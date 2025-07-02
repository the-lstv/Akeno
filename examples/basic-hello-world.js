const backend = require("akeno:backend");

// This example sets up a simple hostname route to respond with a static response.

backend.domainRouter.add("example.{net,com}", (req, res) => {
    res.end("Hello, World!");
});
