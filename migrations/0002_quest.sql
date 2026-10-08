-- phase: expand
-- OpenVibe.Quest: the quest log. Applied at boot by openvibe-sdk/db (NNNN_*.sql, in order).
-- Nothing written here is ever a credential, a key or a token.
--
--   quest_progress          one row per (person, quest, step): how far along they are
--   quest_completions       one row per (person, quest): the completion, its badge and its OpenCoins
--   quest_badges            one row per (person, badge): a badge is awarded once and never taken back
--   quest_event_inbox       the receipts of the OpenVibe.Events deliveries this service applied
--
-- A subject is a canonical usr_… id (identity.subject-ref@1); never a service-local id.
--
-- Coins: OpenCoins are loyalty points, never money. coins_state is
--   pending  the completion happened and a credit is still to be made
--   credited the Network wallet took the credit (coins_at is when)
--   skipped  no credit will be made (QUEST_COINS is off, or a daily cap was reached; coins_error says which)
--   failed   the wallet refused or was unreachable (coins_error says why; the retry timer comes back to it)
--
-- Applying one Events delivery is idempotent twice over: quest_event_inbox claims (consumer, event_id) in the
-- same transaction as the writes, and UNIQUE (subject, quest_id) makes a completion happen once.

CREATE TABLE quest_progress (
    subject    text COLLATE "C" NOT NULL,          -- usr_<ULID>
    quest_id   text COLLATE "C" NOT NULL,          -- the catalog's slug
    step       integer NOT NULL,                   -- the index of the step in the quest
    count      integer NOT NULL DEFAULT 0,         -- events seen for this step, capped at the step's target
    updated_at text COLLATE "C" NOT NULL,          -- ISO 8601 UTC
    PRIMARY KEY (subject, quest_id, step)
);

CREATE TABLE quest_completions (
    id            text COLLATE "C" PRIMARY KEY,    -- qcp_<ULID>
    subject       text COLLATE "C" NOT NULL,
    quest_id      text COLLATE "C" NOT NULL,
    completed_at  text COLLATE "C" NOT NULL,
    coins         integer NOT NULL DEFAULT 0,      -- what the catalog promises, never more
    coins_state   text COLLATE "C" NOT NULL,       -- pending | credited | skipped | failed
    coins_error   text,                            -- why it was skipped or failed; null when credited
    coins_at      text COLLATE "C",                -- when the credit landed (the day counts against the caps)
    coins_attempts integer NOT NULL DEFAULT 0,
    coins_balance integer,                         -- the wallet's balance after a credit, as Network answered it
    CONSTRAINT quest_completions_state CHECK (coins_state IN ('pending', 'credited', 'skipped', 'failed')),
    CONSTRAINT quest_completions_once  UNIQUE (subject, quest_id)
);
-- The retry timer's queue: completions whose credit is still owed.
CREATE INDEX quest_completions_owed ON quest_completions (completed_at) WHERE coins_state IN ('pending', 'failed');
-- The daily caps sum the coins that landed today.
CREATE INDEX quest_completions_coins_day ON quest_completions (coins_at) WHERE coins_state = 'credited';

CREATE TABLE quest_badges (
    subject    text COLLATE "C" NOT NULL,
    badge_id   text COLLATE "C" NOT NULL,          -- the catalog's badge id
    quest_id   text COLLATE "C" NOT NULL,
    awarded_at text COLLATE "C" NOT NULL,
    PRIMARY KEY (subject, badge_id)
);
CREATE INDEX quest_badges_by_subject ON quest_badges (subject, awarded_at DESC);

-- The openvibe-sdk inbox (inboxSchema('quest_event_inbox')): the receipt of every delivery this service applied.
CREATE TABLE IF NOT EXISTS quest_event_inbox (
    consumer     text NOT NULL,
    event_id     text NOT NULL,
    processed_at bigint NOT NULL,
    PRIMARY KEY (consumer, event_id)
);
