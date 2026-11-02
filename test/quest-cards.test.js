'use strict';
/**
 * The quest card and quest page the market outcomes ask for:
 *
 *   - a card shows its title, one-line description, what it counts and a reward with its amount;
 *   - progress is a numerator/denominator with a unit and a bar carrying role=progressbar and its ARIA values;
 *   - the state is written as text (Active / Completed), and a completed card is dimmed;
 *   - a reward says its type and amount, never "up to";
 *   - a quest page states its terms (no wallet, no card, no auto-renew, the event inbox);
 *   - a completed quest shows the date it was earned and the badge.
 *
 * The cases where a line must be left out: a signed-out card has no personal progress or completion date, and no
 * expiry/urgent line exists because the database has no expiry column.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const catalog = require('../server/quests/catalog');
const renderQuests = require('../server/render/quests');
const { render } = require('../server/render/html');

const NOW = '2026-10-01T10:00:00.000Z';

(async () => {
    const t = await boot();
    const kim = t.network.addUser('kim');

    try {
        await check('progress writes the fraction with a unit and a bar with role=progressbar and ARIA now/max', () => {
            const hours = render(renderQuests.progress('Watch time', 3, 12, 'hours'));
            assert.ok(hours.includes('3/12 hours'), 'the fraction with its unit');
            assert.ok(hours.includes('role="progressbar"'), 'a progressbar role');
            assert.ok(hours.includes('aria-valuenow="3"') && hours.includes('aria-valuemax="12"'), 'its values');
            const bare = render(renderQuests.progress('Votes', 7, 10));
            assert.ok(bare.includes('7/10') && !bare.includes('hours'), 'a unit is optional, as in 7/10');
        });

        await check('a quest card shows the title, why, what it counts, the reward amount and the state', () => {
            const q = catalog.byId('stream-three-times');
            const card = render(renderQuests.card(q, { coinsEnabled: false, seen: new Map([[0, 1]]) }));
            assert.ok(card.includes('Stream three times'), 'the title');
            assert.ok(card.includes('Three broadcasts is a habit'), 'the one-line description');
            assert.ok(card.includes('Start a stream') && card.includes('1/3 streams'), 'what it counts, with progress and its unit');
            assert.ok(card.includes('role="progressbar"') && card.includes('aria-valuenow="1"') && card.includes('aria-valuemax="3"'), 'the bar and its values');
            assert.ok(card.includes('Badge: <strong>Regular Broadcaster</strong>'), 'the badge reward, named');
            assert.ok(card.includes('25</strong> OpenCoins'), 'the coin amount, even while OpenCoins are off');
            assert.ok(card.includes('start soon'), 'and that they do not move yet');
            assert.ok(!card.includes('up to'), 'never an up-to figure');
            assert.ok(card.includes('Active') && !card.includes('is-completed'), 'the state as text, active');
        });

        await check('a completed card is dimmed and repeats the date earned and the badge', () => {
            const q = catalog.byId('go-live');
            const card = render(renderQuests.card(q, { coinsEnabled: false, seen: new Map(), completedAt: NOW }));
            assert.ok(card.includes('class="quest is-completed"'), 'the card is dimmed by its class');
            assert.ok(card.includes('Completed'), 'the state as text');
            assert.ok(card.includes(`<time datetime="${NOW}">2026-10-01</time>`), 'the date it was earned');
            assert.ok(card.includes('Badge: <strong>First Broadcast</strong>'), 'the badge');
            assert.ok(card.includes('1/1'), 'a completed step reads 1/1, not the missing progress row');
            const open = render(renderQuests.card(q, { coinsEnabled: false, seen: new Map() }));
            assert.ok(!open.includes('Completed <time'), 'not completed: the completion line is left out');
            assert.ok(open.includes('Active'), 'and it says Active');
        });

        await check('a retired app quest says Locked, a completed one still says Completed', () => {
            assert.ok(render(renderQuests.stateChip(false, true)).includes('Locked'), 'the one locked state in the code');
            assert.ok(render(renderQuests.stateChip(true, true)).includes('Completed'), 'a badge already earned stays earned');
            assert.ok(render(renderQuests.stateChip(false)).includes('Active'), 'everything else is Active');
        });

        await check('a quest page states its terms, only what the code does', () => {
            const terms = render(renderQuests.terms());
            for (const line of ['no wallet to connect', 'no card', 'no subscription or auto-renew', 'quest_event_inbox', 'no page views, no clicks, no watch time']) {
                assert.ok(terms.includes(line), line);
            }
            assert.ok(!/expir/i.test(terms), 'no expiry claim: there is no expiry column');
            assert.ok(!terms.includes('up to'), 'never an up-to figure');
        });

        // A person with one started quest and one completed quest, read back from the real pages.
        await t.ctx.s.db.query('INSERT INTO quest_progress (subject, quest_id, step, count, updated_at) VALUES ($1, $2, 0, 1, $3)', [kim.subject, 'stream-three-times', NOW]);
        await t.ctx.s.db.query('INSERT INTO quest_completions (id, subject, quest_id, completed_at, coins, coins_state) VALUES ($1, $2, $3, $4, 10, $5)', ['qcp_kim', kim.subject, 'go-live', NOW, 'skipped']);
        await t.ctx.s.db.query('INSERT INTO quest_badges (subject, badge_id, quest_id, awarded_at) VALUES ($1, $2, $3, $4)', [kim.subject, 'first-broadcast', 'go-live', NOW]);

        await check('signed out, the index shows the catalog card and leaves personal progress and dates out', async () => {
            const r = await t.get('/quests');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('10</strong> OpenCoins'), 'the reward amount is on the public card');
            assert.ok(r.text.includes('class="quest-steps"'), 'what it counts');
            assert.ok(r.text.includes('quest-state--active') && r.text.includes('>Active</span>'), 'state as text');
            assert.ok(!r.text.includes('is-completed'), 'nobody is signed in, so no completed card');
            assert.ok(!r.text.includes('1/3 streams'), 'no personal progress is invented');
            assert.ok(!r.text.includes('Completed <time'), 'no completion date');
            assert.ok(!/expir/i.test(r.text) && !r.text.includes('up to'), 'no expiry or up-to line');
        });

        await check('signed in, the index shows the viewer\'s fraction, unit and completed card', async () => {
            const r = await t.get('/quests', { as: kim });
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('1/3 streams'), 'the started quest\'s fraction with its unit');
            assert.ok(r.text.includes('aria-valuenow="1"') && r.text.includes('aria-valuemax="3"'), 'the bar\'s ARIA values');
            assert.ok(r.text.includes('class="quest is-completed"'), 'the completed quest is dimmed');
            assert.match(r.text, /Completed <time datetime="2026-10-01T10:00:00\.000Z">2026-10-01<\/time> · Badge: <strong>First Broadcast<\/strong>/, 'the date and the badge');
            assert.ok(r.text.includes('quest-state--completed'), 'state as text as well as colour');
        });

        await check('a quest page carries the terms, and a completed one the date and the badge', async () => {
            const open = await t.get('/quests/go-live');
            assert.ok(open.text.includes('<h2>Terms</h2>'), 'the terms heading');
            assert.ok(open.text.includes('no wallet to connect') && open.text.includes('quest_event_inbox'), 'the terms themselves');
            assert.ok(open.text.includes('quest-state--active'), 'an open quest is Active');
            assert.ok(!open.text.includes('Your progress'), 'signed out: no personal progress section');
            assert.ok(!open.text.includes('Badge earned'), 'signed out: no earned line');

            const donePage = await t.get('/quests/go-live', { as: kim });
            assert.ok(donePage.text.includes('quest-state--completed'), 'the completed quest is Completed');
            assert.ok(donePage.text.includes('<h2>Your progress</h2>') && donePage.text.includes('1/1'), 'its progress is complete');
            assert.match(donePage.text, /Completed on <strong><time datetime="2026-10-01T10:00:00\.000Z">2026-10-01<\/time><\/strong>\. Badge earned: <strong>First Broadcast<\/strong>/, 'the date and the badge');
            assert.ok(!/expir/i.test(donePage.text), 'no expiry line: no column exists');
        });

        await check('a series shows its own progress with the quest unit', async () => {
            const series = await t.get('/series/live-setup', { as: kim });
            assert.strictEqual(series.status, 200);
            const total = catalog.seriesById('live-setup').quests.length;
            assert.ok(series.text.includes(`0/${total} quests`), 'the series fraction with its unit');
            assert.ok(series.text.includes('role="progressbar"') && series.text.includes('aria-valuemax="1"'), 'its bar, and the cards\' bars');
        });

        await check('the quest log shows the active state, the unit and the completed date and badge', async () => {
            const me = await t.get('/me', { as: kim });
            assert.strictEqual(me.status, 200);
            assert.ok(me.text.includes('1/3 streams'), 'the in-progress fraction with its unit');
            assert.ok(me.text.includes('quest-state--active'), 'Active');
            assert.ok(me.text.includes('class="quest is-completed"') && me.text.includes('quest-state--completed'), 'the completed card, dimmed');
            assert.match(me.text, /Completed <time datetime="2026-10-01T10:00:00\.000Z">2026-10-01<\/time> · Badge: <strong>First Broadcast<\/strong>/, 'the date and the badge');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
