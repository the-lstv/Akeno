/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0
    Version: 2.1.0
    Description: A performance optimized web application framework for Akeno.
*/

let
    // Libraries
    fs = require("fs"),
    nodePath = require("path"),

    parser, // Will be defined later
    parserContext,

    { xxh3 } = require("@node-rs/xxhash"),

    { parse, configTools, stringifyBlock } = require("atrium"),
    Units = require("akeno:units"),
    backend = require("akeno:backend"),
    akeno = require("akeno:server")
;

// May be removed later
const applications = new Map/*<string, WebApp>*/;

// Temporary
const globalApp = backend.globalApp;

class WebApp extends Units.App {
    constructor(path, options = {}) {
        super();

        this.path = nodePath.normalize(path); path = null;
        this.basename = this.name = nodePath.basename(this.path);
        this.root = this.path;
        this.type = "akeno.web.WebApp";

        this.configMtime = null;
        this.loaded = false;

        // @experimental
        new Units.EventHandler(this);
        this.cacheStoreEvref = this._events.prepareEvent("refreshed-cache");

        /**
         * @warning Do not use this for routing - it is only a copy to keep track of domains.
         */
        this.domains = new Set;
        this.modules = new Map;

        applications.set(this.path, this);

        this._rootPathAllowed = true;

        // Managed C++ WebApp instance (we defer its creation until we have the config loaded to avoid unnecessary calls)
        this.webApp = null;

        this.reload(options, true);

        this.name = this.config.getBlock("app").get("name", String, this.basename);
    }

