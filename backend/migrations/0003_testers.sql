-- Product testers and the tester release channel.
--
-- A tester is a licensed user who, besides the production releases, can
-- download releases on the `tester` channel: non-production builds that
-- ordinary licensees never see. Their tester build is still built with
-- their own key, so a leaked test build traces back like any other.

ALTER TABLE licenses ADD COLUMN tester       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licenses ADD COLUMN tester_since INTEGER;   -- when tester access was granted
ALTER TABLE licenses ADD COLUMN tester_by    TEXT;      -- discord id of the admin who granted it

ALTER TABLE files ADD COLUMN channel TEXT NOT NULL DEFAULT 'release';  -- release | tester
