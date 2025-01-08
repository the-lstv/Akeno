#! /bin/node
/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2024
    License: GPL-3.0
    Version: 1.0.0
    Description: Command line interface for Akeno
*/


const
    minimist = require('minimist'),
    argv = minimist(process.argv.slice(2)),

    exec = require("child_process").execSync,
    execAsync = require("child_process").exec,
    spawn = require("child_process").spawn,

    nodePath = require("path"),

    fs = require("fs-extra"),

    // Local libraries
    { parse, stringify, configTools, merge } = require("./parser"),
    { ipc_client } = require("./ipc"),

    // path = require('path'),
    // axios = require('axios'),

    socketPath = '/tmp/akeno.backend.sock',
    
    client = new ipc_client(socketPath)
;



let logo = argv["no-ascii"]? "" : (gradient(`\x1b[1m
     _    _
    / \\  | | _____ _ __   ___
   / _ \\ | |/ / _ \\ '_ \\ / _ \\
  / ___ \\|   <  __/ | | | (_) |
 /_/   \\_\\_|\\_\\___|_| |_|\\___/
`) + "\x1b[0m\n"),
    signature = "\x1b[95m[akeno]\x1b[0m"
;

if(process.argv.length < 3 || argv.h || argv.help || argv._[0] === "help" || argv._[0] === "h" || argv._[0] === "?" || argv._[0] === "/?"){
    log(logo + box(`Global options:
    \x1b[1m--json                      \x1b[90m│\x1b[0m  Preffer JSON output (where supported)
    \x1b[1m--no-ascii                  \x1b[90m│\x1b[0m  Disable the Akeno ASCII art
    \x1b[1m--no-boxes                  \x1b[90m│\x1b[0m  Disable all borders/boxes from the output
    \x1b[1m--no-color                  \x1b[90m│\x1b[0m  Disable all colouring from the output
    \x1b[1m--silent | -s               \x1b[90m│\x1b[0m  Disable all output (excluding errors)
---
Base commands list:
    \x1b[1mhelp | --help | -h          \x1b[90m│\x1b[0m  Display command help
    \x1b[1minfo | status | --info | -i \x1b[90m│\x1b[0m  Display some current information about the server and its status
    \x1b[1mstart                       \x1b[90m│\x1b[0m  Start the server (without a PM)
    \x1b[1mreload [app]                \x1b[90m│\x1b[0m  Hot-reload the server configuration
    \x1b[1mrestart                     \x1b[90m│\x1b[0m  Restart the server (requires PM2)
        \x1b[90m⤷\x1b[0m --logs                \x1b[90m│\x1b[0m  Display logs while loading the server
    \x1b[1mlogs [filter]               \x1b[90m│\x1b[0m  View server logs (requires PM2)
  \x1b[93m•\x1b[0m \x1b[1mparse-config <file>         \x1b[90m│\x1b[0m  Parse a config file and return it as JSON. Defaults to the main config.
        \x1b[90m⤷\x1b[0m -t | --text [text]    \x1b[90m│\x1b[0m  Parse from text input instead of a file
        \x1b[90m⤷\x1b[0m -p                    \x1b[90m│\x1b[0m  Prettify JSON output
        \x1b[90m⤷\x1b[0m --stringify           \x1b[90m│\x1b[0m  Return stringified (converted back to a readable syntax)
---
Web applications (websites) / Modules:
  \x1b[93m•\x1b[0m \x1b[1mlist | ls                          \x1b[90m│\x1b[0m  List web applications
    \x1b[1mcreate | init [path]               \x1b[90m│\x1b[0m  Setup a new application template in the current or specified directory.
        \x1b[90m⤷\x1b[0m -n [name]                    \x1b[90m│\x1b[0m  Application name
        \x1b[90m⤷\x1b[0m -c [config]                  \x1b[90m│\x1b[0m  Configuration options
        \x1b[90m⤷\x1b[0m -f                           \x1b[90m│\x1b[0m  Force creation even if the directory is not empty
    \x1b[1menable [app]                       \x1b[90m│\x1b[0m  Enable a web application
    \x1b[1mdisable [app]                      \x1b[90m│\x1b[0m  Disable a web application
    \x1b[1mtemp-hostname [app]                \x1b[90m│\x1b[0m  Generate a temporary hostname for an app
    \x1b[1mbundle <source> [target path]      \x1b[90m│\x1b[0m  Bundle a web application for offline use
---
Auth addon:
  \x1b[93m•\x1b[0m \x1b[1mauth login [name] [password]       \x1b[90m│\x1b[0m  Attempt login and return token
  \x1b[93m•\x1b[0m \x1b[1mauth verify [token]                \x1b[90m│\x1b[0m  Verify login token
  \x1b[93m•\x1b[0m \x1b[1mauth create [name] <{options}>     \x1b[90m│\x1b[0m  Verify login token
  \x1b[93m•\x1b[0m \x1b[1mauth list <offset> <limit>         \x1b[90m│\x1b[0m  List users
  \x1b[93m•\x1b[0m \x1b[1mauth detail [name|token]           \x1b[90m│\x1b[0m  List details about an user
    \x1b[1mauth patch [name|token] [{patch}]  \x1b[90m│\x1b[0m  Apply a patch to an user object
    \x1b[1mauth status [status]               \x1b[90m│\x1b[0m  Get/Set account status (ok, disabled, ...)
    \x1b[1mauth delete [name|token]           \x1b[90m│\x1b[0m  Delete an account
        \x1b[90m⤷\x1b[0m -f                           \x1b[90m│\x1b[0m  Skip confirmation
---
\x1b[93m•\x1b[0m = Supports JSON output`))
    process.exit()
}

