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
 * What a quest pays: its badge (a text label), for some an item (OpenVibe.Inventory) and its OpenCoins. Every chip
 * says its type and what it is for, and the coin chip keeps its amount even while OpenCoins are off, so the catalog's
 * promise is visible rather than replaced by "soon". Never an "up to": the catalog's amount is the whole amount.
 */
function reward(quest, { coinsEnabled = false } = {}) {
    const badge = quest.reward.badge.name;
    const badgeChip = html`<span class="reward-badge">Badge: <strong>${badge}</strong> <small>on your profile</small></span>`;
    // An item for the person's OpenVibe.Inventory (server/quests/items.js), worn in chat and on their profile.
    const it = quest.reward.item;
    const itemChip = it ? html`<span class="reward-item" title="${it.kind} for your OpenVibe inventory"><span aria-hidden="true">${it.emoji}</span> <strong>${it.name}</strong> <small>${it.kind} for your inventory</small></span>` : '';
    if (quest.reward.coins <= 0) return html`<span class="reward">${badgeChip}${itemChip}</span>`;
    if (!coinsEnabled) return html`<span class="reward">${badgeChip}${itemChip}<span class="reward-coins soon"><strong>${quest.reward.coins}</strong> OpenCoins, <small>start soon</small></span></span>`;
    return html`<span class="reward">${badgeChip}${itemChip}<span class="reward-coins"><strong>${quest.reward.coins}</strong> OpenCoins</span></span>`;
}

/**
 * What a counted step counts, in words, for the fraction beside its bar. Only a step that needs more than one event
 * shows it ("2/3 streams"); a one-event step reads as "1/1", the way the reference card renders "7/10". The nouns
 * describe the catalog's own labels; no count or limit is added.
 */
const STEP_UNITS = Object.freeze({
    'live.stream.started': 'streams',
    'network.follow.created': 'follows',
    'community.thread.created': 'threads',
    'community.post.created': 'replies',
    'community.comment.created': 'comments',
    'space.thread.created': 'threads',
    'chat.room.message.created': 'messages',
    'wiki.revision.created': 'revisions',
    'games.player.joined': 'worlds',
    'tools.job.created': 'jobs',
    'live.setup.task_completed': 'tasks',
    'blog.post.published': 'posts',
    'deals.offer.created': 'deals',
    'deals.vote.changed': 'votes',
    'run.job.succeeded': 'jobs',
    'inventory.item.equipped': 'items',
    'bot.robot.online': 'robots',
    'games.world.published': 'worlds',
    'mediahub.video.published': 'videos',
    'mediahub.picture.uploaded': 'pictures',
});
const unitOf = (step) => (step.count > 1 ? STEP_UNITS[step.event_type] || '' : '');

/** A progress bar with the ARIA a screen reader reads (role=progressbar, now/max, the fraction as the value text). */
function bar(value, target, text, label) {
    return html`<progress max="${target}" value="${value}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${value}" aria-valuetext="${text}">${text}</progress>`;
}

