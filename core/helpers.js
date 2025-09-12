/**
 * Helper utilities for the Akeno backend server.
 * @module helpers
 */

const backend = require("akeno:backend");
const nodePath = require("node:path");
const fs = require("node:fs");
const Units = require("./unit");

const uws = require("uWebSockets.js");
const { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash");

let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    sharp = null;
}

/**
 * List of MIME types that should not be compressed.
 * @type {string[]}
 */
const doNotCompress = [
    'image/',
    'audio/',
    'video/',
    'application/zip',
    'application/octet-stream',
    'application/pdf'
];

const defaultCacheControl = {
    "text/html": "5",
    // "text/javascript": "31536000",
    // "text/css": "31536000",
    default: "31536000"
};

const decoder = new TextDecoder("utf-8");

// const errorTemplate = backend.stringTemplate `{"success":false,"code":${"code"},"error":${"error"}}`;

const nullStringBuffer = Buffer.from("null");


class CacheManager extends Units.Server {
    /**
     * @param {object} options
     * @param {function} [options.fileProcessor]
     * @param {function} [options.onMissing]
     * @param {object}   [options.cacheControl]
     * @param {boolean}  [options.enableCompression]
     */
    constructor({
        fileProcessor = null,
        onMissing = null,
        cacheControl = defaultCacheControl,
        enableCompression = true,
    } = {}) {
        super();

        this.cache = new Map();
        this.processor = typeof fileProcessor === 'function' ? fileProcessor : null;
        this.onMissing = typeof onMissing === 'function'
            ? onMissing
            : (req, res, key, status) => {
                // default 404 sender
                backend.helper.send(req, res, 'Not Found', {
                    'Content-Type': 'text/plain',
                    'Cache-Control': 'public, max-age=60'
                }, status || 404);
            };
        this.cacheControl = cacheControl || defaultCacheControl;
        this.enableCompression = !!enableCompression;
    }

    /**
     * Add a brand-new cache entry under `key`.
     * Throws if exists already.
     */
    async add(key, headers, cacheBreaker = null, content = null) {
        if (typeof key !== 'string' || !key) {
            throw new Error('Invalid cache entry key');
        }

        if (this.cache.has(key)) {
            throw new Error('Cache entry already exists: ' + key);
        }

        // Delegate to subclass’s `refresh` implementation
        if (typeof this.refresh !== 'function') {
            throw new Error('Subclass must implement refresh()');
        }

        return await this.refresh(key, headers, cacheBreaker, content);
    }

    /**
     * Drop an entry completely.
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * Read‐only metadata view.
     */
    getMetadata(key) {
        const file = this.cache.get(key);
        if (!file || !file[0]) return null;
        return {
            content: file[0][0],
            headers: file[0][1],
            lastChecked: file[0][2],
            lastModified: file[0][3],
            cacheBreaker: file[0][4],
            extension: file[0][5],
            mimeType: file[0][6],
            pathOrKey: file[0][7],
        };
    }

    /**
     * Mutate metadata in-place.
     */
    setMetadata(key, metadata) {
        const file = this.cache.get(key);
        if (!file) {
            throw new Error('Cache entry does not exist: ' + key);
        }

        if (metadata.content) file[0][0] = metadata.content;
        if (metadata.headers) file[0][1] = { ...file[0][1], ...metadata.headers };
        if (metadata.lastChecked) file[0][2] = metadata.lastChecked;
        if (metadata.lastModified) file[0][3] = metadata.lastModified;
        if (metadata.cacheBreaker) file[0][4] = metadata.cacheBreaker;
    }

