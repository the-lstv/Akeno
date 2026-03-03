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
 * Base class for both sockets and requests, on both client and server.
 */

class SocketConnection {
    constructor(client, id, type, data = null) {
        this.client = client;
        this.socket = client.socket;
        this.id = id;
        this.type = type;

        this.data = data;

        if(this.status !== 1) {
            console.error("SocketConnection cannot be created: socket is closed");
            return;
        }
    }

    /**
     * Sends data back to the client.
     * @param {any} data - The data to send.
     * @returns {SocketConnection} The response object for chaining.
     */
    write(data) {
        if(this.status !== 1) return;

        this.socket.write(`${this.id} ${this.type} ${JSON.stringify(data)}\n`);

        return this;
    }

    /**
     * Sends an error back to the client.
     * @param {Error} error - The error to send.
     * @returns {SocketConnection} The response object for chaining.
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

        Client.closeConnection(this.client, this.id);
        return true;
    }

    /**
     * Closes the socket connection.
     */
    close() {
        if(this.status !== 1) return;
        Client.closeConnection(this.client, this.id);
    }

    /**
     * Gets the status of the request.
     * @returns {number} The status of the request (1 for open, 0 for closed).
     */
    get status() {
        return this.client.openSockets.has(this.id) ? 1 : 0;
    }

    /**
     * Sends data through the socket.
     * @param {any} data - The data to send.
     */
    send(data) {
        return this.write(data);
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

class Client {
    constructor(socket, options = {}, server = null) {

        this._connected = server ? true : false;

        if (typeof socket === "string" && !server) {
            this.socket = net.createConnection(socket);
            this.socketPath = socket;

            this._connectingPromise = new Promise((resolve, reject) => {
                this.socket.on('connect', () => {
                    this._connected = true;
                    this._connectingPromise = null;
                    resolve(this);
                });
    
                this.socket.on('error', (err) => {
                    this._connected = false;
                    reject(err);
                });
            });
        } else {
            this.socket = socket;
        }

        if(!this.socket || !(this.socket instanceof net.Socket)) {
            throw new Error("Invalid socket provided. Must be a net.Socket or a valid socket path.");
        }

        this.options = options;

        this.openSockets = new Set();
        this.messageListeners = new Map();
        this.closeListeners = new Map();

        this.buffer = "";

        // If the client has a parent server
        if(server instanceof Server) {
            this.server = server;
            this.id = uuid();
            this.server.connectedClients.set(this.id, this);
        }

        this.socket.on('error', (err) => {
            // this.socket = null;
            // console.error('Socket error:', err);
            // this.cleanup();
            if (this.options.onError) {
                this.options.onError(err);
            }
        });

        this.socket.on('end', () => {
            this.cleanup();

            if (this.id && this.server) {
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
                    Client.closeConnection(this, id, false);
                    return;
                }

                this.openSockets.add(id);

                if(type === REQUEST){

                    // We received a request
                    if(!this.options.onRequest) return;

                    const req = { id, data, type, client: this };
                    const res = new SocketConnection(this, id, RESPONSE);

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

                    const socketConnection = new SocketConnection(this, id, type, data);
                    if(this.options.onSocket) {
                        this.options.onSocket(socketConnection);
                    }
        
                }
            }
        });
    }

    awaitConnection() {
        if(this._connected) return Promise.resolve(this);
        return this._connectingPromise;
    }

    close(){
        if(this.socket) this.socket.end();
        this.cleanup();
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
     * @returns {Promise<SocketConnection>} A promise that resolves with the socket connection.
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

        const socketClient = new SocketConnection(this, id, OPEN_SOCKET, initialPayload);
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
        this._connected = false;
    }

    static closeConnection(client, id, sendMessage = true) {
        if(!client.openSockets.has(id)) return;
    
        client.openSockets.delete(id);
        client.closeListeners.delete(id);
        client.messageListeners.delete(id);
    
        if(sendMessage) {
            client.socket.write(`${id} ${CLOSE_SOCKET}\n`);
        }
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
            const client = new Client(socket, this.options, this);

            if(options.onClient) {
                options.onClient(client);
            }
        });
    }

    listen(path, callback){
        try {
            if (fs.existsSync(path)) fs.unlinkSync(path);
        } catch (error) {
            console.error("Error removing existing socket file:", error);
        }

        this.server.listen(path, () => {
            if(callback) callback(path);
        });
    }

    close(callback) {
        this.server.close(callback);
    }
}

module.exports = { Client, Server, SocketConnection, REQUEST, RESPONSE, ERROR_RESPONSE, OPEN_SOCKET, CLOSE_SOCKET, PROTOCOL_VERSION };