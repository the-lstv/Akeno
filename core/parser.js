// const fs = require("fs");
// const { xxh32 } = require("@node-rs/xxhash");


const parser_regex = {
    keyword: /[\w-.]/,
    plain_value: /[\w-</>.*:]/,
    stringChar: /["'`]/,
    whitespace: /[\s\n\r\t]/,
    digit: /^\d+(\.\d+)?$/,
    singleton: ["area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"],
    plaintext_blocks: ["part"],
    initiator: "@"
}


function parse(options){

    // Temporary for backwards compatibility
    if(typeof options === "string"){
        console.warn("[parser] Warning: Deprecated usage of parse(). Please consider upgrading.");
        
        return parse({
            content: arguments[0],
            embedded: !arguments[1],
            strict: true,
            asLookupTable: true
        })
    }


    // Used in embedded mode to skip through blocks
    let blockPosition = -1;


    if(options.embedded){
        blockPosition = options.content.indexOf(parser_regex.initiator);
    
        // Nothing to do, so just skip parsing entirely
        if(blockPosition === -1) return options.onText(options.content);

        if(options.onText) options.onText(options.content.substring(0, blockPosition));
    } else {

        // Enable strict mode by default when not using embedded mode
        if(typeof options.strict === "undefined") options.strict = true;

    }

    let result = null;
    if(options.asArray) {
        result = []

        options._onBlock = block => {
            result.push(block)
        }
    } else if(options.asLookupTable) {
        result = new Map

        options._onBlock = block => {
            if (!result.has(block.name)) {
                result.set(block.name, []);
            }

            result.get(block.name).push(block);
        }
    }


    // Parse block
    function parseAt(initialBlockStart){
        let currentPosition = initialBlockStart;

        if(initialBlockStart >= options.content.length) return;

        // Stage of parsing + types (0 = default, 1 = keyword, 2 = string, 3 = plain value, 4 = plaintext until block end, 5 = comment (single-line))
        let stage = options.embedded? 0: -1, next_stage = 0, parsedString = null, type = options.embedded? 1: 0, revert_type = null, confirmed = false, stringChar = null, current_value_isString, block = {
            name: "",
            attributes: [],
            properties: {}
        }


        let parsingValueStart = currentPosition, parsingValueLength = 1, parsingValueSequenceBroken = false;

        // Exit block
        function exit(cancel, message = null){
            const endPosition = currentPosition;

            if(cancel) {

                // TODO: Throw/broadcast error on cancelled exit when strict mode
                const error = new Error("[Parser Syntax Error] " + (message || "") + "\n  (at character " + currentPosition + ")");

                if(options.strict) currentPosition = options.content.length; // Skip to the end of the file
                if(typeof options.onError === "function") options.onError(error);

                if(options.embedded) currentPosition = initialBlockStart;

            } else {

                // No error, send block for processing
                if(options._onBlock) options._onBlock(block)
                if(options.onBlock) options.onBlock(block)
                currentPosition ++;

            }

            if(options.embedded) {

                // Find next block
                blockPosition = options.content.indexOf(parser_regex.initiator, currentPosition);

                if(options.onText) options.onText(options.content.slice(currentPosition, blockPosition !== -1? blockPosition: options.content.length));

                if(blockPosition !== -1) parseAt(blockPosition); else return;

            } else parseAt(endPosition)

        }

        function value_start(length = 0, positionOffset = 0, _type = null){
            if(_type !== null) type = _type;
            parsingValueStart = currentPosition + positionOffset;
            parsingValueLength = length;
            parsingValueSequenceBroken = false;
            parsedString = null;
        }

        function get_value(){
            return options.content.slice(parsingValueStart, parsingValueStart + parsingValueLength)
        }

        let last_key;

        while(currentPosition < options.content.length){
            currentPosition ++;

            const char = options.content[currentPosition];

            if(type === 2) {
                // currentPosition += (options.content.indexOf(stringChar, currentPosition) - currentPosition) -1;

                if(char === stringChar && options.content[currentPosition -1] !== "\\"){
                    type = 0

                    // if(stage !== next_stage) currentPosition--;

                    stage = next_stage

                    parsedString = get_value()
                } else parsingValueLength ++
            } else

            if(type === 4) {
                // currentPosition += (options.content.indexOf("}", currentPosition) - currentPosition) -1;

                if(char === "}"){
                    type = 0

                    stage = next_stage

                    parsedString = get_value()
                } else parsingValueLength ++
            } else

            if(type === 5) {
                // const next = options.content.indexOf("\n", currentPosition);
                // if(next !== -1) currentPosition += (next - currentPosition) -1;

                if(char === "\n"){
                    type = revert_type
                    currentPosition--
                }
            } else

            if(type === 3) {
                if(!parser_regex.plain_value.test(char)){
                    type = 0
                    stage = next_stage
                    currentPosition--

                    parsedString = get_value()
                } else parsingValueLength ++
            } else

            // Also skip whitespace when possible.
            if(type !== 0 || !parser_regex.whitespace.test(char)) {

                if(char === "#") {
                    // revert_type = type; type = 5;
                    while(options.content[currentPosition] !== "\n" && currentPosition < options.content.length){
                        currentPosition ++
                    }
                    continue
                }

                switch(stage){

                    // Searching for the beginning of a block
                    case -1:
                        if(!parser_regex.keyword.test(char)) return exit(true, "Unexpected character " + char);
                        
                        stage = 0;
                        type = 1;
                        parsingValueStart = currentPosition
                        currentPosition --
                        parsingValueLength = 0
                        break

                    // Beginning of a block name
                    case 0:
                        if(!parser_regex.keyword.test(char)){

                            if(parser_regex.whitespace.test(char)) {
                                parsingValueSequenceBroken = true
                                break
                            }

                            if(char !== "(" && char !== "{") return exit(true, "Unexpected character " + char);

                            type = 0;
                            stage = 1;
                            currentPosition --

                        } else if (parsingValueSequenceBroken) return exit(true, "Space in keyword names is not allowed"); else parsingValueLength ++;
                        break;


                    // End of a block name
                    case 1:
                        block.name = get_value().replace(parser_regex.initiator, "")

                        if(char === "("){
                            stage = 2;
                        } else if (char === "{") {
                            stage = 4;

                            if(parser_regex.plaintext_blocks.indexOf(block.name) !== -1){
                                value_start(0, 1, 4)
                            }
                        } else return exit(true);

                        break;


                    // Attribute
                    case 2:
                        if(char === ")" || char === ","){
                            type = 0
                            if(parsedString) block.attributes.push(parsedString.trim())
                            if(char === ")") stage = 3;
                            break;
                        }

                        if(parser_regex.stringChar.test(char)){
                            stringChar = char

                            value_start(0, 1, 2)

                            next_stage = 2
                        } else if (parser_regex.plain_value.test(char)){
                            type = 3

                            value_start(1)

                            next_stage = 2
                        } else return exit(true)

                        break


                    // Before a block
                    case 3:
                        if(!/[;{]/.test(char)) return exit(true);

                        if(char === ";"){
                            return exit()
                        }

                        stage = 4

                        break


                    // Looking for a keyword
                    case 4:
                        if(char === "}"){
                            return exit()
                        }

                        if(!parser_regex.keyword.test(char)) return exit(true);

                        stage = 5

                        value_start(1, 0, 1)
                        break


                    // Keyword
                    case 5:
                        if(!parser_regex.keyword.test(char)){
                            if(parser_regex.whitespace.test(char)) {
                                parsingValueSequenceBroken = true
                                break
                            }

                            const key = get_value().trim()

                            type = 0

                            if(char === ";" || char === "}") {

                                block.properties[key] = [true]
                                stage = 4

                                if(char === "}"){
                                    return exit()
                                }

                            } else if (char === ":") {

                                last_key = key
                                parsedString = null
                                stage = 6

                            } else return exit(true);
                        } else {
                            if(parsingValueSequenceBroken) {
                                return exit(true)
                            }

                            parsingValueLength ++
                        }

                        break;


                    // Start of a value
                    case 6:

                        // Push values - this *was* supposed to write in an array only if there are multiple values, but this made working with data harder - property values are now always an array
                        if(parsedString){

                            if(!current_value_isString){
                                if(parsedString === "true") parsedString = true;
                                else if(parsedString === "false") parsedString = false;
                                else if(parser_regex.digit.test(parsedString)) parsedString = Number(parsedString);
                            }

                            if(block.properties[last_key]) {
                                block.properties[last_key].push(parsedString)
                            } else {
                                block.properties[last_key] = [parsedString]
                            }

                            parsedString = null
                        }

                        current_value_isString = false;

                        if(char === ","){

                            type = 0
                            stage = 6;
                            
                        } else if(char === ";"){

                            type = 0
                            stage = 4;

                        } else if(char === "}"){

                            return exit()

                        } else {
                            if(parser_regex.stringChar.test(char)){
                                current_value_isString = true;
                                stringChar = char

                                value_start(0, 1, 2)

                                next_stage = 6
                            } else if (parser_regex.plain_value.test(char)){
                                current_value_isString = false;

                                value_start(1, 0, 3)

                                next_stage = 6
                            } else return exit(true)
                        };

                        break;
                }
            }
        }

        if(!confirmed) return exit(true);

        exit()
    }

    parseAt(blockPosition)

    return result;
}



function stringify(config){
    let result = "";

    for(let block of config){
        if(!block) continue;

        result += `${
            // Block name
            block.name
        }${
            // attributes
            block.attributes.length > 1 || block.attributes[0].length > 0? ` (${block.attributes.map(value => value.map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(" ")).join(", ") })` : ""
        }${
            // Properties
            Object.keys(block.properties).length > 0? ` {\n    ${Object.keys(block.properties).map(key => `${key}${block.properties[key] === true? "": `: ${block.properties[key].map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(", ")}`};`).join("\n    ")}\n}` : ";"
        }\n\n`
    }
    
    return result;
}

function merge(base, newConfig){
    const mergedConfig = [];

    const findBlockIndex = (config, name) => config.findIndex(
        block => block.name === name && (block.attributes.length === 0 || (block.attributes.length === 1 && block.attributes[0].length === 0))
    );

    base.forEach(block => mergedConfig.push({ ...block }));

    newConfig.forEach(newBlock => {
        if(!newBlock) return;

        const { name, attributes: newAttributes, properties: newProperties } = newBlock;

        // Check if the block with the same key and empty values already exists in the merged config
        const baseBlockIndex = findBlockIndex(mergedConfig, name);

        if (baseBlockIndex !== -1) {
            const baseBlock = mergedConfig[baseBlockIndex];
            const baseProperties = baseBlock.properties;

            // Merge properties
            for (const prop in newProperties) {
                if (prop in baseProperties) {
                    if (Array.isArray(baseProperties[prop]) && Array.isArray(newProperties[prop])) {
                        // Concatenate arrays, avoiding duplicates
                        baseProperties[prop] = Array.from(new Set(baseProperties[prop].concat(newProperties[prop])));
                    } else {
                        // Overwrite value
                        baseProperties[prop] = newProperties[prop];
                    }
                } else {
                    // Add new property
                    baseProperties[prop] = newProperties[prop];
                }
            }
        } else {
            // Add the new block if not present in baseConfig
            mergedConfig.push({ ...newBlock });
        }
    });

    return mergedConfig;
}

function configTools(parsed){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    function block_proxy(block){
        return new Proxy(block, {
            get(target, prop) {
                if (prop === "get") {
                    return function (key, type, default_value = null){
                        if(block.isShadow) return default_value;

                        if(type === Array || type === null || type === undefined) return target.properties[key];
                        if(type === Boolean) return !!(target.properties[key] && target.properties[key][0]);
 
                        if(!target.properties.hasOwnProperty(key)) return default_value;
                        if(typeof type === "function") return type(target.properties[key] && target.properties[key][0]);

                        return default_value
                    }
                }

                return target[prop];
            }
        })
    }

    let tools = {
        data: parsed,

        has(name){
            return parsed.has(name)
        },

        block(name){
            let list = parsed.get(name);

            if(!list || list.length === 0){
                return block_proxy({
                    isShadow: true,
                    name,
                    attributes: [],
                    properties: {}
                })
            }

            return block_proxy(list[0])
        },

        blocks(name){
            const blocks = parsed.get(name);
            return blocks? blocks.map(block_proxy): []
        },

        add(name, attributes, properties){
            if(!attributes) attributes = [[]];
            if(!properties) properties = {};

            for(let i = 0; i < attributes.length; i++) {
                if(!Array.isArray(attributes[i])) attributes[i] = [attributes[i]];
            }

            for(let key in properties) {
                if(!Array.isArray(properties[key]) || typeof properties[key] !== "boolean") properties[key] = [properties[key]];
            }

            if(!parsed.has(name)) parsed.set(name, []);

            parsed.get(name).push({
                name,
                attributes,
                properties
            })
        },

        forEach(name, callback){
            if(!parsed.has(name)) return;

            let list = parsed.get(name);

            let i = -1, _break = false;
            for(let block of parsed.get(name)){
                i++;

                if(_break) break;
                if(!block || typeof block !== "object") continue;

                if(block.name === name) callback(block_proxy(block), function(){
                    delete list[i]
                }, () => _break = true)
            }
        },

        // Deprecated
        valueOf(name){
            let block = tools.block(name);
            return block? block.attributes[0].join("") : null
        },

        stringify(){
            return stringify(parsed)
        },

        toString(){
            return tools.stringify()
        },

        merge(config){
            return parsed
            parsed = merge(parsed, config)
            return parsed
        }
    }
    
    return tools
}

let _exports = { parser_regex, parse, stringify, merge, configTools };

if(!globalThis.window) module.exports = _exports; else window.AkenoConfigParser = _exports;