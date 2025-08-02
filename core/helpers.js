/**
 * Helper utilities for the Akeno backend server.
 * @module helpers
 */

const backend = require("akeno:backend");
const nodePath = require("node:path");
const fs = require("node:fs");

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

const cacheControl = {
    html: "5",
    js: "604800",
    css: "604800",
    default: "50000"
};

const decoder = new TextDecoder("utf-8");

// const errorTemplate = backend.stringTemplate `{"success":false,"code":${"code"},"error":${"error"}}`;

const nullStringBuffer = Buffer.from("null");

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
            if(!headers["Content-Type"]) headers["Content-Type"] = "application/json";
            data = JSON.stringify(data);
        }

        res.cork(() => {
            res.writeStatus(status || "200 OK");

            if(req.begin) {
                res.writeHeader("server-timing", `generation;dur=${performance.now() - req.begin}`);
            }

            backend.helper.corsHeaders(req, res, null, headers.hasOwnProperty("Access-Control-Allow-Origin")).writeHeaders(req, res, headers);
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

    cacheControl,

    FileServer: class {
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
        constructor({ fileProcessor, onMissing, cacheControl: _cacheControl, root, automatic = false, enableCompression = true } = {}) {
            this.cache = new Map();
            this.processor = typeof fileProcessor === "function"? fileProcessor: null;

            this.onMissing = typeof onMissing === "function"? onMissing: (req, res, path, status) => {
                backend.helper.send(req, res, "Not Found", {
                    "Content-Type": "text/plain",
                    "Cache-Control": "public, max-age=60"
                }, status || "404");
            };

            this.cacheControl = _cacheControl || cacheControl;
            this.root = root || "";

            this.automatic = !!automatic;
            this.enableCompression = !!enableCompression;
        }
    
        async add(path, headers, cacheBreaker = null, content = null) {
            path = this.resolvePath(path);

            if (typeof path !== 'string' || !path) {
                throw new Error('Invalid cache entry');
            }
    
            if (this.cache.has(path)) {
                throw new Error('Cache entry already exists');
            }
    
            if (!fs.existsSync(path)) {
                throw new Error('File does not exist: ' + path);
            }
    
            return await this.refresh(path, headers, cacheBreaker, content, false);
        }

        needsUpdate(path, file) {
            const now = Date.now();
            if(now - file[0][2] < (backend.mode === backend.modes.DEVELOPMENT ? 1000 : 60000)) {
                return false;
            }

            try {
                const stats = fs.statSync(path);

                if((stats.mtimeMs > file[0][3]) || (typeof file[0][4] === "function" && file[0][4](path) === true)) {
                    file[0][2] = now;
                    file[0][3] = stats.mtimeMs;
                    return true;
                }
            } catch (error) {
                console.error("Error checking file update:", error);
                return true;
            }

            return false;
        }

        resolvePath(path) {
            if (this.root) {
                return nodePath.join(this.root, nodePath.resolve(nodePath.sep, path || nodePath.sep));
            }

            return nodePath.normalize(path);
        }
    
        async refresh(path, headers = null, cacheBreaker = null, content = null, _resolvePath = true) {
            if(_resolvePath) path = this.resolvePath(path);

            if(!fs.existsSync(path)) {
                this.cache.delete(path);
                return false;
            }

            let file = this.cache.get(path);
            if (!file) {
                file = [[]];
                this.cache.set(path, file);
            }

            const extension = file[0][5] || nodePath.extname(path).slice(1).toLowerCase();
            const mimeType  = file[0][6] || backend.mime.getType(extension) || "application/octet-stream";

            content = content || (this.processor? await this.processor(path): await fs.promises.readFile(path, (extension === "js" || extension === "css") ? "utf8" : null));

            if (file.length > 1) {
                for (let i = 1; i < file.length; i++) {
                    delete file[i];
                }
            }

            const stats = fs.statSync(path);
            file[0][0] = content;

            file[0][1] = headers || {};
            file[0][1]["ETag"] = `"${stats.mtimeMs.toString(36)}"`;
            if(!file[0][1]["Cache-Control"]) file[0][1]["Cache-Control"] = "public, max-age=" + (this.cacheControl[extension] || this.cacheControl.default);
            file[0][1]["Content-Type"] = mimeType + "; charset=utf-8";
            file[0][1]["X-Content-Type-Options"] = "nosniff";
            file[0][1]["Connection"] = "keep-alive";

            file[0][2] = Date.now();
            file[0][3] = stats.mtimeMs;
            if (typeof cacheBreaker === "function") file[0][4] = cacheBreaker;
            if (!file[0][5]) file[0][5] = extension;
            if (!file[0][6]) file[0][6] = mimeType;
            file[0][7] = path;
            return true;
        }

        getMetadata(path) {
            const file = this.cache.get(path);
            if (!file || file.length === 0) {
                return null;
            }

            return {
                content: file[0][0],
                headers: file[0][1],
                lastUpdated: file[0][2],
                lastModified: file[0][3],
                cacheBreaker: file[0][4],
                extension: file[0][5],
                mimeType: file[0][6],
                path: file[0][7]
            };
        }

        setMetadata(path, metadata) {
            path = this.resolvePath(path);

            const file = this.cache.get(path);
            if (!file) {
                throw new Error('Cache entry does not exist: ' + path);
            }

            if (metadata.content) file[0][0] = metadata.content;
            if (metadata.headers) file[0][1] = { ...file[0][1], ...metadata.headers };
            if (metadata.lastChecked) file[0][2] = metadata.lastChecked;
            if (metadata.lastModified) file[0][3] = metadata.lastModified;
            if (metadata.cacheBreaker) file[0][4] = metadata.cacheBreaker;

            if (metadata.extension) {
                file[0][5] = metadata.extension;
                file[0][6] = backend.mime.getType(metadata.extension);
                file[0][1]["Content-Type"] = file[0][6];
            } else if (metadata.mimeType) {
                file[0][5] = backend.mime.getExtension(metadata.mimeType)[0];
                file[0][6] = metadata.mimeType;
                file[0][1]["Content-Type"] = metadata.mimeType;
            }
        }

        delete(path) {
            path = this.resolvePath(path);
            if (this.cache.has(path)) {
                this.cache.delete(path);
            }
        }

        /**
         * Serves a cached file or processes it if not cached.
         * @param {object} req - The request object.
         * @param {object} res - The response object.
         * @param {string} path - The file path to serve.
         * @param {string} [status] - Optional HTTP status code.
         */
        async serve(req, res, path = req.path, status = null) {
            path = this.resolvePath(path);

            let cache = this.cache.get(path), suggestedCompressionAlgorithm;

            if (!cache || this.cacheDisabled) {
                if (this.automatic) {
                    // sigh.
                    suggestedCompressionAlgorithm = backend.helper.getUsedCompression(req, backend.mime.getType(nodePath.extname(path).slice(1)));

                    if(!await this.refresh(path, null, null, null, false)) {
                        this.onMissing(req, res, path, status);
                        return;
                    }

                    cache = this.cache.get(path);
                } else {
                    this.onMissing(req, res, path, status);
                    return;
                }
            }

            const needsUpdate = this.needsUpdate(path, cache);
            return this.serveWithoutChecking(req, res, cache, status, needsUpdate, suggestedCompressionAlgorithm);
        }

        async serveWithoutChecking(req, res, cache, status = null, needsUpdate = false, suggestedCompressionAlgorithm = null) {
            if(!cache) {
                this.onMissing(req, res, null, status);
                return;
            }

            const mimeType = cache[0][6];
            const algorithm = (this.enableCompression = backend.compression.enabled && cache[0][0].length >= backend.constants.MIN_COMPRESSION_SIZE)? (suggestedCompressionAlgorithm === null? backend.helper.getUsedCompression(req, mimeType): suggestedCompressionAlgorithm): backend.compression.format.NONE;

            if (!needsUpdate && cache[algorithm]) {
                backend.helper.send(req, res, cache[algorithm][0], cache[algorithm][1], status);
                return;
            }

            if(needsUpdate) {
                if(!await this.refresh(cache[0][7], null, null, null, false)) {
                    this.onMissing(req, res, cache[0][7], status);
                    return;
                }
            }

            const [algo, buffer, headers] = backend.helper.sendCompressed(req, res, cache[0][0], mimeType, {...cache[0][1]}, status, algorithm);
            if (!cache[algo]) {
                cache[algo] = [buffer, headers];
            }
        }

        // This method allows the FileServer to be used as a handler on its own
        onRequest(req, res) {
            if (this.automatic) {
                this.serve(req, res, req.path);
                return;
            }

            this.onMissing(req, res, null);
        }
    },


    /**
     * Parses the request body, optionally as a stream.
     * @class
     */
    bodyParser: class {
        constructor(req, res, callback, stream = false){
            this.req = req;
            this.res = res;

            this.type = req.contentType;
            this.length = req.contentLength || 0;

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