    /**
     * The core send‐out routine:
     * - given a cached entry array `cache`,
     *   (re)compress if needed,
     *   and pipe back to client.
     */
    async serveWithoutChecking(
        req,
        res,
        cache, // the array for this entry
        status = null,
        needsUpdate = false,
        suggestedCompressionAlgorithm = null,
        options = null
    ) {
        if (!cache) {
            this.onMissing(req, res, null, status);
            return;
        }

        const mimeType = cache[0][6];
        const algo = (this.enableCompression
            && backend.compression.enabled
            && cache[0][0].length >= backend.constants.MIN_COMPRESSION_SIZE)
            ? (suggestedCompressionAlgorithm == null
                ? backend.helper.getUsedCompression(req, mimeType)
                : suggestedCompressionAlgorithm)
            : backend.compression.format.NONE;

        cache[0][8] = Date.now();

        // If it's cached compressed already and no refresh
        if (!needsUpdate && cache[algo]) {
            backend.helper.send(req, res, cache[algo][0], cache[algo][1], status);
            return;
        }

        // Recompress & send
        const [usedAlgo, buffer, headers] = backend.helper.sendCompressed(req, res, cache[0][0], mimeType, { ...cache[0][1] }, status, algo);

        // Store if new
        if (!cache[usedAlgo]) {
            cache[usedAlgo] = [buffer, headers];
        }
    }

    /**
     * Public serve() entry point.
     */
    async serve(req, res, key, status = null, options = null) {
        if (this.cacheDisabled) {
            this.onMissing(req, res, key, status);
            return;
        }

        const entry = this.cache.get(key);
        if (!entry) {
            this.onMissing(req, res, key, status);
            return;
        }

        return this.serveWithoutChecking(req, res, entry, status, false, null, options);
    }

    /**
     * Clear unused cache entries that have not been accessed for a specified time.
     * @param {number} [lastAccessed=259200000] - Time in milliseconds after which entries are considered unused. Defaults to three days.
     * @returns {void}
    */
    clearUnused(lastAccessed = 259200000) {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value[0][2] > lastAccessed) {
                this.cache.delete(key);
            }
        }
    }

    clear() {
        this.cache.clear();
    }

    /**
     * Refresh a cache entry.
     * @param {string} key - The key of the cache entry to refresh.
     * @param {object|null} headers - Optional headers to set for the cache entry.
     * @param {string|null} cacheBreaker - Optional cache breaker value.
     * @param {string|null} content - Optional new content for the cache entry.
     * @param {string|null} mimeType - Optional MIME type for the cache entry.
     * @returns {boolean} - Returns true if the entry was refreshed successfully.
     */
    refresh(key, headers = null, cacheBreaker = null, content = null, mimeType = null) {
        let entry = this.cache.get(key);
        if (!entry) {
            entry = [[]];
            this.cache.set(key, entry);
        } else {
            // Clear out any old compressed variants
            for (let i = 1; i < entry.length; i++) {
                delete entry[i];
            }
        }

        if (content) {
            entry[0][0] = content;
        }

        entry[0][1] = headers || {};

        if (mimeType) {
            if (!entry[0][1]['Cache-Control']) {
                entry[0][1]['Cache-Control'] =
                'public, max-age=' +
                (this.cacheControl[mimeType] || this.cacheControl.default);
            }
            entry[0][1]['Content-Type'] = mimeType + '; charset=utf-8';
            entry[0][1]['X-Content-Type-Options'] = 'nosniff';
            entry[0][1].Connection = 'keep-alive';
            entry[0][6] = mimeType;
        }

        if (cacheBreaker) {
            entry[0][4] = cacheBreaker;
        }

        entry[0][2] = entry[0][3] = entry[0][8] = Date.now();
        return true;
    }

    /**
     * Wire into a router as a handler.
     */
    onRequest(req, res) {
        if (this.automatic) {
            this.serve(req, res, req.path);
        } else {
            this.onMissing(req, res, null);
        }
    }
}

/**
 * FileServer
 *
 * Extends CacheManager with actual file‐system lookup,
 * path resolution, stat‐based freshness checking, and
 * “automatic” on‐demand loading.
 */
