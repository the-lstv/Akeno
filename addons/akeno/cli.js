#! /bin/node


// Libraries
let exec = require("child_process").execSync,
    execAsync = require("child_process").exec,
    spawn = require("child_process").spawn,

    fs = require("fs-extra"),

    // Local libraries
    { parse } = require("./parse-config"),

    path = require('path'),
    axios = require('axios'),
    cheerio = require('cheerio')
;


let version = "0", //TODO: Get this from the config
    PATH = "/www/content/akeno/",
    COMMAND_PATH = "/www/cmd/bin/",
    info = "",
    infoLines = []
;

// Utilities

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...data){
    if(!process.argv.includes("--silent") && !process.argv.includes("-s")) console.log(...data.map(thing => typeof thing == "string"? process.argv.includes("--no-color")? thing.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '') : thing : thing))
}

function grep(search){
    return infoLines.find(thing => thing.toLowerCase().includes(search.toLowerCase()))
}

function grep_value(search){
    let found = (grep(search) || "").match(/│(.*?)│(.*?)│/);
    
    return found? found[2].trim() : ""
}

function getInfo(){
    info = exec("pm2 info egapi").toString()
    infoLines = info.split("\n")
}

function getHits(){
    return fs.existsSync(PATH + "/etc/hits") ? fs.readFileSync(PATH + "./etc/hits").readUInt32LE(0) : 0
}

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

    if(process.argv.includes("--no-boxes")) return text;

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

let logo = 
process.argv.includes("--no-ascii")? "" : (gradient(`\x1b[1m
     _    _
    / \\  | | _____ _ __   ___
   / _ \\ | |/ / _ \\ '_ \\ / _ \\
  / ___ \\|   <  __/ | | | (_) |
 /_/   \\_\\_|\\_\\___|_| |_|\\___/
`) + "\x1b[0m\n"),
    signature = "\x1b[95m[akeno]\x1b[0m"
;


if(process.argv.includes("-h") || process.argv.includes("--help") || process.argv.includes("help") || process.argv.length < 3){
    try {
        getInfo();
    } catch {
        console.error("[Akeno] [Error] Could not fetch information about the backend. Are you sure that you are running the API server via PM2? Make sure that you are logged in on the same user as where the API was started, try running with sudo or try to set-up the server with pm2-make if your environment has this.\n\n\x1b[31m! If you have not yet set-up the server, this is an expected error !\x1b[0m\nInstall NodeJS and PM2 on your system, then run the api with \x1b[1m\"pm2 start app.js --name egapi\"\x1b[0m from the root directory of the API.\nAfter that try running this again.");
        process.exit(2)
    }

    log(logo + box(`Global options:
    \x1b[1m--json                      \x1b[90m│\x1b[0m  Preffer JSON output (where supported)
    \x1b[1m--no-ascii                  \x1b[90m│\x1b[0m  Disable the Akeno ASCII art
    \x1b[1m--no-boxes                  \x1b[90m│\x1b[0m  Disable all borders/boxes from the output
    \x1b[1m--no-color                  \x1b[90m│\x1b[0m  Disable all colouring from the output
    \x1b[1m--silent | -s               \x1b[90m│\x1b[0m  Disable all output (excluding errors)
---
Base command list:
    \x1b[1mhelp | --help | -h          \x1b[90m│\x1b[0m  Display command help
    \x1b[1minfo | --info | -i          \x1b[90m│\x1b[0m  Display some current information about the server and its status
    \x1b[1mreload                      \x1b[90m│\x1b[0m  Reload the API server
       \x1b[90m⤷\x1b[0m -h | --hot             \x1b[90m│\x1b[0m  Hot-reload of the web addon (for when you add/remove apps)
       \x1b[90m⤷\x1b[0m -a | --app             \x1b[90m│\x1b[0m  Hot-reload a specific web application (basic configuration)
       \x1b[90m⤷\x1b[0m --host                 \x1b[90m│\x1b[0m  Reload the host server (eg. Nginx, DNS...)
  \x1b[93m•\x1b[0m \x1b[1mlist | ls                   \x1b[90m│\x1b[0m  List web applications
    \x1b[1mlogs [filter]               \x1b[90m│\x1b[0m  View server logs
  \x1b[93m•\x1b[0m \x1b[1mfabricate <path>            \x1b[90m│\x1b[0m  Simulate a GET request to the server
  \x1b[93m•\x1b[0m \x1b[1mget-config                  \x1b[90m│\x1b[0m  Parse the main Akeno/EGAPI config file and return it as JSON
  \x1b[93m•\x1b[0m \x1b[1mparse-config <file|text>    \x1b[90m│\x1b[0m  Parse a compatible Akeno config file and return it as JSON
        \x1b[90m⤷\x1b[0m -t                    \x1b[90m│\x1b[0m  Parse from text instead of a file
        \x1b[90m⤷\x1b[0m -d                    \x1b[90m│\x1b[0m  Parse dynamic content (eg. code - keep all plaintext and start blocks with @)
        \x1b[90m⤷\x1b[0m -p                    \x1b[90m│\x1b[0m  Prettify JSON
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
Web addon:
    \x1b[1mrenew-cert [domain]                \x1b[90m│\x1b[0m  Automatically renew a certificate for a domain
        \x1b[90m⤷\x1b[0m --namecheap                  \x1b[90m│\x1b[0m  Use the NameCheap API for DNS instead of local DNS
    \x1b[1mtemp-hostname [app]                \x1b[90m│\x1b[0m  Generate a temporary hostname for an app
---
\x1b[93m•\x1b[0m = Supports JSON output`))
    process.exit()
}

