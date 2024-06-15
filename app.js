let
    // Modules
    uws = require('uWebSockets.js'),

    fastJson = require("fast-json-stringify"),

    // Temporary
    // http = require("http"),
    // express = require("express"),
    // bodyParser = require('body-parser'),
    // compression = require("compression"),
    // cors = require("cors"),
    cookieParser = require('cookie-parser'),

    fs = require("fs"),
    url = require("url"),

    app,
    SSLApp,
    server,

    connections = {},

    bcrypt = require("bcrypt"),
    crypto = require('crypto'),
    uuid = (require("uuid")).v4,
    jwt = require('jsonwebtoken'),

    ipc,
    { exec, spawn } = require('child_process'),

    wscp = cookieParser(),
    multer = require('multer-md5'),
    formidable = require('formidable'),

    lsdb = require("./addons/lsdb_mysql.js"),

    // Config parser
    { parse, configTools } = require("./addons/akeno/parse-config.js")
;

let
    // Globals
    isDev = fs.existsSync("/www/__dev__"),
    initialized = false,
    db,
    AddonCache = {},
    Backend,
    config,
    configRaw,

    API,
    apiVersions,

    doHost,
    doBuild,

    host,

    port,
    PATH = __dirname + "/",

    total_hits,
    saved_hits,
    since_startup = Date.now()
;


    
async function save_hits(){
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32LE(total_hits, 0);
    fs.writeFileSync(PATH + "./etc/hits", buffer);
    saved_hits = total_hits
}

// Initialize is the first thing that runs after the config is loaded and basics (like the backend object) initialized.
function initialize(){
    saved_hits = total_hits = fs.existsSync(PATH + "/etc/hits") ? fs.readFileSync(PATH + "./etc/hits").readUInt32LE(0) : 0;
    
    // Hit counter
    
    process.on('uncaughtException', (err) => {
        // Why does this even happen in the first place
        console.debug("[system] [ERROR] It's probably fine, just some poorly written module can't throw a proper error instead of crashing the whole thread.\nThe error: ", err);
    });
    
    process.on('exit', () => {
        save_hits()
        console.log(`[system] API is stopping.`);
    })

    // Initialize the host communication module (optional)
    if(doHost){
        let
            HostSocketID = 'eg_persistentHost',
            HostSocket,
            HostConnected = false,
            HostQueue,
            HostReplyListeners = [],
            HostReplies = {}
        ;

        host = {
            dispatch(evt, data, force, prefix = 'app.'){
                if(force || (HostConnected && HostSocket)){
                    return HostSocket.emit(prefix + evt, data)
                }
                if(HostQueue){
                    HostQueue.push(evt, ...data)
                }
            },
            
            handleListener(evt){
                if(HostReplyListeners.includes(evt))return;
                HostReplyListeners.push(evt)
                HostSocket.on("app." + evt + ".reply",
                    function(data){
                        HostReplies[data.id] = data.reply;
                    }
                )
            },

            ask(evt, data){
                host.handleListener(evt)
                if(HostConnected && HostSocket){
                    let ID = uuid();
                    HostSocket.emit('app.' + evt, {id :ID, data: data})
                    return new Promise(resolve => {
                        let i, interval = setInterval(()=>{
                            if(HostReplies[ID]){
                                resolve(HostReplies[ID])
                            }
            
                            i++
            
                            if(i > 300){
                                clearInterval(interval)
                                resolve(null)
                            }
                        }, 10)
                    })
                }
                return null
            }
        }

        ipc = require('@node-ipc/node-ipc').default;
    
        ipc.config.id = 'eg_API';
        ipc.config.retry = 1000;
        ipc.config.logLevel = 'WARN';
    
        let prefix = "[akeno] [persistentHost]";
        
        console.log(prefix + ' CONNECTING TO HOST...');
    
        ipc.connectTo(
            HostSocketID,
            function(){
                HostSocket = ipc.of[HostSocketID];
    
                HostSocket.handle = function(evt, fn){
                    HostSocket.on(evt, async(data, _socket) => {
                        if(!data.id){
                            return fn(data.data, _socket)
                        }
                        host.dispatch(evt + ".reply", {id: data.id, reply: await fn(data.data, _socket)}, false, "")
                    });
                }
    
                HostSocket.on(
                    'connect',
                    function(){
                        console.log(prefix + ' INFORMING HOST OF OUR EXISTENCE...');
                        host.dispatch("hi", "hello", true)
                    }
                );
    
                HostSocket.on(
                    'disconnect',
                    function(){
                        HostConnected = false
                        console.log(prefix + ' DISCONNECTED FROM HOST');
                    }
                );
    
                HostSocket.on(
                    'app.hi',
                    function(){
                        HostConnected = true
                        console.log(prefix + ' CONNECTED TO HOST');
                        if(doBuild) build()
                    }
                );
            }
        );
    } else if (doBuild) build();
}