    #instantiateWebApp(options = {}) {
        if (this.webApp) return;
        if (!this.config) throw new Error("Config must be loaded before instantiating WebApp");
        this.webApp = new akeno.WebApp(this.path, options);
    }

    reload(options = {}, checkConfig = true) {
        options ??= {};

        // We'll be sending some config to the C++ WebApp, so it's best we do it in one call
        const pendingOptionsUpsert = {};

        // Note: Due to how this currently works, we first need to load options that will be passed to the WebApp as options, then other ones
        let toInstantiate = false;

        if (options.config) {
            if (typeof options.config === "object" && !options.config.data) {
                // Config is possibly JSON, will need to parse
                throw new Error("Provided config to WebApp seems to be an object, please provide an Atrium lookupTable or config string to be parsed. (App " + path + ")");
            } else if (typeof options.config === "object" && options.config.data) {
                // Config is provided as configTools
                this.config = options.config; // TODO: configTools should be a class
            } else if (options.config instanceof Map) {
                // Config is provided as a parsed Map of blocks
                this.config = configTools(options.config);
            } else if (typeof options.config === "string") {
                // Config is provided as a string
                this.config = configTools(parse(options.config, {
                    strict: true,
                    asLookupTable: true
                }));
            } else {
                throw new Error("Provided config is not valid. (App " + path + ")");
            }

            this._memoryConfig = true;
            delete options.config;
        }

        if ((!this.config || checkConfig) && !this._memoryConfig) {
            this.configPath = this.path + (options.configPath ? nodePath.posix.resolve("/", options.configPath) : "/app.conf");

            const configPath = this.path + "/app.conf";
            let currentMtime = null;

            try {
                currentMtime = fs.statSync(configPath).mtimeMs;
            } catch { }

            if (currentMtime && this.configMtime !== currentMtime) {
                this.readConfig();
            } else return;

            if (!this.config) throw "Invalid or missing config";
        }

        this.#applyCaseOverrides();

        if (this.loaded) this.verbose("Hot-reloading");

        const is_enabled = backend.db.apps.get(`${this.path}.enabled`, Boolean);
        this.enabled = (is_enabled === null ? true : is_enabled) || false;

        const serverBlock = this.config.getBlock("server");

        const enabledDomains = serverBlock.get("domains", Array, []);

        const custom_root = serverBlock.get("root", String, null);

        // TODO: Support this in C++ too
        // this._rootPathAllowed = serverBlock.get("allowRootPath", Boolean, true);

        this.root = custom_root && custom_root.length > 0? this.resolvePath(custom_root, null, true).full : this.path;
        pendingOptionsUpsert.root = this.root;

        // TODO: Handle ports; the block should be redesigned as a protocol instead
        // const enabledPorts = this.config.getBlock("server").get("port") || [];

        // TODO: Implement the rest of features

        // TODO: Module system

        const browserRequirements = this.config.getBlock("browserSupport")?.properties || null;
        // Convert to tuple <int chrome, int firefox, bool has_requirements>
        // Could be packed somehow, an array is a bit expensive
        pendingOptionsUpsert.browserSupport = [browserRequirements?.chrome || 0, browserRequirements?.firefox || 0, !!browserRequirements];

        if (enabledDomains.length > 0 || this.domains.size > 0) {
            const domains = new Set([...enabledDomains, ...this.domains]);

            for (let domain of domains) {
                if (!domain || typeof domain !== "string") {
                    server.warn("Invalid domain name \"" + domain + "\" for web application \"" + this.basename + "\".");
                    continue;
                }

                if (!enabledDomains.includes(domain)) {
                    globalApp.route(domain, null);
                    this.domains.delete(domain);
                    continue;
                }

                // This is done lazily, which also technically means that nothing happens if the app doesn't have a valid route
                this.#instantiateWebApp(pendingOptionsUpsert);

                globalApp.route(domain, this.webApp);
                this.domains.add(domain);
            }
        }

        if(toInstantiate && !this.webApp) this.#instantiateWebApp(pendingOptionsUpsert); else if(this.webApp) this.webApp.setOptions(pendingOptionsUpsert);

        if(this.webApp) {
            // TODO: Warning: Temporarily, error pages can only be added/changed, but not fully removed, even after config reloads. If the file is not found, it will fallback to the default (or an empty page).
            for(const errorBlock of this.config.getBlocks("errors")) {
                for(const code in errorBlock.properties) {
                    const page = errorBlock.get(code, String);
                    this.webApp.setErrorPage(parseInt(code), page || null);
                }
            }

            // Start over
            if (this.webApp) this.webApp.clearAttributes();

            if(this.config.data.has("route")) {
                for(const route of this.config.getBlocks("route")) {
                    this.warn("Route-to blocks are replaced by location-alias and will be removed. Implicitly converting to an alias, which may have different behavior.\nApp " + this.path + ", offending block:\n" + stringifyBlock(route));

                    for(const pattern of route.attributes) {
                        const target = route.get("to", String);
                        if (!target) continue;
                        this.webApp.applyAttributes(pattern, { target, type: 1 });
                    }
                }
            }

            // TODO: Path overrides & addons
            this._hasAttribs = this.config.data.has("location") || this.config.data.has("addon") || this.config.data.has("redirect") || this.config.data.has("handle");
            if (this._hasAttribs) {
                for (const redirect of this.config.getBlocks("redirect")) {
                    for(const pattern of redirect.attributes) {
                        const to = redirect.get("to", String);
                        if (!to) continue;
    
                        // Note: Replaced by location redirect
                        this.webApp.applyAttributes(pattern, { target: to, type: 2 });
                    }
                }
    
                // Addons - Load addon, block the path
                if (this.config.data.has("addon")) {
                    for (const addon of this.config.getBlocks("addon")) {
                        const at = addon.attributes[0];
                        const path = this.resolvePath(at).full;
    
                        // Deny the path for security
                        this.webApp.applyAttributes(at, { deny: true });
    
                        Units.Manager.loadAddon(path);
                    }
                }

                // General path attributes
                for (const route of this.config.getBlocks("location")) {
                    let rule = null;
                    if(route.has("deny")) {
                        rule = { deny: true };
                    } else {
                        if (route.has("redirect")) {
                            rule = { target: route.get("redirect", String), type: 2 };
                        } else if (route.has("alias")) {
                            rule = { target: route.get("alias", String), type: 1 };
                        } else if (route.has("reroute")) {
                            rule = { target: route.get("reroute", String), type: 3 };
                        }
                    }
    
                    if(rule) for (const pattern of route.attributes) {
                        this.webApp.applyAttributes(pattern, rule);
                    }
                }
            }
        }

        if (this.config.data.has("esbuild")) {
            const targets = this.config.getBlock("esbuild").get("targets", Array, []);
            this.esbuildTargets = targets.length > 0 && targets;
        } else delete this.esbuildTargets;

        // TODO: This could be set by a generic module settings block
        if (this.config.data.has("ls")) {
            const version = this.config.getBlock("ls").get("version", String, null);
            this.lsVersion = version;
        } else delete this.lsVersion;

        this.loaded = true;

        // Preload configured files into cache
        void this.preloadFiles();
    }

    readConfig() {
        if (this._memoryConfig) return true;

        if (!this.configPath) {
            return false;
        }

        try {
            this.configMtime = fs.statSync(this.configPath).mtimeMs;
        } catch {
            this.configMtime = null;
        }

        this.config = configTools(parse(fs.readFileSync(this.configPath, "utf8"), {
            strict: true,
            asLookupTable: true
        }));

        return true;
    }

    #isConfigBlock(value) {
        return value && typeof value === "object" && typeof value.get === "function" && typeof value.getBlock === "function";
    }

    #applyCaseOverrides() {
        if (!this.config) return;

        const caseEntries = this.config.getBlocks("case_override");
        if (!caseEntries || caseEntries.length === 0) return;

        this.warn("case_override is an experimental feature");

        for (const entry of caseEntries) {
            if (!entry || !Array.isArray(entry.attributes) || entry.attributes.length === 0) continue;

            let match = false;
            for (const attr of entry.attributes) {
                const compare = this.#resolveCaseField(attr.name);

                let compareFn = (value) => compare === value;

                if (compare instanceof Units.Version) {
                    compareFn = (value) => compare.compare(value);
                }

                if (compare && Array.isArray(attr.values) && attr.values.some(compareFn)) {
                    match = true;
                    break;
                }
            }

            if (!match) continue;
            this.#applyOverride(entry);
        }
    }

    #resolveCaseField(name) {
        switch (name) {
            case "basename":
                return this.basename;
            case "path":
                return this.path;
            case "name":
                return this.name;
            case "root":
                return this.root;
            case "dir": case "dirname":
                return nodePath.dirname(this.path);
            case "mode":
                return backend.modes[backend.mode];
            case "akeno_version":
                return backend.version;
            default:
                if (name.startsWith("env.")) {
                    const envKey = name.slice(4);
                    return process.env ? process.env[envKey] : undefined;
                }

                if (Object.prototype.hasOwnProperty.call(this, name) && typeof this[name] !== "function") {
                    return this[name];
                }

                return undefined;
        }
    }

    #applyOverride(entry) {
        if (!entry.properties || typeof entry.properties !== "object") return;

        for (const blockName of Object.keys(entry.properties)) {
            const override = entry.properties[blockName];
            if (!override) continue;

            // Only overrides blocks; properties aren't supported at the top level (yet)
            if (this.#isConfigBlock(override)) {
                const targetName = override.name || blockName;
                const blocks = this.config.data.get(targetName) || [];

                if (blocks.length <= 1) {
                    this.config.data.set(targetName, [override]);
                    continue;
                }

                this.error(`case_override: Block "${targetName}" has multiple instances; cannot override (App ${this.path})`);
            }
        }
    }

    async preloadFiles() {
        if (!this.config?.data?.has("preload")) return;

        const blocks = this.config.getBlocks("preload");
        const paths = [];

        for (const block of blocks) {
            for (const item of block.attributes || []) {
                if (typeof item === "string" && item.length > 0) paths.push(item);
            }
        }

        if (paths.length === 0) return;

        // TODO: Preload
    }

    /**
     * Resolve a relative, absolute, or root path to a full path while safely avoiding directory traversal attacks.
     * @param {string} path - The path to resolve
     * @param {string} relative - The base path to resolve against when the input path is relative.
     * @param {boolean} useRootPath - Indicates whether to always use the root path.
     * @returns 
     */
    resolvePath(path, relative = null, useRootPath = false) {
        // Preserve original input for URL construction
        const original = path;
        let isRelative = false;

        if (path.charCodeAt(0) === 126) { // '~'
            path = path.slice(1);
            useRootPath = true;
        } else if (path.charCodeAt(0) !== 47) { // not starting with '/'
            isRelative = true;
        } else if (path.length >= 3 && path.charCodeAt(1) === 126 && path.charCodeAt(2) === 47) { // '/~/'
            path = path.slice(2);
            useRootPath = true;
        }

        // if (!this._rootPathAllowed) {
        //     useRootPath = false;
        // }

        const root = useRootPath? this.path: ((relative && isRelative)? this.#merge(this.root || this.path, relative): (this.root || this.path));

        // Resolve to an absolute filesystem path for the server
        const resolvedFsRelative = nodePath.posix.resolve("/", path);
        const full = nodePath.join(root, resolvedFsRelative);

        // Safety: prevent traversal outside of root
        if (!full.startsWith(root)) {
            return { full, relative: nodePath.sep, useRootPath: true };
        }

        // For client links, keep relative input as-is (e.g., "./assets/main.js")
        const relativeForLink = isRelative ? original : resolvedFsRelative;

        return { full, relative: relativeForLink, useRootPath };
    }

    #merge(base, target) {
        base = nodePath.resolve(base);
        target = nodePath.resolve(target);

        if (target.startsWith(base + nodePath.sep) || target === base) {
            return target;
        }

        if (base.startsWith(target + nodePath.sep) || base === target) {
            return base;
        }

        return nodePath.join(base, target);
    }

    /*<Glitter transpile> ~ */
    destroy() {
        for (let domain of this.domains) {
            globalApp.route(domain, null);
        }

        this.domains.clear();
        this.modules.clear();
        this.webApp?.destroy();
        this.webApp = null;
        this.loaded = false;
        this.config = null;
        this.events.clear();
        applications.delete(this.path);
        super.destroy();
    }

    ws(options) {
        // TODO:
    }
}

