/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.0.0
    Description: This is an external module for 3rd party Node.JS applications to access and interact with Akeno.
*/

const
    { ipc_client } = require("../ipc"),
    socketPath = '/tmp/akeno.backend.sock',
    client = new ipc_client(socketPath)
;


const Akeno = {
    loadApplication(path){
        return new Promise((resolve, reject) => {
            client.request(["web.reload", path], (error, response) => {
                if(error) reject(error)
                resolve(response)
            })
        })
    }
}


module.exports = Akeno;