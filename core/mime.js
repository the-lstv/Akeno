/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0
    Version: 1.2.0
    Description: A very simple MIME type module for Akeno.
*/

const fs = require("fs");
const nodePath = require("path");

const types = new Map();
const categories = new Set;
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

            categories.add(mimetype.split("/")[0]);

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
    get types(){
        if(!loaded) load();
        return types;
    },

    get extensions(){
        if(!loaded) load();
        return extensions;
    },

    get categories(){
        if(!loaded) load();
        return categories;
    },

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
     * Get the MIME type associated with a given file path based on it's extension.
     * Note: This doesn't perform a header based lookup, just gets the type from the provided extension.
     * Same as getType but accepts a regular file path.
     * 
     * @param {*} path - The file path to look up.
     * @returns {string|null} - The corresponding MIME type or null if not found.
     * 
     * @example
     * const type = mime.fromPath('/hello/file.html'); // Returns 'text/html'
     */
    fromPath(path) {
        if(!loaded) load();
        return types.get(nodePath.extname(path).slice(1)) || null;
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
        return extensions.get(mimetype) || [];
    }
}