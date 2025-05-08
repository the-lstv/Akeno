/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.5.9-beta
    See: https://github.com/the-lstv/akeno
*/


let
    // Read more about units in the docs
    Units = require("./core/unit"),

    version = new Units.Version("1.5.9-beta"),

    since_startup = performance.now(),

    // Modules
    uws = require('uWebSockets.js'),
    fastJson = require("fast-json-stringify"),
    fs = require("fs"),

    { ipc_server } = require("./core/ipc"),
    ipc,

    app,
    SSLApp,
    H3App,

    // Storage/cache managers
    KeyStorage = require("./core/kvdb"),
    lsdb,

    bcrypt = require("bcrypt"),     // Secure hashing
    crypto = require('crypto'),     // Cryptographic utils
    uuid = (require("uuid")).v4,    // UUID
    jwt = require('jsonwebtoken'),  // Web tokens

    // Config parser
    { parse, stringify, merge, configTools } = require("./core/parser"),
    // { proxyReq, proxyWebSocket } = require("./core/proxy"),

    { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash"),

    // For code compression
    CleanCSS = new (require('clean-css')),
    UglifyJS = require("uglify-js")
;


try {
    // Disable uWebSockets version header, remove to re-enable
    uws._cfg('999999990007');
} catch (error) {}

const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_BUFFER = Buffer.alloc(0);

let
    // Globals
    AddonCache = {},

    API = { handlers: new Map },

    PATH = __dirname + "/",

    total_hits,

    // Simple domain mapper
    domainRouter = new Map,

    trustedOrigins = new Set
;


function KeyDB(name) {
    const path = PATH + name;

    if (name.startsWith("db/")) {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path)
        }
    } else throw new Error("Invalid database path");

    return new KeyStorage(path)
}


// Open databases
const cache_db = new KeyDB("db/cache");
const data_db = new KeyDB("db/data");

cache_db.open();
data_db.open();

const kvdb = {
    compressionCache: cache_db.openDbi("compression_cache", { keyIsUint32: true }, true),
    generalCache: cache_db.openDbi("general_cache", {}, true),
    apps: data_db.openDbi("apps_data", {}, true),
}


