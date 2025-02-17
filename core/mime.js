const fs = require("fs");

const types = new Map;
const extensions = new Map;

function load(){
    if(types.size) return;

    try {
        const data = JSON.parse(fs.readFileSync(__dirname + "/../etc/mimetypes.json", "utf8"));
    
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
        if(!types.size) load();
        return mime.types[extension] || null
    },

    getExtension(mimetype){
        if(!types.size) load();
        return mime.extensions[mimetype] || null
    }
}