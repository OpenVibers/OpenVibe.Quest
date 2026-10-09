# Changelog

What changed in OpenVibe.Quest, newest first. Each site also publishes its patch notes at /updates.

## 0.3.0 — 2026-10-09

- **Item rewards** (plan T21): six quests also give one of Live's items for the person's OpenVibe.Inventory: say hello
  in chat (Sparkle), follow someone (Hearts), go live (Basic Cap), stream three times (Fire Name), start a thread (Ice
  Name), improve a wiki page (Rainbow Name).
  - **How:** `server/quests/items.js` grants each in Inventory after the completion commits, with Quest's own token,
    origin `earned` and the completion id as the idempotency key.
  - **Failures:** a failed grant is recorded (`migrations/0004_item_rewards.sql`) and retried by a timer, which also
    reaches completions from before this release.
  - **Pages:** the quest pages, `/me` and `/api/v1/quests` name the item.

## 0.2.0 — 2026-10-08

- **The product.** One quest log across the whole network:
  - a catalog of 12 first-party quests in code (`server/quests/catalog.js`), grouped by the site whose events each
    one counts, each with a badge and OpenCoins;
  - `POST /internal/events` (`server/events-consumer.js`), exactly as OpenVibe.Space does it — raw body, signature
    v2, the `openvibe-sdk` inbox for once-only application, forwarding headers refused, 503 without
    `QUEST_EVENTS_SECRET` — with the person taken from the field each event's own schema defines
    (`server/quests/apply.js`) and an ignored outcome for anything that names nobody Quest may credit;
  - `quest_progress`, `quest_completions`, `quest_badges` and the Events receipts (`migrations/0002_quest.sql`), all
    keyed by the canonical subject and safe under a redelivery;
  - OpenCoins through OpenVibe.Network's wallet (`server/quests/coins.js`): `idempotency_key` is the completion id,
    `QUEST_COINS` is off by default, per-person and network-wide daily caps, a failure recorded with its reason and
    retried by a timer;
  - the API: `GET /api/v1/quests`, `/quests/:id`, `/me/quests`, `/profiles/:subject/badges`;
  - pages: home, a quest, your quest log (plain `<progress>` bars), the rules, and a sitemap that lists every quest
    page — all server-rendered and complete without JavaScript;
  - the test suite grew two files: `test/events-consumer.test.js` and `test/quests-api.test.js`, and the mock
    Network now serves `/internal/identity/resolve` and `/internal/coins/credit` the way Network checks them.
- The home page grew by about 9 KB with the catalog and the event list; the perf budget was raised to match
  (`test/perf-budget.test.js`, measured 34.0 KB raw / 7.7 KB brotli).
- nginx: `/internal/` is answered 404 from outside; Events posts to the loopback address directly.

## 0.1.0 — 2026-10-08

- **First release:** the service starts from the OpenVibe skeleton — sign-in with OpenVibe.Network (OAuth 2 + PKCE), server-rendered pages through the OpenVibe Frame, the `/api/v1` mount with per-caller limits, crawl artifacts, PostgreSQL migrations, the deploy files and the test suite.
