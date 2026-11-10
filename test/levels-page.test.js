'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
(async () => {
    const t = await boot();
    const user = t.network.addUser('levels_page');
    const entry = { subject: user.subject, username: 'levels_page', xp: 125, level: 2, rank: 1 };
    t.ctx.levels.readClient = () => ({
        board: async () => ({ all_time: { top: [entry], me: entry, around: [entry] }, week: { top: [entry], me: entry, around: [entry] } }),
        get: async () => ({ level: 2, xp: 125, into: 25, span: 200, next_at: 300, rank: 1, recent: [{ name: 'Finished a quest', amount: 25, at: '2026-11-09T12:00:00Z' }] }),
    });
    try {
        await check('public levels page shows boards and sign-in; signed-in page shows progress and named history', async () => {
            let r = await t.get('/levels'); assert.equal(r.status, 200); assert(r.text.includes('All time')); assert(r.text.includes('Sign in to see your level'));
            r = await t.get('/levels', { as: user }); assert.equal(r.status, 200);
            assert(r.text.includes('Your level: 2')); assert(r.text.includes('Finished a quest')); assert(r.text.includes('value="25" max="200"'));
            assert.equal(r.headers.get('cache-control'), 'private, no-store');
        });
        await check('Network outage gives a recoverable page', async () => {
            t.ctx.levels.readClient = () => ({ board: async () => { throw new Error('down'); } });
            const r = await t.get('/levels'); assert.equal(r.status, 503); assert(r.text.includes('temporarily unavailable'));
        });
    } finally { await t.close(); }
    done();
})().catch(() => process.exit(1));
