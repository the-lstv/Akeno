
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
                                if(!sessionSet.has(_data.id)){
                                    _data.index = sessionIndex
                                    sessionIndex++
                                }

                                sessionSet.add(_data.id)
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