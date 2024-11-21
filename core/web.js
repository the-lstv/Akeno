

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
    mime,
    CleanCSS = new (require('clean-css')),
    UglifyJS = require("uglify-js"),
    { Parser } = require('htmlparser2'),

    // Local libraries
    { parse, configTools } = require("./parser"),

    // Globals
    server,

    applications = new Map,
    applicationCache = [], // debug purposes

    // Backend object
    Backend,

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




let latest_ls_version = fs.readFileSync("/www/content/akeno/cdn/ls/source/version.info", "utf8").trim(),
    ls_url = null // Is set in initialization
;

const html_header = Buffer.from(`<!DOCTYPE html>\n<!-- This is automatically generated code -->\n<html lang="en">`);

const parser_regex = {
    keyword: /[\w-]/,
    plain_value: /[\w-</>.*:]/,
    stringChar: /["'`]/,
    whitespace: /[\s\n\r\t]/,
    singleton: ["area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"],
    plaintext_blocks: ["part"]
}

function map_resource(link, local_path){
    if(local_path && !link.startsWith("http")){
        const assetPath = local_path + "/" + link;

        if(!fs.existsSync(assetPath)){
            server.log.warn(`Application ${app.basename} has an invalid (not found) resource ("${assetPath}")`);
            return null
        }

        link += `${link.includes("?")? "&": "?"}mtime=${(fs.statSync(assetPath).mtimeMs).toString(36)}`
    }

    return link
}

function parse_html_content(options){
    const htmlContent = options.content? options.content: options.file? fs.readFileSync(options.file, "utf8"): "";

    const output = [ null ]; // null for the header

    let head_string_index = null, head = "";

    let now = performance.now();

    let currentTag = null;

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

                    let mimeType = (mime && mime.getType && mime.getType(extension)) || "image/x-icon";

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
            
                    let url = `${ls_url}${Backend.isDev? "js" : "js.min"}/${block.properties["ls-version"]? block.properties["ls-version"][0]: latest_ls_version}/${block.properties["ls-js"].join(",")}`;
                    
                    head += `<script src="${url}"></script>`;
                }
            
                if(block.properties["ls-css"]){
                    misc.default_attributes.body.ls = "";

                    let url = `${ls_url}css/${block.properties["ls-version"]? block.properties["ls-version"][0]: latest_ls_version}/${block.properties["ls-css"].join(",")}`;
                    
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

            if(name === "page") name = "body"; // Backwards-compatibility with old, outdated parser

            currentTag = name;

            if(attribs.class) attribs.class; else attribs.class = "";

            if (name.includes('%')) [name, attribs.id] = name.split('%'); else if (name.includes('#')) [name, attribs.id] = name.split('#');

            if (name.includes('.')) {
                const parts = name.split('.');
                name = parts[0];
                attribs.class += " " + parts.slice(1).join(' ');
            }

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
                    if(text) push(options.compress? UglifyJS.minify(text).code || text: text)
                    return;

                case "style":
                    if(text) push(options.compress? CleanCSS.minify(text).styles || text: text)
                    return;
            }


            // gee this parser sucks ass
            // still sucks much less than the one in parser.js


            let blockPosition = text.indexOf("@");

            // Nothing to do, so just skip parsing entirely
            if(blockPosition === -1) return push(text);

            // Parse block
            function parseAt(initialBlockStart){
                let currentPosition = initialBlockStart;

                // Stage of parsing + types (0 = default, 1 = keyword, 2 = string, 3 = plain value, 4 = plaintext until block end)
                let stage = 0, next_stage = 0, parsedString = null, type = 1, confirmed = false, stringChar = null, block = {
                    name: "",
                    attributes: [],
                    properties: {}
                }

                let parsingValueStart = currentPosition, parsingValueLength = 0, parsingValueSequenceBroken = false;

                // Exit block
                function exit(cancel){
                    blockPosition = text.indexOf("@", currentPosition);
                    
                    if(cancel) currentPosition = initialBlockStart; else {
                        currentPosition ++; process_block(block)
                    }

                    push(text.slice(currentPosition, blockPosition !== -1? blockPosition: text.length));

                    if(blockPosition !== -1) parseAt(blockPosition); else return;
                }

                function value_start(length = 0, positionOffset = 0, _type = null){
                    if(_type !== null) type = _type;
                    parsingValueStart = currentPosition + positionOffset;
                    parsingValueLength = length;
                    parsingValueSequenceBroken = false;
                    parsedString = null;
                }

                function get_value(){
                    return text.slice(parsingValueStart, parsingValueStart + parsingValueLength)
                }

                let last_key;
    
                while(currentPosition < text.length){
                    currentPosition ++;
    
                    const char = text[currentPosition];

                    // console.log("parsing at", currentPosition, "stage:", stage, "type:", type, char);

                    if(type === 2) {
                        // currentPosition += (text.indexOf(stringChar, currentPosition) - currentPosition) -1;

                        if(char === stringChar && text[currentPosition -1] !== "\\"){
                            type = 0

                            // if(stage !== next_stage) currentPosition--;

                            stage = next_stage

                            parsedString = get_value()
                        } else parsingValueLength ++
                    } else

                    if(type === 4) {
                        currentPosition += (text.indexOf("}", currentPosition) - currentPosition) -1;

                        if(char === "}"){
                            type = 0

                            stage = next_stage

                            parsedString = get_value()
                        } else parsingValueLength ++
                    } else

                    if(type === 3) {
                        if(!parser_regex.plain_value.test(char)){
                            type = 0
                            stage = next_stage
                            currentPosition--

                            parsedString = get_value()
                        } else parsingValueLength ++
                    } else

                    // Also skip whitespace when possible.
                    if(type !== 0 || !parser_regex.whitespace.test(char)) switch(stage){

                        // Beginning of a block name
                        case 0:
                            if(!/[\s\n\r\t\w({-]/.test(char)) return exit(true);

                            parsingValueLength ++;

                            if(!parser_regex.keyword.test(char)){
                                type = 0;
                                stage = 1;
                                currentPosition --
                            }
                            break;


                        // End of a block name
                        case 1:
                            block.name = get_value().replace("@", "")

                            if(char === "("){
                                stage = 2;
                            } else if (char === "{") {
                                stage = 4;

                                if(parser_regex.plaintext_blocks.indexOf(block.name) !== -1){
                                    value_start(0, 1, 4)
                                }
                            } else return exit(true);

                            break;


                        // Attribute
                        case 2:
                            if(char === ")" || char === ","){
                                type = 0
                                if(parsedString) block.attributes.push(parsedString.trim())
                                if(char === ")") stage = 3;
                                break;
                            }

                            if(parser_regex.stringChar.test(char)){
                                stringChar = char

                                value_start(0, 1, 2)

                                next_stage = 2
                            } else if (parser_regex.plain_value.test(char)){
                                type = 3

                                value_start(1)

                                next_stage = 2
                            } else return exit(true)

                            break


                        // Before a block
                        case 3:
                            if(!/[;{]/.test(char)) return exit(true);

                            if(char === ";"){
                                return exit()
                            }

                            stage = 4

                            break


                        // Looking for a keyword
                        case 4:
                            if(char === "}"){
                                return exit()
                            }

                            if(!parser_regex.keyword.test(char)) return exit(true);

                            stage = 5

                            value_start(1, 0, 1)
                            break


                        // Keyword
                        case 5:
                            if(!parser_regex.keyword.test(char)){
                                if(parser_regex.whitespace.test(char)) {
                                    parsingValueSequenceBroken = true
                                    break
                                }

                                const key = get_value().trim()

                                type = 0

                                if(char === ";" || char === "}") {

                                    block.properties[key] = [true]
                                    stage = 4

                                    if(char === "}"){
                                        return exit()
                                    }

                                } else if (char === ":") {

                                    last_key = key
                                    parsedString = null
                                    stage = 6

                                } else return exit(true);
                            } else {
                                if(parsingValueSequenceBroken) {
                                    return exit(true)
                                }

                                parsingValueLength ++
                            }

                            break;


                        // Start of a value
                        case 6:

                            // Push values - this *was* supposed to write in an array only if there are multiple values, but this made working with data harder - property values are now always an array
                            if(parsedString){
                                if(block.properties[last_key]) {
                                    block.properties[last_key].push(parsedString)
                                } else {
                                    block.properties[last_key] = [parsedString]
                                }

                                parsedString = null
                            }

                            if(char === ","){

                                type = 0
                                stage = 6;
                                
                            } else if(char === ";"){

                                type = 0
                                stage = 4;

                            } else if(char === "}"){

                                return exit()

                            } else {
                                if(parser_regex.stringChar.test(char)){
                                    stringChar = char
    
                                    value_start(0, 1, 2)
    
                                    next_stage = 6
                                } else if (parser_regex.plain_value.test(char)){
    
                                    value_start(1, 0, 3)
    
                                    next_stage = 6
                                } else return exit(true)
                            };

                            break;
                    }
                }

                if(!confirmed) return exit(true);

                exit()
            }

            parseAt(blockPosition)
        },

        onclosetag(name) {
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

    console.log(performance.now() - now);

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



// Section: request handling
server = {
    Initialize(Backend_){
        Backend = Backend_;
        server.Reload(true)

        mime = Backend.mime;

        ls_url = `http${Backend.isDev? "" : "s"}://cdn.extragon.${Backend.isDev? "test" : "cloud"}/ls/`
    },
    
    async Reload(firstTime){

        if(!firstTime){
            Backend.refreshConfig()
        }

        version = Backend.config.valueOf("version") || "unknown";
    
        let webConfig = Backend.config.block("web");
    
        // Directories with web apps
        locations = webConfig && webConfig.properties.locations? webConfig.properties.locations : []
    
        await server.LoadAppliactions();

    },

    async LoadAppliactions(){
        function load(path){
            if(applications.has(path)){
                server.log.debug("Loading of web application (at " + path + ") was skipped (already seems to be loaded)");
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

                            res.send("You have landed in " + url + " - which is a directory.", headers);

                        } else {

                            // Temporary caching system, until uWS suppports low-level optimised cache on the C++ layer.
                            // Once that support is done, I will implement that

                            // Check if the file exists in cache and has not been changed since
                            let cache = !Backend.isDev ? 1 : cachedFile(file);

                            const baseName = nodePath.basename(file);
                            let extension = baseName, lastIndex = baseName.lastIndexOf('.');

                            if (lastIndex !== -1) {
                                extension = baseName.slice(lastIndex + 1);
                            }

                            let mimeType = (mime && mime.getType && mime.getType(extension)) || "text/plain";

                            headers['content-type'] = `${mimeType}; charset=UTF-8`;
                            headers['cache-control'] = `public, max-age=${cacheByFile[extension] || cacheByFile.default}`;
                            headers['x-content-type-options'] = "nosniff";
                            
                            if(cache instanceof Buffer || typeof cache === "string") {
                                // Great, content is cached and up to date, lets send the cache:

                                res.send(cache, headers)
                                return
                            }

                            if(cache !== 1) server.log.warn("Cached data were wrong or empty (serving \""+file+"\"), did you update them correctly? Note: forcing cache reload!");

                            let content;

                            switch(extension){
                                case "html":
                                    content = parse_html_content({ url, file, app, compress: true })
                                break;

                                case "css":
                                    content = fs.readFileSync(file, "utf8");
                                    content = Buffer.from(CleanCSS.minify(content).styles || content)
                                break;

                                case "js":
                                    content = fs.readFileSync(file, "utf8");
                                    content = Buffer.from(UglifyJS.minify(content).code || content)
                                break;

                                default:
                                    // res.stream(fs.createReadStream(file));
                                    content = fs.readFileSync(file);
                            }

                            res.send(content, headers)
                            if(content.length < max_cache_size) updateCache(file, content)
                            return
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

            applications.set(app.path, app)

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

        for(let app of applications.values()){
            if(!app.manifest || !app.manifest.server) continue;

            if(app.manifest.server.properties.domains) {
                for(let domain of app.manifest.server.properties.domains){
                    assignedDomains.set(domain, app.path);
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

        let appPath = assignedDomains.get(req.domain) ?? assignedDomains.get(":default");

        if(typeof appPath !== "undefined") {
            const app = applications.get(appPath)

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


    parse_html_content,

    // Debugging purposes and temporarily pretty messy, will be reworked later
    async HandleInternal({segments, req, res}){
        let application;

        switch (segments[1]) {
            case "list":

                for(let app of applicationCache){
                    app.domains = assignedDomains.keys().filter(domain => assignedDomains.get(domain) === app.path)
                }

                res.send(applicationCache)
                break

            case "resolve":

                if(!req.getQuery("app") || !req.getQuery("path")) return res.writeStatus("500").end();
                
                application = applications.get(req.getQuery("app"));
                if(!application) return res.writeStatus("500").end();

                application.serve({ domain: "internal", method: "GET", segments: req.getQuery("path").replace(/\?.*$/, '').split("/").filter(g => g), req, res })
                break

            case "enable": case "disable":

                if(!req.getQuery("app")) return res.writeStatus("500").end();
                
                for(let application of applications.values()) {
                    if(application.path === req.getQuery("app")) {
                        application.enabled = segments[1] === "enable"
                        res.end()
                        return
                    }
                }

                res.writeStatus("500").end();
                break

            case "domain":
                for(domain in assignedDomains.keys()){
                    if(assignedDomains.get(domain) == req.getQuery("app")) return res.send(asd);
                }
                return res.send("");

            case "domains":
                let list = [];

                for(domain in assignedDomains.keys()){
                    if(assignedDomains.get(domain) == req.getQuery("app")) list.push(domain);
                }

                return res.send(list);

            case "temporaryDomain":

                let random = Backend.uuid();
                assignedDomains.set(random) = req.getQuery("app");

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


module.exports = server