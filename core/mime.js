const fs = require("fs");

const types = new Map;
const extensions = new Map;

let loaded = false;

function load(){
    if(loaded || types.size > 0) return;

    try {
        const data = JSON.parse(fs.readFileSync(__dirname + "/../etc/mimetypes.json", "utf8"));

        loaded = true;

        for(let extension in data){
            types.set(extension, data[extension]);
            extensions.set(data[extension], extension);
        }
    } catch (error) {
        throw new Error("Failed to load mime types: " + error.message);
    }
}

const mime = module.exports = {
    types,
    extensions,

    getType(extension){
        if(!loaded) load();
        return types.get(extension) || null;
    },

    getExtension(mimetype){
        if(!loaded) load();
        return extensions.get(mimetype) || null;
    }
}