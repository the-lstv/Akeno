#!/usr/bin/env node

/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0
    Version: 1.1.0
    Description: Command line interface for Akeno
*/


const
    minimist = require('minimist'),
    argv = minimist(process.argv.slice(2)),

    exec = require("child_process").execSync,
    execAsync = require("child_process").exec,
    spawn = require("child_process").spawn,

    pm2 = require("pm2"),

    nodePath = require("path"),

    fs = require("fs-extra"),

    // Local libraries
    { parse, stringify, v } = require("./parser"),
    { Client } = require("./ipc"),

    socketPath = process.platform === "win32"? '\\\\.\\pipe\\akeno.backend.sock' : '/tmp/akeno.backend.sock'
;

// To be removed
const COMMAND_PATH = "/www/cmd/bin/";

let client;


let logo = argv.ascii === false? "" : (gradient(`\x1b[1m
     _    _
    / \\  | | _____ _ __   ___
   / _ \\ | |/ / _ \\ '_ \\ / _ \\
  / ___ \\|   <  __/ | | | (_) |
 /_/   \\_\\_|\\_\\___|_| |_|\\___/
`) + "\x1b[0m\n"),
    signature = "\x1b[95m[akeno]\x1b[0m",
    signatureLength = "[akeno]".length,
    nestedSignature = " ".repeat(signatureLength - 2) + "\x1b[90m⤷\x1b[0m "
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
                description: "Display some information about the server and its status",
                json: true
            },
            {
                name: ["version", "-v"],
                type: "command",
                description: "Display the current version of Akeno",
                json: true
            },
            {
                name: "start",
                type: "command",
                description: "Start the server (without a PM)",
                options: [
                    {
                        name: "--inspect",
                        description: "Enable Node.js inspector for debugging"
                    }
                ]
            },
            {
                name: "reload",
                type: "command",
                description: "Hot-reload the server or a specific application",
                args: ["app"]
            },
            {
                name: "restart",
                type: "command",
                description: "Restart the server",
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
                name: "pm2-setup",
                type: "command",
                description: "Setup Akeno to run under PM2 (process manager)"
            },
            {
                name: "pm2-delete",
                type: "command",
                description: "Delete Akeno from PM2 (process manager)"
            },
            {
                name: "systemd-setup",
                type: "command",
                description: "Setup Akeno to run under systemd (service manager)"
            },
            {
                name: "systemd-delete",
                type: "command",
                description: "Delete the Akeno service from systemd"
            },
            {
                name: "ipc-exec",
                type: "command",
                description: "Execute a command directly via the IPC server",
                args: ["command", "[args...]"]
            },
            {
                name: "logs",
                type: "command",
                description: "View server logs (requires PM2)",
                args: ["filter"]
            },
            {
                name: ["parse", "parse-config", "get-config"],
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
                name: "info",
                type: "command",
                description: "Get information about a web application",
                args: ["app"],
                json: true
            },
            {
                name: "list-domains",
                type: "command",
                description: "List all domains for a web application",
                args: ["app"]
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
                description: "Generate a temporary hostname for an app (or specify a domain)",
                args: ["app", "[domain]"],
            },
            {
                name: "bundle",
                type: "command",
                description: "Export a bundle for external/offline use",
                args: ["app", "target path"]
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
    }
];


// TODO: Allow modules to extend the help menu

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

if(argv._[0] === "version" || (argv.v && !argv._[0])) {
    const packageJson = require("../package.json");

    if(argv.json) {
        return log(packageJson.version);
    }

    return log(logo + box(`\x1b[1mAkeno CLI version: ${packageJson.version}\x1b[0m\n\x1b[90mCreated with <3 by TheLSTV (https://lstv.space)\x1b[0m`));
}

