#include <iostream>
#include <fstream>
#include <string>
#include <cstdint>
#include <stack>
#include <algorithm>
#include <unordered_set>
#include <functional>
#include <memory>
#include <filesystem>
#include <unordered_map>


/*

    Copyright (c) 2025, TheLSTV (https://lstv.space)
    Built for Akeno and released under the open source GPL-v3 license.
    All rights reserved.

    This is the native HTML-like parser used by Akeno for "blazingly" fast HTML parsing for the server.
    This parser is built with performance being the only thing in mind and it does NOT fully respect the XML/HTML standard (nor is it particularly safe...)!

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

    - Attribute parsing isn't implemented properly in the API yet

*/

// Elements that do not have a closing tag
std::unordered_set<std::string> voidElements = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "source", "track", "command", "frame", "param", "wbr"
};

// Elements that only contain text content
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


struct FileCache {
    std::filesystem::file_time_type lastModified;
    size_t templateChunkSplit = 0;
    std::string path;
    std::string content;

    // FIXME: Would be safer to use path
    std::shared_ptr<FileCache> templateCache = nullptr;
    std::filesystem::file_time_type templateLastModified;

    FileCache() = default;

    FileCache(const std::string& path, std::filesystem::file_time_type lastModified)
        : path(path), lastModified(lastModified), templateCache(nullptr), templateLastModified(lastModified) {}

    FileCache(const std::string& path, const std::string& content, std::filesystem::file_time_type lastModified)
        : path(path), content(content), lastModified(lastModified), templateCache(nullptr), templateLastModified(lastModified) {}

    bool operator==(const FileCache& other) const {
        return path == other.path;
    }
};


struct HTMLParsingPosition {
    // std::shared_ptr<std::vector<char>> buffer = nullptr;
    const char* it;
    const char* chunk_end;
    const char* value_start;
    std::string* output;
    std::shared_ptr<FileCache> cacheEntry;

    HTMLParsingPosition() 
        : it(nullptr), chunk_end(nullptr), value_start(nullptr), output(nullptr), cacheEntry(nullptr) {}

    HTMLParsingPosition(const char* it, const char* chunk_end, const char* value_start, std::string* output = nullptr, std::shared_ptr<FileCache> cacheEntry = nullptr) 
        : it(it), chunk_end(chunk_end), value_start(value_start), output(output), cacheEntry(std::move(cacheEntry)) {}
};


// Global cache map
static std::unordered_map<std::string, std::shared_ptr<FileCache>> fileCache;

class HTMLParsingContext {
public:
    explicit HTMLParsingContext(std::string_view buf, HTMLParserOptions& options)
        : options(options),
        buffer(buf), it(buf.data()), chunk_end(buf.data() + buf.size()), value_start(buf.data()) {}

    explicit HTMLParsingContext(HTMLParserOptions& options)
        : options(options) {}

    void write(std::string_view buf, std::string* _output = nullptr, void* userData = nullptr, std::string rootPath = "") {
        if (options.buffer && _output == nullptr) {
            throw std::invalid_argument("Output string cannot be undefined when buffer option is enabled.");
        }

        if (_output) {
            output = _output;
        }

        buffer = buf;
        it = buf.data();
        chunk_end = buf.data() + buf.size();
        value_start = it;

        this->rootPath = rootPath;
        if(userData) {
            this->userData = userData;
        }

        cacheEntry = nullptr;
        resume();
    }

    bool needsUpdate(std::string filePath) {
        auto cacheIt = fileCache.find(filePath);
        if (cacheIt == fileCache.end()) {
            return true;
        }

        if (!std::filesystem::exists(filePath)) return true;
        auto fileModTime = std::filesystem::last_write_time(filePath);
        if (cacheIt->second->lastModified != fileModTime) {
            return true;
        }

        // Check template file modification time if it exists
        // NOTE: Make sure it gets handled if the template gets deleted
        if (cacheIt->second->templateCache != nullptr) {
            const auto& tmpl = cacheIt->second->templateCache;
            if (!std::filesystem::exists(tmpl->path)) return true;
            auto templateModTime = std::filesystem::last_write_time(tmpl->path);
            if (cacheIt->second->templateLastModified != templateModTime) {
                return true;
            }
        }
        return false;
    }

