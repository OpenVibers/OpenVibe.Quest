'use strict';

/**
 * Test accounts for Quest's public numbers (OpenVibe.Network users.is_test).
 *
 * Quest shows counts, never people, but a probe account that finished a quest still moved "quests finished", "people
 * with badges" and the "badges people earn most" list. The identity authority lists its test accounts at
 * GET /internal/identity/test-subjects (identity.subject.resolve) and this module keeps their subject ids in
 * test_subject, so the counts can exclude them in SQL (server/quests/store.js). A failed refresh keeps the last good
 * list: a Network outage never makes a test account public again. Their own signed-in quest log and badges still work,
 * because nothing filters a subject reading its own rows.
 */
const { serviceAuth } = require('openvibe-contracts');

const AUDIENCE = 'openvibe.network';
const SCOPES = 'identity.subject.resolve';
const TIMEOUT_MS = 5000;
const REFRESH_MS = 60 * 60 * 1000;
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;

function createTestSubjects({ config, s, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() } = {}) {
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
    const stats = { subjects: 0, refreshed_at: null, failures: 0 };

    /** Replace the list with the Network's answer. Throws with a short, safe reason; never logs a token. */
    async function refresh() {
        const res = await fetchImpl(`${base}/internal/identity/test-subjects`, {
            headers: { Accept: 'application/json', ...(await tokens.authHeaders()) },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !Array.isArray(body.subjects)) {
            throw new Error(`Network ${res.status}${body && (body.code || body.error) ? `: ${body.code || body.error}` : ''}`);
        }
        const subjects = [...new Set(body.subjects.map((p) => p && p.subject && p.subject.id).filter((id) => SUBJECT_RE.test(String(id))))];
        await s.db.tx(async () => {
            for (const subject of subjects) {
                await s.db.exec(`INSERT INTO test_subject (subject, seen_at) VALUES ($1, $2)
                    ON CONFLICT (subject) DO UPDATE SET seen_at = excluded.seen_at`, [subject, s.iso()]);
            }
            // A subject no longer on the list is no longer a test account (it was unmarked); remove it after the upsert.
            if (subjects.length) await s.db.exec('DELETE FROM test_subject WHERE subject <> ALL($1::text[])', [subjects]);
            else await s.db.exec('DELETE FROM test_subject');
        });
        stats.subjects = subjects.length;
        stats.refreshed_at = new Date(now()).toISOString();
        return subjects;
    }

    /** Refresh once now, then hourly; a failure is logged and the last good list stays. */
    function start() {
        if (timer) return timer;
        refresh().catch((err) => { stats.failures++; log.warn && log.warn('[Test accounts] refresh failed:', err.message); });
        timer = setInterval(() => {
            refresh().catch((err) => { stats.failures++; log.warn && log.warn('[Test accounts] refresh failed:', err.message); });
        }, REFRESH_MS);
        if (timer.unref) timer.unref();
        return timer;
    }

    function stop() { if (timer) clearInterval(timer); timer = null; }

    return { refresh, start, stop, status: () => ({ ...stats }) };
}

module.exports = { createTestSubjects, REFRESH_MS };
