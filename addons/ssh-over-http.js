let { Client } = require('ssh2'),
    url = require('url')
;

let decoder = new TextDecoder(), sessions = {};

module.exports = {
    HandleSocket: {
        open(ws) {
            let query = url.parse("?" + ws.query, true).query;
    
            // Currently, only password authentication is available :(
            ws.password = null;
    
            sessions[ws.uuid] = new Client();
    
            ws.connectSSHClient = function (){
                if(!ws.password) return false;
    
                try{

                    sessions[ws.uuid].on('ready', () => {
                        sessions[ws.uuid].shell({height: query.height? +query.height: 600, width: query.width? +query.width: 800, term: query.term? +query.term: "xterm"}, (err, stream) => {

                            ws.send(`]login;`);

                            if (err){
                                ws.send(`]closing:${err};error`);
                                ws.close();
                                delete sessions[ws.uuid]
                                return
                            }
    
                            sessions[ws.uuid].stream = stream;
    
                            sessions[ws.uuid].on('error', (err) => {

                                ws.send(`]closing:${err};error`);
                                ws.close();
                                delete sessions[ws.uuid]

                            })
    
                            stream.on('close', () => {
    
                                ws.send(`]closing`);
                                ws.close();
                                delete sessions[ws.uuid]
                                return
    
                            }).on('data', (data) => {
    
                                ws.send(data, true)
    
                            }).on('error', (err) => {

                                ws.send(`]closing:${err};error`);
                                ws.close();
                                delete sessions[ws.uuid]

                            }).stderr.on('data', (data) => { });
                        })
                    }).connect({

                        host: query.host || "localhost",
                        port: query.port || 22,
                        username: query.user || "user",
                        password: ws.password

                    });

                } catch(err) {

                    ws.send(`]closing:${err};error`);
                    ws.close();
                    delete sessions[ws.uuid]

                }
            }
        },
        
        message(ws, message, isBinary) {
            if(!ws.password){
                if(!ws.connectSSHClient) return;

                ws.password = decoder.decode(message)
                return ws.connectSSHClient()
            }
    
            if(sessions[ws.uuid]) {
                // TODO: Window resizing
                // if(message...){
                //     sessions[ws.uuid].stream.setWindow()
                // }

                sessions[ws.uuid].stream.stdin.write(Buffer.from(message))
            }
        },
        
        
        close(ws, code, message) {
            sessions[ws.uuid].end();
            delete sessions[ws.uuid]
        }
    }
}