    // TODO: This *needs* a better implementation
    std::string exportCopy(const std::shared_ptr<FileCache>& cacheEntry) {
        if (!cacheEntry) return "";

        // If no template, just wrap the (possibly trimmed) file content
        if (!cacheEntry->templateCache) return "<!DOCTYPE html>\n" + options.header + "\n<html lang=\"en\">" + cacheEntry->content + "</html>";

        // 1. Extract and remove the file's <head>…</head> content
        std::string fileContent = cacheEntry->content;
        std::string fileHeadInner;
        size_t fileHeadOpen = fileContent.find("<head>");
        size_t fileHeadClose = fileContent.find("</head>");
        if (fileHeadOpen != std::string::npos && fileHeadClose != std::string::npos && fileHeadClose > fileHeadOpen) {
            size_t innerStart = fileHeadOpen + 6; // after "<head>"
            fileHeadInner = fileContent.substr(innerStart, fileHeadClose - innerStart);
            fileContent.erase(fileHeadOpen, fileHeadClose + 7 - fileHeadOpen); // remove "<head>…</head>"
        }

        // 2. Merge extracted head into the template's <head>
        const auto *tmpl = cacheEntry->templateCache.get();
        std::string combinedTemplateContent = tmpl->content;

        size_t tmplHeadOpen2 = std::string::npos;
        size_t tmplHeadClose2 = std::string::npos;
        if (!fileHeadInner.empty()) {
            tmplHeadOpen2 = combinedTemplateContent.find("<head>");
            tmplHeadClose2 = combinedTemplateContent.find("</head>");
            if (tmplHeadOpen2 != std::string::npos && tmplHeadClose2 != std::string::npos && tmplHeadClose2 > tmplHeadOpen2) {
                combinedTemplateContent.insert(tmplHeadClose2, fileHeadInner);
            }
        }

        // 3. Build result, adjusting split if head insert was before it
        const bool hasSplit = tmpl->templateChunkSplit > 0;
        const size_t origSplit = tmpl->templateChunkSplit;
        size_t splitPoint = origSplit;
        if (tmplHeadClose2 != std::string::npos && tmplHeadClose2 < origSplit) {
            splitPoint += fileHeadInner.size();
        }

        const size_t tmplLen = combinedTemplateContent.size();
        size_t resultSize = fileContent.size() + options.header.size() + 15;
        if (hasSplit) {
            resultSize += splitPoint;
            resultSize += tmplLen - splitPoint;
        } else {
            resultSize += tmplLen;
        }

        std::string result = "<!DOCTYPE html>\n" + options.header + "\n<html lang=\"en\">";
        result.reserve(resultSize);

        if (hasSplit) {
            result.append(combinedTemplateContent, 0, splitPoint);
        } else {
            result.append(combinedTemplateContent);
        }

        result.append(fileContent);

        if (hasSplit) {
            result.append(combinedTemplateContent, splitPoint, tmplLen - splitPoint);
        }

        return result + "</html>";
    }

