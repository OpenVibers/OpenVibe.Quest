# AGENTS.md — OpenVibe.Quest

## Project Overview

OpenVibe.Quest is one quest log across every OpenVibe site: it counts something a person really did (went live,
started a thread, said hello in a public chat, edited a wiki page, played a game) and pays a badge. When OpenCoins are
on it credits loyalty points through OpenVibe.Network's wallet (never money, never Vibes), and it can grant one of
Live's items through OpenVibe.Inventory. The home page leads with one shared daily quest; `/me` and `/me/daily` show a
private checklist, streak and level.

- **Domain:** `openvibe.quest` · **Port:** 4980 · **Service id:** `quest` · **Env prefix:** `QUEST`
- **Runtime:** Node 22, Express 4, PostgreSQL 18 through `openvibe-sdk/db` (PGlite in development/tests), Valkey for
  shared limits when configured.
- **Read first:** [README.md](README.md), [STATUS.json](STATUS.json), [.env.example](.env.example).

**Network context:** identity/sign-in and the wallet are OpenVibe.Network (OAuth client `quest`, PKCE S256; staff
roles). Events and their delivery are OpenVibe.Events. Item instances are OpenVibe.Inventory (Live names Quest a
grantor of its items, ADR-054 §3). Platform experience/levels are `openvibe-sdk/levels` calling Network. Daily quest
glyphs may request a draft from OpenVibe.Design (`design.glyph.draft`; with a bundled fallback always visible). Quest
stores no identity, no event, no item row and no balance.

## Commands

```bash
npm ci                         # install (contracts/sdk/shared pinned by tag)
npm run dev                    # http://localhost:4980, PGlite under data/
npm start                      # node server/index.js
npm test                       # every test/*.test.js on temp PGlite, mock Network, no network
npm run test:pg                # the same through PostgreSQL + PgBouncer
npm test -- daily              # only test files whose name contains the word
node --check <file.js>         # syntax check (no linter configured)
```

No build step: pages are server-rendered; CSS/JS under [public/css/](public/css/) (`app.css`, `quest-visual.css`) and
[public/js/quest-visual.js](public/js/quest-visual.js).

## Architecture at a Glance

- **Entry:** [server/index.js](server/index.js) — listener, telemetry, Events subscriptions, the OpenCoins/item/level
  retry timers and graceful stop. `QUEST_DRILL` keeps boot-time work off.
- **App factory:** [server/app.js](server/app.js) — CSP, SSO, `/auth`, `/internal/events`, `/shared`+static, `/api/v1`,
  discovery/agent twins, pages, 404/error handler.
- **Config:** [server/config.js](server/config.js) — `load(env)` is pure; production `/etc/openvibe/quest.env`.
- **Catalog:** [server/quests/catalog.js](server/quests/catalog.js) — 36 first-party quests and every event Quest
  listens to; a quest naming an undocumented event fails at load. Never add an event without the catalog entry.
- **Progress and rewards:** [server/quests/apply.js](server/quests/apply.js) (which event field names the person),
  [server/quests/store.js](server/quests/store.js), [server/quests/daily.js](server/quests/daily.js),
  [server/quests/coins.js](server/quests/coins.js), [server/quests/items.js](server/quests/items.js),
  [server/quests/levels.js](server/quests/levels.js), [server/quests/app-quests.js](server/quests/app-quests.js),
  [server/quests/glyph-drafts.js](server/quests/glyph-drafts.js).
- **Events:** [server/events-consumer.js](server/events-consumer.js) — raw body, v2 signature required, forwarded
  headers refused, SDK inbox for once-only application, 503 without `QUEST_EVENTS_SECRET`.
- **HTTP:** [server/http/api.js](server/http/api.js), [server/http/pages.js](server/http/pages.js),
  [server/http/principal.js](server/http/principal.js), [server/http/discovery.js](server/http/discovery.js),
  [server/http/router.js](server/http/router.js), [server/http/caller-limits.js](server/http/caller-limits.js).
- **Auth/account data:** [server/auth/sso.js](server/auth/sso.js), [server/auth/keys.js](server/auth/keys.js),
  [server/identity/account-data.js](server/identity/account-data.js), [server/identity/test-subjects.js](server/identity/test-subjects.js).
- **Rendering:** [server/render/](server/render/) — `layout.js`, `quests.js`, `quest-icons.js`, `badge-art.js`,
  `html.js`, `short.js`, `markdown.js`; agent twins [server/agent-pages.js](server/agent-pages.js),
  [server/agent-descriptor.js](server/agent-descriptor.js). Search documents: [server/search-index.js](server/search-index.js).
- **Database:** [server/db.js](server/db.js) and [migrations/](migrations/): `quest_progress`, `quest_completions`,
  `quest_badges`, `quest_event_inbox`, `account_data_events`, `quest_index_revisions`, `app_quests`,
  `quest_subject_merges`, `daily_quests`, `daily_step_types`, `daily_events`, `daily_personal_quests`,
  `daily_completions`, `daily_preferences`, `channel_daily_quests`, `daily_ai_choices`, a `test_subject` fixture
  table and `telemetry_samples`.
- **Deploy:** [deploy/systemd/openvibe-quest.service](deploy/systemd/openvibe-quest.service) (127.0.0.1:4980,
  `/etc/openvibe/quest.env`, `/opt/openvibe.quest`) and [deploy/nginx/openvibe.quest.conf](deploy/nginx/openvibe.quest.conf)
  (`/internal/` is 404 from outside). `sudo ovhost deploy quest`; database `ov_quest`.

## Ownership and Boundaries

