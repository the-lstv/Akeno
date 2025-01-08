/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2024
    License: GPL-3.0
    Version: 1.0.0
    Description: Inter-process communication (IPC) module built for Akeno
*/

const net = require('net');
const fs = require('fs');
const uuid = (require("uuid")).v4;

// Simulating request/response and websocket-like communication via an Unix socket for IPC

const REQUEST_RESPONSE = 0;
const OPEN_SOCKET = 1;
const CLOSE_SOCKET = 2;


class ipc_client {
    constructor(socketPath){
        this.socketPath = socketPath;
        this.client = null;
        this.requests = new Map();
        this.closeListeners = new Map();

        this.buffer = ""
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.client = net.createConnection(this.socketPath, () => {
                resolve(this.client)
            })

            this.client.on('error', (err) => {
                this.client = null
                reject(err);
            })

            this.client.on('end', (err) => {
                this.client = null
                this.buffer = ""

                for(let listener of this.closeListeners){
                    if(typeof listener === "function") listener()
                }

                this.requests.clear()
                delete this.requests;
                this.requests = new Map();
                this.closeListeners.clear()
                delete this.closeListeners;
                this.closeListeners = new Map();
            })

            this.client.on('data', (data) => {
                this.buffer += data.toString();

                let boundary;
                while ((boundary = this.buffer.indexOf('\n')) !== -1) {
                    const chunk = this.buffer.slice(0, boundary);
                    this.buffer = this.buffer.slice(boundary + 1);

                    try {
                        const response = JSON.parse(chunk);
                        const id = response.id;

                        if(response.type === CLOSE_SOCKET){
                            const listener = this.closeListeners(id)
                            if(typeof listener === "function") listener();
    
                            this.requests.delete(id)
                            this.closeListeners.delete(id)
                            return
                        }

                        const callback = this.requests.get(id);

                        if(typeof callback === "function") {
                            if(response.type === OPEN_SOCKET){
                                callback(response.data);
                                return
                            }
    
                            callback(response.error, response.data);
                            if(response.type === REQUEST_RESPONSE){
                                this.requests.delete(response.id);
                            }
                        }
                    } catch {}
                }
            })
        })
    }

    close(){
        if(this.client) this.client.end();
        return true
    }

    async request(data, callback, options = {}) {
        if(!this.client) {
            try { await this.connect() } catch (error) {
                if(!callback) throw error;
                return callback(error);
            }
        }

        const id = uuid();
        const request = `${id} ${options.type || REQUEST_RESPONSE} ${JSON.stringify(data)}`;

        if(options.type === OPEN_SOCKET){
            this.client.write(request + "\n");
            return id
        }

        if(!callback) return new Promise((resolve, reject) => {
            this.requests.set(id, (error, response) => error? reject(error): resolve(response));
            this.client.write(request + "\n");
        })

        this.requests.set(id, callback)
        this.client.write(request + "\n")
    }

    async socket(command, callback){
        const _this = this;
    
        let status = 1, initialBuffer = [];

        const socket_id = await _this.request(command, data => initialBuffer.push(data), { type: OPEN_SOCKET })

        const object = {
            onMessage(callback){
                _this.requests.set(socket_id, callback);
            },

            onClosed(callback){
                _this.closeListeners.set(socket_id, callback)
            },

            send(data){
                if(status !== 1) return;
                _this.client.write(`${socket_id} 1 ${JSON.stringify(data)}\n`)
            },

            close(){
                _this.client.write(`${socket_id} 2\n`)
                status = 0
            },

            get status(){
                return status
            }
        }

        callback(object)

        const listener = _this.requests.get(socket_id)

        if(typeof listener === "function"){
            for(let entry of initialBuffer){
                listener(entry)
            }
        }

        initialBuffer = null
    }
}


class ipc_server {
    constructor(options){
        const _this = this;

        this.ipc_sock = net.createServer((socket) => {
            socket.buffer = "";

            socket.closeListeners = new Map;
            socket.messageListeners = new Map;
            socket.openSockets = new Set;

            socket.on("data", (data) => {
                socket.buffer += data.toString();

                let boundary;
                while ((boundary = socket.buffer.indexOf('\n')) !== -1) {
                    const chunk = socket.buffer.slice(0, boundary).toString();
                    socket.buffer = socket.buffer.slice(boundary + 1);

                    
                    const id_index = chunk.indexOf(" ");
                    if(id_index === -1) return;
                    
                    const type_index = chunk.indexOf(" ", id_index +1);
                    if(type_index === -1) return;
                    
                    const id = chunk.slice(0, id_index), type = +chunk.slice(id_index +1, type_index);
                    
                    let args;
                    try {
                        args = JSON.parse(chunk.slice(type_index +1))
                    } catch (error) { return socket.write(JSON.stringify({
                        type, id, error
                    }) + "\n") }

                    if(type === CLOSE_SOCKET){
                        return _this.close(socket, id)
                    }

                    socket.openSockets.add(id)

                    if(type === REQUEST_RESPONSE){
                        // Single request-response
                        if(options.onRequest) options.onRequest(socket, args, (error, data) => {
                            if(!socket.openSockets.has(id)) return;

                            socket.write(JSON.stringify({
                                type, id, error, data
                            }) + "\n")

                            _this.close(socket, id, false)
                        })
                    } else if (type === OPEN_SOCKET) {
                        // Multi-stream (bidirectional)

                        let listener = socket.messageListeners.get(id);
                        if(typeof listener === "function") return listener(args); else

                        if(options.onSocket) {
                            options.onSocket(socket, args, {
                                send(data) {
                                    if(!socket.openSockets.has(id)) return;

                                    socket.write(JSON.stringify({
                                        type, id, data
                                    }) + "\n")
                                },

                                close(){
                                    _this.close(socket, id)
                                },

                                get status(){
                                    return socket.openSockets.has(id);
                                },
        
                                onClosed(callback) {
                                    socket.closeListeners.set(id, callback)
                                },
        
                                onMessage(callback) {
                                    socket.messageListeners.set(id, callback)
                                }
                            })

                            listener = socket.messageListeners.get(id);
                            if(typeof listener === "function") listener(args);
                        }
                    }
                }
            })

            socket.on("close", () => {
                socket.buffer = null

                for(let listener of socket.closeListeners){
                    if(typeof listener === "function") listener()
                }

                socket.closeListeners.clear()
                socket.closeListeners = null
                socket.messageListeners.clear()
                socket.messageListeners = null
                socket.openSockets.clear()
                socket.openSockets = null
            })
        })
    }

    listen(path, callback){
        if (fs.existsSync(path)) fs.unlinkSync(path);

        this.ipc_sock.listen(path, () => {
            fs.chmodSync(path, 0o777);
            if(callback) callback(path)
        })
    }

    close(socket, id, message = true){
        
        const listener = socket.closeListeners.get(id)
        if(typeof listener === "function") return listener();
        
        socket.openSockets.delete(id)
        socket.closeListeners.delete(id)
        socket.messageListeners.delete(id)

        if(message) socket.write(JSON.stringify({
            type: CLOSE_SOCKET, id
        }) + "\n")
    }
}


module.exports = { ipc_client, ipc_server }