'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { BASE_TYPES, validateSelection, localDay } = require('../server/quests/daily');
const { ids, serviceAuth } = require('openvibe-contracts');

(async () => {
    let now = Date.parse('2026-11-08T12:00:00Z');
    const t = await boot({ now: () => now, env: { QUEST_GUIDED_TODAY: 'on' }, aiGenerate: async () => ({
        steps: ['go-live', 'chat', 'wiki'], title: 'Go somewhere new', story: 'Make the network yours today.',
    }) });
    const user = t.network.addUser('daily');
    try {
        await check('catalogue carries the Live setup controls and at least thirty kinds', async () => {
            const kinds = await t.ctx.daily.allTypes();
            assert.ok(kinds.length >= 30);
            for (const [id, hook, site] of [['meme', 'meme.caption', 'openvibe.meme'], ['video', 'video.upload', 'openvibe.video'],
                ['chat', 'chat.message', 'openvibe.chat'], ['tool', 'tools.job', 'dns.openvibe.tools'],
                ['world', 'games.world.publish', 'openvibe.games'], ['wiki', 'wiki.revision', 'openvibe.wiki']]) {
                const step = kinds.find((item) => item.id === id);
                assert.strictEqual(step.hook, hook);
                assert.strictEqual(new URL(step.href).hostname, site);
            }
            assert.strictEqual(kinds.find((step) => step.id === 'world').daily_eligible, false);
            assert.strictEqual(kinds.find((step) => step.id === 'wiki').daily_eligible, false);
            const setup = kinds.filter((step) => step.id.startsWith('setup-'));
            assert.strictEqual(setup.length, 17);
            for (const step of setup) {
                assert.strictEqual(step.hook, `live.setup.${step.match_task}`);
                assert.strictEqual(new URL(step.href).hostname, 'openvibe.live');
                assert.ok(step.help);
            }
        });
        await check('today reader is private and permits network-site bearer requests', async () => {
            assert.strictEqual((await t.get('/api/v1/quests/today')).status, 401);
            const preflight = await t.get('/api/v1/quests/today', { method: 'OPTIONS', headers: { origin: 'https://openvibe.pics', 'access-control-request-method': 'GET' } });
            assert.strictEqual(preflight.status, 204);
            assert.strictEqual(preflight.headers.get('access-control-allow-origin'), 'https://openvibe.pics');
            const guidePreflight = await t.get('/api/v1/quests/today/steps/abc123def456', { method: 'OPTIONS', headers: { origin: 'https://dns.openvibe.tools', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
            assert.strictEqual(guidePreflight.status, 204);
            assert.strictEqual(guidePreflight.headers.get('access-control-allow-origin'), 'https://dns.openvibe.tools');
            const denied = await t.get('/api/v1/quests/today', { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
            assert.strictEqual(denied.headers.get('access-control-allow-origin'), null);
        });
        await check('generator checks topics and sites, and falls back after a bad answer', async () => {
            assert.strictEqual(validateSelection(['go-live', 'made-up', 'chat'], BASE_TYPES, null), null);
            assert.strictEqual(validateSelection(['thread', 'reply', 'comment'], BASE_TYPES, null), null);
            const today = await t.ctx.daily.ensure();
            assert.deepStrictEqual(today.steps.map((x) => x.id), ['go-live', 'chat', 'wiki']);
            assert.ok(today.steps.every((step) => !step.match_task), 'the public quest does not assign streamer-only setup tasks to everyone');
            assert.strictEqual(today.source, 'ai');
            const same = await t.ctx.daily.ensure();
            assert.deepStrictEqual(same, today);
            const bad = require('../server/quests/daily').createDaily({
                s: t.ctx.s, config: t.config, coins: t.ctx.coins,
                aiGenerate: async () => ({ steps: ['unknown', 'chat', 'wiki'], title: 'Bad', story: 'Bad' }),
            });
            now += 86400000;
            const next = await bad.ensure();
            assert.strictEqual(next.source, 'rotation');
            assert.notDeepStrictEqual(next.steps.map((x) => x.id).sort(), today.steps.map((x) => x.id).sort());
        });
        await check('events identify their person and count only in the chosen local day', async () => {
            now -= 86400000;
            await t.ctx.daily.setZone(user.subject, 'America/Los_Angeles');
            assert.strictEqual(localDay('2026-11-08T02:00:00Z', 'America/Los_Angeles'), '2026-11-07');
            const types = ['live.stream.started', 'chat.room.message.created', 'wiki.revision.created'];
            for (const [i, event_type] of types.entries()) {
                const payload = event_type === 'live.stream.started' ? { channel: { subject: { type: 'user', id: user.subject } } }
                    : event_type === 'chat.room.message.created' ? { user_subject: user.subject } : { author: user.subject };
                await t.ctx.daily.recordEvent(t.ctx.s.db, {
                    event_id: `evt_daily_${i}`, event_type, payload,
                    timestamp: '2026-11-08T18:00:00Z',
                });
            }
            const mine = await t.get('/api/v1/me/daily', { as: user });
            assert.strictEqual(mine.status, 200);
            assert.strictEqual(mine.json().progress, 3);
            assert.strictEqual(mine.json().streak, 1);
            assert.strictEqual(mine.json().completed, true);
            const today = await t.get('/api/v1/quests/today', { as: user, headers: { origin: 'https://openvibe.live' } });
            assert.strictEqual(today.status, 200);
            assert.strictEqual(today.json().steps.length, 3);
            assert.ok(!today.json().steps.some((x) => ['live.stream.started', 'chat.room.message.created', 'wiki.revision.created'].includes(x.event_type)), 'the private quest avoids recent actions already in this person\'s history');
            assert.deepStrictEqual((await t.get('/api/v1/quests/today', { as: user })).json(), today.json(), 'the personalized selection is cached for the day');
            assert.strictEqual(today.headers.get('access-control-allow-origin'), 'https://openvibe.live');
            const publicView = await t.get('/api/v1/daily');
            assert.strictEqual(publicView.json().finished_today, 1);
            assert.ok(!publicView.text.includes(user.subject));
        });
        await check('review gates contributed types and streak reads consecutive completions', async () => {
            const submitted = await t.ctx.daily.contribute('prj_test', {
                id: 'new-wiki', event_type: 'wiki.revision.created', site: 'openvibe.wiki',
                sentence: 'Edit a page', href: 'https://openvibe.wiki/', weight: 2,
            });
            assert.strictEqual(submitted.status, 'pending');
            assert.ok(!(await t.ctx.daily.allTypes()).some((x) => x.id === submitted.id));
            await t.ctx.daily.review(submitted.id, 'approved');
            assert.ok((await t.ctx.daily.allTypes()).some((x) => x.id === submitted.id));
            await t.ctx.s.db.exec('INSERT INTO daily_completions (subject,day,completed_at) VALUES ($1,$2,$3)',
                [user.subject, '2026-11-07', '2026-11-07T20:00:00Z']);
            assert.strictEqual((await t.ctx.daily.progress(user.subject)).streak, 2);
        });
        await check('step type API requires an app capability and a separate staff review', async () => {
            const project = ids.newId('project');
            const app = ids.newId('app');
            const sign = (sub, cap, actor_type, project_id = null) => {
                const at = Math.floor(Date.now() / 1000);
                return serviceAuth.signServiceToken({ iss: t.network.url, sub, actor_type, aud: ['openvibe.quest'],
                    cap: [cap], ns: project_id ? [project_id] : [], ...(project_id ? { project_id } : {}),
                    env: 'production', iat: at, exp: at + 300, jti: `tok_${Date.now()}` }, t.network.privatePem);
            };
            const proposal = { id: 'community-reply', event_type: 'community.post.created', site: 'openvibe.community',
                sentence: 'Reply to a thread', href: 'https://openvibe.community/', weight: 2 };
            const denied = await t.get('/api/v1/step-types', { method: 'POST', bearer: sign(`app:${app}`, 'quest.app_quest.manage', 'app', project), json: proposal });
            assert.strictEqual(denied.status, 403);
            const created = await t.get('/api/v1/step-types', { method: 'POST', bearer: sign(`app:${app}`, 'quest.steps.contribute', 'app', project), json: proposal });
            assert.strictEqual(created.status, 202, created.text);
            assert.strictEqual(created.json().status, 'pending');
            assert.ok(!(await t.get('/api/v1/step-types')).json().step_types.some(x => x.id === created.json().id));
            const reviewed = await t.get(`/api/v1/step-types/${encodeURIComponent(created.json().id)}/review`, {
                method: 'POST', bearer: sign('svc:quest', 'quest.steps.review', 'service'), json: { status: 'approved' },
            });
            assert.strictEqual(reviewed.status, 200);
            assert.ok((await t.get('/api/v1/step-types')).json().step_types.some(x => x.id === created.json().id));
        });
        await check('enabled OpenCoins credit a daily completion once', async () => {
            const c = await boot({ now: () => Date.parse('2026-11-08T20:00:00Z'), env: { QUEST_COINS: 'on' },
                aiGenerate: async () => ({ steps: ['go-live', 'chat', 'wiki'], title: 'Around the network', story: 'Three places today.' }) });
            try {
                const coinUser = c.network.addUser('coin-daily');
                await c.ctx.daily.setZone(coinUser.subject, 'UTC');
                for (const [i, event_type] of ['live.stream.started', 'chat.room.message.created', 'wiki.revision.created'].entries()) {
                    const payload = event_type === 'live.stream.started' ? { channel: { subject: { type: 'user', id: coinUser.subject } } }
                        : event_type === 'chat.room.message.created' ? { user_subject: coinUser.subject } : { author: coinUser.subject };
                    await c.ctx.daily.recordEvent(c.ctx.s.db, { event_id: `evt_coins_${i}`, event_type, payload, timestamp: '2026-11-08T19:00:00Z' });
                }
                await c.ctx.daily.progress(coinUser.subject);
                await c.ctx.daily.progress(coinUser.subject);
                const rows = await c.ctx.s.db.many('SELECT coins,coins_state FROM quest_completions WHERE subject=$1 AND quest_id=$2', [coinUser.subject, 'daily-2026-11-08']);
                assert.deepStrictEqual(rows.map(r => [Number(r.coins), r.coins_state]), [[5, 'credited']]);
            } finally { await c.close(); }
        });
        await check('opaque guide links resolve only for their signed-in owner', async () => {
            const aiCalls = [];
            const g = await boot({ now: () => Date.parse('2026-11-08T12:00:00Z'), env: { QUEST_GUIDED_TODAY: 'on' },
                aiGenerate: async (input) => { aiCalls.push(input); return ({ steps: ['picture', 'thread', 'schedule'], title: 'Make something', story: 'Three places.',
                    lines: { picture: 'Upload a picture', thread: 'Start a thread', schedule: 'Schedule something' } }); } });
            try {
                const owner = g.network.addUser('guide-owner');
                const stranger = g.network.addUser('guide-stranger');
                const aiPath = '/api/v1/me/daily/ai-text';
                assert.strictEqual((await g.get(aiPath, { as: owner })).json().ai_text_enabled, false);
                const choice = await g.get(aiPath, { as: owner, method: 'PUT', headers: { 'sec-fetch-site': 'same-origin' },
                    json: { enabled: true, language: 'es', text_version: 'quest-ai-text-1' } });
                assert.strictEqual(choice.status, 200, choice.text);
                const today = await g.get('/api/v1/quests/today', { as: owner });
                assert.strictEqual(today.status, 200);
                assert.strictEqual(today.json().source, 'ai');
                assert.ok(aiCalls.some((call) => call.language === 'es'));
                assert.ok(aiCalls.every((call) => !call.types.some((step) => step.id === 'meme')), 'disabled Meme events cannot become a daily step');
                const beforeUnsignedChoice = aiCalls.length;
                assert.strictEqual((await g.get('/api/v1/quests/today', { as: stranger })).json().source, 'rotation');
                assert.strictEqual(aiCalls.length, beforeUnsignedChoice, 'no person data reaches AI before that person opts in');
                const picture = today.json().steps.find((step) => step.id === 'picture');
                assert.match(picture.href, /^https:\/\/openvibe\.pics\/\?qstep=[A-Za-z0-9_-]{16}$/);
                assert.strictEqual(picture.hook, 'pics.upload');
                const id = new URL(picture.href).searchParams.get('qstep');
                const path = `/api/v1/quests/today/steps/${id}`;
                assert.strictEqual((await g.get(path)).status, 401);
                assert.strictEqual((await g.get(path, { as: stranger })).status, 404);
                const resolved = await g.get(path, { as: owner });
                assert.strictEqual(resolved.status, 200);
                assert.strictEqual(resolved.json().step.hook, 'pics.upload');
                assert.strictEqual(resolved.json().step.done, false);
                await g.ctx.s.db.exec('INSERT INTO daily_events(event_id,subject,event_type,occurred_at) VALUES($1,$2,$3,$4)',
                    [ids.newId('event'), owner.subject, 'mediahub.picture.uploaded', g.ctx.s.iso()]);
                assert.strictEqual((await g.get(path, { as: owner })).json().step.done, true);
                assert.ok(resolved.json().next_href === null || resolved.json().next_href.includes('qstep='));
                assert.strictEqual(require('../server/quests/apply').personOf({ event_type: 'today.event.scheduled', actor: { type: 'user', id: owner.subject } }), owner.subject);
                const channelPath = '/api/v1/me/channel-quest';
                const request = { title: 'Make something together', steps: ['picture', 'thread', 'schedule'] };
                assert.strictEqual((await g.get(channelPath, { method: 'PUT', json: request })).status, 401);
                assert.strictEqual((await g.get(channelPath, { as: owner, method: 'PUT', headers: { 'sec-fetch-site': 'same-origin' }, json: { ...request, steps: ['picture', 'thread', 'wiki'] } })).status, 422);
                const made = await g.get(channelPath, { as: owner, method: 'PUT', headers: { 'sec-fetch-site': 'same-origin' }, json: request });
                assert.strictEqual(made.status, 200, made.text);
                assert.deepStrictEqual(made.json().steps.map((step) => step.id), request.steps);
                const publicQuest = await g.get(`/api/v1/channels/${owner.subject}/quest`);
                assert.strictEqual(publicQuest.status, 200);
                assert.strictEqual(publicQuest.json().title, request.title);
            } finally { await g.close(); }
        });
        await check('one setup task event cannot finish a different task', async () => {
            const task = BASE_TYPES.find((step) => step.id === 'setup-slot');
            const chosen = { date: '2026-11-08', title: 'Set up', story: '', source: 'rotation', steps: [task] };
            const base = { event_type: 'live.setup.task_completed', timestamp: '2026-11-08T18:00:00Z',
                payload: { user: { type: 'user', id: user.subject } } };
            await t.ctx.daily.recordEvent(t.ctx.s.db, { ...base, event_id: 'evt_setup_method', payload: { ...base.payload, task: 'method' } });
            assert.strictEqual((await t.ctx.daily.progress(user.subject, chosen.date, chosen)).steps[0].done, false);
            await t.ctx.daily.recordEvent(t.ctx.s.db, { ...base, event_id: 'evt_setup_slot', payload: { ...base.payload, task: 'slot' } });
            assert.strictEqual((await t.ctx.daily.progress(user.subject, chosen.date, chosen)).steps[0].done, true);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { process.stderr.write(String(err.stack || err) + '\n'); process.exit(1); });
