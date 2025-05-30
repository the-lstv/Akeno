#!/usr/bin/env node

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

    socketPath = '/tmp/akeno.backend.sock',

    client = new ipc_client(socketPath)
;

// To be removed
const COMMAND_PATH = "/www/cmd/bin/";



let logo = argv.ascii === false? "" : (gradient(`\x1b[1m
     _    _
    / \\  | | _____ _ __   ___
   / _ \\ | |/ / _ \\ '_ \\ / _ \\
  / ___ \\|   <  __/ | | | (_) |
 /_/   \\_\\_|\\_\\___|_| |_|\\___/
`) + "\x1b[0m\n"),
    signature = "\x1b[95m[akeno]\x1b[0m"
;


// TO BE UPDATED.

const ROOT_COMMANDS = [
    {
        type: "group",
        name: "Global options",
        items: [
            {
                name: "--json",
                type: "flag",
                description: "Preffer JSON output (where supported)"
            },
            {
                name: "--no-ascii",
                type: "flag",
                description: "Disable the Akeno ASCII art"
            },
            {
                name: "--no-boxes",
                type: "flag",
                description: "Disable all borders/boxes from the output"
            },
            {
                name: "--no-color",
                type: "flag",
                description: "Disable all colouring from the output"
            },
            {
                name: ["--silent", "-s"],
                type: "flag",
                description: "Disable all output (excluding errors)"
            }
        ]
    },
    {
        type: "group",
        name: "Basic commands",
        items: [
            {
                name: ["help", "--help", "-h"],
                type: "command",
                description: "Display command help",
                json: true
            },
            {
                name: ["info", "status", "--info", "-i"],
                type: "command",
                description: "Display some information about the server and its status"
            },
            {
                name: "start",
                type: "command",
                description: "Start the server (without a PM)"
            },
            {
                name: "reload",
                type: "command",
                description: "Hot-reload the server configuration",
                args: ["app"]
            },
            {
                name: "restart",
                type: "command",
                description: "Restart the server (requires PM2)",
                options: [
                    {
                        name: "--logs",
                        description: "Display logs while loading the server"
                    }
                ]
            },
            {
                name: "update",
                type: "command",
                description: "Update the server to the latest version (requires git) and reload",
                options: [
                    {
                        name: "--no-pull",
                        description: "Skip pulling updates from the repository"
                    }
                ]
            },
            {
                name: "logs",
                type: "command",
                description: "View server logs (requires PM2)",
                args: ["filter"]
            },
            {
                name: "parse-config",
                type: "command",
                description: "Parse a config file and return it as JSON. Defaults to the main config",
                json: true,
                args: ["file"],
                options: [
                    {
                        name: ["-t", "--text"],
                        description: "Parse from text input instead of a file",
                        args: ["text"]
                    },
                    {
                        name: "-p",
                        description: "Prettify JSON output"
                    },
                    {
                        name: "--stringify",
                        description: "Return stringified (converted back to a readable syntax)"
                    }
                ]
            }
        ]
    },
    {
        type: "group",
        name: "Web apps",
        items: [
            {
                name: ["list", "ls"],
                type: "command",
                description: "List web applications"
            },
            {
                name: ["create", "init"],
                type: "command",
                description: "Setup a new application template in the current or specified directory.",
                args: ["path"],
                options: [
                    {
                        name: "-n",
                        description: "Application name",
                        args: ["name"]
                    },
                    {
                        name: "-c",
                        description: "Configuration options",
                        args: ["config"]
                    },
                    {
                        name: "-f",
                        description: "Force creation even if the directory is not empty"
                    }
                ]
            },
            {
                name: "enable",
                type: "command",
                description: "Enable a web application",
                args: ["app"]
            },
            {
                name: "disable",
                type: "command",
                description: "Disable a web application",
                args: ["app"]
            },
            {
                name: "temp-hostname",
                type: "command",
                description: "Generate a temporary hostname for an app",
                args: ["app"]
            },
            {
                name: "bundle",
                type: "command",
                description: "Create a bundle for external/offline use",
                args: ["source", "target path"]
            }
        ]
    },
    {
        type: "group",
        name: "Modules",
        items: [
            {
                name: "module list",
                type: "command",
                description: "List all loaded modules and their status",
                options: [
                    {
                        name: "--brief",
                        description: "Only list available modules without fetching the status"
                    }
                ]
            },
            {
                name: ["module install", "i"],
                type: "command",
                description: "Install one or more modules from a remote source (defaults to the official registry)",
                args: ["source"],
            },
            {
                name: "module update",
                type: "command",
                description: "Find and install updates for all installed modules",
            },
            {
                name: "module remove",
                type: "command",
                description: "Remove one or more modules",
                args: ["module"]
            },
            {
                name: "module unload",
                type: "command",
                description: "Unload a module (behavior may vary based on the module type)",
                args: ["module"]
            },
            {
                name: "module reload",
                type: "command",
                description: "Reload a module (behavior may vary based on the module type)",
                args: ["module"]
            },
            {
                name: "module set-enabled",
                type: "command",
                description: "Enable or disable a module",
                args: ["module", "enabled"],
                options: [
                    {
                        name: "--now",
                        description: "Take immediate effect (load/unload the module)",
                    }
                ]
            },
            {
                name: "module reset",
                type: "command",
                description: "Clear data and settings for a module",
                args: ["module"],
            },
            {
                name: "module info",
                type: "command",
                description: "Get information and status about a module",
                args: ["module"],
            },
            {
                name: "module create-template",
                type: "command",
                description: "Interactive setup to create a new module template for development",
                args: ["name"]
            }
        ]
    },
    {
        type: "group",
        name: "Auth addon",
        items: [
            {
                name: "auth login",
                type: "command",
                description: "Attempt login and return token",
                args: ["name", "password"]
            },
            {
                name: "auth verify",
                type: "command",
                description: "Verify login token",
                args: ["token"]
            },
            {
                name: "auth create",
                type: "command",
                description: "Create a new user",
                args: ["name", "{options}"]
            },
            {
                name: "auth list",
                type: "command",
                description: "List users",
                args: ["offset", "limit"]
            },
            {
                name: "auth detail",
                type: "command",
                description: "List details about a user",
                args: ["name|token"]
            },
            {
                name: "auth patch",
                type: "command",
                description: "Apply a patch to a user object",
                args: ["name|token", "{patch}"]
            },
            {
                name: "auth status",
                type: "command",
                description: "Get/Set account status (ok, disabled, ...)",
                args: ["status"]
            },
            {
                name: "auth delete",
                type: "command",
                description: "Delete an account",
                args: ["name|token"],
                options: [
                    {
                        name: "-f",
                        description: "Skip confirmation"
                    }
                ]
            }
        ]
    }
];


