/*

    ExtraGon API default endpoints V1

*/

var ThisAPI, Backend;

function setAuth(res,token, expiresIn){
    res.cookie('token',token,{
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        maxAge: expiresIn,
        domain: '.extragon.cloud',
        path: '/'
    })
}

function getAuth(req){
    if(req.User) return req.User;
    // let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MCwibmFtZSI6ImFkbWluIiwiYXBpIjpmYWxzZSwiaWF0IjoxNzA0MTQxOTcwLCJleHAiOjE3MDkzMjU5NzB9.HMtqSFq_RtoUmpYewOaMGBkkRCYW19X5kPjRvafIqfc";
    // let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDIsIm5hbWUiOiJ3ZXJiIiwiYXBpIjpmYWxzZSwiaWF0IjoxNzA0MTY5OTA1LCJleHAiOjE3MDkzNTM5MDV9.EaUIXTyY-I2w8QXIerXZVpqiqYsdjX_3XB7ud5XyETM";
    let token = typeof req == "string"? req : decodeURIComponent(req.headers.authorization || req.cookies.token || "").replace('Bearer ','').replace('APIKey ','');

    if(!token) return {error:13};

    try{
        return Backend.jwt.verify(token, Backend.testKey)
    } catch {
        return {error: 9}
    }
}

