const version = "1.2.3";

const States = {
    blockSearch: -1,
    blockName: 0,
    attribute: 1,
    beforeProperties: 2,
    keywordSearch: 3,
    keyword: 4,
    arbitraryValue: 5,
    writeKeywordValue: 6
}


const Types = {
    default: 0,
    keyword: 1,
    string: 2,
    plain: 3,
    plaintext: 4,
    comment: 5,
}


const Match = {
    keyword(code) {
        return(
            (code >= 48 && code <= 57) || // 0-9
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 || // _
            code === 45 || // -
            code === 46    // .
        )
    },

    plain_value(code) {
        return (
            (code >= 48 && code <= 57) || // 0-9
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 || // _
            code === 45 || // -
            code === 46 || // .
            code === 42 || // *
            code === 58 || // :
            code === 60 || // <
            code === 62 || // >
            code === 33 || // !
            code === 63 || // ?
            code === 64 || // @
            code === 35 || // #
            code === 37 || // %
            code === 38 || // &
            code === 126 || // ~
            code === 47    // /
        )
    },

    stringChar(code) {
        return code === 34 || code === 39 || code === 96;
    },

    whitespace(code) {
        return code === 32 || code === 9 || code === 10 || code === 13;
    },

    digit(str) {
        let dotSeen = false;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code === 46) {
                if (dotSeen) return false;
                dotSeen = true;
            } else if (code < 48 || code > 57) {
                return false;
            }
        }
        return true;
    },

    number(code) {
        return code >= 48 && code <= 57;
    },

    // From: 64
    initiator: "@"
}


const Chars = {
    "\n": 10,
    "(": 40,
    ")": 41,
    "{": 123,
    "}": 125,
    ",": 44,
    ":": 58,
    ";": 59,
    "#": 35,
    "[": 91,
    "]": 93,
    "\\": 92
}


/**
 * @description This is a currently unimplemented class.
 */

class StringView {
    constructor(buffer, start = 0, end = buffer.length){
        this.buffer = buffer;
        this.start = start;
        this.end = end;
        this.cached = null;
    }

    charCodeAt(index){
        index += this.start
        if (index < this.start || index >= this.end) return NaN
        return this.buffer[index]
    }

    charAt(index){
        const char = this.charCodeAt(index);
        return isNaN(char)? "": String.fromCharCode(char)
    }

    slice(start, end){
        start = Math.max(this.start + start, this.start);
        end = Math.min(this.start + (end ?? this.end), this.end);
        return new StringView(this.buffer, start, end);
    }

    substring(start, end){
        return this.slice(start, end);
    }

    data(){
        return (this.start === 0 && this.end === this.buffer.length)? this.buffer : this.buffer.subarray(this.start, this.end);
    }

    toString(cache = true){
        if(cache && this.cached) return this.cached;

        if (this.buffer instanceof Uint8Array) return this.cached = StringView.decoder.decode(this.data());
        if (this.buffer instanceof Uint16Array) return this.cached = String.fromCharCode(...this.data());
        return this.cached = this.data().toString();
    }
}


/**
 * @description This class holds the current position and state in the parsed buffer.
 */

class ParserState {
    constructor(options, state = {}){
        this.options = options
        this.offset = typeof state.offset === "number"? state.offset: -1;
        this.collector = state.collector || null;
        this.index = this.offset
        this.recursed = 0
        this.closedAtLevel = -1

        this.recursionLevels = null;

        this.blockState = new BlockState(this);
    }

    fastForwardTo(char){
        const index = this.chunk.indexOf(char, this.index +1);

        if(index === -1) {
            this.index = this.chunk.length;
            return false
        }

        this.index = index -1
        return true
    }

    write(chunk){
        if(this.chunk) throw ".write called more than once: Sorry, streaming is currently not supported. Please check for latest updates.";
        this.chunk = chunk

        if(this.options.embedded){

            this.offset = chunk.indexOf(Match.initiator);
            
            // Nothing to do, so just skip parsing entirely and return everything as text
            if(this.offset === -1) return this.options.onText && this.options.onText(chunk);

            if(this.options.onText) this.options.onText(chunk.substring(0, this.offset));

        } else {
            this.offset = -1;
        }

        this.index = this.offset
        this.blockState.parsingValueStart = this.index +1;
        this.blockState.parsingValueLength = 0;

        parseAt(this, this.blockState)
        return this
    }

