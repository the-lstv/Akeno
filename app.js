let
    version = "1.4.1",

    // Modules
    uws = require('uWebSockets.js'),

    fastJson = require("fast-json-stringify"),

    // Used for proxy
    http = require("http"),

    // cookieParser = require('cookie-parser'),

    fs = require("fs"),

    app,
    SSLApp,

    bcrypt = require("bcrypt"),
    crypto = require('crypto'),
    uuid = (require("uuid")).v4,
    jwt = require('jsonwebtoken'),

    ipc,
    { exec, spawn } = require('child_process'),

    // wscp = cookieParser(),
    // multer = require('multer-md5'),
    // formidable = require('formidable'),

    lsdb = require("./addons/lsdb_mysql.js"),

    // Config parser
    { parse, stringify, merge, configTools } = require("./core/parser.js")
;

try {
    // Disable uWebSockets version header, remove to re-enable
    uws._cfg('999999990007');
} catch (error) {}

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
    // saved_hits,
    since_startup = Date.now(),

    devInspecting = isDev && !!process.execArgv.find(v => v.startsWith("--inspect"));
;

    
async function save_hits(){
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32LE(total_hits, 0);
    fs.writeFileSync(PATH + "./etc/hits", buffer);
    // saved_hits = total_hits
}

// Initialize is the first thing that runs after the config is loaded and basics (like the backend object) initialized.
function initialize(){
    // saved_hits = total_hits = fs.existsSync(PATH + "/etc/hits") ? fs.readFileSync(PATH + "./etc/hits").readUInt32LE(0) : 0;
    
    // Hit counter
    
    process.on('uncaughtException', (err) => {
        // Why does this even happen in the first place
        console.debug("[system] [ERROR] It's probably fine, most likely some poorly written module can't throw a proper error instead of crashing the whole thread.\nNot this might also be an actual fatal error and you shouldn't continue (reload might be required).\nThe error: ", err);
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
    1: require("./api/v1.js"),
    2: require("./api/v2.js")
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

    db = lsdb.Server(isDev? '109.71.252.170' : "localhost", 'api_full', Backend.config.block("database").properties.password[0])

    // Set up multer for file uploads
    // const storage = multer.diskStorage({
    //     destination: '/www/ram/',
    //     filename: (req, file, callback) => {
    //         callback(null, Backend.uuid());
    //     }
    // });

    // const upload = multer({ storage })
    
    let wss = {

        // idleTimeout: 32,
        // maxBackpressure: 1024,
        maxPayloadLength: 2**16,
        compression: uws.DEDICATED_COMPRESSOR_32KB,

        sendPingsAutomatically: true,

        upgrade(res, req, context) {

            // Upgrading a HTTP connection to a WebSocket

            res.onAborted(() => {
                continueUpgrade = false
            })

            let segments = req.getUrl().split("/").filter(garbage => garbage), continueUpgrade = true;
            
            if(segments[0].toLowerCase().startsWith("v") && !isNaN(+segments[0].replace("v", ""))) segments.shift();

            let handler = API[API._latest].GetHandler(segments[0]);

            if(!handler || !handler.HandleSocket) return res.end();

            if(continueUpgrade) res.upgrade({
                uuid: uuid(),
                url: req.getUrl(),
                host: req.getHeader("host"),
                ip: res.getRemoteAddress(),
                ipAsText: res.getRemoteAddressAsText(),
                handler: handler.HandleSocket,
                segments
            }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
        },

        open(ws) {
            if(ws.handler.open) ws.handler.open(ws);
        },
        
        message(ws, message, isBinary) {
            if(ws.handler.message) ws.handler.message(ws, message, isBinary);
        },
        
        
        close(ws, code, message) {
            if(ws.handler.close) ws.handler.close(ws, code, message);
        }
    };

    let types = {
        json: "application/json; charset=utf-8",
        js: "text/javascript; charset=utf-8",
        css: "text/css; charset=utf-8",
        html: "text/html; charset=utf-8",
    }

    let version = Backend.config.valueOf("version") || "unknown";

    function resolve(res, req, secured) {
        total_hits++
        // if((total_hits - saved_hits) > 500) save_hits();

        // Helper variables
        req.method = req.getMethod().toUpperCase(); // Lowercase would be pretty but harder to adapt
        req.domain = req.getHeader("host").replace(/:([0-9]+)/, "");
        // req.port = +req.getHeader("host").match(/:([0-9]+)/)[1];

        res.writeHeaders = (headers) => {
            if(!headers) return res;

            res.cork(() => {
                for(let header in headers){
                    if(!headers[header]) return;
                    res.writeHeader(header, headers[header])
                }
            });

            return res
        }

        res.onAborted(() => {
            clearTimeout(res.timeout)
            req.abort = true;
        })

        req.path = req.getUrl();
        req.secured = secured; // If the communication is done over HTTP or HTTPS

        if(req.domain == "upedie.online"){
            return proxyReq(req, res, {port: 42069})
        }

        if(req.domain == "127.0.0.1") return res.end("pong");

        res.corsHeaders = () => {
            res.writeHeaders({
                'X-Powered-By': 'Akeno Server/' + version,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,DELETE",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Allow-Headers": "Authorization, *",
                "Origin": req.domain
            })
            return res
        }

        // Handle preflights:
        if(req.method == "OPTIONS"){
            // Prevent preflights for 16 days... which chrome totally ignores anyway
            res.corsHeaders().writeHeader("Cache-Control", "max-age=1382400").writeHeader("Access-Control-Max-Age", "1382400").writeHeader("CORS-is", "a piece of crap").end()
            return
        }

        if(req.method === "POST" || (req.transferProtocol === "qblaze" && req.hasBody)){
            req.fullBody = Buffer.from('');

            // To be honest; Body on GET requests SHOULD be allowed. There are many legitimate uses for it. But since current browser implementations usually block the body for GET requests, I am also skipping their body proccessing.

            req.hasFullBody = false
            req.contentType = req.getHeader('content-type');

            res.onData((chunk, isLast) => {
                req.fullBody = Buffer.concat([req.fullBody, Buffer.from(chunk)]);

                // req.bodyChunks.push(Buffer.from(chunk.slice(0)));
                // console.log("data: ", chunk, isLast);
    
                if (isLast) {
                    // Object.defineProperties(req, {
                    //     fullBody: {
                    //         get(){
                    //             if(req._fullBody) return req._fullBody;
                    //             // req.bodyChunks = []
                    //             return req._fullBody = Buffer.concat(req.bodyChunks)
                    //         }
                    //     }
                    // })
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
    
                    upload(key = "file", hash){

                        function done(){
                            let parts = uws.getParts(req.fullBody, req.contentType);
                            
                            for(let part of parts){
                                part.data = Buffer.from(part.data)
                                if(hash) part.md5 = crypto.createHash('md5').update(part.data).digest('hex')
                            }

                            callback(parts)
                        }

                        // return (upload.array(key)) (req, res, ()=>{
                        //     req.body = {
                        //         type: "multipart",
                        //         fields: req.body,
                        //         files: req.files
                        //     }
                        //     return callback(req.body)
                        // })
                        if(req.hasFullBody) done(); else req.onFullData = done;
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

        // let end_response = res.end;

        // res.end = body => {
        //     if(req.abort || res.sent) return;
        //     res.sent = true
        //     clearTimeout(res.timeout)

        //     end_response(body)
        // }

        res.send = (message, headers = {}, status) => {
            if(req.abort) return;
            // OUTDATED!
            // Should be avoided for performance reasons
        
            if(Array.isArray(message) || (typeof message !== "string" && !(message instanceof ArrayBuffer) && !(message instanceof Uint8Array) && !(message instanceof DataView) && !(message instanceof Buffer))) {
                headers["content-type"] = types["json"];

                message = JSON.stringify(message);
                Backend.log.warn("[performance] Warning: You are not properly encoding your data before sending. The data were automatically stringified using JSON.stringify, but this has a bad impact on performance. If possible, either send a string, binary data or stringify using fast-json-stringify.")
            }

            if(res.setType){
                headers["content-type"] = res.setType;
            }

            if(res.setCache){
                headers["Cache-Control"] = "public, max-age=" + res.setCache;
            }

            if(req.begin && headers) {
                let hrTime = process.hrtime()
                headers["server-timing"] = `generation;dur=${hrTime[0] * 1000 + hrTime[1] / 1000000 - req.begin}`
            };

            res.cork(() => {
                res.writeStatus(status? status + "": "200 OK").corsHeaders().writeHeaders(headers).end(message)
            });
        }

        res.stream = (stream, totalSize) => {
            stream.on('data', (chunk) => {
                let buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength), lastOffset = res.getWriteOffset();

                // Try writing the chunk
                const [ok, done] = res.tryEnd(buffer, totalSize);

                if (!done && !ok) {
                    // Backpressure handling
                    stream.pause();

                    // Resume once the client is ready
                    res.onWritable((offset) => {
                        const [ok, done] = res.tryEnd(buffer.slice(offset - lastOffset), totalSize);

                        if (done) {
                            stream.close();
                        } else if (ok) {
                            stream.resume();
                        }

                        return ok;
                    });
                } else if (done) stream.close();
            });

            stream.on('error', (err) => {
                res.writeStatus('500 Internal Server Error').end();
            });

            stream.on('end', () => {
                res.end();
            });

            res.onAborted(() => {
                stream.destroy();
            });
        }

        res.type = (type) => {
            res.setType = types[type] || type
            return res
        }

        res.cache = (duration) => {
            res.setCache = duration
            return res
        }

        let index = -1, segments = req.path.split("/").filter(trash => trash).map(segment => decodeURIComponent(segment));

        let hrTime = process.hrtime()
        req.begin = hrTime[0] * 1000 + hrTime[1] / 1000000;

        function error(error, code){
            if(req.abort) return;

            if(typeof error == "number" && Backend.Errors[error]){
                let _code = code;
                code = error;
                error = (_code? code : "") + Backend.Errors[code]
            }

            res.cork(() => {
                res.writeStatus('400').corsHeaders().writeHeader("content-type", "application/json").end(`{"success":false,"code":${code || -1},"error":"${(JSON.stringify(error) || "Unknown error").replaceAll('"', '\\"')}"}`);
            })
        }

        function shift(){
            index++
            return segments[index] || "";
        }

        if(segments[0] === "___internal"){
            // console.log(res.getRemoteAddressAsText()); // this does not get the text for some reason
            Backend.addon("core/web").HandleInternal({segments, req, res})
        }

        // Handle the builtin CDN
        else if(req.domain.startsWith("cdn.") || req.domain.startsWith("cdn-origin.")){
            Backend.addon("cdn").HandleRequest({segments, shift, error, req, res})
        }
        
        // Handle the builtin API
        else if(req.domain.startsWith("api.extragon")){
            let ver = segments[0] ? +(segments[0].slice(1)) : 0;

            if(ver && segments[0].toLowerCase().startsWith("v")){
                segments.shift()
            }
    
            ver = (ver? ver : API._default);
    
            if(API[ver]){
                API[ver].HandleRequest({segments, shift, error, req, res})
            } else {
                return error(0)
            }
        }

        else {
            // In this case, the request didnt match any special scenarios, thus should be passed to the webserver:
            Backend.addon("core/web").HandleRequest({segments, req, res})
        }

        res.timeout = setTimeout(() => {
            try {
                if(req.abort) return;

                if(res && !res.sent && !res.wait) res.writeStatus("408 Request Timeout").tryEnd();
            } catch {}
        }, res.timeout || 15000)
    }

    Backend.exposeToDebugger("router", resolve)

    function proxyReq(req, res, options){
        options = {
            path: req.path,
            method: req.method,
            hostname: "localhost",
            headers: {},
            ...options
        }

        req.forEach((key, value) => {
            options.headers[key] = value;
        });
      
        const proxyReq = http.request(options, (proxyRes) => {
            let chunks = []

            proxyRes.on('data', (chunk) => {
                chunks.push(Buffer.from(chunk));
            });
            
            proxyRes.on('end', () => {
                res.cork(() => {
                    res.writeStatus(`${proxyRes.statusCode} ${proxyRes.statusMessage}`);
                    proxyRes.headers.server = "Akeno Server Proxy/" + version;

                    for(let header in proxyRes.headers){
                        if(header === "date" || header === "content-length") continue;
    
                        res.writeHeader(header, proxyRes.headers[header]);
                    }

                    res.end(Buffer.concat(chunks));
                })
            });
        });
      
        proxyReq.on('error', (e) => {
            res.cork(() => {
                res.writeStatus('500 Internal Server Error').end(`Proxy error: ${e.message}\nPowered by Akeno/${version}`);
            })
        });
      
        res.onData((chunk, isLast) => {
            // proxyReq.write(chunk);
            if (isLast) {
                proxyReq.end();
            }
        });
    }

    Backend.exposeToDebugger("proxyRouter", proxyReq)

    // Create server instances
    app = uws.App()

    Backend.exposeToDebugger("uws", app)

    // Initialize WebSockets
    app.ws('/*', wss)
    
    // Initialize WebServer
    app.any('/*', (res, req) => resolve(res, req, true))
    
    app.listen(port, (listenSocket) => {
        if (listenSocket) {
            console.log(`[system] [ time:${Date.now()} ] > The Akeno server has started and is listening on port ${port}! Total hits so far: ${typeof total_hits === "number"? total_hits: "(not counting)"}, startup took ${Date.now() - since_startup}ms`)

            // Configure SSL
            if(Backend.config.block("server").properties.enableSSL) {
                SSLApp = uws.SSLApp();
                Backend.exposeToDebugger("uws_ssl", SSLApp)

                let SSLPort = (+ Backend.config.block("server").properties.sslPort) || 443;

                SSLApp.ws('/*', wss)

                SSLApp.any('/*', (res, req) => resolve(res, req, true))

                // If sslRouter is defined
                if(Backend.config.block("sslRouter")){
                    let SNIDomains = Backend.config.block("sslRouter").properties.domains;
    
                    if(SNIDomains){

                        // This entire proccess is a bit annoying and messy due to the weird API for SNI domains in uWebSockets.
                        // If it will be necessary, a fork of uWS could be made to make the API cleaner, faster and more fitting to our use-case.

                        if(!Backend.config.block("sslRouter").properties.certBase){
                            return Backend.log.error("Could not start SSL server - you are missing certBase in your sslRouter block.")
                        }
                        if(!Backend.config.block("sslRouter").properties.certBase){
                            return Backend.log.error("Could not start SSL server - you are missing keyBase in your sslRouter block.")
                        }

                        function addSNIRoute(domain) {
                            SSLApp.addServerName(domain, {
                                key_file_name:  Backend.config.block("sslRouter").properties.keyBase[0].replace("{domain}", domain.replace("*.", "")),
                                cert_file_name: Backend.config.block("sslRouter").properties.certBase[0].replace("{domain}", domain.replace("*.", ""))
                            })
    
                            // For some reason we still have to include a separate router like so:
                            SSLApp.domain(domain).any("/*", (res, req) => resolve(res, req, true)).ws("/*", wss)
                            // If we do not do this, the domain will respond with ERR_CONNECTION_CLOSED.
                            // A bit wasteful right? For every domain..
                        }

                        for(let domain of SNIDomains) {
                            addSNIRoute(domain)
                            if(Backend.config.block("sslRouter").properties.subdomainWildcard){
                                addSNIRoute("*." + domain)
                            }
                        }

                        // if(Backend.config.block("sslRouter").properties.autoAddDomains){
                        //     SSLApp.missingServerName((hostname) => {
                        //         Backend.log.warn("You are missing a SSL server name <" + hostname + ">! Trying to use a certificate on the fly.");

                        //         addSNIRoute(hostname)
                        //     })
                        // }
                    }
                }

                SSLApp.listen(SSLPort, (listenSocket) => {
                    if (listenSocket) {
                        console.log(`[system] Listening with SSL on ${SSLPort}!`)
                    } else Backend.log.error("[error] Could not start the SSL server! If you do not need SSL, you can ignore this, but it is recommended to remove it from the config. If you do need SSL, make sure nothing is taking the port you configured (" +SSLPort+ ")")
                });
            }
        } else Backend.log.error("[error] Could not start the server!")
    });

    Backend.resolve = resolve;

    if(Backend.config.block("server").properties.preloadWeb) Backend.addon("core/web");
}


// First initialization, ints the backend object.
(private => {
    let testKey = process.env.AKENO_KEY;

    Backend = {
        isDev,
        logLevel: isDev? 5 : 3,

        config,
        configRaw,

        get path(){
            return PATH
        },

        get PATH(){
            return PATH
        },

        // configTools,

        refreshConfig(){
            Backend.log("Refreshing configuration")

            if(!fs.existsSync(PATH + "/config")){
                Backend.log("No main config file found in /config, creating a default config file.")
                fs.writeFileSync(PATH + "/config", fs.readFileSync(PATH + "/etc/default-config", "utf8"))
            }

            let alreadyResolved = {}; // Prevent infinite loops

            function resolveImports(parsed, stack, referer){
                let imports = [];

                
                configTools(parsed).forEach("import", (block, remove) => {
                    remove() // remove the block from the config

                    if(block.values[0][0]){
                        let path = block.values[0].join("").replace("./", PATH + "/");
                        
                        if(path === stack) return Backend.log.warn("Warning: You have a self-import of \"" + path + "\", stopped import to prevent an infinite loop.");

                        if(!fs.existsSync(path)){
                            Backend.log.warn("Failed import of \"" + path + "\", file not found")
                            return;
                        }

                        imports.push(path)
                    }
                })

                alreadyResolved[stack] = imports;

                for(let path of imports){
                    if(stack === referer || (alreadyResolved[path] && alreadyResolved[path].includes(stack))){
                        Backend.log.warn("Warning: You have a recursive import of \"" + path + "\" in \"" + stack + "\", stopped import to prevent an infinite loop.");
                        continue
                    }

                    parsed = merge(parsed, resolveImports(parse(fs.readFileSync(path, "utf8"), true), path, stack))
                }



                return parsed
            }

            
            let path = PATH + "/config";

            configRaw = Backend.configRaw = resolveImports(parse(fs.readFileSync(path, "utf8"), true), path, null);
            config = Backend.config = configTools(configRaw);

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

        broadcast(topic, data, isBinary, compress){
            if(Backend.config.block("server").properties.enableSSL) return SSLApp.publish(topic, data, isBinary, compress); else return app.publish(topic, data, isBinary, compress);
        },

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

                db.database("extragon").query(`SELECT ${items} FROM users WHERE id IN (${idList.join()}) LIMIT 300`,
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
                            ip: ip || ""

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

        memoryCache: {},

        getCachingID(req){
            return req.getHeader("host") + req.getUrl() + req.getQuery()
        },

        setCache(id, data, expire = 5){
            return (Backend.memoryCache[id] = {data, expire: Date.now() + (expire * 1000)}).data
        },

        getCache(req){
            let id = req.getHeader("host") + req.getUrl() + req.getQuery(), cache = Backend.memoryCache[id];
            return {data: cache && cache.expire > Date.now()? cache.data: (delete Backend.memoryCache[id], false), id}
        },

        pockets: {
            createWallet(pocket, holder, options, callback = (error, address) => {}){
                let address = Backend.pockets.generateAddress(32);

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

            listWallets(holder, options = {}, callback = (error, data) => {}){
                db.database("extragon").query(
                    'SELECT balance, comment, identifier, created, pocket FROM `pockets_wallets` WHERE holder = ?' + (options.pocket? " AND pocket = ?" : ""),
                    [holder, options.pocket],

                    function(err, result){
                        if(err) return callback(err);
                        callback(null, result)
                    }
                )
            },

            listTransactions(author, options = {}, callback = (error, data) => {}){
                db.database("extragon").query(
                    'SELECT * FROM `pockets_transactions` WHERE source = ?' + (options.target? " AND target = ?" : "") + " LIMIT ? OFFSET ?",
                    [author, ...options.target? [options.target] : [], options.limit || 20, options.offset || 0],

                    function(err, result){
                        if(err) return callback(err);
                        callback(null, result)
                    }
                )
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

            if(!Array.isArray(data)) data = [data];

            for(let callback of Backend.__logListeners){
                if(callback(source, severity, data) === false){
                    return;
                }
            }

            if(severity < (5 - Backend.logLevel)) return;

            if(devInspecting) data.unshift("color: aquamarine");

            console[severity == 4? "error": severity == 3? "warn": severity < 2? "debug": "log"](`${devInspecting? "%c": ""}[${source}]`, ...data)
        },

        __logListeners: [],

        onLog(callback){
            if(typeof callback !== "function") throw "Callback must be a function";
            Backend.__logListeners.push(callback)
        },

        createLoggerContext(target){
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
            // if(!fs.existsSync("./addons/"+name+".js")) return false;

            path = path || `./${name.startsWith("core/") ? "" : "addons/"}${name}`;

            if(!AddonCache[name]){
                Backend.log("Loading addon; " + name);

                AddonCache[name] = require(path);

                AddonCache[name].log = Backend.createLoggerContext(name)

                if(AddonCache[name].Initialize) AddonCache[name].Initialize(Backend);
            }

            return AddonCache[name]
        },

        mime: {
            // Had to make my own mimetype "library" since the current mimetype library for Node is... meh.

            types: null,
            extensions: null,

            load(){
                Backend.mime.types = JSON.parse(fs.readFileSync(PATH + "/etc/mimetypes.json", "utf8"))
                Backend.mime.extensions = {}

                for(let extension in Backend.mime.types){
                    Backend.mime.extensions[Backend.mime.types[extension]] = extension
                }
            },

            getType(extension){
                return Backend.mime.types[extension] || null
            },

            getExtension(mimetype){
                return Backend.mime.extensions[mimetype] || null
            }
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

        Errors: {
            0: "Unknown API version",
            1: "Invalid API endpoint",
            2: "Missing parameters in request body/query string.",
            3: "Internal Server Error.",
            4: "Access denied.",
            5: "You do not have access to this endpoint.",
            6: "User not found.",
            7: "Username already taken.",
            8: "Email address is already registered.",
            9: "Your login session has expired. Please log-in again.",
            10: "Incorrect verification code.", // FIXME: What does this even mean
            11: "Invalid password.",
            12: "Authentication failed.",
            13: "Session/API token missing or expired.", // FIXME: Identical to 9
            14: "This account is suspended.",
            15: "Forbidden action.", // FIXME: Unclear
            16: "Entity not found.",
            17: "Request timed out.",
            18: "Too many requests. Try again in a few seconds.", // FIXME: Identical to 34/36/429
            19: "Service temporarily unavailable.",
            20: "Service/Feature not enabled. It might first require setup from your panel, is not available (or is paid and you don't have access).",
            21: "Unsupported media type.",
            22: "Deprecated endpoint. Consult documentation for a replacement.",
            23: "Not implemented.",
            24: "Conflict.",
            25: "Data already exist.",
            26: "Deprecated endpoint. Consult documentation for a replacement.",
            27: "This endpoint has been removed from this version of the API. Please migrate your code to the latest API version to keep using it.",
            28: "Access blocked for the suspicion of fraudulent/illegal activity. Contact our support team to get this resolved.",
            29: "This endpoint requires an additional parametter (cannot be called directly)",
            30: "Invalid method.", // FIXME: Identical to 39
            31: "Underlying host could not be resolved.",
            32: "Underlying host could not resolve this request due to a server error.",
            33: "Temporarily down due to high demand. Please try again in a few moments.",
            34: "Global rate-limit has been reached. Please try again in a few moments.",
            35: "This endpoint may handle sensitive data, so you must use HTTPS. Do not use unsecured connections to avoid your information being vulnerable to attacks.",
            36: "Rate-Limited. Please try again in a few minutes.",
            37: "Rate-Limited. You have used all of your requests for a given time period.",
            38: "Rate-Limited. Please contact support for more information.",
            39: "Invalid method for this endpoint.",
            40: "This is a WebSocket-only endpoint. Use the ws:// or wss:// protocol instead of http.",
            41: "Wrong protocol.",
            42: "Internal error: Configured backend type doesn't have a driver for it. Please contact support.",
            43: "File not found.",
            44: "The request contains wrong data",
            45: "Wrong data type",
            46: "Invalid email address.",
            47: "Username must be within 2 to 200 characters in range and only contain bare letters, numbers, and _, -, .",
            48: "Weak password.",
            49: "Sent data exceed maximum allowed size.",


            // HTTP-compatible error codes, this does NOT mean this list is meant for HTTP status codes.
            404: "Request Timed Out.",
            408: "Not Found.",
            409: "Conflict.",
            429: "Too Many Requests",
            500: "Internal Server Error."
        },

        claimedErrorRanges: [
            [0, 100],
            [400, 600]
        ],

        claimErrorCodeRange(from = 0, to = 0){
            if(typeof from !== "number" || typeof to !== "number") throw "Invalid type";
            if(from < 0) throw "Minimum for an error range is 0";
            if(from > to) throw "Invalid range; 'from' must be smaller than 'to'";
            if(to - from > 1000) throw "Error range is too big - maximum size per range is 1000";

            for(let range of Backend.claimedErrorRanges){
                if((from >= range[0] && from <= range[1]) || (to <= range[1] && from >= range[1])) throw "Error range is conflicting with another range: " + range.join(" - ");
            }

            Backend.claimedErrorRanges.push([from, to]);

            function registerError(code, message){
                if(typeof code !== "number") throw "Code must be a number";
                if(from > code || to < code) throw "Error code is outside of claimed range";
                Backend.Errors[code] = message
            }

            return {
                error: registerError,
                errors(list){
                    if(!Array.isArray(list)) list = Object.entries(list);

                    for(let [code, message] of list){
                        registerError(code, message)
                    }
                }
            }
        },

        exposeToDebugger(key, thing){
            if(!devInspecting) return;

            Object.defineProperty(global, key, {
                get(){
                    return thing
                }
            })

            return thing
        }
    }
})()

Backend.log = Backend.createLoggerContext("api")
Backend.refreshConfig()

if(isDev){
    Backend.log("NOTE: API is running in development mode.")

    if(devInspecting){
        console.log("%cWelcome to the Akeno debugger!", "color: #ff9959; font-size: 2rem; font-weight: bold")
        console.log("%cLook at the %c'backend'%c object to get started!", "font-size: 1.4rem", "color: aquamarine; font-size: 1.4rem", "font-size: 1.4rem")
    }
}

Backend.exposeToDebugger("backend", Backend)
Backend.exposeToDebugger("addons", AddonCache)
Backend.exposeToDebugger("api", API)

port = (+Backend.config.block("server").properties.port) || 7007;
doHost = Backend.config.block("server").properties.enableHost == "prod"? !isDev: Backend.config.block("server").properties.enableHost;
doBuild = Backend.config.block("server").properties.enableBuild;

Backend.mime.load()

initialize()
