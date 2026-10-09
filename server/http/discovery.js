'use strict';

/**
 * Crawl artifacts for openvibe.quest, built with openvibe-shared/seo: robots.txt, sitemap.xml, llms.txt and
 * llms-full.txt, and the home page's JSON-LD. The public pages are for search engines and AI crawlers; sign-in and
 * the API are not.
 *
 * The product extends PAGE_TEXT and publicPages() with its own pages; the routes and headers here stay.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');
const catalog = require('../quests/catalog');

const SITE_NAME = 'OpenVibe.Quest';
const DESCRIPTION = 'OpenVibe.Quest — Quests across the whole network.';
const DISALLOW = ['/auth/', '/api/', '/me'];

// One line per public page for llms-full.txt. /me is not here: it is a person's own log, never crawled.
const PAGE_TEXT = {
    '/': ['OpenVibe.Quest home', 'OpenVibe.Quest: Quests across the whole network. The quests, grouped by the site whose events each one counts.'],
    '/how-it-works': ['How quests work', 'What OpenVibe.Quest counts, what it stores, and what its rewards are — badges and OpenCoins, never money and never Vibes.'],
    '/updates': ['What shipped on OpenVibe.Quest', 'This site\'s update log, from the network changelog feed.'],
    ...Object.fromEntries(catalog.all().map((q) => [`/quests/${q.id}`, [q.title, `${q.why} On ${(catalog.SITES[q.site] || {}).name || q.site}. Reward: the ${q.reward.badge.name} badge${q.reward.item ? `, the ${q.reward.item.name} (${q.reward.item.kind.toLowerCase()}) for your inventory` : ''}${q.reward.coins > 0 ? ` and ${q.reward.coins} OpenCoins` : ''}.`]])),
};

function dayOf(ts) {
    const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION }),
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'BusinessApplication', keywords: 'openvibe' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

const publicPages = () => [
    { path: '/', changefreq: 'weekly', priority: 1.0 },
    { path: '/how-it-works', changefreq: 'monthly', priority: 0.6 },
    ...catalog.all().map((q) => ({ path: `/quests/${q.id}`, changefreq: 'monthly', priority: 0.7 })),
    { path: '/updates', changefreq: 'daily', priority: 0.5 },
];

function createDiscoveryRoutes(ctx) {
    const { config } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.quest: the public pages are for search and AI crawlers; sign-in and the API are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: 'OpenVibe.Quest: Quests across the whole network.',
            details: 'Every page is server-rendered and readable without JavaScript.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Quest', url: abs('/'), note: 'Quests across the whole network.' },
                    { title: 'How quests work', url: abs('/how-it-works'), note: 'what is counted, what is stored, and the rewards' },
                    { title: 'The catalog (JSON)', url: abs('/api/v1/quests'), note: 'every quest, grouped by site' },
                    { title: 'What shipped on OpenVibe.Quest', url: abs('/updates') },
                ] },
                { title: 'The quests', links: catalog.all().map((q) => ({ title: q.title, url: abs(`/quests/${q.id}`), note: `${(catalog.SITES[q.site] || {}).name || q.site} — reward: the ${q.reward.badge.name} badge${q.reward.item ? ` and the ${q.reward.item.name}` : ''}` })) },
                { title: 'Machine-readable', links: [
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Full text for language models', url: abs('/llms-full.txt') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Network', url: 'https://openvibe.network', note: 'accounts, apps and grants' },
                    { title: 'OpenVibe.Services', url: 'https://openvibe.services', note: 'apps, keys and capability grants' },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', (_req, res) => {
        const pages = publicPages().map((p) => ({ url: p.path, title: PAGE_TEXT[p.path][0], text: PAGE_TEXT[p.path][1] }));
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public page of OpenVibe.Quest, one line each.',
            base: site,
            maxBytes: 64 * 1024,
            sections: [{ title: 'Pages', pages }],
        }));
    });

    r.get('/sitemap.xml', (_req, res) => {
        const lastmod = siteUpdated();
        const urls = publicPages().map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority }));
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME };
