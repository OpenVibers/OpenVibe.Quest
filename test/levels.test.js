'use strict';
const assert = require('assert');
const { createLevels } = require('../server/quests/levels');
(async () => {
    const state = new Map(); const sent = new Map(); let down = false;
    const row = { id: 'qcp_probe', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNP1', quest_id: 'follow-someone' };
    const db = {
        exec: async (_sql, [id]) => state.set(id, 'done'),
        many: async () => state.has(row.id) ? [] : [row],
    };
    const fetchImpl = async (url, options) => {
        if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'test-service-token', expires_in: 300 }), { status: 200 });
        if (down) return new Response('{}', { status: 503 });
        const body = JSON.parse(options.body); const duplicate = sent.has(body.idempotency_key);
        if (!duplicate) sent.set(body.idempotency_key, body.amount);
        return new Response(JSON.stringify(duplicate ? { code: 'levels.duplicate' } : { level: 1 }), { status: duplicate ? 409 : 201, headers: { 'content-type': 'application/json' } });
    };
    const levels = createLevels({ config: { networkInternalUrl: 'https://network.example', oauth: { clientId: 'quest', clientSecret: 'test-only' } }, s: { db }, fetchImpl });
    down = true; await levels.retryPending(); assert(!state.has(row.id), 'outage leaves durable pending completion');
    down = false; await levels.retryPending(); assert.equal(sent.get(row.id), 25); assert(state.has(row.id));
    state.clear(); await levels.retryPending(); assert.equal(sent.size, 1, 'crash replay changes XP once'); assert(state.has(row.id), '409 settles the retry');
    await levels.settle({ ...row, id: 'app-row', quest_id: 'app-custom' }); assert.equal(sent.size, 1, 'app events do not mint platform XP');
    console.log('levels: completed quest awards 25 once; outages retry; duplicate refusal settles; app quests excluded');
})().catch(e => { console.error(e); process.exitCode = 1; });
