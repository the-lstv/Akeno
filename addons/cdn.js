let backend,
    api,

    fs = require("fs"),
    sharp = require('sharp'),

    path = require("path"),

    mime,

    db,
    fileMetadata

    // // Libraries
    // libLocations
;

const cdn_path = path.resolve(__dirname, "../cdn");

let ls_api = null;
if(fs.existsSync(cdn_path + "/ls")){
    ls_api = require(cdn_path + "/ls/backend/api");
}

var STREAM_CHUNK_SIZE = 8_000_000;

api = {
    Initialize($){
        backend = $;

        if (ls_api) ls_api.Initialize(backend)

        db = backend.KeyDB("db/cdn");
        db.open();

        fileMetadata = db.openDbi("fileMetadata", {}, true);
        
        if(fs.existsSync(cdn_path + "/metadata.cache.json")){
            let data = JSON.parse(fs.readFileSync(cdn_path + "/metadata.cache.json", "utf8"));

            console.log("Migrating metadata cache JSON into a database...");

            const txn = fileMetadata.beginTxn();
            try {
                for (const key in data) {
                    fileMetadata.set(txn, key, data[key]);
                }
            } finally {
                txn.commit();
                console.log("Migration complete.");
            }

            fs.renameSync(cdn_path + "/metadata.cache.json", cdn_path + "/archive/metadata.cache.json");
        }
        
        mime = backend.mime;
    },

    async HandleRequest({segments, shift, error, req, res}){
        let first = segments.shift();

        switch(req.method){
            case "GET":
                switch(first){
                    case "file":
                        if(!segments[0]){
                            return backend.helper.send(req, res, `{"success":false,"error":"Usage: /file/[hash][.format][?options] instead."}`, null, "400")
                        }

                        let file = segments[segments[0].length < 6? 1 : 0] || "";
                        
                        const dot_index = file.lastIndexOf(".");
                        const fileName = dot_index === -1? file: file.slice(0, dot_index);
                        const fileExtension = dot_index === -1? "": fileName.slice(dot_index + 1);

                        let filePath = cdn_path + "/file/" + fileName,
                            mimeType = mime.getType(fileExtension) || "text/plain",
                            exists = fs.existsSync(filePath),
                            content
                        ;

                        if(fs.lstatSync(filePath).isDirectory()){
                            backend.helper.send(req, res, fs.readdirSync(filePath))
                            return
                        }

                        if(segments[0] === "check"){
                            return backend.helper.send(req, res, `{"exists":${exists}}`, {'cache-control': "no-cache"})
                        }

                        if(segments[0] === "info"){
                            const metadata = fileMetadata.get(fileName, Object);

                            if(metadata){
                                return backend.helper.send(req, res, {
                                    ...metadata,
                                    likelyMimeType: mostCommonItem(metadata.mimeTypeHistory),
                                    likelyName: mostCommonItem(metadata.nameHistory),
                                    likelyExtension: mostCommonItem(metadata.extensionHistory),
                                    exists
                                }, {'cache-control': "no-cache"})
                            } else {
                                return error(43);
                            }
                        }

                        if(!exists) {
                            return error(43)
                        }

                        // if(segments[1] && segments[1].toLowerCase() == "checknsfw"){
                        //     backend.helper.send(req, res, await imageCheckNSFW(fileName))
                        //     return 
                        // }

                        const size_query = req.getQuery("size");
                        if(size_query && mimeType.startsWith("image")){
                            let size = size_query.split(",");
                
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

                        migration_send(req, res, content || filePath, 31536000, mimeType, content? false : true)
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
                                migration_send(req, res, fs.readdirSync(filePath))
                                return
                            }

                            migration_send(req, res, content || filePath, 31536000, mimeType, content? false : true)
                            return
                        })()
                        return;

                    case "docs": case "docs.html": case "docs.htm":
                        backend.helper.send(req, res, cdn_path + "/docs.html", false, "text/html", true)
                    break

                    case "ls":
                        /*
                            This code handles transfer of the framework.
                        */

                        if(ls_api) ls_api.HandleRequest({ req, res, segments, error }); else error(43);
                    break;

                    default:
                        file = cdn_path + "/" + first + "/" + req.path;

                        if(fs.existsSync(file) && fs.lstatSync(file).isDirectory()){
                            backend.helper.send(req, res, fs.readdirSync(file))
                            return
                        }

                        error(43)
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

                            api.upload(data, req, res, error);
                        }).upload("file", "xxh3")
                    break;
                    default:
                        error(1)
                }
            break;

            default:
                error(39)
        }
    },

    async upload(files, req, res, error){
        const update_txn = fileMetadata.beginTxn();

        const finalResult = [];

        const ip = (res && String(new Uint8Array(res.getRemoteAddress())).replaceAll(",", ".").replace("0.0.0.0.0.0.0.0.0.0.255.255.", "")) || null;

        for(let file of files){
            let ext = (file.filename.match(/\.[^.]+$/)?.[0] || "").replace(".", ""),
                mimeType = file.type || mime.getType(ext) || "text/plain"
            ;

            if(fileMetadata.has(file.hash)) {
                const metadata = fileMetadata.get(file.hash, Object);

                Object.assign(metadata, {
                    lastUploaderIP: ip,
                    lastUploadTime: Date.now(),
                    uploadedTimes: metadata.uploadedTimes + 1,
                })

                if(!metadata.nameHistory) metadata.nameHistory = [];
                if(!metadata.extensionHistory) metadata.extensionHistory = [];
                if(!metadata.mimeTypeHistory) metadata.mimeTypeHistory = [];

                if(!metadata.nameHistory.includes(file.filename)) metadata.nameHistory.push(file.filename)
                if(!metadata.extensionHistory.includes(ext)) metadata.extensionHistory.push(ext)
                if(!metadata.mimeTypeHistory.includes(ext)) metadata.mimeTypeHistory.push(mimeType)

                fileMetadata.set(update_txn, file.hash, metadata)
            } else {
                fileMetadata.set(update_txn, file.hash, {
                    nameHistory: [file.filename],
                    extensionHistory: [ext],
                    mimeTypeHistory: [mimeType],
                    lastUploaderIP: ip,
                    uploaderIP: ip,
                    firstUploadTime: Date.now(),
                    uploadedTimes: 1
                })
            }

            const newPath = cdn_path + '/file/' + file.hash;
            const filename = file.hash + (ext? "." + ext: "");
            const exists = fs.existsSync(newPath);

            const result = {
                success: true,
                mimeType,
                hash: file.hash,
                originalName: file.filename,
                name: filename,
                ignored: exists,
                url: "https://cdn.extragon.cloud/file/" + filename
            }

            // if(mimeType.startsWith("image")){
            //     try {
            //         result.nsfw = await imageCheckNSFW(file.hash);
            //     } catch (e) {
            //         result.nsfw_error = e
            //     }
            // }

            if(!exists) {
                fs.writeFile(newPath, file.data, () => {
                    delete file.data
                })
            }

            // if(!fileMetadataCache.nsfw) await imageCheckNSFW(file.hash)                        
            finalResult.push(result)
        }

        update_txn.commit();
        if (res) backend.helper.send(req, res, finalResult); else return finalResult
    }
};

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

