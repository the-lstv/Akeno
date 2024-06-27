let Backend, flags = {wake: false}, text = "", responseText = "";

module.exports = {
    Initialize(Backend_){
        Backend = Backend_;
    },
    async HandleRequest({req, res, segments, error, shift}){
        switch(shift()){
            case "get":
                res.send(flags)
                flags = {wake: false, command_done: !!flags.command_done};
            break;
            case "flags":
                res.send(flags)
            break;
            case "text":
                if(req.method == "POST"){
                    text = req.body
                } else {
                    send(text)
                }
            break;
            case "response":
                if(req.method == "POST"){
                    responseText = req.body
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
            break;
            default:
                error(1)
            break;
        }
    }
}