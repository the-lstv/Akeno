/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.1.0
    Description: A very simple MIME type module for Akeno.
*/

const fs = require("fs");

const types = new Map();
const extensions = new Map();

let loaded = false;

function load(){
    if(loaded || types.size > 0) return;

    try {
        const data = JSON.parse(fs.readFileSync(__dirname + "/../etc/mimetypes.json", "utf8"));

        for (const [mimetype, extensions_] of Object.entries(data)) {
            if (!Array.isArray(extensions_)) {
                continue;
            }

            extensions.set(mimetype, extensions_);

            for (const ext of extensions_) {
                types.set(ext, mimetype);
            }
        }

        loaded = true;
    } catch (error) {
        throw new Error("Failed to load mime types: " + error.message);
    }
}

module.exports = {
    types,
    extensions,

    /**
     * Get the MIME type associated with a given file extension.
     * 
     * @param {*} extension - The file extension to look up.
     * @returns {string|null} - The corresponding MIME type or null if not found.
     * 
     * @example
     * const type = mime.getType('html'); // Returns 'text/html'
     */
    getType(extension){
        if(!loaded) load();
        return types.get(extension) || null;
    },

    /**
     * Get the file extension(s) associated with a given MIME type.
     * 
     * @param {*} mimetype - The MIME type to look up.
     * @returns {Array|null} - An array of file extensions or null if not found.
     * 
     * @example
     * const extensions = mime.getExtension('text/html'); // Returns ['html', 'htm', 'shtml']
     */
    getExtension(mimetype){
        if(!loaded) load();
        return extensions.get(mimetype) || null;
    }
}