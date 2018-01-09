const fs = require( 'fs' );

require( 'dotenv' ).config();
const tmi = require( 'tmi.js' );
const got = require( 'got' );
const chalk = require( 'chalk' );
const blessed = require( 'blessed' );
const contrib = require( 'blessed-contrib' );
const chunk = require( 'lodash.chunk' );
const timestamp = require( 'time-stamp' );
const now = require( 'performance-now' );

let liveStreams = [];
let devAccounts = {};
let twitchNames = {};
let extraStreams = {};
let games;
let gamesToCheck = [];

const posts = [];
const context = [];
const screen = blessed.screen();
let twitchClient = false;
const grid = new contrib.grid( {
    rows: 12,
    cols: 12,
    screen: screen
} );
const lineStats = {
    title: 'texts',
    x: [],
    y: [],
};
const MAX_LINE_POINTS = 30;

 //grid.set(row, col, rowSpan, colSpan, obj, opts)
 const messageLog = grid.set(0, 0, 9, 4, contrib.log,  {
     fg: 'green',
     selectedFg: 'green',
     label: 'Message Log'
});
const performanceLine = grid.set(9, 0, 3, 4, contrib.line, {
    style: {
        line: 'yellow',
        ext: 'green',
        baseline: 'black'
    },
    xLabelPadding: 3,
    xPadding: 5,
    howLegend: true,
    wholeNumbersOnly: true, //true=do not show fraction in y axis
    label: 'Messages / second',
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

const sleep = function sleep( ms ) {
    return new Promise( ( resolve ) => {
        setTimeout( resolve, ms );
    } );
};

const logLine = function logLine( line, log, type = 'info' ) {
    chunk( line.split( '' ), 55 ).forEach( ( arrayChunk ) => {
        let lineToLog = arrayChunk.join( '' );
        if ( type === 'error' ) {
            // lineToLog = chalk.red( lineToLog );
        }

        log.log( lineToLog );
    } );
};

const getUsersInChat = function getUsersInChat( streamName ) {
    const dataUrl = `https://tmi.twitch.tv/group/user/${ streamName }/chatters`;

    return got( dataUrl, {
        json: true,
    } );
};

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

const addMessageStat = function addMessageStat(){
    const currentTimestamp = timestamp( 'HH:mm:ss' );
    if ( lineStats.x.length > MAX_LINE_POINTS ) {
        lineStats.x.shift();
        lineStats.y.shift();
    }

    if ( lineStats.x[ lineStats.x.length - 1 ] !== currentTimestamp ) {
        lineStats.x.push( currentTimestamp );
        lineStats.y.push( 0 );
    }

    lineStats.y[ lineStats.y.length - 1 ] = lineStats.y[ lineStats.y.length - 1 ] + 1;
};

const memorySizeOf = function memorySizeOf(obj) {
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
            json: true,
        } )
        .then( ( response ) => {
            return response.body;
        } );
};

const twitchApiRequest = function twitchApiRequest( path ) {
    return got( `https://api.twitch.tv/kraken${ path }`, {
        headers: {
            'Accept': 'application/vnd.twitchtv.v5+json',
            'Client-ID': process.env.TWITCH_CLIENTID,
        },
        json: true,
    } )
    .then( ( response ) => {
        return response.body;
    } );
}

const checkDevsInStream = async function checkDevsInStream( stream ) {
    const start = now();
    let response;

    try {
        response = await getUsersInChat( stream );
    } catch ( getUsersError ) {
        return false;
    }
    let users = [];

    Object.keys( response.body.chatters ).forEach( ( chatterType ) => {
        users = users.concat( response.body.chatters[ chatterType ] );
    } );

    for ( const dev in devAccounts ) {
        if ( users.includes( dev ) ) {
            logLine( `[${ timestamp( 'HH:mm' ) }] ${ dev } spotted in #${ stream }`, devLog );
        }
    }

    const end = now();

    // Make sure we don't do more than 1 request / 1000 ms
    if ( end - start < 1000 ) {
        await sleep( 1000 - ( end - start ) );
    }
};

const findDevs = async function findDevs(){
    while ( true ) {
        const streamsCopy = liveStreams.slice(); // Make sure the streams isn't altered
        for ( let i = 0; i < streamsCopy.length; i = i + 1 ) {
            await checkDevsInStream( streamsCopy[ i ].replace( '#', '' ) )
        }

        // Wait so we don't blow the CPU ^^
        if ( streamsCopy.length < 1 ) {
            await sleep( 1000 );
        }
    }
};

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

    games = gamesResponse.data;

    for ( let i = 0; i < gamesResponse.data.length; i = i + 1 ) {
        if ( gamesResponse.data[ i ].config.sources && gamesResponse.data[ i ].config.sources.Twitch ) {

            if ( gamesResponse.data[ i ].config.sources.Twitch.name ) {
                twitchNames[ gamesResponse.data.identifier ] = gamesResponse.data[ i ].config.sources.Twitch.name;
            }

            if ( gamesResponse.data[ i ].config.sources.Twitch.allowedSections ) {
                extraStreams[ gamesResponse.data.identifier ] =  gamesResponse.data[ i ].config.sources.Twitch.allowedSections.map( ( streamName ) => {
                    return `#${ streamName }`;
                } );
            }
        }
    }
}

