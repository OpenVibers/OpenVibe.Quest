'use strict';

const glyphs = require('openvibe-shared/glyphs');
const siteMarks = require('openvibe-shared/icons');
const catalog = require('../quests/catalog');
const { html, raw } = require('./html');

// Two icon sets (see glyph() below): a name is usable when either has it.
const GLYPHS = new Set(glyphs.NAMES);
const MARKS = new Set(typeof siteMarks.names === 'function' ? siteMarks.names() : siteMarks.names);
const available = new Set([...GLYPHS, ...MARKS]);
const TOPICS = Object.freeze({
    'live.stream.started': 'live', 'network.follow.created': 'heart',
    'community.thread.created': 'chat', 'community.post.created': 'reply',
    'community.comment.created': 'quote', 'chat.room.message.created': 'chat',
    'wiki.revision.created': 'book-open', 'tools.job.created': 'wrench',
    'mediahub.video.published': 'clapper', 'mediahub.picture.uploaded': 'camera',
    'meme.caption.created': 'pencil',
    'deals.vote.changed': 'thumbs-up', 'blog.post.published': 'pencil',
    'games.world.published': 'globe',
});
const SITES = Object.freeze({
    'openvibe.live': 'live', 'openvibe.network': 'globe', 'openvibe.community': 'chat',
    'openvibe.chat': 'chat', 'openvibe.wiki': 'book-open', 'openvibe.tools': 'wrench',
    'openvibe.video': 'clapper', 'openvibe.pics': 'camera', 'openvibe.meme': 'pencil', 'openvibe.deals': 'tag',
    'openvibe.blog': 'pencil', 'openvibe.games': 'game',
});

const safe = (name, fallback = 'quest') => available.has(name) ? name : fallback;
const topic = (eventType, site) => safe(TOPICS[eventType] || SITES[site]);
const site = (domain) => safe(SITES[domain] || String(domain || '').replace(/^openvibe\./, ''));
const quest = (q) => topic(q.steps?.[0]?.event_type, q.site);
const badge = (id, q) => safe(catalog.BADGE_ICONS[id] || (q && quest(q)));
function glyph(name, size = 24, approvedSvg = null) {
    if (approvedSvg) {
        const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8fa4dd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${approvedSvg}</svg>`;
        return html`<img class="q-reviewed-glyph" src="data:image/svg+xml,${encodeURIComponent(doc)}" width="${size}" height="${size}" alt="">`;
    }
    // A site's own mark (live, chat, quest…) is drawn in the page by ov-icons.js; every other name is a glyph, drawn
    // here as inline SVG. Writing a glyph's name as a site mark drew the bare "V" (most quest rows had one).
    const n = safe(name);
    if (!MARKS.has(n) && GLYPHS.has(n)) return html`<span class="q-glyph" data-glyph="${n}" aria-hidden="true">${raw(glyphs.svg(n, size))}</span>`;
    return html`<span class="ov-icon" data-icon="${n}" data-size="${size}" aria-hidden="true"></span>`;
}
const needsDraft = (eventType, domain) => !TOPICS[eventType] && !SITES[domain];

module.exports = { TOPICS, SITES, GLYPHS, MARKS, safe, topic, site, quest, badge, glyph, needsDraft };
