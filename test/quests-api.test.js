'use strict';
/**
 * /api/v1/quests, /api/v1/quests/:id, /api/v1/me/quests and /api/v1/profiles/:subject/badges, plus the pages that
 * carry them:
 *
 *   - the public catalog needs no token and is grouped by site, with each reward;
 *   - /me/quests is a person's own log: it requires sign-in, shows only their rows, and nobody else's;
 *   - the public badge endpoint shows an id, a name and a date and nothing else about the person;
 *   - every page is server-rendered and complete without JavaScript;
 *   - a hostile title is escaped everywhere it is rendered.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const catalog = require('../server/quests/catalog');
const renderQuests = require('../server/render/quests');
const { render } = require('../server/render/html');

(async () => {
    const t = await boot();
    const kim = t.network.addUser('kim');
    const ana = t.network.addUser('ana');

    try {
        await check('GET /api/v1/quests: public, grouped by site, every quest with its reward and its steps', async () => {
            const r = await t.get('/api/v1/quests');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('cache-control') || '', /no-store/);
            const body = r.json();
            assert.strictEqual(body.quests.length, catalog.all().length);
            assert.ok(body.quests.length >= 8 && body.quests.length <= 12, `${body.quests.length} quests`);
            assert.deepStrictEqual(body.sites.map((s) => s.site), catalog.SITE_ORDER, 'grouped in catalog order');
            assert.strictEqual(body.sites.reduce((n, s) => n + s.quests.length, 0), catalog.all().length, 'every quest is in exactly one group');
            const live = body.sites.find((s) => s.site === 'openvibe.live');
            assert.strictEqual(live.name, 'OpenVibe.Live');
            const goLive = body.quests.find((q) => q.id === 'go-live');
            assert.strictEqual(goLive.title, 'Go live once');
            assert.deepStrictEqual(goLive.steps, [{ event_type: 'live.stream.started', count: 1, label: 'Start a stream' }]);
            assert.deepStrictEqual(goLive.reward, { badge: { id: 'first-broadcast', name: 'First Broadcast' }, coins: 10, item: { issuer: 'service:live', alias: 'hat_basic_cap', name: 'Basic Cap', kind: 'Hat' } });
            assert.strictEqual(goLive.repeatable, false);
            assert.strictEqual(body.coins.enabled, false, 'OpenCoins are off by default');
            assert.strictEqual(body.coins.daily_cap, 50);
        });

        await check('every quest counts only events the catalog documents, and no quest pays Vibes', () => {
            for (const q of catalog.all()) {
                for (const step of q.steps) assert.ok(catalog.EVENT_TYPES.includes(step.event_type), `${q.id} counts ${step.event_type}`);
                assert.ok(Number.isInteger(q.reward.coins) && q.reward.coins >= 0, `${q.id} coins`);
                assert.ok(typeof q.reward.badge.name === 'string' && /^[A-Za-z ]+$/.test(q.reward.badge.name), `${q.id} badge label is plain text`);
                assert.strictEqual(q.repeatable, false);
                assert.ok(catalog.SITES[q.site], `${q.id} has a real site`);
            }
        });

        await check('GET /api/v1/quests/:id answers one quest, and a problem+json 404 for an unknown one', async () => {
            const ok = await t.get('/api/v1/quests/improve-a-wiki-page');
            assert.strictEqual(ok.status, 200);
            assert.strictEqual(ok.json().site, 'openvibe.wiki');
            assert.strictEqual(ok.json().url, '/quests/improve-a-wiki-page');
            const missing = await t.get('/api/v1/quests/not-a-quest');
            assert.strictEqual(missing.status, 404);
            assert.match(missing.headers.get('content-type'), /application\/problem\+json/);
            assert.strictEqual(missing.json().code, 'quest.not_found');
        });

        await check('GET /api/v1/me/quests requires sign-in and shows only the caller\'s own log', async () => {
            const anon = await t.get('/api/v1/me/quests');
            assert.strictEqual(anon.status, 401);
            assert.match(anon.headers.get('content-type'), /application\/problem\+json/);
            assert.strictEqual(anon.json().code, 'token.required');

            await t.ctx.s.db.query('INSERT INTO quest_progress (subject, quest_id, step, count, updated_at) VALUES ($1, $2, 0, 2, $3)', [kim.subject, 'stream-three-times', new Date().toISOString()]);
            await t.ctx.s.db.query('INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state) VALUES ($1, $2, $3, $4, 5, $5)', ['qcp_kim', kim.subject, 'follow-someone', new Date().toISOString(), 'skipped']);

            const mine = await t.get('/api/v1/me/quests', { as: kim });
            assert.strictEqual(mine.status, 200);
            assert.strictEqual(mine.json().subject, kim.subject);
            assert.strictEqual(mine.json().quests.length, catalog.all().length);
            const started = mine.json().quests.find((q) => q.id === 'stream-three-times');
            assert.strictEqual(started.state, 'in_progress');
            assert.deepStrictEqual(started.progress.map((p) => p.count), [2]);
            assert.strictEqual(mine.json().quests.find((q) => q.id === 'follow-someone').state, 'completed');
            assert.deepStrictEqual(mine.json().completions.map((c) => c.id), ['qcp_kim']);
            assert.strictEqual(mine.json().coins.enabled, false);

            const hers = await t.get('/api/v1/me/quests', { as: ana });
            assert.strictEqual(hers.json().subject, ana.subject);
            assert.deepStrictEqual(hers.json().completions, [], 'ana sees nothing of kim');
            assert.deepStrictEqual(hers.json().badges, []);
            assert.ok(!hers.text.includes('qcp_kim'), 'kim\'s completion id is not in ana\'s answer');
        });

        await check('GET /api/v1/profiles/:subject/badges: public, and only ids, names and dates', async () => {
            await t.ctx.s.db.query('INSERT INTO quest_badges (subject, badge_id, quest_id, awarded_at) VALUES ($1, $2, $3, $4)', [kim.subject, 'first-broadcast', 'go-live', '2026-10-01T10:00:00.000Z']);

            const anon = await t.get(`/api/v1/profiles/${kim.subject}/badges`);
            assert.strictEqual(anon.status, 200, 'no token needed');
            const body = anon.json();
            assert.strictEqual(body.subject, kim.subject);
            assert.deepStrictEqual(body.badges, [{ id: 'first-broadcast', name: 'First Broadcast', awarded_at: '2026-10-01T10:00:00.000Z' }]);
            for (const b of body.badges) assert.deepStrictEqual(Object.keys(b).sort(), ['awarded_at', 'id', 'name'], 'nothing else about the person');
            assert.ok(!anon.text.includes('qcp_'), 'no completion');
            assert.ok(!anon.text.includes(kim.username), 'no username');
            assert.ok(!anon.text.includes('coins'), 'no coins');

            const nobody = await t.get('/api/v1/profiles/usr_01JZZZZZZZZZZZZZZZZZZZZZZZ/badges');
            assert.strictEqual(nobody.status, 200);
            assert.deepStrictEqual(nobody.json().badges, []);
            const hostile = await t.get('/api/v1/profiles/%3Cscript%3Ealert(1)%3C%2Fscript%3E/badges');
            assert.strictEqual(hostile.status, 404);
            assert.strictEqual(hostile.json().code, 'quest.profile.not_found');
        });

        await check('every page is server-rendered, complete without JavaScript, and answers 200', async () => {
            for (const p of ['/', '/how-it-works', '/quests/go-live', '/updates']) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 200, p);
                assert.match(r.headers.get('content-type'), /^text\/html/, p);
                assert.ok(r.text.includes('<main id="main"'), `${p}: no main`);
                assert.ok(/<noscript>/.test(r.text), `${p}: no noscript fallback`);
            }
            const quest = await t.get('/quests/go-live');
            assert.ok(quest.text.includes('Go live once'), 'the title');
            assert.ok(quest.text.includes('live.stream.started'), 'the event it counts');
            assert.ok(quest.text.includes('First Broadcast'), 'its badge');
            assert.ok(quest.text.includes('OpenCoins rewards start soon'), 'coins are honestly off');
            const home = await t.get('/');
            assert.ok(home.text.includes('OpenVibe.Live'), 'the quests are grouped by site');
            assert.ok(home.text.includes('Say hello in chat'), 'a chat quest is listed');
            assert.ok(home.text.includes('chat.room.message.created'), 'the events are listed');
            const how = await t.get('/how-it-works');
            assert.ok(how.text.includes('never money'), 'the rules say what rewards are');
            assert.ok(how.text.includes('Vibes'), 'and that they are never Vibes');
            assert.ok(how.text.includes('QUEST_COINS') || how.text.includes('OpenCoins rewards start soon'), 'the coins state');
        });

        await check('/me without a session asks for sign-in; with one it shows the person\'s own log', async () => {
            const anon = await t.get('/me');
            assert.strictEqual(anon.status, 200);
            assert.ok(anon.text.includes('Sign in with OpenVibe'), 'a sign-in prompt');
            assert.ok(!anon.text.includes(kim.username), 'nothing about anyone');
            assert.match(anon.headers.get('cache-control') || '', /no-store|private/);

            const mine = await t.get('/me', { as: kim });
            assert.strictEqual(mine.status, 200);
            assert.ok(mine.text.includes('<progress max="3" value="2">2 of 3</progress>'), 'a real progress bar for the started quest');
            assert.ok(mine.text.includes('First Broadcast'), 'the badge');
            assert.ok(mine.text.includes('Completed'), 'the completion');
            assert.ok(mine.text.includes(`/api/v1/profiles/${kim.subject}/badges`), 'it says what is public');
            assert.ok(!mine.text.includes(ana.subject), 'nothing about anyone else');
        });

        await check('crawl artifacts cover the quest pages and keep the private ones out', async () => {
            const sitemap = await t.get('/sitemap.xml');
            for (const q of catalog.all()) assert.ok(sitemap.text.includes(`<loc>https://openvibe.quest/quests/${q.id}</loc>`), `sitemap misses ${q.id}`);
            assert.ok(sitemap.text.includes('<loc>https://openvibe.quest/how-it-works</loc>'));
            const robots = await t.get('/robots.txt');
            assert.ok(robots.text.includes('Disallow: /me'), 'the private log is not crawled');
            const llms = await t.get('/llms.txt');
            assert.ok(llms.text.includes('(https://openvibe.quest/quests/go-live)'), 'llms.txt lists the quests');
            const full = await t.get('/llms-full.txt');
            assert.ok(full.text.includes('https://openvibe.quest/quests/go-live'), 'llms-full.txt has every quest page');
        });

        await check('a hostile title is escaped in the renderer and on the page', async () => {
            const hostile = {
                id: 'x', title: '<script>alert(1)</script>', why: '<img src=x onerror=alert(2)>',
                steps: [{ event_type: 'live.stream.started', count: 1, label: '<b>go</b>' }],
                reward: { badge: { id: 'b', name: '<i>Badge</i>' }, coins: 5 }, repeatable: false,
            };
            const cardHtml = render(renderQuests.card(hostile, { coinsEnabled: true }));
            assert.ok(!cardHtml.includes('<script>') && !cardHtml.includes('<img') && !cardHtml.includes('<b>go</b>'), 'no raw markup from data');
            assert.ok(cardHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped, not stripped');
            assert.ok(cardHtml.includes('&lt;i&gt;Badge&lt;/i&gt;'), 'the badge label is escaped too');

            const page = await t.get('/quests/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
            assert.strictEqual(page.status, 404);
            assert.ok(!page.text.includes('<script>alert(1)'), 'the requested path is never echoed as markup');
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