const process_command_item = item => {
    item.isCommand = !item.type || item.type === "command";
    if(!item.usage) item.usage = (typeof item.name === "string"? item.name: item.name.join(" | ")) + (item.args? " " + (item.args.map(arg => typeof arg === "string"? `[${arg}]`: `${arg.required? "<": "["}${arg.name}${arg.required? ">": "]"}`).join(" ")) : "");
    let longestOption = item.isCommand && item.options? Math.max(...item.options.map(process_command_item)): 0;
    return Math.max(longestOption || 0, item.usage.length);
}

function generateHelp(items) {
    let result = "";
    const longest = Math.max(...items.map(process_command_item)) + 2; // +2 for padding

    for (let item of items) {
        if(item.type === "group"){
            result += `${item.name}:\n`;
            result += generateHelp(item.items);
            result += "\n---\n";
            continue;
        }

        result += `  ${item.json? "\x1b[93m•\x1b[0m": " "} \x1b[1m${item.usage.padEnd(longest)}\x1b[90m│\x1b[0m  ${item.description}\x1b[0m\n`;

        if(item.options) for (let option of item.options) {
            result += `        \x1b[90m⤷\x1b[0m ${option.usage.padEnd(longest - 6)}\x1b[90m│\x1b[0m  ${option.description}\x1b[0m\n`;
        }
    }

    return result;
}


/**
 * Help command
 */

if(process.argv.length < 3 || argv.h || argv.help || argv._[0] === "help" || argv._[0] === "h" || argv._[0] === "?" || argv._[0] === "/?"){

    if(argv.json) {
        return log(JSON.stringify(ROOT_COMMANDS.map(item => {
            if(item.type === "group"){
                item.items = item.items.map(i => i.json? i: { ...i, json: true });
                return item;
            } else {
                return item.json? item: { ...item, json: true };
            }
        })))
    } else {
        log(logo + box(`${generateHelp(ROOT_COMMANDS)}\x1b[93m•\x1b[0m = Supports JSON output\nLegend: \x1b[90makeno command <required> [optional] "{object}" --arguments "value"\x1b[0m`));
    }

    process.exit()
}

