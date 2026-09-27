// The script-facing API under /api/v1: what running builds call (public) and
// what an operator's tooling calls with the bearer secret.

import { assess } from "../lib/check";
import { assignKey, findLicense, findLicenseByKey, grantLicense, log, recordTelemetry, type AlarmRow } from "../lib/db";
import {
  HttpError,
  normalizeKey,
  now,
  optionalId,
  optionalString,
  parseBool,
  parseIdOrThrow,
  reply,
} from "../lib/http";
import type { Handler, Router } from "../router";

// The public endpoints below are what running builds call. Each one is
// rate-limited per client IP, and needs the build's licence key: a request
// without one is refused before anything is looked up or stored. Writes
// (telemetry, diagnostics) are also rate-limited per key.

function requireKey(input: Record<string, unknown>): string {
  const raw = input.licenseKey ?? input.licenseId;
  if (raw === undefined || raw === null || raw === "") throw new HttpError(401, "licenseKey is required");
  const key = normalizeKey(raw);
  if (key === null) throw new HttpError(400, "licenseKey must be a non-empty string");
  return key;
}

async function limitIp(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.RL_IP.limit({ key: ip });
  if (!success) throw new HttpError(429, "too many requests; slow down");
}

async function limitKey(env: Env, key: string): Promise<void> {
  const { success } = await env.RL_KEY.limit({ key });
  if (!success) throw new HttpError(429, "too many requests for this licence key; slow down");
}

