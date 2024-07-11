

let app, backend;

app = {
    // Expose the backend object
    Initialize(backend_){
        backend = backend_
    },

    // Handle WebSocket connections
    HandleSocket: {
        open(ws){
            console.log("WebSocket ID", ws.uuid, "has connected!");

            ws.subscribe("example.broadcast")
        },

        message(ws, message, isBinary){

            // Echo the message to all clients, with compression!
            backend.broadcast("example.broadcast", message, isBinary, true)

        },

        open(ws, code, message){
            console.log("WebSocket ID", ws.uuid, "has disconnected with code", code, "!");
        }
    },

    // Handle HTTP requests
    HandleRequest({req, res, error, segments}){
        res.end("Hello world!")
    }
}

module.exports = app;