let flags = {wake: false}, text = "", responseText = "";

module.exports = {

    async HandleRequest({req, res, segments, error, shift}){
        switch(shift()){
            case "get":
                res.send(JSON.stringify(flags))
                flags = {wake: false, command_done: !!flags.command_done};
            break;
            case "flags":
                res.send(JSON.stringify(flags))
            break;
            case "text":
                if(req.method == "POST"){
                    req.parseBody((data, fail) => {
                        if(fail){
                            return error(fail)
                        }

                        text = data.data
                    }).data()
                } else {
                    res.send(text)
                }
            break;
            case "response":
                if(req.method == "POST"){
                    req.parseBody((data, fail) => {
                        if(fail){
                            return error(fail)
                        }

                        responseText = data.data
                    }).data()
                } else {
                    flags.command_done = false
                    res.send(responseText)
                    responseText = ""
                }
            break;
            case "flag":
                let flag = shift(), value = shift();
                console.log(flag, value);
                flags[flag] = value == "true"? true : value == "false"? false : false;
                res.end()
            break;
            default:
                error(1)
            break;
        }
    }

}