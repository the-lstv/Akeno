let isDev = true,

    app=(require('express'))(),
    id=new Date(),
    fs=require("fs"),
    multer = require('multer-md5'),
    uuid = require('uuid'),
    compression = (require("compression"))(),
    cors = (require('cors'))(),
    mime = require('mime'),
    sharp = require('sharp'),
    lsCache = {},

    fileMetadataCache = {}
;

console.log("starting");


var Path = "/www/content/extragon/cdn/content",
    CompiledPath = Path + "/ls/compiled/",
    SourcePath = Path + "/ls/source/"
;

fileMetadataCache = JSON.parse(fs.readFileSync(Path + "/metadata.cache.json", "utf8"))

app.use(compression)
app.use(cors)

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: Path + '/temp/',
    filename: (req, file, cb) => {
        cb(null, uuid.v4());
    }
});

console.clear()

const upload = multer({ storage });

async function imageCheckNSFW(hash){
    if(!fileMetadataCache[hash]) fileMetadataCache[hash] = {};
    if(fileMetadataCache[hash].nsfw) return fileMetadataCache[hash].nsfw;

    let result = await(await fetch("http://0.0.0.0:8000?imageHash=" + hash)).json()
    if(!result.error){
        fileMetadataCache[hash].nsfw = result
    }

    fs.writeFileSync(Path + "/metadata.cache.json", JSON.stringify(fileMetadataCache))

    return result
}

app.post('/upload', upload.array('file'), async (req, res) => {
    let finalResult = [];
    for(let file of req.files){
        let ext = file.originalname.match(/\.[^.]+$/)?.[0] || "",
            mimeType = mime.types[ext.replace(".", "")] || "text/plain";

        if(!fileMetadataCache[file.md5]) fileMetadataCache[file.md5] = {};

        console.log(req.query);
    
        let newPath = Path + '/file/' + file.md5,
            result = {
                success: true,
                mimeType,
                hash: file.md5,
                originalName: file.originalname,
                url: "https://cdn.extragon.cloud/file/" + file.md5 + ext,
                ... typeof req.query.checkNSFW == "string" ? {
                    nsfw: await imageCheckNSFW(file.md5)
                } : {}
            }
        ;

        if(fs.existsSync(newPath)){
            fs.rmSync(file.path)
            result.ignored = true
        }else{
            fs.renameSync(file.path, newPath)
            result.ignored = false
        }

        if(!fileMetadataCache[file.md5].nsfw) await imageCheckNSFW(file.md5)

        finalResult.push(result)
    }
    res.json(finalResult);
});


app.get("*", Handler);
app.post("*", Handler);

