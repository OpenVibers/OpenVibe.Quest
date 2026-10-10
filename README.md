# OpenVibe.Quest

> Quests across the whole network.

**Status:** first release. The quest log, the events consumer, the OpenCoins crediting and the pages are written and
tested; it is not deployed, and OpenCoins are off until the feature is turned on.
**Domain:** `openvibe.quest` · **Port:** 4980 · **Service id:** `quest` · **Env prefix:** `QUEST`
**License:** AGPL-3.0 (same as every OpenVibe service).

## What it is

One quest log across every OpenVibe site. A quest counts something a person really did somewhere in the network —
went live, started a thread, said hello in a public chat room, edited a wiki page — and pays a **badge** on their
profile. When OpenCoins are on it also credits **OpenCoins** through OpenVibe.Network's wallet. OpenCoins are
loyalty points, **never money**, and they are **never Vibes** (Vibes are real money and belong to the sites that
pay them out); nothing here reads or moves money.

Quest runs no activities of its own. It listens to the domain events the sites already emit and nothing else: no
page views, no clicks, no watch time, and no content a person wrote — not a message's text, not a thread's title.
`/how-it-works` prints the complete list of what is listened to, generated from the same catalog the consumer
subscribes to.

## Owns

OpenVibe.Quest owns the quest log and the catalog that describes it.

- The **quest catalog** in code ([server/quests/catalog.js](server/quests/catalog.js)): 12 first-party quests, each
  with its steps, the events that count them, its badge, its OpenCoins and any item reward, plus the list of events
  Quest listens to. A quest may not count an event the catalog does not document; that fails at load.
- `quest_progress` ([migrations/0002_quest.sql](migrations/0002_quest.sql)): one row per (person, quest, step) — how
  far they are.
- `quest_completions` ([migrations/0002_quest.sql](migrations/0002_quest.sql), extended by
  [migrations/0004_item_rewards.sql](migrations/0004_item_rewards.sql)): one row per (person, quest) — the completion,
  its OpenCoins state and its item-grant state.
- `quest_badges` ([migrations/0002_quest.sql](migrations/0002_quest.sql)): one row per (person, badge).
- `quest_event_inbox` ([migrations/0002_quest.sql](migrations/0002_quest.sql)): this service's own receipts of the
  OpenVibe.Events deliveries it applied.
- `account_data_events` ([migrations/0003_account_data.sql](migrations/0003_account_data.sql)): its own receipts of
  the ADR-033 account export and deletion deliveries.

It is the authority for a person's quest progress, completions and badges, and for the `quest.*` namespace. Migration
`0001_initial.sql` creates no table.

## Does not own

- **Identity** — the `usr_…` subjects, the Network user id and the sign-in session are OpenVibe.Network's. Quest
  stores the subject a delivery names and resolves the wallet id on demand; it issues and verifies no identity itself.
- **Events** — the events and their delivery belong to OpenVibe.Events. Quest runs no activity of its own and only
  consumes what Events delivers.
- **Items and their definitions** — the items Quest grants (Sparkle, Hearts, Basic Cap, Fire Name, Ice Name, Rainbow
  Name) are OpenVibe.Live's, and the instances are OpenVibe.Inventory's. Quest holds no item row.
- **The wallet and the OpenCoins ledger** — the balance lives in OpenVibe.Network's wallet. Quest holds no balance and
  reads none.
- **The sites' content** — threads, posts, comments, chat messages, wiki revisions, streams and job inputs belong to
  OpenVibe.Community, OpenVibe.Space, OpenVibe.Chat, OpenVibe.Wiki, OpenVibe.Live and OpenVibe.Tools. Quest counts
  that they happened and stores none of them.

## Depends on

| Depends on | For | Env vars |
|---|---|---|
| **OpenVibe.Network** | sign-in with PKCE S256 (OAuth client `quest`), its JWKS, `identity.subject.resolve`, `network.coins.credit`, and the account export/deletion sender | `OV_NETWORK_URL`, `OV_NETWORK_INTERNAL_URL`, `OV_OAUTH_CLIENT_ID`, `OV_OAUTH_CLIENT_SECRET` |
| **OpenVibe.Events** | the deliveries to `POST /internal/events` and the subscriptions it creates at boot | `QUEST_EVENTS_URL`, `QUEST_EVENTS_SECRET`, `QUEST_EVENTS_ENDPOINT` |
| **OpenVibe.Inventory** | granting an item reward, and reading Live's item definitions by alias | `OV_INVENTORY_INTERNAL_URL` |
| **PostgreSQL** | the store (every migration and table) | `DATABASE_URL`, `DATABASE_DIRECT_URL` |
| **Valkey** | shared per-caller limit counters (optional: without it they count in this process) | `VALKEY_URL`, `VALKEY_PREFIX` |

