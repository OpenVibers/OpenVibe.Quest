'use strict';
/**
 * Quests in OpenVibe.Search (server/search-index.js): a sweep puts every quest in the outbox as one
 * quest.index_document.upserted, exactly the contract, with its /quests/<id> page (which answers) and its badge, and
 * never a promise of OpenCoins; a second sweep sends nothing; a quest the catalog dropped becomes a tombstone.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const catalog = require('../server/quests/catalog');
const { createSearchIndex } = require('../server/search-index');

(async () => {
    const t = await boot();
    const { s, searchIndex } = t.ctx;
    const outbox = async () => (await s.db.many('SELECT envelope FROM event_outbox ORDER BY id')).map((r) => r.envelope);
    const valid = (env) => {
        assert.ok(contracts.validate('events.event-envelope@1', env).valid, 'envelope');
        const p = contracts.validate(env.event_type, env.payload);
        assert.ok(p.valid, `${env.event_type}: ${JSON.stringify(p.errors)}`);
        assert.strictEqual(env.source, 'quest');
        return env;
    };

    try {
        await check('a sweep sends every quest once, as the contract says, and the page it names answers', async () => {
            const quests = catalog.all();
            const res = await searchIndex.sweep();
            assert.deepStrictEqual(res.quest, { seen: quests.length, sent: quests.length, removed: 0, failed: 0 });
            const envs = (await outbox()).map(valid);
            const doc = envs.find((e) => e.payload.id === 'go-live').payload;
            assert.strictEqual(doc.title, 'Go live once');
            assert.strictEqual(doc.canonical_url, 'https://openvibe.quest/quests/go-live');
            assert.match(doc.summary, /First Broadcast badge/);
            assert.match(doc.summary, /Basic Cap hat/);
            assert.deepStrictEqual(doc.facets, { site: 'openvibe.live', badge: 'first-broadcast', item: true });
            assert.ok(!/coin/i.test(JSON.stringify(envs)), 'no document promises OpenCoins');
            assert.strictEqual((await t.get('/quests/go-live')).status, 200);
            assert.strictEqual((await searchIndex.sweep()).quest.sent, 0, 'a second sweep sends nothing');
        });

        await check('a quest the catalog dropped becomes a tombstone, once', async () => {
            const fewer = catalog.all().filter((q) => q.id !== 'go-live');
            const other = createSearchIndex({ config: t.config, s, outbox: searchIndex.outbox, quests: fewer, log: { log() {}, warn() {} } });
            assert.strictEqual((await other.sweep()).quest.removed, 1);
            const env = valid((await outbox()).pop());
            assert.deepStrictEqual([env.event_type, env.payload], ['quest.index_document.deleted', { type: 'quest', id: 'go-live', revision: 2 }]);
            assert.strictEqual((await other.sweep()).quest.removed, 0);
        });
    } finally {
        await done(t);
    }
})();