const server = module.exports = new class WebServer extends Units.Module {
    moduleProviders = new Map;
    customBlocks = new Map;

    constructor() {
        super({ name: "web", id: "akeno.web", version: "1.4.0-beta" });
        this.registerType("WebApp", WebApp);
        this.WebApp = WebApp;

        // @experimental
        new Units.EventHandler(this);
        this.cacheStoreEvref = this._events.prepareEvent("refreshed-cache");
    }

    onLoad() {
        // Constants
        const header = backend.config.getBlock("web").get("htmlHeader", String, `<!-- Server-generated code. Powered by Akeno v${backend.version} - https://github.com/the-lstv/Akeno -->`) || '';

        initParser(header);
        this.reload(null, true);
    }

    /**
     * Handles IPC requests related to web applications
     * TODO: To be updated
     */
    onIPCRequest(segments, req, res) {
        switch (segments[0]) {
            case "list":
                res.end([...applications.values()].map(app => ({
                    name: app.name,
                    basename: app.basename,
                    path: app.path,
                    enabled: app.enabled,
                    // ports: [...app.ports],
                    domains: [...app.domains],
                    modules: [...app.modules.keys()],
                })));
                break;

            case "list.domains":
                res.end(this.listDomains(req.data[0]));
                break;

            case "list.getDomain":
            case "getFirstDomain":
                res.end(this.getFirstDomain(req.data[0]));
                break;

            case "enable":
                res.end(this.enableApp(req.data[0]));
                break;

            case "disable":
                res.end(this.disableApp(req.data[0]));
                break;

            case "reload":
                if (!req.data || !req.data[0]) {
                    this.reload();
                    res.end(true);
                } else {
                    const app = applications.get(this.resolveApplicationPath(req.data[0]));
                    if (!app) return res.end(false);

                    app.reload();
                    res.end(true);
                }
                break;

            case "tempDomain":
                res.end(this.tempDomain(req.data[0], req.data[1] || null));
                break;

            case "info":
                if (!req.data || !req.data[0]) return res.error("No application specified").end();
                const appInfo = this.getApp(req.data[0]);
                if (!appInfo) return res.error("Application not found").end();

                res.end({
                    name: appInfo.name,
                    basename: appInfo.basename,
                    path: appInfo.path,
                    enabled: appInfo.enabled,
                    ports: [...appInfo.ports],
                    domains: [...appInfo.domains],
                    modules: [...appInfo.modules.keys()],
                });
                break;

            default:
                res.end("Invalid request");
        }
    }

    /**
     * Reloads web applications based on the configuration. If a specific application path is provided, only that application will be reloaded.
     * Also reponsible for discovering applications.
     * 
     * @param {string|null} specific_app - The path of the specific application to reload, or null to reload all applications.
     * @param {boolean} [skip_config_refresh=false] - Whether to skip refreshing the configuration before reloading.
     * @returns {void}
     */
    async reload(specific_app, skip_config_refresh) {
        if (specific_app) return !!this.load(specific_app);

        if (!skip_config_refresh) backend.refreshConfig();

        const start = performance.now();

        const webConfig = backend.config.getBlock("web");
        const locations = webConfig.get("locations", Array, []);

        // Looks for valid application locations
        for (let location of locations) {
            if (location.startsWith("./")) location = backend.path + location.slice(1);

            if (!fs.existsSync(location.replace("/*", ""))) {
                this.warn("Web application (at " + location + ") does not exist - skipped.");
                continue;
            }

            // Handle wildcard (multi) locations
            if (location.endsWith("*")) {
                let appDirectory = nodePath.normalize(location.slice(0, -1) + "/");

                for (let path of fs.readdirSync(appDirectory)) {
                    path = appDirectory + path;

                    if (!fs.statSync(path).isDirectory() || !fs.existsSync(path + "/app.conf")) continue;
                    locations.push(path);
                }
                continue;
            }

            if (!fs.statSync(location).isDirectory()) {
                this.warn("Web application (at " + location + ") is a file - skipped.");
                continue;
            }

            if(!fs.existsSync(nodePath.join(location, "app.conf"))) {
                this.warn("Web application (at " + location + ") does not contain an app.conf file - skipped. You can add one (see docs), or switch from WebApp to a simple FileServer instead");
                continue;
            }

            this.load(location);
        }

        this.log(`${skip_config_refresh ? "Loaded" : "Reloaded"} ${locations.length} web application${locations.length !== 1 ? "s" : ""} in ${(performance.now() - start).toFixed(2)}ms`);
    }

    // TODO:
    load(path, options = {}) {
        path = nodePath.normalize(path);

        let app = applications.get(path);

        if (!app) {
            try {
                app = new WebApp(path, options);
            } catch (error) {
                this.warn("Web application (at " + path + ") failed to load due to an error: ", error);
                return false;
            }

            if (!app) return false;
        } else {
            app.reload(options);
        }

        if (!app.config) return false;
        return app;
    }

    registerModuleProvider(name, providerCallback) {
        this.moduleProviders.set(name, providerCallback);
    }

    unregisterModuleProvider(name) {
        this.moduleProviders.delete(name);
    }

    registerCustomBlock(name, handler) {
        this.customBlocks.set(name, handler);
    }

    unregisterCustomBlock(name) {
        this.customBlocks.delete(name);
    }

    // --- Utility functions ---

    /**
     * Get application from its path or name.
     * @param {string} path - The path or name of the application.
     * @returns {WebApp|null} - The application object or null if not found.
     */
    getApp(path) {
        path = this.resolveApplicationPath(path);
        if (!path) return null;

        return applications.get(path);
    }

    /**
     * Resolve an application path by its name or path.
     * @param {string} path - The path or name of the application.
     * @returns {string|null} - The resolved application path or null if not found.
     */
    resolveApplicationPath(path) {
        path = nodePath.normalize(path);

        if (!path) return null;
        if (applications.has(path)) return path; // Direct match
        if (path.includes("/") && fs.existsSync(path)) return path;

        for (const app of applications.values()) {
            if (app.basename === path) return app.path;
        }

        return null;
    }

    enableApp(app_path) {
        if (!(app_path = this.resolveApplicationPath(app_path))) return false;

        const app = applications.get(app_path);
        app.enabled = true;
        backend.db.apps.commitSet(`${app_path}.enabled`, true);
        return true;
    }

    disableApp(app_path) {
        if (!(app_path = this.resolveApplicationPath(app_path))) return false;

        const app = applications.get(app_path);
        app.enabled = false;
        backend.db.apps.commitSet(`${app_path}.enabled`, false);
        return true;
    }

    listDomains(app_path) {
        if (!(app_path = this.resolveApplicationPath(app_path))) return false;

        const app = applications.get(app_path);
        if (!app) return false;

        return [...app.domains];
    }

    getFirstDomain(app_path) {
        const list = this.listDomains(app_path);
        return list && list[0];
    }

    tempDomain(app_path, domain = null) {
        const app = this.getApp(app_path);
        if (!app) return false;

        let random = domain || backend.uuid();
        globalApp.route(random, app.webApp);

        return random;
    }
}

