-- Diagnostics reports: sent from a running build when staff press "Send
-- Diagnostics" on the OrbitDebug popup (a critical failure in that server:
-- DataStore, licence server, an extension that failed to load, ...).
--
-- One row per report. The licence columns are filled by the same check the
-- whitelist runs, so a report from a leaked build is visible as such.

CREATE TABLE IF NOT EXISTS diagnostics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    creator_id  INTEGER NOT NULL,        -- game owner the build reports for
    key         TEXT,                    -- the key the build carries
    licensed    INTEGER NOT NULL,
    key_valid   INTEGER,                 -- NULL when no key was sent
    game_id     INTEGER,                 -- universe id
    place_id    INTEGER,
    job_id      TEXT,                    -- the server instance; NULL in Studio
    version     TEXT,
    studio      INTEGER NOT NULL DEFAULT 0,
    reporter_id INTEGER,                 -- Roblox user who pressed Send
    codes       TEXT    NOT NULL,        -- open error codes, comma-separated: "102,103"
    summary     TEXT    NOT NULL,        -- the first (oldest) failure, one line
    payload     TEXT    NOT NULL,        -- json { incidents, log, uptime, players }
    resolved_at INTEGER,
    resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS diagnostics_open ON diagnostics (resolved_at, ts);
CREATE INDEX IF NOT EXISTS diagnostics_user ON diagnostics (creator_id, ts);
CREATE INDEX IF NOT EXISTS diagnostics_job  ON diagnostics (job_id, ts);
