/**
 * Helper utilities for the Akeno backend server.
 * @module helpers
 */

const backend = require("akeno:backend");

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
     * @returns {object} The backend helper object.
     */
    corsHeaders(req, res, credentials = false) {
        if(backend.trustedOrigins.has(req.origin)){
            credentials = true
        }
        
        res.cork(() => {
            res.writeHeader('X-Powered-By', 'Akeno Server/' + backend.version);

            if(credentials){
                res.writeHeader("Access-Control-Allow-Credentials", "true");
                res.writeHeader("Access-Control-Allow-Origin", req.origin);
                res.writeHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Credentials,Data-Auth-Identifier");
            } else {
                res.writeHeader('Access-Control-Allow-Origin', '*');
                res.writeHeader("Access-Control-Allow-Headers", "Authorization,*");
            }

            res.writeHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS");

            if(backend.protocols.h3.enabled){
                // EXPERIMENTAL: add alt-svc header for HTTP3
                res.writeHeader("alt-svc", `h3=":${H3Port}"`)
            }
        })
            
        return backend.helper
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


    getUsedCompression(req, mimeType){
        if(!backend.compression.enabled) return backend.compression.format.NONE;

        if(mimeType && doNotCompress.some(type => mimeType.startsWith(type))) {
            return backend.compression.format.NONE;
        }

        const enc = req.getHeader("accept-encoding");

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

        headers["content-type"] = mimeType;

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
        headers["content-encoding"] = {
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

        if(typeof error === "number" && backend.Errors[error]){
            let _code = code;
            code = error;
            error = (_code? code : "") + backend.Errors[code]
        }

        res.cork(() => {
            res.writeStatus(status || (code >= 400 && code <= 599? String(code) : '400'))
            backend.helper.corsHeaders(req, res);

            res.writeHeader("content-type", "application/json").end(`{"success":false,"code":${code || -1},"error":${(JSON.stringify(error) || '"Unknown error"')}}`);

            // res.writeHeader("content-type", "application/json");
            // backend.helper.sendTemplate(req, res, errorTemplate, {
            //     code: code || -1,
            //     error: JSON.stringify(error) || '"Unknown error"'
            // });
        })
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
            return req.contentLength > 0 || req.method === "POST" || (req.hasBody && req.transferProtocol === "qblaze")
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
}