'use strict';
/**
 * The home's daily quest card, and the icons on it.
 *
 * Two icon sets exist: a site's own mark (openvibe-shared/icons: live, chat, quest…, drawn in the page) and the glyphs
 * (openvibe-shared/glyphs: wrench, heart, camera…). Quest wrote every icon as a site mark, and a mark that does not
 * exist draws the bare "V": on production "Use a tool" and the card's own icon were a V. A glyph is now drawn here, as
 * inline SVG, and nothing on the page asks for a mark that does not exist.
 */
const assert = require('assert');
const { boot } = require('./helpers/boot');
const icons = require('../server/render/quest-icons');

(async () => {
    const t = await boot();
    try {
        // Every name the icon tables use is drawable by one set or the other.
        const names = [...Object.values(icons.TOPICS), ...Object.values(icons.SITES)];
        names.forEach((n) => assert.ok(icons.GLYPHS.has(n) || icons.MARKS.has(n), `${n} is in neither icon set`));
        assert.match(String(icons.glyph('wrench', 22)), /^<span class="q-glyph" data-glyph="wrench" aria-hidden="true"><svg /, 'a glyph is inline SVG');
        assert.match(String(icons.glyph('live', 22)), /^<span class="ov-icon" data-icon="live"/, 'a site mark stays a site mark');
        assert.match(String(icons.glyph('no-such-icon', 22)), /data-icon="quest"/, 'an unknown name is the quest mark, which exists');

        const home = await t.get('/');
        assert.strictEqual(home.status, 200);
        const card = (home.text.match(/<section class="q-daily"[\s\S]*?<\/section>/) || [''])[0];
        assert.ok(card, 'the daily card is on the home');
        assert.match(card, /<p class="q-daily-kicker"><b>Today's quest<\/b><time datetime="\d{4}-\d\d-\d\d">[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}<\/time><\/p>/, 'the day is said in words');
        const rows = Array.from(card.matchAll(/<li[^>]*><a href="([^"]+)"><span class="q-daily-ic">([\s\S]*?)<\/span><span class="q-daily-t"><b>([^<]+)<\/b><small>([^<]+)<\/small><\/span>/g));
        assert.strictEqual(rows.length, 3, 'three steps, each one row to press');
        rows.forEach((m) => assert.match(m[1], /^https:\/\/[a-z0-9.-]+\//, 'a step links to where it is done'));
        assert.match(card, /<a class="ovk-btn ovk-btn--primary" href="\/auth\/login\?next=%2F">Sign in to track it<\/a>/, 'signed out: one button');
        assert.match(card, /<h1 id="daily-title" class="q-daily-title">/, 'on the home its title is the page\'s h1');
        assert.ok(!card.includes('Build a step type') && !card.includes('/build-a-step-type'), 'the developer link is not in today\'s card');
        assert.match(home.text, /Building an app\? <a href="\/build-a-step-type">Suggest a step for the daily quest<\/a>/, 'it is with How it works');

        // The catalog shows the same card (its title an h2), not a second one of its own.
        const catalog = await t.get('/quests');
        assert.match(catalog.text, /<section class="q-daily"[^>]*>[\s\S]*?<h2 id="daily-title" class="q-daily-title">/);
        assert.match(catalog.text, /href="\/auth\/login\?next=%2Fquests">Sign in to track it<\/a>/, 'signing in comes back to the page you were on');

        // Nothing on the page asks for a site mark that does not exist (that is what drew the "V").
        const asked = Array.from(home.text.matchAll(/class="ov-icon" data-icon="([^"]+)"/g)).map((m) => m[1]);
        const missing = [...new Set(asked.filter((n) => !icons.MARKS.has(n)))];
        assert.deepStrictEqual(missing, [], `site marks that do not exist: ${missing.join(', ')}`);
        // A past day is a row, not a link to its JSON.
        assert.ok(!/<a href="\/api\/v1\/daily\//.test(home.text), 'no page link goes to an API address');
        console.log('daily-card: the card, its three rows, the day in words, one sign-in button; every icon on the home exists');
    } finally {
        await t.close();
    }
})().catch((e) => { console.error(e); process.exit(1); });
