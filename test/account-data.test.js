'use strict';
/**
 * ADR-033: Quest's part of an account export (progress, completions, badges) and of an account deletion, applied
 * through the service's own /internal/events route with a stand-in Network. Real rows are made through the
 * service's own store (server/quests/store.js), the signed delivery is answered inside server/events-consumer.js by
 * openvibe-sdk/account-data, and the part only ever carries person A's rows. A redelivery erases nothing twice, a
 * bare network.account.deleted delivery is never claimed by quest_event_inbox, and the route refuses a bad
 * signature and a forwarded request.
 */
const assert = require('assert');
const http = require('http');
const { boot, check, done } = require('./helpers/boot');
const { createNetworkSender } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const questStore = require('../server/quests/store');

const A = 'usr_01JZ0000000000000000000AAA';
const B = 'usr_01JZ0000000000000000000BBB';
const OLD = 'usr_01JZ0000000000000000000MRG';
const EXP = 'exp_01JZ0000000000000000000EXP';
const DEL = 'del_01JZ0000000000000000000DEX';
// Fixture secrets, built so they never look like a real key to a scanner.
const SECRET = `whsec_${'fixture'.repeat(6)}`;
const WRONG = `whsec_${'mismatch'.repeat(5)}`;

const exportEvent = { event_id: 'evt_01JZ0000000000000000000E01', event_type: 'network.account.export_requested', source: 'network', payload: { export_id: EXP, subject: A } };
const deleteEvent = { event_id: 'evt_01JZ0000000000000000000D01', event_type: 'network.account.deleted', source: 'network', payload: { deletion_id: DEL, subject: A, aliases: [OLD] } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

/** A stand-in for Network's internal routes: the token endpoint, the export part and the deletion confirmation. */
async function startNetworkStub({ partStatus = 201, confirmStatus = 201 } = {}) {
    const calls = [];
    const statusOf = (v) => (typeof v === 'function' ? v() : v);
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_quest', token_type: 'Bearer', expires_in: 300, scope: 'openvibe.network' });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw.toString() || 'null') });
            return json(req.url.includes('/parts') ? statusOf(partStatus) : statusOf(confirmStatus), {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

/** Make progress, a completion and a badge for one person, through the store the consumer writes with. */
async function makeRows(t, subject, { questId, badgeId }) {
    const s = t.ctx.s;
    const at = s.iso();
    await questStore.bumpProgress(s.db, { subject, questId, step: 0, target: 1, at });
    await questStore.complete(s.db, { id: s.newId('qcp'), subject, questId, at, coins: 10, coinsState: 'skipped' });
    await questStore.awardBadge(s.db, { subject, badgeId, questId, at });
}

const rowsFor = async (t, table, subject) => Number(await t.ctx.s.db.value(`SELECT count(*)::int FROM ${table} WHERE subject = $1`, [subject]));

(async () => {
    await check('an export part carries only the person\'s progress, completions and badges, and no secret', async () => {
        const stub = await startNetworkStub();
        const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'quest', clientSecret: 'quest-secret' });
        const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET }, accountSend: sender });
        try {
            await makeRows(t, A, { questId: 'go-live', badgeId: 'first-broadcast' });
            await makeRows(t, B, { questId: 'follow-someone', badgeId: 'first-follow' });

            const res = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(exportEvent), SECRET) } });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'exported');

            const part = stub.calls.find((c) => c.url === `/internal/account-exports/${EXP}/parts`);
            assert.ok(part, 'the part was pushed to Network');
            assert.strictEqual(part.auth, 'Bearer tok_quest', 'with this service\'s own token');
            assert.strictEqual(part.body.subject, A);
            assert.deepStrictEqual(part.body.files.map((f) => f.name).sort(), ['badges.json', 'completions.json', 'progress.json']);
            for (const file of part.body.files) {
                assert.strictEqual(file.content.length, 1, `one row for ${file.name}`);
                assert.strictEqual(file.content[0].subject, A, `only A's rows in ${file.name}`);
            }
            assert.strictEqual(part.body.files.find((f) => f.name === 'progress.json').content[0].quest_id, 'go-live');
            assert.strictEqual(part.body.files.find((f) => f.name === 'completions.json').content[0].quest_id, 'go-live');
            assert.strictEqual(part.body.files.find((f) => f.name === 'badges.json').content[0].badge_id, 'first-broadcast');
            assert.ok(!JSON.stringify(part.body).includes(B), 'nobody else\'s rows');
            assert.ok(!JSON.stringify(part.body).includes('follow-someone'), 'no B-only content');
            assert.ok(!JSON.stringify(part.body).includes('first-follow'), 'no B-only badge');
            assert.ok(!/token|secret|password/i.test(JSON.stringify(part.body)), 'no secret is exported');
            // The account topics never pass through the quest inbox: the SDK keeps its own idempotency.
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT count(*)::int FROM quest_event_inbox WHERE event_id = $1', [exportEvent.event_id])), 0, 'the export event is not claimed by quest_event_inbox');
        } finally { await t.close(); await stub.close(); }
    });

    await check('a deletion erases the person and their aliases once, keeps someone else, and confirms with counts', async () => {
        const stub = await startNetworkStub();
        const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'quest', clientSecret: 'quest-secret' });
        const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET }, accountSend: sender });
        try {
            await makeRows(t, A, { questId: 'go-live', badgeId: 'first-broadcast' });
            await makeRows(t, B, { questId: 'follow-someone', badgeId: 'first-follow' });

            const res = await t.get('/internal/events', { method: 'POST', body: bodyOf(deleteEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(deleteEvent), SECRET) } });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'erased');
            for (const table of ['quest_progress', 'quest_completions', 'quest_badges']) {
                assert.strictEqual(await rowsFor(t, table, A), 0, `the person's rows are gone from ${table}`);
                assert.strictEqual(await rowsFor(t, table, B), 1, `someone else's row stays in ${table}`);
            }
            // A bare network.account.deleted is never claimed by the quest inbox.
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT count(*)::int FROM quest_event_inbox WHERE event_id = $1', [deleteEvent.event_id])), 0, 'the deletion is not claimed by quest_event_inbox');

            const confirmation = stub.calls.find((c) => c.url === `/internal/account-deletions/${DEL}/confirmations`);
            assert.ok(confirmation, 'the confirmation was sent');
            assert.deepStrictEqual(confirmation.body.erased, { quest_progress: 1, quest_completions: 1, quest_badges: 1 });
            assert.deepStrictEqual(confirmation.body.retained, {});
            assert.ok(!Number.isNaN(Date.parse(confirmation.body.completed_at)));

            // A redelivery must not erase again: rows written after the deletion stay.
            await makeRows(t, A, { questId: 'use-a-tool', badgeId: 'toolsmith' });
            const again = await t.get('/internal/events', { method: 'POST', body: bodyOf(deleteEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(deleteEvent), SECRET) } });
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().outcome, 'unchanged');
            for (const table of ['quest_progress', 'quest_completions', 'quest_badges']) {
                assert.strictEqual(await rowsFor(t, table, A), 1, `nothing was erased twice in ${table}`);
            }
        } finally { await t.close(); await stub.close(); }
    });

    await check('the internal route refuses a bad signature (401) and a forwarded request (403)', async () => {
        const stub = await startNetworkStub();
        const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'quest', clientSecret: 'quest-secret' });
        const t = await boot({ env: { QUEST_EVENTS_SECRET: SECRET }, accountSend: sender });
        try {
            const bad = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(exportEvent), WRONG) } });
            assert.strictEqual(bad.status, 401);
            assert.strictEqual(bad.json().code, 'quest.bad_signature');

            const forwarded = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...signDeliveryHeaders(bodyOf(exportEvent), SECRET) } });
            assert.strictEqual(forwarded.status, 403);
            assert.strictEqual(forwarded.json().code, 'quest.internal_only');
        } finally { await t.close(); await stub.close(); }
    });

    done();
})();
