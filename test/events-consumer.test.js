'use strict';
/**
 * POST /internal/events (server/events-consumer.js): the six things that matter about how the quest log moves.
 *
 *   - a delivery that is not signed correctly, comes through a proxy, or arrives with no secret configured is
 *     refused before it touches anything;
 *   - the same event twice is the same event once (the openvibe-sdk inbox), and a completion is not paid twice;
 *   - progress counts to the step's target and then completes the quest, awarding its badge once;
 *   - an event that names nobody Quest may credit (no subject, a guest, a service) changes nothing;
 *   - OpenCoins: off by default (skipped), on it credits through Network's wallet with the completion id as the
 *     idempotency key, the two daily caps stop it, and a failure is recorded and retried.
 *
 * The stand-in Network (test/helpers/mocks.js) serves /internal/identity/resolve and /internal/coins/credit too,
 * checked the way Network checks them: a svc:quest token with the capability, and its own app id.
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { boot, check, done } = require('./helpers/boot');

const SECRET = 'quest-events-secret-0123456789abcdef';
const second = 'quest-events-secret-fedcba9876543210';
const iso = () => new Date().toISOString();

/** A real envelope shape (openvibe-contracts contracts/events/event-envelope.v1.json) for one event type. */
function envelope(eventType, payload, { actor, subject, source = 'live', id } = {}) {
    return {
        event_id: id || ids.newId('event'), event_type: eventType, version: 1, source,
        actor: actor || { type: 'service', id: source }, timestamp: iso(),
        subject: subject || { type: 'thing', id: '1' }, payload,
    };
}
const streamStarted = (subject) => envelope('live.stream.started', {
    stream_id: 7, channel: { username: 'liv', display_name: 'Liv', url: 'https://openvibe.live/@liv', subject: { type: 'user', id: subject } },
    title: 'A stream', category: null, protocol: 'webrtc', is_nsfw: false, started_at: iso(),
}, { actor: { type: 'user', id: subject }, subject: { type: 'stream', id: '7' } });
const chatMessage = (user_subject) => envelope('chat.room.message.created', {
    message_id: 12, room: { id: 'room_1', slug: 'general', name: 'General' }, text: 'hello', created_at: iso(),
    user_subject, username: 'liv', display_name: 'Liv',
}, { source: 'chat', actor: user_subject ? { type: 'user', id: user_subject } : { type: 'service', id: 'chat' } });
/** live.setup.task_completed (Contracts 0.190.0): one task of Live's go-live setup list, done for the first time. */
const setupTask = (subject, task, done = 1) => envelope('live.setup.task_completed', {
    task, user: { type: 'user', id: subject }, title: `Task ${task}`, group: 'Stream', completed_at: iso(), done, total: 18,
}, { actor: { type: 'user', id: subject }, subject: { type: 'user', id: subject } });
const followCreated = (follower) => envelope('network.follow.created', {
    follower, target_type: 'channel', target_id: 'usr_' + '0'.repeat(26), revision: 1,
}, { source: 'network', actor: { type: 'user', id: follower } });

/** One signed delivery, as OpenVibe.Events posts it. */
function deliver(t, event, { secret = SECRET, headers = {}, rawBody } = {}) {
    const raw = rawBody || JSON.stringify({ event, seq: 1 });
    return t.get('/internal/events', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(raw, secret), ...headers } });
}
const rows = async (t, sql, params) => t.ctx.s.db.many(sql, params);
const completions = (t, subject) => rows(t, 'SELECT * FROM quest_completions WHERE subject = $1 ORDER BY completed_at, id', [subject]);
const badges = (t, subject) => rows(t, 'SELECT * FROM quest_badges WHERE subject = $1', [subject]);
const progressOf = async (t, subject, questId) => (await rows(t, 'SELECT step, count FROM quest_progress WHERE subject = $1 AND quest_id = $2 ORDER BY step', [subject, questId])).map((r) => Number(r.count));