const getStreams = async function getStreams() {
    // console.log( '<info> Getting streams from kraken API' );
    logLine( 'Getting streams from kraken API', systemLog );

    for ( let i = 0; i < gamesToCheck.length; i = i + 1 ) {
        const apiPath = `/search/streams?query=${ encodeURIComponent( gamesToCheck[ i ] ) }&limit=25`;

        try {
            let streamsResponse = await twitchApiRequest( apiPath );

            logLine( `Twitch returned ${ streamsResponse.streams.length } streams for ${ encodeURIComponent( gamesToCheck[ i ] ) }`, systemLog );

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
    for ( let game of games ) {
        const accountResponse = await apiRequest( `/${ game.identifier }/accounts` );

        // logLine( `got ${ accountResponse.data.length } accounts for ${ game.identifier }`, systemLog );
        accountResponse.data.map( ( account ) => {
            if ( account.service !== 'Twitch' ) {
                return true;
            }

            const twitchGameName = twitchNames[ game.identifier ] || game.name;

            if ( !gamesToCheck.includes( twitchGameName ) ) {
                gamesToCheck.push( twitchGameName );
            }

            devAccounts[ account.identifier.toLowerCase() ] = Object.assign(
                {},
                account,
                {
                    twitchActivity: {
                        updatedAt: Date.now(),
                        active: false,
                        messages: [],
                    },
                }
            );
        } );
    }

};

// Not happy with this; too many possible inconsistencies
// - can't guarantee context message will be correct
const messageHandler = function messageHandler( data ) {
    const { channel, userstate, message, self } = data;
    const sender = userstate.username;

    const parts = message.split(' ');
    addMessageStat();

    if ( devAccounts[ sender ] ) {
        // handle dev message
        // console.log( chalk.yellow( `${ data.userstate[ 'display-name' ] }: ${ data.message }` ) );
        devLog.log( `${ channel } ${ data.userstate[ 'display-name' ] }: ${ data.message }` );
        fs.appendFile( './posts.txt', `${ JSON.stringify( data ) }\n`, ( appendError ) => {
            if ( appendError ) {
                logLine( appendError.message, systemLog, 'error' );
            } else {
                logLine( 'Dev message saved', systemLog );
            }

        } );

        parts.forEach( part => {
            if ( !part.startsWith( '@' )) {
                return;
            }

            // get context
            context.forEach( ( msg, index ) => {
                if ( msg.username !== part.slice( 1 ).toLowerCase() || msg.channel !== channel ) {
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
                        logLine( 'Dev post saved', systemLog );
                    }

                } );
                posts.unshift( newMsg );
            } );
        } );
    } else {
        const newContext = {
            username: userstate.username,
            displayName: userstate[ 'display-name' ],
            channel,
            message,
            // toDev: part.slice( 1 ).toLowerCase(),
            timestamp: Date.now(),
        };

        context.unshift( newContext );
        messageLog.log( `${ data.userstate[ 'display-name' ] }: ${ data.message }` );
        contextCount.setDisplay( context.length );
    }
}


function twitchIrc( channels ) {
    // console.log( `<info> Listening for dev activity in ${ channels.join( ', ' ) }` );
    logLine( `Listening for activity from ${ Object.keys( devAccounts ).length } devs in ${ channels.length } streams`, systemLog );


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
        const msgData = { channel, userstate, message, self };
        messageHandler( msgData );
    });

    twitchClient.connect();
};

function startup() {
    getGames()
        .then( () => {
            return getDevelopers();
        } )
        .then( () => {
            return getStreams();
        } )
        .then( () => {
            twitchIrc( [ ...new Set( liveStreams ) ] );
        } );
}

startup();
findDevs();

// Initiate a clean contexts call every 100ms
setInterval( cleanContexts, 100 );

// Update memory usage every 1000ms
setInterval( () => {
    contextSize.setDisplay( memorySizeOf( context ) );
}, 1000 );

// Update performance line every 1000ms
setInterval( () => {
    performanceLine.setData( [ lineStats ] );
}, 1000 );

setInterval( () => {
    // console.log( '<info> Running refresh routine...' );
    logLine( 'Running refresh routine...', systemLog );
    liveStreams = [];
    devAccounts = {};

    startup();
}, 600000 );
