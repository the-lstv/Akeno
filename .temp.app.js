/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.5.9-beta
    See: https://github.com/the-lstv/akeno
*/



function initialize() {

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
            console.log(`[system] Server has started and is listening on port ${HTTPort}! Total hits: ${typeof total_hits === "number"? total_hits: "(not counting)"}, startup took ${(performance.now() - SINCE_STARTUP).toFixed(2)}ms`)

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

const backend = {

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
            if(compressed = db.compressionCache.getCache(hash)) return compressed;

            // We have no disk nor memory cache, compress on the fly and store.
            if(!db.compressionCache.has(hash)){
                compressed = isCSS? CleanCSS.minify(code).styles: UglifyJS.minify(code).code

                // If compression failed, return the original code
                if(!compressed) return Buffer.from(code);

                compressed = Buffer.from(compressed);

                db.compressionCache.commitSet(hash, compressed)
                return compressed;
            }
            
            else {
                // Read from disk cache
                return db.compressionCache.get(hash, Buffer)
            }
        }

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
        if(!IS_NODE_INSPECTOR_ENABLED) return;

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


const trustedOriginsConfig = backend.config.block("server").get("trustedOrigins", Array);
if(trustedOriginsConfig) for(const origin of trustedOriginsConfig){
    trustedOrigins.add(origin)
}


initialize()