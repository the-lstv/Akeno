const backend = require("akeno-backend");

const addon = new backend.Addon();

addon.router("api.v1", "/*", {
    onRequest(req, res) {
        new backend.helper.bodyParser(req, res, (body) => {
            if(!req.hasBody) {
                res.writeStatus("400 Bad Request").end();
                return;
            }

            const json = body.json;
        });
    }
})