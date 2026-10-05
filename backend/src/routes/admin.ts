// The admin API behind /admin: releases, alarms, diagnostics, licences, logs,
// telemetry, users and settings. Every route needs a signed-in admin, except licence
// and product-tester management, which moderators may use too.

import {
  assignKey,
  findFile,
  findLicense,
  grantLicense,
  isChannel,
  isSettingKey,
  listFiles,
  loadSettings,
  log,
  saveSettings,
  SECRET_SETTINGS,
  setTester,
  type AlarmRow,
  type Channel,
  type DiagnosticRow,
  type LicenseRow,
  type Level,
  type LogRow,
  type SettingKey,
  type Settings,
  type TelemetryRow,
  type UserRow,
} from "../lib/db";
import { HttpError, now, optionalId, optionalString, parseBool, parseId, parseIdOrThrow, parseString, randomToken, reply } from "../lib/http";
import { countMarkedScripts, isRbxmx } from "../lib/rbxmx";
import { rotatePrincipal, setPrincipalRevoked } from "../lib/integrations";
import { isAdmin } from "../lib/auth";
import type { Router } from "../router";
import { presentFile, presentLicense, presentUser } from "./account";

const CHANNEL_NAMES: Record<Channel, string> = { release: "production", beta: "the public beta", tester: "testers" };

const MAX_UPLOAD = 50 * 1024 * 1024;
const LEVELS: Level[] = ["info", "warn", "error"];

