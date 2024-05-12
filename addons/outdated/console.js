

/*!

    ! IMPORTANT !

    THIS ADDON IS SEVERELY OUT OF DATE AND SHOULD **NOT** BE EVER USED FOR SSH CLIENTS!
    PLEASE EMBED A NEW SECURE SHELL TRANSMISSION INTO YOUR APP.

    ! IMPORTANT !

*/


// let Backend,sockets={},sshConnections=[];
// const { Client } = require('ssh2');

// function sshConn(id, ip, other, wsID){
//     /*
//         WS Signals:
//             - 0: Data
//             - 1: Server closed
//             - 3: Error
//             - 4: Ping
//         WS Incomming signals:
//             - 0: Data
//             - 1: Close on demand
//             - 2: Ping reply
//             - 4: TTY resize
//             - 5: Request new TTY session
    
//     */
//     return new Promise(resolve=>{
//         sshConnections[id]={ws:sockets[wsID],log:""};
//         let SSH=sshConnections[id],conn=new Client();
//         SSH.conn=conn;
//         conn.on('ready', () => {
//             conn.shell({rows: 24, cols: 80, height: 600, width: 800, term: "vt100"},(err, stream) => {
//                 if (err){
//                     if(SSH.ws){
//                         SSH.ws.send("2"+err);
//                         SSH.ws.close();
//                     }
//                     sshConnections[ws.server.id]
//                     return resolve(false)
//                 }
//                 SSH.stream=stream;
//                 stream.on('close', () => {
//                     if(SSH.ws){
//                         SSH.ws.send("1")
//                         SSH.ws.close()
//                         delete sshConnections[id]
//                     }
//                     conn.end();
//                 }).on('data', (data) => {
//                     SSH.log+=data;
//                     if(SSH.log.length>7000)SSH.log=SSH.log.slice(SSH.log.length-7000);
//                     if(SSH.ws){SSH.ws.send("0"+data)}
//                 })
//                 sshConnections[id]=SSH;
//                 resolve(true)
//             })
//         }).connect({
//             host: ip,
//             port: other.port,
//             username: other.user,
//             password: other.password
//         });
//     })
// }


// module.exports = {
//     Initialize(Backend_){
//         Backend = Backend_;
//     },
//     async HandleSocket({User, req, ws, send, message, shift}){
//         if(ws.busy)return;
//         with(Backend){
//             switch(req.event){
//                 case 0:
//                     let id=+shift();
//                     if(!id||isNaN(id)){
//                         ws.close()
//                         return;
//                     }
//                     let info = await Backend.EmulateRequest("/v1/user/creations/"+id+"?details","GET",null,{
//                         req:User
//                     })
//                     if(info&&info.success){
//                         ws.server = info.data;
//                         ws.service = info.service;
//                         ws.type = ws.server.type;
//                         ws.id = ws.server.id;
//                         //Hello
//                         sockets[ws.uuid]=ws;
//                         if(sshConnections[ws.id]){
//                             let same=Object.values(sockets).filter(s=>s.id==ws.id&&s.uuid!==ws.uuid);
//                             if(same.length){
//                                 for(let s of same){
//                                     s.send("1Connection has been open from a different locaion")
//                                     s.close()
//                                 }
//                             }
//                             sshConnections[ws.id].ws=ws; //Reconnect
//                             ws.conn=sshConnections[ws.id];
//                             console.log("reconnecting");
//                             ws.send("0"+ws.conn.log)
//                         }else{
//                             ws.busy=true;
//                             ws.conn = await sshConn(ws.id, ws.server.ip, ws.service, ws.uuid);
//                             ws.busy=false;
//                             if(!ws.conn){
//                                 ws.close()
//                                 return
//                             }
//                         }
//                     }else{
//                         ws.send("2Failed to fetch server information.")
//                         ws.close()
//                         return;
//                     }
//                 break;
//                 case 1:
//                     message=message.toString();
//                     let code = message[0];
//                     message=message.slice(1)
//                     switch(code){
//                         case"0":
//                             if(sshConnections[ws.id]){
//                                 sshConnections[ws.id].stream.stdin.write(message)
//                             }
//                         break;
//                         case"1":
//                             delete sshConnections[ws.id]
//                             ws.close()
//                         break;
//                         case"4":
//                             //resizing stuff
//                         break;
//                         case"5":
//                         break;
//                     }
//                     // switch(ws.type){
                        
//                     // }
//                 break;
//                 case 2:
//                     //Goodbye
//                     delete sockets[ws.uuid];
//                 break;
//             }
//         }
//     },
// }