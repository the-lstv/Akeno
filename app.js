/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0
    See: https://github.com/the-lstv/akeno
*/


// This is temporary
const fs = require("node:fs");
const TEMP_AKENO_UWS_PATH = fs.existsSync(__dirname + "/../akeno-uws-dev/dist/uws.js") && __dirname + "/../akeno-uws-dev/dist/uws.js";
// Whether to use the new experimental C++ API, or the slow legacy JavaScript one (for now, both are supported, but the legacy one is being deprecated)
// Everywhere where we check "TEMP_USING_AKENO_UWS" is to be later removed
const TEMP_USING_AKENO_UWS = !!TEMP_AKENO_UWS_PATH;

// Module aliases
const moduleAlias = require('module-alias');

moduleAlias.addAliases({
    "akeno:backend" : __dirname + "/app.js",
    "akeno:units"   : __dirname + "/core/unit.js",
    "akeno:web"     : __dirname + (TEMP_USING_AKENO_UWS? "/core/web.js": "/core/legacy/web.js"),
    "akeno:bucket"  : __dirname + "/core/bucket",
    "akeno:ipc"     : __dirname + "/core/ipc",
    "akeno:mime"    : __dirname + "/core/mime.js",
    "akeno:kvdb"    : __dirname + "/core/kvdb.js",
    "akeno:router"  : __dirname + "/core/router.js", // This is being moved to akeno:server (C++ side router)
    "akeno:server"  : (TEMP_USING_AKENO_UWS? TEMP_AKENO_UWS_PATH: 'uWebSockets.js'), // Note that these are *not* API compatible between legacy and Akeno-uWS
    "atrium"        : __dirname + "/core/parser"
});

// Units need to be loaded before everything else
const Units = require("akeno:units");

// Global variables
let version = new Units.Version("1.6.9-beta");

// Tempoary
let globalApp;

