// case"service":case"creations":case"services":case"list":case"creation":
// if(User.error)return error(13);
// if(!req.secured)return error(35);
// let id=shift();
// switch(id){
//     case"create":
//     break;
//     default:
//         id=+id;
//         if(!isNaN(id)||id==""){
//             let service, hasAccess, isOwned, action = shift(), details = req.query.hasOwnProperty("details"), backend, handle;
//             if(id){
//                 service = await Creation(id,true);
//                 isOwned = service.info.owner==User.id
//                 hasAccess = isOwned||service.info?.access?.find?.(o=>o.id==User.id)
//                 backend = service.info["backend-type"]
//                 handle = addon("driver-"+backend);
//             }
//             switch(action){
//                 case"":case"info":
//                     let filter=["id", "name", "type", "ip", "status", "reason", "owner", "isLegacy"];
//                     if(details)filter.push("access", "creation_date", "apiKeys", "details", "ownerName");
//                     if(id){
//                         let reply = {success:false};
//                         if(!service||service.error||!service.info){
//                             error(16)
//                             if(service.error)reply.error=service.error;
//                             return;
//                         }else{
//                             let data = service.infoFilter(filter,true);
//                             if(hasAccess){
//                                 reply.data = data;
//                                 reply.success = true;
//                                 if(details&&handle&&handle.Aditional)reply.service=await handle.Aditional({service});
//                             }else{
//                                 return error(5)
//                             }
//                         }
//                         return send(reply)
//                     }else{
//                         await new Promise(resolve=>{
//                             sql.query(
//                                 `SELECT id FROM creations WHERE ${id?"id=? LIMIT 1 OFFSET 0":"managers LIKE ? OR owner = ? LIMIT ? OFFSET ?"}`,
//                                 [...(id?[+id]:['%"'+User.name.replace(/['"]/g,"")+'"%',User.name]),+req.query.limit||100,+req.query.offset||0],
//                                 async function(err, results) {
//                                     if(!err){
//                                         let reply={success:false};
//                                         reply.data = (await CreationBulk(results.map(e=>e.id),true))?.map?.(e=>e?e.infoFilter(filter,true):null).filter(e=>e);
//                                         if(reply.data)reply.success=true;
//                                         return send(reply);
//                                     }else{
//                                         reply.err=err
//                                         reply.auth_=User.name
//                                         error(24)
//                                     }
//                                     resolve()
//                                 }
//                             )
//                         })
//                     }
//                 break;
//                 default:
//                     if(!handle)return error(42);
//                     await handle.HandleRequest({service, action, req, res, segments, reply, error, success, shift, send, message})
//                 break;
//             }
//         }else{
//             error(1)
//         }
//     break;
// }
// break;