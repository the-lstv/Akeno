




/*

    Welcome to the Akeno web backend!
    This is an extension to Akeno/ExtraGon API that acts as a webserver handler.
    It features automation, neat application structure.. if you know, you know.
    Read more at https://lstv.space/akeno for information about its APIs.

    Now more to the actual library.
    It is spliced into a few sections; global variables, the API handler and content parser.

    It automatically handles file changes and caching in a (hopefuly) simple way.
    


    Did you just get this API standalone and have no clue on how to set it up?

    Don't worry.
    Simply run the API (app.js file in the root directory), it will run at :7007 by default.
    To make a webserver, you can proxy the port 7007 to :80 and :433 using Nginx for example. (Or dont and test on the default port, it will work anyway)

    Then, you will need to set up hostnames for your IP (domains). If using a proxy, proxy all hosts in the proxy.
    If you dont know what this means - don't worry. If your domain is pointed to your server's IP, you are all set. For testing you can edit /etc/hosts (on Linux) and add custom hostnames, point it to localhost if you want to just test locally.
    Any subdomain starting with cdn. or api. will be forwarded to a different ExtraGon API extension, but any other domain will be forwarded here!

    Now all you need to do is to edit the locations variable below to include folders with your web apps.
    Create an app.manifest file in the root of your project folder and put "server {domains: example.com}" in that file (replacing example.com with your domain or hostname).
    Done! If setup correctly, Akeno should now handle example.com or example.com:7007!

    (Note: you will need to reload the API every time you make/change/remove a new app or change locations. If you only added a new app, you can send a check signal to do this more efficiently.)

*/

// Section: variables

let
    // Libraries
    fs = require("fs"),
    nodePath = require("path"),
    mime,
    CleanCSS = new (require('clean-css')),
    UglifyJS = require("uglify-js"),

    // Local libraries
    { parse, configTools } = require("./parser"),

    // Globals
    server,
    applications = [], applicationCache = [],

    // Backend
    Backend,

    // Cache && optimisation helpers
    assignedDomains = {},
    cache = {},

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

const { Writable } = require('stream');
const { Parser } = require('htmlparser2');

// Section: Initialize variables
// Warning: The following variables are set in the Initialize handle.

let version, locations;


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

    if(cache[file]
        && (
            ((Date.now() - cache[file].updateTimer) < 1000) ||
            (fs.statSync(file).mtimeMs <= cache[file].lastModifyTime)
        )
    ) {
        cache[file].updateTimer = Date.now()
        return cache[file].content
    }

    server.log.debug("File '" + file + "' has been updated; refreshing cache!");

    if(!cache[file]) cache[file] = {}

    cache[file].lastModifyTime = fs.statSync(file).mtimeMs,
    cache[file].updateTimer = Date.now()

    return 1
}

