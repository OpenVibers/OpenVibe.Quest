'use strict';
/**
 * App quests (contracts 0.193.0, capability quest.app_quest.manage): the owner's "moddable in the SDK" for Quest. A
 * developer app defines quests on its own project's events, app.<project_key>.<name>, and Quest counts them like its
 * own quests (progress, completions and badges in the same tables, under the id app.<project_key>.<slug>):
 *
 *   - only the app's own events: every step's type starts with app.<the token's project key>.;
 *   - the person is the event's actor (an app publishing on_behalf_of a user); an app acting as itself is nobody;
 *   - only production counts: OpenVibe.Events never hands sandbox events to a first-party consumer, so a sandbox app may
 *     define quests to try the API, and they are listed to it alone;
 *   - a badge named for the app is the whole reward: app quests never pay OpenCoins;
 *   - at most 20 active per project; a retired quest keeps its completions and badges and is no longer counted or listed.
 *
 * Quest subscribes to app.<project_key>.* at Events when a project's first production quest goes active (and at boot
 * for every project that has one).
 */
const contracts = require('openvibe-contracts');

const MAX_PER_PROJECT = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PROJECT_RE = /^prj_([0-9A-HJKMNP-TV-Z]{26})$/;

/** 'prj_01JAB…' → 'p01jab…' (Events' project key, the middle segment of an app event type). */
function projectKey(projectId) {
    const m = PROJECT_RE.exec(String(projectId || ''));
    return m ? `p${m[1].toLowerCase()}` : null;
}

const parse = (v, d) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return d; } };

/** A row in the catalog's shape, so apply() and the pages treat it like any quest. */
function asQuest(row) {
    return {
        id: row.id, site: null, app: true, project_id: row.project_id, env: row.env, title: row.title, why: row.why || '',
        steps: parse(row.steps, []), url: row.url || null, status: row.status,
        reward: { badge: { id: row.id, name: row.badge_name }, coins: 0 },
        repeatable: false,
    };
}