// Modules
const
    // - Basic modules
    // fs = require("node:fs"),                                  // File system
    crypto = require('crypto'),                               // Cryptographic utilities

    uws = require('akeno:server'),                            // uWebSockets
    uuid = crypto.randomUUID,                                 // UUIDv4
    { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash"),      // XXHash

    MimeTypes = require("akeno:mime"),                        // MIME types
    Router = require("akeno:router"),                         // Router utilities

    domainRouter = TEMP_USING_AKENO_UWS? {
        add(pattern, handler) {
            backend.globalApp.route(pattern, handler);
        }
    }: new Router.DomainRouter(),                             // Global router instance (temporary backward compatibility)

    // Compression
    zlib = require("node:zlib"),                              // Gzip compression (TODO: Akeno-uWS already has native compression, we can remove this dependency later)

    // - Database (deprecated)
    KeyStorage = require("akeno:kvdb"),                       // Key-value database (WARNING: will soon be deprecated)

    // Local modules
    { Server: IPCServer } = require("akeno:ipc"),             // IPC server
    { parse, configTools } = require("atrium"),               // Config parser

    // Native bindings
    // Warning: The last legacy build had a broken Markdown parser. Akeno-uWS fixes that.
    native = !TEMP_USING_AKENO_UWS? require(`./core/legacy/native/akeno-native-${process.platform}-${process.arch}.node`): {
        get parser() { return uws.HTMLParser; }
    } // <- The native bindings module has been replaced by Akeno-uWS. TODO: Remove once API is replaced.
;

if(TEMP_USING_AKENO_UWS) {
    if(!uws.isAkeno) {
        throw new Error("Invalid Akeno-uWS build.");
    }

    if(!version.compare(uws.akenoCompatibility)) {
        throw new Error(`Incompatible Akeno-uWS build, expected ${uws.akenoCompatibility}, but is running ${version}.`);
    }

    console.warn(`[system] Using experimental Akeno-uWS build`);
    
    // Tempoarary
    globalApp = new uws.App();

    globalApp.onObject((req, res, object) => {
        resolveJS(req, res, object);
    });
} else {
    console.warn(`[system] Using legacy JavaScript resolver - you are mising on high performance.`);
}


// Misc global constants
const PATH = __dirname + "/";
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_BUFFER = Buffer.alloc(0);
const SINCE_STARTUP = process.hrtime.bigint();

const IS_NODE_INSPECTOR_ENABLED = process.execArgv.indexOf("--inspect") !== -1;


// Open databases [TODO: to be updated]
const db = {
    storages: {
        // - Main database
        main: KeyStorage.openDb(PATH, "db/main"),

        // - Data database
        data: KeyStorage.openDb(PATH, "db/data"),

        // - Cache database
        cache: KeyStorage.openDb(PATH, "db/cache")
    }
}

/**
 * Handles object calls to JS; mostly not needed with Akeno-uWS, but could still be used in some edge cases
 * @deprecated
 */
function resolveHandler(req, res, wsContext, handler = null) {
    const isWs = wsContext !== null && typeof wsContext !== "undefined";

    while (handler && typeof handler === "object" && handler instanceof Router.PathMatcher) {
        handler = handler.match(req.path);
    }

    if(typeof handler === "function"){
        if(isWs) {
            if(handler.__includeWebSocketUpgrades) {
                handler(req, res, wsContext);
                return;
            }

            res.writeStatus("400 Bad Request").end("400 Bad Request");
            return;
        }

        handler(req, res);
        return;
    }

    if (typeof handler === "object") {
        if (isWs) {
            const ws = handler.websocket;
            if (!ws || typeof ws !== "object") {
                res.writeStatus("400 Bad Request").end("400 Bad Request");
                return;
            }

            if(typeof ws.upgrade === "function") {
                ws.upgrade(req, res, wsContext);
                return;
            }

            const customData = {
                uuid: uuid(),
                url: req.path,
                query: req.getQuery(),
                domain: req.domain,
                host: req.host,
                ip: backend.helper.getRequestIP(res),
                handler: ws
            };

            if(typeof ws.beforeUpgrade === "function") {
                if(ws.beforeUpgrade(req, res, wsContext, customData) === false) {
                    return;
                }
            }

            if (!req.abort) {
                try {
                    res.upgrade(customData, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), wsContext);
                } catch (e) {
                    console.error("WebSocket upgrade error:", e);
                }
            }
            return;
        }

        if(typeof handler.onRequest === "function"){
            handler.onRequest(req, res);
            return;
        }

        if(handler instanceof Units.App){
            backend.webServerHandler(req, res, handler);
            return;
        }
    }

    res.writeStatus("400 Bad Request").end("400 Bad Request");
}

let resolve = resolveJS; // Akeno-uWS skips the JS resolver completely
if(!TEMP_USING_AKENO_UWS) {
    /**
    * This is the legacy JS resolver compatible with vanilla uWebSockets.js.
    * @deprecated
    */
    resolve = function (res, req, wsContext = null) {
        if(!(this instanceof Units.Protocol)) {
            throw new TypeError("resolve() must be called with Units.Protocol as context");
        }

        if(!wsContext && (backend.mode === backend.modes.DEVELOPMENT || backend.mode === backend.modes.TESTING)){
            req.begin = performance.now();
        }

        // Method string; GET, POST, etc. - is case-sensitive, as per RFC standards. Thus we don't need to normalize (previously I was stupidly normalizing TWICE...).
        req.method = req.getCaseSensitiveMethod();
        req.origin = req.getHeader('origin');

        const flags = this.requestFlags;
        req.secure = !!(flags && flags.secure);

        const _host = req.getHeader("host") || "", _colon_index = _host.lastIndexOf(":");
        req.domain = _colon_index === -1? _host: _host.slice(0, _colon_index);
        req.host = _host;

        if(req.domain.startsWith("www.")) {
            res.writeStatus("301 Moved Permanently");
            res.writeHeader("Location", `${req.secure ? "https" : "http"}://${req.domain.slice(4)}${req.getUrl()}`);
            res.end();
            return;
        }

        if(req.method === "OPTIONS"){
            backend.helper.corsHeaders(req, res);
            res.writeHeader("Cache-Control", "max-age=1382400");
            res.writeHeader("Access-Control-Max-Age", "1382400");
            res.end();
            return;
        }

        const url = req.getUrl();
        req.path = url.indexOf("%") === -1? url: decodeURIComponent(url);

        if(req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
            req.contentType = req.getHeader("content-type");
            req.contentLength = req.getHeader("content-length");
        }

        res.onAborted(() => {
            req.abort = true; // This doesn't even make sense
        });

        resolveHandler(req, res, wsContext, domainRouter.match(req.domain));
    }
}