    FileCache& fromFile(std::string filePath, void* userData = nullptr, std::string rootPath = "", bool checkCache = true) {
        filePath = std::filesystem::path(filePath).lexically_normal().string();
        if (!std::filesystem::exists(filePath)) {
            throw std::runtime_error("Unable to open file: " + filePath);
        }
        auto fileModTime = std::filesystem::last_write_time(filePath);
        bool contentCached = true;
        bool templateCached = true;

        if (checkCache) {
            auto cacheIt = fileCache.find(filePath);
            contentCached = cacheIt != fileCache.end() && cacheIt->second->lastModified == fileModTime;

            if (contentCached && cacheIt->second->templateCache != nullptr) {
                auto templateModTime = std::filesystem::last_write_time(cacheIt->second->templateCache->path);
                if (cacheIt->second->templateLastModified != templateModTime) {
                    cacheIt->second->templateLastModified = templateModTime;
                    templateCached = false;

                    if (contentCached) {
                        fromFile(cacheIt->second->templateCache->path, userData, rootPath);
                        return *cacheIt->second;
                    }
                }
            }

            if (contentCached && templateCached) {
                cacheEntry = cacheIt->second;
                return *cacheIt->second;
            }
        }

        auto newEntry = std::make_shared<FileCache>(filePath, fileModTime);
        auto [insertIt, inserted] = fileCache.emplace(filePath, newEntry);
        cacheEntry = insertIt->second;

        if (!inserted) {
            cacheEntry->content.clear();
            cacheEntry->lastModified = fileModTime;
        }

        std::ifstream file(filePath, std::ios::in | std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            throw std::runtime_error("Unable to open file: " + filePath);
        }

        std::streamsize size = file.tellg();
        if (size > MAX_FILE_SIZE) {
            throw std::runtime_error("File size exceeds the maximum limit of " + std::to_string(MAX_FILE_SIZE) + " bytes.");
        }

        if(size == 0) {
            cacheEntry->content.clear();
            return *cacheEntry;
        }

        file.seekg(0, std::ios::beg);
        std::vector<char> fileBuffer(size);
        if (!file.read(fileBuffer.data(), size)) {
            throw std::runtime_error("Error reading file: " + filePath);
        }

        std::string_view fileContent(fileBuffer.data(), fileBuffer.size());

        output = &cacheEntry->content;
        it = fileContent.data();
        chunk_end = fileContent.data() + fileContent.size();
        value_start = it;

        this->rootPath = rootPath;
        if (userData) this->userData = userData;

        resume();
        end();
        return *cacheEntry;
    }

    void end() {
        if(options.onClosingTag) {
            while (!tagStack.empty()) {
                options.onClosingTag(*output, tagStack, tagStack.top(), userData);
                tagStack.pop();
            }
        }

        if (options.onEnd) {
            options.onEnd(userData);
        }

        if (options.buffer && output && !ls_inline_script.empty()) {
            output->insert(0, "<script>\n" + ls_inline_script + "</script>\n");
            ls_inline_script.clear();
        }

        resetState();
    }

    std::string parse(std::string_view buf) {
        std::string result;
        write(buf, &result);
        end();
        return result;
    }

