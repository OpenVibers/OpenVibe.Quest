'use strict';

/** One shared daily quest. Events are kept without payloads so local-day progress can be recalculated safely. */
const { serviceAuth } = require('openvibe-contracts');
const { randomBytes } = require('node:crypto');
const catalog = require('./catalog');
const { personOf } = require('./apply');
const store = require('./store');

const BASE_TYPES = Object.freeze([
    ['go-live', 'live.stream.started', 'openvibe.live', 'Go live for a stream', 'https://openvibe.live/broadcast', 3],
    ['follow', 'network.follow.created', 'openvibe.network', 'Follow someone new', 'https://openvibe.network/', 1],
    ['thread', 'community.thread.created', 'openvibe.community', 'Start a community thread', 'https://openvibe.community/forum/general/new', 2, 'community.thread', 'Write a title and message, then press Post thread.'],
    ['reply', 'community.post.created', 'openvibe.community', 'Reply to a community thread', 'https://openvibe.community/', 1],
    ['comment', 'community.comment.created', 'openvibe.community', 'Comment on a post', 'https://openvibe.community/', 1],
    ['chat', 'chat.room.message.created', 'openvibe.chat', 'Send a public chat message', 'https://openvibe.chat/', 1],
    ['wiki', 'wiki.revision.created', 'openvibe.wiki', 'Improve a wiki page', 'https://openvibe.wiki/', 3],
    ['tool', 'tools.job.created', 'openvibe.tools', 'Use a tool', 'https://openvibe.tools/', 2],
    ['video', 'mediahub.video.published', 'openvibe.video', 'Publish a video', 'https://openvibe.video/', 3],
    ['picture', 'mediahub.picture.uploaded', 'openvibe.pics', 'Upload a picture', 'https://openvibe.pics/', 2, 'pics.upload', 'Choose a picture to upload, then finish the upload form.'],
    ['vote', 'deals.vote.changed', 'openvibe.deals', 'Vote on a deal', 'https://openvibe.deals/', 1],
    ['blog', 'blog.post.published', 'openvibe.blog', 'Publish a blog post', 'https://openvibe.blog/', 3],
    ['world', 'games.world.published', 'openvibe.games', 'Publish a world', 'https://openvibe.games/', 3],
].map(([id, event_type, site, sentence, href, weight, hook, help]) => Object.freeze({
    id, event_type, site, sentence, href, weight, hook, help, count: 1, verification: 'event subject, count within the person\'s local day',
    status: 'approved', source: 'quest',
})));
const KNOWN_TOPICS = new Set(catalog.EVENT_TYPES);
for (const t of BASE_TYPES) if (!KNOWN_TOPICS.has(t.event_type)) throw new Error(`Unknown daily event topic: ${t.event_type}`);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z][a-z0-9-]{1,47}$/;
function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function localDay(iso, zone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
}
function validZone(zone) {
    if (typeof zone !== 'string' || zone.length > 64) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
function validateSelection(ids, types, yesterday) {
    if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) return null;
    const byId = new Map(types.map((t) => [t.id, t]));
    const steps = ids.map((id) => byId.get(id));
    if (steps.some((s) => !s || !KNOWN_TOPICS.has(s.event_type))) return null;
    if (new Set(steps.map((s) => s.site)).size < 2) return null;
    if (new Set(steps.map((s) => s.event_type)).size !== 3) return null;
    if (yesterday && ids.slice().sort().join(',') === yesterday.map((s) => s.id).sort().join(',')) return null;
    return steps;
}
function rotation(day, types, yesterday) {
    const ranked = types.slice().sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
    const start = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000) % ranked.length;
    for (let shift = 0; shift < ranked.length; shift++) {
        const ordered = [...ranked.slice((start + shift) % ranked.length), ...ranked.slice(0, (start + shift) % ranked.length)];
        for (let i = 1; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
            const selected = validateSelection([ordered[0].id, ordered[i].id, ordered[j].id], types, yesterday);
            if (selected) return selected;
        }
    }
    throw new Error('Daily registry needs at least three usable step types on two sites');
}
function wireType(t) {
    return { id: t.id, event_type: t.event_type, site: t.site, sentence: t.sentence, href: t.href,
        ...(t.hook ? { hook: t.hook, help: t.help } : {}),
        weight: Number(t.weight), count: 1, verification: 'event subject, count within the person\'s local day',
        status: t.status, source: t.source || t.project_id };
}
function guidedStep(step) {
    const value = wireType(step);
    if (value.hook) {
        value.guide_id = randomBytes(12).toString('base64url');
        const url = new URL(value.href);
        url.searchParams.set('qstep', value.guide_id);
        value.href = url.toString();
    }
    return value;
}

