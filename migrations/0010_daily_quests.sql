-- phase: expand
-- One network-wide quest per UTC date; each person's progress uses their chosen IANA time zone.
CREATE TABLE daily_quests (
    day text COLLATE "C" PRIMARY KEY,
    title text NOT NULL,
    story text NOT NULL,
    steps_json text NOT NULL,
    source text NOT NULL,
    created_at text COLLATE "C" NOT NULL
);
CREATE TABLE daily_step_types (
    id text COLLATE "C" PRIMARY KEY,
    project_id text COLLATE "C" NOT NULL,
    event_type text COLLATE "C" NOT NULL,
    site text NOT NULL,
    sentence text NOT NULL,
    href text NOT NULL,
    weight integer NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at text COLLATE "C" NOT NULL,
    reviewed_at text COLLATE "C",
    CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE TABLE daily_preferences (
    subject text COLLATE "C" PRIMARY KEY,
    time_zone text NOT NULL DEFAULT 'UTC'
);
CREATE TABLE daily_events (
    event_id text COLLATE "C" PRIMARY KEY,
    subject text COLLATE "C" NOT NULL,
    event_type text COLLATE "C" NOT NULL,
    occurred_at text COLLATE "C" NOT NULL
);
CREATE INDEX daily_events_person_time ON daily_events (subject, occurred_at);
CREATE TABLE daily_completions (
    subject text COLLATE "C" NOT NULL,
    day text COLLATE "C" NOT NULL,
    completed_at text COLLATE "C" NOT NULL,
    PRIMARY KEY (subject, day)
);
CREATE INDEX daily_completions_day ON daily_completions (day);
