-- phase: expand
-- Match a Live setup event to its one task without storing any other payload data.
ALTER TABLE daily_events ADD COLUMN event_detail text;
