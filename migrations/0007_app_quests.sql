-- phase: expand
-- App quests (contracts 0.193.0, capability quest.app_quest.manage): quests a developer app defines on its own project's
-- events (app.<project_key>.<name>). Progress, completions and badges use the existing tables under the quest id
-- app.<project_key>.<slug>; this table holds the definitions. A retired quest keeps its row, its completions and its badges.
CREATE TABLE app_quests (
    id          text COLLATE "C" PRIMARY KEY,          -- app.<project_key>.<slug>
    project_id  text COLLATE "C" NOT NULL,             -- prj_…
    project_key text COLLATE "C" NOT NULL,             -- p<ULID lowercase>, the event type prefix's middle segment
    app         text COLLATE "C" NOT NULL,             -- app:app_… that last defined it
    env         text NOT NULL CHECK (env IN ('sandbox','production')),
    slug        text COLLATE "C" NOT NULL,
    title       text NOT NULL,
    why         text,
    steps       jsonb NOT NULL,                        -- [{ event_type, count, label }]
    badge_name  text NOT NULL,
    url         text,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
    created_at  text COLLATE "C" NOT NULL,
    updated_at  text COLLATE "C" NOT NULL,
    UNIQUE (project_key, slug)
);
CREATE INDEX app_quests_project ON app_quests (project_id, status);
CREATE INDEX app_quests_listing ON app_quests (env, status, updated_at DESC);
