
// case"economy": case"eco": case"pocket":
// if(!req.secured)return error(35);
// switch(shift()){
//     case"balance":
//         User=getAuth(req)
//         if(User.error)return error(13);
//         await new Promise( resolve => {
//             sql.query(
//                 'SELECT `credits-free`, `credits-paid` FROM `users` WHERE `username` = ?',
//                 [User.name],
//                 async function(err, results) {
//                     if(!err&&results[0]&&results[0]["credits-free"]){
//                         send({
//                             free: +results[0]["credits-free"],
//                             paid: +results[0]["credits-paid"],
//                             total: (+results[0]["credits-free"])+(+results[0]["credits-paid"])
//                         })
//                         success()
//                     }else{
//                         reply.err = err
//                         // reply.auth_ = User.name
//                         error(6)
//                     }
//                     resolve()
//                 }
//             )
//         })
//     break;

//     case"transaction":
//         //TODO: Transaction API
//     break;

//     case"": case"price":
//         with(Economy){
//             send({ CV, CV_CZK, CV_EUR, CV_USD })
//         }
//     break;
// }
// break;