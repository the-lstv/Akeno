
let sessions = [];

module.exports = {

    async HandleRequest({req, res, segments, error, shift}){
        switch(shift()){
            case "get":
                return res.send(JSON.stringify(sessions))
            break;

            case "session":
                if(req.method == "POST"){

                    req.parseBody((data, fail) => {
                        if(fail){
                            return error(fail)
                        }

                        sessions.push(data.data)
                    }).data()

                } else res.end()
            break;
        }
    }

}