let isDev = false, // Do not change - its now inherited from Backend.isDev when initialized. This only serves as a fallback at this point

    Backend,
    api,

    // app=(require('express'))(),
    // id=Date.now(),
    // compression = (require("compression"))(),
    // cors = (require('cors'))(),

    fs = require("fs"),
    // multer = require('multer-md5'),
    mime = require('mime'),
    sharp = require('sharp'),

    CleanCSS = new (require('clean-css'))({
        keepSpecialComments: '*'
    }),
    UglifyJS = require("uglify-js"),

    lsCache = {},
    fileMetadataCache = {}
;

var Path = "/www/content/akeno/cdn",
    CompiledPath = Path + "/ls/compiled/",
    SourcePath = Path + "/ls/source/"
;

fs.writeFileSync(SourcePath + "ls.min.css", CleanCSS.minify(fs.readFileSync(SourcePath + "ls.css", "utf8").replaceAll("/*]", "/*! ]")).styles.replaceAll("/*! ]", "/*]"))
fs.writeFileSync(SourcePath + "ls.min.js", UglifyJS.minify(fs.readFileSync(SourcePath + "ls.js", "utf8"), {
    output: {
        comments: /\]/
    }
}).code)

fileMetadataCache = JSON.parse(fs.readFileSync(Path + "/metadata.cache.json", "utf8"))

// app.use(compression)

// Set up multer for file uploads
// const storage = multer.diskStorage({
//     destination: Path + '/temp/',
//     filename: (req, file, callback) => {
//         callback(null, Backend.uuid());
//     }
// });

// const upload = multer({ storage });

function mostCommonItem(arr) {
    const frequency = arr.reduce((acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
    }, {});

    let maxCount = 0;
    let mostCommon;

    for (const item in frequency) {
        if (frequency[item] > maxCount) {
            maxCount = frequency[item];
            mostCommon = item;
        }
    }

    return mostCommon;
}

async function deadlineFetch(url, options = {}, timeout = 5000) {
    let controller = new AbortController(),
        timeoutId = setTimeout(() => controller.abort(), timeout);
    ;

    try {
        let response = await fetch(url, { signal: controller.signal, ...options });

        clearTimeout(timeoutId);

        return response
    } catch (error) {throw error};
}

async function imageCheckNSFW(hash){
    if(!fileMetadataCache[hash]) fileMetadataCache[hash] = {};
    if(fileMetadataCache[hash].nsfw) return fileMetadataCache[hash].nsfw;

    let result = {};

    try {
        let data = await deadlineFetch("http://0.0.0.0:8000?imageHash=" + hash)
        result = await data.json()
    } catch (e) {
        result.error = e
    }

    if(!result.error){
        fileMetadataCache[hash].nsfw = result
    }

    saveMetadata()
    
    return result
}

function updateMetadataOf(hash, patch){
    if(!fileMetadataCache[hash]) fileMetadataCache[hash] = {};

    fileMetadataCache[hash] = {
        ...fileMetadataCache[hash],
        ...patch
    }

    saveMetadata()
}

function saveMetadata(){
    fs.writeFileSync(Path + "/metadata.cache.json", JSON.stringify(fileMetadataCache))
}

// CDN API:

