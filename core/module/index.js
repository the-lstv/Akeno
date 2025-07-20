/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.0.0
    Description: This is an external module for 3rd party Node.JS applications to access and interact with Akeno.
*/

const ipc = require("../ipc");
const client = new ipc.Client('/tmp/akeno.backend.sock');


module.exports = {
    /**
     * Functions related to akeno.web applications.
     * @namespace web
     */
    web: {
        /**
         * Load or reload an application by its path.
         * @param {string} path - The path to the application.
         * @returns {Promise<any>} - A promise that resolves with the response from the server.
         */
        async load(path){
            return client.request(["akeno.web/reload", path]);
        },
    
        /**
         * Enable an application by its path.
         * @param {string} path - The path to the application.
         * @returns {Promise<any>} - A promise that resolves with the response from the server.
         */
        async enable(path){
            return client.request(["akeno.web/enable", path]);
        },
    
        /**
         * Disable an application by its path.
         * @param {string} path - The path to the application.
         * @returns {Promise<any>} - A promise that resolves with the response from the server.
         */
        async disable(path){
            return client.request(["akeno.web/disable", path]);
        },
    
        /**
         * Get the status of an application by its path.
         * @param {string} path - The path to the application.
         * @returns {Promise<any>} - A promise that resolves with the response from the server.
         */
        async getStatus(path){
            return client.request(["akeno.web/status", path]);
        },
    
        /**
         * List all applications.
         * @returns {Promise<any>} - A promise that resolves with the list of applications.
         */
        async list(){
            return client.request(["akeno.web/list"]);
        }
    }
};