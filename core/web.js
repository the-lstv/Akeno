

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

    { Parser } = require('htmlparser2'),

    { xxh32 } = require("@node-rs/xxhash"),

    // Local libraries
    { parse, parser_regex, configTools } = require("./parser"),

    // Globals
    server,

    applications = new Map,
    applicationCache = [], // debug purposes

    // backend object
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



let locations;

// Section: utils
function files_try(...files){
    for(let file of files){
        if(fs.existsSync(file)){
            return file
        }
    }
}

function cachedFile(file){
    file = nodePath.normalize(file);

    if(!fs.existsSync(file)){
        return 0
    }

    let cachedFile = cache.get(file);

    if(cachedFile
        && (
            ((Date.now() - cachedFile.updateTimer) < 1000) ||
            (fs.statSync(file).mtimeMs <= cachedFile.lastModifyTime)
        )
    ) {
        cachedFile.updateTimer = Date.now()
        return cachedFile.content
    }

    server.log.debug("File '" + file + "' has been updated; refreshing cache!");

    if(!cachedFile) {
        cachedFile = {}
        cache.set(file, cachedFile)
    }

    cachedFile.lastModifyTime = fs.statSync(file).mtimeMs,
    cachedFile.updateTimer = Date.now()

    return 1
}

function updateCache(file, content){
    file = nodePath.normalize(file);

    if(!cache.has(file)) cachedFile(file);

    cache.get(file).content = content;
    // cache.get(file).headers = headers;
}


function checkSupportedBrowser(userAgent, properties) {
    const ua = userAgent.toLowerCase();

    if (ua.includes('chrome') && properties.chrome) {
        const match = ua.match(/chrome\/(\d+)/);

        if(properties.disableChrome) return false;

        if (match && parseInt(match[1], 10) < +properties.chrome[0]) return false;
    } else if (ua.includes('firefox') && properties.firefox) {
        const match = ua.match(/firefox\/(\d+)/);

        if(properties.disableFirefox) return false;

        if (match && parseInt(match[1], 10) < +properties.firefox[0]) return false;

    } else if (ua.includes('msie') || ua.includes('trident')) return false;

    return true; // Allow by default if the browser could not be determined
}


let latest_ls_version = fs.existsSync("/www/content/akeno/cdn/ls/source/version")? fs.readFileSync("/www/content/akeno/cdn/ls/source/version", "utf8").trim(): "4.0.0",

    // Is set in initialization
    ls_url = null,
    html_header = null
;

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

function parse_html_content(options){
    const htmlContent = options.content? options.content: options.file? fs.readFileSync(options.file, "utf8"): "";

    const output = [ null ]; // null for the header

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
                break;

            case "dynamic":
                options.dynamic = true
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
                        console.warn("Failed to import: importing " + item, error.toString())
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
                        console.warn("Failed to import (raw): importing " + item, error.toString())
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
            
                    let url = `${ls_url}${block.properties["ls-version"]? block.properties["ls-version"][0]: latest_ls_version}/${block.properties["ls-js"].join(",")}/ls.${options.compress? "min." : ""}js`;

                    head += `<script src="${url}"></script>`;
                }
            
                if(block.properties["ls-css"]){
                    misc.default_attributes.body.ls = "";

                    let url = `${ls_url}${block.properties["ls-version"]? block.properties["ls-version"][0]: latest_ls_version}/${block.properties["ls-css"].join(",")}/ls.${options.compress? "min." : ""}css`;
                    
                    head += `<link rel=stylesheet href="${url}">`
                }

                if(block.properties.js) {
                    for(let resource of block.properties.js) {
                        const link = map_resource(resource, options.app.path);
                        if(link) head += `<script src="${link}"></script>`
                    }
                }

                if(block.properties.css) {
                    for(let resource of block.properties.css) {
                        const link = map_resource(resource, options.app.path);
                        if(link) head += `<link rel=stylesheet href="${link}"></link>`
                    }
                }

                if(block.properties["bootstrap-icons"] || (block.properties.icons && block.properties.icons.includes("bootstrap"))) {
                    head += `<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"></link>`
                }

                if(block.properties["fa-icons"] || (block.properties.icons && block.properties.icons.includes("fa"))) {
                    head += `<link rel=stylesheet href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.0/css/all.min.css"></link>`
                }

                if(block.properties.fonts) {
                    head += `<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin><link rel=stylesheet href="${`https://fonts.googleapis.com/css2?${block.properties.fonts.map(font => {
                        return "family=" + font.replaceAll(" ", "+") + ":wght@100;200;300;400;500;600;700;800;900"
                    }).join("&")}&display=swap`}">`
                }

                break;

            default:
                if(options.dynamic) push(block)
        }

    }

    const parser = new Parser({
        onopentag(name, attribs) {
            let result = "<";

            if(html_element_alias.has(name)) name = html_element_alias.get(name);

            if(name === "shader" && !attribs.type) attribs.type = "x-shader/x-fragment";

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

            parse({ content: text, onText: push, onBlock: process_block, embedded: true, strict: false })
        },

        onclosetag(name) {
            if(html_element_alias.has(name)) name = html_element_alias.get(name);

            if(parser_regex.singleton.indexOf(name) !== -1) return;
            push(`</${name}>`);
        }
    }, {
        lowerCaseAttributeNames: false
    });

    parser.write(htmlContent);
    parser.end();

    if(!options.plain) {
        output[0] = options.header || html_header;

        if(head){
            if(head_string_index !== null) output[head_string_index] = Buffer.from(head); else output[0] = Buffer.concat([output[0], Buffer.from(`<head>${head}</head>`)]);
        }
    
        push("</html>");
    }

    // Finally, condense buffers and return.
    return condense_parsed_output(output, options.dynamic);
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



