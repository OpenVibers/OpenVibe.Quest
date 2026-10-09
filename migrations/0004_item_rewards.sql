-- phase: expand
-- Item rewards (plan T21): six quests also give one of Live's items, granted in OpenVibe.Inventory after the
-- completion commits (server/quests/items.js), the way OpenCoins are. item_state is NULL until decided, then
-- 'granted' (item_instance is the inv_… id) or 'failed' (item_error says why; the retry timer comes back to it).
-- A completion from before this release has NULL too, so the timer gives earlier finishers their item. Additive.
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS item_state text COLLATE "C";
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS item_instance text COLLATE "C";
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS item_error text COLLATE "C";
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS item_at text COLLATE "C";
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS item_attempts integer NOT NULL DEFAULT 0;
