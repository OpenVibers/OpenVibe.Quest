-- phase: expand
-- Test accounts (probe and manual test accounts, OpenVibe.Network users.is_test). The subject ids are read from the
-- identity authority on a timer (server/identity/test-subjects.js) and kept here, so the public counts can leave them
-- out in SQL without asking Network on every page read. Additive: an older release never reads this table.
CREATE TABLE IF NOT EXISTS test_subject (
    subject text COLLATE "C" PRIMARY KEY,
    seen_at text COLLATE "C" NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