ThisAPI = {
    Initialize(backend){
        Backend = backend
    },
    async HandleRequest({req, res, segments, reply, error, success, assign, shift, send, message}){
        with(Backend){
            let User;

            if(req.method == "WEBSOCKET"){
                ThisAPI.HandleSocket({Backend, User, req, ws: res, send, message, shift})
                return;
            }

            switch(segments[0]){
                case"ping":
                    send("pong");
                break;
                case"start":
                    Backend.dispatch("start", ["636", "minecraft", "start", "-", "52001"])
                    HostSocket.on("app.stdout.636", function(data){
                        console.log("MINECRAFT > ",data);
                    })
                break;
                case"status":
                    send(
                        await Backend.ask("status", 636)
                    )
                break;
                case"say":
                    send(
                        await Backend.dispatch("stdin", [636, shift().replace("%20"," ") + "\n"])
                    )
                break;
                case"latest":case"apiver":case"version":
                    assign({
                        current: 1,
                        default: API._default,
                        latest: API._latest
                    })
                break;
                case"economy":case"eco":case"pocket":
                    if(!req.secured)return error(35);
                    switch(shift()){
                        case"balance":
                            User=getAuth(req)
                            if(User.error)return error(13);
                            await new Promise( resolve => {
                                sql.query(
                                    'SELECT `credits-free`, `credits-paid` FROM `users` WHERE `username` = ?',
                                    [User.name],
                                    async function(err, results) {
                                        if(!err&&results[0]&&results[0]["credits-free"]){
                                            assign({
                                                free: +results[0]["credits-free"],
                                                paid: +results[0]["credits-paid"],
                                                total: (+results[0]["credits-free"])+(+results[0]["credits-paid"])
                                            })
                                            success()
                                        }else{
                                            reply.err = err
                                            // reply.auth_ = User.name
                                            error(6)
                                        }
                                        resolve()
                                    }
                                )
                            })
                        break;
                        case"transaction":
                            //TODO: Transaction API
                        break;
                        case"":case"price":
                            with(Economy){
                                assign({ CV, CV_CZK, CV_EUR, CV_USD })
                            }
                        break;
                    }
                break;
                case"user":
                    User = getAuth(req)
                    let user,id;
                    switch(shift()){
                        case"login":
                            if(!req.secured) return error(35);
                            if(req.method != "POST") return error(30);

                            if(typeof req.body == "string" && req.body.startsWith("email=")){

                                //Legacy method. Will be deprecated soon.
                                req.body = req.body.split("&").map(e=>e.split("="))
                                req.body = {user: req.body[0], password: req.body[1]}
                                reply.warning = "Please do not use the HTML form to log-in anymore. It is deprecated and may stop working anytime! Instead, use our API (same URL) but with a JSON body."

                            }else if(typeof req.body !== "object" || !req.body.user || !req.body.password ){
                                return error(2)
                            }

                            user = req.body.user

                            let password = req.body.password, expiresIn = (+req.body.expiresIn) || 5184000000; //2 months by default
                            res.wait = true;

                            sql.query(
                                'SELECT hash, id, username FROM `users` WHERE `username` = ? OR `email` = ?',
                                [user, user],
                                async function(err, results) {
                                    if(!err&&results[0]&&results[0].hash){
                                        bcrypt.compare(password, results[0].hash.replace("$2y$","$2b$"), function(err, result){
                                            if(!err && result){
                                                let id = results[0].id;
                                                let token = jwt.sign({
                                                    id,
                                                    name: results[0].username,
                                                    api:false
                                                },
                                                    testKey,
                                                {
                                                    expiresIn: expiresIn<1000?1:expiresIn/1000
                                                });
                                                reply.token=token;

                                                if(results[0].hash.includes("$2y$")) reply.legacy = true;

                                                setAuth(res, token, expiresIn)
                                                success()
                                                send()
                                            }else{
                                                error(err ? 12 : 11)
                                                send()
                                            }
                                        })
                                    }else{
                                        error(6)
                                        send()
                                    }
                                }
                            )
                        break;

                        case"discord_login":
                            if(!req.secured)return error(35);
                            if(req.method!="POST")return error(30);
                            res.wait = true;
                            if(!req.body){
                                error(2)
                                return send()
                            }
    
                            let token = typeof req.body=="object"? req.body.token : req.body ;
                            let discordLogin = await getDiscordUserInfo(token)
    
                            if(!discordLogin || !discordLogin.id){
                                error("Discord login failed.",11)
                                return send()
                            }
    
                            sql.query(
                                'SELECT id, hash, username FROM `users` WHERE `discord_id` = ?',
                                [+discordLogin.id],
                                async function(err, results) {
                                    if(!err&&results[0]&&results[0].id){
                                        let id = results[0].id;
                                        let expiresIn = (+req.body?.expiresIn) || 5184000000;
                                        let token = jwt.sign({id, user: results[0].username, api:false}, testKey, {expiresIn: expiresIn<1000?1:expiresIn/1000});
                                        reply.token=token;
                                        if(results[0].hash.includes("$2y$"))reply.legacy=true;
                                        setAuth(res, token, expiresIn)
                                        success()
                                        send()
                                    }else{
                                        error("Discord login failed: No user with this Discord account was found. Please create a normal account first and add your Discord account there.",6)
                                        send()
                                    }
                                }
                            )
                        break;
                        case"session":
                            switch(shift()){
                                case"validate":case"":
                                    if(User.error)return error(User.error);
                                    assign(User)
                                    success()
                                break;
                                case"logout":
                                break;
                                default:
                                    error(1)
                            }
                        break;
                        case"info":
                            if(User.error)return error(13);
                            await new Promise(resolve=>{
                                let details = shift();
                                sql.query(
                                    `SELECT \`status\`, \`reason\`, \`credits-free\`, \`credits-free\`, \`credits-paid\`${details=="elaborate"?", discord_raw, `suspension-history`, id, creation_time":""} FROM users WHERE username = ?`,
                                    [User.name],
                                    async function(err, results) {
                                        if(!err&&results[0]&&results[0]["credits-free"]){
                                            assign(results[0])
                                            success()
                                        }else{
                                            reply.err=err
                                            reply.auth_=User.name
                                            error(6)
                                        }
                                        resolve()
                                    }
                                )
                            })
                        break;
                        case"service":case"creations":case"services":case"list":case"creation":
                            if(User.error)return error(13);
                            if(!req.secured)return error(35);
                            let id=shift();
                            switch(id){
                                case"create":
                                break;
                                default:
                                    id=+id;
                                    if(!isNaN(id)||id==""){
                                        let service, hasAccess, isOwned, action = shift(), details = req.query.hasOwnProperty("details"), backend, handle;
                                        if(id){
                                            service = await Creation(id,true);
                                            isOwned = service.info.owner==User.id
                                            hasAccess = isOwned||service.info?.access?.find?.(o=>o.id==User.id)
                                            backend = service.info["backend-type"]
                                            handle = addon("driver-"+backend);
                                        }
                                        switch(action){
                                            case"":case"info":
                                                let filter=["id", "name", "type", "ip", "status", "reason", "owner", "isLegacy"];
                                                if(details)filter.push("access", "creation_date", "apiKeys", "details", "ownerName");
                                                if(id){
                                                    let reply = {success:false};
                                                    if(!service||service.error||!service.info){
                                                        error(16)
                                                        if(service.error)reply.error=service.error;
                                                        return;
                                                    }else{
                                                        let data = service.infoFilter(filter,true);
                                                        if(hasAccess){
                                                            reply.data = data;
                                                            reply.success = true;
                                                            if(details&&handle&&handle.Aditional)reply.service=await handle.Aditional({service});
                                                        }else{
                                                            return error(5)
                                                        }
                                                    }
                                                    return send(reply)
                                                }else{
                                                    await new Promise(resolve=>{
                                                        sql.query(
                                                            `SELECT id FROM creations WHERE ${id?"id=? LIMIT 1 OFFSET 0":"managers LIKE ? OR owner = ? LIMIT ? OFFSET ?"}`,
                                                            [...(id?[+id]:['%"'+User.name.replace(/['"]/g,"")+'"%',User.name]),+req.query.limit||100,+req.query.offset||0],
                                                            async function(err, results) {
                                                                if(!err){
                                                                    let reply={success:false};
                                                                    reply.data = (await CreationBulk(results.map(e=>e.id),true))?.map?.(e=>e?e.infoFilter(filter,true):null).filter(e=>e);
                                                                    if(reply.data)reply.success=true;
                                                                    return send(reply);
                                                                }else{
                                                                    reply.err=err
                                                                    reply.auth_=User.name
                                                                    error(24)
                                                                }
                                                                resolve()
                                                            }
                                                        )
                                                    })
                                                }
                                            break;
                                            default:
                                                if(!handle)return error(42);
                                                await handle.HandleRequest({service, action, req, res, segments, reply, error, success, assign, shift, send, message})
                                            break;
                                        }
                                    }else{
                                        error(1)
                                    }
                                break;
                            }
                        break;
                        case "register": case "new": case "signup":
                            if(!req.secured) return error(35);
                            if(req.method != "POST") return error(30);

                            res.wait = true;
                            if(typeof req.body !== "object" || !req.body.user || !req.body.password || !req.body.email){
                                error(2)
                                return send()
                            }

                            user = req.body;
                            if(!user.username&&user.user)user.username=user.user;
                            user.expiresIn=user.expiresIn?(user.expiresIn<1000?1:expiresIn/1000):5184000000;
                            if(!(/(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/).test(user.email)){
                                error("Invalid email address");
                                return send()
                            }
                            let discord;
                            if(user.discord){
                                discord = await getDiscordUserInfo(user.discord)
                            }
                            sql.query(
                                `SELECT username, email, discord_id FROM users WHERE username = ? OR email = ? OR discord_id = ?`,
                                [user.username, user.email, (+discord?.id||0)],
                                async function(err, results) {
                                    if(err || results.length>0){
                                        if(discord && (+results[0].discord_id==+discord.id)){
                                            error("Some other account already has this same Discord account linked.", 300)
                                        }else{
                                            error(err?12:(user.email==results[0].email?(user.username==results[0].username?"Are you trying to log-in? Both the email and username are":"This email is"):"This username is")+" already taken.")
                                        }
                                        reply.sql=err;
                                        return send();
                                    }
                                    sql.query(
                                        `INSERT INTO users (username, email, hash${discord?", discord_link, discord_id, discord_raw":""}) VALUES (?, ?, ?${discord?", ?, ?, ?":""})`,
                                        [user.username, user.email, await bcrypt.hash(user.password, 12), user.discord, (discord?+discord.id:0), JSON.stringify(discord)],
                                        async function(err, result){
                                            if(err){
                                                error(err)
                                                return send()
                                            }
                                            let id = result.insertId;
                                            success()
                                            if(user.doLogin){
                                                reply.token=jwt.sign({id,user:user.username,api:false},testKey,{expiresIn:user.expiresIn})
                                                setAuth(res,reply.token,user.expiresIn)
                                            }
                                            if(user.discord)reply.discordSuccess=!!discord;
                                            send()
                                        }
                                    )
                                }
                            )
                        break;
                        case"":
                            
                        break;
                        default:
                            error(1)
                    }
                break;

                case"api_errors":
                    assign({data: Errors})
                break;

                case"pixel":
                    addon("pixel").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"net":
                    addon("net").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"iproxy":
                    addon("iproxy").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"currency":
                    addon("currency").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"remote":
                    addon("remoteSync").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"currency":
                    addon("currency").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"remote":
                    addon("remoteSync").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"localcommands":
                    addon("localCommands").HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                case"mazec":
                    User = getAuth(req)
                    await addon("mazec").HandleRequest({User, Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                break;

                default:
                    let api = Backend.apiExtensions[segments[0]];
                    if(api){
                        if(typeof api == "string"){
                            // The API addon has not been loaded yet - lets do it now;
                            Backend.apiExtensions[segments[0]] = api = addon(segments[0], api)
                            if(!api){
                                return error(1)
                            }
                        }
                        api.HandleRequest({Backend, req, res, segments, reply, error, success, assign, shift, send, message})
                    } else {
                        error(1)
                    }
            }
        }
    },
    async HandleSocket({User, req, ws, send, message, shift}){
        with(Backend){
            switch(shift()){
                case"pixel":
                    addon("pixel").HandleSocket({Backend, User, req, ws, send, message, shift})
                break;

                case"console":
                    addon("console").HandleSocket({User, req, ws, send, message, shift})
                break;

                case"mazec":
                    addon("mazec").HandleSocket({getAuth, req, ws, send, message, shift})
                break;
            }
            
        }
    }
}

module.exports = ThisAPI;