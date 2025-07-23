#include <iostream>
#include <fstream>
#include <string>
#include <cstdint>
#include <stack>
#include <algorithm>
#include <unordered_set>
#include <functional>
#include <memory>


/*

    Copyright (c) 2025, TheLSTV (https://lstv.space)
    Built for Akeno and released under the open source GPL-v3 license.
    All rights reserved.

    This is the native HTML-like parser used by Akeno for "blazingly" fast HTML parsing for the server.
    This parser is built with performance being the only thing in mind and it does NOT fully respect the XML/HTML standard!

    Note:
    By default, this is not a pure HTML parser, it uses a custom syntax (the xw file format) for web applications.
    While it can be customized to work like a HTML parser, be cautious when using it in environments outside of Akeno or the xw file format.

    Technically, with a few modifications, this could be used as a drop-in replacement for the htmlparser2 library (without features like streaming though).
    If someone has the time, feel free to test this out and make some benchmarks!

*/

/*

    Known issues and bugs:
    - Escape characters are left in the final output
    - Attribute values are not disabled for special shorthand cases (eg. .classes, #ids), causing unexpected behavior
    - Safety and edge cases may not be fully covered

    - Attribute parsing isnt implemented properly in the API yet

*/


std::unordered_set<std::string> voidElements = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "source", "track", "command", "frame", "param", "wbr"
};

std::unordered_set<std::string> rawElements = {
    "script", "style", "xmp", "textarea", "title"
};

enum HTMLParserState {
    TEXT,
    TAGNAME,
    ATTRIBUTE,
    ATTRIBUTE_VALUE,
    COMMENT,
    INLINE_VALUE,
    RAW_ELEMENT,
    TEMPLATE_PATH
};

void* empty = nullptr;


const std::streamsize MAX_FILE_SIZE = 10 * 1024 * 1024;


class HTMLParserOptions {
public:
    // Whether to collect and store/reconstruct chunks of the code back into a buffer
    const bool buffer;

    // Minify the output
    bool compact = false;

    // Use vanilla HTML parsing (drop custom syntax)
    bool vanilla = false;

    std::string header = "";
    std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, void*)> onText = nullptr;
    std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, void*)> onOpeningTag = nullptr;
    std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, void*)> onClosingTag = nullptr;
    std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, void*)> onInline = nullptr;
    std::function<void(void*)> onEnd = nullptr;

    HTMLParserOptions(bool buffer) : buffer(buffer) {
        if(buffer) {
            onText = _defaultOnText;
            onOpeningTag = _defaultOnOpeningTag;
            onClosingTag = _defaultOnClosingTag;
            onInline = _defaultOnInline;
        }
    };

    static void _defaultOnText(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
        buffer.append(value);
    }

    static void _defaultOnOpeningTag(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
        buffer.append("<").append(std::string(tag));
    }

    static void _defaultOnClosingTag(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
        buffer.append("</").append(std::string(tag)).append(">");
    }

    static void _defaultOnInline(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
        buffer.append("<span data-reactive=\"").append(std::string(value)).append("\"></span>");
    }
};

struct HTMLParsingPosition {
    std::shared_ptr<std::vector<char>> buffer = nullptr;
    const char* it;
    const char* chunk_end;
    const char* value_start;
    
    HTMLParsingPosition() 
        : buffer(nullptr), it(nullptr), chunk_end(nullptr), value_start(nullptr) {}
    
    HTMLParsingPosition(const char* it, const char* chunk_end, const char* value_start, 
                        std::shared_ptr<std::vector<char>> buffer = nullptr) 
        : buffer(buffer), it(it), chunk_end(chunk_end), value_start(value_start) {}
};

class HTMLParsingContext {
public:
    explicit HTMLParsingContext(std::string_view buf, HTMLParserOptions& options)
        : options(options),
        buffer(buf), it(buf.data()), chunk_end(buf.data() + buf.size()), value_start(buf.data()) {}
    
    explicit HTMLParsingContext(HTMLParserOptions& options)
        : options(options) {}
    
