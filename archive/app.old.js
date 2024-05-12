let
    port = 7007,
    http = require("http"),
    fs = require("fs"),
    // fastify = (require("fastify"))(),
    app,
    server,
    ws = require("ws"),
    wss = new ws.Server({ noServer: true }),
    connections = {},
    mysql = require("mysql2"),
    bcrypt = require("bcrypt"),
    cors = require("cors"),
    uuid = (require("uuid")).v4,
    jwt = require('jsonwebtoken'),
    cookieParser = require('cookie-parser'),
    compression = require("compression"),
    wscp=cookieParser()
;

let keyTest = "0a20c4356f3a4615b2dba4a11b29ba891370520466825db9f93c5316f61fd4e2075f2fdf49fb4bc476ef3fefe785ca094e0296e2aaa9b62359a5848d835acc6a";


async function build(){
    // await fastify.register(require('@fastify/express'));
    app = (require("express"))();
    // app = fastify;
    app.use((req,res,next)=>{
        if(req.body)next();
        if(req.method=="POST"){
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try{
                    let _= JSON.parse(body);
                    if(_) body =_
                }catch(e){}
                req.body = body;
                next()
            })
        }else{
            next()
        }
    })

    for(let v of apiVersions){
        v=API[v]
        if(v.Initialize)v.Initialize(Backend)
    }

    app.use(cors())
    app.use(wscp)
    // app.use(compression())
    
    app.get("*",(r,q)=>resolve("GET",r,q))
    app.post("*",(r,q)=>resolve("POST",r,q))
    app.delete("*",(r,q)=>resolve("DELETE",r,q))
    app.options("*",(r,q)=>resolve("OPTIONS",r,q))
    app.patch("*",(r,q)=>resolve("PATCH",r,q))

    server = http.createServer(app);

    server.on('upgrade',(req, socket, head) => {
        let _ = req.url.replace(/unsecure\/|secure\//,"")
        if (_.startsWith('/ws') || (/\/v(\d+)\/ws/).test(_)) {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wscp(req, {}, ()=>{
                    /*
                        0 = Connect
                        1 = Message
                        2 = Disconnect
                        3 = Error
                    */
                    req.method = "WEBSOCKET";
                    req.event = 0;
                    ws.uuid = uuid();
                    resolve("WEBSOCKET", req, ws)

                    ws.on('message', (message) => {
                        req.event = 1;
                        resolve("WEBSOCKET", req, ws, message)
                    })

                    ws.on('close',()=>{
                        req.event = 2;
                        resolve("WEBSOCKET", req, ws)
                    })
                });
            })
        } else {
            // For other paths, reject the WebSocket upgrade and continue with HTTP API
            socket.destroy();
        }
    })

    server.listen({port}, ()=>{
        console.log("[ "+Date.now()+" ("+new Date+") ] > API Has started on the port "+port)
    });
}


function SQLTool(config, connection){
    if(typeof config=="string")config={database:config};
    config = Object.assign({
        host     : 'vez.my.to',
        user     : 'api_full',
        password : 'xsD6SicFy2MMc.-',
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
        idleTimeout: 80000, // idle connections timeout, in milliseconds, the default value 60000
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    },config)
    let tools;
    tools={
        connection: connection?mysql.createPool(config):null,
        get config(){
            let config_=config
            delete config.password
            return config_
        },
        exists(table,column){return`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1;`},
        select(table,columns="*",limit,offset){return`SELECT ${Array.isArray(columns)?columns.join(","):columns} FROM ${table} LIMIT ${limit||500} OFFSET ${offset||0}`},
        selectWhere(table,columns="*",cond,limit,offset){return`SELECT ${Array.isArray(columns)?columns.join(","):columns} FROM ${table} WHERE ${cond} LIMIT ${limit||500} OFFSET ${offset||0}`},
        insert(table,columns){return`INSERT INTO ${table} (${Array.isArray(columns)?columns.join(","):columns}) VALUES (${columns.map(q=>"?").join(",")})`},
        update(table,columns){return`UPDATE ${table} SET ${columns.map(c=>c+" = ?").join(",")}`},
        updateWhere(table,columns,cond){return`UPDATE ${table} SET ${columns.map(c=>c+" = ?").join(",")} WHERE ${cond}`},
        exec(template, table, args, values, callback){
            return new Promise(resolve=>{
                tools.connection.query(tools[template](table,...args),values,function(err,result){
                    if(callback)callback(err,result)
                    resolve({err,result})
                })
            })
        }
    }
    return tools
}
var SQL = SQLTool("extragon", true), connection = SQL.connection;

