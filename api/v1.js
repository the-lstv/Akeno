let encoder = new TextEncoder(), errorBuffer = encoder.encode('{"success":false,"error":"Deprecated API version! Please migrate to v2 and up."}')

module.exports = {
    async HandleRequest({req, res}){

        res.cork(() => {
            res.writeStatus("400").corsHeaders().writeHeader("content-type", "application/json").end(errorBuffer)
        })

    }
};