// This one has the correct order.
function resolveJS(req, res, target) {
    res.onAborted(() => { });
    resolveHandler(req, res, null, target);
}

// Central backend object
const backend = {
    version,

    /**
     * @deprecated
     */
    db,

    /**
     * Legacy only, to be removed
     * @deprecated
     */
    native,

    /**
     * You should use `require("akeno:mime")`
     * @deprecated
     */
    mime: MimeTypes,

    /**
     * @deprecated
     */
    broadcast(topic, data, isBinary = false, compress = false) {
        (backend.protocols.https.server || backend.protocols.http.server).publish(topic, data, isBinary, compress);
    },

    PATH,
    get path(){
        return PATH
    },

    constants: {
        EMPTY_OBJECT, EMPTY_ARRAY, EMPTY_BUFFER, SINCE_STARTUP,
        IS_NODE_INSPECTOR_ENABLED,

        MAX_BODY_SIZE: 107374182400, // 100 GB

        MIN_COMPRESSION_SIZE: 512,
    },

    mode: 0,

    modes: new Units.IndexedEnum([
        "PRODUCTION",
        "DEVELOPMENT",
        "TESTING",
        "MAINTENANCE"
    ]),

    /**
     * Protocols should now be independent rather than static (since we now have a proper Protocol API)
     * @deprecated
     */
    protocols: {
        ipc: new class IPCProtocol extends Units.Protocol {
            constructor(){
                super({
                    name: "IPC",
                    protocol: "ipc",
                    type: "ipc"
                })
            }

            init() {
                // Internal ipc server
                this.server = new IPCServer({
                    onRequest(req, res) {
                        // TODO: This needs rework I guess
                        
                        let target;
                        if (typeof req.data === "string") {
                            target = req.data;
                            req.data = [];
                        } else if(Array.isArray(req.data) && req.data.length > 0) {
                            target = req.data.shift();
                        } else {
                            res.error("Invalid request").end();
                            return;
                        }

                        const segments = target.split("/");
                        target = segments.shift();

                        switch(target){
                            case "ping":
                                res.end({
                                    backend_path: PATH,
                                    version,
                                    versionString: String(version),
                                    mode: backend.modes.get(backend.mode),
                                })
                                break

                            case "dump-router":
                                res.end(domainRouter.dump());
                                break

                            case "usage":
                                const usageData = {
                                    mem: process.memoryUsage(),
                                    cpu: process.cpuUsage(),
                                    uptime: process.uptime(),
                                    backend_path: PATH,
                                    mode: backend.modes.get(backend.mode),
                                    version: String(version),
                                    modules: {
                                        count: Units.Manager.count,
                                        sample: [] // Units.Manager.list(),
                                    }
                                };

                                // Calculate CPU usage in percentages
                                if(segments.includes("cpu")) {
                                    setTimeout(() => {
                                        const endUsage = process.cpuUsage(usageData.cpu);
                                        const userTime = endUsage.user / 1000;
                                        const systemTime = endUsage.system / 1000;

                                        usageData.cpu.usage = ((userTime + systemTime) / 200) * 100;
                                        res.end(usageData);
                                    }, 200);
                                } else res.end(usageData);
                                break

                            default:
                                const targetModule = Units.Manager.module(target);

                                if(targetModule && targetModule.onIPCRequest){
                                    targetModule.onIPCRequest(segments, req, res);
                                } else {
                                    res.error("Invalid command").end();
                                    return;
                                }
                        }

                    }
                })
            }

            enable() {
                if(!this._initialized){
                    this._initialized = true;
                    this.init();
                }

                this.server.listen(this.socketPath, () => {
                    this.log(`Listening on ${this.socketPath}`);

                    if (backend.config.getBlock("protocols").getBlock("ipc").get("openPermissions", Boolean, false)) {
                        try {
                            fs.chmodSync(this.socketPath, 0o777);
                        } catch (err) {
                            this.log(`Failed to set permissions for ${this.socketPath}: ${err.message}`);
                        }
                    }
                })
            }

            disable() {
                this.server.close(() => {
                    this.log(`Closed`)
                })
            }
        },

        /**
         * @deprecated To be replaced by the new Protocol API
         */
        http: new class HTTPProtocol extends Units.HTTPProtocol {
            constructor(){
                super({
                    name: "HTTP",
                    protocol: "http",
                    type: "http"
                })

                this.requestFlags = {
                    secure: false
                }

                if(!TEMP_USING_AKENO_UWS) this.defaultResolver = resolve.bind(this);

                // @deprecated
                this.ports = [];
            }

            init() {
                if(TEMP_USING_AKENO_UWS) {
                    // There is finally a proper API for this
                    this.server = new uws.HTTPProtocol();
                    this.server.bind(globalApp);
                } else {
                    this.server = uws.App();
                    this.server.any("/*", this.defaultResolver);
    
                    if(this.enableWebSockets) this.server.ws("/*", backend.protocols.ws.options);
                }
            }
        },

        https: new class HTTPSProtocol extends Units.HTTPProtocol {
            constructor(){
                super({
                    name: "HTTPS",
                    protocol: "https",
                    type: "http"
                })

                this.requestFlags = {
                    secure: true
                }

                if(!TEMP_USING_AKENO_UWS) this.defaultResolver = resolve.bind(this);

                this.ports = [];

                this.SNINames = new Set();
            }

            onReload(){
                if(!this.server || !this.enabled) return;

                // Legacy SNI handling
                // if(!TEMP_USING_AKENO_UWS) {
                    const SNIDomains = backend.config.getBlock("ssl").get("domains", Array, []);

                    if(SNIDomains && SNIDomains.length > 0) for(const domain of SNIDomains) {
                        this.addSNIRoute(domain);

                        // Not sure if we should be adding a root domain handler by default.
                        if(domain.startsWith("*.")){
                            this.addSNIRoute(domain.replace("*.", ""));
                        }
                    }
                // }
            }

            addSNIRoute(domain, key = null, cert = null) {
                if(this.SNINames.has(domain)) {
                    return false;
                }

                this.server.addServerName(domain, {
                    key_file_name:  key  || backend.config.getBlock("ssl").get("keyBase", String, "") .replace("{domain}", domain.replace("*.", "")),
                    cert_file_name: cert || backend.config.getBlock("ssl").get("certBase", String, "").replace("{domain}", domain.replace("*.", ""))
                });

                this.SNINames.add(domain);

                if(!TEMP_USING_AKENO_UWS) {
                    const route = this.server.domain(domain);
                    route.any("/*", this.defaultResolver);

                    if(this.enableWebSockets) route.ws("/*", backend.protocols.ws.options);
                    return true;
                }
            }

            init() {
                // TODO: Support passphrases

                const default_key = backend.config.getBlock("ssl").get("key", String, null);
                const default_cert = backend.config.getBlock("ssl").get("cert", String, null);

                const ssl_config = (default_key && default_cert)? {
                    key_file_name: default_key,
                    cert_file_name: default_cert
                }: null;

                if(TEMP_USING_AKENO_UWS) {
                    // There is finally a proper API for this
                    this.server = ssl_config? new uws.HTTPSProtocol(ssl_config): new uws.HTTPSProtocol();
                    this.server.bind(globalApp);
                } else {
                    // No, you can't put the ternary inside the constructor.
                    this.server = ssl_config? uws.SSLApp(ssl_config): uws.SSLApp();
                    this.server.any("/*", this.defaultResolver);

                    // TODO: Distinguish WS over HTTP/s
                    if(this.enableWebSockets) this.server.ws("/*", backend.protocols.ws.options);
                }
            }
        },

        h3: new class H3Protocol extends Units.HTTPProtocol {
            constructor(){
                super({
                    name: "HTTP3",
                    protocol: "h3",
                    type: "http"
                })

                this.requestFlags = {
                    secure: true,
                    h3: true
                }

                this.defaultResolver = resolve.bind(this);

                this.ports = [];
            }

            init() {
                this.warn("HTTP/3 support is still experimental and may not work correctly.");

                const key = backend.config.getBlock("ssl").get("key", String, null);
                const cert = backend.config.getBlock("ssl").get("cert", String, null);
                console.log(key, cert);
                

                this.server = uws.H3App({
                    key_file_name: key,
                    cert_file_name: cert
                });

                this.server.any("/*", this.defaultResolver);
            }
        },

        ws: new class WebSocketProtocol extends Units.Protocol {
            constructor(){
                super({
                    name: "WebSocket",
                    protocol: "ws",
                    type: "ws"
                })

                this.defaultResolver = resolve.bind(this);
            }

            init() {
                // TODO: In the future, this could be moved to the C++ side
                // Default WS handler
                this.options = {
                    idleTimeout: backend.config.getBlock("websocket").get("idleTimeout", Number) || 60,
                    sendPingsAutomatically: backend.config.getBlock("websocket").get("sendPingsAutomatically", Boolean, true),
                    maxPayloadLength: backend.config.getBlock("websocket").get("maxPayloadLength", Number) || 32 * 1024,
                    maxBackpressure: backend.config.getBlock("websocket").get("maxBackpressure", Number) || 1024 * 1024,
                    maxLifetime: backend.config.getBlock("websocket").get("maxLifetime", Number) || 0,
                    closeOnBackpressureLimit: backend.config.getBlock("websocket").get("closeOnBackpressureLimit", Boolean, false),
                    compression: uws[backend.config.getBlock("websocket").get("compression", String, "DEDICATED_COMPRESSOR_32KB").toLowerCase()] || uws.DEDICATED_COMPRESSOR_32KB,

                    upgrade: (res, req, context) => {
                        if(!this.enabled) {
                            return res.writeStatus("503 Service Unavailable").end("503 Service Unavailable");
                        }

                        this.defaultResolver(res, req, context);
                    },

                    open(ws) {
                        if(ws.handler.open) ws.handler.open(ws);
                    },

                    message(ws, message, isBinary) {
                        if(ws.handler.message) ws.handler.message(ws, message, isBinary);
                    },
                    
                    close(ws, code, message) {
                        if(ws.handler.close) ws.handler.close(ws, code, message);
                    },

                    drain(ws) {
                        if(ws.handler.drain) ws.handler.drain(ws);
                    },

                    dropped(ws, message, isBinary) {
                        if(ws.handler.dropped) ws.handler.dropped(ws, message, isBinary);
                    },

                    ping(ws, message) {
                        if(ws.handler.ping) ws.handler.ping(ws, message);
                    },

                    pong(ws, message) {
                        if(ws.handler.pong) ws.handler.pong(ws, message);
                    },

                    subscription(ws, topic, newCount, oldCount) {
                        if(ws.handler.subscription) ws.handler.subscription(ws, topic, newCount, oldCount);
                    }
                };
            }

            enable() {
                if(!this._initialized){
                    this._initialized = true;
                    this.init();
                }
            }
        }
    },

    /**
     * @deprecated
     */
    compression: {

        // If to enable compression/code compression, overriden by the config - actual code may not, but should respect this.
        enabled: true,
        codeEnabled: true,

        format: new Units.IndexedEnum([
            "NONE",
            "GZIP",
            "DEFLATE",
            "BROTLI",
            "JS",
            "CSS",
            "JSON"
        ]),

        compress(buffer, format = 0) {
            if(!(buffer instanceof Buffer)) {
                buffer = Buffer.from(buffer);
            }

            if(!buffer || !buffer.length) return buffer;

            if(typeof format === "string") {
                format = backend.compression.format[format.toUpperCase()];
            }

            if(typeof format !== "number") {
                throw new Error(`Invalid compression format: ${format}`);
            }

            if(format === backend.compression.format.NONE) {
                return buffer;
            }

            // const hash = xxh32(buffer);

            switch (format) {
                case backend.compression.format.GZIP:
                    return zlib.gzipSync(buffer, { level: 6 });

                case backend.compression.format.DEFLATE:
                    return zlib.deflateSync(buffer, { level: 6 });

                case backend.compression.format.BROTLI:
                    return zlib.brotliCompressSync(buffer, {
                        params: {
                            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
                        }
                    });

                default:
                    throw new Error(`Unknown compression format: ${format}`);
            }
        },

        // Code compression with both disk and memory cache.
        code(data, format){
            // Sadly no Buffer support yet :(
            if(typeof data !== "string") {
                throw new TypeError("A string must be provided for code compression.");
            }

            if(typeof format !== "number") {
                throw new Error(`Invalid compression format: ${format}`);
            }

            if(!data || !data.length || !backend.compression.codeEnabled || format === backend.compression.format.NONE) {
                return Buffer.from(data)
            }

            // if (backend.mode === backend.modes.DEVELOPMENT) {
            //     return Buffer.from(data);
            // }

            const hash = xxh32(data);

            let compressed;

            if(compressed = db.compressionCache.getCache(hash)) return compressed;


            // We have no disk nor memory cache, compress on the fly and store.
            if(!db.compressionCache.has(hash)){
                switch(format){
                    case backend.compression.format.JS:
                        if(!backend._UglifyJS) {
                            backend._UglifyJS = require("uglify-js");
                        }
                        compressed = backend._UglifyJS.minify(data).code;
                        break;

                    case backend.compression.format.CSS:
                        if(!backend._CleanCSS) {
                            backend._CleanCSS = new (require('clean-css'))();
                        }
                        compressed = backend._CleanCSS.minify(data).styles;
                        break;

                    case backend.compression.format.JSON:
                        compressed = JSON.stringify(JSON.parse(data));
                        break;
                }

                // If compression failed, return the original code
                if(!compressed) return Buffer.from(data);

                compressed = Buffer.from(compressed);

                db.compressionCache.commitSet(hash, compressed)
                return compressed;
            }
            
            else {
                // Read from memory/disk cache
                return db.compressionCache.get(hash, Buffer)
            }
        }

    },

    // Legacy JS logger
    writeLog(level = 2, source = "api", ...data) {
        if(level < (5 - backend.logLevel)) return;

        const color = level >= 4 ? "1;31" : level === 3 ? "1;33" : "36";
        const consoleFunction = console[level === 4 ? "error" : level === 3 ? "warn" : level < 2 ? "debug" : "log"];
        const sourceName = typeof source === "string" ? source : source?.name || "unknown";

        if(!backend._fancyLogEnabled) {
            consoleFunction(`[${sourceName}]`, ...data);
            return;
        }

        const tag = `${level > 4? "* ": ""}\x1b[${color}m[${sourceName}]\x1b[${level > 4? "0;1": "0"}m`;

        if(!Array.isArray(data)){
            data = [data];
        }

        consoleFunction(tag, ...data.map(item => {
            if (typeof item === "string") {
                return item.replaceAll("\n", "\n" + " ".repeat(sourceName.length - 1) + "\x1b[90m⤷\x1b[0m   ");
            }
            return item;
        }));
    },

    refreshConfig(){
        if(!fs.existsSync(PATH + "/config")){
            backend.log("No main config file found in /config, creating a default config file.")
            fs.writeFileSync(PATH + "/config", fs.readFileSync(PATH + "/etc/default-config", "utf8"))
        }

        let path = PATH + "/config";
        try {
            const configStat = fs.statSync(path);
            if (backend._lastConfigMtime && configStat.mtime.getTime() === backend._lastConfigMtime) {
                backend.log("Configuration file has not been modified, skipping reload.");
                return;
            }

            backend._lastConfigMtime = configStat.mtime.getTime();
        } catch (err) {
            backend.warn("Failed to check config modification time:", err.message);
        }


        if(backend.config) backend.log("Refreshing configuration");

        backend.configRaw = parse(fs.readFileSync(path, "utf8"), {
            strict: true,
            asLookupTable: true
        });

        backend.config = configTools(backend.configRaw);

        backend.mode = backend.modes[backend.config.getBlock("system").get("mode", String, "production").toUpperCase()] || backend.modes.PRODUCTION;
        backend.logLevel = backend.config.getBlock("system").get("logLevel", Number) || (backend.mode === backend.modes.DEVELOPMENT? 5 : 3);
        backend._fancyLogEnabled = backend.config.getBlock("system").get("fancyLog", Boolean, true);

        // Enable/disable protocols
        const protocols = backend.config.getBlock("protocols");

        backend.protocols.ipc.socketPath = (protocols.getBlock("ipc").get("socket_path", String)) || '/tmp/akeno.backend.sock';
        if(process.platform === 'win32'){
            const pipeName = (protocols.getBlock("ipc").get("windowsPipeName", String)) || 'akeno.backend.sock';
            if (/[/\\]/.test(pipeName)) throw new Error('protocols.ipc.windowsPipeName should not contain slashes - make sure you are not adding a full path.');
            backend.protocols.ipc.socketPath = `\\\\.\\pipe\\${pipeName}`;
        }

        backend.protocols.ipc.enabled = protocols.getBlock("ipc").get("enabled", Boolean, true);

        // TODO: Better handling of ports (due to apps being able to request custom ports)

        // Note: setting "enabled" has to be last, as it calls the init() method. Also, ws has to be enabled before HTTP.

        const http_ws_enabled = protocols.getBlock("http").get("websockets", String, "false");
        backend.protocols.http.ports = protocols.getBlock("http").get(["port", "ports"], Array, [80]);
        backend.protocols.http.enableWebSockets = http_ws_enabled === "true"? true: http_ws_enabled === "dev-only"? backend.mode === backend.modes.DEVELOPMENT: false;

        backend.protocols.https.ports = protocols.getBlock("https").get(["port", "ports"], Array, [443]);
        backend.protocols.https.enableWebSockets = protocols.getBlock("https").get("websockets", Boolean, true);

        backend.protocols.h3.ports = protocols.getBlock("h3").get(["port", "ports"], Array, [443]);

        backend.protocols.ws.enabled = backend.protocols.http.enableWebSockets || backend.protocols.https.enableWebSockets;
        backend.protocols.http.enabled = protocols.getBlock("http").get("enabled", Boolean, true);
        backend.protocols.https.enabled = protocols.getBlock("https").get("enabled", Boolean, false);
        backend.protocols.h3.enabled = protocols.getBlock("h3").get("enabled", Boolean, false);

        if(backend.protocols.http.onReload) backend.protocols.http.onReload();
        if(backend.protocols.https.onReload) backend.protocols.https.onReload();

        // TODO: Add something like "in production only".
        backend.compression.enabled = backend.config.getBlock("web").get("compress", Boolean, true);
        backend.compression.codeEnabled = backend.config.getBlock("web").get("compress-code", Boolean, true);

        backend.esbuildEnabled = backend.config.getBlock("web").get("esbuild", Boolean, false);
        backend.esbuildTargets = backend.config.getBlock("web").get("esbuild-targets", Array, ["chrome108", "firefox102", "safari16"]);
    },

    exposeToDebugger(key, item){
        if(!IS_NODE_INSPECTOR_ENABLED) return;

        Object.defineProperty(global, key, {
            get(){
                return item
            }
        })

        return item
    },

    trustedOrigins: new Set,

    resolve,

    resolveHandler,

    domainRouter,

    uuid,

    uws,

    globalApp,

    TEMP_USING_AKENO_UWS
}


