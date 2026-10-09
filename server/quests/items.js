'use strict';

/**
 * Item rewards: granting a completion's item in OpenVibe.Inventory (plan T21).
 *
 * Some quests give one of Live's items (catalog.js reward.item: Live's alias, the name and emoji the pages show).
 * Live is the item's issuer and names Quest a grantor of it (ADR-054 §3 amendment, Contracts 0.123.0), so Quest
 * grants it itself: POST /api/v1/grants with origin `earned`, the completion id (qcp_…) as the idempotency key and
 * the quest as the reason. A retry of a grant that did land answers the same instance, so nobody gets two. Nothing
 * is bought, sold or traded, and an item is never money.
 *
 * Auth: this service's own client credentials (`quest`) through openvibe-contracts' cached token client, for
 * audience openvibe.inventory and inventory.item.grant. Inventory's definition ids are read once by alias
 * (GET /api/v1/definitions?issuer=service:live, public) and kept for an hour.
 *
 * Like OpenCoins, a grant runs after the completion commits: an Inventory outage never holds up a delivery or rolls
 * back a completion. A failure is recorded (item_state 'failed' with a short reason) and the retry timer comes back
 * to it; the timer also picks up completions from before this release (item_state NULL), so everyone who already
 * finished a quest gets its item. QUEST_ITEMS=off turns all of it off.
 */
const { serviceAuth } = require('openvibe-contracts');
const store = require('./store');
const catalog = require('./catalog');

const AUDIENCE = 'openvibe.inventory';
const SCOPES = 'inventory.item.grant';
const TIMEOUT_MS = 5000;
const DEFS_TTL_MS = 60 * 60 * 1000;

function createItems({ config, s, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const enabled = config.items.mode === 'on';
    const base = String(config.items.inventoryUrl || '').replace(/\/+$/, '');
    const networkBase = String(config.networkInternalUrl || '').replace(/\/+$/, '');
    const tokens = serviceAuth.createTokenClient({
        tokenUrl: `${networkBase}/oauth/token`,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: AUDIENCE,
        scope: SCOPES,
        fetchImpl,
    });
    const rewarded = catalog.QUESTS.filter((q) => q.reward && q.reward.item).map((q) => q.id);
    let defs = null;   // { at, byAlias: Map(alias → itd_ id) }
    let timer = null;
    const stats = { granted: 0, failed: 0, attempts: 0, last_at: null };

    async function call(method, path, { body, auth = false } = {}) {
        const headers = { Accept: 'application/json', ...(auth ? await tokens.authHeaders() : {}) };
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(`${base}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            // Inventory's own problem code (inventory.not_issuer, inventory.not_published), never the token.
            const err = new Error(`Inventory ${res.status}${json && json.code ? `: ${json.code}` : ''}`);
            err.status = res.status;
            throw err;
        }
        return json || {};
    }

    /** The itd_ id of one of an issuer's items, by its alias (Live's item id). */
    async function definitionId(issuer, alias) {
        if (!defs || now() - defs.at > DEFS_TTL_MS || !defs.byAlias.has(`${issuer}|${alias}`)) {
            const out = await call('GET', `/definitions?issuer=${encodeURIComponent(issuer)}&limit=500`);
            const byAlias = new Map();
            for (const d of out.definitions || []) for (const a of d.aliases || []) byAlias.set(`${d.issuer}|${a}`, d.id);
            defs = { at: now(), byAlias };
        }
        return defs.byAlias.get(`${issuer}|${alias}`) || null;
    }

    /** Grant one completion's item; → the instance id. Throws with a short, safe reason. */
    async function grant(completion) {
        const quest = catalog.byId(completion.quest_id);
        const item = quest && quest.reward.item;
        if (!item) throw new Error(`no item reward for ${completion.quest_id}`);
        const id = await definitionId(item.issuer, item.alias);
        if (!id) throw new Error(`OpenVibe.Inventory has no ${item.alias} from ${item.issuer}`);
        const out = await call('POST', '/grants', {
            auth: true,
            body: { definition_id: id, subject: completion.subject, idempotency_key: completion.id, origin: 'earned', reason: `Quest: ${quest.title}`.slice(0, 200) },
        });
        return out.instance && out.instance.id;
    }

    /** Decide one completion's item now: grant it, or record the failure for the retry timer. Never throws. */
    async function settle(completion) {
        if (!enabled || !completion) return null;
        const quest = catalog.byId(completion.quest_id);
        if (!quest || !quest.reward.item) return null;
        if (completion.item_state === 'granted') return completion;
        stats.attempts++;
        try {
            const instance = await grant(completion);
            stats.granted++; stats.last_at = new Date(now()).toISOString();
            return store.setItem(s.db, completion.id, { state: 'granted', instance, error: null, at: new Date(now()).toISOString(), attempts: 1 });
        } catch (err) {
            stats.failed++;
            const message = String((err && err.message) || err).slice(0, 200);
            log.warn(`[Items] ${completion.id} (${completion.quest_id}) not granted: ${message}`);
            return store.setItem(s.db, completion.id, { state: 'failed', error: message, attempts: 1 });
        }
    }

    /** Come back to every completion whose item is still owed: a failure, or a completion from before items. */
    async function retryPending({ limit = 50 } = {}) {
        if (!enabled) return { tried: 0, granted: 0, failed: 0 };
        const rows = await store.owedItems(s.db, rewarded, limit);
        const out = { tried: rows.length, granted: 0, failed: 0 };
        for (const row of rows) {
            const after = await settle(row);
            if (after && after.item_state === 'granted') out.granted++; else if (after) out.failed++;
        }
        if (rows.length) log.log(`[Items] retried ${rows.length}: ${out.granted} granted, ${out.failed} still failing`);
        return out;
    }

    function start({ intervalMs = config.items.retryMs } = {}) {
        if (!enabled || timer) return null;
        timer = setInterval(() => { retryPending().catch((err) => log.warn('[Items] retry failed:', err.message)); }, intervalMs);
        if (timer.unref) timer.unref();
        return timer;
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    return { enabled, settle, retryPending, start, stop, grant, status: () => ({ enabled, ...stats }) };
}

module.exports = { createItems, AUDIENCE, SCOPES };
