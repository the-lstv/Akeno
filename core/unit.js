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

    static isValid(versionString){
        if(typeof versionString !== 'string' || versionString.length === 0){
            return false;
        }

        let i = 0;
        const len = versionString.length;
        let dotCount = 0;
        let hasDigitInSegment = false;

        while(i < len){
            const char = versionString.charCodeAt(i);
            
            if(char >= 48 && char <= 57){ // 0-9
                hasDigitInSegment = true;
                i++;
            } else if(char === 46){ // .
                if(!hasDigitInSegment || dotCount >= 2){
                    return false;
                }
                dotCount++;
                hasDigitInSegment = false;
                i++;
            } else if(char === 45 || char === 43){ // - or +
                break; // Start of pre-release or build metadata
            } else if((char === 120 || char === 88) && !hasDigitInSegment){ // x or X (wildcard)
                hasDigitInSegment = true;
                i++;
            } else if(char === 42){ // * (wildcard)
                hasDigitInSegment = true;
                i++;
            } else {
                return false;
            }
        }

        if(!hasDigitInSegment){
            return false;
        }

        if(i < len && versionString.charCodeAt(i) === 45){
            i++;
            if(i >= len) return false;
            
            hasDigitInSegment = false;
            while(i < len){
                const char = versionString.charCodeAt(i);
                if((char >= 48 && char <= 57) || // 0-9
                   (char >= 65 && char <= 90) || // A-Z
                   (char >= 97 && char <= 122) || // a-z
                   char === 45 || char === 46){ // - or .
                    hasDigitInSegment = true;
                    i++;
                } else if(char === 43){ // +
                    break;
                } else {
                    return false;
                }
            }
            
            if(!hasDigitInSegment) return false;
        }

        if(i < len && versionString.charCodeAt(i) === 43){
            i++;
            if(i >= len) return false;
            
            hasDigitInSegment = false;
            while(i < len){
                const char = versionString.charCodeAt(i);
                if((char >= 48 && char <= 57) || // 0-9
                   (char >= 65 && char <= 90) || // A-Z
                   (char >= 97 && char <= 122) || // a-z
                   char === 45 || char === 46){ // - or .
                    hasDigitInSegment = true;
                    i++;
                } else {
                    return false;
                }
            }
            
            if(!hasDigitInSegment) return false;
        }

        return i === len;
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

        new EventHandler(backendInstance);
        backendInstance.buildHookEvref = backendInstance._events.prepareEvent("build-hook", {
            await: true,
            results: true
        });

        backend = backendInstance;
        module.exports.backend = backend;

        return backendInstance;
    },

    refreshAddons(){
        const paths = [backend.PATH + "./addons", ...(backend.config.getBlock("server").get("modules", Array) || [])];

        allow_unrestricted_execution = backend.config.getBlock("modules").get("allow_unrestricted_execution", Boolean, false);

        if(allow_unrestricted_execution){
            backend.warn("⚠️  Unrestricted execution of scripts is enabled. Make sure you are in a trusted environment.");
        }

        for (const path of paths) {
            // First try to treat the path itself as an addon, then scan for addons inside
            if(Manager.loadAddon(path) === null){
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
        return null;
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

    destroy(){ }

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

class EventHandler {
    static REMOVE_LISTENER = Symbol("event-remove");
    static optimize = true;

    static EventObject = class EventObject {
        compiled = null;
        listeners = [];
        free = [];
        aliases = null;
        completed = false;
        warned = false;
        data = null;

        break = false;
        results = false;
        async = false;
        await = false;
        deopt = false;

        _isEvent = true;

        remove(index) {
            const listeners = this.listeners;
            if (listeners[index] == null) return;
            this.compiled = null;

            if(listeners.length === 1 || listeners.length === this.free.length + 1) { listeners.length = 0; this.free.length = 0; return; }

            listeners[index] = null;
            this.free.push(index);
        }

        emit(data) {
            return EventHandler.emit(this, data);
        }

        /**
         * Recompile the event's internal emit function for performance.
         * Compilation may get skipped in which case the normal emit loop is used.
         */
        recompile() {
            const listeners = this.listeners;
            const listenersCount = listeners.length;

            // TODO: Unroll for large amounts of listeners
            if (listenersCount < 2 || listenersCount >= 950 || EventHandler.optimize === false || this.deopt === true) return;

            const collectResults = this.results === true;
            const breakOnFalse = this.break === true;

            // if(this.last_compile_count === listenersCount && this.factory) {
            //     this.compiled = this.factory(EventHandler.REMOVE_LISTENER, listeners, this);
            //     return;
            // }

            const parts = [];
            parts.push("(function(RL,listeners,event){var l=listeners;");
            for (let i = 0; i < listenersCount; i++) {
                const li = listeners[i];
                if (li === null) continue;
                parts.push("var f", i, "=l[", i, "].callback;");
            }

            if(this.await === true) {
                parts.push("l=undefined;return(async function(a,b,c,d,e){var v");
            } else {
                parts.push("l=undefined;return(function(a,b,c,d,e){var v");
            }

            if (collectResults) parts.push(",r=[]");
            parts.push(";");

            // Main call loop
            for (let i = 0; i < listenersCount; i++) {
                const li = listeners[i];
                if (li === null) continue;

                parts.push("v=");

                if(this.await === true) {
                    parts.push("await f");
                } else {
                    parts.push("f");
                }

                parts.push(i, "(a,b,c,d,e);");

                // Optional break behavior
                if (breakOnFalse) {
                    parts.push("if(v===false)return", collectResults ? " r" : "", ";");
                }

                if (li.once) {
                    if (collectResults) {
                        parts.push("if(v!==RL)r.push(v);");
                    }
                    parts.push("event.remove(", i, ");");
                } else {
                    if (collectResults) {
                        parts.push("if(v===RL){event.remove(", i, ")}else{r.push(v)};");
                    } else {
                        parts.push("if(v===RL){event.remove(", i, ")};");
                    }
                }
            }

            if (collectResults) parts.push("return r;");
            parts.push("})})");

            const factory = eval(parts.join(""));
            this.compiled = factory(EventHandler.REMOVE_LISTENER, listeners, this);
        }
    }

    /**
     * @param {object} target Possibly deprecated; Binds the event handler methods to a target object.
     * @param {object} options Event handler options.
     */
    constructor(target, options = {}) {
        EventHandler.prepareHandler(this, options);
        if(target){
            target._events = this;

            ["emit", "quickEmit", "on", "once", "off"].forEach(method => {
                if (!target.hasOwnProperty(method)) target[method] = this[method].bind(this);
            });

            this.target = target;
        }
    }

    static prepareHandler(target, options = {}){
        target.events = new Map();
        if(options) target.eventOptions = options;
    }

    /**
     * Prepare or update an event object with given name and options.
     * @param {string|symbol} name Name of the event.
     * @param {object} options Event options.
     * @returns {EventObject} Prepared event object.
     * 
     * @warning If you are going to use the event reference, remember to dispose of it properly to avoid memory leaks.
     */
    prepareEvent(name, options = undefined){
        let event = this.events.get(name);

        if(!event) {
            event = new EventHandler.EventObject();
            this.events.set(name, event);
        }

        if(options){
            if(options.completed !== undefined) {
                event.completed = options.completed;
                if(!event.completed) event.data = null;
            }

            if(options.break !== undefined) event.break = !!options.break;
            if(options.results !== undefined) event.results = !!options.results;
            if(options.async !== undefined) event.async = !!options.async;
            if(options.await !== undefined) {
                event.await = !!options.await;
                this.compiled = null; // Need to recompile
            }
            if(options.deopt !== undefined) {
                event.deopt = !!options.deopt;
                this.compiled = null; // Remove compiled function
            }

            if(options.data !== undefined) event.data = options.data;
        }

        return event;
    }

    on(name, callback, options){
        const event = name._isEvent? name: (this.events.get(name) || this.prepareEvent(name));
        if(event.completed) {
            if(event.data) Array.isArray(event.data) ? callback.apply(null, event.data) : callback(event.data); else callback();
            if(options && options.once) return;
        }

        options ||= {};
        options.callback = callback;

        const free = event.free;
        if (free.length > 0) {
            event.listeners[free.pop()] = options;
        } else {
            const amount = event.listeners.push(options);
            if(amount > (this.eventOptions?.maxListeners || 1000) && !event.warned) {
                console.warn(`EventHandler: Possible memory leak detected. ${event.listeners.length} listeners added for event '${name.toString()}'.`);
                event.warned = true;
            }
        }

        event.compiled = null; // Invalidate compiled function
    }

    off(name, callback){
        const event = (name._isEvent? name: this.events.get(name));
        if(!event) return;

        const listeners = event.listeners;

        for(let i = 0; i < listeners.length; i++){
            const listener = listeners[i];
            if(!listener) continue;

            if(listener.callback === callback){
                event.remove(i);
            }
        }
    }

    once(name, callback, options){
        options ??= {};
        options.once = true;
        return this.on(name, callback, options);
    }

    /**
     * Emit an event with the given name and data.
     * @param {string|object} name Name of the event to emit or it's reference
     * @param {Array} data Array of values to pass
     * @param {object} event Optional emit options override
     * @returns {null|Array|Promise<null|Array>} Array of results (if options.results is true) or null. If event.await is true, returns a Promise.
     */
    emit(name, data) {
        const event = name._isEvent ? name : this.events.get(name);
        if (!event || event.listeners.length === 0) return event && event.await ? Promise.resolve(null) : null;

        const listeners = event.listeners;
        const listenerCount = listeners.length;

        const collectResults = event.results === true;

        const isArray = data && Array.isArray(data);
        if(!isArray) data = [data];
        const dataLen = isArray ? data.length : 0;

        let a = undefined, b = undefined, c = undefined, d = undefined, e = undefined;

        if (dataLen > 0) a = data[0];
        if (dataLen > 1) b = data[1];
        if (dataLen > 2) c = data[2];
        if (dataLen > 3) d = data[3];
        if (dataLen > 4) e = data[4];

        // Awaiting path
        if (event.await === true) {
            if(!event.compiled) {
                event.recompile();
            }

            if(event.compiled) {
                return event.compiled(a, b, c, d, e);
            }

            const breakOnFalse = event.break === true;
            const returnData = collectResults ? [] : null;

            return (async () => {
                for (let i = 0; i < listeners.length; i++) {
                    const listener = listeners[i];
                    if (listener === null) continue;

                    let result = (dataLen < 6)? listener.callback(a, b, c, d, e): listener.callback.apply(null, data);
                    if (result && typeof result.then === 'function') {
                        result = await result;
                    }

                    if (collectResults) returnData.push(result);

                    if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                        event.remove(i);
                    }

                    if (breakOnFalse && result === false) break;
                }
                return returnData;
            })();
        }

        if(listenerCount === 1) {
            const listener = listeners[0];
            if (listener === null) return null;

            let result = listener.callback(a, b, c, d, e);

            if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                event.remove(0);
            }

            return collectResults? [result]: null;
        }

        if(!event.compiled) {
            event.recompile();
        }

        if(event.compiled) {
            return event.compiled(a, b, c, d, e);
        }

        const breakOnFalse = event.break === true;
        const returnData = collectResults ? [] : null;

        if(dataLen < 6){
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                if (listener === null) continue;

                let result = listener.callback(a, b, c, d, e);
                if (collectResults) returnData.push(result);

                if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                    event.remove(i);
                }

                if (breakOnFalse && result === false) break;
            }
        } else {
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                if (listener === null) continue;

                let result = listener.callback.apply(null, data);
                if (collectResults) returnData.push(result);

                if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                    event.remove(i);
                }

                if (breakOnFalse && result === false) break;
            }
        }

        return returnData;
    }

    /**
     * Faster emit, without checking or collecting return values. Limited to 5 arguments.
     * @warning This does not guarantee EventHandler.REMOVE_LISTENER or any other return value functionality. Async events are not supported with quickEmit.
     * @param {string|object} event Event name or reference.
     * @param {*} a First argument.
     * @param {*} b Second argument.
     * @param {*} c Third argument.
     * @param {*} d Fourth argument.
     * @param {*} e Fifth argument.
     */
    quickEmit(name, a, b, c, d, e){
        const event = name._isEvent ? name : this.events.get(name);
        if (!event || event.listeners.length === 0) return false;

        if(event.await === true) {
            throw new Error("quickEmit cannot be used with async/await events.");
        }

        if(event.listeners.length === 1) {
            const listener = event.listeners[0];
            listener.callback(a, b, c, d, e);
            if (listener.once) {
                event.remove(0);
            }
            return;
        }

        if(!event.compiled) {
            event.recompile();
        }

        if(event.compiled) {
            event.compiled(a, b, c, d, e);
            return;
        }

        const listeners = event.listeners;
        for(let i = 0, len = listeners.length; i < len; i++){
            const listener = listeners[i];
            if(listener === null) continue;

            if(listener.once) {
                event.remove(i);
            }

            listener.callback(a, b, c, d, e);
        }
    }

    flush(){
        this.events.clear();
    }

    /**
     * Create an alias for an existing event.
     * They will become identical and share listeners.
     * @param {*} name Original event name.
     * @param {*} alias Alias name.
     */
    alias(name, alias){
        const event = (name._isEvent? name: this.events.get(name)) || this.prepareEvent(name);
        event.aliases ??= [];

        if(!event.aliases.includes(alias)) event.aliases.push(alias);
        this.events.set(alias, event);
    }

    completed(name, data = undefined, options = null){
        this.emit(name, data);

        options ??= {};
        options.completed = true;
        options.data = data;

        this.prepareEvent(name, options);
    }
}

module.exports = { Version, Protocol, HTTPProtocol, IndexedEnum, Manager, External, Unit, App, Module, Addon, Server, EventHandler, backend };