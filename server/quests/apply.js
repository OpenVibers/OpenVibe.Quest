'use strict';

/**
 * Applying one domain event to the quest log.
 *
 * The person comes from the field the event's own schema defines — never from anything else in the body, never
 * from a name, and never guessed: a stream's channel subject (live.stream.started), the follower
 * (network.follow.created), the author of a thread, post, comment or wiki revision, the chat message's
 * user_subject, a game player's account subject, a tool job's owner. Where a schema says the envelope's actor IS
 * that person (live.stream.started: "the streamer's user subject when Live knows it"), the actor is the second
 * choice; otherwise it is ignored. An event whose subject is missing, a guest (gst_…), or a service, app or mod
 * principal is ignored, outcome 'ignored:subject', and nothing is written.
 *
 * Then, for every quest that counts the event type:
 *   - one more on that step's count (capped at the step's target; a completed quest is left frozen);
 *   - if every step is at its target, a completion — once per person, by the unique constraint — and its badge.
 *
 * OpenCoins are NOT touched here: the caller settles them after the transaction commits, so a slow or broken
 * wallet (OpenVibe.Network) cannot hold up the delivery or roll back a completion the person really earned.
 *
 * `db` is a transaction handle when this runs inside the inbox (server/events-consumer.js), so the writes and the
 * receipt of the delivery commit together.
 */
const { ids } = require('openvibe-contracts');
const catalog = require('./catalog');
const store = require('./store');

const isUser = (v) => typeof v === 'string' && ids.isSubjectId('user', v);
/** A subject-ref ({ type, id }) that names a person. */
const refUser = (r) => (r && r.type === 'user' && isUser(r.id) ? r.id : null);

/**
 * The person the event names, or null when it names nobody this service may credit. Each case is one schema
 * (node_modules/openvibe-contracts/contracts/events/payloads/<event_type>.v1.json); the comment names the field.
 */
function personOf(event) {
    const p = (event && event.payload) || {};
    switch (event && event.event_type) {
        case 'live.stream.started':       // payload.channel.subject (the streamer), else the envelope actor
            return refUser(p.channel && p.channel.subject) || refUser(event.actor);
        case 'network.follow.created':    // payload.follower
            return isUser(p.follower) ? p.follower : null;
        case 'community.thread.created':  // payload.author (identity.subject-ref@1)
        case 'community.post.created':
        case 'community.comment.created':
        case 'space.thread.created':
            return refUser(p.author);
        case 'chat.room.message.created': // payload.user_subject (null in private rooms, and for a guest)
            return isUser(p.user_subject) ? p.user_subject : null;
        case 'wiki.revision.created':     // payload.author: a usr_… subject, or svc:<id> for a service edit
            return isUser(p.author) ? p.author : null;
        case 'games.player.joined':       // payload.player.subject (user or guest; a local guest has none)
            return refUser(p.player && p.player.subject);
        case 'tools.job.created':         // payload.owner (a user, or a service, app or mod principal)
            return refUser(p.owner);
        default:
            return null;
    }
}

/**
 * Apply the event in `db` (a handle or a transaction). Returns
 *   { subject, outcome, completed: [<quest_completions row>] }
 * with outcome 'ignored:subject' | 'ignored:type' | 'progress' | 'completed'. `completed` is what the caller
 * still has to do about OpenCoins.
 */
async function apply(db, event, { at, newId }) {
    const subject = personOf(event);
    if (!subject) return { subject: null, outcome: 'ignored:subject', completed: [] };
    const quests = catalog.withEvent(event.event_type);
    if (!quests.length) return { subject, outcome: 'ignored:type', completed: [] };

    const completed = [];
    for (const quest of quests) {
        // A quest this person already finished stays finished: its progress is history, not a counter to raise.
        if (await store.completion(db, subject, quest.id)) continue;

        const progress = new Map((await store.progressOf(db, subject, quest.id)).map((r) => [Number(r.step), Number(r.count)]));
        for (const [i, step] of quest.steps.entries()) {
            if (step.event_type !== event.event_type) continue;
            progress.set(i, await store.bumpProgress(db, { subject, questId: quest.id, step: i, target: step.count, at }));
        }
        if (!quest.steps.every((s, i) => (progress.get(i) || 0) >= s.count)) continue;

        const coins = quest.reward.coins;
        const row = await store.complete(db, {
            id: newId('qcp'), subject, questId: quest.id, at,
            coins, coinsState: coins > 0 ? 'pending' : 'skipped',
        });
        if (!row) continue;   // lost a race with another delivery: it owns the completion
        await store.awardBadge(db, { subject, badgeId: quest.reward.badge.id, questId: quest.id, at });
        completed.push(row);  // the completion row: id, subject, quest_id, coins, coins_state, …
    }
    return { subject, outcome: completed.length ? 'completed' : 'progress', completed };
}

module.exports = { apply, personOf };
