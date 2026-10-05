-- Per-licensee nyxyl "principal" (shared, revocable server-binding key).
--
-- When server binding is enabled, each licensee's obfuscated scripts are nyxyl
-- server-bound builds tied to ONE principal for that user. We remember the
-- principal id so (a) every build we mint for the user reuses the same principal
-- (one shared secret, not one per build) and (b) revoking the licence can revoke
-- the principal in a single call, killing the user's whole fleet. NULL until the
-- user's first server-bound download.
ALTER TABLE licenses ADD COLUMN principal_id TEXT;
