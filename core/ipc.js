/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    Version 1.1.0
    License GPL-3.0

    Inter-process communication (IPC) module built for Akeno.
    Simulating request/response and websocket-like communication via a Unix socket for IPC.

    It is designed to be bi-directional, the server and client both share the same API, allowing you to communicate between the server and client seamlessly.
    The Server class maintains clients, where each client instance can also make requests back to where it was initiated, and clients can receive requests from the server.
*/

const PROTOCOL_VERSION = 2;

const REQUEST = 0;
const RESPONSE = 1;
const ERROR_RESPONSE = 2;
const OPEN_SOCKET = 3;
const CLOSE_SOCKET = 4;

const net = require('net');
const fs = require('fs');
const uuid = (require("uuid")).v4;

/**
 * Represents a request sent to the IPC server.
 */
class Request {
    constructor(client, id, data, type) {
        this.client = client;
        this.socket = client.socket;
        this.id = id;
        this.data = data;
        this.type = type;
    }
}

/**
 * Represents a response from the IPC server.
 */
class Response {
    constructor(request) {
        this.request = request;
        this.client = request.client;
        this.socket = request.client.socket;
        this.id = request.id;
        this.type = request.type;

        if(this.status !== 1) {
            console.error("Response cannot be created: request socket is closed");
            return;
        }
    }

    /**
     * Sends data back to the client.
     * @param {any} data - The data to send.
     * @returns {Response} The response object for chaining.
     */
    write(data) {
        if(this.status !== 1) return;

        this.socket.write(`${this.id} ${this.type} ${JSON.stringify(data)}\n`);

        return this;
    }

    /**
     * Sends an error back to the client.
     * @param {Error} error - The error to send.
     * @returns {Response} The response object for chaining.
     */
    error(error) {
        if(this.status !== 1) return;

        this.socket.write(`${this.id} ${ERROR_RESPONSE} ${JSON.stringify(error)}\n`);

        return this;
    }

    /**
     * Closes the connection and optionally sends data.
     * @param {any} [data=null] - Optional data to send before closing.
     * @returns {boolean} True if the connection was closed successfully.
     */
    end(data = null) {
        if(this.status !== 1) return;

        if(data !== null) {
            this.write(data);
        }

        closeConnection(this.client, this.id);
        return true;
    }

    /**
     * Gets the status of the request.
     * @returns {number} The status of the request (1 for open, 0 for closed).
     */
    get status() {
        return this.client.openSockets.has(this.id) ? 1 : 0;
    }
}

/**
 * Represents a socket connection in the IPC server, used by both the client and server.
 */
class SocketClient {
    constructor(client, id, data, type) {
        this.client = client;
        this.socket = client.socket;
        this.id = id;
        this.data = data;
        this.type = type;
    }

    /**
     * Sends data through the socket.
     * @param {any} data - The data to send.
     */
    send(data) {
        if(this.status !== 1) return;

        this.socket.write(`${this.id} ${this.type} ${JSON.stringify(data)}\n`);

        return this;
    }

    /**
     * Closes the socket connection.
     */
    close() {
        if(this.status !== 1) return;
        closeConnection(this.client, this.id);
    }

    /**
     * Gets the status of the socket connection.
     * @returns {number} The status of the socket (1 for open, 0 for closed).
     */
    get status() {
        return this.client.openSockets.has(this.id) ? 1 : 0;
    }

    /**
     * Sets a callback for when a message is received on the socket.
     * @param {Function} callback - The callback function to handle incoming messages.
     */
    onMessage(callback) {
        if(this.status !== 1) return;
        this.client.messageListeners.set(this.id, callback);
    }

    /**
     * Sets a callback for when the socket is closed.
     * @param {Function} callback - The callback function to handle socket closure.
     */
    onClosed(callback) {
        if(this.status !== 1) return;
        this.client.closeListeners.set(this.id, callback);
    }
}

