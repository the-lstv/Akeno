const { backend } = require("./unit");

module.exports = {
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

    // TODO: Update
    types: {
        json: "application/json; charset=utf-8",
        js: "text/javascript; charset=utf-8",
        css: "text/css; charset=utf-8",
        html: "text/html; charset=utf-8",
    },

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


    // Use this if: 1) You are lazy
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
}