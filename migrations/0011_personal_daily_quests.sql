-- phase: expand
-- Cache the signed-in person's selected daily quest for that local day.
CREATE TABLE daily_personal_quests (
    subject text COLLATE "C" NOT NULL,
    day text COLLATE "C" NOT NULL,
    title text NOT NULL,
    story text NOT NULL,
    steps_json text NOT NULL,
    source text NOT NULL CHECK (source IN ('ai', 'rotation')),
    created_at text COLLATE "C" NOT NULL,
    PRIMARY KEY (subject, day)
);