//Add API handlers or addons here.

API = {
    _default: 2,

    //Add or remove API versions here.
    1: require("./version/v1.js"),
    2: require("./version/v2.js")
}

apiVersions = Object.keys(API).filter(version => !isNaN(+version));

API._latest = Math.max(...apiVersions.map(number => +number));

// The init fucntion that initializes and starts the server.
function build(){
    if(initialized) return;
    initialized = true;

    Backend.log("Initializing the API...")

    // Initialize API
    for(let version of apiVersions){
        version = API[version]
        if(version.Initialize) version.Initialize(Backend)
    }

    db = lsdb.Server(isDev? '109.71.252.170' : "localhost", 'api_full', 'xsD6SicFy2MMc.-')

    // Set up multer for file uploads
    // const storage = multer.diskStorage({
    //     destination: '/www/ram/',
    //     filename: (req, file, callback) => {
    //         callback(null, Backend.uuid());
    //     }
    // });

    // const upload = multer({ storage })
    
    let wss = {

        /* There are many common helper features */
        idleTimeout: 32,
        maxBackpressure: 1024,
        maxPayloadLength: 512,
        compression: uws.DEDICATED_COMPRESSOR_32KB,

        sendPingsAutomatically: true,

        upgrade(res, req, context) {

            // Upgrading a HTTP connection to a WebSocket

            res.upgrade({
                uuid: uuid(),
                url: req.getUrl(),
                host: req.getHeader("host"),
            }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
        },

        open(ws) {

        },
        
        message(ws, message, isBinary) {

        },
        
        
        close(ws, code, message) {

        }
    
    };

    let types = {
        json: "application/json; charset=utf-8",
        js: "application/javascript; charset=utf-8",
        css: "text/css; charset=utf-8",
        html: "text/html; charset=utf-8",
    }

    let version = Backend.config.valueOf("version") || "unknown";

    async function resolve(res, req, secured) {
        total_hits++
        if((total_hits - saved_hits) > 2) save_hits();

        // Helper variables
        req.method = req.getMethod().toUpperCase(); // Lowercase would be pretty but harder to adapt
        req.domain = req.getHeader("host").replace(/:([0-9]+)/, "");
        // req.port = +req.getHeader("host").match(/:([0-9]+)/)[1];

        req.bodyChunks = []

        if(req.method === "POST"){
            // To be honest; Body on GET requests SHOULD be allowed. There are many legitimate uses for it. But since current browser implementations usually block the body for GET requests, I am also skipping their body proccessing.

            req.hasFullBody = false

            res.onData((chunk, isLast) => {
                req.bodyChunks.push(Buffer.from(chunk));
                // console.log("data: ", chunk, isLast);
    
                if (isLast) {
                    Object.defineProperties(req, {
                        fullBody: {
                            get(){
                                if(req._fullBody) return req._fullBody;
                                // req.bodyChunks = []
                                return req._fullBody = Buffer.concat(req.bodyChunks)
                            }
                        }
                    })

                    req.hasFullBody = true;

                    if(req.onFullData) req.onFullData();
                }
            })

            // Helper function
            req.parseBody = function bodyParser(callback){
                return {
                    get type(){
                        return req.getHeader("content-type")
                    },
    
                    get length(){
                        return req.getHeader("content-length")
                    },
    
                    upload(key = "file"){
                        return (upload.array(key)) (req, res, ()=>{
                            req.body = {
                                type: "multipart",
                                fields: req.body,
                                files: req.files
                            }
                            return callback(req.body)
                        })
                    },
    
                    data(){
                        function done(){
                            req.body = {
                                get data(){
                                    return req.fullBody
                                },

                                get string(){
                                    return req.fullBody.toString('utf8');
                                },

                                get json(){
                                    let data;

                                    try{
                                        data = JSON.parse(req.fullBody.toString('utf8'));
                                    } catch {
                                        return null
                                    }

                                    return data
                                }
                            }
        
                            callback(req.body)
                        }


                        if(req.hasFullBody) done(); else req.onFullData = done;
                    },
    
                    json(){
                        // (express.json())(req, res, ()=>{
                        //     callback(req.body)
                        // })
                    },
    
                    form(){
                        // const form = formidable.formidable({});
                        // form.parse(req, (err, fields, files) => {
                        //     if (err) {
                        //         callback(null, err);
                        //         return;
                        //     }
    
                        //     req.body = {
                        //         type: "multipart",
                        //         fields,
                        //         files
                        //     }
    
                        //     callback(req.body);
                        // })
                    }
                }
            }
        }

        res.onAborted(() => {
            abort = true;
        })

        req.path = req.getUrl();
        req.secured = secured; // If the communication is done over HTTP or HTTPS

        res.writeHeaders = (headers) => {
            if(!headers) return;
            
            for(let header in headers){
                res.writeHeader(header, headers[header])
            }
        }

        res.writeHeaders({
            'X-Powered-By': 'Akeno Server/',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS,POST,PUT",
            "Access-Control-Allow-Headers": "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, Authorization",
            ...headers,
        })

        res.send = (message, headers = {}, status) => {
            // OUTDATED!
            // Should be avoided for performance reasons
        
            if(Array.isArray(message) || (typeof message !== "string" && !(message instanceof ArrayBuffer) && !(message instanceof Uint8Array) && !(message instanceof DataView) && !(message instanceof Buffer))) {
                headers["content-type"] = types["json"];

                message = JSON.stringify(message);
                Backend.log.verbose("Warning: You are not properly encoding your data before sending. The data were automatically stringified using JSON.stringify, but this has a bad impact on performance. If possible, either send a string, binary data or stringify using fast-json-stringify.")
            }

            res.cork(() => {
                res.writeHeaders({
                    'X-Powered-By': 'Akeno Server/',
                    ...headers,
                })

                if(status) res.writeStatus(status + "")

                res.end(message)
            });
        }

        res.stream = (stream) => {
            stream.on('data', (chunk) => {
                let buffer = Buffer.from(chunk), lastOffset = res.getWriteOffset();

                // Try writing the chunk
                const [ok, done] = res.tryEnd(buffer, buffer.length);

                if (!done && !ok) {
                    // Backpressure handling
                    stream.pause();

                    // Resume once the client is ready
                    res.onWritable((offset) => {
                        const [ok, done] = res.tryEnd(buffer.slice(offset - lastOffset), buffer.length);
                        if (done) {
                            stream.close();
                        } else if (ok) {
                            stream.resume();
                        }
                        return ok;
                    });
                } else if (done) {
                    // Stream is done, close it
                    stream.close();
                }
            });

            stream.on('end', () => {
                // Ensure the response ends when the stream ends
                if (res.getWriteOffset() === 0) {
                    res.end();
                }
            });

            stream.on('error', (err) => {
                // Handle errors
                console.error('Stream error:', err);
                res.writeStatus('500 Internal Server Error').end('Internal Server Error');
            });

            // If the connection is closed by the client, stop reading the file
            res.onAborted(() => {
                stream.destroy();
            });
        }

        res.type = (type) => {
            res.writeHeader("Content-Type", types[type] || type)
        }

        let index = -1, segments = req.path.split("/").filter(trash => trash).map(segment => decodeURIComponent(segment)),
            abort = false
        ;


        function error(error, code){
            if(typeof error == "number" && Backend.Errors[error]){
                let _code = code;
                code = error;
                error = (_code? code : "") + Backend.Errors[code]
            }

            res.cork(() => {
                res.writeStatus('400').writeHeader("Content-Type", "application/json; charset=utf-8").end(`{"success":false,"code":${+code},"error":"${error.replaceAll('"', '\\"')}"}`);
            })
        }

        function shift(){
            index++
            return segments[index] || "";
        }

        // Handle the builtin CDN
        if(req.domain.startsWith("cdn.") || req.domain.startsWith("cdn-origin.")){
            Backend.addon("cdn").HandleRequest({segments, shift, error, req, res})
        }
        
        // Handle the builtin API
        else if(req.domain.startsWith("api.")){
            let ver = segments[0] ? +(segments[0].slice(1)) : 0;

            if(ver && segments[0].toLowerCase().startsWith("v")){
                segments.shift()
            }
    
            ver = (ver? ver : API._default);
    
            if(API[ver]){
                await API[ver]["HandleRequest"]({
                    req,
                    res,
                    segments,
                    shift,
                    error
                })
            } else {
                error(0)
            }
            return;
        }


        else {
            // In this case, the request didnt match any special scenarios, thus should be passed to the webserver:
            Backend.addon("akeno/web").HandleRequest({segments, req, res})
        }
    }

    // Create server instances
    app = uws.App()
    if(Backend.config.block("server").properties.enableSSL) SSLApp = uws.SSLApp({})

    // Initialize WebSockets
    app.ws('/*', wss)
    
    // Initialize WebServer
    app.any('/*', (res, req) => resolve(res, req, true))
    
    app.listen(port, (listenSocket) => {
        if (listenSocket) {
            console.log(`[system] [ time:${Date.now()} ] > The Akeno server has started and is listening on port ${port}! Total hits so far: ${total_hits}, startup took ${Date.now() - since_startup}ms`)

            // Do the same for SSL
            if(SSLApp) {
                SSLApp.ws('/*', wss)

                SSLApp.any('/*', (res, req) => resolve(res, req, true))

                let SSLPort = (+ Backend.config.block("server").properties.sslPort) || 443;

                SSLApp.listen(SSLPort, (listenSocket) => {
                    if (listenSocket) {
                        console.log(`[system] Listening with SSL on ${SSLPort}!`)
                    } else Backend.log.error("[error] Could not start the SSL server! If you do not need SSL, you can ignore this, but it is recommended to remove it from the config. If you do need SSL, make sure nothing is taking the port you configured (" +SSLPort+ ")")
                });
            }
        } else Backend.log.error("[error] Could not start the server!")
    });
}


// First initialization, ints the backend object.
(private => {
    let testKey = process.env.AKENO_KEY;

    Backend = {
        isDev,
        logLevel: isDev? 5 : 3,

        config,
        configRaw,

        // configTools,

        refreshConfig(){
            Backend.log("Refreshing configuration")
            configRaw = Backend.configRaw = parse(fs.readFileSync(PATH + "/config", "utf8"), true);
            config = Backend.config = configTools(configRaw)
        },

        jwt: {
            verify(something, options){
                return jwt.verify(something, testKey, options)
            },
            sign(something, options){
                return jwt.sign(something, testKey, options)
            }
        },

        get db(){
            return db
        },

        uuid,
        bcrypt,
        fastJson,
        fs,
        exec,
        spawn,
        host,
        app,
        SSLApp,
        API,
        CreationCache: {},

        // resolve,

        user: {
            get(idList, callback, items = ["username", "displayname", "pfp", "email", "verified_email", "status", "id"]){
                if(!Array.isArray(idList)) idList = [idList];

                for(let i = 0; i < idList.length; i++){
                    if(typeof idList[i] === "object") idList[i] = idList[i].id;
                    if(typeof idList[i] === "string") idList[i] = +idList[i];
                }

                idList = idList.filter(id => typeof id === "number")
                if(idList.length < 1) return callback(2);

                items = items.map(item => item.replace(/[^a-zA-Z0-9_.\-]/g, '')).filter(nothing => nothing).join();
                if(items.length < 1) return callback(2);

                db.database("extragon").query(`SELECT ${items} FROM users WHERE id IN (${idList.join()}) LIMIT 80`,
                    function(err, results){
                        if(err){
                            return callback(err)
                        }

                        if(results.length < 1){
                            return callback(6)
                        }

                        for(let result of results){
                            if(result.verified_email) result.verified_email = !!result.verified_email.data
                        }

                        callback(null, results)
                    }
                )
            },

            login(username, password, callback, expiresIn = 5184000000, createToken = true){
                db.database("extragon").query(
                    'SELECT hash, id, username FROM `users` WHERE `username` = ? OR `email` = ?',
                    [username, username],
                    async function(err, results) {
                        if(err){
                            return callback(err)
                        }

                        if(results.length < 1){
                            return callback(6)
                        }

                        let user = results[0];

                        bcrypt.compare(password, user.hash.replace("$2y$", "$2b$"), function(err, result){
                            if(!err && result){

                                let token;
                                if(createToken) token = Backend.jwt.sign(
                                    {
                                        id: user.id
                                    },
                                    {
                                        expiresIn: expiresIn < 1000 ? 1 : expiresIn / 1000
                                    }
                                );

                                callback(null, {
                                    token,
                                    id: user.id,
                                    legacy: user.hash.includes("$2y$")
                                })
                            }else{
                                callback(err ? 12 : 11)
                            }
                        })
                    }
                )
            },

            async createAccount(user, callback, ip){
                let discord, generateToken = !!user.generateToken;

                delete user.generateToken;

                if(user.discord){
                    discord = await Backend.getDiscordUserInfo(user.discord)
                }

                db.database("extragon").query(`SELECT username, email, discord_id FROM users WHERE username = ? OR email = ? OR discord_id = ?`,
                    [user.username, user.email, discord? +discord.id : 0],

                    async function(err, results) {
                        if(err || results.length > 0){
                            if(discord && results[0].discord_id == +discord.id){
                                return callback("Some other account already has this same Discord account linked.")
                            } else {
                                return callback(err? 12 : (user.email == results[0].email? (user.username == results[0].username? "Both the email and username are": "This email is"): "This username is") +" already taken.")
                            }
                        }

                        let finalUser = {

                            // Profile
                            displayname: user.username,
                            ...user.profile || {},

                            // User
                            username: user.username,
                            hash: await bcrypt.hash(user.password, 12),
                            email: user.email,
                            ip

                        };

                        if(discord) {
                            finalUser.discord_link = user.discord
                            finalUser.discord_id = discord? + discord.id : 0
                            finalUser.discord_raw = JSON.stringify(discord)
                        }

                        db.database("extragon").table("users").insert(finalUser, (err, result) => {
                            if(err){
                                return callback(err)
                            }

                            if(generateToken){
                                Backend.user.login(user.username, user.password, (err, data)=>{
                                    if(err){
                                        return callback(null, {id: result.insertId, token: null, err})
                                    }

                                    callback(null, {id: result.insertId, ...data})
                                }, 5184000000, true)
                            } else {
                                callback(null, {id: result.insertId})
                            }

                        })
                    }
                )
            },

            getAuth(req){
                if(req.User) return req.User;
                // TODO: || req.cookies.token - parse cookies
                let token = typeof req == "string"? req : decodeURIComponent(req.getHeader("authorization") || "").replace('Bearer ','').replace('APIKey ','');
            
                if(!token) return {error: 13};
            
                try{
                    return Backend.jwt.verify(token, Backend.testKey)
                } catch {
                    return {error: 9}
                }
            }
        },

        pockets: {
            createWallet(pocket, holder, options, callback = (error, address) => {}){
                let address = Backend.pockets.generateAddress();

                db.database("extragon").table("pockets_wallets").insert({
                    comment: null,
                    ...options,

                    pocket,
                    identifier: address,
                    balance: 0,
                    created: Date.now(),
                    holder

                }, (err, result) => {
                    if(err || !result) return callback(err);
                    callback(null, address)
                })
            },

            generateAddress(length = 64) {
                const buffer = crypto.randomBytes(Math.ceil(length * 3 / 4)); // 3/4 factor because base64 encoding

                return buffer.toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, length);
            },

            transaction(pocket, source, target, value = 0, options = {}, callback = (error, data) => {}){


                // WARNING: This is a low-level transaction API and should never be exposed to the internet directly.
                // Transactions are taken as-is and only have standard security measures and validations to make sure the transaction is valid, but it does not check for things like if the transaction has been authorized by the user or the pocket.
                // ALWAYS validate the request heavily depending on your use before passing it here.
                // Failing to do so might have undesired consequences.

                /*
                    pocket = Pocket ID. Not the wallet ID.
                    source = Source wallet to transfer FROM
                    target = Target wallet to transfer TO
                    value = Value to transfer
                */

                // Step 1) verify the transaction author and that he has enough balance

                db.database("extragon").query(
                    'SELECT balance, holder FROM `pockets_wallets` WHERE `pocket` = ? AND `identifier` = ?',
                    [pocket, source],

                    function(err, result){
                        if(err) return callback(err);
                        if(result.length < 1) return callback("Source pocket not found");

                        // if(result[0].holder !== source){
                        //     callback("The transaction author does not own the pocket.")
                        // }

                        let initBalance = result[0].balance;

                        db.database("extragon").table("pockets_transactions").insert({
                            ...options,
        
                            pocket,
                            source,
                            target,

                            value,
                            initBalance,
                            date: Date.now(),
                            merchant: options.merchant || null,
                            pending: true,
                            failed: false

                        }, (err, result) => {
                            if(err) return callback(err);
        
                            let transaction_id = result.insertId;

                            db.database("extragon").query(
                                'SELECT holder, balance FROM `pockets_wallets` WHERE `pocket` = ? AND `identifier` = ?',
                                [pocket, target],

                                function(err, result){
                                    if(err) return callback(err);
                                    if(result.length < 1) return callback("Target pocket not found");

                                    let targetInitBalance = result[0].balance;

                                    db.database("extragon").table("pockets_wallets").update("WHERE identifier='" + source.replaceAll("'", "") + "'", {
                                        balance: initBalance - value
                                    }, (err, result) => {
                                        if(err) return callback(err);

                                        db.database("extragon").table("pockets_wallets").update("WHERE identifier='" + target.replaceAll("'", "") + "'", {
                                            balance: targetInitBalance + value
                                        }, (err, result) => {
                                            if(err) return callback(err);

                                            db.database("extragon").table("pockets_transactions").update("WHERE id='" + transaction_id + "'", {
                                                pending: false
                                            }, (err, result) => {
                                                if(err) return callback(err);
        
                                                callback(null, transaction_id)
                                            })
                                        })
                                    })
                                }
                            )
                        })

                    }
                )
            }
        },

        apiExtensions: {},

        writeLog(data, severity = 2, source = "api"){
            // 0 = Debug (Verbose), 1 = Info (Verbose), 2 = Info, 3 = Warning, 4 = Error, 5 = Important

            if(severity < (5 - Backend.logLevel)) return;
            if(!Array.isArray(data)) data = [data];

            console[severity == 4? "error": severity == 3? "warn": severity < 2? "debug": "log"](`[${source}]`, ...data)
        },

        logger(target){
            let logger = function (...data){
                Backend.writeLog(data, 2, target)
            }

            logger.debug = function (...data){
                Backend.writeLog(data, 0, target)
            }

            logger.verbose = function (...data){
                Backend.writeLog(data, 1, target)
            }

            logger.info = function (...data){
                Backend.writeLog(data, 2, target)
            }

            logger.warn = function (...data){
                Backend.writeLog(data, 3, target)
            }

            logger.error = function (...data){
                Backend.writeLog(data, 4, target)
            }

            logger.impotant = function (...data){
                Backend.writeLog(data, 5, target)
            }

            return logger
        },

        addon(name, path){
            // if(!fs.existsSync("./addons/"+name+".js"))return false;
            if(!AddonCache[name]){
                Backend.log("Loading addon; " + name);

                AddonCache[name] = require(path || "./addons/" + name);

                AddonCache[name].log = Backend.logger(name)

                if(AddonCache[name].Initialize) AddonCache[name].Initialize(Backend);
            }
            return AddonCache[name]
        },

        async getDiscordUserInfo(accessToken) {
            try {
                // Make a GET request to Discord API to fetch user information
                const response = await fetch('https://discord.com/api/users/@me', {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                    },
                });

                if (response.ok) {
                    const userInfo = await response.json();
                    return userInfo;
                } else {
                    console.error('Failed to fetch user information:', response.status, response.statusText);
                    return null;
                }
            } catch (error) {
                console.error('Error occurred while fetching user information:', error.message);
                return null;
            }
        },
        
        Economy: {
            CV: 100
        },

        Errors:{
            0: "Invalid API version",
            1: "Invalid API endpoint",
            2: "Missing or invalid parameters in request body/query string.",
            3: "Internal Server Error.",
            4: "Access denied.",
            5: "This user does not have access to this service.",
            6: "User not found. (Invalid username or email)",
            7: "Username already taken.",
            8: "Email address is already registered.",
            9: "Session/API token expired/is invalid. Please log-in again.",
            10: "Incorrect verification code.",
            11: "Invalid password.",
            12: "Authentication failed.",
            13: "Session/API token missing.",
            14: "This account is under suspension/termination/other kind of penalty. Log-in from the panel and contact support for more info.",
            15: "Forbidden action.",
            16: "This service does not exist.",
            17: "Request timed out.",
            18: "Too many requests. Try again in a few seconds.",
            19: "Service temporarily unavailable. Please check status (https://status.extragon.cloud).",
            20: "Service/Feature not enabled. It might first require setup from your panel, is not available (or is paid and you don't have access).",
            21: "Unsupported media type.",
            22: "Deprecated endpoint. Consult documentation for a replacement.",
            23: "Not implemented.",
            24: "Conflict.",
            25: "This node/location is temporarily unavailable. Please check status (https://status.extragon.cloud).",
            26: "Deprecated endpoint. Consult documentation for a replacement.",
            27: "Deprecated endpoint for this API version. Please update your code to the latest API version. (GET /latest)",
            28: "Access blocked for suspicious/illegal activity. Please, explain yourself to the support team to get the chance to re-enable access.",
            29: "Missing a sub-endpoint. This endpoint does not have a default response.",
            30: "Invalid method. Only POST allowed.",
            31: "Invalid method. Only GET allowed.",
            32: "Invalid method. Only PATCH allowed.",
            33: "Invalid method. Only DELETE allowed.",
            34: "Invalid method. Only OPTIONS allowed.",
            35: "This endpoint may handle sensitive data and so you can only use it over HTTPS. Please do not use it from unsecured environments to prevent attacks.",
            36: "Rate-Limited (API level). Please try again in a few seconds (or when your usage recharges).",
            37: "Rate-Limited (API level). You have used all of your requests for a given time period. For more info, look into your panel.",
            38: "Rate-Limited (Account level). Please contact support for more information.",
            39: "Invalid method for this endpoint.",
            40: "This endpoint is a WebSocket endpoint. Use the ws:// or wss:// protocol instead of http.",
            41: "Wrong protocol.",
            42: "Internal error: Configured backend type doesn't have a driver for it. Please contact support.",
            43: "File not found.",
            44: "The request contains wrong data",
            45: "Wrong data type",
            46: "Invalid email address.",
            47: "Username must be within 2 to 200 characters in range and only contain bare letters, numbers, and _, -, .",
            48: "Weak password.",
        }
    }
})()

Backend.log = Backend.logger("api")
Backend.refreshConfig()

if(isDev){
    Backend.log("NOTE: API is running in developmenmt mode.")
}

port = (+Backend.config.block("server").properties.port) || 7007;
doHost = Backend.config.block("server").properties.enableHost == "prod"? !isDev: Backend.config.block("server").properties.enableHost;
doBuild = Backend.config.block("server").properties.enableBuild;

initialize()