const PARSER_FLAGS = {
    USING_LS_CSS: 1,
    USING_LS_JS: 2,
    USING_LS: 3,
    GOOGLE_FONTS_PRECONNECT: 4,
    SET_DEFAULT_CHARSET: 5,
    SET_DEFAULT_VIEWPORT: 6
};

globalApp.registerFileProcessor(async (id, url, path, mimeType) => {
    // TODO: very ugly; should be pointed from C++ rather than looking up
    const npath = nodePath.normalize(path);
    const app = [...applications.values()].find(app => {
        const appPath = app.path;
        return npath === appPath || npath.startsWith(appPath + nodePath.sep);
    });

    const file = (path && path.replace(app.path, "")) || "<not found>";
    app.verbose(`Serving "${url}"${(file && file !== url)? ` (${file})` : ""} as ${mimeType}`);

    let buffer, linkedPaths = [];

    // Normalize path and use posix to ensure consistency across platforms (Windows breaks stuff)
    // TODO: Handle from C++
    // if (app.root) {
    //     // make sure leading slash is honored
    //     path = nodePath.posix.join(
    //         app.root,
    //         nodePath.posix.resolve('/', path || '/')
    //     );
    // } else {
    //     path = nodePath.posix.normalize(path);
    // }

    if(mimeType === "text/html" || mimeType === "text/markdown") {
        // Prepare parser context data (what the callbacks should see)
        // Shared object to reduce allocations (https://jsbm.dev/JeOxl30Y6fOj1)
        const data = parserContext.data;
        data.url = url;                          // URL as the client requested it
        data.path = app.path;                    // Path to the app
        data.file = path;                        // Path to the file
        data.directory = nodePath.dirname(path); // Directory of the file
        data.app = app;                          // Reference to the app
        data.secure = true;                      // Whether HTTPs should be used; there is no way to do this conditionally now
        data.flags.clearAll();                   // Bitfield
        data.ls_version = null;                  // Tempoarary
        data.linkedPaths = linkedPaths;          // Array to be populated with paths that should be linked for caching purposes

        // path, parserContext, sanitize_html, template_enabled
        // TODO: Allow to enable/disable templates and sanitization per-path or per-app

        let newLinkedPaths;
        if (mimeType === "text/html") {
            [buffer, newLinkedPaths] = parser.fromFile(path, parserContext, false, true);
        } else {
            [buffer, newLinkedPaths] = parser.fromMarkdownFile(path, parserContext, false, false);
        }
        
        // Paths given by the parser
        linkedPaths.push(...newLinkedPaths);

        app.warn(`Linked to ${file}:\n${newLinkedPaths.join('\n')}`);
    }

    // Processing hooks go here

    if(!buffer) {
        const ext = nodePath.extname(path).slice(1).toLowerCase();
        
        // TODO: This isn't optimal; later if no processing is needed and "true" is returned, C++ should serve the file on it's side to avoid unnecessarily moving buffers
        buffer = await fs.promises.readFile(
            path,
            (ext === 'js' || ext === 'css') ? 'utf8' : null
        )

        if(backend.helper.TRANSPILE_EXTENSIONS.has(ext)) {
            // Calls any build hooks, addons & tranpiles with esbuild
            // TODO: Let apps disable or config esbuild again
            const result = await backend.helper.ContentProcessor.build({ content: buffer, ext, targets: (app && app.esbuildTargets) || backend.esbuildTargets, asBuffer: true, filePath: path, app });
            if(result.success) {
                buffer = result.result;

                if (backend.helper.JAVASCRIPT_EXTENSIONS.has(ext)) {
                    mimeType = 'text/javascript';
                } else if (['scss', 'sass'].includes(ext)) {
                    mimeType = 'text/css';
                }
            }
        }
    }

    // Send the processed buffer back
    globalApp.completeProcessing(id, buffer, linkedPaths, mimeType);

    // Notify that a file has been cached
    // TODO: Optimize
    const evData = [path, null, app];
    server.emit(server.cacheStoreEvref, evData);
    app.emit(app.cacheStoreEvref, evData);
});

