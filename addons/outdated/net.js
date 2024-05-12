var API, Backend, SQL, sql, sleep= (ms) => new Promise(r => setTimeout(r, ms));

let TLDList = ["free","com","net","cloud","ws","sh","ls","eu","app","tunnel","js","vista","dot","tunnel","us","arpa","tp","tv","proxy","time","place","help","win","ml","cf","ga","paint","ai","art","rent","monster","get","store","shop","y"];

API = {
    Initialize(Backend_){
        Backend = Backend_;
        SQL = Backend.SQLTool("net", true);
        sql = SQL.connection;
    },
    async HandleRequest({req, res, segments, reply, error, success, assign, shift, send, message}){
        res.wait = true;
        if(!sql){
            await sleep(20);
            if(!sql)return send({error:"Failed connecting to the database."})
        }
        let domain;
        switch(shift()){
            case"check":
                send(await API.checkDomain(shift()))
            break;
            case"checkBulk":
                let result={},_domain=shift();
                for(const tld of TLDList){
                   result[tld]= await API.checkDomain(_domain+"."+tld)
                }
                send(result)
            break;
            case"register":
                if(typeof req.body!=="object"||!req.body.domain||!req.body.owner){
                    error(2)
                    return send()
                }
                let data = Object.assign({
                    expiry: 1
                },req.body);
                domain = API.fixDomain(data.domain);
                if(!domain||!API.validateDomain(domain))return send({error:"Invalid domain."});
                API.checkDomain(domain,available=>{
                    if(!available)return send({error:"This domain name is not available. Maybe someone took it?"});
                    sql.query(
                        `INSERT INTO domains (name, owner, created, expiry) VALUES (?, ?, ?, ?)`,
                        [domain, data.owner, Date.now()-1000000000000, data.expiry],
                        function(err, data){
                            if(err){
                                return send({error:err})
                            }
                            success();
                            send();
                        }
                    )
                })
            break;
            case"whois":
                domain = API.fixDomain(shift());
                if(!domain||!API.validateDomain(domain))return send({error:"Invalid domain."});
                sql.query(
                    'SELECT owner, expiry, trust, created FROM domains WHERE name=?',
                    [domain],
                    function(err,result){
                        if(err||result.length<1){
                            return send({error:"Domain \""+domain+"\" was not found in the database."});
                        }
                        result=result[0];
                        let reg=result.created+1000000000000;
                        let exp=result.created+1000000000000+(result.expiry*31556952000);
                        res.send(`== LSTV NET WHOIS DATA ==

Use of this data for illegal or spam purposes is strictly prohibited.

Domain name: ${domain}
Registered to: ${result.owner}

Registered: ${new Date(reg)}
Expires: ${new Date(exp)}

Registered (UNIX): ${reg}
Expires (UNIX): ${exp}

Total registration period (years): ${result.expiry}
(The above contains the years elapsed of the domain's lifetime, and also the future years of registration).

Trust level: ${result.trust}
(0-1 = Issued by a trusted authority, 2 = Issued by a verified identity, 3 = Normal user registration, 4 = Unknown/Anonymous identity)
== END ==`)
                    }
                )
            break;
        }
    },
    fixDomain(domain, noSubdomains = true){
        domain.replace(/\.\.\./,'.').replace(/\.\./,'.').replace(/^(https?:\/\/)?/,'').replace(/\/.*/,'')
        if(noSubdomains){
            let rsd = domain.match(/^(?:https?:\/\/)?(?:[\w-]+\.)+([\w-]+\.[a-z]{2,})(?:\/.*)?$/)
            if(rsd)domain=rsd[1];
        }
        return domain
    },
    validateDomain(domain){
        return (/^(?!-)[A-Za-z0-9-]+([\-\.]{1}[a-z0-9]+)*\.[A-Za-z]{1,8}$/.test(domain))
    },
    checkDomain(domain, cb){
        return new Promise(r=>{
            if(!API.validateDomain(API.fixDomain(domain))){if(cb)cb(false);r(false)};
            sql.query(
                SQL.exists("domains", "name"),
                [domain],
                function(err, result){
                    let a= result.length==0;
                    if(cb)cb(a)
                    r(a)
                }
            )
        })
    }
}

module.exports=API