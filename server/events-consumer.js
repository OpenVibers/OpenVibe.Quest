'use strict';

/**
 * OpenVibe.Events → Quest: POST /internal/events, the endpoint of this service's Events subscriptions
 * (consumer `quest`). The quest log moves because the sites say what really happened — never because a page was
 * loaded or a button was pressed here:
 *
 *   live.stream.started         a stream went live on OpenVibe.Live        (../../quests/catalog.js 'go live once',
 *                                                                           'stream three times')
 *   network.follow.created      somebody followed a channel                ('follow someone')
 *   community.thread.created    a forum thread was started                 ('start a forum thread', 'settle in')
 *   community.post.created      a reply was posted                         ('reply in a thread')
 *   community.comment.created   a comment was left                         ('comment on a post')
 *   space.thread.created        a thread was started in a Space            ('start a Space thread')
 *   chat.room.message.created   a message was posted in a public room      ('say hello in chat', 'settle in')
 *   wiki.revision.created       a wiki page got a new revision             ('improve a wiki page')
 *   games.player.joined         a character entered a world                ('play a game')
 *   tools.job.created           a tool job was accepted                    ('use a tool')
 *
 * Which field carries the person, and what is ignored, is ./quests/apply.js.
 *
 * Exactly once: the openvibe-sdk inbox claims (consumer, event_id) in the same transaction as the writes. A
 * replay of the same event is answered 200 with duplicate:true and changes nothing. Signature v2 only
 * (parseDelivery requireV2) under QUEST_EVENTS_SECRET (comma-separated for rotation, 32+ characters each); unset
 * = 503. Loopback only: a request that carries a forwarding header came through nginx and is refused.
 */
const express = require('express');
const { http, serviceAuth } = require('openvibe-contracts');
const { parseDelivery, createPgInbox } = require('openvibe-sdk/events');
const catalog = require('./quests/catalog');
const { apply } = require('./quests/apply');

const CONSUMER = 'quest';
const TOPICS = catalog.EVENT_TYPES;
const EVENT_ID_RE = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;

function createEventsConsumer({ db, s, secrets = [], coins = null, now = () => Date.now(), log = console }) {
    const keys = (secrets || []).filter((x) => typeof x === 'string' && x.length >= 32);
    // Receipts (quest_event_inbox) are in migrations/0002_quest.sql.
    const inbox = createPgInbox(db, { table: 'quest_event_inbox', now });
    const stats = { received: 0, applied: 0, duplicates: 0, ignored: 0, completed: 0, refused: 0, failed: 0, last_at: null };
    const router = express.Router();

    router.post('/', express.raw({ type: () => true, limit: '256kb' }), async (req, res) => {
        const ctx = http.requestContext(req.headers);
        const problem = (status, code, detail) => http.sendProblem(res, status, code, { detail, ctx });
        if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip']) return problem(403, 'quest.internal_only', 'internal route');
        if (!keys.length) return problem(503, 'quest.events_disabled', 'QUEST_EVENTS_SECRET is not set');
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        let delivery = null;
        for (const secret of keys) { delivery = parseDelivery(raw, req.headers, secret, { requireV2: true, now: now() }); if (delivery) break; }
        if (!delivery) { stats.refused++; return problem(401, 'quest.bad_signature', 'X-OpenVibe-Signature-V2 does not verify or is outside the replay window'); }
        const event = delivery.event;
        if (!event || !EVENT_ID_RE.test(String(event.event_id || '')) || typeof event.event_type !== 'string') { stats.refused++; return problem(400, 'quest.bad_delivery', 'body must be { event: <envelope>, seq }'); }
        stats.received++; stats.last_at = new Date(now()).toISOString();

        let outcome;
        try {
            const r = await inbox.once(CONSUMER, event.event_id, (t) => apply(t, event, { at: new Date(now()).toISOString(), newId: s.newId }));
            if (r.duplicate) { stats.duplicates++; return res.json({ event_id: event.event_id, duplicate: true, outcome: null }); }
            outcome = r.result;
        } catch (err) {
            stats.failed++;
            log.error(`[Events consumer] ${event.event_id} (${event.event_type}) failed:`, err.message);
            return problem(500, 'quest.event_failed', 'processing failed; it will be retried');
        }

        if (outcome.outcome === 'ignored:subject' || outcome.outcome === 'ignored:type') stats.ignored++;
        else stats.applied++;
        stats.completed += outcome.completed.length;
        // OpenCoins are settled after the transaction: the completion is committed first, so a wallet outage
        // cannot lose (or roll back) a completion the person really earned. A failure is recorded and retried.
        if (coins) for (const completion of outcome.completed) await coins.settle(completion);
        return res.json({
            event_id: event.event_id, duplicate: false, outcome: outcome.outcome,
            completed: outcome.completed.map((c) => c.id),
        });
    });

    return { router, stats: () => ({ ...stats, enabled: keys.length > 0 }) };
}

/** Create any missing subscription for TOPICS at Events (idempotent; retried in the background at boot). */
function startSubscriptions({ config, port, secret, eventsUrl = config.events.url, fetchImpl = globalThis.fetch, log = console }) {
    if (!eventsUrl || !secret || !config.oauth.clientSecret || process.env.QUEST_EVENTS_SUBSCRIBE === '0') return null;
    const base = String(eventsUrl).replace(/\/+$/, '');
    const endpoint = config.events.endpoint || `http://127.0.0.1:${port}/internal/events`;
    const tokens = serviceAuth.createTokenClient({ tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, audience: 'openvibe.events', scope: 'events.subscription.manage', fetchImpl });
    const call = async (method, path, body) => {
        const res = await fetchImpl(`${base}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await tokens.authHeaders()) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok, body: json };
    };
    const attempt = async () => {
        const listed = await call('GET', '/api/v1/subscriptions');
        if (!listed.ok) throw new Error(`listing subscriptions: ${listed.status}`);
        const mine = (listed.body.subscriptions || []).filter((x) => x.endpoint === endpoint);
        for (const topic of TOPICS) {
            if (mine.some((x) => x.topic_pattern === topic)) continue;
            const r = await call('POST', '/api/v1/subscriptions', { topic_pattern: topic, endpoint, secret });
            if (!r.ok && r.status !== 409) throw new Error(`subscribing to ${topic}: ${r.status} ${r.body.code || ''}`);
            if (r.ok) log.log(`[Events consumer] subscription created: ${r.body.id} (${topic} → ${endpoint})`);
        }
    };
    const delays = [0, 10_000, 60_000, 5 * 60_000, 15 * 60_000];
    let i = 0;
    let timer = null;
    let stopped = false;
    const run = () => { timer = null; if (stopped) return; attempt().catch((err) => {
        if (stopped) return;
        if (++i < delays.length) { timer = setTimeout(run, delays[i]); if (timer.unref) timer.unref(); } else log.warn('[Events consumer] subscriptions not created:', err.message);
    }); };
    timer = setTimeout(run, delays[0]); if (timer.unref) timer.unref();
    // Graceful stop: no further attempts (they run again at the next start).
    return { topics: TOPICS, endpoint, stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; } };
}

module.exports = { createEventsConsumer, startSubscriptions, CONSUMER, TOPICS };