class FileServer extends CacheManager {
    /**
     * File server with cache and compression support.
     * Can be used both for manually serving files or as a complete file server.
     * @param {object} options Options for the cache mapper.
     * @param {function} [options.fileProcessor] - Function to process files before caching.
     * @param {function} [options.onMissing] - Function to call when a file is not found.
     * @param {object} [options.cacheControl] - Cache control settings.
     * @param {boolean} [options.enableCompression] - If set to true, files will be compressed when served.
     * @param {boolean} [options.automatic] - If set to true, files will be automatically read and cached based on the request URL, even if they weren't added manually.
     * @param {string} [options.root] - Root directory for the cache, appended to all paths or for automatic serving.
     * @memberof backend.helper
     * @constructor
     * 
     * File cache structure:
     * [[content, headers, lastChecked, lastModified, cacheBreaker, extension, mimeType, path], [compressedContent, compressedHeaders], ...]
     * 
     * @example
     * // You can use it as a simple static file manager:
     * const static = new backend.helper.FileServer();
     * static.add('/path/to/file.txt');
     * ...
     * static.serve(req, res, '/path/to/file.txt');
     * @example
     * // It can also be used as a full standalone file server:
     * backend.domainRouter.add("mycoolwebsite.com", new backend.helper.FileServer({ root: "/my_cool_website/", automatic: true }));
     * // mycoolwebsite.com now serves files from /my_cool_website/, with caching and compression.
     */
    constructor({
        fileProcessor,
        onMissing,
        cacheControl,
        enableCompression = true,
        automatic = false,
        root = ''
    } = {}) {
        super({ fileProcessor, onMissing, cacheControl, enableCompression });
        this.automatic = !!automatic;
        this.root = root;
    }

    /**
     * Turn a user‐supplied path into an absolute file‐system path.
     */
    resolvePath(path) {
        if (this.root) {
            // make sure leading slash is honored
            return nodePath.join(
                this.root,
                nodePath.resolve(nodePath.sep, path || nodePath.sep)
            );
        }
        return nodePath.normalize(path);
    }

    /**
     * Check if more than a threshold has elapsed or mtime increased.
     */
    needsUpdate(resolvedPath, fileEntry) {
        const now = Date.now();
        const minCheckInterval = backend.mode === backend.modes.DEVELOPMENT ? 1000 : 30000;
        if (now - fileEntry[0][2] < minCheckInterval) {
            return false;
        }

        try {
            const stats = fs.statSync(resolvedPath);
            if ((stats.mtimeMs > fileEntry[0][3])
                || (typeof fileEntry[0][4] === 'function'
                    && fileEntry[0][4](resolvedPath) === true)) {
                fileEntry[0][2] = now;
                fileEntry[0][3] = stats.mtimeMs;
                return true;
            }
        } catch (err) {
            console.error('Error checking file update:', err);
            return true;
        }
        return false;
    }

    /**
     * (Re)load a file from disk into the cache under `key===resolvedPath`.
     * This is where we do fs.existsSync, fs.readFile, statSync, etc.
     */
    async refresh(rawPath, headers = null, cacheBreaker = null, content = null) {
        const resolved = this.resolvePath(rawPath);
        if (!fs.existsSync(resolved)) {
            this.cache.delete(resolved);
            return false;
        }

        let file = this.cache.get(resolved);
        if (!file) {
            file = [[]];
            this.cache.set(resolved, file);
        } else {
            // Clear out any old compressed variants
            for (let i = 1; i < file.length; i++) {
                delete file[i];
            }
        }

        // figure extension/mime
        const ext = nodePath.extname(resolved).slice(1).toLowerCase();
        const mimeType = backend.mime.getType(ext) || 'application/octet-stream';

        // read or delegate to processor
        if (content == null) {
            content = this.processor
                ? await this.processor(resolved)
                : await fs.promises.readFile(
                    resolved,
                    (ext === 'js' || ext === 'css') ? 'utf8' : null
                );
        }

        const stats = fs.statSync(resolved);

        // store core
        file[0][0] = content;
        file[0][1] = headers || {};
        file[0][1].ETag = `"${stats.mtimeMs.toString(36)}"`;
        if (!file[0][1]['Cache-Control']) {
            file[0][1]['Cache-Control'] =
                'public, max-age=' +
                (this.cacheControl[mimeType] || this.cacheControl.default);
        }
        file[0][1]['Content-Type'] = mimeType + '; charset=utf-8';
        file[0][1]['X-Content-Type-Options'] = 'nosniff';
        file[0][1].Connection = 'keep-alive';

        const now = Date.now();
        file[0][2] = now;            // lastChecked
        file[0][3] = stats.mtimeMs;  // lastModified
        if (typeof cacheBreaker === 'function') {
            file[0][4] = cacheBreaker;
        }
        file[0][5] = ext;            // extension
        file[0][6] = mimeType;       // mimeType
        file[0][7] = resolved;       // store the actual key
        file[0][8] = now;            // lastAccessed
        return true;
    }