    explicit HTMLParsingContext(HTMLParserOptions& options, bool nested)
        : options(options), nested(nested) {}


    void write(std::string_view buf, std::string* output = nullptr, void* userData = nullptr, bool templateEnabled = false, std::string rootPath = "") {
        if (options.buffer && output == nullptr) {
            throw std::invalid_argument("Output string cannot be undefined when buffer option is enabled.");
        }

        buffer = buf;
        it = buf.data();
        chunk_end = buf.data() + buf.size();
        value_start = it;

        this->templateEnabled = templateEnabled;
        this->rootPath = rootPath;
        if(userData) {
            this->userData = userData;
        }

        resume(*output);
    }

    void end(std::string* buffer = nullptr) {
        if(options.onClosingTag) {
            while (!tagStack.empty()) {
                options.onClosingTag(*buffer, tagStack, tagStack.top(), userData);
                tagStack.pop();
            }
        }

        if (options.onEnd) {
            options.onEnd(userData);
        }

        if(!nested && options.buffer && buffer) {
            buffer->append("</html>");
        }

        state = TEXT;
        string_char = 0;
        space_broken = false;
        flag_appendToClass = false;
        end_tag = false;
        class_buffer.clear();
        body_attributes.clear();
        rootPath.clear();
        tagStack = std::stack<std::string_view>();
        tree = std::stack<HTMLParsingPosition>();
        template_scope = std::string_view();
        inside_head = false;
        is_template = false;
        is_raw = false;
        reset = true;
    }

    std::string parse(std::string_view buf) {
        std::string result;
        write(buf, &result);
        end(&result);
        return result;
    }

    void storePosition() {
        tree.push({ it, chunk_end, value_start, currentBuffer });
    }

    void treeUp() {
        if (tree.empty()) {
            return;
        }

        HTMLParsingPosition currentPos(it, chunk_end, value_start, currentBuffer);
        HTMLParsingPosition pos = tree.top();
        tree.pop();
        tree.push(currentPos);

        it = pos.it;
        chunk_end = pos.chunk_end;
        value_start = pos.value_start;
        currentBuffer = pos.buffer;

        it --; // We will increment it in the next iteration
    }

    void restorePosition() {
        if (tree.empty()) {
            return;
        }

        HTMLParsingPosition pos = tree.top();
        tree.pop();

        it = pos.it;
        chunk_end = pos.chunk_end;
        value_start = pos.value_start;
        currentBuffer = pos.buffer;
    }

