const backend = require("akeno-backend");

const addon = new backend.Addon({
    onRequest(req, res) {
        new backend.helper.bodyParser(req, res, (body) => {
            if(!req.hasBody) {
                res.writeStatus("400 Bad Request").end();
                return;
            }

            const json = body.json;
        });
    }
});

backend.route("api.v1", "/proposals", addon);

module.exports = addon;