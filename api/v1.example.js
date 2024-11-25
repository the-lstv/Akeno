module.exports = {
    async HandleRequest({ req, res }){

        res.end("Hello world!")

    },

    HandleSocket: {
        open(ws){

        },

        message(ws, message, isBinary){

        },

        close(ws, code, message){

        },
    }
};