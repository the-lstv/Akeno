/*

    ExtraGon API default endpoints V2

*/

var main, backend;

function setAuthCookie(req, res, token, expiresIn){

    res.cookie('token', token, {
        httpOnly: true,
        secure: true,
        // sameSite: 'None',
        maxAge: expiresIn,
        domain: backend.isDev? 'api.extragon.test' : 'api.extragon.cloud',
        path: '/'
    })
}

let permissions = {
    // Please keep the numbers - they are IDs and should not change.
    'pockets.list'
        :1,
    'pockets.transaction'
        :2,
    'info.email.read'
        :3,
    'info.email.change'
        :4,
    'info.username.read'
        :5,
    'info.username.change'
        :6,
    'info.phone.read'
        :7,
    'info.phone.change'
        :8,
    'info.ip.read'
        :9,
    'info.ip'
        :10,
    'info.password.change'
        :11,
    'info.password.validate' :12,
    'pockets.read' :14,
    'cloud.services.list' :15,
    'cloud.services.link' :16,
    'cloud.services.manage' :17,
    'cloud.bucket.manage' :18,
}

function encodePermissions(list) {
    let result = [];

    for(let permission of list){
        if(!permissions.hasOwnProperty(permission)) continue;

        let code = permissions[permission],
            index = Math.floor(code / 10)
        ;

        if(!result[index]) result[index] = 0;

        result[index] |= (1 << (code % 10));
    }

    return result.map(thing => thing.toString(34).padStart(2, ".")).join("");
}

function decodePermissions(permissionString) {
    let codes = (permissionString.match(/.{1,2}/g) || []);

    codes = codes.map(thing => parseInt(thing.replace(".", ""), 34));
    
    let result = [];
    
    let i = -1;
    for(let permission in permissions){
        i++;
        
        let index = Math.floor(i / 10);

        let code = codes[index];

        if (code & (1 << (permissions[permission] % 10))) {
            result.push(permission);
        }
    }

    return result;
}

