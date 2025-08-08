/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    See: https://github.com/the-lstv/akeno
*/

// Module aliases
const moduleAlias = require('module-alias');

moduleAlias.addAliases({
    "akeno:backend": __dirname + "/app.js",
    "akeno:kvdb": __dirname + "/core/kvdb.js",
    "akeno:units": __dirname + "/core/unit.js",
    "akeno:mime": __dirname + "/core/mime.js",
    "akeno:ipc": __dirname + "/core/ipc.js",
    "akeno:router": __dirname + "/core/router.js"
});

const Units = require("akeno:units");


// Global variables
let
    version = new Units.Version("1.6.6-beta")
;


// Modules
const
    // - Basic modules
    fs = require("node:fs"),                              // File system
    uws = require('uWebSockets.js'),                      // uWebSockets
    uuid = (require("uuid")).v4,                          // UUIDv4
    // fastJson = require("fast-json-stringify"),            // Fast JSON serializer
    { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash"),  // XXHash

    MimeTypes = require("akeno:mime"),                    // MIME types
    Router = require("akeno:router"),                     // Router utilities

    domainRouter = new Router.DomainRouter(),             // Global router instance

    // - Authentication and security
    bcrypt = require("bcrypt"),                           // Secure hashing
    crypto = require('crypto'),                           // Cryptographic utilities
    jwt = require('jsonwebtoken'),                        // Web tokens

    // Compression
    zlib = require("node:zlib"),                          // Gzip compression

    // - Database
    KeyStorage = require("./core/kvdb"),                  // Key-value database (WARNING: will soon be deprecated)

    // Local modules
    { Server: IPCServer } = require("./core/ipc"),        // IPC server
    { parse, configTools } = require("./core/parser"),    // Parser

    native = require("./core/native/dist/akeno-native")   // Native bindings
;


// Misc constants
const PATH = __dirname + "/";
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_BUFFER = Buffer.alloc(0);
const SINCE_STARTUP = performance.now();

const IS_NODE_INSPECTOR_ENABLED = !!process.execArgv.find(arg => arg.startsWith("--inspect"));
let JWT_KEY = process.env.AKENO_KEY;


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
* Global HTTP request resolver
* Note: Do not call this function directly, define a protocol and then .bind it instead.
* TODO: Move this to the C++ side
* @param {HttpResponse} res
* @param {HttpRequest} req
* @example
* const myHandler = backend.resolve.bind(myProtocol);
* myHandler(res, req);
*/

function resolve(res, req) {
    if(!(this instanceof Units.Protocol)) {
        throw new TypeError("resolve() must be called with Units.Protocol as context");
    }

    if(backend.mode === backend.modes.DEVELOPMENT || backend.mode === backend.modes.TESTING){
        req.begin = performance.now();
    }

    // Uppercased because of the common convention, a lot of people expect methods to be uppercase
    req.method = req.getMethod().toUpperCase();
    req.secure = Boolean(this.requestFlags?.secure);
    req.origin = req.getHeader('origin');

    const _host = req.getHeader("host"), _colon_index = _host.lastIndexOf(":");
    req.domain = _colon_index === -1? _host: _host.slice(0, _colon_index);

    if(req.domain.startsWith("www.") && backend.config.getBlock("web").get("redirect-www", Boolean, false)) {
        res.writeStatus("301 Moved Permanently");
        res.writeHeader("Location", `${req.secure ? "https" : "http"}://${req.domain.slice(4)}${req.getUrl()}`);
        res.end();
        return;
    }

    // TODO: More flexible CORS handling, though I don't know how to approach this yet, preflight requests are such a stupid idea.
    if(req.method === "OPTIONS"){
        backend.helper.corsHeaders(req, res);
        res.writeHeader("Cache-Control", "max-age=1382400");
        res.writeHeader("Access-Control-Max-Age", "1382400");
        res.end();
        return;
    }

    const url = req.getUrl();
    req.path = url.indexOf("%") === -1? url: decodeURIComponent(url);

    if(req.method !== "GET"){
        req.contentType = req.getHeader("content-type");
        req.contentLength = req.getHeader("content-length");
    }

    res.onAborted(() => {
        req.abort = true;
    });

    resolveHandler(req, res, domainRouter.match(req.domain));
}

function resolveHandler(req, res, handler) {
    if(typeof handler === "function"){
        handler(req, res);
        return;
    }

    if (typeof handler === "object") {
        if (handler instanceof Router.PathMatcher) {
            return resolveHandler(req, res, handler.match(req.path));
        }

        if(typeof handler.onRequest === "function"){
            handler.onRequest(req, res);
            return;
        } else if(handler instanceof Units.App){
            backend.webServerHandler(req, res, handler);
            return;
        }
    }

    res.writeStatus("400 Bad Request").end("400 Bad Request");
}


// Central backend object
const backend = {
    version,

    PATH,
    get path(){
        return PATH
    },

    mime: MimeTypes,

    db,
    native,

    jwt: {
        verify(something, options){
            return jwt.verify(something, JWT_KEY, options);
        },

        sign(something, options){
            return jwt.sign(something, JWT_KEY, options);
        }
    },

    bcrypt: {
        hash(something, saltRounds = 10, callback = null){
            return bcrypt.hash(something, saltRounds, callback);
        },

        compare(something, hash, callback = null){
            return bcrypt.compare(something, hash, callback);
        },
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

    broadcast(topic, data, isBinary, compress){
        if(backend.config.getBlock("server").properties.enableSSL) return SSLApp.publish(topic, data, isBinary, compress); else return app.publish(topic, data, isBinary, compress);
    },

    constants: {
        EMPTY_OBJECT, EMPTY_ARRAY, EMPTY_BUFFER, SINCE_STARTUP,
        IS_NODE_INSPECTOR_ENABLED,

        MIN_COMPRESSION_SIZE: 512,
    },

    mode: 0,

    modes: new Units.IndexedEnum([
        "PRODUCTION",
        "DEVELOPMENT",
        "TESTING",
        "MAINTENANCE"
    ]),

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

                this.defaultResolver = resolve.bind(this);

                this.ports = [];
            }

            init() {
                this.server = uws.App();
                this.server.any("/*", this.defaultResolver);

                if(this.enableWebSockets) this.server.ws("/*", backend.protocols.ws.options);
            }
        },

        // TODO: Allow multiple App/SSLApp/H3App instances, maybe through some abstract interface

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

                this.defaultResolver = resolve.bind(this);

                this.ports = [];

                this.SNINames = new Set();
            }

            onReload(){
                if(!this.server || !this.enabled) return;

                const SNIDomains = backend.config.getBlock("ssl").get("domains", Array, []);

                if(SNIDomains && SNIDomains.length > 0) for(const domain of SNIDomains) {
                    this.addSNIRoute(domain);

                    // Not sure if we should be adding a root domain handler by default.
                    if(domain.startsWith("*.")){
                        this.addSNIRoute(domain.replace("*.", ""));
                    }
                }
            }

            addSNIRoute(domain, key = null, cert = null) {
                if(this.SNINames.has(domain)) {
                    return false;
                }

                this.server.addServerName(domain, {
                    key_file_name:  key  || backend.config.getBlock("ssl").get("keyBase", String, "") .replace("{domain}", domain.replace("*.", "")),
                    cert_file_name: cert || backend.config.getBlock("ssl").get("certBase", String, "").replace("{domain}", domain.replace("*.", ""))
                })

                // TODO: Better routing options
                const route = this.server.domain(domain);

                this.SNINames.add(domain);

                route.any("/*", this.defaultResolver);

                if(this.enableWebSockets) route.ws("/*", backend.protocols.ws.options);
                return true;
            }

            init() {
                // TODO: Support passphrases

                const default_key = backend.config.getBlock("ssl").get("key", String, null);
                const default_cert = backend.config.getBlock("ssl").get("cert", String, null);

                const ssl_config = (default_key && default_cert)? {
                    key_file_name: default_key,
                    cert_file_name: default_cert
                }: null;

                // No, you can't put the ternary inside the constructor.
                this.server = ssl_config? uws.SSLApp(ssl_config): uws.SSLApp();
                this.server.any("/*", this.defaultResolver);

                // if(this.enableWebSockets) this.server.ws("/*", backend.protocols.ws.options);
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

                this.server = uws.H3App({
                    key_file_name: key,
                    cert_file_name: cert
                });

                // this.server.any("/*", this.defaultResolver);
            }
        },

        ws: new class WebSocketProtocol extends Units.Protocol {
            constructor(){
                super({
                    name: "WebSocket",
                    protocol: "ws",
                    type: "ws"
                })
            }

            init() {
                // TODO: In the future, this could be moved to the C++ side
                this.options = {
                    idleTimeout: backend.config.getBlock("websocket").get("idleTimeout", Number) || 60,
                    maxBackpressure: backend.config.getBlock("websocket").get("maxBackpressure", Number) || 1024 * 1024,
                    maxPayloadLength: backend.config.getBlock("websocket").get("maxPayloadLength", Number) || 32 * 1024,
                    compression: uws[backend.config.getBlock("websocket").get("compression", String, "DEDICATED_COMPRESSOR_32KB").toLowerCase()] || uws.DEDICATED_COMPRESSOR_32KB,
            
                    sendPingsAutomatically: true,

                    upgrade(res, req, context) {
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
            }

            enable() {
                if(!this._initialized){
                    this._initialized = true;
                    this.init();
                }
            }
        }
    },

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

        compress(buffer, format = 0){
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

    stringTemplate(strings, ...keys) {
        return strings.flatMap((str, i) =>
            [Buffer.from(str), keys[i] != null ? keys[i] : null]
        ).filter(Boolean);
    },

    /**
     * @deprecated
     */
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
        9: null,
        10: "Incorrect verification code.",
        11: "Invalid password.",
        12: "Authentication failed.",
        13: "Your login session is missing or expired.",
        14: "This account is suspended.",
        15: "Forbidden action.",
        16: "Entity not found.",
        17: "Request timed out.",
        18: "Too many requests. Try again in a few seconds.", // FIXME: Use 429
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
        30: "Invalid method.", // FIXME: Use 405
        31: "Underlying host could not be resolved.",
        32: null,
        33: "Temporarily down due to high demand. Please try again in a few moments.",
        34: null,
        35: "Unsecured access is not allowed on this endpoint. Please use HTTPS instead.",
        36: null,
        37: null,
        38: null,
        39: null,
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

    /**
     * Logs messages to the console with configured formatting and levels, using the native logger.
     *
     * @param {number} [level=2] - The log level (0: Debug, 1: Info (Verbose), 2: Info, 3: Warning, 4: Error, 5: Fatal).
     * @param {string} [source="api"] - The source of the log message.
     * @param {...any} data - The data to log. Can be a string, object, or any other type.
     *
     * @example
     * writeLog(['User created successfully'], 1, 'user-service');
     */
    // writeLog(level = 2, source = "api", ...data) {
    //     if(level < (5 - backend.logLevel)) return;
    //     return backend.native.writeLog(level, typeof source === "string" ? source : source?.name || "unknown", ...data.map(item => {
    //         if(typeof item === "string") return item;
    //         if(item instanceof Error) return item.stack || item.message;
    //         return String(item);
    //     }));
    // },

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
    },

    trustedOrigins: new Set,

    resolve,

    resolveHandler,

    domainRouter,

    uuid
}


