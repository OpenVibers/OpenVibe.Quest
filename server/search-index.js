'use strict';

/**
 * Quest's quest pages in OpenVibe.Search (openvibe-publishing/search-feed): one search.index-document@1 per quest
 * (/quests/<id>), sent as quest.index_document.upserted|deleted through this service's events outbox. The document is
 * what the page says: the quest's title, why it is worth doing, its steps, the site it happens on and the badge (and
 * item) it gives. Not the OpenCoins: they are off until the reward economics are decided (QUEST_COINS), and Search
 * should never promise them.
 *
 * Quests are this service's own catalog (server/quests/catalog.js), so a sweep a minute after boot and every six
 * hours is enough: a deploy that adds, rewords or drops a quest sends a document, a new revision or a tombstone
 * (quest_index_revisions is the sequencer), and a quiet boot sends nothing.
 */
const { createServiceOutbox } = require('openvibe-sdk/events');
const { createSearchFeed } = require('openvibe-publishing/search-feed');
const catalog = require('./quests/catalog');

const EVENT_TYPES = ['quest.index_document.upserted', 'quest.index_document.deleted'];
const START_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 3_600_000;

/** One quest → what its page says, as search-feed's document description. */
function describe(quest) {
    const site = catalog.SITES[quest.site] || { name: quest.site };
    const steps = quest.steps.map((st) => (st.count > 1 ? `${st.label} (${st.count} times)` : st.label));
    const reward = [`the ${quest.reward.badge.name} badge`, quest.reward.item ? `the ${quest.reward.item.name} ${String(quest.reward.item.kind).toLowerCase()} for your inventory` : '']
        .filter(Boolean).join(' and ');
    return {
        title: quest.title,
        summary: `${quest.why} On ${site.name}; earns ${reward}.`,
        body: [quest.title, quest.why, `Where: ${site.name}`, `Steps: ${steps.join('; ')}`, `Reward: ${reward}`].join('\n'),
        facets: { site: quest.site, badge: quest.reward.badge.id, item: Boolean(quest.reward.item) },
        authorship: { mode: 'human' },
    };
}

function createSearchIndex({ config, s, log = console, outbox = null, quests = catalog.all() }) {
    const out = outbox || createServiceOutbox({
        db: s.db, source: 'quest', eventsUrl: config.events.url || null, networkInternalUrl: config.networkInternalUrl,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, log, eventTypes: EVENT_TYPES,
    });
    const ordered = [...quests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ids = new Set(ordered.map((q) => q.id));
    const feed = createSearchFeed({
        owner: 'quest', db: s.db, outbox: out, baseUrl: config.baseUrl, now: s.now, log,
        types: {
            quest: {
                page: (q) => `/quests/${q.id}`,
                document: describe,
                rows: async (after, limit) => ordered.filter((q) => q.id > after).slice(0, limit),
                exists: async (list) => list.filter((id) => ids.has(id)),
            },
        },
    });
    const timers = [];

    async function sweep() {
        const res = await feed.sweep();
        const q = res.quest;
        if (q.sent || q.removed || q.failed) log.log(`[Search] quests: ${q.sent} sent, ${q.removed} removed, ${q.failed} failed of ${q.seen}`);
        if (out.kick) out.kick().catch(() => {});
        return res;
    }
    const quietly = () => { sweep().catch((err) => log.warn(`[Search] sweep failed: ${(err && err.message) || err}`)); };

    function start() {
        if (timers.length) return false;
        out.start();
        const kick = setTimeout(quietly, START_DELAY_MS);
        if (kick.unref) kick.unref();
        const tick = setInterval(quietly, INTERVAL_MS);
        if (tick.unref) tick.unref();
        timers.push(kick, tick);
        return true;
    }

    function stop() {
        for (const t of timers.splice(0)) { clearTimeout(t); clearInterval(t); }
        out.stop();
    }

    return { feed, outbox: out, describe, sweep, start, stop, status: () => out.status() };
}

module.exports = { createSearchIndex, describe, EVENT_TYPES };
