

/*

    Welcome to the Akeno Web App module!
    This is an Akeno module created for static/dynamic web application handling & routing,
    optimized for performance, with on-the-fly code compression, smart caching etc.

    It also features a dynamic HTML processor.

*/

// Section: variables

let
    // Libraries
    fs = require("fs"),
    nodePath = require("path"),
    uws = require('uWebSockets.js'),

    picomatch = require('picomatch'),

    WebNative = require("./native/dist/akeno-web"),

    parser, // Will be defined later
    parserContext,

    // Local libraries
    { parse, configTools } = require("./parser"),
    Units = require("./unit"),

    applications = new Map,
    applicationCache = [], // debug purposes

    // Backend object
    backend,

    // Cache && optimisation helpers
    assignedDomains = new Map,
    cache = new Map,

    // Maximal cache size for binary files per-file.
    // If a file is bigger than this, it is not served from RAM.
    max_cache_size = 367001600,

    cacheByFile = {
        html: "15",
        js: "604800",
        css: "604800",
        default: "50000"
    }
;


class WebApp extends Units.App {
    constructor(path){
        super();

        this.path = path;
        this.type = "akeno.web.WebApp";

        this.reloadConfig();
        if(!this.config) throw "Invalid or missing config";

        this.basename = nodePath.basename(path);
        this.name = this.config.getBlock("app").get("name", String, this.basename);
        this.enabled = null;
        this.ports = new Set;

        /**
         * @warning Do not use this set for routing - it is only a copy to allow for easy removal of domains.
         */
        this.domains = new Set;
        this.modules = new Map;

        applications.set(this.path, this);

        // Only for quick retrieval of website information
        applicationCache.push({
            basename: this.basename,
            path,

            get enabled(){
                return this.enabled
            },

            get ports(){
                return [...this.ports]
            }
        })

        this.reload();
    }

    reloadConfig(){
        let configPath = files_try(this.path + "/app.conf", this.path + "/app.manifest");

        if(!configPath){
            return false;
        }

        this.config = configTools(parse(fs.readFileSync(configPath, "utf8"), {
            strict: true,
            asLookupTable: true
        }))
    }

