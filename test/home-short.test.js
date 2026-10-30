'use strict';
/**
 * The home on a phone (the owner's short-pages rule, 2026-10-30): how it works and the questions are folds, closed on
 * a phone and open where there is room. Both stay in the page for the crawlers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('how it works and the questions are folds, open in the page and closed on a phone', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200, r.text);
            for (const id of ['how-it-works-fold', 'questions-fold']) {
                assert.ok(r.text.includes(`<details class="hm-fold hm-fold-block" id="${id}" open>`), `${id} is a fold, open in the page`);
                assert.ok(r.text.includes(`document.getElementById("${id}")`), `${id} has the script that closes it on a phone`);
            }
            // The content of the folds stays in the page.
            assert.match(r.text, /From what you do to a badge/);
            assert.match(r.text, /What is OpenVibe.Quest?/);
            // The sections they replace are still there.
            assert.ok(r.text.includes('id="how-it-works"'));
            assert.ok(r.text.includes('id="questions"'));
        });

        await check('the CSS guard: a fold is a 44 px target and only the phone rules change the page', async () => {
            const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
            assert.match(css, /\.hm-fold-block > summary \{[^}]*min-height: 44px/, 'a fold is a 44 px target');
            assert.match(css, /\.hm-fold-block > summary span \{ display: none; \}/, 'the "tap to open" hint is hidden where there is room');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
