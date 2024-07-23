let fs;
if(globalThis.require) fs = require("fs");



// This file contains a collection of parsers made for Akeno.
// That includes parsing configs, client code, and so on.


function replaceObjects(code, dynamicObjects = {}, fill = false) {
    /*
    
        This is a speical parser made for clientside JavaScript code, which allows the server to dynamically expose an object or multiple to the client.
        (Or for any other use where you need to expose an object to a string of JS code).

        If fill is set to false (most cases):
            Returns the code spliced as an array of strings, with references to the functions to call.
        
            Warning: Static values will get added directly to the code as a string (potentially causing caching problems if the value changes.).
            You must make the value a function in order to achieve a refresh each time.

        If fill is set to true:
            Returns the code as a string, now with replaced and filled references to the object, including function calls.

        Note: This parser automatically removes all comments!
        Warning: This parsed does NOT respect scopes (at this moment)! Be careful with the name of your objects - treat them as a global.
        Warning: Syntax like object["key"] is NOT supported, because no actual code evaluation is performed. You are only allowed to write full object paths.
        Warning: You cannot put variables into function calls. Only immediate values are supported (due to no-evaluation).

    */
    
    let dynamicObjectKeys = Object.keys(dynamicObjects),
        dynamicObjectFirstLetters = dynamicObjectKeys.map(key => key[0]),
        dynamicObjectSecondLetters = dynamicObjectKeys.map(key => key[1])
    ;

    let state = 0, current = "", result = [], string, parsingString, browsing, keyword, arguments = [];

    function push(){
        if(current.length < 1) return;
        result.push(current)
        current = ""
    }

    let acceptableStartingRegex = /[\n\s;,(]/,
        acceptableEndingRegex = /[\s\n.[;,)]/,
        whitespaceRegex = /[\s\n]/
    ;


    for(let i = 0; i < code.length; i++){
        let char = code[i];

        switch(state){
            case 0: // Normal
                if(acceptableStartingRegex.test(code[i - 1] || " ") && dynamicObjectFirstLetters.includes(char) && dynamicObjectSecondLetters.includes(code[i + 1])) {
                    let keyword = dynamicObjectKeys.find(key => code.substring(i, i + key.length) == key);

                    if(keyword && acceptableEndingRegex.test(code[i + keyword.length] || " ")){

                        let whiteSpace = false;
                        i += keyword.length

                        while(whitespaceRegex.test(code[i])){
                            whiteSpace = true
                            i++
                        } // Ignore whitespace
    
                        if(code[i] !== ".") {current += "{}"; if(whiteSpace) current += "\n"; current += code[i] || ""; continue};


                        while(whitespaceRegex.test(code[i + 1])) i++; // Ignore whitespace

                        string = ""
                        browsing = dynamicObjects[keyword]
                        state = 2
                        arguments = [];

                        continue
                    }
                }

                if(char == "'" || char == '"' || char == "`") {state = 1; current += char; string = char; continue}
                if((char == "/" && (code[i + 1] == "/" || code[i + 1] == "*"))) {state = 3; string = code[i + 1]; continue}

                current += char
            break

            case 1: // String
                if(char == string) {state = 0}
                current += char
            break

            case 2: // Keyword
                if(!/^[a-zA-Z0-9$_]+$/.test(char)){
                    while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace

                    keyword = string;

                    if(code[i] === ".") {

                        while(whitespaceRegex.test(code[i + 1])) i++; // Ignore whitespace

                        if(!browsing[keyword]){
                            throw `error: can't get ${keyword}`
                        }

                        browsing = browsing[keyword]
                        string = ""
                        keyword = ""
                        continue
                    }

                    if(code[i] === "(") {

                        while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace
                        state = 5

                        continue
                    }

                    state = 4
                    i -= 2
                    continue
                }

                string += char
            break

            case 3: // Comment
                if((string === "/" && char === "\n") || (string === "*" && char === "*" && code[i + 1] === "/")) {
                    if(string === "/") current += char;
                    if(string === "*") i++;

                    state = 0;
                    continue
                }
            break;

            case 4: // End of keyword, do something with it:
                state = 0
                
                if(typeof browsing[keyword] === "function"){
                    if(fill){
                        current += JSON.stringify(browsing[keyword](...arguments))
                        continue
                    }

                    push()
                    result.push({
                        call: browsing[keyword],
                        args: arguments
                    })
                    continue
                }

                current += JSON.stringify(browsing[keyword])
            break;

            case 5: // Arguments
                while(whitespaceRegex.test(code[i])) i++; // Ignore whitespace

                if(code[i] == "'" || code[i] == '"' || code[i] == "`") {state = 6; parsingString = ""; string = code[i]; continue}

                if(code[i] == "," || code[i] == ")") arguments.push(parsingString);

                if(code[i] == ")") {
                    state = 4
                    i--
                    continue
                }

            break;

            case 6: // Argument string

                if(char == string) {state = 5; continue}

                parsingString += char;

            break;
        }
    }

    push()

    return result
}

function parse(code, direct, sourcePath){
    code = code.trim();

    let tokens = [],
        chars = code.split(""),
        variables = {},

        regex = {
            singleton: /^(area|base|br|col|command|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/i
        }

        nest = 0,

        blockNest = 0,
        blockNestBlocks = [],
        blockNestingProperty = "",

        tagName = "",
        state = 0,  // 0 = default
                    // 1 = element tag (matching tagname)
                    // 2 = element tag (attributes)
                    // 3 = ignoring (eg. comments)
                    // 4 = matching keyword 
                    // 5 = matching keyword value
                    // 6 = inside a block
                    // 7 = ignoring, but writing (eg. script, style)
                    // 10 = string
                    // 11 = element tag (end tag)
                    // 12 = property value
        oldState = 0, // "previous" state
        current = "",

        commentType = "",

        stringType = "",
        string = "",

        rawKeywords = ["raw", "part"],
        rawElements = ["script", "style", "svg"],
        parsingRaw = false,
        parsingRawElement = false,
        rawContent = "",

        keyword = "",
        keywordValues = [[""]],
        keywordProperties = {},

        temporaryBlockRaw = "", // Contains raw value of the currently processed block - Used to return the text back to the source when parsing fails.

        propertyName = "",
        propertyValue = [""],

        attributeName = "",
        attributeValue = "",
        tagAttributes = {},
        parsingAttributeValue = false,
        attributeBroken = false,

        // Tags that should get a special token for attributes and its content, so that it can be dynamically modified in the parsed result
        specialTags = ["head", "page"],

        // Misc tags
        flag_single_value = false,
        flag_done_parsing_string = false,
        flag_arguments_set = false
    ;

    for(let i = 0; i < chars.length; i++){
        let char = chars[i];

        switch(state){
            case 0:
                // Standard location (text, etc)

                if(direct && char == "#"){
                    state = 3;
                    oldState = 0;
                    commentType = "block"
                    continue
                }

                // if(direct){
                //     if(/[a-zA-Z-_]/.test(char)){
                //         state = 4
                //         keyword += char
                //     }
                //     continue
                // }

                if(!direct) {
                    if(parsingRawElement && char == "<" && chars[i+1] === "/" && code.slice(i + 2, i + tagName.length + 2).startsWith(tagName)){
                        i++
                        state = 11
                        closingTagName = ""
                        parsingRawElement = false
                        continue
                    }
    
                    if((char == "<" || (chars[i + 1] == "/" && chars[i - 1] == "<")) && !parsingRawElement){
                        nest++;
                        state = 1
                        continue
                    }
                }

                if((char == "@" || (direct && /[a-zA-Z]/.test(char))) && /[a-zA-Z]/.test(chars[i + 1]) && !parsingRawElement){

                    // A new block starts! (probably)

                    state = 4
                    keyword = char
                    keywordValues = [[""]]
                    temporaryBlockRaw = char
                    flag_arguments_set = false
                    continue
                }

                if(direct) continue;
            break;

            case 1:
                // Parsing tagname

                if(char == " " || char == ">"){

                    // When element tagName is done parsing

                    attributeName = "";
                    attributeValue = "";
                    parsingAttributeValue = false;
                    attributeBroken = false;
                    tagAttributes = {};

                    let singleton = tagName.startsWith("!") || regex.singleton.test(tagName);
                    if(singleton){
                        nest--;
                    }

                    if(rawElements.includes(tagName)){
                        parsingRawElement = true
                    }

                    if(char == ">") {
                        state = 0;
                    } else {
                        state = 2;
                    }

                    tokens.push(current);
                    tokens.push({type: "tagStart", tag: tagName, attributes: {}, singleton})
                    current = "";

                } else if(char == "/") {

                    closingTagName = "";

                    nest--;
                    state = 11

                } else {

                    if(chars[i-1] == "<") tagName = ""
                    tagName += char;

                    if(tagName == "!--") {
                        state = 3
                        commentType = "html"
                        continue
                    }

                }

                continue
            break;

            case 2:
                // Parsing element attributes now

                if(parsingAttributeValue){
                    if(flag_done_parsing_string){
                        attributeValue += string;
                        flag_done_parsing_string = false
                    }

                    if(/["']/.test(char)){

                        stringType = char
                        oldState = 2;
                        state = 10;
                        string = "";
                        flag_done_parsing_string = true;
                        continue

                    } else if((char == " " && (attributeValue.length > 0 || flag_done_parsing_string)) || char == ">") {

                        i--;
                        parsingAttributeValue = false
                        tagAttributes[attributeName] = attributeValue
                        attributeName = "";

                    }else{
                        if(/[\s\n\t]/.test(char)) {
                            continue
                        }
                        attributeValue += char
                    }
                } else {
                    if(char == " " || char == "=" || char == ">"){
                        attributeValue = "";
                        string = "";

                        if(attributeName.length > 0){
                            tagAttributes[attributeName] = ""

                            if(char == "=") {
                                parsingAttributeValue = true
                            }

                            if(char == " ") {
                                attributeBroken = true
                            }
                        }

    
                        if(char == ">"){
                            tokens[tokens.length - 1].attributes = tagAttributes;
                            current = ""
                            state = 0;
                            continue
                        }
                    } else if(!/[\s\t\n>"'=/]/.test(char)){
                        if(attributeBroken){
                            attributeBroken = false
                            attributeName = ""
                        }

                        attributeName += char
                    }
                }

                continue
            break;

            case 3:
                // Inside a comment

                switch(commentType){
                    case "html":
                        // TODO: Its obvious what has to be done :)
                        if(char == ">" && chars[i - 1] == "-" && chars[i - 2] == "-"){
                            state = 0;
                        }
                    break;
                    case "block":
                        if(char == "\n"){
                            state = oldState;
                            i--;
                        }
                    break
                }

                continue
            break;

            case 4:
                // Parsing keyword

                temporaryBlockRaw += char;

                if(/[a-zA-Z-_]/.test(char) && !flag_arguments_set){

                    keyword += char
                    continue

                } else if(/[\s({]/.test(char) && char !== "\n") {

                    if(char == "("){
                        if(flag_arguments_set){

                            state = 0
                            current += temporaryBlockRaw
                            continue

                        }
                        
                        state = 5
                        flag_arguments_set = true

                        continue
                    }
                    
                    if(char == "{"){
                        if(rawKeywords.includes(keyword.replace("@", ""))) {
                            parsingRaw = true
                            rawContent = ""
                        }
                        state = 6
                        continue
                    }

                    continue

                } else if(char == ";" || char == "}") {

                    state = 6
                    flag_single_value = true
                    i--

                } else {

                    // If the match failed again, treat it as regular text
                    state = 0
                    current += temporaryBlockRaw

                }
        
                continue
            break;

            case 5:
                // Parsing block value (aka arguments)

                temporaryBlockRaw += char;

                if(string) {
                    keywordValues[keywordValues.length - 1].push(string, "")
                    string = ""
                }

                if(char == ")"){
                    state = 4;
                    continue
                }

                if(char == ","){
                    keywordValues.push([""]);
                    continue
                }

                if(/["']/.test(char)){
                    stringType = char
                    oldState = 5;
                    state = 10;
                    string = "";
                    continue
                }

                if(!/[\s\n\t]/.test(char)) keywordValues[keywordValues.length - 1][keywordValues[keywordValues.length - 1].length - 1] += char;

                continue
            break;

            case 6:
                // Parsing the inside of a block

                if(char == "}" || flag_single_value){

                    if(blockNest > 0){
                        blockNest--
                    } else {
                        state = 0;
    
                        tokens.push(current)
                        tokens.push({type: "block", key: keyword.replace("@", ""), values: keywordValues.map(value => value.filter(garbage => garbage)), ...parsingRaw? {content: parse(rawContent, false, sourcePath)} : {properties: keywordProperties}})
    
                        current = ""
                        keyword = ""
                        keywordValues = [[""]]
                        keywordProperties = {}
                        propertyName = ""
                        blockNestingProperty = ""
                        propertyValue = [""]
                        parsingRaw = false
    
                        flag_single_value = false
                    }
                    
                    continue
                }

                if(parsingRaw) {
                    rawContent += char
                    continue;
                }

                if(char == ";" && propertyName){
                    ;(blockNest? blockNestBlocks[blockNest] : keywordProperties)[propertyName.replace("!", "")] = !propertyName.startsWith("!");
                    propertyName = ""
                    continue
                }

                if(char == "#"){
                    state = 3;
                    oldState = 6;
                    commentType = "block"
                    continue
                }

                if(/[a-zA-Z-_!0-9/]/.test(char)){

                    propertyName += char

                } else if(char == ":") {

                    // Go to parse a property value;
                    state = 12

                } else if(char == "{") {
                    continue; // TODO: This needs some more testing

                    // A nested object;
                    blockNestingProperty = propertyName;

                    ;(blockNest? blockNestBlocks[blockNest] : keywordProperties)[propertyName] = {}
                    propertyName = "";

                    blockNest ++;
                    blockNestBlocks.push({});

                    state = 6
                }

                continue
            break;

            case 10:
                // Parsing a string

                if(char == stringType){
                    state = oldState;
                    continue
                }

                string += char
                continue
            break;

            case 11:
                // Matching a closing tag

                if(char == ">"){
                    parsingRawElement = false
                    state = 0;

                    // if(closingTagName !== tagName && !regex.singleton.test(tagName)){
                    //     console.log("Invalid tag closure", closingTagName, tagName);
                    //     current = ""
                    //     continue
                    // }

                    tokens.push(current)
                    tokens.push({type: "tagEnd", tag: closingTagName})
                    current = ""
                    tagName = ""
                    // current += (closingTagName == "page"? "body": closingTagName) + ">";
                }

                if(char == " "){
                    continue
                }

                closingTagName += char
                continue
            break;

            case 12:
                // Parsing a property value

                if(string) {
                    propertyValue.push(string, "")
                    string = ""
                }

                if(char == ";" || char == "}"){
                    ;(blockNest? blockNestBlocks[blockNest][blockNestingProperty] : keywordProperties)[propertyName] = propertyValue.filter(garbage => garbage);
                    propertyName = "";
                    propertyValue = [""];

                    state = 6;
                    i--
                    continue
                }

                if(char == ","){
                    propertyValue.push("");
                    continue
                }

                if(/["']/.test(char)){
                    stringType = char
                    oldState = 12;
                    state = 10;
                    string = "";
                    continue
                }

                if(char == "#"){
                    state = 3;
                    oldState = 12;
                    commentType = "block"
                    continue
                }

                if(!/[\s\n\t]/.test(char)) propertyValue[propertyValue.length - 1] += char;

                continue
            break;
        }

        current += char
    }

    tokens = tokens.filter(garbage => garbage);
    if(current) tokens.push(current)

    if(direct){
        // When not parsing any DOM, only configuration files
        return tokens;
    }

    let level = 0, path = [];
    function parseRecursive(start) {
        let result = [],
            processed = 0,
            skip = 0
        ;

        function quit(){
            path.pop()
            return [processed,  result]
        }

        for (let i = 0; i < tokens.length - start; i++){
            let globalI = start + i,
                token = tokens[globalI]
            ;

            processed++;

            if(skip > 0){
                skip--
                // if(globalI + skip >= (tokens.length -1)){
                //     return quit()
                // }
                continue
            }

            if (typeof token == "object") {
                switch(token.type.toLowerCase()){

                    case "tagstart":
                        token.type = "element"
                        if(!token.singleton){
                            level++;
                            path.push(token.tag)
                            let scope = parseRecursive(globalI + 1);

                            skip = scope[0]
                            token.content = scope[1]
                        }

                        result.push(token)
                    break;

                    case "tagend":
                        if(path.at(-1) == token.tag) {
                            level--
                            return quit()
                        }
                    break;

                    default:
                        if(typeof token === "object" && token.key === "import"){
                            if(!sourcePath){
                                console.warn("Invalid import statement in document; sourcePath must be specified")
                            } else {
                                for(let file of token.values){
                                    try {
                                        result.push(...parse(fs.readFileSync(sourcePath + "/" + file, "utf8"), false, sourcePath))
                                    } catch {
                                        console.warn("Failed to import: importing " + sourcePath + "/" + file)
                                    }
                                }
                            }
                        } else if(typeof token === "object" && token.key === "importRaw"){
                            if(!sourcePath){
                                console.warn("Invalid import-raw statement in document; sourcePath must be specified")
                            } else {
                                for(let file of token.values){
                                    try {
                                        let doEscape = !!token.properties.escape, content = fs.readFileSync(sourcePath + "/" + file, "utf8");
                                        result.push(doEscape? content.replace(/'/g, '&#39;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : content)
                                    } catch (e) {
                                        console.warn("Failed to import-raw: importing " + sourcePath + "/" + file, e.toString())
                                    }
                                }
                            }
                        } else {
                            result.push(token)
                        }
                    break;
                }
            } else {
                let value = (token.startsWith(" ")?" ":"") + token.trim() + (token.endsWith(" ")?" ":"")
                if(value) result.push(value)
            }
        }

        return quit()
    }

    return parseRecursive(0)[1];
}

function stringify(config){
    let result = "";

    for(let block of config){
        if(!block) continue;

        result += `${
            // Block name
            block.key
        }${
            // Values
            block.values.length > 1 || block.values[0].length > 0? ` (${block.values.map(value => value.map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(" ")).join(", ") })` : ""
        }${
            // Properties
            Object.keys(block.properties).length > 0? ` {\n    ${Object.keys(block.properties).map(key => `${key}${block.properties[key] === true? "": `: ${block.properties[key].map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(", ")}`};`).join("\n    ")}\n}` : ";"
        }\n\n`
    }
    
    return result;
}

function merge(base, newConfig){
    const mergedConfig = [];

    const findBlockIndex = (config, key) => config.findIndex(
        block => block.key === key && (block.values.length === 0 || (block.values.length === 1 && block.values[0].length === 0))
    );

    base.forEach(block => mergedConfig.push({ ...block }));

    newConfig.forEach(newBlock => {
        if(!newBlock) return;

        const { key, values: newValues, properties: newProperties } = newBlock;

        // Check if the block with the same key and empty values already exists in the merged config
        const baseBlockIndex = findBlockIndex(mergedConfig, key);

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
    if(!Array.isArray(parsed)) throw new Error("You must provide a parsed config as an array.");

    let tools = {
        data: parsed,

        has(name){
            for(let block of parsed){
                if(block.key === name) return true;
            }
            return false;
        },

        block(name){
            return parsed.find(block => block && block.key == name)
        },

        blocks(name){
            return parsed.filter(block => block && block.key == name)
        },

        add(name, values, properties){

            if(!values) values = [[]];
            if(!properties) properties = {};

            for(let i = 0; i < values.length; i++) {
                if(!Array.isArray(values[i])) values[i] = [values[i]];
            }

            for(let key in properties) {
                if(!Array.isArray(properties[key]) || typeof properties[key] !== "boolean") properties[key] = [properties[key]];
            }

            parsed.push({
                type: "block",
                key: name,
                values,
                properties
            })
        },

        forEach(name, callback){
            let i = -1, _break = false;
            for(let block of parsed){
                i++;

                if(!block || typeof block !== "object") continue;
                if(_break) break;

                if(block.key === name) callback(block, function(){
                    delete parsed[i]
                }, () => _break = true)
            }

            // parsed = parsed.filter(garbage => garbage)
        },

        valueOf(name){
            let block = tools.block(name);
            return block? block.values[0].join("") : null
        },

        stringify(){
            return stringify(parsed)
        },

        toString(){
            return tools.stringify()
        },

        merge(config){
            parsed = merge(parsed, config)
            return parsed
        }
    }
    
    return tools
}

let _exports = {parse, stringify, merge, configTools, replaceObjects};

if(!globalThis.window) module.exports = _exports; else window.AkenoConfigParser = _exports;