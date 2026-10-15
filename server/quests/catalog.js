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
 *   steps       [{ event_type, count, label, match? }] — every step must reach its count; `match` ({ field: value })
 *               counts only the events whose payload has those values (live.setup.task_completed: { task: 'emote' })
 *   series      optional: the SERIES it belongs to; the home page shows a series as one card, its page lists them
 *   reward      { badge: { id, name }, coins, item? } — a text badge label (no emoji), OpenCoins (loyalty, not money)
 *               and, for some, an item for the person's OpenVibe.Inventory: { issuer, alias, name, kind, emoji }, one of
 *               Live's items that Live lets Quest give (ADR-054 §3 grantors; server/quests/items.js grants it)
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
    'openvibe.blog': { name: 'OpenVibe.Blog', what: 'blogs' },
    'openvibe.deals': { name: 'OpenVibe.Deals', what: 'deals the community shares and votes on' },
    'openvibe.run': { name: 'OpenVibe.Run', what: 'jobs run on nodes' },
    'inventory.openvibe.network': { name: 'OpenVibe.Inventory', what: 'the items you own across OpenVibe' },
});

/**
 * Series: a set of quests one site offers together. The home page shows a series as one card that opens its page
 * (/series/<id>), so a long set does not bury the rest of the catalog; the API and the quest log list every quest.
 */
const SERIES = Object.freeze({
    'live-setup': {
        id: 'live-setup',
        site: 'openvibe.live',
        title: 'Set up your channel',
        why: 'OpenVibe.Live\'s go-live setup list: a quest for each task, and one for finishing it all.',
        how: 'Live tells Quest about a task the first time it sees it done: the next time you open OpenVibe.Live\'s home page or your setup list. A task done before this series existed counts too.',
        href: 'https://openvibe.live/',
        hrefLabel: 'Your setup list on OpenVibe.Live',
    },
});