function actor(user: UserRow | null): string {
  return (user as UserRow).discord_id;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export function registerAdmin(router: Router): void {
  // OVERVIEW -----------------------------------------------------------------

  router.get("/api/admin/overview", "admin", async ({ env }) => {
    const ts = now();
    const [licenses, users, alarms, logs, telemetry, files, diagnostics] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(key IS NOT NULL) AS keyed, SUM(tester) AS testers FROM licenses"),
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(roblox_id IS NOT NULL) AS linked FROM users"),
      env.DB.prepare("SELECT level, COUNT(*) AS n, SUM(count) AS hits FROM alarms WHERE cleared_at IS NULL GROUP BY level"),
      env.DB.prepare("SELECT level, COUNT(*) AS n FROM logs WHERE resolved_at IS NULL AND level != 'info' GROUP BY level"),
      env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT creator_id) AS users, COUNT(DISTINCT game_id) AS games FROM telemetry WHERE ts > ?1").bind(ts - 86400),
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(published) AS published FROM files"),
      env.DB.prepare("SELECT COUNT(*) AS open, COUNT(DISTINCT creator_id) AS users FROM diagnostics WHERE resolved_at IS NULL"),
    ]);
    const byLevel = (rows: Record<string, unknown>[]) =>
      Object.fromEntries(rows.map((r) => [r.level as string, { rows: r.n, hits: r.hits ?? r.n }]));
    return reply(200, {
      ok: true,
      now: ts,
      licenses: licenses.results[0],
      users: users.results[0],
      alarms: byLevel(alarms.results as Record<string, unknown>[]),
      logs: byLevel(logs.results as Record<string, unknown>[]),
      telemetry24h: telemetry.results[0],
      files: files.results[0],
      diagnostics: diagnostics.results[0],
    });
  });

  // FILES --------------------------------------------------------------------

  router.get("/api/admin/files", "admin", async ({ env }) => {
    const files = await listFiles(env.DB);
    const { results: buildCounts } = await env.DB.prepare(
      "SELECT file_id, COUNT(*) AS n FROM builds GROUP BY file_id",
    ).all<{ file_id: string; n: number }>();
    const counts = new Map(buildCounts.map((r) => [r.file_id, r.n]));
    return reply(200, {
      ok: true,
      files: files.map((f) => ({ ...presentFile(f), builds: counts.get(f.id) ?? 0 })),
    });
  });

  // multipart/form-data: file (.rbxmx), name?, version?, notes?, published?,
  // channel? (release | beta | tester, default release)
  router.post("/api/admin/files", "admin", async ({ request, env, user }) => {
    const form = await request.formData().catch(() => null);
    if (form === null) throw new HttpError(400, "expected multipart form data");
    const upload = form.get("file");
    if (!(upload instanceof File)) throw new HttpError(400, "attach the .rbxmx as `file`");
    if (upload.size > MAX_UPLOAD) throw new HttpError(413, "file is larger than 50 MB");
    if (!upload.name.toLowerCase().endsWith(".rbxmx")) {
      throw new HttpError(400, "only .rbxmx files can be published (Save as… → Roblox XML Model)");
    }
    const xml = await upload.text();
    if (!isRbxmx(xml)) throw new HttpError(400, "that is not a Roblox XML model (.rbxmx)");

    const settings = await loadSettings(env.DB);
    const marker = settings.key_marker || "__LICENSE_KEY";
    const markerHits = countMarkedScripts(xml, marker);

    const id = randomToken(8);
    const name = optionalString(form.get("name"), 120) ?? upload.name;
    const version = optionalString(form.get("version"), 40);
    const notes = optionalString(form.get("notes"), 2000);
    const published = parseBool(form.get("published"));
    const channel = parseChannel(form.get("channel"), "release");
    const r2Key = `releases/${id}.rbxmx`;

    await env.FILES.put(r2Key, xml, { httpMetadata: { contentType: "application/xml" } });
    await env.DB.prepare(
      `INSERT INTO files (id, name, version, notes, size, r2_key, marker_hits, published, channel, uploaded_at, uploaded_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(id, name, version, notes, upload.size, r2Key, markerHits, published ? 1 : 0, channel, now(), actor(user))
      .run();
    await log(env.DB, markerHits === 0 ? "warn" : "info", "file.upload", actor(user), `uploaded ${name}${version ? ` ${version}` : ""}${channel === "release" ? "" : ` to ${CHANNEL_NAMES[channel]}`} (${markerHits} script(s) carry ${marker})`, {
      fileId: id,
      size: upload.size,
      markerHits,
      channel,
    });
    const file = await findFile(env.DB, id);
    return reply(201, { ok: true, file: file === null ? null : presentFile(file), marker, markerHits });
  });

  router.patch("/api/admin/files/:id", "admin", async ({ env, input, params, user }) => {
    const file = await findFile(env.DB, params.id);
    if (file === null) throw new HttpError(404, "no such file");
    const name = optionalString(input.name, 120) ?? file.name;
    const version = input.version === undefined ? file.version : optionalString(input.version, 40);
    const notes = input.notes === undefined ? file.notes : optionalString(input.notes, 2000);
    const published = input.published === undefined ? file.published : parseBool(input.published) ? 1 : 0;
    const channel = parseChannel(input.channel, file.channel);
    await env.DB.prepare("UPDATE files SET name = ?1, version = ?2, notes = ?3, published = ?4, channel = ?5 WHERE id = ?6")
      .bind(name, version, notes, published, channel, file.id)
      .run();
    if (published !== file.published) {
      await log(env.DB, "info", published ? "file.publish" : "file.unpublish", actor(user), `${published ? "published" : "unpublished"} ${name}`, {
        fileId: file.id,
      });
    }
    if (channel !== file.channel) {
      await log(env.DB, "info", "file.channel", actor(user), `moved ${name} to ${CHANNEL_NAMES[channel]}`, {
        fileId: file.id,
        channel,
      });
    }
    const updated = await findFile(env.DB, file.id);
    return reply(200, { ok: true, file: updated === null ? null : presentFile(updated) });
  });

  router.delete("/api/admin/files/:id", "admin", async ({ env, params, user }) => {
    const file = await findFile(env.DB, params.id);
    if (file === null) throw new HttpError(404, "no such file");
    const { results: builds } = await env.DB.prepare("SELECT r2_key FROM builds WHERE file_id = ?1")
      .bind(file.id)
      .all<{ r2_key: string }>();
    await env.FILES.delete([file.r2_key, ...builds.map((b) => b.r2_key)]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM builds WHERE file_id = ?1").bind(file.id),
      env.DB.prepare("DELETE FROM files WHERE id = ?1").bind(file.id),
    ]);
    await log(env.DB, "warn", "file.delete", actor(user), `deleted ${file.name} and ${builds.length} build(s)`, { fileId: file.id });
    return reply(200, { ok: true });
  });

  // Drops the cached per-user builds of a release, so the next download is
  // rebuilt (after changing obfuscation settings, say).
  router.post("/api/admin/files/:id/rebuild", "admin", async ({ env, params, user }) => {
    const file = await findFile(env.DB, params.id);
    if (file === null) throw new HttpError(404, "no such file");
    const { results: builds } = await env.DB.prepare("SELECT r2_key FROM builds WHERE file_id = ?1")
      .bind(file.id)
      .all<{ r2_key: string }>();
    if (builds.length > 0) await env.FILES.delete(builds.map((b) => b.r2_key));
    await env.DB.prepare("DELETE FROM builds WHERE file_id = ?1").bind(file.id).run();
    await log(env.DB, "info", "file.rebuild", actor(user), `cleared ${builds.length} cached build(s) of ${file.name}`, { fileId: file.id });
    return reply(200, { ok: true, cleared: builds.length });
  });

  // ALARMS -------------------------------------------------------------------

  router.get("/api/admin/alarms", "admin", async ({ env, input }) => {
    const includeCleared = parseBool(input.cleared);
    const limit = clampLimit(input.limit, 500, 2000);
    const { results } = await env.DB.prepare(
      includeCleared
        ? "SELECT * FROM alarms ORDER BY last_seen DESC LIMIT ?1"
        : "SELECT * FROM alarms WHERE cleared_at IS NULL ORDER BY last_seen DESC LIMIT ?1",
    )
      .bind(limit)
      .all<AlarmRow>();
    return reply(200, { ok: true, alarms: results.map(presentAlarm) });
  });

  // { ids: number[] } clears those; { all: true } clears every open alarm.
  router.post("/api/admin/alarms/clear", "admin", async ({ env, input, user }) => {
    const ts = now();
    let cleared: number;
    if (parseBool(input.all)) {
      const result = await env.DB.prepare("UPDATE alarms SET cleared_at = ?1, cleared_by = ?2 WHERE cleared_at IS NULL")
        .bind(ts, actor(user))
        .run();
      cleared = result.meta.changes;
    } else {
      const ids = idList(input.ids);
      if (ids.length === 0) throw new HttpError(400, "pass ids[] or all=true");
      const result = await env.DB.prepare(
        `UPDATE alarms SET cleared_at = ?1, cleared_by = ?2 WHERE cleared_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(ts, actor(user), ...ids)
        .run();
      cleared = result.meta.changes;
    }
    await log(env.DB, "info", "alarm.clear", actor(user), `cleared ${cleared} alarm(s)`);
    return reply(200, { ok: true, cleared });
  });

  // DIAGNOSTICS --------------------------------------------------------------

  // Reports from the OrbitDebug popup, newest first, without their payload.
  // ?unresolved=1  ?q=  ?creatorId=  ?gameId=  ?code=  ?limit=
  router.get("/api/admin/diagnostics", "admin", async ({ env, input }) => {
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (parseBool(input.unresolved)) clauses.push("resolved_at IS NULL");
    const creatorId = optionalId(input.creatorId, "creatorId");
    if (creatorId !== null) {
      binds.push(creatorId);
      clauses.push(`creator_id = ?${binds.length}`);
    }
    const gameId = optionalId(input.gameId, "gameId");
    if (gameId !== null) {
      binds.push(gameId);
      clauses.push(`game_id = ?${binds.length}`);
    }
    const code = optionalId(input.code, "code");
    if (code !== null) {
      binds.push(`%,${code},%`);
      clauses.push(`(',' || codes || ',') LIKE ?${binds.length}`);
    }
    const q = optionalString(input.q, 64);
    if (q !== null) {
      binds.push(`%${q}%`);
      clauses.push(`(summary LIKE ?${binds.length} OR job_id LIKE ?${binds.length} OR version LIKE ?${binds.length})`);
    }
    const limit = clampLimit(input.limit, 200, 1000);
    binds.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(`SELECT * FROM diagnostics ${where} ORDER BY id DESC LIMIT ?${binds.length}`)
      .bind(...binds)
      .all<DiagnosticRow>();
    return reply(200, { ok: true, reports: results.map((r) => presentDiagnostic(r, false)) });
  });

  // One report with its incidents and log.
  router.get("/api/admin/diagnostics/:id", "admin", async ({ env, params }) => {
    const id = parseIdOrThrow(params.id, "id");
    const row = await env.DB.prepare("SELECT * FROM diagnostics WHERE id = ?1").bind(id).first<DiagnosticRow>();
    if (row === null) throw new HttpError(404, "no such report");
    return reply(200, { ok: true, report: presentDiagnostic(row, true) });
  });

  // { ids: number[] } resolves those; { all: true } resolves every open report.
  router.post("/api/admin/diagnostics/resolve", "admin", async ({ env, input, user }) => {
    const ts = now();
    let resolved: number;
    if (parseBool(input.all)) {
      const r = await env.DB.prepare("UPDATE diagnostics SET resolved_at = ?1, resolved_by = ?2 WHERE resolved_at IS NULL")
        .bind(ts, actor(user))
        .run();
      resolved = r.meta.changes;
    } else {
      const ids = idList(input.ids);
      if (ids.length === 0) throw new HttpError(400, "pass ids[] or all=true");
      const r = await env.DB.prepare(
        `UPDATE diagnostics SET resolved_at = ?1, resolved_by = ?2 WHERE resolved_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(ts, actor(user), ...ids)
        .run();
      resolved = r.meta.changes;
    }
    await log(env.DB, "info", "diagnostics.resolve", actor(user), `resolved ${resolved} diagnostics report(s)`);
    return reply(200, { ok: true, resolved });
  });

  // LICENSES -----------------------------------------------------------------

  router.get("/api/admin/licenses", "moderator", async ({ env, input }) => {
    const q = optionalString(input.q, 64);
    const testersOnly = parseBool(input.tester);
    const limit = clampLimit(input.limit, 100, 500);
    const offset = Math.max(0, Number(input.offset) || 0);
    const clauses: string[] = [];
    if (q !== null) clauses.push("(CAST(l.creator_id AS TEXT) LIKE ?3 OR u.roblox_username LIKE ?3 OR u.discord_username LIKE ?3 OR l.key LIKE ?3)");
    if (testersOnly) clauses.push("l.tester = 1");
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT l.*, u.discord_id, u.discord_username, u.roblox_username
                 FROM licenses l LEFT JOIN users u ON u.roblox_id = l.creator_id
                 ${where} ORDER BY l.licensed_at DESC LIMIT ?1 OFFSET ?2`;
    const statement = env.DB.prepare(sql);
    const { results } = await (q === null ? statement.bind(limit, offset) : statement.bind(limit, offset, `%${q}%`)).all<
      LicenseRow & { discord_id: string | null; discord_username: string | null; roblox_username: string | null }
    >();
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM licenses").first<{ n: number }>();
    return reply(200, {
      ok: true,
      total: total?.n ?? 0,
      licenses: results.map((row) => ({
        ...presentLicense(row),
        key: row.key,
        issuedBy: row.issued_by,
        testerBy: row.tester_by,
        discordId: row.discord_id,
        discordUsername: row.discord_username,
        robloxUsername: row.roblox_username,
      })),
    });
  });

  // { creatorId, tester? }. With tester, an existing licence is made a
  // product tester too.
  router.post("/api/admin/licenses", "moderator", async ({ env, input, user }) => {
    const creatorId = parseIdOrThrow(input.creatorId, "creatorId");
    const { created } = await grantLicense(env.DB, creatorId, isAdmin(user) ? "admin" : "moderator", actor(user));
    if (created) await log(env.DB, "info", "license.issue", actor(user), `licensed ${creatorId}`, { creatorId });
    if (parseBool(input.tester) && (await setTester(env.DB, creatorId, true, actor(user)))) {
      await log(env.DB, "info", "tester.add", actor(user), `made ${creatorId} a product tester`, { creatorId });
    }
    const license = await findLicense(env.DB, creatorId);
    return reply(created ? 201 : 200, { ok: true, created, license: presentLicense(license) });
  });

  // { tester: boolean }. Product testers also get the tester-channel
  // releases. Withdrawing access drops their cached tester builds.
  router.post("/api/admin/licenses/:creatorId/tester", "moderator", async ({ env, input, params, user }) => {
    const creatorId = parseIdOrThrow(params.creatorId, "creatorId");
    const license = await findLicense(env.DB, creatorId);
    if (license === null) throw new HttpError(404, "not licensed");
    const tester = parseBool(input.tester);
    const changed = await setTester(env.DB, creatorId, tester, actor(user));
    if (changed && !tester) {
      const { results: builds } = await env.DB.prepare(
        "SELECT b.r2_key FROM builds b JOIN files f ON f.id = b.file_id WHERE b.creator_id = ?1 AND f.channel = 'tester'",
      )
        .bind(creatorId)
        .all<{ r2_key: string }>();
      if (builds.length > 0) await env.FILES.delete(builds.map((b) => b.r2_key));
      await env.DB.prepare(
        "DELETE FROM builds WHERE creator_id = ?1 AND file_id IN (SELECT id FROM files WHERE channel = 'tester')",
      )
        .bind(creatorId)
        .run();
    }
    if (changed) {
      await log(env.DB, "info", tester ? "tester.add" : "tester.remove", actor(user), `${tester ? "made" : "removed"} ${creatorId} ${tester ? "a" : "as"} product tester`, {
        creatorId,
      });
    }
    return reply(200, { ok: true, changed, license: presentLicense(await findLicense(env.DB, creatorId)) });
  });

  // Paste-import: Roblox user ids separated by whitespace, commas or newlines.
  router.post("/api/admin/licenses/import", "admin", async ({ env, input, user }) => {
    const text = parseString(input.ids, "ids", 200_000);
    const ids = [...new Set(text.split(/[\s,;]+/).map((s) => parseId(s)).filter((n): n is number => n !== null))];
    if (ids.length === 0) throw new HttpError(400, "no Roblox user ids found");
    const ts = now();
    const result = await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO licenses (creator_id, licensed_at, source, issued_by) VALUES (?1, ?2, 'import', ?3)",
        ).bind(id, ts, actor(user)),
      ),
    );
    const created = result.reduce((n, r) => n + r.meta.changes, 0);
    await log(env.DB, "info", "license.import", actor(user), `imported ${created} new licence(s) out of ${ids.length} id(s)`, {
      created,
      given: ids.length,
    });
    return reply(200, { ok: true, given: ids.length, created });
  });

  router.delete("/api/admin/licenses/:creatorId", "moderator", async ({ env, params, user }) => {
    const creatorId = parseIdOrThrow(params.creatorId, "creatorId");
    const license = await findLicense(env.DB, creatorId);
    if (license === null) throw new HttpError(404, "not licensed");
    const { results: builds } = await env.DB.prepare("SELECT r2_key FROM builds WHERE creator_id = ?1")
      .bind(creatorId)
      .all<{ r2_key: string }>();
    if (builds.length > 0) await env.FILES.delete(builds.map((b) => b.r2_key));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM builds WHERE creator_id = ?1").bind(creatorId),
      env.DB.prepare("DELETE FROM licenses WHERE creator_id = ?1").bind(creatorId),
    ]);
    // Kill the user's whole server-bound fleet on nyxyl in one call. Best-effort: the
    // local revoke already stands, so a nyxyl hiccup must not fail the request.
    if (license.principal_id !== null) {
      try {
        await setPrincipalRevoked(await loadSettings(env.DB), license.principal_id, true);
      } catch (err) {
        await log(env.DB, "error", "principal.revoke.fail", actor(user), `nyxyl revoke failed for ${creatorId}`, {
          creatorId,
          error: String(err),
        });
      }
    }
    await log(env.DB, "warn", "license.revoke", actor(user), `revoked ${creatorId}`, { creatorId });
    return reply(200, { ok: true });
  });

  // Issues or (with rotate) replaces the user's key. Returns it once.
  router.post("/api/admin/licenses/:creatorId/key", "moderator", async ({ env, input, params, user }) => {
    const creatorId = parseIdOrThrow(params.creatorId, "creatorId");
    const license = await findLicense(env.DB, creatorId);
    if (license === null) throw new HttpError(404, "not licensed");
    const rotate = parseBool(input.rotate);
    if (license.key !== null && !rotate) throw new HttpError(409, "user already has a key; rotate to replace it");
    const key = await assignKey(env.DB, creatorId);
    if (license.key !== null) {
      // The old builds carry the old key; drop them so downloads rebuild.
      const { results: builds } = await env.DB.prepare("SELECT r2_key FROM builds WHERE creator_id = ?1")
        .bind(creatorId)
        .all<{ r2_key: string }>();
      if (builds.length > 0) await env.FILES.delete(builds.map((b) => b.r2_key));
      await env.DB.prepare("DELETE FROM builds WHERE creator_id = ?1").bind(creatorId).run();
      // Rotate the principal too, so server-bound copies already in the wild (minted
      // against the old secret) can no longer decrypt — the crypto counterpart to the
      // new whitelist key. Best-effort; the local key change already stands.
      if (license.principal_id !== null) {
        try {
          await rotatePrincipal(await loadSettings(env.DB), license.principal_id);
        } catch (err) {
          await log(env.DB, "error", "principal.rotate.fail", actor(user), `nyxyl rotate failed for ${creatorId}`, {
            creatorId,
            error: String(err),
          });
        }
      }
    }
    await log(env.DB, "info", license.key !== null ? "key.rotate" : "key.issue", actor(user), `key for ${creatorId}`, { creatorId });
    return reply(201, { ok: true, creatorId, key, rotated: license.key !== null });
  });

  // LOGS ---------------------------------------------------------------------

  // ?level=info|warn|error  ?unresolved=1  ?q=  ?before=<id>  ?limit=
  router.get("/api/admin/logs", "admin", async ({ env, input }) => {
    const clauses: string[] = [];
    const binds: unknown[] = [];
    const level = optionalString(input.level, 10);
    if (level !== null) {
      if (!LEVELS.includes(level as Level)) throw new HttpError(400, "level must be info, warn or error");
      binds.push(level);
      clauses.push(`level = ?${binds.length}`);
    }
    if (parseBool(input.unresolved)) clauses.push("resolved_at IS NULL");
    const q = optionalString(input.q, 64);
    if (q !== null) {
      binds.push(`%${q}%`);
      clauses.push(`(message LIKE ?${binds.length} OR event LIKE ?${binds.length} OR actor LIKE ?${binds.length})`);
    }
    const before = optionalId(input.before, "before");
    if (before !== null) {
      binds.push(before);
      clauses.push(`id < ?${binds.length}`);
    }
    const limit = clampLimit(input.limit, 200, 1000);
    binds.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(`SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ?${binds.length}`)
      .bind(...binds)
      .all<LogRow>();
    return reply(200, { ok: true, logs: results.map(presentLog) });
  });

  // { ids: number[] } or { all: true } (every unresolved warn/error).
  router.post("/api/admin/logs/resolve", "admin", async ({ env, input, user }) => {
    const ts = now();
    let resolved: number;
    if (parseBool(input.all)) {
      const r = await env.DB.prepare("UPDATE logs SET resolved_at = ?1, resolved_by = ?2 WHERE resolved_at IS NULL AND level != 'info'")
        .bind(ts, actor(user))
        .run();
      resolved = r.meta.changes;
    } else {
      const ids = idList(input.ids);
      if (ids.length === 0) throw new HttpError(400, "pass ids[] or all=true");
      const r = await env.DB.prepare(
        `UPDATE logs SET resolved_at = ?1, resolved_by = ?2 WHERE resolved_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(ts, actor(user), ...ids)
        .run();
      resolved = r.meta.changes;
    }
    return reply(200, { ok: true, resolved });
  });

  // Deletes every info-level entry now, instead of waiting for the cron.
  router.post("/api/admin/logs/purge", "admin", async ({ env, user }) => {
    const r = await env.DB.prepare("DELETE FROM logs WHERE level = 'info'").run();
    await log(env.DB, "info", "logs.purge", actor(user), `purged ${r.meta.changes} info entries`);
    return reply(200, { ok: true, deleted: r.meta.changes });
  });

  // TELEMETRY ----------------------------------------------------------------

  // Recent pings plus a per-game summary of the last 7 days.
  router.get("/api/admin/telemetry", "admin", async ({ env, input }) => {
    const creatorId = optionalId(input.creatorId, "creatorId");
    const gameId = optionalId(input.gameId, "gameId");
    const limit = clampLimit(input.limit, 200, 1000);
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (creatorId !== null) {
      binds.push(creatorId);
      clauses.push(`creator_id = ?${binds.length}`);
    }
    if (gameId !== null) {
      binds.push(gameId);
      clauses.push(`game_id = ?${binds.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    binds.push(limit);
    const recent = env.DB.prepare(`SELECT * FROM telemetry ${where} ORDER BY id DESC LIMIT ?${binds.length}`).bind(...binds);
    const games = env.DB.prepare(
      `SELECT game_id, COUNT(*) AS pings, COUNT(DISTINCT creator_id) AS users, MAX(ts) AS last_seen,
              SUM(licensed = 0) AS unlicensed, SUM(key_valid = 0) AS bad_keys, MAX(version) AS version
       FROM telemetry WHERE ts > ?1 GROUP BY game_id ORDER BY pings DESC LIMIT 100`,
    ).bind(now() - 7 * 86400);
    const [recentResult, gamesResult] = await env.DB.batch([recent, games]);
    return reply(200, {
      ok: true,
      recent: (recentResult.results as TelemetryRow[]).map(presentTelemetry),
      games: gamesResult.results,
    });
  });

  // USERS --------------------------------------------------------------------

  router.get("/api/admin/users", "admin", async ({ env, input }) => {
    const q = optionalString(input.q, 64);
    const limit = clampLimit(input.limit, 100, 500);
    const statement =
      q === null
        ? env.DB.prepare("SELECT * FROM users ORDER BY last_login_at DESC LIMIT ?1").bind(limit)
        : env.DB.prepare(
            "SELECT * FROM users WHERE discord_id LIKE ?2 OR discord_username LIKE ?2 OR CAST(roblox_id AS TEXT) LIKE ?2 OR roblox_username LIKE ?2 ORDER BY last_login_at DESC LIMIT ?1",
          ).bind(limit, `%${q}%`);
    const { results } = await statement.all<UserRow>();
    const licensed = new Set(
      (await env.DB.prepare("SELECT creator_id FROM licenses").all<{ creator_id: number }>()).results.map((r) => r.creator_id),
    );
    return reply(200, {
      ok: true,
      users: results.map((u) => ({ ...presentUser(u), licensed: u.roblox_id !== null && licensed.has(u.roblox_id) })),
    });
  });

  // Fulfils a deletion request: the account, its sessions and (with
  // ?license=1) the licence, key and cached builds.
  router.delete("/api/admin/users/:discordId", "admin", async ({ env, input, params, user }) => {
    const target = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?1").bind(params.discordId).first<UserRow>();
    if (target === null) throw new HttpError(404, "no such user");
    const withLicense = parseBool(input.license) && target.roblox_id !== null;
    const statements = [
      env.DB.prepare("DELETE FROM sessions WHERE discord_id = ?1").bind(target.discord_id),
      env.DB.prepare("DELETE FROM users WHERE discord_id = ?1").bind(target.discord_id),
      env.DB.prepare("UPDATE alarms SET cleared_at = ?1, cleared_by = ?2 WHERE kind = 'deletion_request' AND cleared_at IS NULL AND detail LIKE ?3")
        .bind(now(), actor(user), `%"discordId":"${target.discord_id}"%`),
    ];
    let revokePrincipalId: string | null = null;
    if (withLicense) {
      const priorLicense = await findLicense(env.DB, target.roblox_id as number);
      revokePrincipalId = priorLicense?.principal_id ?? null;
      const { results: builds } = await env.DB.prepare("SELECT r2_key FROM builds WHERE creator_id = ?1")
        .bind(target.roblox_id)
        .all<{ r2_key: string }>();
      if (builds.length > 0) await env.FILES.delete(builds.map((b) => b.r2_key));
      statements.push(
        env.DB.prepare("DELETE FROM builds WHERE creator_id = ?1").bind(target.roblox_id),
        env.DB.prepare("DELETE FROM licenses WHERE creator_id = ?1").bind(target.roblox_id),
        env.DB.prepare("DELETE FROM telemetry WHERE creator_id = ?1").bind(target.roblox_id),
      );
    }
    await env.DB.batch(statements);
    // Kill the deleted user's server-bound fleet on nyxyl (best-effort).
    if (revokePrincipalId !== null) {
      try {
        await setPrincipalRevoked(await loadSettings(env.DB), revokePrincipalId, true);
      } catch (err) {
        await log(env.DB, "error", "principal.revoke.fail", actor(user), `nyxyl revoke failed for ${target.roblox_id}`, {
          robloxId: target.roblox_id,
          error: String(err),
        });
      }
    }
    await log(env.DB, "warn", "user.delete", actor(user), `deleted ${target.discord_username} (${target.discord_id})${withLicense ? " including licence and telemetry" : ""}`, {
      discordId: target.discord_id,
      robloxId: target.roblox_id,
      withLicense,
    });
    return reply(200, { ok: true });
  });

  // SETTINGS -----------------------------------------------------------------

  router.get("/api/admin/settings", "admin", async ({ env }) => {
    return reply(200, { ok: true, settings: maskSettings(await loadSettings(env.DB)) });
  });

  // Secret fields left empty are kept as they are; anything else is replaced.
  router.put("/api/admin/settings", "admin", async ({ env, input, user }) => {
    const current = await loadSettings(env.DB);
    const changes: Partial<Settings> = {};
    for (const [key, raw] of Object.entries(input)) {
      if (!isSettingKey(key)) continue;
      const value = typeof raw === "boolean" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
      if (value === null) continue;
      if (SECRET_SETTINGS.includes(key) && value === "") continue;
      if (value !== current[key]) changes[key] = value;
    }
    validateSettings({ ...current, ...changes });
    await saveSettings(env.DB, changes, actor(user));
    const changed = Object.keys(changes);
    if (changed.length > 0) {
      await log(env.DB, "info", "settings.update", actor(user), `changed ${changed.join(", ")}`);
    }
    return reply(200, { ok: true, changed, settings: maskSettings(await loadSettings(env.DB)) });
  });
}

function parseChannel(value: unknown, fallback: Channel): Channel {
  if (value === undefined || value === null || value === "") return fallback;
  if (!isChannel(value)) throw new HttpError(400, "channel must be release, beta or tester");
  return value;
}

function validateSettings(s: Settings): void {
  if (!["vm", "register", "ast", "minify", "none"].includes(s.obfuscate_mode)) throw new HttpError(400, "obfuscate_mode must be vm, register, minify or none");
  if (!["marked", "all"].includes(s.obfuscate_scope)) throw new HttpError(400, "obfuscate_scope must be marked or all");
  if (s.key_marker.length < 4) throw new HttpError(400, "key_marker should be at least 4 characters");
  const days = Number(s.telemetry_retention_days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, "telemetry_retention_days must be 1–365");
  if (s.bloxlink_guild_id !== "" && !/^\d{5,25}$/.test(s.bloxlink_guild_id)) throw new HttpError(400, "bloxlink_guild_id must be a Discord snowflake");
}

function maskSettings(s: Settings): Record<SettingKey, string> & { _secrets: SettingKey[] } {
  const masked = { ...s } as Record<SettingKey, string> & { _secrets: SettingKey[] };
  for (const key of SECRET_SETTINGS) masked[key] = s[key] === "" ? "" : `set (…${s[key].slice(-4)})`;
  masked._secrets = SECRET_SETTINGS;
  return masked;
}

function idList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => parseId(v)).filter((n): n is number => n !== null).slice(0, 500);
}

