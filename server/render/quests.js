'use strict';

/**
 * Small server-rendered pieces the quest pages share: a quest's reward line, a quest card, the catalog grouped by
 * site, a progress bar and the OpenCoins note. Plain HTML, no JavaScript, every value through the html`` template
 * (escaping); the catalog is code, but nothing here assumes its text is harmless.
 */
const catalog = require('../quests/catalog');
const { html } = require('./html');

/**
 * What a quest pays: its badge (a text label) and its OpenCoins. When OpenCoins are off the reward says so
 * instead of promising points that do not move — the sentence the product uses everywhere.
 */
function reward(quest, { coinsEnabled = false } = {}) {
    const badge = quest.reward.badge.name;
    if (quest.reward.coins <= 0) return html`<span class="reward">Badge: <strong>${badge}</strong></span>`;
    if (!coinsEnabled) return html`<span class="reward">Badge: <strong>${badge}</strong> · <span class="muted">OpenCoins rewards start soon</span></span>`;
    return html`<span class="reward">Badge: <strong>${badge}</strong> · <strong>${quest.reward.coins}</strong> OpenCoins</span>`;
}

/** One quest in a list: what it is, why, what it pays, and the events it counts. */
function card(quest, { coinsEnabled = false } = {}) {
    return html`<li class="quest">
    <a class="quest-title" href="/quests/${quest.id}">${quest.title}</a>
    <p class="quest-why">${quest.why}</p>
    <p class="quest-steps">${quest.steps.map((s) => html`<span class="step">${s.label}${s.count > 1 ? html` ×${s.count}` : ''} <code>${s.event_type}</code></span>`)}</p>
    <p class="quest-reward">${reward(quest, { coinsEnabled })}</p>
</li>`;
}

/** The catalog grouped by the site whose events each quest counts. */
function list(groups = catalog.grouped(), { coinsEnabled = false } = {}) {
    // The heading id is the domain with its dots replaced: an id with a dot is legal but awkward to target.
    const anchor = (site) => `site-${String(site).replace(/[^a-z0-9-]/gi, '-')}`;
    return html`${groups.map((g) => html`<section class="site-group" aria-labelledby="${anchor(g.site)}">
    <h3 id="${anchor(g.site)}"><a href="https://${g.site}">${g.name}</a>${g.what ? html` <small>${g.what}</small>` : ''}</h3>
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

module.exports = { reward, card, list, progress, coinsNote };