const QUESTS = Object.freeze([
    {
        id: 'go-live',
        site: 'openvibe.live',
        title: 'Go live once',
        why: 'A channel with nothing on it is a promise; one broadcast makes it real.',
        steps: [{ event_type: 'live.stream.started', count: 1, label: 'Start a stream' }],
        reward: { badge: { id: 'first-broadcast', name: 'First Broadcast' }, coins: 10, item: { issuer: 'service:live', alias: 'hat_basic_cap', name: 'Basic Cap', kind: 'Hat', emoji: '🧢' } },
        repeatable: false,
    },
    {
        id: 'stream-three-times',
        site: 'openvibe.live',
        title: 'Stream three times',
        why: 'Three broadcasts is a habit; the first one is only an attempt.',
        steps: [{ event_type: 'live.stream.started', count: 3, label: 'Start a stream' }],
        reward: { badge: { id: 'regular-broadcaster', name: 'Regular Broadcaster' }, coins: 25, item: { issuer: 'service:live', alias: 'fx_fire', name: 'Fire Name', kind: 'Name effect', emoji: '🔥' } },
        repeatable: false,
    },
    {
        id: 'follow-someone',
        site: 'openvibe.network',
        title: 'Follow someone',
        why: 'The network is a list of people you chose to hear from.',
        steps: [{ event_type: 'network.follow.created', count: 1, label: 'Follow a channel or a person' }],
        reward: { badge: { id: 'first-follow', name: 'First Follow' }, coins: 5, item: { issuer: 'service:live', alias: 'px_hearts', name: 'Hearts', kind: 'Particle effect', emoji: '💖' } },
        repeatable: false,
    },
    {
        id: 'start-a-thread',
        site: 'openvibe.community',
        title: 'Start a forum thread',
        why: 'Every thread on the forum started as somebody\'s question.',
        steps: [{ event_type: 'community.thread.created', count: 1, label: 'Start a thread' }],
        reward: { badge: { id: 'thread-starter', name: 'Thread Starter' }, coins: 10, item: { issuer: 'service:live', alias: 'fx_ice', name: 'Ice Name', kind: 'Name effect', emoji: '❄️' } },
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
        reward: { badge: { id: 'said-hello', name: 'Said Hello' }, coins: 5, item: { issuer: 'service:live', alias: 'px_sparkle', name: 'Sparkle', kind: 'Particle effect', emoji: '✨' } },
        repeatable: false,
    },
    {
        id: 'improve-a-wiki-page',
        site: 'openvibe.wiki',
        title: 'Improve a wiki page',
        why: 'One corrected sentence is a page someone else reads correctly.',
        steps: [{ event_type: 'wiki.revision.created', count: 1, label: 'Save a revision' }],
        reward: { badge: { id: 'wiki-editor', name: 'Wiki Editor' }, coins: 15, item: { issuer: 'service:live', alias: 'fx_rainbow', name: 'Rainbow Name', kind: 'Name effect', emoji: '🌈' } },
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
        id: 'publish-a-blog-post',
        site: 'openvibe.blog',
        title: 'Publish a blog post',
        why: 'Every member gets a blog on OpenVibe.Blog; a first post makes it yours.',
        steps: [{ event_type: 'blog.post.published', count: 1, label: 'Publish a post on your blog' }],
        reward: { badge: { id: 'first-post', name: 'First Post' }, coins: 15 },
        repeatable: false,
    },
    {
        id: 'share-a-deal',
        site: 'openvibe.deals',
        title: 'Share a deal',
        why: 'A deal is only worth something when somebody posts it with its price and where it was seen.',
        steps: [{ event_type: 'deals.offer.created', count: 1, label: 'Submit a deal' }],
        reward: { badge: { id: 'deal-spotter', name: 'Deal Spotter' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'vote-on-deals',
        site: 'openvibe.deals',
        title: 'Vote on ten deals',
        why: 'Votes decide what is hot on OpenVibe.Deals, one person, one vote.',
        steps: [{ event_type: 'deals.vote.changed', count: 10, label: 'Vote a deal up or down' }],
        reward: { badge: { id: 'deal-judge', name: 'Deal Judge' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'run-a-job',
        site: 'openvibe.run',
        title: 'Run a job on a node',
        why: 'OpenVibe.Run sends a job to a machine that can do it, yours or the network\'s.',
        steps: [{ event_type: 'run.job.succeeded', count: 1, label: 'Run a job that finishes' }],
        reward: { badge: { id: 'job-runner', name: 'Job Runner' }, coins: 15 },
        repeatable: false,
    },
    {
        id: 'wear-an-item',
        site: 'inventory.openvibe.network',
        title: 'Wear an item',
        why: 'Hats, name effects and particles you earn show on every OpenVibe site once you wear them.',
        steps: [{ event_type: 'inventory.item.equipped', count: 1, label: 'Equip an item from your inventory' }],
        reward: { badge: { id: 'dressed-up', name: 'Dressed Up' }, coins: 5 },
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
    {
        id: 'live-setup-slot',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Create your stream slot',
        why: 'Your show gets its own key, settings, VODs and restreams.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'slot' }, count: 1, label: 'Create your stream slot on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-slot-holder', name: 'Slot Holder' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-method',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Choose how you stream',
        why: 'From the browser, from OBS over RTMP, or from OBS over WHIP: picking one is half the setup.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'method' }, count: 1, label: 'Choose how you stream on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-method-picked', name: 'Method Picked' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-restream',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Mirror to another platform',
        why: 'One stream on Twitch, YouTube, Kick, RobotStreamer or any RTMP server at the same time.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'restream' }, count: 1, label: 'Mirror to another platform on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-restreamer', name: 'Restreamer' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'live-setup-profile',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Add an avatar and a bio',
        why: 'The first thing people see on your channel and next to your name in chat.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'profile' }, count: 1, label: 'Add an avatar and a bio on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-profile-ready', name: 'Profile Ready' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-offline',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Make an offline screen',
        why: 'What visitors see while you are not live: an image, a video or your own page.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'offline' }, count: 1, label: 'Make an offline screen on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-offline-screen', name: 'Offline Screen' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-emote',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Upload a custom emote',
        why: 'Your chat, your inside jokes. Animated ones work too.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'emote' }, count: 1, label: 'Upload a custom emote on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-emote-maker', name: 'Emote Maker' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-sound',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Add a sound command',
        why: 'Viewers type !boom and your stream plays it.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'sound' }, count: 1, label: 'Add a sound command on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-sound-board', name: 'Sound Board' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-goal',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Set a donation goal',
        why: 'A visible target turns tips into a team effort.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'goal' }, count: 1, label: 'Set a donation goal on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-goal-setter', name: 'Goal Setter' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-powerchat',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Connect PowerChat',
        why: 'Card and crypto tips, with alerts on your stream.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'powerchat' }, count: 1, label: 'Connect PowerChat on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-tip-jar', name: 'Tip Jar' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'live-setup-panels',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Fill in your About panels',
        why: 'Links, schedule and rules: what people read under the player.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'panels' }, count: 1, label: 'Fill in your About panels on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-panel-writer', name: 'Panel Writer' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-share',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Get your first follower',
        why: 'Share your channel link: a follower hears about it every time you go live.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'share' }, count: 1, label: 'Get your first follower on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-followed', name: 'Followed' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'live-setup-mods',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Add a moderator',
        why: 'Someone you trust watching chat while you stream.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'mods' }, count: 1, label: 'Add a moderator on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-mod-squad', name: 'Mod Squad' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-requests',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Open media requests',
        why: 'Let viewers queue clips and tracks to play on your stream.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'requests' }, count: 1, label: 'Open media requests on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-request-line', name: 'Request Line' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-moderation',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Set your chat rules',
        why: 'Slow mode, followers-only and emote-only, tuned the way you want them.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'moderation' }, count: 1, label: 'Set your chat rules on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-rule-maker', name: 'Rule Maker' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-robot',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Connect a robot',
        why: 'Bind a robot from OpenVibe.Bot to your channel: its panel shows under your stream and chat can drive it.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'robot' }, count: 1, label: 'Connect a robot on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-robot-wrangler', name: 'Robot Wrangler' }, coins: 10 },
        repeatable: false,
    },
    {
        id: 'live-setup-aibot',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Add an AI chat regular',
        why: 'Keeps an empty chat warm and answers the usual questions.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'aibot' }, count: 1, label: 'Add an AI chat regular on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-bot-host', name: 'Bot Host' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-paste',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Publish a paste',
        why: 'Code, configs or notes from your stream, each on a page of its own.',
        steps: [{ event_type: 'live.setup.task_completed', match: { task: 'paste' }, count: 1, label: 'Publish a paste on OpenVibe.Live' }],
        reward: { badge: { id: 'live-setup-paste-author', name: 'Paste Author' }, coins: 5 },
        repeatable: false,
    },
    {
        id: 'live-setup-complete',
        site: 'openvibe.live',
        series: 'live-setup',
        title: 'Finish the whole go-live setup',
        why: 'Every task on the list done: the channel is ready for whoever walks in.',
        // Live sends each task once per person, so 18 of them is every task on the list.
        steps: [{ event_type: 'live.setup.task_completed', count: 18, label: 'Finish every task on the setup list' }],
        reward: { badge: { id: 'live-setup-complete', name: 'Fully Set Up' }, coins: 50 },
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
    { event_type: 'live.setup.task_completed', site: 'openvibe.live', what: 'A streamer finished a task on Live\'s go-live setup list for the first time; the payload names the streamer and the task, never what they made.' },
    { event_type: 'blog.post.published', site: 'openvibe.blog', what: 'A post was published; the envelope actor is the person who published it (a scheduled or service publish is ignored).' },
    { event_type: 'deals.offer.created', site: 'openvibe.deals', what: 'A deal was submitted; the envelope actor is the person who posted it (deals imported from a source are ignored).' },
    { event_type: 'deals.vote.changed', site: 'openvibe.deals', what: 'A vote on a deal was cast or changed; the envelope actor is the voter.' },
    { event_type: 'run.job.succeeded', site: 'openvibe.run', what: 'A job finished on a node; the payload names its requester (a service or app requester is ignored).' },
    { event_type: 'inventory.item.equipped', site: 'inventory.openvibe.network', what: 'An item was equipped; the payload names its owner, never what else they own.' },
]);

// The events Quest actually counts: the consumer subscribes to exactly these, and a quest may not count an event
// this catalog does not document. A typo in a step therefore fails loudly here, not silently in production.
const COUNTED = Object.freeze(EVENTS.filter((e) => e.counted !== false).map((e) => e.event_type));
const EVENT_TYPES = Object.freeze(COUNTED.slice().sort());
{
    const missing = QUESTS.flatMap((q) => q.steps.map((s) => s.event_type)).filter((t) => !COUNTED.includes(t));
    if (missing.length) throw new Error(`quests/catalog.js: a quest counts an event that is not in EVENTS: ${[...new Set(missing)].join(', ')}`);
    const orphans = QUESTS.filter((q) => q.series && !(SERIES[q.series] && SERIES[q.series].site === q.site)).map((q) => q.id);
    if (orphans.length) throw new Error(`quests/catalog.js: a quest names a series that is not in SERIES (or is on another site): ${orphans.join(', ')}`);
}

/** The sites, in the order they first appear in the catalog (so the pages read the same every time). */
const SITE_ORDER = Object.freeze([...new Set(QUESTS.map((q) => q.site))]);

const byId = (id) => BY_ID.get(String(id)) || null;
const all = () => QUESTS;
/** The quests that count this event type (a step may be shared: 'settle in' counts two sites). */
const withEvent = (eventType) => QUESTS.filter((q) => q.steps.some((s) => s.event_type === eventType));
/** Whether a step counts this event: its type, and every value its `match` names in the payload. */
const stepCounts = (step, event) => step.event_type === event.event_type
    && Object.entries(step.match || {}).every(([k, v]) => ((event.payload || {})[k]) === v);
/** The quests with a step that counts this very event (live.setup.task_completed for 'emote' moves two, not eighteen). */
const forEvent = (event) => QUESTS.filter((q) => q.steps.some((s) => stepCounts(s, event)));
/**
 * The catalog grouped by site, for the home page and the API: [{ site, name, what, quests, series }]. With
 * { fold: true } (the home page) a series' quests leave `quests` and `series` lists the series instead, each with its
 * quests; otherwise `quests` has every quest and `series` is empty.
 */
const grouped = ({ fold = false } = {}) => SITE_ORDER.map((site) => {
    const here = QUESTS.filter((q) => q.site === site);
    const series = Object.values(SERIES).filter((x) => x.site === site)
        .map((x) => ({ ...x, quests: here.filter((q) => q.series === x.id) })).filter((x) => x.quests.length);
    return {
        site,
        name: (SITES[site] || {}).name || site,
        what: (SITES[site] || {}).what || '',
        quests: fold ? here.filter((q) => !q.series) : here,
        series: fold ? series : [],
    };
});
const seriesById = (id) => {
    const x = Object.prototype.hasOwnProperty.call(SERIES, String(id)) ? SERIES[String(id)] : null;
    return x ? { ...x, quests: QUESTS.filter((q) => q.series === x.id) } : null;
};
/** The badge for a quest, by badge id (the public badge endpoint stores only the id). */
const badgeById = (badgeId) => {
    for (const q of QUESTS) if (q.reward.badge.id === badgeId) return { ...q.reward.badge, quest_id: q.id };
    return null;
};

module.exports = { QUESTS, SITES, SERIES, EVENTS, EVENT_TYPES, SITE_ORDER, all, byId, withEvent, forEvent, stepCounts, grouped, seriesById, badgeById };