api = {
    Initialize(Backend_){
        Backend = Backend_;
        isDev = Backend.isDev;
    },
    async HandleRequest({method, segments, shift, error, req, res}){+
        res.setHeader( 'X-Powered-By', 'ExtraGon CDN/1.2' );

        function send(data = {}, cache = false, type = null, isFilePath){
            let mime = type || (typeof data == "object"? "application/json" : typeof data == "string" ? "text/plain" : "application/octet-stream");

            res.setHeader('cache-control', (cache === false? "no-cache" : (typeof cache == "number" ? `public, max-age=${cache}` : cache)) || "max-age=60")
            res.setHeader('content-type', `${mime}; charset=UTF-8`);

            if(isFilePath){
                const range = req.headers.range;

                if (range) {
                    const fileSize = fs.statSync(data).size;
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                    const chunkSize = end - start + 1;
                    const file = fs.createReadStream(data, { start, end });

                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.setHeader('Content-Length', chunkSize);
                    res.setHeader('Content-Type', 'video/mp4');

                    res.status(206);
                    file.pipe(res);
                } else {
                    fs.createReadStream(data).pipe(res);
                }
                return
            }

            res[(!type && (Array.isArray(data) || (typeof data == "object" && Object.prototype.toString.call(data) === '[object Object]'))? "json" : "send")](data);
        }

        let file;

        let first = segments.shift();
        
    
        switch(method){
            case"GET":
                switch(first){
                    case"file":

                        if(!segments[0]){
                            res.setHeader('cache-control', "no-cache");
                            return res.json({
                                success: false,
                                error: "This endpoint is currently not supported directly as for unstable behavior. Use /file/[hash][.format][?options] instead."
                            })
                        }

                        let fileName = segments[segments[0].length < 32? 1 : 0] || "";

                        file = [(fileName.split(".").slice(0,-1)[0]) || fileName, fileName.split(".").length > 1 ? fileName.split(".").slice(-1)[0].replace(/\?.*/, ""): ""]

                        let filePath = Path + "/file/" + file[0],
                            mimeType = mime.types[file[1]] || "text/plain",
                            exists = fs.existsSync(filePath),
                            content
                        ;
                        
                        if(segments[0] == "check"){
                            res.setHeader('cache-control', "no-cache");

                            return res.json({
                                exists
                            })
                        }

                        if(segments[0] == "info"){
                            res.setHeader('cache-control', "no-cache");

                            if(fileMetadataCache[file[0]]){
                                return res.json({
                                    ...fileMetadataCache[file[0]],
                                    likelyMimeType: mostCommonItem(fileMetadataCache[file[0]].mimeTypeHistory),
                                    likelyName: mostCommonItem(fileMetadataCache[file[0]].nameHistory),
                                    likelyExtension: mostCommonItem(fileMetadataCache[file[0]].extensionHistory),
                                })
                            } else {
                                return res.json({
                                    success: false,
                                    code: 43,
                                    error: "File metadata not found.",
                                    file: file[0]
                                })
                            }
                        }

                        if(!exists) {
                            return error(43)
                        }

                        if(fs.lstatSync(filePath).isDirectory()){
                            send(fs.readdirSync(filePath))
                            return
                        }

                        if(segments[1] && segments[1].toLowerCase() == "checknsfw"){
                            send(await imageCheckNSFW(file[0]))
                            return 
                        }

                        if(fs.existsSync(filePath)){
                            if(req.query.size && mimeType.startsWith("image")){
                                let size = req.query.size.split(",");
                    
                                if(size.length < 2) size[1] = size[0];
                    
                                size[0] = +size[0]
                                size[1] = +size[1]
                    
                                if(isNaN(size[0])) size[0] = null;
                                if(isNaN(size[1])) size[1] = null;
                    
                                content = await sharp(filePath).resize(size[0] === 0 ? null : size[0], size[1] === 0 ? null : size[1], {fit: req.query.fit || "cover"}).toBuffer()
                            }

                            send(content || filePath, 31536000, mimeType, content? false : true)
                            return
                        } else {
                            error(43)
                            return
                        }
                        return;
                    break;

                    case "docs": case "docs.html": case "docs.htm":
                        send(Path + "/docs.html", false, "text/html", true)
                    break

                    case "ls":
                        /*
                            This code handles transfer of the framework.
                        */

                        segments = segments.map(segment => segment.toLowerCase());

                        let version = segments[2]? segments[1] : null;

                        if (!segments[2]) {
                            //If no version string is passed
                            segments[2] = segments[1] || ""
                        }

                        let code,
                            defaultsList = ["eventresolver", "default", "events"],
                            list = segments[2] ? segments[2].split(",") : ["*"]
                        ;

                        file = segments[0].split(".").reverse().join(".")
                        
                        if (isDev || !fs.existsSync(CompiledPath + "ls." + file + ".json")) {
                            if (isDev || fs.existsSync(SourcePath + "ls." + file)){
                                code = lsParse(fs.readFileSync(SourcePath + "ls." + file, "utf8"), file.endsWith("min.js"))
                                fs.writeFileSync(CompiledPath + "ls." + file + ".json", JSON.stringify(code, ...(isDev? [null, 4]: [])))
                            }else{
                                return error(43)
                            }
                        }
                    
                        // We parse the code.
                        if(!code){
                            if(lsCache[file]){
                                code = lsCache[file]
                            }else{
                                code = fs.readFileSync(CompiledPath + "ls." + file + ".json", "utf8");
                                code = JSON.parse(code)
                                lsCache[file] = code
                            }
                        }
                    
                        if(list.includes("@bare")){
                            defaultsList = []
                        }
                    
                        list.push(...defaultsList);
                    
                        // Now we perform a tree-shake, where we only include needed components, recruisively.
                        code = lsShake(code.content, list).replace(/\/\*\*\/|\/\*\//g, "").trim();

                        // Bug with minification
                        if(code.endsWith(",;")) code = code.replace(",;", ";")

                        send(code, isDev? "no-cache": 31536000, file.endsWith("js")? "text/javascript": file.endsWith("css")? "text/css": "text/plain")
                    break;
                    default:
                        file = Path + "/" + first + "/" + req.path;

                        if(fs.existsSync(file)){
                            if(fs.lstatSync(file).isDirectory()){
                                send(fs.readdirSync(file))
                                return
                            }

                            send(file, (args.includes("@version") || args.includes("@refresh"))? false : 345600, first == "flags"? "image/svg+xml": "application/octet-stream", true)
                        } else {
                            error(43)
                        }
                }
            break;

            case"POST":
                switch(first){
                    case"upload": case"file":
                        req.parseBody(async (data, fail) => {
                            if(fail){
                                error(fail)
                                return send()
                            }

                            let finalResult = [];

                            if(!data || !data.files){
                                return error(2)
                            }

                            for(let file of data.files){
                                fs.renameSync("/www/ram/" + file.path.split("/").at(-1), "/www/ram/" + file.md5)
                                file.path = "/www/ram/" + file.md5;

                                let ext = (file.originalname.match(/\.[^.]+$/)?.[0] || "").replace(".", ""),
                                    mimeType = mime.types[ext] || "text/plain",
                                    ignored = false
                                ;

                                if(fileMetadataCache.hasOwnProperty(file.md5)) {
                                    Object.assign(fileMetadataCache[file.md5], {
                                        lastUploaderIP: req.ip,
                                        lastUploadTime: Date.now()
                                    })

                                    fileMetadataCache[file.md5].uploadedTimes ++

                                    if(!fileMetadataCache[file.md5].nameHistory) fileMetadataCache[file.md5].nameHistory = [];
                                    if(!fileMetadataCache[file.md5].extensionHistory) fileMetadataCache[file.md5].extensionHistory = [];
                                    if(!fileMetadataCache[file.md5].mimeTypeHistory) fileMetadataCache[file.md5].mimeTypeHistory = [];

                                    if(!fileMetadataCache[file.md5].nameHistory.includes(file.originalname)) fileMetadataCache[file.md5].nameHistory.push(file.originalname)
                                    if(!fileMetadataCache[file.md5].extensionHistory.includes(ext)) fileMetadataCache[file.md5].extensionHistory.push(ext)
                                    if(!fileMetadataCache[file.md5].mimeTypeHistory.includes(ext)) fileMetadataCache[file.md5].mimeTypeHistory.push(mimeType)

                                    saveMetadata()
                                } else {
                                    updateMetadataOf(file.md5, {
                                        nameHistory: [file.originalname],
                                        extensionHistory: [ext],
                                        mimeTypeHistory: [mimeType],
                                        lastUploaderIP: req.ip,
                                        uploaderIP: req.ip,
                                        firstUploadTime: Date.now(),
                                        uploadedTimes: 1
                                    })
                                }

                                let newPath = Path + '/file/' + file.md5,
                                    result = {
                                        success: true,
                                        mimeType,
                                        hash: file.md5,
                                        originalName: file.originalname,
                                        url: "https://cdn.extragon.cloud/file/" + file.md5 + "." + ext,
                                        ... typeof req.query.checkNSFW == "string" && ["png", "gif", "jpg", "jpeg", "webp", "webm", "mp4", "tiff", "bmp"].includes(ext.toLowerCase()) ? {
                                            nsfw: await imageCheckNSFW(file.md5)
                                        } : {}
                                    }
                                ;


                                if(fs.existsSync(newPath)){
                                    ignored = true
                                }else{
                                    fs.copyFileSync(file.path, newPath)
                                    ignored = false
                                }

                                result.ignored = ignored;

                                fs.rmSync(file.path)

                                if(!fileMetadataCache[file.md5].nsfw) await imageCheckNSFW(file.md5)
                        
                                finalResult.push(result)
                            }

                            send(finalResult);
                        }).upload()
                    break;
                    default:
                        error(1)
                }
            break;
            default:
                error(39)
        }
    }
};

function lsShake(tree, list) {
    let result = "",
        all = list.includes("*")
    ;
    function recruisive(array) {
        for(let o of array){
            if(typeof o == "string"){
                result += o
            }else{
                if(!o.hasOwnProperty("segment") || list.includes(o.segment.toLowerCase()) || all){
                    recruisive(o.content)
                }
            }
        }
    }
    recruisive(tree)
    return result
}

function lsParse(code, compression){
    let tokens = [],
        cs = "",
        matching = false,
        matchStart = ["/*]", "//]"],
        matchEnd = ["*/"]
        matchType = "",
        skip = 0,
        matchingName = false,
        name = "",
        nameList = [],
        matchingKeyword = false,
        keywordMatch = /[[a-zA-Z#{}_]/,
        keyword = "",
        i = -1,
        variables = {}
    ;
    function stringVar(str){
        return (str||"").replace(/\$[\w\-\_]+/g, (a)=>{
            return stringVar(variables[a.replace("$", "").toLowerCase().trim()])
        })
    }
    function push(){
        if(cs){
            if(typeof tokens[tokens.length-1] == "string"){
                tokens[tokens.length-1] += cs
            }else{
                tokens.push(cs)
            }
        }
        cs = ""
    }

    //.split() is necessary since we need to split multi-symbol characters like emojis to not cause total chaos
    for(let s of code.split("")){

        // Parses the raw code (makes tokens)

        i++;

        if(skip > 0){
            skip--
            continue
        }
        if(matchingKeyword){
            if(s=="*" ||s=="(" || !keywordMatch.test(s)){
                matchingKeyword = false
                push()
                if(
                    //If a keyword should start matching an attribute
                    s == "("
                ){
                    name = ""
                    matchingName = true
                } else {
                    if( s=="*" && code[i+1] == "/" ){
                        skip++
                        matching = false
                    }
                    tokens.push({keyword})
                }
                continue
            }
            keyword += s
            continue
        }
        if(matchingName){
            if(s==")"){
                matchingName = false
                tokens.push({keyword,value: name})
                continue
            }
            name += s;
            continue
        }
        if(matching){
            if(s == "{"){
                continue
            }
            let _end = matchEnd.find((v)=>{
                return code.substring(i, i+v.length) == v
            });
            if(
                //Conditions to stop parsing attriutes
                _end ||
                (matchType == "//" && s == "\n")
            ){
                push()
                if(matchType != "//"){skip += _end.length-1}
                matching = false
                matchType = ""
                continue
            }
            if(
                //Conditions to start parsing an attribute
                keywordMatch.test(s)
            ){
                keyword = s
                matchingKeyword = true
                continue
            }
            continue
        }
        let _start = matchStart.find((v)=>{
            return code.substring(i, i+v.length) == v
        })
        if(
            //Conditions to start parsing attriutes
            _start
        ){
            matchType = _start
            push()
            skip += _start.length-1
            matching = true
            continue
        }

        cs+=s
    }

    push()
    tokens.push(cs)
    tokens = tokens.filter(g => g)
    let level = 0;

    function parse(start) {
        let result = [],
            processed = 0,
            skip = 0,
            part = ""
        ;
        function quit(){
            return [processed,  result]
        }
        for (let i=0;i<tokens.length-start;i++){
            let globalI = start+i,
                token = tokens[globalI]

            processed++;
            if(skip>0){
                skip--
                if(globalI + skip >= (tokens.length -1)){
                    return quit()
                }
                continue
            }

            if (typeof token == "object") {
                switch(token.keyword){
                    case"print":
                        result.push(stringVar(token.value.replaceAll("$name", part)))
                    break;

                    case"switch_dev":
                        let values = stringVar(token.value).split(",").map(asd => asd.trim());
                        // api.log("asdasdas",values)
                        result.push(isDev? values[0] : values[1])
                    break;

                    case"mark":
                        //...
                    break;

                    case"set":
                        token.value = token.value.split(":")
                        variables[token.value.shift().toLowerCase().trim()] = token.value.join(":")
                    break;

                    case"get":
                        result.push(variables[token.value.toLowerCase().trim()])
                    break;

                    case"import": case"include":
                        if(!compression){
                            result.push("\n")
                        }

                        if(!Array.isArray(token.value))token.value = stringVar(token.value).split(",").map(e=>
                            e.split(":").map(t=>t.trim()).filter(g=>g)
                        );

                        for(imp of token.value){
                            let isComponent = !!imp[1],
                                file = imp[0],
                                name = imp[1].replace("-", ""),
                                _result = {},
                                text = fs.readFileSync(SourcePath + file, "utf8")
                            ;

                            if(imp[2] == "-f") text = text.replace("function ", "");

                            text = (imp[2]=="js"? name + "(gl)": "") + text
                            
                            if(text && compression) {
                                text = UglifyJS.minify((imp[2]=="js"? "function ": "") + text, {
                                    output: {
                                        comments: /\]/
                                    }
                                }).code || "";
                                if(imp[2]=="js") text = text.replace("function ", "")
                            }

                            text = text +(imp[2]=="js"?",":"");

                            if(imp[2] == "escape.template") text=text.replaceAll("`", "\\`").replaceAll("${", "$\\{");

                            let parsed = 
                                    imp[2]=="plain" ? {content:[text]} :
                                    lsParse(
                                        text
                                    )
                            ;

                            if(parsed.components) nameList.push(...parsed.components)
                            
                            if(isComponent){
                                _result.segment = name.toLowerCase()
                                nameList.push(name)
                            }

                            _result.content = parsed.content
                            _result.from = file

                            result.push(_result)
                        }

                    break;

                    case"part": case"default":
                        token.values = stringVar(token.value)
                        level++;
                        nameList.push(token.value)
                        let scope = parse(globalI + 1);
                        skip = scope[0]
                        part = token.value
                        result.push({segment: (token.value || "default").toLowerCase(), content: scope[1]})
                    break;

                    case"end": case"}":
                        level--;
                    return quit()
                    
                    case"#":

                    break;

                    default:
                        // console.warn("Unknown keyword: " + token.keyword)
                    break;
                }
            } else {
                result.push(compression? token.trim() : token)
            }
        }
        return quit()
    }
    let content = parse(0)[1];
    return {components: [...new Set(nameList)].filter(g=>g).map(t=>t.toLowerCase()), content: content}
}

module.exports = api;
