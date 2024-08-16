




/*

    Welcome to the Akeno (formerly ExtraGon) web backend!
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


function checkSupportedBrowser(userAgent, minChrome, minFirefox) {
    const ua = userAgent.toLowerCase();

    if (ua.includes('chrome')) {
        const match = ua.match(/chrome\/(\d+)/);

        if (match && parseInt(match[1], 10) < minChrome) return false;

    } else if (ua.includes('firefox')) {
        const match = ua.match(/firefox\/(\d+)/);

        if (match && parseInt(match[1], 10) < minFirefox) return false;

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

            server.errorRange = backend.claimErrorCodeRange(1000, 1200)

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
                stacks: [], // A feature to be potentially deprecated?s
                path,
                basename,
                enabled: true,

                serve({segments, req, res}){
                    try {

                        let url = ("/" + segments.join("/")), file;

                        if(!file) file = files_try(path + url + ".html", path + url + "/index.html", path + url, path + "/" + (manifest.server && manifest.server.properties.fallback? manifest.server.properties.fallback[0]: url));

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

                // Redirects the request to an API endpoint instead
                // TODO: Extend this so that it is a standalone block that can specify which URLs get forwarded to which endpoint.

                let handle = app.manifest.server.properties.handle;

                req.wait = true;
                Backend.resolve(req.method, req, res, "", {
                    domain: "api.extragon.cloud",
                    path: handle + "/" + segments.join("/"),
                    virtual: true
                })
                return
            }

            if(app.manifest.browserSupport){
                if(!checkSupportedBrowser(req.getHeader('user-agent'), +app.manifest.browserSupport.properties.chrome[0], +app.manifest.browserSupport.properties.firefox[0])){
                    res.cork(() => {
                        res.writeHeader('Content-Type', 'text/html').writeStatus('403 Forbidden').end(`<h2>Your browser version is not supported.<br>Please update your web browser.</h2><br>Minimum requirement for this website: Chrome ${app.manifest.browserSupport.properties.chrome[0]} and up, Firefox ${app.manifest.browserSupport.properties.firefox[0]} and up.`)
                    })
                    return
                }
            }

            app.serve({ segments, req, res })
        } else {
            res.cork(() => {
                res.writeHeader('Content-Type', 'text/html').writeStatus('404 Not Found').end(`<h2>No website was found for this URL.</h2>Additionally, nothing was found to handle this error.<br><br><hr>Powered by Akeno/${version}`)
            })
        }
    }
}


// Section: functions

let lsVersion = fs.readFileSync("/www/content/akeno/cdn/ls/source/version.info", "utf8").trim();

function get_content(app, url, file){
    server.log.debug("Server is parsing dynamic file '" + file + "'!");

    let stack = [],

        variables = {
            url, file
        },

        prevTitle = "",

        parts = [],

        hasLS = false,

        doNotInit = false
    ;

    if(app.stacks && app.stacks.length > 0){
        for(const stackBlock of app.stacks){
            if(stackBlock.values.find(path => url.startsWith(path))){
                if(stackBlock.properties.not && stackBlock.properties.not.find(path => url.startsWith(path))){
                    continue
                }

                stack.push(...stackBlock.properties.chain[0].split(">").map(value => {
                    return value == "."? file : app.path + "/" + value
                }))

                break
            }
        }
    }
    
    if(stack.length < 1) {
        stack.push(file)
    }

    let waterfall = {
        head: "",
        body: "",

        merged: [],
        resources: [],
        bodyAttributes: {},
        exposed: [],

        htmlLang: "en",

        deferResources: []
    }

    // NOTE: The following code merges the documents from the stack in order, to a single document
    function merge(array, target) {
        let content = [];

        
        for(let token of array){
            if(token.type == "element"){

                if(["body", "page"].includes(token.tag)){

                    if(token.tag == "page") token.tag = "body";

                    if(token.tag == "body") {
                        Object.assign(waterfall.bodyAttributes, token.attributes)
                    }
                }

                if(token.content && token.content.length > 0) {
                    let mergedContent = merge(token.content, target);
                    token.content = mergedContent
                }

                content.push(token);

            } else {
                if(typeof token == "string"){
                    content.push(token);
                    continue
                }

                switch (token.type) {
                    case "block":
                        switch (token.key) {
                            case "no-init":
                                doNotInit = true;
                            break

                            case "variables":
                                for(const variable in token.properties){
                                    if(!token.properties.hasOwnProperty(variable)) continue;
                                    variables[variable] = token.properties[variable].join("")
                                }
                            break

                            case "print":
                                content.push(stringVar(token.values.join(" ")))
                            break

                            case "preload":
                                for(let value of token.values){
                                    value = value.join("");

                                    let file = resourceMapper("preload", value)
                                    content.push(`<script src="${file}"></script>`)
                                    waterfall.head += `<link rel=preload href="${file}" as=script>`
                                }
                            break

                            case "resources":
                                for(const key in token.properties){
                                    if(!token.properties.hasOwnProperty(key)) continue;

                                    if(!Array.isArray(token.properties[key])) token.properties[key] = [token.properties[key]];

                                    let properties = [];
                                    for(let property of token.properties[key]){
                                        if(property == "+"){
                                            properties.push(...waterfall.resources[key])
                                        } else {
                                            properties.push(property)
                                        }
                                    }

                                    waterfall.resources[key] = properties
                                }
                            break

                            case "manifest": case "mainfest": // Youd be surprised how many times i made that typo
                                if(token.properties.title){
                                    prevTitle = token.properties.title.map(item => item == "+"? prevTitle : item).join("");
                                }

                                if(token.properties.favicon){
                                    const baseName = nodePath.basename(token.properties.favicon[0]);
                                    let extension = baseName, lastIndex = baseName.lastIndexOf('.');
        
                                    if (lastIndex !== -1) {
                                        extension = baseName.slice(lastIndex + 1);
                                    }
        
                                    let mimeType = (mime && mime.getType && mime.getType(extension)) || "image/x-icon";
                                    waterfall.head += `<link rel="shortcut icon" href="${token.properties.favicon[0]}" type="${mimeType}">`
                                }


                                if(token.properties.lang){
                                    waterfall.htmlLang = token.properties.lang[0]
                                }

                                if(token.properties.accent){
                                    waterfall.bodyAttributes["ls-accent"] = token.properties.accent[0]
                                    waterfall.bodyAttributes["ls"] = ""
                                }

                                if(token.properties.theme){
                                    waterfall.bodyAttributes["ls-theme"] = token.properties.theme[0]
                                    waterfall.bodyAttributes["ls"] = ""
                                }

                                if(token.properties.style){
                                    waterfall.bodyAttributes["ls-style"] = token.properties.style[0]
                                    waterfall.bodyAttributes["ls"] = ""
                                }
                            break

                            case "part":
                                if(Array.isArray(token.values[0])) token.values[0] = token.values[0][0];
                                parts[token.values[0]] = token.content
                            break

                            case "get":
                                for(let part of token.values){
                                    if(Array.isArray(part)) part = part[0];

                                    const data = parts[part];

                                    if(!data){
                                        server.log.warn(data, "Trying to get a part that does not exist/has not been defined yet. (Getting '" + part + "')");
                                        continue
                                    }

                                    content.push(...data)
                                }
                            break
                        }
                    break;
                }
            }
        }

        return content
    }

    for(const file of stack){
        let parsed = parse(fs.readFileSync(file, "utf8"), false, app.path);
        waterfall.merged.push(...merge(parsed, "body"))
    }

    function resourceMapper(type, value){
        if(!value.startsWith("http")){
            const assetPath = app.path + "/" + value;

            if(!fs.existsSync(assetPath)){
                server.log.warn(`Application ${app.basename} has an invalid (not found) resource ("${assetPath}")`);
                return ""
            }

            value += `${value.includes("?")? "&": "?"}mtime=${(fs.statSync(assetPath).mtimeMs).toString(36)}`
        }

        if(type == "css" && waterfall.resources["defer-css"]){
            waterfall.deferResources.push("css:" + value)
            return ""
        }

        if(type == "js" && waterfall.resources["defer-js"]){
            waterfall.deferResources.push("js:" + value)
            return ""
        }
        
        return type == "css"? `<link rel=stylesheet href="${value}">`: type == "preload"? value: `<script src="${value}"></script>`
    }

    function attributesString(attributeObject){

        let result = [], attributes = {};

        for(let attribute in attributeObject){
            let value = attributeObject[attribute] || "";

            if(attribute == "style") value = value.replaceAll("   ", " ").replaceAll("  ", " ").replaceAll(", ", ",").replaceAll(": ", ":").replaceAll("; ", ";");

            if(attribute.startsWith("%") && value == "") {
                attributes.id = attribute.replace("%", "");
                continue
            }

            if(attribute.startsWith(".") && value == "") {
                attribute = attribute.replace(".", "");

                if(attributeObject.hasOwnProperty("class")){
                    if(!attributes.hasOwnProperty("class")){
                        attributes.class = ""
                    }
                    
                    attributeObject.class += " " + attribute
                    continue
                }

                if(attributes.hasOwnProperty("class")){
                    attributes.class += " " + attribute
                    continue
                }

                attributes.class = attribute;

                continue
            }

            if(attributes.hasOwnProperty(attribute)){
                attributes[attribute] += " " + value
                continue
            }

            attributes[attribute] = value;
        }

        for(let attribute in attributes){
            let quote = "", value = attributes[attribute] || "";
            
            // TODO: Add a case for escaped quotes

            if(value.includes(' ')) quote = '"';

            if(value.includes('"')) {
                quote = "'";
                if(value.includes("'")){
                    value = value.replace("'", "\\'")
                }
            } else {
                if(value.includes("'")) quote = '"';
            }

            result.push(`${attribute}` + (value? `=${quote}${value.trim()}${quote}` : ""))
        }

        return " " + result.join(" ");
    }

    function stringVar(str){
        if(typeof str !== "string") return "";

        return str.replace(/\$[\w\-\_]+/g, (match) => {
            return stringVar(variables[match.replace("$", "").trim()])
        })
    }

    // NOTE: This finally constructs the final form HTML from the merged parsed documents.
    function build(array, target) {
        let content = "";
        for(let token of array){
            if(typeof token === "undefined") continue;

            if(typeof token == "string" || token.type == "element"){

                if(typeof token == "string"){
                    content += token;
                    continue
                }

                if(token.tag == "head"){
                    build(token.content, "head")
                    continue
                }

                let elementTag = "";
                if(token.tag !== "body") {
                    elementTag = `<${token.tag}${attributesString(token.attributes)}>`
                } else {
                    Object.assign(waterfall.bodyAttributes, token.attributes)
                }

                if(!token.singleton){
                    let rawContent = token.content && token.content.length > 0 ? build(token.content, target) : "";
                    
                    if(token.tag == "style"){
                        rawContent = CleanCSS.minify(rawContent).styles || rawContent
                    }

                    if(token.tag == "script"){
                        rawContent = UglifyJS.minify(rawContent).code || rawContent
                    }

                    elementTag += token.tag == "body"? rawContent : `${rawContent}</${token.tag}>`
                }

                if(target == "body") {content += elementTag} else waterfall.head += elementTag;

            }
        }

        return content
    }

    waterfall.body = build(waterfall.merged, "body")

    if(prevTitle) waterfall.head += `<title>${prevTitle}</title>`;


    // Please excuse this IF ladder.
    // But it is for a good reason - it's faster (10%) than a fancy for-in solution, and we need to check for the keys somehow.. It's definetly not clean, but it works.

    if(waterfall.resources["ls-js"]){
        hasLS = true

        let url = `http${Backend.isDev? "" : "s"}://cdn.extragon.${Backend.isDev? "test" : "cloud"}/ls/${Backend.isDev? "js" : "js.min"}/${waterfall.resources["ls-version"]? waterfall.resources["ls-version"][0]: lsVersion}/${waterfall.resources["ls-js"].join(",")}`;

        if(waterfall.resources["defer-js"]){
            waterfall.deferResources.push("js:" + url)
        } else {
            waterfall.head += `<script src="${url}"></script>`;
        }
        // for(const component of waterfall.resources["ls-js"]){
        //     if(component === "tiny")
        //     waterfall.head += `<script src="http${Backend.isDev? "" : "s"}://cdn.extragon.${Backend.isDev? "test" : "cloud"}/ls/js/${waterfall.resources["ls-version"]? waterfall.resources["ls-version"][0]: "3.0"}/${component}"></script>`
        // }
    }

    if(waterfall.resources["ls-css"]){
        let url = `http${Backend.isDev? "" : "s"}://cdn.extragon.${Backend.isDev? "test" : "cloud"}/ls/css/${waterfall.resources["ls-version"]? waterfall.resources["ls-version"][0]: lsVersion}/${waterfall.resources["ls-css"].join(",")}`;
        
        if(waterfall.resources["defer-css"]){
            waterfall.deferResources.push("css:" + url)
        } else {
            waterfall.head += `<link rel=stylesheet href="${url}">`
        }
    }

    if(waterfall.resources["bootstrap-icons"]){
        let url = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css";
        
        if(waterfall.resources["defer-css"]){
            waterfall.deferResources.push("css:" + url)
        } else {
            waterfall.head += `<link rel=stylesheet href="${url}">`
        }
    }

    if(waterfall.resources.fonts){
        waterfall.head += `<link rel=preconnect href="https://fonts.googleapis.com"><link rel=preconnect href="https://fonts.gstatic.com" crossorigin>`
        let url = `https://fonts.googleapis.com/css2?${waterfall.resources.fonts.map(font => {
            return "family=" + font.replaceAll(" ", "+") + ":wght@100;200;300;400;500;600;700;800;900"
        }).join("&")}&display=swap`;

        if(waterfall.resources["defer-css"]){
            waterfall.deferResources.push("css:" + url)
        } else {
            waterfall.head += `<link rel=stylesheet href="${url}">`
        }
    }

    if(waterfall.resources.css || waterfall.resources.js){
        if(waterfall.resources.css) waterfall.head += waterfall.resources.css.map(css => resourceMapper("css", css)).join("");
        if(waterfall.resources.js) waterfall.head += waterfall.resources.js.map(js => resourceMapper("js", js)).join("")
    }

    if(waterfall.deferResources.length > 0){
        // This is OBVIOUSLY not a great practice, especially given that we have an actual HTML parser. But it does currently work the best.
        waterfall.head = waterfall.head.replace(`Akeno.get("resources")`, `["${waterfall.deferResources.join('","').replaceAll("\n", "")}"]`)
    }

    if(doNotInit){
        return `${waterfall.body}`
    }

    return Buffer.from(`<!DOCTYPE html>\n<!-- WARNING:\n\tThis is automatically generated and compressed code. It may not represent the source.\n-->\n<html lang=${waterfall.htmlLang}><head><meta charset=UTF-8><meta name=viewport content="width=device-width, initial-scale=1.0">${waterfall.head}</head><body${attributesString(waterfall.bodyAttributes)}>${waterfall.body}${waterfall.exposed.length > 0? `<script>let ${waterfall.exposed.map(element => element + "=" + ((hasLS && !waterfall.resources["defer-js"])? "O('#" : "document.querySelector('#") + element + "')").join(",")}</script>`: ""}</body></html>`)
}

module.exports = server


// Friendly reminder: Do **NOT** USE DOCUMENT.WRITE() !!!!!!!!!!!!!!!!!!!!!!!!! <=== E V E R