    void resume() {
        if(reset) {
            if (*it == '#' && (it + 9) < chunk_end && std::string_view(it, 10) == "#template ") {
                state = TEMPLATE_PATH;
                it += 9;
                value_start = it + 1;
            }

            if(options.buffer && output->size() == 0) {
                // *output = "<!DOCTYPE html>\n" + options.header + "\n<html>";
                output->reserve(this->buffer.size() + 64);
            }

            reset = false;
        }

        for (; it < chunk_end; ++it) {

            if (ls_template_capture) {
                constexpr std::string_view closing = "</ls::template>";
                std::string_view remaining(it, chunk_end - it);
                auto pos = remaining.find(closing);
                if (pos == std::string_view::npos) {
                    ls_template_buffer.append(remaining);
                    it = chunk_end;
                    break;
                }
                ls_template_buffer.append(remaining.substr(0, pos));
                it += pos + closing.size() - 1;

                ls_template_capture = false;
                if (!ls_template_id.empty()) {
                    ls_inline_script.append(buildLsTemplateFunction(ls_template_id, ls_template_buffer));
                }
                ls_template_buffer.clear();
                ls_template_id.clear();

                state = TEXT;
                value_start = it + 1;
                continue;
            }

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
                        pushText(*output);

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
                        pushText(*output);

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
                                pushText(*output);

                                tagStack.pop();

                                if (options.onClosingTag) {
                                    options.onClosingTag(*output, tagStack, topTag, userData);
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

                            ls_template_tag = is_template && template_scope == "ls" && tag == "template";
                            render_element = !is_template && tag != "html" && tag != "!DOCTYPE";
                            if (ls_template_tag) {
                                render_element = false;
                            }

                            if (options.onOpeningTag && render_element) {
                                options.onOpeningTag(*output, tagStack, tag, userData);
                            }

                            value_start = it + 1;
                            space_broken = false;

                            if (tag == "body" && !body_attributes.empty()) {
                                output->append(" ").append(body_attributes);
                            }

                            if(*it == '>' || *it == '/'){
                                bool was_template = is_template;
                                _endTag();

                                if(was_template) {
                                    continue;
                                }

                                if(*it == '/' && (it + 1) < chunk_end) {
                                    if (options.onClosingTag) {
                                        options.onClosingTag(*output, tagStack, tag, userData);
                                    }
                                    value_start = it + 2;
                                    ++it;

                                    continue;
                                }
                            } else {
                                state = ATTRIBUTE;
                            }

                            if(render_element && voidElements.find(std::string(tag)) == voidElements.end()) {
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
                            options.onClosingTag(*output, tagStack, closingTag, userData);
                        }

                        if(closingTag == "head") {
                            inside_head = false;
                        }

                        break;
                    }

                    break;

                case ATTRIBUTE: {
                    if(!render_element && !ls_template_tag) {
                        if(*it == '>') {
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                            _endTag();
                            continue;
                        }
                        continue;
                    }

                    bool isInline = *it == '{' && (it + 1) < chunk_end && it[1] == '{';

                    if(*it == '=' || *it == '>' || *it == '/' || std::isspace(static_cast<unsigned char>(*it)) || isInline) {
                        if(it > value_start){
                            std::string_view attribute_view(value_start, it - value_start);
                            if(attribute_view.empty()) {
                                value_start = it + 1;
                                space_broken = false;
                                break;
                            }

                            if (ls_template_tag) {
                                if (attribute_view[0] == '#') {
                                    ls_template_id = std::string(attribute_view.substr(1));
                                } else {
                                    ls_template_attr_name = std::string(attribute_view);
                                }
                            } else if(options.buffer){
                                // Handle attributes
                                if (attribute_view[0] == '#') {
                                    output->append(" id=\"");
                                    output->append(attribute_view.substr(1));
                                    output->append("\"");
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
                                    output->append(" ");
                                    output->append(attribute_view);
                                }
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
                                output->append(" data-reactive=\"");
                                output->append(trim(std::string_view(value_start, it - value_start)));
                                output->append("\"");
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
                            _endTag();
                            continue;
                        }

                        if((it + 1) < chunk_end && *it == '/' && it[1] == '>') {
                            state = TEXT;
                            ++it;
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }

                            _endTag();
                            if (options.onClosingTag && !tagStack.empty()) {
                                options.onClosingTag(*output, tagStack, tagStack.top(), userData);
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
                            std::string_view value = std::string_view(value_start, it - value_start);

                            if (ls_template_tag) {
                                if (ls_template_attr_name == "id") {
                                    ls_template_id = std::string(value);
                                }
                                ls_template_attr_name.clear();
                            } else if(flag_appendToClass) {
                                if(!class_buffer.empty()) {
                                    class_buffer.append(" ");
                                }

                                class_buffer.append(value);
                                flag_appendToClass = false;
                            } else {
                                char quote = value.find('\'') != std::string_view::npos ? '"' : '\'';

                                output->append("=");
                                output->append(1, quote);
                                output->append(value);
                                output->append(1, quote);
                            }
                        }

                        if(*it == '>') {
                            if (it < chunk_end) {
                                value_start = it + 1;
                            }
                            _endTag();
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
                                options.onInline(*output, tagStack, rtrim(std::string_view(value_start, it - value_start)), userData);
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

                        if (templateEnabled && !templatePath.empty() && cacheEntry) {
                            std::string templateFile = rootPath + std::string(templatePath);

                            try {
                                HTMLParsingPosition originalPosition = storePosition();
                                FileCache& templateCacheEntry = fromFile(templateFile, userData, rootPath);
                                restorePosition(originalPosition);
                                cacheEntry->templateLastModified = templateCacheEntry.lastModified;
                                cacheEntry->templateCache = fileCache[templateCacheEntry.path];
                            } catch (const std::filesystem::filesystem_error& e) {
                                std::cerr << "Error accessing template file: " << e.what() << std::endl;
                            }

                            // if (cacheEntry->templateChunkSplit > 0) {
                            //     output->append(cacheEntry->content, 0, cacheEntry->templateChunkSplit);
                            // } else {
                            //     // Otherwise, append the whole content
                            //     output->append(cacheEntry->content);
                            // }
                        }
                    }
                    break;
            }
        }

        if(state == TEXT) {
            pushText(*output);
        }

        // if(cacheEntry->templateChunkSplit && !inside_template_file) {
        //     output->append(cacheEntry->content, cacheEntry->templateChunkSplit, cacheEntry->content.size() - cacheEntry->templateChunkSplit);
        // }
    }

    /**
     * Inline a file into the current parsing location, treating it as if it were part of the current context.
     * Be cautious with this, as the state does not get reset.
     */
    void inlineFile(std::string filePath) {
        std::ifstream file(filePath, std::ios::in | std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            throw std::runtime_error("Failed to open file: " + filePath);
        }

        std::streamsize size = file.tellg();
        if (size > MAX_FILE_SIZE) {
            throw std::runtime_error("File size exceeds maximum allowed size: " + filePath);
        }

        file.seekg(0, std::ios::beg);
        std::vector<char> buffer(size);
        if (!file.read(buffer.data(), size)) {
            throw std::runtime_error("Failed to read file: " + filePath);
        }

        std::string_view fileContent(buffer.data(), size);

        HTMLParsingPosition pos = storePosition();
        HTMLParsingPosition newPos(fileContent.data(), fileContent.data() + fileContent.size(), fileContent.data(), output);
        restorePosition(newPos);
        resume();
        restorePosition(pos);
    }

    std::stack<std::string_view> tagStack;
    // std::stack<HTMLParsingPosition> tree;

    std::string body_attributes;
    bool inside_head = false;
    bool templateEnabled = false;

    std::string* output;

private:
    void* userData = nullptr;

    const char* it;
    const char* chunk_end;
    const char* value_start;

    bool reset = true;

    bool end_tag = false;
    bool space_broken = false;
    bool flag_appendToClass = false;
    bool is_template = false;
    bool is_raw = false;
    bool render_element = true;

    HTMLParserState state = TEXT;

    std::string_view buffer;
    std::string rootPath;

    std::shared_ptr<FileCache> cacheEntry = nullptr;

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

    bool ls_template_tag = false;
    bool ls_template_capture = false;
    std::string ls_template_id;
    std::string ls_template_attr_name;
    std::string ls_template_buffer;
    std::string ls_inline_script;

    void _endTag() {
        state = is_raw? RAW_ELEMENT: TEXT;

        if (ls_template_tag) {
            ls_template_tag = false;
            ls_template_capture = true;
            is_template = false;
            template_scope = std::string_view();
            value_start = it + 1;
            return;
        }

        if (is_template) {
            // TODO: This is temporary
            std::string_view current_template_scope = this->template_scope;
            template_scope = std::string_view();
            is_template = false;

            if(current_template_scope == "template" && cacheEntry) {
                cacheEntry->templateChunkSplit = output->size();
                return;
            } else {
                // TODO:
                output->append("#template ").append(current_template_scope).append("\n");
            }
            return;
        }

        if(options.buffer && render_element) {
            if(!class_buffer.empty()) {
                output->append(" class=\"").append(class_buffer).append("\"");
                class_buffer.clear();
            }

            output->append(">");
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

    void resetState() {
        end_tag = false;
        space_broken = false;
        flag_appendToClass = false;
        is_template = false;
        is_raw = false;
        render_element = true;
        state = TEXT;
        string_char = 0;
        class_buffer.clear();
        body_attributes.clear();
        tagStack = std::stack<std::string_view>();
        template_scope = std::string_view();
        inside_head = false;

        ls_template_tag = false;
        ls_template_capture = false;
        ls_template_id.clear();
        ls_template_attr_name.clear();
        ls_template_buffer.clear();
        ls_inline_script.clear();
        reset = true;
    }


    HTMLParsingPosition storePosition() {
        return HTMLParsingPosition(it, chunk_end, value_start, output, cacheEntry);
    }

    void restorePosition(HTMLParsingPosition& pos) {
        it = pos.it;
        chunk_end = pos.chunk_end;
        value_start = pos.value_start;
        output = pos.output;
        cacheEntry = pos.cacheEntry;
    }

    std::string jsEscape(std::string_view s) {
        std::string out;
        out.reserve(s.size() + 8);
        for (char c : s) {
            switch (c) {
                case '\\': out += "\\\\"; break;
                case '"':  out += "\\\""; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default: out += c; break;
            }
        }
        return out;
    }

    std::string normalizeDataExpr(std::string_view s) {
        std::string_view t = trim(s);
        if (t.empty()) return "data";
        if (t.rfind("data.", 0) == 0 || t.find_first_of(".(") != std::string_view::npos) {
            return std::string(t);
        }
        return "data." + std::string(t);
    }

    std::string buildLsTemplateFunction(const std::string& id, std::string_view content) {
        if (id.empty()) return "";

        std::string js = "function " + id + "(data){\n";
        int idx = 0;
        std::string rootVar;
        std::vector<std::string> stack;
        std::vector<std::pair<std::string, std::string>> exports;

        auto appendToParent = [&](const std::string& var) {
            if (!stack.empty()) {
                js += stack.back() + ".appendChild(" + var + ");\n";
            } else if (rootVar.empty()) {
                rootVar = var;
            }
        };

        auto emitTextNode = [&](std::string_view txt) {
            if (txt.empty()) return;
            bool all_ws = true;
            for (char c : txt) { if (!std::isspace(static_cast<unsigned char>(c))) { all_ws = false; break; } }
            if (all_ws) return;

            std::string v = "e" + std::to_string(idx++);
            js += "var " + v + "=document.createTextNode(\"" + jsEscape(txt) + "\");\n";
            appendToParent(v);
        };

        auto emitDynamic = [&](std::string_view expr) {
            if (stack.empty()) return;
            js += stack.back() + ".appendChild(LS.__dynamicInnerToNode(" + normalizeDataExpr(expr) + "));\n";
        };

        auto emitReactive = [&](std::string_view expr) {
            if (stack.empty()) return;
            std::string v = "e" + std::to_string(idx++);
            std::string name = std::string(trim(expr));
            js += "var " + v + "=document.createElement(\"span\");\n";
            js += "LS.Reactive.bindElement(" + v + ", \"" + jsEscape(name) + "\");\n";
            appendToParent(v);
        };

        auto emitText = [&](std::string_view txt) {
            size_t p = 0;
            while (p < txt.size()) {
                size_t open = txt.find("{{", p);
                if (open == std::string_view::npos) {
                    emitTextNode(txt.substr(p));
                    break;
                }
                bool hash = (open > 0 && txt[open - 1] == '#');
                size_t plain_end = hash ? open - 1 : open;
                if (plain_end > p) {
                    emitTextNode(txt.substr(p, plain_end - p));
                }
                size_t close = txt.find("}}", open + 2);
                if (close == std::string_view::npos) {
                    emitTextNode(txt.substr(open));
                    break;
                }
                std::string_view expr = txt.substr(open + 2, close - (open + 2));
                if (hash) {
                    emitDynamic(expr);
                } else {
                    emitReactive(expr);
                }
                p = close + 2;
            }
        };

        size_t i = 0;
        while (i < content.size()) {
            if (content[i] != '<') {
                size_t next = content.find('<', i);
                if (next == std::string_view::npos) next = content.size();
                emitText(content.substr(i, next - i));
                i = next;
                continue;
            }

            if (content.compare(i, 4, "<!--") == 0) {
                size_t end = content.find("-->", i + 4);
                i = (end == std::string_view::npos) ? content.size() : end + 3;
                continue;
            }

            if (i + 1 < content.size() && content[i + 1] == '/') {
                size_t end = content.find('>', i + 2);
                if (end == std::string_view::npos) break;
                if (!stack.empty()) stack.pop_back();
                i = end + 1;
                continue;
            }

            size_t name_start = i + 1;
            size_t name_end = name_start;
            while (name_end < content.size() && !std::isspace(static_cast<unsigned char>(content[name_end])) && content[name_end] != '>' && content[name_end] != '/') {
                ++name_end;
            }
            std::string tag = std::string(content.substr(name_start, name_end - name_start));

            std::string idAttr;
            std::string className;
            std::string exportName;
            std::vector<std::pair<std::string, std::string>> attrs;

            size_t p = name_end;
            bool selfClosing = false;

            while (p < content.size()) {
                while (p < content.size() && std::isspace(static_cast<unsigned char>(content[p]))) ++p;
                if (p >= content.size()) break;
                if (content[p] == '>') { ++p; break; }
                if (content[p] == '/' && p + 1 < content.size() && content[p + 1] == '>') {
                    selfClosing = true; p += 2; break;
                }

                if (content[p] == '.' || content[p] == '#') {
                    char kind = content[p++];
                    size_t start = p;
                    while (p < content.size() && !std::isspace(static_cast<unsigned char>(content[p])) && content[p] != '>' && content[p] != '/') ++p;
                    std::string token = std::string(content.substr(start, p - start));
                    if (kind == '.') {
                        std::replace(token.begin(), token.end(), '.', ' ');
                        if (!className.empty()) className += " ";
                        className += token;
                    } else {
                        idAttr = token;
                    }
                    continue;
                }

                size_t attr_start = p;
                while (p < content.size() && !std::isspace(static_cast<unsigned char>(content[p])) && content[p] != '=' && content[p] != '>' && content[p] != '/') ++p;
                std::string attrName = std::string(content.substr(attr_start, p - attr_start));

                while (p < content.size() && std::isspace(static_cast<unsigned char>(content[p]))) ++p;
                std::string attrValue;
                if (p < content.size() && content[p] == '=') {
                    ++p;
                    while (p < content.size() && std::isspace(static_cast<unsigned char>(content[p]))) ++p;
                    if (p < content.size() && (content[p] == '"' || content[p] == '\'')) {
                        char q = content[p++];
                        size_t vstart = p;
                        while (p < content.size() && content[p] != q) ++p;
                        attrValue = std::string(content.substr(vstart, p - vstart));
                        if (p < content.size()) ++p;
                    } else {
                        size_t vstart = p;
                        while (p < content.size() && !std::isspace(static_cast<unsigned char>(content[p])) && content[p] != '>' && content[p] != '/') ++p;
                        attrValue = std::string(content.substr(vstart, p - vstart));
                    }
                }

                if (attrName == "class") {
                    if (!className.empty()) className += " ";
                    className += attrValue;
                } else if (attrName == "id") {
                    idAttr = attrValue;
                } else if (attrName == "export") {
                    exportName = attrValue;
                } else if (!attrName.empty()) {
                    attrs.emplace_back(attrName, attrValue);
                }
            }

            std::string var = "e" + std::to_string(idx++);
            js += "var " + var + "=document.createElement(\"" + jsEscape(tag) + "\");";
            if (!idAttr.empty()) {
                js += var + ".id=\"" + jsEscape(idAttr) + "\";";
            }
            if (!className.empty()) {
                js += var + ".className=\"" + jsEscape(className) + "\";";
            }
            for (auto& kv : attrs) {
                js += var + ".setAttribute(\"" + jsEscape(kv.first) + "\", \"" + jsEscape(kv.second) + "\");";
            }

            appendToParent(var);
            if (!exportName.empty()) {
                exports.emplace_back(exportName, var);
            }
            if (!selfClosing) {
                stack.push_back(var);
            }
            i = p;
        }

        if (rootVar.empty()) rootVar = "null";
        js += "var __rootValue = " + rootVar + ";\nreturn { root: __rootValue";
        for (auto& ex : exports) {
            js += ", " + ex.first + ": " + ex.second;
        }
        js += " };\n}\n";
        return js;
    }
};