require('dotenv').config();
const tmi = require('tmi.js');

// TODO: [injectJon]
// Fetch live EFT streams via twitch dev api, connect via IRC to top 20(?)
// Context for dev messages:
//     Option 1: Keep a constant 5min message history to grab context message (more context matches)
//     Option 2: Keep all messages (within 5min) that mention a dev (performant)


// Example params from API
const streams = [
    '#kotton',
    '#klean',
];

const devs = {
    'escapefromtarkov': {
        name: 'Nikita',
        nick: 'EscapeFromTarkov',
        role: 'Chief Operating Officer - Battlestate Games',
        twitchActivity: {
            updatedAt: Date.now(),
            active: false,
            channels: [],
            messages: [],
        },
    },
};

// Connect to the chat for all streams. Wait for replys from all devs.
// Optionally only connect when they are live?

function twitchIrc(channels, developers) {
    // Twitch IRC client config options
    /* Docs: https://docs.tmijs.org/v1.2.1/Configuration.html */
    const config = {
        options: {
            debug: false, // Set to true for irc output to console
        },
        connection: {
            reconnect: true,
        },
        identity: {
            username: process.env.TWITCH_USERNAME,
            password: process.env.TWITCH_OAUTH, // Get yours here: https://twitchapps.com/tmi/
        },
        channels,
    };

    const client = new tmi.client(config);

    // The on chat event will fire for every message (in every connected channel)
    /* Docs for chat event: https://docs.tmijs.org/v1.2.1/Events.html#chat */
    client.on('chat', (channel, userstate, message, self) => {
        const sender = userstate.username;
        if (!developers[sender]) return;

        const timestamp = new Date();

        const newMsg = {
            timestamp,
            channel,
            message,
        };

        // Update with latest activity
        // Placeholder until API implementation, you get the idea
        const dev = developers[sender].twitchActivity;
        dev.updatedAt = timestamp;
        dev.active = true;
        dev.channels.push(channel);
        dev.messages.push(newMsg);

    });

    client.connect();

}

twitchIrc(streams, devs);
