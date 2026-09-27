# Axion

Licence server and website for **Orbit** (flux studio), deployed as a
Cloudflare Worker with a D1 (SQLite) database, an R2 bucket for releases and a
Vite + React frontend served as static assets. Everything runs on Cloudflare
at [orbitroblox.xyz](https://orbitroblox.xyz).

> **Branding notice.** The names *Axion*, *Orbit* and *Flux Studio*, and the
> logos and other brand assets in this repository (including
> `frontend/public/logo.png` and `frontend/public/favicon.png`), are the
> property of Flux Studio. The code is MIT-licensed (see [LICENSE](LICENSE));
> that licence covers the code only and grants no right to the brand. If you
> use, fork or deploy this code, rename the
> project and replace every name, logo, domain, link and legal text that
> refers to Flux Studio or its products before publishing it.

```
backend/src/index.ts       the Worker entry: router + nightly cron
backend/src/router.ts      method + URLPattern router with none/secret/session/admin access
backend/src/routes/v1.ts   script-facing API (whitelist, telemetry, bearer-secret issue endpoints)
backend/src/routes/account.ts  Discord sign-in, /api/me, Parcel claim, per-user download
backend/src/routes/admin.ts    everything under /api/admin
backend/src/lib/           db queries, auth, integrations (Bloxlink, Parcel, nyxyl), rbxmx rewriting
backend/migrations/        D1 schema (applied by `npm run dev` / `npm run deploy`)
frontend/src/              the React app: pages/, pages/admin/, ui.tsx, styles.css
frontend/public/           copied verbatim into the build; holds _redirects and favicon.svg
index.html                 Vite entry for the app
vite.config.ts             Vite + Cloudflare plugin
wrangler.jsonc             Worker configuration (D1, R2, cron, assets)
```

## Model

- A **license** means a Roblox user owns the product. It is keyed by Roblox
  user id and can come from the API, an admin, a paste-import, or a Parcel
  migration.
- A **key** is a per-user token baked into that user's obfuscated build. Each
  user has exactly one; it is issued automatically on first download. Whitelist
  checks confirm the key the build presents is the one issued to the user
  running it; if not, the check fails and an **alarm** is raised — the key
  tells you whose build leaked.
- A **user** is a Discord account that signed in. Its Roblox account comes
  from Bloxlink (looked up once and cached until the user asks for a re-check).
- A **release** is an `.rbxmx` an admin uploaded. On download, every script
  containing the key marker (`__LICENSE_KEY` by default) has it replaced with
  the user's key and is obfuscated through nyxyl's Umbra API. The result is
  cached per (release, user) in R2 until the key rotates or the release changes.
- A release is on the **production** channel (every licensee) or the
  **tester** channel: non-production builds that only **product testers** see.
  An admin makes a licensee a tester on the Licences page (or ticks "product
  tester" when granting); tester builds carry the tester's own key like any
  other. Moving a release from testers to production promotes it for everyone.
- **Alarms** are collapsed: one open row per (kind, user, key, game) that
  counts repeats. **Logs** have a level; info rows are dropped after 24 h by the
  nightly cron, warn/error rows stay until an admin resolves them.
  **Telemetry** is kept for a configurable number of days.

## Site

| Path | What |
|---|---|
| `/` | Landing: docs link, licence agreement, disabled "Buy · 199 R$" |
| `/login` | Discord sign-in (Roblox sign-in shown as WIP) |
| `/account` | Roblox link status, licence, Parcel claim, downloads (plus tester builds for product testers), data-deletion request |
| `/terms`, `/privacy` | Terms of Service and Privacy Policy (telemetry disclosed) |
| `/admin` | Overview, Alarms, Diagnostics, Releases, Licences, Users, Telemetry, Logs, Settings |

Admins are the Discord ids listed in `ADMIN_DISCORD_IDS` in
[backend/src/lib/auth.ts](backend/src/lib/auth.ts). Moderators
(`MODERATOR_DISCORD_IDS`, same file) see only the Licences page: they can
grant and revoke licences, issue and rotate keys, and appoint or remove
product testers — no bulk import, releases, settings, users, logs or
telemetry.

## Script-facing API

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/whitelist?creatorId=123&licenseKey=…[&gameId=…]` | key | `{ ok, owned, licensed, keyValid, tester, creatorId, gameId, timestamp }`. `owned` is true only when the user is licensed and the key is theirs. `tester` is true for product testers. Failures raise alarms. |
| `POST /api/v1/whitelist` `{ creatorId, licenseId, gameId, version }` | key | Same check and response as the GET form. `licenseId` and `licenseKey` are interchangeable; a `version`, when sent, is also recorded as telemetry. |
| `POST /api/v1/telemetry` `{ creatorId, licenseKey, gameId, version }` | key | Records a ping; same checks and alarms as whitelist. |
| `POST /api/v1/diagnostics` `{ creatorId, licenseKey, gameId, placeId, jobId, version, studio, reporterId, uptime, players, incidents[], log[] }` | key | A report from the in-game OrbitDebug popup ("Send Diagnostics") → `201 { id }`. Same licence checks and alarms as whitelist; stored only when the key was actually issued (`401` otherwise) and listed under Admin → Diagnostics. One per server (`jobId`) per minute: a repeat returns the earlier `id` with `duplicate: true`. Resolved reports are dropped after the telemetry retention window. |
| `POST /api/v1/licenses/issue` `{ creatorId }` | Bearer | Grant the product. Idempotent (`alreadyLicensed: true` on repeat). |
| `POST /api/v1/keys/issue` `{ creatorId, rotate? }` | Bearer | Issue the user's build key → `201 { key, … }`. `404` if unlicensed, `409` if they already have one unless `rotate: true`. |
| `GET /api/v1/keys/mismatches[?creatorId=123]` | Bearer | Open key-mismatch alarms, newest first (`count` = collapsed hits). |

**key** endpoints need the build's licence key (`licenseKey` or `licenseId`);
without one they answer `401` and store nothing. They are also rate-limited:
120 requests a minute per client IP, and telemetry and diagnostics 60 a minute
per key (the `ratelimits` bindings in `wrangler.jsonc`). Over the limit they
answer `429`, which a build should treat as "try again later", not as
unlicensed.

Bearer endpoints need `Authorization: Bearer <API_SECRET>`. Parameters can be
query-string or a JSON body (body wins). `gameId` is `game.GameId` (the
universe id).

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars          # then fill in the secrets (SESSION_SECRET needs 16+ chars)
npm run dev                              # http://localhost:5173
```

`npm run dev` first applies `backend/migrations` to a local D1 copy (kept in
`.wrangler/`), then starts Vite with the Cloudflare plugin: the React app gets
hot reload and the Worker runs in the real Workers runtime on the same origin
with a local D1 and R2. Poke at the database with
`npx wrangler d1 execute axion --local --command "SELECT * FROM licenses"`.

For Discord sign-in locally, add `http://localhost:5173/api/auth/discord/callback`
as a redirect URI on the Discord application. To try the admin pages without
Discord, add your own Discord id to `ADMIN_DISCORD_IDS` and insert a user and
session row directly:

```sh
npx wrangler d1 execute axion --local --command "INSERT INTO users (discord_id,discord_username,created_at,last_login_at) VALUES ('<your-discord-id>','me',0,0); INSERT INTO sessions (id,discord_id,created_at,expires_at) VALUES ('$(openssl rand -hex 32)','<your-discord-id>',0,9999999999)"
```

then set the `axion_session` cookie to that id in the browser.

`npm run preview` builds and serves the production bundle locally (this is
the one that honours `_redirects`). `npm run check` type-checks both the
Worker and the app; run `npm run types` first after changing `wrangler.jsonc`.

## Deploy

```sh
# 1. Storage (once)
npx wrangler d1 create axion             # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create axion-files

# 2. Secrets (random values: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
npx wrangler secret put API_SECRET        # bearer token for the v1 issue endpoints; random
npx wrangler secret put SESSION_SECRET    # signs cookies; random, 16+ chars (32+ recommended)
npx wrangler secret put DISCORD_CLIENT_ID      # Discord developer portal → your app → OAuth2
npx wrangler secret put DISCORD_CLIENT_SECRET  # same page; add <origin>/api/auth/discord/callback as redirect URI

# 3. Ship it (builds, applies pending migrations to the remote DB, then deploys)
npm run deploy
```

Then sign in as an admin and fill in **Admin → Settings**: the Bloxlink guild
id and server API key, the Parcel hub/product ids (and enable claiming), the
nyxyl API key and obfuscation mode. Everything else has a default.

`wrangler.jsonc` binds the Worker to `orbitroblox.xyz` as a custom domain, so
the first deploy also creates the DNS record and certificate — the zone just
has to be on the same Cloudflare account. The cron trigger (`0 4 * * *`) is
registered by the same deploy.

Schema changes go in a new file under `backend/migrations/` (e.g.
`0003_something.sql`); both `dev` and `deploy` apply whatever is pending.

## Short links

`frontend/public/_redirects` holds short links (`/github`, `/discord`, …)
that forward to external pages.

They are answered by the asset layer (302), before the SPA fallback and
without invoking the Worker. Add more as `/path https://… 302` lines. Note
that `_redirects` is applied by `npm run preview` and in production but **not**
by the `npm run dev` server, where those paths just show the app's 404 view.

## From Roblox

Put the marker in a string in the script that reads the key; the site swaps
it for the user's key at download time and obfuscates that script.

```lua
local HttpService = game:GetService("HttpService")
local BASE = "https://orbitroblox.xyz"
local BUILD_KEY = "__LICENSE_KEY" -- replaced per user on download
local VERSION = "3.2.0"

-- The licensed Roblox *user* id. For a group-owned game, game.CreatorId is
-- the group, so put the licence holder's user id here instead.
local CREATOR_ID = game.CreatorId

local function isWhitelisted(): boolean?
    local url = `{BASE}/api/v1/whitelist?creatorId={CREATOR_ID}&licenseKey={BUILD_KEY}&gameId={game.GameId}`
    local ok, body = pcall(HttpService.GetAsync, HttpService, url)
    if not ok then
        return nil -- network error or 429: retry later rather than treating it as unlicensed
    end
    return HttpService:JSONDecode(body).owned == true
end

local function telemetry()
    pcall(HttpService.PostAsync, HttpService, `{BASE}/api/v1/telemetry`, HttpService:JSONEncode({
        creatorId = CREATOR_ID,
        licenseKey = BUILD_KEY,
        gameId = game.GameId,
        version = VERSION,
    }), Enum.HttpContentType.ApplicationJson)
end
```

Keep `API_SECRET` in a server Script only; never ship it to clients.

## License

The code is released under the [MIT License](LICENSE). The Axion, Orbit and
Flux Studio names and brand assets are not covered by it; see the branding
notice at the top.
