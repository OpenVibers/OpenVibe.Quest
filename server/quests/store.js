'use strict';

/**
 * The quest log in PostgreSQL (migrations/0002_quest.sql): progress, completions and badges.
 *
 * Every function takes a db handle first — the store's `s.db`, or the transaction handle inside `inbox.once`,
 * so the progress a delivery writes and its receipt commit together or not at all.
 *
 * A subject is a canonical usr_… id. A quest never completes twice for a person (UNIQUE (subject, quest_id)) and
 * a badge is never awarded twice (PRIMARY KEY (subject, badge_id)), so a redelivered event changes nothing.
 */

const DAY_MS = 86_400_000;

/** The UTC day (YYYY-MM-DD) a moment falls in — the bucket the daily coin caps count. */
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Raise one step's count by one, never past its target. Returns the new count. */
async function bumpProgress(db, { subject, questId, step, target, at }) {
    return Number(await db.value(
        `INSERT INTO quest_progress (subject, quest_id, step, count, updated_at)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (subject, quest_id, step) DO UPDATE
             SET count = LEAST(quest_progress.count + 1, $5), updated_at = EXCLUDED.updated_at
         RETURNING count`,
        [subject, questId, step, at, target]));
}

/** A person's progress on one quest: [{ step, count, updated_at }], keyed by step index in the caller. */
const progressOf = (db, subject, questId) => db.many(
    'SELECT step, count, updated_at FROM quest_progress WHERE subject = $1 AND quest_id = $2 ORDER BY step',
    [subject, questId]);

/** Every progress row a person has, newest first — the quest log page and GET /me/quests read this once. */
const progressFor = (db, subject) => db.many(
    'SELECT quest_id, step, count, updated_at FROM quest_progress WHERE subject = $1 ORDER BY quest_id, step',
    [subject]);

const completion = (db, subject, questId) => db.maybe(
    'SELECT * FROM quest_completions WHERE subject = $1 AND quest_id = $2', [subject, questId]);

const completionsFor = (db, subject) => db.many(
    'SELECT * FROM quest_completions WHERE subject = $1 ORDER BY completed_at DESC, id DESC', [subject]);

/** Every completion for a quest — a completion count for the pages, never a list of people. */
const completionCount = async (db, questId) => Number(await db.value('SELECT count(*) FROM quest_completions WHERE quest_id = $1', [questId]));

/**
 * Record a completion. Returns the row when it was inserted now, or null when this person already completed the
 * quest (the unique constraint, not a read-then-write, is what makes that safe under a redelivery).
 */
async function complete(db, c) {
    const row = await db.maybe(
        `INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (subject, quest_id) DO NOTHING
         RETURNING *`,
        [c.id, c.subject, c.questId, c.at, c.coins, c.coinsState]);
    return row;
}

const awardBadge = (db, { subject, badgeId, questId, at }) => db.exec(
    `INSERT INTO quest_badges (subject, badge_id, quest_id, awarded_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (subject, badge_id) DO NOTHING`,
    [subject, badgeId, questId, at]);

const badgesFor = (db, subject) => db.many(
    'SELECT badge_id, quest_id, awarded_at FROM quest_badges WHERE subject = $1 ORDER BY awarded_at DESC, badge_id',
    [subject]);

/** A person's public badges: the caller renders them; nothing else about the person leaves this function. */
const badgesOf = (db, subject) => db.many(
    'SELECT badge_id, awarded_at FROM quest_badges WHERE subject = $1 ORDER BY awarded_at DESC, badge_id',
    [subject]);

/** Move a completion's coins state; `attempt` bumps the attempt counter the retry timer reads. */
const setCoins = (db, id, { state, error = null, at = null, attempts = 0, balance = null }) => db.maybe(
    `UPDATE quest_completions
        SET coins_state = $2, coins_error = $3, coins_at = $4,
            coins_attempts = coins_attempts + $5, coins_balance = COALESCE($6, coins_balance)
      WHERE id = $1
      RETURNING *`,
    [id, state, error, at, attempts, balance]);

/** Completions whose credit is still owed (pending, or failed and worth retrying), oldest first. */
const owedCoins = (db, limit = 50) => db.many(
    `SELECT * FROM quest_completions WHERE coins_state IN ('pending', 'failed') AND coins > 0
      ORDER BY completed_at, id LIMIT $1`,
    [limit]);

// `left(coins_at, 10)` (the UTC day of an ISO timestamp) keeps the comparison typed: substr() is overloaded for
// text and bytea, and with an untyped parameter Postgres cannot tell which one is meant.
/** OpenCoins credited to one person on a UTC day (by when the credit landed, not when the quest completed). */
const creditedTo = async (db, subject, day) => Number(await db.value(
    `SELECT COALESCE(SUM(coins), 0) FROM quest_completions
      WHERE subject = $1 AND coins_state = 'credited' AND coins_at IS NOT NULL AND left(coins_at, 10) = $2::text`,
    [subject, day]));

/** OpenCoins credited to everyone on a UTC day — the global cap. */
const creditedAll = async (db, day) => Number(await db.value(
    `SELECT COALESCE(SUM(coins), 0) FROM quest_completions
      WHERE coins_state = 'credited' AND coins_at IS NOT NULL AND left(coins_at, 10) = $1::text`,
    [day]));

/** Record what happened to a completion's item reward. */
const setItem = (db, id, { state, instance = null, error = null, at = null, attempts = 0 }) => db.maybe(
    `UPDATE quest_completions
        SET item_state = $2, item_instance = COALESCE($3, item_instance), item_error = $4, item_at = $5,
            item_attempts = item_attempts + $6
      WHERE id = $1
      RETURNING *`,
    [id, state, instance, error, at, attempts]);

/** Completions of the given quests whose item is still owed (never decided, or failed), oldest first. */
const owedItems = (db, questIds, limit = 50) => (questIds.length ? db.many(
    `SELECT * FROM quest_completions WHERE quest_id = ANY($1::text[]) AND (item_state IS NULL OR item_state = 'failed')
      ORDER BY completed_at, id LIMIT $2`,
    [questIds, limit]) : Promise.resolve([]));

/** How many people have a badge — the count a quest page can show without naming anyone. */
const badgeHolders = async (db, badgeId) => Number(await db.value('SELECT count(*) FROM quest_badges WHERE badge_id = $1', [badgeId]));

module.exports = {
    DAY_MS, dayOf,
    bumpProgress, progressOf, progressFor,
    completion, completionsFor, completionCount, complete,
    awardBadge, badgesFor, badgesOf, badgeHolders,
    setCoins, owedCoins, creditedTo, creditedAll,
    setItem, owedItems,
};
