let backend;

const spawn = require('child_process').spawn;
const fs = require('fs');

const external = new Map;

const modules = new Map;
const addons = new Map;

const types = new Map;


// Please make sure to use the correct Unit class for the type of object that you are creating.
// See descriptions or docs for more information on Units.



class Version {
    /**
     * @description Version class for managing and comparing version numbers
     * @param {number|string|array<number|string>|object} major - Major version number, or a string, array or object containing version information
     * @param {number} minor - Minor version number
     * @param {number} patch - Patch version number
     * @param {string} release - Pre-release version string
     * @param {string} build - Build metadata string
     * 
     * @example
     * new Version("1.2.*") // Version { major: 1, minor: 2, patch: 0 }
     * new Version(1) // Version { major: 1, minor: 0, patch: 0 }
     * new Version([1, 2, "*"]) // Version { major: 1, minor: 2, patch: 0 }
     * new Version(new Version(1, 2, "*")) // Version { major: 1, minor: 2, patch: 0 }
     * new Version({ major: 1, minor: 2, patch: "*" }) // Version { major: 1, minor: 2, patch: 0 }
     */
    constructor(major, minor, patch, release = null, build = null){
        this.wildcardMask = 0b000;
        this.set(major, minor, patch, release, build);
    }

    toString(){
        return `${this.major}.${this.minor}.${this.patch}${this.release ? '-' + this.release : ''}${this.build ? '+' + this.build : ''}`;
    }

