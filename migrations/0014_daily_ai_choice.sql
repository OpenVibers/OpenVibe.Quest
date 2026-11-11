-- phase: expand
-- AI wording is off until the person explicitly chooses it; keep each change for audit.
ALTER TABLE daily_preferences ADD COLUMN ai_text_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE daily_preferences ADD COLUMN language text NOT NULL DEFAULT 'en';
CREATE TABLE daily_ai_choices (
    id text COLLATE "C" PRIMARY KEY,
    subject text COLLATE "C" NOT NULL,
    enabled boolean NOT NULL,
    language text NOT NULL,
    text_version text NOT NULL,
    chosen_at text COLLATE "C" NOT NULL
);
