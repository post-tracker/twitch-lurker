require('dotenv').config();
const tmi = require('tmi.js');
const got = require( 'got' );

// TODO: [injectJon]
// Fetch live EFT streams via twitch dev api, connect via IRC to top 20(?)
// Context for dev messages:
//     Option 1: Keep a constant 5min message history to grab context message (more context matches)
//     Option 2: Keep all messages (within 5min) that mention a dev (performant)

const devAccounts = [];
const posts = [];
let context = [];

// Prevent oudated context, awful but functional
setInterval( () => {
    if ( context.length === 0 ) return;

    const now = Date.now()
    const timeSinceMessage = Date.now() - context[ context.length - 1 ].timestamp

    if ( timeSinceMessage >= 300000 ) {
        context.pop();
    }

}, 100 )

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
    console.log( '<info> Getting streams from API...' );
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
    console.log( '<info> Getting developers from API...' );
    const accountResponse = await apiRequest( '/escape-from-tarkov/accounts' );
    const validAccounts = {};

    accountResponse.data.map( ( account ) => {
        if ( account.service !== 'Twitch' ) {
            return true;
        }

        devAccounts.push( `@${ account.identifier.toLowerCase() }` );

        validAccounts[ account.identifier.toLowerCase() ] = Object.assign(
            {},
            account,
            {
                twitchActivity: {
                    updatedAt: Date.now(),
                    active: false,
                    messages: [],
                },
            }
        )
    } );

    return validAccounts;
};

// Not happy with this; too many possible inconsistencies
// - can't guarantee context message will be correct
function messageHandler( data ) {
    const { channel, userstate, message, self, devs } = data;
    const sender = userstate.username;

    const parts = message.split(' ');

    if ( devs[ sender ] ) {
        // handle dev message
        parts.forEach( part => {
            if ( !part.startsWith( '@' )) return;

            // get context
            context.forEach( ( msg, index ) => {
                if ( msg.username !== part.slice( 1 ).toLowerCase() || sender !== msg.toDev ) return;

                const newMsg = {
                    developer: devAccounts[ sender ].identifier,
                    toUser: msg.displayName,
                    channel,
                    message,
                    context: msg,
                    timestamp: Date.now(),
                };

                // Delete context messages after tying to a dev message
                context.splice( index, 1 );

                console.log( `<info> New post found:\n${ newMsg }` );
                posts.unshift( newMsg );
            } );
        } );

    } else {
        parts.forEach( part => {
            if ( !part.startsWith( '@' ) ) return;

            if ( devs[ part.slice( 1 ).toLowerCase() ] ) {
                const newContext = {
                    username: userstate.username,
                    displayName: userstate[ 'display-name' ],
                    channel,
                    message,
                    toDev: part.slice( 1 ).toLowerCase(),
                    timestamp: Date.now(),
                };

                context.unshift( newContext );
            }
        } );
    }

}

// Connect to the chat for all streams. Wait for replys from all devs.
// Optionally only connect when they are live?

function twitchIrc( channels, devs ) {
    // Twitch IRC client config options
    /* Docs: https://docs.tmijs.org/v1.2.1/Configuration.html */
    const config = {
        options: {
            debug: false,
        },
        connection: {
            reconnect: true,
        },
        identity: {
            username: process.env.TWITCH_USERNAME,
            password: process.env.TWITCH_OAUTH,
        },
        channels,
    };

    const client = new tmi.client( config );

    // The on chat event will fire for every message (in every connected channel)
    /* Docs for chat event: https://docs.tmijs.org/v1.2.1/Events.html#chat */
    client.on('chat', ( channel, userstate, message, self ) => {
        const msgData = { channel, userstate, message, self, devs };
        messageHandler( msgData );
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
        console.log( '<info> Listening for dev activity...' );
        twitchIrc( streams, allDevs );
    } );