function initParser(header) {
    parser = new akeno.HTMLParser({
        header,
        buffer: true,
        compact: backend.compression.codeEnabled,

        // On HTML text
        onText(text, parent, context) {
            if (!text || text.length === 0) return;

            // Inline script compression
            if (parent === "script") {
                const scriptType = (typeof context?.getTagAttribute === "function" ? context.getTagAttribute("type") : "")?.toLowerCase?.() || "";
                const scriptFormat = (typeof context?.getTagAttribute === "function" ? context.getTagAttribute("format") : "")?.toLowerCase?.() || "";

                if (scriptType.includes("json") || scriptType === "importmap") {
                    try {
                        return JSON.stringify(JSON.parse(text)).replace(/</g, "\\u003c");
                    } catch {
                        return text.replace(/</g, "\\u003c");
                    }
                }

                if (!backend.compression.codeEnabled) {
                    return true;
                }

                const buildOptions = {
                    content: text,
                    ext: "js",
                    targets: backend.esbuildTargets,
                    asBuffer: false,
                    filePath: context?.data?.path,
                    app: context?.data?.app
                };

                if (scriptType === "module") {
                    buildOptions.format = "esm";
                }

                if (scriptFormat === "iife") {
                    buildOptions.format = "iife";
                }

                return backend.helper.ContentProcessor.buildSync(buildOptions).result;
            }

            // Inline style compression
            if (parent === "style") {
                if (!backend.compression.codeEnabled) {
                    return true;
                }

                // TODO: Idea; could have a special attribute to support inline scss (editor won't like it though)
                return backend.helper.ContentProcessor.buildSync({ content: text, ext: "css", targets: backend.esbuildTargets, asBuffer: false, filePath: context?.data?.path, app: context?.data?.app }).result;
            }

            // Parse with Atrium, text gets sent back to C++, blocks get handled via onBlock
            parse(text, context);
        }
    });

    parserContext = parser.createContext();
    parserContext.data = { flags: new Units.BitSet, break: false };

    parserContext.constructor.prototype.break = function () {
        this.data.break = true;
    };

    // Block processor
    parserContext.constructor.prototype.onBlock = function (block) {
        const parent = this.getTagName();
        const blockHandler = server.customBlocks.get(block.name);

        // Addons can now define custom blocks
        if (blockHandler) {
            try {
                blockHandler(block, this, parent); // Block, context, parent
            } catch (error) {
                globalApp.warn(`Error in custom block handler for block "${block.name}":`, error);
            }
            return;
        }

        // Built-in blocks
        switch (block.name) {
            case "use":
                // Modules
                for (const entry of block.attributes) {
                    const has_component_list = typeof entry !== "string";

                    const scriptAttributes = `${block.properties.defer ? " defer" : block.properties.async ? " async" : ""}`;

                    let attrib = has_component_list ? entry.name : entry;
                    let components = has_component_list && entry.values.length > 0 ? [] : backend.constants.EMPTY_ARRAY;

                    // We sort alphabetically and remove duplicates to maximize cache hits
                    // This is the fastest implementation based on my benchmark: https://jsbm.dev/Au74tivWZWKEo
                    if (has_component_list) {
                        // Google Fonts are case-sensitive
                        const is_google_fonts = attrib === "google-fonts";

                        let last = "";
                        entry.values.sort();
                        for (let i = 0, len = entry.values.length; i < len; i++) {
                            let v = entry.values[i];
                            if (!v) continue;
                            let lower = is_google_fonts ? v : v.toLowerCase();
                            if (lower !== last) {
                                components.push(lower);
                                last = lower;
                            }
                        }
                    }

                    const v_start_index = attrib.lastIndexOf(":");

                    let version = v_start_index !== -1 ? attrib.substring(v_start_index + 1) : null;
                    if (v_start_index !== -1) attrib = attrib.substring(0, v_start_index);

                    const provider = server.moduleProviders.get(attrib.split("/")[0].split(".")[0]);
                    if (provider) {
                        try {
                            provider({ version, attrib, components, scriptAttributes, context: this, block });
                            if(this.data.break) {
                                this.data.break = false;
                                break;
                            }
                            continue;
                        } catch (error) {
                            globalApp.warn(`Error in module provider for "${attrib}":`, error);
                        }
                    }

                    if (attrib.includes("/")) {
                        if (attrib.startsWith("http")) {
                            server.warn("Error in app " + this.data.path + ": @use does not allow direct URL imports (\"" + attrib + "\") - please define a custom @source or use a different way to import your content.");
                            break;
                        }

                        const resolvedPath = this.data.app.resolvePath(attrib, this.data.directory);
                        
                        const path = resolvedPath.full;
                        const link = (resolvedPath.useRootPath ? "/~" : "") + resolvedPath.relative || attrib;

                        if (!fs.existsSync(path)) {
                            this.data.app.warn("Error: File \"" + path + "\" does not exist (constructed from \"" + attrib + "\").");
                            break;
                        }

                        // Link the path for caching
                        // The server then knows what files are linked to what and can get smart about it
                        this.data.linkedPaths.push(path);

                        const mtime = `?mtime=${(fs.statSync(path).mtimeMs).toString(36)}`;
                        const extension = attrib.slice(attrib.lastIndexOf('.') + 1);

                        switch (extension) {
                            case "js": case "mjs": case "cjs":
                                this.write(`<script src="${link}${mtime}" ${components.join(" ")}${scriptAttributes}></script>`)
                                break;
                            case "css": case "scss":
                                this.write(`<link rel=stylesheet href="${link}${mtime}" ${components.join(" ")}>`)
                                break;
                            case "json":
                                let content = fs.readFileSync(path, "utf8");
                                try {
                                    content = JSON.stringify(JSON.parse(content));
                                } catch { }
                                content.replace(/</g, "\\u003c"); // Prevent script tag injection

                                this.write(`<script type="application/json" id="${components.length ? components.join(",") : attrib}">${content}</script>`)
                                break;
                            default:
                                this.data.app.warn("Error: Unknown file extension \"" + extension + "\" for file \"" + attrib + "\"");
                                break;
                        }
                    } else {
                        this.data.app.warn("Error: Unknown module \"" + attrib + "\"");
                    }
                }
                break;

            case "page":
                if (parent !== "head") {
                    this.data.app.warn("Error: @page can only be used in <head>, instead was found in <" + parent + ">.");
                    break
                }

                if (block.properties.charset) {
                    this.write(`<meta charset="${block.properties.charset}">`);
                } else {
                    if (!(this.data.flags.has(PARSER_FLAGS.SET_DEFAULT_CHARSET))) {
                        this.data.flags.set(PARSER_FLAGS.SET_DEFAULT_CHARSET);
                        this.write(`<meta charset="utf-8">`);
                    }
                }

                if (block.properties.title) {
                    this.write(`<title>${block.properties.title}</title>`)
                }

                if (block.properties.description) {
                    this.write(`<meta name="description" content="${block.properties.description}">`);
                }

                if (block.properties.keywords) {
                    this.write(`<meta name="keywords" content="${block.properties.keywords}">`);
                }

                if (block.properties.author) {
                    this.write(`<meta name="author" content="${block.properties.author}">`);
                }

                if (block.properties.copyright) {
                    this.write(`<meta name="copyright" content="${block.properties.copyright}">`);
                }

                if (block.properties.themeColor) {
                    this.write(`<meta name="theme-color" content="${block.properties.themeColor}">`);
                }

                if (block.properties.rating) {
                    this.write(`<meta name="rating" content="${block.properties.rating}">`);
                }

                if (block.properties.viewport) {
                    this.write(`<meta name="viewport" content="${block.properties.viewport}">`);
                } else {
                    if (!(this.data.flags.has(PARSER_FLAGS.SET_DEFAULT_VIEWPORT))) {
                        this.data.flags.set(PARSER_FLAGS.SET_DEFAULT_VIEWPORT);
                        this.write(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
                    }
                }

                let bodyAttributes = (this.data.flags.has(PARSER_FLAGS.USING_LS_CSS)) ? "ls" : "";

                if (this.data.flags.has(PARSER_FLAGS.USING_LS_CSS)) {
                    if (block.properties.theme) {
                        bodyAttributes += ` ls-theme="${block.properties.theme}"`;
                    }

                    if (block.properties.accent) {
                        bodyAttributes += ` ls-accent="${block.properties.accent}"`;
                    }

                    if (block.properties.style) {
                        bodyAttributes += ` ls-style="${block.properties.style}"`;
                    }
                }

                if (block.properties.font) {
                    bodyAttributes += (this.data.flags.has(PARSER_FLAGS.USING_LS_CSS)) ? ` style="--font:${block.properties.font}"` : ` style="font-family:${block.properties.font}"`;
                }

                if (block.properties.favicon) {
                    const baseName = nodePath.basename(block.properties.favicon);
                    let extension = baseName, lastIndex = baseName.lastIndexOf('.');

                    if (lastIndex !== -1) {
                        extension = baseName.slice(lastIndex + 1);
                    }

                    let mimeType = backend.mime.getType(extension) || "image/x-icon";

                    this.write(`<link rel="shortcut icon" href="${block.properties.favicon}" type="${mimeType}">`);
                }

                this.setBodyAttributes(bodyAttributes);

                // if(typeof block.properties.meta === "object"){
                //     for(let key in block.properties.meta){
                //         this.write(`<meta name="${key}" content="${block.properties.meta[key]}">`);
                //     }
                // }
                break;

            case "import":
                if (!this.data.path) break;

                const asStyle = block.properties.as === "inline-style";
                const asScript = block.properties.as === "inline-script";

                for (let item of block.attributes) {
                    const path = this.data.app.resolvePath(item, this.data.directory).full;

                    if(!asStyle && !asScript) {
                        try {
                            this.import(path);
                        } catch (error) {
                            this.data.app.warn("Failed to import: " + item + " (" + path + ")", error);
                        }
                    } else {
                        const className = block.properties.class ? ` class="${block.properties.class}"` : "";
                        try {
                            let content = fs.readFileSync(path, "utf8");
                            if(asStyle) {
                                content = backend.helper.ContentProcessor.buildSync({ content, ext: "css", targets: backend.esbuildTargets, asBuffer: false, filePath: path, app: this.data.app }).result;
                                this.write(`<style${className}>${content}</style>`);
                            } else if(asScript) {
                                content = backend.helper.ContentProcessor.buildSync({ content, ext: "js", targets: backend.esbuildTargets, asBuffer: false, filePath: path, app: this.data.app }).result;
                                this.write(`<script${className}>${content}</script>`);
                            }
                        } catch (error) {
                            this.data.app.warn("Failed to import (inline): " + item + " (" + path + ")", error);
                        }
                    }
                }
                break;

            case "importRaw": // TODO:
                if (!this.data.path) break;

                for (let item of block.attributes) {
                    const path = this.data.app.resolvePath(item, this.data.directory).full;

                    try {
                        let content = fs.readFileSync(path, "utf8");
                        this.write(!!block.properties.escape ? content.replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : content);
                    } catch (error) {
                        this.data.app.warn("Failed to import (raw): " + item + " (" + path + ")", error);
                    }
                }
                break;

            case "file-scope-key":
                if (!this.data.file) break;
                this.write(xxh3.xxh64(nodePath.dirname(this.data.file)).toString(16));
                break;

            case "print": case "write": case "echo":
                for (let attrib of block.attributes) {
                    this.write(attrib.replace(/\$\w+/, () => { return "" }))
                }
                break;

            default:
                block = null;
        }
    }
}

/**
 * Common libraries that can be directly imported with @use out of the box.
 * TODO: Should later be moved to a separate addon
 * 
 * Includes:
 * - Google Fonts
 * - Bootstrap Icons
 * - Font Awesome
 * - Highlight.js
 * - Marked
 * - PixiJS (+ filters and advanced blend modes)
 * - Three.js
 * 
 * Any other npm library from CDNJS or jsDelivr (custom CDN import syntax):
 * Usage: @use(npm/libname:version[components]);
 * 
 * Note: components are normalized (sorted, deduplicated, and lowercased)
 */
{
    // const PROVIDER = "https://cdnjs.cloudflare.com/ajax/libs";
    const PROVIDER = "https://cdn.jsdelivr.net/npm";

    const VERSION_SEPARATOR = PROVIDER === "https://cdn.jsdelivr.net/npm" ? "@" : "/";

    // Latest known versions of these modules as of Feb 19 2026
    // Later should be updated to fetch the latest versions dynamically
    const FA_VERSION =            "7.0.1";
    const HLJS_VERSION =          "11.11.1";
    const BI_VERSION =            "1.13.1";
    const MARKED_VERSION =        "16.3.0";
    const PIXI_VERSION =          "8.16.0";
    const PIXI_FILTERS_VERSION =  "6.1.5";
    const THREE_VERSION =         "0.180.0";

    /**
     * Usage: @use(hljs:version[components]);
     * Components can be languages (lang:javascript) or themes (theme:github)
     */
    server.registerModuleProvider("hljs", ({ version, components, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/highlight.js${VERSION_SEPARATOR}${version || HLJS_VERSION}/highlight.min.js"${scriptAttributes}></script>`);
    
        for (const component of components) {
            if (component.startsWith("lang:")) {
                context.write(`<script src="${PROVIDER}/highlight.js${VERSION_SEPARATOR}${version || HLJS_VERSION}/languages/${component.slice(5)}.min.js"${scriptAttributes}></script>`);
            }
    
            if (component.startsWith("theme:")) {
                context.write(`<link rel=stylesheet href="${PROVIDER}/highlight.js${VERSION_SEPARATOR}${version || HLJS_VERSION}/styles/${component.slice(6)}.min.css">`);
            }
        }
    });

    /**
     * Usage: @use(google-fonts[fonts]);
     * Components are font family names (e.g., "Roboto" or "Open Sans")
     */
    server.registerModuleProvider("google-fonts", ({ components, context }) => {
        if (!(context.data.flags.has(PARSER_FLAGS.GOOGLE_FONTS_PRECONNECT))) {
            context.write(`<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin>`);
            context.data.flags.set(PARSER_FLAGS.GOOGLE_FONTS_PRECONNECT);
        }
    
        if (components.length > 0) context.write(`<link rel=stylesheet href="https://fonts.googleapis.com/css2?${components.map(font => "family=" + font.replaceAll(" ", "+")).join("&")}&display=swap">`);
    });

    /**
     * Usage: @use(marked:version);
     */
    server.registerModuleProvider("marked", ({ version, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/marked${VERSION_SEPARATOR}${version || MARKED_VERSION}/lib/marked.umd.min.js"${scriptAttributes}></script>`);
    });

    /**
     * Usage: @use(bootstrap-icons:version);
     */
    server.registerModuleProvider("bootstrap-icons", ({ version, context }) => {
        const LINK = `${PROVIDER}/bootstrap-icons${VERSION_SEPARATOR}${version || BI_VERSION}/font/bootstrap-icons.min.css`;
        context.write(`<link rel="preload" href="${LINK}" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${LINK}"></noscript>`);
    });

    /**
     * Usage: @use(fa-icons:version);
     */
    server.registerModuleProvider("fa-icons", ({ version, context }) => {
        context.write(`<link rel="preload" href="${PROVIDER}/font-awesome${VERSION_SEPARATOR}${version || FA_VERSION}/css/all.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${PROVIDER}/font-awesome${VERSION_SEPARATOR}${version || FA_VERSION}/css/all.min.css"></noscript>`);
    });
    
    /**
     * Usage: @use(fa-solid:version);
     */
    server.registerModuleProvider("fa-solid", ({ version, context }) => {
        context.write(`<link rel=stylesheet href="${PROVIDER}/font-awesome${VERSION_SEPARATOR}${version || FA_VERSION}/css/solid.min.css">`);
    });
    
    /**
     * Usage: @use(fa-regular:version);
     */
    server.registerModuleProvider("fa-regular", ({ version, context }) => {
        context.write(`<link rel=stylesheet href="${PROVIDER}/font-awesome${VERSION_SEPARATOR}${version || FA_VERSION}/css/regular.min.css">`);
    });
    
    /**
     * Usage: @use(fa-brands:version);
     */
    server.registerModuleProvider("fa-brands", ({ version, context }) => {
        context.write(`<link rel=stylesheet href="${PROVIDER}/font-awesome${VERSION_SEPARATOR}${version || FA_VERSION}/css/brands.min.css">`);
    });

    /**
     * Usage: @use(pixi:version);
     */
    server.registerModuleProvider("pixi", ({ version, scriptAttributes, context }) => {
        // context.write(`<script src="${PROVIDER}/pixi.js${VERSION_SEPARATOR}${version || PIXI_VERSION}/pixi.min.js"${scriptAttributes}></script>`);
        // jsdelivr doesn't automatically resolve /dist
        context.write(`<script src="${PROVIDER}/pixi.js${VERSION_SEPARATOR}${version || PIXI_VERSION}/dist/pixi.min.js"${scriptAttributes}></script>`);
    });

    server.registerModuleProvider("pixi-advanced-blend-modes", ({ version, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/pixi.js${VERSION_SEPARATOR}${version || PIXI_VERSION}/dist/packages/advanced-blend-modes.min.js"${scriptAttributes}></script>`);
    });

    server.registerModuleProvider("pixi-filters", ({ version, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/pixi-filters${VERSION_SEPARATOR}${version || PIXI_FILTERS_VERSION}/dist/pixi-filters.min.js"${scriptAttributes}></script>`);
    });

    /**
     * Usage: @use(three:version);
     */
    server.registerModuleProvider("three", ({ version, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/three${VERSION_SEPARATOR}${version || THREE_VERSION}/build/three.core.min.js"${scriptAttributes}></script>`);
    });

    server.registerModuleProvider("three-webgpu", ({ version, scriptAttributes, context }) => {
        context.write(`<script src="${PROVIDER}/three${VERSION_SEPARATOR}${version || THREE_VERSION}/build/three.webgpu.min.js"${scriptAttributes}></script>`);
    });

    /**
     * Any other module from jsDelivr:
     * Usage: @use(npm/module-name:version[components]);
     */
    server.registerModuleProvider("npm", ({ attrib, version, components, scriptAttributes, context }) => {
        const moduleName = attrib.split("/").slice(1).join("/").split(":")[0];
        if (!moduleName) {
            context.data.app.warn("Invalid npm module name in @use: " + attrib);
            return;
        }

        const baseURL = `${PROVIDER}/${moduleName}${VERSION_SEPARATOR}${version || "latest"}`;
        const cssComponents = components.filter(c => c.endsWith(".css"));
        const jsComponents = components.filter(c => c.endsWith(".js"));

        for (const css of cssComponents) {
            context.write(`<link rel=stylesheet href="${baseURL}/${css}">`);
        }

        for (const js of jsComponents) {
            context.write(`<script src="${baseURL}/${js}"${scriptAttributes}></script>`);
        }
    });
}