if(process.argv.includes("-i") || process.argv.includes("--info") || process.argv.includes("info")){
    try {
        getInfo();
    } catch {
        console.error("[Akeno] [Error] Could not fetch information about the backend. Are you sure that you are running the API server via PM2? Make sure that you are logged in on the same user as where the API was started, try running with sudo or try to set-up the server with pm2-make if your environment has this.\n\n\x1b[31m! If you have not yet set-up the server, this is an expected error !\x1b[0m\nInstall NodeJS and PM2 on your system, then run the api with \x1b[1m\"pm2 start app.js --name egapi\"\x1b[0m from the root directory of the API.\nAfter that try running this again.");
        process.exit(2)
    }

    let isOnline = grep("status").includes("online");

    log(logo + box(`You are running the Akeno backend - an open source, fast, modern and fully automated
web application management system with integrated API, CDN and a webserver!
\x1b[95mCreated with <3 by \x1b[1mTheLSTV\x1b[0m\x1b[95m (https://lstv.test).\x1b[0m

    Version: ${version}
    Server is ${isOnline? `\x1b[32monline\x1b[0m for \x1b[36m\x1b[1m${grep_value("uptime")}\x1b[0m`: "\x1b[31moffline\x1b[0m"}
    ${isOnline?`Running in \x1b[36m\x1b[1m${fs.existsSync("/www/__dev__")? "development": "production"}\x1b[0m environment and received \x1b[36m\x1b[1m${getHits()}\x1b[0m hits so far.
    It is currently using \x1b[36m\x1b[1m${grep_value("Used Heap Size")}\x1b[0m of its heap size (RAM).`:''}

---
Some command examples:
    akeno\x1b[1m reload                   \x1b[90m│\x1b[0m  Reload the API server
    akeno\x1b[1m bundle <source> [target] \x1b[90m│\x1b[0m  Bundle a web application
    akeno\x1b[1m logs [my_web_app]        \x1b[90m│\x1b[0m  Show (and stream) logs, with a filter
    akeno\x1b[1m load <path>              \x1b[90m│\x1b[0m  Load an application from a directory
    akeno\x1b[1m disable <id>             \x1b[90m│\x1b[0m  Disable an application
    akeno\x1b[1m addon -l <path> [id]     \x1b[90m│\x1b[0m  Load an addon
    akeno\x1b[1m bump <api|cdn|ls|...>    \x1b[90m│\x1b[0m  Bump version
    akeno\x1b[1m fabricate <path>         \x1b[90m│\x1b[0m  Simulate a GET request to the server & return the result
    akeno\x1b[1m auth [user]              \x1b[90m│  [auth addon]\x1b[0m Attempt a login and return a token
    ...

---
\x1b[92m•\x1b[0m \x1b[1mDo "akeno --help" for all possible commands!\x1b[0m`))
    process.exit()
}


// const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout
// });


let values = process.argv.slice(2).filter(arg => !arg.startsWith("-")), api = "http://0.0.0.0:7007/internal";

async function resolve(command){
    let thing, domain, data;

    switch(command[0]) {
        case "reload":            
            if(process.argv.includes("--host")){
                return (()=>{
                    log(`${signature} Reloading the host server\n`);
                    let thing = spawn(COMMAND_PATH + "reload");
    
                    thing.stderr.on("data", ()=>{
                        console.error(`Error reloading server: ${error.message}`);
                    })

                    thing.stdout.on("data", data => {
                        process.stdout.write(data)
                    })

                    thing.on("close", ()=>{
                        log(`\n${signature} \x1b[32mSuccessfully reloaded the server!\x1b[0m`);
                    })
                })()
            }

            if(process.argv.includes("-h") || process.argv.includes("--hot")){
                log(`${signature} Hot-reloading web server...`);
                await fetch(`${api}/reload`)
                log(`${signature} Web server sucessfully reloaded!`);
                return
            }

            exec("pm2 reload egapi")
            log(`${signature} API Server sucessfully reloaded.`);
        break;
        case "list": case "ls":
            thing = await(await fetch(api + "/list")).json();
            
            if(process.argv.includes("--json")){
                return log(thing)
            }
            
            return log(box(thing.map(app => `\x1b[93m\x1b[1m${app.basename}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}`).join("\n---\n")))
        break;
        case "parse-config":
            let file = !process.argv.includes("-t"), input;

            if(!command[1]) {
                command[1] = ""
                file = false
            }

            if(file){
                if(!fs.existsSync(command[1])) throw new Error(`${signature} Could not find file "${command[1]}"`);
                
                input = fs.readFileSync(command[1], "utf8")
            } else input = command[1];

            data = parse(input, !process.argv.includes("-d"));

            if(!process.argv.includes("-p")) data = JSON.stringify(data);

            return log(data)
        break;
        case "get-config":

            if(process.argv.includes("--source")) return log(fs.readFileSync(PATH + "../config", "utf8"));

            return log(JSON.stringify(parse(fs.readFileSync(PATH + "../config", "utf8"), true), null, process.argv.includes("-p")? 4 : 0))
        break;
        case "temp-hostname":
            (async()=>{
                thing = await(await fetch(api + "/list")).json();
    
                let app;
    
                if(command[1] && command[1].includes("/")){
                    if(fs.existsSync(command[1])) app = command[1]
                } else if(command[1]) {
                    app = thing.find(thing => thing.basename == command[1]).path
                }
    
                if(!app){
                    return log(`${signature} App "${command[1]}" not found`)
                }

                log(await(await fetch(`${api}/temporaryDomain?app=${app}`)).text())
            })()
        break;
        case "bundle":
            thing = await(await fetch(api + "/list")).json();

            let app, path = command[2] || process.env["PWD"];

            if(command[1] && command[1].includes("/")){
                if(fs.existsSync(command[1])) app = command[1]
            } else if(command[1]) {
                app = thing.find(thing => thing.basename == command[1]).path
            }

            if(!app){
                return log(`${signature} App "${command[1]}" not found`)
            }

            log(`${signature} Preparing to bundle app "${app}" into ${path}...`)

            async function getDomain(file = "/"){

                /*
                    What does this do?
                    This generates a random hostname on-demand that the server will accept as a valid domain for this application, when provided in the host header.
                    This allows the web scrape script to reach the app, even if it has no domains attached or is not available globally.
                */

                return await(await fetch(`${api}/temporaryDomain?app=${app}`)).text()
            }

            domain = await getDomain();

            let scraper = (await import('/www/node/shared_modules/node_modules/website-scraper/index.mjs')).default,
                random = "akeno-temp-bundle-" + (Math.random() * 1000).toString(16) // Why? Because the scraper throws an error if the directory already exists for some reason
            ;

            log(`${signature} Fetching data to a temporary directory ("${"/tmp/" + random}")`)

            // This module is a pain to work with, but it works..
            await scraper({
                urls: [`http://0.0.0.0`],
                directory: "/tmp/" + random,

                plugins: [
                    new class {
                        apply(register){
                            register("beforeRequest", async ({resource, requestOptions}) => {
                                let url = resource.getUrl();

                                log(`${signature} Fetching ${url}`)

                                return {
                                    requestOptions: {
                                        ...requestOptions,
                                        headers: url.includes("0.0.0.0")? {
                                            host: domain
                                        }: {}
                                    }
                                }
                            })
                            register("error", async ({error}) => {
                                log(`${signature} Error ${error}`)
                            })
                            register("onResourceError", async ({error}) => {
                                log(`${signature} Error ${error}`)
                            })
                        }
                    }
                ]
            })

            log(`${signature} Moving data.`)
            
            fs.moveSync("/tmp/" + random, path, { overwrite: true });
            
            log(`${signature} \x1b[32mSUCCESS!\x1b[0m Bundle has been created.`)
        break;
        case "logs":
            if(command[1]) log(`${signature} Showing only lines including "${command[1]}"`);

            const childProcess = spawn('pm2 logs egapi', {
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
                    if(command[1] && !thing.includes(command[1])) return;

                    return thing
                }).join("\n"))
            });

            childProcess.stderr.on('data', (buffer) => {
                process.stderr.write(buffer)
            });
        break;
        case "renew-cert":
            if(!command[1] || command[1].length < 1 || !command[1].includes(".")){
                return log(`${signature} \x1b[31mDomain "${command[1]}" seems to be invalid.\x1b[0m`)
            }

            domain = command[1];

            let configPath = "/www/server/config/server.json";

            // NOTE: VERY SPECIFIC TEMPORARY FIX!!!!
            if(domain == "upedie.online") configPath = "/www/content/shared/wss/server.jsonc";

            let dns = require("node:dns");

            let
                config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m))
            ;


            

            // log(config);

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
            console.error(signature + " Unknown command \"" + command[0] + "\". Type 'akeno -h' for help.")
    }
}

resolve(values)