    end(){
        if(this.chunk) {
            this.chunk = null
        }

        this.recursionLevels = null
        this.recursed = 0
        this.blockState = null
        return this
    }
}

/**
 * @description Holds information on the current block being parsed. This works in layers - each instance of BlockState handles a full recursion layer. Eg. if the code has up to 4 nested layers, up to 4 instances of BlockState will be used for the full code.
 */

class BlockState {
    constructor(parent){
        this.parent = parent
        this.clear()
    }

    clear(returnBlock = false){
        const embedded = this.parent.options.embedded && this.parent.recursed === 0;

        this.parsing_state = embedded? States.blockName: States.blockSearch;
        this.next_parsing_state = 0;
        this.parsedValue = null;
        this.valueTarget = null;
        this.type = embedded? 1: 0;
        this.parsingValueStart = this.parent.index;
        this.parsingValueLength = 0;
        this.parsingValueSequenceBroken = false;
        this.last_key = null;

        this.blockShorthandSyntax = false;

        this.quit = false;

        if(returnBlock){

            const block = this.block

            this.block = {
                name: null,
                attributes: [],
                properties: {}
            }

            return Block.from(block);

        } else if(this.block) {

            this.block.name = null
            this.block.attributes.length = 0
            this.block.properties = {}

        } else {
            this.block = {
                name: null,
                attributes: [],
                properties: {}
            }
        }
    }

    close(cancel, message){
        const recursive = this.parent.recursed !== 0;
        if(recursive) {
            this.parent.recursed --;
        }

        if(!cancel) {

            const block = this.clear(true);

            // No error, send block for processing
            if(!recursive) {

                if(this.parent.collector) {
                    if(this.parent.options.asArray) {
                        this.parent.collector.push(block)
                    } else if(this.parent.options.asLookupTable) {
                        if(!this.parent.collector.has(block.name)) {
                            this.parent.collector.set(block.name, []);
                        }

                        this.parent.collector.get(block.name).push(block);
                    }
                }

                if(this.parent.options.onBlock) this.parent.options.onBlock(block);

            } else {
                this.parentBlock.block.properties[this.parentBlock.last_key] = block;
            }

        } else {

            this.clear();

            const error = new Error("[Parser Syntax Error] " + (message || "") + "\n  (at character " + this.parent.index + ")");

            if(this.parent.options.strict) this.parent.index = this.parent.chunk.length; // Skip to the end of the file
            if(typeof this.parent.options.onError === "function") this.parent.options.onError(error);

        }

        if(recursive) {

            this.quit = true;

        } else if(this.parent.options.embedded) {

            const start = this.parent.index;
            const found = this.parent.fastForwardTo(Match.initiator);

            if(this.parent.options.onText) this.parent.options.onText(this.parent.chunk.slice(start +1, this.parent.index +1));

            if(found){
                this.parent.index++;
                this.parsingValueStart = this.parent.index +1
                // this.blockState.parsingValueStart = this.index +1;
                this.parsingValueLength = 0;
            }
        }
    }

    value_start(length = 0, positionOffset = 0, _type = null){
        if(_type !== null) this.type = _type;
        this.parsingValueStart = this.parent.index + positionOffset;
        this.parsingValueLength = length;
        this.parsingValueSequenceBroken = false;
        if(_type === Types.keyword) this.parsedValue = null;
    }

    get_value(){
        return this.parent.chunk.slice(this.parsingValueStart, this.parsingValueStart + this.parsingValueLength);
    }

    begin_arbitrary_value(returnTo){
        this.parsedValue = null
        this.parsing_state = States.arbitraryValue
        this.type = Types.default
        this.next_parsing_state = returnTo
        this.valueTarget = null;
    }
}

/**
 * @description Resume parsing from a specific state.
 * @param {ParserState} state
 * @param {BlockState} blockState
 * @returns {void}
 */

