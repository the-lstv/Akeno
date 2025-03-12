#include <iostream>
#include <fstream>
#include <string>
#include <cstdint>
#include <stack>
#include <algorithm>
#include <unordered_set>
#include <functional>
#include <optional>


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

enum HTMLParserState {
    TEXT,
    TAGNAME,
    ATTRIBUTE,
    ATTRIBUTE_VALUE,
    COMMENT,
    INLINE_VALUE
};

void* empty = nullptr;


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

class HTMLParsingContext {
public:
    void write(std::string_view buf, std::string* output = nullptr, void* userData = nullptr) {
        buffer = buf;

        if (options.buffer && output == nullptr) {
            throw std::invalid_argument("Output string cannot be undefined when buffer option is enabled.");
        }

        it = buf.data();
        chunk_end = buf.data() + buf.size();
        value_start = it;

        if(userData) {
            this->userData = userData;
        }

        resume(*output);
    }

    explicit HTMLParsingContext(std::string_view buf, HTMLParserOptions& options)
        : options(options),
        buffer(buf), it(buf.data()), chunk_end(buf.data() + buf.size()), value_start(buf.data()) {}
    
    explicit HTMLParsingContext(HTMLParserOptions& options)
        : options(options) {}
    
    explicit HTMLParsingContext(HTMLParserOptions& options, bool nested)
        : options(options), nested(nested) {}

    void end(std::string* buffer = nullptr) {
        if(options.onClosingTag) {
            while (!tagStack.empty()) {
                options.onClosingTag(*buffer, tagStack, tagStack.top(), userData);
                tagStack.pop();
            }
        }

        if(options.buffer) {
            buffer->append("</html>");
        }

        state = TEXT;
        string_char = 0;
        space_broken = false;
        flag_appendToClass = false;
        end_tag = false;
        class_buffer.clear();
        body_attributes.clear();
        tagStack = std::stack<std::string_view>();
        reset = true;
    }

    std::string parse(std::string_view buf) {
        std::string result;
        write(buf, &result);
        end(&result);
        return result;
    }