function updateCache(file, content){
    file = nodePath.normalize(file);

    if(!cache[file]) cachedFile(file);

    cache[file].content = content;
    // cache[file].headers = headers;
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

// Section: API
server = {
    Initialize(Backend_){
        Backend = Backend_;
        server.Reload(true)

        try {
            // Reserve API error codes from 1000 to 1200

            server.errorRange = Backend.claimErrorCodeRange(1000, 1200)

            // server.errorRange.errors({
            //     1000: "Hi (Reserved for future use)"
            // })
        } catch (e) {
            server.log.warn("Could not reserve errors (", e.toString(), ")")
        }

        mime = Backend.mime;
    },
    
    async Reload(firstTime){

        if(!firstTime){
            Backend.refreshConfig()
        }

        version = Backend.config.valueOf("version") || "unknown";
    
        let webConfig = Backend.config.block("web");
    
        locations = webConfig && webConfig.properties.locations? webConfig.properties.locations : []
    
        await server.LoadAppliactions();

    },

    async LoadAppliactions(){
        function load(path){
            if(applications.find(app => app.path == path)){
                server.log.debug("Loading of web application (at " + path + ") was skipped (already loaded)");
                return
            }

            let manifestPath = files_try(path + "/app.conf", path + "/app.manifest", path + "/v3.manifest", path + "/app.info", path + "/akeno.app.conf", path + "/manifest", path + "/index.manifest", path + "/manifest.app");

            if(!manifestPath){
                server.log.debug("Loading of web application (at " + path + ") was skipped (couldn't find a config file)");
                return
            }

            server.log.verbose("Loading web application (at " + path + ")");
                
            let files = fs.readdirSync(path), basename = nodePath.basename(path), manifest = {};

            function get_error_page(code){
                if(!manifest.errors) return false;

                let error = (manifest.errors.properties[code] || manifest.errors.properties["default"])

                if(error){
                    return path + error
                }

                return false
            }

            let app = {
                cache: {},
                routes: [],
                handles: [],
                stacks: [], // A feature to be potentially deprecated?
                path,
                basename,
                enabled: true,

                serve({segments, req, res, url}){
                    try {

                        let file;

                        if(!file) file = files_try(path + url + ".html", path + url + "/index.html", path + url, ...(manifest.server.properties.fallbackFiles? manifest.server.properties.fallbackFiles: []).map(file => path + url + file), path + "/" + (manifest.server && manifest.server.properties.fallback? manifest.server.properties.fallback[0]: url));

                        if(file) file = nodePath.normalize(file);

                        for(const route of app.routes){
                            if(route.values.find(route => url.startsWith(route))){
                                if(route.properties.files) {
                                    let fExt = nodePath.extname(file || "").replace(".", ""), match = false;

                                    if(fExt === "" && route.properties["notStrict"]){
                                        match = true;
                                    } else {
                                        for(const ext of route.properties.files){
                                            if(fExt == ext) {
                                                match = true
                                                break
                                            }
                                        }
                                    }

                                    if(!match) continue
                                }

                                if(route.properties.not && route.properties.not.find(path => url.startsWith(path))){
                                    continue
                                }

                                file = path + "/" + route.properties.to[0]
                                server.log.debug(`[${basename}] [router] Server is routing`, url, "to", route.properties.to[0])
                                break
                            }
                        }
    
                        server.log.verbose(`[${basename}] [${Date.now()}] Serving request for ${req.domain}, path ${url}, file ${file || "<not found>"}, client ${req.ip}`)

                        if(!file){
                            file = get_error_page(404);

                            if(!file){
                                return res.send(url + " not found", null, 404);
                            }
                        }

                        let headers = {};

                        // TODO: Extend this functionality
                        if(fs.statSync(file).isDirectory()){

                            res.send("You have landed in " + url + " - which is a directory - and there is no support for browsing this yet.", headers);

                        } else {

                            // Check if the file exists in cache and has not been changed since
                            let cache = Backend.isDev ? 1 : cachedFile(file);

                            const baseName = nodePath.basename(file);
                            let extension = baseName, lastIndex = baseName.lastIndexOf('.');

                            if (lastIndex !== -1) {
                                extension = baseName.slice(lastIndex + 1);
                            }

                            // Why the extra mime checks? Because the libarary is total unpredictable crap that sometimes exists and sometimes doesnt. Why? No clue.
                            // Yes, it could be that I am using an older version, but that is because the @4 and up switched to MJS, which I really do not understand the reason for, and thus I can not use it, since I refuse MJS.
                            let mimeType = (mime && mime.getType && mime.getType(extension)) || "text/plain";

                            headers['content-type'] = `${mimeType}; charset=UTF-8`;
                            headers['cache-control'] = `public, max-age=${cacheByFile[extension] || cacheByFile.default}`;
                            headers['x-content-type-options'] = "nosniff";
                            
                            if(cache instanceof Buffer) {
                                // Great, content is cached and up to date, lets send the cache:

                                res.send(cache, headers)
                                return
                            }

                            if(cache !== 1) server.log.warn("Cached data were wrong or empty (serving \""+file+"\"), did you update them correctly? Note: forcing cache reload!");
                            
                            let content;
                            if(["html", "js", "css"].includes(extension)){

                                // FIXME: Temporary

                                switch(extension){
                                    case "html":
                                        content = get_content(app, url, file)
                                    break;

                                    case "css":
                                        content = fs.readFileSync(file, "utf8");
                                        content = Buffer.from(CleanCSS.minify(content).styles || content)
                                    break;

                                    case "js":
                                        content = fs.readFileSync(file, "utf8");

                                        // I dont know, should this be deprecated?
                                        content = content.replace(`Akeno.randomSet`, `["${Array.from({length: 4}, () => require('crypto').randomBytes(16).toString('base64').replaceAll("=", "")).join('","')}"]`)

                                        content = Buffer.from(UglifyJS.minify(content).code || content) // Try to compres the file and fallback to the original content
                                    break;
                                }

                                res.send(content, headers)
                                updateCache(file, content)
                                return

                            } else {

                                // res.stream(fs.createReadStream(file));
                                content = fs.readFileSync(file);

                                res.send(content, headers)
                                if(content.length < max_cache_size) updateCache(file, content)
                                return

                            }
                        }

                    } catch(error) {
                        server.log.error("Error when serving app \"" + path + "\", requesting \"" + req.path + "\": ")
                        console.error(error)

                        try {
                            res.send("<b>Internal Server Error - Incident log was saved.</b> <br> Don't know what this means? Something went wrong on our side - the staff was notified of this issue and will look into what caused this. Try again later, or contact the website admin.", null, 500)
                        } catch {}
                    }
                }
            }

            if(manifestPath) {
                for(let block of parse(fs.readFileSync(manifestPath, "utf8"), true, app.path)){
                    if(!typeof block == "object") continue;

                    // This is mainly for optimisation so that the app does not have to look for route blocks each time.
                    if(block.key == "route"){
                        app.routes.push({properties: block.properties, values: block.values});
                        continue
                    }

                    if(block.key == "handle"){
                        app.handles.push({properties: block.properties, values: block.values});
                        continue
                    }

                    if(block.key == "stack"){
                        app.stacks.push({properties: block.properties, values: block.values});
                        continue
                    }

                    manifest[block.key] = {properties: block.properties, values: block.values}
                }

                if(!manifest.server) manifest.server = {properties: {}};
                app.manifest = manifest
            }

            applications.push(app)

            applicationCache.push({
                basename,
                path,
                get enabled(){
                    return app.enabled
                }
            })
        }

        for(let location of locations){
            if(location.startsWith("./")) location = backend.path + location.replace("./", "/");

            if(!fs.existsSync(location.replace("/*", ""))) {
                server.log.warn("Web application directory (" + location + ") does not exist");
                continue
            }

            if(location.endsWith("*")){
                let path = (location.replace("*", "") + "/").replaceAll("//", "/");
                locations.push(...fs.readdirSync(path).map(location => path + location).filter(path => fs.statSync(path).isDirectory()))
                continue
            }

            if(fs.statSync(location).isDirectory()){
                load(location)
            } else {
                server.log.warn("Web application (at " + location + ") is a file, which is not supported yet.");
            }
        }

        for(let app of applications){
            if(!app.manifest || !app.manifest.server) continue;

            if(app.manifest.server.properties.domains) {
                for(let domain of app.manifest.server.properties.domains){
                    assignedDomains[domain] = app.path;
                }
            }

            if(app.manifest.server.properties.api) {
                for(let api of app.manifest.server.properties.api){
                    api = api.split(">");
                    Backend.apiExtensions[api[0]] = app.path + "/" + api[1]
                }
            }
        }
    },

    async HandleRequest({segments, req, res}){
        // This is the main handler for websites/webapps.

        if(req.domain.startsWith("www.")) req.domain = req.domain.replace("www.", "");

        let appPath = assignedDomains[req.domain] ?? assignedDomains[":default"], app;

        if(typeof appPath !== "undefined") {
            app = applications.find(app => app.path == appPath)

            if(app.manifest.server.properties.redirect_https && !Backend.isDev && !req.secured){
                res.redirect(301, `https://${req.getHeader("host")}${req.path}`);
                return
            }

            if(!app.enabled){
                res.send("This website is temporarily disabled.", null, 422)
                return
            }

            if(app.manifest.server.properties.handle){
                console.error("server().handle has been deprecated, please use handle() instead")
                return res.close()
            }

            let url = ("/" + segments.join("/"));

            if(app.manifest.browserSupport){
                let browserRequirements = app.manifest.browserSupport.properties;

                if(!checkSupportedBrowser(req.getHeader('user-agent'), browserRequirements)){
                    res.cork(() => {
                        res.writeHeader('Content-Type', (browserRequirements.contentType && browserRequirements.contentType[0]) || 'text/html').writeStatus('403 Forbidden').end((browserRequirements.message && browserRequirements.message[0]) || `<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${browserRequirements.chrome && browserRequirements.chrome[0]} and up, Firefox ${browserRequirements.firefox && browserRequirements.firefox[0]} and up.`)
                    })
                    return
                }
            }

            // Redirect handles
            if(app.handles && app.handles.length > 0){
                for(const handle of app.handles){
                    if(handle.values.find(route => url.startsWith(route))){
                        if(handle.properties.target) {
                            return Backend.resolve(res, req, req.secured, {
                                domain: "api.extragon.cloud",
                                path: "/" + handle.properties.target.join("/") + (handle.properties.appendPath? "/" + segments.join("/"): ""),
                                virtual: true
                            })
                        }
                    }
                }
            }

            app.serve({ segments, req, res, url })
        } else {
            res.cork(() => {
                res.writeHeader('Content-Type', 'text/html').writeStatus('404 Not Found').end(`<h2>No website was found for this URL.</h2>Additionally, nothing was found to handle this error.<br><br><hr>Powered by Akeno/${version}`)
            })
        }
    },


    get_content,


    // Debugging purposes and temporarily pretty messy, will be reworked later
    async HandleInternal({segments, req, res}){
        let application;

        switch (segments[1]) {
            case "list":

                for(let app of applicationCache){
                    app.domains = Object.keys(assignedDomains).filter(domain => assignedDomains[domain] === app.path)
                }

                res.send(applicationCache)
                break

            case "resolve":

                if(!req.getQuery("app") || !req.getQuery("path")) return res.writeStatus("500").end();
                
                application = applications.find(app => app.path == req.getQuery("app"));
                if(!application) return res.writeStatus("500").end();

                application.serve({ domain: "internal", method: "GET", segments: req.getQuery("path").replace(/\?.*$/, '').split("/").filter(g => g), req, res })
                break

            case "enable": case "disable":

                if(!req.getQuery("app")) return res.writeStatus("500").end();
                
                for(let application of applications) {
                    if(application.path === req.getQuery("app")) {
                        application.enabled = segments[1] === "enable"
                        res.end()
                        return
                    }
                }

                res.writeStatus("500").end();
                break

            case "domain":
                for(asd in assignedDomains){
                    if(assignedDomains[asd] == req.getQuery("app")) return res.send(asd);
                }
                return res.send("");

            case "domains":
                let list = [];

                for(domain in assignedDomains){
                    if(assignedDomains[domain] == req.getQuery("app")) list.push(domain);
                }

                return res.send(list);

            case "temporaryDomain":

                let random = Backend.uuid();
                assignedDomains[random] = req.getQuery("app");

                return res.send(random);

            case "reload":
                server.log("Server is reloading!")
                await server.Reload()
                return res.end();

            default:
                res.end()
        }
    },
}


// Section: functions

let lsVersion = fs.readFileSync("/www/content/akeno/cdn/ls/source/version.info", "utf8").trim();


function get_content(htmlContent){
    // console.log("should parse", app, url, file);
    
    const output = [];

    let now = performance.now();

    function push(data){
        if(typeof data === "string" && typeof output.at(-1) === "string") {
            output[output.length - 1] += data
            return
        }

        output.push(data)
    }

    const parser = new Parser({
        onopentag(name, attribs) {
            let result = "<";

            if(attribs.class) attribs.class; else attribs.class = "";

            if (name.includes('#')) [name, attribs.id] = name.split('#');

            if (name.includes('.')) {
                const parts = name.split('.');
                name = parts[0];
                attribs.class += " " + parts.slice(1).join(' ');
            }

            result += name;

            for(let attr in attribs) {
                if (attr === "class" || attr === "id") continue;

                if (attr.startsWith('.')) {
                    attribs.class += " " + attr.slice(1).split(".").join(" ")
                    continue
                }

                if (attr.startsWith('#')) {
                    attribs.id = attr.slice(1)
                    continue
                }

                let value = attribs[attr];

                if(value){
                    if (value.includes(`"`) && value.includes(`'`)) {
                        value = `"${value.replace(/"/g, '&quot;')}"`;
                    } else if (value.includes(" ")) {
                        value = `"${value}"`;
                    }

                    result += ` ${attr}=${value}`;
                    continue
                }

                result += " " + attr;
            }

            if (attribs.class) result += ` class="${attribs.class.trim()}"`;
            if (attribs.id) result += ` id="${attribs.id}"`;

            push(result + ">");
        },

        ontext(text) {
            // A fast custom syntax parser optimized for HTML. (faster than the event the currently implemented one on the backend and much faster than the old one. TODO: upgrade the config parser too)

            let blockPosition = text.indexOf("@");

            // Nothing to do, so just skip parsing
            if(blockPosition === -1) return push(text);

            function parseAt(initialBlockStart){
                let currentPosition = initialBlockStart + 1;

                function exit(cancel){
                    blockPosition = text.indexOf("@", currentPosition);
                    
                    if(cancel) currentPosition = initialBlockStart;

                    push(text.slice(currentPosition, blockPosition !== -1? blockPosition: text.length));

                    if(blockPosition !== -1) parseAt(blockPosition); else {
                        return
                    }
                }

                // Stage of parsing + types (0 = default, 1 = keyword, 2 = string)
                let stage = 0, type = 1, confirmed = false, block = {
                    name: "",
                    attributes: [],
                    properties: []
                }

                let parsingValueStart = currentPosition, parsingValueLength = 0;
    
                while(currentPosition < text.length){
    
                    const char = text[currentPosition];

                    console.log("parsing state", stage, type, char);

                    // Also skip whitespace when possible.
                    if(type !== 0 || !/[\s\n\r\t]/.test(char)) switch(stage){

                        case 0:
                            if(!/[\s\n\r\t\w({]/.test(char)) return exit(true);

                            parsingValueLength ++;

                            if(!/\w/.test(char)){
                                type = 0;
                                stage = 0.5;
                                currentPosition --
                            }
                            break;

                        case 0.5:
                            if(!/[({]/.test(char)) return exit(true);

                            stage = char === "("? 1: 4;
                            block.name = text.slice(parsingValueStart, parsingValueStart + parsingValueLength)

                            break;

                        case 1:
                            if(char === ")"){
                                stage = 3
                                break;
                            }

                            if(!/[\w,]/.test(char)) return exit(true);

                            parsingValueStart = currentPosition;
                            parsingValueLength = char === ","? 0: 1;
                            stage = 2
                            type = 0

                            break

                        case 2:
                            if(!/\w/.test(char)){

                                if(!/[,)]/.test(char)) return exit(true);

                                type = 0
                                block.attributes.push(text.slice(parsingValueStart, parsingValueStart + parsingValueLength).trim())
                                stage = char === ","? 1 : 3;

                            } else parsingValueLength ++;
        
                            break

                        case 3:
                            if(!/[;{]/.test(char)) return exit(true);

                            if(char === ";"){
                                push(block)
                                return exit()
                            }

                            stage = 4
                            
                            break

                        case 4:
                            if(!/[\w}]/.test(char)) return exit(true);
                            
                            // wip
                            push(block)
                            return exit()
                            
                            break
                    }

                    currentPosition++
                }

                if(!confirmed) return exit(true);

                push(block)
                exit()
            }

            parseAt(blockPosition)
        },

        onclosetag(name) {
            push(`</${name}>`);
        }
    });

    parser.write(htmlContent);
    parser.end();

    console.log(performance.now() - now);

    return output;
}

module.exports = server


// Friendly reminder: Do **NOT** USE DOCUMENT.WRITE() !!!!!!!!!!!!!!!!!!!!!!!!! <=== E V E R