export function registerV1(router: Router): void {
  // Is this Roblox user licensed, and (when the build sends one) is the key it
  // carries the one issued to that user? `gameId` (game.GameId or
  // game.PlaceId, whichever the build sends) is optional and only used to
  // attribute alarms. Reachable as GET with query parameters or POST with a
  // json body; the key may be sent as `licenseKey` or, as newer builds do,
  // `licenseId`; it is required, and `owned` is only true when it is the
  // one issued to `creatorId`. `tester` says whether the user is a product tester. A
  // `version` in the request is recorded as telemetry so the
  // admin view sees builds that only ever call this endpoint.
  const whitelist: Handler = async ({ request, env, input }) => {
    await limitIp(request, env);
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const gameId = optionalId(input.gameId, "gameId");
    const version = optionalString(input.version, 40);
    const key = requireKey(input);

    const a = await assess(env.DB, creatorId, key, gameId);
    if (version !== null) {
      await recordTelemetry(env.DB, {
        creator_id: creatorId,
        key,
        game_id: gameId,
        version,
        licensed: a.licensed ? 1 : 0,
        key_valid: a.keyValid === null ? null : a.keyValid ? 1 : 0,
      });
    }
    return reply(200, {
      ok: true,
      owned: a.owned,
      licensed: a.licensed,
      keyValid: a.keyValid,
      tester: a.license?.tester === 1,
      creatorId,
      gameId,
      timestamp: now(),
    });
  };
  router.get("/api/v1/whitelist", "none", whitelist);
  router.post("/api/v1/whitelist", "none", whitelist);

  // A running build reporting in: { creatorId, licenseKey, gameId, version }.
  // Stored for the admin telemetry view; failing checks raise the same alarms
  // as /whitelist.
  router.post("/api/v1/telemetry", "none", async ({ request, env, input }) => {
    await limitIp(request, env);
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const gameId = optionalId(input.gameId, "gameId");
    const version = optionalString(input.version, 40);
    const key = requireKey(input);
    await limitKey(env, key);

    const a = await assess(env.DB, creatorId, key, gameId);
    await recordTelemetry(env.DB, {
      creator_id: creatorId,
      key,
      game_id: gameId,
      version,
      licensed: a.licensed ? 1 : 0,
      key_valid: a.keyValid === null ? null : a.keyValid ? 1 : 0,
    });
    return reply(200, { ok: true, owned: a.owned, timestamp: now() });
  });

  // A running build sending a diagnostics report: staff pressed "Send
  // Diagnostics" on the OrbitDebug popup after a critical failure.
  //   { creatorId, licenseKey, gameId, placeId, jobId, version, studio,
  //     reporterId, uptime, players, incidents: [...], log: [...],
  //     console: [...], context: {...} }
  // `log` is Orbit's own log, `console` the server's whole output
  // (LogService history) and `context` a snapshot of versions, place/server,
  // extension status and probe state.
  // The licence is assessed like /whitelist (and raises the same alarms). Only
  // reports carrying a key that was actually issued are stored (a leaked
  // build's report is kept, flagged as a bad key); anything else is refused.
  // One report per server per minute.
  router.post("/api/v1/diagnostics", "none", async ({ request, env, input }) => {
    await limitIp(request, env);
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const gameId = optionalId(input.gameId, "gameId");
    const placeId = optionalId(input.placeId, "placeId");
    const reporterId = optionalId(input.reporterId, "reporterId");
    const jobId = optionalString(input.jobId, 64);
    const version = optionalString(input.version, 40);
    const studio = parseBool(input.studio);
    const key = requireKey(input);
    if ((await findLicenseByKey(env.DB, key)) === null) throw new HttpError(401, "unknown licence key");
    await limitKey(env, key);

    const incidents = parseIncidents(input.incidents);
    if (incidents.length === 0) throw new HttpError(400, "incidents must list at least one failure");
    const lines = parseLogLines(input.log);
    const payload = JSON.stringify({
      incidents,
      log: lines,
      console: parseConsole(input.console),
      context: parseContext(input.context),
      uptime: finiteOrNull(input.uptime),
      players: finiteOrNull(input.players),
    });
    if (payload.length > MAX_DIAGNOSTICS_PAYLOAD) throw new HttpError(413, "report is too large");

    const ts = now();
    const recent = await env.DB.prepare(
      `SELECT id FROM diagnostics
       WHERE ts > ?1 AND (job_id = ?2 OR (?2 IS NULL AND job_id IS NULL AND creator_id = ?3))
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(ts - 60, jobId, creatorId)
      .first<{ id: number }>();
    if (recent !== null) return reply(200, { ok: true, id: recent.id, duplicate: true });

    const a = await assess(env.DB, creatorId, key, gameId);
    const codes = [...new Set(incidents.map((i) => i.code))].join(",");
    const first = incidents[0];
    const summary = `${first.code} ${first.title}${first.source ? ` (${first.source})` : ""}: ${first.detail}`.slice(0, 300);

    const result = await env.DB.prepare(
      `INSERT INTO diagnostics (ts, creator_id, key, licensed, key_valid, game_id, place_id, job_id, version, studio,
                                reporter_id, codes, summary, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
      .bind(
        ts,
        creatorId,
        key,
        a.licensed ? 1 : 0,
        a.keyValid === null ? null : a.keyValid ? 1 : 0,
        gameId,
        placeId,
        jobId,
        version,
        studio ? 1 : 0,
        reporterId,
        codes,
        summary,
        payload,
      )
      .run();
    const id = result.meta.last_row_id;
    await log(env.DB, "info", "diagnostics.report", `roblox:${creatorId}`, `report #${id}: ${codes} from game ${gameId ?? "?"}`, {
      id,
      gameId,
      placeId,
      jobId,
    });
    return reply(201, { ok: true, id });
  });

  // Grants a Roblox user the product. Idempotent.
  router.post("/api/v1/licenses/issue", "secret", async ({ env, input }) => {
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const { license, created } = await grantLicense(env.DB, creatorId, "api", null);
    if (!created) {
      return reply(200, {
        ok: true,
        alreadyLicensed: true,
        creatorId,
        licensedAt: license.licensed_at,
        hasKey: license.key !== null,
      });
    }
    await log(env.DB, "info", "license.issue", "api", `licensed ${creatorId} via the API`, { creatorId });
    return reply(201, { ok: true, creatorId, licensedAt: license.licensed_at });
  });

  // Issues the key for a licensed user's build. Each user has exactly one; a
  // second call is refused unless `rotate` is set, which replaces the old key.
  router.post("/api/v1/keys/issue", "secret", async ({ env, input }) => {
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const rotate = parseBool(input.rotate);

    const license = await findLicense(env.DB, creatorId);
    if (license === null) throw new HttpError(404, "user is not licensed");
    if (license.key !== null && !rotate) {
      throw new HttpError(409, "user already has a key; pass rotate=true to replace it");
    }
    const key = await assignKey(env.DB, creatorId);
    await log(env.DB, "info", license.key !== null ? "key.rotate" : "key.issue", "api", `key for ${creatorId}`, {
      creatorId,
    });
    return reply(201, { ok: true, creatorId, key, issuedAt: now(), rotated: license.key !== null });
  });

  // Open key-mismatch alarms, newest first, optionally only those involving a
  // given user's key. Kept for compatibility with the earlier API; the admin
  // page shows the same data.
  router.get("/api/v1/keys/mismatches", "secret", async ({ env, input }) => {
    const ownerId = optionalId(input.creatorId, "creatorId");
    const statement =
      ownerId === null
        ? env.DB.prepare(
            "SELECT * FROM alarms WHERE kind = 'key_mismatch' AND cleared_at IS NULL ORDER BY last_seen DESC LIMIT 200",
          )
        : env.DB.prepare(
            "SELECT * FROM alarms WHERE kind = 'key_mismatch' AND cleared_at IS NULL AND key_owner_id = ?1 ORDER BY last_seen DESC LIMIT 200",
          ).bind(ownerId);
    const { results } = await statement.all<AlarmRow>();
    return reply(200, {
      ok: true,
      mismatches: results.map((row) => ({
        key: row.key,
        keyOwnerId: row.key_owner_id,
        presentedBy: row.creator_id,
        gameId: row.game_id,
        count: row.count,
        firstSeen: row.first_seen,
        seenAt: row.last_seen,
      })),
    });
  });
}

// DIAGNOSTICS ----------------------------------------------------------------

// D1 caps a row at 2 MB; a full report (1000 console lines) is well under this.
const MAX_DIAGNOSTICS_PAYLOAD = 1_500_000;
const MAX_CONTEXT = 32 * 1024;
const LOG_LEVELS = ["info", "warn", "error"] as const;

export interface DiagnosticIncident {
  code: number;
  title: string;
  detail: string;
  source: string | null;
  count: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface DiagnosticLogLine {
  at: number | null;
  level: (typeof LOG_LEVELS)[number];
  text: string;
}

const CONSOLE_TYPES = ["output", "info", "warn", "error"] as const;

export interface DiagnosticConsoleLine {
  at: number | null;
  type: (typeof CONSOLE_TYPES)[number];
  text: string;
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return value === undefined || value === null || !Number.isFinite(n) ? null : n;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// The build's open failures, oldest first. Anything malformed is dropped
// rather than failing the whole report.
function parseIncidents(value: unknown): DiagnosticIncident[] {
  if (!Array.isArray(value)) return [];
  const out: DiagnosticIncident[] = [];
  for (const raw of value.slice(0, 25)) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const code = Number(r.code);
    if (!Number.isInteger(code) || code <= 0 || code > 9999) continue;
    out.push({
      code,
      title: text(r.title, 80) || "Unknown failure",
      detail: text(r.detail, 4000),
      source: text(r.source, 120) || null,
      count: Math.max(1, Math.min(Number(r.count) || 1, 1_000_000)),
      firstAt: finiteOrNull(r.firstAt),
      lastAt: finiteOrNull(r.lastAt),
    });
  }
  return out;
}

// The server's recent Orbit log, oldest first.
function parseLogLines(value: unknown): DiagnosticLogLine[] {
  if (!Array.isArray(value)) return [];
  const out: DiagnosticLogLine[] = [];
  for (const raw of value.slice(-600)) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const level = (LOG_LEVELS as readonly unknown[]).includes(r.level) ? (r.level as DiagnosticLogLine["level"]) : "info";
    out.push({ at: finiteOrNull(r.at), level, text: text(r.text, 2000) });
  }
  return out;
}

// The server's whole console output (LogService history), oldest first.
function parseConsole(value: unknown): DiagnosticConsoleLine[] {
  if (!Array.isArray(value)) return [];
  const out: DiagnosticConsoleLine[] = [];
  for (const raw of value.slice(-1500)) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = (CONSOLE_TYPES as readonly unknown[]).includes(r.type) ? (r.type as DiagnosticConsoleLine["type"]) : "output";
    out.push({ at: finiteOrNull(r.at), type, text: text(r.text, 1000) });
  }
  return out;
}

// Free-form snapshot from the build; kept as sent when it is a small object.
function parseContext(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const json = JSON.stringify(value);
  return json.length <= MAX_CONTEXT ? (value as Record<string, unknown>) : { truncated: true, size: json.length };
}
