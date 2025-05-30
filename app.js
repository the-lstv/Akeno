/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    See: https://github.com/the-lstv/akeno
*/


const Units = require("./core/unit");


// Global variables
let
    version = new Units.Version("1.6.0-beta")
;


// Modules
const
    // - Basic modules
    fs = require("node:fs"),                              // File system
    uws = require('uWebSockets.js'),                      // uWebSockets
    uuid = (require("uuid")).v4,                          // UUIDv4
    fastJson = require("fast-json-stringify"),            // Fast JSON serializer
    { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash"),  // XXHash
    MimeTypes = require("./core/mime"),                   // MIME types
    
    // - Authentication and security
    bcrypt = require("bcrypt"),                           // Secure hashing
    crypto = require('crypto'),                           // Cryptographic utilities
    jwt = require('jsonwebtoken'),                        // Web tokens

    // Compression
    zlib = require("node:zlib"),                          // Gzip compression
    CleanCSS = new (require('clean-css')),                // CSS minifier
    UglifyJS = require("uglify-js"),                      // JS minifier

    // - Database
    KeyStorage = require("./core/kvdb"),                  // Key-value database (WARNING: will soon be deprecated)

    // Local modules
    { ipc_server } = require("./core/ipc"),               // IPC server
    { parse, configTools } = require("./core/parser")     // Parser
;


// Module aliases
require('module-alias/register');


// Misc constants
const PATH = __dirname + "/";
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_BUFFER = Buffer.alloc(0);
const SINCE_STARTUP = performance.now();

const IS_NODE_INSPECTOR_ENABLED = !!process.execArgv.find(arg => arg.startsWith("--inspect"));
const JWT_KEY = process.env.AKENO_KEY;


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

    req.method = req.getMethod().toUpperCase();

    const _host = req.getHeader("host"), _colon_index = _host.lastIndexOf(":");
    req.domain = _colon_index === -1? _host: _host.slice(0, _colon_index);

    try {
        req.path = decodeURIComponent(req.getUrl());
    } catch (e) {
        req.path = req.getUrl();
        backend.warn("Failed to decode URL:", req.path)
    }

    req.secure = Boolean(this.requestFlags?.secure);
    req.origin = req.getHeader('origin');

    if(req.method === "OPTIONS"){
        backend.helper.corsHeaders(req, res)
        res.writeHeader("Cache-Control", "max-age=1382400");
        res.writeHeader("Access-Control-Max-Age", "1382400");
        res.end();
        return
    }

    const timeout = setTimeout(() => {
        try {
            if(req.abort) return;

            if(res && !res.sent && !res.wait) res.writeStatus("408 Request Timeout").tryEnd();
        } catch {}
    }, res.timeout || 15000)

    res.onAborted(() => {
        clearTimeout(timeout)
        req.abort = true;
    })


    // Finally, lets route the request to find a handler.

    // A slightly faster implementation compared to .split("/").filter(Boolean)
    req.pathSegments = [];
    let segStart = 1;
    for(let i = 1; i <= req.path.length; i++){
        if(req.path.charCodeAt(i) === 47 || i === req.path.length) {
            if(i > segStart) req.pathSegments.push(req.path.slice(segStart, i));
            segStart = i + 1;
        }
    }

    let handler = backend.defaultHTTPHandler;

    // TODO: FIXME: Temporary CDN handler, replace with a proper modular router asap

    if(req.domain.startsWith("cdn.")){
        handler = Units.Manager.module("akeno.cdn").HandleRequest;
    }

    // TODO: Move API handlers to a separate module
    // if(handler === 2){
    //     const versionCode = req.pathSegments.shift();
    //     const firstChar = versionCode && versionCode.charCodeAt(0);

    //     if(!firstChar || (firstChar !== 118 && firstChar !== 86)) return backend.helper.error(req, res, 0);
        
    //     const api = API.handlers.get(parseInt(versionCode.slice(1), 10));
    //     handler = api && api.HandleRequest;

    //     if(!handler) return backend.helper.error(req, res, 0);
    // }

    if(typeof handler !== "function"){
        return req.writeStatus("400 Bad Request").end("400 Bad Request")
    }

    handler({
        req,
        res,
        flags: this.requestFlags,

        segments: req.pathSegments,

        // /** @deprecated */
        // shift: () => backend.helper.next(req),

        // /** @deprecated */
        // error: (error, code, status) => backend.helper.error(req, res, error, code, status)
    })
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

    jwt: {
        verify(something, options){
            return jwt.verify(something, JWT_KEY, options)
        },

        sign(something, options){
            return jwt.sign(something, JWT_KEY, options)
        }
    },

    refreshConfig(){
        if(backend.config) backend.log("Refreshing configuration");

        if(!fs.existsSync(PATH + "/config")){
            backend.log("No main config file found in /config, creating a default config file.")
            fs.writeFileSync(PATH + "/config", fs.readFileSync(PATH + "/etc/default-config", "utf8"))
        }

        let path = PATH + "/config";

        backend.configRaw = parse(fs.readFileSync(path, "utf8"), {
            strict: true,
            asLookupTable: true
        });

        backend.config = configTools(backend.configRaw);

        backend.mode = backend.modes[backend.config.getBlock("system").get("mode", String, "production").toUpperCase()] || backend.modes.PRODUCTION;
        backend.logLevel = backend.config.getBlock("system").get("logLevel", Number) || backend.mode === backend.modes.DEVELOPMENT? 5 : 3;

        // Enable/disable protocols
        const protocols = backend.config.getBlock("protocols");

        backend.protocols.ipc.socketPath = (protocols.getBlock("ipc").get("socket_path", String)) || '/tmp/akeno.backend.sock';
        if(process.platform === 'win32'){
            const pipeName = (protocols.getBlock("ipc").get("windowsPipeName", String)) || 'akeno.backend.sock';
            if (/[/\\]/.test(pipeName)) throw new Error('protocols.ipc.windowsPipeName should not contain slashes - make sure you are not adding a full path.');
            backend.protocols.ipc.socketPath = `\\\\.\\pipe\\${pipeName}`;
        }
        backend.protocols.ipc.enabled = protocols.getBlock("ipc").get("enabled", Boolean, true);

        backend.protocols.http.port = protocols.getBlock("http").get("port", Number, 80);
        backend.protocols.http.enabled = protocols.getBlock("http").get("enabled", Boolean, true);

        backend.protocols.https.port = protocols.getBlock("https").get("port", Number, 443);
        backend.protocols.https.enabled = protocols.getBlock("https").get("enabled", Boolean, false);

        backend.protocols.h3.port = protocols.getBlock("h3").get("port", Number, 443);
        backend.protocols.h3.enabled = protocols.getBlock("h3").get("enabled", Boolean, false);

        // TODO: Add something like "in production only".
        backend.compression.enabled = backend.config.getBlock("web").get("compress", Boolean, true);
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

    /**
     * Logs messages to the console with different log levels, colors, and sources.
     *
     * @param {string|any[]} data - The log message(s) as a string or an array of values to output.
     * @param {number} [level=2] - The log level (0: Debug, 1: Info (Verbose), 2: Info, 3: Warning, 4: Error, 5: Fatal).
     * @param {string} [source="api"] - The source of the log message.
     *
     * @example
     * writeLog(['User created successfully'], 1, 'user-service');
     */
    writeLog(data, level = 2, source = "api"){
        if(level < (5 - backend.logLevel)) return;

        const color = level >= 4 ? "1;31" : level === 3 ? "1;33" : "36";
        const consoleFunction = console[level === 4 ? "error" : level === 3 ? "warn" : level < 2 ? "debug" : "log"];
        const sourceName = typeof source === "string" ? source : source?.name || "unknown";

        const signature = `${level > 4? "* ": ""}\x1b[${color}m[${sourceName}]\x1b[${level > 4? "0;1": "0"}m`;

        if(!Array.isArray(data)){
            consoleFunction(signature, data);
        } else {
            consoleFunction(signature, ...data);
        }
    },

    constants: {
        EMPTY_OBJECT, EMPTY_ARRAY, EMPTY_BUFFER, SINCE_STARTUP,
        IS_NODE_INSPECTOR_ENABLED,

        MIN_COMPRESSION_SIZE: 1024,
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
                this.server = new ipc_server({
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
                                    mode: backend.modes.get(backend.mode),
                                })
                                break

                            case "usage":
                                const res = {
                                    mem: process.memoryUsage(),
                                    cpu: process.cpuUsage(),
                                    uptime: process.uptime(),
                                    backend_path: PATH,
                                    mode: backend.modes.get(backend.mode),
                                    version,
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
            }

            enable() {
                if(!this._initialized){
                    this._initialized = true;
                    this.init();
                }

                this.server.listen(this.socketPath, () => {
                    this.log(`IPC socket is listening on ${this.socketPath}`)
                })
            }

            disable() {
                this.server.close(() => {
                    this.log(`IPC socket was closed`)
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
            }

            init() {
                this.server = uws.App();
                this.server.any("/*", resolve.bind(this));
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
            }

            init() {
                this.server = uws.SSLApp();
                this.server.any("/*", resolve.bind(this));
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

        // If to enable compression, overriden by the config - actual code may not, but should respect this.
        enabled: true,

        format: new Units.IndexedEnum([
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

            // const hash = xxh32(buffer);

            switch (format) {
                case backend.compression.format.GZIP:
                    return zlib.gzipSync(buffer, { level: 6 });

                case backend.compression.format.DEFLATE:
                    return zlib.deflateSync(buffer, { level: 6 });

                case backend.compression.format.BROTLI:
                    return zlib.brotliCompressSync(buffer, {
                        params: {
                            [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
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

            if(!data || !data.length) return Buffer.from(data);

            if(typeof format !== "number") {
                throw new Error(`Invalid compression format: ${format}`);
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
                        compressed = UglifyJS.minify(data).code;
                        break;

                    case backend.compression.format.CSS:
                        compressed = CleanCSS.minify(data).styles;
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

    trustedOrigins: new Set,

    resolve
}

// We do this here to make code completions work in VSCode
Units.Manager.initCore(backend);

// Do not rely on this
global.backend = backend;

module.exports = backend;

backend.helper = require("./core/helpers");




// First initialization

// Load configuration file
backend.refreshConfig();

db.storages.cache.open();
db.storages.data.open();

db.compressionCache = db.storages.cache.openDbi("compression", { keyIsUint32: true }, true);
db.generalCache = db.storages.cache.openDbi("general", {}, true);
db.apps = db.storages.main.openDbi("app.metadata", {}, true);


Units.Manager.loadModule("./core/web");

backend.defaultHTTPHandler = Units.Manager.module("akeno.web").HandleRequest;

process.on('uncaughtException', (error) => {
    backend.fatal("[uncaught error] This might be a fatal error, in which case you may want to reload (Or you just forgot to catch it somewhere).\nMessager: ", error);
})

process.on('exit', () => {
    console.log(`[system] API is stopping.`);
})

backend.log(`Starting \x1b[35mAkeno v${version}\x1b[0m in \x1b[36m${backend.modes.get(backend.mode).toLowerCase()}\x1b[0m mode. Startup took \x1b[36m${(performance.now() - SINCE_STARTUP).toFixed(2)}ms\x1b[0m.`);

if (!JWT_KEY) {
    JWT_KEY = crypto.randomBytes(32).toString("hex");
    try {
        fs.appendFileSync(PATH + ".env", `\nAKENO_KEY=${JWT_KEY}\n`);
    } catch (err) {
        console.warn("Warning: Failed to export generated JWT key to .env file.", err);
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

    backend.exposeToDebugger("backend", backend)
    backend.exposeToDebugger("addons", AddonCache)
    backend.exposeToDebugger("api", API)
}

if (process.platform !== 'linux') {
    backend.warn(`Warning: Your platform (${process.platform}) has experimental support. Akeno is currently only officially supported on Linux, so you may run into unexpected issues.${process.platform === 'win32' ? ' You can try using WSL or other types of Linux VM to run this software.' : ''}`);
}