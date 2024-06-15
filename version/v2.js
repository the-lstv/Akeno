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

    async HandleRequest({req, res, segments, error, shift}){

        let User;

        // if(req.method == "WEBSOCKET"){
        //     switch(shift()){
        //         case"arisen":
        //             backend.addon("arisen").HandleSocket({backend, User, req, ws: res, send, message, shift})
        //         break;

        //         case"pixel":
        //             backend.addon("pixel").HandleSocket({backend, User, req, ws: res, send, message, shift})
        //         break;

        //         case"console":
        //             backend.addon("console").HandleSocket({User, req, ws: res, send, message, shift})
        //         break;

        //         case"mazec":
        //             backend.addon("mazec").HandleSocket({getAuth: backend.user.getAuth, req, ws: res, send, message, shift})
        //         break;
        //     }
        //     return;
        // }

        switch(shift()){

            case "ping":
                res.send("pong");
            break;

            case "test":
                backend.pockets.transaction(0, "5BATGBHQ2UvUNzzw6YKcz7NY6317VetyJER5BGb9UYdihhvwLt7W4FwPf0jK", "WUcjYxTQEiAwmieH8kE2tdWXk9UCAq7H", value = 1000, {}, (error, id) => {
                    console.log(error, id);
                })
            break;

            case "new":
                backend.pockets.createWallet(0, 0, {}, (error, id) => {
                    console.log(error, id);
                })
            break;

            case "start":
                backend.dispatch("start", ["635", "minecraft", "start", "-", "52000"])

                backend.HostSocket.on("app.stdout.636", function(data){
                    console.log("MINECRAFT > ",data);
                })
            break;

            case "status":
                res.send(
                    await backend.ask("status", 635)
                )
            break;

            case "say":
                req.parseBody(async (data, fail) => {
                    if(fail){
                        return error(fail)
                    }

                    data = data.string;

                    if(typeof data !== "string"){
                        return error(2)
                    }

                    res.send(
                        await backend.dispatch("stdin", [635, data + "\n"])
                    )
                }).data()
            break;

            case "latest": case "version":
                res.type("json")
                res.send(`{"current":2,"default":${backend.API._default},"latest":${backend.API._latest}}`)
            break;

            case "auth":
                User = backend.user.getAuth(req)

                switch(shift()){

                    case "get":
                        let users = [...new Set(shift().split(",").map(thing => thing.replace(/[^0-9]/g, '')).filter(garbage => garbage))];
                        if(users.length < 1) return error(2);

                        backend.user.get(users, (err, users) => {
                            if(err){
                                return error(err)
                            }

                            res.send(users)
                        })
                    break;

                    case "me":
                        if(User.error) return error(User.error);

                        backend.user.get(User.id, (err, users) => {
                            if(err){
                                return error(err)
                            }

                            res.send({...User, ...users[0], success: true})
                        })
                    break;

                    case "login":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);

                        res.writeHeader('Access-Control-Allow-Origin', req.getHeader("Origin"));

                        req.parseBody((data, fail) => {
                            let type = shift();

                            if(fail){
                                return error(fail)
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.username || !data.password){
                                return error(2)
                            }

                            backend.user.login(data.username, data.password, (err, token)=>{
                                if(err) {
                                    return error(err)
                                }

                                if(type == "cookie") setAuthCookie(req, res, token.token, 5184000000)
                                if(type !== "token") delete token.token;

                                token.success = true;

                                res.send(token)
                            }, 5184000000, type !== "verify")
                        }).data()
                    break;

                    case "check_sso":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);

                        req.parseBody((data, fail) => {
                            if(fail){
                                return error(fail)
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.app || !data.target){
                                return error(2)
                            }

                            let permissions = decodePermissions(data.permissions || "");

                            backend.db.database("extragon").query(`SELECT displayname, name, auth_uri, owner, icon, accent, banner, pocket_id FROM apps WHERE id = ?`,
                                [data.app],
                                function (err, result){
                                    if(err){
                                        return error(err)
                                    }
                                
                                    if(result.length < 1){
                                        return error("Application not found")
                                    }

                                    delete result[0].auth_uri;

                                    res.send({
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

                        req.parseBody((data, fail) => {
                            if(fail){
                                return error(fail)
                            }

                            data = data.json;

                            if(typeof data !== "object" || !data.app){
                                return error(2)
                            }

                            backend.db.database("extragon").query(`SELECT 1 FROM apps WHERE id = ?`,
                                [data.app],
                                function (err, result){
                                    if(err){
                                        return error(err)
                                    }
                                
                                    if(result.length < 1){
                                        return error("Application not found")
                                    }

                                    res.send({
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

                    case "benchmark":
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
                        
                        res.send(`Time taken to generate ${numTokens} JWT tokens: ${elapsedTime} milliseconds`);
                    break;

                    case "create":
                        if(!req.secured) return error(35);
                        if(req.method != "POST") return error(30);

                        res.writeHeader('Access-Control-Allow-Origin', req.getHeader("Origin"));
                        
                        
                        req.parseBody((data, fail) => {
                            if(fail){
                                return error(fail)
                            }
            
                            data = data.json;

                            if(typeof data !== "object" || !data.username || !data.password || !data.email){
                                return error(2)
                            }

                            if(!/(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/.test(data.email)){
                                return error(46)
                            }

                            if(!/^(?![0-9])[a-zA-Z0-9_.-]{2,60}$/.test(data.username)){
                                return error(47)
                            }

                            if(!/^(?=.*[^a-zA-Z]).{8,}$/.test(data.password)){
                                return error(48)
                            }

                            backend.user.createAccount(data, (err, token)=>{
                                if(err) {
                                    return error(err)
                                }

                                token.success = true;

                                res.send(token)
                            }, req.ip)
                        }).data()
                    break;

                    default:
                        error(1)
                }
            break;

            case"api_errors":
                res.send({data: backend.Errors})
            break;

            case"pixel":
                backend.addon("pixel").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"arisen":
                backend.addon("arisen").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"net":
                backend.addon("net").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"iproxy":
                backend.addon("iproxy").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"currency":
                backend.addon("currency").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"remote":
                backend.addon("remoteSync").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"currency":
                backend.addon("currency").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"remote":
                backend.addon("remoteSync").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"localcommands":
                backend.addon("localCommands").HandleRequest({backend, req, res, segments, error, shift})
            break;

            case"mazec":
                User = backend.user.getAuth(req)
                await backend.addon("mazec").HandleRequest({User, backend, req, res, segments, error, shift})
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
                api.HandleRequest({backend, req, res, segments, error, shift})
        }
    }
}

module.exports = main;