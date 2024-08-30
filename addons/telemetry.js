
let sessions = [];

module.exports = {

    async HandleRequest({req, res, segments, error, shift}){
        switch(shift()){
            case "get":
                return res.send(sessions)
            break;

            case "session":
                if(req.method == "POST"){

                    req.parseBody((data, fail) => {
                        if(fail){
                            return error(fail)
                        }

                        try{
                            let _data = data.json;

                            if(_data) sessions.push(_data);
                        } catch {}

                        res.end()
                    }).data()

                } else res.end()
            break;
        }
    }

}