    void resume(std::string& buffer = *(new std::string())) {
        if(reset) {
            if(options.buffer && buffer.size() == 0) {
                buffer = "<!DOCTYPE html>\n" + options.header + "<html>";
                buffer.reserve(buffer.size() + this->buffer.size() + 64);
            }
            reset = false;
        }

        for (; it < chunk_end; ++it) {

            // Match strings
            if(string_char != 0 && *it != string_char) {
                continue;
            }

            if(state == ATTRIBUTE || state == ATTRIBUTE_VALUE || (state == INLINE_VALUE && !space_broken)) {
                bool isWhitespace = std::isspace(*it);

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
                    if (*it == '-' && it[1] == '-' && it[2] == '>') {
                        state = TEXT;
                        value_start = it + 3;
                        it += 2;
                        continue;
                    }
                    break;

                case TEXT:
                    if (*it == '<') {

                        if(!(it - value_start == 0)){
                            if(options.onText) {
                                std::string_view text(value_start, it - value_start);

                                if(text.size() > 0) {
                                    options.onText(buffer, tagStack, trim(text), userData);
                                }
                            }
                        }

                        if (it[1] == '!' && it[2] == '-' && it[3] == '-') {
                            state = COMMENT;
                            it += 3;
                            continue;
                        }

                        state = TAGNAME;
                        end_tag = it[1] == '/';

                        value_start = it + (end_tag? 2: 1);

                        if(end_tag) {
                            ++it;
                        }

                        continue;
                    }

                    if (*it == '{' && it[1] == '{' && it[-1] != '\\') {
                        if(!(chunk_end - value_start == 0)){
                            if(options.onText) {
                                std::string_view text(value_start, it - value_start);

                                if(text.size() > 0) {
                                    options.onText(buffer, tagStack, trim(text), userData);
                                }
                            }
                        }

                        state = INLINE_VALUE;

                        it += 1;
                        value_start = it + 1;
                        space_broken = false;

                        continue;
                    }
                    break;

                case TAGNAME:
                    if (*it == '>' || *it == '/' || std::isspace(*it)) {

                        if(!end_tag) {

                            // Handle opening tags

                            std::string_view tag(value_start, it - value_start);

                            if (options.onOpeningTag) {
                                options.onOpeningTag(buffer, tagStack, tag, userData);
                            }

                            value_start = it + 1;
                            space_broken = false;

                            if (tag == "body" && !body_attributes.empty()) {
                                buffer.append(" ").append(body_attributes);
                            }

                            if(*it == '>' || *it == '/'){
                                _endTag(state, buffer, class_buffer);

                                if(*it == '/') {
                                    if (options.onClosingTag) {
                                        options.onClosingTag(buffer, tagStack, tag, userData);
                                    }
                                    value_start = it + 2;
                                    continue;
                                }
                            } else {
                                state = ATTRIBUTE;
                            }

                            if(!(voidElements.find(std::string(tag)) != voidElements.end())) {
                                tagStack.push(tag);
                            }

                            continue;

                        }

                        // Handle closing tags

                        std::string_view closingTag = std::string_view(value_start, it - value_start);

                        // We can simply ignore anything that is in the closing tag after the tag name.
                        // It should not happen, but well..
                        if (*it != '>') while(it < chunk_end && *it != '>') ++it;

                        if(tagStack.empty() || tagStack.top() != closingTag) {
                            std::cout << "End tag mismatch: " << closingTag << " != " << tagStack.top() << std::endl;
                            throw std::runtime_error("Tag mismatch error");
                        }

                        tagStack.pop();
                        
                        if (options.onClosingTag) {
                            options.onClosingTag(buffer, tagStack, closingTag, userData);
                        }

                        value_start = it + 1;
                        state = TEXT;

                        break;
                    }

                    break;

                case ATTRIBUTE: {
                    if(*it == '=' || *it == '>' || *it == '/' || std::isspace(*it)) {
                        if(!(it - value_start == 0)){
                            // Handle attributes

                            std::string attribute(value_start, it - value_start);
                            // std::cout << "Attribute: \"" << attribute << "\"" << std::endl;

                            if (attribute[0] == '#') {

                                buffer.append(" id=\"").append(attribute.substr(1)).append("\"");

                            } else if (attribute[0] == '.') {

                                if(!class_buffer.empty()) {
                                    class_buffer.append(" ");
                                }

                                std::replace(attribute.begin(), attribute.end(), '.', ' ');

                                class_buffer.append(attribute.substr(1));

                            } else if (attribute == "class") {

                                flag_appendToClass = true;

                            } else {
                                buffer.append(" ").append(attribute);
                            }
                        }

                        if(*it == '=') {
                            state = ATTRIBUTE_VALUE;
                            value_start = it + 1;
                            space_broken = false;
                            break;
                        }

                        if(*it == '>') {
                            value_start = it + 1;
                            _endTag(state, buffer, class_buffer);
                            break;
                        }

                        if(it + 1 < chunk_end && *it == '/' && it[1] == '>') {
                            state = TEXT;
                            ++it;
                            value_start = it + 1;

                            _endTag(state, buffer, class_buffer);
                            if (options.onClosingTag) {
                                options.onClosingTag(buffer, tagStack, tagStack.top(), userData);
                            }

                            tagStack.pop();
                            break;
                        }
                        break;
                    }
                    break;
                }

                case ATTRIBUTE_VALUE: {
                    bool end = *it == '>' || std::isspace(*it);

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
                        if(!(it - value_start == 0)){

                            // Handle attribute values

                            std::string_view value = std::string_view(value_start, it - value_start);
                            // std::cout << "Value: \"" << value << "\"" << std::endl;

                            if(flag_appendToClass) {
                                if(!class_buffer.empty()) {
                                    class_buffer.append(" ");
                                }

                                class_buffer.append(value);
                                flag_appendToClass = false;
                            } else {
                                char quote = value.find('\'') != std::string_view::npos ? '"' : '\'';

                                buffer.append("=").append(1, quote).append(value).append(1, quote);
                            }
                        }

                        if(*it == '>') {
                            value_start = it + 1;
                            _endTag(state, buffer, class_buffer);
                            break;
                        }

                        state = ATTRIBUTE;
                        value_start = it + 1;
                        space_broken = false;
                        break;
                    }
                    break;
                }

                case INLINE_VALUE:
                    if(*it == '}' && it[1] == '}') {
                        if(!(it - value_start == 0)){

                            // Handle inline values

                            if (options.onInline) {
                                options.onInline(buffer, tagStack, rtrim(std::string_view(value_start, it - value_start)), userData);
                            }

                        }

                        it += 1;
                        value_start = it + 1;
                        state = TEXT;
                        break;
                    }
                    break;
            }
        }

        if(state == TEXT && options.onText && !(chunk_end - value_start == 0)) {
            std::string_view text(value_start, chunk_end - value_start);

            if(text.size() > 0) {
                options.onText(buffer, tagStack, trim(text), userData);
            }
        }
    }

    std::stack<std::string_view> tagStack;

    std::string body_attributes;

private:
    void* userData = nullptr;

    const char* it;
    const char* chunk_end;
    const char* value_start;

    bool reset = true;

    std::string_view buffer;

    HTMLParserState state = TEXT;

    bool end_tag = false;
    bool space_broken = false;
    bool flag_appendToClass = false;
    bool nested = false;

    char string_char = 0;

    std::string class_buffer;

    HTMLParserOptions& options;

    void _endTag(HTMLParserState& state, std::string& buffer, std::string& class_buffer) {
        state = TEXT;

        if(options.buffer) {
            if(!class_buffer.empty()) {
                buffer.append(" class=\"").append(class_buffer).append("\"");
                class_buffer.clear();
            }

            buffer.append(">");
        }
    }

    std::string_view rtrim(const std::string_view& s) {
        size_t end = s.find_last_not_of(" \t\n\r\f\v");
        return (end == std::string_view::npos) ? "" : s.substr(0, end + 1);
    }

    std::string_view trim(std::string_view s) {
        if(!options.compact) {
            return s;
        }

        size_t start = s.find_first_not_of(" \t\n\r\f\v");
        if (start == std::string_view::npos) return ""; // String is all whitespace

        size_t end = s.find_last_not_of(" \t\n\r\f\v");
        return s.substr(start, end - start + 1);
    }
};