main = {
    Initialize(_backend){
        backend = _backend
    },

    async HandleRequest({req, res, segments, reply, error, success, shift, send, message}){

        let User;

        if(req.method == "WEBSOCKET"){
            switch(shift()){
                case"arisen":
                    backend.addon("arisen").HandleSocket({backend, User, req, ws: res, send, message, shift})
                break;

                case"pixel":
                    backend.addon("pixel").HandleSocket({backend, User, req, ws: res, send, message, shift})
                break;

                case"console":
                    backend.addon("console").HandleSocket({User, req, ws: res, send, message, shift})
                break;

                case"mazec":
                    backend.addon("mazec").HandleSocket({getAuth: backend.user.getAuth, req, ws: res, send, message, shift})
                break;
            }
            return;
        }

        switch(shift()){

            case"ping":
                send("pong");
            break;

            case"start":
                backend.dispatch("start", ["635", "minecraft", "start", "-", "52000"])

                backend.HostSocket.on("app.stdout.636", function(data){
                    console.log("MINECRAFT > ",data);
                })
            break;

            case"status":
                send(
                    await backend.ask("status", 635)
                )
            break;

            case"say":
                res.wait = true;
                req.parseBody(async (data, fail) => {
                    if(fail){
                        error(fail)
                        return send()
                    }

                    data = data.string;

                    if(typeof data !== "string"){
                        error(2)
                        return send()
                    }

                    send(
                        await backend.dispatch("stdin", [635, data + "\n"])
                    )
                }).data()
            break;

            case "latest": case"version":
                send({
                    current: 1,
                    default: API._default,
                    latest: API._latest
                })
            break;

            case "auth":
                User = backend.user.getAuth(req)

                switch(shift()){

                    case "get":
                        let users = [...new Set(shift().split(",").map(thing => thing.replace(/[^0-9]/g, '')).filter(garbage => garbage))];
                        if(users.length < 1) return error(2);
                        
                        res.wait = true;

                        backend.user.get(users, (err, users) => {
                            if(err){
                                error(err)
                                return send()
                            }

                            send(users)
                        })
                    break;

                    case "me":
                        if(User.error) return error(User.error);

                        res.wait = true;

                        backend.user.get(User.id, (err, users) => {
                            if(err){
                                error(err)
                                return send()
                            }

                            send({...User, ...users[0], success: true})
                        })
                    break;

                    case "login":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);

                        res.header('Access-Control-Allow-Origin', req.get("Origin"));
                        
                        res.wait = true;

                        req.parseBody((data, fail) => {
                            let type = shift();

                            if(fail){
                                error(fail)
                                return send()
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.username || !data.password){
                                error(2)
                                return send()
                            }

                            backend.user.login(data.username, data.password, (err, token)=>{
                                if(err) {
                                    error(err)
                                    return send()
                                }

                                if(type == "cookie") setAuthCookie(req, res, token.token, 5184000000)
                                if(type !== "token") delete token.token;

                                token.success = true;

                                send(token)
                            }, 5184000000, type !== "verify")
                        }).data()
                    break;

                    case "check_sso":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);
                        
                        res.wait = true;

                        req.parseBody((data, fail) => {
                            if(fail){
                                error(fail)
                                return send()
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.app || !data.target){
                                error(2)
                                return send()
                            }

                            let permissions = decodePermissions(data.permissions || "");

                            backend.db.database("extragon").query(`SELECT displayname, name, auth_uri, owner, icon, accent, banner, pocket_id FROM apps WHERE id = ?`,
                                [data.app],
                                function (err, result){
                                    if(err){
                                        error(err)
                                        return send()
                                    }
                                
                                    if(result.length < 1){
                                        error("Application not found")
                                        return send()
                                    }

                                    delete result[0].auth_uri;

                                    send({
                                        success: true,
                                        app: result[0],
                                        permissions
                                    })
                                }
                            );
                        }).data()
                    break;

                    case "authorize_sso":
                        if(User.error) return error(User.error);

                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);
                        
                        res.wait = true;

                        req.parseBody((data, fail) => {
                            if(fail){
                                error(fail)
                                return send()
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.app){
                                error(2)
                                return send()
                            }

                            backend.db.database("extragon").query(`SELECT 1 FROM apps WHERE id = ?`,
                                [data.app],
                                function (err, result){
                                    if(err){
                                        error(err)
                                        return send()
                                    }
                                
                                    if(result.length < 1){
                                        error("Application not found")
                                        return send()
                                    }

                                    send({
                                        success: true,
                                        token: backend.jwt.sign(
                                            {
                                                id: User.id,
                                                permissions: data.permissions || "",
                                                app: data.app
                                            },
                                            {
                                                expiresIn: (+data.expire) || 5184000
                                            }
                                        )
                                    })
                                }
                            );
                        }).data()
                    break;

                    case"discord_login":
                        // if(!req.secured)return error(35);
                        // if(req.method!="POST")return error(30);
                        // res.wait = true;
                        // if(!req.body){
                        //     error(2)
                        //     return send()
                        // }

                        // let token = typeof req.body=="object"? req.body.token : req.body ;
                        // let discordLogin = await getDiscordUserInfo(token)

                        // if(!discordLogin || !discordLogin.id){
                        //     error("Discord login failed.",11)
                        //     return send()
                        // }

                        // sql.query(
                        //     'SELECT id, hash, username FROM `users` WHERE `discord_id` = ?',
                        //     [+discordLogin.id],
                        //     async function(err, results) {
                        //         if(!err&&results[0]&&results[0].id){
                        //             let id = results[0].id;
                        //             let expiresIn = (+req.body?.expiresIn) || 5184000000;
                        //             let token = jwt.sign({id, user: results[0].username, api:false}, {expiresIn: expiresIn<1000?1:expiresIn/1000});
                        //             reply.token=token;
                        //             if(results[0].hash.includes("$2y$"))reply.legacy=true;
                        //             setAuthCookie(req, res, token, expiresIn)
                        //             success()
                        //             send()
                        //         }else{
                        //             error("Discord login failed: No user with this Discord account was found. Please create a normal account first and add your Discord account there.",6)
                        //             send()
                        //         }
                        //     }
                        // )
                    break;

                    // case"session":
                    //     switch(shift()){
                    //         case"validate": case"":
                    //             if(User.error) return error(User.error);
                    //             send(User)
                    //             success()
                    //         break;
                    //         case"logout":
                    //         break;
                    //         default:
                    //             error(1)
                    //     }
                    // break;

                    // case"info":
                    //     if(User.error) return error(13);
                    //     await new Promise(resolve => {
                    //         let details = shift();
                    //         sql.query(
                    //             `SELECT \`status\`, \`reason\`, \`credits-free\`, \`credits-free\`, \`credits-paid\`${details=="elaborate"?", discord_raw, `suspension-history`, id, creation_time":""} FROM users WHERE username = ?`,
                    //             [User.name],
                    //             async function(err, results) {
                    //                 if(!err&&results[0]&&results[0]["credits-free"]){
                    //                     send(results[0])
                    //                     success()
                    //                 }else{
                    //                     reply.err=err
                    //                     reply.auth_=User.name
                    //                     error(6)
                    //                 }
                    //                 resolve()
                    //             }
                    //         )
                    //     })
                    // break;

                    case "benchmark":
                        res.wait = true;

                        function generateJWT() {
                            const payload = {
                                something: Math.random(),
                                thing: "ABCDEFG",
                                asd: false
                            }
                            return backend.jwt.sign(payload, {});
                        }
                        
                        // Measure the time taken to generate 1000 JWT tokens
                        const startTime = performance.now();

                        const numTokens = 3000;
                        for (let i = 0; i < numTokens; i++) {
                            console.log(generateJWT());
                        }
                        const endTime = performance.now();
                        
                        // Calculate the elapsed time
                        const elapsedTime = endTime - startTime;
                        
                        send(`Time taken to generate ${numTokens} JWT tokens: ${elapsedTime} milliseconds`);
                    break;

                    case "create":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);

                        res.header('Access-Control-Allow-Origin', req.get("Origin"));
                        
                        res.wait = true;
                        
                        
                        req.parseBody((data, fail) => {
                            if(fail){
                                error(fail)
                                return send()
                            }
            
                            data = data.json;

                            if(typeof data !== "object" || !data.username || !data.password || !data.email){
                                error(2)
                                return send()
                            }

                            if(!/(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/.test(data.email)){
                                error(46)
                                return send()
                            }

                            if(!/^(?![0-9])[a-zA-Z0-9_.-]{2,60}$/.test(data.username)){
                                error(47)
                                return send()
                            }

                            if(!/^(?=.*[^a-zA-Z]).{8,}$/.test(data.password)){
                                error(48)
                                return send()
                            }

                            backend.user.createAccount(data, (err, token)=>{
                                if(err) {
                                    error(err)
                                    return send()
                                }

                                token.success = true;

                                send(token)
                            }, req.ip)
                        }).data()


                        // if(!req.secured) return error(35);
                        // if(req.method != "POST") return error(30);

                        // res.wait = true;

                        // if(typeof req.body !== "object" || !req.body.user || !req.body.password || !req.body.email){
                        //     error(2)
                        //     return send()
                        // }

                        // user = req.body;
                        // if(!user.username&&user.user)user.username=user.user;
                        // user.expiresIn=user.expiresIn?(user.expiresIn<1000?1:expiresIn/1000):5184000000;
                        // if(!(/(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/).test(user.email)){
                        //     error("Invalid email address");
                        //     return send()
                        // }
                        // let discord;
                        // if(user.discord){
                        //     discord = await getDiscordUserInfo(user.discord)
                        // }
                        // sql.query(
                        //     `SELECT username, email, discord_id FROM users WHERE username = ? OR email = ? OR discord_id = ?`,
                        //     [user.username, user.email, (+discord?.id||0)],
                        //     async function(err, results) {
                        //         if(err || results.length>0){
                        //             if(discord && (+results[0].discord_id==+discord.id)){
                        //                 error("Some other account already has this same Discord account linked.", 300)
                        //             }else{
                        //                 error(err?12:(user.email==results[0].email?(user.username==results[0].username?"Are you trying to log-in? Both the email and username are":"This email is"):"This username is")+" already taken.")
                        //             }
                        //             reply.sql=err;
                        //             return send();
                        //         }
                        //         sql.query(
                        //             `INSERT INTO users (username, email, hash${discord?", discord_link, discord_id, discord_raw":""}) VALUES (?, ?, ?${discord?", ?, ?, ?":""})`,
                        //             [user.username, user.email, await bcrypt.hash(user.password, 12), user.discord, (discord?+discord.id:0), JSON.stringify(discord)],
                        //             async function(err, result){
                        //                 if(err){
                        //                     error(err)
                        //                     return send()
                        //                 }
                        //                 let id = result.insertId;
                        //                 success()
                        //                 if(user.doLogin){
                        //                     reply.token=jwt.sign({id,user:user.username,api:false},{expiresIn:user.expiresIn})
                        //                     setAuthCookie(req, res,reply.token,user.expiresIn)
                        //                 }
                        //                 if(user.discord)reply.discordSuccess=!!discord;
                        //                 send()
                        //             }
                        //         )
                        //     }
                        // )
                    break;

                    default:
                        error(1)
                }
            break;

            case"api_errors":
                send({data: backend.Errors})
            break;

            case"pixel":
                backend.addon("pixel").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"arisen":
                backend.addon("arisen").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"net":
                backend.addon("net").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"iproxy":
                backend.addon("iproxy").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"currency":
                backend.addon("currency").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"remote":
                backend.addon("remoteSync").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"currency":
                backend.addon("currency").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"remote":
                backend.addon("remoteSync").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"localcommands":
                backend.addon("localCommands").HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            case"mazec":
                User = backend.user.getAuth(req)
                await backend.addon("mazec").HandleRequest({User, backend, req, res, segments, reply, error, success, shift, send, message})
            break;

            default:
                let api = backend.apiExtensions[segments[0]];
                if(!api) return error(1);

                if(typeof api == "string"){
                    // The API addon has not been loaded yet - lets do it now;
                    backend.apiExtensions[segments[0]] = api = backend.addon(segments[0], api)

                    if(!api){
                        return error(1)
                    }
                }
                api.HandleRequest({backend, req, res, segments, reply, error, success, shift, send, message})
        }
    },

    // async HandleSocket({backend, User, req, ws, send, message, shift}, segments){
        
    // }
}

module.exports = main;