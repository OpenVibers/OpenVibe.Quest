'use strict';

const assert = require('node:assert/strict');
const { boot, check, done } = require('./helpers/boot');
const { createGlyphDraftClient, nameForBadge, nameForDaily } = require('../server/quests/glyph-drafts');

(async () => {
    const requests = [];
    const approved = new Map();
    const glyphs = { nameForBadge, nameForDaily, approved: async () => approved,
        request: async (name, sentence) => { requests.push({ name, sentence }); return true; } };
    const t = await boot({ glyphs });
    const person = t.network.addUser('mira');
    try {
        await t.ctx.s.db.query('INSERT INTO quest_progress (subject, quest_id, step, count, updated_at) VALUES ($1,$2,0,2,$3)',
            [person.subject, 'stream-three-times', new Date().toISOString()]);
        await t.ctx.s.db.query('INSERT INTO quest_badges (subject,badge_id,quest_id,awarded_at) VALUES ($1,$2,$3,$4)',
            [person.subject, 'first-broadcast', 'go-live', new Date().toISOString()]);
        await check('quest log and index stay server rendered with distinct phone and desktop structures', async () => {
            const me = await t.get('/me', { as: person });
            assert.equal(me.status, 200);
            for (const word of ['q-log-hero', 'q-log-columns', 'q-progress-card', 'q-completed-fold', 'q-badge-grid',
                'q-badge-sheet', 'First Broadcast', 'role="progressbar"', 'Your quest log']) assert.ok(me.text.includes(word), word);
            assert.ok(me.text.includes('/css/quest-visual.css') && me.text.includes('/js/quest-visual.js'));
            const index = await t.get('/quests', { as: person });
            assert.equal(index.status, 200);
            assert.ok(/<section class="q-daily"[^>]*>[\s\S]*?<h2 id="daily-title" class="q-daily-title">/.test(index.text), 'the catalog shows the same daily card as the home, its title an h2');
            assert.ok(!index.text.includes('q-index-daily'), 'one card, not two');
            assert.ok(index.text.includes('Quests by site') && index.text.includes('q-site-chip'));
            assert.ok(requests.some((x) => /^daily-\d{4}-\d{2}-\d{2}$/.test(x.name)), 'a unique daily drawing joins review');
        });
        await check('only approved drawings replace the bundled glyph fallback', async () => {
            let me = await t.get('/me', { as: person });
            assert.ok(me.text.includes('data-icon="live"'), 'a bundled icon appears before review');
            approved.set(nameForBadge('first-broadcast'), '<path d="M5 12h14"/>');
            me = await t.get('/me', { as: person });
            assert.ok(me.text.includes('data:image/svg+xml,'), 'an approved drawing is shown');
            assert.ok(me.text.includes('q-badge-close') && me.text.includes('data-share='));
        });
    } finally { await t.close(); }

    await check('the Design client sends a service token, caches approved glyphs and never returns pending ones', async () => {
        const calls = [];
        let now = Date.now();
        const fetchImpl = async (url, options = {}) => {
            calls.push({ url: String(url), method: options.method || 'GET', authorization: options.headers?.Authorization });
            if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'opaque-test', token_type: 'Bearer', expires_in: 300 }), { status: 200 });
            if (options.method === 'POST') return new Response(JSON.stringify({ name: 'daily-2026-11-09', status: 'pending', draft_ids: [], created: true }), { status: 201 });
            return new Response(JSON.stringify({ drafts: [
                { name: 'daily-2026-11-09', status: 'approved', svg: '<path d="M5 12h14"/>' },
                { name: 'pending', status: 'draft', svg: '<path d="M5 12h14"/>' },
            ] }), { status: 200 });
        };
        const client = createGlyphDraftClient({ config: { designDrafts: true, designInternalUrl: 'http://design.test',
            networkInternalUrl: 'http://network.test', oauth: { clientId: 'quest', clientSecret: 'test' } },
        fetchImpl, now: () => now });
        assert.equal(await client.request('daily-2026-11-09', 'A shared quest across sites'), true);
        assert.equal(calls.find((c) => c.url.includes('/api/v1/glyphs/drafts') && c.method === 'POST').authorization, 'Bearer opaque-test');
        const first = await client.approved();
        assert.ok(first.has('daily-2026-11-09'));
        assert.ok(!first.has('pending'));
        await client.approved();
        assert.equal(calls.filter((c) => c.method === 'GET').length, 1, 'approved list cached for five minutes');
    });
    done();
})().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exit(1); });