Quest is the authority for a person's progress, completions, badges, daily quests/choices/preferences and app quests,
and for the `quest.*` namespace. It does **not** own identity, the wallet/OpenCoins ledger, Events, item definitions
or instances, or the sites' content (threads, posts, comments, messages, revisions, streams). Quest counts that an
event happened and stores none of the content itself. A `gst_` guest, a service/app/mod principal, or an event with
no person field is ignored — nothing is written.

## Auth and Capabilities

- A person is the Network token or this site's session (cookie writes must be same-origin). The only capabilities
  Quest itself uses are `quest.app_quest.manage` (a developer app defines its own quests),
  `quest.steps.contribute` (an app proposes a step type) and `quest.steps.review` (staff). `CAPABILITIES` in
  [server/http/principal.js](server/http/principal.js) is exactly that list — add to it and Contracts together.
- Outbound with Quest's own client-credentials token: `identity.subject.resolve`, `network.coins.credit`,
  `events.subscription.manage`, `inventory.item.grant`, and `network.levels.award` for platform experience.
  `design.glyph.draft` only when the Design internal URL is set; `QUEST_DESIGN_DRAFTS=off` disables requests.
- OpenCoins: `QUEST_COINS=on` credits with `idempotency_key = <completion id>`; per-person and global daily caps put
  over-cap completions in `coins_state=skipped` with a reason. Off records `skipped` and the pages say rewards start
  soon.
- Item rewards: six quests grant one of Live's items as `earned`, keyed by the completion id; `QUEST_ITEMS=off` turns
  it off. A refusal is recorded and retried by a timer, never silently dropped.
- Developer app quests cannot mint platform experience from arbitrary app events; their experience state is
  `skipped`.
- Errors are RFC 9457 problem+json with stable `quest.*` codes; limits return 429 with `Retry-After` before the route
  does work.

## API (`/api/v1`)

Public: `GET /ping`, `/quests`, `/quests/:id`, `/daily`, `/daily/:date`, `/step-types`,
`/profiles/:subject/badges` (id, name, date only), `/profiles/:subject/streak`, `/channels/:subject/quest`.
Signed in: `GET /me/quests`, `GET /me/daily`, `GET /quests/today`, `GET /quests/today/steps/:id`,
`POST /quests/today/steps/:id/done`, `PUT /me/daily/ai-text`, `PUT /me/daily/time-zone`, `PUT /me/channel-quest`.
App: `GET|PUT|DELETE /app-quests[/:slug]`, `POST /step-types`; staff `POST /step-types/:id/review`.
Machine endpoints `/api/health`, `/api/ready`, `/release.json`, `/metrics` are loopback only.

## Conventions

- CommonJS, 4-space indent, single quotes, semicolons; no linter/formatter. Async handlers through the router.
- **The person is not the envelope actor.** Take it from the field the event's schema defines (`channel.subject`,
  `follower`, `author`, `user_subject`, `player.subject`, `owner`), and only use the actor where the schema says the
  actor is that person.
- Two deliveries of one event change nothing; a replay of the whole request changes nothing (SDK inbox + unique
  completion).
- New schema = a new `migrations/NNNN_name.sql`; never edit one that has run. Keep `quest_`/`daily_` prefixes.
- Daily quests: one per UTC date, progress uses the person's chosen IANA time zone; a due-based job picks three
  verified step types across at least two sites, asks AI for recent network changes, and falls back to a hand-written
  set when AI is unavailable.
- Glyphs: the bundled glyph is always the fallback; only a Design-approved SVG may replace it, and pending drafts
  never leave Design.
- CSP: add origins to `helmet` in [server/app.js](server/app.js); do not widen `frameAncestors`/`objectSrc`.
- Phone first: home, a quest, `/me`, `/me/daily` fit 390 px; `<progress>` bars and forms work without JS.
- Empty states use the shared kit; no Font Awesome (shared glyphs only); "Calm reduces, only Off removes".

## Key Pitfalls

- **Event signatures:** forwarded requests and a missing `QUEST_EVENTS_SECRET` are refusals (503), not a bypass. A
  bad signature writes nothing. Never log an event's content.
- **Catalog load:** a quest that counts an undocumented event fails at load — add the event to the catalog and the
  subscription list, then Contracts if needed.
- **Badges are public and minimal:** `GET /profiles/:subject/badges` returns id, name and date and nothing else.
- **OpenCoins are loyalty points, not money or Vibes.** Never read or move money; never credit without the idempotency
  key, and never exceed either daily cap.
- **Levels:** only catalog/daily completions may award platform experience; a developer app quest sets
  `experience_state=skipped`. A 409 `levels.duplicate` is success, 404 `levels.person_not_found` is a skip.
- **Drill mode** (`QUEST_DRILL`) keeps subscriptions and every retry timer off; add new timers there.
- **Account export/deletion** runs through `/internal/events` only, is idempotent, and carries only the person's rows;
  a deletion erases them whole.
- **Migration 0009** adds the `event_outbox` rejected partial index; keep it.

## Testing

`npm test` runs each file in its own process on temp PGlite with a mock Network: events consumer (signature, replay,
per-event person field), quests API/pages, daily and streaks, levels, items, coins off/on and caps, app quests, step
types, account data, discovery, SSO/JWKS, caller limits, secret-leak/session/redirect, service kit, layout and perf
budgets. `npm run test:pg` for PostgreSQL. Run the narrowest file first, then the suite; always `node --check`
changed files.

## Documentation

- [README.md](README.md) — what it is, owns/does-not-own, capabilities/grants, what works, API, how progress happens,
  data terms, configuration, acceptance, deploy, account data, security.
- [docs/screenshots/](docs/screenshots/) — recorded UI states.
- [STATUS.json](STATUS.json) — stage, deployed flag, features and not-yet list.
- [.env.example](.env.example), [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md).
