'use strict';
const { serviceAuth } = require('openvibe-contracts');
const { createClient } = require('openvibe-sdk/core');
const { createLevelsClient } = require('openvibe-sdk/levels');
const catalog = require('./catalog');
const EXTRA_XP = 25;
function createLevels({ config, s, fetchImpl = globalThis.fetch }) {
    const tokens = serviceAuth.createTokenClient({ tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret, audience: 'openvibe.network', scope: 'network.levels.award', fetchImpl });
    const awards = createLevelsClient(createClient({ baseUrls: { network: config.networkInternalUrl }, getToken: () => tokens.getToken(), fetch: fetchImpl, retries: 0, timeoutMs: 5000 }));
    let running = false;
    async function settle(row) {
        // Developer-defined badge quests cannot mint platform experience from arbitrary app events.
        if (!catalog.byId(row.quest_id) && !/^daily-\d{4}-\d{2}-\d{2}$/.test(row.quest_id)) {
            await s.db.exec("UPDATE quest_completions SET experience_state = 'skipped' WHERE id = $1", [row.id]); return false;
        }
        try { await awards.award({ subject: row.subject, amount: EXTRA_XP, reason: 'quest.completed', idempotency_key: row.id }); }
        catch (e) {
            if (e.status === 404 && e.code === 'levels.person_not_found') {
                await s.db.exec("UPDATE quest_completions SET experience_state = 'skipped' WHERE id = $1", [row.id]); return false;
            }
            if (e.status !== 409 || e.code !== 'levels.duplicate') throw e;
        }
        await s.db.exec("UPDATE quest_completions SET experience_state = 'awarded' WHERE id = $1", [row.id]);
        return true;
    }
    async function retryPending() {
        if (running) return { awarded: 0 };
        running = true;
        let awarded = 0;
        try {
            const rows = await s.db.many("SELECT id, subject, quest_id FROM quest_completions WHERE experience_state = 'pending' ORDER BY completed_at LIMIT 50");
            for (const row of rows) { try { if (await settle(row)) awarded++; } catch { /* durable pending row retries next tick; never log a credential */ } }
        } finally { running = false; }
        return { awarded };
    }
    function readClient(token) { return createLevelsClient(createClient({ baseUrls: { network: config.networkInternalUrl }, token: token || undefined, fetch: fetchImpl, retries: 0, timeoutMs: 5000 })); }
    return { settle, retryPending, readClient };
}
module.exports = { createLevels, EXTRA_XP };
