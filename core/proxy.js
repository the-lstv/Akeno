/*

    Deprecated!

 */

/*
A powerful-ish proxy built into Akeno.

Current limitations:
- No streaming support
- Not always 100% accurate, some sites might block it or break
- Not too well written

Current features:
- WebSockets proxying
- Local proxying
- Overwrite links
- Overwrite fetch and other request libraries on the client side
- CORS unblocking
- Header handling, passthrough, and adaptation
- SSL support
- Replacing browser's "location" object with an adjusted one with identical behavior
- Does not support custom ports in subdomain mode
*/

let
    // Used only for proxy requests
    http = require("http"),
    https = require("https"),
    WebSocket = require("ws"),

    zlib = require('zlib'),
    parse5 = require('parse5'),

    textEncoder = new TextEncoder,
    textDecoder = new TextDecoder
;


// Parser that replaces object references in JavaScript code (eg. location to _location)
let { replaceObjects } = require(__dirname + "/parser.js");

// Code to place on clients to replace or handle certain behaviors
let clientCode = require("fs").readFileSync(__dirname + "/proxy.client-code.js", "utf8")

// Detect mime types for content manipulation
const webContentMimeTypes = {
    html: [
        "text/html",
        "application/xhtml+xml",
        // "application/xml",
        // "text/xml"
    ],
    js: [
        "application/javascript",
        "application/ecmascript",
        "text/javascript",
    ],
    css: [
        "text/css"
    ]
}


// I guess there are much better ways, I just did what was the easiest
let url_translate_function_as_string;


