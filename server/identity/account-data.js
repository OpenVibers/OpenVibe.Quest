'use strict';

/**
 * Account export and deletion → Quest (ADR-033; openvibe-sdk/account-data). Quest holds three things a person
 * made: how far they are through each quest (quest_progress), the quests they finished and the OpenCoins that go
 * with them (quest_completions), and the badges they earned (quest_badges). All three are keyed `subject = usr_…`
 * (server/quests/store.js writes the event's subject straight into the column), the person's own rows — nothing
 * anyone else hangs under them — so all three are deleted whole and nothing is kept.
 *
 *   network.account.export_requested  the person's progress, completions and badges, pushed to Network
 *                                     (POST /internal/account-exports/:id/parts) with this service's token.
 *   network.account.deleted           the person's rows in all three tables go, and Quest confirms with counts.
 *
 * Coins: a completion is a loyalty reward; deleting the completion deletes its record here. The wallet credit at
 * OpenVibe.Network is Network's own data, not Quest's.
 *
 * quest_event_inbox holds this service's own delivery receipts, not a person's rows, so it is neither exported nor
 * erased (migrations/0002_quest.sql). Nothing here is a secret: no token, key or credential is stored, so every
 * column of all three tables may be exported.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

/**
 * The tables that hold a person's rows, with the value the subject column really stores. All three store the raw
 * `usr_…` id (server/quests/store.js takes it from the event's schema field), so the value is the identity itself —
 * the SDK default, no prefix.
 */
const TABLES = [
    { table: 'quest_progress', subject: 'subject', file: 'progress.json' },
    { table: 'quest_completions', subject: 'subject', file: 'completions.json' },
    { table: 'quest_badges', subject: 'subject', file: 'badges.json' },
];

/** The account-data handle for Quest's store (server/db.js createStore). */
function create({ db, note = null, log = console } = {}) {
    return createAccountData({ db, service: 'quest', tables: TABLES, note, log });
}

module.exports = { create, TABLES, TOPICS };
