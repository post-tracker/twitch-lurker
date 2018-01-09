const fs = require( 'fs' );

require( 'dotenv' ).config();
const tmi = require( 'tmi.js' );
const got = require( 'got' );
const chalk = require( 'chalk' );
const blessed = require( 'blessed' );
const contrib = require( 'blessed-contrib' );
const chunk = require( 'lodash.chunk' );

let liveStreams = [];
let devAccounts = [];
const posts = [];
const context = [];
const screen = blessed.screen();
let twitchClient = false;
const grid = new contrib.grid( {
    rows: 12,
    cols: 12,
    screen: screen
} );

const logLine = function logLine( line, log, type = 'info' ) {
    chunk( line.split( '' ), 55 ).forEach( ( arrayChunk ) => {
        let lineToLog = arrayChunk.join( '' );
        if ( type === 'error' ) {
            // lineToLog = chalk.red( lineToLog );
        }

        log.log( lineToLog );
    } );
};

 //grid.set(row, col, rowSpan, colSpan, obj, opts)
 const messageLog = grid.set(0, 0, 12, 4, contrib.log,  {
     fg: "green",
     selectedFg: "green",
     label: 'Message Log'
});
 const devLog = grid.set(0, 4, 12, 4, contrib.log,  {
     fg: 'green',
     selectedFg: 'green',
     label: 'Dev Log'
});
const contextCount = grid.set( 0, 8, 3, 4, contrib.lcd, {
    segmentWidth: 0.06, // how wide are the segments in % so 50% = 0.5
    segmentInterval: 0.11, // spacing between the segments in % so 50% = 0.550% = 0.5
    strokeWidth: 0.11, // spacing between the segments in % so 50% = 0.5
    elements: 6, // how many elements in the display. or how many characters can be displayed.
    display: 'ZERO', // what should be displayed before first call to setDisplay
    elementSpacing: 4, // spacing between each element
    elementPadding: 2, // how far away from the edges to put the elements
    color: 'white', // color for the segments
    label: 'Stored context objects'
} );
const contextSize = grid.set( 3, 8, 3, 4, contrib.lcd, {
    segmentWidth: 0.06, // how wide are the segments in % so 50% = 0.5
    segmentInterval: 0.11, // spacing between the segments in % so 50% = 0.550% = 0.5
    strokeWidth: 0.11, // spacing between the segments in % so 50% = 0.5
    elements: 9, // how many elements in the display. or how many characters can be displayed.
    display: 'WAITING', // what should be displayed before first call to setDisplay
    elementSpacing: 4, // spacing between each element
    elementPadding: 2, // how far away from the edges to put the elements
    color: 'white', // color for the segments
    label: 'Context memory size'
} );
const systemLog = grid.set( 6, 8, 6, 4, contrib.log,  {
    fg: 'green',
    selectedFg: 'green',
    label: 'System Log'
});

screen.key(['escape', 'q', 'C-c'], function(ch, key) {
    return process.exit(0);
});

screen.render();

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

function memorySizeOf(obj) {
    var bytes = 0;
    const decimalPlaces = 2;

    function sizeOf(obj) {
        if(obj !== null && obj !== undefined) {
            switch(typeof obj) {
            case 'number':
                bytes += 8;
                break;
            case 'string':
                bytes += obj.length * 2;
                break;
            case 'boolean':
                bytes += 4;
                break;
            case 'object':
                var objClass = Object.prototype.toString.call(obj).slice(8, -1);
                if(objClass === 'Object' || objClass === 'Array') {
                    for(var key in obj) {
                        if(!obj.hasOwnProperty(key)) continue;
                        sizeOf(obj[key]);
                    }
                } else bytes += obj.toString().length * 2;
                break;
            }
        }
        return bytes;
    };

    function formatByteSize(bytes) {
        if(bytes < 1024) return bytes + ' b';
        else if(bytes < 1048576) return(bytes / 1024).toFixed( decimalPlaces ) + ' KB';
        else if(bytes < 1073741824) return(bytes / 1048576).toFixed( decimalPlaces ) + ' MB';
        else return(bytes / 1073741824).toFixed( decimalPlaces ) + ' GB';
    };

    return formatByteSize(sizeOf(obj));
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
            'Accept': 'application/vnd.twitchtv.v5+json',
            'Client-ID': process.env.TWITCH_CLIENTID,
        },
    } )
    .then( response => {
        return JSON.parse( response.body );
    } );
}

