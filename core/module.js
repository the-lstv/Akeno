let backend;

const spawn = require('child_process').spawn;
const modules = new Map;

const ModuleManager = module.exports = {
    init($) {
        backend = $;
    },

    modules,

    loadModule(name, options){
        const { path, autoRestart } = options;

        const child = spawn('node', [path], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });

        modules.set(name, { process: child, options });

        const signature = `\x1b[95m[module]\x1b[0m [${name}]`;

        child.stdout.on('data', (data) => {
            console.log(`${signature} ${data}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`${signature} ${data}`);
        });

        child.on('error', (error) => {
            console.error(`${signature} Failed to start module: ${error.message}`);
        });

        child.on('exit', (code, signal) => {
            if (code !== null) {
                console.log(`${signature} Process exited with code ${code}`);

                if(autoRestart){
                    console.log(`${signature} Restarting module...`);
                    ModuleManager.loadModule(name, options)
                }
            } else {
                console.log(`${signature} Process was killed with signal ${signal}`);
            }
        });

        return child;
    },

    // getResourceUsage(){
    //     const usage = {}

    //     for(const [name, module] of modules.entries()){
    //         usage[name] = module.process.memoryUsage();
    //     }

    //     return usage;
    // }
}
