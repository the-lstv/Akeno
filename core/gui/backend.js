const
    { ipc_client } = require("../ipc"),
    socketPath = '/tmp/akeno.backend.sock',
    client = new ipc_client(socketPath)
;

let backend;

module.exports = {
    Initialize($){
        backend = $;
    },

    async HandleRequest({segments, error, req, res}){
        segments = segments.slice(2);

        const query = req.getQuery();
        if(query){
            segments.push(query);
        }

        client.request(segments, (err, response) => {            
            if(err){
                return error(err.toString());
            }

            backend.helper.send(req, res, response);
        })
    }
}