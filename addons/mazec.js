var API, Backend, db, mazeDatabase;

let clients = {}, globalMessageID = 0;

let enc = new TextEncoder,
    dec = new TextDecoder,
    encode = (text) => enc.encode(text),
    decode = (bytes) => dec.decode(bytes),
    globalTimeStart = 1697840000000,
    eventList = [
        "heartbeat",
        "message",
        "listen",
        "update",
        "typing",
        "authorize"
    ],


    profileCache = {}
;

eventList.get = function(name){
    return eventList[eventList.indexOf(name)]
}

function A2U8(...data) {
    let result = [], i = 0;
    for(const event of data) {
        if(!Array.isArray(event))continue;
        let j = -1;
        for(const value of event){
            j++;
            let number = value, encoded, isString = (typeof value == "string");
            if(j == 0){
                // Add event type if suitable
                result.push(isString? eventList.indexOf(value) : value);
                continue
            }

            if(typeof value == "boolean"){
                result.push(value? 2 : 1);
                continue
            }

            if (isString){
                if(value === ""){
                    result.push(21)
                    continue
                }
                encoded = encode(value)
                number = encoded.length;
            } else if (value >= 0 && value <= 155) {
                // Numbers 0 to 155 can have a dedicated byte
                result.push(value + 100);
                continue
            }

            let a = [0];

            // Use 64bit int bitshift operations to convert a 1-8 byte number to a 8 bit array
            number = BigInt(number);
            for(let i = 0; i<8 ; i++){
                a.push(
                    Number(number & 0xFFn) >>> 0 //Unsigned
                )
                number >>= 8n;
            }

            // Remove trailing 0s
            let i = a.length - 1
            while (i >= 0 && a[i] === 0) {
                a.pop()
                i--
            }

            if(a.length < 2){
                a.push(0, 0) // If 0
            }

            a[0] = a.length + (isString ? 9 : 1) // Assign type
            result.push(...a);

            if (isString){
                result.push(...encoded)
            }
        }
        i++;
        if(i != data.length && data.length != 1 && data[i].length > 0) result.push(0);
    }
    result = result.map(b => Math.min(Math.abs(b), 255)).filter(b => typeof b == "number" && b < 256)
    return new Uint8Array(result)
}

function U82A(bytes) {
    let result = [],
        c = [],
        separator = false,
        skip = 0
    ;

    for(let i = 0; i < bytes.length; i++){
        let byte = bytes[i];
        if(skip > 0) {
            skip--
            continue
        }

        if(separator || i === 0){
            if(separator){
                result.push(c)
                c = []
            }
            c.push(eventList[byte])
            separator = false
            continue
        }

        if( byte === 0 ){
            separator = true
            continue
        }
        
        if( byte === 1 || byte === 2 ){
            c.push(byte == 2)
            continue
        }
        
        if( byte === 21 ){
            c.push("")
            continue
        }

        let isString = byte >= 11 && byte <= 20;

        if( (byte >= 3 && byte <= 10) || isString ){
            let size = byte - (isString? 10 : 2)
            let num = BigInt(0);
            for (let j = 0; j < size; j++) {
                num += BigInt(bytes[i + (j + 1)] || 0) << (BigInt(j) * 8n);
            }

            num = Number(num);
            
            i += (size)

            if(isString){
                c.push(
                    decode(new Uint8Array(bytes.slice(i + 1, i + num + 1)))
                )

                i += (num)
            } else {
                c.push(num)
            }


            continue
        }
        if( byte >= 100 && byte <= 255 ){
            c.push(byte - 100)
            continue
        }
    }
    result.push(c)

    return result;
}

