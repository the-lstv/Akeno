

/*

    Welcome to the Akeno web backend!
    This is an extension to Akeno created for static/dynamic web application handling,
    optimized for performance, with on-the-fly code compression, smart caching etc.

    It also features a dynamic HTML processor.

*/

// Section: variables

let
    // Libraries
    fs = require("fs"),
    nodePath = require("path"),
    uws = require('uWebSockets.js'),

    { Parser } = require('htmlparser2'),
    picomatch = require('picomatch'),

    // { xxh32 } = require("@node-rs/xxhash"),

    // Local libraries
    { parse, configTools } = require("./parser"),

    // Globals
    server,

    applications = new Map,
    applicationCache = [], // debug purposes

    // Backend object
    backend,

    // Cache && optimisation helpers
    assignedDomains = new Map,
    cache = new Map,

    // Maximal cache size for binary files per-file.
    // If a file is bigger than this, it is not saved and served from RAM.
    max_cache_size = 367001600,

    cacheByFile = {
        html: "15",
        js: "604800",
        css: "604800",
        default: "50000"
    }
;



server = {
    Initialize($){
        backend = $;

        // Constants
        const html_header = Buffer.from(`<!DOCTYPE html>\n<!-- Auto-generated code. Powered by Akeno v${backend.version} - https://github.com/the-lstv/Akeno -->\n<html lang="en">`);

        server.etc = {
            html_header,
            notfound_error: Buffer.concat([html_header, Buffer.from(`<h2>No website was found for this URL.</h2>Additionally, nothing was found to handle this error.<br><br><hr>Powered by Akeno/${backend.version}</html>`)]),
            default_disabled_message: Buffer.from(backend.config.block("web").get("disabledMessage", String) || "This website is temporarily disabled."),
            ls_url: `://cdn.extragon.cloud/ls/`,
            ls_url_dev: `://cdn.extragon.test/ls/`,
        };

        server.reload()
    },

    async reload(specific_app){
        if(specific_app) return server.load(specific_app);

        backend.refreshConfig();

        const start = performance.now();

        const webConfig = backend.config.block("web");
        const locations = webConfig.get("locations") || [];

        // Looks for valid application locations
        for(let location of locations){
            if(location.startsWith("./")) location = backend.path + location.slice(1);

            if(!fs.existsSync(location.replace("/*", ""))) {
                server.log.warn("Web application (at " + location + ") does not exist - skipped.");
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
                return server.log.warn("Web application (at " + location + ") is a file - skipped.")
            }

            server.load(location)
        }

        server.log(`Loaded ${locations.length} web application${locations.length > 1? "s": ""} in ${(performance.now() - start).toFixed(2)}ms`);
    },


    load(path){

        // TODO: Hot reloading is almost functional, but needs config validation and re-parsing to be finished
        // if(applications.has(path)) return false;

        let app = applications.get(path);

        if(!app) {
            app = server._createApp(path)
            if(!app) return false;
        } else {
            server.log.verbose("Hot-reloading web application (at " + path + ")");
            app.config = server.loadAppConfig(path)
        }

        if(!app.config) return false;

        const is_enabled = backend.kvdb.apps.get(`${path}.enabled`, Boolean)
        app.enabled = (is_enabled === null? true: is_enabled) || false;


        const enabledDomains = app.config.block("server").get("domains") || [];

        if(enabledDomains.length > 0 || app.domains.size > 0){
            const domains = new Set([...enabledDomains, ...app.domains]);

            for(let domain of domains){
                if(!domain || typeof domain !== "string") {
                    server.log.warn("Invalid domain name \"" + domain + "\" for web application \"" + app.basename + "\".");
                    continue
                }

                if(!enabledDomains.includes(domain)){
                    assignedDomains.delete(domain);
                    app.domains.delete(domain);
                    continue
                }

                assignedDomains.set(domain, app);
                app.domains.add(domain);
            }
        }


        const enabledPorts = app.config.block("server").get("port") || [];

        if(enabledPorts.length > 0 || app.ports.size > 0){
            const ports = new Set([...enabledPorts, ...app.ports]);

            for (let port of ports) {
                if(!port || typeof port !== "number" || port < 1 || port > 65535) {
                    server.log.warn("Invalid port number \"" + port + "\" for web application \"" + app.basename + "\" - skipped.");
                    continue
                }

                if(app.ports.has(port)){
                    if(!enabledPorts.includes(port)){
                        app.ports.delete(port);

                        if(app.uws){
                            uws.us_listen_socket_close(app.sockets.get(port));
                            app.uws.close();
                            app.uws = null;
                        }

                        server.log(`Web application "${app.basename}" is no longer listening on port ${port}`);
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
                    server.log.warn("Port " + port + " is already in use by \"" + found.basename + "\" - skipped.");
                    continue
                }
                
                app.ports.add(port);

                const flags = { app };

                if(!app.uws) {
                    app.uws = uws.App().any('/*', (res, req) => {
                        backend.resolve(res, req, flags)
                    })

                    app.sockets = new Map;
                }

                app.uws.listen(port, (socket) => {
                    if(socket) {
                        app.sockets.set(port, socket)
                        server.log(`Web application "${app.basename}" is listening on port ${port}`);
                    } else {
                        server.log.error(`Failed to start web application "${app.basename}" on port ${port}`);
                    }
                })
            }
        }

        for(let api of app.config.blocks("api")){
            backend.apiExtensions[api.attributes[0]] = app.path + "/" + api.attributes[1]
        }

        // Reload modules
        for(let [name, module] of app.modules){
            module.restart()
        }

        for(let api of app.config.blocks("module")){
            // TODO: Proper module system
            const name = api.attributes[0];

            if(app.modules.has(name)) continue;

            let module;
            try {
                module = new backend.Module(`${app.basename}/${name}`, { path: app.path + "/" + api.get("path", String), autoRestart: api.get("autoRestart", Boolean, false) });
            } catch (error) {
                server.log.error("Failed to load module " + name + " for web application " + app.basename + ": " + error.toString() + ". You can reload the app to retry.");
                continue
            }

            app.modules.set(name, module)
        }

        return true

    },


    loadAppConfig(path){
        let configPath = files_try(path + "/app.conf", path + "/app.manifest");

        if(!configPath){
            server.log.warn("Web application (at " + path + ") failed to load - no config file found - skipped.");
            return
        }

        return configTools(parse(fs.readFileSync(configPath, "utf8"), {
            strict: true,
            asLookupTable: true
        }))
    },


    _createApp(path){
        if(applications.has(path)) return;

        const config = server.loadAppConfig(path);

        if(!config) return;

        const app = {
            path,

            basename: nodePath.basename(path),

            enabled: null,

            config,

            ports: new Set,

            /**
             * @warning Do not use this set for routing - it is only a reference to allow for easy removal of domains.
             */
            domains: new Set,

            modules: new Map
        }

        applications.set(app.path, app)

        // Only for quick retrieval of website information
        applicationCache.push({
            basename: app.basename,
            path,

            get enabled(){
                return app.enabled
            },

            get ports(){
                return [...app.ports]
            }
        })

        return app
    },


    ServeCache(req, res, cache, app, url){
        // Dynamic content
        if(Array.isArray(cache.content)){
            return server.ServeDynamicContent(req, res, cache.content, cache.headers, app, url)
        }

        return backend.helper.send(req, res, cache.content, cache.headers)
    },


    async HandleRequest({ segments, req, res, flags }){
        // This is the main handler/router for websites/webapps.

        if(req.domain.startsWith("www.")) req.domain = req.domain.slice(4);

        const app = flags.app || (assignedDomains.get(req.domain) ?? assignedDomains.get(":default"));

        if(!app) return res.cork(() => {
            res.writeHeader('Content-Type', 'text/html').writeStatus('404 Not Found').end(server.etc.notfound_error)
        })

        // HTTPS Redirect
        if(!req.secure && !backend.isDev && app.config.block("server").get("redirect_https", Boolean)){
            res.writeStatus('302 Found').writeHeader('Location', `https://${req.getHeader("host")}${req.path}`).end();
            return
        }

        // When the app is disabled
        if(!app.enabled){
            backend.helper.send(req, res, app.config.block("server").get("disabled_message", String, server.etc.default_disabled_message), null, "422")
            return
        }

        if(app.config.data.has("browserSupport")){
            let browserRequirements = app.config.block("browserSupport");

            if(!checkSupportedBrowser(req.getHeader('user-agent'), browserRequirements.properties)){
                res.cork(() => {
                    res.writeHeader('Content-Type', browserRequirements.get("contentType", String, 'text/html')).writeStatus('403 Forbidden').end(browserRequirements.get("message", String, `<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${browserRequirements.chrome && browserRequirements.chrome[0]} and up, Firefox ${browserRequirements.firefox && browserRequirements.firefox[0]} and up.`))
                })
                return
            }
        }


        let url = req.original_url = `/${segments.join("/")}`;


        // Redirects
        if(app.config.data.has("redirect")) for(const handle of app.config.blocks("redirect")){
            const target = handle.get("to", String);

            if(target && (handle.picomatchCache || (handle.picomatchCache = picomatch(handle.attributes)))(url)){
                res.writeStatus('302 Found').writeHeader('Location', target).end();
                return
            }
        }


        // Redirect handles
        if(app.config.data.has("handle")) for(const handle of app.config.blocks("handle")){
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
        if(app.config.data.has("route")) for(const route of app.config.blocks("route")){
            if((route.picomatchCache || (route.picomatchCache = picomatch(route.attributes)))(url)){
                const negate = route.get("not");

                if(!negate || !negate.length || !(route.negate_picomatchCache || (route.negate_picomatchCache = picomatch(negate)))(url)){
                    url = `/${route.get("to", String)}`
                    break
                }
            }
        }


        // Finally, handle content
        try {

            let file = files_try(app.path + url + ".html", app.path + url + "/index.html", app.path + url);

            if(!file){
                file = app.config.block("errors").get("code", String) || app.config.block("errors").get("default", String)

                if(!file){
                    return backend.helper.send(req, res, url + " not found", null, "404 Not Found");
                } else file = app.path + file
            }
            
            file = nodePath.normalize(file);

            if(fs.statSync(file).isDirectory()){
                return backend.helper.send(req, res, "You have landed in " + url + " - which is a directory.");
            }


            // TODO: Once uWS implements low-level cache, add support for it

            // Check if the file has not been changed since
            const cache = requestCachedFile(file);


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

            server.log.verbose(`[${app.basename}] Serving request for ${req.domain}, path ${url}, file ${file || "<not found>"}`)

            let content;

            switch(extension){
                case "html":
                    content = parse_html_content({ url, file, app, compress: true, secure: req.secure })
                break;

                case "js": case "css":
                    content = fs.readFileSync(file, "utf8");
                    content = content && (backend.compression.code(content, extension === "css") || content)
                break;

                default:
                    content = fs.readFileSync(file);
            }

            if(content) {
                if(Array.isArray(content)){
                    // Dynamic content!
                    server.ServeDynamicContent(req, res, content, headers, app, url)
                } else backend.helper.send(req, res, content, headers);

                if(content.length <= max_cache_size) updateCache(file, content, headers);
            } else res.end();



        } catch(error) {
            server.log.error("Error when serving app \"" + app.path + "\", requesting \"" + req.path + "\": ")
            console.error(error)

            try {
                backend.helper.send(req, res, "<b>Internal Server Error - Incident log was saved.</b>", null, 500)
            } catch {}
        }
    },


    /*
        Optimized handler for dynamic server-side content generation, for when you need to generate data on every request.
        Parsing is only done once and is fully cached for all dynamic requests - you only fill in the data.
        Still, use with caution. Is still much slower than regular static files, and if you only need to update dynamic data
        once in a while and they otherwise are the same for all requests, please avoid using it.
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

                                    res.write(parse_html_content({ file: files_try(path +  + ".html", path + "/index.html", path) || path, plain: true, dynamic: false, compress: true, app, url }))
                                } catch (error) {
                                    console.warn("Failed to import: importing " + item, error)
                                }
                            }
                            break;
                    }

                } else res.write(chunk)
            }

            res.end()
        })
    },


    util: {
        getApp(path_or_name){
            if(!path_or_name) return null;
            if(path_or_name.includes("/") && fs.existsSync(path_or_name)) return path_or_name;

            const found = applicationCache.find(app => app.basename === path_or_name);

            return found && found.path
        },
        
        list(){
            for(let app of applicationCache){
                app.domains = [...assignedDomains.keys()].filter(domain => assignedDomains.get(domain).path === app.path)
            }

            return applicationCache
        },

        enable(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;
            
            for(let application of applications.values()) {
                if(application.path === app_path) {
                    application.enabled = true
                    backend.kvdb.apps.commitSet(`${app_path}.enabled`, true)
                    return true
                }
            }

            return false
        },

        disable(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;
        
            for(let application of applications.values()) {
                if(application.path === app_path) {
                    application.enabled = false
                    backend.kvdb.apps.commitSet(`${app_path}.enabled`, false)
                    return true
                }
            }

            return false
        },

        listDomains(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            let list = [];

            for(domain in assignedDomains.keys()){
                if(assignedDomains.get(domain).path === app_path) list.push(domain);
            }

            return list;
        },

        reload(app_path = null){
            if(app_path && !(app_path = server.util.getApp(app_path))) return false;
            return server.reload(app_path || null)
        },

        getDomain(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            for(domain in assignedDomains.keys()){
                if(assignedDomains.get(domain).path === req.getQuery(app_path)) return domain;
            }

            return "";
        },

        tempDomain(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            let random = backend.uuid();
            assignedDomains.set(random, applications.get(app_path));

            return random;
        }
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

function requestCachedFile(file){
    // file = nodePath.normalize(file);

    // Should never happen since this is checked before requesting cache
    // if(!fs.existsSync(file)){
    //     return 0
    // }

    let cachedFile = cache.get(file), mtime = fs.statSync(file).mtimeMs;

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
        cache.set(file, cachedFile)
    }

    cachedFile.lastModifyTime = mtime;
    cachedFile.refresh = true;
    // cachedFile.updateTimer = Date.now();

    return cachedFile
}

function updateCache(file, content, headers){
    let cached = cache.get(file);

    if(!cached) {
        requestCachedFile(file)
        cached = cache.get(file);
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

        if (match && parseInt(match[1], 10) < +properties.chrome[0]) return false;

    } else if (properties.firefox && ua.includes('firefox')) {
        const match = ua.match(/firefox\/(\d+)/);

        if(properties.disableFirefox) return false;

        if (match && parseInt(match[1], 10) < +properties.firefox[0]) return false;

    } else if (ua.includes('msie') || ua.includes('trident')) return false;

    return true; // Allow by default if the browser could not be determined
}

let latest_ls_version = fs.existsSync("/www/content/akeno/cdn/ls/source/version")? fs.readFileSync("/www/content/akeno/cdn/ls/source/version", "utf8").trim(): "5.0.0";

function map_resource(link, local_path){
    if(local_path && !link.startsWith("http")){
        const assetPath = local_path + "/" + link;
        link += `${link.includes("?")? "&": "?"}mtime=${(fs.statSync(assetPath).mtimeMs).toString(36)}`
    }

    return link
}


const html_element_alias = new Map;

html_element_alias.set("page", "body") // Backwards-compatibility with the old, outdated parser
html_element_alias.set("shader", "script")

const voidElements = new Set([
    "area",
    "base",
    "basefont",
    "br",
    "col",
    "command",
    "embed",
    "frame",
    "hr",
    "img",
    "input",
    "isindex",
    "keygen",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

function parse_html_content(options){
    if(options.file){
        const cache = requestCachedFile(options.file);
        if(!cache.refresh) return cache.content;
    }

    const htmlContent = options.content? options.content: options.file? fs.readFileSync(options.file, "utf8"): "";

    if(htmlContent.length < 1) return Buffer.from("");

    const output = [ null ]; // null for adding the header

    let head_string_index = null, head = options.head || '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">';

    let currentTag = null, script_type = null;

    if(!options.app) options.app = {};

    const misc = {
        default_attributes: options.default_attributes || {
            body: {}
        }
    }

    function push(data){
        if(!data) return;

        if(typeof data === "string"){
            if(options.compress){
                data = (data.startsWith(" ")? " " : "") + data.trim() + (data.endsWith(" ")? " " : "");
                if(data.length === 0) return;
            }
            data = Buffer.from(data)
        }

        if(data instanceof Buffer){

            const last = output.at(-1);
            if(Array.isArray(last)) {
                last.push(data)
            } else {
                output.push([data])
            }

        } else output.push(data);
    }

    // This gets called once a block finishes parsing, with the block in question.
    function process_block(block){
        switch(block.name) {
            case "no-init": case "plain":
                options.plain = true
                head = ""
                break;

            case "dynamic":
                options.dynamic = Boolean(block.attributes[0])
                break;

            case "print":
                for(let attrib of block.attributes){
                    push(attrib.replace(/\$\w+/, () => { return "" }))
                }
                break;

            case "import":
                if(!options.app.path) break;

                for(let item of block.attributes){
                    try {
                        push(parse_html_content({file: options.app.path + "/" + item, plain: true, app: options.app, compress: !!options.compress, url: options.url || null}))
                    } catch (error) {
                        console.warn("Failed to import: importing " + item, error)
                    }
                }
                break;

            case "importRaw":
                if(!options.app.path) break;

                for(let item of block.attributes){
                    try {
                        let content = fs.readFileSync(options.app.path + "/" + item, "utf8");
                        push(!!block.properties.escape? content.replace(/'/g, '&#39;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : content)
                    } catch (error) {
                        console.warn("Failed to import (raw): importing " + item, error)
                    }
                }
                break;

            case "manifest":
                if(block.properties.title) {
                    push(`<title>${block.properties.title[0]}</title>`)
                }

                if(block.properties.favicon) {
                    const baseName = nodePath.basename(block.properties.favicon[0]);
                    let extension = baseName, lastIndex = baseName.lastIndexOf('.');

                    if (lastIndex !== -1) {
                        extension = baseName.slice(lastIndex + 1);
                    }

                    let mimeType = backend.mime.getType(extension) || "image/x-icon";

                    push(`<link rel="shortcut icon" href="${block.properties.favicon[0]}" type="${mimeType}">`)
                }

                if(block.properties.theme) {
                    misc.default_attributes.body["ls-theme"] = block.properties.theme[0]
                }

                if(block.properties.style) {
                    misc.default_attributes.body["ls-style"] = block.properties.style[0]
                }

                if(block.properties.accent) {
                    misc.default_attributes.body["ls-accent"] = block.properties.accent[0]
                }
                break;

            case "resources":
                if(block.properties["ls-js"]){
                    misc.default_attributes.body.ls = "";

                    let version = block.properties["ls-version"] && block.properties["ls-version"][0];
                    let devChannel = backend.isDev? (block.properties["ls-channel"] && block.properties["ls-channel"][0]) !== "prod": false;

                    if(!version) {
                        version = "4.0.1"
                        console.error("Warning for app " + options.app.path + ": No version was specified for LS in your app. This is deprecated and will stop working soon, please specify a version with ls-version. To explicitly set the latest version, set ls-version to latest. Defaulting to a LEGACY version (4.0.1) instead of " + latest_ls_version + ".");
                    } else if(version === "latest") version = latest_ls_version;

                    let url = `http${options.secure? "s" : ""}${devChannel? server.etc.ls_url_dev : server.etc.ls_url}${version}/${block.properties["ls-js"][0] === true? "": block.properties["ls-js"].join(",") + "/"}ls.${!backend.isDev && options.compress? "min." : ""}js`;

                    const part = `<script src="${url}"></script>`;
                    if(!options.plain) head += part; else push(part);
                }
            
                if(block.properties["ls-css"]){
                    misc.default_attributes.body.ls = "";

                    let version = block.properties["ls-version"] && block.properties["ls-version"][0];
                    let devChannel = backend.isDev? (block.properties["ls-channel"] && block.properties["ls-channel"][0]) !== "prod": false;

                    if(!version) {
                        version = "4.0.1"
                        console.error("Warning for app " + options.app.path + ": No version was specified for LS in your app. This is deprecated and will stop working soon, please specify a version with ls-version. To explicitly set the latest version, set ls-version to latest. Defaulting to a LEGACY version (4.0.1) instead of " + latest_ls_version + ".");
                    } else if(version === "latest") version = latest_ls_version;

                    let url = `http${options.secure? "s" : ""}${devChannel? server.etc.ls_url_dev : server.etc.ls_url}${version}/${block.properties["ls-css"][0] === true? "": block.properties["ls-css"].join(",") + "/"}ls.${!backend.isDev && options.compress? "min." : ""}css`;
                    
                    const part = `<link rel=stylesheet href="${url}">`
                    if(!options.plain) head += part; else push(part);
                }

                if(block.properties.js) {
                    for(let resource of block.properties.js) {
                        const link = map_resource(resource, options.app.path);

                        if(link) {
                            const part = `<script src="${link}"></script>`
                            if(!options.plain) head += part; else push(part);
                        }
                    }
                }

                if(block.properties.css) {
                    for(let resource of block.properties.css) {
                        const link = map_resource(resource, options.app.path);

                        if(link) {
                            const part = `<link rel=stylesheet href="${link}">`
                            if(!options.plain) head += part; else push(part);
                        }
                    }
                }

                if(block.properties["bootstrap-icons"] || (block.properties.icons && block.properties.icons.includes("bootstrap"))) {
                    const part = `<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">`
                    if(!options.plain) head += part; else push(part);
                }

                if(block.properties["fa-icons"] || (block.properties.icons && block.properties.icons.includes("fa"))) {
                    const part = `<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.0/css/all.min.css">`
                    if(!options.plain) head += part; else push(part);
                }

                if(block.properties.fonts) {
                    const part = `<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin><link rel=stylesheet href="${`https://fonts.googleapis.com/css2?${block.properties.fonts.map(font => {
                        return "family=" + font.replaceAll(" ", "+") + ":wght@100;200;300;400;500;600;700;800;900"
                    }).join("&")}&display=swap`}">`

                    if(!options.plain) head += part; else push(part);
                }

                break;

            default:
                if(options.dynamic) push(block); else block = null;
        }
    }

    const parser = new Parser({
        onopentag(name, attribs) {
            let result = "<";

            if(name === "shader" && !attribs.type) attribs.type = "x-shader/x-fragment";

            if(html_element_alias.has(name)) name = html_element_alias.get(name);

            script_type = name === "script" && attribs.type? attribs.type: null;
            currentTag = name;

            if(attribs.class) attribs.class; else attribs.class = "";

            result += name;

            // Assign default attributes
            if(misc.default_attributes[name]){
                Object.assign(attribs, misc.default_attributes[name])
            }

            for(let attr in attribs) {
                if (attr === "class" || attr === "id") continue;

                if (attr.startsWith('.')) {
                    attribs.class += " " + attr.slice(1).split(".").join(" ")
                    continue
                }

                if (attr.startsWith('%') || attr.startsWith('#')) {
                    attribs.id = attr.slice(1)
                    continue
                }

                let value = attribs[attr];

                if(value){
                    if (value.includes(`"`) && value.includes(`'`)) {
                        value = `"${value.replace(/"/g, '&quot;')}"`;
                    } else if (value.includes('"')) {
                        value = `'${value}'`;
                    } else if (value.includes(" ") || value.includes("'")) {
                        value = `"${value}"`;
                    }

                    result += ` ${attr}=${value}`;
                    continue
                }

                result += " " + attr;
            }

            if (attribs.class) result += ` class="${attribs.class.trim()}"`;
            if (attribs.id) result += ` id=${attribs.id.replaceAll(" ", "")}`;

            push(result + ">");

            if(name === "head" && head_string_index === null) {
                head_string_index = output.push(null) -1
            }
        },

        ontext(text) {
            // Inline script/style compression
            switch (currentTag){
                case "script":
                    if(script_type && script_type !== "text/javascript") break;

                    if(text) {
                        push(options.compress? backend.compression.code(text) : text)
                    }
                    return;

                case "style":
                    if(text) {
                        push(options.compress? backend.compression.code(text, true) : text)
                    }
                    return;
            }

            parse(text, { onText: push, onBlock: process_block, embedded: true, strict: false })
        },

        onclosetag(name) {
            if(html_element_alias.has(name)) name = html_element_alias.get(name);

            if(voidElements.has(name)) return;

            push(`</${name}>`);
        }
    }, {
        lowerCaseAttributeNames: false
    });

    parser.write(htmlContent);
    parser.end();

    if(!options.plain) {
        output[0] = options.header || server.etc.html_header;

        if(head){
            if(head_string_index !== null) output[head_string_index] = Buffer.from(head); else output[0] = Buffer.concat([output[0], Buffer.from(`<head>${head}</head>`)]);
        }

        push("</html>");
    }

    const content = condense_parsed_output(output, options.dynamic);

    if(options.file && content.length <= max_cache_size) updateCache(options.file, content, null);

    // Finally, condense buffers and return.
    return content;
}

function condense_parsed_output(data, allow_dynamic_content) {
    let bufferGroup = [];

    if(!allow_dynamic_content){
        let length = 0;

        for(let item of data){
            if (item instanceof Buffer) {
                bufferGroup.push(item);
                length += item.length
            } else if (Array.isArray(item)) {
                for(let _item of item){
                    if (_item instanceof Buffer) {
                        bufferGroup.push(_item);
                        length += _item.length
                    }
                }
            }
        }

        data = null;

        return Buffer.concat(bufferGroup)
    }

    let flattenedData = [];
    
    for (const item of data) {
        if (!item) continue;

        if (Array.isArray(item)) {
            for (const subItem of item) {
                if (subItem instanceof Buffer) {
                    bufferGroup.push(subItem);
                } else {
                    if (bufferGroup.length > 0) {
                        flattenedData.push(Buffer.concat(bufferGroup));
                        bufferGroup = [];
                    }

                    flattenedData.push(subItem);
                }
            }

        } else if (item instanceof Buffer) {

            bufferGroup.push(item);

        } else {

            if (bufferGroup.length > 0) {
                flattenedData.push(Buffer.concat(bufferGroup));
                bufferGroup = [];
            }

            flattenedData.push(item);

        }
    }

    if (bufferGroup.length > 0) {
        flattenedData.push(Buffer.concat(bufferGroup));
    }

    return flattenedData;
}





module.exports = server