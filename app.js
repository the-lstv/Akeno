let
    version = "1.5.4",

    // Modules
    uws = require('uWebSockets.js'),
    fastJson = require("fast-json-stringify"),
    fs = require("fs"),

    { ipc_server } = require("./core/ipc"),
    ipc,

    app,
    SSLApp,
    H3App,

    lmdb = require('node-lmdb'),
    lsdb = require("./addons/lsdb_mysql"), // SQL Wrapper (temporary)

    bcrypt = require("bcrypt"),     // Secure hashing
    crypto = require('crypto'),     // Cryptographic utils
    uuid = (require("uuid")).v4,    // UUID
    jwt = require('jsonwebtoken'),  // Web tokens

    // Config parser
    { parse, stringify, merge, configTools } = require("./core/parser"),
    { proxyReq, proxyWebSocket, proxySFTP, remoteNodeShell } = require("./core/proxy"),

    { xxh32 } = require("@node-rs/xxhash"),

    textEncoder = new TextEncoder,
    textDecoder = new TextDecoder,

    // For code compression
    CleanCSS = new (require('clean-css')),
    UglifyJS = require("uglify-js")
;



try {
    // Disable uWebSockets version header, remove to re-enable
    uws._cfg('999999990007');
} catch (error) {}



let
    // Globals
    initialized = false,
    AddonCache = {},
    db,

    config,
    configRaw,

    API = { handlers: new Map },
    
    PATH = __dirname + "/",
    
    total_hits,
    since_startup = performance.now(),

    domainRouter = new Map
;



// For requests that shouldn't have CORS restrictions (should be used responsibly)
const no_cors_headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,PUT,DELETE",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "Authorization, *"
}



const cache_db = {
    env: new lmdb.Env(),

    memory_compression_cache: new Map,
    memory_general_cache: new Map,

    commit(){
        try {

            cache_db.txn.commit();
    
        } catch (error) {
    
            console.error(error);        
            cache_db.txn.abort();
    
        }

        cache_db.txn = cache_db.env.beginTxn();
    }
}

cache_db.env.open({
    path: PATH + "db/cache",
    maxDbs: 3
});

cache_db.compression = cache_db.env.openDbi({
    name: "compression_cache",
    create: true,

    // 32-bit xxhash
    keyIsUint32: true
})

cache_db.general = cache_db.env.openDbi({
    name: "general_cache",
    create: true,
})

cache_db.txn = cache_db.env.beginTxn();



function initialize(){
    const socketPath = (backend.config.block("ipc").get("socket_path", String)) || '/tmp/akeno.backend.sock';

    // Internal ipc server
    ipc = new ipc_server({
        onRequest(socket, request, respond){
            
            const command = typeof request === "string"? (request = [request] && request[0]): request[0];

            switch(command){
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

                case "web.list":
                    respond(null, backend.addon("core/web").util.list())
                    break

                case "web.list.domains":
                    respond(null, backend.addon("core/web").util.listDomains(request[1]))
                    break

                case "web.list.getDomain":
                    respond(null, backend.addon("core/web").util.getDomain(request[1]))
                    break

                case "web.enable":
                    respond(null, backend.addon("core/web").util.enable(request[1]))
                    break

                case "web.disable":
                    respond(null, backend.addon("core/web").util.disable(request[1]))
                    break

                case "web.reload":
                    respond(null, backend.addon("core/web").util.reload(request[1]))
                    break

                case "web.tempDomain":
                    respond(null, backend.addon("core/web").util.tempDomain(request[1]))
                    break

                default:
                    respond("Invalid command")
            }

        }
    })

    ipc.listen(socketPath, () => {
        console.log(`[system] IPC socket is listening on ${socketPath}`)
    })

    if (server_enabled) build();
}



// Add / Remove versions
API.handlers.set(1, require("./api/v1.js"))
API.handlers.set(2, require("./api/v2.js"))

API.default = 2



