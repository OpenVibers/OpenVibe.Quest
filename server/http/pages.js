'use strict';

/**
 * Public pages: the home page (what Quest is, the quests grouped by site, how progress works), a quest's page,
 * your own quest log, the rules, and the update log. Crawl artifacts (robots.txt, sitemap.xml, llms.txt,
 * llms-full.txt, JSON-LD) are http/discovery.js.
 *
 * Every page works without JavaScript and is server-rendered through openvibe-shared/shell (render/layout.js).
 * Nothing here reads anything about a person except their own rows on /me, and no page ever shows one person
 * another's progress.
 */
const ovServe = require('openvibe-shared/serve');
const frame = require('openvibe-shared/frame');
const showcase = require('openvibe-shared/showcase');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { html, raw, table } = require('../render/html');
const { send } = require('../render/layout');
const quests = require('../render/quests');
const catalog = require('../quests/catalog');
const store = require('../quests/store');

const SITE_NAME = 'OpenVibe.Quest';
const TAGLINE = 'Quests across the whole network.';
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const siteName = (domain) => (catalog.SITES[domain] || {}).name || domain;

/**
 * A quest page's meta description (≤ 160 characters): why it matters, where it happens, what it counts and its badge.
 * It was the "why" line alone ("An answer is worth more than a read."), which says nothing about the quest.
 */
function questDescription(quest) {
    const steps = quest.steps.map((st) => (st.count > 1 ? `${st.label} ×${st.count}` : st.label)).join(', ');
    const badge = quest.reward && quest.reward.badge && quest.reward.badge.name ? ` Badge: ${quest.reward.badge.name}.` : '';
    const text = `${String(quest.why || '').trim().replace(/[.!?]*$/, '.')} A quest on ${siteName(quest.site)}: ${steps}.${badge}`;
    return text.length <= 160 ? text : `${text.slice(0, 159).replace(/\s+\S*$/, '')}…`;
}

