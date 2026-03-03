# Advanced Node.JS IPC
This is an unique IPC (Inter-Process Communication) library designed for Node.js with a clever and flexible API, with features such as:
- Request/Response model
- Sub-sockets
- Same API for both client and server

TODO:
- Pub-Sub model
- Shared channels

## Getting Started
Simply import the library.
```javascript
const ipc = require('/path/to/advanced-node-ipc');
```
Creating a server:
```javascript
const server = new ipc.Server({ ... });

server.listen("./socket", () => {
    console.log('Server is running');
});
```
Creating a client:
```javascript
const client = new ipc.Client("./socket", { ... });

client.socket.on('connect', () => {
    console.log('Connected to server');
});
```

## Examples
### 1. Sending requests from a client to a server:
Server:
```javascript
const server = new ipc.Server({
    onRequest(req, res) {
        console.log('Received data:', req.data);

        // Send a response back to the client
        res.end('Hello from server!');
    }
});
```
Client:
```javascript
// Send a request to the server
client.request('Hello from client!', (error, response) => {
    if (error) {
        console.error('Error in response:', error);
        return;
    }

    // Handle the response from the server
    console.log('Received response:', response);
});
```

### 2. Creating a bi-directional socket (one client can create as many sockets as needed in one connection):
Server:
```javascript
const server = new ipc.Server({
    onSocket(socket) {
        console.log('New client connected:', socket.id);
        
        socket.onMessage((message) => {
            console.log('Received message from client:', message);

            // Echo the message back to the client
            socket.send(message);
        });
    }
});
```
Client:
```javascript
// The connection can optionally have an initial payload, set to null to disable.
client.openSocket(null, (socket) => {
    // The "socket" object here is the exact same as the one on the server.

    console.log('Socket opened:', socket.id);

    // Send a message to the server
    socket.send('Hello from client!');

    // Listen for messages from the server
    socket.onMessage((message) => {
        console.log('Received message from server:', message);
    });
})
```

---


> [!NOTE]
> An unique feature of this library is that you can simply use the exact same API on the client and server - meaning you can open sockets and create requests from both sides. Here are some examples of that:


### 3. Creating a request from the server to the client:
This is done the exact same way as it is done from the client to the server, but simply reversed.<br>
On the server, you can call client.request(), client.openSocket(), etc.
```javascript
const server = new ipc.Server({
    onClient(client) {
        console.log('New client connected:', client.id);

        // Send a request to the client
        client.request('Hello from server!', (error, response) => {
            if (error) {
                console.error('Error in response:', error);
                return;
            }

            // Handle the response from the client
            console.log('Received response:', response);
        });
    }
});
```
On the client side, simply define the onRequest handler in options the same way as you would on the server:
```javascript
const client = new ipc.Client("./socket", {
    onRequest(req, res) {
        console.log('Received request from server:', req.data);

        // Send a response back to the server
        res.end('Hello from client!');
    }
});
```