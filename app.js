let
    // Modules

    http = require("http"),
    express = require("express"),
    fs = require("fs"),
    url = require("url"),

    // fastify = (require("fastify"))(),

    app,
    server,

    ws = require("ws"),
    wss = new ws.Server({ noServer: true }),

    connections = {},

    bcrypt = require("bcrypt"),
    uuid = (require("uuid")).v4,
    jwt = require('jsonwebtoken'),
    
    cookieParser = require('cookie-parser'),
    bodyParser = require('body-parser'),
    compression = require("compression"),
    // cors = require("cors"),

    ipc,
    { exec, spawn } = require('child_process'),

    wscp = cookieParser(),
    multer = require('multer-md5'),
    formidable = require('formidable'),

    // Config parser
    { parse, configTools } = require("./addons/akeno/parse-config")
;

process.on('uncaughtException', (err) => {
    // Why does this even happen in the first place, do people just not know how to use "throw new Error()"? Why crash everything?
	console.debug("blah blah blah, it's probably fine, just some poorly written module can't throw a proper error instead of crashing the whole thread.\nThe error was: ", err);
});

let isDev = fs.existsSync("/www/__dev__");


let
    // Main configuration
    port = 7007,
    doHost = !isDev,
    doBuild = true,

    // Host configuration
    HostSocketID = 'eg_persistentHost',
    HostSocket,
    HostConnected = false,
    HostQueue,
    HostReplyListeners = [],
    HostReplies = {},

    // Misc
    initialized = false,
    lsdb = require("./addons/lsdb_mysql.js"),
    db,

    PATH = "/www/content/extragon/api/" // Sadly, Node seems to always work with the wrong relative path instead of the one the file is actually in. May be fixed later but please use this now.
;

let
    // Misc options
    total_hits = fs.existsSync(PATH + "/etc/hits") ? fs.readFileSync(PATH + "./etc/hits").readUInt32LE(0) : 0,
    saved_hits = total_hits
;

function save_hits(){
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32LE(total_hits, 0);
    fs.writeFileSync(PATH + "./etc/hits", buffer);
    saved_hits = total_hits
}

process.on('exit', () => {
    save_hits()
    console.log(`[system] API is stopping.`);
})

