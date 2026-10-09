'use strict';

/**
 * Small server-rendered pieces the quest pages share: a quest's reward line, a quest card, the catalog grouped by
 * site, a progress bar and the OpenCoins note. Plain HTML, no JavaScript, every value through the html`` template
 * (escaping); the catalog is code, but nothing here assumes its text is harmless.
 */
const catalog = require('../quests/catalog');
const { html } = require('./html');

/**
 * What a quest pays: its badge (a text label), for some an item (OpenVibe.Inventory) and its OpenCoins. When OpenCoins are off the reward says so
 * instead of promising points that do not move — the sentence the product uses everywhere.
 */
function reward(quest, { coinsEnabled = false } = {}) {
    const badge = quest.reward.badge.name;
    const badgeChip = html`<span class="reward-badge">Badge: <strong>${badge}</strong></span>`;
    // An item for the person's OpenVibe.Inventory (server/quests/items.js), worn in chat and on their profile.
    const it = quest.reward.item;
    const itemChip = it ? html`<span class="reward-item" title="${it.kind} for your OpenVibe inventory"><span aria-hidden="true">${it.emoji}</span> <strong>${it.name}</strong> <small>${it.kind.toLowerCase()}</small></span>` : '';
    if (quest.reward.coins <= 0) return html`<span class="reward">${badgeChip}${itemChip}</span>`;
    if (!coinsEnabled) return html`<span class="reward">${badgeChip}${itemChip}<span class="reward-coins soon">OpenCoins rewards start soon</span></span>`;
    return html`<span class="reward">${badgeChip}${itemChip}<span class="reward-coins"><strong>${quest.reward.coins}</strong> OpenCoins</span></span>`;
}

/** A badge's colour, fixed by its quest id, so a badge looks the same wherever it is shown. */
function hueOf(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 33 + ch.codePointAt(0)) % 360;
    return h;
}

/** The badge as a medal: its initials on a ring of its colour (decorative; the name is always written beside it). */
function medal(quest, { earned = false } = {}) {
    const words = String(quest.reward.badge.name || quest.title).split(/\s+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
    return html`<span class="medal${earned ? ' earned' : ''}" style="--h:${hueOf(quest.id)}" aria-hidden="true">${initials}</span>`;
}

/** One quest in a list: the badge it pays, what it is, why, the steps as a checklist, and the reward. */
function card(quest, { coinsEnabled = false } = {}) {
    return html`<li class="quest">
    ${medal(quest)}
    <div class="quest-main">
    <a class="quest-title" href="/quests/${quest.id}">${quest.title}</a>
    <p class="quest-why">${quest.why}</p>
    <ul class="quest-steps">${quest.steps.map((s) => html`<li>${s.label}${s.count > 1 ? html` <span class="step-count">×${s.count}</span>` : ''}</li>`)}</ul>
    <p class="quest-reward">${reward(quest, { coinsEnabled })}</p>
    </div>
</li>`;
}

/** The catalog grouped by the site whose events each quest counts. */
function list(groups = catalog.grouped(), { coinsEnabled = false } = {}) {
    // The heading id is the domain with its dots replaced: an id with a dot is legal but awkward to target.
    const anchor = (site) => `site-${String(site).replace(/[^a-z0-9-]/gi, '-')}`;
    return html`${groups.map((g) => html`<section class="site-group" aria-labelledby="${anchor(g.site)}">
    <h3 id="${anchor(g.site)}"><a href="https://${g.site}">${String(g.name).replace(/^OpenVibe\./, '')}</a><span class="site-count">${g.quests.length} quest${g.quests.length === 1 ? '' : 's'}</span>${g.what ? html` <small>${g.what}</small>` : ''}</h3>
    <ul class="quest-list">${g.quests.map((q) => card(q, { coinsEnabled }))}</ul>
</section>`)}`;
}

/** A progress bar as a plain <progress> element — readable without JavaScript and by a screen reader. */
function progress(label, count, target) {
    const value = Math.min(count, target);
    return html`<div class="progress"><span class="progress-label">${label}</span>
    <progress max="${target}" value="${value}">${value} of ${target}</progress>
    <span class="progress-count">${value} / ${target}</span></div>`;
}

/** The one sentence about OpenCoins: what they are, and whether they move yet. */
function coinsNote({ coinsEnabled, dailyCap, globalDailyCap }) {
    if (!coinsEnabled) {
        return html`<p class="muted">OpenCoins rewards start soon. A completion is recorded now, and no OpenCoins move
while <code>QUEST_COINS</code> is off. OpenCoins are loyalty points, never money — and never Vibes.</p>`;
    }
    return html`<p class="muted">Completing a quest credits OpenCoins through OpenVibe.Network's wallet, within
${dailyCap} OpenCoins per person per day and ${globalDailyCap} for everyone together. OpenCoins are loyalty points,
never money — and never Vibes.</p>`;
}

module.exports = { medal, hueOf, reward, card, list, progress, coinsNote };
