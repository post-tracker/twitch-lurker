require('dotenv').config();
const tmi = require('tmi.js');
const got = require( 'got' );

// TODO: [injectJon]
// Fetch live EFT streams via twitch dev api, connect via IRC to top 20(?)
// Context for dev messages:
//     Option 1: Keep a constant 5min message history to grab context message (more context matches)
//     Option 2: Keep all messages (within 5min) that mention a dev (performant)

const apiRequest = function apiRequest( path ) {
    return got( `https://api.kokarn.com${ path }`, {
            headers: {
                Authorization: `Bearer ${ process.env.API_TOKEN }`
            },
        } )
        .then( ( response ) => {
            return JSON.parse( response.body );
        } );
};

const getStreams = async function getStreams(){
    const gamesResponse = await apiRequest( '/games' );

    for ( let i = 0; i < gamesResponse.data.length; i = i + 1 ) {
        if ( gamesResponse.data[ i ].identifier === 'escape-from-tarkov' ) {
            return gamesResponse.data[ i ].config.sources.Twitch.allowedSections.map( ( streamName ) => {
                return `#${ streamName }`;
            } );
        }
    }
};

const getDevelopers = async function getDevelopers(){
    const accountResponse = await apiRequest( '/escape-from-tarkov/accounts' );
    const validAccounts = {};

    accountResponse.data.map( ( account ) => {
        if ( account.service !== 'Twitch' ) {
            return true;
        }

        validAccounts[ account.identifier ] = Object.assign(
            {},
            account,
            {
                twitchActivity: {
                    updatedAt: Date.now(),
                    active: false,
                    channels: [],
                    messages: [],
                },
            }
        )
    } );

    return validAccounts;
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

let streams;

getStreams()
    .then( ( allStreams ) => {
        streams = allStreams;

        return getDevelopers();
    } )
    .then( ( allDevs ) => {
        twitchIrc( streams, allDevs );
    } );