function createPageRoutes(ctx) {
    const { config, s, coins } = ctx;
    const r = asyncRouter();
    const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 300 });
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.subject;
    const coinsUi = { coinsEnabled: coins.enabled, dailyCap: config.coins.dailyCap, globalDailyCap: config.coins.globalDailyCap };

    /**
     * Every event Quest listens to (and the one it does not). The home page lists the names; /how-it-works spells
     * out what each one means — the list is built from the same catalog, so the page cannot claim less than the
     * consumer really subscribes to.
     */
    const eventsTable = ({ detailed = false } = {}) => table(
        detailed ? ['Event', 'From', 'What it means'] : ['Event', 'From'],
        catalog.EVENTS.map((e) => [
            html`<code>${e.event_type}</code>`,
            html`<a href="https://${e.site}">${siteName(e.site)}</a>`,
            ...(detailed ? [html`${e.what}${e.counted === false ? ' Nothing is stored for it.' : ''}`] : []),
        ]),
        { empty: 'No events.' });

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const appList = ctx.appQuests ? await ctx.appQuests.listed(24) : [];
        const hero = showcase.hero({
            eyebrow: `${SITE_NAME} · ${TAGLINE}`,
            title: 'Quests across OpenVibe.',
            accent: 'Badges for what you really do.',
            lede: `${SITE_NAME} is the network's shared quest log: one place that knows what you have really done on the OpenVibe sites it follows, and rewards it with badges${coinsUi.coinsEnabled ? ' and OpenCoins' : ' (and OpenCoins, once they are switched on)'}. Quest runs no activities of its own — it listens to what the sites already report, and nothing else.`,
            actions: signedIn(req)
                ? [{ label: 'Your quest log', href: '/me', primary: true }, { label: 'How it works', href: '/how-it-works' }]
                : [{ label: 'Sign in to start', href: '/auth/login?next=%2Fme', primary: true }, { label: 'How it works', href: '/how-it-works' }],
            note: 'Open source (AGPL-3.0). Rewards are badges and OpenCoins — loyalty points, never money, and never Vibes.',
        });
        page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE,
            description: 'One quest log across the OpenVibe sites: badges for what you really do on Live, Chat, Community, Games and more, built on real activity.',
            jsonLd: homeJsonLd(config),
            styles: [showcase.STYLESHEET],
            body: html`${raw(hero)}
${raw(showcase.features({
                title: 'What Quest is',
                lede: 'One quest log across eight OpenVibe sites (Live, the Network, Community, Chat, the Wiki, Games, Tools and Space), built on what the sites already tell the network.',
                items: [
                    { icon: 'ov:page', title: 'One log, many sites', text: 'A stream on OpenVibe.Live, a thread on OpenVibe.Community, a message in OpenVibe.Chat: the same log, grouped by the site the event came from.' },
                    { icon: 'ov:account', title: 'Rewards are badges', text: coinsUi.coinsEnabled ? 'A quest pays a badge that shows on your profile across the network, and OpenCoins into your OpenVibe.Network wallet.' : 'A quest pays a badge that shows on your profile across the network and, once they are switched on, OpenCoins.' },
                    { icon: 'ov:tools', title: 'OpenCoins, not Vibes', text: 'OpenCoins are loyalty points credited through OpenVibe.Network\'s wallet. They are never money, they are not Vibes, and Vibes are never touched here.' },
                    { icon: 'ov:games', title: 'Made by apps', text: 'A developer app defines quests on its own events with an app token (the SDK\'s quests): they pay a badge named for the app, never OpenCoins. Quests a streamer writes come later.' },
                ],
            }))}
<section class="sc-sec" id="the-quests" aria-labelledby="the-quests-h"><h2 id="the-quests-h">The quests</h2>
<p class="sc-lede">Every quest below counts something a person really did on an OpenVibe site. Grouped by the site whose events it counts.</p>
${quests.list(catalog.grouped({ fold: true }), coinsUi)}
${quests.coinsNote(coinsUi)}</section>
${appList.length ? html`<section class="sc-sec" id="app-quests" aria-labelledby="app-quests-h"><h2 id="app-quests-h">Made by apps</h2>
<p class="sc-lede">Quests that developer apps on OpenVibe define on their own events. Each pays a badge named for the app, never OpenCoins.</p>
<ul class="quest-list">${appList.map((q) => html`<li class="quest-card"><h3><a href="/apps/quests/${q.id}">${q.title}</a></h3>${q.why ? html`<p>${q.why}</p>` : ''}<p class="muted">Badge: ${q.reward.badge.name}${q.url ? html` · <a href="${q.url}" rel="nofollow noopener">Where to do it</a>` : ''}</p></li>`)}</ul></section>` : ''}
<section class="sc-sec" id="how-progress-works" aria-labelledby="how-progress-works-h"><h2 id="how-progress-works-h">How progress works</h2>
<p class="sc-lede">Quest does not watch you and does not ask the sites who you are. The network's event backbone,
OpenVibe.Events, delivers the domain events a site already emits, and Quest counts the ones below — one per real
action, with the person taken from the field the event's own schema defines. Nothing else is tracked: no page
views, no clicks, no watch time, and no content you wrote.</p>
${eventsTable()}
<p class="sc-note">What each one means is on <a href="/how-it-works">How it works</a>. That list is the whole of it. A quest completes when every one of its steps reaches its count;
the completion, its badge and its OpenCoins are recorded once. <a href="/how-it-works">The rules, in full</a>.</p></section>
${raw(showcase.cta({
                title: signedIn(req) ? 'Your quest log is waiting' : 'Start your quest log',
                text: signedIn(req) ? 'Your progress, your badges, and what each quest still needs.' : 'Sign in with OpenVibe and the sites you already use start counting.',
                actions: signedIn(req) ? [{ label: 'Your quest log', href: '/me', primary: true }] : [{ label: 'Sign in with OpenVibe', href: '/auth/login?next=%2Fme', primary: true }],
            }))}`,
        });
    });

    // ── An app quest (server/quests/app-quests.js) ──────────
    r.get('/apps/quests/:id', async (req, res) => {
        const quest = ctx.appQuests ? await ctx.appQuests.byId(req.params.id) : null;
        if (!quest || quest.env !== 'production') return page(req, res, {
            title: 'No such quest',
            body: html`<h1>No such quest</h1><p>There is no app quest at this address. <a href="/#app-quests">Quests made by apps</a> lists them.</p>`,
        }, 404);
        const mine = signedIn(req) && SUBJECT_RE.test(req.viewer.subject);
        const [rows, completion, holders] = await Promise.all([
            mine ? store.progressOf(s.db, req.viewer.subject, quest.id) : [],
            mine ? store.completion(s.db, req.viewer.subject, quest.id) : null,
            store.badgeHolders(s.db, quest.reward.badge.id),
        ]);
        const seen = new Map(rows.map((x) => [Number(x.step), Number(x.count)]));
        return page(req, res, {
            index: quest.status === 'active', cache: mine ? null : PUBLIC_CACHE,
            title: quest.title, description: quest.why || `${quest.title}: a quest an OpenVibe app made.`,
            crumbs: [{ label: 'Quests', href: '/' }, { label: 'Made by apps', href: '/#app-quests' }, { label: quest.title }],
            body: html`<h1>${quest.title}</h1>
${quest.why ? html`<p class="lede">${quest.why}</p>` : ''}
<p class="muted">Made by an OpenVibe developer app (project <code>${quest.project_id}</code>)${quest.url ? html` · <a href="${quest.url}" rel="nofollow noopener">Where to do it</a>` : ''}.${quest.status === 'retired' ? ' Retired: it no longer counts.' : ''}</p>
<h2>What it counts</h2>
<ul class="steps">${quest.steps.map((step, i) => html`<li><strong>${step.label}</strong> — ${step.count}× <code>${step.event_type}</code>${(seen.get(i) || 0) >= step.count ? html` <span class="done">done</span>` : ''}</li>`)}</ul>
<h2>The reward</h2>
<p>The badge <strong>${quest.reward.badge.name}</strong>. App quests never pay OpenCoins.</p>
<p class="muted">${holders ? html`${holders} ${holders === 1 ? 'person has' : 'people have'} this badge.` : 'A badge is awarded once and kept.'}</p>
${completion ? html`<div class="notice" role="status">You completed this quest on <strong>${String(completion.completed_at).slice(0, 10)}</strong>.</div>` : ''}
<p><a href="/">All quests</a></p>`,
        });
    });

    // ── One quest ────────────────────────────────────────────
    r.get('/quests/:id', (req, res) => {
        const quest = catalog.byId(req.params.id);
        if (!quest) return page(req, res, {
            title: 'No such quest',
            body: html`<h1>No such quest</h1><p>There is no quest at this address. <a href="/">The quest list</a> has all ${catalog.all().length} of them.</p>`,
        }, 404);

        const viewer = req.viewer;
        const mine = signedIn(req) && SUBJECT_RE.test(viewer.subject);
        const load = async () => {
            if (!mine) return null;
            const [rows, completion, holders] = await Promise.all([
                store.progressOf(s.db, viewer.subject, quest.id),
                store.completion(s.db, viewer.subject, quest.id),
                store.badgeHolders(s.db, quest.reward.badge.id),
            ]);
            return { seen: new Map(rows.map((x) => [Number(x.step), Number(x.count)])), completion, holders };
        };
        return load().then((state) => page(req, res, {
            index: true, cache: mine ? null : PUBLIC_CACHE,
            title: quest.title,
            description: questDescription(quest),
            crumbs: [{ label: 'Quests', href: '/' }, { label: quest.title }],
            body: html`<h1>${quest.title}</h1>
<p class="lede">${quest.why}</p>
<p class="muted">On <a href="https://${quest.site}">${siteName(quest.site)}</a>${quest.series && catalog.SERIES[quest.series] ? html`, in <a href="/series/${quest.series}">${catalog.SERIES[quest.series].title}</a>` : ''}.</p>
<h2>What it counts</h2>
<ul class="steps">${quest.steps.map((step, i) => html`<li><strong>${step.label}</strong> — ${step.count}× <code>${step.event_type}</code>${Object.entries(step.match || {}).map(([k, v]) => html` with <code>${k}</code> <code>${String(v)}</code>`)}${state && (state.seen.get(i) || 0) >= step.count ? html` <span class="done">done</span>` : ''}</li>`)}</ul>
<h2>The reward</h2>
<p>${quests.reward(quest, coinsUi)}</p>
<p class="muted">${state && state.holders ? html`${state.holders} ${state.holders === 1 ? 'person has' : 'people have'} this badge.` : html`A badge is awarded once and kept.`}</p>
${state && state.completion ? html`<div class="notice" role="status">You completed this quest on <strong>${String(state.completion.completed_at).slice(0, 10)}</strong>${coinsUi.coinsEnabled && state.completion.coins_state === 'credited' ? html`, and its OpenCoins are in your wallet` : ''}.</div>` : html`<p><a href="/me">Your quest log</a> keeps your progress.</p>`}
${quests.coinsNote(coinsUi)}
<p><a href="/">All quests</a></p>`,
        }));
    });

    // ── A series: its quests, and which of them the person has done ──
    r.get('/series/:id', async (req, res) => {
        const series = catalog.seriesById(req.params.id);
        if (!series) return page(req, res, {
            title: 'No such series',
            body: html`<h1>No such series</h1><p>There is no quest series at this address. <a href="/">The quest list</a> has every quest.</p>`,
        }, 404);
        const mine = signedIn(req) && SUBJECT_RE.test(req.viewer.subject);
        const done = new Set(mine ? (await store.completionsFor(s.db, req.viewer.subject)).map((c) => c.quest_id) : []);
        const finished = series.quests.filter((q) => done.has(q.id)).length;
        return page(req, res, {
            index: true, cache: mine ? null : PUBLIC_CACHE,
            title: series.title,
            description: series.why,
            crumbs: [{ label: 'Quests', href: '/' }, { label: series.title }],
            body: html`<h1>${series.title}</h1>
<p class="lede">${series.why}</p>
<p class="muted">On <a href="https://${series.site}">${siteName(series.site)}</a>. ${series.how} <a href="${series.href}">${series.hrefLabel}</a>.</p>
${mine ? quests.progress('Your progress', finished, series.quests.length) : ''}
<ul class="quest-list">${series.quests.map((q) => quests.card(q, { ...coinsUi, earned: done.has(q.id) }))}</ul>
${quests.coinsNote(coinsUi)}
<p><a href="/">All quests</a>${mine ? html` · <a href="/me">Your quest log</a>` : ''}</p>`,
        });
    });

    // ── Your quest log ───────────────────────────────────────
    r.get('/me', async (req, res) => {
        if (!signedIn(req)) return page(req, res, {
            title: 'Your quest log',
            body: html`<h1>Your quest log</h1>
<p>Quest keeps one log per person, across every site. Sign in with OpenVibe to see yours: what you have done, what
each quest still needs, and the badges you have earned.</p>
<p><a href="/auth/login?next=%2Fme">Sign in with OpenVibe</a></p>
<p class="muted">Your progress is read from this site's database only, and only for you. Nobody else's log is shown here, and yours is not shown on anyone else's.</p>
<p><a href="/how-it-works">How progress works</a> · <a href="/">The quests</a></p>`,
        });

        const subject = req.viewer.subject;
        const [progress, completions, badges, creditedToday] = await Promise.all([
            store.progressFor(s.db, subject),
            store.completionsFor(s.db, subject),
            store.badgesFor(s.db, subject),
            store.creditedTo(s.db, subject, store.dayOf(s.now())),
        ]);
        const seen = new Map();
        for (const row of progress) {
            const list = seen.get(row.quest_id) || new Map();
            list.set(Number(row.step), Number(row.count));
            seen.set(row.quest_id, list);
        }
        const done = new Map(completions.map((c) => [c.quest_id, c]));
        const questState = (q) => (done.has(q.id) ? 'done' : (seen.get(q.id) && seen.get(q.id).size && [...(seen.get(q.id).values())].some((n) => n > 0) ? 'started' : 'new'));
        const started = catalog.all().filter((q) => questState(q) === 'started');
        const finished = catalog.all().filter((q) => questState(q) === 'done');
        const badge = (id) => catalog.badgeById(id) || { id, name: (ctx.appQuests && ctx.appQuests.badgeName(id)) || id };

        return page(req, res, {
            title: 'Your quest log',
            crumbs: [{ label: 'Quests', href: '/' }, { label: 'Your quest log' }],
            body: html`<h1>Your quest log</h1>
<p class="muted">Signed in as <strong>${req.viewer.displayName || req.viewer.username || 'you'}</strong>. One log across every OpenVibe site.</p>
<h2>In progress</h2>
${started.length ? started.map((q) => html`<section class="quest-block"><h3><a href="/quests/${q.id}">${q.title}</a> <small>on ${siteName(q.site)}</small></h3>
${q.steps.map((step, i) => quests.progress(step.label, (seen.get(q.id) || new Map()).get(i) || 0, step.count))}
<p class="quest-reward">${quests.reward(q, coinsUi)}</p></section>`) : html`<p class="muted">Nothing started yet. <a href="/">Pick a quest</a> — any of the sites you already use counts.</p>`}
<h2>Completed</h2>
${finished.length ? html`<ul class="quest-list">${finished.map((q) => {
                const c = done.get(q.id);
                return html`<li class="quest"><a class="quest-title" href="/quests/${q.id}">${q.title}</a>
<p class="quest-why">Completed ${String(c.completed_at).slice(0, 10)}. Badge: <strong>${q.reward.badge.name}</strong>. ${q.reward.item ? (c.item_state === 'granted' ? html`${q.reward.item.emoji} <strong>${q.reward.item.name}</strong> is in <a href="https://inventory.openvibe.network/me">your inventory</a>. ` : c.item_state === 'failed' ? html`${q.reward.item.name} could not be given yet — this is recorded and retried. ` : html`${q.reward.item.name} is on its way to your inventory. `) : ''}${c.coins > 0 ? (c.coins_state === 'credited' ? html`<strong>${c.coins}</strong> OpenCoins credited.` : c.coins_state === 'skipped' ? html`${c.coins} OpenCoins ${coinsUi.coinsEnabled ? html`were not credited: ${c.coins_error || 'the daily cap was reached'}` : html`start soon`}.` : html`${c.coins} OpenCoins could not be credited yet — this is recorded and retried.`) : ''}</p></li>`;
            })}</ul>` : html`<p class="muted">No quests completed yet.</p>`}
<h2>Your badges</h2>
${badges.length ? html`<ul class="badges">${badges.map((b) => html`<li><strong>${badge(b.badge_id).name}</strong> <small>${String(b.awarded_at).slice(0, 10)}</small></li>`)}</ul>
<p class="muted">Anyone can see these three facts at <code>/api/v1/profiles/${subject}/badges</code>: the badge's id, its name and the date. Nothing else about you is ever in that answer.</p>` : html`<p class="muted">No badges yet.</p>`}
${quests.coinsNote(coinsUi)}
${coinsUi.coinsEnabled ? html`<p class="muted">Credited today: <strong>${creditedToday}</strong> of ${coinsUi.dailyCap} OpenCoins.</p>` : ''}
<h2>Not started</h2>
${catalog.all().filter((q) => questState(q) === 'new').length
                ? html`<p>${catalog.all().filter((q) => questState(q) === 'new').map((q, i) => html`${i ? ', ' : ''}<a href="/quests/${q.id}">${q.title}</a>`)}</p>`
                : html`<p class="muted">Every quest is started or done.</p>`}`,
        });
    });

    // ── The rules ────────────────────────────────────────────
    r.get('/how-it-works', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE,
        title: 'How quests work',
        description: 'What OpenVibe.Quest counts, what it stores, and what its rewards are — and are not.',
        crumbs: [{ label: 'Quests', href: '/' }, { label: 'How it works' }],
        body: html`<h1>How quests work</h1>
<p class="lede">Everything on this page is the whole truth about what Quest does with your activity. If it is not
here, Quest does not do it.</p>

<h2>What moves a quest</h2>
<p>OpenVibe.Events delivers the domain events that OpenVibe sites already emit when something really happens. Quest
counts the ones below, and takes the person from the field the event's own schema defines — never from a name, never
by guessing. An event whose person field is missing, or names a guest or a service instead of a person, is ignored
and nothing is stored.</p>
${eventsTable({ detailed: true })}
<p>Nothing else is tracked. Quest stores no page views, no clicks, no watch time, and no content you wrote — not a
message's text, not a thread's title, not a wiki revision's text. A message in a private chat room or a direct
message never reaches Quest at all: OpenVibe.Chat only emits <code>chat.room.message.created</code> for public
rooms.</p>

<h2>What is stored</h2>
<p>Three things, all keyed by your canonical subject (<code>usr_…</code>):</p>
<ul>
<li>a count per quest step — for example "2 of 3 streams";</li>
<li>one row per quest you completed, with when, and what happened to its OpenCoins;</li>
<li>one row per badge you were awarded, with the date.</li>
</ul>
<p>The only thing anyone else can read about you is that badge list: GET /api/v1/profiles/${'<subject>'}/badges
answers the badge's id, its name and the date, and nothing else — no counts, no progress, no completions, no person.</p>

<h2>Rewards</h2>
<p>A quest pays a <strong>badge</strong> — a text label on your profile, awarded once — and, when OpenCoins are on,
<strong>OpenCoins</strong>. OpenCoins are loyalty points credited through OpenVibe.Network's wallet. They are
<strong>never money</strong>, they are not <strong>Vibes</strong>, and Quest neither reads nor moves money anywhere.
Vibes are real money and belong to the sites that pay them out; nothing on this service touches them.</p>
${quests.coinsNote(coinsUi)}
<p>When a completion earns OpenCoins, Quest asks OpenVibe.Network to credit them with an idempotency key — so a
retry of a credit that did land can never pay twice. If the wallet refuses or is unreachable, the failure is
recorded with its reason and retried; nothing is silently dropped. A completion over a daily cap is marked
<em>skipped</em> with the reason, and the quest itself is still completed and still pays its badge.</p>

<h2>Your account and your quests</h2>
<ul>
<li>Every quest completes once per person.</li>
<li>Quests come from OpenVibe and from developers' apps (on their own app's events, badges only). Communities and
streamers do not write quests: a quest sends people to do something.</li>
<li>Deleting your OpenVibe account deletes your progress, completions and badges here, and an account export includes
them (ADR-033).</li>
<li>When two of your OpenVibe accounts are merged, everything here moves to the account you keep: each step keeps the
higher count, a quest both finished counts once, and each badge keeps its first award (ADR-029).</li>
</ul>
<p><a href="/">The quests</a> · <a href="/updates">What shipped</a></p>`,
    }));

    // ── The update log ───────────────────────────────────────
    r.get('/updates', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE,
        title: `What shipped on ${SITE_NAME}`,
        description: 'Every change deployed to OpenVibe.Quest, newest first, from the OpenVibe network\'s shared update log.',
        body: raw(frame.updatesBody({ service: 'quest', siteName: SITE_NAME }) + `<script src="${ovServe.url('shipped.js')}" defer></script>`),
    }));

    // ── Discovery: robots.txt, sitemap.xml, llms.txt, llms-full.txt ──
    r.use(createDiscoveryRoutes(ctx));
    return r;
}

module.exports = { createPageRoutes };
