## Using as a library
Akeno is usually used as a single global server and then interacted via an API, but it also supports being run as any other server library.

```js
const akeno = require("akeno-lib");

// Using a global server instance
akeno.connect().then(server => {
    server.route("localhost", (req, res) => {
        res.end("Hello from your first Akeno server!");
    });
});
```

```js
const akeno = require("akeno-lib");

// Using a dedicated in-process server with a config (same as app.conf)
const server = new akeno.dedicatedServer(`
protocols {
    http {
        port: 80;
    }
}
`);

server.route("localhost", (req, res) => {
    res.end("Hello from your first Akeno server!");
});
```
