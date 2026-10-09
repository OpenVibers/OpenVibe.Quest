'use strict';
/**
 * Item rewards (server/quests/items.js, plan T21): six quests also give one of Live's items, granted in a stand-in
 * OpenVibe.Inventory with Quest's own token (audience openvibe.inventory, inventory.item.grant) after the completion
 * commits: origin earned, the completion id as the idempotency key, the quest as the reason. A refusal is recorded
 * and retried; a completion from before items is granted by the retry; a quest without an item asks nothing;
 * QUEST_ITEMS=off asks nothing at all. The pages and the API name the item.
 */
const assert = require('assert');
const http = require('http');
const { ids } = require('openvibe-contracts');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { boot, check, done } = require('./helpers/boot');

const SECRET = 'quest-events-secret-0123456789abcdef';
const SPARKLE = 'itd_01JZ00000000000000000001S1';
const HEARTS = 'itd_01JZ00000000000000000001H1';
const iso = () => new Date().toISOString();
const chatMessage = (user_subject) => ({
    event_id: ids.newId('event'), event_type: 'chat.room.message.created', version: 1, source: 'chat',
    actor: { type: 'user', id: user_subject }, timestamp: iso(), subject: { type: 'thing', id: '1' },
    payload: { message_id: 12, room: { id: 'room_1', slug: 'general', name: 'General' }, text: 'hello', created_at: iso(), user_subject, username: 'liv', display_name: 'Liv' },
});
const deliver = (t, event) => {
    const raw = JSON.stringify({ event, seq: 1 });
    return t.get('/internal/events', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(raw, SECRET) } });
};
const claims = (auth) => JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'));

function stubInventory() {
    const st = { grants: [], down: false, instances: 0 };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
            const u = new URL(req.url, 'http://x');
            if (u.pathname === '/api/v1/definitions') return json(200, { definitions: [{ id: SPARKLE, issuer: 'service:live', aliases: ['px_sparkle'] }, { id: HEARTS, issuer: 'service:live', aliases: ['px_hearts'] }] });
            if (u.pathname === '/api/v1/grants' && req.method === 'POST') {
                if (st.down) return json(503, { code: 'unavailable' });
                const body = JSON.parse(raw);
                st.grants.push({ body, auth: req.headers.authorization });
                const prior = st.grants.find((g) => g.body.idempotency_key === body.idempotency_key && g.instance);
                const instance = prior ? prior.instance : `inv_01JZ00000000000000000000${String(++st.instances).padStart(2, '0')}`;
                st.grants[st.grants.length - 1].instance = instance;
                return json(prior ? 200 : 201, { instance: { id: instance, definition_id: body.definition_id, owner: body.subject, origin: body.origin, state: 'owned' }, created: !prior });
            }
            return json(404, { code: 'route.not_found' });
        });
    });
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ st, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