else if(argv.i || argv.info || argv._[0] === "info" || argv._[0] === "status"){
    client.request(["usage", "cpu"], (error, response) => {
        if(error){
            if(error.code === "ECONNREFUSED") {
                return client.close() && log_error(`${signature} Can't get status: Akeno is not running! Make sure you have started it either with a process manager, or the "akeno start" command.`)
            }

            return client.close() && log_error(`${signature} Couln't get information! Error:`, error)
        }

        const mem_total = response.mem.heapTotal
        const mem_used = response.mem.heapUsed
    
        log(logo + box(`You are running the Akeno backend - an open source, fast, modern and fully automated
web application, API and content delivery management system / server!

\x1b[95mCreated with <3 by \x1b[1mTheLSTV\x1b[0m\x1b[95m (https://lstv.test).\x1b[0m

Version: ${response.version}
Server is ${response.server_enabled? `\x1b[32monline\x1b[0m for \x1b[36m\x1b[1m${formatUptime(response.uptime)}\x1b[0m`: "\x1b[31moffline\x1b[0m"}
${response.server_enabled?`Running in \x1b[36m\x1b[1m${response.isDev? "development": "production"}\x1b[0m environment.
---
Currently using \x1b[36m\x1b[1m${(mem_used / 1000000).toFixed(2)} MB\x1b[0m RAM out of a \x1b[36m\x1b[1m${(mem_total / 1000000).toFixed(2)} MB\x1b[0m heap and \x1b[36m\x1b[1m${response.cpu.usage.toFixed(4)}%\x1b[0m CPU.` : ''}
---
Some examples:
    akeno\x1b[1m reload              \x1b[90m│\x1b[0m  Hot-reload the API server without downtime
    akeno\x1b[1m logs                \x1b[90m│\x1b[0m  Show (and stream) logs
    akeno\x1b[1m disable <id>        \x1b[90m│\x1b[0m  Disable an application
    ...
    
---
    \x1b[92m•\x1b[0m \x1b[1mTry "akeno --help" for explanation of all commands!\x1b[0m`));
        process.exit()
    })
} else resolve(argv)



const COMMAND_PATH = "/www/cmd/bin/"


async function resolve(argv){

    let childProcess;

    switch(argv._[0]) {
        case "reload":
            const singular = typeof argv._[1] === "string";

            log(`${signature} Hot-reloading web ${(singular? `application "${argv._[1]}"`: "server")}...`);

            client.request(["web.reload", (singular && argv._[1]) || null], (error, success) => {
                client.close()

                if(error || !success){
                    return log_error(`${signature} Could not reload:`, (error && error) || "Invalid application")
                }

                log(`${signature} Sucessfully reloaded!`);
            })

        break;

        case "restart":
            if(argv.logs){
                await resolve({_: ["logs"]}) // This is a bit of a hack, but it works
            }

            exec("pm2 reload Akeno")
            log(`${signature} API Server sucessfully reloaded.`)

        break;


        case "list": case "ls":
            client.request(["web.list"], (error, response) => {
                client.close()

                if(error){
                    return log_error(`${signature} Could not list applications:`, error)
                }

                if(argv.json){
                    return log(response)
                }
                
                return log(box(response.map(app => `\x1b[93m\x1b[1m${app.basename}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}\n\n\x1b[1mDomains:\x1b[0m\n${app.domains.join("\n")}`).join("\n---\n")))
            })

        break;


        case "parse-config": case "parse":
            let input = argv.t || argv.text;

            if(typeof input !== "string"){
                if(!fs.existsSync(argv._[1])) return log_error(`${signature} Could not find file "${argv._[1]}"`);
                input = fs.readFileSync(argv._[1], "utf8")
            }

            if(typeof input !== "string") return log_error(`${signature} No input provided"`);

            data = parse(input, !argv.d);

            if(argv.stringify) data = stringify(data); else if(argv.p) data = JSON.stringify(data, null, 4); else data = JSON.stringify(data);

            return log(data)


        case "enable":
            client.request(["web.enable", argv._[1]], (error, response) => {
                client.close()

                if(response){
                    log(`${signature} Sucessfully enabled app!`)
                } else log_error(`${signature} Couldnt enable app (it either doesnt exist or Akeno is not running).`)
            })
            break;


        case "disable":
            client.request(["web.disable", argv._[1]], (error, response) => {
                client.close()

                if(response){
                    log(`${signature} Sucessfully disabled app!`)
                } else log_error(`${signature} Couldnt disable app (it either doesnt exist or Akeno is not running).`)
            })
            break;


        case "temp-hostname":
            client.request(["web.tempDomain", argv._[1]], (error, response) => {
                client.close()
                log(response)
            })
            break;


        case "create": case "init":
            return (()=>{
                let path = nodePath.resolve(process.env["PWD"], argv._[1] || "");

                log(`${signature} Creating a new web application at "${path}"`)

                // Check if the directory is empty
                if(fs.existsSync(path) && fs.readdirSync(path).length > 0){
                    if(fs.existsSync(path + "/app.conf") && !argv.f){
                        return log_error(`${signature} Warning: "${path}/app.conf" already exists and is an application directory! If you wish to proceed anyway (will overwrite the file!), add the -f option. Creating was aborted.`)
                    }

                    if(!argv.f) return log_error(`${signature} Warning: "${path}" is not empty! If you wish to proceed anyway, add the -f flag. Creating was aborted.`)
                }

                fs.createFileSync(path + "/app.conf")
                fs.createFileSync(path + "/index.html")
            })()

        // case "bundle":
        //     thing = await(await fetch(api + "/list")).json();

        //     let app, path = argv._[2] || process.env["PWD"];

        //     if(argv._[1] && argv._[1].includes("/")){
        //         if(fs.existsSync(argv._[1])) app = argv._[1]
        //     } else if(argv._[1]) {
        //         app = thing.find(thing => thing.basename == argv._[1]).path
        //     }

        //     if(!app){
        //         return log(`${signature} App "${argv._[1]}" not found`)
        //     }

        //     log(`${signature} Preparing to bundle app "${app}" into ${path}...`)

        //     async function getDomain(file = "/"){

        //         /*
        //             What does this do?
        //             This generates a random hostname on-demand that the server will accept as a valid domain for this application, when provided in the host header.
        //             This allows the web scrape script to reach the app, even if it has no domains attached or is not available globally.
        //         */

        //         return await(await fetch(`${api}/temporaryDomain?app=${app}`)).text()
        //     }

        //     domain = await getDomain();

        //     let scraper = (await import('/www/node/shared_modules/node_modules/website-scraper/index.mjs')).default,
        //         random = "akeno-temp-bundle-" + (Math.random() * 1000).toString(16) // Why? Because the scraper throws an error if the directory already exists for some reason
        //     ;

        //     log(`${signature} Fetching data to a temporary directory ("${"/tmp/" + random}")`)

        //     // This module is a pain to work with, but it works..
        //     await scraper({
        //         urls: [`http://0.0.0.0`],
        //         directory: "/tmp/" + random,

        //         plugins: [
        //             new class {
        //                 apply(register){
        //                     register("beforeRequest", async ({resource, requestOptions}) => {
        //                         let url = resource.getUrl();

        //                         log(`${signature} Fetching ${url}`)

        //                         return {
        //                             requestOptions: {
        //                                 ...requestOptions,
        //                                 headers: url.includes("0.0.0.0")? {
        //                                     host: domain
        //                                 }: {}
        //                             }
        //                         }
        //                     })
        //                     register("error", async ({error}) => {
        //                         log(`${signature} Error ${error}`)
        //                     })
        //                     register("onResourceError", async ({error}) => {
        //                         log(`${signature} Error ${error}`)
        //                     })
        //                 }
        //             }
        //         ]
        //     })

        //     log(`${signature} Moving data.`)
            
        //     fs.moveSync("/tmp/" + random, path, { overwrite: true });
            
        //     log(`${signature} \x1b[32mSUCCESS!\x1b[0m Bundle has been created.`)
        // break;

        case "logs":
            if(argv._[1]) log(`${signature} Showing only lines including "${argv._[1]}"`);

            childProcess = spawn('pm2 logs Akeno', {
                shell: true,
                env: {
                    ...process.env,
                    FORCE_COLOR: "1"
                }
            });

            childProcess.stdout.on('data', (buffer) => {
                if(!buffer) return;
                let data = buffer.toString();

                log(data.split("\n").map(line => line.replace(/\d+\|[^|]*\|/, "█ ").trim()).filter(thing => {
                    if(argv._[1] && !thing.includes(argv._[1])) return;

                    return thing
                }).join("\n"))
            });

            childProcess.stderr.on('data', (buffer) => {
                process.stderr.write(buffer)
            });
        break;

        case "start":
            log(`${signature} Launching Akeno (without a package manager).`);
            
            childProcess = spawn('node ' + (argv.inspect? "--inspect " : "") + __dirname + '/../app', {
                shell: true,
                env: {
                    ...process.env
                }
            })

            childProcess.stdout.on('data', (buffer) => {
                if(!buffer) return;
                process.stdout.write(buffer)
            });

            childProcess.stderr.on('data', (buffer) => {
                process.stderr.write(buffer)
            });
        break;


        // DO NOT USE THIS COMMAND :D
        // It is here just for backwards compatibility with my old system, and this part is still relied on.
        case "renew-cert":
            if(!argv._[1] || argv._[1].length < 1 || !argv._[1].includes(".")){
                return log(`${signature} \x1b[31mDomain "${argv._[1]}" seems to be invalid.\x1b[0m`)
            }

            domain = argv._[1];

            let configPath = "/www/server/config/server.json";

            // NOTE: VERY SPECIFIC TEMPORARY FIX!!!!
            if(domain == "upedie.online") configPath = "/www/content/shared/wss/server.jsonc";

            let dns = require("node:dns");

            let
                config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m))
            ;

            function TXT(domain){
                return new Promise(complete => dns.resolveTxt(domain, (err, records) => {
                    if (err) {
                        log(`DNS query failed: ${err}`);
                    }

                    complete(records || [])
                }))
            }

            function renew(domain){
                log(`\n${signature} Starting the renewal of ${domain}`)

                let bot = spawn("certbot", ["certonly", "--manual", "--preferred-challenges", "dns", "--force-renewal", "-d", domain, "-d", "*." + domain])

                let records = [], working = false;

                bot.stdout.on('data', (data) => {

                    data = data.toString()
                    // log(data);

                    if(working) return;

                    if(data.includes("Successfully received certificate.")){
                        log("Reloading...");
                        execAsync(COMMAND_PATH + "reload", async (error, stdout, stderr) => {
                            
                            if (error) {
                                console.error(`Error reloading server: ${error.message}`);
                                return;
                            }
                            
                            console.log(`${signature} \x1b[32mSuccessfully updated the certificate for ${domain}!\x1b[0m`);

                        })
                        return
                    }

                    let record = data.match(/value:(.*?)\s\s(.*?)\s/s), isDone = data.includes("verify the TXT record has been deployed");

                    if (record && record[2]) {
                        record = record[2].trim();
                        console.log("Setting a TXT record \""+ record +"\"");
                        records.push(record);
                        if(!isDone) bot.stdin.write('\n');
                    }

                    if(isDone){
                        working = true;
                        console.log("Updating server config")

                        if(!config.DNS) config.DNS = {};
                        if(!config.DNS[domain]) config.DNS[domain] = {};
                        if(!config.DNS[domain].records) config.DNS[domain].records = [];

                        config.DNS[domain].records =  config.DNS[domain].records.filter(e => !e.includes("_acme-challenge"));
                        for(let r of records){
                            config.DNS[domain].records.push("_acme-challenge IN TXT " + r);
                        }

                        fs.writeFileSync(configPath, JSON.stringify(config, null, 4))
                        execAsync(COMMAND_PATH + "reload", async (error, stdout, stderr) => {
                            // console.log(stdout);

                            if (error) {
                                console.error(`Error reloading server: ${error.message}`);
                                return;
                            }

                            if(stderr) console.error(`Server reload errors: ${stderr}`);

                            await sleep(5000);
                            let complete = true;

                            while(complete){
                                log("Fetching DNS records")

                                let currentRecords = await TXT("_acme-challenge." + domain)

                                if(currentRecords.find((a)=> a[0] == records[0]) && currentRecords.find((a)=> a[0] == records[1])){
                                    complete = false;
                                    console.log("Found the records! Preparing..")
                                    await sleep(4000)
                                    working = false;
                                    bot.stdin.write('\n');
                                } else {
                                    console.log("Records not updated yet. Waiting.")
                                    await sleep(3000)
                                }
                            }

                        })
                    }

                });
            }

            renew(domain)
        break;
    
        default:
            console.error(signature + " Unknown command \"" + argv._[0] + "\". Type 'akeno -h' for help.")
    }
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

function data_to_log(data){
    return data.map(thing => typeof thing == "string"? argv["no-color"]? thing.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '') : thing : thing)
}

function log(...data){
    if(argv.silent || argv.s) return;
    console.log(...data_to_log(data))
}

function log_error(...data){
    console.error(...data_to_log(data))
}

// function getHits(){
//     return fs.existsSync(PATH + "/etc/hits") ? fs.readFileSync(PATH + "./etc/hits").readUInt32LE(0) : 0
// }

function gradient(text) {
    let gradientColors = [],
        lines = text.split('\n'),
        steps = lines.length,
        start = 196, // Red
        end = 204, // Orange
        step = (end - start) / steps;
    ;

    for (let i = 0; i < steps; i++) {
        const color = start + Math.round(step * i);
        gradientColors.push(`\x1b[38;5;${color}m`);
    }

    let gradientText = "", i = -1;

    for (let line of lines) {
        i++
        gradientText += gradientColors[i] + line + "\n";
    }

    gradientText += "\x1b[0m";

    return gradientText;
}

function box(text, padding = 1, margin = 0, color = "90") {
    // Super messy code but does what it should

    if(argv["no-boxes"]) return text;

    let lines = text.split('\n'),
        lengths = lines.map(str => str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').length),
        width = lengths.reduce((maxLength, length) => Math.max(maxLength, length), 0),
        outerWidth = width + (padding * 2),
        fullWidth = outerWidth + (margin * 2),
        result = ""
    ;

    color = `\x1b[${color}m`

    result += (" ".repeat(fullWidth) + "\n").repeat(margin)
    result += " ".repeat(margin) + color + "┌" + ("─".repeat(outerWidth)) + "┐\x1b[0m" + " ".repeat(margin) + "\n"
    // result += (" ".repeat(margin) + color + "│\x1b[0m" + " ".repeat(padding) + (" ".repeat(width)) + " ".repeat(padding) + color + "│\x1b[0m" + " ".repeat(margin) + "\n").repeat(padding)
    
    for(let i = 0; i < lines.length; i++){
        if(lines[i] == "---"){
            result += " ".repeat(margin) + color + "├" + ("─".repeat(outerWidth)) + "┤\x1b[0m" + " ".repeat(margin) + "\n"
        }else{
            result += (" ".repeat(margin) + color + "│\x1b[0m" + " ".repeat(padding) + lines[i] + (" ".repeat(width - lengths[i])) + " ".repeat(padding) + color + "│\x1b[0m" + " ".repeat(margin) + "\n").repeat(padding)
        }
    }

    // result += (" ".repeat(margin) + color + "│\x1b[0m" + " ".repeat(padding) + (" ".repeat(width)) + " ".repeat(padding) + color + "│\x1b[0m" + " ".repeat(margin) + "\n").repeat(padding)
    result += " ".repeat(margin) + color + "└" + ("─".repeat(outerWidth)) + "┘\x1b[0m" + " ".repeat(margin) + "\n"
    result += (" ".repeat(fullWidth) + "\n").repeat(margin)

    return result
}