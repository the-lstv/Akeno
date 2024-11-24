const net = require('net');
const fs = require('fs');


class ipc_client {
    constructor(socketPath){
        this.socketPath = socketPath;
        this.client = null;
        this.request_id = 0;
        this.requests = new Map();
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
            })

            this.client.on('data', (data) => {
                let response;

                try {
                    response = JSON.parse(data);
                    const callback = this.requests.get(Number(response.id));
                    if(callback) callback(response.error, response.data);
                    this.requests.delete(response.id);
                } catch {}
            })
        })
    }

    close(){
        if(this.client) this.client.end();
        return true
    }


    /*
    
        Important!
        You have to call client.close() after you are done sending requests, otherwise your process will remain open.

    */

    async request(command, callback) {
        if(!this.client) {
            try { await this.connect() } catch (error) {
                if(!callback) throw error;
                return callback(error);
            }
        }

        const id = this.request_id++;
        const request = `${id} ${command}`;


        if(!callback) return new Promise((resolve, reject) => {
            this.requests.set(id, (error, response) => error? reject(error): resolve(response));
            this.client.write(request);
        })

        this.requests.set(id, callback)
        this.client.write(request)
    }
}


class ipc_server {
    constructor(options){
        this.ipc_sock = net.createServer((socket) => {
            socket.on("data", (data) => {
                const args = data.toString().trim().split(" "), id = args[0];

                args.shift()

                if(options.onRequest) options.onRequest(socket, args, (error, data) => {
                    socket.write(JSON.stringify({
                        id, error, data
                    }))
                })
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
}


module.exports = { ipc_client, ipc_server }