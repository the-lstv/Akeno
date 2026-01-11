# WebSockets examples
WebSockets are a core part of Akeno and work seamlessly alongside HTTP/S - where you can host HTTP, you can also easily setup a websocket.

To setup a WebSocket, all you need is:
```js
server.route("localhost", {
    websocket: {
        open(ws) {
            console.log("Client connected!");
        },

        message(ws, message, isBinary) {
            console.log("Received message:", message);
        },

        close(ws) {
            console.log("Client disconnected!");
        }
    }
});

// You can now connect to ws://localhost and wss://localhost.
```

You can easily setup WebSockets alongside an existing HTTP/S route:
```js
// --- For simple HTTP handlers: ---
server.route("localhost", {
    onRequest(req, res) {
        res.end("Hello from HTTP server!");
    },

    // Seamlessly integrate WebSocket handlers
    websocket: {
        open(ws) {
            console.log("Client connected!");
        }
    }
});

// http://localhost now works as a HTTP server, and ws://localhost works as a WebSocket server.
// That is all the configuration you need!
```
```js
// -- Or for any other handler, including path matchers, other routers, file servers... --

const myServer = new akeno.FileServer(); // Can be any kind of handler

// Set websocket handlers
myServer.ws({
    open(ws) { ... }
})

server.route("localhost", myServer);
```

Custom upgrade handlers are as simple as adding an `upgrade` handler function (which will override the default upgrade logic):
```js
server.route("localhost", {
    websocket: {
        upgrade(res, req, wsContext) {
            // Perform any custom upgrade logic here (see uWebSockets.js upgrade handler)
        }
    }
});
```
```js
// -- Or: you can also handle WebSocket connections inside regular HTTP handlers! --
function myHandler(req, res, wsContext) {
    // Here you can perform logic for both HTTP and WS requests

    if(wsContext) {
        // Perform upgrade here
        return;
    }
}

myHandler.__includeWebSocketUpgrades = true; // Forwards upgrade requests to the handler
server.route("localhost", myHandler);
```