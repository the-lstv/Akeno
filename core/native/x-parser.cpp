#include <iostream>
#include <fstream>
#include <string>
#include <cstdint>
#include <stack>
#include <algorithm>
#include <unordered_set>
#include <functional>


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

enum State {
    TEXT,
    TAGNAME,
    ATTRIBUTE,
    ATTRIBUTE_VALUE,
    COMMENT,
    INLINE_VALUE
};



void* empty = nullptr;


template<typename UserData>

class Parser {

public:
    struct Options {
        // Collect and store/reconstruct chunks of the code back into a buffer
        bool buffer = false;

        // Minify the output
        bool compact = false;

        // Use vanilla HTML parsing (drop custom syntax)
        bool vanilla = false;

        std::string header = "";
        std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, UserData&)> onText = nullptr;
        std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, UserData&)> onOpeningTag = nullptr;
        std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, UserData&)> onClosingTag = nullptr;
        std::function<void(std::string&, std::stack<std::string_view>&, std::string_view, UserData&)> onInline = nullptr;
    };

    static int noContext;

    Parser() = default;

    Parser(const Options& opts) : options(opts) {
        if(options.buffer) {
            if(!options.onText) options.onText = _defaultOnText;
            if(!options.onOpeningTag) options.onOpeningTag = _defaultOnOpeningTag;
            if(!options.onClosingTag) options.onClosingTag = _defaultOnClosingTag;
            if(!options.onInline) options.onInline = _defaultOnInline;
        }
    }


    std::string parse(std::string_view str, UserData& userData = empty, std::string& buffer = *(new std::string())) {
        std::stack<std::string_view> tagStack;

        State state = TEXT;

        const char* start = str.data();
        const char* end = start + str.size();

        // Position of the current value
        const char* value_start = start;
        bool end_tag = false;

        char string_char = 0;

        std::string class_buffer;

        bool space_broken = false;

        bool flag_appendToClass = false;

        if(options.buffer) {
            buffer = options.buffer? ("<!DOCTYPE html>\n" + options.header + "<html>") : "";
            buffer.reserve(str.size());
        }

        for (const char* it = start; it < end; ++it) {

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
                                std::string_view text = trim(std::string_view(value_start, it - value_start));

                                if(text.size() > 0) {
                                    options.onText(buffer, tagStack, text, userData);
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
                        if(!(end - value_start == 0)){
                            if(options.onText) {
                                std::string_view text = trim(std::string_view(value_start, it - value_start));

                                if(text.size() > 0) {
                                    options.onText(buffer, tagStack, text, userData);
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
                        if (*it != '>') while(it < end && *it != '>') ++it;

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

                                buffer += " id=\"" + attribute.substr(1) + "\"";

                            } else if (attribute[0] == '.') {

                                if(!class_buffer.empty()) {
                                    class_buffer += " ";
                                }

                                std::replace(attribute.begin(), attribute.end(), '.', ' ');

                                class_buffer += attribute.substr(1);

                            } else if (attribute == "class") {

                                flag_appendToClass = true;

                            } else {
                                buffer += " " + attribute;
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

                        if(it + 1 < end && *it == '/' && it[1] == '>') {
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
                                    class_buffer += " ";
                                }

                                class_buffer += value;
                                flag_appendToClass = false;
                            } else {
                                char quote = value.find('\'') != std::string_view::npos ? '"' : '\'';

                                buffer += '=';
                                buffer += quote;
                                buffer += value;
                                buffer += quote;
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

        while (!tagStack.empty()) {
            if (options.onClosingTag) {
                options.onClosingTag(buffer, tagStack, tagStack.top(), userData);
            }
            tagStack.pop();
        }

        if(state == TEXT) {
            if(!(end - value_start == 0)){
                if(options.onText) {
                    std::string_view text = trim(std::string_view(value_start, end - value_start));

                    if(text.size() > 0) {
                        options.onText(buffer, tagStack, text, userData);
                    }
                }
            }
        }

        if(options.buffer) {
            buffer += "</html>";
        }

        return buffer;
    }

private:
    Options options;

    void _endTag(State& state, std::string& buffer, std::string& class_buffer) {
        state = TEXT;

        if(options.buffer) {
            if(!class_buffer.empty()) {
                buffer += " class=\"" + class_buffer + "\"";
                class_buffer.clear();
            }

            buffer += ">";
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

    static void _defaultOnText(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
        buffer += value;
    }

    static void _defaultOnOpeningTag(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
        // std::cout << "Open tag: " << tag << ", parent: " << (tagStack.empty()? "none": tagStack.top()) << std::endl;
        buffer += "<" + std::string(tag);
    }

    static void _defaultOnClosingTag(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
        // std::cout << "Close tag: " << tag << ", parent: " << (tagStack.empty()? "none": tagStack.top()) << std::endl;
        buffer += "</" + std::string(tag) + ">";
    }

    static void _defaultOnInline(std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
        buffer += "<span data-reactive=\"" + std::string(value) + "\"></span>";
    }
};