    reload(){
        const is_enabled = backend.db.apps.get(`${this.path}.enabled`, Boolean)
        this.enabled = (is_enabled === null? true: is_enabled) || false;

        const enabledDomains = this.config.getBlock("server").get("domains", Array, []);

        if(enabledDomains.length > 0 || this.domains.size > 0){
            const domains = new Set([...enabledDomains, ...this.domains]);

            for(let domain of domains){
                if(!domain || typeof domain !== "string") {
                    server.warn("Invalid domain name \"" + domain + "\" for web application \"" + this.basename + "\".");
                    continue
                }

                if(!enabledDomains.includes(domain)){
                    assignedDomains.delete(domain);
                    this.domains.delete(domain);
                    continue
                }

                assignedDomains.set(domain, this);
                this.domains.add(domain);
            }
        }


        const enabledPorts = this.config.getBlock("server").get("port") || [];

        if(enabledPorts.length > 0 || this.ports.size > 0){
            const ports = new Set([...enabledPorts, ...this.ports]);

            for (let port of ports) {
                if(!port || typeof port !== "number" || port < 1 || port > 65535) {
                    server.warn("Invalid port number \"" + port + "\" for web application \"" + this.basename + "\" - skipped.");
                    continue
                }

                if(this.ports.has(port)){
                    if(!enabledPorts.includes(port)){
                        this.ports.delete(port);

                        if(this.uws){
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
                for(const app of applications.values()){
                    if(app.ports.has(port)){
                        found = app;
                        break
                    }
                }

                if(found){
                    server.warn("Port " + port + " is already in use by \"" + found.basename + "\" - skipped.");
                    continue
                }
                
                this.ports.add(port);

                const flags = { app: this };

                if(!this.uws) {
                    this.uws = uws.App().any('/*', (res, req) => {
                        backend.resolve(res, req, flags)
                    })

                    this.sockets = new Map;
                }

                this.uws.listen(port, (socket) => {
                    if(socket) {
                        this.sockets.set(port, socket)
                        server.log(`Web application "${this.basename}" is listening on port ${port}`);
                    } else {
                        server.error(`Failed to start web application "${this.basename}" on port ${port}`);
                    }
                })
            }
        }

        // TODO: API extensions
        // for(let api of this.config.getBlocks("api")){
        //     backend.apiExtensions[api.attributes] = this.path + "/" + api.attributes[1]
        // }

        // Reload modules
        for(let [name, module] of this.modules){
            module.restart()
        }

        for(let api of this.config.getBlocks("module")){
            // TODO: Proper module system
            const name = api.attributes;

            if(this.modules.has(name)) continue;

            let module;
            try {
                module = new backend.Module(`${this.basename}/${name}`, { path: this.path + "/" + api.get("path", String), autoRestart: api.get("autoRestart", Boolean, false) });
            } catch (error) {
                server.error("Failed to load module " + name + " for web application " + this.basename + ": " + error.toString() + ". You can reload the app to retry.");
                continue
            }

            this.modules.set(name, module)
        }
    }

    restart(){
        return this.reload();
    }
}

const server = new class WebServer extends Units.Module {
    constructor(){
        super({ name: "web", id: "akeno.web", version: "1.4.0-beta" });

        this.registerType("WebApp", WebApp)
    }

    Initialize($){
        backend = $;

        // Constants
        const header = `<!-- Auto-generated code. Powered by Akeno v${backend.version} - https://github.com/the-lstv/Akeno -->`;

        this.etc = {
            notfound_error: Buffer.from(`<!DOCTYPE html><html>\n${header}\n<h2>No website was found for this URL.</h2>Additionally, nothing was found to handle this error.<br><br><hr>Powered by Akeno/${backend.version}</html>`),
            default_disabled_message: Buffer.from(backend.config.getBlock("web").get("disabledMessage", String) || "This website is temporarily disabled."),

            EXTRAGON_CDN: backend.config.getBlock("web").get("extragon_cdn_url", String) || backend.mode === backend.modes.DEVELOPMENT? `http://cdn.extragon.test`: `https://cdn.extragon.cloud`
        };

        initParser(header);

        backend.exposeToDebugger("parser", parser);

        this.reload(null, true);
    }

    async reload(specific_app, skip_refresh){
        if(specific_app) return this.load(specific_app);

        if(!skip_refresh) backend.refreshConfig();

        const start = performance.now();

        const webConfig = backend.config.getBlock("web");
        const locations = webConfig.get("locations") || [];

        // Looks for valid application locations
        for(let location of locations){
            if(location.startsWith("./")) location = backend.path + location.slice(1);

            if(!fs.existsSync(location.replace("/*", ""))) {
                this.warn("Web application (at " + location + ") does not exist - skipped.");
                continue
            }

            // Handle wildcard (multi) locations
            if(location.endsWith("*")){
                let path = nodePath.normalize(location.slice(0, -1) + "/");

                for(let new_location of fs.readdirSync(path)){
                    new_location = path + new_location;
                    if(!fs.statSync(path).isDirectory()) continue;
                    locations.push(new_location)
                }
                continue
            }

            if(!fs.statSync(location).isDirectory()) {
                return this.warn("Web application (at " + location + ") is a file - skipped.")
            }

            this.load(location)
        }

        this.log(`Loaded ${locations.length} web application${locations.length !== 1? "s": ""} in ${(performance.now() - start).toFixed(2)}ms`);
    }


    load(path){
        // TODO: Hot reloading is almost functional, but needs config validation and re-parsing to be finished

        path = nodePath.normalize(path);

        let app = applications.get(path);

        
        if(!app) {
            try {
                app = new WebApp(path);
            } catch (error) {
                this.warn("Web application (at " + path + ") failed to load due to an error: ", error);
                return false;
            }
            if(!app) return false;
        } else {
            this.verbose("Hot-reloading web application (at " + path + ")");
            app.reload();
        }

        if(!app.config) return false;
        return true
    }

    ServeCache(req, res, cache, app, url){
        // Dynamic content
        if(Array.isArray(cache.content)){
            return this.ServeDynamicContent(req, res, cache.content, cache.headers, app, url)
        }

        return backend.helper.send(req, res, cache.content, cache.headers)
    }

    async HandleRequest({ segments, req, res, flags }){
        // This is the main handler/router for websites/webapps.

        if(req.domain.startsWith("www.")) req.domain = req.domain.slice(4);

        const app = flags.app || (assignedDomains.get(req.domain) ?? assignedDomains.get(":default"));

        if(!app) return res.cork(() => {
            res.writeHeader('Content-Type', 'text/html').writeStatus('404 Not Found').end(server.etc.notfound_error)
        })

        // HTTPS Redirect
        if(backend.mode !== backend.modes.DEVELOPMENT && (!req.secure && !app.config.getBlock("server").get("allowInsecureTraffic", Boolean))){
            res.writeStatus('302 Found').writeHeader('Location', `https://${req.getHeader("host")}${req.path}`).end();
            return
        }

        // When the app is disabled
        if(!app.enabled){
            backend.helper.send(req, res, app.config.getBlock("server").get("disabled_message", String, server.etc.default_disabled_message), null, "422")
            return
        }

        if(app.config.data.has("browserSupport")){
            let browserRequirements = app.config.getBlock("browserSupport");

            if(!checkSupportedBrowser(req.getHeader('user-agent'), browserRequirements.properties)){
                res.cork(() => {
                    res.writeHeader('Content-Type', browserRequirements.get("contentType", String, 'text/html')).writeStatus('403 Forbidden').end(browserRequirements.get("message", String, `<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${browserRequirements.chrome && browserRequirements.chrome} and up, Firefox ${browserRequirements.firefox && browserRequirements.firefox} and up.`))
                })
                return
            }
        }


        let url = req.original_url = `/${segments.join("/")}`;


        // Redirects (simple URL redirects)
        if(app.config.data.has("redirect")) for(const handle of app.config.getBlocks("redirect")){
            const target = handle.get("to", String);

            if(target && (handle.picomatchCache || (handle.picomatchCache = picomatch(handle.attributes)))(url)){
                res.writeStatus('302 Found').writeHeader('Location', target).end();
                return
            }
        }


        // Redirect handles (when an URL points to a whole another point in the server)
        if(app.config.data.has("handle")) for(const handle of app.config.getBlocks("handle")){
            const target = handle.get("path", String);
            const domain = handle.get("as", String);

            if(target && domain && (handle.picomatchCache || (handle.picomatchCache = picomatch(handle.attributes)))(url)){
                return backend.resolve(res, req, { secure: req.secure }, {
                    domain,
                    path: `/${target}${handle.get("appendPath", Boolean)? `/${segments.join("/")}`: ""}`,
                    virtual: true
                })
            }
        }


        // Redirect routes
        if(app.config.data.has("route")) for(const route of app.config.getBlocks("route")){
            if((route.picomatchCache || (route.picomatchCache = picomatch(route.attributes)))(url)){
                const negate = route.get("not");

                if(!negate || !negate.length || !(route.negate_picomatchCache || (route.negate_picomatchCache = picomatch(negate)))(url)){
                    url = `/${route.get("to", String)}`
                    break
                }
            }
        }


        // *Finally*, handle content (don't worry routes will be cached)
        try {

            let file = files_try(app.path + url + ".html", app.path + url + "/index.html", app.path + url);

            if(!file){
                file = app.config.getBlock("errors").get("code", String) || app.config.getBlock("errors").get("default", String)

                if(!file){
                    return backend.helper.send(req, res, url + " not found", null, "404 Not Found");
                } else file = app.path + file
            }

            file = nodePath.normalize(file);

            if(fs.statSync(file).isDirectory()){
                return backend.helper.send(req, res, "You have landed in " + url + " - which is a directory.");
            }

            // TODO: Once uWS implements low-level cache, add support for it OR compile a custom build with a more dynamic C++ router


            const cacheKey = backend.helper.getUsedCompression(req);

            // Check if the file has not been changed since
            const cache = requestCachedFile(file, cacheKey);

            /**
             * TODO: Migrate router and caching to C++ using the uWS fork, currently the C++ cache is never hit.
            */

            // In case that we do not have the headers yet, well have to wait for them.
            if(!cache.refresh && cache.headers) {
                return server.ServeCache(req, res, cache, app, url)
            }

            const file_name = nodePath.basename(file);

            let extension, lastIndex = file_name.lastIndexOf('.');

            if (lastIndex !== -1) {
                extension = file_name.slice(lastIndex + 1);
            } else extension = file_name;

            let mimeType = backend.mime.getType(extension) || "text/plain";

            const headers = {
                "Content-Type": `${mimeType}; charset=UTF-8`,
                "Cache-Control": `public, max-age=${cacheByFile[extension] || cacheByFile.default}`,
                "X-Content-Type-Options": "nosniff",
                "ETag": `"${cache.lastModifyTime.toString(36)}"`,
            }

            // Now that we got headers, lets actually serve the cached response
            if(!cache.refresh) {
                cache.headers = headers
                return server.ServeCache(req, res, cache, app, url)
            }

            app.verbose(`Serving request for ${req.domain}, path ${url}, file ${file || "<not found>"}`)

            let content;

            switch(extension){
                case "html":
                    parserContext.data = { url, app, secure: req.secure };
                    content = parser.fromFile(file, parserContext)
                    // content = fs.readFileSync(file);
                    break;

                case "js": case "css":
                    content = fs.readFileSync(file, "utf8");
                    break;

                default:
                    content = fs.readFileSync(file);
            }

            if(content) {
                if(Array.isArray(content)){
                    // TODO: Rework dynamic content handling
                    // Dynamic content
                    // server.ServeDynamicContent(req, res, content, headers, app, url)
                    return res.end();
                } else {
                    let compressionAlgo;

                    try {
                        if(backend.compression.enabled){
                            [compressionAlgo, content] = backend.helper.sendCompressed(req, res, content, mimeType, headers);
                        } else {
                            backend.helper.send(req, res, content, headers);
                        }
                    } catch (error) {
                        app.error("Couldn't perform compression, requesting \"" + req.path + "\": ", error);
                        backend.helper.send(req, res, "<b>Internal Server Error - Incident log was saved.</b>", null, 500);
                        return
                    }

                    if(content.length <= max_cache_size) updateCache(file, compressionAlgo, content, headers);
                }

            } else res.end();

        } catch(error) {
            app.error("Error when serving app \"" + app.path + "\", requesting \"" + req.path + "\": ", error);

            try {
                backend.helper.send(req, res, "<b>Internal Server Error - Incident log was saved.</b>", null, 500);
            } catch {}
        }
    }


    /*
        To be replaced with a more advanced dynamic content handler
    */
    ServeDynamicContent(req, res, content, headers, app, url){
        res.cork(() => {
            // undefined will delay sending
            backend.helper.send(req, res, undefined, headers);

            for(let chunk of content){
                if(!(chunk instanceof Buffer)){

                    switch(chunk.name){
                        case "dynamicImport":
                            
                            if(!app.path) break;
            
                            for(let item of chunk.attributes){
                                try {
                                    const path = app.path + "/" + item.replace("$original_path", req.original_url);

                                    parserContext.data = { plain: true, dynamic: false, compress: true, app, url };
                                    res.write(parser.fromFile(files_try(path +  + ".html", path + "/index.html", path) || path, parserContext))
                                } catch (error) {
                                    this.warn("Failed to import: importing " + item, error)
                                }
                            }
                            break;
                    }

                } else res.write(chunk)
            }

            res.end()
        })
    }


    onIPCRequest(path, args, respond){
        switch(path){
            case "list":
                respond(null, this.list())
                break

            case "list.domains":
                respond(null, this.listDomains(request[1]))
                break

            case "list.getDomain":
                respond(null, this.getDomain(request[1]))
                break

            case "enable":
                respond(null, this.enableApp(request[1]))
                break

            case "disable":
                respond(null, this.disableApp(request[1]))
                break

            case "reload":
                respond(null, this.reloadApp(request[1]))
                break

            case "tempDomain":
                respond(null, this.tempDomain(request[1]))
                break
        }
    }


    // Utility functions

    getApp(path_or_name){
        if(!path_or_name) return null;
        if(path_or_name.includes("/") && fs.existsSync(path_or_name)) return path_or_name;

        const found = applicationCache.find(app => app.basename === path_or_name);

        return found && found.path
    }

    list(){
        for(let app of applicationCache){
            app.domains = [...assignedDomains.keys()].filter(domain => assignedDomains.get(domain).path === app.path)
        }

        return applicationCache
    }

    enableApp(app_path){
        if(!(app_path = this.util.getApp(app_path))) return false;
        
        for(let application of applications.values()) {
            if(application.path === app_path) {
                application.enabled = true
                backend.kvdb.apps.commitSet(`${app_path}.enabled`, true)
                return true
            }
        }

        return false
    }

    disableApp(app_path){
        if(!(app_path = this.util.getApp(app_path))) return false;
    
        for(let application of applications.values()) {
            if(application.path === app_path) {
                application.enabled = false
                backend.kvdb.apps.commitSet(`${app_path}.enabled`, false)
                return true
            }
        }

        return false
    }

    listDomains(app_path){
        if(!(app_path = this.util.getApp(app_path))) return false;

        let list = [];

        for(domain in assignedDomains.keys()){
            if(assignedDomains.get(domain).path === app_path) list.push(domain);
        }

        return list;
    }

    reloadApp(app_path = null){
        if(app_path && !(app_path = this.util.getApp(app_path))) return false;
        return this.reload(app_path || null)
    }

    getDomain(app_path){
        if(!(app_path = this.util.getApp(app_path))) return false;

        for(domain in assignedDomains.keys()){
            if(assignedDomains.get(domain).path === req.getQuery(app_path)) return domain;
        }

        return "";
    }

    tempDomain(app_path){
        if(!(app_path = this.util.getApp(app_path))) return false;

        let random = backend.uuid();
        assignedDomains.set(random, applications.get(app_path));

        return random;
    }
}


// Section: utils
function files_try(...files){
    for(let file of files){
        if(fs.existsSync(file)){
            return file
        }
    }
}

function requestCachedFile(file, cacheKey){
    // file = nodePath.normalize(file);

    const key = file + (cacheKey || "");

    let cachedFile = cache.get(key);
    let mtime = fs.statSync(file).mtimeMs;

    if(cachedFile
        && (
            // ((Date.now() - cachedFile.updateTimer) < 1000) ||
            mtime <= cachedFile.lastModifyTime
        )
    ) {
        // cachedFile.updateTimer = Date.now()
        return cachedFile
    }

    if(!cachedFile) {
        cachedFile = {}
        cache.set(key, cachedFile)
    }

    cachedFile.lastModifyTime = mtime;
    cachedFile.refresh = true;
    // cachedFile.updateTimer = Date.now();

    return cachedFile
}

function updateCache(file, cacheKey, content, headers){
    if(typeof cacheKey !== "string") cacheKey = "";

    let cached = cache.get(file + cacheKey);

    if(!cached) {
        // Update the cache
        cached = requestCachedFile(file, cacheKey);
    }

    cached.content = content;
    cached.refresh = false;
    cached.headers = headers;
}


function checkSupportedBrowser(userAgent, properties) {
    const ua = userAgent.toLowerCase();

    if (properties.chrome && ua.includes('chrome')) {
        const match = ua.match(/chrome\/(\d+)/);

        if(properties.disableChrome) return false;

        if (match && parseInt(match[1], 10) < +properties.chrome) return false;

    } else if (properties.firefox && ua.includes('firefox')) {
        const match = ua.match(/firefox\/(\d+)/);

        if(properties.disableFirefox) return false;

        if (match && parseInt(match[1], 10) < +properties.firefox) return false;

    } else if (ua.includes('msie') || ua.includes('trident')) return false;

    return true; // Allow by default if the browser could not be determined
}


const ls_path = "/www/content/akeno" + "/cdn/ls"; // should be backend.path
const latest_ls_version = fs.existsSync(ls_path + "/version")? fs.readFileSync(ls_path + "/version", "utf8").trim(): "5.1.0";
const ls_components = {
    // JS-only components
    js: [
        'reactive',
        'network',
        'reactive',
        'tabs',
        'toast',
        'tooltips',
        'v4compat'
    ],

    // CSS-only components
    css: ["flat"]
};

// if(fs.existsSync(ls_path)) {
//     for (const file of fs.readdirSync(ls_path + "/dist/dev/js")) {
//         if (file.endsWith(".js")) {
//             ls_components.js.push(nodePath.basename(file, ".js"));
//         }
//     }

//     for (const file of fs.readdirSync(ls_path + "/dist/dev/css")) {
//         if (file.endsWith(".css")) {
//             ls_components.css.push(nodePath.basename(file, ".css"));
//         }
//     }

//     console.log("Found components: ", ls_components);
// }


function initParser(header){
    parser = new WebNative.parser({
        header,
        buffer: true,
        compact: backend.compression.enabled,

        onText(text, parent, context) {
            // Inline script/style compression
            switch (parent){
                case "script":
                    // if(script_type && script_type !== "text/javascript") break; # TODO: Add back support for other script types
                    return text ?? (context.compress? backend.compression.code(text) : text);

                case "style":
                    return text ?? (context.compress? backend.compression.code(text, backend.compression.format.CSS) : text);
            }

            // Parse with Atrium, text gets sent back to C++, blocks get handled via onBlock
            parse(text, context)
        },

        onEnd(context){
            // context.data = null;
        }
    });

    parserContext = parser.createContext();

    WebNative.context.prototype.onBlock = function(block){
        const parent = this.getTagName();

        switch(block.name) {
            case "use":
                // if(parent !== "head") {
                //     server.warn("Error in app " + this.data.app.path + ": @use can only be used in <head>.");
                //     break
                // }

                // Modules
                for(const entry of block.attributes){
                    const has_component_list = typeof entry !== "string";

                    let attrib = has_component_list? entry.name: entry;

                    const components = has_component_list && entry.values.length > 0? []: backend.constants.EMPTY_ARRAY;

                    // We sort alphabetically and remove duplicates to maximize cache hits
                    // This is the fastest method based on my benchmark: https://jsbm.dev/Au74tivWZWKEo
                    if(has_component_list) {
                        let last = null;
                        for (let v of entry.values.sort()) {
                            let lower = attrib === "google-fonts"? v: v.toLowerCase();
                            if (v && lower !== last) {
                                components.push(lower);
                                last = lower;
                            }
                        }
                    }

                    const v_start_index = attrib.lastIndexOf(":");

                    let version = v_start_index !== -1? attrib.substring(v_start_index +1): null;
                    if(v_start_index !== -1) attrib = attrib.substring(0, v_start_index);

                    if(attrib === "ls" || attrib.startsWith("ls.")){
                        if(!version) {
                            if(this.data.ls_version) {
                                version = this.data.ls_version;
                            } else {
                                console.error(`Error in app "${this.data.app.path}": No version was specified for LS in your app. This is no longer supported - you must specify a version, for example ${attrib}:${latest_ls_version}. To enforce the latest version, use ${attrib}:latest`);
                                break;
                            }
                        }

                        if(version === "latest") version = latest_ls_version;

                        this.data.ls_version = version;

                        const is_merged = attrib === "ls";

                        let components_string;

                        if(is_merged || attrib === "ls.css") {
                            components_string = (is_merged? components.filter(value => !ls_components.js.includes(value)): components).join();

                            if(!(components_string.length === 0 && this.data.using_ls_css)) {
                                this.write(`<link rel=stylesheet href="${server.etc.EXTRAGON_CDN}/ls/${version}/${components_string? components_string + "/": ""}${this.data.using_ls_css? "bundle": "ls"}.${this.data.compress? "min." : ""}css">`);
                                this.data.using_ls_css = true;
                            }
                        }
                        
                        if(is_merged || attrib === "ls.js") {
                            components_string = (is_merged? components.filter(value => !ls_components.css.includes(value)): components).join();

                            if(!(components_string.length === 0 && this.data.using_ls_js)) {
                                this.write(`<script src="${server.etc.EXTRAGON_CDN}/ls/${version}/${components_string? components_string + "/": ""}${this.data.using_ls_js? "bundle": "ls"}.${this.data.compress? "min." : ""}js"></script>`);
                                this.data.using_ls_js = true;
                            }
                        }

                        this.data.using_ls = true;
                        continue;
                    }


                    switch(attrib){
                        case "bootstrap-icons":
                            this.write(`<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/bootstrap-icons@${version || "1.11.3"}/font/bootstrap-icons.min.css">`)
                            break;

                        case "fa-icons":
                            this.write(`<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version || "6.7.0"}/css/all.min.css">`)
                            break;
                        
                        case "fa-brands":
                            this.write(`<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version || "6.7.0"}/css/brands.min.css">`)
                            break;
                        
                        case "google-fonts":
                            if(!this.data.flag_google_fonts_preconnect){
                                this.write(`<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin>`)
                                this.data.flag_google_fonts_preconnect = true;
                            }

                            if(components.length > 0) this.write(`<link rel=stylesheet href="https://fonts.googleapis.com/css2?${components.map(font => "family=" + font.replaceAll(" ", "+")).join("&")}&display=swap">`)
                            break;

                        default:
                            if(attrib.includes("/")){
                                if(attrib.startsWith("http")){
                                    server.warn("Error in app " + this.data.app.path + ": @use does not allow direct URL imports (\"" + attrib + "\") - please define a custom @source or use a different way to import your content.");
                                    break;
                                }

                                const path = this.data.app.path + "/" + attrib;
                                if(fs.existsSync(path)){
                                    const link = map_resource(attrib, this.data.app.path);

                                    if(link) {
                                        const extension = attrib.slice(attrib.lastIndexOf('.') + 1);

                                        switch(extension){
                                            case "js":
                                                this.write(`<script src="${link}" ${components.join(" ")}></script>`)
                                                break;
                                            case "css":
                                                this.write(`<link rel=stylesheet href="${link}" ${components.join(" ")}>`)
                                                break;
                                            case "json":
                                                this.write(`<script type="application/json" id="${components || attrib}">${fs.readFileSync(path)}</script>`)
                                                break;
                                        }
                                    }
                                }
                            } else {
                                this.data.app.warn("Error: Unknown module \"" + attrib + "\"");
                            }
                    }
                }
                break;

            case "page":
                if(parent !== "head") {
                    this.data.app.warn("Error: @page can only be used in <head>.");
                    break
                }

                this.write(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`)

                if(block.properties.title) {
                    this.write(`<title>${block.properties.title}</title>`)
                }

                let bodyAttributes = this.data.using_ls_css? "ls": "";

                if(this.data.using_ls_css) {
                    if(block.properties.theme) {
                        bodyAttributes += ` ls-theme="${block.properties.theme}"`;
                    }
    
                    if(block.properties.accent) {
                        bodyAttributes += ` ls-accent="${block.properties.accent}"`;
                    }
    
                    if(block.properties.style) {
                        bodyAttributes += ` ls-style="${block.properties.style}"`;
                    }    
                }

                if(block.properties.font) {
                    bodyAttributes += this.data.using_ls_css? ` style="--font:${block.properties.font}"`: ` style="font-family:${block.properties.font}"`;
                }

                if(block.properties.favicon) {
                    const baseName = nodePath.basename(block.properties.favicon);
                    let extension = baseName, lastIndex = baseName.lastIndexOf('.');

                    if (lastIndex !== -1) {
                        extension = baseName.slice(lastIndex + 1);
                    }

                    let mimeType = backend.mime.getType(extension) || "image/x-icon";

                    this.write(`<link rel="shortcut icon" href="${block.properties.favicon}" type="${mimeType}">`)
                }

                this.setBodyAttributes(bodyAttributes)

                if(typeof block.properties.meta === "object"){
                    // for(let key in block.properties.meta){
                    //     this.write(`<meta name="${key}" content="${block.properties.meta[key]}">`)
                    // }
                }
                break;

            case "import":
                if(!this.data.app.path) break;

                for(let item of block.attributes){
                    try {
                        this.import(this.data.app.path + "/" + item);
                    } catch (error) {
                        this.data.app.warn("Failed to import: importing " + item, error)
                    }
                }
                break;

            case "importRaw":
                if(!this.data.app.path) break;

                for(let item of block.attributes){
                    try {
                        let content = fs.readFileSync(this.data.app.path + "/" + item, "utf8");
                        this.write(!!block.properties.escape? content.replace(/'/g, '&#39;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : content)
                    } catch (error) {
                        this.data.app.warn("Failed to import (raw): importing " + item, error)
                    }
                }
                break;

            case "dynamicImport":
                if(!this.data.app.path) break;

                for(let item of block.attributes){
                    try {
                        this.import(this.data.app.path + "/" + item);
                    } catch (error) {
                        this.data.app.warn("Failed to import: importing " + item, error)
                    }
                }
                break;

            case "print":
                for(let attrib of block.attributes){
                    this.write(attrib.replace(/\$\w+/, () => { return "" }))
                }
                break;

            default:
                block = null;
        }
    }
}

function map_resource(link, local_path){
    if(local_path && !link.startsWith("http")){
        const assetPath = local_path + "/" + link;
        link += `${link.includes("?")? "&": "?"}mtime=${(fs.statSync(assetPath).mtimeMs).toString(36)}`
    }

    return link
}

module.exports = server