    /**
     * Add a file to cache by pathname.
     * (resolves via this.resolvePath before delegating)
     */
    async add(path, headers, cacheBreaker = null, content = null) {
        const rp = this.resolvePath(path);
        if (this.cache.has(rp)) {
            throw new Error('Cache entry already exists: ' + rp);
        }
        return await this.refresh(path, headers, cacheBreaker, content);
    }

    /**
     * Override delete to RESOLVE first.
     */
    delete(path) {
        const rp = this.resolvePath(path);
        super.delete(rp);
    }

    /**
     * Override setMetadata to resolve the path first
     */
    setMetadata(path, metadata) {
        const rp = this.resolvePath(path);
        super.setMetadata(rp, metadata);
    }

    /**
     * Public serve() entry point.
     * - resolves path
     * - optionally auto‐loads if missing
     * - checks freshness
     * - delegates to serveWithoutChecking
     */
    async serve(req, res, path = req.path, status = null, options = null) {
        const rp = this.resolvePath(path);
        let entry = this.cacheDisabled ? null : this.cache.get(rp);
        let suggestedAlg = null;

        if (!entry) {
            if (!this.automatic) {
                this.onMissing(req, res, rp, status);
                return;
            }
            // figure compression hint
            const ext = nodePath.extname(rp).slice(1);
            const mime = backend.mime.getType(ext);
            suggestedAlg =
                backend.helper.getUsedCompression(req, mime);

            // attempt to load now
            const ok = await this.refresh(rp, null, null, null);
            if (!ok) {
                this.onMissing(req, res, rp, status);
                return;
            }
            entry = this.cache.get(rp);
        }

        const needsUpd = this.needsUpdate(rp, entry);
        return this.serveWithoutChecking(req, res, entry, status, needsUpd, suggestedAlg, options);
    }
}


