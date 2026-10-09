'use strict';

/**
 * OpenVibe.Quest configuration. Every value comes from the environment (production: /etc/openvibe/quest.env, see
 * .env.example). Only environment variable NAMES appear in code and docs; secrets are never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();
const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 4980);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.quest' : `http://localhost:${port}`));
    const networkUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');

    return {
        service: 'quest',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,
        // Per-caller limits (server/http/caller-limits.js): the requests one caller (an app, a person, else an
        // address) may make per minute and per hour. The product's own routes add tighter budgets there.
        limits: {
            minute: Math.max(1, int(env.QUEST_LIMITS_MINUTE, 120)),
            hour: Math.max(1, int(env.QUEST_LIMITS_HOUR, 3000)),
        },

        // PostgreSQL (ADR-035): DATABASE_URL serves (PgBouncer), DATABASE_DIRECT_URL migrates (owner role). In
        // development without DATABASE_URL an embedded PGlite database in data/pglite is used (QUEST_PGLITE_DIR
        // overrides the directory).
        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.QUEST_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:quest:' },

        // OpenVibe.Network: SSO (OAuth2 authorization server with PKCE) and its JWKS.
        networkUrl,
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkUrl),
        // The audience this service's app, agent and service tokens carry.
        audience: env.QUEST_AUDIENCE || 'openvibe.quest',
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'quest',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        // OpenVibe.Events → this service (server/events-consumer.js). The secret is what signs a delivery
        // (comma-separated for rotation, 32+ characters each); unset turns the consumer off (503) and Quest
        // then simply never moves. The url is where subscriptions are created at boot, off when unset.
        events: {
            secrets: String(env.QUEST_EVENTS_SECRET || '').split(',').map((x) => x.trim()).filter(Boolean),
            url: trim(env.QUEST_EVENTS_URL || env.EVENTS_URL || ''),
            endpoint: env.QUEST_EVENTS_ENDPOINT || '',
        },

        // OpenCoins (server/quests/coins.js). Rewards are badges and OpenCoins — loyalty points, never money, and
        // never Vibes. QUEST_COINS is off by default: with 'off' nothing is credited, a completion's coins are
        // 'skipped' and the pages say the rewards start soon. 'on' credits through OpenVibe.Network's wallet
        // within the two daily caps. retryMs is how often a failed or unfinished credit is retried.
        coins: {
            mode: String(env.QUEST_COINS || 'off').toLowerCase() === 'on' ? 'on' : 'off',
            dailyCap: Math.max(0, int(env.QUEST_COINS_DAILY_CAP, 50)),
            globalDailyCap: Math.max(0, int(env.QUEST_COINS_GLOBAL_DAILY_CAP, 5000)),
            retryMs: Math.max(10_000, int(env.QUEST_COINS_RETRY_MS, 300_000)),
        },

        // Item rewards (server/quests/items.js): some quests also give one of Live's items, granted in
        // OpenVibe.Inventory with this service's own token (Live names Quest a grantor of those items, ADR-054 §3).
        // On by default: an item is free and never money. QUEST_ITEMS=off records nothing and grants nothing.
        items: {
            mode: String(env.QUEST_ITEMS || 'on').toLowerCase() === 'off' ? 'off' : 'on',
            inventoryUrl: trim(env.OV_INVENTORY_INTERNAL_URL || 'http://127.0.0.1:5030'),
            retryMs: Math.max(10_000, int(env.QUEST_ITEMS_RETRY_MS, 300_000)),
        },
    };
}

module.exports = { load };