function createDaily({ s, config, coins, glyphs, fetchImpl = globalThis.fetch, aiGenerate, log = console }) {
    const db = s.db;
    const token = config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret, audience: 'openvibe.ai', fetchImpl,
    }) : null;
    const allTypes = async () => [...BASE_TYPES, ...(await db.many("SELECT * FROM daily_step_types WHERE status = 'approved' ORDER BY id")).map(wireType)];
    const read = async (day) => {
        const row = await db.maybe('SELECT * FROM daily_quests WHERE day = $1', [day]);
        return row && { date: row.day, title: row.title, story: row.story, steps: JSON.parse(row.steps_json), source: row.source };
    };
    const readPersonal = async (subject, day) => {
        const row = await db.maybe('SELECT * FROM daily_personal_quests WHERE subject=$1 AND day=$2', [subject, day]);
        return row && { date: row.day, title: row.title, story: row.story, steps: JSON.parse(row.steps_json), source: row.source };
    };
    async function latestChanges() {
        try {
            const res = await fetchImpl(`${config.networkInternalUrl}/api/v1/changelog?limit=20`, { signal: AbortSignal.timeout(4000) });
            if (!res.ok) return [];
            const body = await res.json();
            return (Array.isArray(body) ? body : body.items || body.entries || []).slice(0, 20)
                .map((x) => ({ service: String(x.service || ''), title: String(x.title || x.message || '').slice(0, 140) }));
        } catch { return []; }
    }
    async function generateAi(day, types, yesterday) {
        if (aiGenerate) return aiGenerate({ day, types, yesterday, changes: await latestChanges(), preset: 'cheapest' });
        if (!token) return null;
        const prompt = JSON.stringify({ day, types: types.map(({ id, site, sentence, weight }) => ({ id, site, sentence, weight })),
            yesterday: yesterday ? yesterday.map((s) => s.id) : [], changes: await latestChanges(),
            task: 'Choose exactly three supplied step ids across at least two sites. Never invent a step or name a person. Write an English title (max 80 characters), a one-line story (max 180 characters), and one short actionable line per chosen id (max 120 characters). Return JSON {steps:[ids],title,story,lines:{id:line}}.' });
        const res = await fetchImpl(`${process.env.OV_AI_INTERNAL_URL || 'http://127.0.0.1:4700'}/api/v1/runs?wait=60000`, {
            method: 'POST', headers: { ...(await token.authHeaders()), 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow: 'ai.complete', input: { messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_tokens: 300 }, options: { latency: 'background' } }),
            signal: AbortSignal.timeout(70000),
        });
        if (!res.ok) return null;
        const run = (await res.json()).run;
        if (!run || !['succeeded', 'cached'].includes(run.status) || run.synthetic) return null;
        const content = run.output && run.output.choices && run.output.choices[0] && run.output.choices[0].message && run.output.choices[0].message.content;
        return typeof content === 'string' ? JSON.parse(content) : null;
    }
    async function create(day) {
        if (!DAY_RE.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z'))) return null;
        const existing = await read(day);
        if (existing) return existing;
        const types = await allTypes();
        const priorDay = utcDay(Date.parse(day + 'T00:00:00Z') - 86400000);
        const yesterday = await read(priorDay);
        let chosen = null, title = '', story = '', source = 'rotation';
        try {
            const ai = await generateAi(day, types, yesterday && yesterday.steps);
            chosen = ai && validateSelection(ai.steps, types, yesterday && yesterday.steps);
            if (chosen && typeof ai.title === 'string' && ai.title.trim() && ai.title.length <= 80
                && typeof ai.story === 'string' && ai.story.trim() && ai.story.length <= 180) {
                title = ai.title.trim(); story = ai.story.trim(); source = 'ai';
            } else chosen = null;
        } catch (err) { log.warn('[Daily quest] AI unavailable:', err.message); }
        if (!chosen) { chosen = rotation(day, types, yesterday && yesterday.steps); title = 'Make your way around OpenVibe'; story = 'Three small things, across the network, to make today yours.'; }
        await db.exec(`INSERT INTO daily_quests (day,title,story,steps_json,source,created_at)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (day) DO NOTHING`,
        [day, title, story, JSON.stringify(chosen.map(wireType)), source, s.iso()]);
        return read(day);
    }
    const pending = new Map();
    async function ensure(day = utcDay(s.now())) {
        if (!pending.has(day)) pending.set(day, create(day).then((q) => {
            if (q && glyphs) void glyphs.request(glyphs.nameForDaily(day), `${q.title}. ${q.story}`);
            return q;
        }).finally(() => pending.delete(day)));
        return pending.get(day);
    }
    async function ensurePersonal(subject) {
        const zone = await zoneOf(subject);
        const day = localDay(s.iso(), zone);
        const cached = await readPersonal(subject, day);
        if (cached) return cached;
        const types = await allTypes();
        const since = new Date(s.now() - 30 * 86400000).toISOString();
        const history = await db.many('SELECT DISTINCT event_type FROM daily_events WHERE subject=$1 AND occurred_at >= $2', [subject, since]);
        const done = new Set(history.map((x) => x.event_type));
        const fresh = types.filter((x) => !done.has(x.event_type));
        const candidates = fresh.length >= 3 ? fresh : types;
        let chosen = null, title = '', story = '', source = 'rotation', lines = null;
        try {
            const ai = await generateAi(day, candidates, null);
            chosen = ai && validateSelection(ai.steps, candidates, null);
            if (chosen && typeof ai.title === 'string' && ai.title.trim() && ai.title.length <= 80
                && typeof ai.story === 'string' && ai.story.trim() && ai.story.length <= 180
                && ai.lines && chosen.every((step) => typeof ai.lines[step.id] === 'string' && ai.lines[step.id].trim() && ai.lines[step.id].length <= 120)) {
                title = ai.title.trim(); story = ai.story.trim(); source = 'ai'; lines = ai.lines;
            } else chosen = null;
        } catch (err) { log.warn('[Daily quest] Personal AI unavailable:', err.message); }
        if (!chosen) {
            try { chosen = rotation(day, candidates, null); }
            catch { chosen = rotation(day, types, null); }
            title = 'Make your way around OpenVibe';
            story = 'Three small things, across the network, to make today yours.';
        }
        if (lines) chosen = chosen.map((step) => ({ ...step, sentence: lines[step.id].trim() }));
        await db.exec(`INSERT INTO daily_personal_quests(subject,day,title,story,steps_json,source,created_at)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(subject,day) DO NOTHING`,
        [subject, day, title, story, JSON.stringify(chosen.map(guidedStep)), source, s.iso()]);
        return readPersonal(subject, day);
    }
    async function resolveStep(subject, id) {
        if (!/^[A-Za-z0-9_-]{16}$/.test(id || '')) return null;
        const quest = await ensurePersonal(subject);
        const index = quest.steps.findIndex((step) => step.guide_id === id);
        if (index < 0) return null;
        const step = quest.steps[index];
        return { step: { id: step.id, hook: step.hook, help: step.help, event_type: step.event_type },
            next_href: quest.steps[index + 1]?.href || null };
    }
    async function publicQuest(day = utcDay(s.now())) {
        const q = day === utcDay(s.now()) ? await ensure(day) : await read(day);
        if (!q) return null;
        const finished_today = Number(await db.value('SELECT count(*) FROM daily_completions WHERE day = $1', [day]));
        return { ...q, finished_today };
    }
    async function setZone(subject, zone) {
        if (!validZone(zone)) throw new TypeError('Use an IANA time zone');
        await db.exec(`INSERT INTO daily_preferences (subject,time_zone) VALUES ($1,$2)
            ON CONFLICT (subject) DO UPDATE SET time_zone = EXCLUDED.time_zone`, [subject, zone]);
    }
    async function zoneOf(subject) {
        return (await db.value('SELECT time_zone FROM daily_preferences WHERE subject = $1', [subject])) || 'UTC';
    }
    async function recordEvent(tx, event) {
        const subject = personOf(event);
        if (!subject || !KNOWN_TOPICS.has(event.event_type)) return null;
        const occurred = new Date(event.timestamp);
        if (!Number.isFinite(occurred.getTime()) || Math.abs(s.now() - occurred.getTime()) > 3 * 86400000) return null;
        await tx.exec(`INSERT INTO daily_events (event_id,subject,event_type,occurred_at) VALUES ($1,$2,$3,$4)
            ON CONFLICT (event_id) DO NOTHING`, [event.event_id, subject, event.event_type, occurred.toISOString()]);
        return subject;
    }
    // Read-only: unlike progress(), a card must never ensure quests or settle rewards.
    async function streakOf(subject, day = null) {
        day = day || localDay(s.iso(), await zoneOf(subject));
        const rows = await db.many('SELECT day FROM daily_completions WHERE subject=$1 AND day <= $2 ORDER BY day DESC LIMIT 366', [subject, day]);
        const days = new Set(rows.map(r => r.day));
        let streak = 0;
        for (let cursor = Date.parse(day + 'T00:00:00Z') - (days.has(day) ? 0 : 86400000); streak < 365; cursor -= 86400000) {
            if (!days.has(utcDay(cursor))) break;
            streak++;
        }
        return streak;
    }
    async function progress(subject, day = null, selectedQuest = null) {
        const savedZone = await db.value('SELECT time_zone FROM daily_preferences WHERE subject = $1', [subject]);
        const zone = savedZone || 'UTC';
        day = day || localDay(s.iso(), zone);
        const q = selectedQuest || await ensure(day);
        if (!q) return null;
        const start = new Date(day + 'T00:00:00Z').getTime();
        const events = await db.many(`SELECT event_type,occurred_at FROM daily_events
            WHERE subject=$1 AND occurred_at >= $2 AND occurred_at < $3`,
        [subject, new Date(start - 86400000).toISOString(), new Date(start + 2 * 86400000).toISOString()]);
        const local = events.filter((e) => localDay(e.occurred_at, zone) === day);
        const steps = q.steps.map((step) => ({ ...step, progress: Math.min(step.count, local.filter((e) => e.event_type === step.event_type).length),
            done: local.some((e) => e.event_type === step.event_type) }));
        const done = steps.every((step) => step.done);
        if (done && savedZone) {
            const at = s.iso();
            await db.exec('INSERT INTO daily_completions (subject,day,completed_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [subject, day, at]);
            const row = await store.complete(db, { id: s.newId('qcp'), subject, questId: `daily-${day}`, at,
                coins: 5, coinsState: coins.enabled ? 'pending' : 'skipped' });
            if (row && coins.enabled) await coins.settle(row);
        }
        const completion = await db.maybe('SELECT completed_at FROM daily_completions WHERE subject=$1 AND day=$2', [subject, day]);
        const streak = await streakOf(subject, day);
        const finished_today = Number(await db.value('SELECT count(*) FROM daily_completions WHERE day=$1', [day]));
        return { ...q, steps, finished_today, progress: steps.filter((x) => x.done).length, completed: !!completion,
            completed_at: completion && completion.completed_at, streak, time_zone: zone };
    }
    async function today(subject) {
        const quest = await ensurePersonal(subject);
        return progress(subject, quest.date, quest);
    }
    async function contribute(project, input) {
        const { id, event_type, site, sentence, href, weight = 1 } = input || {};
        if (!ID_RE.test(id || '') || !KNOWN_TOPICS.has(event_type)
            || !catalog.EVENTS.some((e) => e.event_type === event_type && e.site === site)
            || typeof sentence !== 'string' || !sentence.trim() || sentence.length > 120
            || !Number.isInteger(weight) || weight < 1 || weight > 5) return { error: 'invalid' };
        let url;
        try { url = new URL(href); } catch { return { error: 'invalid' }; }
        if (url.protocol !== 'https:' || url.hostname !== site) return { error: 'invalid' };
        const key = `${project}:${id}`;
        await db.exec(`INSERT INTO daily_step_types (id,project_id,event_type,site,sentence,href,weight,status,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
            ON CONFLICT (id) DO UPDATE SET event_type=$3,site=$4,sentence=$5,href=$6,weight=$7,status='pending',reviewed_at=NULL
            WHERE daily_step_types.project_id=$2`, [key, project, event_type, site, sentence.trim(), url.toString(), weight, s.iso()]);
        return { ...(await db.maybe('SELECT * FROM daily_step_types WHERE id=$1', [key])), verification: 'event subject, count within the person\'s local day' };
    }
    async function review(id, status) {
        if (!['approved', 'rejected'].includes(status)) return null;
        await db.exec('UPDATE daily_step_types SET status=$2,reviewed_at=$3 WHERE id=$1', [id, status, s.iso()]);
        return db.maybe('SELECT * FROM daily_step_types WHERE id=$1', [id]);
    }
    async function refreshAfterEvent(subject) {
        const day = localDay(s.iso(), await zoneOf(subject));
        if (!(await read(day))) return null;
        return progress(subject, day);
    }
    let timer;
    function start() {
        const due = async () => {
            try {
                await ensure();
                await db.exec('DELETE FROM daily_events WHERE occurred_at < $1', [new Date(s.now() - 3 * 86400000).toISOString()]);
                await db.exec('DELETE FROM daily_personal_quests WHERE day < $1', [utcDay(s.now() - 2 * 86400000)]);
            } catch (err) { log.warn('[Daily quest] generation failed:', err.message); }
            const now = s.now();
            const next = Date.parse(utcDay(now + 86400000) + 'T00:00:00Z') + 1000;
            timer = setTimeout(due, Math.max(1000, next - now)); timer.unref?.();
        };
        void due();
        return () => { if (timer) clearTimeout(timer); };
    }
    return { ensure, read, publicQuest, progress, streakOf, today, ensurePersonal, resolveStep, refreshAfterEvent, recordEvent, setZone, zoneOf, allTypes, contribute, review, start };
}
module.exports = { createDaily, BASE_TYPES, KNOWN_TOPICS, validateSelection, rotation, localDay, validZone, utcDay };
