let backend;

const spawn = require('child_process').spawn;
const fs = require('fs');
const modules = new Map;

class Module {
    constructor(name, options = {}){
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

        modules.set(this.name, this);

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
}

const ModuleManager = module.exports = {
    init($) {
        backend = $;
    },

    modules,

    Module,

    loadModule(name, options){
        return new Module(name, options);
    }
}