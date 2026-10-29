'use strict';

/**
 * A badge's picture: its medal (the initials on a ring of its colour, the same as render/quests.js medal()) on a wash of
 * that colour, with the badge's name under it. A 16:9 SVG, so a quest is a picture in the shared kit's cards
 * (openvibe-shared kit.card) like a stream or a clip is. Served at /quests/:id/badge.svg, /series/:id/badge.svg and
 * /apps/quests/:id/badge.svg (http/pages.js); the text is the catalog's or an app's, escaped here.
 */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Up to two letters: the first of the first two words, or the first two of a single word ("Toolsmith" → "TO"). */
function initials(name) {
    const words = String(name || '').split(/\s+/).filter(Boolean);
    const s = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] || '?')].slice(0, 2).join('');
    return s.toUpperCase();
}

/**
 * svg({ hue, mark, name }): mark is the medal's face (the initials, or a series' count), name the line under it (cut to
 * 26 characters). The lowest 40 units stay clear for the card's corner (an item, a price). Decorative in a card, whose
 * alt text names the badge.
 */
function svg({ hue = 210, mark = '?', name = '' } = {}) {
    const h = Math.abs(Math.round(Number(hue) || 0)) % 360;
    const line = [...String(name)].length > 26 ? `${[...String(name)].slice(0, 25).join('').trimEnd()}…` : String(name);
    const face = [...String(mark)].slice(0, 3).join('');
    const font = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">`
        + `<defs><radialGradient id="w" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="hsl(${h},48%,26%)"/><stop offset="1" stop-color="hsl(${h},42%,9%)"/></radialGradient>`
        + `<radialGradient id="m" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="hsl(${h},55%,38%)"/><stop offset=".75" stop-color="hsl(${h},50%,17%)"/></radialGradient></defs>`
        + `<rect width="320" height="180" fill="url(#w)"/>`
        + `<g fill="none" stroke="hsl(${h},70%,72%)" stroke-opacity=".16"><circle cx="160" cy="62" r="58"/><circle cx="160" cy="62" r="82"/><circle cx="160" cy="62" r="108"/></g>`
        + `<path d="M141 88 133 116 145 110 151 121 158 93Z M179 88 187 116 175 110 169 121 162 93Z" fill="hsl(${h},55%,34%)"/>`
        + `<circle cx="160" cy="62" r="38" fill="url(#m)" stroke="hsl(${h},62%,58%)" stroke-width="5"/>`
        + `<text x="160" y="62" dy=".35em" text-anchor="middle" font-family="${font}" font-weight="800" font-size="${face.length > 2 ? 21 : 26}" letter-spacing="1" fill="hsl(${h},85%,85%)">${esc(face)}</text>`
        + (line ? `<text x="160" y="137" text-anchor="middle" font-family="${font}" font-weight="700" font-size="15" fill="hsl(${h},60%,88%)">${esc(line)}</text>` : '')
        + '</svg>';
}

module.exports = { svg, initials };
