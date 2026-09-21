# Axion

Licence server for the Roblox product, deployed as a Cloudflare Worker with a
D1 (SQLite) database and a Vite + React frontend served as static assets.
Everything runs on Cloudflare at [orbitroblox.xyz](https://orbitroblox.xyz);
there is no external database to host.

> **Branding notice.** The names *Axion*, *Orbit* and *Flux Studio*, and the
> logos and other brand assets in this repository are the property of Flux
> Studio. The source is public for reference, but no right to the brand is
> granted. If you use, fork or deploy this code, rename the project and
> replace every name, logo, domain, link and legal text that refers to Flux
> Studio or its products before publishing it.

```
backend/src/index.ts     the Worker (API)
backend/migrations/      the licenses table (D1 migrations)
frontend/src/            the React app (placeholder site)
frontend/public/         copied verbatim into the build; holds _redirects
index.html               Vite entry for the app
vite.config.ts           Vite + Cloudflare plugin
wrangler.jsonc           Worker configuration
```

## Short links

`frontend/public/_redirects` holds short links (`/github`, `/discord`, …)
that forward to external pages.

They are answered by the asset layer (302), before the SPA fallback and
without invoking the Worker. Add more as `/path https://… 302` lines. Note
that `_redirects` is applied by `npm run preview` and in production but **not**
by the `npm run dev` server, where those paths just show the app's 404 view.

## Model

- A **license** means a Roblox user owns the product.
- A **key** is a per-user token baked into that user's obfuscated build. Each
  user has exactly one. Whitelist checks confirm the key the build presents is
  the one issued to the user running it; if it is not, the check fails and the
  mismatch is recorded — the key tells you whose build leaked.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/whitelist?creatorId=123[&licenseKey=…]` | none | `{ ok, owned, licensed, keyValid, creatorId, timestamp }`. `owned` is true when the user is licensed and the key (if sent) is theirs. |
| `POST /api/v1/licenses/issue` `{ creatorId }` | Bearer | Grant the product. Idempotent (`alreadyLicensed: true` on repeat). |
| `POST /api/v1/keys/issue` `{ creatorId, rotate? }` | Bearer | Issue the user's build key → `201 { key, … }`. `404` if unlicensed, `409` if they already have one unless `rotate: true`, which replaces it (use after a leak). |
| `GET /api/v1/keys/mismatches[?creatorId=123]` | Bearer | Recent mismatches, newest first: `{ key, keyOwnerId, presentedBy, seenAt }`. Filter by the key owner to see who is running a given user's build. |

Bearer endpoints need `Authorization: Bearer <API_SECRET>`. Parameters can be
query-string or a JSON body (body wins). Mismatches are also written to the
Worker log as warnings.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars          # then set API_SECRET (16+ chars)
npm run dev                              # http://localhost:5173
```

`npm run dev` first applies `backend/migrations` to a local D1 copy (kept in
`.wrangler/`), then starts Vite with the Cloudflare plugin: the React app gets
hot reload and the Worker runs in the real Workers runtime on the same origin,
so `/api/*` just works. Poke at the database with
`npx wrangler d1 execute axion --local --command "SELECT * FROM licenses"`.

`npm run preview` builds and serves the production bundle locally (this is
the one that honours `_redirects`). `npm run check` type-checks both the
Worker and the app; run `npm run types` first after changing `wrangler.jsonc`.

## Deploy

```sh
# 1. Create the database (once)
npx wrangler d1 create axion
#    → paste the returned database_id into wrangler.jsonc

# 2. The secret the issue endpoints check
npx wrangler secret put API_SECRET

# 3. Ship it (builds, applies pending migrations to the remote DB, then deploys)
npm run deploy
```

`wrangler.jsonc` binds the Worker to `orbitroblox.xyz` as a custom domain, so
the first deploy also creates the DNS record and certificate — the zone just
has to be on the same Cloudflare account. The `*.workers.dev` URL keeps
working alongside it. The build writes `dist/axion/wrangler.json` (with the
asset directory filled in) and points `wrangler deploy` at it via
`.wrangler/deploy/config.json`; both are generated, neither is committed.

Schema changes go in a new file under `backend/migrations/` (e.g.
`0002_something.sql`); both `dev` and `deploy` apply whatever is pending.

## From Roblox

The build carries its own key; send it with every check.

```lua
local HttpService = game:GetService("HttpService")
local BASE = "https://orbitroblox.xyz"
local BUILD_KEY = "AXION-XXXXX-XXXXX-XXXXX-XXXXX" -- baked into this obfuscated build

local function isWhitelisted(userId: number): boolean
    local body = HttpService:GetAsync(`{BASE}/api/v1/whitelist?creatorId={userId}&licenseKey={BUILD_KEY}`)
    return HttpService:JSONDecode(body).owned == true
end
```

Keep `API_SECRET` in a server Script only; never ship it to clients.