    set(major = 0, minor = 0, patch = 0, release = null, build = null){
        if(Array.isArray(major)){
            this.major = major[0];
            this.minor = major[1];
            this.patch = major[2];
            this.release = major[3] || null;
            this.build = major[4] || null;
        } else if(major instanceof Version || typeof major === 'object' && major !== null){
            this.major = major.major;
            this.minor = major.minor;
            this.patch = major.patch;
            this.release = major.release || null;
            this.build = major.build || null;
        } else if(typeof major === 'string'){
            const versionParts = major.split('.');
            const mainVersion = versionParts[0] || "0";
            const minorVersion = versionParts[1] || "0";
            let patchVersion = versionParts[2] || "0";
            let release = null;
            let build = null;

            // Handle pre-release and build metadata
            if (patchVersion && typeof patchVersion === "string") {
                const patchMatch = patchVersion.match(/^(\d+|[x*]+)?(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/);
                if (patchMatch) {
                    patchVersion = patchMatch[1] || patchVersion;
                    release = patchMatch[2] || null;
                    build = patchMatch[3] || null;
                }
            }

            this.major = mainVersion;
            this.minor = minorVersion;
            this.patch = patchVersion;
            this.release = release;
            this.build = build;
        } else {
            this.major = major;
            this.minor = minor;
            this.patch = patch;
            this.release = release || null;
            this.build = build || null;
        }

        if(this.major === "*" || this.major === "x"){
            this.wildcardMask |= 0b100;
        }

        if(this.minor === "*" || this.minor === "x"){
            this.wildcardMask |= 0b010;
        }

        if(this.patch === "*" || this.patch === "x"){
            this.wildcardMask |= 0b001;
        }

        this.major = Math.floor(Number(this.major) || 0);
        this.minor = Math.floor(Number(this.minor) || 0);
        this.patch = Math.floor(Number(this.patch) || 0);

        return this;
    }

    setRelease(release){
        if(typeof release !== "string" || release.length === 0){
            this.release = null;
            return this;
        }
        
        this.release = release;
        return this;
    }

    setBuild(build){
        if(typeof build !== "string" || build.length === 0){
            this.build = null;
            return this;
        }

        this.build = build;
        return this;
    }

    increment(major = 0, minor = 0, patch = 0){
        if(typeof major !== 'number' && major !== null && major !== undefined && (typeof major === "string"? major.indexOf(".") !== -1 : true)){
            const version = new Version(major);
            major = version.major;
            minor = version.minor;
            patch = version.patch;
        }

        this.set(
            this.major + (major || 0),
            this.minor + (minor || 0),
            this.patch + (patch || 0)
        );

        return this;
    }

    compare(comparator){
        if(typeof comparator !== 'string'){
            return Version.matches(this, comparator);
        }

        if(comparator.length === 0 || comparator === "any" || comparator === "*"){
            return true;
        }

        const rules = comparator.split("||");
        for(let rule of rules) {
            rule = rule.trim();

            if(rule.length === 0){
                continue;
            }

            if(rule === "any" || rule === "*"){
                return true;
            }

            let result = false;
            for(let part of rule.split(" ")){
                part = part.trim();

                if(part.length === 0){
                    continue;
                }

                let operator = null;
                let version = part;

                const match = part.match(/^([<>=!~^]+)?\s*(.+)?$/);
                if (match) {
                    operator = match[1] || null;
                    version = match[2] || part;
                }

                result = Version.matches(this, version, operator);
                if(!result) break;
            }

            if(result) return true;
        }

        return false;
    }

    static diff(versionA, versionB){
        versionA = versionA instanceof Version ? versionA : new Version(versionA);
        versionB = versionB instanceof Version ? versionB : new Version(versionB);

        // Compare major, minor, patch with wildcards
        let cmp = 
            (versionB.wildcardMask & 0b100? 0 : versionA.major - versionB.major) ||
            (versionB.wildcardMask & 0b010? 0 : versionA.minor - versionB.minor) ||
            (versionB.wildcardMask & 0b001? 0 : versionA.patch - versionB.patch)
        ;

        // Pre-releases are considered lower than normal releases
        if (cmp === 0) {
            const aPre = versionA.release != null && versionA.release !== "stable";
            const bPre = versionB.release != null && versionB.release !== "stable";

            if (aPre && !bPre) {
                cmp = -1;
            } else if (!aPre && bPre) {
                cmp = 1;
            } else if (aPre && bPre) {
                // Compare pre-release strings lexicographically
                cmp = String(versionA.release).localeCompare(String(versionB.release));
            }
        }

        return cmp;
    }

    static matches(versionA, versionB, operator = null){
        if(versionB === null || versionB === undefined){
            return false;
        }

        versionA = versionA instanceof Version ? versionA : new Version(versionA);
        versionB = versionB instanceof Version ? versionB : new Version(versionB);

        const cmp = Version.diff(versionA, versionB);

        switch(operator){
            case ">":
                return cmp > 0;

            case "<":
                return cmp < 0;

            case ">=":
                return cmp >= 0;

            case "<=":
                return cmp <= 0;

            case "!=":
                return cmp !== 0;

            case null: case "": case "=": case "==": case "===":
                return cmp === 0;

            case "*": case "any":
                return true;

            case "^":
                return (
                    versionA.major === versionB.major &&
                    (versionA.minor > versionB.minor ||
                    (versionA.minor === versionB.minor && versionA.patch >= versionB.patch))
                );

            case "~":
                return (
                    versionA.major === versionB.major &&
                    versionA.minor === versionB.minor &&
                    versionA.patch >= versionB.patch
                );

            default:
                throw new Error(`Invalid operator: ${operator}`);
        }
    }
}


/**
 * Manager
 * @description Responsible for providing utilities for managing unit operations in the system.
*/

const Manager = {
    init(backendInstance){
        Manager.toUnit(backendInstance);
        backendInstance.name = "api";

        backend = backendInstance;
    },

    refreshAddons(){
        const paths = [backend.PATH + "./addons", ...(backend.config.block("server").get("modules") || [])];
        
        for (const path of paths) {
            backend.verbose("Scanning for addons: " + path);

            const directories = fs.readdirSync(path, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const dir of directories) {
                Manager.loadAddon(path + "/" + dir);
            }
        }
    },

    module(name){
        return modules.get(name) || null;
    },

    loadAddon(path){
        if(fs.statSync(path).isDirectory() && fs.existsSync(path + "/index.js")){
            backend.verbose("Loading addon: " + path);            
            path += "/index.js";
        }
    },

    loadModule(path) {
        path = backend.PATH + path;

        const module = require(path);

        if(!(module instanceof Unit)){
            Manager.toUnit(module, Module);
        }

        if(!(module instanceof Module)){
            throw new Error("Unit must be of type Module");
        }

        module.path = path;
        module.type = "module";

        modules.set(module.id, module);

        if(!(module.version instanceof Version)){
            module.version = new Version(module.version || 1);
        }

        if(module.Initialize) module.Initialize(backend);

        return module;
    },

    toUnit(object, base = Unit) {
        Object.setPrototypeOf(object, (base || Unit).prototype);
    }
}

/**
 * @description An abstract base class representing any unit (module, addon, job, application, etc.) in the system.
 */

class Unit {
    constructor(options) {
        if(options) this.initialize(options);
    }

    initialize(options){
        if(typeof options === "string"){
            return this.id = options;
        }

        if(options.name) this.name = options.name;
        if(options.id) this.id = options.id;

        if(options.version){
            this.version = (options.version instanceof Version)? options.version: new Version(options.version);
        }
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



/**
 * @description Module is an internal or reused module extending the core functionality
 */

class Module extends Unit {
    constructor(options = {}) {
        super(options);
    }

    registerType(type, constructor){
        type = this.id + "." + type;

        if(types.has(type)) {
            throw new Error(`Type ${type} already exists, cannot re-register.`);
        }

        types.set(type, constructor);
    }
}



/**
 * @description Addon is an external module/plugin that is adding new features
 */

class Addon extends Unit {
    constructor(name, options = {}) {
    }
}


/**
 * @description App is an user application not altering the core functionality, eg. a website
 */

class App extends Unit {}




/**
 * @description An abstract base class representing any unit (module, addon, job, application, etc.) in the system.
 */

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

module.exports = { Version, Manager, External, Unit, App, Module, Addon };