// HTTP/s proxy + Content transformation
function proxyReq(req, res, options, proxyOptions = {}){
    options = {
        path: req.path,
        method: req.method,
        hostname: "localhost",
        headers: {},
        overwriteHeaders: {},
        ...options
    }

    let SUBDOMAIN_MODE = !!proxyOptions.subdomainMode

    req.forEach((key, value) => {
        if(key.toLowerCase() === "host") return;

        options.headers[key] = value;
    });

    let PROXY_HOST = req.domain.split('.').slice(-2).join(".")

    const proxyReq = (options.protocol && options.protocol === "https:"? https: http).request(options, (proxyRes) => {
        let chunks = []

        proxyRes.on('data', (chunk) => {
            // TODO: Stream chunks when needed
            chunks.push(Buffer.from(chunk));
        });

        proxyRes.on('end', async () => {
            // Full body
            let body = Buffer.concat(chunks);

            const PROXY_PREFIX = `${options.protocol || "http:"}//${req.domain}/`, PROXY_ORIGIN = (options.protocol || "http:") + "//" + options.hostname;

            function translateURL(url, protocol = "http"){
                if (typeof url !== 'string' || url.includes("//gateway_") && url.includes("." + PROXY_HOST) || !SUBDOMAIN_MODE && url.startsWith(PROXY_PREFIX)) return url;

                let isAbsolute = url.startsWith(protocol + "://") || url.startsWith(protocol + "s://");

                if(SUBDOMAIN_MODE) {
                    let parsed;

                    if(isAbsolute){
                        try {
                            parsed = new URL(url);
                        } catch {return ""};
                    }

                    return isAbsolute? `${parsed.protocol}//gateway_${parsed.hostname.replaceAll(".", "_")}.${PROXY_HOST}${parsed.pathname + (parsed.search || "") + (parsed.hash || "")}` : url;
                } else {
                    return PROXY_PREFIX + encodeURIComponent(isAbsolute? url: PROXY_ORIGIN + "/" + url);
                }
            }

            if(!url_translate_function_as_string) url_translate_function_as_string = translateURL.toString();

            if(proxyRes.headers['location']) proxyRes.headers['location'] = translateURL(proxyRes.headers['location']);
            
            options.headers['origin'] = PROXY_ORIGIN;
            options.headers['referer'] = PROXY_ORIGIN + "/";
            delete options.headers['x-fingerprint'];

            console.log(options.hostname, options.path, options.headers);


            // Transform web content on the fly when needed
            if(proxyOptions.mode === "web"){

                // Block some spyware
                if(options.path.includes("sentry")) {
                    return res.end()
                }

                for(let type in webContentMimeTypes){
                    if(webContentMimeTypes[type].includes(proxyRes.headers["content-type"]? proxyRes.headers["content-type"].replace(/[\s;].*/g, ""): null)){

                        const encoding = proxyRes.headers['content-encoding'];

                        // Remove the header since we are sending decoded data already
                        delete proxyRes.headers['content-encoding'];
                        delete proxyRes.headers['content-security-policy'];

                        // Handle gzip, deflate, and br (Brotli) encodings
                        let decoded = await new Promise(resolve => {
                            switch(encoding){
                                case "gzip":
                                    zlib.gunzip(body, (err, data) => resolve([err, data]));
                                    break;

                                case "deflate":
                                    zlib.inflate(body, (err, data) => resolve([err, data]))
                                    break;

                                case "br":
                                    zlib.brotliDecompress(body, (err, data) => resolve([err, data]))
                                    break;

                                default: resolve([null, body])
                            }
                        })

                        if(decoded[0]){
                            return res.writeStatus("500 Internal Server Error").end("Proxy error: Invalid/Corrupted content encoding")
                        }

                        body = textDecoder.decode(new Uint8Array(decoded[1]));

                        switch(type){
                            case "html":
                                try {
                                    const clientScript = `(()=>{ // Akeno Proxy Client Interceptor\nlet PROXY_PREFIX = '${PROXY_PREFIX}', SUBDOMAIN_MODE = ${SUBDOMAIN_MODE}, PROXY_HOST = '${PROXY_HOST}', PROXY_TARGET = '${options.hostname}', PROXY_ORIGIN = '${PROXY_ORIGIN}'; \n ${url_translate_function_as_string} \n ${clientCode} })();`;

                                    function addClientScript(document, value) {
                                        const scriptNode = {
                                            nodeName: 'script',
                                            tagName: 'script',
                                            attrs: [],
                                            childNodes: [{
                                                nodeName: '#text', value
                                            }]
                                        };

                                        const htmlNode = document.childNodes.find(node => node.tagName === 'html');
                                        const headNode = htmlNode.childNodes.find(node => node.tagName === 'head') || htmlNode.childNodes.find(node => node.tagName === 'body');

                                        headNode.childNodes.unshift(scriptNode);
                                    }

                                    function modifyLinks(node) {
                                        if (node.tagName) {
                                            if (node.attrs) {
                                                node.attrs.forEach(attr => {
                                                    if (['href', 'src', 'action', 'data', 'srcset', 'poster', "content"].includes(attr.name)) {
                                                        // Also make sure to handle relative paths;
                                                        attr.value = translateURL(attr.value);
                                                    }
                                                })
                                            }

                                            if (node.tagName === 'script' && node.childNodes) {
                                                node.childNodes.forEach(scriptNode => {
                                                    if (scriptNode.nodeName !== '#text') return;

                                                    // Discord-specific fixes
                                                    if (options.hostname === "discord.com" && scriptNode.value.startsWith("window.GLOBAL_ENV")) {

                                                        scriptNode.value = scriptNode.value
                                                        // .replaceAll("'//", "'" + PROXY_PREFIX + "https://")
                                                        // .replaceAll("wss://", PROXY_PREFIX + "wss://")
                                                        // .replaceAll("http://", PROXY_PREFIX + "http://")
                                                        // .replaceAll("https://", PROXY_PREFIX + "https://")
                                                        .replace("cdn.discordapp.com", PROXY_PREFIX + "https://cdn.discordapp.com")
                                                        // .replace("'discord.gg'", "'" + PROXY_PREFIX + "https://discord.gg'")
                                                        // .replace("'discord.gift'", "'" + PROXY_PREFIX + "https://discord.gift'")
                                                        // .replace("'discord.new'", "'" + PROXY_PREFIX + "https://discord.new'")

                                                    } else {

                                                        scriptNode.value = replaceObjects(scriptNode.value, {
                                                            location: "_location_"
                                                        })

                                                        // scriptNode.value = scriptNode.value.replace(/(['"`])((https?:)?\/\/[^\1]+)\1/g, (match, p1, p2) => {
                                                        //     return p1 + translateURL(p2 + p1);
                                                        // })
                                                    }
                                                })
                                            }
                                        }

                                        if (node.childNodes) {
                                            node.childNodes.forEach(modifyLinks);
                                        }
                                    }

                                    let doc = parse5.parse(body);

                                    modifyLinks(doc)

                                    // Why do it like this? parse5 does not seem to have a "escapeStrings: false" option yet so ">" 
                                    addClientScript(doc, "Insert___ClientScript___Here")

                                    body = Buffer.from(parse5.serialize(doc).replace("Insert___ClientScript___Here", clientScript));
                                    options.overwriteHeaders["content-middleware", "Akeno Proxy Serializer"]

                                } catch (error) {
                                    console.error(error);
                                    return res.writeStatus("500 Internal Server Error").end("Proxy error: Could not modify content")
                                }
                            break

                            case "js":
                                body = replaceObjects(body, {
                                    location: "_location_"
                                })
                                
                                .replaceAll("F.location", "_location_")
                                .replaceAll("l.location", "_location_")
                                .replaceAll("f.location", "_location_")
                                .replaceAll("r.search", "_location_.search")
                                .replaceAll("parse(location", "parse(_location_")
                                .replaceAll("parse)(location", "parse)(_location_")
                                .replaceAll("window.location.search", "_location_")
                            break;
                        }

                        break
                    }
                }
            }

            delete proxyRes.headers['alt-svc'];

            // Finalize
            res.cork(() => {
                res.writeStatus(`${proxyRes.statusCode} ${proxyRes.statusMessage}`);
                proxyRes.headers.server = "Akeno Server Proxy";
                
                for(let header in options.overwriteHeaders){
                    res.writeHeader(header, options.overwriteHeaders[header]);
                }

                for(let header in proxyRes.headers){
                    if(options.overwriteHeaders.hasOwnProperty(header) || !proxyRes.headers.hasOwnProperty(header)) continue;
                    if(header === "date" || header === "content-length" || header === "transfer-encoding") continue;

                    if(typeof proxyRes.headers[header] === "string") res.writeHeader(header, proxyRes.headers[header]);
                }

                // Finally, send the proxied request back to the client
                res.end(body);
            })
        })
    });

    proxyReq.on('error', (e) => {
        res.cork(() => {
            res.writeStatus('500 Internal Server Error').end(`Proxy error: ${e.message}\nPowered by Akeno`);
        })
    });

    res.onData((chunk, isLast) => {
        if(req.method === "POST"){
            proxyReq.write(Buffer.from(chunk));
        }

        if (isLast) {
            proxyReq.end();
        }
    })
}


