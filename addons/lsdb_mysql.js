


/*

    This is a WRAPPER (not an actual database) for MariaDB/MySQL, using LSDB-ish API.
    This is made to make transitioning simpler since LSDB is currently too early into development.

*/

// - .database(name) = opens or creates a database
//         - .table(name, ?structure) = opens or creates a table
//             .row(searchFunction | index) = Get row (default: first row)
//                 .get(...columns) = Reads values
//                 .set(column, value) = Sets value
//                 .patch(object) = Applies a patch of values to the row
//                 .delete() = Deletes the row
//                 .index = Gets the index in the DB
//             .rows(searchFunction) = Get rows (default: all rows)
//                 .get(...columns) = Returns an array of arrays
//                 .set(column, value) = Apply a change to all columns
//                 .patch(object) = Apply a patch of values to all rows
//                 .delete() = Delete the selected rows
//             .insert(...rows) = Inserts rows
//             .delete() = Deletes the table
//             .modify(structure) = Modifies the columns
//             .header = Returns the raw header
//             .increment = Gets the first free unique row number (includes deleted rows)
//             .length = Returns the total amount of rows
//             .fraglist() = Lists points where the table is fragmented (The less the better - 0 results is the best)
//         - .tables() = Returns an array tables (as in strings - table IDs)    

let lsdb, mysql = require("mysql2");

lsdb = {
    Server(host, user, password, defaultDB){
        return new ((_this => class MySQLDatabaseServer {
            constructor () {
                this.pool = mysql.createPool({
                    host, user, password,

                    waitForConnections: true,
                    connectionLimit: 15,
                    maxIdle: 10,
                    idleTimeout: 80000,
                    queueLimit: 0,
                    enableKeepAlive: true,
                    keepAliveInitialDelay: 0,
                    database: defaultDB || "extragon"
                })

                _this = this;
                _this.using = defaultDB || "extragon";

                this.version = "mysql"
            }

            database(dbName){
                let tools;

                function use(callback){
                    return // Temporary
                    // This is stupid.. And why I dont like MySQL

                    if(_this.using == dbName) return;

                    return new Promise(resolve=>{
                        _this.using = dbName
                        return _this.pool.query(`USE ${dbName};`, function(err, result){
                            // if(!err){
                            // }

                            if(callback) callback(err, result)
                            resolve({err, result})
                        })
                    })
                }

                tools = {
                    dbName,
                    use,

                    async query(query, data, callback){
                        await use();
                        return new Promise(resolve=>{
                            return _this.pool.query(`${query}`, data, function(err, result){
                                if(callback) callback(err, result)
                                resolve({err, result})
                            })
                        })
                    },
                    
                    table(tableName){
                        let tools;
                        
                        tools = {
                            tableName,

                            async has(column, data, callback){
                                await use();
                                return new Promise(resolve=>{
                                    return _this.pool.query(`SELECT 1 FROM ${tableName} WHERE ${column} = ? LIMIT 1;`, data, function(err, result){
                                        if(callback) callback(err, result)
                                        resolve({err, result})
                                    })
                                })
                            },

                            async insert(data, callback){
                                await use();
                                return new Promise(resolve=>{
                                    _this.pool.query(`INSERT INTO ${tableName} (${Object.keys(data).join(",")}) VALUES (${",?".repeat(Object.keys(data).length).substring(1)})`, Object.values(data), function(err, result){
                                        if(callback) callback(err, result)
                                        resolve({err, result})
                                    })
                                })
                            },

                            async update(selector = "*", data, callback){
                                await use();
                                return new Promise(resolve=>{
                                    _this.pool.query(`UPDATE ${tableName} SET ${Object.keys(data).map(key => key + "=?").join(",")} ${(selector == "?" || !selector)? "" : selector}`, Object.values(data), function(err, result){
                                        if(callback) callback(err, result)
                                        resolve({err, result})
                                    })
                                })
                            }
                        }

                        return tools
                    }
                }

                return tools;
            }
        })())
    }
}

module.exports = lsdb;