'use strict';

/**
 * OpenCoins: crediting a completion through OpenVibe.Network's wallet.
 *
 * OpenCoins are loyalty points, never money — they are not Vibes, and nothing here ever moves money. The wallet
 * is Network's (POST /internal/coins/credit, network.coins-change-request@1); this service holds no balance and
 * reads none. The wallet is keyed by the Network user id, the integer, so a subject is resolved first
 * (GET /internal/identity/resolve, a projection that carries network_user_id) — a subject the Network does not
 * know is a failure to record, not a reason to guess.
 *
 * Auth: this service's own client credentials (grant_type=client_credentials for `quest`) through
 * openvibe-contracts' cached token client, for audience openvibe.network and the two capabilities it needs:
 * identity.subject.resolve and network.coins.credit.
 *
 * idempotency_key is the completion id (qcp_…), so a retry of a credit that did land changes nothing: Network
 * answers the original balance.
 *
 * Guard rails, all of them deliberate:
 *   QUEST_COINS=off (the default)   no credit is attempted at all; the completion is `skipped` and the pages say
 *                                   "OpenCoins rewards start soon"
 *   QUEST_COINS_DAILY_CAP           per person, per UTC day (default 50): over it, the completion is `skipped`
 *                                   with the reason, so nobody's day is silently short
 *   QUEST_COINS_GLOBAL_DAILY_CAP    everyone together (default 5000)
 *   a failure (the wallet refused, the Network was unreachable, no network account for the subject) is recorded
 *                                   as `failed` with its reason and retried by a small timer — never lost, and
 *                                   never retried into a double credit (the idempotency key).
 */

const { serviceAuth } = require('openvibe-contracts');
const store = require('./store');
const catalog = require('./catalog');

const APP_ID = 'quest';                 // svc:quest may only credit its own app id (Network's ownApp rule)
const AUDIENCE = 'openvibe.network';
const SCOPES = 'identity.subject.resolve network.coins.credit';
const TIMEOUT_MS = 5000;

/** How a completion is told apart in the ledger row (never anything about the person). */
const coinsRef = (questId) => `https://openvibe.quest/quests/${questId}`;

function createCoins({ config, s, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const enabled = config.coins.mode === 'on';
    const base = String(config.networkInternalUrl || '').replace(/\/+$/, '');
    const tokens = serviceAuth.createTokenClient({
        tokenUrl: `${base}/oauth/token`,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: AUDIENCE,
        scope: SCOPES,
        fetchImpl,
    });
    let timer = null;
    const stats = { credited: 0, skipped: 0, failed: 0, attempts: 0, last_at: null };

    /** One call to Network's internal API with this service's token. Throws CoinsError (no token, no secret). */
    async function call(method, path, { query, body } = {}) {
        const url = new URL(base + path);
        for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url.toString(), {
            method, headers, body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            // The wallet's own words (`invalid_user_id`, `user_not_found`), never the token.
            const err = new Error(`Network ${res.status}${json && (json.error || json.code) ? `: ${json.error || json.code}` : ''}`);
            err.status = res.status;
            throw err;
        }
        return json || {};
    }

    /** The Network user id behind a subject, or null when the Network has no such account. */
    async function networkUserId(subject) {
        try {
            const out = await call('GET', '/internal/identity/resolve', { query: { subject_id: subject } });
            const id = out && out.network_user_id;
            return Number.isInteger(id) && id > 0 ? id : null;
        } catch (err) {
            if (err.status === 404) return null;
            throw err;
        }
    }

    /** Credit one completion. Throws with a short, safe reason; never logs a token or a body. */
    async function credit(completion) {
        const quest = catalog.byId(completion.quest_id);
        if (!quest) throw new Error(`no quest ${completion.quest_id} in the catalog`);
        const userId = await networkUserId(completion.subject);
        if (!userId) throw new Error('the Network has no account for this subject yet');
        const out = await call('POST', '/internal/coins/credit', {
            body: {
                user_id: userId,
                app_id: APP_ID,
                amount: completion.coins,
                reason: `quest:${quest.id}`,
                ref: coinsRef(quest.id),
                idempotency_key: completion.id,
            },
        });
        return Number.isInteger(out.balance) ? out.balance : null;
    }

    /** Record the outcome of a decision about one completion's coins. */
    async function record(completion, patch) {
        return store.setCoins(s.db, completion.id, patch);
    }

    /**
     * Decide what happens to a completion's coins now: skip (coins off, or a cap is reached), credit, or record
     * the failure for the retry timer. Never throws.
     */
    async function settle(completion) {
        if (!completion || completion.coins <= 0) return null;
        if (!enabled) { stats.skipped++; return record(completion, { state: 'skipped', error: null }); }
        try {
            const day = store.dayOf(now());
            const mine = await store.creditedTo(s.db, completion.subject, day);
            if (mine + completion.coins > config.coins.dailyCap) {
                stats.skipped++;
                return record(completion, { state: 'skipped', error: `the daily cap of ${config.coins.dailyCap} OpenCoins per person is reached` });
            }
            const everyone = await store.creditedAll(s.db, day);
            if (everyone + completion.coins > config.coins.globalDailyCap) {
                stats.skipped++;
                return record(completion, { state: 'skipped', error: `the network-wide daily cap of ${config.coins.globalDailyCap} OpenCoins is reached` });
            }
            stats.attempts++;
            const balance = await credit(completion);
            stats.credited++; stats.last_at = new Date(now()).toISOString();
            return record(completion, { state: 'credited', error: null, at: new Date(now()).toISOString(), attempts: 1, balance });
        } catch (err) {
            stats.failed++;
            const message = String((err && err.message) || err).slice(0, 200);
            log.warn(`[OpenCoins] ${completion.id} (${completion.quest_id}) not credited: ${message}`);
            return record(completion, { state: 'failed', error: message, attempts: 1 });
        }
    }

    /**
     * Come back to every completion whose credit is still owed (a failure, or a process that stopped between the
     * completion and the credit). Called by the timer in production and directly by tests.
     */
    async function retryPending({ limit = 50 } = {}) {
        if (!enabled) return { tried: 0, credited: 0, skipped: 0, failed: 0 };
        const rows = await store.owedCoins(s.db, limit);
        const out = { tried: rows.length, credited: 0, skipped: 0, failed: 0 };
        for (const row of rows) {
            const after = await settle(row);
            if (after && after.coins_state === 'credited') out.credited++;
            else if (after && after.coins_state === 'skipped') out.skipped++;
            else if (after) out.failed++;
        }
        if (rows.length) log.log(`[OpenCoins] retried ${rows.length}: ${out.credited} credited, ${out.skipped} skipped, ${out.failed} still failing`);
        return out;
    }

    function start({ intervalMs = config.coins.retryMs } = {}) {
        if (!enabled || timer) return null;
        timer = setInterval(() => { retryPending().catch((err) => log.warn('[OpenCoins] retry failed:', err.message)); }, intervalMs);
        if (timer.unref) timer.unref();
        return timer;
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    return {
        enabled, settle, retryPending, start, stop, networkUserId, credit,
        status: () => ({ enabled, daily_cap: config.coins.dailyCap, global_daily_cap: config.coins.globalDailyCap, ...stats }),
    };
}

module.exports = { createCoins, APP_ID, AUDIENCE, SCOPES, coinsRef };