Packages: **openvibe-contracts** (service auth, capabilities, HTTP problems), **openvibe-sdk** (auth, the events
inbox, account-data, limits, service lifecycle) and **openvibe-shared** (cache policy, metrics, readiness, release,
legal pages).

## Capabilities

The [service manifest](node_modules/openvibe-contracts/manifests/services/quest.json) lists **no capabilities of its
own** and produces no events; no `/api/v1` route is guarded by one ([server/http/principal.js](server/http/principal.js)
`CAPABILITIES` is empty). Quest calls these on other services with its own client-credentials token:

- `identity.subject.resolve` — OpenVibe.Network `GET /internal/identity/resolve`, to turn a subject into the wallet's
  `network_user_id` ([server/quests/coins.js](server/quests/coins.js)).
- `network.coins.credit` — OpenVibe.Network `POST /internal/coins/credit`, to credit a completion's OpenCoins.
- `events.subscription.manage` — OpenVibe.Events, to create the catalog's subscriptions at boot
  ([server/events-consumer.js](server/events-consumer.js)).
- `inventory.item.grant` — OpenVibe.Inventory `POST /api/v1/grants`, to give a quest's item
  ([server/quests/items.js](server/quests/items.js)).

## What works

| Piece | Where | What it does |
|---|---|---|
| Catalog | [server/quests/catalog.js](server/quests/catalog.js) | 12 first-party quests in code, one per real thing a person can do, plus the whole list of events Quest listens to (and the one it does not). A quest may not count an event the catalog does not document: that fails at load |
| Events consumer | [server/events-consumer.js](server/events-consumer.js) | `POST /internal/events`, exactly as OpenVibe.Space does it: raw body, `parseDelivery(…, { requireV2: true })`, the `openvibe-sdk` inbox for once-only application, forwarding headers refused, 503 without `QUEST_EVENTS_SECRET`. It subscribes to the catalog's events at boot (idempotent, off without `QUEST_EVENTS_URL`) |
| What moves a quest | [server/quests/apply.js](server/quests/apply.js) | The person is taken from the field the event's own schema defines (`channel.subject`, `follower`, `author`, `user_subject`, `player.subject`, `owner`; the envelope actor only where the schema says the actor *is* that person). No subject, a `gst_` guest, or a service/app/mod principal → ignored, nothing written |
| Quest log | [server/quests/store.js](server/quests/store.js), [migrations/0002_quest.sql](migrations/0002_quest.sql) | Progress per step, one completion per person per quest (unique), one badge per person, and the Events receipts. Two deliveries of the same event change nothing; so does a replay of the whole request |
| Item rewards | [server/quests/items.js](server/quests/items.js) | Six quests also give one of Live's items: Sparkle, Hearts, Basic Cap, Fire Name, Ice Name and Rainbow Name. Each is granted in OpenVibe.Inventory with Quest's own token (Live names Quest a grantor of those items, ADR-054 §3) as `earned`, keyed by the completion id. Failures and completions from before items are retried by a timer. `QUEST_ITEMS=off` turns it off |
| OpenCoins | [server/quests/coins.js](server/quests/coins.js) | Credits a completion through OpenVibe.Network's wallet with `idempotency_key = <completion id>`. Off by default, per-person and network-wide daily caps, failures recorded with their reason and retried by a timer |
| API | [server/http/api.js](server/http/api.js) | `GET /quests`, `GET /quests/:id`, `GET /me/quests`, `GET /profiles/:subject/badges` (see the table below) |
| Pages | [server/http/pages.js](server/http/pages.js), [server/render/quests.js](server/render/quests.js) | Home (the quests grouped by site, how progress works), a quest, your quest log (plain `<progress>` bars), the rules, the update log — all server-rendered, all readable without JavaScript |
| Discovery | [server/http/discovery.js](server/http/discovery.js) | `robots.txt` (the private log disallowed), `sitemap.xml` (every quest page), `llms.txt`, `llms-full.txt`, JSON-LD |
| Foundation | `server/app.js`, `server/auth/`, `server/db.js`, `server/observability.js`, `deploy/` | The skeleton's plumbing, unchanged: Network SSO with PKCE, per-caller limits, PostgreSQL migrations, truthful `/api/ready`, nginx and systemd files |