/** The fraction as the page writes it: "3/12 hours" when the step has a unit, "7/10" when it has none. */
function fraction(value, target, unit = '') {
    return `${value}/${target}${unit ? ` ${unit}` : ''}`;
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

/**
 * The state as text as well as colour: Active, Completed once the badge is awarded, or Locked for an app quest its
 * app retired (the only state in the code that stops a quest counting).
 */
const stateChip = (done, locked = false) => (locked && !done
    ? html`<span class="quest-state quest-state--locked">Locked</span>`
    : done
        ? html`<span class="quest-state quest-state--completed">Completed</span>`
        : html`<span class="quest-state quest-state--active">Active</span>`);

/**
 * One counted step in a card: its label, and — when the viewer's progress is known — the fraction with its unit and
 * a bar. Without a viewer it keeps the catalog's target ("×3"), so "what it counts" is never hidden.
 */
function stepLine(step, i, seen) {
    const unit = unitOf(step);
    if (!seen) {
        return html`<li>${step.label}${step.count > 1 ? html` <span class="step-count">×${step.count}</span>` : ''}</li>`;
    }
    const value = Math.min(seen.get(i) || 0, step.count);
    const text = fraction(value, step.count, unit);
    return html`<li>${step.label}<span class="step-progress">${bar(value, step.count, text, step.label)}<span class="progress-count">${text}</span></span></li>`;
}

/**
 * One quest in a list: its title, one-line description, what it counts, the reward with its amount, and its state as
 * text. `seen` is the viewer's step counts (Map step → count); `completedAt` is when they earned it. A completed card
 * is dimmed and repeats the date and the badge, so the state is not colour alone.
 */
function card(quest, { coinsEnabled = false, earned = false, counts = null, seen = null, completedAt = null } = {}) {
    const done = Boolean(earned || completedAt);
    const date = completedAt ? String(completedAt).slice(0, 10) : '';
    // A completion means every step reached its target; show that even if the progress rows were not the reason.
    const stepSeen = done && seen ? new Map(quest.steps.map((s, i) => [i, s.count])) : seen;
    return html`<li class="quest${done ? ' is-completed' : ''}">
    ${medal(quest, { earned: done })}
    <div class="quest-main">
    <a class="quest-title" href="/quests/${quest.id}">${quest.title}</a> ${stateChip(done)}
    <p class="quest-why">${quest.why}</p>
    <ul class="quest-steps">${quest.steps.map((s, i) => stepLine(s, i, stepSeen))}</ul>
    <p class="quest-reward">${reward(quest, { coinsEnabled })}</p>
    ${done && completedAt ? html`<p class="quest-earned">Completed <time datetime="${completedAt}">${date}</time> · Badge: <strong>${quest.reward.badge.name}</strong></p>` : ''}
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
    <p class="quest-reward"><span class="reward"><span class="reward-badge"><strong>${n}</strong> quests, a badge each</span>${coins > 0 ? html`<span class="reward-coins${coinsEnabled ? '' : ' soon'}"><strong>${coins}</strong> OpenCoins in all${coinsEnabled ? '' : html`, <small>start soon</small>`}</span>` : ''}</span></p>
    ${done > 0 ? html`<p class="quest-count">${done} ${done === 1 ? 'badge' : 'badges'} earned in this series</p>` : ''}
    </div>
</li>`;
}

/** A quest a developer app made, in a list (the full index, /quests): its badge, what it is, and where to do it. */
function appCard(q, { seen = null, completedAt = null } = {}) {
    const done = Boolean(completedAt);
    const stepSeen = done && seen ? new Map(q.steps.map((s, i) => [i, s.count])) : seen;
    return html`<li class="quest${done ? ' is-completed' : ''}">
    ${medal(q, { earned: done })}
    <div class="quest-main">
    <a class="quest-title" href="/apps/quests/${q.id}">${q.title}</a> ${stateChip(done)}
    ${q.why ? html`<p class="quest-why">${q.why}</p>` : ''}
    <ul class="quest-steps">${q.steps.map((s, i) => stepLine(s, i, stepSeen))}</ul>
    <p class="quest-reward"><span class="reward"><span class="reward-badge">Badge: <strong>${q.reward.badge.name}</strong> <small>on your profile</small></span></span></p>
    ${done && completedAt ? html`<p class="quest-earned">Completed <time datetime="${completedAt}">${String(completedAt).slice(0, 10)}</time> · Badge: <strong>${q.reward.badge.name}</strong></p>` : ''}
    ${q.url ? html`<p class="quest-count"><a href="${q.url}" rel="nofollow noopener">Where to do it</a></p>` : ''}
    </div>
</li>`;
}

/** The catalog grouped by the site whose events each quest counts (a folded catalog shows each series as one card). */
function list(groups = catalog.grouped(), { coinsEnabled = false, counts = null, seen = null, completed = null } = {}) {
    // The heading id is the domain with its dots replaced: an id with a dot is legal but awkward to target.
    const anchor = (site) => `site-${String(site).replace(/[^a-z0-9-]/gi, '-')}`;
    const count = (g) => g.quests.length + (g.series || []).reduce((n, x) => n + x.quests.length, 0);
    // `seen` is the viewer's Map quest id → Map(step → count); null for a signed-out reader, who gets the targets only.
    const cardFor = (q) => card(q, {
        coinsEnabled, counts,
        seen: seen ? (seen.get(q.id) || new Map()) : null,
        completedAt: completed ? (completed.get(q.id) || null) : null,
    });
    return html`${groups.map((g) => html`<section class="site-group" aria-labelledby="${anchor(g.site)}">
    <h3 id="${anchor(g.site)}"><a href="https://${g.site}">${String(g.name).replace(/^OpenVibe\./, '')}</a><span class="site-count">${count(g)} quest${count(g) === 1 ? '' : 's'}</span>${g.what ? html` <small>${g.what}</small>` : ''}</h3>
    <ul class="quest-list">${g.quests.map(cardFor)}${(g.series || []).map((x) => seriesCard(x, { coinsEnabled, counts }))}</ul>
</section>`)}`;
}

/**
 * A progress bar as a plain <progress> element with the ARIA role and values a screen reader reads, and the fraction
 * written beside it — "3/12 hours" when the unit is passed, "7/10" otherwise.
 */
function progress(label, count, target, unit = '') {
    const value = Math.min(Math.max(Number(count) || 0, 0), target);
    const text = fraction(value, target, unit);
    return html`<div class="progress"><span class="progress-label">${label}</span>
    ${bar(value, target, text, label)}
    <span class="progress-count">${text}</span></div>`;
}

/**
 * A quest's terms, the same on every quest page: only what the code does. It needs a signed-in account and nothing
 * else — no wallet to connect, no card, no subscription or auto-renew; the event inbox is the only thing that moves
 * a quest, and a badge is awarded once and kept.
 */
function terms() {
    return html`<h2>Terms</h2>
<ul class="terms">
<li><strong>Nothing to connect or pay.</strong> Earning a quest needs a signed-in OpenVibe account: no wallet to connect, no card, and no subscription or auto-renew.</li>
<li><strong>Counted by Quest's event inbox.</strong> Quest counts the events OpenVibe sites send to its own event inbox (<code>quest_event_inbox</code>), and nothing else: no page views, no clicks, no watch time.</li>
<li><strong>Once per person.</strong> A quest completes once, and its badge is awarded once and kept.</li>
</ul>`;
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

module.exports = { medal, hueOf, reward, card, seriesCard, appCard, list, progress, terms, stateChip, coinsNote, kitCard, seriesKitCard, appKitCard, badgeSvg, seriesSvg, shortSite, unitOf };