function parseAt(state, blockState){
    if(state.index >= state.chunk.length -1) return;

    while(++state.index < state.chunk.length){

        // Go up in the stack
        if(blockState.quit) {
            const parent = blockState.parentBlock;
            blockState.quit = false
            blockState.parentBlock = null;

            blockState = parent
        }

        if(blockState.type === Types.plain){
            if (!Match.plain_value(state.chunk.charCodeAt(state.index))) {
                let parsed = blockState.get_value();
                if(parsed === "true") parsed = true;
                else if(parsed === "false") parsed = false;
                else if(Match.digit(parsed)) parsed = parseFloat(parsed);

                if(Array.isArray(blockState.valueTarget)) {

                    blockState.valueTarget.push(parsed);

                } else if(state.chunk.charCodeAt(state.index) === Chars["["]) {

                    blockState.parsedValue = {name: parsed, values: []};
                    blockState.valueTarget = blockState.parsedValue.values;
                    
                    state.index ++;

                } else {
                    blockState.parsedValue = parsed;
                    blockState.parsing_state = blockState.next_parsing_state;
                }

                blockState.type = Types.default
            } else {
                blockState.parsingValueLength++
                continue
            }
        }


        const charCode = state.chunk.charCodeAt(state.index);


        // Skip whitespace if possible.
        if(blockState.type === Types.default && Match.whitespace(charCode)){
            continue
        }

        // Skip comments
        if(charCode === Chars["#"]) {
            state.fastForwardTo("\n")
            continue
        }

        switch(blockState.parsing_state){

            // Searching for the beginning of a block
            case States.blockSearch:
                if(!Match.keyword(charCode)) {
                    blockState.close(true, "Unexpected character " + String.fromCharCode(charCode));
                    continue
                }

                blockState.parsing_state = States.blockName;
                blockState.type = Types.keyword;
                blockState.parsingValueStart = state.index
                blockState.parsingValueLength = 1
                break


            // Beginning of a block name
            case States.blockName:
                if(!Match.keyword(charCode)){

                    blockState.type = Types.default;

                    const name = blockState.get_value();
                    blockState.block.name = name;

                    if(Match.whitespace(charCode)) {
                        blockState.parsingValueSequenceBroken = true;
                        break;
                    }

                    if(charCode === Chars["("]){
                        const nextChar = state.chunk.charCodeAt(state.index +1);

                        if(nextChar === Chars[")"]){
                            blockState.type = Types.default;
                            blockState.parsing_state = States.beforeProperties;
                            state.index ++;
                        } else blockState.begin_arbitrary_value(States.attribute);

                    }

                    else if (charCode === Chars["{"]) {
                        blockState.parsing_state = States.keywordSearch;
                    }

                    else if (charCode === Chars[";"]) {
                        blockState.close();
                        break;
                    }

                    else blockState.close(true, "Unexpected character " + String.fromCharCode(charCode))

                } else if(blockState.parsingValueSequenceBroken) {
                    blockState.blockShorthandSyntax = true;
                    blockState.parsing_state = States.keyword;
                    blockState.value_start(1, 0, Types.keyword);
                } else blockState.parsingValueLength ++;
                break;

            // Before a block
            case States.beforeProperties:
                if(charCode === Chars[";"]) {
                    blockState.block.isCall = true;
                    blockState.close()
                    continue
                }

                if(charCode === Chars["{"]) {
                    blockState.blockShorthandSyntax = false;
                    blockState.parsing_state = States.keywordSearch
                    continue
                }

                if(Match.keyword(charCode)) {
                    blockState.blockShorthandSyntax = true;
                    blockState.parsing_state = States.keyword;
                    blockState.value_start(1, 0, Types.keyword);
                    continue
                }

                blockState.close(true);
                continue


            // Looking for a keyword
            case States.keywordSearch:
                if(charCode === Chars["}"]){
                    blockState.close()
                    continue
                }

                if(charCode === Chars[";"]){
                    continue
                }

                if(!Match.keyword(charCode)) { blockState.close(true); continue };

                blockState.parsing_state = States.keyword

                blockState.value_start(1, 0, Types.keyword)
                break


            // Keyword
            case States.keyword:
                if(!Match.keyword(charCode)){
                    if(Match.whitespace(charCode)) {
                        blockState.parsingValueSequenceBroken = true
                        break
                    }

                    const key = blockState.get_value()

                    blockState.type = Types.default

                    if(charCode === Chars[";"] || charCode === Chars["}"]) {

                        blockState.block.properties[key] = [true]
                        blockState.parsing_state = States.keywordSearch

                        if(charCode === Chars["}"] || blockState.blockShorthandSyntax) {
                            blockState.close()
                            continue
                        }

                    } else if (charCode === Chars[":"]) {

                        blockState.last_key = key
                        blockState.begin_arbitrary_value(States.writeKeywordValue)

                    } else if (charCode === Chars["{"] || charCode === Chars["("]) {

                        state.recursed ++;

                        if(!state.recursionLevels) state.recursionLevels = [];

                        let level = state.recursionLevels[state.recursed];
                        if(!level) {
                            level = new BlockState(state);
                            state.recursionLevels[state.recursed] = level;
                        }

                        blockState.last_key = key
                        blockState.parsing_state = States.keywordSearch
                        
                        level.parsing_state = charCode === Chars["{"]? States.keywordSearch: States.blockName;
                        level.type = Types.default

                        if(charCode === Chars["("]) state.index --;

                        level.parentBlock = blockState
                        blockState = level

                    } else { blockState.close(true); continue };
                } else {
                    if(blockState.parsingValueSequenceBroken) {
                        blockState.close(true)
                        continue
                    }

                    blockState.parsingValueLength ++
                }

                break;


            case States.writeKeywordValue:
                if(blockState.parsedValue !== null){
                    if(blockState.block.properties[blockState.last_key]) {
                        if(!Array.isArray(blockState.block.properties[blockState.last_key])) {
                            blockState.block.properties[blockState.last_key] = [blockState.block.properties[blockState.last_key]]
                        }

                        blockState.block.properties[blockState.last_key].push(blockState.parsedValue)
                    } else {
                        blockState.block.properties[blockState.last_key] = blockState.parsedValue
                    }

                    blockState.parsedValue = null
                }

                if(charCode === Chars[","]){

                    blockState.type = Types.default
                    blockState.parsing_state = States.arbitraryValue;

                } else if(charCode === Chars["}"] || (charCode === Chars[";"] && blockState.blockShorthandSyntax)){

                    blockState.close()
                    continue

                } else if(charCode === Chars[";"]){

                    blockState.type = Types.default
                    blockState.parsing_state = States.keywordSearch;

                } else {

                    state.index --;
                    blockState.type = Types.default
                    blockState.parsing_state = States.arbitraryValue;

                    // blockState.close(true, "Unexpected character in keyword value" + String.fromCharCode(charCode))
                }
                break;


            case States.attribute:
                if(blockState.parsedValue !== null) {
                    blockState.block.attributes.push(blockState.parsedValue);
                    blockState.parsedValue = null;
                }

                blockState.type = Types.default;

                if(charCode === Chars[")"]) blockState.parsing_state = States.beforeProperties;
                if(charCode === Chars[","]) blockState.begin_arbitrary_value(States.attribute);
                break;


            // Beginning of a value
            case States.arbitraryValue:
                // TODO: Both attributes and values should be handled by the same state (all values)

                if(Array.isArray(blockState.valueTarget)){
                    if(charCode == Chars[","]) {
                        break
                    }

                    if(charCode == Chars["]"]) {
                        blockState.parsing_state = blockState.next_parsing_state;
                        break
                    }
                } else {
                    if(charCode == Chars["["]) {
                        blockState.valueTarget = blockState.parsedValue = [];
                        break
                    }
                }


                if(Match.stringChar(charCode)){

                    // Match strings
                    // TODO: Remove escape characters from the string

                    const stringChar = String.fromCharCode(charCode);

                    blockState.value_start(0, 1)

                    state.fastForwardTo(stringChar);

                    // Do not remove the if statement, it is a performance improvement
                    if(state.chunk.charCodeAt(state.index) === Chars["\\"]){
                        while(state.chunk.charCodeAt(state.index) === Chars["\\"] && state.index < state.chunk.length -1) {
                            state.index++;
                            state.fastForwardTo(stringChar);
                        }
                    }

                    blockState.parsingValueLength = state.index - blockState.parsingValueStart +1;
                    
                    if(Array.isArray(blockState.valueTarget)) {
                        blockState.valueTarget.push(blockState.get_value());
                    } else {
                        blockState.parsedValue = blockState.get_value();
                        blockState.parsing_state = blockState.next_parsing_state;
                    }

                    state.index++;

                } else if (Match.plain_value(charCode)){

                    // Match plain values
                    blockState.value_start(1, 0, Types.plain)

                } else if (charCode === Chars["}"]){

                    blockState.parsing_state = blockState.next_parsing_state;
                    state.index--;

                } else blockState.close(true, "Unexpected character in arbitrary value " + String.fromCharCode(charCode))
                break;
        }
    }
}

