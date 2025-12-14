/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 2.0.0
    Description: A performance optimized web application framework for Akeno.
*/


let
    // Libraries
    fs = require("fs"),
    nodePath = require("path"),
    uws = require('uWebSockets.js'),

    parser, // Will be defined later
    parserContext,

    // Local libraries
    { parse, configTools } = require("./parser"),
    { PathMatcher } = require("./router"),
    Units = require("./unit"),

    applications = new Map,

    // Backend object
    backend = require("akeno:backend")
;

/**
 * Web application class for Akeno.
 * Everything should be pre-computed here, routing should be mostly linear.
 */
class WebApp extends Units.App {
    constructor(path, options = {}) {
        super();

        this.path = nodePath.normalize(path);
        this.basename = nodePath.basename(path);
        this.root = this.path;
        this.type = "akeno.web.WebApp";

        this.configMtime = null;
        this.loaded = false;

        this.enabled = null;
        this.ports = new Set;

        /**
         * @warning Do not use this set for routing - it is only a copy to allow for easy removal of domains.
         */
        this.domains = new Set;
        this.modules = new Map;

        applications.set(this.path, this);

        this._rootPathAllowed = true;

        this.reload(options, true);
        this.name = this.config.getBlock("app").get("name", String, this.basename);
    }

    /**
     * Resolve a relative, absolute, or root path to a full path while safely avoiding directory traversal attacks.
     * @param {string} path 
     * @param {string} current 
     * @param {boolean} useRootPath - Indicates whether to use the root path.
     * @returns 
     */

    resolvePath(path, current = null, useRootPath = false) {
        let isRelative = false;

        if (path.charCodeAt(0) === 126) { // '~'
            path = path.slice(1);
            useRootPath = true;
        } else if (path.charCodeAt(0) !== 47) { // '/'
            isRelative = true;
        } else if (path.charCodeAt(1) === 126 && path.charCodeAt(2) === 47) { // '/~/', special case :shrug:
            path = path.slice(2);
            useRootPath = true;
        }

        if (!this._rootPathAllowed) {
            useRootPath = false;
        }

        const root = useRootPath ? this.path : this.root || this.path;
        const relative = nodePath.posix.resolve(isRelative ? (current || nodePath.sep) : "/", path);

        const full = nodePath.join(root, relative);

        // Extra safety check, while it should already be safe, better to be extra safe.
        if (!full.startsWith(root)) {
            return { full, relative: nodePath.sep, useRootPath: true };
        }

        return { full, relative, useRootPath };
    }

    fileHasChangedSince(path, ms) {
        const file = this.resolvePath(path).full;
        try {
            return fs.statSync(file).mtimeMs > ms;
        } catch {
            return false;
        }
    }

