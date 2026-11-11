'use strict';
/**
 * Test accounts in Quest's public numbers (server/identity/test-subjects.js, server/quests/store.js).
 *
 * The identity authority lists the accounts marked is_test (the probes and older manual test accounts); Quest keeps
 * their subject ids in test_subject and every public count (quests finished, people with badges, badges people earn
 * most) leaves them out. The account's own rows are untouched: its quest log and badges still answer for itself.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const catalog = require('../server/quests/catalog');
const store = require('../server/quests/store');

(async () => {
    const t = await boot();
    const normal = t.network.addUser('normal_person');
    const probe = t.network.addUser('ovprobe_merge_keep', { is_test: true });
    const quest = catalog.all()[0];
    const insert = async (id, subject, at) => await t.ctx.s.db.exec(
        `INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state) VALUES ($1, $2, $3, $4, 0, 'skipped')`,
        [id, subject, quest.id, at]);
    await insert('qcp_normal', normal.subject, t.ctx.s.iso());
    await insert('qcp_probe', probe.subject, t.ctx.s.iso());
    const since = new Date(Date.now() - 7 * 86400000).toISOString();

    await check('before the identity list arrives, both count (the filter is data, not a guess)', async () => {
        const totals = await store.totals(t.ctx.s.db, since);
        assert.deepStrictEqual([totals.completions, totals.people, totals.recent], [2, 2, 2]);
    });

    await check('the Network list marks the test account; every public count leaves it out', async () => {
        const subjects = await t.ctx.testSubjects.refresh();
        assert.deepStrictEqual(subjects, [probe.subject]);
        const totals = await store.totals(t.ctx.s.db, since);
        assert.deepStrictEqual([totals.completions, totals.people, totals.recent], [1, 1, 1], 'the public figures count one person');
        const byQuest = await store.completionsByQuest(t.ctx.s.db);
        assert.deepStrictEqual(byQuest, [{ quest_id: quest.id, n: 1 }], 'the badge list counts one holder');
        assert.strictEqual(await store.completionCount(t.ctx.s.db, quest.id), 1);
    });

    await check('the test account\'s own rows still answer for itself', async () => {
        const mine = await store.completionsFor(t.ctx.s.db, probe.subject);
        assert.strictEqual(mine.length, 1, 'the probe still sees its own completion');
        assert.strictEqual((await store.badgesOf(t.ctx.s.db, probe.subject)).length, 0);
    });

    await check('a subject the Network unmarks is no longer hidden', async () => {
        t.network.state.testSubjects.clear();
        assert.deepStrictEqual(await t.ctx.testSubjects.refresh(), []);
        assert.strictEqual((await store.totals(t.ctx.s.db, since)).people, 2);
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
