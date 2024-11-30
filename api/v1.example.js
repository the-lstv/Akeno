// This is an example API setup - you would be able to access it from domains routed to the API (from your config), eg. https://api.example.com/v1/

module.exports = {
    async HandleRequest({ req, res }){

        res.end("Hello world!")

    },

    // Handle WebSocket connections
    HandleSocket: {
        open(ws){

        },

        message(ws, message, isBinary){

        },

        close(ws, code, message){

        }
    }
};