// The init fucntion that initializes and starts the server.
function build(){
    if(initialized) return;
    initialized = true;

    backend.log("Initializing the API...")

    // Initialize API
    for(let version of API.handlers.values()){
        if(version.Initialize) version.Initialize(backend)
    }

    // TODO: uh, no. away with this
    db = lsdb.Server(isDev? '109.71.252.170' : "localhost", 'api_full', backend.config.block("database").get("password", String))

    // Websocket handler
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

            let host = req.getHeader("host");


            // Handle proxied websockets when needed
            if(shouldProxy(req, res, true, true, context)) return;


            // FIXME: This should not be in the main branch
            if(req.domain.startsWith("ssh.")) {
                return proxySFTP(req, res, context, "will-provide")
            }

            if(req.domain.startsWith("node.")) {
                return remoteNodeShell(req, res, context)
            }

            let segments = req.getUrl().split("/").filter(garbage => garbage), continueUpgrade = true;
            
            if(segments[0].toLowerCase().startsWith("v") && !isNaN(+segments[0].replace("v", ""))) segments.shift();

            let handler = API.handlers.get(API.default).GetHandler(segments[0]);

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

    function resolve(res, req, flags, virtual) {
        // total_hits++

        // if(flags && flags.h3){
        //     return res.end("Hi")
        // }


        // Virtual requests
        if(virtual){
            if(virtual.method) req.getMethod = () => virtual.method
            if(virtual.path) req.getUrl = () => virtual.path
            if(virtual.domain) req.getHeader = header => header === "host"? virtual.domain: req.getHeader(header)
        }


        // Lowercase is pretty but most code already uses uppercase
        req.method = req.getMethod && req.getMethod().toUpperCase();
        req.domain = req.getHeader("host").replace(/:([0-9]+)/, "");
        req.path = req.getUrl();
        req.secured = flags && !!flags.secured; // If the request is done over a secured connection


        // This can be called more than once, due to internal redirecions, that is why we check if the request was resolved:
        if(!req.wasResolved){
            req.wasResolved = true;
    
            res.onAborted(() => {
                clearTimeout(res.timeout)
                req.abort = true;
            })


            // Handle proxied requests
            if(shouldProxy(req, res, flags)) return;


            // Handle preflight requests
            if(req.method == "OPTIONS"){
                backend.helper.corsHeaders(req, res)
                res.writeHeader("Cache-Control", "max-age=1382400").writeHeader("Access-Control-Max-Age", "1382400").end()
                return
            }


            // Receive POST body
            if(req.method === "POST" || (req.transferProtocol === "qblaze" && req.hasBody)){
                req.fullBody = Buffer.from('');

                req.hasFullBody = false;
                req.contentType = req.getHeader('content-type');

                res.onData((chunk, isLast) => {
                    req.fullBody = Buffer.concat([req.fullBody, Buffer.from(chunk)]);

                    if (isLast) {
                        req.hasFullBody = true;
                        if(req.onFullData) req.onFullData();
                    }
                })
            }

            // Default 15s timeout when the request doesnt get answered
            res.timeout = setTimeout(() => {
                try {
                    if(req.abort) return;
    
                    if(res && !res.sent && !res.wait) res.writeStatus("408 Request Timeout").tryEnd();
                } catch {}
            }, res.timeout || 15000)
        }

        // Finally, lets route the request.

        let index = -1, segments = decodeURIComponent(req.path).split("/").filter(Boolean)
        req.begin = performance.now()

        function error(error, code){
            if(req.abort) return;

            if(typeof error == "number" && backend.Errors[error]){
                let _code = code;
                code = error;
                error = (_code? code : "") + backend.Errors[code]
            }

            res.cork(() => {
                res.writeStatus('400')
                backend.helper.corsHeaders()
                res.writeHeader("content-type", "application/json").end(`{"success":false,"code":${code || -1},"error":"${(JSON.stringify(error) || "Unknown error").replaceAll('"', '\\"')}"}`);
            })
        }

        function shift(){
            index++
            return segments[index] || "";
        }
        
        const target = domainRouter.get(req.domain);

        console.log(domainRouter);

        // Handle the builtin CDN
        if(target === 1){
            return backend.addon("cdn").HandleRequest({segments, shift, error, req, res})
        }

        // Handle the builtin API
        if(target === 2){
            let version = segments[0] && +(segments[0].slice(1));

            if(version && segments[0][0].toLowerCase().startsWith("v")){
                segments.shift()
            }
    
            const handler = API.handlers.get(version || API.default);
    
            if(handler){
                handler.HandleRequest({segments, shift, error, req, res})
            } else return error(0)
        }

        else {
            // Let's handle it by the webserever addon by default
            backend.addon("core/web").HandleRequest({segments, req, res})
        }
    }

    backend.exposeToDebugger("router", resolve)

    backend.exposeToDebugger("proxyRouter", proxyReq)

    // Create server instances
    app = uws.App()

    backend.exposeToDebugger("uws", app)

    // Initialize WebSockets
    app.ws('/*', wss)
    
    // Initialize WebServer
    app.any('/*', (res, req) => resolve(res, req, backend.isDev))
    
    app.listen(HTTPort, (listenSocket) => {
        if (listenSocket) {
            console.log(`[system] The Akeno server has started and is listening on port ${HTTPort}! Total hits so far: ${typeof total_hits === "number"? total_hits: "(not counting)"}, startup took ${(performance.now() - since_startup).toFixed(2)}ms`)

            // Configure SSL
            if(ssl_enabled) {


                SSLApp = uws.SSLApp();
                backend.exposeToDebugger("uws_ssl", SSLApp)


                if(h3_enabled){
                    H3App = uws.H3App({
                        key_file_name: '/etc/letsencrypt/live/lstv.space/privkey.pem',
                        cert_file_name: '/etc/letsencrypt/live/lstv.space/fullchain.pem',
                        passphrase: '1234'
                    });
    
                    // HTTP3 doesn't have WebSockets, do not setup ws listeners.
    
                    H3App.any('/*', (res, req) => resolve(res, req, {secured: true, h3: true}))
    
                    backend.exposeToDebugger("uws_h3", H3App)
                }


                SSLApp.ws('/*', wss)
                SSLApp.any('/*', (res, req) => resolve(res, req, {secured: true}))
                

                // If sslRouter is defined
                if(backend.config.block("sslRouter")){
                    let SNIDomains = backend.config.block("sslRouter").properties.domains;
    
                    if(SNIDomains){

                        if(!backend.config.block("sslRouter").properties.certBase){
                            return backend.log.error("Could not start SSL server - you are missing certBase in your sslRouter block.")
                        }
                        if(!backend.config.block("sslRouter").properties.certBase){
                            return backend.log.error("Could not start SSL server - you are missing keyBase in your sslRouter block.")
                        }

                        function addSNIRoute(domain) {
                            SSLApp.addServerName(domain, {
                                key_file_name:  backend.config.block("sslRouter").properties.keyBase[0].replace("{domain}", domain.replace("*.", "")),
                                cert_file_name: backend.config.block("sslRouter").properties.certBase[0].replace("{domain}", domain.replace("*.", ""))
                            })
    
                            // For some reason we still have to include a separate router like so:
                            SSLApp.domain(domain).any("/*", (res, req) => resolve(res, req, {secured: true})).ws("/*", wss)
                            // If we do not do this, the domain will respond with ERR_CONNECTION_CLOSED.
                            // A bit wasteful right? For every domain..
                        }

                        for(let domain of SNIDomains) {
                            addSNIRoute(domain)
                            if(backend.config.block("sslRouter").properties.subdomainWildcard){
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
                    } else backend.log.error("[error] Could not start the SSL server! If you do not need SSL, you can ignore this, but it is recommended to remove it from the config. If you do need SSL, make sure nothing is taking the port you configured (" +SSLPort+ ")")
                });

                if(h3_enabled){
                    H3App.listen(H3Port, (listenSocket) => {
                        if (listenSocket) {
                            console.log(`[system] HTTP3 Listening with SSL on ${H3Port}!`)
                        } else backend.log.error("[error] Could not start the HTTP3 server! If you do not need HTTP3, you can ignore this, but it is recommended to remove it from the config. Make sure nothing is taking the port you configured for H3 (" +H3Port+ ")")
                    });
                }
            }
        } else backend.log.error("[error] Could not start the server on port " + HTTPort + "!")
    });

    backend.resolve = resolve;

    if(backend.config.block("server").properties.preloadWeb) backend.addon("core/web");
}



// TODO:
function shouldProxy(req, res, flags = {}, ws = false, wsContext){

    if(!req.domain) req.domain = req.getHeader("host").replace(/:([0-9]+)/, "");

    if(req.domain == "upedie.online"){
        // Redirect to a diferent server on a specific port

        if(!ws) return proxyReq(req, res, {port: 42069}), true;
    }

    if(req.domain.startsWith("proxy.") || req.domain.startsWith("gateway_") || req.domain.startsWith("gateway.") || req.domain.startsWith("discord.")){
        let url,
            subdomain = req.domain.split(".")[0],
            query = req.getQuery(),
            reportedUrl = decodeURIComponent(req.getUrl()).substring(1) + (query? `?${query}`: "")
        ;

        // Handle special cases
        if(subdomain.startsWith("gateway_")){
            reportedUrl = `http${(flags && flags.secured)? "s": ""}://${subdomain.replace("gateway_", "").replaceAll("_", ".")}/${reportedUrl}`
        } else if(subdomain === "discord"){
            reportedUrl = `https://discord.com/${reportedUrl}`
        }

        try {
            url = new URL(decodeURIComponent(reportedUrl));
        } catch {
            return res.writeStatus("400 Bad Request").end("Proxy error: Invalid URL")
        }

        if(ws){
            let headers = {};

            req.forEach((key, value) => {
                if(key.toLowerCase() === "host") return;

                headers[key] = key.toLowerCase() === "origin"? "https://remote-auth-gateway.discord.gg" : value;
            });

            return proxyWebSocket(req, res, wsContext, {
                url: decodeURIComponent(reportedUrl), parsedUrl: url, headers
            }), true
        }

        return proxyReq(req, res, {
            overwriteHeaders: no_cors_headers,
            hostname: url.hostname,
            protocol: url.protocol,
            path: url.pathname + url.search
        }, {
            mode: subdomain === "proxy"? "normal": "web",
            subdomainMode: subdomain !== "proxy" && subdomain !== "gateway"
        }), true
    }

    return false
}



const jwt_key = process.env.AKENO_KEY;

const backend = {
    version,

    config,
    configRaw,

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

        corsHeaders(req, res) {
            res.cork(() => {
                res.writeHeader('X-Powered-By', 'Akeno Server/' + version);

                backend.helper.writeHeaders(res, req, no_cors_headers)

                res.writeHeader("Origin", req.domain)

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

            if(Array.isArray(data) || (typeof data !== "string" && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array) && !(data instanceof DataView) && !(data instanceof Buffer))) {
                headers["content-type"] = types["json"];    
                data = JSON.stringify(data);
            }

            if(req.begin && headers) {
                headers["server-timing"] = `generation;dur=${performance.now() - req.begin}`
            }

            res.cork(() => {
                res.writeStatus(status? status + "": "200 OK")
                backend.helper.corsHeaders(req, res).writeHeaders(req, res, headers)
                res.end(data)
            });
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

        parseBody(req, res, callback){
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

                    if(req.hasFullBody) done(); else req.onFullData = done;

                },

                parts(){

                    function done(){
                        let parts = uws.getParts(req.fullBody, req.contentType);

                        callback(parts)
                    }

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
                }
            }
        }
    },

    refreshConfig(){
        backend.log("Refreshing configuration")

        if(!fs.existsSync(PATH + "/config")){
            backend.log("No main config file found in /config, creating a default config file.")
            fs.writeFileSync(PATH + "/config", fs.readFileSync(PATH + "/etc/default-config", "utf8"))
        }

        let alreadyResolved = {}; // Prevent infinite loops

        // TODO: Merge function must be updated

        // function resolveImports(parsed, stack, referer){
        //     let imports = [];

            
        //     configTools(parsed).forEach("import", (block, remove) => {
        //         remove() // remove the block from the config

        //         if(block.attributes.length !== 0){
        //             let path = block.attributes[0].replace("./", PATH + "/");

        //             if(path === stack) return Backend.log.warn("Warning: You have a self-import of \"" + path + "\", stopped import to prevent an infinite loop.");

        //             if(!fs.existsSync(path)){
        //                 Backend.log.warn("Failed import of \"" + path + "\", file not found")
        //                 return;
        //             }

        //             imports.push(path)
        //         }
        //     })

        //     alreadyResolved[stack] = imports;

        //     for(let path of imports){
        //         if(stack === referer || (alreadyResolved[path] && alreadyResolved[path].includes(stack))){
        //             Backend.log.warn("Warning: You have a recursive import of \"" + path + "\" in \"" + stack + "\", stopped import to prevent an infinite loop.");
        //             continue
        //         }

        //         parsed = merge(parsed, resolveImports(parse(fs.readFileSync(path, "utf8"), true), path, stack))
        //     }



        //     return parsed
        // }

        let path = PATH + "/config";

        // configRaw = Backend.configRaw = resolveImports(parse(fs.readFileSync(path, "utf8"), true), path, null);

        configRaw = backend.configRaw = parse({
            content: fs.readFileSync(path, "utf8"),
            strict: true,
            asLookupTable: true
        });

        config = backend.config = configTools(configRaw);

    },

    compression: {

        // Code compression with both disk and memory cache.
        code(code, isCSS){
            const hash = xxh32(code);

            let compressed;
            if(compressed = cache_db.memory_general_cache.get(hash)) return compressed;

            let hasDiskCache = lmdb_exists(cache_db.txn, cache_db.compression, hash)

            if(!hasDiskCache){
                compressed = Buffer.from(isCSS? CleanCSS.minify(code).styles: UglifyJS.minify(code).code)
                cache_db.txn.putBinary(cache_db.compression, hash, compressed);

                cache_db.commit();
            } else {
                compressed = cache_db.txn.getBinary(cache_db.compression, hash)
            }

            cache_db.memory_compression_cache.set(hash, compressed)

            return compressed || code;
        }

    },

    cache: {
        set(key, value){
            if(!value instanceof Buffer) throw "Cache only accepts a buffer as a value";
            cache_db.memory_general_cache.set(key, value)
            cache_db.txn.putBinary(cache_db.general, key, value);
        },

        get(key){
            return cache_db.memory_general_cache.get(key) || cache_db.txn.getBinary(cache_db.general, key)
        },

        commit(){
            cache_db.commit();
        }
    },

    jwt: {
        verify(something, options){
            return jwt.verify(something, jwt_key, options)
        },

        sign(something, options){
            return jwt.sign(something, jwt_key, options)
        }
    },

    get db(){
        return db
    },

    uuid,
    bcrypt,
    fastJson,

    app,
    SSLApp,

    API,
    apiExtensions: {},

    broadcast(topic, data, isBinary, compress){
        if(backend.config.block("server").properties.enableSSL) return SSLApp.publish(topic, data, isBinary, compress); else return app.publish(topic, data, isBinary, compress);
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

        login(identification, password, callback, expiresIn = 5184000000, createToken = true){
            db.database("extragon").query(
                'SELECT hash, id, username FROM `users` WHERE `username` = ? OR `email` = ?',

                [identification, identification],

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
                            if(createToken) token = backend.jwt.sign(
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

                        } else callback(err ? 12 : 11);
                    })
                }
            )
        },

        async createAccount(user, callback, ip){
            let discord = user.discord? await backend.getDiscordUserInfo(user.discord): {};

            if (!user.username || !user.email || !user.password) {
                return callback("Missing required fields: username, email, or password.");
            }

            if (discord && !discord.id) {
                return callback("Invalid Discord information.");
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
                        hash: await bcrypt.hash(user.password, 8),
                        email: user.email,
                        ip: ip || "",

                        ...(discord && {
                            discord_link: user.discord,
                            discord_id: +discord.id,
                            discord_raw: JSON.stringify(discord),
                        })
                    };

                    db.database("extragon").table("users").insert(finalUser, (err, result) => {
                        if(err){
                            return callback(err)
                        }

                        if (user.generateToken) {
                            backend.user.login(user.username, user.password, (err, data)=>{
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
                return backend.jwt.verify(token, backend.testKey)
            } catch {
                return {error: 9}
            }
        }
    },

    writeLog(data, severity = 2, source = "api"){
        // 0 = Debug (Verbose), 1 = Info (Verbose), 2 = Info, 3 = Warning, 4 = Error, 5 = Important

        if(severity < (5 - backend.logLevel)) return;
        if(!Array.isArray(data)) data = [data];
        if(devInspecting) data.unshift("color: aquamarine");
        console[severity == 4? "error": severity == 3? "warn": severity < 2? "debug": "log"](`${devInspecting? "%c": ""}[${source}]`, ...data)
    },

    createLoggerContext(target){
        let logger = function (...data){
            backend.writeLog(data, 2, target)
        }

        logger.debug = function (...data){
            backend.writeLog(data, 0, target)
        }

        logger.verbose = function (...data){
            backend.writeLog(data, 1, target)
        }

        logger.info = function (...data){
            backend.writeLog(data, 2, target)
        }

        logger.warn = function (...data){
            backend.writeLog(data, 3, target)
        }

        logger.error = function (...data){
            backend.writeLog(data, 4, target)
        }

        logger.impotant = function (...data){
            backend.writeLog(data, 5, target)
        }

        return logger
    },

    addon(name, path){
        // if(!fs.existsSync("./addons/"+name+".js")) return false;

        path = path || `./${name.startsWith("core/") ? "" : "addons/"}${name}`;

        if(!AddonCache[name]){
            backend.log("Loading addon; " + name);

            AddonCache[name] = require(path);

            AddonCache[name].log = backend.createLoggerContext(name)

            if(AddonCache[name].Initialize) AddonCache[name].Initialize(backend);
        }

        return AddonCache[name]
    },

    mime: {
        // My own mimetype checker since the current mimetype library for Node is meh.

        types: null,
        extensions: null,

        load(){
            backend.mime.types = JSON.parse(fs.readFileSync(PATH + "/etc/mimetypes.json", "utf8"))
            backend.mime.extensions = {}

            for(let extension in backend.mime.types){
                backend.mime.extensions[backend.mime.types[extension]] = extension
            }
        },

        getType(extension){
            if(!backend.mime.types) backend.mime.load();
            return backend.mime.types[extension] || null
        },

        getExtension(mimetype){
            if(!backend.mime.extensions) backend.mime.load();
            return backend.mime.extensions[mimetype] || null
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

backend.log = backend.createLoggerContext("api")
backend.refreshConfig()

const server_enabled = backend.config.block("server").get("enable", Boolean);
const ssl_enabled = backend.config.block("server").get("enableSSL", Boolean);
const h3_enabled = backend.config.block("server").get("enableH3", Boolean);

const HTTPort = backend.config.block("server").get("port", Number, 80);
const SSLPort = backend.config.block("server").get("sslPort", Number, 443);
const H3Port = backend.config.block("server").get("h3Port", Number, 443);

const isDev = backend.config.block("system").get("developmentMode", Boolean);
const devInspecting = isDev && !!process.execArgv.find(v => v.startsWith("--inspect"));


for (const block of backend.config.blocks("route")) {
    for(const name of block.attributes) {
        domainRouter.set(name, {
            cdn: 1,
            api: 2
        }[block.get("to", String)])
    }
}


backend.isDev = isDev;
backend.logLevel = backend.config.block("system").get("logLevel", Number) || isDev? 5 : 3;

if(isDev){
    backend.log("NOTE: API is running in development mode.")

    if(devInspecting){
        console.log("%cWelcome to the Akeno debugger!", "color: #ff9959; font-size: 2rem; font-weight: bold")
        console.log("%cLook at the %c'backend'%c object to get started!", "font-size: 1.4rem", "color: aquamarine; font-size: 1.4rem", "font-size: 1.4rem")
    }
}

backend.exposeToDebugger("backend", backend)
backend.exposeToDebugger("addons", AddonCache)
backend.exposeToDebugger("api", API)

process.on('uncaughtException', (error) => {
    console.debug("[system] [error] This might be a fatal error, in which case you may want to reload (Or you just forgot to catch it somewhere).\nMessager: ", error);
})

process.on('exit', () => {
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32LE(total_hits, 0);
    fs.writeFileSync(PATH + "./etc/hits", buffer);

    console.log(`[system] API is stopping.`);
})

initialize()

module.exports = backend



// Misc functions:
function lmdb_exists(txn, db, key){
    let cursor;
    try {
        cursor = new lmdb.Cursor(txn, db);
        return cursor.goToKey(key) !== null;
    } finally {
        if (cursor) cursor.close();
    }
}