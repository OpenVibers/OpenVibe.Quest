'use strict';

/**
 * OpenVibe.Quest — process entry. `node server/index.js`
 * Listens on PORT (4980) behind nginx (deploy/).
 */
const { createApp } = require('./app');
const { gracefulStop } = require('openvibe-sdk/service');
const { startTelemetryRetention } = require('openvibe-sdk/telemetry');

/**
 * The process stop (openvibe-sdk/service): the HTTP drain runs, then the timers clear, the Events subscriptions
 * stop, the JWKS refresher stops and the store closes. Exported so a test can inject `exit` and `signals: false`.
 * `extra` is what the product adds (the Events subscriptions and the OpenCoins retry timer); a test that passes
 * none keeps the skeleton's order.
 */
function createLifecycle({ server, ctx, exit, signals, timers = [], extra = [] }) {
    return gracefulStop({
        name: 'OpenVibe.Quest', server, deadlineExitCode: 0, exit, signals, deadlineMs: 10_000,
        close: [() => { for (const t of timers) clearInterval(t); }, () => ctx.keys.client.stop(), () => ctx.searchIndex.stop(), async () => { clearInterval(ctx.telemetryTick); if (ctx.retention) await ctx.retention.stop(); if (ctx.telemetry) await ctx.telemetry.stop(); }, () => ctx.s.close(), ...extra],
    });
}

async function start() {
    const { app, ctx } = await createApp();
    const { config } = ctx;

    // Socket activation (2026-10-31): systemd's .socket unit holds the listener across restarts, so a deploy
    // queues requests in the kernel instead of answering 502. Without the socket unit, the usual listen.
    const socketActivated = process.env.LISTEN_FDS === '1' && Number(process.env.LISTEN_PID) === process.pid;
    const server = app.listen(...(socketActivated ? [{ fd: 3 }] : [config.port, config.host]), () => {
        console.log(`[OpenVibe.Quest] ${config.nodeEnv} on http://${config.host}:${config.port} → ${config.baseUrl} (db ${ctx.s.db.store})`);
    });
    server.keepAliveTimeout = 65_000;
    // telemetry_samples rows older than 14 days go: a minute after start, then daily (openvibe-sdk/telemetry).
    ctx.retention = startTelemetryRetention({ db: ctx.s.db, log: ctx.log || console, olderThanDays: 14 });
    // The request collector aggregates in memory and has no timer of its own (openvibe-sdk 0.46 createHttpTelemetry):
    // this tick writes each minute's samples; the stop clears it and flushes once more.
    ctx.telemetryTick = setInterval(() => { ctx.telemetry.flush().catch(() => {}); }, 60_000);
    ctx.telemetryTick.unref();
    ctx.keys.client.start();
    ctx.searchIndex.start();

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

    // App quests: each project with an active production quest gets its app.<project_key>.* subscription.
    ctx.appQuests.setSubscriber(subscriptions ? subscriptions.subscribe : null);
    ctx.appQuests.load().catch((err) => console.warn('[Quest] app quests not loaded:', err.message));
    const extra = [() => { if (subscriptions) subscriptions.stop(); }, () => ctx.coins.stop(), () => ctx.items.stop()];
    createLifecycle({ server, ctx, timers, extra });
    return { server, ctx };
}

if (require.main === module) {
    start().catch((err) => { console.error('[OpenVibe.Quest] failed to start:', err); process.exit(1); });
}

module.exports = { start, createLifecycle };