API = {
    Initialize(Backend_){
        Backend = Backend_;
        db = Backend_.db;
        mazeDatabase = db.database("chat")
    },
    async HandleRequest({User, req, res, segments, reply, error, success, assign, shift, send, message}){
        let r;
        switch(shift()){
            case "":
                send({
                    auth: "/user/",
                    user_fragment: User,
                    latest_client: "0.1.20",
                    lowest_client: "0.1.9",
                    sockets: [
                        `ws://${req.hostname}/ws/mazec/`
                    ]
                })
            break;

            case "stats":
                send({
                    active_clients: clients.length
                })
            break;

            case "list":
                if(User.error)return error(13);
                await new Promise(resolve=>{
                    mazeDatabase.query(
                        `SELECT id,author,participants,created,name,icon,type,data,e2e,burn FROM rooms WHERE ${id?"id=? LIMIT 1 OFFSET 0":"managers LIKE ? OR owner = ? LIMIT ? OFFSET ?"}`,
                        [...(id?[+id]:['%"'+User.name.replace(/['"]/g,"")+'"%',User.name]),+req.query.limit||100,+req.query.offset||0],
                        async function(err, results) {
                            if(!err){
                                return send(results);
                            }else{
                                reply.err = err
                                reply.auth_ = User.name
                                error(24)
                            }
                            resolve()
                        }
                    )
                })
            break;


            case "user":
                if(!User || User.error) return error(13);
                let user;

                switch(shift()){
                    case "create_profile":
                        if(typeof req.body !== "object" || !req.body.displayname){
                            return error(2)
                        }

                        let row = await mazeDatabase.table("profiles").has("link", User.id);

                        if(row.err) return error(row.err);

                        if(row.result.length < 1) {
                            let thing = await mazeDatabase.table("profiles").insert({...req.body, ...{
                                link: User.id
                            }})

                            if(thing.err) return error(thing.err);

                            success()
                        } else {
                            error("Profile for this user was already created. Did you mean to use \"patch\"?")
                        }
                    break;

                    case "patch":
                        // ...
                    break;

                    case "profile":
                        user = shift();

                        if(user == "me" || user == "") user = User.id;
                        user = +user;

                        if(isNaN(user)) return error(2);

                        if(profileCache[user]) return send(profileCache[user]);
                        
                        let profile = await mazeDatabase.query(`SELECT displayname, avatar, banner, bio, status, colors, nsfw, bot FROM profiles WHERE link=?`, [user])

                        if(profile.err) return error(profile.err);
                        
                        if(profile.result.length < 1) return send({
                            created: false
                        })
                        
                        profile = profile.result[0];

                        profile.bot = !!profile.bot[0]
                        profile.nsfw = !!profile.nsfw[0]

                        profileCache[user] = profile
                        send(profile)
                    break;
                }
            break;

            case "chat":
                if(User.error) return error(13);
                let id = shift();

                switch(id){
                    default:
                        id = +id;
                        switch(shift()){
                            case "send":case "post":
                                if(typeof req.body !== "object" || !req.body.message || !id){
                                    return error(2)
                                }

                                let msg = {
                                    text: ""+req.body.message+"",
                                    mentions: Array.isArray(req.body.mentions) ? req.body.mentions.map(e=>+e).filter(e=>!isNaN(e)) : "[]",
                                    attachments: req.body.attachments || "[]",
                                    author: User.id,
                                    room: id,
                                    timestamp: Date.now()
                                }

                                r = await mazeDatabase.table("messages").insert(msg)
                                
                                if(!r.err){
                                    msg.id = r.result.insertId;

                                    for(let v of Object.values(clients)){
                                        if(v.listeners.message.includes(id)){
                                            v.write([
                                                eventList.get("message"),
                                                msg.author,
                                                msg.room,
                                                msg.id,
                                                msg.timestamp - globalTimeStart,
                                                msg.attachments.replace(/[\[\]]/g, ""),
                                                msg.mentions.replace(/[\[\]]/g, ""),
                                                msg.text
                                            ])
                                        }
                                    }

                                    send({id: msg.id});
                                } else {
                                    console.log(r.err);
                                    reply.asd = r.err
                                    return error(24)
                                }
                            break;

                            case "read":
                                if(!id){
                                    return error(2)
                                }

                                r = await mazeDatabase.query(`SELECT id, text, attachments, mentions, author, timestamp FROM messages WHERE room=? ORDER BY id DESC LIMIT ${(+req.query.limit) || 10} OFFSET ${(+req.query.offset) || 0}`[id])
                                
                                if(!r.err){
                                    send(r.result)
                                } else {
                                    return error(r.err)
                                }
                            break;

                            default:
                                if(!id){
                                    return error(2)
                                }
                                r = await mazeDatabase.query(`SELECT * FROM rooms wher id=? LIMIT 1`, [id])
                                if(!r.err){
                                    send(r.result[0])
                                } else {
                                    return error(24)
                                }
                        }
                    }
            break;
            case "create":
                if(User.error) return error(13);
                if(typeof req.body !== "object" || !req.body.name){
                    return error(2)
                }

                r = await mazeDatabase.table("rooms").insert({
                    author: User.id,
                    participants: req.body.participants ? JSON.stringify(req.body.participants) : "[]",
                    name: req.body.name,
                    icon: req.body.icon || "",
                    type: req.body.type || "dm",
                    data: req.body.data ? JSON.stringify(req.body.data) : "{}",
                    e2e: req.body.encryption ? 1 : 0,
                    burn: req.body.burn ? 1 : 0,
                })

                if(!r.err){
                    send(r.result.insertId)
                } else {
                    return error(24)
                }
            break;
            default:
                error(1)
        }
    },
    HandleSocket({getAuth, req, ws, send, message, shift}){
        with(Backend){
            switch(req.event){
                case 0:
                    clients[ws.uuid] = ws;

                    ws.alive = true;
                    ws.authorized = false;

                    ws.listeners = {
                        message: []
                    }

                    ws.queue = []

                    ws.write = (data) => {
                        ws.queue.push(data)
                    }

                    ws.queueInterval = setInterval(function sendQueue(){
                        if(ws.alive && ws.queue.length > 0){
                            ws.send(A2U8(...ws.queue));
                            ws.queue = []
                        }
                    }, 100)

                    ws.forget = (close = true) => {
                        if(!ws.alive) return;

                        if(close) ws.close()
                        ws.alive = false;
                        clearInterval(ws.queueInterval);
                        delete clients[ws.uuid];
                    }

                    setTimeout(()=>{
                        if(!ws.authorized) {
                            ws.forget()
                        }
                    }, 4000)
                break;
                case 1:
                    for(let data of U82A(message)){

                        if(!ws.authorized && data[0]!=="authorize") continue;

                        switch(data[0]){
                            case"heartbeat":
                                // Heartbeat
                                ws.alive = true;
                                ws.write([0])
                                continue;
                            break;

                            case"authorize":
                                let user = getAuth(data[1])

                                if(user.error) {
                                    ws.forget()
                                } else {
                                    ws.user = user
                                    ws.authorized = true
                                }
                            break;

                            case"message": break;

                            case"listen":
                                switch(data[2]){ //Event type
                                    case 0:
                                        // Message
                                        if(data[1]){
                                            if(!ws.listeners.message.includes(data[3])) {
                                                ws.listeners.message.push(data[3])
                                            }
                                        }else{
                                            ws.listeners.message[ws.listeners.message.indexOf(data[3])] = null
                                        }
                                    break;
                                }
                            break;
                        }
                    }
                break;
                case 2:
                    ws.forget(false)
                break;
            }
        }
    }
}

module.exports = API