function createAppQuests({ s, log = console, subscribe: initialSubscribe = null }) {
    const badgeNames = new Map();
    let subscribe = initialSubscribe;
    const iso = () => new Date(s.now()).toISOString();

    async function ensureSubscribed(key) {
        if (!subscribe) return;
        try { await subscribe(`app.${key}.*`); } catch (err) { log.warn(`[Quest] subscribing to app.${key}.* failed: ${err.message}`); }
    }

    return {
        MAX_PER_PROJECT, projectKey, asQuest,
        /** The Events subscription helper (server/index.js sets it once subscriptions start). */
        setSubscriber(fn) { subscribe = typeof fn === 'function' ? fn : null; },

        /** Fill the badge names at boot; subscribe to every project with an active production quest. */
        async load() {
            for (const r of await s.db.many('SELECT id, badge_name FROM app_quests')) badgeNames.set(r.id, r.badge_name);
            for (const r of await s.db.many("SELECT DISTINCT project_key FROM app_quests WHERE env = 'production' AND status = 'active'")) await ensureSubscribed(r.project_key);
        },
        badgeName: (id) => badgeNames.get(String(id)) || null,

        /** Create or replace one quest for the app's project. → { status, row } | { status, code, detail } */
        async put(principal, slug, body) {
            const projectId = principal.project;
            const key = projectKey(projectId);
            if (!key || !String(principal.requester || '').startsWith('app:')) return { status: 403, code: 'quest.app_only', detail: 'Only a developer app token with a project defines app quests.' };
            if (!SLUG_RE.test(String(slug || ''))) return { status: 422, code: 'quest.bad_slug', detail: 'slug: lower-case letters, digits and dashes, at most 48' };
            const v = contracts.validate('quest.app-quest-request@1', body);
            if (!v.valid) return { status: 422, code: 'quest.invalid', detail: `the quest does not match quest.app-quest-request@1: ${JSON.stringify(v.errors).slice(0, 400)}` };
            const foreign = body.steps.find((st) => !st.event_type.startsWith(`app.${key}.`));
            if (foreign) return { status: 422, code: 'quest.foreign_event', detail: `${foreign.event_type} is not one of this project's events (app.${key}.<name>)` };
            const id = `app.${key}.${slug}`;
            const others = Number(await s.db.value("SELECT count(*) FROM app_quests WHERE project_key = $1 AND id <> $2 AND status = 'active'", [key, id])) || 0;
            if (others >= MAX_PER_PROJECT && (body.status || 'active') === 'active') return { status: 409, code: 'quest.limit', detail: `a project has at most ${MAX_PER_PROJECT} active app quests; retire one or reuse a slug` };
            const env = principal.claims && principal.claims.env === 'sandbox' ? 'sandbox' : 'production';
            const at = iso();
            const status = body.status || 'active';
            const existed = await s.db.maybe('SELECT id FROM app_quests WHERE id = $1', [id]);
            await s.db.query(`INSERT INTO app_quests (id, project_id, project_key, app, env, slug, title, why, steps, badge_name, url, status, created_at, updated_at)
                              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $13)
                              ON CONFLICT (id) DO UPDATE SET app = excluded.app, env = excluded.env, title = excluded.title, why = excluded.why,
                                  steps = excluded.steps, badge_name = excluded.badge_name, url = excluded.url, status = excluded.status, updated_at = excluded.updated_at`,
            [id, projectId, key, principal.requester, env, slug, body.title, body.why || null, JSON.stringify(body.steps), body.badge.name, body.url || null, status, at]);
            badgeNames.set(id, body.badge.name);
            if (env === 'production' && status === 'active') await ensureSubscribed(key);
            return { status: existed ? 200 : 201, row: await s.db.maybe('SELECT * FROM app_quests WHERE id = $1', [id]) };
        },

        async listForProject(projectId) {
            return s.db.many('SELECT * FROM app_quests WHERE project_id = $1 ORDER BY created_at', [projectId]);
        },

        /** Retire one (its completions and badges stay). → the row, or null. */
        async retire(projectId, slug) {
            const key = projectKey(projectId);
            if (!key) return null;
            return s.db.maybe("UPDATE app_quests SET status = 'retired', updated_at = $3 WHERE project_key = $1 AND slug = $2 RETURNING *", [key, String(slug), iso()]);
        },

        /** The active production app quests with a step that counts this event (in `db`, the delivery's transaction). */
        async forEvent(db, event) {
            const type = String((event && event.event_type) || '');
            if (!type.startsWith('app.')) return [];
            const rows = await db.many(`SELECT * FROM app_quests WHERE env = 'production' AND status = 'active'
                                          AND project_key = $1 AND steps @> $2::jsonb`, [type.split('.')[1], JSON.stringify([{ event_type: type }])]);
            return rows.map(asQuest);
        },

        /** The public list: active production quests, newest first. */
        async listed(limit = 100) {
            return (await s.db.many("SELECT * FROM app_quests WHERE env = 'production' AND status = 'active' ORDER BY updated_at DESC LIMIT $1", [limit])).map(asQuest);
        },
        async byId(id) {
            const row = await s.db.maybe('SELECT * FROM app_quests WHERE id = $1', [String(id)]);
            return row ? asQuest(row) : null;
        },

        /** quest.app-quest@1 */
        async wire(row) {
            const completions = Number(await s.db.value('SELECT count(*) FROM quest_completions WHERE quest_id = $1', [row.id])) || 0;
            return {
                id: row.id, slug: row.slug, project_id: row.project_id, app: row.app, env: row.env, title: row.title, why: row.why || null,
                steps: parse(row.steps, []), badge: { id: row.id, name: row.badge_name }, url: row.url || null, status: row.status,
                created_at: row.created_at, updated_at: row.updated_at, completions,
            };
        },
    };
}

module.exports = { createAppQuests, projectKey, asQuest, MAX_PER_PROJECT };