## API

| Route | Who | |
|---|---|---|
| `GET /api/v1/ping` | anyone | `{ ok: true, service: "quest" }` |
| `GET /api/v1/quests` | anyone | the catalog grouped by site (`sites[].quests`), a flat `quests[]`, and whether OpenCoins are live with their caps |
| `GET /api/v1/quests/:id` | anyone | one quest: its steps, its events, its reward |
| `GET /api/v1/me/quests` | a signed-in person | your log: progress per step, completions (with what happened to their coins) and your badges |
| `GET /api/v1/profiles/:subject/badges` | anyone | a person's badges: id, name and date — nothing else, ever |

Public reads need no token. `/me/quests` takes a person's Network token as a Bearer or this site's session, and
answers only that person's rows. Errors are RFC 9457 `application/problem+json` with a stable `code`. Requests are
counted per caller (a person as themselves, anyone else by address) with the default read numbers —
[server/http/caller-limits.js](server/http/caller-limits.js) `BUDGETS` is empty because no route is expensive yet.

## How progress happens

OpenVibe.Events delivers an event when a site really does something. Quest counts these, and only these:

| Event | From | The person is |
|---|---|---|
| `live.stream.started` | OpenVibe.Live | the channel's user subject (else the envelope actor) |
| `network.follow.created` | OpenVibe.Network | the follower |
| `community.thread.created` / `community.post.created` / `community.comment.created` | OpenVibe.Community | the author |
| `space.thread.created` | OpenVibe.Space | the author |
| `chat.room.message.created` | OpenVibe.Chat | `payload.user_subject` (public rooms only; a DM never reaches Quest) |
| `wiki.revision.created` | OpenVibe.Wiki | the author (a service edit is ignored) |
| `games.player.joined` | OpenVibe.Games | the player's account subject (a guest is ignored) |
| `tools.job.created` | OpenVibe.Tools | the owner (an anonymous session is ignored) |

A quest completes when every step reaches its count. The completion, its badge and (when OpenCoins are on) its
coins are recorded once; a redelivery of the same event, or the whole request again, changes nothing.

## Data sources and their terms

| Source | Used for | Terms as applied |
|---|---|---|
| **OpenVibe.Events** (`openvibe.events`) | the domain events that move the log, `POST /internal/events`, loopback only | Signed deliveries only: `X-OpenVibe-Signature-V2` (HMAC-SHA256 over `<timestamp>.<raw body>`), a 300-second replay window, `requireV2`, the secret from `QUEST_EVENTS_SECRET` (32+ characters, comma-separated for rotation). A delivery that carries a forwarding header is refused: nginx never proxies this route. Once-only application is the `openvibe-sdk` inbox, in the same transaction as the writes |
| **openvibe-contracts** v0.115.0 | the shape of every event and of the two Network calls | Every field read is the one the schema at `contracts/events/payloads/<type>.v1.json` defines; no field is inferred and nothing about a person is taken from a name or from the request |
| **OpenVibe.Network** (`openvibe.network`) | resolving a subject to its wallet id, and crediting OpenCoins | `GET /internal/identity/resolve` (capability `identity.subject.resolve`, `identity.resolve-result@1`) gives `network_user_id`; `POST /internal/coins/credit` (capability `network.coins.credit`, body `network.coins-change-request@1`, answer `network.coins-balance-result@1`) credits, with `app_id: quest` — a service token may only name its own app id. Both use this service's own client credentials over the internal URL; no token is logged |
| **OpenVibe sites** (Live, Community, Space, Chat, Wiki, Games, Tools, Network) | nothing is fetched from them | Quest makes no outbound request to any site, and no URL from a request ever decides one: the only host it calls is `OV_NETWORK_INTERNAL_URL` |

Rewards are badges and OpenCoins. Nothing here is money, and nothing here is Vibes.

## Configuration

See [.env.example](.env.example) for every name. Required in production: `OV_OAUTH_CLIENT_SECRET`, `BASE_URL`,
`DATABASE_URL` and `DATABASE_DIRECT_URL`. The product adds:

| Variable | Default | What it does |
|---|---|---|
| `QUEST_EVENTS_SECRET` | unset | signs the Events deliveries (32+ characters; comma-separated for rotation). Unset turns the consumer off (503) and the quest log then never moves |
| `QUEST_EVENTS_URL` | unset | OpenVibe.Events' base URL, used once at boot to create the subscriptions for the catalog's events |
| `QUEST_EVENTS_ENDPOINT` | `http://127.0.0.1:<port>/internal/events` | the endpoint the subscriptions name |
| `QUEST_COINS` | `off` | `on` credits rewards through Network's wallet; `off` records completions with `coins_state=skipped` and the pages say the rewards start soon |
| `QUEST_COINS_DAILY_CAP` | `50` | OpenCoins per person per UTC day; over it a completion is skipped with the reason |
| `QUEST_COINS_GLOBAL_DAILY_CAP` | `5000` | OpenCoins for everyone together per UTC day |
| `QUEST_COINS_RETRY_MS` | `300000` | how often a failed or unfinished credit is retried (only while `QUEST_COINS=on`) |

## Development

```bash
npm install
fnm exec --using=22 npm test        # every test/*.test.js, on temp PGlite databases with a mock Network
fnm exec --using=22 npm run dev     # http://localhost:4980
```

