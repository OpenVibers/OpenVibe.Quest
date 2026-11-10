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
const kit = require('openvibe-shared/kit');
// The home's stylesheets: the showcase (hero, sections), then the kit's controls and its cards and rails (room.css).
const KIT_STYLES = [showcase.STYLESHEET, 'kit.css', 'room.css'];
// A person's stuff across the network (openvibe-shared 4.13 profile-panel: items, badges, achievements), shown once the
// pinned openvibe-shared serves it; before that the section is simply not there.
const HAS_PROFILE_PANEL = require('openvibe-shared/files').isBrowserFile('profile-panel.js');
const USERNAME_RE = /^[A-Za-z0-9_]{1,32}$/;
const cache = require('openvibe-shared/cache-policy');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { html, raw, table } = require('../render/html');
const { send } = require('../render/layout');
const quests = require('../render/quests');
const icons = require('../render/quest-icons');
const { nameForBadge, nameForDaily } = require('../quests/glyph-drafts');
const S = require('../render/short');
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
    r.get('/levels', async (req, res) => {
        res.set('Cache-Control', req.viewer?.kind === 'user' ? 'private, no-store' : 'public, max-age=30');
        const client = ctx.levels.readClient(req.viewer?.token);
        let board, mine;
        try {
            [board, mine] = await Promise.all([client.board(), req.viewer?.username ? client.get(req.viewer.username) : null]);
        } catch { return page(req, res, { title: 'Levels', body: html`<h1>Levels</h1><p>Experience is temporarily unavailable. Try again shortly.</p>` }, 503); }
        const renderBoard = (label, data) => html`<section><h2>${label}</h2><ol>${data.top.map(e => html`<li value="${e.rank}"><a href="https://openvibe.network/@${encodeURIComponent(e.username)}">${e.username}</a> — Level ${e.level} · ${e.xp} experience</li>`)}</ol>${data.me ? html`<p>Your place: ${data.me.rank}</p><ol>${data.around.map(e => html`<li value="${e.rank}">${e.username} — Level ${e.level} · ${e.xp} experience</li>`)}</ol>` : ''}</section>`;
        return page(req, res, { title: 'Levels', styles: KIT_STYLES, body: html`<h1>Levels</h1>
            ${mine ? html`<section><h2>Your level: ${mine.level}</h2><p>${mine.xp} experience · ${mine.next_at - mine.xp} to the next level</p><progress aria-label="Experience to next level" value="${mine.into}" max="${mine.span}"></progress><h3>Recent experience</h3><ul>${mine.recent.map(e => html`<li>${e.name} · ${e.amount} · <time datetime="${e.at}">${e.at.slice(0, 10)}</time></li>`)}</ul></section>` : html`<p><a href="/me">Sign in to see your level</a></p>`}
            ${renderBoard('All time', board.all_time)}${renderBoard('This week', board.week)}
            <section><h2>How experience is earned</h2><p>Earned OpenCoins add the same amount of experience. Finishing a platform quest adds 25 extra experience. Experience is never bought or spent.</p><p><a href="https://openvibe.network/my#profile">Choose whether to appear on the leaderboard</a>. Your profile still shows your level.</p></section>` });
    });
    const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 300 });
    // The pages with a Markdown twin (openvibe-shared/agent-layer): the public ones only.
    const TWIN_PATH_RE = /^\/(?:how-it-works|build-a-step-type|updates|quests|quests\/[^/]+|series\/[^/]+|apps\/quests\/[^/]+)?$/;
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, agentLayer: TWIN_PATH_RE.test(String(req.path || '/').split('?')[0]), llms: '/llms.txt', ...o });
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
    // The home's figures (store.totals, store.completionsByQuest): counts only, read at most once a minute.
    let pulseMemo = null;
    const pulse = async () => {
        const now = s.now();
        if (pulseMemo && now - pulseMemo.at < 60_000) return pulseMemo.value;
        const since = new Date(now - 7 * store.DAY_MS).toISOString();
        const [totals, byQuest] = await Promise.all([store.totals(s.db, since), store.completionsByQuest(s.db)]);
        const value = { ...totals, byQuest: new Map(byQuest.map((r) => [r.quest_id, Number(r.n)])) };
        pulseMemo = { at: now, value };
        return value;
    };
    const siteCount = Object.keys(catalog.SITES).length;
    const siteKey = (domain) => quests.shortSite(domain).toLowerCase();

    // The numbers under the hero: one strip of the shared kit (kit.stats; it scrolls sideways on a phone instead of
    // stacking tiles), each only when it has something to say (a zero is left out).
    const statsStrip = (p) => raw(kit.stats([
        [catalog.all().length, `quests on ${siteCount} sites`],
        [Number(p.completions) || 0, Number(p.completions) === 1 ? 'quest finished' : 'quests finished'],
        [Number(p.people) || 0, Number(p.people) === 1 ? 'person with badges' : 'people with badges'],
        [Number(p.recent) || 0, 'finished this week'],
        coinsUi.coinsEnabled ? [Number(p.coins) || 0, 'OpenCoins given'] : null,
    ].filter(Boolean), { label: `${SITE_NAME} in numbers` }));

    /**
     * What the home offers as cards: every quest outside a series and each series as one, in the catalog's site order,
     * with how many hold its badge (a series: the badges earned across it). Counts only, never who.
     */
    const homeEntries = (p) => catalog.grouped({ fold: true }).flatMap((g) => [
        ...g.quests.map((q) => ({ q, n: p.byQuest.get(q.id) || 0 })),
        ...(g.series || []).map((x) => ({ x, n: x.quests.reduce((sum, q) => sum + (p.byQuest.get(q.id) || 0), 0) })),
    ]);
    const entryCard = (e) => (e.x ? quests.seriesKitCard(e.x, { earned: e.n }) : quests.kitCard(e.q, { coinsEnabled: coinsUi.coinsEnabled, earned: e.n }));

    /** Which sites Quest follows and the events each reports: the whole of what moves a quest. */
    const followed = () => {
        const bySite = new Map();
        for (const e of catalog.EVENTS) {
            if (e.counted === false) continue;
            if (!bySite.has(e.site)) bySite.set(e.site, []);
            bySite.get(e.site).push(e.event_type);
        }
        return bySite;
    };
    const sitesFollowed = () => html`<ul class="q-sites">${[...followed()].map(([site, events]) => html`<li><a href="https://${site}">${siteName(site)}</a><small>${(catalog.SITES[site] || {}).what || ''}</small><span>${events.map((ev, i) => html`${i ? ' ' : ''}<code>${ev}</code>`)}</span></li>`)}</ul>`;

    const FAQ = [
        { q: 'What is OpenVibe.Quest?', a: `One quest log for the OpenVibe sites. It counts what you really do on ${siteCount} of them, like going live, posting in the forum or publishing a world, and pays a badge for each quest you finish.` },
        { q: 'How do I start?', a: 'Use the OpenVibe sites while signed in to your OpenVibe account: what you do there counts, with nothing to join first. Sign in here to see your quest log and your badges.' },
        { q: 'What are OpenCoins?', a: 'Loyalty points credited to your OpenVibe.Network wallet when a quest pays them, within a daily cap. They are never money and never Vibes.' },
        { q: 'What does Quest track about me?', a: 'Only the events listed under How it works, one per real action. No page views, no clicks, no watch time and nothing you wrote. Private chat rooms and direct messages never reach Quest.' },
        { q: 'Can other people see my progress?', a: 'No. Your log is yours alone. The only public part is your badge list: each badge\'s name and the date you earned it.' },
        { q: 'Can developers add quests?', a: 'Yes. A developer app defines quests on its own events with an app token through the OpenVibe SDK. They pay a badge named for the app, never OpenCoins.' },
    ];

    // The home is a taste and a door (owner 2026-10-28: "act more like an app, not a huge long web page"): the hero,
    // one strip of numbers, the quests as rails of cards with See all → /quests and the sites as quick filters, and
    // the parts read once (how it works, what is counted, the questions) as folds. The whole catalog is /quests.
    /**
     * The home on a phone (the owner's short-pages rule, 2026-10-30): the parts a reader rarely needs — how it works
     * and the questions — are folds, closed on a phone and open where there is room. Both stay in the page.
     */
    function foldedHome(body) {
        let html = String(body);
        html = S.foldSection(html, 'id="how-it-works" aria-labelledby', 'how-it-works-fold');
        html = S.foldSection(html, 'id="questions" aria-labelledby', 'questions-fold');
        return html;
    }

    // Today's quest: one card. Its head is the day in words and the quest's own icon; each step is one row to press
    // (the whole row is the link), with a tick when it is done; the foot says where the person stands and how many
    // people finished today. The developer's link ("Build a step type") is with the other developer links, in How it
    // works: it is not a step of today's quest.
    const dayWords = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); };
    // One renderer for the home (where its title is the page's h1) and the catalog (an h2): they were two cards
    // with different markup, wording and dates for the same quest.
    function dailyCardOf(req, daily, approvedGlyphs, tag = 'h1') {
        const stepCount = daily.steps.length;
        const doneCount = daily.steps.filter((x) => x.done).length;
        const finishedToday = Number(daily.finished_today) || 0;
        return html`<section class="q-daily" aria-labelledby="daily-title">
<header class="q-daily-head"><span class="q-daily-icon">${icons.glyph('spark', 28, approvedGlyphs.get(nameForDaily(daily.date)))}</span><p class="q-daily-kicker"><b>Today's quest</b><time datetime="${daily.date}">${dayWords(daily.date)}</time></p></header>
${raw(`<${tag} id="daily-title" class="q-daily-title">`)}${daily.title}${raw(`</${tag}>`)}<p class="q-daily-story">${daily.story}</p>
<ol class="q-daily-steps">${daily.steps.map((step) => html`<li${step.done ? raw(' class="is-done"') : ''}><a href="${step.href}"><span class="q-daily-ic">${icons.glyph(step.done ? 'check' : icons.topic(step.event_type, step.site), 22)}</span><span class="q-daily-t"><b>${step.sentence}</b><small>${step.done ? 'Done · ' : ''}${step.site}</small></span><span class="q-daily-go" aria-hidden="true"></span></a></li>`)}</ol>
<p class="q-daily-foot">${signedIn(req)
        ? html`<span class="q-daily-dots" role="img" aria-label="${doneCount} of ${stepCount} steps done">${daily.steps.map((x) => html`<i${x.done ? raw(' class="is-on"') : ''}></i>`)}</span><b>${doneCount} of ${stepCount}</b>${Number(daily.streak) > 1 ? html`<span>${daily.streak}-day streak</span>` : ''}`
        : html`<a class="ovk-btn ovk-btn--primary" href="/auth/login?next=${encodeURIComponent(req.path || '/')}">Sign in to track it</a>`}${finishedToday ? html`<span class="q-daily-n">${finishedToday.toLocaleString('en-US')} ${finishedToday === 1 ? 'person' : 'people'} finished today</span>` : ''}</p></section>`;
    }

    r.get('/', async (req, res) => {
        const [appList, p, approvedGlyphs] = await Promise.all([ctx.appQuests ? ctx.appQuests.listed(12) : [], pulse(), ctx.glyphs.approved()]);
        const daily = signedIn(req) ? await ctx.daily.progress(req.viewer.subject) : await ctx.daily.publicQuest();
        const past = await s.db.many('SELECT day,title FROM daily_quests WHERE day < $1 ORDER BY day DESC LIMIT 14', [daily.date]);
        const dailyCard = dailyCardOf(req, daily, approvedGlyphs, 'h1');
        // Earlier days, as a counted fold. A row is the day and the quest's name; it links nowhere (the only address a
        // past day has is its JSON, which is for programs, and is listed on How it works).
        const pastFold = past.length ? html`<details class="q-daily-past"><summary><span>Earlier daily quests</span><span class="q-daily-past-n">${past.length}</span></summary><ul>${past.map((x) => html`<li><time datetime="${x.day}">${dayWords(x.day)}</time><span>${x.title}</span></li>`)}</ul></details>` : '';
        const site = String(config.baseUrl).replace(/\/+$/, '');
        const total = catalog.all().length;
        // The navbar already says OpenVibe.Quest: the hero says what you get, in plain words, and where to start.
        const hero = showcase.hero({
            eyebrow: { icon: 'ov:quest', text: 'Free, nothing to install' },
            // The hero's picture is this site's own (2026-11-01): it drew the generic aura, the same on six homes.
            // The sites a quest is earned on circle the quest log, each linked.
            orbit: (() => {
                const ICON = { 'openvibe.live': 'live', 'openvibe.network': 'network', 'openvibe.community': 'community', 'openvibe.chat': 'chat', 'openvibe.wiki': 'wiki', 'openvibe.games': 'games', 'openvibe.tools': 'tools', 'openvibe.space': 'space', 'openvibe.blog': 'blog', 'openvibe.deals': 'deals', 'openvibe.run': 'run', 'inventory.openvibe.network': 'inventory', 'openvibe.bot': 'bot', 'openvibe.video': 'video', 'openvibe.pics': 'pics' };
                const sites = Object.entries(catalog.SITES).filter(([host]) => ICON[host]).map(([host, s]) => ({ icon: `ov:${ICON[host]}`, label: s.name.replace(/^OpenVibe\./, ''), href: `https://${host}/` }));
                return { label: `Quests on ${siteCount} OpenVibe sites`, center: { title: 'Quest log', sub: `${siteCount} sites` }, inner: sites.slice(0, 6), outer: sites.slice(6) };
            })(),
            title: 'Earn badges',
            accent: 'for what you already do on OpenVibe.',
            lede: `Go live, post in the forum, publish a world: every quest you finish on any of ${siteCount} OpenVibe sites earns a badge${coinsUi.coinsEnabled ? ' and OpenCoins' : ''}. One quest log follows you everywhere.`,
            actions: signedIn(req)
                ? [{ label: 'Your quest log', href: '/me', primary: true, icon: 'ov:quest' }, { label: 'Browse quests', href: '/quests', icon: 'ov:search' }]
                : [{ label: 'Start earning', href: '/auth/login?next=%2Fme', primary: true, icon: 'ov:quest' }, { label: 'Browse quests', href: '/quests', icon: 'ov:search' }],
            note: 'Badges, items and OpenCoins: loyalty points, never money. Open source (AGPL-3.0).',
        });
        // The first rail: what people finish most (the easy starts), then the rest in the catalog's order; the second:
        // the quests nobody has finished yet that the first one left out. Twelve each at most; /quests has them all.
        const entries = homeEntries(p);
        const first = entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.n - a.e.n || a.i - b.i).slice(0, 12).map(({ e }) => e);
        const open = entries.filter((e) => e.q && e.n === 0 && !first.includes(e)).slice(0, 12);
        const kinds = catalog.grouped().map((g) => ({ key: siteKey(g.site), label: quests.shortSite(g.site), count: g.quests.length + (g.series || []).reduce((n, x) => n + x.quests.length, 0) }));
        const events = [...followed()].reduce((n, [, list]) => n + list.length, 0);
        const fold = (o) => raw(kit.fold({ ...o, body: String(o.body) }));
        page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE,
            title: 'Earn badges for what you do on OpenVibe',
            description: `One quest log across ${siteCount} OpenVibe sites: finish quests by streaming, posting, chatting and playing, and earn badges, items and OpenCoins.`,
            jsonLd: [
                ...homeJsonLd(config),
                seo.jsonLd.itemList('OpenVibe quests', [
                    ...catalog.all().filter((q) => !q.series).map((q) => ({ name: q.title, url: `${site}/quests/${q.id}` })),
                    ...Object.values(catalog.SERIES).map((x) => ({ name: x.title, url: `${site}/series/${x.id}` })),
                ], { url: `${site}/` }),
                seo.jsonLd.faq(FAQ),
            ],
            // The kit's controls (numbers, filters, folds) and its cards and rails; no kit-web.js: the cards carry no
            // menu, and from 760 px the rails wrap into a grid instead of scrolling (public/css/app.css).
            styles: KIT_STYLES,
            body: raw(foldedHome(html`${dailyCard}${signedIn(req) ? raw(`<script>try{const z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z&&sessionStorage.getItem('quest-zone')!==z){fetch('/api/v1/me/daily/time-zone',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({time_zone:z})}).then(r=>{if(r.ok){sessionStorage.setItem('quest-zone',z);location.reload()}}).catch(()=>{})}}catch{}</script>`) : ''}${raw(hero)}
${statsStrip(p)}
${yourStuff(req)}
${pastFold}
<section class="sc-sec q-rails">
${raw(kit.rail({ id: 'the-quests', wrap: true, title: first.some((e) => e.n > 0) ? 'Badges people earn most' : 'Quests to start with', more: { href: '/quests', label: `See all ${total}` }, items: first.map(entryCard) }))}
<p class="q-kinds-h" aria-hidden="true">Quests by site</p>
${raw(kit.tabs({ base: '/quests', param: 'site', label: 'Quests by site', items: kinds }))}
${raw(kit.rail({ id: 'be-first', wrap: true, title: 'Nobody has these badges yet', items: open.map(entryCard) }))}
${raw(kit.rail({ id: 'app-quests', wrap: true, title: 'Made by apps', more: { href: '/quests#app-quests', label: 'See all' }, items: appList.map(quests.appKitCard) }))}
</section>
<section class="sc-sec q-folds" id="how-it-works" aria-labelledby="how-it-works-h"><h2 id="how-it-works-h">How it works</h2>
<p class="sc-lede">Quest runs no activities of its own: it counts what the sites already report, one count per real action. Nothing else is tracked: no page views, no clicks, no watch time and no content you wrote.</p>
${fold({ id: 'how-progress-works', title: 'From what you do to a badge', meta: '4 steps', body: html`<ol class="q-steps">
<li><strong>You do something on a site.</strong> Go live on OpenVibe.Live, reply in a forum thread, publish a creator world on OpenVibe.Games.</li>
<li><strong>The site reports it.</strong> The site sends the event it already emits to OpenVibe.Events, with the person named by the event's own schema.</li>
<li><strong>Quest counts it.</strong> One count per real action. When every step of a quest reaches its count, the quest is complete, once.</li>
<li><strong>You get the reward.</strong> The badge goes on your profile, an item goes to your inventory where the quest gives one, and OpenCoins go to your wallet.</li>
</ol>` })}
${fold({ id: 'rewards', title: 'Badges, items and OpenCoins', body: html`<p>One log, many sites: a stream on OpenVibe.Live, a thread on OpenVibe.Community, a message in OpenVibe.Chat, grouped by the site the event came from.</p>
<p>${coinsUi.coinsEnabled ? 'A quest pays a badge that shows on your profile across the network, and OpenCoins into your OpenVibe.Network wallet.' : 'A quest pays a badge that shows on your profile across the network and, once they are switched on, OpenCoins.'} Some quests also give an item for your OpenVibe inventory, worn in chat and on your profile.</p>
<p>OpenCoins are loyalty points credited through OpenVibe.Network's wallet. They are never money, they are not Vibes, and Vibes are never touched here. A quest a developer app defines on its own events pays a badge named for the app, never OpenCoins.</p>
${quests.coinsNote(coinsUi)}` })}
${fold({ id: 'sites-followed', title: 'The sites Quest follows', meta: `${followed().size} sites, ${events} events`, body: html`${sitesFollowed()}
<p class="sc-note">What each event means is on <a href="/how-it-works">How it works</a>, with what is stored and what is public. Building an app? <a href="/build-a-step-type">Suggest a step for the daily quest</a>.</p>` })}
</section>
<section class="sc-sec q-folds" id="questions" aria-labelledby="questions-h"><h2 id="questions-h">Questions</h2>
${FAQ.map((f) => fold({ title: f.q, body: html`<p>${f.a}</p>` }))}</section>
${raw(showcase.network({ service: 'quest' }))}
${raw(showcase.cta({
                title: signedIn(req) ? 'Your quest log is waiting' : 'Start your quest log',
                text: signedIn(req) ? 'Your progress, your badges, and what each quest still needs.' : 'Sign in with OpenVibe and the sites you already use start counting.',
                actions: signedIn(req) ? [{ label: 'Your quest log', href: '/me', primary: true }] : [{ label: 'Sign in with OpenVibe', href: '/auth/login?next=%2Fme', primary: true }],
            }))}`)),
        });
    });

    r.get('/build-a-step-type', async (req, res) => page(req, res, {
        title: 'Build a step type', description: 'Add a reviewable daily quest step using an OpenVibe.Events topic.', styles: KIT_STYLES,
        body: html`<main class="sc-sec q-doc"><h1>Build a step type</h1><p>Apps can suggest a daily step on an event Quest already verifies. A staff review is required before it can appear in a daily quest.</p>
<ol><li>Get an app token for openvibe.quest with <code>quest.steps.contribute</code>.</li><li>Choose a topic from <a href="/api/v1/step-types">the registry</a>. The event must identify the person who did it.</li><li>POST JSON to <code>/api/v1/step-types</code> with <code>id</code>, <code>event_type</code>, <code>site</code>, <code>sentence</code>, <code>href</code> and <code>weight</code> (1–5).</li><li>The API returns a pending type. Staff reviews it before the generator can select it.</li></ol>
<p>Each selected step needs one real event in the person's local day. The API gives the same quest to everyone; each person's progress remains private.</p></main>`,
    }));

    // ── Every quest: the index the home's See all opens, one site at a time (?site=), as the kit's tabs ──
    r.get('/quests', async (req, res) => {
        const groups = catalog.grouped({ fold: true });
        const keys = ['all', ...groups.map((g) => siteKey(g.site))];
        const active = kit.tabOf(req.query, keys, 'site');
        const shown = active === 'all' ? groups : groups.filter((g) => siteKey(g.site) === active);
        const mine = signedIn(req) && SUBJECT_RE.test(req.viewer.subject);
        const [appList, p, rows, completions, approvedGlyphs] = await Promise.all([
            active === 'all' && ctx.appQuests ? ctx.appQuests.listed(100) : [],
            pulse(),
            mine ? store.progressFor(s.db, req.viewer.subject) : [],
            mine ? store.completionsFor(s.db, req.viewer.subject) : [],
            ctx.glyphs.approved(),
        ]);
        const completed = new Map(completions.map((c) => [c.quest_id, c.completed_at]));
        const seen = new Map();
        for (const row of rows) {
            const list = seen.get(row.quest_id) || new Map();
            list.set(Number(row.step), Number(row.count));
            seen.set(row.quest_id, list);
        }
        const count = (g) => g.quests.length + (g.series || []).reduce((n, x) => n + x.quests.length, 0);
        const total = catalog.all().length;
        const one = active === 'all' ? null : shown[0];
        const daily = signedIn(req) ? await ctx.daily.progress(req.viewer.subject) : await ctx.daily.publicQuest();
        page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE,
            title: one ? `Quests on ${one.name}` : 'All quests',
            description: one
                ? `The ${count(one)} quest${count(one) === 1 ? '' : 's'} on ${one.name}: what each one counts and the badge it pays.`
                : `All ${total} OpenVibe quests on ${siteCount} sites, grouped by site: what each one counts, the badge it pays and how many people hold it.`,
            crumbs: [{ label: 'Quests', href: '/' }, { label: one ? one.name : 'All quests' }],
            styles: ['kit.css'],
            localStyles: ['css/quest-visual.css'],
            body: html`<h1>${one ? html`Quests on ${one.name}` : 'All quests'}</h1>
<p class="lede">${one ? html`${count(one)} quest${count(one) === 1 ? '' : 's'} on <a href="https://${one.site}">${one.name}</a>${one.what ? html`, ${one.what}` : ''}.` : html`${total} quests on ${siteCount} OpenVibe sites, grouped by the site whose events each one counts.`} Each pays a badge; how many people hold it is a count, never who.</p>
${daily ? dailyCardOf(req, daily, approvedGlyphs, 'h2') : ''}
${raw(kit.tabs({ base: '/quests', param: 'site', label: 'Quests by site', active, items: [{ key: 'all', label: 'All', count: total, href: '/quests' }, ...groups.map((g) => ({ key: siteKey(g.site), label: quests.shortSite(g.site), count: count(g) }))] }))}
${quests.list(shown, { ...coinsUi, counts: p.byQuest, seen: mine ? seen : null, completed: mine ? completed : null })}
${appList.length ? html`<section class="site-group" id="app-quests" aria-labelledby="app-quests-h"><h2 id="app-quests-h">Made by apps</h2>
<p class="muted">Quests that developer apps on OpenVibe define on their own events. Each pays a badge named for the app, never OpenCoins.</p>
<ul class="quest-list">${appList.map((q) => quests.appCard(q, { seen: mine ? (seen.get(q.id) || new Map()) : null, completedAt: mine ? (completed.get(q.id) || null) : null }))}</ul></section>` : ''}
${quests.coinsNote(coinsUi)}
<p><a href="/">Quests home</a> · <a href="/how-it-works">How it works</a></p>`,
        });
    });

    // ── A badge's picture (render/badge-art.js): the home's cards show the badge each quest pays ──
    const sendSvg = (req, res, body) => res.status(200).type('image/svg+xml').set('Cache-Control', cache.assetHeaders(req.path, { maxAge: 86400 })).send(body);
    r.get('/quests/:id/badge.svg', (req, res, next) => { const q = catalog.byId(req.params.id); return q ? sendSvg(req, res, quests.badgeSvg(q)) : next(); });
    r.get('/series/:id/badge.svg', (req, res, next) => { const x = catalog.seriesById(req.params.id); return x ? sendSvg(req, res, quests.seriesSvg(x)) : next(); });
    r.get('/apps/quests/:id/badge.svg', async (req, res, next) => {
        const q = ctx.appQuests ? await ctx.appQuests.byId(req.params.id) : null;
        return q && q.env === 'production' && q.status === 'active' ? sendSvg(req, res, quests.badgeSvg(q)) : next();
    });

    // ── An app quest (server/quests/app-quests.js) ──────────
    r.get('/apps/quests/:id', async (req, res) => {
        const quest = ctx.appQuests ? await ctx.appQuests.byId(req.params.id) : null;
        if (!quest || quest.env !== 'production') return page(req, res, {
            title: 'No such quest',
            body: html`<h1>No such quest</h1><p>There is no app quest at this address. <a href="/quests#app-quests">Quests made by apps</a> lists them.</p>`,
        }, 404);
        const mine = signedIn(req) && SUBJECT_RE.test(req.viewer.subject);
        const [rows, completion, holders] = await Promise.all([
            mine ? store.progressOf(s.db, req.viewer.subject, quest.id) : [],
            mine ? store.completion(s.db, req.viewer.subject, quest.id) : null,
            store.badgeHolders(s.db, quest.reward.badge.id),
        ]);
        const seen = new Map(rows.map((x) => [Number(x.step), Number(x.count)]));
        const shown = completion ? new Map(quest.steps.map((s, i) => [i, s.count])) : seen;
        return page(req, res, {
            index: quest.status === 'active', cache: mine ? null : PUBLIC_CACHE,
            title: quest.title, description: quest.why || `${quest.title}: a quest an OpenVibe app made.`,
            crumbs: [{ label: 'Quests', href: '/' }, { label: 'Made by apps', href: '/quests#app-quests' }, { label: quest.title }],
            body: html`<h1>${quest.title}</h1>
${quest.why ? html`<p class="lede">${quest.why}</p>` : ''}
<p class="muted">Made by an OpenVibe developer app (project <code>${quest.project_id}</code>)${quest.url ? html` · <a href="${quest.url}" rel="nofollow noopener">Where to do it</a>` : ''}.${quest.status === 'retired' ? ' Retired: it no longer counts.' : ''}</p>
<p>${quests.stateChip(Boolean(completion), quest.status === 'retired')}</p>
<h2>What it counts</h2>
<ul class="steps">${quest.steps.map((step, i) => html`<li><strong>${step.label}</strong> — ${step.count}× <code>${step.event_type}</code>${(shown.get(i) || 0) >= step.count ? html` <span class="done">done</span>` : ''}</li>`)}</ul>
${mine ? html`<h2>Your progress</h2>
${quest.steps.map((step, i) => quests.progress(step.label, shown.get(i) || 0, step.count, quests.unitOf(step)))}` : ''}
<h2>The reward</h2>
<p>The badge <strong>${quest.reward.badge.name}</strong>. App quests never pay OpenCoins.</p>
<p class="muted">${holders ? html`${holders} ${holders === 1 ? 'person has' : 'people have'} this badge.` : 'A badge is awarded once and kept.'}</p>
${completion ? html`<div class="notice ok" role="status">Completed on <strong><time datetime="${completion.completed_at}">${String(completion.completed_at).slice(0, 10)}</time></strong>. Badge earned: <strong>${quest.reward.badge.name}</strong>.</div>` : ''}
<p><a href="/quests">All quests</a></p>`,
        });
    });

    // ── One quest ────────────────────────────────────────────
    r.get('/quests/:id', (req, res) => {
        const quest = catalog.byId(req.params.id);
        if (!quest) return page(req, res, {
            title: 'No such quest',
            body: html`<h1>No such quest</h1><p>There is no quest at this address. <a href="/quests">The quest list</a> has all ${catalog.all().length} of them.</p>`,
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
        return load().then((state) => {
            // A completion means every step reached its target, even if no progress row was written for this step.
            const seen = state ? (state.completion ? new Map(quest.steps.map((s, i) => [i, s.count])) : state.seen) : null;
            return page(req, res, {
                index: true, cache: mine ? null : PUBLIC_CACHE,
                title: quest.title,
                description: questDescription(quest),
                crumbs: [{ label: 'Quests', href: '/' }, { label: quest.title }],
                body: html`<h1>${quest.title}</h1>
<p class="lede">${quest.why}</p>
<p class="muted">On <a href="https://${quest.site}">${siteName(quest.site)}</a>${quest.series && catalog.SERIES[quest.series] ? html`, in <a href="/series/${quest.series}">${catalog.SERIES[quest.series].title}</a>` : ''}.</p>
<p>${quests.stateChip(Boolean(state && state.completion))}</p>
<h2>What it counts</h2>
<ul class="steps">${quest.steps.map((step, i) => html`<li><strong>${step.label}</strong> — ${step.count}× <code>${step.event_type}</code>${Object.entries(step.match || {}).map(([k, v]) => html` with <code>${k}</code> <code>${String(v)}</code>`)}${seen && (seen.get(i) || 0) >= step.count ? html` <span class="done">done</span>` : ''}</li>`)}</ul>
${state ? html`<h2>Your progress</h2>
${quest.steps.map((step, i) => quests.progress(step.label, seen.get(i) || 0, step.count, quests.unitOf(step)))}` : ''}
<h2>The reward</h2>
<p>${quests.reward(quest, coinsUi)}</p>
<p class="muted">${state && state.holders ? html`${state.holders} ${state.holders === 1 ? 'person has' : 'people have'} this badge.` : html`A badge is awarded once and kept.`}</p>
${state && state.completion ? html`<div class="notice ok" role="status">Completed on <strong><time datetime="${state.completion.completed_at}">${String(state.completion.completed_at).slice(0, 10)}</time></strong>. Badge earned: <strong>${quest.reward.badge.name}</strong>${coinsUi.coinsEnabled && state.completion.coins_state === 'credited' ? html`, and its OpenCoins are in your wallet` : ''}.</div>` : html`<p><a href="/me">Your quest log</a> keeps your progress.</p>`}
${quests.terms()}
${quests.coinsNote(coinsUi)}
<p><a href="/quests">All quests</a></p>`,
            });
        });
    });

    // ── A series: its quests, and which of them the person has done ──
    r.get('/series/:id', async (req, res) => {
        const series = catalog.seriesById(req.params.id);
        if (!series) return page(req, res, {
            title: 'No such series',
            body: html`<h1>No such series</h1><p>There is no quest series at this address. <a href="/quests">The quest list</a> has every quest.</p>`,
        }, 404);
        const mine = signedIn(req) && SUBJECT_RE.test(req.viewer.subject);
        const [rows, completions] = mine
            ? await Promise.all([store.progressFor(s.db, req.viewer.subject), store.completionsFor(s.db, req.viewer.subject)])
            : [[], []];
        const completed = new Map(completions.map((c) => [c.quest_id, c.completed_at]));
        const seen = new Map();
        for (const row of rows) {
            const list = seen.get(row.quest_id) || new Map();
            list.set(Number(row.step), Number(row.count));
            seen.set(row.quest_id, list);
        }
        const finished = series.quests.filter((q) => completed.has(q.id)).length;
        return page(req, res, {
            index: true, cache: mine ? null : PUBLIC_CACHE,
            title: series.title,
            description: series.why,
            crumbs: [{ label: 'Quests', href: '/' }, { label: series.title }],
            body: html`<h1>${series.title}</h1>
<p class="lede">${series.why}</p>
<p class="muted">On <a href="https://${series.site}">${siteName(series.site)}</a>. ${series.how} <a href="${series.href}">${series.hrefLabel}</a>.</p>
${mine ? quests.progress('Your progress', finished, series.quests.length, series.quests.length > 1 ? 'quests' : '') : ''}
<ul class="quest-list">${series.quests.map((q) => quests.card(q, { ...coinsUi, earned: completed.has(q.id), seen: mine ? (seen.get(q.id) || new Map()) : null, completedAt: mine ? (completed.get(q.id) || null) : null }))}</ul>
${quests.coinsNote(coinsUi)}
<p><a href="/quests">All quests</a>${mine ? html` · <a href="/me">Your quest log</a>` : ''}</p>`,
        });
    });

    // ── Your quest log ───────────────────────────────────────
    /** "Your stuff across OpenVibe": the signed-in person's items, badges and achievements, the same panel every site shows. */
    const yourStuff = (req) => {
        const name = signedIn(req) && req.viewer ? String(req.viewer.username || '') : '';
        if (!HAS_PROFILE_PANEL || !USERNAME_RE.test(name)) return '';
        return html`<section class="sc-sec" id="your-stuff" aria-labelledby="your-stuff-h"><h2 id="your-stuff-h">Your stuff across OpenVibe</h2>
<p class="sc-lede">Your items, badges and achievements, the same on every OpenVibe site.</p>
<link rel="stylesheet" href="${ovServe.url('profile-panel.css')}">
<div data-ov-profile="${name}"><a href="https://openvibe.network/@${name}">Your profile</a></div>
<script src="${ovServe.url('profile-panel.js')}" defer></script></section>`;
    };

    r.get('/me', async (req, res) => {
        if (!signedIn(req)) return page(req, res, {
            title: 'Your quest log',
            body: html`<h1>Your quest log</h1>
<p>Quest keeps one log per person, across every site. Sign in with OpenVibe to see yours: what you have done, what
each quest still needs, and the badges you have earned.</p>
<p><a class="sc-btn sc-primary" href="/auth/login?next=%2Fme">Sign in with OpenVibe</a></p>
<p class="muted">Your progress is read from this site's database only, and only for you. Nobody else's log is shown here, and yours is not shown on anyone else's.</p>
<p><a href="/how-it-works">How progress works</a> · <a href="/quests">The quests</a></p>`,
        });

        const subject = req.viewer.subject;
        const week = new Date(s.now());
        week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
        week.setUTCHours(0, 0, 0, 0);
        const weekStart = week.toISOString();
        const [progress, completions, badges, creditedToday, creditedWeek, daily, approvedGlyphs] = await Promise.all([
            store.progressFor(s.db, subject),
            store.completionsFor(s.db, subject),
            store.badgesFor(s.db, subject),
            store.creditedTo(s.db, subject, store.dayOf(s.now())),
            s.db.value("SELECT COALESCE(SUM(coins),0) FROM quest_completions WHERE subject=$1 AND coins_state='credited' AND coins_at >= $2", [subject, weekStart]),
            ctx.daily.progress(subject),
            ctx.glyphs.approved(),
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
        const earnedIds = new Set(badges.map((b) => b.badge_id));
        const locked = catalog.all().filter((q) => !earnedIds.has(q.reward.badge.id));
        const appBadgeQuests = new Map((await Promise.all(badges.filter((b) => !catalog.byId(b.quest_id) && !String(b.quest_id).startsWith('daily-'))
            .map(async (b) => [b.quest_id, await ctx.appQuests.byId(b.quest_id)]))).filter(([, q]) => q));
        const badgeTile = (b, isLocked = false) => {
            const id = isLocked ? b.reward.badge.id : b.badge_id;
            const info = badge(id);
            const q = isLocked ? b : catalog.byId(info.quest_id || b.quest_id) || appBadgeQuests.get(b.quest_id);
            const title = info.name;
            const date = isLocked ? 'Not earned yet' : String(b.awarded_at).slice(0, 10);
            const href = q ? (String(q.id).startsWith('app.') ? `/apps/quests/${encodeURIComponent(q.id)}` : `/quests/${q.id}`) : b.quest_id?.startsWith('daily-') ? '/' : `/apps/quests/${encodeURIComponent(b.quest_id || '')}`;
            const why = q ? q.why : isLocked ? 'Complete this quest to earn the badge.' : 'Earned by completing a quest across OpenVibe.';
            const approved = isLocked ? null : approvedGlyphs.get(nameForBadge(id));
            return html`<li><details class="q-badge${isLocked ? ' is-locked' : ''}" data-badge-id="${id}" data-awarded="${isLocked ? '' : date}"><summary aria-label="${title}, ${date}"><span class="q-badge-medal" style="--h:${quests.hueOf(id)}">${icons.glyph(icons.badge(id, q), 26, approved)}</span><span class="q-badge-name">${title}</span><span class="q-badge-tip"><strong>${title}</strong><small>${date}</small></span></summary><div class="q-badge-sheet"><p class="q-eyebrow">${isLocked ? 'STILL TO EARN' : 'BADGE EARNED'}</p><span class="q-badge-medal q-badge-medal--large" style="--h:${quests.hueOf(id)}">${icons.glyph(icons.badge(id, q), 36, approved)}</span><h3>${title}</h3><p>${why}</p>${q ? html`<p>From <strong>${q.title}</strong></p><ul class="q-badge-steps">${q.steps.map((step) => html`<li>${step.label}</li>`)}</ul>` : ''}<p class="q-badge-date">${isLocked ? 'Complete the quest to unlock it.' : html`Earned <time datetime="${b.awarded_at}">${date}</time>`}</p><div class="q-badge-actions"><a href="${href}">View quest</a>${isLocked ? '' : html`<button type="button" class="q-share" data-share="${href}" data-title="${title}">Share</button>`}<button type="button" class="q-badge-close">Close</button></div></div></details></li>`;
        };

        return page(req, res, {
            title: 'Your quest log',
            crumbs: [{ label: 'Quests', href: '/' }, { label: 'Your quest log' }],
            scripts: ['js/quest-visual.js'], localStyles: ['css/quest-visual.css'],
            body: html`<div class="q-log"><header class="q-log-hero"><div><p class="q-eyebrow">YOUR JOURNEY ACROSS OPENVIBE</p><h1>Your quest log</h1><p>Signed in as <strong>${req.viewer.displayName || req.viewer.username || 'you'}</strong>. One log across every OpenVibe site, showing what you have done and what each quest still needs.</p></div><div class="q-log-stats"><div class="q-streak"><span class="q-flame" style="--streak:${Math.min(daily.streak || 0, 30)}" aria-hidden="true">🔥</span><strong>${daily.streak || 0}</strong><span>day streak</span></div><div class="q-today-ring" style="--progress:${daily.progress || 0}"><strong>${daily.progress || 0}<small>/3</small></strong><span>today's quest</span></div><div class="q-week-coins">${icons.glyph('coin', 24)}<strong>${Number(creditedWeek) || 0}</strong><span>OpenCoins this week</span></div></div></header>
<div class="q-log-columns"><section class="q-log-work" aria-labelledby="q-in-progress"><div class="q-section-head"><div><p class="q-eyebrow">KEEP GOING</p><h2 id="q-in-progress">In progress</h2></div><span>${started.length} active</span></div>
${started.length ? html`<ul class="q-progress-list">${started.map((q) => html`<li class="q-progress-card"><div class="q-progress-head"><span class="q-quest-tile" style="--h:${quests.hueOf(q.id)}">${icons.glyph(icons.quest(q), 30)}</span><div><a href="/quests/${q.id}" class="q-progress-title">${q.title}</a><span class="q-site-chip">${icons.glyph(icons.site(q.site), 16)}${siteName(q.site)}</span></div>${quests.stateChip(false)}</div><p>${q.why}</p><ul class="q-progress-steps">${q.steps.map((step, i) => { const value = Math.min((seen.get(q.id) || new Map()).get(i) || 0, step.count); return html`<li>${icons.glyph(icons.topic(step.event_type, q.site), 18)}<span>${step.label}<progress max="${step.count}" value="${value}" role="progressbar" aria-label="${step.label}" aria-valuemin="0" aria-valuemax="${step.count}" aria-valuenow="${value}" aria-valuetext="${value}/${step.count}${quests.unitOf(step) ? ` ${quests.unitOf(step)}` : ''}">${value}/${step.count}${quests.unitOf(step) ? ` ${quests.unitOf(step)}` : ''}</progress></span><b>${value >= step.count ? '✓' : `${value}/${step.count}${quests.unitOf(step) ? ` ${quests.unitOf(step)}` : ''}`}</b></li>`; })}</ul><div class="q-progress-reward">${quests.medal(q)}<span>Earn the <strong>${q.reward.badge.name}</strong> badge${q.reward.coins > 0 ? html` · ${q.reward.coins} OpenCoins${coinsUi.coinsEnabled ? '' : ' when enabled'}` : ''}</span></div></li>`)}</ul>` : html`<div class="q-empty"><span class="q-quest-tile">${icons.glyph('spark', 30)}</span><p>Nothing started yet. <a href="/quests">Pick a quest</a> — any of the sites you already use counts.</p></div>`}
<details class="q-completed-fold"><summary><span>Done</span><strong>${finished.length}</strong><small>completed quests</small></summary>${finished.length ? html`<ul class="quest-list">${finished.map((q) => {
                const c = done.get(q.id);
                const item = q.reward.item ? (c.item_state === 'granted' ? html`${q.reward.item.emoji} <strong>${q.reward.item.name}</strong> is in <a href="https://inventory.openvibe.network/me">your inventory</a>. ` : c.item_state === 'failed' ? html`${q.reward.item.name} could not be given yet — this is recorded and retried. ` : html`${q.reward.item.name} is on its way to your inventory. `) : '';
                const coins = c.coins > 0 ? (c.coins_state === 'credited' ? html`<strong>${c.coins}</strong> OpenCoins credited.` : c.coins_state === 'skipped' ? html`${c.coins} OpenCoins ${coinsUi.coinsEnabled ? html`were not credited: ${c.coins_error || 'the daily cap was reached'}` : html`start soon`}.` : html`${c.coins} OpenCoins could not be credited yet — this is recorded and retried.`) : '';
                return html`<li class="quest is-completed">
    ${quests.medal(q, { earned: true })}
    <div class="quest-main">
    <a class="quest-title" href="/quests/${q.id}">${q.title}</a> ${quests.stateChip(true)}
    <p class="quest-earned">Completed <time datetime="${c.completed_at}">${String(c.completed_at).slice(0, 10)}</time> · Badge: <strong>${q.reward.badge.name}</strong></p>
    ${item || coins ? html`<p class="quest-why">${item}${coins}</p>` : ''}
    </div></li>`;
            })}</ul>` : html`<p class="muted">No quests completed yet.</p>`}</details>
<p class="q-more-quests"><a href="/quests">Explore quests you have not started ${icons.glyph('arrow-right', 16)}</a></p>
</section><aside class="q-log-badges" aria-labelledby="q-your-badges"><div class="q-section-head"><div><p class="q-eyebrow">THE COLLECTION</p><h2 id="q-your-badges">Your badges</h2></div><span>${badges.length} earned</span></div><p>Each badge marks a quest you finished. Tap one for its story and a link to share it.</p>
${badges.length ? html`<ul class="q-badge-grid">${badges.map((b) => badgeTile(b))}</ul>` : html`<p class="muted">No badges yet. Finish a quest to earn your first.</p>`}
<details class="q-locked-fold"><summary>${locked.length} badges still to earn</summary><ul class="q-badge-grid">${locked.map((q) => badgeTile(q, true))}</ul></details>
<p class="q-badge-privacy">Anyone can see which badges you earned and when (<a href="/api/v1/profiles/${subject}/badges">your public badge list</a>). Your progress stays private.</p></aside></div>
<div class="q-log-foot">${quests.coinsNote(coinsUi)}${coinsUi.coinsEnabled ? html`<p class="muted">Credited today: <strong>${creditedToday}</strong> of ${coinsUi.dailyCap} OpenCoins.</p>` : ''}</div>${yourStuff(req)}</div>`,
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
higher count, a quest both finished counts once, and each badge keeps its first award.</li>
</ul>
<p><a href="/quests">The quests</a> · <a href="/updates">What shipped</a></p>`,
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
