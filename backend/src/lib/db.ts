// Row types and the queries the routes share. Timestamps are unix seconds.

import { now } from "./http";

// LICENSES -------------------------------------------------------------------

export interface LicenseRow {
  creator_id: number;
  key: string | null;
  licensed_at: number;
  key_issued_at: number | null;
  source: string;
  issued_by: string | null;
  // 1 for product testers, who also get releases on the tester channel.
  tester: number;
  tester_since: number | null;
  tester_by: string | null;
}

const LICENSE_SELECT =
  "SELECT creator_id, key, licensed_at, key_issued_at, source, issued_by, tester, tester_since, tester_by FROM licenses";

export function findLicense(db: D1Database, creatorId: number): Promise<LicenseRow | null> {
  return db.prepare(`${LICENSE_SELECT} WHERE creator_id = ?1`).bind(creatorId).first<LicenseRow>();
}

export function findLicenseByKey(db: D1Database, key: string): Promise<LicenseRow | null> {
  return db.prepare(`${LICENSE_SELECT} WHERE key = ?1`).bind(key).first<LicenseRow>();
}

// Grants the product. Returns the row and whether it was just created.
export async function grantLicense(
  db: D1Database,
  creatorId: number,
  source: string,
  issuedBy: string | null,
): Promise<{ license: LicenseRow; created: boolean }> {
  const existing = await findLicense(db, creatorId);
  if (existing !== null) return { license: existing, created: false };
  const licensedAt = now();
  await db
    .prepare(
      "INSERT INTO licenses (creator_id, licensed_at, source, issued_by) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(creatorId, licensedAt, source, issuedBy)
    .run();
  return {
    license: {
      creator_id: creatorId,
      key: null,
      licensed_at: licensedAt,
      key_issued_at: null,
      source,
      issued_by: issuedBy,
      tester: 0,
      tester_since: null,
      tester_by: null,
    },
    created: true,
  };
}

// Keys look like AXION-1A2B3-4C5D6-7E8F9-0A1B2 (20 hex chars, 80 bits).
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const groups = hex.match(/.{5}/g) ?? [];
  return `AXION-${groups.join("-")}`;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

// Sets (or replaces) the key on a licensed user's row. Collisions are
// astronomically unlikely; the UNIQUE constraint catches one anyway.
export async function assignKey(db: D1Database, creatorId: number): Promise<string> {
  const issuedAt = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateKey();
    try {
      await db
        .prepare("UPDATE licenses SET key = ?1, key_issued_at = ?2 WHERE creator_id = ?3")
        .bind(key, issuedAt, creatorId)
        .run();
      return key;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("could not generate a unique key");
}

// Grants or withdraws product-tester access. Returns whether it changed.
export async function setTester(
  db: D1Database,
  creatorId: number,
  tester: boolean,
  by: string,
): Promise<boolean> {
  const result = tester
    ? await db
        .prepare("UPDATE licenses SET tester = 1, tester_since = ?1, tester_by = ?2 WHERE creator_id = ?3 AND tester = 0")
        .bind(now(), by, creatorId)
        .run()
    : await db
        .prepare("UPDATE licenses SET tester = 0, tester_since = NULL, tester_by = NULL WHERE creator_id = ?1 AND tester = 1")
        .bind(creatorId)
        .run();
  return result.meta.changes > 0;
}

// USERS ----------------------------------------------------------------------

export interface UserRow {
  discord_id: string;
  discord_username: string;
  discord_avatar: string | null;
  roblox_id: number | null;
  roblox_username: string | null;
  bloxlink_checked_at: number | null;
  bloxlink_error: string | null;
  parcel_checked_at: number | null;
  created_at: number;
  last_login_at: number;
}

export function findUser(db: D1Database, discordId: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE discord_id = ?1").bind(discordId).first<UserRow>();
}

export async function upsertUser(
  db: D1Database,
  discordId: string,
  username: string,
  avatar: string | null,
): Promise<UserRow> {
  const ts = now();
  await db
    .prepare(
      `INSERT INTO users (discord_id, discord_username, discord_avatar, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (discord_id) DO UPDATE SET
         discord_username = excluded.discord_username,
         discord_avatar = excluded.discord_avatar,
         last_login_at = excluded.last_login_at`,
    )
    .bind(discordId, username, avatar, ts)
    .run();
  const user = await findUser(db, discordId);
  if (user === null) throw new Error("user vanished after upsert");
  return user;
}

// SESSIONS -------------------------------------------------------------------

export const SESSION_TTL = 30 * 24 * 3600;

export async function createSession(db: D1Database, discordId: string, id: string): Promise<void> {
  const ts = now();
  await db
    .prepare("INSERT INTO sessions (id, discord_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, discordId, ts, ts + SESSION_TTL)
    .run();
}

export function findSessionUser(db: D1Database, sessionId: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.discord_id = s.discord_id
       WHERE s.id = ?1 AND s.expires_at > ?2`,
    )
    .bind(sessionId, now())
    .first<UserRow>();
}

export function deleteSession(db: D1Database, sessionId: string): Promise<D1Result> {
  return db.prepare("DELETE FROM sessions WHERE id = ?1").bind(sessionId).run();
}

// SETTINGS -------------------------------------------------------------------

// Every admin-editable setting with its default. Keys are the settings-table
// keys; the admin UI edits exactly this set.
export const SETTING_DEFAULTS = {
  bloxlink_guild_id: "",
  bloxlink_api_key: "",
  parcel_enabled: "false",
  parcel_hub_id: "",
  parcel_product_id: "",
  nyxyl_api_key: "",
  obfuscate_mode: "vm", // vm | ast | minify | none
  obfuscate_scope: "marked", // marked (scripts containing the marker) | all
  key_marker: "__LICENSE_KEY",
  telemetry_retention_days: "30",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

// Settings whose values are masked when sent to the admin UI.
export const SECRET_SETTINGS: SettingKey[] = ["bloxlink_api_key", "nyxyl_api_key"];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key);
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings")
    .all<{ key: string; value: string }>();
  const settings: Settings = { ...SETTING_DEFAULTS };
  for (const row of results) {
    if (isSettingKey(row.key)) settings[row.key] = row.value;
  }
  return settings;
}

export async function saveSettings(
  db: D1Database,
  changes: Partial<Settings>,
  updatedBy: string,
): Promise<void> {
  const ts = now();
  const statements = Object.entries(changes).map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(key, value, ts, updatedBy),
  );
  if (statements.length > 0) await db.batch(statements);
}

// FILES / BUILDS -------------------------------------------------------------

// `release` files are the production builds every licensee gets; `tester`
// files are non-production builds only product testers (and admins) see.
export const CHANNELS = ["release", "tester"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export interface FileRow {
  id: string;
  name: string;
  version: string | null;
  notes: string | null;
  size: number;
  r2_key: string;
  marker_hits: number;
  published: number;
  channel: Channel;
  uploaded_at: number;
  uploaded_by: string;
}

export interface BuildRow {
  file_id: string;
  creator_id: number;
  key: string;
  r2_key: string;
  size: number;
  built_at: number;
}

export function findFile(db: D1Database, id: string): Promise<FileRow | null> {
  return db.prepare("SELECT * FROM files WHERE id = ?1").bind(id).first<FileRow>();
}

export async function listFiles(db: D1Database): Promise<FileRow[]> {
  return (await db.prepare("SELECT * FROM files ORDER BY uploaded_at DESC").all<FileRow>()).results;
}

// What a licensee is offered: published production releases, plus published
// tester releases when they are a product tester.
export async function listPublishedFiles(db: D1Database, tester: boolean): Promise<FileRow[]> {
  const sql = tester
    ? "SELECT * FROM files WHERE published = 1 ORDER BY uploaded_at DESC"
    : "SELECT * FROM files WHERE published = 1 AND channel = 'release' ORDER BY uploaded_at DESC";
  return (await db.prepare(sql).all<FileRow>()).results;
}

export function findBuild(
  db: D1Database,
  fileId: string,
  creatorId: number,
): Promise<BuildRow | null> {
  return db
    .prepare("SELECT * FROM builds WHERE file_id = ?1 AND creator_id = ?2")
    .bind(fileId, creatorId)
    .first<BuildRow>();
}

// ALARMS ---------------------------------------------------------------------

export type AlarmKind = "key_mismatch" | "unknown_key" | "unlicensed" | "deletion_request";
export type Level = "info" | "warn" | "error";

export interface AlarmRow {
  id: number;
  kind: AlarmKind;
  level: Level;
  creator_id: number | null;
  key: string | null;
  key_owner_id: number | null;
  game_id: number | null;
  detail: string | null;
  count: number;
  first_seen: number;
  last_seen: number;
  cleared_at: number | null;
  cleared_by: string | null;
}

export interface AlarmInput {
  kind: AlarmKind;
  level: Level;
  creatorId?: number | null;
  key?: string | null;
  keyOwnerId?: number | null;
  gameId?: number | null;
  detail?: string | null;
}

// Raises an alarm, collapsing onto the open row for the same
// (kind, user, key, game) when there is one. The partial unique index
// `alarms_open` makes the upsert atomic.
export async function raiseAlarm(db: D1Database, alarm: AlarmInput): Promise<void> {
  const ts = now();
  await db
    .prepare(
      `INSERT INTO alarms (kind, level, creator_id, key, key_owner_id, game_id, detail, count, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
       ON CONFLICT (kind, COALESCE(creator_id, 0), COALESCE(key, ''), COALESCE(game_id, 0)) WHERE cleared_at IS NULL
       DO UPDATE SET count = count + 1, last_seen = excluded.last_seen,
                     key_owner_id = COALESCE(excluded.key_owner_id, alarms.key_owner_id),
                     detail = COALESCE(excluded.detail, alarms.detail)`,
    )
    .bind(
      alarm.kind,
      alarm.level,
      alarm.creatorId ?? null,
      alarm.key ?? null,
      alarm.keyOwnerId ?? null,
      alarm.gameId ?? null,
      alarm.detail ?? null,
      ts,
    )
    .run();
}

// LOGS -----------------------------------------------------------------------

export interface LogRow {
  id: number;
  ts: number;
  level: Level;
  event: string;
  actor: string | null;
  message: string;
  data: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
}

export function log(
  db: D1Database,
  level: Level,
  event: string,
  actor: string | null,
  message: string,
  data?: Record<string, unknown>,
): Promise<D1Result> {
  const line = `[${level}] ${event} ${actor ?? "-"}: ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return db
    .prepare(
      "INSERT INTO logs (ts, level, event, actor, message, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(now(), level, event, actor, message, data === undefined ? null : JSON.stringify(data))
    .run();
}

// DIAGNOSTICS ----------------------------------------------------------------

// A report sent from the OrbitDebug popup. `payload` is json:
// { incidents, log, uptime, players }.
export interface DiagnosticRow {
  id: number;
  ts: number;
  creator_id: number;
  key: string | null;
  licensed: number;
  key_valid: number | null;
  game_id: number | null;
  place_id: number | null;
  job_id: string | null;
  version: string | null;
  studio: number;
  reporter_id: number | null;
  codes: string;
  summary: string;
  payload: string;
  resolved_at: number | null;
  resolved_by: string | null;
}

// TELEMETRY ------------------------------------------------------------------

export interface TelemetryRow {
  id: number;
  ts: number;
  creator_id: number;
  key: string | null;
  game_id: number | null;
  version: string | null;
  licensed: number;
  key_valid: number | null;
}

export function recordTelemetry(
  db: D1Database,
  row: Omit<TelemetryRow, "id" | "ts">,
): Promise<D1Result> {
  return db
    .prepare(
      "INSERT INTO telemetry (ts, creator_id, key, game_id, version, licensed, key_valid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(now(), row.creator_id, row.key, row.game_id, row.version, row.licensed, row.key_valid)
    .run();
}
