-- phase: expand
-- Completion is the durable outbox: retries reuse its existing id.
ALTER TABLE quest_completions ADD COLUMN IF NOT EXISTS experience_state text NOT NULL DEFAULT 'pending'
    CHECK (experience_state IN ('pending', 'awarded', 'skipped'));
CREATE INDEX IF NOT EXISTS quest_completions_experience_pending ON quest_completions(completed_at) WHERE experience_state = 'pending';