if(doHost){
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
                    dispatch(evt + ".reply", {id: data.id, reply: await fn(data.data, _socket)}, false, "")
                });
            }

            HostSocket.on(
                'connect',
                function(){
                    console.log(prefix + ' INFORMING HOST OF OUR EXISTENCE...');
                    dispatch("hi", "hello", true)
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
}


function dispatch(evt, data, force, prefix = 'app.'){
    if(force || (HostConnected && HostSocket)){
        return HostSocket.emit(prefix + evt, data)
    }
    if(HostQueue){
        HostQueue.push(evt, ...data)
    }
}

function handleListener(evt){
    if(HostReplyListeners.includes(evt))return;
    HostReplyListeners.push(evt)
    HostSocket.on("app." + evt + ".reply",
        function(data){
            HostReplies[data.id] = data.reply;
        }
    )
}

async function ask(evt, data){
    handleListener(evt)
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

async function build(){
    if(initialized) return;

    Backend.log("Initializing the API...")

    initialized = true;

    db = lsdb.Server(isDev? '109.71.252.170' : "localhost", 'api_full', 'xsD6SicFy2MMc.-')

    // await fastify.register(require('@fastify/express'));
    app = express();

    app.set('trust proxy', true)
    // app = fastify;

    // Set up multer for file uploads
    const storage = multer.diskStorage({
        destination: '/www/ram/',
        filename: (req, file, callback) => {
            callback(null, Backend.uuid());
        }
    });

    const upload = multer({ storage });

    // POST need to be first since multer will break if any middleware is in front of it....
    app.use((req, res, next)=>{
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
        res.header("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, Authorization");

        if(req.method === "POST") req.parseBody = function(callback){
            return {
                get type(){
                    return req.headers["content-type"]
                },

                get length(){
                    return req.headers["content-length"]
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
                    // On regular post data
                    let chunks = [], length = 0, data;
            
                    req.on('data', (chunk) => {
                        chunks.push(chunk)
                        length += chunk.length
                    })
            
                    req.on('end', () => {
            
                        data = new Uint8Array(length);
            
                        let offset = 0
                        for(let chunk of chunks){
                            data.set(chunk, offset)
                            offset += chunk.length
                        }

                        req.body = {
                            type: "data",
                            data,
                            get string(){
                                return Buffer.from(data).toString('utf8');
                            },
                            get json(){
                                try{
                                    let temporary = JSON.parse(Buffer.from(data).toString('utf8'));
                                    if(temporary) data = temporary
                                }catch{
                                    return null
                                }
                                
                                return data
                            }
                        }
    
                        callback(req.body)
                    })
                },

                json(){
                    (express.json())(req, res, ()=>{
                        callback(req.body)
                    })
                },

                form(){
                    const form = formidable.formidable({});
                    form.parse(req, (err, fields, files) => {
                        if (err) {
                            callback(null, err);
                            return;
                        }

                        req.body = {
                            type: "multipart",
                            fields,
                            files
                        }

                        callback(req.body);
                    })
                }
            }
            // if(req.method !== "POST" || req.body) return callback();
    
            // // On Multipart (file upload) data
            // if(req.headers["content-type"] && req.headers["content-type"].startsWith("multipart/form-data")){
            // }
        }
        next()
    })

    // app.post("*", , (r,q) => resolve("POST", r, q))


    for(let v of apiVersions){
        v = API[v]
        if(v.Initialize) v.Initialize(Backend)
    }

    // app.use(cors())
    app.use(wscp)
    // app.use(compression())

    app.get("*", (r,q) => resolve("GET", r, q))
    app.delete("*", (r,q) => resolve("DELETE", r, q))
    app.patch("*", (r,q) => resolve("PATCH", r, q))
    app.post("*", (r,q) => resolve("POST", r, q))
    // app.options("*", (r,q) => resolve("OPTIONS", r, q))

    server = http.createServer(app);

    server.on('upgrade', (req, socket, head) => {
        let _ = req.url.replace(/unsecure\/|secure\//, "")

        wss.handleUpgrade(req, socket, head, (ws) => {
            wscp(req, {}, ()=>{
                /*
                    0 = Connect
                    1 = Message
                    2 = Disconnect
                    3 = Error
                */

                req.method = "WEBSOCKET";
                req.event = 0;
                ws.uuid = uuid();

                resolve("WEBSOCKET", req, ws)

                ws.on('message', (message) => {
                    req.event = 1;
                    resolve("WEBSOCKET", req, ws, message)
                })

                ws.on('close',()=>{
                    req.event = 2;
                    resolve("WEBSOCKET", req, ws)
                })
            });
        })
    })

    server.listen({port}, ()=>{
        console.log(`[system] [ ${Date.now()} ] > ExtraGon API has started and is listening on port ${port}! Total hits so far: ${total_hits}`)
    });
}

//Add API handlers or addons here.
var API = {
    _default: 2,

    //Add or remove API versions here.
    1: require("./version/v1"),
    2: require("./version/v2")
}

let apiVersions = Object.keys(API).filter(e=>!isNaN(+e));

API._latest = Math.max(...apiVersions.map(e=>+e));

var AddonCache = {}, Backend, config;

(private => {
    let testKey = process.env.AKENO_KEY;

    Backend = {
        isDev,
        logLevel: isDev? 5 : 3,

        config,

        configTools,

        refreshConfig(){
            Backend.log("Refreshing configuration")
            config = Backend.config = parse(fs.readFileSync(PATH + "../config", "utf8"), true);
            Backend.configTools = configTools(config)
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
        wss,
        fs,
        exec,
        spawn,
        dispatch,
        ask,
        HostSocket,
        app,
        API,
        cookieParser,
        CreationCache: {},

        resolve,

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
                // let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MCwibmFtZSI6ImFkbWluIiwiYXBpIjpmYWxzZSwiaWF0IjoxNzA0MTQxOTcwLCJleHAiOjE3MDkzMjU5NzB9.HMtqSFq_RtoUmpYewOaMGBkkRCYW19X5kPjRvafIqfc";
                // let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDIsIm5hbWUiOiJ3ZXJiIiwiYXBpIjpmYWxzZSwiaWF0IjoxNzA0MTY5OTA1LCJleHAiOjE3MDkzNTM5MDV9.EaUIXTyY-I2w8QXIerXZVpqiqYsdjX_3XB7ud5XyETM";
                let token = typeof req == "string"? req : decodeURIComponent(req.headers.authorization || req.cookies.token || "").replace('Bearer ','').replace('APIKey ','');
            
                if(!token) return {error: 13};
            
                try{
                    return Backend.jwt.verify(token, Backend.testKey)
                } catch {
                    return {error: 9}
                }
            }
        },

/*
id	int(11) Auto Increment	
source	int(11) NULL	
author	int(6) unsigned NULL	
target	int(6) unsigned NULL	
value	double	
comment	mediumtext []	
date	bigint(20)	
merchant	int(11) NULL	
message	text []	
extra	tinytext []


*/

        pockets: {
            transaction(pocket, source, target, value = 0, options = {}, callback = (error, data) => {}){

                /*
                    pocket = Pocket ID. Not the wallet ID.
                    source = Source wallet
                    target = Target wallet
                    value = Value
                */

                // Step 1) verify the transaction author and that he has enough balance

                return;

                db.database("extragon").query(
                    'SELECT balance, holder FROM `pockets_wallets` WHERE `pocket` = ? AND `identifier` = ?',
                    [pocket, source],

                    function(err, result){
                        if(err) callback(err);

                        if(result[0].holder !== source){
                            callback("The transaction author does not own the pocket.")
                        }

                        db.database("extragon").table("pockets_transactions").insert({
                            ...options,
        
                            source: pocket, author: source, target, value,
                            date: Date.now(),
                            merchant: options.merchant || null,
                            pending: true
                        }, (err, result) => {
                            if(err) callback(err);
        
                            let transaction_id = result.insertId;
                            
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

async function resolve(method, req, res, message, options = {}){
    // This is the main request handling function.
    // Nearly every request, including all websocket events, go through here.

    total_hits++
    if((total_hits - saved_hits) > 2) save_hits();

    let domain = options.domain || (method == "WEBSOCKET" ? "" : req.get('Host') || req.get('host')).replace(/:.*/, ""),
        segments = (options.path || req.path || req.url).split("/").filter(trash => trash),
        reply = {},
        sent,
        type = "api"
    ;

    if(domain == "020070.xyz" || domain == "0.020070.xyz" || domain == "1.020070.xyz"){
        res.redirect(301, `https://ssbrno-my.sharepoint.com/:w:/g/personal/lukas_zloch_gellnerka_cz/EV95SVM5OlREkLBXUTQN4MkBOO9cHnBfz7vKaSQ78wrbnQ?e=yX3KPn`);
        return
    }

    if(options.path) req.path = options.path;

    if(method == "WEBSOCKET"){
        const obj = {};

        for (const [key, value] of (new URLSearchParams(req.url.replace(/^.*\?/, ''))).entries()) {
            obj[key] = value;
        }

        req.query = obj;
    }

    if(method !== "WEBSOCKET" && !options.virtual && segments.length < 1){
        return res.json({
            error: "The proxy didnt specify the trust scope along with this request.",
            code: -1,
            success: false
        })
    }

    // Should be added by the proxy. Do not expect from when accessing the server directly.

    let scope;
    
    if(!req.proxyScope){
        if(options.virtual){
            scope = "secure";
        } else {
            scope = segments.shift();
        }
    } else scope = req.proxyScope;

    req.secured = scope == "secure";
    req.proxyScope = scope;
    req.url = req.path = ("/" + segments.join("/"));

    /*
        Good to note;
        This server became a center hub for everyhing - web apps, cdn, and the API itself.
        It handles requests for all of them.
        CDN and API are handled in different way to the webserver, as shown below.
    */

    // Utils.

    if(method !== "WEBSOCKET"){
        res.header("Access-Control-Allow-Origin", "*")
    }

    function error(err, code){
        if(typeof err == "number" && Backend.Errors[err]){
            let _code = code;
            code = err;
            err = (_code?code:"") + Backend.Errors[code]
        }

        if(method == "WEBSOCKET"){ res.send("ERROR: " + err); return res.close() }

        reply.success = false;

        if(code || typeof code=="number") reply.code = code;

        reply.error = err;

        if(type !== "api") res.json(reply);
    }
    
    function success(){
        reply.success = true;
    }

    function shift(){
        let result = segments.shift();
        return result || ""
    }

    function send(message){
        sent = true
        if(method == "WEBSOCKET") return res.send(message);
        res[typeof message=="string"? "send" : "json"](typeof message=="undefined"?reply:message)
    }

    if(method !== "WEBSOCKET" && domain && (domain.startsWith("cdn.") || domain.startsWith("cdn-origin.") || ["file", "ls", "flags"].includes(segments[0]))){

        // The following is for handling CDN requests.

        type = "cdn";

        Backend.addon("cdn").HandleRequest({method, segments, shift, error, req, res})

        return;
    }

    
    if(method !== "WEBSOCKET" && domain && !domain.startsWith("api.")){
        if(scope === "internal"){
    
            // The following is for handling internal queries
    
            type = "web";
            Backend.addon("akeno/web").HandleInternal(segments, req, res)
    
            return;
        }

        // The following is for handling the webserver and its apps.

        type = "web";
        Backend.addon("akeno/web").HandleRequest({domain, segments, method, req, res})

        return;
    }

    if(method === "WEBSOCKET" && (req.query && req.query["is-ls-proxy-pass"])){
        if(!AddonCache["proxyd"]){
            res.close()
            return
        }
        Backend.addon("proxyd").HandleSocket({req, ws: res, message})
        return
    }

    // The following is for handling API requests.

    let ver = segments[0] ? +(segments[0].slice(1)) : 0;

    if(ver && segments[0].toLowerCase().startsWith("v")){
        segments.shift()
    }

    if(!req.method) req.method = method;

    ver = (ver? ver : API._default);

    if(API[ver]){
        await API[ver]["HandleRequest"]({Backend, req, res, segments, reply, error, shift, success, send, message})
    } else {
        error(0)
    }

    if(!sent && !res.wait && method !== "WEBSOCKET") res.json(reply)
}


if(!doHost && doBuild) build()