module.exports = {
    /**
     * Returns the path segments of the request.
     * @param {object} req - The request object.
     * @returns {string[]} An array of path segments.
     */
    getPathSegments(req){
        if(!req.pathSegments) {
            req.pathSegments = [];
            
            // A slightly faster implementation compared to .split("/").filter(Boolean)
            if(req.path !== "/"){
                let segStart = 1;
                for(let i = 1; i <= req.path.length; i++){
                    if(req.path.charCodeAt(i) === 47 || i === req.path.length) {
                        if(i > segStart) req.pathSegments.push(req.path.slice(segStart, i));
                        segStart = i + 1;
                    }
                }
            }
        }

        return req.pathSegments;
    },

    /**
     * Writes headers to the response object.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {object} headers - Key-value pairs of headers to write.
     * @returns {object} The backend helper object.
     */
    writeHeaders(req, res, headers){
        if(headers) {
            res.cork(() => {
                for(let header in headers){
                    if(!headers[header]) return;
                    res.writeHeader(header, headers[header])
                }
            });
        }

        return backend.helper;
    },

    /**
     * Writes CORS headers to the response.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {boolean} [credentials=false] - Whether to allow credentials.
     * 
     * @returns {object} The backend helper object.
     */
    corsHeaders(req, res, credentials = false, hasCors = false) {
        // TODO: Better and more flexible CORS handling.
        // const trusted = backend.trustedOrigins.has(req.origin);

        res.cork(() => {
            res.writeHeader('X-Powered-By', 'Akeno Server/' + backend.version);

            if(!hasCors) {
                if(credentials){
                    if(!backend.trustedOrigins.has(req.origin)) {
                        throw new Error(`Can't allow credentials for ${req.origin} because it is not on the trusted list`);
                    }
    
                    res.writeHeader("Access-Control-Allow-Credentials", "true");
                    res.writeHeader("Access-Control-Allow-Origin", req.origin);
                    res.writeHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Credentials,Data-Auth-Identifier");
                } else {
                    res.writeHeader('Access-Control-Allow-Origin', '*');
                    res.writeHeader("Access-Control-Allow-Headers", "Authorization,*");
                }

                res.writeHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
            }

            if(backend.protocols.h3.enabled){
                res.writeHeader("alt-svc", `h3=":${backend.protocols.h3.ports[0]}"; ma=86400`);
            }
        });

        return backend.helper;
    },


    /**
     * Sends a response with optional headers and status.
     * Automatically stringifies objects/arrays as JSON.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {*} data - The data to send.
     * @param {object} [headers={}] - Optional headers.
     * @param {string} [status] - Optional HTTP status.
     */
    send(req, res, data, headers = {}, status){
        if(req.abort) return;

        if(data !== undefined && (typeof data !== "string" && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array) && !(data instanceof Buffer)) || Array.isArray(data)) {
            if(headers && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
            data = JSON.stringify(data);
        }

        res.cork(() => {
            res.writeStatus(String(status || "200 OK"));

            if(req.begin) {
                res.writeHeader("server-timing", `generation;dur=${performance.now() - req.begin}`);
            }

            backend.helper.corsHeaders(req, res, null, headers && headers.hasOwnProperty("Access-Control-Allow-Origin")).writeHeaders(req, res, headers);
            if(data !== undefined) res.end(data);
        });
    },


    getUsedCompression(acceptEncoding, mimeType){
        if(!backend.compression.enabled) return backend.compression.format.NONE;

        if(mimeType && doNotCompress.some(type => mimeType.startsWith(type))) {
            return backend.compression.format.NONE;
        }

        const enc = typeof acceptEncoding === "string"? acceptEncoding: acceptEncoding.getHeader("accept-encoding");

        if(!enc) {
            return backend.compression.format.NONE;
        }

        if(enc.includes("br")) {
            return backend.compression.format.BROTLI;
        } else if(enc.includes("gzip")) {
            return backend.compression.format.GZIP;
        } else if(enc.includes("deflate")) {
            return backend.compression.format.DEFLATE;
        }

        return backend.compression.format.NONE;
    },


    /**
     * Sends a compressed response if possible.
     * Accepts a Buffer. If you provide a string, code compression will be peformed for supported types, othwerwise throws an error.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {Buffer|string} buffer - The data buffer to send.
     * @param {string} mimeType - The MIME type of the data.
     * @param {object} [headers={}] - Optional headers.
     * @param {string} [status] - Optional HTTP status.
     * @param {string} [compressionAlgorithm] - Optional compression algorithm.
     * @throws {Error} If buffer is not a Buffer instance.
     * @returns {Array} A tuple containing a cache key and the result buffer.
     */
    sendCompressed(req, res, buffer, mimeType, headers = {}, status, compressionAlgorithm){
        if(req.abort) return;

        if(!headers["Content-Type"]) headers["Content-Type"] = mimeType;

        // Perform code compression
        if(typeof buffer === "string") switch(mimeType){
            case "text/javascript": case "application/javascript":
                buffer = backend.compression.code(buffer, backend.compression.format.JS);
                break;
            
            case "text/css":
                buffer = backend.compression.code(buffer, backend.compression.format.CSS);
                break;

            case "application/json": case "text/json":
                buffer = backend.compression.code(buffer, backend.compression.format.JSON);
                break;

            default:
                throw new Error("Unsupported MIME type for code compression: " + mimeType + ". If you didn't mean to use code compression, provide a Buffer instead.");
        }

        // Check if the buffer is a Buffer instance
        if(!(buffer instanceof Buffer)) {
            throw new Error("sendCompressed must be called with a Buffer, received: " + Object.prototype.toString.call(buffer));
        }

        const algorithm = buffer.length < backend.constants.MIN_COMPRESSION_SIZE? null: compressionAlgorithm || backend.helper.getUsedCompression(req, mimeType);

        // If no compression is needed, send the buffer as is
        if(algorithm === backend.compression.format.NONE || algorithm === null) {
            backend.helper.send(req, res, buffer, headers, status);
            return [backend.compression.format.NONE, buffer, headers];
        }

        buffer = backend.compression.compress(buffer, algorithm);
        headers["Content-Encoding"] = {
            [backend.compression.format.BROTLI]: "br",
            [backend.compression.format.GZIP]: "gzip",
            [backend.compression.format.DEFLATE]: "deflate"
        }[algorithm];

        backend.helper.send(req, res, buffer, headers, status);
        return [algorithm, buffer, headers];
    },

    
    /**
     * Send a templated response.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {Array} template - The template.
     * @experimental
     */
    sendTemplate(req, res, template, data){
        _isJSON = false; // Reserved for later

        // const result = [];

        res.cork(() => {
            if(template && template.length > 0) {
                for(const part of template) {
                    if(part === null || part === undefined) continue;

                    if(typeof part === "string") {
                        if(!data || !data.hasOwnProperty(part)) {
                            if(_isJSON) {
                                res.write(nullStringBuffer);
                                // result.push(nullStringBuffer);
                            }
                            continue;
                        }

                        let value = data[part];

                        if(!(value instanceof Buffer) && typeof value !== "string") {
                            value = _isJSON? JSON.stringify(value): String(value);
                        }

                        res.write(value);
                        // result.push(Buffer.from(value));
                    } else if(part instanceof Buffer) {
                        res.write(part);
                        // result.push(part);
                    }
                }
            }

            res.end();
            // res.end(result.length === 0? nullStringBuffer : Buffer.concat(result));
        });
    },


    /**
     * Returns the next path segment from the request.
     * @param {object} req - The request object.
     * @returns {string} The next path segment or empty string.
     * @deprecated
     */
    nextSegment(req){
        if(!req.pathSegments) {
            req.pathSegments = backend.helper.getPathSegments(req);
        }

        if(!req.pathIndex) req.pathIndex = 0; else req.pathIndex ++;
        return req.pathSegments[req.pathIndex] || null;
    },


    /**
     * Sends an error response.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {string|number} error - The error message or code.
     * @param {number} [code] - Optional error code.
     * @param {string} [status] - Optional HTTP status.
     */
    error(req, res, error, code, status){
        if(req.abort) return;
        
        if(!code && code !== 0 && typeof error === "number" && backend.Errors[error]) {
            code = error;
            error = backend.Errors[code];
        }

        res.cork(() => {
            res.writeStatus(status || (code >= 400 && code <= 599 ? String(code) : '400'));

            backend.helper.corsHeaders(req, res);

            res.writeHeader("content-type", "application/json").end(`{"success":false,"code":${code || -1},"error":${(JSON.stringify(error) || '"Unknown error"')}}`);
        });
    },


    /**
     * Streams data from a readable stream to the response.
     * Handles backpressure and client aborts.
     * @param {object} req - The request object.
     * @param {object} res - The response object.
     * @param {ReadableStream} stream - The stream to pipe.
     * @param {number} totalSize - The total size of the stream.
     */
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

    cacheControl: defaultCacheControl,

    CacheManager,
    FileServer,

    /**
     * Parses the request body, optionally as a stream.
     * @class
     */
    bodyParser: class {
        constructor(req, res, callback, options = {}){
            this.req = req;
            this.res = res;

            this.type = req.contentType;
            this.length = req.contentLength || 0;

            // Old behavior
            if(options === true) {
                options = { stream: true };
            }

            this.options = options;

            if(!backend.helper.bodyParser.hasBody(req)){
                req.hasBody = false;
                if(options.stream) {
                    callback(null, true);
                } else {
                    callback(this);
                }
                return
            }

            if (!options.stream) {
                let chunks = [];
                let totalLength = 0;
                let aborted = false;

                res.onData((chunk, isLast) => {
                    if (aborted) return;

                    const buffer = Buffer.from(chunk.slice(chunk.byteOffset || 0, (chunk.byteOffset || 0) + chunk.byteLength));
                    chunks.push(buffer);
                    totalLength += buffer.length || 0;

                    if(totalLength > (options.maxSize || backend.constants.MAX_BODY_SIZE)) {
                        // Handle max body size exceeded
                        if(options.waitOnError) {
                            // Wait until the full body is received before responding (wastes CPU and bandwidth, but sends a proper error)
                            this.res.writeStatus('413 Payload Too Large').end();
                        } else {
                            // Forcefully close the connection to stop uploading (better, but user won't get an error message)
                            this.res.close();
                        }
                        chunks = null;
                        aborted = true;
                        return;
                    }

                    if (isLast) {
                        req.fullBody = Buffer.concat(chunks, totalLength);
                        chunks = null;
                        callback(this);
                    }
                });
            } else {
                res.onData(callback);
            }
        }

        upload(hash = null, compressImages = false){
            let parts = this.parts();

            if(compressImages) {
                return this.processFilesAndCompressImages(parts, hash);
            }

            return this.processFiles(parts, hash);
        }

        processFiles(files, hash = false){
            for(let part of files){
                if (!(part.data instanceof Buffer)) part.data = Buffer.from(part.data);

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

        async processFilesAndCompressImages(files, hash = false){
            for(let part of files){
                if (!(part.data instanceof Buffer)) part.data = Buffer.from(part.data);

                if(part.data.length > 0 && part.type && part.type.startsWith("image/") && sharp) {
                    try {
                        part.data = await sharp(part.data).webp({
                            quality: 80,
                            lossless: false
                        }).toBuffer();

                        part.type = "image/webp";
                        part.filename = part.filename.replace(/\.[^.]+$/, '.webp');
                    } catch (e) {
                        console.error("Error compressing image:", e);
                    }
                }

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

        free(){
            this.req.fullBody = null;
        }

        static hasBody(req){
            return req.contentLength > 0 || req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || (req.hasBody && req.transferProtocol === "qblaze")
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
    },

    /**
     * Basic rate limiter.
     */
    RateLimiter: class {
        constructor(limit, interval = 60000) {
            this.limit = limit;
            this.interval = interval;
            this.requests = new Map();
        }

        /**
         * Checks if the request exceeds the rate limit.
         * @param {object} req - The request object.
         * @param {object} res - The response object.
         * @returns {boolean} True if the request is allowed, false if it exceeds the rate limit.
         */
        check(req, res) {
            const now = Date.now();
            const key = backend.helper.getRequestIP(res) || req.getHeader("x-forwarded-for") || "anonymous";

            if (!this.requests.has(key)) {
                this.requests.set(key, []);
            }

            const timestamps = this.requests.get(key);
            timestamps.push(now);

            // Remove timestamps older than the interval
            while (timestamps.length > 0 && timestamps[0] < now - this.interval) {
                timestamps.shift();
            }

            if (timestamps.length > this.limit) {               
                return false;
            }

            return true;
        }

        /**
         * Checks if the request exceeds the rate limit.
         * If it does, sends a 429 response.
         * @param {object} req - The request object.
         * @param {object} res - The response object.
         * @returns {boolean} True if the request is allowed, false if it exceeds the rate limit.
         * 
         * @example
         * // Usage in a route handler:
         * if (!rateLimiter.pass(req, res)) {
         *     return;
         * }
         */
        pass(req, res) {
            if (this.check(req, res)) {
                return true;
            }

            res.cork(() => {
                res.writeStatus("429").end('Rate limit exceeded');
            });
            return false;
        }

        /**
         * Resets the request count for a specific key or all keys.
         * @param {string} [key] - The key to reset. If not provided, resets all keys.
         */
        reset(key) {
            if(!key) {
                this.requests.clear();
                return;
            }

            this.requests.delete(key);
        }

        /**
         * Returns the number of requests made by a specific key.
         * @param {string} key - The key to check.
         * @returns {number} The number of requests made by the key.
         */
        getRequestCount(key) {
            return this.requests.has(key) ? this.requests.get(key).length : 0;
        }
    },

    /**
     * Returns the request IP address.
     * @param {object} res - The response (yes, not request) object.
     * @returns {string} The request IP address.
     */
    getRequestIP(res) {
        return decoder.decode(res.getRemoteAddressAsText());
    }
}