(async () => {
    // ── Without a secret ─────────────────────────────────────
    await check('with QUEST_EVENTS_SECRET unset the consumer is off (503) and nothing is written', async () => {
        const t = await boot();
        try {
            const u = t.network.addUser('liv');
            const r = await deliver(t, streamStarted(u.subject));
            assert.strictEqual(r.status, 503);
            assert.strictEqual(r.json().code, 'quest.events_disabled');
            assert.strictEqual((await completions(t, u.subject)).length, 0);
        } finally { await t.close(); }
    });

    const t = await boot({ env: { QUEST_EVENTS_SECRET: `${SECRET},${second}` } });
    const liv = t.network.addUser('liv');
    const sam = t.network.addUser('sam');

    try {
        await check('a delivery with no signature, a wrong signature or a tampered body is refused 401', async () => {
            const event = streamStarted(liv.subject);
            const raw = JSON.stringify({ event, seq: 1 });
            const unsigned = await t.get('/internal/events', { method: 'POST', body: raw, headers: { 'content-type': 'application/json' } });
            assert.strictEqual(unsigned.status, 401);
            assert.strictEqual(unsigned.json().code, 'quest.bad_signature');
            const wrong = await deliver(t, event, { secret: 'a-different-secret-of-32-characters!' });
            assert.strictEqual(wrong.status, 401);
            const tampered = await t.get('/internal/events', { method: 'POST', body: `${raw} `, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(raw, SECRET) } });
            assert.strictEqual(tampered.status, 401);
            assert.strictEqual((await progressOf(t, liv.subject, 'go-live')).length, 0, 'nothing was applied');
        });

        await check('a delivery that came through a proxy (a forwarding header) is refused 403', async () => {
            const r = await deliver(t, streamStarted(liv.subject), { headers: { 'x-forwarded-for': '203.0.113.9' } });
            assert.strictEqual(r.status, 403);
            assert.strictEqual(r.json().code, 'quest.internal_only');
        });

        await check('a rotated secret signs too, and a body that is not a delivery is refused 400', async () => {
            const rotated = await deliver(t, streamStarted(liv.subject), { secret: second });
            assert.strictEqual(rotated.status, 200);
            assert.strictEqual(rotated.json().outcome, 'completed');
            // A signed body that is not a delivery at all never gets past the signature check.
            const noEvent = JSON.stringify({ seq: 1 });
            const notADelivery = await t.get('/internal/events', { method: 'POST', body: noEvent, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(noEvent, SECRET) } });
            assert.strictEqual(notADelivery.status, 401);
            // A signed delivery whose envelope is malformed (no evt_ id, no type) is refused 400, not applied.
            const broken = JSON.stringify({ event: { event_id: 'nope', event_type: '' }, seq: 1 });
            const malformed = await t.get('/internal/events', { method: 'POST', body: broken, headers: { 'content-type': 'application/json', ...signDeliveryHeaders(broken, SECRET) } });
            assert.strictEqual(malformed.status, 400);
            assert.strictEqual(malformed.json().code, 'quest.bad_delivery');
        });

        await check('the same event twice: the second is duplicate:true and changes nothing', async () => {
            const event = followCreated(sam.subject);
            const first = await deliver(t, event);
            const again = await deliver(t, event);
            assert.strictEqual(first.status, 200);
            assert.strictEqual(first.json().duplicate, false);
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().duplicate, true);
            assert.strictEqual(again.json().outcome, null);
            assert.deepStrictEqual(await progressOf(t, sam.subject, 'follow-someone'), [1]);
            assert.strictEqual((await completions(t, sam.subject)).length, 1, 'one completion, not two');
            assert.strictEqual((await badges(t, sam.subject)).length, 1);
        });

        await check('progress counts to the step target, then the quest completes and its badge is awarded once', async () => {
            const u = t.network.addUser('three-streams');
            // The first stream completes 'go live once' on its own; the third completes 'stream three times'.
            assert.strictEqual((await deliver(t, streamStarted(u.subject))).json().outcome, 'completed');
            assert.strictEqual((await deliver(t, streamStarted(u.subject))).json().outcome, 'progress');
            assert.deepStrictEqual(await progressOf(t, u.subject, 'stream-three-times'), [2]);
            const third = await deliver(t, streamStarted(u.subject));
            assert.strictEqual(third.json().outcome, 'completed');
            assert.deepStrictEqual(await progressOf(t, u.subject, 'stream-three-times'), [3]);
            const done = await completions(t, u.subject);
            assert.ok(done.some((c) => c.quest_id === 'stream-three-times'), 'stream-three-times completed');
            // The first stream also completed 'go live once': two quests, one event.
            assert.ok(done.some((c) => c.quest_id === 'go-live'), 'go-live completed by the same first stream');
            const earned = await badges(t, u.subject);
            assert.deepStrictEqual(earned.map((b) => b.badge_id).sort(), ['first-broadcast', 'regular-broadcaster']);
            // A fourth stream raises nothing: the quest is finished and frozen.
            await deliver(t, streamStarted(u.subject));
            assert.strictEqual((await completions(t, u.subject)).length, 2, 'no third completion');
            assert.strictEqual((await badges(t, u.subject)).length, 2, 'no second badge');
            assert.deepStrictEqual(await progressOf(t, u.subject, 'stream-three-times'), [3], 'progress is frozen at the target');
        });

        await check('a Live setup task completes its own quest (step match) and counts toward finishing the whole setup', async () => {
            const SETUP_TASKS = ['slot', 'method', 'restream', 'golive', 'profile', 'offline', 'emote', 'sound', 'goal', 'powerchat', 'panels', 'share', 'mods', 'requests', 'moderation', 'robot', 'aibot', 'paste'];
            const u = t.network.addUser('setter-upper');
            const emote = await deliver(t, setupTask(u.subject, 'emote'));
            assert.strictEqual(emote.json().outcome, 'completed');
            let done = await completions(t, u.subject);
            assert.deepStrictEqual(done.map((c) => c.quest_id), ['live-setup-emote'], 'only the emote quest, not the other sixteen');
            assert.deepStrictEqual(await progressOf(t, u.subject, 'live-setup-sound'), [], 'a step whose match differs is not counted');
            assert.deepStrictEqual(await progressOf(t, u.subject, 'live-setup-complete'), [1], 'the whole-setup quest counts every task');
            // "Go live for the first time" has no quest of its own (the go-live quest pays it) but counts toward the whole setup.
            for (const task of SETUP_TASKS.filter((x) => x !== 'emote')) await deliver(t, setupTask(u.subject, task));
            done = await completions(t, u.subject);
            assert.strictEqual(done.length, 18, '17 task quests and the whole setup');
            assert.ok(done.some((c) => c.quest_id === 'live-setup-complete'));
            assert.ok((await badges(t, u.subject)).some((b) => b.badge_id === 'live-setup-complete'));
            // A setup event without a person in the payload credits nobody, even with a user actor.
            const nobody = envelope('live.setup.task_completed', { task: 'slot', user: null }, { actor: { type: 'user', id: u.subject } });
            assert.strictEqual((await deliver(t, nobody)).json().outcome, 'ignored:subject');
            // The series page shows a signed-in streamer what they have done; the home page folds the series into one card.
            const page = await t.get('/series/live-setup', { as: u });
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /<progress max="18" value="18" role="progressbar"[^>]*>18\/18 quests<\/progress>/);
            assert.ok(page.text.includes('href="/quests/live-setup-emote"'));
            const home = await t.get('/');
            assert.ok(home.text.includes('href="/series/live-setup"'), 'the home page links the series');
            assert.ok(!home.text.includes('href="/quests/live-setup-emote"'), 'and does not list its quests one by one');
            assert.strictEqual((await t.get('/series/nope')).status, 404);
            const quest = await t.get('/quests/live-setup-emote');
            assert.ok(quest.text.includes('<code>task</code> <code>emote</code>'), 'the quest page says which task it counts');
        });

        await check('the Blog, Deals, Run, Inventory and Bot quests: each event credits its person; a service never does', async () => {
            const done = async () => (await completions(t, sam.subject)).map((c) => c.quest_id);
            // A post published by a schedule or a service is nobody's.
            await deliver(t, envelope('blog.post.published', { canonical_url: 'https://openvibe.blog/@sam/hi' }, { source: 'blog', actor: { type: 'service', id: 'blog' } }));
            assert.ok(!(await done()).includes('publish-a-blog-post'));
            await deliver(t, envelope('blog.post.published', { canonical_url: 'https://openvibe.blog/@sam/hi' }, { source: 'blog', actor: { type: 'user', id: sam.subject } }));
            assert.ok((await done()).includes('publish-a-blog-post'));
            await deliver(t, envelope('deals.offer.created', { offer_id: 'off_2' }, { source: 'deals', actor: { type: 'user', id: sam.subject } }));
            assert.ok((await done()).includes('share-a-deal'));
            for (let i = 0; i < 9; i++) await deliver(t, envelope('deals.vote.changed', { offer_id: `off_${i}`, value: 1 }, { source: 'deals', actor: { type: 'user', id: sam.subject } }));
            assert.ok(!(await done()).includes('vote-on-deals'), 'nine votes are not ten');
            await deliver(t, envelope('deals.vote.changed', { offer_id: 'off_9', value: -1 }, { source: 'deals', actor: { type: 'user', id: sam.subject } }));
            assert.ok((await done()).includes('vote-on-deals'));
            await deliver(t, envelope('run.job.succeeded', { job_id: 'job_1', requester: { type: 'app', id: 'app_x' } }, { source: 'run' }));
            assert.ok(!(await done()).includes('run-a-job'), 'an app\'s job is nobody\'s');
            await deliver(t, envelope('run.job.succeeded', { job_id: 'job_2', requester: { type: 'user', id: sam.subject } }, { source: 'run' }));
            assert.ok((await done()).includes('run-a-job'));
            await deliver(t, envelope('inventory.item.equipped', { instance_id: 'i', definition_id: 'd', kind: 'hat', slot: 'hat', owner: sam.subject }, { source: 'inventory' }));
            assert.ok((await done()).includes('wear-an-item'));
            await deliver(t, envelope('bot.robot.online', { robot_id: 'rob_1', device_id: 'dev_1' }, { source: 'bot' }));
            assert.ok(!(await done()).includes('bring-a-robot-online'), 'an event that does not name the owner credits nobody');
            await deliver(t, envelope('bot.robot.online', { robot_id: 'rob_1', device_id: 'dev_1', owner: sam.subject }, { source: 'bot' }));
            assert.ok((await done()).includes('bring-a-robot-online'));
            const world = { world: 'wk3j9x0a2bq', title: 'Moon base', url: 'https://openvibe.games/play?world=wk3j9x0a2bq', published_at: iso() };
            await deliver(t, envelope('games.world.published', { ...world, owner: { type: 'service', id: 'games' } }, { source: 'games' }));
            assert.ok(!(await done()).includes('publish-a-world'), 'a world a service published is nobody\'s');
            await deliver(t, envelope('games.world.published', { ...world, owner: { type: 'user', id: sam.subject } }, { source: 'games' }));
            assert.ok((await done()).includes('publish-a-world'));
            const vid = { upload: 'vup_01M516F1WX5NN6C0EMW2V0G8Y9', title: 'Coast', url: 'https://openvibe.video/u/vup_01M516F1WX5NN6C0EMW2V0G8Y9', published_at: iso() };
            await deliver(t, envelope('mediahub.video.published', { ...vid, owner: { type: 'user', id: sam.subject } }, { source: 'media-hub' }));
            assert.ok((await done()).includes('publish-a-video'));
            await deliver(t, envelope('mediahub.picture.uploaded', { picture: 'pic_01M516F1WX5NN6C0EMW2V0G8Y9', owner: { type: 'user', id: sam.subject }, uploaded_at: iso() }, { source: 'media-hub' }));
            assert.ok((await done()).includes('share-a-picture'));
        });

        await check('an event that names nobody creditable is ignored: no subject, a guest, a service, an unknown type', async () => {
            const before = (await completions(t, sam.subject)).length;
            const guest = 'gst_' + '0'.repeat(26);
            for (const event of [
                chatMessage(null),                                     // a private-ish/guest message: no user_subject
                chatMessage(guest),                                    // a guest id is not a usr_ subject
                envelope('chat.room.message.created', { message_id: 3, room: { id: 'r', slug: 'g', name: 'G' }, text: 'x', created_at: iso(), user_subject: null }, { source: 'chat' }),
                envelope('deals.offer.created', { offer_id: 'off_1' }, { source: 'deals', actor: { type: 'service', id: 'deals' } }),   // an imported deal: a service, not a person
                envelope('quest.something.happened', { user_subject: sam.subject }),                                            // not an event Quest counts
            ]) {
                const r = await deliver(t, event);
                assert.strictEqual(r.status, 200);
                assert.match(r.json().outcome, /^ignored:/, r.json().outcome);
                assert.deepStrictEqual(r.json().completed, []);
            }
            assert.strictEqual((await completions(t, sam.subject)).length, before, 'nothing completed');
            assert.deepStrictEqual(await progressOf(t, sam.subject, 'say-hello-in-chat'), [], 'no progress for an ignored event');
        });

        await check('OpenCoins off (the default): the completion is recorded and its coins are skipped', async () => {
            const u = t.network.addUser('coins-off');
            const r = await deliver(t, followCreated(u.subject));
            assert.strictEqual(r.json().outcome, 'completed');
            const [c] = await completions(t, u.subject);
            assert.strictEqual(c.quest_id, 'follow-someone');
            assert.strictEqual(Number(c.coins), 5);
            assert.strictEqual(c.coins_state, 'skipped');
            assert.strictEqual(c.coins_error, null);
            assert.strictEqual(t.network.coinCredits.length, 0, 'the wallet was never called');
            assert.deepStrictEqual(await t.ctx.coins.retryPending(), { tried: 0, credited: 0, skipped: 0, failed: 0 }, 'with coins off there is nothing to retry');
            assert.strictEqual(await t.ctx.coins.start(), null, 'no retry timer while coins are off');
            const page = await t.get('/me', { as: u });
            assert.ok(page.text.includes('OpenCoins rewards start soon'), 'the page says the rewards start soon');
        });

        await check('a signed-in person sees their own progress in the API and on their page, as plain progress bars', async () => {
            const u = t.network.addUser('log');
            await deliver(t, streamStarted(u.subject));
            await deliver(t, chatMessage(u.subject));
            const api = await t.get('/api/v1/me/quests', { as: u });
            assert.strictEqual(api.status, 200);
            const goLive = api.json().quests.find((q) => q.id === 'go-live');
            assert.strictEqual(goLive.state, 'completed');
            assert.strictEqual(goLive.completion.coins.state, 'skipped');
            const settleIn = api.json().quests.find((q) => q.id === 'settle-in');
            assert.strictEqual(settleIn.state, 'in_progress');
            assert.deepStrictEqual(settleIn.progress.map((p) => [p.event_type, p.count]), [['community.thread.created', 0], ['chat.room.message.created', 1]]);
            const page = await t.get('/me', { as: u });
            assert.match(page.text, /<progress max="3" value="1" role="progressbar"[^>]*>1\/3 streams<\/progress>/, 'a real <progress> element with its ARIA values');
            assert.ok(page.text.includes('First Broadcast'), 'the badge it earned');
        });
    } finally { await t.close(); }

    // ── OpenCoins on, with the stand-in Network wallet ───────
    await check('coins on: a completion is credited through the wallet, keyed by the completion id', async () => {
        const c = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, QUEST_COINS: 'on' } });
        try {
            const u = c.network.addUser('paid');
            const r = await deliver(c, streamStarted(u.subject));
            assert.strictEqual(r.json().outcome, 'completed');
            const done = await completions(c, u.subject);
            assert.deepStrictEqual(done.map((x) => x.quest_id), ['go-live'], 'one stream completes one quest; "stream three times" is still at 1 of 3');
            const [goLive] = done;
            assert.strictEqual(goLive.coins_state, 'credited');
            const [credit] = c.network.coinCredits;
            assert.strictEqual(credit.idempotency_key, goLive.id, 'the idempotency key is the completion id');
            assert.strictEqual(credit.app_id, 'quest');
            assert.strictEqual(credit.amount, 10);
            assert.strictEqual(credit.reason, 'quest:go-live');
            assert.strictEqual(credit.ref, 'https://openvibe.quest/quests/go-live');
            assert.strictEqual(c.network.coinBalance(u), 10, 'the wallet holds the OpenCoins');
            assert.strictEqual(Number(goLive.coins_balance), 10);
            assert.ok(goLive.coins_at, 'the credit is timestamped (the day the caps count)');
        } finally { await c.close(); }
    });

    await check('coins on: the per-person daily cap is enforced — over it, skipped with the reason and no credit', async () => {
        const c = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, QUEST_COINS: 'on', QUEST_COINS_DAILY_CAP: '5' } });
        try {
            const u = c.network.addUser('capped');
            await deliver(c, followCreated(u.subject));       // 5 OpenCoins: inside the cap
            await deliver(c, chatMessage(u.subject));         // 5 more: over it
            const all = await completions(c, u.subject);
            const follow = all.find((x) => x.quest_id === 'follow-someone');
            const hello = all.find((x) => x.quest_id === 'say-hello-in-chat');
            assert.strictEqual(follow.coins_state, 'credited');
            assert.strictEqual(hello.coins_state, 'skipped');
            assert.match(hello.coins_error, /daily cap of 5 OpenCoins per person/);
            assert.strictEqual(c.network.coinCredits.length, 1, 'the second quest was not sent to the wallet');
            assert.strictEqual(c.network.coinBalance(u), 5);
            assert.strictEqual((await badges(c, u.subject)).length, 2, 'the badge is still awarded');
        } finally { await c.close(); }
    });

    await check('coins on: the network-wide daily cap is enforced', async () => {
        const c = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, QUEST_COINS: 'on', QUEST_COINS_DAILY_CAP: '100', QUEST_COINS_GLOBAL_DAILY_CAP: '5' } });
        try {
            const a = c.network.addUser('first');
            const b = c.network.addUser('second');
            await deliver(c, followCreated(a.subject));       // 5: exactly the global cap
            await deliver(c, followCreated(b.subject));       // over it, for someone else
            const second = (await completions(c, b.subject))[0];
            assert.strictEqual(second.coins_state, 'skipped');
            assert.match(second.coins_error, /network-wide daily cap of 5 OpenCoins/);
            assert.strictEqual(c.network.coinCredits.length, 1);
        } finally { await c.close(); }
    });

    await check('coins on: a credit failure is recorded with its reason, then retried and credited', async () => {
        const c = await boot({ env: { QUEST_EVENTS_SECRET: SECRET, QUEST_COINS: 'on' } });
        try {
            const u = c.network.addUser('unlucky');
            c.network.setCoinsDown(true);
            const r = await deliver(c, followCreated(u.subject));
            assert.strictEqual(r.status, 200, 'the delivery still succeeds: the completion is committed first');
            let [completion] = await completions(c, u.subject);
            assert.strictEqual(completion.coins_state, 'failed');
            assert.match(completion.coins_error, /Network 503/);
            assert.strictEqual((await badges(c, u.subject)).length, 1, 'the badge is awarded regardless');

            c.network.setCoinsDown(false);
            const out = await c.ctx.coins.retryPending();
            assert.strictEqual(out.credited, 1);
            [completion] = await completions(c, u.subject);
            assert.strictEqual(completion.coins_state, 'credited');
            assert.strictEqual(completion.coins_error, null);
            assert.strictEqual(Number(completion.coins_attempts), 2, 'the first failure and the retry');
            assert.strictEqual(c.network.coinCredits[1].idempotency_key, completion.id);
            assert.strictEqual(c.network.coinBalance(u), 5);

            // Retrying again pays nothing more: there is nothing owed, and the key would not double-credit anyway.
            assert.strictEqual((await c.ctx.coins.retryPending()).tried, 0);
            assert.strictEqual(c.network.coinBalance(u), 5);
        } finally { await c.close(); }
    });
    done();
})().catch((err) => { console.error(err); process.exit(1); });
