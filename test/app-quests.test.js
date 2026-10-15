'use strict';
/**
 * App quests (contracts 0.193.0, quest.app_quest.manage; server/quests/app-quests.js):
 *   - only a developer app token with a project and the capability defines them; a person, a service or an app without
 *     the capability cannot;
 *   - a step may count only the project's own events (app.<project_key>.<name>), and the body is quest.app-quest-request@1;
 *   - a production quest subscribes Quest to app.<project_key>.* and counts the app's events whose actor is a person;
 *     the reward is a badge, never OpenCoins; a sandbox quest is listed to its app alone and counts nothing;
 *   - at most 20 per project; a retired quest stops counting and keeps its badges; the public page and the badge name.
 */
const assert = require('assert');
const crypto = require('crypto');
const { ids, serviceAuth } = require('openvibe-contracts');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { boot, check, done } = require('./helpers/boot');

const SECRET = 'quest-events-secret-0123456789abcdef';
const ULID = () => ids.newId('user').slice(4);

(async () => {
    const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET } });
    const subscribed = [];
    t.ctx.appQuests.setSubscriber(async (topic) => { subscribed.push(topic); });
    const projectId = `prj_${ULID()}`;
    const key = `p${projectId.slice(4).toLowerCase()}`;
    const appId = `app_${ULID()}`;
    const token = ({ env = 'production', cap = ['quest.app_quest.manage'], project = projectId, sub = `app:${appId}` } = {}) => {
        const now = Math.floor(Date.now() / 1000);
        return serviceAuth.signServiceToken({ iss: t.network.url, sub, actor_type: 'app', aud: ['openvibe.quest'], cap, ns: [project], project_id: project, env, iat: now, exp: now + 300, jti: `tok_${crypto.randomBytes(6).toString('hex')}` }, t.network.privatePem);
    };
    const put = (slug, body, tok = token()) => t.get(`/api/v1/app-quests/${slug}`, { method: 'PUT', json: body, headers: { authorization: `Bearer ${tok}` } });
    const QUEST = { title: 'Collector', why: 'Find five gems.', steps: [{ event_type: `app.${key}.gem.found`, count: 5, label: 'Find a gem' }], badge: { name: 'Gem Collector' }, url: 'https://example.com/play' };
    const deliver = (event) => {
        const raw = JSON.stringify({ event, seq: 1 });
        return t.get('/internal/events', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(raw, SECRET) } });
    };
    const appEvent = (type, actor) => ({ event_id: ids.newId('event'), event_type: type, version: 1, source: `app-${appId.slice(4).toLowerCase()}`, actor, timestamp: new Date().toISOString(), subject: { type: 'thing', id: '1' }, payload: {} });
    const sam = t.network.addUser('sam');

    try {
        await check('only an app token with a project and the capability defines a quest', async () => {
            assert.strictEqual((await t.get(`/api/v1/app-quests/x`, { method: 'PUT', json: QUEST })).status, 401);
            assert.strictEqual((await t.get(`/api/v1/app-quests/x`, { method: 'PUT', json: QUEST, headers: { authorization: `Bearer ${t.network.userToken(sam)}` } })).status, 403, 'a person cannot');
            assert.strictEqual((await put('x', QUEST, token({ cap: ['events.app.publish'] }))).status, 403, 'an app without the capability cannot');
            assert.strictEqual((await put('x', QUEST, token({ sub: 'svc:someone' }))).status, 403, 'a service cannot');
        });

        await check('the body is checked; a step may count only this project\'s own events', async () => {
            const foreign = await put('x', { ...QUEST, steps: [{ event_type: `app.p${'0'.repeat(26)}.x`, count: 1, label: 'x' }] });
            assert.strictEqual(foreign.status, 422);
            assert.strictEqual(foreign.json().code, 'quest.foreign_event');
            assert.strictEqual((await put('x', { ...QUEST, coins: 50 })).status, 422, 'no OpenCoins field at all');
            assert.strictEqual((await put('Bad Slug', QUEST)).status, 422);
        });

        await check('a production quest: 201, Quest subscribes to the project\'s events, a person completes it and gets the badge (no coins)', async () => {
            const r = await put('collector', QUEST);
            assert.strictEqual(r.status, 201, r.text);
            const q = r.json();
            assert.deepStrictEqual([q.id, q.env, q.status, q.badge.name, q.completions], [`app.${key}.collector`, 'production', 'active', 'Gem Collector', 0]);
            assert.deepStrictEqual(subscribed, [`app.${key}.*`]);
            assert.strictEqual((await put('collector', { ...QUEST, title: 'Gem Collector' })).status, 200, 'replace');
            // The app acting as itself is nobody; on behalf of a person, it counts.
            assert.match((await deliver(appEvent(`app.${key}.gem.found`, { type: 'app', id: appId }))).json().outcome, /^ignored:/);
            for (let i = 0; i < 5; i++) await deliver(appEvent(`app.${key}.gem.found`, { type: 'user', id: sam.subject }));
            const c = await t.ctx.s.db.many('SELECT * FROM quest_completions WHERE subject = $1 AND quest_id = $2', [sam.subject, q.id]);
            assert.strictEqual(c.length, 1);
            assert.deepStrictEqual([Number(c[0].coins), c[0].coins_state], [0, 'skipped']);
            const badges = (await t.get(`/api/v1/profiles/${sam.subject}/badges`)).json().badges;
            assert.ok(badges.some((b) => b.id === q.id && b.name === 'Gem Collector'), JSON.stringify(badges));
            const page = await t.get(`/apps/quests/${q.id}`);
            assert.ok(page.text.includes('Gem Collector') && page.text.includes('App quests never pay OpenCoins') && page.text.includes('1 person has this badge'));
            assert.ok((await t.get('/')).text.includes(`href="/apps/quests/${q.id}"`), 'listed on the home page');
            assert.strictEqual((await t.get('/api/v1/app-quests', { headers: { authorization: `Bearer ${token()}` } })).json().quests[0].completions, 1);
        });

        await check('a sandbox quest is the app\'s alone: not listed, not counted, no subscription', async () => {
            const before = subscribed.length;
            const r = await put('sandbox-try', { ...QUEST, steps: [{ event_type: `app.${key}.level_completed`, count: 1, label: 'Finish a level' }] }, token({ env: 'sandbox' }));
            assert.strictEqual(r.status, 201);
            assert.strictEqual(r.json().env, 'sandbox');
            assert.strictEqual(subscribed.length, before);
            assert.strictEqual((await t.get(`/apps/quests/${r.json().id}`)).status, 404);
            await deliver(appEvent(`app.${key}.level_completed`, { type: 'user', id: sam.subject }));
            assert.strictEqual((await t.ctx.s.db.many('SELECT * FROM quest_completions WHERE quest_id = $1', [r.json().id])).length, 0);
        });

        await check('retired: no longer counted or listed, its badges stay; at most 20 a project', async () => {
            const del = await t.get('/api/v1/app-quests/collector', { method: 'DELETE', headers: { authorization: `Bearer ${token()}` } });
            assert.strictEqual(del.json().status, 'retired');
            assert.ok(!(await t.get('/')).text.includes('/apps/quests/'), 'off the home page');
            assert.ok((await t.get(`/api/v1/profiles/${sam.subject}/badges`)).json().badges.some((b) => b.name === 'Gem Collector'), 'the badge stays');
            // Active: the sandbox one and 19 more is 20; the retired one does not count.
            for (let i = 0; i < 19; i++) assert.strictEqual((await put(`q${i}`, QUEST)).status, 201);
            const over = await put('one-too-many', QUEST);
            assert.strictEqual(over.status, 409);
            assert.strictEqual(over.json().code, 'quest.limit');
        });
    } finally { await t.close(); }
    done();
})();
