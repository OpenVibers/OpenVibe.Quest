'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { serviceAuth } = require('openvibe-contracts');
(async () => {
    const t = await boot({ now: () => Date.parse('2026-11-10T02:00:00Z') });
    const u = t.network.addUser('card');
    const path = `/api/v1/profiles/${u.subject}/streak`;
    const token = (sub, cap = ['quest.badge.read']) => {
        const at = Math.floor(Date.now() / 1000);
        return serviceAuth.signServiceToken({ iss: t.network.url, sub, actor_type: 'service', aud: ['openvibe.quest'], cap,
            iat: at, exp: at + 300, jti: 'card-test' }, t.network.privatePem);
    };
    try {
        await check('streak aggregate is restricted to Network with its read capability', async () => {
            assert.strictEqual((await t.get(path)).status, 403);
            assert.strictEqual((await t.get(path, { as: u })).status, 403);
            assert.strictEqual((await t.get(path, { bearer: token('svc:live') })).status, 403);
            assert.strictEqual((await t.get(path, { bearer: token('svc:network', []) })).status, 403);
        });
        await check('card streak respects local day, yesterday grace and a gap without creating quests or rewards', async () => {
            await t.ctx.daily.setZone(u.subject, 'America/Los_Angeles');
            for (const day of ['2026-11-07', '2026-11-08']) await t.ctx.s.db.exec('INSERT INTO daily_completions(subject,day,completed_at) VALUES($1,$2,$3)', [u.subject, day, day + 'T12:00:00Z']);
            const r = await t.get(path, { bearer: token('svc:network') });
            assert.strictEqual(r.status, 200, r.text);
            assert.deepStrictEqual(r.json(), { streak: 2 });
            assert.strictEqual(r.headers.get('cache-control'), 'no-store');
            assert.strictEqual(await t.ctx.daily.streakOf(u.subject, '2026-11-11'), 0);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT count(*) FROM quest_completions')), 0);
            const bad = await t.get('/api/v1/profiles/nope/streak', { bearer: token('svc:network') });
            assert.strictEqual(bad.status, 400);
        });
    } finally { await t.close(); }
    done('card-streak');
})().catch(e => { console.error(e); process.exitCode = 1; });
