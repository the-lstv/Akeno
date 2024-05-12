let Backend;

module.exports = {
    Initialize(Backend_){
        Backend = Backend_;
    },
    async Aditional({service}){
        
    },
    async HandleRequest({action, service, req, res, segments, reply, error, success, assign, shift, send, message}){
        let type = service.info.type, id = service.info.type;
        switch(action){
            case"start":
                let data = await service.kdb.get() || {}
                Backend.dispatch("start", [id, type, "start", data.software || "-", data.port || "-", data.memory || "512"])
                send(true)
            break;
            case"status":
                send(
                    await Backend.dispatch("status", id)
                )
            break;
            case"running":
                send(
                    await Backend.dispatch("status.running", id)
                )
            break;
            case"stop":
                if(type=="minecraft"){
                    Backend.dispatch("stdin", [id, "stop\n"])
                    return send(true)
                }
                Backend.dispatch("kill", id)
                send(true)
            break;
            case"execute":
                if(!req.bodyRaw)return;
                Backend.dispatch("stdin", [id, ""+req.bodyRaw+"\n"])
                send(true)
            break;
            case"kill":
                Backend.dispatch("kill", id)
                send(true)
            break;
            default:
                return error(1)
        }
    },
    async create({type, order}){
        Backend.ask()
    }
}