server = {
    Initialize(_backend){
        backend = _backend;

        ls_url = `http${backend.isDev? "" : "s"}://cdn.extragon.${backend.isDev? "test" : "cloud"}/ls/`
        html_header = Buffer.from(`<!DOCTYPE html>\n<!-- Auto-generated code. Powered by Akeno v${backend.version} - https://github.com/the-lstv/Akeno -->\n<html lang="en">`)

        server.Reload(true)
    },


    async Reload(server_initiated, specific_app){
        if(!server_initiated){
            backend.refreshConfig()
        }

        if(specific_app){
            return server.load(specific_app)
        }


        let webConfig = backend.config.block("web");

        // Directories with web apps
        locations = webConfig.get("locations")

        await server.LoadAppliactions();
    },


    async LoadAppliactions(){
        // Looks for valid application locations
        for(let location of locations){
            if(location.startsWith("./")) location = backend.path + location.replace("./", "/");

            if(!fs.existsSync(location.replace("/*", ""))) {
                server.log.warn("Web application directory (" + location + ") does not exist");
                continue
            }

            // Handle wildcard (multi) locations
            if(location.endsWith("*")){
                let path = (location.replace("*", "") + "/").replaceAll("//", "/");
                locations.push(...fs.readdirSync(path).map(location => path + location).filter(path => fs.statSync(path).isDirectory()))
                continue
            }

            if(fs.statSync(location).isDirectory()){

                server.load(location)

            } else server.log.warn("Web application (at " + location + ") is a file - skipped.");
        }
    },


    load(path){

        // TODO: Hot reloading is almost functional, but needs config validation and re-parsing to be finished
        if(applications.has(path)) return;

        let app = applications.get(path);

        if(!app) {
            app = server._createApp(path)
            if(!app) return;
        } else server.log.verbose("Hot-reloading web application (at " + path + ")");

        const is_enabled = backend.cache.get(`web.${path}.enabled`, Boolean)
        app.enabled = is_enabled === null? true: is_enabled

        const domains = app.config.block("server").get("domains");
        for(let domain of domains){
            assignedDomains.set(domain, app.path);
        }

        for(let api of app.config.blocks("api")){
            backend.apiExtensions[api.attributes[0]] = app.path + "/" + api.attributes[1]
        }
    },


    _createApp(path){
        if(applications.has(path)) return;

        server.log.verbose("Loading web application (at " + path + ")");

        let configPath = files_try(path + "/app.conf", path + "/app.manifest");

        if(!configPath){
            server.log.debug("Web application (at " + path + ") was not loaded (no config file found)");
            return
        }

        const app = {
    
            path,
            basename: nodePath.basename(path),

            enabled: null,

            config: configTools(parse({
                content: fs.readFileSync(configPath, "utf8"),
                strict: true,
                asLookupTable: true
            })),

            serve({ req, res, url }){
                try {

                    for(const route of app.config.blocks("route")){
                        if(route.attributes.some(route => url.startsWith(route))){
                            if(route.properties.not && route.properties.not.some(path => url.startsWith(path))){
                                continue
                            }

                            url = `/${route.get("to", String)}`
                            break
                        }
                    }


                    let file = files_try(path + url + ".html", path + url + "/index.html", path + url);


                    server.log.verbose(`[${app.basename}] Serving request for ${req.domain}, path ${url}, file ${file || "<not found>"}`)

                    if(!file){
                        file = app.config.block("errors").get("code", String) || app.config.block("errors").get("default", String)

                        if(!file){
                            return backend.helper.send(req, res, url + " not found", null, 404);
                        } else file = path + file
                    }
                    
                    file = nodePath.normalize(file);

                    if(fs.statSync(file).isDirectory()){

                        backend.helper.send(req, res, "You have landed in " + url + " - which is a directory.");

                    } else {
                        // TODO: Once uWS implements low-level cache, add support for it

                        // Check if the file exists in cache and has not been changed since
                        const cache = cachedFile(file);
                        const file_name = nodePath.basename(file);

                        let extension, lastIndex = file_name.lastIndexOf('.');

                        if (lastIndex !== -1) {
                            extension = file_name.slice(lastIndex + 1);
                        } else extension = file_name;

                        let mimeType = backend.mime.getType(extension) || "text/plain";

                        const headers = {
                            "content-type": `${mimeType}; charset=UTF-8`,
                            "cache-control": `public, max-age=${cacheByFile[extension] || cacheByFile.default}`,
                            "x-content-type-options": "nosniff"
                        }
                        
                        if(cache instanceof Buffer || typeof cache === "string") {
                            // Great, content is cached and up to date, lets send the cache directly:
                            return backend.helper.send(req, res, cache, headers)
                        }

                        if(cache !== 1) server.log.warn("Cached data were wrong or empty (serving \""+file+"\"), did you update them correctly? Note: forcing cache reload!");

                        let content;

                        switch(extension){
                            case "html":
                                content = parse_html_content({ url, file, app, compress: true })
                            break;

                            case "css":
                                content = fs.readFileSync(file, "utf8");
                                content = content && (backend.compression.code(content, true) || content)
                            break;

                            case "js":
                                content = fs.readFileSync(file, "utf8");
                                content = content && (backend.compression.code(content) || content)
                            break;

                            default:
                                content = fs.readFileSync(file);
                        }

                        if(content) {
                            backend.helper.send(req, res, content, headers);

                            if(content.length < max_cache_size) updateCache(file, content)
                        } else res.end();
                    }


                } catch(error) {
                    server.log.error("Error when serving app \"" + path + "\", requesting \"" + req.path + "\": ")
                    console.error(error)

                    try {
                        backend.helper.send(req, res, "<b>Internal Server Error - Incident log was saved.</b>", null, 500)
                    } catch {}
                }
            }
        }

        applications.set(app.path, app)
    
        // Only for quick retrieval of website information
        applicationCache.push({
            basename: app.basename,
            path,
            get enabled(){
                return app.enabled
            }
        })

        return app
    },


    async HandleRequest({ segments, req, res }){
        // This is the main handler/router for websites/webapps.

        if(req.domain.startsWith("www.")) req.domain = req.domain.slice(4);

        const appPath = assignedDomains.get(req.domain) ?? assignedDomains.get(":default");

        if(appPath) {

            const app = applications.get(appPath)

            // HTTPS Redirect
            if(app.config.block("server").get("redirect_https", Boolean) && !backend.isDev && !req.secured){
                res.writeStatus('302 Found').writeHeader('Location', `https://${req.getHeader("host")}${req.path}`);
                return
            }

            // When the app is disabled
            if(!app.enabled){
                backend.helper.send(req, res, app.config.block("server").get("disabled_message", String, "This website is temporarily disabled."), null, 422)
                return
            }


            if(app.config.has("browserSupport")){
                let browserRequirements = app.config.block("browserSupport");

                if(!checkSupportedBrowser(req.getHeader('user-agent'), browserRequirements.properties)){
                    res.cork(() => {
                        res.writeHeader('Content-Type', browserRequirements.get("contentType", String, 'text/html')).writeStatus('403 Forbidden').end(browserRequirements.get("message", String, `<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${browserRequirements.chrome && browserRequirements.chrome[0]} and up, Firefox ${browserRequirements.firefox && browserRequirements.firefox[0]} and up.`))
                    })
                    return
                }
            }

            const url = `/${segments.join("/")}`;

            // Redirect handles
            for(const handle of app.config.blocks("handle")){
                if(handle.attributes.some(route => url.startsWith(route))){
                    const target = handle.get("target", String);

                    if(target) {
                        return backend.resolve(res, req, { secured: req.secured }, {
                            domain: handle.get("as", String, "api.extragon.cloud"),
                            path: `/${target}${handle.get("appendPath", Boolean)? `/${segments.join("/")}`: ""}`,
                            virtual: true
                        })
                    }
                }
            }

            app.serve({ req, res, url })

        } else {
            res.cork(() => {
                res.writeHeader('Content-Type', 'text/html').writeStatus('404 Not Found').end(`<h2>No website was found for this URL.</h2>Additionally, nothing was found to handle this error.<br><br><hr>Powered by Akeno/${backend.version}`)
            })
        }
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
                app.domains = [...assignedDomains.keys()].filter(domain => assignedDomains.get(domain) === app.path)
            }

            return applicationCache
        },

        enable(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;
            
            for(let application of applications.values()) {
                if(application.path === app_path) {
                    application.enabled = true
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
                    return true
                }
            }

            return false
        },

        listDomains(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            let list = [];

            for(domain in assignedDomains.keys()){
                if(assignedDomains.get(domain) === app_path) list.push(domain);
            }

            return list;
        },

        reload(app_path = null){
            if(app_path && !(app_path = server.util.getApp(app_path))) return false;
            server.Reload(null, app_path || null)
        },

        getDomain(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            for(domain in assignedDomains.keys()){
                if(assignedDomains.get(domain) === req.getQuery(app_path)) return domain;
            }

            return "";
        },

        tempDomain(app_path){
            if(!(app_path = server.util.getApp(app_path))) return false;

            let random = backend.uuid();
            assignedDomains.set(random, app_path);

            return random;
        }
    }
}


module.exports = server