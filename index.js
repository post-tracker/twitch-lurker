require( 'dotenv' ).config();
const tmi = require( 'tmi.js' );
const got = require( 'got' );

let liveStreams = [];
let devAccounts = [];
const posts = [];
const context = [];
let twitchClient = false;

const cleanContexts = function cleanContexts(){
    if ( context.length === 0 ) {
        return;
    }

    const timeSinceMessage = Date.now() - context[ context.length - 1 ].timestamp;

    if ( timeSinceMessage >= 300000 ) {
        context.pop();
        cleanContexts();
    }
};


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

const twitchApiRequest = function twitchApiRequest( path ) {
    return got( `https://api.twitch.tv/kraken${ path }`, {
        headers: {
            "Accept": "application/vnd.twitchtv.v5+json",
            "Client-ID": process.env.TWITCH_CLIENTID,
        },
    } )
    .then( response => {
        return JSON.parse( response.body );
    } );
}

const getGames = async function getGames() {
    console.log( '<info> Fetching games from API...' );
    const gamesResponse = await apiRequest( '/games' );

    const games = [];

    for ( let i = 0; i < gamesResponse.data.length; i = i + 1 ) {
        if ( gamesResponse.data[ i ].config.sources && gamesResponse.data[ i ].config.sources.Twitch ) {
            games.push( gamesResponse.data[ i ].config.sources.Twitch.name );

            if ( gamesResponse.data[ i ].config.sources.Twitch.allowedSections ) {
                liveStreams = liveStreams.concat( gamesResponse.data[ i ].config.sources.Twitch.allowedSections.map( ( streamName ) => {
                    return `#${ streamName }`;
                }) );
            }
        }
    }

    return games;
}

const getStreams = async function getStreams( games ) {
    console.log( '<info> Getting streams from kraken API' );

    for ( let i = 0; i < games.length; i++ ) {
        const apiPath = `/search/streams?query=${ encodeURIComponent( games[ i ] ) }&limit=25`;
        const streamsResponse = await twitchApiRequest( apiPath );

        for ( let j = 0; j < streamsResponse.streams.length; j++ ) {
            const stream = `#${ streamsResponse.streams[ j ].channel.name }`;
            liveStreams.push( stream );
        }
    }
}

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
        console.log( data );
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
        parts.forEach( ( part ) => {
            const newContext = {
                username: userstate.username,
                displayName: userstate[ 'display-name' ],
                channel,
                message,
                toDev: part.slice( 1 ).toLowerCase(),
                timestamp: Date.now(),
            };

            context.unshift( newContext );
        } );
    }

}


function twitchIrc( channels, devs ) {
    console.log( `<info> Listening for dev activity in ${ channels.join( ', ' ) }` );

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

    if ( twitchClient ) {
        twitchClient.disconnect();
    }

    twitchClient = new tmi.client( config );

    // The on chat event will fire for every message (in every connected channel)
    /* Docs for chat event: https://docs.tmijs.org/v1.2.1/Events.html#chat */
    twitchClient.on('chat', ( channel, userstate, message, self ) => {
        const msgData = { channel, userstate, message, self, devs };
        messageHandler( msgData );
    });

    twitchClient.connect();
};

function startup() {
    getGames()
        .then( games => {
            return getStreams( games );
        } )
        .then( () => {
            return getDevelopers();
        } )
        .then( allDevs => {
            twitchIrc( [ ...new Set( liveStreams ) ], allDevs );
        } );
}

startup();

// Prevent oudated context, awful but functional
setInterval( cleanContexts, 100 );

setInterval( () => {
    console.log( '<info> Running refresh routine...' );
    liveStreams = [];
    devAccounts = [];

    startup();
}, 600000 );
