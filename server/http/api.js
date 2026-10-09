'use strict';

/**
 * /api/v1 — OpenVibe.Quest's API.
 *
 *   GET  /ping                            public        liveness: { ok: true, service }
 *   GET  /quests                          public        the catalog, grouped by site, with each reward
 *   GET  /quests/:id                      public        one quest
 *   GET  /me/quests                       a person      your quest log: progress, completions, badges
 *   GET  /profiles/:subject/badges        public        a person's badges — ids, names and dates, nothing else
 *
 * Public reads need no token and are counted per caller (a person is themselves, anyone else by address) with
 * the default read numbers; there is no expensive route yet, so server/http/caller-limits.js BUDGETS stays empty.
 * /me/quests is a person's own log: it needs a signed-in person (a Network token or this site's session) and
 * shows only their own rows. A refusal is an RFC 9457 problem+json with a stable code.
 */
const express = require('express');
const contracts = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const catalog = require('../quests/catalog');
const store = require('../quests/store');

const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;

/** A quest as the wire sees it: what it is, what it counts, what it pays. */
const questWire = (q) => ({
    id: q.id,
    site: q.site,
    site_name: (catalog.SITES[q.site] || {}).name || q.site,
    title: q.title,
    why: q.why,
    steps: q.steps.map((s) => ({ event_type: s.event_type, count: s.count, label: s.label })),
    reward: { badge: { id: q.reward.badge.id, name: q.reward.badge.name }, coins: q.reward.coins, ...(q.reward.item ? { item: { issuer: q.reward.item.issuer, alias: q.reward.item.alias, name: q.reward.item.name, kind: q.reward.item.kind } } : {}) },
    repeatable: q.repeatable,
    url: `/quests/${q.id}`,
});

function createApi(ctx) {
    const { config, s, principal, limits, coins } = ctx;
    const r = asyncRouter();
    const problem = (req, res, status, code, detail) => contracts.http.sendProblem(res, status, code, { detail, ctx: req.ov });
    /** Whether OpenCoins are live, and the caps — the same answer the pages give. */
    const coinsWire = () => ({ enabled: coins.enabled, daily_cap: config.coins.dailyCap, global_daily_cap: config.coins.globalDailyCap });

    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    r.get('/ping', limits.reads('quest.api.read'), (_req, res) => res.json({ ok: true, service: config.service }));

    // ── The catalog (public) ─────────────────────────────────
    r.get('/quests', limits.reads('quest.quests.read'), (_req, res) => res.json({
        sites: catalog.grouped().map((g) => ({
            site: g.site, name: g.name, what: g.what,
            quests: g.quests.map(questWire),
        })),
        quests: catalog.all().map(questWire),
        coins: coinsWire(),
    }));

    r.get('/quests/:id', limits.reads('quest.quests.read'), (req, res) => {
        const quest = catalog.byId(req.params.id);
        if (!quest) return problem(req, res, 404, 'quest.not_found', 'No such quest. GET /api/v1/quests lists them.');
        return res.json(questWire(quest));
    });

    // ── Your own quest log (a person) ────────────────────────
    r.get('/me/quests', limits.reads('quest.me.read'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Sign in at openvibe.quest, or send a person\'s Network token, to read your own quest log.');
        const subject = req.principal.requester.slice('user:'.length);
        const [progress, completions, badges, balance] = await Promise.all([
            store.progressFor(s.db, subject),
            store.completionsFor(s.db, subject),
            store.badgesFor(s.db, subject),
            store.creditedTo(s.db, subject, store.dayOf(s.now())),
        ]);
        const byQuest = new Map();
        for (const row of progress) {
            const list = byQuest.get(row.quest_id) || [];
            list.push({ step: Number(row.step), count: Number(row.count), updated_at: row.updated_at });
            byQuest.set(row.quest_id, list);
        }
        const done = new Map(completions.map((c) => [c.quest_id, c]));
        res.json({
            subject,
            quests: catalog.all().map((q) => {
                const seen = byQuest.get(q.id) || [];
                return {
                    ...questWire(q),
                    progress: q.steps.map((step, i) => ({
                        step: i, event_type: step.event_type, label: step.label, target: step.count,
                        count: Math.min((seen.find((x) => x.step === i) || {}).count || 0, step.count),
                    })),
                    state: done.has(q.id) ? 'completed' : seen.length ? 'in_progress' : 'not_started',
                    completion: done.has(q.id) ? completionWire(done.get(q.id)) : null,
                };
            }),
            completions: completions.map(completionWire),
            badges: badges.map((b) => ({ ...badgeWire(b.badge_id), awarded_at: b.awarded_at, quest_id: b.quest_id })),
            coins: { ...coinsWire(), credited_today: balance },
        });
    });

    // ── Someone's badges (public: ids, names and dates only) ──
    r.get('/profiles/:subject/badges', limits.reads('quest.badge.read'), async (req, res) => {
        const subject = String(req.params.subject || '');
        if (!SUBJECT_RE.test(subject)) return problem(req, res, 404, 'quest.profile.not_found', 'No such person.');
        const rows = await store.badgesOf(s.db, subject);
        res.json({ subject, badges: rows.map((b) => ({ ...badgeWire(b.badge_id), awarded_at: b.awarded_at })) });
    });

    return r;
}

/** A completion as its owner may see it: the quest, when, and what happened to the coins (never a token). */
const completionWire = (c) => ({
    id: c.id, quest_id: c.quest_id, completed_at: c.completed_at,
    coins: { amount: Number(c.coins), state: c.coins_state, error: c.coins_error || null, at: c.coins_at || null },
});

/** A badge as anyone may see it: the id, its catalog name, and nothing about the person. */
const badgeWire = (badgeId) => {
    const badge = catalog.badgeById(badgeId);
    return { id: badgeId, name: badge ? badge.name : badgeId };
};

module.exports = { createApi, questWire, completionWire, badgeWire, SUBJECT_RE };