Without `DATABASE_URL` development uses an embedded PGlite database in `data/pglite` (one process only). `npm run
test:pg` runs the same suite through PostgreSQL and PgBouncer (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

The mock Network in [test/helpers/mocks.js](test/helpers/mocks.js) also serves `/internal/identity/resolve` and
`/internal/coins/credit`, checked as Network checks them (a `svc:quest` token with the capability, its own app id,
idempotent by key), so the OpenCoins tests need no real wallet.

## Acceptance

`npm test` ([test/run.js](test/run.js)) runs every `test/*.test.js` in its own process on temp PGlite databases and
an in-process mock of OpenVibe.Network ([test/helpers/mocks.js](test/helpers/mocks.js)); no network or running site is
needed. `npm run test:pg` runs the same suite through PostgreSQL and PgBouncer. The main proofs:

- [test/events-consumer.test.js](test/events-consumer.test.js) — a bad signature, a forwarded request and an
  unconfigured secret are refused; the same event twice changes nothing; progress counts to completion and the badge
  is awarded once; an event that names nobody creditable is ignored; OpenCoins off is skipped, on credits with the
  completion id as the idempotency key, the two daily caps stop it, and a failure is recorded and retried.
- [test/quests-api.test.js](test/quests-api.test.js) — the catalog and a quest are public; `/me/quests` requires
  sign-in and shows only the caller's rows; the badge endpoint answers an id, a name and a date and nothing else; the
  pages are complete without JavaScript; a hostile title is escaped.
- [test/items.test.js](test/items.test.js) — a quest's item is granted in a stand-in Inventory with `origin: earned`
  and the completion id, a refusal is recorded and retried, a completion from before items is granted by the retry,
  and `QUEST_ITEMS=off` grants nothing.
- [test/account-data.test.js](test/account-data.test.js) — an export carries only the person's own progress,
  completions and badges; a deletion erases them whole and confirms the counts; a redelivery changes nothing.
- [test/security-secrets.test.js](test/security-secrets.test.js) — the OAuth client secret never appears in a
  response, the database or a log line, over every route and hostile input.
- [test/security-session.test.js](test/security-session.test.js) — a FedCM assertion, app, service or internal token
  is never accepted as a session cookie.
- [test/caller-limits.test.js](test/caller-limits.test.js) — past its budget a caller gets 429 problem+json with
  Retry-After before the route does any work, while another caller still passes.
- [test/open-redirect.test.js](test/open-redirect.test.js) — the sign-in `next` never leaves the site.
- [test/no-internal-key.test.js](test/no-internal-key.test.js) — no `X-Internal-Key` anywhere in the code, deploy
  files or the running service (ADR-014).
- [test/auth-ops.test.js](test/auth-ops.test.js) — PKCE S256 sign-in, truthful `/api/ready`, `/release.json`, and
  loopback-only `/metrics`.
- [test/auth-jwks.test.js](test/auth-jwks.test.js) — the Network signing key is kept across outages, a rotation is
  honoured at once and unknown-kid floods are throttled.
- [test/discovery.test.js](test/discovery.test.js) — `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` and the
  JSON-LD carry real public entries only and take `lastmod` from STATUS.json, not the clock.
- [test/service-kit.test.js](test/service-kit.test.js) — the graceful stop runs its close steps in the manifest's
  order and resolves exit 0.
- [test/layout.test.js](test/layout.test.js), [test/asset-cache.test.js](test/asset-cache.test.js),
  [test/nginx-auth-limit.test.js](test/nginx-auth-limit.test.js) and [test/perf-budget.test.js](test/perf-budget.test.js)
  — the shared boost marker and the asset cache rules, the nginx limit zones, and the home page's size budgets.

## Deploy (for the lead)

- **Deploy:** `sudo ovhost deploy quest` on the host (git checkout at `/opt/openvibe.quest`, unit
  `openvibe-quest.service` on 127.0.0.1:4980, env `/etc/openvibe/quest.env`, database `ov_quest` on the data role).
- **nginx:** [deploy/nginx/openvibe.quest.conf](deploy/nginx/openvibe.quest.conf), installed with `ov-vhost-install`.
  `/internal/` is answered 404 from outside; Events posts to the loopback address directly.
- **Rollback:** ovhost puts the previous sha back by itself when `/api/ready` does not answer after the restart.
- **Before OpenCoins can be turned on**, OpenVibe.Network must grant the `quest` OAuth client
  `identity.subject.resolve` and `network.coins.credit` (its service-principal grants), and `QUEST_EVENTS_SECRET`
  and a subscription for the catalog's events must exist at OpenVibe.Events.
- Register the service and its capabilities in **OpenVibe.Contracts** (`contracts-service: quest` in CI) and with
  **OpenVibe.Services** before the first deploy.

## Account export and deletion

A person's account at OpenVibe.Network can be exported and deleted, and every service holding their rows answers its
part (ADR-033). Quest receives `network.account.export_requested` and `network.account.deleted` at `POST /internal/events`
(loopback only) through the consumer it already runs — the two account topics are handed to
[server/identity/account-data.js](server/identity/account-data.js), which maps the tables, and the boot-time
subscriptions for them are created (alongside the catalog's events) by
[server/events-consumer.js](server/events-consumer.js):

- **Exported:** the quests a person is partway through (`progress.json`), the quests they completed and their OpenCoins
  (`completions.json`) and the badges they earned (`badges.json`), pushed to `POST /internal/account-exports/:id/parts`
  with this service's own token. Nothing here is a secret — Quest stores no token, key or credential.
- **Erased:** all three tables hold the person's own rows and nothing anyone else's page hangs under them, so they are
  deleted whole and nothing is kept. Deleting a completion deletes its OpenCoins record here; the wallet credit at
  OpenVibe.Network is Network's own data. Quest then confirms with `POST /internal/account-deletions/:id/confirmations`
  and the counts.
- **Anonymized:** nothing. There is no row Quest keeps that was written by this person for another person to read.

The delivery receipts (`quest_event_inbox`) are this service's own, not a person's rows, and are neither exported nor
erased.

Environment: `QUEST_EVENTS_SECRET` (comma-separated for rotation, 32+ characters each; unset makes the route answer
503), `QUEST_EVENTS_URL` (or `EVENTS_URL`) is where the subscriptions are created at boot (off when unset), and
`QUEST_EVENTS_ENDPOINT` overrides the loopback endpoint; `QUEST_EVENTS_SUBSCRIBE=0` turns the boot-time subscription off.

## Security (threat notes)

Reporting a vulnerability: [SECURITY.md](SECURITY.md).

- Session tokens are httpOnly cookies; a FedCM assertion or an app or service token is never a session.
- Secrets live only in the env file; only environment variable names appear in code and docs, and no secret is
  logged. A wallet or identity failure is recorded as Network's own short code, never as a token or a body.
- Request bodies are never logged. The Events route is the one place a body is read raw, and only to verify its
  signature.
- Nothing in a request may decide a URL this service fetches: the only host Quest calls is the configured
  `OV_NETWORK_INTERNAL_URL`.
- A person's log is theirs: `/me/quests` answers their rows only, and the public badge endpoint answers an id, a
  name and a date and nothing else.

---

Part of the [OpenVibe network](https://openvibe.network). Built in the open by [OpenVibers](https://github.com/OpenVibers).

<!-- versions:start -->
- openvibe-contracts: v0.127.0
- openvibe-sdk: v0.36.0
- openvibe-shared: v2.21.0
<!-- versions:end -->
