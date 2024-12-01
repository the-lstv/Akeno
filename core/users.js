let backend, db;

// User management addon
// TODO: This needs a lot of work

const addon = module.exports = {
    Initialize(backend_){
        backend = backend_
        db = backend.db.sql_open()
    },

    get(idList, callback, items = ["username", "displayname", "pfp", "email", "verified_email", "status", "id"]){
        if(!Array.isArray(idList)) idList = [idList];

        for(let i = 0; i < idList.length; i++){
            if(typeof idList[i] === "object") idList[i] = idList[i].id;
            if(typeof idList[i] === "string") idList[i] = +idList[i];
        }

        idList = idList.filter(id => typeof id === "number")
        if(idList.length < 1) return callback(2);

        items = items.map(item => item.replace(/[^a-zA-Z0-9_.\-]/g, '')).filter(nothing => nothing).join();
        if(items.length < 1) return callback(2);

        db.database("extragon").query(`SELECT ${items} FROM users WHERE id IN (${idList.join()}) LIMIT 300`,
            function(err, results){
                if(err){
                    return callback(err)
                }

                if(results.length < 1){
                    return callback(6)
                }

                for(let result of results){
                    if(result.verified_email) result.verified_email = !!result.verified_email.data
                }

                callback(null, results)
            }
        )
    },

    login(identification, password, callback, expiresIn = 5184000000, createToken = true){
        db.database("extragon").query(
            'SELECT hash, id, username FROM `users` WHERE `username` = ? OR `email` = ?',

            [identification, identification],

            async function(err, results) {
                if(err){
                    return callback(err)
                }

                if(results.length < 1){
                    return callback(6)
                }

                let user = results[0];

                backend.bcrypt.compare(password, user.hash.replace("$2y$", "$2b$"), function(err, result){
                    if(!err && result){

                        let token;
                        if(createToken) token = backend.jwt.sign(
                            {
                                id: user.id
                            },
                            {
                                expiresIn: expiresIn < 1000 ? 1 : expiresIn / 1000
                            }
                        );

                        callback(null, {
                            token,
                            id: user.id,
                            legacy: user.hash.includes("$2y$")
                        })

                    } else callback(err ? 12 : 11);
                })
            }
        )
    },

    async createAccount(user, callback, ip){
        let discord = user.discord? await backend.getDiscordUserInfo(user.discord): {};

        if (!user.username || !user.email || !user.password) {
            return callback("Missing required fields: username, email, or password.");
        }

        if (discord && !discord.id) {
            return callback("Invalid Discord information.");
        }

        db.database("extragon").query(`SELECT username, email, discord_id FROM users WHERE username = ? OR email = ? OR discord_id = ?`,
            [user.username, user.email, discord? +discord.id : 0],

            async function(err, results) {
                if(err || results.length > 0){
                    if(discord && results[0].discord_id == +discord.id){
                        return callback("Some other account already has this same Discord account linked.")
                    } else {
                        return callback(err? 12 : (user.email == results[0].email? (user.username == results[0].username? "Both the email and username are": "This email is"): "This username is") +" already taken.")
                    }
                }

                let finalUser = {

                    // Profile
                    displayname: user.username,
                    ...user.profile || {},

                    // User
                    username: user.username,
                    hash: await backend.bcrypt.hash(user.password, 8),
                    email: user.email,
                    ip: ip || "",

                    ...(discord && {
                        discord_link: user.discord,
                        discord_id: +discord.id,
                        discord_raw: JSON.stringify(discord),
                    })
                };

                db.database("extragon").table("users").insert(finalUser, (err, result) => {
                    if(err){
                        return callback(err)
                    }

                    if (user.generateToken) {
                        backend.user.login(user.username, user.password, (err, data)=>{
                            if(err){
                                return callback(null, {id: result.insertId, token: null, err})
                            }

                            callback(null, {id: result.insertId, ...data})
                        }, 5184000000, true)
                    } else {
                        callback(null, {id: result.insertId})
                    }

                })
            }
        )
    },

    getAuth(req){
        if(req.User) return req.User;
        // TODO: || req.cookies.token - parse cookies
        let token = typeof req == "string"? req : decodeURIComponent(req.getHeader("authorization") || "").replace('Bearer ','').replace('APIKey ','');
    
        if(!token) return {error: 13};
    
        try{
            return backend.jwt.verify(token, backend.testKey)
        } catch {
            return {error: 9}
        }
    }
}