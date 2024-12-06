let backend,
    api,

    fs = require("fs"),
    sharp = require('sharp'),

    mime,

    fileMetadataCache = {},

    // Libraries
    libLocations
;

const cdn_path = "/www/content/akeno/cdn";
const ls_api = require(cdn_path + "/ls/source/backend/api");

var STREAM_CHUNK_SIZE = 8_000_000;

fileMetadataCache = JSON.parse(fs.readFileSync(cdn_path + "/metadata.cache.json", "utf8"))

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
    fs.writeFileSync(cdn_path + "/metadata.cache.json", JSON.stringify(fileMetadataCache))
}

function send(req, res, data = {}, cache = false, type = null, isFilePath){
    let mime = type || (typeof data == "object"? "application/json" : typeof data == "string" ? "text/plain" : "application/octet-stream");

    let headers = {
        'cache-control': (cache === false? "no-cache" : (typeof cache == "number" ? `public, max-age=${cache}` : cache)) || "max-age=60",
        'content-type': `${mime}; charset=UTF-8`
    }

    if(isFilePath){
        const range = req.getHeader("range");

        if (range) {
            const fileSize = fs.statSync(data).size;

            // const parts = range.replace(/bytes=/, '').split('-');
            // const start = parseInt(parts[0], 10);
            // const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1000000, fileSize - 1);

            const start = Number(range.replace(/\D/g, ""));
            const end = Math.min(start + STREAM_CHUNK_SIZE, fileSize - 1);

            const chunkSize = end - start;
            const file = fs.createReadStream(data, { start, end });

            res.cork(() => {
                // Begin stream with the proper headers
                res.writeStatus('206')

                backend.helper.corsHeaders(req, res).writeHeaders(req, res, {
                    ...headers,
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes'
                });
            })

            backend.helper.stream(req, res, file, chunkSize);
        } else {
            backend.helper.writeHeaders(req, res, headers).stream(req, res, fs.createReadStream(data), fs.statSync(data).size);
        }
        return
    }

    // res[(!type && (Array.isArray(data) || (typeof data == "object" && Object.prototype.toString.call(data) === '[object Object]'))? "json" : "send")](data);
    backend.helper.send(req, res, data, headers);
}


