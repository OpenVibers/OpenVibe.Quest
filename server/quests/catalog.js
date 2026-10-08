'use strict';

/**
 * The quest catalog: the first-party quests OpenVibe.Quest itself offers, in code, so a quest cannot drift from
 * what the service actually counts. Small and honest — one quest per real thing a person already does on an
 * OpenVibe site, and nothing a person cannot really do today.
 *
 * Every quest names the events it counts (the schemas live in openvibe-contracts contracts/events/payloads/):
 * a quest only counts an event whose payload (or, where the schema says the actor is the person, the envelope
 * actor) really carries a usr_… subject, so a repeat of someone else's action can never move a quest log.
 * Nothing else about a person is read or stored: see the rules on /how-it-works.
 *
 * A quest is:
 *   id          slug, the URL and the database key
 *   site        the domain whose events it counts (grouping and provenance)
 *   title       one line, a thing a person would say
 *   why         one line on why it is worth doing (never a promise the sites do not keep)
 *   steps       [{ event_type, count, label }] — every step must reach its count
 *   reward      { badge: { id, name }, coins } — a text badge label (no emoji) and OpenCoins (loyalty, not money)
 *   repeatable  false: a quest completes once per person, and its badge is awarded once
 *
 * Community-made quests (the product's third pillar) are not here yet: they need moderation, which this release
 * does not have. The API and the tables already key everything by quest id, so they arrive as data, not a rewrite.
 */

/** The OpenVibe sites a quest can belong to: the domain its events come from, and how the page names it. */
const SITES = Object.freeze({
    'openvibe.live': { name: 'OpenVibe.Live', what: 'streaming' },
    'openvibe.network': { name: 'OpenVibe.Network', what: 'the network itself — accounts, follows, blocks' },
    'openvibe.community': { name: 'OpenVibe.Community', what: 'the forum' },
    'openvibe.chat': { name: 'OpenVibe.Chat', what: 'public chat rooms' },
    'openvibe.wiki': { name: 'OpenVibe.Wiki', what: 'the wiki' },
    'openvibe.games': { name: 'OpenVibe.Games', what: 'the games platform' },
    'openvibe.tools': { name: 'OpenVibe.Tools', what: 'the tools' },
    'openvibe.space': { name: 'OpenVibe.Space', what: 'forums in a Space' },
});

