'use strict';
// The agent manifest of OpenVibe.Quest: what the site is, where its API is, and how it is reached.
// openvibe-shared/agent-layer turns this into /.well-known/agent.json.
module.exports = {
    id: 'quest', name: 'OpenVibe.Quest',
    purpose: 'One quest log across the whole OpenVibe network: finish quests by streaming, posting and playing, and earn badges, items and OpenCoins.',
    home: 'https://openvibe.quest', api: '/api/v1',
    docs: 'https://openvibe.quest/how-it-works',
    policy: {
        auth: ['none', 'bearer', 'Network OIDC'],
        rateLimit: 'The API is rate limited per caller; the limits are per address and per account.',
    },
};
