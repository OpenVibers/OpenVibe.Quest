'use strict';

/**
 * OpenVibe.Quest — process entry. `node server/index.js`
 * Listens on PORT (4980) behind nginx (deploy/).
 */
const { createApp } = require('./app');
const { gracefulStop } = require('openvibe-sdk/service');

/**
 * The process stop (openvibe-sdk/service): the HTTP drain runs, then the timers clear, the Events subscriptions
 * stop, the JWKS refresher stops and the store closes. Exported so a test can inject `exit` and `signals: false`.
 * `extra` is what the product adds (the Events subscriptions and the OpenCoins retry timer); a test that passes
 * none keeps the skeleton's order.
 */
function createLifecycle({ server, ctx, exit, signals, timers = [], extra = [] }) {
    return gracefulStop({
        name: 'OpenVibe.Quest', server, deadlineExitCode: 0, exit, signals, deadlineMs: 10_000,
        close: [() => { for (const t of timers) clearInterval(t); }, () => ctx.keys.client.stop(), () => ctx.s.close(), ...extra],
    });
}

async function start() {
    const { app, ctx } = await createApp();
    const { config } = ctx;

    const server = app.listen(config.port, config.host, () => {
        console.log(`[OpenVibe.Quest] ${config.nodeEnv} on http://${config.host}:${config.port} → ${config.baseUrl} (db ${ctx.s.db.store})`);
    });
    server.keepAliveTimeout = 65_000;
    ctx.keys.client.start();

    // Subscribe to the events the catalog counts at OpenVibe.Events (idempotent; off without QUEST_EVENTS_URL
    // and QUEST_EVENTS_SECRET) and come back to OpenCoins a failed credit owes (off unless QUEST_COINS=on).
    const secret = config.events.secrets[0] || '';
    const subscriptions = require('./events-consumer').startSubscriptions({ config, port: config.port, secret });
    const timers = [];
    const coinsTimer = ctx.coins.start();
    if (coinsTimer) timers.push(coinsTimer);
    // Item rewards owed (a failed grant, or a completion from before items) are granted by the same kind of timer.
    const itemsTimer = ctx.items.start();
    if (itemsTimer) timers.push(itemsTimer);

    const extra = [() => { if (subscriptions) subscriptions.stop(); }, () => ctx.coins.stop(), () => ctx.items.stop()];
    createLifecycle({ server, ctx, timers, extra });
    return { server, ctx };
}

if (require.main === module) {
    start().catch((err) => { console.error('[OpenVibe.Quest] failed to start:', err); process.exit(1); });
}

module.exports = { start, createLifecycle };