api = {
    Initialize(backend_){
        backend = backend_;

        mime = backend.mime;

        api.Reload(true)
    },


    async Reload(server_initiated){
        if(!server_initiated){
            backend.refreshConfig()
        }
    
        // let libConfig = backend.config.block("cdn.libraries");
    
        // libLocations = libConfig && libConfig.properties.locations? libConfig.properties.locations : [cdn_path + "/lib/*"]

        // await api.LoadLibraries();
    },


    async LoadLibraries(){

        function load(path){
            // console.log("loading ", path);
        }

        for(let location of libLocations){

            if(location.startsWith("./")) location = backend.path + location.replace("./", "/");

            if(!fs.existsSync(location.replace("/*", ""))) {
                api.log.warn("Library directory (" + location + ") does not exist");
                continue
            }

            if(location.endsWith("*")){
                let path = (location.replace("*", "") + "/").replaceAll("//", "/");
                libLocations.push(...fs.readdirSync(path).map(location => path + location).filter(path => fs.statSync(path).isDirectory()))
                continue
            }

            if(fs.statSync(location).isDirectory()){
                load(location)
            }
        }
    },


    async HandleRequest({segments, shift, error, req, res}){
        let file;

        let first = segments.shift();

        switch(req.method){
            case "GET":
                switch(first){
                    case "lib":
                        // Library
                        req.end("a")
                    break;

                    case "file":

                        // FIXME: This needs changes

                        if(!segments[0]){
                            return backend.helper.send(req, res, `{"success":false,"error":"This endpoint is currently not supported directly as for unstable behavior. Use /file/[hash][.format][?options] instead."}`, {'cache-control': "no-cache"}, 400)
                        }

                        let fileName = segments[segments[0].length < 32? 1 : 0] || "";

                        file = [(fileName.split(".").slice(0,-1)[0]) || fileName, fileName.split(".").length > 1 ? fileName.split(".").slice(-1)[0].replace(/\?.*/, ""): ""]

                        let filePath = cdn_path + "/file/" + file[0],
                            mimeType = mime.getType(file[1]) || "text/plain",
                            exists = fs.existsSync(filePath),
                            content
                        ;
                        
                        if(segments[0] == "check"){
                            return backend.helper.send(req, res, `{"exists":${exists}}`, {'cache-control': "no-cache"})
                        }

                        if(segments[0] == "info"){
                            if(fileMetadataCache[file[0]]){
                                return backend.helper.send(req, res, {
                                    ...fileMetadataCache[file[0]],
                                    likelyMimeType: mostCommonItem(fileMetadataCache[file[0]].mimeTypeHistory),
                                    likelyName: mostCommonItem(fileMetadataCache[file[0]].nameHistory),
                                    likelyExtension: mostCommonItem(fileMetadataCache[file[0]].extensionHistory),
                                }, {'cache-control': "no-cache"})
                            } else {
                                return backend.helper.send(req, res, {
                                    success: false,
                                    code: 43,
                                    error: "File metadata not found.",
                                    file: file[0]
                                }, {'cache-control': "no-cache"})
                            }
                        }

                        if(!exists) {
                            return error(43)
                        }

                        if(fs.lstatSync(filePath).isDirectory()){
                            send(req, res, fs.readdirSync(filePath))
                            return
                        }

                        if(segments[1] && segments[1].toLowerCase() == "checknsfw"){
                            send(req, res, await imageCheckNSFW(file[0]))
                            return 
                        }

                        if(req.getQuery("size") && mimeType.startsWith("image")){
                            let size = req.getQuery("size").split(",");
                
                            if(size.length < 2) size[1] = size[0];
                
                            size = size.map(value => Math.max(12, Math.min(+value, 1024)))

                            size[0] = +size[0]
                            size[1] = +size[1]
                
                            if(isNaN(size[0])) size[0] = null;
                            if(isNaN(size[1])) size[1] = null;
                
                            content = await sharp(filePath).resize(size[0] === 0 ? null : size[0], size[1] === 0 ? null : size[1], {fit: req.getQuery("fit") || "cover"}).webp({
                                quality: 80,
                                lossless: false
                            }).toBuffer()
                        }

                        send(req, res, content || filePath, 31536000, mimeType, content? false : true)
                        return;

                    case "archive":
                        (() => {
                            let file = segments.join("/"),
                                extension = file.split(".").at(-1).toLowerCase(),
                                filePath = cdn_path + "/archive/" + segments.join("/"),
                                mimeType = mime.getType(extension) || "text/plain",
                                exists = fs.existsSync(filePath),
                                content
                            ;
    
                            if(!exists) {
                                return error(43)
                            }
    
                            if(fs.lstatSync(filePath).isDirectory()){
                                send(req, res, fs.readdirSync(filePath))
                                return
                            }

                            send(req, res, content || filePath, 31536000, mimeType, content? false : true)
                            return
                        })()
                        return;

                    case "docs": case "docs.html": case "docs.htm":
                        send(req, res, cdn_path + "/docs.html", false, "text/html", true)
                    break

                    case "ls":
                        /*
                            This code handles transfer of the framework.
                        */

                        ls_api.HandleRequest({ req, res, segments, error, backend, send })
                    break;

                    default:
                        file = cdn_path + "/" + first + "/" + req.path;

                        if(fs.existsSync(file)){
                            if(fs.lstatSync(file).isDirectory()){
                                send(req, res, fs.readdirSync(file))
                                return
                            }

                            send(req, res, file, (args.includes("@version") || args.includes("@refresh"))? false : 345600, first == "flags"? "image/svg+xml": "application/octet-stream", true)
                        } else {
                            error(43)
                        }
                }
            break;

            case "POST":
                switch(first){
                    case "upload": case "file":
                        backend.helper.parseBody(req, res, async (data, fail) => {
                            if(fail){
                                return error(fail)
                            }

                            let finalResult = [];

                            if(!data || !Array.isArray(data)){
                                return error(2)
                            }

                            for(let file of data){
                                // fs.renameSync("/www/ram/" + file.path.split("/").at(-1), "/www/ram/" + file.md5)

                                // file.path = "/www/ram/" + file.md5;

                                let ext = (file.filename.match(/\.[^.]+$/)?.[0] || "").replace(".", ""),
                                    mimeType = file.type || mime.getType(ext) || "text/plain",
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

                                    if(!fileMetadataCache[file.md5].nameHistory.includes(file.filename)) fileMetadataCache[file.md5].nameHistory.push(file.filename)
                                    if(!fileMetadataCache[file.md5].extensionHistory.includes(ext)) fileMetadataCache[file.md5].extensionHistory.push(ext)
                                    if(!fileMetadataCache[file.md5].mimeTypeHistory.includes(ext)) fileMetadataCache[file.md5].mimeTypeHistory.push(mimeType)

                                    saveMetadata()
                                } else {
                                    updateMetadataOf(file.md5, {
                                        nameHistory: [file.filename],
                                        extensionHistory: [ext],
                                        mimeTypeHistory: [mimeType],
                                        lastUploaderIP: req.ip,
                                        uploaderIP: req.ip,
                                        firstUploadTime: Date.now(),
                                        uploadedTimes: 1
                                    })
                                }

                                let newPath = cdn_path + '/file/' + file.md5,
                                    result = {
                                        success: true,
                                        mimeType,
                                        hash: file.md5,
                                        originalName: file.filename,
                                        name: file.md5 + (ext? "." + ext: ""),
                                        url: "https://cdn.extragon.cloud/file/" + file.md5 + (ext? "." + ext: ""),
                                        ... mimeType.startsWith("image") ? {
                                            nsfw: await imageCheckNSFW(file.md5)
                                        } : {}
                                    }
                                ;


                                if(fs.existsSync(newPath)){
                                    ignored = true
                                }else{
                                    // fs.copyFileSync(file.path, newPath)
                                    fs.writeFile(newPath, file.data, () => {
                                        delete file.data
                                    })
                                    ignored = false
                                }

                                result.ignored = ignored;

                                // fs.rmSync(file.path)

                                if(!fileMetadataCache[file.md5].nsfw) await imageCheckNSFW(file.md5)
                        
                                finalResult.push(result)
                            }

                            send(req, res, finalResult);
                        }).upload("file", true)
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

module.exports = api;
