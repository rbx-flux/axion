-- One row per licensed Roblox user. `key` is the token baked into that
-- user's obfuscated build; NULL until issued, UNIQUE so a key identifies
-- exactly one user (and therefore one build).
CREATE TABLE IF NOT EXISTS licenses (
    creator_id    INTEGER PRIMARY KEY,
    key           TEXT    UNIQUE,
    licensed_at   INTEGER NOT NULL,   -- unix seconds
    key_issued_at INTEGER             -- unix seconds, NULL while no key
);

-- Every whitelist check where the presented key did not belong to the
-- presented user. `key_owner_id` is whose build the key came from (NULL when
-- the key is unknown), so a leaked build can be traced to its owner.
CREATE TABLE IF NOT EXISTS key_mismatches (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    key                  TEXT    NOT NULL,
    key_owner_id         INTEGER,
    presented_creator_id INTEGER NOT NULL,
    seen_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS key_mismatches_owner ON key_mismatches (key_owner_id, seen_at);
