/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0

    Units are the core part of Akeno, making it modular, extensible, and easy to debug.
*/

// Backend reference
let backend;

const spawn = require('child_process').spawn;
const fs = require('fs');
const nodepath = require('path');

const { xxh32 } = require("@node-rs/xxhash");  // XXHash

const external = new Map;

const modules = new Map;
const addons = new Map;

// Addons and modules can define custom types to be used across other modules.
const types = new Map;

let allow_unrestricted_execution = false;

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

    toJSON(){
        return {
            major: this.major,
            minor: this.minor,
            patch: this.patch,
            release: this.release,
            build: this.build
        };
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

class IndexedEnum {
    constructor(values){
        if(!Array.isArray(values)){
            throw new Error("Enum values must be an array");
        }

        for(let i = 0; i < values.length; i++){
            const value = values[i].toString().toUpperCase();
            this[value] = i;
            this[i] = value;
        }

        this.values = values;
        this.length = values.length;
    }

    has(value){
        if(typeof value === "number"){
            return this[value] !== undefined;
        } else if(typeof value === "string"){
            return this[value.toUpperCase()] !== undefined;
        }
        return false;
    }

    get(value){
        if(typeof value === "number"){
            return this[value];
        } else if(typeof value === "string"){
            return this[value.toUpperCase()];
        }

        return null;
    }
}


/**
 * Manager
 * @description Responsible for providing utilities for managing unit operations in the system.
*/

const Manager = {
    /**
     * Initializes the core backend instance.
     * @param {*} backendInstance
     * @returns {Unit} The initialized backend instance.
     */
    initCore(backendInstance){
        if(backend) {
            throw new Error("Core already initialized, can't do that twice.");
        }

        Manager.toUnit(backendInstance);
        backendInstance.name = "core";
        backendInstance.id = "akeno";

        backend = backendInstance;
        module.exports.backend = backend;

        return backendInstance;
    },

    refreshAddons(){
        const paths = [backend.PATH + "./addons", ...(backend.config.getBlock("server").get("modules") || [])];

        allow_unrestricted_execution = backend.config.getBlock("modules").get("allow_unrestricted_execution", Boolean, false);

        if(allow_unrestricted_execution){
            backend.warn("⚠️  Unrestricted execution of scripts is enabled. Make sure you are in a trusted environment.");
        }

        for (const path of paths) {
            backend.verbose("Scanning for addons: " + path);

            const directories = fs.readdirSync(path, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const dir of directories) {
                try {
                    Manager.loadAddon(path + "/" + dir);
                } catch (error) {
                    backend.error(`Failed to load addon ${dir} from ${path}:`, error);
                }
            }
        }
    },

    module(name){
        return modules.get(name) || addons.get(name) || null;
    },

    // TODO: Enhance
    loadAddon(path){
        if(fs.existsSync(path) && fs.statSync(path).isDirectory() && fs.existsSync(path + "/addon.json")){
            const addonConfig = JSON.parse(fs.readFileSync(path + "/addon.json", "utf8"));

            if(!addonConfig.id || !addonConfig.name){
                throw new Error("Addon must have an id and name");
            }

            // TODO: Protect & manage namespaces

            if(addons.has(addonConfig.id)){
                throw new Error(`Addon with id ${addonConfig.id} already exists`);
            }

            if(!(addonConfig.version instanceof Version)){
                addonConfig.version = new Version(addonConfig.version || 1)
            }

            if(addonConfig.akenoVersion && !backend.version.compare(addonConfig.akenoVersion)){
                throw new Error(`Addon ${addonConfig.id} requires Akeno version ${addonConfig.akenoVersion}, but current version is ${backend.version}`);
            }

            let _mainfile = null;
            if(addonConfig.main) {
                _mainfile = nodepath.normalize(path + "/" + addonConfig.main);

                if(!fs.existsSync(_mainfile)){
                    throw new Error(`Addon main file ${_mainfile} does not exist.`);
                }
            }

            // Validate security of the main file
            if(_mainfile && !allow_unrestricted_execution){
                // const mainFileContent = fs.readFileSync(_mainfile, "utf8");

                // const hash = xxh32(mainFileContent).toString(16);

                // // TODO: This needs a better solution
                // if(![123].includes(hash)){
                //     throw new Error(`Addon ${addonConfig.id} tried to load an unrestricted script file: "${_mainfile}" but was not allowed to for security reasons, or possible tampering was detected. If you are developing this addon or are sure that it is safe, please add an exception in the config, switch to developer mode, or if you 100% trust your environment, set "modules { allow_unrestricted_execution: true }" in the config.`);
                // }
            }

            const addon = _mainfile? require(_mainfile): new Addon;

            if(!(addon instanceof Unit)){
                Manager.toUnit(addon, Addon);
            }

            if(!(addon instanceof Addon)){
                throw new Error("Unit must be of type Addon");
            }

            addon._initialize(addonConfig);

            addon.path = path;
            addon.type = "addon";

            addons.set(addon.id, addon);

            backend.verbose(`Loaded addon: ${addon.name} (${addon.id}) v${addon.version}`);

            if(addon.onLoad){
                try {
                    addon.onLoad(addon, backend);
                } catch (error) {
                    addon.error(`Error during onLoad:`, error);
                }
            }
            return addon;
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

        if(module.onLoad) module.onLoad(backend);

        return module;
    },

    toUnit(object, base = Unit) {
        Object.setPrototypeOf(object, (base || Unit).prototype);
        return object;
    }
}

/**
 * @description An abstract base class representing any unit (module, addon, job, application, etc.) in the system.
 */

class Unit {
    constructor(options = null) {
        if(options) this._initialize(options);
    }

    _initialize(options){
        if(typeof options === "string"){
            return this.id = options;
        }

        if(options.name) this.name = options.name;
        if(options.type) this.type = options.type;
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

    writeLog(level, ...data){
        backend.writeLog(level, this, ...data);
    }

    verbose(...data){
        backend.writeLog(1, this, ...data);
    }

    log(...data){
        backend.writeLog(2, this, ...data);
    }

    warn(...data){
        backend.writeLog(3, this, ...data);
    }

    error(...data){
        backend.writeLog(4, this, ...data);
    }

    fatal(...data){
        backend.writeLog(5, this, ...data);
    }

    info(...data){
        backend.writeLog(0, this, ...data);
    }
}



/**
 * @description Module is an internal or reused module extending the core functionality
 */

class Module extends Unit {
    constructor(options = null) {
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

class Addon extends Unit {}


/**
 * @description Represents a server that handles requests and responses.
 */

class Server extends Unit {}


/**
 * @description App is an user application not altering the core functionality, eg. a website
 */

class App extends Unit {}


/**
 * @description Protocol is describing a communication protocol like HTTP, WebSocket, etc.
 */

class Protocol extends Unit {
    constructor(options = {}){
        super(options);

        if(options.protocol) this.protocol = options.protocol;

        if(!options.name){
            throw new Error("Protocol name is required");
        }
    }

    get enabled(){
        return !!this._enabled;
    }

    set enabled(value){
        value = !!value;
        if(!!this._enabled === value) return;

        if(value){
            this.enable();
        } else {
            this.disable();
        }

        this._enabled = value;
    }
}

class HTTPProtocol extends Protocol {
    constructor(options = {}){
        super(options);

        if(!this.requestFlags) this.requestFlags = {};
    }

    enable(){
        if(this.enabled) return;

        if(!this._initialized){
            this._initialized = true;
            this.init();
        }


        for(const port of this.ports){
            this.server.listen(port, (listenSocket) => {
                if(listenSocket) {
                    this.log(`Listening on port ${port}`);
                    this.server.socket = listenSocket;
                } else {
                    this.error(`Failed to listen on port ${port}`);
                }
            })
        }
    }

    disable(){
        if(!this.enabled) return;

        this.log(`${this.name} server is shutting down...`);

        this.server.close();
        this.server.socket = null;
    }
}




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

        const signature = `\x1b[95m[module]\x1b[0m`;

        this.process.stdout.on('data', (data) => {
            this.log(`${signature} ${data}`);
        });

        this.process.stderr.on('data', (data) => {
            this.error(`${signature} ${data}`);
        });

        this.process.on('error', (error) => {
            this.error(`${signature} Failed to start module: ${error.message}`);
        });

        this.process.on('exit', (code, signal) => {
            if (code !== null) {
                this.log(`${signature} Process exited with code ${code}`);

                if(this.optionsautoRestart){
                    this.log(`${signature} Restarting module...`);
                    this.restart();
                }
            } else {
                this.log(`${signature} Process was killed with signal ${signal}`);
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

module.exports = { Version, Protocol, HTTPProtocol, IndexedEnum, Manager, External, Unit, App, Module, Addon, Server, backend };