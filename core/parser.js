const fs = require("fs");
const { xxh32 } = require("@node-rs/xxhash");


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

            } else parseAt(currentPosition +1)

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

                if(char === "#") { revert_type = type; type = 5; continue }

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
                    return function (key, type){
                        if(block.isShadow) return null;

                        if(type === Array || type === null || type === undefined) return target.properties[key];
                        if(type === Boolean) return !!(target.properties[key] && target.properties[key][0]);
                        if(typeof type === "function") return type(target.properties[key] && target.properties[key][0]);

                        return null
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
            return parsed.get(name).map(block => block_proxy)
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

// function assignObjects(code, dynamicObjects = {}, fill = false) {
//     /*

//         Shouldnt be used
    
//         This is a parser made for clientside JavaScript code, which allows the server to dynamically expose an object or multiple to the client.
//         (Or for any other use where you need to expose an object to a string of JS code).

//         If fill is set to false (most cases):
//             Returns the code spliced as an array of strings, with references to the functions to call.
        
//             Warning: Static values will get added directly to the code as a string (potentially causing caching problems if the value changes.).
//             You must make the value a function in order to achieve a refresh each time.

//         If fill is set to true:
//             Returns the code as a string, now with replaced and filled references to the object, including function calls.

//         Note: This parser automatically removes all comments!
//         Warning: This does not respect scopes! Be careful with the name of your objects - treat them as a global.
//         Warning: Syntax like object["key"] is NOT supported, because no actual code evaluation is performed. You are only allowed to write full object paths.
//         Warning: You cannot put variables into function calls. Only immediate values are supported (due to no-evaluation).

//     */

//     let dynamicObjectKeys = Object.keys(dynamicObjects),
//         dynamicObjectFirstLetters = dynamicObjectKeys.map(key => key[0]),
//         dynamicObjectSecondLetters = dynamicObjectKeys.map(key => key[1])
//     ;

//     let state = 0, current = "", result = [], string, parsingString, browsing, keyword, arguments = [];

//     function push(){
//         if(current.length < 1) return;
//         result.push(current)
//         current = ""
//     }

//     let acceptableStartingRegex = /[\n\s;,(]/,
//         acceptableEndingRegex = /[\s\n.[;,)]/,
//         whitespaceRegex = /[\s\n]/
//     ;


//     for(let i = 0; i < code.length; i++){
//         let char = code[i];

//         switch(state){
//             case 0: // Normal
//                 if(acceptableStartingRegex.test(code[i - 1] || " ") && dynamicObjectFirstLetters.includes(char) && dynamicObjectSecondLetters.includes(code[i + 1])) {
//                     let keyword = dynamicObjectKeys.find(key => code.substring(i, i + key.length) == key);

//                     if(keyword && acceptableEndingRegex.test(code[i + keyword.length] || " ")){

//                         let whiteSpace = false;
//                         i += keyword.length

//                         while(whitespaceRegex.test(code[i])){
//                             whiteSpace = true
//                             i++
//                         } // Ignore whitespace
    
//                         if(code[i] !== ".") {current += "{}"; if(whiteSpace) current += "\n"; current += code[i] || ""; continue};


//                         while(whitespaceRegex.test(code[i + 1])) i++; // Ignore whitespace

//                         string = ""
//                         browsing = dynamicObjects[keyword]
//                         state = 2
//                         arguments = [];

//                         continue
//                     }
//                 }

//                 if(char == "'" || char == '"' || char == "`") {state = 1; current += char; string = char; continue}
//                 if((char == "/" && (code[i + 1] == "/" || code[i + 1] == "*"))) {state = 3; string = code[i + 1]; continue}

//                 current += char
//             break

//             case 1: // String
//                 if(char == string) {state = 0}
//                 current += char
//             break

//             case 2: // Keyword
//                 if(!/^[a-zA-Z0-9$_]+$/.test(char)){
//                     while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace

//                     keyword = string;

//                     if(code[i] === ".") {

//                         while(whitespaceRegex.test(code[i + 1])) i++; // Ignore whitespace

//                         if(!browsing[keyword]){
//                             throw `error: can't get ${keyword}`
//                         }

//                         browsing = browsing[keyword]
//                         string = ""
//                         keyword = ""
//                         continue
//                     }

//                     if(code[i] === "(") {

//                         while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace
//                         state = 5

//                         continue
//                     }

//                     state = 4
//                     i -= 2
//                     continue
//                 }

//                 string += char
//             break

//             case 3: // Comment
//                 if((string === "/" && char === "\n") || (string === "*" && char === "*" && code[i + 1] === "/")) {
//                     if(string === "/") current += char;
//                     if(string === "*") i++;

//                     state = 0;
//                     continue
//                 }
//             break;

//             case 4: // End of keyword, do something with it:
//                 state = 0
                
//                 if(typeof browsing[keyword] === "function"){
//                     if(fill){
//                         current += JSON.stringify(browsing[keyword](...arguments))
//                         continue
//                     }

//                     push()
//                     result.push({
//                         call: browsing[keyword],
//                         args: arguments
//                     })
//                     continue
//                 }

//                 current += JSON.stringify(browsing[keyword])
//             break;

//             case 5: // Arguments
//                 while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace

//                 if(code[i] == "'" || code[i] == '"' || code[i] == "`") {state = 6; parsingString = ""; string = code[i]; continue}

//                 if(code[i] == "," || code[i] == ")") arguments.push(parsingString);

//                 if(code[i] == ")") {
//                     state = 4
//                     i--
//                     continue
//                 }

//             break;

//             case 6: // Argument string

//                 if(char == string) {state = 5; continue}

//                 parsingString += char;

//             break;
//         }
//     }

//     push()

//     return result
// }

// function replaceObjects(code, replacements) {

//     // FIXME: Needs improved parsing logic to choose when to replace

//     let keys = Object.keys(replacements);

//     if(!replacements || typeof replacements !== "object" || keys.length < 1) return code;

//     let output = '', i = -1, length = code.length;

//     // Optimization
//     let firstIndex = keys.map(key => key[0]);

//     let insideString = false, stringChar = '', insideSingleLineComment = false, insideMultiLineComment = false, insideRegex = false, insideTemplateStringInsert = false;

//     while (i < length) {
//         i++

//         let char = code[i];
//         let nextChar = code[i + 1];

//         if(!char) break;

//         if (insideString) {
//             if (char === stringChar && code[i - 1] !== '\\') {

//                 insideString = false;

//             }
            
//             // else if(stringChar === "`" && char === "$" && nextChar === "{" && code[i - 1] !== '\\'){

//             //     insideTemplateStringInsert = true
//             //     output += "${"
//             //     i++
//             //     continue

//             // }

//             output += char;

//             continue
//         }

//         // if(insideTemplateStringInsert){
//         //     if(char === "}"){
//         //         // FIXME: Bracket matching needed :(

//         //         insideTemplateStringInsert = false
//         //         output += "}";
//         //         continue
//         //     }

//         //     // Also match in template strings
//         //     if(find()) continue;

//         //     output += char;
//         //     continue
//         // }

//         if (insideRegex) {
//             if (char === "/" && code[i - 1] !== '\\') {
//                 insideRegex = false;
//             }

//             output += char;
//             continue
//         }

//         if (insideSingleLineComment) {
//             if (char === '\n') {
//                 insideSingleLineComment = false;
//             }
//             output += char;

//             continue
//         }

//         if (insideMultiLineComment) {
//             if (char === '*' && nextChar === '/') {
//                 insideMultiLineComment = false;
//                 output += '*/';
//                 i++
//             } else {
//                 output += char;
//             }

//             continue
//         }

//         if (char === '"' || char === "'" || char === '`') {
//             insideString = true;
//             stringChar = char;
//             output += char;

//             continue
//         }

//         if (char === '/') {

//             if(nextChar === '/'){
//                 insideSingleLineComment = true;
//                 output += '//';
//                 i++
//                 continue
//             }

//             if(nextChar === '*'){
//                 insideMultiLineComment = true;
//                 output += '/*';
//                 i++
//                 continue
//             }

//             insideRegex = true;
//             output += '/' + nextChar;
//             i++

//             continue
//         }

//         function find(){
//             let find = firstIndex.includes(char) && keys.find(key => code.substring(i, i + key.length) === key);
    
//             if (
//                 find &&
//                 !/[a-zA-Z0-9_$]/.test(code[i - 1]) && // Make sure it's not part of a larger identifier
//                 !/[a-zA-Z0-9_$:]/.test(code[i + find.length])   // Make sure it's not part of a larger identifier
//             ) {
//                 output += replacements[find];
//                 i += find.length - 1
    
//                 return true
//             }

//             return false
//         }

//         if(find()) continue;

//         output += char;
//     }

//     return output;
// }


let _exports = { parser_regex, parse, stringify, merge, configTools };

if(!globalThis.window) module.exports = _exports; else window.AkenoConfigParser = _exports;