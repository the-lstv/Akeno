
let sessions = {}, fs = require("fs"), path = "/www/content/akeno/addons/data/", sessionIndex = 0;

if(fs.existsSync(path + "/telemetry.json")){
    try {
        sessions = JSON.parse(fs.readFileSync(path + "/telemetry.json", "utf8"))
        
        sessionIndex = Object.keys(sessions).length
    } catch {}
} else fs.writeFile(path + "/telemetry.json", "{}", () => {})

let sessionSet = new Set(Object.keys(sessions))

module.exports = {

    async HandleRequest({req, res, segments, error, shift}){
        switch(shift()){
            case "get":
                return res.send(sessions)
            break;

            case "save":
                fs.writeFile(path + "/telemetry.json", JSON.stringify(sessions), () => {})
                res.end()
            break;

            case "session":
                if(req.method == "POST"){

                    req.parseBody((data, fail) => {
                        if(fail){
                            return error(fail)
                        }

                        try{
                            let _data = data.json;

                            if(_data && _data.id) {
                                _data.end = Date.now()

                                if(!sessionSet.has(_data.id)){
                                    sessionSet.add(_data.id)
                                    sessionIndex++
                                }
                                
                                _data.index = sessions[_data.id]? sessions[_data.id].index: sessionIndex
                                _data.ip = `${new Uint8Array(res.getRemoteAddress())}`.replaceAll(",", ".").replace("0.0.0.0.0.0.0.0.0.0.255.255.", "")

                                _data.pings = sessions[_data.id]? sessions[_data.id].pings +1: 0
                                sessions[_data.id] = _data
                            }
                        } catch {}

                        res.end()
                    }).data()

                } else res.end()
            break;
        }
    }

}