    void resume(std::string& buffer) {
        if(reset) {
            if(!nested && options.buffer && buffer.size() == 0) {
                buffer = "<!DOCTYPE html>\n" + options.header + "\n<html>";
                buffer.reserve(buffer.size() + this->buffer.size() + 64);
            }

            if (*it == '#' && (it + 9) < chunk_end && std::string_view(it, 10) == "#template ") {
                state = TEMPLATE_PATH;
                it += 9;
                value_start = it + 1;
            }
            reset = false;
        }

        for (; it < chunk_end; ++it) {

            // Match strings
            if(string_char != 0 && *it != string_char) {
                continue;
            }

            if(state == ATTRIBUTE || state == ATTRIBUTE_VALUE || (state == INLINE_VALUE && !space_broken)) {
                bool isWhitespace = std::isspace(static_cast<unsigned char>(*it));

                if(isWhitespace){
                    if(!space_broken) {
                        continue;
                    }

                    space_broken = false;
                }

                if(!space_broken && !isWhitespace) {
                    space_broken = true;
                    value_start = it;
                }
            }

            switch (state) {
                case COMMENT:
                    if (*it == '-' && (it + 2) < chunk_end && it[1] == '-' && it[2] == '>') {
                        state = TEXT;
                        value_start = it + 3;
                        it += 2;
                        continue;
                    }
                    break;

                case TEXT:
                    if (*it == '<') {
                        pushText(buffer);

                        if ((it + 3) < chunk_end && it[1] == '!' && it[2] == '-' && it[3] == '-') {
                            state = COMMENT;
                            it += 3;
                            continue;
                        }

                        state = TAGNAME;
                        is_template = false;
                        end_tag = (it + 1) < chunk_end && it[1] == '/';
                        is_raw = false;

                        value_start = it + (end_tag? 2: 1);

                        if(end_tag) {
                            ++it;
                        }

                        continue;
                    }

                    if (*it == '{' && (it + 1) < chunk_end && it[1] == '{' && (it == buffer.data() || it[-1] != '\\')) {
                        pushText(buffer);

                        state = INLINE_VALUE;

                        it += 1;
                        value_start = it + 1;
                        space_broken = false;

                        continue;
                    }
                    break;

                case RAW_ELEMENT:
                    if (*it == '<' && (it + 1) < chunk_end && it[1] == '/') {
                        if (!tagStack.empty()) {
                            std::string_view topTag = tagStack.top();
                            size_t tagEnd = 2 + topTag.size();

                            if ((it + tagEnd) < chunk_end && it[tagEnd] == '>' && 
                                std::string_view(it + 2, topTag.size()) == topTag) {
                                pushText(buffer);

                                tagStack.pop();

                                if (options.onClosingTag) {
                                    options.onClosingTag(buffer, tagStack, topTag, userData);
                                }

                                state = TEXT;

                                it += tagEnd;
                                value_start = it + 1;
                            }
                        }
                    }
                    break;

                case TAGNAME:
                    // Templates
                    if(!is_template && *it == ':' && (it + 1) < chunk_end && it[1] == ':') {
                        template_scope = std::string_view(value_start, it - value_start);
                        is_template = true;

                        value_start = it + 2;
                        it += 1;
                        continue;
                    }

                    if (*it == '>' || *it == '/' || std::isspace(static_cast<unsigned char>(*it))) {

                        
                        if(!end_tag) {
                            
                            // Handle opening tags
                            
                            std::string_view tag(value_start, it - value_start);

                            if (options.onOpeningTag && !is_template) {
                                options.onOpeningTag(buffer, tagStack, tag, userData);
                            }

                            value_start = it + 1;
                            space_broken = false;

                            if (tag == "body" && !body_attributes.empty()) {
                                buffer.append(" ").append(body_attributes);
                            }

                            if(*it == '>' || *it == '/'){
                                bool was_template = is_template;
                                _endTag(buffer);

                                if(was_template) {
                                    continue;
                                }

                                if(*it == '/' && (it + 1) < chunk_end) {
                                    if (options.onClosingTag) {
                                        options.onClosingTag(buffer, tagStack, tag, userData);
                                    }
                                    value_start = it + 2;
                                    ++it;

                                    continue;
                                }
                            } else {
                                state = ATTRIBUTE;
                            }

                            if(!is_template && voidElements.find(std::string(tag)) == voidElements.end()) {
                                tagStack.push(tag);

                                if(tag == "head") {
                                    inside_head = true;
                                } else if(rawElements.find(std::string(tag)) != rawElements.end()) {
                                    if(*it == '>') {
                                        state = RAW_ELEMENT;
                                    } else {
                                        is_raw = true;
                                    }
                                }
                            }

                            continue;

                        }

                        // Handle closing tags

                        std::string_view closingTag = std::string_view(value_start, it - value_start);

                        // We can simply ignore anything that is in the closing tag after the tag name.
                        // It should not happen, but well..
                        if (*it != '>') while(it < chunk_end && *it != '>') ++it;

                        if (it < chunk_end) {
                            value_start = it + 1;
                        }
                        state = TEXT;

                        if(tagStack.empty()) continue;

                        if(tagStack.top() != closingTag) {
                            continue;
                        }

                        tagStack.pop();
                        
                        if (options.onClosingTag) {
                            options.onClosingTag(buffer, tagStack, closingTag, userData);
                        }

                        if(closingTag == "head") {
                            inside_head = false;
                        }

                        break;
                    }

                    break;

                case ATTRIBUTE: {
                    if(is_template) {
                        if(*it == '>') {
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                            _endTag(buffer);
                            continue;
                        }
                        continue;
                    }

                    bool isInline = *it == '{' && (it + 1) < chunk_end && it[1] == '{';

                    if(*it == '=' || *it == '>' || *it == '/' || std::isspace(static_cast<unsigned char>(*it)) || isInline) {
                        if(options.buffer && (it > value_start)){
                            // Handle attributes

                            std::string_view attribute_view(value_start, it - value_start);
                            
                            if (attribute_view[0] == '#') {
                                buffer.append(" id=\"");
                                buffer.append(attribute_view.substr(1));
                                buffer.append("\"");
                            } else if (attribute_view[0] == '.') {
                                if(!class_buffer.empty()) {
                                    class_buffer.append(" ");
                                }
                                
                                std::string attribute_str(attribute_view.substr(1));
                                std::replace(attribute_str.begin(), attribute_str.end(), '.', ' ');
                                class_buffer.append(attribute_str);
                            } else if (attribute_view == "class") {
                                flag_appendToClass = true;
                            } else {
                                buffer.append(" ");
                                buffer.append(attribute_view);
                            }
                        }

                        if(*it == '=') {
                            state = ATTRIBUTE_VALUE;
                            value_start = it + 1;
                            space_broken = false;
                            break;
                        }
                        
                        if(isInline) {
                            it++;
                            value_start = it + 1;

                            while(it < chunk_end && !(*it == '}' && (it + 1) < chunk_end && it[1] == '}')) ++it;

                            if(options.buffer && (it > value_start)){
                                buffer.append(" data-reactive=\"");
                                buffer.append(trim(std::string_view(value_start, it - value_start)));
                                buffer.append("\"");
                            }

                            it += 2;
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                        }

                        if(*it == '>') {
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                            _endTag(buffer);
                            continue;
                        }

                        if((it + 1) < chunk_end && *it == '/' && it[1] == '>') {
                            state = TEXT;
                            ++it;
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }

                            _endTag(buffer);
                            if (options.onClosingTag && !tagStack.empty()) {
                                options.onClosingTag(buffer, tagStack, tagStack.top(), userData);
                                tagStack.pop();
                            }
                            continue;
                        }
                        break;
                    }
                    break;
                }

                case ATTRIBUTE_VALUE: {
                    bool end = *it == '>' || std::isspace(static_cast<unsigned char>(*it));

                    if(*it == '"' || *it == '\''){
                        if(string_char == 0) {
                            value_start = it + 1;
                            string_char = *it;
                            break;
                        }

                        string_char = 0;
                        end = true;
                    }

                    if(end) {
                        if(it > value_start){

                            // Handle attribute values

                            std::string_view value = std::string_view(value_start, it - value_start);

                            if(flag_appendToClass) {
                                if(!class_buffer.empty()) {
                                    class_buffer.append(" ");
                                }

                                class_buffer.append(value);
                                flag_appendToClass = false;
                            } else {
                                char quote = value.find('\'') != std::string_view::npos ? '"' : '\'';

                                buffer.append("=");
                                buffer.append(1, quote);
                                buffer.append(value);
                                buffer.append(1, quote);
                            }
                        }

                        if(*it == '>') {
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                            _endTag(buffer);
                            continue;
                        }

                        state = ATTRIBUTE;
                        value_start = it + 1;
                        space_broken = false;
                        break;
                    }
                    break;
                }

                case INLINE_VALUE:
                    if(*it == '}' && (it + 1) < chunk_end && it[1] == '}') {
                        if(it > value_start){

                            // Handle inline values

                            if (options.onInline) {
                                options.onInline(buffer, tagStack, rtrim(std::string_view(value_start, it - value_start)), userData);
                            }

                        }

                        it += 1;
                        if (it < chunk_end) {
                            value_start = it + 1;
                        }
                        state = TEXT;
                        break;
                    }
                    break;

                case TEMPLATE_PATH:
                    if(*it == '\n' || *it == '\r') {
                        std::string_view templatePath(value_start, it - value_start);
                        value_start = it + 1;
                        state = TEXT;

                        if (templateEnabled) {
                            std::string templateFile = rootPath + std::string(templatePath);


                            std::ifstream file(templateFile, std::ios::in | std::ios::binary | std::ios::ate);
                            if (file.is_open()) {
                                std::streamsize size = file.tellg();

                                if (size <= MAX_FILE_SIZE) {
                                    file.seekg(0, std::ios::beg);

                                    auto templateBuffer = std::make_shared<std::vector<char>>(size);

                                    if (file.read(templateBuffer->data(), size)) {
                                        storePosition();

                                        // Switch to template buffer
                                        std::string_view templateView(templateBuffer->data(), templateBuffer->size());

                                        // To make sure the buffer isn't freed
                                        currentBuffer = templateBuffer;
                                        it = templateView.data();
                                        value_start = it;
                                        chunk_end = templateView.data() + templateView.size();

                                        it --; // We will increment it in the next iteration
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                    break;
            }
        }

        if(state == TEXT) {
            pushText(buffer);
        }

        if(tree.size() > 0) {
            restorePosition();
            resume(buffer);
        }
    }

    void inlineFile(std::string filePath, std::string* output) {
        std::ifstream file(filePath, std::ios::in | std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            return;
        }
    
        std::streamsize size = file.tellg();
        if (size > MAX_FILE_SIZE) {
            return;
        }
    
        file.seekg(0, std::ios::beg);
        std::vector<char> buffer(size);
        if (!file.read(buffer.data(), size)) {
            return;
        }
    
        HTMLParsingContext ctx(options, true);
        ctx.write(std::string_view(buffer.data(), buffer.size()), output, &userData);
        ctx.end(output);
    }

    std::stack<std::string_view> tagStack;
    std::stack<HTMLParsingPosition> tree;

    std::string body_attributes;
    bool inside_head = false;
    bool nested = false;

private:
    void* userData = nullptr;

    const char* it;
    const char* chunk_end;
    const char* value_start;

    bool reset = true;

    std::string_view buffer;
    std::string rootPath;

    HTMLParserState state = TEXT;

    bool templateEnabled = false;

    std::shared_ptr<std::vector<char>> currentBuffer = nullptr;

    bool end_tag = false;
    bool space_broken = false;
    bool flag_appendToClass = false;
    bool is_template = false;
    bool is_raw = false;

    void pushText(std::string& buffer) {
        if(options.onText && !(it - value_start == 0)){
            std::string_view text(value_start, it - value_start);
            text = (!options.compact && !inside_head)? text: trim(text, true);

            if(text.size() > 0) {
                options.onText(buffer, tagStack, text, userData);
            }
        }
    }
    
    char string_char = 0;

    std::string class_buffer;
    std::string_view template_scope;

    HTMLParserOptions& options;

    void _endTag(std::string& buffer) {
        state = is_raw? RAW_ELEMENT: TEXT;

        if(is_template) {
            // TODO: This is temporary
            std::string_view current_template_scope = this->template_scope;
            template_scope = std::string_view();
            is_template = false;

            if(current_template_scope == "template") {
                treeUp();
                return;
            } else {
                // TODO:
                buffer.append("#template ").append(current_template_scope).append("\n");
            }

            return;
        }
    
        if(options.buffer) {
            if(!class_buffer.empty()) {
                buffer.append(" class=\"").append(class_buffer).append("\"");
                class_buffer.clear();
            }

            buffer.append(">");
        }
    }

    std::string_view rtrim(const std::string_view& s) {
        auto end = s.find_last_not_of(" \t\n\r\f\v");
        return (end == std::string_view::npos) ? std::string_view{} : s.substr(0, end + 1);
    }

    std::string_view trim(std::string_view s, bool leave_one = false) {
        if(inside_head) leave_one = false;

        auto start = s.find_first_not_of(" \t\n\r\f\v");
        if (start == std::string_view::npos) {
            return (leave_one && !s.empty()) ? s.substr(0, 1) : std::string_view{};
        }

        auto end = s.find_last_not_of(" \t\n\r\f\v");

        if (leave_one) {
            if (start > 0) --start;
            if (end < s.size() - 1) ++end;
        }

        return s.substr(start, end - start + 1);
    }
};