function initialize() {
    if (process.platform !== 'linux') {
        console.warn(`[system] Warning: Your platform (${process.platform}) has experimental support. Internal API server is disabled and the CLI will not work as expected. Akeno is currently only supported on Linux.${process.platform === 'win32' ? ' You can try using WSL or other types of Linux VM to run this software.' : ''}`);
    }

    else {
        const socketPath = (backend.config.block("ipc").get("socket_path", String)) || '/tmp/akeno.backend.sock';
    
        // Internal ipc server
        ipc = new ipc_server({
            onRequest(socket, request, respond){

                const full_path = typeof request === "string"? (request = [request] && request[0]): request[0];

                const index = target.indexOf(".");
                const target = index !== -1? target.slice(0, index): target;
                const path = index !== -1? target.slice(index + 1): full_path;
    
                switch(target){
                    case "ping":
                        respond(null, {
                            backend_path: PATH,
                            version,
                            isDev,
                            server_enabled
                        })
                        break
    
                    case "usage":
                        const res = {
                            mem: process.memoryUsage(),
                            cpu: process.cpuUsage(),
                            uptime: process.uptime(),
                            backend_path: PATH,
                            version,
                            isDev,
                            server_enabled,
                            modules: {
                                count: Units.Manager.count,
                                sample: Units.Manager.list(),
                            }
                        };
    
                        // Calculate CPU usage in percentages
                        if(request[1] === "cpu") {
                            setTimeout(() => {
                                const endUsage = process.cpuUsage(res.cpu);
                                const userTime = endUsage.user / 1000;
                                const systemTime = endUsage.system / 1000;
    
                                res.cpu.usage = ((userTime + systemTime) / 200) * 100
                                respond(null, res)
                            }, 200);
                        } else respond(null, res);
                        break
    
                    default:
                        const targetModule = Units.module(target);

                        if(targetModule && targetModule.onIPCRequest){
                            targetModule.onIPCRequest(path, request, respond);
                        } else {
                            respond("Invalid command")
                        }
                }
    
            }
        })
    
        ipc.listen(socketPath, () => {
            console.log(`[system] IPC socket is listening on ${socketPath}`)
        })
    }

    // TODO: fix
    // if (!server_enabled) return backend.log("Note; server is disabled, skipped loading.");

    // for(let version of API.handlers.values()){
    //     if(version.Initialize) version.Initialize(backend)
    // }

    // Websocket handler
    const wss = {

        // idleTimeout: 32,
        // maxBackpressure: 1024,
        maxPayloadLength: backend.config.block("websocket").get("maxPayloadLength", Number) || 32 * 1024,
        compression: uws[backend.config.block("websocket").get("compression", String)] || uws.DEDICATED_COMPRESSOR_32KB,

        sendPingsAutomatically: true,


        /**
         * @warning This router is currently outdated and will be replaced in the future.
         */

        upgrade(res, req, context) {

            // Upgrading a HTTP connection to a WebSocket

            res.onAborted(() => {
                continueUpgrade = false
            })

            let host = req.getHeader("host"), handler;


            // Handle proxied websockets when needed
            // if(shouldProxy(req, res, true, true, context)) return;

            let segments = req.getUrl().split("/").filter(Boolean), continueUpgrade = true;
            
            const versionCode = req.pathSegments.shift();
            const firstChar = versionCode && versionCode.charCodeAt(0);
            
            if(!firstChar || (firstChar !== 118 && firstChar !== 86)) return backend.helper.error(req, res, 0);
            
            const api = API.handlers.get(parseInt(versionCode.slice(1), 10));
            handler = api && api.HandleRequest;

            if(!handler) return backend.helper.error(req, res, 0);

            if(!handler || !handler.HandleSocket) return res.end();

            if(continueUpgrade) res.upgrade({
                uuid: uuid(),
                url: req.getUrl(),
                query: req.getQuery(),
                host,
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


    const web_handler = Units.Manager.module("akeno.web").HandleRequest;

    function resolve(res, req, flags, virtual = null) {
        if(!flags) flags = EMPTY_OBJECT;

        if(!virtual) {

            req.begin = performance.now()

            // Lowercase is pretty but most code already uses uppercase :(
            req.method = req.getMethod && req.getMethod().toUpperCase();

            const _host = req.getHeader("host"), _colon_index = _host.lastIndexOf(":");
            req.domain = _colon_index === -1? _host: _host.slice(0, _colon_index);
            
            try {
                req.path = decodeURIComponent(req.getUrl());
            } catch (e) {
                req.path = req.getUrl();
                backend.warn("Failed to decode URL:", req.path)
            }
            
            req.secure = flags && !!flags.secure; // If the request is done over a secured connection
            req.origin = req.getHeader('origin');

        } else {

            // Should this be kept or removed?
            // It has a real use-case: selectively handling some requests by different handlers and localy emulating requests.
            req.getMethod = () => virtual.method;
            req.getUrl = () => virtual.path;
            Object.assign(req, virtual)
            req.virtual = true

        }


        // Handle preflight requests
        // TODO: make this more flexible
        if(req.method === "OPTIONS"){
            backend.helper.corsHeaders(req, res)
            res.writeHeader("Cache-Control", "max-age=1382400").writeHeader("Access-Control-Max-Age", "1382400").end()
            return
        }


        if(!req._once){
            req._once = true;

            res.onAborted(() => {
                clearTimeout(res.timeout)
                req.abort = true;
            })

            // Handle proxied requests
            // if(shouldProxy(req, res, flags)) return;


            // Default 15s timeout when the request doesnt get answered
            res.timeout = setTimeout(() => {
                try {
                    if(req.abort) return;

                    if(res && !res.sent && !res.wait) res.writeStatus("408 Request Timeout").tryEnd();
                } catch {}
            }, res.timeout || 15000)
        }


        // Finally, lets route the request to find a handler.

        // A slightly faster implementation compared to .split("/").filter(Boolean)
        req.pathSegments = []
        let last = 0
        for(let i = 0; i < req.path.length +1; i++){
            if(req.path.charCodeAt(i) === 47 || i === req.path.length) {
                if(last !== i) req.pathSegments.push(req.path.slice(last, i));
                last = i + 1
            }
        }

        // Default handler is the web handler
        let handler = domainRouter.get(req.domain) || web_handler;

        // Handle the built-in API
        if(handler === 2){
            const versionCode = req.pathSegments.shift();
            const firstChar = versionCode && versionCode.charCodeAt(0);

            if(!firstChar || (firstChar !== 118 && firstChar !== 86)) return backend.helper.error(req, res, 0);
            
            const api = API.handlers.get(parseInt(versionCode.slice(1), 10));
            handler = api && api.HandleRequest;

            if(!handler) return backend.helper.error(req, res, 0);
        } else if(typeof handler !== "function"){
            return req.writeStatus("400 Bad Request").end("400 Bad Request")
        }

        handler({
            req,
            res,
            flags,

            segments: req.pathSegments,

            /** @deprecated */
            shift: () => backend.helper.next(req),

            /** @deprecated */
            error: (error, code, status) => backend.helper.error(req, res, error, code, status)
        })
    }

    backend.exposeToDebugger("router", resolve)

    // Create server instances
    app = uws.App()

    backend.exposeToDebugger("uws", app)

    // Initialize WebSockets
    app.ws('/*', wss)

    // Initialize WebServer
    app.any('/*', resolve)

    app.listen(HTTPort, (listenSocket) => {
        if (listenSocket) {
            console.log(`[system] Server has started and is listening on port ${HTTPort}! Total hits: ${typeof total_hits === "number"? total_hits: "(not counting)"}, startup took ${(performance.now() - since_startup).toFixed(2)}ms`)

            // Configure SSL
            if(ssl_enabled) {

                SSLApp = uws.SSLApp();
                backend.exposeToDebugger("uws_ssl", SSLApp);

                if(h3_enabled){
                    H3App = uws.H3App({
                        key_file_name: '/etc/letsencrypt/live/lstv.space/privkey.pem',
                        cert_file_name: '/etc/letsencrypt/live/lstv.space/fullchain.pem',
                        passphrase: '1234'
                    });
    
                    // HTTP3 doesn't have WebSockets, do not setup ws listeners.    
                    H3App.any('/*', (res, req) => resolve(res, req, { secure: true, h3: true }))
    
                    backend.exposeToDebugger("uws_h3", H3App)
                }


                SSLApp.ws('/*', wss)
                SSLApp.any('/*', (res, req) => resolve(res, req, { secure: true }))
                

                // If sslRouter is defined
                if(backend.config.block("sslRouter")){
                    let SNIDomains = backend.config.block("sslRouter").properties.domains;
    
                    if(SNIDomains){

                        if(!backend.config.block("sslRouter").properties.certBase || !backend.config.block("sslRouter").properties.keyBase){
                            return backend.error("Could not start server with SSL - you are missing your certificate files (either base or key)!")
                        }

                        function addSNIRoute(domain) {
                            SSLApp.addServerName(domain, {
                                key_file_name:  backend.config.block("sslRouter").properties.keyBase[0].replace("{domain}", domain.replace("*.", "")),
                                cert_file_name: backend.config.block("sslRouter").properties.certBase[0].replace("{domain}", domain.replace("*.", ""))
                            })

                            // We still have to include a separate router like so:
                            SSLApp.domain(domain).any("/*", (res, req) => resolve(res, req, {secure: true})).ws("/*", wss)
                            // If we do not do this, the domain will respond with ERR_CONNECTION_CLOSED.
                            // A bit wasteful right? For every domain..
                        }

                        for(let domain of SNIDomains) {
                            addSNIRoute(domain)

                            if(domain.startsWith("*.")){
                                addSNIRoute(domain.replace("*.", ""))
                            }
                        }

                        // if(backend.config.block("sslRouter").properties.autoAddDomains){
                        //     SSLApp.missingServerName((hostname) => {
                        //         backend.warn("You are missing a SSL server name <" + hostname + ">! Trying to use a certificate on the fly.");

                        //         addSNIRoute(hostname)
                        //     })
                        // }
                    }
                }

                SSLApp.listen(SSLPort, (listenSocket) => {
                    if (listenSocket) {
                        console.log(`[system] Listening with SSL on ${SSLPort}!`)
                    } else backend.error("[error] Could not start the SSL server! If you do not need SSL, you can ignore this, but it is recommended to remove it from the config. If you do need SSL, make sure nothing is taking the port you configured (" +SSLPort+ ")")
                });

                if(h3_enabled){
                    H3App.listen(H3Port, (listenSocket) => {
                        if (listenSocket) {
                            console.log(`[system] HTTP3 Listening with SSL on ${H3Port}!`)
                        } else backend.error("[error] Could not start the HTTP3 server! If you do not need HTTP3, you can ignore this, but it is recommended to remove it from the config. Make sure nothing is taking the port you configured for H3 (" +H3Port+ ")")
                    });
                }
            }
        } else backend.error("[fatal error] Could not start the server on port " + HTTPort + "!")
    });

    backend.resolve = resolve;
}

const jwt_key = process.env.AKENO_KEY;
const devInspecting = !!process.execArgv.find(arg => arg.startsWith("--inspect"));

const backend = {
    version,

    get path(){
        return PATH
    },

    get PATH(){
        return PATH
    },

    helper: {
        writeHeaders(req, res, headers){
            if(headers) {
                res.cork(() => {
                    for(let header in headers){
                        if(!headers[header]) return;
                        res.writeHeader(header, headers[header])
                    }
                });
            }

            return backend.helper
        },

        types: {
            json: "application/json; charset=utf-8",
            js: "text/javascript; charset=utf-8",
            css: "text/css; charset=utf-8",
            html: "text/html; charset=utf-8",
        },

        corsHeaders(req, res, credentials = false) {

            if(trustedOrigins.has(req.origin)){
                credentials = true
            }
            
            res.cork(() => {
                res.writeHeader('X-Powered-By', 'Akeno Server/' + version);
                
                if(credentials){
                    res.writeHeader("Access-Control-Allow-Credentials", "true");
                    res.writeHeader("Access-Control-Allow-Origin", req.origin);
                    res.writeHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Credentials,Data-Auth-Identifier");
                } else {
                    res.writeHeader('Access-Control-Allow-Origin', '*');
                    res.writeHeader("Access-Control-Allow-Headers", "Authorization,*");
                }

                res.writeHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS");

                if(h3_enabled){
                    // EXPERIMENTAL: add alt-svc header for HTTP3
                    res.writeHeader("alt-svc", `h3=":${H3Port}"`)
                }
            })
                
            return backend.helper
        },


        // This helper should be avoided.
        // Only use this if: 1) You are lazy; ...
        send(req, res, data, headers = {}, status){
            if(req.abort) return;            

            if(data !== undefined && (typeof data !== "string" && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array) && !(data instanceof Buffer)) || Array.isArray(data)) {
                headers["content-type"] = backend.helper.types["json"];    
                data = JSON.stringify(data);
            }

            res.cork(() => {
                res.writeStatus(status || "200 OK")

                if(req.begin) {
                    res.writeHeader("server-timing", `generation;dur=${performance.now() - req.begin}`)
                }

                backend.helper.corsHeaders(req, res).writeHeaders(req, res, headers)

                if(data !== undefined) res.end(data)
            });
        },

        next(req){
            if(!req._segmentsIndex) req._segmentsIndex = 0; else req._segmentsIndex ++;
            return req.pathSegments[req._segmentsIndex] || ""; // Returning null is more correct
        },

        // This helper should likely be avoided.
        error(req, res, error, code, status){
            if(req.abort) return;

            if(typeof error == "number" && backend.Errors[error]){
                let _code = code;
                code = error;
                error = (_code? code : "") + backend.Errors[code]
            }

            res.cork(() => {
                res.writeStatus(status || (code >= 400 && code <= 599? String(code) : '400'))
                backend.helper.corsHeaders(req, res)
                res.writeHeader("content-type", "application/json").end(`{"success":false,"code":${code || -1},"error":${(JSON.stringify(error) || '"Unknown error"')}}`);
            })
        },

        stream(req, res, stream, totalSize){
            stream.on('data', (chunk) => {
                let buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength), lastOffset = res.getWriteOffset();

                res.cork(() => {
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
                })
                
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
        },

        bodyParser: class {
            constructor(req, res, callback, stream = false){
                this.req = req;
                this.res = res;

                req.contentType = this.type;

                if(!backend.helper.bodyParser.hasBody(req)){
                    req.hasBody = false;
                    if(stream) {
                        callback(null, true);
                    } else {
                        callback(this);
                    }
                    return
                }

                if(!stream){
                    req.fullBody = Buffer.alloc(0);    
    
                    res.onData((chunk, isLast) => {
                        req.fullBody = Buffer.concat([req.fullBody, Buffer.from(chunk)]);
    
                        if (isLast) {
                            callback(this);
                        }
                    })
                } else {
                    res.onData(callback);
                }
            }

            upload(hash){
                let parts = uws.getParts(this.req.fullBody, this.req.contentType);
                return this.processFiles(parts, hash);
            }

            processFiles(files, hash){
                for(let part of files){
                    part.data = Buffer.from(part.data)

                    if(hash) {
                        if(hash === "xxh3") part.hash = xxh3.xxh64(part.data).toString(16); else
                        if(hash === "xxh32") part.hash = xxh32(part.data).toString(16); else
                        if(hash === "xxh64") part.hash = xxh64(part.data).toString(16); else
                        if(hash === "xxh128") part.hash = xxh3.xxh128(part.data).toString(16); else

                        part.hash = crypto.createHash('md5').update(part.data).digest('hex');
                    }
                }

                return files
            }

            parts(){
                return uws.getParts(this.req.fullBody, this.req.contentType);
            }

            static hasBody(req){
                return req.method === "POST" || (req.hasBody && req.transferProtocol === "qblaze")
            }

            get type(){
                return this.req.getHeader("content-type");
            }

            get length(){
                return this.req.getHeader("content-length");
            }

            get data(){
                return this.req.fullBody
            }

            get string(){
                return this.req.fullBody.toString('utf8');
            }

            get json(){
                let data;

                try{
                    data = JSON.parse(this.req.fullBody.toString('utf8'));
                } catch {
                    return null
                }

                return data
            }
        }
    },

    refreshConfig(){
        backend.log("Refreshing configuration")

        if(!fs.existsSync(PATH + "/config")){
            backend.log("No main config file found in /config, creating a default config file.")
            fs.writeFileSync(PATH + "/config", fs.readFileSync(PATH + "/etc/default-config", "utf8"))
        }

        // let alreadyResolved = {}; // Prevent infinite loops

        // TODO: Merge function must be updated

        // function resolveImports(parsed, stack, referer){
        //     let imports = [];

            
        //     configTools(parsed).forEach("import", (block, remove) => {
        //         remove() // remove the block from the config

        //         if(block.attributes.length !== 0){
        //             let path = block.attributes[0].replace("./", PATH + "/");

        //             if(path === stack) return backend.warn("Warning: You have a self-import of \"" + path + "\", stopped import to prevent an infinite loop.");

        //             if(!fs.existsSync(path)){
        //                 backend.warn("Failed import of \"" + path + "\", file not found")
        //                 return;
        //             }

        //             imports.push(path)
        //         }
        //     })

        //     alreadyResolved[stack] = imports;

        //     for(let path of imports){
        //         if(stack === referer || (alreadyResolved[path] && alreadyResolved[path].includes(stack))){
        //             backend.warn("Warning: You have a recursive import of \"" + path + "\" in \"" + stack + "\", stopped import to prevent an infinite loop.");
        //             continue
        //         }

        //         parsed = merge(parsed, resolveImports(parse(fs.readFileSync(path, "utf8"), {
        //             strict: true,
        //             asLookupTable: true
        //         }), path, stack))
        //     }



        //     return parsed
        // }

        let path = PATH + "/config";

        backend.configRaw = parse(fs.readFileSync(path, "utf8"), {
            strict: true,
            asLookupTable: true
        });

        backend.config = configTools(backend.configRaw);
    },

    compression: {

        // Code compression with both disk and memory cache.
        code(code, isCSS){
            const hash = xxh32(code);

            if (isDev) {
                return Buffer.from(code);
            }

            let compressed;
            // Try to read from memory cache
            if(compressed = kvdb.compressionCache.getCache(hash)) return compressed;

            // We have no disk nor memory cache, compress on the fly and store.
            if(!kvdb.compressionCache.has(hash)){
                compressed = isCSS? CleanCSS.minify(code).styles: UglifyJS.minify(code).code

                // If compression failed, return the original code
                if(!compressed) return Buffer.from(code);

                compressed = Buffer.from(compressed);

                kvdb.compressionCache.commitSet(hash, compressed)
                return compressed;
            }
            
            else {
                // Read from disk cache
                return kvdb.compressionCache.get(hash, Buffer)
            }
        }

    },

    kvdb,

    KeyDB,

    jwt: {
        verify(something, options){
            return jwt.verify(something, jwt_key, options)
        },

        sign(something, options){
            return jwt.sign(something, jwt_key, options)
        }
    },

    uuid,
    bcrypt,
    fastJson,

    app,
    SSLApp,


    /**
     * @deprecated
     */
    API,

    /**
     * @deprecated
     */
    apiExtensions: {},

    broadcast(topic, data, isBinary, compress){
        if(backend.config.block("server").properties.enableSSL) return SSLApp.publish(topic, data, isBinary, compress); else return app.publish(topic, data, isBinary, compress);
    },

    writeLog(data, level = 2, source = "api"){
        // 0 = Debug (Verbose), 1 = Info (Verbose), 2 = Info, 3 = Warning, 4 = Error, 5 = Fatal issue

        if(level < (5 - backend.logLevel)) return;
        if(!Array.isArray(data)) return;

        const color = level >= 4 ? "1;31" : level === 3 ? "1;33" : "36";
        const consoleFunction = level === 4 ? "error" : level === 3 ? "warn" : level < 2 ? "debug" : "log";
        const sourceName = typeof source === "string" ? source : source?.name || "unknown";

        console[consoleFunction](`${level > 4? "* ": ""}\x1b[${color}m[${sourceName}]\x1b[${level > 4? "0;1": "0"}m`, ...data);
    },

    /**
     * @deprecated Please migrate to universal Units.Addon or Units.Module.
     */

    addon(name, path){
        if(!AddonCache[name]){
            path = path || `./${name.startsWith("core/") ? "" : "addons/"}${name}`;

            backend.log("Loading addon;", name);

            AddonCache[name] = require(path);

            // Convert the addon to an Unit instance
            if(!(AddonCache[name] instanceof Units.Unit)){
                Units.Manager.toUnit(AddonCache[name]);
            }

            if(AddonCache[name].Initialize) AddonCache[name].Initialize(backend);
        }

        return AddonCache[name]
    },

    mime: require("./core/mime"),

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
        10: "Incorrect verification code.",
        11: "Invalid password.",
        12: "Authentication failed.",
        13: "Session/API token missing or expired.", // FIXME: Identical to 9
        14: "This account is suspended.",
        15: "Forbidden action.",
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
        34: "",
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


        // HTTP-compatible error codes, this does not mean this list is for HTTP status codes.
        404: "Not found.",
        500: "Internal server error.",
        503: "Service unavailable.",
        504: "Gateway timeout.",
        429: "Too many requests.",
        403: "Forbidden.",
        401: "Unauthorized.",
        400: "Bad request.",
        408: "Request timeout.",
        409: "Conflict.",
        415: "Unsupported media type.",
        501: "Not implemented.",
        406: "Not acceptable.",
        405: "Method not allowed.",
        502: "Bad gateway.",
    },

    exposeToDebugger(key, thing){
        if(!devInspecting) return;

        Object.defineProperty(global, key, {
            get(){
                return thing
            }
        })

        return thing
    },

    db: {
        sql_connections: {},

        sql_open(db, host, user, password){
            if(!user && !host) {
                if(!db) db = backend.config.block("database.sql").get("db", String)
                host = backend.config.block("database.sql").get("host", String)
                user = backend.config.block("database.sql").get("user", String)
                password = backend.config.block("database.sql").get("password", String)

                if(!host || !db || !user || !password) {
                    return null
                }
            }

            if(!lsdb) lsdb = require("./addons/lsdb_mysql");
            if(backend.db.sql_connections[db]) return backend.db.sql_connections[db];
            return backend.db.sql_connections[db] = lsdb.Server(host, user, password, db)
        }
    },

    constants: {
        EMPTY_OBJECT, EMPTY_ARRAY, EMPTY_BUFFER
    }
}

// Initialize the backend
Units.Manager.init(backend);
backend.refreshConfig();

Units.Manager.refreshAddons();

Units.Manager.loadModule("./core/web")


const server_enabled = backend.config.block("server").get("enable", Boolean);
const ssl_enabled = backend.config.block("server").get("enableSSL", Boolean);
const h3_enabled = backend.config.block("server").get("enableH3", Boolean);

const HTTPort = backend.config.block("server").get("port", Number, 80);
const SSLPort = backend.config.block("server").get("sslPort", Number, 443);
const H3Port = backend.config.block("server").get("h3Port", Number, 443);

const isDev = backend.config.block("system").get("developmentMode", Boolean);


backend.log("Starting Akeno v" + version + " in " + (isDev? "development": "production") + " mode.")

// TODO: Improve hanling
const handlers = {
    api: 2
}

// process.exit(0);

for (const block of backend.config.blocks("route")) {
    for (const route of block.attributes) {
        if (typeof route !== "object") continue;
        for (const domain of route.values) {
            domainRouter.set(domain, handlers[route.name])
        }
    }
}


const trustedOriginsConfig = backend.config.block("server").get("trustedOrigins", Array);
if(trustedOriginsConfig) for(const origin of trustedOriginsConfig){
    trustedOrigins.add(origin)
}


// Setup API versions/modules
API.default = backend.config.block("api").get("default", Number, 1)

for (const block of backend.config.blocks("api.version")) {
    for(const name of block.attributes) {
        API.handlers.set(+name, require("./api/" + block.get("module", String)))
    }
}


backend.isDev = isDev;
backend.logLevel = backend.config.block("system").get("logLevel", Number) || isDev? 5 : 3;

if(isDev){
    if(devInspecting){
        console.log("%cWelcome to the Akeno debugger!", "color: #ff9959; font-size: 2rem; font-weight: bold")
        console.log("%cLook at the %c'backend'%c object to get started!", "font-size: 1.4rem", "color: aquamarine; font-size: 1.4rem", "font-size: 1.4rem")
    }
}

backend.exposeToDebugger("backend", backend)
backend.exposeToDebugger("addons", AddonCache)
backend.exposeToDebugger("api", API)

process.on('uncaughtException', (error) => {
    backend.fatal("[uncaught error] This might be a fatal error, in which case you may want to reload (Or you just forgot to catch it somewhere).\nMessager: ", error);
})

process.on('exit', () => {
    console.log(`[system] API is stopping.`);
})

initialize()

module.exports = backend