'use strict';

/**
 * network.subject.merged → Quest (ADR-029). Two Network accounts became one: `from` is now an alias of `into`, and
 * every quest row of `from` becomes `into`'s, once per merge_id (quest_subject_merges):
 *
 *   quest_progress     each step keeps the higher count of the two (counts are capped at the step's target)
 *   quest_completions  a quest only `from` finished moves to `into` with its OpenCoins state (a credit still owed is
 *                      settled to the survivor); one both finished keeps the survivor's, since each wallet was credited
 *                      once and Network merges the wallets itself
 *   quest_badges       the earliest award of each badge is kept
 *
 * Delivered to POST /internal/events beside the account topics; it never passes through quest_event_inbox.
 */
const TOPIC = 'network.subject.merged';
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const MERGE_RE = /^mrg_[0-9A-HJKMNP-TV-Z]{26}$/;

/** One envelope → 'merged' | 'unchanged' | 'ignored:<why>'. */
async function apply(ev, { s, log = console }) {
    if (!ev || ev.event_type !== TOPIC) return 'ignored:type';
    if (ev.source !== 'network') return 'ignored:source';
    const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    const mergeId = String(p.merge_id || ''), from = String(p.from || ''), into = String(p.into || '');
    if (!MERGE_RE.test(mergeId) || !SUBJECT_RE.test(from) || !SUBJECT_RE.test(into) || from === into) return 'ignored:payload';
    const r = await s.tx(async () => {
        const db = s.db;
        if (await db.maybe('SELECT 1 FROM quest_subject_merges WHERE merge_id = $1', [mergeId])) return null;
        const at = s.iso();
        const progress = Number(await db.value(`WITH moved AS (
            INSERT INTO quest_progress (subject, quest_id, step, count, updated_at)
            SELECT $2, quest_id, step, count, updated_at FROM quest_progress WHERE subject = $1
            ON CONFLICT (subject, quest_id, step) DO UPDATE SET count = GREATEST(quest_progress.count, excluded.count),
                updated_at = GREATEST(quest_progress.updated_at, excluded.updated_at)
            RETURNING 1) SELECT count(*)::int FROM moved`, [from, into]));
        await db.exec('DELETE FROM quest_progress WHERE subject = $1', [from]);
        const completions = Number(await db.value(`WITH moved AS (
            UPDATE quest_completions SET subject = $2 WHERE subject = $1
              AND quest_id NOT IN (SELECT quest_id FROM quest_completions WHERE subject = $2)
            RETURNING 1) SELECT count(*)::int FROM moved`, [from, into]));
        await db.exec('DELETE FROM quest_completions WHERE subject = $1', [from]);
        const badges = Number(await db.value(`WITH moved AS (
            INSERT INTO quest_badges (subject, badge_id, quest_id, awarded_at)
            SELECT $2, badge_id, quest_id, awarded_at FROM quest_badges WHERE subject = $1
            ON CONFLICT (subject, badge_id) DO UPDATE SET awarded_at = LEAST(quest_badges.awarded_at, excluded.awarded_at)
            RETURNING 1) SELECT count(*)::int FROM moved`, [from, into]));
        await db.exec('DELETE FROM quest_badges WHERE subject = $1', [from]);
        await db.exec('INSERT INTO quest_subject_merges (merge_id, from_subject, into_subject, progress, completions, badges, merged_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [mergeId, from, into, progress, completions, badges, at]);
        return { progress, completions, badges };
    });
    if (!r) return 'unchanged';
    log.log(`[Merge] ${mergeId}: ${r.progress} progress step(s), ${r.completions} completion(s) and ${r.badges} badge(s) now the survivor's`);
    return 'merged';
}

module.exports = { apply, TOPIC };