const getGames = async function getGames() {
    // console.log( '<info> Fetching games from API...' );
    logLine( 'Fetching games from API...', systemLog );
    let gamesResponse;
    try {
        gamesResponse = await apiRequest( '/games' );
    } catch ( apiRequestError ) {
        logLine( apiRequestError, systemLog, 'error' );
        // throw apiRequestError;
        return false;
    }

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
    // console.log( '<info> Getting streams from kraken API' );
    logLine( 'Getting streams from kraken API', systemLog );

    for ( let i = 0; i < games.length; i++ ) {
        const apiPath = `/search/streams?query=${ encodeURIComponent( games[ i ] ) }&limit=25`;

        try {
            let streamsResponse = await twitchApiRequest( apiPath );

            logLine( `Twitch returned ${ streamsResponse.streams.length } streams for ${ encodeURIComponent( games[ i ] ) }`, systemLog );

            for ( let j = 0; j < streamsResponse.streams.length; j++ ) {
                const stream = `#${ streamsResponse.streams[ j ].channel.name }`;

                liveStreams.push( stream );
            }
        } catch ( twitchApiRequestError ) {
            logLine( `Twitch ${ apiPath } failed with "${ twitchApiRequestError.message }".`, systemLog, 'error'  );
            // throw twitchApiRequestError;
        }
    }
}

const getDevelopers = async function getDevelopers(){
    // console.log( '<info> Getting developers from API...' );
    logLine( 'Getting developers from API...', systemLog );
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
        // console.log( chalk.yellow( `${ data.userstate[ 'display-name' ] }: ${ data.message }` ) );
        devLog.log( `${ data.userstate[ 'display-name' ] }: ${ data.message }` );
        parts.forEach( part => {
            if ( !part.startsWith( '@' )) return;

            // get context
            context.forEach( ( msg, index ) => {
                if ( msg.username !== part.slice( 1 ).toLowerCase() || sender !== msg.toDev ) {
                    return;
                }

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

                // console.log( `<info> New post found:\n${ chalk.green( JSON.stringify( newMsg, null, 4 ) ) }` );
                fs.appendFile( './devs.txt', JSON.stringify( newMsg, null, 4 ), ( appendError ) => {
                    if ( appendError ) {
                        logLine( appendError.message, systemLog, 'error' );
                    } else {
                        logLine( 'Dev message saved', systemLog );
                    }

                } );
                posts.unshift( newMsg );
            } );
        } );

    } else {
        messageLog.log( `${ data.userstate[ 'display-name' ] }: ${ data.message }` );

        const newContext = {
            username: userstate.username,
            displayName: userstate[ 'display-name' ],
            channel,
            message,
            // toDev: part.slice( 1 ).toLowerCase(),
            timestamp: Date.now(),
        };

        context.unshift( newContext );

        contextCount.setDisplay( context.length );
        contextSize.setDisplay( memorySizeOf( context ) );
    }

}


function twitchIrc( channels, devs ) {
    // console.log( `<info> Listening for dev activity in ${ channels.join( ', ' ) }` );
    logLine( `Listening for dev activity in ${ channels.join( ', ' ) }`, systemLog );


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
    // console.log( '<info> Running refresh routine...' );
    logLine( 'Running refresh routine...', systemLog );
    liveStreams = [];
    devAccounts = [];

    startup();
}, 600000 );
