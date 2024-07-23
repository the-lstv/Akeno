


/*

    qBlaze is a HIGHLY experimental protocol that emulates HTTP requests over a WebSocket connection.
    It has minimal overhead and for small, frequent requests to the same origin is VERY fast, many times faster than HTTP 1.1, and can handle thousands of requests at once.

    (It requires a special client for connections).

    It is partially compatible with existing HTTP libraries (eg. the fetch API in JS, and uWebSocket HTTP server)


    It should be used with EXTREME caution and never 100% relied on.

    By default, akeno sets up your server to route any qBlaze traffic to your regular server, meaning it will respond to the same requests.
    qBlaze is listening at /quicc of any domain unless disabled.

*/




let urlParser = require('url');

let encoder = new TextEncoder, decoder = new TextDecoder;

let backend;

let methods = {0: "get", 1: "post", 2: "delete", 3: "patch", 4: "writeheader"};

let api = {
    Initialize(_){
        backend = _
    },

    HandleRequest({req, res}){
        // F*cking cors...
        res.writeHeader("Access-Control-Allow-Origin", "*").end()
    },

    HandleSocket: {
        open(socket){
            socket.abortSignals = {}
            socket.globalHeaders = {}
        },

        message(socket, buffer, isBinary){
            if(!isBinary) return;

            const dataView = new DataView(buffer);

            let offset = 0;

            const id = dataView.getUint16(offset, false);
            offset += 2;

            const method = dataView.getUint8(offset);
            offset += 1;

            const urlLength = dataView.getUint8(offset);
            offset += 1;

            let url = '';

            for (let i = 0; i < urlLength; i++) {
                url += String.fromCharCode(dataView.getUint8(offset + i));
            }

            offset += urlLength;

            // The rest of the buffer is the body
            const body = new Uint8Array(buffer.slice(offset));


            // Writing global headers
            if(method === 4) {
                let headers = decoder.decode(body).split("\n");

                for(let header of headers){
                    if(!header) continue;

                    let [key, value] = header.split(":");

                    socket.globalHeaders[key] = value;
                }

                return socket.send(new Uint8Array([
                    (id >> 8) & 0xFF,
                    id & 0xFF,
                    0
                ]), true, true)
            }

            // console.log(
            //     id, method, url, body
            // );


            let parsedUrl = new urlParser.URL("http://localhost/" + url);


            // [PARTIAL] Backwards compatibility with uWebSockets HTTP, this forwards the request to Akeno's standard handler:

            let _status = 200;

            let res = {
                end(body = null, close = false){

                    if(typeof body === "string") body = encoder.encode(body);

                    socket.send(new Uint8Array([
                        (id >> 8) & 0xFF,
                        id & 0xFF,
                        _status,
                        ...(body? body: [])
                    ]), true, true)

                    socket.abortSignals[id] = null;

                    if(close) socket.close();
                    return res
                },

                getRemoteAddress(){
                    return socket.ip || null
                },

                getRemoteAddressAsText(){
                    return socket.ipAsText || null
                },

                onAborted(handler){
                    socket.abortSignals[id] = handler
                    return res
                },

                onData(handler){
                    // Temporary: In the future, client should be able to send body in chunks
                    handler(body.buffer, true)
                    return res
                },

                cork(callback){
                    callback()
                    return res
                },

                writeStatus(status){
                    _status = (+(`${status}`.match(/^\d+/)[0])) - 200;
                    return res
                },

                writeHeader(key, value){
                    // uhh... to be implemented
                    return res
                },

                write(chunk){
                    // TODO: implement this
                },

                colse(){
                    socket.close();
                    return res
                },

                connectionID: socket.uuid
            }

            let req = {
                getMethod(){
                    return methods[method]
                },

                getUrl(){
                    return parsedUrl.pathname
                },

                getQuery(key = null){
                    if(typeof key === "string") return parsedUrl.searchParams.get(key);

                    return parsedUrl.search
                },

                getHeader(key = null){
                    // FIXME: temporary
                    if(key === "host") return "api.extragon.cloud"; 
                    return socket.globalHeaders[key] || "" // temporary
                },

                transferProtocol: "qblaze",

                hasBody: body.length > 0
            }

            backend.resolve(res, req)
        },

        close(socket, code, message){
            for(let key in socket.abortSignals) {
                let handler = socket.abortSignals[key]
                if(handler) handler(code, message)
            }
        }
    }
}


module.exports = api;