// Following are helper functions.

/**
 * @description Parses a block of code. This is a helper function used when you have the full code (not streaming).
 * @param {string} data
 * @param {object} options
 * @returns {null | Array | Map<string, Array>}
 */

function parse(data, options = { asArray: true }){
    if(!options.embedded && typeof options.strict === "undefined") options.strict = true;

    let collector = options.asArray? []: options.asLookupTable? new Map: null;

    new ParserState(options, { collector }).write(data);

    return collector;
}

function encodeArray(array){
    return `[${array.map(value => valueToString(value)).join(", ")}]`
}

function valueToString(value){
    // Array
    if(Array.isArray(value)) return encodeArray(value);

    // Block
    if(value instanceof Block) return stringifyBlock(value);

    // Named array
    if(typeof value === "object") return `${value.name}${encodeArray(value.values)}`;

    // String
    if(typeof value === "string") {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`};

    // Number
    if(typeof value === "number") return value.toString();

    // Boolean
    if(typeof value === "boolean") return value? "true": "false";
    return value
}

function stringifyBlock(block){
    let result = `${block.name || ""}`;

    if(block.attributes && block.attributes.length > 0) result += ` (${block.attributes.map(value => valueToString(value)).join(", ")})`;

    if(Object.keys(block.properties).length > 0) {
        result += " {\n";

        for(let key in block.properties){
            result += `${key}${
                Array.isArray(block.properties[key])?
                    ((block.properties[key].length === 1 && block.properties[key][0] === true)? "": `: ${block.properties[key].map(value => valueToString(value)).join(", ")}`) + ";":

            (block.properties[key] instanceof Block)?
                stringifyBlock(block.properties[key]):

                ": " + valueToString(block.properties[key]) + ";"
            }`.split("\n").map(line => `    ${line}`).join("\n") + "\n";
        }

        result += "}"
    } else result += ";";

    return result;
}

function stringify(parsed){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    let result = "";

    for(let name of parsed.keys()){
        for(let block of parsed.get(name)){
            result += stringifyBlock(block) + "\n\n"
        }
    }

    return result
}

/**
 * @description Slices raw code into tokens for syntax highlighting.
 * @param {string} code
 * @returns {array}
 */

function slice(code){
    const state = new ParserState({});

    state.chunk = code;

    if(state.index >= state.chunk.length -1) return;

    const tokens = [];
    let token = { type: null, value: "" };

    function pushChar(swap, char){
        if(token.type === null) token.type = swap;

        if(token.type !== swap) {
            if(token.value.length > 0) {
                if(isValue) {
                    if(token.value === "true" || token.value === "false") token.type = "boolean";
                    else if(Match.digit(token.value)) token.type = "number";
                }

                tokens.push(token)
            }

            if(unbecomeValue) isValue = unbecomeValue = false;

            token = { type: swap, value: char };
        } else {
            token.value += char;
        }
    }

    let stringChar = null, isComment = false, isValue = false, unbecomeValue = false;

    while(++state.index < state.chunk.length){
        const charCode = state.chunk.charCodeAt(state.index), char = state.chunk[state.index];
        let type = null;

        if(isComment){
            if(charCode === 10) {
                pushChar("comment", char);
                isComment = false;
            } else token.value += char;
            continue
        }

        if(stringChar){
            if(charCode === stringChar) {
                pushChar("string", char);
                stringChar = null;
            } else token.value += char;
            continue
        }

        switch(true){
            case Match.keyword(charCode):
                type = "keyword";
                break

            case Match.whitespace(charCode):
                type = "whitespace";
                break

            case charCode === 35:
                type = "comment";
                isComment = true;
                break
            
            case Match.stringChar(charCode):
                type = "string";
                stringChar = charCode;
                break

            case ["{", "}", "(", ")", ",", ";", ":"].includes(char):
                type = "symbol";

                if(char === "{" || char === "(") isValue = true;
                if(char === "}" || char === ")") unbecomeValue = true;
                break

            default:
                type = "plain";
                break
        }

        pushChar(type, char);
    }

    if(token.value.length > 0) tokens.push(token);

    return tokens
}

function merge(base, newConfig){
    if(!(base instanceof Map) || !(newConfig instanceof Map)) throw new Error("Both arguments for merging must be a lookup table.");

    // Blocks are considered identical if they have no attributes.
    // For example: `block { a: 1 }` and `block { b: 2 }` would be considered identical and their properties would be meged.
    // However, if a block has any number of attributes, it is considered unique and will not be merged.

    for(let key of base.keys()){
        if(newConfig.has(key)){
            newConfig.set(key, [...base.get(key), ...newConfig.get(key)])
        } else {
            newConfig.set(key, base.get(key))
        }
    }

    return newConfig
}

class Block {
    constructor(name, attributes, properties){
        this.name = name || null;
        this.isShadow = false;
        this.attributes = attributes || [];
        this.properties = properties || {};
    }

    static from(target){
        if(typeof target === "object"){
            Object.setPrototypeOf(target, Block.prototype);
            return target;
        }

        return target;
    }

    has(key){
        if(this.isShadow) return false;

        if(Array.isArray(key)) {
            // Alias-style access
            // If any of the keys exist, return true.

            for(let k of key) {
                if(this.properties.hasOwnProperty(k)) return true;
            }
            return false;
        }

        return this.properties.hasOwnProperty(key);
    }

    get(key, type = null, default_value = null) {
        if(this.isShadow) return default_value;

        if(Array.isArray(key)) {
            // Alias-style access
            // If any of the keys exist, return the first one found.

            for(let k of key) {
                if(this.properties.hasOwnProperty(k)) return this.get(k, type, default_value);
            }
            return default_value;
        }

        if(!this.properties.hasOwnProperty(key)) return default_value;

        let value = this.properties[key];
        if(type === null || type === undefined) return value;

        if(type === Array) return Array.isArray(value)? value: [value];
        else if(Array.isArray(value)) value = value[0];

        if(type === Boolean) return !!(value);
        if(type === String) return value.toString? value.toString(): value;
        if(typeof type === "function") return type(value);

        return default_value
    }

    getBlock(name){
        if(this.isShadow) return EMPTY_BLOCK;

        if(!this.properties.hasOwnProperty(name)) return EMPTY_BLOCK;
        if(this.properties[name] instanceof Block) return this.properties[name];
        return EMPTY_BLOCK
    }
}


const EMPTY_BLOCK = Object.freeze(Block.from({
    name: null,
    isShadow: true,
    attributes: Object.freeze([]),
    properties: Object.freeze({})
}));


function configTools(parsed){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    let tools = {
        data: parsed,

        has(name){
            return parsed.has(name)
        },

        getBlock(name){
            let list = parsed.get(name);

            if(!list || list.length === 0){
                return EMPTY_BLOCK
            }

            return list[0]
        },

        block(name){
            console.warn("Deprecated: tools.block() is deprecated. Use tools.getBlock() instead.");
            let block = tools.getBlock(name);
            return block? block: EMPTY_BLOCK
        },

        getBlocks(name){
            return parsed.get(name) || [];
        },

        add(name, attributes, properties){
            if(!attributes) attributes = [[]];
            if(!properties) properties = {};

            for(let i = 0; i < attributes.length; i++) {
                if(!Array.isArray(attributes[i])) attributes[i] = [attributes[i]];
            }

            for(let key in properties) {
                if(!Array.isArray(properties[key]) && typeof properties[key] !== "boolean") properties[key] = [properties[key]];
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

                if(block.name === name) callback(block, function(){
                    delete list[i]
                }, () => _break = true)
            }
        },

        /**
         * @deprecated
         */
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
            parsed = merge(parsed, config)
            return parsed
        }
    }

    return tools
}


let _exports = { parse, parserStream: ParserState, BlockState, Match, parseAt, stringify, stringifyBlock, slice, merge, configTools, version, v: parseInt(version[0]) };

if(!globalThis.window) module.exports = _exports; else window.AtriumParser = _exports;