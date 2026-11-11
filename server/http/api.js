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
    steps: q.steps.map((s) => ({ event_type: s.event_type, count: s.count, label: s.label, ...(s.match ? { match: { ...s.match } } : {}) })),
    ...(q.series ? { series: q.series } : {}),
    reward: { badge: { id: q.reward.badge.id, name: q.reward.badge.name }, coins: q.reward.coins, ...(q.reward.item ? { item: { issuer: q.reward.item.issuer, alias: q.reward.item.alias, name: q.reward.item.name, kind: q.reward.item.kind } } : {}) },
    repeatable: q.repeatable,
    url: `/quests/${q.id}`,
});

function createApi(ctx) {
    const { config, s, principal, limits, coins } = ctx;
    if (ctx.appQuests) setAppBadgeNames(ctx.appQuests.badgeName);
    const r = asyncRouter();
    const problem = (req, res, status, code, detail) => contracts.http.sendProblem(res, status, code, { detail, ctx: req.ov });
    /** Whether OpenCoins are live, and the caps — the same answer the pages give. */
    const coinsWire = () => ({ enabled: coins.enabled, daily_cap: config.coins.dailyCap, global_daily_cap: config.coins.globalDailyCap });

    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const questOrigins = new Set([...Object.keys(catalog.SITES).map((host) => `https://${host}`), 'https://dns.openvibe.tools']);
    r.use((req, res, next) => {
        const origin = req.get('Origin');
        if (origin && questOrigins.has(origin)) {
            res.set('Access-Control-Allow-Origin', origin).set('Access-Control-Allow-Credentials', 'true').set('Vary', 'Origin');
            if (req.method === 'OPTIONS') res.set('Access-Control-Allow-Methods', 'GET, OPTIONS').set('Access-Control-Allow-Headers', 'Authorization, Content-Type').set('Access-Control-Max-Age', '600');
        }
        next();
    });
    r.options('/quests/today', (_req, res) => res.sendStatus(204));
    r.options('/quests/today/steps/:id', (_req, res) => res.sendStatus(204));
    r.use(principal.middleware);

    r.get('/ping', limits.reads('quest.api.read'), (_req, res) => res.json({ ok: true, service: config.service }));

    // One network-wide quest each UTC date; progress is counted in the person's chosen IANA time zone.
    r.get('/daily', limits.reads('quest.daily.read'), async (_req, res) => res.json(await ctx.daily.publicQuest()));
    r.get('/daily/:date', limits.reads('quest.daily.read'), async (req, res) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return problem(req, res, 400, 'quest.invalid_date', 'Use YYYY-MM-DD.');
        const q = await ctx.daily.publicQuest(req.params.date);
        if (!q) return problem(req, res, 404, 'quest.daily_not_found', 'No quest for that day.');
        return res.json(q);
    });
    r.get('/me/daily', limits.reads('quest.me.read'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        return res.json(await ctx.daily.progress(req.principal.requester.slice(5)));
    });
    r.get('/quests/today', limits.reads('quest.me.read'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        if (!config.guidedTodayEnabled) return problem(req, res, 404, 'quest.guided_today_unavailable', 'Guided daily quests are not enabled.');
        return res.json(await ctx.daily.today(req.principal.requester.slice(5)));
    });
    r.get('/me/daily/ai-text', limits.reads('quest.me.read'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        return res.json(await ctx.daily.aiPreference(req.principal.requester.slice(5)));
    });
    r.put('/me/daily/ai-text', limits.budget('quest.me.write'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        if (req.principal.viaSession && !require('./principal').sameOrigin(req, config.baseUrl)) return problem(req, res, 403, 'request.cross_site', 'Use the same origin.');
        if (req.body?.text_version !== 'quest-ai-text-1') return problem(req, res, 422, 'quest.stale_text', 'Review the current AI wording choice.');
        const pref = await ctx.daily.setAiPreference(req.principal.requester.slice(5), req.body?.enabled, req.body?.language);
        if (!pref) return problem(req, res, 422, 'quest.invalid', 'Choose on or off and a language tag.');
        return res.json(pref);
    });
    r.get('/quests/today/steps/:id', limits.reads('quest.me.read'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        if (!config.guidedTodayEnabled) return problem(req, res, 404, 'quest.guided_today_unavailable', 'Guided daily quests are not enabled.');
        const answer = await ctx.daily.resolveStep(req.principal.requester.slice(5), req.params.id);
        if (!answer) return problem(req, res, 404, 'quest.step_not_found', 'No guided step with that id today.');
        return res.json(answer);
    });
    r.post('/quests/today/steps/:id/done', limits.budget('quest.me.write'), async (req, res) => {
        if (req.principal.kind !== 'app' || !req.principal.requester.startsWith('service:'))
            return problem(req, res, 403, 'quest.site_required', 'Only the service that owns this step can report it.');
        if (!config.guidedTodayEnabled) return problem(req, res, 404, 'quest.guided_today_unavailable', 'Guided daily quests are not enabled.');
        const answer = await ctx.daily.reportStep(req.body?.subject, req.params.id, req.body?.event_id, req.principal.requester);
        if (!answer) return problem(req, res, 403, 'quest.step_not_owned', 'This service cannot report that step or the report is invalid.');
        return res.json(answer);
    });
    r.put('/me/channel-quest', limits.budget('quest.me.write'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        if (!config.guidedTodayEnabled) return problem(req, res, 404, 'quest.guided_today_unavailable', 'Guided daily quests are not enabled.');
        if (req.principal.viaSession && !require('./principal').sameOrigin(req, config.baseUrl)) return problem(req, res, 403, 'request.cross_site', 'Use the same origin.');
        const quest = await ctx.daily.putChannelQuest(req.principal.requester.slice(5), req.body);
        if (!quest) return problem(req, res, 422, 'quest.invalid', 'Choose three guided catalogue steps on different sites and a title under 80 characters.');
        return res.json(quest);
    });
    r.get('/channels/:subject/quest', limits.reads('quest.quests.read'), async (req, res) => {
        if (!config.guidedTodayEnabled) return problem(req, res, 404, 'quest.guided_today_unavailable', 'Guided daily quests are not enabled.');
        if (!/^usr_[0-9A-HJKMNP-TV-Z]{26}$/.test(req.params.subject)) return problem(req, res, 404, 'quest.not_found', 'No channel quest.');
        const quest = await ctx.daily.channelQuest(req.params.subject);
        if (!quest) return problem(req, res, 404, 'quest.not_found', 'No channel quest.');
        return res.json(quest);
    });
    r.put('/me/daily/time-zone', limits.budget('quest.me.write'), async (req, res) => {
        if (req.principal.kind !== 'user') return problem(req, res, 401, 'token.required', 'Send a person\'s Network token.');
        if (req.principal.viaSession && !require('./principal').sameOrigin(req, config.baseUrl)) return problem(req, res, 403, 'request.cross_site', 'Use the same origin.');
        if (!require('../quests/daily').validZone(req.body && req.body.time_zone)) return problem(req, res, 422, 'quest.invalid_time_zone', 'Use an IANA time zone.');
        const subject = req.principal.requester.slice(5);
        await ctx.daily.setZone(subject, req.body.time_zone);
        return res.json({ time_zone: req.body.time_zone });
    });
    r.get('/step-types', limits.reads('quest.step_type.read'), async (_req, res) => res.json({ step_types: await ctx.daily.allTypes() }));

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

    // ── App quests (developer apps, contracts 0.193.0: quest.app_quest.manage) ──
    // Only an app token with a project: a person, an agent or a service never defines an app's quests.
    const appOnly = (req, res, next) => {
        const p = req.principal;
        if (p.kind !== 'app' || !String(p.requester || '').startsWith('app:') || !p.project) {
            return problem(req, res, p.kind === 'anonymous' ? 401 : 403, 'quest.app_only', 'App quests are defined by a developer app: send its app token (a project, audience openvibe.quest, quest.app_quest.manage).');
        }
        return next();
    };
    const manage = principal.requireCapability('quest.app_quest.manage');
    r.post('/step-types', limits.budget('quest.step_type.write'), appOnly, principal.requireCapability('quest.steps.contribute'), async (req, res) => {
        const row = await ctx.daily.contribute(req.principal.project, req.body);
        if (row.error) return problem(req, res, 422, 'quest.invalid_step_type', 'Use a known event topic, its site and a secure link on that site.');
        if (row.project_id !== req.principal.project) return problem(req, res, 409, 'quest.step_type_exists', 'That id belongs to another app.');
        return res.status(202).json(row);
    });
    r.post('/step-types/:id/review', limits.budget('quest.step_type.review'), principal.requireCapability('quest.steps.review'), async (req, res) => {
        if (req.principal.kind !== 'app' || !String(req.principal.requester).startsWith('service:')) return problem(req, res, 403, 'quest.staff_only', 'Staff review uses a service token.');
        const row = await ctx.daily.review(req.params.id, req.body && req.body.status);
        if (!row) return problem(req, res, 404, 'quest.step_type_not_found', 'No step type with that id or review state.');
        return res.json(row);
    });
    r.get('/app-quests', limits.reads('quest.app_quest.read'), appOnly, manage, async (req, res) => {
        const rows = await ctx.appQuests.listForProject(req.principal.project);
        res.json({ project_id: req.principal.project, max: ctx.appQuests.MAX_PER_PROJECT, quests: await Promise.all(rows.map((row) => ctx.appQuests.wire(row))) });
    });
    r.put('/app-quests/:slug', limits.budget('quest.app_quest.write'), appOnly, manage, async (req, res) => {
        const out = await ctx.appQuests.put(req.principal, req.params.slug, req.body);
        if (out.code) return problem(req, res, out.status, out.code, out.detail);
        res.status(out.status).json(await ctx.appQuests.wire(out.row));
    });
    r.delete('/app-quests/:slug', limits.budget('quest.app_quest.write'), appOnly, manage, async (req, res) => {
        const row = await ctx.appQuests.retire(req.principal.project, req.params.slug);
        if (!row) return problem(req, res, 404, 'quest.not_found', 'This project has no app quest with that slug.');
        res.json(await ctx.appQuests.wire(row));
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
    // Network applies public-profile and per-field visibility before requesting this private aggregate.
    r.get('/profiles/:subject/streak', limits.reads('quest.badge.read'), async (req, res) => {
        if (req.principal.kind !== 'app' || req.principal.requester !== 'service:network' || req.principal.claims.env === 'sandbox' || !Array.isArray(req.principal.claims.cap) || !req.principal.claims.cap.includes('quest.badge.read')) {
            return problem(req, res, 403, 'quest.network_only', 'Only Network may read the card aggregate.');
        }
        if (!contracts.ids.isSubjectId('user', req.params.subject)) return problem(req, res, 400, 'quest.invalid_subject', 'Use a user subject.');
        res.json({ streak: await ctx.daily.streakOf(req.params.subject) });
    });

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

/**
 * A badge as anyone may see it: the id, its catalog name, the site whose quest awards it, and its picture (a glyph name
 * from openvibe-shared/glyphs: what it was earned for), and nothing about the person.
 */
let appBadgeName = () => null;
/** server/app.js points this at the app quests' badge names. */
const setAppBadgeNames = (fn) => { appBadgeName = typeof fn === 'function' ? fn : () => null; };
const badgeWire = (badgeId) => {
    const badge = catalog.badgeById(badgeId);
    return { id: badgeId, name: badge ? badge.name : (appBadgeName(badgeId) || badgeId), ...(badge && badge.site ? { site: badge.site } : {}), ...(badge && badge.icon ? { icon: badge.icon } : {}) };
};

module.exports = { createApi, questWire, completionWire, badgeWire, setAppBadgeNames, SUBJECT_RE };
