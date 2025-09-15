# Simple HTTP server examples

## Simple handler
The simplest way to setup a simple HTTP server is with a simple function:
```js
server.route("localhost", (req, res) => {
    res.end("Hello world!");
});

// http://localhost now responds with "Hello world!" - if you enabled https, it will work seamlessly - no further config needed.
```

## Static file server
Automatically handles compression, cache management, etc.
```js
// -- Method 1: Full automatic file server ---
const fileServer = new akeno.FileServer({
    root: __dirname, // Directory to serve files from
    automatic: true
});

// Simply point to the fileServer, and all files will be served automatically
server.route("localhost", fileServer);
```
```js
// --- Method 2: Manual instance (for full control) ---
const fileServer = new akeno.FileServer();
fileServer.add("/path/to/file.txt"); // Add, preload and cache a file manually

server.route("localhost", (req, res) => {
    // Serve from the fileServer manually at any point
    fileServer.serve(req, res, "/path/to/file.txt");
});
```