async function resolve(argv){

    // FIXME: Temporary
    if(new Set(["status", "info", "reload", "list", "ls", "enable", "disable", "create", "init", "web.info", "temp-hostname", "ipc-exec"]).has(argv._[0])) {
        client = new Client(socketPath)
    }

    switch(argv._[0]) {
        case "status": case "info":
            client.request(["usage/cpu"], (error, response) => {
                client.close();

                if(error){
                    if(error.code === "ECONNREFUSED") {
                        return log_error(`${signature} Can't get status: Akeno is not running! Make sure you have started it either with a process manager, or the "akeno start" command.`)
                    }
        
                    return log_error(`${signature} Couldn't get information, the server may not be running!\nError:`, error)
                }

                const mem_total = response.mem.heapTotal;
                const mem_used = response.mem.heapUsed;

                if(argv.json) {
                    return log(JSON.stringify(response));
                }

                log(logo + box(`You are running the Akeno backend - an open source, fast, modern and fully automated
web application, API and content delivery management system / server!

\x1b[95mCreated with <3 by \x1b[1mTheLSTV\x1b[0m\x1b[95m (https://lstv.space).\x1b[0m

Version: ${response.version}
Server is \x1b[32monline\x1b[0m for \x1b[36m\x1b[1m${formatUptime(response.uptime)}\x1b[0m
Running in \x1b[36m\x1b[1m${response.mode.toLowerCase()}\x1b[0m mode.
---
Currently using \x1b[36m\x1b[1m${(mem_used / 1000000).toFixed(2)} MB\x1b[0m RAM out of a \x1b[36m\x1b[1m${(mem_total / 1000000).toFixed(2)} MB\x1b[0m heap and \x1b[36m\x1b[1m${response.cpu.usage.toFixed(4)}%\x1b[0m CPU.
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

            client.request(["akeno.web/reload", (singular && argv._[1]) || null], (error, success) => {
                client.close()

                if(error || !success){
                    return log_error(`${nestedSignature} Could not reload:`, error || "Application not found or failed to reload.")
                }

                log(`${nestedSignature} Successfully reloaded!`);
            })

        break;

        case "restart":
            if(argv.logs){
                await resolve({_: ["logs"]}) // This is a bit of a hack, but it works
            }

            log(`${signature} Restarting Akeno...`);

            pm2.connect(function (err) {
                if (err) {
                    console.error(err)
                    process.exit(2)
                }

                pm2.restart('akeno', (err, apps) => {
                    pm2.disconnect();
                    if (err) {
                        log_error(`${signature} ⚠️  Could not restart Akeno:`, err.message || err, argv.updating? "- Updates will not be applied until restart!": "");
                        log_error(`${nestedSignature} Make sure that you have PM2 installed and setup for Akeno (\x1b[1msudo akeno pm2-setup\x1b[0m)!`);
                        
                        if (process.getuid && process.getuid() !== 0) {
                            log_error(`${nestedSignature} You may need to run this command as root - try \x1b[1msudo akeno restart\x1b[0m.`);
                        } else {
                            log_error(`${nestedSignature} Make sure you are running this command as the same user that has the PM2 process.`);
                        }

                        log_error(`${nestedSignature} If you are using systemd instead of pm2, use \x1b[1msystemd restart akeno\x1b[0m instead.`);
                        return process.exit(2);
                    }

                    if (argv.updating) {
                        const version = require("../package.json").version;
                        log(`${nestedSignature} Akeno has been updated to version ${version}!`);
                    } else {
                        log(`${nestedSignature} Akeno has been successfully restarted.`);
                    }
                });
            });
            break;
        
        case "pm2-setup":
            const systemdServiceFile = "/etc/systemd/system/akeno.service";
            if (fs.existsSync(systemdServiceFile)) {
                log_error(`${signature} Warning: A systemd service file for Akeno seems to exist at ${systemdServiceFile}. You probably don't need to setup PM2 or you may end up running Akeno twice. You can later run \x1b[1makeno pm2-delete\x1b[0m to remove the app from PM2 or \x1b[1makeno systemd-delete\x1b[0m to remove the systemd service.`);
            }

            pm2.connect(function (err) {
                if (err) {
                    console.error(err)
                    process.exit(2)
                }

                pm2.describe('akeno', (err, apps) => {
                    if (err) {
                        pm2.disconnect();
                        return log_error(`${signature} Could not check Akeno status:`, err);
                    }
                    
                    if(apps.length === 0){
                        pm2.start({
                            script: nodePath.resolve(__dirname, "../app.js"),
                            name: "akeno",
                            autorestart: true
                        }, (err, apps) => {
                            pm2.disconnect();
                            
                            if (err) {
                                return log_error(`${signature} Could not start Akeno:`, err);
                            }
                            
                            log(`${signature} Akeno successfully started under PM2!`);
                        });
                    } else {
                        log(`${signature} Akeno is already running under PM2!`);
                        pm2.disconnect();
                    }

                });
            });
            break;

        case "pm2-delete":
            pm2.connect(function (err) {
                if (err) {
                    console.error(err);
                    process.exit(2);
                }

                pm2.delete('akeno', (err) => {
                    pm2.disconnect();
                    if (err) {
                        return log_error(`${signature} Could not delete Akeno:`, err);
                    }

                    log(`${signature} Akeno successfully deleted from PM2!`);
                });
            });
            break;

        case "systemd-setup":
            if(process.platform === "win32"){
                log_error(`${signature} Systemd setup is not supported on Windows. Please run this command on a Linux system with systemd support.`);
                process.exit(1);
            }

            const serviceName = "akeno";
            const serviceFile = `/etc/systemd/system/${serviceName}.service`;
            const execPath = nodePath.resolve(__dirname, "../app.js");
            const serviceContent = `[Unit]
Description=Akeno Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${execPath}
Restart=always
User=${process.env.USER || "www-data"}

[Install]
WantedBy=multi-user.target`;

            if (fs.existsSync(serviceFile) && !argv.f) {
                log_error(`${signature} Service file already exists at ${serviceFile}. Use -f to overwrite.`);
                process.exit(1);
            }

            try {
                fs.writeFileSync(serviceFile, serviceContent, { mode: 0o644 });
                exec("systemctl daemon-reload");
                exec(`systemctl enable ${serviceName}`);
                log(`${signature} Systemd service created at ${serviceFile} and enabled!`);
                log(`${nestedSignature} You can start Akeno with: sudo systemctl start ${serviceName}`);
            } catch (err) {
                log_error(`${signature} Failed to setup systemd service:`, err);
                process.exit(1);
            }
            break;

        case "systemd-delete":
            if (process.platform === "win32") {
                log_error(`${signature} Systemd delete is not supported on Windows.`);
                process.exit(1);
            }

            const serviceNameDel = "akeno";
            const serviceFileDel = `/etc/systemd/system/${serviceNameDel}.service`;

            if (!fs.existsSync(serviceFileDel)) {
                log_error(`${signature} Service file does not exist at ${serviceFileDel}.`);
                process.exit(1);
            }

            try {
                exec(`systemctl stop ${serviceNameDel}`);
                exec(`systemctl disable ${serviceNameDel}`);
                fs.unlinkSync(serviceFileDel);
                exec("systemctl daemon-reload");
                log(`${signature} Systemd service ${serviceNameDel} deleted and disabled!`);
            } catch (err) {
                log_error(`${signature} Failed to delete systemd service:`, err);
                process.exit(1);
            }
            break;

        case "module": {

            switch(argv._[1]){
                case "list": case "ls":
                    client.request(["module.list"], (error, response) => {
                        client.close()

                        if(error){
                            return log_error(`${signature} Could not list modules:`, error)
                        }
                    })
                break;

                default:
                    log_error(`${signature} Unknown modules command "${argv._[1]}"`)
            }

            break;
        }

        case "list": case "ls":
            client.request(["akeno.web/list"], (error, data) => {
                client.close();

                if(error){
                    return log_error(`${signature} Could not list applications:`, error)
                }

                if(argv.json){
                    return log(data);
                }

                return log(box(data.map(app => `\x1b[93m\x1b[1m${app.basename}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}${ app.ports.length > 0? `\n\n\x1b[1mPorts:\x1b[0m\n${app.ports.join("\n")}`: "" }`).join("\n---\n")))
            })
        break;

        case "web.info":
            client.request(["akeno.web/info", argv._[1]], (error, app) => {
                client.close();

                if(error){
                    return log_error(`${signature} Could not retrieve application info:`, error)
                }

                if(argv.json){
                    return log(app);
                }

                return log(box(`\x1b[93m\x1b[1m${app.basename}\x1b[0m \x1b[90m${app.path}\x1b[0m\n${app.enabled? "\x1b[32m✔ Enabled\x1b[0m": "\x1b[31m✘ Disabled\x1b[0m"}${ app.ports.length > 0? `\n\n\x1b[1mPorts:\x1b[0m\n${app.ports.join("\n")}`: "" }`));
            });
        break;

        case "ipc-exec":
            if(!argv._[1]){
                return log_error(`${signature} No command provided! Usage: \x1b[1makeno ipc-exec <command> [args...]`);
            }

            const command = argv._[1];
            const args = argv._.slice(2);

            client.request([command, ...args], (error, response) => {
                client.close();

                if (error) {
                    return log_error(`${signature} IPC execution failed:`, error);
                }

                console.log(JSON.stringify(response));
            });
            break;

        case "update":
            try {
                // Determine the project root directory (assume this file is in /www/content/akeno/core/)
                const projectRoot = nodePath.resolve(__dirname, "..");
                
                log("Pulling updates from the repository...");
                exec("git pull", { cwd: projectRoot, stdio: "inherit" });

                resolve({_: ["restart"], updating: true});
            } catch (err) {
                log_error("Failed to update:", err);
            }
            break;

        case "parse-config": case "parse": case "get-config":
            let input = argv.t || argv.text;

            if(typeof input !== "string"){
                let path = argv._[1] || nodePath.resolve(__dirname, "../config");

                if(!fs.existsSync(path)) return log_error(`${signature} Could not find file "${path}"`);
                input = fs.readFileSync(path, "utf8")
            }

            if(typeof input !== "string") return log_error(`${signature} No input provided! Use the -t option to provide text input, or specify a file path as the first argument.`);

            data = parse(input, argv.stringify? { asLookupTable: true }: { asArray: true });

            if(argv.stringify) data = stringify(data); else if(argv.p) data = JSON.stringify(data, null, 4); else data = JSON.stringify(data);
            return log(data)

        case "enable":
            client.request(["akeno.web/enable", argv._[1]], (error, response) => {
                client.close()

                if(response){
                    log(`${signature} Sucessfully enabled app!`)
                } else log_error(`${signature} Couldnt enable app (it either doesnt exist or Akeno is not running).`)
            })
            break;

        case "disable":
            client.request(["akeno.web/disable", argv._[1]], (error, response) => {
                client.close()

                if(response){
                    log(`${signature} Successfully disabled app!`)
                } else log_error(`${signature} Couldn't disable app (it either doesn't exist or Akeno is not running).`)
            })
            break;

        case "temp-hostname":
            client.request(["akeno.web/tempDomain", argv._[1], argv._[2] || null], (error, response) => {
                client.close();

                if (error) {
                    return log_error(`${signature} Could not retrieve temporary domain:`, error);
                }

                log(response);
            });
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
            
            const childProcess = spawn('node ' + (argv.inspect? "--inspect " : "") + __dirname + '/../app ' + process.argv.slice(process.argv.indexOf("start") + 1).join(" "), {
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