// Simple WebSocket proxy
function proxyWebSocket(req, res, context, options){
    let {url, headers} = options;

    console.log("Should be proxying websocket: ", url);

    let eventConnectionBuffer = [], proxySocket, isConnected = false, ws;

    function send(event){
        if(!isConnected){
            return eventConnectionBuffer.push(event)
        }

        proxySocket.send(event)
    }
    
    res.upgrade({
        handler: {

            open(_ws){
                ws = _ws;
    
                proxySocket = new WebSocket(url, [], {
                    headers
                })
    
                console.log(headers);
                
    
                proxySocket.on("open", () => {
                    isConnected = true;
    
                    for(let event of eventConnectionBuffer){
                        send(event)
                    }
                })
    
                proxySocket.on("message", data => {
                    ws.send(data, typeof data !== "string", true)
                })
    
                proxySocket.on("close", () => {
                    ws.close()
                    console.log("Proxy socket closed");
                })
    
                proxySocket.on("error", error => {
                    console.error(error);
                })
            },
    
            message(ws, message, isBinary){
                send(message)
            },
    
            close(ws, code, message){
                proxySocket.close()
            }
        },

    }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
}


// SFTP Proxy over 
async function proxySFTP(req, res, wsContext, options){
    let Client = require('ssh2-sftp-client');
    let sftp = new Client();

    res.upgrade({
        handler: {
            async open(_ws){
                ws = _ws;

                await sftp.connect(options)

                ws.send("connected")
            },

            message(ws, message, isBinary){
                send(message)
            },

            close(ws, code, message){
                sftp.end()
            }
        },

    }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), wsContext);

    // .then(() => {
    //     return 
    //   }).then(data => {
    //     console.log(data, 'the data info');
    //   }).catch(err => {
    //     console.log(err, 'catch error');
    //   });  
}


module.exports = { proxyReq, proxyWebSocket, proxySFTP }