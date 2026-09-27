-- The site: Discord accounts, sessions, settings, releases, alarms, logs,
-- telemetry. All timestamps are unix seconds.

-- Where a license came from and who granted it.
ALTER TABLE licenses ADD COLUMN source    TEXT NOT NULL DEFAULT 'api';  -- api | admin | import | parcel
ALTER TABLE licenses ADD COLUMN issued_by TEXT;                          -- discord id of the admin, or NULL

-- One row per Discord account that has signed in. The Roblox link comes from
-- Bloxlink and is cached here for good (re-checked only on request), so the
-- Bloxlink API is hit once per user.
CREATE TABLE IF NOT EXISTS users (
    discord_id          TEXT    PRIMARY KEY,
    discord_username    TEXT    NOT NULL,
    discord_avatar      TEXT,
    roblox_id           INTEGER,
    roblox_username     TEXT,
    bloxlink_checked_at INTEGER,            -- last Bloxlink lookup, linked or not
    bloxlink_error      TEXT,               -- why the last lookup did not link
    parcel_checked_at   INTEGER,            -- last Parcel ownership check
    created_at          INTEGER NOT NULL,
    last_login_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_roblox ON users (roblox_id);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,         -- random, only ever sent in the cookie
    discord_id TEXT    NOT NULL REFERENCES users (discord_id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (discord_id);

-- Admin-editable configuration (Bloxlink, Parcel, obfuscation, retention).
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
);

-- Uploaded .rbxmx releases. `published` files are offered to licensed users.
CREATE TABLE IF NOT EXISTS files (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,             -- shown to users; also the download filename
    version     TEXT,
    notes       TEXT,
    size        INTEGER NOT NULL,
    r2_key      TEXT    NOT NULL,
    marker_hits INTEGER NOT NULL,             -- scripts containing the key marker at upload
    published   INTEGER NOT NULL DEFAULT 0,
    uploaded_at INTEGER NOT NULL,
    uploaded_by TEXT    NOT NULL
);

-- Per-user builds: a release with the user's key substituted and obfuscated.
-- Cached so repeated downloads do not spend obfuscator credits.
CREATE TABLE IF NOT EXISTS builds (
    file_id    TEXT    NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    creator_id INTEGER NOT NULL,
    key        TEXT    NOT NULL,              -- the key baked in; a rotated key means a rebuild
    r2_key     TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    built_at   INTEGER NOT NULL,
    PRIMARY KEY (file_id, creator_id)
);

-- Security alerts, collapsed: one open row per (kind, user, key, game) that
-- counts repeats instead of adding rows. Clearing sets `cleared_at`; a
-- later repeat opens a fresh row.
CREATE TABLE IF NOT EXISTS alarms (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT    NOT NULL,   -- key_mismatch | unknown_key | unlicensed | deletion_request
    level        TEXT    NOT NULL,   -- info | warn | error
    creator_id   INTEGER,            -- the Roblox user involved (who presented / who asked)
    key          TEXT,               -- the key presented, if any
    key_owner_id INTEGER,            -- whose key it really is, when known
    game_id      INTEGER,            -- where it happened, when reported
    detail       TEXT,               -- free text / json
    count        INTEGER NOT NULL DEFAULT 1,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    cleared_at   INTEGER,
    cleared_by   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS alarms_open
    ON alarms (kind, COALESCE(creator_id, 0), COALESCE(key, ''), COALESCE(game_id, 0))
    WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS alarms_seen ON alarms (cleared_at, last_seen);

-- Everything that happens, with a level. Info rows are dropped after a day
-- by the cron; warn/error rows stay until an admin resolves them.
CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    level       TEXT    NOT NULL,    -- info | warn | error
    event       TEXT    NOT NULL,    -- short machine name, e.g. login, license.issue
    actor       TEXT,                -- discord id, 'api', 'system', or a Roblox id as 'roblox:123'
    message     TEXT    NOT NULL,
    data        TEXT,                -- json
    resolved_at INTEGER,
    resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS logs_ts    ON logs (ts);
CREATE INDEX IF NOT EXISTS logs_level ON logs (level, resolved_at, ts);

-- Pings from running builds.
CREATE TABLE IF NOT EXISTS telemetry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    creator_id INTEGER NOT NULL,
    key        TEXT,
    game_id    INTEGER,
    version    TEXT,
    licensed   INTEGER NOT NULL,     -- was the user licensed at the time
    key_valid  INTEGER               -- NULL when no key was sent
);
CREATE INDEX IF NOT EXISTS telemetry_ts   ON telemetry (ts);
CREATE INDEX IF NOT EXISTS telemetry_user ON telemetry (creator_id, ts);
CREATE INDEX IF NOT EXISTS telemetry_game ON telemetry (game_id, ts);