(async () => {
    const inv = await stubInventory();
    try {
        await check('saying hello in chat gives the Sparkle: earned, keyed by the completion, with Quest\'s token', async () => {
            const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, OV_INVENTORY_INTERNAL_URL: inv.url } });
            try {
                const u = t.network.addUser('liv');
                const r = await deliver(t, chatMessage(u.subject));
                assert.strictEqual(r.status, 200, r.text);
                const c = (await t.ctx.s.db.many("SELECT * FROM quest_completions WHERE subject = $1 AND quest_id = 'say-hello-in-chat'", [u.subject]))[0];
                assert.ok(c, 'the quest completed');
                const g = inv.st.grants.find((x) => x.body.idempotency_key === c.id);
                assert.deepStrictEqual(g.body, { definition_id: SPARKLE, subject: u.subject, idempotency_key: c.id, origin: 'earned', reason: 'Quest: Say hello in chat' });
                const tok = claims(g.auth);
                assert.deepStrictEqual([tok.sub, tok.aud, tok.cap], ['svc:quest', ['openvibe.inventory'], ['inventory.item.grant']]);
                assert.deepStrictEqual([c.item_state, c.item_instance], ['granted', g.instance]);
                // The person's page says it is in their inventory.
                const me = await t.get('/me', { headers: { cookie: t.signIn(u) } });
                assert.ok(me.text.includes('Sparkle') && me.text.includes('your inventory'), 'the /me page names the item');
            } finally { await t.close(); }
        });

        await check('a refused grant is recorded and retried; a completion from before items is granted by the retry; no item, no call', async () => {
            const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, OV_INVENTORY_INTERNAL_URL: inv.url } });
            try {
                const u = t.network.addUser('ana');
                inv.st.down = true;
                await deliver(t, chatMessage(u.subject));
                let c = (await t.ctx.s.db.many("SELECT * FROM quest_completions WHERE subject = $1 AND quest_id = 'say-hello-in-chat'", [u.subject]))[0];
                assert.strictEqual(c.item_state, 'failed');
                assert.match(c.item_error, /Inventory 503/);
                inv.st.down = false;
                // A completion recorded before this release: item_state NULL.
                const old = 'qcp_01JZ0000000000000000000012';
                await t.ctx.s.db.exec("INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state) VALUES ($1, $2, 'follow-someone', $3, 5, 'skipped')", [old, u.subject, iso()]);
                const before = inv.st.grants.length;
                const out = await t.ctx.items.retryPending();
                assert.deepStrictEqual(out, { tried: 2, granted: 2, failed: 0 });
                c = (await t.ctx.s.db.many("SELECT * FROM quest_completions WHERE subject = $1 AND quest_id = 'say-hello-in-chat'", [u.subject]))[0];
                assert.strictEqual(c.item_state, 'granted');
                const hearts = inv.st.grants.slice(before).find((g) => g.body.idempotency_key === old);
                assert.strictEqual(hearts.body.definition_id, HEARTS, 'the earlier finisher gets their Hearts');
                assert.deepStrictEqual(await t.ctx.items.retryPending(), { tried: 0, granted: 0, failed: 0 }, 'nothing owed now');
                // A quest that gives no item is never asked about.
                const none = 'qcp_01JZ0000000000000000000034';
                await t.ctx.s.db.exec("INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state) VALUES ($1, $2, 'reply-in-a-thread', $3, 5, 'skipped')", [none, u.subject, iso()]);
                assert.deepStrictEqual(await t.ctx.items.retryPending(), { tried: 0, granted: 0, failed: 0 });
            } finally { await t.close(); }
        });

        await check('QUEST_ITEMS=off: nothing is granted, nothing retried, no timer', async () => {
            const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, OV_INVENTORY_INTERNAL_URL: inv.url, QUEST_ITEMS: 'off' } });
            try {
                const u = t.network.addUser('off');
                const before = inv.st.grants.length;
                await deliver(t, chatMessage(u.subject));
                assert.strictEqual(inv.st.grants.length, before);
                assert.deepStrictEqual(await t.ctx.items.retryPending(), { tried: 0, granted: 0, failed: 0 });
                assert.strictEqual(t.ctx.items.start(), null);
            } finally { await t.close(); }
        });

        await check('the quest pages and the API name the item', async () => {
            const t = await boot({ env: { OV_INVENTORY_INTERNAL_URL: inv.url } });
            try {
                const page = await t.get('/quests/say-hello-in-chat');
                assert.ok(page.text.includes('class="reward-item"') && page.text.includes('Sparkle'), 'the reward chip');
                const api = (await t.get('/api/v1/quests')).json();
                const q = (api.quests || api).find((x) => x.id === 'say-hello-in-chat');
                assert.deepStrictEqual(q.reward.item, { issuer: 'service:live', alias: 'px_sparkle', name: 'Sparkle', kind: 'Particle effect' });
                const none = (api.quests || api).find((x) => x.id === 'reply-in-a-thread');
                assert.strictEqual(none.reward.item, undefined);
            } finally { await t.close(); }
        });
    } finally {
        inv.close();
    }
    done();
})();
