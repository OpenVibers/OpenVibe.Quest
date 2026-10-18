'use strict';
/**
 * ADR-029: network.subject.merged folds one account's quest rows into the survivor's, through the service's own
 * /internal/events route. Progress keeps the higher count per step, a quest both finished counts once (the
 * survivor's), a quest only the folded account finished moves with its coins, each badge keeps its first award, a
 * redelivery moves nothing twice, and the event never touches quest_event_inbox.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const questStore = require('../server/quests/store');

const KEEP = 'usr_01JZ0000000000000000000KEP';
const GONE = 'usr_01JZ0000000000000000000GNE';
const OTHER = 'usr_01JZ0000000000000000000OTH';
const SECRET = `whsec_${'fixture'.repeat(6)}`;
const merged = { event_id: 'evt_01JZ0000000000000000000M01', event_type: 'network.subject.merged', source: 'network', payload: { merge_id: 'mrg_01JZ0000000000000000000MRG', from: GONE, into: KEEP } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

(async () => {
    await check('a merge moves the folded account\'s quests to the survivor once', async () => {
        const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET } });
        try {
            const s = t.ctx.s;
            const early = '2026-10-01T00:00:00.000Z', late = '2026-10-10T00:00:00.000Z';
            // Both started "go-live": the folded account is further along.
            await questStore.bumpProgress(s.db, { subject: KEEP, questId: 'go-live', step: 0, target: 3, at: late });
            await questStore.bumpProgress(s.db, { subject: GONE, questId: 'go-live', step: 0, target: 3, at: early });
            await questStore.bumpProgress(s.db, { subject: GONE, questId: 'go-live', step: 0, target: 3, at: early });
            // Both finished "follow-someone"; only the folded account finished "first-paste", with coins still owed.
            await questStore.complete(s.db, { id: s.newId('qcp'), subject: KEEP, questId: 'follow-someone', at: late, coins: 10, coinsState: 'credited' });
            await questStore.complete(s.db, { id: s.newId('qcp'), subject: GONE, questId: 'follow-someone', at: early, coins: 10, coinsState: 'credited' });
            await questStore.complete(s.db, { id: s.newId('qcp'), subject: GONE, questId: 'first-paste', at: early, coins: 5, coinsState: 'pending' });
            await questStore.awardBadge(s.db, { subject: KEEP, badgeId: 'first-follow', questId: 'follow-someone', at: late });
            await questStore.awardBadge(s.db, { subject: GONE, badgeId: 'first-follow', questId: 'follow-someone', at: early });
            await questStore.awardBadge(s.db, { subject: GONE, badgeId: 'first-paste', questId: 'first-paste', at: early });
            await questStore.awardBadge(s.db, { subject: OTHER, badgeId: 'first-paste', questId: 'first-paste', at: early });

            const send = async () => await t.get('/internal/events', { method: 'POST', body: bodyOf(merged), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(merged), SECRET) } });
            const res = await send();
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'merged');

            const count = await s.db.value("SELECT count FROM quest_progress WHERE subject = $1 AND quest_id = 'go-live' AND step = 0", [KEEP]);
            assert.strictEqual(Number(count), 2, 'the step keeps the higher count');
            const comps = await s.db.many('SELECT quest_id, completed_at, coins_state FROM quest_completions WHERE subject = $1 ORDER BY quest_id', [KEEP]);
            assert.deepStrictEqual(comps.map((c) => [c.quest_id, c.coins_state]), [['first-paste', 'pending'], ['follow-someone', 'credited']], 'one completion per quest; an owed credit moves to the survivor');
            assert.strictEqual(comps.find((c) => c.quest_id === 'follow-someone').completed_at, late, "a quest both finished keeps the survivor's");
            const badges = await s.db.many('SELECT badge_id, awarded_at FROM quest_badges WHERE subject = $1 ORDER BY badge_id', [KEEP]);
            assert.deepStrictEqual(badges.map((b) => [b.badge_id, b.awarded_at]), [['first-follow', early], ['first-paste', early]], 'each badge keeps its first award');
            for (const table of ['quest_progress', 'quest_completions', 'quest_badges']) {
                assert.strictEqual(Number(await s.db.value(`SELECT count(*)::int FROM ${table} WHERE subject = $1`, [GONE])), 0, `nothing is left under the folded account in ${table}`);
            }
            assert.strictEqual(Number(await s.db.value('SELECT count(*)::int FROM quest_badges WHERE subject = $1', [OTHER])), 1, 'someone else is untouched');

            const again = await send();
            assert.strictEqual(again.json().outcome, 'unchanged', 'a redelivery moves nothing twice');
            assert.strictEqual(Number(await s.db.value('SELECT count(*)::int FROM quest_event_inbox WHERE event_id = $1', [merged.event_id])), 0, 'the merge is not claimed by quest_event_inbox');
            const bad = { ...merged, event_id: 'evt_01JZ0000000000000000000M02', payload: { ...merged.payload, into: GONE } };
            assert.strictEqual((await t.get('/internal/events', { method: 'POST', body: bodyOf(bad), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(bad), SECRET) } })).json().outcome, 'ignored:payload', 'an account merged into itself is ignored');
        } finally { await t.close(); }
    });

    await check('boot subscribes to account merges', async () => {
        assert.ok(require('../server/events-consumer').TOPICS.includes('network.subject.merged'));
    });

    done();
})();
