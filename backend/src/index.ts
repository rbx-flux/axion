// Axion licence server, Cloudflare Workers edition, backed by D1.
//
// A *license* says a Roblox user owns the product. A *key* is a per-user
// token baked into that user's obfuscated build; whitelist checks confirm
// the key belongs to the user presenting it, so a build running under
// somebody else's account is caught and traced back to whoever it was
// issued to.
//
//   GET  /api/v1/whitelist?creatorId=123[&licenseKey=...]   public
//   POST /api/v1/licenses/issue  { creatorId }               Bearer secret
//   POST /api/v1/keys/issue      { creatorId, rotate? }      Bearer secret
//   GET  /api/v1/keys/mismatches [?creatorId=123]            Bearer secret
//
// The schema lives in backend/migrations and is applied with
// `wrangler d1 migrations apply`.

// TYPES ----------------------------------------------------------------------

type Input = Record<string, unknown>;

interface Context {
  request: Request;
  env: Env;
  input: Input;
}

type Handler = (ctx: Context) => Promise<Response>;

interface Route {
  handler: Handler;
  // Requires `Authorization: Bearer <API_SECRET>`; checked before the handler runs.
  auth?: boolean;
}

type Endpoint = Partial<Record<string, Route>>;

// A row of `licenses`. `key` is NULL until one is issued for the user.
interface LicenseRow {
  creator_id: number;
  key: string | null;
  licensed_at: number;
  key_issued_at: number | null;
}

interface MismatchRow {
  id: number;
  key: string;
  key_owner_id: number | null;
  presented_creator_id: number;
  seen_at: number;
}

// DATABASE -------------------------------------------------------------------

const SELECT = "SELECT creator_id, key, licensed_at, key_issued_at FROM licenses";

function findByCreator(db: D1Database, creatorId: number): Promise<LicenseRow | null> {
  return db.prepare(`${SELECT} WHERE creator_id = ?1`).bind(creatorId).first<LicenseRow>();
}

function findByKey(db: D1Database, key: string): Promise<LicenseRow | null> {
  return db.prepare(`${SELECT} WHERE key = ?1`).bind(key).first<LicenseRow>();
}

// Records a key being presented by someone it was not issued to. `owner` is
// the user whose build the key came from, when the key is known at all.
function recordMismatch(
  db: D1Database,
  key: string,
  owner: LicenseRow | null,
  presentedBy: number,
): Promise<D1Result> {
  return db
    .prepare(
      "INSERT INTO key_mismatches (key, key_owner_id, presented_creator_id, seen_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(key, owner?.creator_id ?? null, presentedBy, now())
    .run();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

// HELPERS --------------------------------------------------------------------

function reply(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fail(status: number, error: string): Response {
  return reply(status, { ok: false, error });
}

const now = (): number => Math.floor(Date.now() / 1000);

// Merges query parameters with a json body (body wins), so callers can use
// either `?creatorId=1` or `{"creatorId": 1}`. Throws on malformed json.
async function readInput(request: Request): Promise<Input> {
  const input: Input = {};
  for (const [key, value] of new URL(request.url).searchParams) input[key] = value;

  const contentType = request.headers.get("content-type") ?? "";
  if (request.body !== null && contentType.includes("application/json")) {
    const text = await request.text();
    if (text.length > 0) {
      const decoded: unknown = JSON.parse(text);
      if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
        Object.assign(input, decoded);
      }
    }
  }
  return input;
}

// Roblox user ids are positive integers; accept them as numbers or strings.
function parseCreatorId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  if (key.length === 0 || key.length > 64) return null;
  return key;
}

// Keys look like AXION-1A2B3-4C5D6-7E8F9-0A1B2 (20 hex chars, 80 bits).
function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const groups = hex.match(/.{5}/g) ?? [];
  return `AXION-${groups.join("-")}`;
}

// Compares two strings without leaking how much of them matched.
function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

// The issue endpoints need `Authorization: Bearer <API_SECRET>`.
function authorized(request: Request, env: Env): boolean {
  if (typeof env.API_SECRET !== "string" || env.API_SECRET.length < 16) return false;
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const match = /^bearer\s+(.+)$/i.exec(header);
  if (match === null) return false;
  return constantTimeEquals(match[1], env.API_SECRET);
}

// ROUTES ---------------------------------------------------------------------

// Is this Roblox user licensed, and (when the build sends one) is the key it
// carries the one issued to that user? A key that belongs to someone else, or
// to nobody, is logged as a mismatch and the check fails.
const whitelist: Handler = async ({ env, input }) => {
  const creatorId = parseCreatorId(input.creatorId);
  if (creatorId === null) return fail(400, "creatorId must be a positive integer");

  const license = await findByCreator(env.DB, creatorId);
  const licensed = license !== null;
  let keyValid: boolean | null = null;

  if (input.licenseKey !== undefined) {
    const key = normalizeKey(input.licenseKey);
    if (key === null) return fail(400, "licenseKey must be a non-empty string");

    const issuedKey = license?.key ?? null;
    keyValid = issuedKey !== null && constantTimeEquals(key, issuedKey);
    if (!keyValid) {
      const owner = await findByKey(env.DB, key);
      console.warn(
        `key mismatch: ${key} (issued to ${owner?.creator_id ?? "nobody"}) presented by ${creatorId}`,
      );
      await recordMismatch(env.DB, key, owner, creatorId);
    }
  }

  return reply(200, {
    ok: true,
    owned: licensed && keyValid !== false,
    licensed,
    keyValid,
    creatorId,
    timestamp: now(),
  });
};