const QUESTS = Object.freeze([
    {
        id: 'go-live',
        site: 'openvibe.live',
        title: 'Go live once',
        why: 'A channel with nothing on it is a promise; one broadcast makes it real.',
        steps: [{ event_type: 'live.stream.started', count: 1, label: 'Start a stream' }],
        reward: { badge: { id: 'first-broadcast', name: 'First Broadcast' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'stream-three-times',
        site: 'openvibe.live',
        title: 'Stream three times',
        why: 'Three broadcasts is a habit; the first one is only an attempt.',
        steps: [{ event_type: 'live.stream.started', count: 3, label: 'Start a stream' }],
        reward: { badge: { id: 'regular-broadcaster', name: 'Regular Broadcaster' }, coins: 25 },
        repeatable: false,
    },
    {
        id: 'follow-someone',
        site: 'openvibe.network',
        title: 'Follow someone',
        why: 'The network is a list of people you chose to hear from.',
        steps: [{ event_type: 'network.follow.created', count: 1, label: 'Follow a channel or a person' }],
        reward: { badge: { id: 'first-follow', name: 'First Follow' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'start-a-thread',
        site: 'openvibe.community',
        title: 'Start a forum thread',
        why: 'Every thread on the forum started as somebody\'s question.',
        steps: [{ event_type: 'community.thread.created', count: 1, label: 'Start a thread' }],
        reward: { badge: { id: 'thread-starter', name: 'Thread Starter' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'reply-in-a-thread',
        site: 'openvibe.community',
        title: 'Reply in a thread',
        why: 'An answer is worth more than a read.',
        steps: [{ event_type: 'community.post.created', count: 1, label: 'Post a reply' }],
        reward: { badge: { id: 'first-reply', name: 'First Reply' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'comment-on-a-post',
        site: 'openvibe.community',
        title: 'Comment on a post',
        why: 'Comments are where the conversation about a video or an article actually happens.',
        steps: [{ event_type: 'community.comment.created', count: 1, label: 'Leave a comment' }],
        reward: { badge: { id: 'commenter', name: 'Commenter' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'say-hello-in-chat',
        site: 'openvibe.chat',
        title: 'Say hello in chat',
        why: 'A public room is the fastest way to meet the people watching the same stream.',
        steps: [{ event_type: 'chat.room.message.created', count: 1, label: 'Send a message in a public room' }],
        reward: { badge: { id: 'said-hello', name: 'Said Hello' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'improve-a-wiki-page',
        site: 'openvibe.wiki',
        title: 'Improve a wiki page',
        why: 'One corrected sentence is a page someone else reads correctly.',
        steps: [{ event_type: 'wiki.revision.created', count: 1, label: 'Save a revision' }],
        reward: { badge: { id: 'wiki-editor', name: 'Wiki Editor' }, coins: 15 },
        repeatable: false,
    },
    {
        id: 'play-a-game',
        site: 'openvibe.games',
        title: 'Play a game',
        why: 'The games platform is a world; walking into it is the only way to see it.',
        steps: [{ event_type: 'games.player.joined', count: 1, label: 'Enter a world' }],
        reward: { badge: { id: 'player-one', name: 'Player One' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'use-a-tool',
        site: 'openvibe.tools',
        title: 'Use a tool',
        why: 'OpenVibe.Tools turns a file into something else; run one job and you know what that means.',
        steps: [{ event_type: 'tools.job.created', count: 1, label: 'Run a job' }],
        reward: { badge: { id: 'toolsmith', name: 'Toolsmith' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'start-a-space-thread',
        site: 'openvibe.space',
        title: 'Start a Space thread',
        why: 'A Space is a community\'s own forum; a thread is how you join it.',
        steps: [{ event_type: 'space.thread.created', count: 1, label: 'Start a thread in a Space' }],
        reward: { badge: { id: 'space-thread-starter', name: 'Space Thread Starter' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'settle-in',
        site: 'openvibe.network',
        title: 'Settle in across the network',
        why: 'One thread and one chat message: two sites, and the account stops being new.',
        steps: [
            { event_type: 'community.thread.created', count: 1, label: 'Start a forum thread' },
            { event_type: 'chat.room.message.created', count: 1, label: 'Send a chat message' },
        ],
        reward: { badge: { id: 'settled-in', name: 'Settled In' }, coins: 20 },
        repeatable: false,
    },
]);

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

/**
 * Every domain event OpenVibe.Quest listens to, with the site that emits it and what it means. This is the whole
 * list of what the service is told about a person — the /how-it-works page prints it from here, so the page cannot
 * claim less than the consumer really subscribes to. Each one comes from its schema in openvibe-contracts
 * contracts/events/payloads/; nothing is inferred.
 */
const EVENTS = Object.freeze([
    { event_type: 'live.stream.started', site: 'openvibe.live', what: 'A stream went live. The streamer is the channel\'s user subject.' },
    // Listed so /how-it-works can say what Quest does NOT listen to, next to what it does: a stream ending is
    // real activity too, and a person reading the page should not have to guess why it moves nothing.
    { event_type: 'live.stream.ended', site: 'openvibe.live', what: 'A stream ended. Quest does not subscribe to this one.', counted: false },
    { event_type: 'network.follow.created', site: 'openvibe.network', what: 'Somebody followed a channel or a person; the payload names the follower.' },
    { event_type: 'community.thread.created', site: 'openvibe.community', what: 'A forum thread was started; the payload names its author.' },
    { event_type: 'community.post.created', site: 'openvibe.community', what: 'A reply was posted in a thread; the payload names its author.' },
    { event_type: 'community.comment.created', site: 'openvibe.community', what: 'A comment was left on a post or a paste; the payload names its author.' },
    { event_type: 'space.thread.created', site: 'openvibe.space', what: 'A thread was started in a Space; the payload names its author.' },
    { event_type: 'chat.room.message.created', site: 'openvibe.chat', what: 'A message was posted in a PUBLIC chat room; the payload names its author. Private rooms and DMs never emit it.' },
    { event_type: 'wiki.revision.created', site: 'openvibe.wiki', what: 'A wiki page got a new immutable revision; the payload names its author (a service edit is ignored).' },
    { event_type: 'games.player.joined', site: 'openvibe.games', what: 'A character entered a world; the payload names its account\'s user subject (a guest is ignored).' },
    { event_type: 'tools.job.created', site: 'openvibe.tools', what: 'A tool job was accepted and queued; the payload names its owner (an anonymous session is ignored).' },
]);

// The events Quest actually counts: the consumer subscribes to exactly these, and a quest may not count an event
// this catalog does not document. A typo in a step therefore fails loudly here, not silently in production.
const COUNTED = Object.freeze(EVENTS.filter((e) => e.counted !== false).map((e) => e.event_type));
const EVENT_TYPES = Object.freeze(COUNTED.slice().sort());
{
    const missing = QUESTS.flatMap((q) => q.steps.map((s) => s.event_type)).filter((t) => !COUNTED.includes(t));
    if (missing.length) throw new Error(`quests/catalog.js: a quest counts an event that is not in EVENTS: ${[...new Set(missing)].join(', ')}`);
}

/** The sites, in the order they first appear in the catalog (so the pages read the same every time). */
const SITE_ORDER = Object.freeze([...new Set(QUESTS.map((q) => q.site))]);

const byId = (id) => BY_ID.get(String(id)) || null;
const all = () => QUESTS;
/** The quests that count this event type (a step may be shared: 'settle in' counts two sites). */
const withEvent = (eventType) => QUESTS.filter((q) => q.steps.some((s) => s.event_type === eventType));
/** The catalog grouped by site, for the home page and the API: [{ site, name, what, quests }]. */
const grouped = () => SITE_ORDER.map((site) => ({
    site,
    name: (SITES[site] || {}).name || site,
    what: (SITES[site] || {}).what || '',
    quests: QUESTS.filter((q) => q.site === site),
}));
/** The badge for a quest, by badge id (the public badge endpoint stores only the id). */
const badgeById = (badgeId) => {
    for (const q of QUESTS) if (q.reward.badge.id === badgeId) return { ...q.reward.badge, quest_id: q.id };
    return null;
};

module.exports = { QUESTS, SITES, EVENTS, EVENT_TYPES, SITE_ORDER, all, byId, withEvent, grouped, badgeById };