/**
 * The main shared class for IPC client and server clients.
 * Both the client and server share the same API.
 */

class IPCClient {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.options = options;

        this.openSockets = new Set();
        this.messageListeners = new Map();
        this.closeListeners = new Map();

        this.buffer = "";

        this._connected = false;

        this.socket.on('error', (err) => {
            // this.socket = null;
            // console.error('Socket error:', err);
            // this.cleanup();
            if(this.options.onError) {
                this.options.onError(err);
            }
        });

        this.socket.on('end', () => {
            this.cleanup();

            if(this.id && this.server) {
                this.server.connectedClients.delete(this.id);
            }
        });

        this.socket.on('data', (received_data) => {
            this.buffer += received_data.toString();

            let boundary;
            while ((boundary = this.buffer.indexOf('\n')) !== -1) {
                const chunk = this.buffer.slice(0, boundary);
                this.buffer = this.buffer.slice(boundary + 1);

                const id_index = chunk.indexOf(" ");
                if(id_index === -1) return;
                
                let type_index = chunk.indexOf(" ", id_index +1);
                if(type_index === -1) type_index = chunk.length;

                const id = chunk.slice(0, id_index), type = +chunk.slice(id_index +1, type_index);

                // Parse data if it exists
                let data = null;
                if(chunk.length > type_index + 1) {
                    try {
                        data = JSON.parse(chunk.slice(type_index +1))
                    } catch (error) {
                        console.error("Error processing JSON data:", error);
                        return;
                    }
                }

                // console.log("Received IPC message:", { id, type, data });

                if(type === CLOSE_SOCKET){
                    closeConnection(this, id, false);
                    return;
                }

                this.openSockets.add(id);

                if(type === REQUEST){

                    // We received a request
                    if(!this.options.onRequest) return;
        
                    const req = new Request(this, id, data, RESPONSE);
                    const res = new Response(req);

                    this.options.onRequest(req, res);

                } else if (type === RESPONSE || type === ERROR_RESPONSE) {

                    // We received a response to a request
                    const callback = this.messageListeners.get(id);
                    if (typeof callback === "function") {
                        // this.messageListeners.delete(id);

                        if(type === ERROR_RESPONSE) {
                            return callback(data);
                        }

                        callback(null, data);
                    }

                } else if (type === OPEN_SOCKET) {
        
                    // Multi-stream (bidirectional)

                    // If a listener is already set, call it with the data
                    let listener = this.messageListeners.get(id);
                    if(typeof listener === "function") {
                        listener(data);
                        return;
                    }
        
                    // Otherwise, create a new socket connection
                    if(!this.options.onSocket) return;

                    const socketConnection = new SocketClient(this, id, data, type);
                    if(this.options.onSocket) {
                        this.options.onSocket(socketConnection);
                    }
        
                }
            }
        });
    }

    awaitConnection() {
        if(this._connected) return Promise.resolve(this);

        return new Promise((resolve, reject) => {
            this.socket.on('connect', () => {
                this._connected = true;
                resolve(this);
            });

            this.socket.on('error', (err) => {
                this._connected = false;
                reject(err);
            });
        });
    }

    close(){
        if(this.socket) this.socket.end();
        return true;
    }

    /**
     * Sends a request to the IPC server.
     * @param {Object} data - The data to send in the request.
     * @param {Function} [callback] - Optional callback to handle the response.
     * @param {Object} [options={}] - Optional options for the request.
     * @param {number} [options.type=REQUEST_RESPONSE] - The type of request (default is REQUEST_RESPONSE).
     * @returns {Promise<string>|string} A promise that resolves with the request ID or a string if no callback is provided.
     */
    async request(data, callback, options = {}) {
        if(!this._connected) {
            try { await this.awaitConnection() } catch (error) {
                if(!callback) throw error;
                return callback(error);
            }
        }

        const id = options.id || uuid();
        const request = `${id} ${options.type || REQUEST} ${JSON.stringify(data)}`;

        if(options.type === OPEN_SOCKET){
            this.socket.write(request + "\n");
            return id;
        }
        
        if(!callback) {
            return new Promise((resolve, reject) => {
                this.messageListeners.set(id, (error, response) => error? reject(error): resolve(response));
                this.socket.write(request + "\n");
            });
        }

        // Send the request
        this.messageListeners.set(id, callback);
        this.socket.write(request + "\n");
    }

    /**
     * Opens a socket connection to the IPC server.
     * @param {any} [initialPayload=null] - Optional initial data to send with the socket connection.
     * @param {Function} [callback] - Optional callback to handle the socket connection.
     * @param {Object} [options={}] - Optional options for the socket connection.
     * @returns {Promise<SocketClient>} A promise that resolves with the socket connection.
     */
    async openSocket(initialPayload = null, callback, options = {}) {
        if(!callback) {
            return new Promise((resolve) => {
                this.openSocket(initialPayload, (socket) => {
                    resolve(socket);
                });
            });
        }

        let initialBuffer = [];

        // Obtain the socket ID and let the server know
        const id = await this.request(initialPayload, data => initialBuffer.push(data), { type: OPEN_SOCKET, id: options.channel || uuid() });

        if(!id) {
            if(typeof callback === "function") callback(null);
            return;
        }

        const socketClient = new SocketClient(this, id, initialPayload, OPEN_SOCKET);
        callback(socketClient);

        // If there is initial data, call the listener
        const listener = this.messageListeners.get(id);
        if(typeof listener === "function"){
            for(let entry of initialBuffer){
                listener(entry);
            }
        }

        initialBuffer = null;
    }

    cleanup() {
        this.socket = null;
        this.buffer = "";

        for(let listener of this.closeListeners.values()){
            if(typeof listener === "function") listener();
        }

        this.messageListeners.clear();
        this.closeListeners.clear();
        this.openSockets.clear();
    }
}