// Grants a Roblox user the product. Idempotent: an already licensed user just
// gets their existing record back.
const issueLicense: Handler = async ({ env, input }) => {
  const creatorId = parseCreatorId(input.creatorId);
  if (creatorId === null) return fail(400, "creatorId must be a positive integer");

  const existing = await findByCreator(env.DB, creatorId);
  if (existing !== null) {
    return reply(200, {
      ok: true,
      alreadyLicensed: true,
      creatorId,
      licensedAt: existing.licensed_at,
      hasKey: existing.key !== null,
    });
  }

  const licensedAt = now();
  await env.DB.prepare("INSERT INTO licenses (creator_id, licensed_at) VALUES (?1, ?2)")
    .bind(creatorId, licensedAt)
    .run();

  return reply(201, { ok: true, creatorId, licensedAt });
};

// Issues the key for a licensed user's build. Each user has exactly one; a
// second call is refused unless `rotate` is set, which replaces the old key
// (so a leaked build can be cut off by shipping the owner a new one).
const issueKey: Handler = async ({ env, input }) => {
  const creatorId = parseCreatorId(input.creatorId);
  if (creatorId === null) return fail(400, "creatorId must be a positive integer");
  const rotate = input.rotate === true || input.rotate === "true";

  const license = await findByCreator(env.DB, creatorId);
  if (license === null) return fail(404, "user is not licensed");
  if (license.key !== null && !rotate) {
    return fail(409, "user already has a key; pass rotate=true to replace it");
  }

  const issuedAt = now();
  // Collisions are astronomically unlikely; the UNIQUE constraint catches one
  // anyway, so just try again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateKey();
    try {
      await env.DB.prepare("UPDATE licenses SET key = ?1, key_issued_at = ?2 WHERE creator_id = ?3")
        .bind(key, issuedAt, creatorId)
        .run();
      return reply(201, { ok: true, creatorId, key, issuedAt, rotated: license.key !== null });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return fail(500, "could not generate a unique key");
};

// Lists recorded mismatches, newest first, optionally only those involving a
// given user's key. This is where a pirated build shows up: `keyOwnerId` is
// whose build it was, `presentedBy` is who ran it.
const listMismatches: Handler = async ({ env, input }) => {
  let ownerId: number | null = null;
  if (input.creatorId !== undefined) {
    ownerId = parseCreatorId(input.creatorId);
    if (ownerId === null) return fail(400, "creatorId must be a positive integer");
  }

  const statement =
    ownerId === null
      ? env.DB.prepare("SELECT * FROM key_mismatches ORDER BY seen_at DESC, id DESC LIMIT 200")
      : env.DB.prepare(
          "SELECT * FROM key_mismatches WHERE key_owner_id = ?1 ORDER BY seen_at DESC, id DESC LIMIT 200",
        ).bind(ownerId);
  const { results } = await statement.all<MismatchRow>();

  return reply(200, {
    ok: true,
    mismatches: results.map((row) => ({
      key: row.key,
      keyOwnerId: row.key_owner_id,
      presentedBy: row.presented_creator_id,
      seenAt: row.seen_at,
    })),
  });
};

const routes = {
  api: {
    v1: {
      whitelist: { GET: { handler: whitelist } },
      licenses: { issue: { POST: { handler: issueLicense, auth: true } } },
      keys: {
        issue: { POST: { handler: issueKey, auth: true } },
        mismatches: { GET: { handler: listMismatches, auth: true } },
      },
    },
  },
};

// Walks `routes` by path segment and returns the { METHOD: route } table at
// the end, or null.
function resolve(segments: string[]): Endpoint | null {
  let node: unknown = routes;
  for (const segment of segments) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[segment];
    if (node === undefined) return null;
  }
  if (node === null || typeof node !== "object") return null;
  // an endpoint is an object whose values are all routes
  const values = Object.values(node as Record<string, unknown>);
  const isRoute = (v: unknown): boolean =>
    v !== null && typeof v === "object" && typeof (v as Route).handler === "function";
  if (values.length === 0 || !values.every(isRoute)) return null;
  return node as Endpoint;
}

// WORKER ---------------------------------------------------------------------

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter((s) => s.length > 0);

    // Only /api/* is configured to reach the Worker; anything else that does
    // arrive goes to the static frontend.
    if (segments[0] !== "api") return env.ASSETS.fetch(request);

    const endpoint = resolve(segments);
    if (endpoint === null) return fail(404, "not found");

    const route = endpoint[request.method];
    if (route === undefined) {
      const allow = Object.keys(endpoint).sort().join(", ");
      return reply(405, { ok: false, error: "method not allowed" }, { allow });
    }

    if (route.auth && !authorized(request, env)) return fail(401, "unauthorized");

    let input: Input;
    try {
      input = await readInput(request);
    } catch {
      return fail(400, "body must be valid json");
    }

    try {
      return await route.handler({ request, env, input });
    } catch (error) {
      // Logged for observability; the client only learns that we failed.
      console.error(`${request.method} ${url.pathname} failed:`, error);
      return fail(500, "internal error");
    }
  },
} satisfies ExportedHandler<Env>;
