let backend;

const spawn = require('child_process').spawn;
const fs = require('fs');

const external = new Map;

const modules = new Map;
const addons = new Map;


/**
 * Manager
 * @description Responsible for providing utilities for managing unit operations in the system.
*/

const Manager = {
    init(backendInstance){
        Object.setPrototypeOf(backendInstance, Unit.prototype);
        backendInstance.name = "api";

        backend = backendInstance;
    },

    load(){
        const paths = [backend.PATH + "./addons", ...(backend.config.block("server").get("modules") || [])];

        for (const path of paths) {
            const directories = fs.readdirSync(path, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const dir of directories) {
                console.log(`Found directory: ${dir}`);
            }
        }
    },

    module(name){
        
    },

    loadAddon(path){

    }
}

/**
 * * @class Unit
 * @description An abstract base class representing any unit (module, addon, job, application, etc.) in the system.
 */

class Unit {
    constructor(identifier = null, options = {}) {
        if (this.constructor === Unit) {
            throw new Error("Cannot instantiate abstract class Unit directly.");
        }

        this.name = identifier;
    }

    start(){ }
    stop(){ }
    reload(){ }
    restart(){ }
    kill(){ }
    disable(){ }
    enable(){ }
    status(){ }

    send(message){ }

    writeLog(level, data){
        backend.writeLog(data, level, this);
    }

    verbose(...data){
        backend.writeLog(data, 1, this);
    }

    log(...data){
        backend.writeLog(data, 2, this);
    }

    warn(...data){
        backend.writeLog(data, 3, this);
    }

    error(...data){
        backend.writeLog(data, 4, this);
    }

    fatal(...data){
        backend.writeLog(data, 5, this);
    }
}



class Module extends Unit {
    constructor(name, options = {}) {
        super(name, options);
        this.log = backend.createLoggerContext(name);

        if(this.name !== null){
            modules.set(this.name, this);
        }
    }
}



class App extends Unit {}



class Addon extends Unit {
    constructor(name, options = {}) {
    }
}



class External extends Unit {
    constructor(name, options = {}){
        super(name, options);

        if(this.name !== null){
            external.set(this.name, this);
        }

        this.name = name;
        this.options = options;
        this.process = null;

        if(!options.path){
            throw new Error('Module path is required');
        }

        if(!fs.existsSync(options.path)){
            throw new Error('Module does not exist');
        }

        this.restart();
    }

    restart(){
        this.process = spawn('node', [this.options.path], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });

        const signature = `\x1b[95m[module]\x1b[0m [${this.name}]`;

        this.process.stdout.on('data', (data) => {
            console.log(`${signature} ${data}`);
        });

        this.process.stderr.on('data', (data) => {
            console.error(`${signature} ${data}`);
        });

        this.process.on('error', (error) => {
            console.error(`${signature} Failed to start module: ${error.message}`);
        });

        this.process.on('exit', (code, signal) => {
            if (code !== null) {
                console.log(`${signature} Process exited with code ${code}`);

                if(this.optionsautoRestart){
                    console.log(`${signature} Restarting module...`);
                    this.restart();
                }
            } else {
                console.log(`${signature} Process was killed with signal ${signal}`);
            }
        });

        return this.process;
    }

    destroy(){
        if(this.process){
            this.process.kill('SIGINT');
            this.process = null;
            // TODO: Detach from parent process
        }
    }
}

module.exports = { Manager, External, Unit, App, Module, Addon };