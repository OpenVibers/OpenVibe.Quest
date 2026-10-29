'use strict';

/**
 * Small server-rendered pieces the quest pages share: a quest's reward line, a quest card, the catalog grouped by
 * site, a progress bar and the OpenCoins note. Plain HTML, no JavaScript, every value through the html`` template
 * (escaping); the catalog is code, but nothing here assumes its text is harmless.
 */
const kit = require('openvibe-shared/kit');
const catalog = require('../quests/catalog');
const art = require('./badge-art');
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
    return html`<span class="medal${earned ? ' earned' : ''}" style="--h:${hueOf(quest.id)}" aria-hidden="true">${art.initials(quest.reward.badge.name || quest.title)}</span>`;
}

// ── The home's cards: a quest, a series or an app's quest as the shared kit's card (openvibe-shared kit.card), its
// picture the badge it pays (render/badge-art.js). The card is one link; nothing in it needs kit-web.js (no ⋯ menu).
const shortSite = (domain) => String((catalog.SITES[domain] || {}).name || domain).replace(/^OpenVibe\./, '');

/** A catalog quest: the site it happens on, its item or OpenCoins in the corner, how many hold its badge. */
function kitCard(quest, { coinsEnabled = false, earned = 0 } = {}) {
    const it = quest.reward.item;
    return kit.card({
        href: `/quests/${quest.id}`, title: quest.title, ratio: '16/9', share: false,
        image: `/quests/${encodeURIComponent(quest.id)}/badge.svg`, alt: `The ${quest.reward.badge.name} badge`,
        badge: shortSite(quest.site),
        corner: it ? `+ ${it.name}` : coinsEnabled && quest.reward.coins > 0 ? `${quest.reward.coins} OpenCoins` : '',
        peek: quest.why,
        count: earned > 0 ? [earned, 'earned'] : null,
    });
}

/** A series: one card for all its quests, opening the series' page. */
function seriesKitCard(series, { earned = 0 } = {}) {
    return kit.card({
        href: `/series/${series.id}`, title: series.title, ratio: '16/9', share: false,
        image: `/series/${encodeURIComponent(series.id)}/badge.svg`, alt: `${series.quests.length} badges, one for each quest`,
        badge: shortSite(series.site), peek: series.why,
        count: earned > 0 ? [earned, earned === 1 ? 'badge earned' : 'badges earned'] : null,
    });
}

/** A quest a developer app made (server/quests/app-quests.js): badges only, never OpenCoins. */
function appKitCard(q) {
    return kit.card({
        href: `/apps/quests/${q.id}`, title: q.title, ratio: '16/9', share: false,
        image: `/apps/quests/${encodeURIComponent(q.id)}/badge.svg`, alt: `The ${q.reward.badge.name} badge`,
        badge: 'App', peek: q.why || '',
    });
}

/** The SVG for a badge card (render/badge-art.js): a quest's, a series' (its count on the medal) or an app quest's. */
const badgeSvg = (quest) => art.svg({ hue: hueOf(quest.id), mark: art.initials(quest.reward.badge.name || quest.title), name: quest.reward.badge.name });
const seriesSvg = (series) => art.svg({ hue: hueOf(series.id), mark: String(series.quests.length), name: `${series.quests.length} quests, a badge each` });

/** "Earned by 3 people": how many have a quest's badge (a count, never who), or nothing at 0. */
function earnedBy(n) {
    return n > 0 ? html`<p class="quest-count">Earned by ${n} ${n === 1 ? 'person' : 'people'}</p>` : '';
}

/** One quest in a list: the badge it pays, what it is, why, the steps as a checklist, and the reward. */
function card(quest, { coinsEnabled = false, earned = false, counts = null } = {}) {
    return html`<li class="quest">
    ${medal(quest, { earned })}
    <div class="quest-main">
    <a class="quest-title" href="/quests/${quest.id}">${quest.title}</a>${earned ? html` <span class="done">done</span>` : ''}
    <p class="quest-why">${quest.why}</p>
    <ul class="quest-steps">${quest.steps.map((s) => html`<li>${s.label}${s.count > 1 ? html` <span class="step-count">×${s.count}</span>` : ''}</li>`)}</ul>
    <p class="quest-reward">${reward(quest, { coinsEnabled })}</p>
    ${counts ? earnedBy(counts.get(quest.id) || 0) : ''}
    </div>
</li>`;
}

/** A series in a list (the home page): one card for all its quests, opening the series' page. */
function seriesCard(series, { coinsEnabled = false, counts = null } = {}) {
    const coins = series.quests.reduce((n, q) => n + q.reward.coins, 0);
    const n = series.quests.length;
    const done = counts ? series.quests.reduce((sum, q) => sum + (counts.get(q.id) || 0), 0) : 0;
    return html`<li class="quest quest-series">
    <span class="medal" style="--h:${hueOf(series.id)}" aria-hidden="true">${n}</span>
    <div class="quest-main">
    <a class="quest-title" href="/series/${series.id}">${series.title}</a>
    <p class="quest-why">${series.why}</p>
    <p class="quest-reward"><span class="reward"><span class="reward-badge"><strong>${n}</strong> quests, a badge each</span>${coins > 0 ? (coinsEnabled ? html`<span class="reward-coins"><strong>${coins}</strong> OpenCoins in all</span>` : html`<span class="reward-coins soon">OpenCoins rewards start soon</span>`) : ''}</span></p>
    ${done > 0 ? html`<p class="quest-count">${done} ${done === 1 ? 'badge' : 'badges'} earned in this series</p>` : ''}
    </div>
</li>`;
}

/** A quest a developer app made, in a list (the full index, /quests): its badge, what it is, and where to do it. */
function appCard(q) {
    return html`<li class="quest">
    ${medal(q)}
    <div class="quest-main">
    <a class="quest-title" href="/apps/quests/${q.id}">${q.title}</a>
    ${q.why ? html`<p class="quest-why">${q.why}</p>` : ''}
    <p class="quest-reward"><span class="reward"><span class="reward-badge">Badge: <strong>${q.reward.badge.name}</strong></span></span></p>
    ${q.url ? html`<p class="quest-count"><a href="${q.url}" rel="nofollow noopener">Where to do it</a></p>` : ''}
    </div>
</li>`;
}

/** The catalog grouped by the site whose events each quest counts (a folded catalog shows each series as one card). */
function list(groups = catalog.grouped(), { coinsEnabled = false, counts = null } = {}) {
    // The heading id is the domain with its dots replaced: an id with a dot is legal but awkward to target.
    const anchor = (site) => `site-${String(site).replace(/[^a-z0-9-]/gi, '-')}`;
    const count = (g) => g.quests.length + (g.series || []).reduce((n, x) => n + x.quests.length, 0);
    return html`${groups.map((g) => html`<section class="site-group" aria-labelledby="${anchor(g.site)}">
    <h3 id="${anchor(g.site)}"><a href="https://${g.site}">${String(g.name).replace(/^OpenVibe\./, '')}</a><span class="site-count">${count(g)} quest${count(g) === 1 ? '' : 's'}</span>${g.what ? html` <small>${g.what}</small>` : ''}</h3>
    <ul class="quest-list">${g.quests.map((q) => card(q, { coinsEnabled, counts }))}${(g.series || []).map((x) => seriesCard(x, { coinsEnabled, counts }))}</ul>
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

module.exports = { medal, hueOf, reward, card, seriesCard, appCard, list, progress, coinsNote, kitCard, seriesKitCard, appKitCard, badgeSvg, seriesSvg, shortSite };