/**
 * Represents the IPC client that connects to the IPC server.
 * @param {string} socketPath - The path to the IPC socket file.
 * @param {Object} [options={}] - Optional options for the IPC client.
 * @extends IPCClient
 */
class Client extends IPCClient {
    constructor(socketPath, options){
        super(net.createConnection(socketPath), options);
        this.socketPath = socketPath;
    }
}


/**
 * Class representing a client connected to the IPC server.
 * @extends IPCClient
 * @param {Server} server - The server instance that this client is connected to.
 * @param {Socket} socket - The socket instance for the connection.
 */

class ServerClient extends IPCClient {
    constructor(server, socket) {
        super(socket, server.options);
        this.server = server;
    }
}


/** 
 * Represents the IPC server that listens for incoming connections.
 * @param {Object} options - Options for the IPC server.
 * @param {Function} options.onRequest - Callback for handling request-response interactions.
 * @param {Function} options.onSocket - Callback for handling socket connections.
 */
class Server {
    constructor(options){
        this.options = options || {};

        this.connectedClients = new Map();

        this.server = net.createServer((socket) => {
            const client = new ServerClient(this, socket);

            client.id = uuid();
            this.connectedClients.set(client.id, client);

            if(options.onClient) {
                options.onClient(client);
            }
        });
    }

    listen(path, callback){
        if (fs.existsSync(path)) fs.unlinkSync(path);

        this.server.listen(path, () => {
            fs.chmodSync(path, 0o777);
            if(callback) callback(path);
        });
    }
}

function closeConnection(client, id, sendMessage = true) {
    if(!client.openSockets.has(id)) return;

    client.openSockets.delete(id);
    client.closeListeners.delete(id);
    client.messageListeners.delete(id);

    if(sendMessage) {
        client.socket.write(`${id} ${CLOSE_SOCKET}\n`);
    }
}

module.exports = { Client, Server, ipc_client: Client, ipc_server: Server }