//Add API handlers or addons here.
var API = {
    _default: 1,
    _addons: {
        chat: require("./addons/chat")
    },

    //Add or remove API versions here.
    1: require("./version/v1")
}

let apiVersions = Object.keys(API).filter(e=>!isNaN(+e));
API._latest = Math.max(...apiVersions.map(e=>+e));

var AddonCache={}, Backend = {
    sql: connection,
    jwt,
    uuid,
    bcrypt,
    wss,
    fs,
    app,
    API,
    cookieParser,
    testKey: keyTest,
    SQLTool,
    SQL,
    async Creation(id,getInfo){
        let info,_this;
        if(getInfo=true){
            info=(await SQL.exec("selectWhere",'creations',['name,type,\`backend-type\`,isLegacy,status,owner,managers,\`special-key\`,ip',"id=?"],[id]));
            if(!info.result||!info.result[0])return false;
            info=info.result[0]
        }
        _this={
            info,
            async get(internal){
                return await _this.storageGet(internal)
            },
            async set(internal,data){
                return await _this.storageSet(internal,data)
            },
            async patch(internal,patch){
                return await _this.storageSet(internal,(old)=>{
                    return Object.assign(old,patch)
                })
            },
            async storageGet(internal){
                let r=await SQL.exec('selectWhere', 'creations', [internal?"`specific`":"details","id=?",1], [id]),data;
                if(!r.err){
                    try{
                        data=r.result[0][internal?"specific":"details"]
                        data=JSON.parse(r.result[0][internal?"specific":"details"])
                    }catch(e){}
                }else{console.error(r.err)}
                return {err:r.err,data}
            },
            async storageSet(internal,newData,prefetch=true){
                let r={err:1},data = prefetch?await _this.storageGet(internal):{data:{}};
                if(data&&!data.err){
                    data=data.data
                    if(typeof newData=="function"){
                        newData=newData(data)
                    }
                    r=await SQL.exec('updateWhere', 'creations', [internal?["`specific`"]:["details"],"id=?"], [JSON.stringify(newData),id])
                }
                return r
            }
        }
        return _this;
    },
    ParseQuery(uri){
        let out = {}
        uri.slice(uri.indexOf("?")+1).split(/[?&]/g).map(m=>m.split("=")).forEach(m=>{
            out[m[0]]=m[1]||""
        })
        return out
    },
    EmulateRequest(path = "/", method = "GET", body, extra = {}, callback){
        return new Promise((r)=>{
            path = "secure/"+path.replace(/\?.*/,'');
            function done(data){
                if(callback)callback(data)
                r(data)
            }
            resolve(method||"GET", {
                path: path,
                url: path,
                body: body,
                headers: {},
                cookies: {},
                query: Backend.ParseQuery(path),
                emulated: true,
                ...extra.req
            },
            {
                send: done,
                json: done,
                ...extra.res
            })
        })
    },
    addon(name){
        // if(!fs.existsSync("./addons/"+name+".js"))return false;
        if(!AddonCache[name]){
            AddonCache[name] = require("./addons/"+name);
            if(AddonCache[name].Initialize)AddonCache[name].Initialize(Backend);
        }
        return AddonCache[name]
    },
    async getDiscordUserInfo(accessToken) {
        try {
            // Make a GET request to Discord API to fetch user information
            const response = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.ok) {
                const userInfo = await response.json();
                return userInfo;
            } else {
                console.error('Failed to fetch user information:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            console.error('Error occurred while fetching user information:', error.message);
            return null;
        }
    },      
    Economy: {
        CV: 100
    },
    Errors:{
        0: "Invalid API version",
        1: "Invalid API endpoint",
        2: "Missing or invalid parameters in request body/query string.",
        3: "Internal Server Error.",
        4: "Access denied.",
        5: "This user does not have access to this service.",
        6: "User not found. (Invalid username or email)",
        7: "Username already taken.",
        8: "Email address is already registered.",
        9: "Session/API token expired/is invalid. Please log-in again.",
        10: "Incorrect verification code.",
        11: "Invalid password.",
        12: "Authentication failed.",
        13: "Session/API token missing.",
        14: "This account is under suspension/termination/other kind of penalty. Log-in from the panel and contact support for more info.",
        15: "Forbidden action.",
        16: "This service does not exist.",
        17: "Request timed out.",
        18: "Too many requests. Try again in a few seconds.",
        19: "Service temporarily unavailable. Please check status (https://status.extragon.cloud).",
        20: "Service/Feature not enabled. It might first require setup from your panel, is not available (or is paid and you don't have access).",
        21: "Unsupported media type.",
        22: "Deprecated endpoint. Consult documentation for a replacement.",
        23: "Not implemented.",
        24: "Conflict.",
        25: "This node/location is temporarily unavailable. Please check status (https://status.extragon.cloud).",
        26: "Deprecated endpoint. Consult documentation for a replacement.",
        27: "Deprecated endpoint for this API version. Please update your code to the latest API version. (GET /latest)",
        28: "Access blocked for suspicious/illegal activity. Please, explain yourself to the support team to get the chance to re-enable access.",
        29: "Missing a sub-endpoint. This endpoint does not have a default response.",
        30: "Invalid method. Only POST allowed.",
        31: "Invalid method. Only GET allowed.",
        32: "Invalid method. Only PATCH allowed.",
        33: "Invalid method. Only DELETE allowed.",
        34: "Invalid method. Only OPTIONS allowed.",
        35: "This endpoint may handle sensitive data and so you can only use it over HTTPS. Please do not use it from unsecured environments to prevent attacks.",
        36: "Rate-Limited (API level). Please try again in a few seconds (or when your usage recharges).",
        37: "Rate-Limited (API level). You have used all of your requests for a given time period. For more info, look into your panel.",
        38: "Rate-Limited (Account level). Please contact support for more information.",
        39: "Invalid method for this endpoint.",
        40: "This endpoint is a WebSocket endpoint. Use the ws:// or wss:// protocol instead of http.",
        41: "Wrong protocol."
    },
    Util:{
        Patch(target, source) {
            for (const key in source) {
              if (typeof source[key] === 'object' && source[key] !== null) {
                if (!target[key]) {
                  target[key] = Array.isArray(source[key]) ? [] : {};
                }
                Backend.Util.Patch(target[key], source[key]);
              } else {
                target[key] = source[key];
              }
            }
          }
    }
}

//Update conversion to different currencies.
Backend.Economy.CV_CZK = Backend.Economy.CV / 100;
Backend.Economy.CV_USD = Backend.Economy.CV / 2173.91304347826;
Backend.Economy.CV_EUR = Backend.Economy.CV / 2380.9523809523;

async function resolve(method, req, res, message){
    /*
    Template, sort of

    switch(method){
        case "GET":
            break;
        case "POST":
            break;
        case "DELETE":
            break;
        case "OPTIONS":
            break;
    }
    */
    let segments = (req.path||req.url).split("/").filter(trash => trash),
        reply = {},
        sent
    ;

    req.secured = (segments.shift())=="secure";

    function error(err, code){
        if(typeof err == "number" && Backend.Errors[err]){
            let _code = code;
            code = err;
            err = (_code?code:"") + Backend.Errors[code]
        }
        if(method=="WEBSOCKET"){res.send("ERROR: "+err);return res.close()}
        reply.success = false;
        if(code||typeof code=="number")reply.code = code;
        reply.error = err;
    }
    
    function success(){
        reply.success = true;
    }

    function assign(obj){
        Object.assign(reply, obj);
    }

    function shift(){
        segments.shift();
        return segments[0]||""
    }

    function send(message){
        sent=true
        if(method=="WEBSOCKET")return res.send(message);
        res[typeof message=="string"?"send":"json"](typeof message=="undefined"?reply:message)
    }

    let ver = segments[0] ? +(segments[0].slice(1)) : 0;

    if(ver&&segments[0].toLowerCase().startsWith("v")){
        segments.shift()
    }

    if(!req.method)req.method=method;

    ver = (ver?ver:API._default);

    if(API[ver]){
        await API[ver]["HandleRequest"]({Backend, req, res, segments, reply, error, assign, shift, success, send, message})
    } else {
        error(0)
    }
    if(!sent&&!res.wait&&method!=="WEBSOCKET")res.json(reply)
}


build()