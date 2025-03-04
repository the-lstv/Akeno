

#include <iostream>
#include <fstream>
#include <string>
#include <cstdint>
#include <stack>

enum State {
    TEXT,
    TAGNAME,
    ATTRIBUTE,
    ATTRIBUTE_VALUE,
};



/*

    Copyright (c) 2025, TheLSTV (https://lstv.space)
    Built for Akeno and released under the open source GPL-v3 license.
    All rights reserved.

    Please read:
    This is the native HTML parser used by Akeno for quick HTML parsing.
    This parser is built with raw performance being the only thing in mind and does NOT fully respect the XML/HTML standard!
    Avoid using it anywhere where you do not 100% know the input. Only use it for simple parsing tasks.

*/


class HTMLParser {
public:
    HTMLParser(std::string_view code) : str(code) {}

    void parse() {
        std::stack<std::string_view> tagStack;

        State state = TEXT;

        const char* start = str.data();  
        const char* end = start + str.size();

        // Current tag name
        std::string_view tag;

        // Position of the current value 
        const char* value_start = start;
        bool end_tag = false;


        bool space_broken = false;

        for (const char* it = start; it < end; ++it) {
            switch (state) {
                case TEXT:
                    if (*it == '<') {

                        // Handle text
                        std::string_view text = std::string_view(value_start, it - value_start);
                        std::cout << "Text: " << text << std::endl;

                        state = TAGNAME;
                        end_tag = it[1] == '/';

                        value_start = it + (end_tag? 2: 1);

                        if(end_tag) {
                            ++it;
                        }

                        break;
                    }
                    break;

                case TAGNAME:

                    if (*it == '>' || std::isspace(*it)) {
                        
                        if(!end_tag) {

                            // Handle opening tags

                            tag = std::string_view(value_start, it - value_start);
                            std::cout << "Open tag: " << tag << ", parent: " << (tagStack.empty()? "none": tagStack.top()) << std::endl;

                            tagStack.push(tag);

                            state = *it == '>'? TEXT: ATTRIBUTE;
                            value_start = it + 1;
                            space_broken = true;

                            break;

                        }

                        // Handle closing tags

                        std::string_view closingTag = std::string_view(value_start, it - value_start);

                        if (*it != '>') while(it < end && *it != '>') ++it;

                        if(tagStack.empty() || tagStack.top() != closingTag) {
                            std::cout << "End tag mismatch: " << tag << " != " << tagStack.top() << std::endl;
                            throw std::runtime_error("Tag mismatch error");
                        }

                        tagStack.pop();

                        std::cout << "Close tag: " << closingTag << ", parent: " << (tagStack.empty()? "none": tagStack.top()) << std::endl;

                        value_start = it + 1;
                        state = TEXT;

                        break;
                    }

                    break;

                case ATTRIBUTE:
                    if(std::isspace(*it)) {
                        space_broken = true;
                        if(it - value_start == 0) break;
                    } else {
                        if(space_broken) {
                            space_broken = false;
                            value_start = it;
                        }
                    }


                    if(*it == '=' || *it == '>' || *it == '/' || std::isspace(*it)) {
                        if(!(it - value_start == 0)){
                            std::string_view attribute = std::string_view(value_start, it - value_start);
                            std::cout << "Attribute: \"" << attribute << "\"" << std::endl;
                        }

                        if(*it == '=') {
                            state = ATTRIBUTE_VALUE;
                            value_start = it + 1;
                            break;
                        }

                        if(*it == '>') {
                            state = TEXT;
                            value_start = it + 1;
                            break;
                        }
                        
                        // if(*it == '/') {
                        //     state = TEXT;
                        //     value_start = it + 2;
                        //     break;
                        // }

                        value_start = it + 1;
                        break;
                    }
                    break;

                case ATTRIBUTE_VALUE:
                    if (*it == '"') {
                        state = ATTRIBUTE;
                    }
                    break;
            }
        }
        std::cout << std::endl;
    }

private:
    std::string_view str;
};

int main() {
    std::string_view code = "<html><head   test   ><title>Test</title></head><body><h1>Hello, World!</h1></body></html>";
    HTMLParser parser(code);
    parser.parse();
    return 0;
}