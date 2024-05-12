let url = "https://backend.panel.bytehosting.cloud/v1/", Backend;

async function api(endpoint, auth, method = "GET", body){
    try{
        return await(await fetch(url+endpoint+"?token="+auth)).json()
    }catch(e){
        return{error:e}
    }
}

let translation = {
    backups: "backup",
    software: "os"
}

module.exports = {
    Initialize(Backend_){
        Backend = Backend_;
    },
    async Aditional({service}){
        let token=service.info["special-key"],id=service.info["special-identifier"];
        let data = await api(`service/${id}`,token), result={};
        if(!data.error){
            for(const key in data.product){
                if(data.product.hasOwnProperty(key)){
                    if(['cores','disk','ostype','port','password','status','user','uplink','backupslots','mac','memory'].includes(key))result[key]=data.product[key]
                }
            }
            for(const key in data.service){
                if(data.service.hasOwnProperty(key)){
                    if(['expire_at'].includes(key))result[key]=data.service[key]
                }
            }
        }
        return result
    },
    async HandleRequest({action, service, req, res, segments, reply, error, success, assign, shift, send, message}){
        let token=service.info["special-key"],id=service.info["special-identifier"];
        console.log(action);
        switch(action){
            case"list":
                send(await api(`service/${action}`,token))
            break;
            case"status":case"software":case"ip":case"cron":case"backups":case"cron":case"traffic":
                send(await api(`service/${id}/${translation[action]||action}`,token))
            break;
            case'start':
                calc()
            break;
            default:
                return error(1)
        }
    }
}