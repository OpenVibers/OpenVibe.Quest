'use strict';

/** Reviewed Design glyphs; pending candidates never leave Design. Every page has a bundled glyph fallback. */
const crypto = require('node:crypto');
const { serviceAuth } = require('openvibe-contracts');

const nameForBadge = (id) => `badge-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 18)}`;
const nameForDaily = (day) => `daily-${day}`;
function createGlyphDraftClient({ config, fetchImpl = globalThis.fetch, log = console, now = Date.now }) {
    const base = String(config.designInternalUrl || 'http://127.0.0.1:5090').replace(/\/+$/, '');
    const tokens = config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret, audience: 'openvibe.design',
        scope: 'design.glyph.draft', fetchImpl,
    }) : null;
    let last = 0;
    let approvedCache = new Map();
    let pending = null;
    const requested = new Set();
    async function request(name, sentence) {
        if (!config.designDrafts || !tokens || !/^[a-z][a-z0-9-]{1,31}$/.test(name) || requested.has(name)) return false;
        requested.add(name);
        try {
            const res = await fetchImpl(`${base}/api/v1/glyphs/drafts`, {
                method: 'POST', headers: { ...(await tokens.authHeaders()), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, sentence: String(sentence || '').slice(0, 200) }),
                signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) { requested.delete(name); log.warn(`[Quest glyphs] Design draft request failed (${res.status})`); return false; }
            return true;
        } catch { requested.delete(name); log.warn('[Quest glyphs] Design draft request unavailable'); return false; }
    }
    async function approved() {
        if (!config.designDrafts) return approvedCache;
        if (now() - last < 300000) return approvedCache;
        if (pending) return pending;
        pending = (async () => {
            try {
                const res = await fetchImpl(`${base}/api/v1/glyphs/drafts?status=approved`, { signal: AbortSignal.timeout(2500) });
                if (res.ok) {
                    const body = await res.json();
                    const rows = Array.isArray(body.drafts) ? body.drafts : [];
                    const next = new Map();
                    for (const row of rows) if (row.status === 'approved' && /^[a-z][a-z0-9-]{1,31}$/.test(row.name) && typeof row.svg === 'string' && row.svg.length <= 4000 && !next.has(row.name)) next.set(row.name, row.svg);
                    approvedCache = next;
                }
            } catch { /* bundled glyphs stay visible */ }
            last = now();
            pending = null;
            return approvedCache;
        })();
        return pending;
    }
    return { request, approved, nameForBadge, nameForDaily };
}
module.exports = { createGlyphDraftClient, nameForBadge, nameForDaily };