// async function deadlineFetch(url, options = {}, timeout = 5000) {
//     let controller = new AbortController(),
//         timeoutId = setTimeout(() => controller.abort(), timeout);
//     ;

//     try {
//         let response = await fetch(url, { signal: controller.signal, ...options });

//         clearTimeout(timeoutId);

//         return response
//     } catch (error) {throw error};
// }

// async function imageCheckNSFW(hash){
//     if(!fileMetadataCache[hash]) fileMetadataCache[hash] = {};
//     if(fileMetadataCache[hash].nsfw) return fileMetadataCache[hash].nsfw;

//     let result = {};

//     try {
//         let data = await deadlineFetch("http://0.0.0.0:8000?imageHash=" + hash)
//         result = await data.json()
//     } catch (e) {
//         result.error = e
//     }

//     if(!result.error){
//         fileMetadataCache[hash].nsfw = result
//     }

//     saveMetadata()
    
//     return result
// }

function migration_send(req, res, data = {}, cache = false, type = null, isFilePath){
    let mime = type || (typeof data == "object"? "application/json" : typeof data == "string" ? "text/plain" : "application/octet-stream");

    let headers = {
        'cache-control': (cache === false? "no-cache" : (typeof cache == "number" ? `public, max-age=${cache}` : cache)) || "max-age=60",
        'content-type': `${mime}; charset=UTF-8`
    }

    if(isFilePath){
        const range = req.getHeader("range");

        if(!range){
            return backend.helper.writeHeaders(req, res, headers).stream(req, res, fs.createReadStream(data), fs.statSync(data).size);
        }

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
        return
    }

    // res[(!type && (Array.isArray(data) || (typeof data == "object" && Object.prototype.toString.call(data) === '[object Object]'))? "json" : "send")](data);
    backend.helper.send(req, res, data, headers);
}

module.exports = api;