// To be updated for multithreading
if(true) {
    // We do this here to make intellisense work at least somewhere
    Units.Manager.initCore(backend);
    
    // Do not rely on this
    global.backend = backend;
    module.exports = backend;

    backend.helper = require("./core/helpers");
    
    // Load configuration file
    backend.refreshConfig();
    
    db.storages.cache.open();
    db.storages.data.open();
    
    db.compressionCache = db.storages.cache.openDbi("compression", { keyIsUint32: true }, true);
    db.generalCache = db.storages.cache.openDbi("general", {}, true);
    db.apps = db.storages.main.openDbi("app.metadata", {}, true);
    
    Units.Manager.loadModule("./core/web");

    backend.webServerHandler = Units.Manager.module("akeno.web").onRequest;
    domainRouter.fallback = backend.webServerHandler;
    
    process.on('uncaughtException', (error) => {
        backend.fatal("[uncaught error] This might be a fatal error, in which case you may want to reload (Or you just forgot to catch it somewhere).\nMessager: ", error);
    })
    
    process.on('exit', () => {
        backend.log(`[system] Exiting Akeno`);
    })
    
    if (!JWT_KEY) {
        JWT_KEY = crypto.randomBytes(32).toString("hex");
    
        try {
            fs.appendFileSync(PATH + ".env", `\nAKENO_KEY=${JWT_KEY}\n`);
        } catch (err) {
            backend.warn("Warning: Failed to export generated JWT key to .env file.", err);
        }
    }
    
    try {
        // Disable uWebSockets version header, remove to re-enable
        uws._cfg('999999990007');
    } catch (error) {}
    
    Units.Manager.refreshAddons();
    
    if(backend.mode === backend.modes.DEVELOPMENT && IS_NODE_INSPECTOR_ENABLED) {
        console.log("%cWelcome to the Akeno debugger!", "color: #ff9959; font-size: 2rem; font-weight: bold")
        console.log("%cLook at the %c'backend'%c object to get started!", "font-size: 1.4rem", "color: aquamarine; font-size: 1.4rem", "font-size: 1.4rem")
    
        backend.exposeToDebugger("backend", backend);
        backend.exposeToDebugger("web", Units.Manager.module("akeno.web"));
    }
    
    if (process.platform !== 'linux') {
        backend.warn(`Warning: Your platform (${process.platform}) has experimental support. Akeno is currently only officially supported on Linux, so you may run into unexpected issues.${process.platform === 'win32' ? ' You can try using WSL or other types of Linux VM to run this software.' : ''}`);
    }
    
    backend.log(`Starting \x1b[35mAkeno v${version}\x1b[0m in \x1b[36m${backend.modes.get(backend.mode).toLowerCase()}\x1b[0m mode. Startup took \x1b[36m${(performance.now() - SINCE_STARTUP).toFixed(2)}ms\x1b[0m.`);
}