require( 'dotenv' ).config();
const tmi = require( 'tmi.js' );
const got = require( 'got' );

const liveStreams = [];
const devAccounts = [];
const posts = [];
let context = [];

// Prevent oudated context, awful but functional
setInterval( () => {
    if ( context.length === 0 ) return;

    const timeSinceMessage = Date.now() - context[ context.length - 1 ].timestamp;

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
        }
    }

    return games;
}

const getStreams = async function getStreams( games ) {
    console.log( '<info> Getting streams from kraken API' );

    for ( let i = 0; i < games.length; i++ ) {
        let game = games[ i ];
        const split = game.split( ' ' )
        const needsEncoding = ( split.length >= 2 )

        if ( needsEncoding ) {
            game = split.join( '+' );
        }

        const apiPath = `/search/streams?query=${ game }&limit=25`;
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


function twitchIrc( channels, devs ) {
    console.log( '<info> Listening for dev activity...' );

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

getGames()
    .then( games => {
        return getStreams( games );
    } )
    .then( () => {
        return getDevelopers();
    } )
    .then( allDevs => {
        twitchIrc( liveStreams, allDevs );
    } );
