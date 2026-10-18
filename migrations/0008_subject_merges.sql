-- phase: expand
-- Account merges (ADR-029, network.subject.merged): one row per merge Quest has folded, so a redelivery moves nothing
-- twice (server/identity/subject-merge.js). The counts say how many of the folded account's rows became the survivor's.
CREATE TABLE quest_subject_merges (
    merge_id     text COLLATE "C" PRIMARY KEY,     -- mrg_<ULID>
    from_subject text COLLATE "C" NOT NULL,        -- the folded account (now an alias of into_subject)
    into_subject text COLLATE "C" NOT NULL,        -- the survivor
    progress     integer NOT NULL DEFAULT 0,
    completions  integer NOT NULL DEFAULT 0,
    badges       integer NOT NULL DEFAULT 0,
    merged_at    text COLLATE "C" NOT NULL         -- ISO 8601 UTC
);