// To be updated for multithreading
// Multithreading technically works, but some kind of a system is needed to redirect applications
if(true) {
    // We do this here to make intellisense work at least somewhere
    Units.Manager.initCore(backend);

    // Do not rely on this 🙏
    global.backend = backend;
    module.exports = backend;

    backend.helper = require("./core/helpers");

    const timeAfterInit = process.hrtime.bigint();

    // Load configuration file
    backend.refreshConfig();

    const timeAfterConfig = process.hrtime.bigint();

    db.storages.cache.open();
    db.storages.data.open();

    db.compressionCache = db.storages.cache.openDbi("compression", { keyIsUint32: true }, true);
    db.generalCache = db.storages.cache.openDbi("general", {}, true);
    db.apps = db.storages.main.openDbi("app.metadata", {}, true);

    const timeAfterDb = process.hrtime.bigint();

    Units.Manager.loadModule((TEMP_USING_AKENO_UWS? "/core/web.js": "/core/legacy/web.js"));

    if(!TEMP_USING_AKENO_UWS) {
        backend.webServerHandler = Units.Manager.module("akeno.web").onRequest;
        domainRouter.fallback = backend.webServerHandler;
    }

    // FIXME: Remove this
    // But I mean... it's better than just instantly crashing
    // The reason I implemented this is that some stupid modules throw on random minor errors and are nearly impossible to catch
    process.on('uncaughtException', (error) => {
        backend.fatal("[uncaught error] This might be a fatal error, in which case you may want to reload (Or you just forgot to catch it somewhere).\nMessager: ", error);
    });

    process.on('exit', () => {
        backend.log(`[system] Exiting Akeno`);
    });

    const timeAfterWebApps = process.hrtime.bigint();

    try {
        // Disable uWebSockets version header, remove to re-enable
        uws._cfg('999999990007');
    } catch (error) {}

    if(backend.mode === backend.modes.DEVELOPMENT && IS_NODE_INSPECTOR_ENABLED) {
        console.log("%cWelcome to the Akeno debugger!", "color: #ff9959; font-size: 2rem; font-weight: bold")
        console.log("%cLook at the %c'backend'%c object to get started!", "font-size: 1.4rem", "color: aquamarine; font-size: 1.4rem", "font-size: 1.4rem")

        backend.exposeToDebugger("backend", backend);
        backend.exposeToDebugger("web", Units.Manager.module("akeno.web"));
    }

    if (process.platform !== 'linux') {
        backend.warn(`Warning: Your platform (${process.platform}) has experimental support. Akeno is currently only officially supported on Linux, so you may run into unexpected issues.`);
    }

    Units.Manager.refreshAddons();
    const timeAfterAddons = process.hrtime.bigint();

    const totalTime = Number(timeAfterAddons - SINCE_STARTUP) / 1_000_000;
    const initTime = Number(timeAfterInit - SINCE_STARTUP) / 1_000_000;
    const configTime = Number(timeAfterConfig - timeAfterInit) / 1_000_000;
    const dbTime = Number(timeAfterDb - timeAfterConfig) / 1_000_000;
    const webTime = Number(timeAfterWebApps - timeAfterDb) / 1_000_000;
    const addonsTime = Number(timeAfterAddons - timeAfterWebApps) / 1_000_000;

    const breakdown = [
        initTime > 1 ? `${initTime.toFixed(2)}ms init` : null,
        configTime > 1 ? `${configTime.toFixed(2)}ms config` : null,
        addonsTime > 1 ? `${addonsTime.toFixed(2)}ms addons` : null,
        webTime > 1 ? `${webTime.toFixed(2)}ms web apps` : null,
        dbTime > 1 ? `${dbTime.toFixed(2)}ms db` : null,
    ].filter(Boolean).join(', ');

    backend.log(`Starting \x1b[35mAkeno v${version}\x1b[0m in \x1b[36m${backend.modes.get(backend.mode).toLowerCase()}\x1b[0m mode. Startup took \x1b[36m${totalTime.toFixed(2)}ms\x1b[0m${breakdown ? ` (${breakdown})` : ''}.`);
}