function presentAlarm(row: AlarmRow) {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    creatorId: row.creator_id,
    key: row.key,
    keyOwnerId: row.key_owner_id,
    gameId: row.game_id,
    detail: row.detail,
    count: row.count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    clearedAt: row.cleared_at,
    clearedBy: row.cleared_by,
  };
}

function presentLog(row: LogRow) {
  let data: unknown = null;
  if (row.data !== null) {
    try {
      data = JSON.parse(row.data);
    } catch {
      data = row.data;
    }
  }
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    event: row.event,
    actor: row.actor,
    message: row.message,
    data,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function presentDiagnostic(row: DiagnosticRow, withPayload: boolean) {
  const base = {
    id: row.id,
    ts: row.ts,
    creatorId: row.creator_id,
    licensed: row.licensed === 1,
    keyValid: row.key_valid === null ? null : row.key_valid === 1,
    gameId: row.game_id,
    placeId: row.place_id,
    jobId: row.job_id,
    version: row.version,
    studio: row.studio === 1,
    reporterId: row.reporter_id,
    codes: row.codes.split(",").filter(Boolean).map(Number),
    summary: row.summary,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
  if (!withPayload) return base;
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null;
  }
  return { ...base, key: row.key, payload };
}

function presentTelemetry(row: TelemetryRow) {
  return {
    id: row.id,
    ts: row.ts,
    creatorId: row.creator_id,
    key: row.key,
    gameId: row.game_id,
    version: row.version,
    licensed: row.licensed === 1,
    keyValid: row.key_valid === null ? null : row.key_valid === 1,
  };
}
