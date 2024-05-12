//libraries
let
    ipc = require('@node-ipc/node-ipc').default,
    { exec, spawn } = require('child_process'),
    uuid = (require("uuid")).v4,
    pidusage = require('pidusage')
;

//globals
let
    APISocketID = "eg_API",
    bridge,
    socket,
    connected = false,
    initialized = false,
    processes = {},
    handleListeners,
    handleReplies
;

ipc.config.id = 'eg_persistentHost';
ipc.config.retry = 1500;
ipc.config.logDepth = 2;

process.on('uncaughtException', (err) => {
	console.debug("blah blah blah, it's probably fine, just some poorly written module can't throw a proper error instead of crashing the whole thread.\nThe error was: ", err);
});

async function build(){
    ipc.serve(
        function(){
            bridge = ipc.server;
            bridge.handle = function(evt, fn){
                bridge.on(evt, async(data, _socket) => {
                    if(!data.id){
                        return fn(data.data, _socket)
                    }

                    dispatch(evt + ".reply", {id: data.id, reply: await fn(data.data, _socket)}, false, "")
                });
            }
            bridge.on(
                'app.hi',
                function(data, _socket){
                    // This below randomly stopped working due to IPC not providing the ID anymore; Possible security issue?
                    // if(_socket.id !== APISocketID)return;
                    socket = _socket;
                    connected = true;
                    console.log(`==  API CONNECTED == : ${socket.id}`);
                    dispatch("hi", "world!")
                    if(!initialized){
                        main()
                        initialized = true;
                    }
                }
            );
            bridge.on('connect', () => {
                console.log(`==  CONNECT ==`);
            });
            bridge.on('socket.disconnected', (socket, id) => {
                connected = false;
                console.log(`==  DISCONNECT == :  ${socket} ${id}`);
            });
        }
    );
    
    ipc.server.start();
}

build()

function dispatch(evt, data, force, prefix = 'app.'){
    if(force || (connected && socket)){
        return bridge.emit(socket, prefix + evt, data)
    }
}

function handleListener(evt){
    if(handleListeners.includes(evt))return;
    handleListeners.push(evt)
    socket.on(evt + ".reply",
        function(data){
            handleReplies[data.id] = data.reply;
        }
    )
}

async function ask(evt, data){
    handleListener(evt)
    if(connected && socket){
        let ID = uuid();
        bridge.emit(socket, 'app.' + evt, {id :ID, data: data})
        return new Promise((r,j)=>{
            let i, interval = setInterval(()=>{
                if(handleReplies[ID]){
                    r(handleReplies[ID])
                }
                i++
                if(i>300){
                    clearInterval(interval)
                    r(null)
                }
            },10)
        })
    }
    return null
}

async function main(){

    function isRunning(id){
        return processes[id] && processes[id].running
    }

    //This is the persistent API allowing to run and communicate between the web API and host process.
    //The goal is to have separate processes, so that in case of the API restarting or crashing, the apps stay persistent.

    bridge.on('app.start', (args) => {
        console.log("== STARTING == :", args);
        let id = args[0];
        if(isRunning(id))return;
        processes[id] = spawn('srv', args)
        processes[id].running = true;

        processes[id].stdout.on('data', (data) => {
            dispatch("stdout."+id, data.toString())
        });

        processes[id].stderr.on('data', (data) => {
            dispatch("stderr."+id, data.toString())
        });

        processes[id].on('close', (code) => {
            processes[id].running = false;
            dispatch("close."+id, code)
        });
    });

    bridge.handle('app.status.running', (id) => {
        return isRunning(id)
    });

    bridge.handle('app.status', (id) => {
        if(!processes[id]) return{running: false, initialized: false}

        return new Promise(r=>{
            pidusage(processes[id].pid, (err, stats) => {
                if(!stats)stats = {};
                r({
                    running: isRunning(id),
                    initialized: true,
                    pid: processes[id].pid,
                    cpu: stats.cpu || 0,
                    memory: stats.memory || 0,
                    uptime: stats.elapsed || 0
                })
            })
        })
    });

    bridge.on('app.kill', (id) => {
        processes[id].kill()
        processes[id].running = false
    });

    bridge.handle('app.srv', (command) => {
        //Dont worry about the use of exex here - only the backend should be executing the app.srv command, with no user input.

        return new Promise(r=>{
            exec('srv ' + command, (error, stdout, stderr) => {
                r(error||stdout)
            });              
        })
    });

    bridge.on('app.stdin', (evt) => {

        if(!Array.isArray(evt) || typeof evt[0] !== "number" || typeof evt[1] !== "string") return;

        let id = evt[0],
            command = evt[1]
        ;

        // If the server is not runnig, do nothing
        if(!isRunning(id))return;
        
        // Write to the server's STDIN
        processes[id].stdin.write(command)
    });

    bridge.on('app.stdin.end', (id) => {
        if(!isRunning(id))return;
        processes[id].stdin.end();
    });
}