    readConfig() {
        if(this._memoryConfig) return true;

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

    reload(options, checkConfig = true) {
        if(options.config) {
            if(typeof options.config === "object" && !options.config.data) {
                // Config is possibly JSON, will need to parse
                throw new Error("Provided config seems to be an object - this has not yet been implemented. (App " + path + ")");
            } else if(typeof options.config === "object" && options.config.data) {
                // Config is provided as configTools
                this.config = options.config; // TODO: configTools should be a class
            } else if(options.config instanceof Map) {
                // Config is provided as a parsed Map of blocks
                this.config = configTools(options.config);
            } else if(typeof options.config === "string") {
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
            this.configPath = this.path + (options.configPath? nodePath.posix.resolve("/", options.configPath): "/app.conf");

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

        if (this.loaded) this.verbose("Hot-reloading");

        const is_enabled = backend.db.apps.get(`${this.path}.enabled`, Boolean);
        this.enabled = (is_enabled === null ? true : is_enabled) || false;

        const serverBlock = this.config.getBlock("server");

        const enabledDomains = serverBlock.get("domains", Array, []);

        const custom_root = serverBlock.get("root", String, null);
        this._rootPathAllowed = serverBlock.get("allowRootPath", Boolean, true);

        if (custom_root && custom_root.length > 0) {
            this.root = this.resolvePath(custom_root, null, true).full;
        } else {
            this.root = this.path;
        }

        if (enabledDomains.length > 0 || this.domains.size > 0) {
            const domains = new Set([...enabledDomains, ...this.domains]);

            for (let domain of domains) {
                if (!domain || typeof domain !== "string") {
                    server.warn("Invalid domain name \"" + domain + "\" for web application \"" + this.basename + "\".");
                    continue;
                }

                if (!enabledDomains.includes(domain)) {
                    backend.domainRouter.remove(domain);
                    this.domains.delete(domain);
                    continue;
                }

                backend.domainRouter.add(domain, this);
                this.domains.add(domain);
            }
        }

        const enabledPorts = this.config.getBlock("server").get("port") || [];

        if (enabledPorts.length > 0 || this.ports.size > 0) {
            const ports = new Set([...enabledPorts, ...this.ports]);

            for (let port of ports) {
                if (!port || typeof port !== "number" || port < 1 || port > 65535) {
                    server.warn("Invalid port number \"" + port + "\" for web application \"" + this.basename + "\" - skipped.");
                    continue
                }

                if (this.ports.has(port)) {
                    if (!enabledPorts.includes(port)) {
                        this.ports.delete(port);

                        if (this.uws) {
                            uws.us_listen_socket_close(this.sockets.get(port));
                            this.uws.close();
                            this.uws = null;
                        }

                        server.log(`Web application "${this.basename}" is no longer listening on port ${port}`);
                        continue
                    }
                    continue
                }

                let found = false;
                for (const app of applications.values()) {
                    if (app.ports.has(port)) {
                        found = app;
                        break
                    }
                }

                if (found) {
                    server.warn("Port " + port + " is already in use by \"" + found.basename + "\" - skipped.");
                    continue
                }

                this.ports.add(port);

                const flags = { app: this };

                if (!this.uws) {
                    this.uws = uws.App().any('/*', (res, req) => {
                        backend.resolve(res, req, flags)
                    })

                    this.sockets = new Map;
                }

                this.uws.listen(port, (socket) => {
                    if (socket) {
                        this.sockets.set(port, socket)
                        server.log(`Web application "${this.basename}" is listening on port ${port}`);
                    } else {
                        server.error(`Failed to start web application "${this.basename}" on port ${port}`);
                    }
                })
            }
        }

        // FIXME: (Temporary) backend hooks
        if (this.config.data.has("hook")) {
            const hook = this.config.getBlock("hook");
            const path = this.path + "/" + hook.get("path", String, "hook.js");

            this.warn("Web application " + this.basename + " has loaded a hook script from " + path + ". This feature may be removed at any time.");
            this.hook = require(path);
        }

        if (this.config.data.has("ratelimit")) {
            const limit = this.config.getBlock("ratelimit").get("limit", Number, 1000); // 1000 Requests
            const interval = this.config.getBlock("ratelimit").get("interval", Number, 60000); // 1 Minute
            this.ratelimit = new backend.helper.RateLimiter(limit, interval);
        } else delete this.ratelimit;

        for (let api of this.config.getBlocks("module")) {
            // TODO: Proper module system
            const name = api.attributes;

            if (this.modules.has(name)) continue;

            let module;
            try {
                module = new backend.Module(`${this.basename}/${name}`, { path: this.path + "/" + api.get("path", String), autoRestart: api.get("autoRestart", Boolean, false) });
            } catch (error) {
                server.error("Failed to load module " + name + " for web application " + this.basename + ": " + error.toString() + ". You can reload the app to retry.");
                continue
            }

            this.modules.set(name, module);
        }

        this.loaded = true;

        // Precompute any path-specific attributes
        this._hasAttribs = this.config.data.has("location") || this.config.data.has("addon") || this.config.data.has("redirect") || this.config.data.has("route") || this.config.data.has("handle");
        if (this._hasAttribs) {
            if (!this.pathMatcher) this.pathMatcher = new PathMatcher({
                mergeObjects: true // Internally merges objects
            });

            this.pathMatcher.clear();

            // Routes (aliases)
            for (const route of this.config.getBlocks("route")) { // Since 1.6.5, this is now called alias
                const to = route.get("to", Array);
                if (!to || typeof to[0] !== "string") continue;

                for (const pattern of route.attributes) {
                    this.pathMatcher.add(pattern, { alias: to[0] });
                }
            }

            // Redirects
            for (const redirect of this.config.getBlocks("redirect")) {
                const to = redirect.get("to", String);
                if (!to) continue;

                this.pathMatcher.add(redirect.attributes[0], { redirect: to });
            }

            // This is possibly deprecated
            for (const handle of this.config.getBlocks("handle")) {
                const target = handle.get("path", String);
                const domain = handle.get("as", String);
                if (!target || !domain) continue;

                const handleObj = { handle: { target, domain, appendPath: handle.get("appendPath", Boolean) } };

                for (const pattern of handle.attributes) {
                    this.pathMatcher.add(pattern, handleObj);
                }
            }

            // Addons - Load addon, block the path
            if (this.config.data.has("addon")) {
                for (const addon of this.config.getBlocks("addon")) {
                    const path = this.resolvePath(addon.attributes[0]).full;
                    
                    Units.Manager.loadAddon(path);
                    this.pathMatcher.add(addon.attributes[0], { deny: true });
                }
            }

            // General path attributes
            for (const route of this.config.getBlocks("location")) {
                for (const pattern of route.attributes) {
                    this.pathMatcher.add(pattern, route.properties);
                }
            }
        }

        this._browserRequirements = this.config.getBlock("browserSupport");

        const _404 = this.config.getBlock("errors").get("404", String) || this.config.getBlock("errors").get("default", String);
        this._404 = _404 ? this.resolvePath(_404) : null;
    }

    ws(options){
        this.websocket = options;
    }
}

const server = new class WebServer extends Units.Module {
    constructor() {
        super({ name: "web", id: "akeno.web", version: "1.4.0-beta" });

        this.registerType("WebApp", WebApp)

        this.fileServer = new backend.helper.FileServer();
    }

    // This is the main handler/router for websites/webapps.
    async onRequest(req, res, app) {
        try {
            if (!app) {
                backend.helper.sendErrorPage(req, res, "404");
                return;
            }

            // HTTPS Redirect
            if (backend.mode !== backend.modes.DEVELOPMENT && (!req.secure && !app.config.getBlock("server").get("allowInsecureTraffic", Boolean))) {
                res.writeStatus('302 Found').writeHeader('Location', `https://${req.getHeader("host")}${req.path}`).end();
                return;
            }

            if(app.ratelimit) {
                if(!app.ratelimit.pass(req, res)) return;
            }

            // When the app is disabled
            if (!app.enabled) {
                backend.helper.send(req, res, app.config.getBlock("server").get("disabled_message", String, server.etc.default_disabled_message), null, "422");
                return;
            }

            // Check if the client version is supported
            if (this._browserRequirements) {
                if (!checkSupportedBrowser(req.getHeader('user-agent'), this._browserRequirements.properties)) {
                    res.cork(() => {
                        res.writeHeader('Content-Type', this._browserRequirements.get("contentType", String, 'text/html')).writeStatus('403 Forbidden').end(this._browserRequirements.get("message", String, `<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${this._browserRequirements.chrome && this._browserRequirements.chrome} and up, Firefox ${this._browserRequirements.firefox && this._browserRequirements.firefox} and up.`))
                    })
                    return;
                }
            }

            // FIXME: TEMPORARY SOLUTION: Backend hooks (basically application middleware)
            if (app.hook && typeof app.hook.onRequest === "function") {
                try {
                    const result = await app.hook.onRequest(req, res);
                    if (result === false) return;
                } catch (error) {
                    app.error("Error in onRequest hook for app \"" + app.path + "\": ", error);
                    backend.helper.send(req, res, "<b>Internal Server Error - Incident log was saved.</b>", null, 500);
                    return;
                }
            }

            let url = req.path;

            // Path attributes
            if (app._hasAttribs && app.pathMatcher) {
                let attributes = app.pathMatcher.match(url);

                if (attributes) {
                    // Check if the path is denied
                    if (attributes.deny) {
                        backend.helper.send(req, res, "Access denied.", null, "403 Forbidden");
                        return;
                    }

                    // Handle redirects
                    if (typeof attributes.redirect === "string") {
                        res.writeStatus('302 Found').writeHeader('Location', attributes.redirect).end();
                        return;
                    }

                    // Handle external handles (redirects to a different handler based on domain)
                    if (typeof attributes.handle === "object" && attributes.handle.domain) {
                        const handler = backend.domainRouter.match(attributes.handle.domain);

                        if (attributes.handle.target) req.path = attributes.handle.target + (attributes.handle.appendPath ? req.path : "");
                        backend.resolveHandler(req, res, handler);
                        return;
                    }

                    // Handle aliases (an URL points to a different file)
                    if (typeof attributes.alias === "string") {
                        if(attributes.alias.charCodeAt(0) !== 47) {
                            attributes.alias = "/" + attributes.alias;
                        }

                        url = attributes.alias;

                        if (attributes.alias.indexOf("$url") !== -1) {
                            url = url.replace("$url", req.path);
                        }

                        if (attributes.alias.indexOf("$file") !== -1) {
                            url = url.replace("$file", nodePath.basename(req.path));
                        }

                        if (attributes.alias.indexOf("$path") !== -1) {
                            url = url.replace("$path", nodePath.dirname(req.path));
                        }
                    }
                }
            }

            /**
             * TODO: Migrate router and caching to C++ using the uWS fork, currently the C++ cache is never hit and the cache system is a bit eh.
             */

            // TODO: Cache this
            let resolvedPath = app.resolvePath(url);
            let errorCode = null;

            // We need to do this upfront even if not used, because we can't access the request after an await
            const ACCEPTS_ENCODING = req.getHeader("accept-encoding") || "";

            let file = resolvedPath.full;
            if (!(file = await files_try_async(file + ".html", file + "/index.html", file))) {
                if (!app._404 || !app._404.full) {
                    return backend.helper.sendErrorPage(req, res, "404", "File \"" + url + "\" not found on this server.");
                }

                // Load the defined 404 page (existence should be checked when the app is loaded)
                resolvedPath = app._404;
                file = app._404.full;
                errorCode = "404";
            }

            // Handle directories (we already know the file exists)
            if ((await fs.promises.stat(file)).isDirectory()) {
                return backend.helper.send(req, res, "You have landed in " + url + " - which is a directory.");
            }

            file = nodePath.normalize(file);

            const cacheEntry = server.fileServer.cache.get(file);

            // Because we can't read the accept-encoding header after generating async content....
            const extension = cacheEntry ? cacheEntry[0][5] : nodePath.extname(file).slice(1);
            const suggestedAlg = backend.helper.getUsedCompression(ACCEPTS_ENCODING, cacheEntry ? cacheEntry[0][6] : backend.mime.getType(extension));

            // Generate and serve fresh content if not cached or modified
            if (!cacheEntry || server.fileServer.needsUpdate(file, cacheEntry)) {
                app.verbose(`Serving request for ${req.domain}, path ${url}, file ${file || "<not found>"}`);

                // By default, the server will get its own content
                let content = null;

                if (extension === "html") {
                    const directory = nodePath.dirname(resolvedPath.relative);

                    parserContext.data = { url, directory, path: app.path, root: app.root, file, app, secure: req.secure };
                    content = parser.fromFile(file, parserContext, true);
                }

                if (cacheEntry) {
                    await server.fileServer.refresh(file, null, null, content);
                } else {
                    await server.fileServer.refresh(file, { "Vary": "Accept-Encoding, Akeno-Content-Only" }, extension === "html" ? (path) => parser.needsUpdate(path) : null, content);
                }
            }

            server.fileServer.serveWithoutChecking(req, res, cacheEntry || server.fileServer.cache.get(file), errorCode, false, suggestedAlg);

        } catch (error) {
            const logTarget = app || server;

            logTarget.error("Error when serving app \"" + logTarget.path + "\", requesting \"" + req.path + "\": ", error);

            try {
                backend.helper.sendErrorPage(req, res, "500", "Internal Server Error - Incident log was saved.");
            } catch (error) {
                logTarget.error("Failed to send error response for app \"" + logTarget.path + "\".", error);
            }
        }
    }

    onIPCRequest(segments, req, res) {
        switch (segments[0]) {
            case "list":
                res.end([...applications.values()].map(app => ({
                    name: app.name,
                    basename: app.basename,
                    path: app.path,
                    enabled: app.enabled,
                    ports: [...app.ports],
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

            this.load(location);
        }

        this.log(`${skip_config_refresh ? "Loaded" : "Reloaded"} ${locations.length} web application${locations.length !== 1 ? "s" : ""} in ${(performance.now() - start).toFixed(2)}ms`);
    }

    onLoad() {
        // Constants
        const header = backend.config.getBlock("web").get("htmlHeader", String, `<!-- Server-generated code. Powered by Akeno v${backend.version} - https://github.com/the-lstv/Akeno -->`) || '';

        this.etc = {
            default_disabled_message: Buffer.from(backend.config.getBlock("web").get("disabledMessage", String) || "This website is temporarily disabled."),
            EXTRAGON_CDN: backend.config.getBlock("web").get("extragon_cdn_url", String) || backend.mode === backend.modes.DEVELOPMENT ? `https://cdn.extragon.localhost` : `https://cdn.extragon.cloud`
        };

        initParser(header);

        backend.exposeToDebugger("parser", parser);
        this.reload(null, true);
    }

    // Utility functions

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
        backend.domainRouter.add(random, app);

        return random;
    }
}

// Section: utils
function files_try(...files) {
    for (let file of files) {
        if (fs.existsSync(file)) {
            return file
        }
    }
}

async function files_try_async(...files) {
    for (let file of files) {
        try {
            await fs.promises.access(file, fs.constants.F_OK);
            return file;
        } catch { }
    }
}

function checkSupportedBrowser(userAgent, properties) {
    if (!userAgent || !properties) return true;

    const ua = userAgent.toLowerCase();

    if (ua.includes('msie') || ua.includes('trident')) return false;

    // Check Chrome
    if (properties.chrome && ua.includes('chrome')) {
        if (properties.disableChrome) return false;
        const match = ua.match(/chrome\/(\d+)/);
        return !match || parseInt(match[1], 10) >= +properties.chrome;
    }

    // Check Firefox
    if (properties.firefox && ua.includes('firefox')) {
        if (properties.disableFirefox) return false;
        const match = ua.match(/firefox\/(\d+)/);
        return !match || parseInt(match[1], 10) >= +properties.firefox;
    }

    return true; // Allow by default if browser could not be determined
}


const ls_path = backend.path + "/addons/cdn/ls";
const latest_ls_version = fs.existsSync(ls_path + "/version") ? fs.readFileSync(ls_path + "/version", "utf8").trim() : "5.1.0";

// TODO: Let the API itself handle this
const ls_components = {
    "js": [
        "animation",
        "dragdrop",
        "gl",
        "imagecropper",
        "modal",
        "network",
        "node",
        "reactive",
        "resize",
        "tabs",
        "timeline",
        "toast",
        "tooltips",
        "tree",
        "v4compat"
    ],
    "css": [
        "flat"
    ]
};

// Brings support for old browsers
let esbuild;
const TRANSPILE_EXTENSIONS = ['ts', 'tsx', 'jsx', 'js', 'mjs', 'cjs', 'css'];
try {
    esbuild = require("esbuild");
} catch (e) {
    esbuild = null;
}

function initParser(header) {
    parser = new backend.native.parser({
        header,
        buffer: true,
        compact: backend.compression.codeEnabled,

        onText(text, parent, context) {
            if (!text || text.length === 0) return;
            
            // Inline script compression
            // TODO: Handle script type
            if(parent === "script") {
                if(!backend.compression.codeEnabled || !backend.esbuildEnabled) {
                    return true;
                }

                if(backend.esbuildEnabled && esbuild && TRANSPILE_EXTENSIONS.includes("js")) {
                    try {
                        const result = esbuild.transformSync(text, {
                            minify: backend.compression.codeEnabled,
                            loader: 'js',
                            format: 'iife',
                            target: backend.esbuildTargets,
                        });
                        return result.code;
                    } catch (e) {
                        console.error("Esbuild JS transform error: ", e);
                        return backend.compression.codeEnabled ? backend.compression.code(text, backend.compression.format.JS) : true;
                    }
                }

                return backend.compression.code(text, backend.compression.format.JS);
            }

            // Inline style compression
            if (parent === "style") {
                if(!backend.compression.codeEnabled || !backend.esbuildEnabled) {
                    return true;
                }

                if(backend.esbuildEnabled && esbuild && TRANSPILE_EXTENSIONS.includes("css")) {
                    try {
                        const result = esbuild.transformSync(text, {
                            minify: backend.compression.codeEnabled,
                            loader: 'css',
                            target: backend.esbuildTargets,
                        });
                        return result.code;
                    } catch (e) {
                        console.error("Esbuild CSS transform error: ", e);
                        return backend.compression.codeEnabled ? backend.compression.code(text, backend.compression.format.CSS) : true;
                    }
                }

                return backend.compression.code(text, backend.compression.format.CSS);
            }

            // Parse with Atrium, text gets sent back to C++, blocks get handled via onBlock
            parse(text, context);
        },

        // onEnd(context) {
        //     // context.data = null;
        // }
    });

    parserContext = parser.createContext();

    backend.native.context.prototype.onBlock = function (block) {
        const parent = this.getTagName();

        switch (block.name) {
            case "use":
                // if(parent !== "head") {
                //     server.warn("Error in app " + this.data.path + ": @use can only be used in <head>.");
                //     break
                // }

                // Modules
                for (const entry of block.attributes) {
                    const has_component_list = typeof entry !== "string";

                    const scriptAttributes = `${block.properties.defer? " defer": block.properties.async? " async": ""}`;

                    let attrib = has_component_list ? entry.name : entry;
                    let components = has_component_list && entry.values.length > 0 ? [] : backend.constants.EMPTY_ARRAY;

                    // We sort alphabetically and remove duplicates to maximize cache hits
                    // This is the fastest implementation based on my benchmark: https://jsbm.dev/Au74tivWZWKEo
                    if (has_component_list) {
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

                    if (attrib === "ls" || attrib.startsWith("ls.")) {
                        if (!version) {
                            if (this.data.ls_version) {
                                version = this.data.ls_version;
                            } else {
                                console.error(`Error in app "${this.data.path}": No version was specified for LS in your app. This is no longer supported - you must specify a version, for example ${attrib}:${latest_ls_version}. To enforce the latest version, use ${attrib}:latest`);
                                break;
                            }
                        }

                        if (version === "latest") version = latest_ls_version;

                        this.data.ls_version = version;

                        const is_merged = attrib === "ls";

                        let components_string;

                        const singularCSSComponent = attrib.startsWith("ls.css.")? attrib.substring(8).toLowerCase() : null;
                        if (singularCSSComponent && ls_components.css.includes(singularCSSComponent)) {
                            components = [singularCSSComponent];
                        }

                        const singularJSComponent = attrib.startsWith("ls.js.")? attrib.substring(6).toLowerCase() : null;
                        if (singularJSComponent && ls_components.js.includes(singularJSComponent)) {
                            components = [singularJSComponent];
                        }

                        if (is_merged || attrib === "ls.css" || singularCSSComponent) {
                            const cssComponents = is_merged ? components.filter(value => !ls_components.js.includes(value)) : components;
                            const useSingular = cssComponents.length === 1 && (this.data.using_ls_css || singularCSSComponent);
                            components_string = cssComponents.join();

                            if (components_string.length !== 0) {
                                this.write(`<link rel=stylesheet href="${server.etc.EXTRAGON_CDN}/ls/${version}/${(components_string && !useSingular) ? components_string + "/" : ""}${useSingular? components_string: this.data.using_ls_css ? "bundle" : "ls"}.${this.data.compress ? "min." : ""}css">`);
                                this.data.using_ls_css = true;
                            }
                        }

                        if (is_merged || attrib === "ls.js" || singularJSComponent) {
                            const jsComponents = is_merged ? components.filter(value => !ls_components.css.includes(value)) : components;
                            const useSingular = jsComponents.length === 1 && (this.data.using_ls_js || singularJSComponent);
                            components_string = jsComponents.join();

                            if (components_string.length !== 0) {
                                this.write(`<script src="${server.etc.EXTRAGON_CDN}/ls/${version}/${(components_string && !useSingular) ? components_string + "/" : ""}${useSingular? components_string: this.data.using_ls_js ? "bundle" : "ls"}.${this.data.compress ? "min." : ""}js"${scriptAttributes}></script>`);
                                this.data.using_ls_js = true;
                            }
                        }

                        this.data.using_ls = true;
                        continue;
                    }


                    /**
                     * TODO:FIXME: (High priority)
                     * Implement a proper source system to allow custom sources, and use a real resource API instead of hard-coded URLs.
                     */

                    switch (attrib) {
                        case "bootstrap-icons":
                            this.write(`<link rel="preload" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@${version || "1.13.1"}/font/bootstrap-icons.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@${version || "1.13.1"}/font/bootstrap-icons.min.css"></noscript>`);
                            break;

                        case "fa-icons":
                            this.write(`<link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version || "6.7.0"}/css/all.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version || "6.7.0"}/css/all.min.css"></noscript>`);
                            break;

                        case "fa-brands":
                            this.write(`<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version || "6.7.0"}/css/brands.min.css">`)
                            break;

                        case "hljs":
                            this.write(`<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${version || "11.11.1"}/highlight.min.js"${scriptAttributes}></script>`);

                            for (const component of components) {
                                if(component.startsWith("lang:")) {
                                    this.write(`<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${version || "11.11.1"}/languages/${component.slice(5)}.min.js"${scriptAttributes}></script>`);
                                }

                                if(component.startsWith("theme:")) {
                                    this.write(`<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${version || "11.11.1"}/styles/${component.slice(5)}.min.css">`);
                                }
                            }
                            break;

                        case "marked":
                            this.write(`<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/${version || "16.2.1"}/lib/marked.umd.min.js"${scriptAttributes}></script>`);
                            break;

                        case "google-fonts":
                            if (!this.data.flag_google_fonts_preconnect) {
                                this.write(`<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin>`)
                                this.data.flag_google_fonts_preconnect = true;
                            }

                            if (components.length > 0) this.write(`<link rel=stylesheet href="https://fonts.googleapis.com/css2?${components.map(font => "family=" + font.replaceAll(" ", "+")).join("&")}&display=swap">`)
                            break;

                        default:
                            if (attrib.includes("/")) {
                                if (attrib.startsWith("http")) {
                                    server.warn("Error in app " + this.data.path + ": @use does not allow direct URL imports (\"" + attrib + "\") - please define a custom @source or use a different way to import your content.");
                                    break;
                                }

                                const resolvedPath = this.data.app.resolvePath(attrib, this.data.directory);
                                const path = resolvedPath.full;
                                const link = (resolvedPath.useRootPath ? "/~" : "") + resolvedPath.relative || attrib;

                                if (!fs.existsSync(path)) {
                                    this.data.app.warn("Error: File \"" + path + "\" does not exist.");
                                    break;
                                }

                                const mtime = `?mtime=${(fs.statSync(path).mtimeMs).toString(36)}`;
                                const extension = attrib.slice(attrib.lastIndexOf('.') + 1);

                                switch (extension) {
                                    case "js":
                                        this.write(`<script src="${link}${mtime}" ${components.join(" ")}${scriptAttributes}></script>`)
                                        break;
                                    case "css":
                                        this.write(`<link rel=stylesheet href="${link}${mtime}" ${components.join(" ")}>`)
                                        break;
                                    case "json":
                                        this.write(`<script type="application/json" id="${components.length ? components.join(",") : attrib}">${fs.readFileSync(path)}</script>`)
                                        break;
                                }
                            } else {
                                this.data.app.warn("Error: Unknown module \"" + attrib + "\"");
                            }
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
                    if (!this.data._setDefaultCharset) {
                        this.data._setDefaultCharset = true;
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
                    if (!this.data._setDefaultViewport) {
                        this.data._setDefaultViewport = true;
                        this.write(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
                    }
                }

                let bodyAttributes = this.data.using_ls_css ? "ls" : "";

                if (this.data.using_ls_css) {
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
                    bodyAttributes += this.data.using_ls_css ? ` style="--font:${block.properties.font}"` : ` style="font-family:${block.properties.font}"`;
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

                for (let item of block.attributes) {
                    const path = this.data.app.resolvePath(item, this.data.directory).full;

                    try {
                        this.import(path);
                    } catch (error) {
                        this.data.app.warn("Failed to import: " + item + " (" + path + ")", error);
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

            case "print":
                for (let attrib of block.attributes) {
                    this.write(attrib.replace(/\$\w+/, () => { return "" }))
                }
                break;

            default:
                block = null;
        }
    }
}


// Debug: Hot reloading LS components
// This is a temporary solution to update the ls_components object in this file, do not actually use this
if (process.argv.includes("--debug-scan-ls-components")) {
    if (fs.existsSync(ls_path)) {
        require(ls_path + "/misc/generate.js");

        const newComponents = JSON.parse(fs.readFileSync(ls_path + "/misc/components.json", "utf8"));

        ls_components.js = newComponents.js;
        ls_components.css = newComponents.css;

        const thisFile = __filename;
        const fileContent = fs.readFileSync(thisFile, "utf8");

        // Find the ls_components assignment using regex
        const updatedContent = fileContent.replace(
            /const ls_components\s*=\s*\{[\s\S]*?\};/,
            `const ls_components = ${JSON.stringify(ls_components, null, 4)};`
        );

        fs.writeFileSync(thisFile, updatedContent, "utf8");
        console.log(`[DEBUG] Updated ${thisFile} with new ls_components.`);
    }
}

server.WebApp = WebApp;
module.exports = server