async function resolve(argv){
    switch(argv._[0]) {
        case "status": case "info":
            client.request(["usage", "cpu"], (error, response) => {
                if(error){
                    if(error.code === "ECONNREFUSED") {
                        return client.close() && log_error(`${signature} Can't get status: Akeno is not running! Make sure you have started it either with a process manager, or the "akeno start" command.`)
                    }
        
                    return client.close() && log_error(`${signature} Couln't get information, the server may not be running!\nError:`, error)
                }        
        
                const mem_total = response.mem.heapTotal
                const mem_used = response.mem.heapUsed
            
                log(logo + box(`You are running the Akeno backend - an open source, fast, modern and fully automated
web application, API and content delivery management system / server!

\x1b[95mCreated with <3 by \x1b[1mTheLSTV\x1b[0m\x1b[95m (https://lstv.space).\x1b[0m

Version: ${response.version}
Server is ${response.server_enabled? `\x1b[32monline\x1b[0m for \x1b[36m\x1b[1m${formatUptime(response.uptime)}\x1b[0m`: "\x1b[31moffline\x1b[0m"}
${response.server_enabled?`Running in \x1b[36m\x1b[1m${response.isDev? "development": "production"}\x1b[0m environment.
---
Currently using \x1b[36m\x1b[1m${(mem_used / 1000000).toFixed(2)} MB\x1b[0m RAM out of a \x1b[36m\x1b[1m${(mem_total / 1000000).toFixed(2)} MB\x1b[0m heap and \x1b[36m\x1b[1m${response.cpu.usage.toFixed(4)}%\x1b[0m CPU.` : ''}
---${response.modules.count > 0?`
\x1b[36m\x1b[1m${response.modules.count}\x1b[0m module${response.modules.count > 1? "s": ""} loaded: ${response.modules.sample.join(", ")}
---`: ''}
Some examples:
    akeno\x1b[1m reload              \x1b[90m│\x1b[0m  Hot-reload the API server without downtime
    akeno\x1b[1m logs                \x1b[90m│\x1b[0m  Show (and stream) logs
    akeno\x1b[1m disable <id>        \x1b[90m│\x1b[0m  Disable an application
    ...
    
---
    \x1b[92m•\x1b[0m \x1b[1mTry "akeno --help" for explanation of all commands!\x1b[0m`));
                    process.exit()
                })
            break;

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

            exec("pm2 reload akeno")
            log(`${signature} API Server sucessfully reloaded.`)

        break;

        case "module": {

            switch(argv._[1]){
                case "list": case "ls":
                    client.request(["module.list"], (error, response) => {
                        client.close()

                        if(error){
                            return log_error(`${signature} Could not list modules:`, error)
                        }

                        if(argv.json){
                            return log(response)
                        }
                        
                        return log(box(response.map(app => `\x1b[93m\x1b[1m${app.name}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}${ app.domains.length > 0? `\n\n\x1b[1mDomains:\x1b[0m\n${app.domains.join("\n")}`: "" }${ app.ports.length > 0? `\n\n\x1b[1mPorts:\x1b[0m\n${app.ports.join("\n")}`: "" }`).join("\n---\n")))
                    })
                break;

                default:
                    log_error(`${signature} Unknown modules command "${argv._[1]}"`)
            }

            break;
        }

        case "list": case "ls":
            client.request(["web.list"], (error, response) => {
                client.close()

                if(error){
                    return log_error(`${signature} Could not list applications:`, error)
                }

                if(argv.json){
                    return log(response)
                }
                
                return log(box(response.map(app => `\x1b[93m\x1b[1m${app.basename}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}${ app.domains.length > 0? `\n\n\x1b[1mDomains:\x1b[0m\n${app.domains.join("\n")}`: "" }${ app.ports.length > 0? `\n\n\x1b[1mPorts:\x1b[0m\n${app.ports.join("\n")}`: "" }`).join("\n---\n")))
            })

        break;


        case "update":
            try {
                log("Pulling updates from the repository...");
                exec("git pull", { stdio: "inherit" });
                log("Reloading server...");
                exec("pm2 reload akeno");
                log("Update complete.");
            } catch (err) {
                log_error("Failed to update:", err);
            }
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

        case "logs": {
            if(argv._[1]) log(`${signature} Showing only lines including "${argv._[1]}"`);

            const childProcess = spawn('pm2 logs akeno', {
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
        }

        case "start": {
            log(`${signature} Launching Akeno (without a process manager).`);
            
            const childProcess = spawn('node ' + (argv.inspect? "--inspect " : "") + __dirname + '/../app', {
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
        }


        // DO NOT USE THIS COMMAND :D
        // It is here just for backwards compatibility with my old system, and this part is still (sigh...) relied on.
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
            console.error(signature + " Unknown command \"" + (argv._[0] || "(no command)") + "\". Type 'akeno -h' for help.")
    }
}






// Utility functions

/**
 * Sleep function
 * @param {number} ms
 * @returns {Promise}
 */

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
    return data.map(thing => typeof thing == "string"? argv.color === false? thing.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '') : thing : thing)
}

function log(...data){
    if(argv.silent || argv.s) return;
    console.log(...data_to_log(data))
}

function log_error(...data){
    console.error(...data_to_log(data))
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

/**
 * Creates a styled text box with customizable padding, margin, and color.
 * The box can include horizontal dividers represented by lines containing "---".
 * 
 * @param {string} text - The text to be displayed inside the box. Each line is separated by a newline character.
 * @param {number} [padding=1] - The amount of padding (spaces) inside the box around the text.
 * @param {number} [margin=0] - The amount of margin (spaces) outside the box.
 * @param {string} [color="90"] - The ANSI color code for the box border.
 * @returns {string} - The formatted text box as a string.
 */

function box(text, padding = 1, margin = 0, color = "90") {
    // Super messy code but does what it should

    if(argv.boxes === false) return text;

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

resolve(argv);