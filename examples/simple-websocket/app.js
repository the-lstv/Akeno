

let backend, app = module.exports = {
    // Expose the backend object
    Initialize(_backend){
        backend = _backend
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

        close(ws, code, message){
            console.log("WebSocket ID", ws.uuid, "has disconnected with code", code, "!");
        }
    },

    // Optionally handle HTTP requests
    HandleRequest({req, res, error, segments}){
        res.end("Hello world!")
    }
}

module.exports = app;