async function Handler(req,res){

    res.setHeader('Access-Control-Allow-Origin', "*")

    if(req.path == "" || req.path == "/"){
        res.redirect("https://lstv.space/");
        return;
    }

    let path = req.path.split("/").filter(t=>t).map(p=>p.toLowerCase()),
        result = new Result(res)
    ;

    let args = path.filter(f=>f.startsWith("@"));

    path = path.filter(f=>
        //What to exclude from parsing
        f!=="@version" || f!=="@info"
    );

    result.assign({cdn_build_id: id});
    result.cache(false);

    if(path[0]=="ls"&&path[1]){

        /*
            This code handles transfer of the framework.
        */

        let cache = isDev ? "no-cache" : (path[3] ? path[2] : "");

        if (!path[3]) {
            //If no version string is passed
            path[3] = path[2] || ""
        }

        let code,
            defaultsList = ["eventresolver", "default", "events"],
            list = path[3] ? path[3].split(",") : ["*"],
            file = path[1].split(".").reverse().join(".")
        ;
        
        if (isDev || !fs.existsSync(CompiledPath + "ls." + file + ".json")) {
            if (isDev || fs.existsSync(SourcePath + "ls." + file)){
                code = lsParse(fs.readFileSync(SourcePath + "ls." + file, "utf8"))
                fs.writeFileSync(CompiledPath + "ls." + file + ".json", JSON.stringify(code, ...(isDev? [null, 4]: [])))
            }else{
                result.success(false, "File ls." + file + " is missing!");
                result.send();
                return
            }
        }

        if (file.endsWith("js")) {
            result.type("text/javascript");
        } else if (file.endsWith("css")) {
            result.type("text/css");
        } else {
            result.success(false, `Unknown type "${file}"`);
            result.send();
            return;
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


        result.raw();
        result.success();
        result.cache(cache == "no-cache" ? false : cache == "ltc" ? 31536000 : 345600);
        result.value(code);

    }else if(path[0] == "file" && path[1]){
        let file = [(path[1].split(".").slice(0,-1)[0]) || path[1], path[1].split(".").length > 1 ? path[1].split(".").slice(-1)[0].replace(/\?.*/, ""): ""],
            filePath = Path + "/file/" + file[0],
            mimeType = mime.types[file[1]] || "text/plain",
            content
        ;

        console.log(file, filePath, path);

        if(fs.lstatSync(filePath).isDirectory()){
            result.value(fs.readdirSync(filePath))
            result.send();
            return
        }

        if(path[2] == "checknsfw"){
            result.set(await imageCheckNSFW(file[0]));
            result.send()
            return 
        }

        result.raw();

        if(fs.existsSync(filePath)){

            result.type( mimeType );
            result.cache(31536000);

            if(req.query.size && mimeType.startsWith("image")){
                let size = req.query.size.split(",");

                if(size.length < 2) size[1] = size[0];

                size[0] = +size[0]
                size[1] = +size[1]

                if(isNaN(size[0])) size[0] = null;
                if(isNaN(size[1])) size[1] = null;

                content = await sharp(filePath).resize(size[0] === 0 ? null : size[0], size[1] === 0 ? null : size[1], {fit: req.query.fit || "cover"}).toBuffer()
            }

            result.value(content || fs.readFileSync(filePath))

        }{
            result.success(false, "Couldn't find \""+path[1]+"\" on the CDN.")
        }

        result.send();
        return;

    }else if(path[0]=="favicon.ico"){

        result.raw();
        result.cache(31536000);
        result.type("image/x-icon")
        // result.value(fs.readFileSync(Path + "/favicon.ico"))
        result.send();

        return;
    }else{

        let p = Path + "/" + req.path;

        if(fs.existsSync(p)){
            if(fs.lstatSync(p).isDirectory()){
                result.value(fs.readdirSync(p))
                result.send();
                return
            }

            result.raw();

            let c = fs.readFileSync(p, "utf8");

            result.cache((args.includes("@version") || args.includes("@refresh"))? false : 345600);

            if(path[0] == "flags"){
                result.type("image/svg+xml");
            }

            result.value(c);
        }else{
            result.success(false, "Couldn't find \""+req.path+"\" on the CDN.")
        }
    }
    result.send();
}

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

function lsParse(code){
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
        keywordMatch = /[[a-zA-Z#{}]/,
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

                        if(!Array.isArray(token.value))token.value = stringVar(token.value).split(",").map(e=>
                            e.split(":").map(t=>t.trim()).filter(g=>g)
                        );

                        for(imp of token.value){
                            let isComponent = !!imp[1],
                                file = imp[0],
                                name = imp[1].replace("-", ""),
                                _result = {},
                                text = fs.readFileSync(SourcePath + file, "utf8");
                            if(imp[2]=="-f") text=text.replace("function ", "");

                            if(imp[2]=="escape.template") text=text.replaceAll("`", "\\`").replaceAll("${", "$\\{");
                            let parsed = 
                                    imp[2]=="plain" ? {content:[text]} :
                                    lsParse(
                                        (imp[2]=="js"?name+"(gl)":"")+ text +(imp[2]=="js"?",":"")
                                    )
                            ;

                            if(parsed.components)nameList.push(...parsed.components)
                            
                            if(isComponent){
                                _result.segment = name.toLowerCase()
                                nameList.push(name)
                            }

                            _result.content = parsed.content
                            _result.from = file

                            result.push(_result)
                        }

                    break;
                    case"part":case"default":
                        token.values = stringVar(token.value)
                        level++;
                        nameList.push(token.value)
                        let scope = parse(globalI+1);
                        skip = scope[0]
                        part = token.value
                        result.push({segment: (token.value || "default").toLowerCase(), content: scope[1]})
                    break;
                    case"end":case"}":
                        level--;
                        return quit()
                    case"#":
                    break;
                    default:
                        // console.warn("Unknown keyword: " + token.keyword)
                    break;
                }
            } else {
                result.push(token)
            }
        }
        return quit()
    }
    let content = parse(0)[1];
    return {components: [...new Set(nameList)].filter(g=>g).map(t=>t.toLowerCase()), content: content}
}

class Result{
    constructor(res=null,v=null){this.data=v?typeof v=="object"?v:{data:v}:{};this.res=res;this.isRaw=!1;this.contentType=null;this.Cache=""}
    set(v){if(this.isRaw){this.data.value=v}else{this.data=v}}
    value(v){this.data.value=v}
    raw(b=!0){this.isRaw=!!b}
    assign(...v){this.data=Object.assign(this.data,...v)}
    success(b=!0,error=''){this.data.success=!!b;if(error)this.data.error=error}
    error(error=''){this.data.error=error}
    type(t){this.contentType=t}
    html(){this.contentType="text/html"}
    cache(t=31536000){this.Cache=t===false?"no-cache":(typeof t=="number"?`public, max-age=${t}`:t)}
    get(){if(this.res){this.res.setHeader('content-type',`${this.contentType||(this.isRaw?"text/plain":"application/json")}; charset=UTF-8`);this.res.setHeader('cache-control',this.Cache||"max-age=0")}return this.isRaw?this.data.value:JSON.stringify(this.data)}
    send(){if(this.res){this.res.send(this.get())}}
}

app.listen(5005);