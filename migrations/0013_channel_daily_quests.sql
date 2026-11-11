-- phase: expand
-- A channel owner can choose guided catalogue steps for their channel.
CREATE TABLE channel_daily_quests (
    subject text COLLATE "C" PRIMARY KEY,
    title text NOT NULL,
    steps_json text NOT NULL,
    updated_at text COLLATE "C" NOT NULL
);
