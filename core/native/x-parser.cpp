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

    This is the (experimental) native custom HTML and Markdown parser used by Akeno.
    This parser does NOT fully respect the XML/HTML standard (nor is it particularly safe in that way...)!

    Note:
    By default, this is not a pure HTML parser, it adds a custom syntax, eg. {{ }}, #id, .class, and markdown support.
    While it can be customized to work like a HTML parser, be cautious when using it in environments outside of Akeno.

    There are no external dependencies, it is one file, and it is a single-pass parser.

    Technically, with a few modifications, this could be used as a drop-in replacement for the htmlparser2 library (without features like streaming though).
    If someone has the time, feel free to test this out and make some benchmarks!

*/

/*

    Known issues and bugs:
    - Escape characters are left in the final output
    - Attribute values are not disabled for special shorthand cases (eg. .classes, #ids), causing potential unexpected behavior
    - Safety and edge cases may not be fully covered

    - Attribute parsing isn't implemented properly in the API yet (it otherwise works for building though)

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
    SPECIAL_MODIFIER
};

enum MarkdownState {
    MD_NONE,
    MD_HEADER,
    MD_LIST,
    MD_BLOCKQUOTE,
    MD_CODEBLOCK,
    MD_TABLE
};


void* empty = nullptr;

const std::streamsize MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB


class HTMLParserOptions {
public:
    // Whether to collect and store/reconstruct chunks of the code back into a buffer
    const bool buffer;

    // Minify the output
    bool compact = false;

    // Use vanilla HTML parsing (drop custom syntax)
    bool vanilla = false;

    // Enable @import attribute
    bool enableImport = true;

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
        : lastModified(lastModified), path(path), templateCache(nullptr), templateLastModified(lastModified) {}

    FileCache(const std::string& path, const std::string& content, std::filesystem::file_time_type lastModified)
        : lastModified(lastModified), path(path), content(content), templateCache(nullptr), templateLastModified(lastModified) {}

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
        : output(nullptr), it(buf.data()), chunk_end(buf.data() + buf.size()), value_start(buf.data()), buffer(buf), options(options) {
             md_list_stack.reserve(8);
        }

    explicit HTMLParsingContext(HTMLParserOptions& options)
        : output(nullptr), it(nullptr), chunk_end(nullptr), value_start(nullptr), options(options) {
             md_list_stack.reserve(8);
        }

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

    static std::string parseMarkdown(std::string_view buf, bool enableHTML = false) {
        HTMLParserOptions opts(true);
        opts.vanilla = false;
        opts.compact = false;

        HTMLParsingContext ctx(opts);
        ctx.resetState();
        ctx.in_markdown = true;
        ctx.enable_html = enableHTML;
        ctx.templateEnabled = false;

        return ctx.parse(buf);
    }

    bool enable_html = true;

    void resume() {
        // If top of the file
        if(reset && !in_markdown) {
            if (*it == '#') {
                state = SPECIAL_MODIFIER;
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
                    if (enable_html && *it == '<' && (!in_markdown || md_state != MD_CODEBLOCK)) {
                        pushText(*output);

                        md_base_indent = -1;

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

                    if (enable_html && *it == '{' && (it + 1) < chunk_end && it[1] == '{' && (it == buffer.data() || it[-1] != '\\')) {
                        pushText(*output);

                        state = INLINE_VALUE;

                        it += 1;
                        value_start = it + 1;
                        space_broken = false;

                        continue;
                    }

                    if (*it == '\\' && (it + 1) < chunk_end) {
                        pushText(*output);
                        it++;
                        value_start = it;
                        continue;
                    }

                    if(in_markdown) {
                        bool atLineStart = (it == buffer.data() || *(it - 1) == '\n');

                        // Handle base indentation logic
                        if (atLineStart) {
                            int currentIndent = 0;
                            const char* tempIt = it;
                            while (tempIt < chunk_end && (*tempIt == ' ' || *tempIt == '\t')) {
                                currentIndent++;
                                tempIt++;
                            }

                            // If this is the first line or base indent is unset, set it
                            if (md_base_indent == -1) {
                                if (tempIt < chunk_end && *tempIt != '\n' && *tempIt != '\r') {
                                    md_base_indent = currentIndent;
                                }
                            }

                            if (md_base_indent > 0) {
                                pushText(*output);
                                
                                int skip = (currentIndent < md_base_indent) ? currentIndent : md_base_indent;
                                it += skip;
                                value_start = it;
                            }
                        }

                        if((!enable_html || md_state == MD_CODEBLOCK) && *it == '<') {
                            pushText(*output);
                            output->append("&lt;");
                            it++;
                            value_start = it;
                            continue;
                        }

                        // Horizontal Rule
                        if (md_state == MD_NONE && atLineStart) {
                            char marker = *it;
                            if (marker == '-' || marker == '*' || marker == '_') {
                                const char* p = it;
                                int count = 0;
                                while(p < chunk_end && (*p == marker || *p == ' ' || *p == '\t')) {
                                    if (*p == marker) count++;
                                    p++;
                                }
                                if (count >= 3 && (p >= chunk_end || *p == '\n' || *p == '\r')) {
                                    pushText(*output);
                                    output->append("<hr>");
                                    it = p; 
                                    value_start = it;
                                    continue;
                                }
                            }
                        }

                        // Table Start
                        if (md_state == MD_NONE && atLineStart && *it == '|') {
                            const char* p = it;
                            while(p < chunk_end && *p != '\n') p++; 
                            if (p < chunk_end) { 
                                p++; 
                                while(p < chunk_end && (*p == ' ' || *p == '\t')) p++;
                                if (p < chunk_end && *p == '|') {
                                    bool isSeparator = true;
                                    const char* s = p+1;
                                    bool hasDash = false;
                                    
                                    md_table_alignments.clear();
                                    
                                    const char* cellStart = s;
                                    while(s < chunk_end && *s != '\n' && *s != '\r') {
                                        if (*s == '|') {
                                            std::string_view cell(cellStart, s - cellStart);
                                            while(!cell.empty() && (cell.front() == ' ' || cell.front() == '\t')) cell.remove_prefix(1);
                                            while(!cell.empty() && (cell.back() == ' ' || cell.back() == '\t')) cell.remove_suffix(1);
                                            
                                            std::string align = "";
                                            if (!cell.empty()) {
                                                bool leftIdx = cell.front() == ':';
                                                bool rightIdx = cell.back() == ':';
                                                if (leftIdx && rightIdx) align = "center";
                                                else if (leftIdx) align = "left";
                                                else if (rightIdx) align = "right";
                                            }
                                            md_table_alignments.push_back(align);
                                            cellStart = s + 1;
                                        }
                                        if(*s == '-') hasDash = true;
                                        if(*s != '|' && *s != '-' && *s != ':' && *s != ' ' && *s != '\t') { isSeparator = false; break; }
                                        s++;
                                    }
                                    
                                    if(isSeparator && hasDash) {
                                        pushText(*output);
                                        md_state = MD_TABLE;
                                        md_table_header = true;
                                        md_table_col_index = 0;
                                        output->append("<table><thead><tr>");
                                        
                                        std::string align = (md_table_col_index < (int)md_table_alignments.size()) ? md_table_alignments[md_table_col_index] : "";
                                        output->append("<th");
                                        if(!align.empty()) output->append(" align=\"").append(align).append("\""); 
                                        output->append(">");

                                        it++; 
                                        value_start = it;
                                        md_table_col_index++;
                                    }
                                }
                            }
                        }

                        // Table Separator & Next Row
                        if (md_state == MD_TABLE && atLineStart && *it == '|') {
                             const char* s = it + 1;
                             bool isSeparator = true;
                             bool hasDash = false;
                             while(s < chunk_end && *s != '\n' && *s != '\r') {
                                 if(*s == '-') hasDash = true;
                                 if(*s != '|' && *s != '-' && *s != ':' && *s != ' ' && *s != '\t') { isSeparator = false; break; }
                                 s++;
                             }
                             
                             if(isSeparator && hasDash) {
                                 pushText(*output);
                                 output->append("</thead><tbody>");
                                 md_table_header = false;
                                 md_table_col_index = 0;
                                 it = s; 
                                 value_start = it + 1; 
                                 continue;
                             }
                             
                             pushText(*output);
                             output->append("<tr>");
                             
                             md_table_col_index = 0;
                             std::string align = (md_table_col_index < (int)md_table_alignments.size()) ? md_table_alignments[md_table_col_index] : "";
                             
                             output->append(md_table_header ? "<th" : "<td");
                             if(!align.empty()) output->append(" align=\"").append(align).append("\"");
                             output->append(">");
                             
                             it++; 
                             value_start = it; 
                             md_table_col_index++;
                        }

                        // Table Cell
                        if (md_state == MD_TABLE && *it == '|' && !atLineStart && (it == buffer.data() || it[-1] != '\\')) {
                             pushText(*output);
                             const char* next = it + 1;
                             while(next < chunk_end && (*next == ' ' || *next == '\t')) next++;
                             bool isEnd = (next >= chunk_end || *next == '\n' || *next == '\r');
                             
                             if (!isEnd) {
                                 std::string align = (md_table_col_index < (int)md_table_alignments.size()) ? md_table_alignments[md_table_col_index] : "";
                                 
                                 output->append(md_table_header ? "</th><th" : "</td><td");
                                 if(!align.empty()) output->append(" align=\"").append(align).append("\"");
                                 output->append(">");
                                 
                                 value_start = it + 1;
                                 md_table_col_index++;
                             } else {
                                 value_start = it + 1; 
                             }
                        }

                        // Code blocks
                        if (atLineStart && (it + 2) < chunk_end && *it == '`' && it[1] == '`' && it[2] == '`') {
                            pushText(*output);
                            if (md_state == MD_CODEBLOCK) {
                                output->append("</code></pre>");
                                md_state = MD_NONE;
                                it += 2;
                                value_start = it + 1;
                            } else {
                                it += 3;
                                const char* lang_start = it;
                                while(it < chunk_end && *it != '\n' && *it != '\r' && *it != ' ' && *it != '\t') it++;
                                std::string_view lang(lang_start, it - lang_start);
                                
                                output->append("<pre><code");
                                if(!lang.empty()) {
                                    output->append(" class=\"language-").append(std::string(lang)).append("\"");
                                }
                                output->append(">");
                                
                                while(it < chunk_end && *it != '\n') it++;
                                
                                md_state = MD_CODEBLOCK;
                                value_start = it + 1; // start content on next line
                            }
                            continue;
                        }

                        if (md_state == MD_CODEBLOCK) {
                            break; 
                        }

                        // Headers
                        if (md_state == MD_NONE && atLineStart && *it == '#') {
                            int level = 0;
                            const char* h = it;
                            while(h < chunk_end && *h == '#') { level++; h++; }
                            
                            if (level <= 6 && h < chunk_end && *h == ' ') {
                                pushText(*output);
                                md_heading_level = level;
                                output->append("<h").append(std::to_string(level)).append(">");
                                md_state = MD_HEADER;
                                it += level; // points to space
                                value_start = it + 1; // start text after space
                                continue;
                            }
                        }
                        
                        // Lists (Nested)
                        if (atLineStart) {
                            int listIndent = 0;
                            const char* s = it;
                            while(s < chunk_end && (*s == ' ' || *s == '\t')) {
                                listIndent += (*s == '\t' ? 4 : 1);
                                s++;
                            }

                            if (s < chunk_end && (s + 1) < chunk_end) {
                                bool isUnordered = (*s == '-' || *s == '*') && s[1] == ' ';
                                bool isOrdered = false;
                                
                                if (!isUnordered && std::isdigit(static_cast<unsigned char>(*s))) {
                                    const char* d = s + 1;
                                    while(d < chunk_end && std::isdigit(static_cast<unsigned char>(*d))) d++;
                                    if (d < chunk_end && *d == '.' && (d+1) < chunk_end && d[1] == ' ') {
                                        isOrdered = true;
                                        s = d; // Point to '.'
                                    }
                                }
                                
                                if (isUnordered || isOrdered) {
                                    pushText(*output);
    
                                    int lastIndent = md_list_stack.empty() ? -1 : md_list_stack.back().first;
                                    
                                    if (listIndent > lastIndent) {
                                        output->append(isOrdered ? "<ol>" : "<ul>");
                                        md_list_stack.push_back({listIndent, isOrdered});
                                    } else {
                                        while(!md_list_stack.empty() && listIndent < md_list_stack.back().first) {
                                            output->append(md_list_stack.back().second ? "</ol>" : "</ul>");
                                            md_list_stack.pop_back();
                                        }
                                        if(md_list_stack.empty()) {
                                             md_list_stack.push_back({listIndent, isOrdered});
                                             output->append(isOrdered ? "<ol>" : "<ul>");
                                        } else if (md_list_stack.back().second != isOrdered) {
                                            // Same level but different type... should ideally close and reopen.
                                            // For now simpler: close prev list type, open new.
                                             output->append(md_list_stack.back().second ? "</ol>" : "</ul>");
                                             md_list_stack.pop_back();
                                             md_list_stack.push_back({listIndent, isOrdered});
                                             output->append(isOrdered ? "<ol>" : "<ul>");
                                        }
                                    }
                                    
                                    output->append("<li>");
                                    
                                    it = s + 1; // skip marker or dot
                                    
                                   // Task lists (unordered only technically, but can support both)
                                    if (isUnordered && (it + 1) < chunk_end && *it == ' ' && it[1] == '[') {
                                         if ((it + 3) < chunk_end && it[3] == ']') {
                                             char mark = it[2];
                                             if (mark == ' ' || mark == 'x' || mark == 'X') {
                                                 output->append("<input type=\"checkbox\"");
                                                 if (mark == 'x' || mark == 'X') output->append(" checked");
                                                 output->append(" disabled> ");
                                                 it += 4;
                                             }
                                         }
                                    }
                                    
                                    value_start = it + 1;
                                    continue;
                                }
                            }
                        }

                        // Blockquotes
                        if (atLineStart && *it == '>' && (it + 1) < chunk_end && it[1] == ' ') {
                            pushText(*output);
                            if (!md_in_quote) {
                                output->append("<blockquote>");
                                md_in_quote = true;
                            } else {
                                output->append("<br>");
                            }
                            it += 1;
                            value_start = it + 1;
                            continue;
                        }
                        
                        // Newline handling for closing block structures
                        if (*it == '\n') {
                           if (md_state == MD_HEADER) {
                               pushText(*output);
                               output->append("</h").append(std::to_string(md_heading_level)).append(">");
                               md_state = MD_NONE;
                               md_heading_level = 0;
                               value_start = it + 1; 
                               continue;
                           } else if (!md_list_stack.empty()) {
                               bool nextIsListItem = false;
                               int nextIndent = 0;
                               if ((it + 1) < chunk_end) {
                                   const char* next = it + 1;
                                   while(next < chunk_end && (*next == ' ' || *next == '\t')) {
                                       nextIndent += (*next == '\t' ? 4 : 1);
                                       next++;
                                   }
                                   
                                  // Check unordered
                                   if (next < chunk_end && (*next == '-' || *next == '*') && (next + 1) < chunk_end && next[1] == ' ') {
                                       nextIsListItem = true;
                                   } 
                                  // Check ordered
                                   else if (next < chunk_end && std::isdigit(static_cast<unsigned char>(*next))) {
                                        const char* d = next + 1;
                                        while(d < chunk_end && std::isdigit(static_cast<unsigned char>(*d))) d++;
                                        if (d < chunk_end && *d == '.' && (d+1) < chunk_end && d[1] == ' ') {
                                            nextIsListItem = true;
                                        }
                                   }
                               }
                               
                               if (!nextIsListItem) {
                                    pushText(*output);
                                    while(!md_list_stack.empty()) {
                                        output->append(md_list_stack.back().second ? "</ol>" : "</ul>");
                                        md_list_stack.pop_back();
                                    }
                                    value_start = it; 
                               } else {
                                   int setIndent = md_list_stack.back().first;
                                   if (nextIndent <= setIndent) {
                                       pushText(*output);
                                       output->append("</li>");
                                       value_start = it;
                                   } else {
                                       pushText(*output);
                                       value_start = it + 1;
                                   }
                               }
                           } else if (md_state == MD_TABLE) {
                                 pushText(*output);
                                 output->append(md_table_header ? "</th></tr>" : "</td></tr>");
                                 value_start = it + 1;
                                 
                                 bool continues = false;
                                 if ((it+1) < chunk_end) {
                                     const char* next = it+1;
                                     while(next < chunk_end && (*next == ' ' || *next == '\t')) next++;
                                     if(next < chunk_end && *next == '|') continues = true;
                                 }
                                 
                                 if(!continues) {
                                     output->append("</tbody></table>");
                                     md_state = MD_NONE;
                                     md_table_header = false;
                                 }
                           } else if (md_in_quote) {
                               bool nextIsQuote = false;
                               if ((it + 1) < chunk_end) {
                                    if (*(it + 1) == '>' && (it + 2) < chunk_end && *(it+2) == ' ') nextIsQuote = true;
                               }
                               if(!nextIsQuote) {
                                   pushText(*output);
                                   output->append("</blockquote>");
                                   md_in_quote = false;
                                   value_start = it;
                               }
                           }
                        }

                        // Bold **
                        if (*it == '*' && (it + 1) < chunk_end && it[1] == '*') {
                             pushText(*output);
                             output->append(md_fmt_bold ? "</b>" : "<b>");
                             md_fmt_bold = !md_fmt_bold;
                             it += 1;
                             value_start = it + 1;
                             continue;
                        }
                        
                        // Italic * (if not bold) or _
                        if (*it == '*' || *it == '_') {
                             pushText(*output);
                             output->append(md_fmt_italic ? "</i>" : "<i>");
                             md_fmt_italic = !md_fmt_italic;
                             value_start = it + 1;
                             continue;
                        }
                        
                        // Strike ~~
                        if (*it == '~' && (it + 1) < chunk_end && it[1] == '~') {
                             pushText(*output);
                             output->append(md_fmt_strikethrough ? "</s>" : "<s>");
                             md_fmt_strikethrough = !md_fmt_strikethrough;
                             it += 1;
                             value_start = it + 1;
                             continue;
                        }
                        
                        // Underline __
                        if (*it == '_' && (it + 1) < chunk_end && it[1] == '_') {
                             pushText(*output);
                             output->append(md_fmt_underline ? "</u>" : "<u>");
                             md_fmt_underline = !md_fmt_underline;
                             it += 1;
                             value_start = it + 1;
                             continue;
                        }
                        
                        // Inline Code `
                        if (*it == '`') {
                             pushText(*output);
                             output->append(md_fmt_code ? "</code>" : "<code>");
                             md_fmt_code = !md_fmt_code;
                             value_start = it + 1;
                             continue;
                        }

                        // Images ![]() and Links []()
                        bool isImage = (*it == '!' && (it + 1) < chunk_end && it[1] == '[');
                        if (isImage || *it == '[') {
                             const char* startBracket = isImage ? it + 1 : it;
                             const char* endBracket = nullptr;
                             const char* startParen = nullptr;
                             const char* endParen = nullptr;
                             
                             for(const char* s = startBracket + 1; s < chunk_end; s++) {
                                 if(*s == '\n') break; 
                                 if(*s == ']') {
                                     endBracket = s;
                                     if((s + 1) < chunk_end && s[1] == '(') {
                                         startParen = s + 1;
                                         for(const char* p = startParen + 1; p < chunk_end; p++) {
                                             if(*p == '\n') break;
                                             if(*p == ')') {
                                                 endParen = p;
                                                 break;
                                             }
                                         }
                                     }
                                     break;
                                 }
                             }
                             
                             if(endBracket && startParen && endParen) {
                                 pushText(*output);
                                 std::string_view text(startBracket + 1, endBracket - (startBracket + 1));
                                 std::string_view urlPart(startParen + 1, endParen - (startParen + 1));
                                 
                                 std::string url;
                                 std::string title;
                                 
                                 while(!urlPart.empty() && std::isspace(static_cast<unsigned char>(urlPart.front()))) urlPart.remove_prefix(1);
                                 while(!urlPart.empty() && std::isspace(static_cast<unsigned char>(urlPart.back()))) urlPart.remove_suffix(1);

                                 if (!urlPart.empty()) {
                                     size_t firstSpace = urlPart.find_first_of(" \t");
                                     if (firstSpace != std::string_view::npos) {
                                         url = std::string(urlPart.substr(0, firstSpace));
                                         
                                         std::string_view titlePart = urlPart.substr(firstSpace + 1);
                                         while(!titlePart.empty() && std::isspace(static_cast<unsigned char>(titlePart.front()))) titlePart.remove_prefix(1);
                                         
                                         if (titlePart.size() >= 2 && 
                                             ((titlePart.front() == '"' && titlePart.back() == '"') || 
                                              (titlePart.front() == '\'' && titlePart.back() == '\''))) {
                                             title = std::string(titlePart.substr(1, titlePart.size() - 2));
                                         }
                                     } else {
                                         url = std::string(urlPart);
                                     }
                                 }
                                 
                                 if(isImage) {
                                     output->append("<img src=\"").append(url).append("\" alt=\"").append(std::string(text)).append("\"");
                                     if(!title.empty()) output->append(" title=\"").append(title).append("\"");
                                     output->append(">");
                                 } else {
                                     output->append("<a href=\"").append(url).append("\"");
                                     if(!title.empty()) output->append(" title=\"").append(title).append("\"");
                                     output->append(">").append(std::string(text)).append("</a>");
                                 }

                                 it = endParen;
                                 value_start = it + 1;
                                 continue;
                             }
                        }
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
                                
                                bool parent_markdown = false;
                                if(!markdownStack.empty()) {
                                    parent_markdown = markdownStack.top();
                                    markdownStack.pop();
                                }

                                if(in_markdown && !parent_markdown) {
                                    resetMarkdownState();
                                } else {
                                    in_markdown = parent_markdown;
                                }

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

                            bool prev_markdown = in_markdown;

                            ls_template_tag = is_template && template_scope == "ls" && tag == "template";

                            if(!in_markdown) {
                                in_markdown = !ls_template_tag && tag == "markdown";
                            }

                            render_element = !is_template && tag != "html" && tag != "!DOCTYPE" && !ls_template_tag && tag != "markdown";

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
                                markdownStack.push(prev_markdown);
                                
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
                        
                        bool parent_markdown = false;
                        if(!markdownStack.empty()) {
                            parent_markdown = markdownStack.top();
                            markdownStack.pop();
                        }

                        if(in_markdown && !parent_markdown) {
                            resetMarkdownState();
                        } else {
                            in_markdown = parent_markdown;
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
                            if(attribute_view == "markdown") {
                                in_markdown = true;
                                pending_markdown_attr = true;
                            }

                            if(attribute_view == "@import" && options.enableImport) {
                                pending_import_attr = true;
                            }

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
                                } else if (attribute_view == "markdown" || (attribute_view == "@import" && options.enableImport)) {
                                    // Do nothing
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

                                bool parent_markdown = false;
                                if(!markdownStack.empty()) {
                                    parent_markdown = markdownStack.top();
                                    markdownStack.pop();
                                }

                                if(in_markdown && !parent_markdown) {
                                    resetMarkdownState();
                                } else {
                                    in_markdown = parent_markdown;
                                }
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

                            if(pending_markdown_attr) {
                                if(value == "off" || value == "false") {
                                    in_markdown = false;
                                }
                                pending_markdown_attr = false;
                            } else if(pending_import_attr) {
                                if(!value.empty()) {
                                    std::filesystem::path p(rootPath);
                                    if(cacheEntry && !cacheEntry->path.empty()) p = std::filesystem::path(cacheEntry->path).parent_path();
                                    
                                    p /= value;
                                    std::cout << "Importing file: " << p.string() << std::endl;
                                    pending_import_file = p.string();
                                }
                                pending_import_attr = false;
                            } else if (ls_template_tag) {
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

                case SPECIAL_MODIFIER:
                    if(special_modifier_type.empty()) {
                        bool isSpace = *it == ' ';

                        if(isSpace || *it == '\n' || *it == '\r') {
                            special_modifier_type = std::string_view(value_start, it - value_start);

                           // Allow markdown across the whole file
                            if(special_modifier_type == "markdown") {
                                in_markdown = true;
                            }

                            if(!isSpace) {
                                if((it + 1) < chunk_end && (it[1] == '#')) {
                                   // Next modifier;
                                    it += 1;
                                } else {
                                    state = TEXT;
                                }
                            }

                            value_start = it + 1;
                        }
                    } else if(*it == '\n' || *it == '\r') {
                        std::string_view modifierValue(value_start, it - value_start);
                        
                        if((it + 1) < chunk_end && (it[1] == '#')) {
                           // Next modifier;
                            it += 1;
                        } else {
                            state = TEXT;
                        }

                        value_start = it + 1;

                        if(special_modifier_type == "template") {
                            if (templateEnabled && !modifierValue.empty() && cacheEntry) {
                                std::string templateFile = rootPath + std::string(modifierValue);
    
                                try {
                                    ParsingState oldState = captureState();
                                    HTMLParsingPosition originalPosition = storePosition();
                                    
                                    FileCache& templateCacheEntry = fromFile(templateFile, userData, rootPath);
                                    
                                    restorePosition(originalPosition);
                                    restoreState(oldState);
                                    
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

                        special_modifier_type = std::string_view();
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
    std::stack<bool> markdownStack;
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

    char string_char = 0;

    std::string class_buffer;
    std::string_view template_scope;
    std::string_view special_modifier_type;

    HTMLParserOptions& options;

    bool ls_template_tag = false;
    bool ls_template_capture = false;
    std::string ls_template_id;
    std::string ls_template_attr_name;
    std::string ls_template_buffer;
    std::string ls_inline_script;
    std::string pending_import_file;

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
        markdownStack = std::stack<bool>();
        template_scope = std::string_view();
        special_modifier_type = std::string_view();
        inside_head = false;
        
        pending_import_file.clear();

        resetMarkdownState();
        pending_import_attr = false;

        ls_template_tag = false;
        ls_template_capture = false;
        ls_template_id.clear();
        ls_template_attr_name.clear();
        ls_template_buffer.clear();
        ls_inline_script.clear();
        reset = true;
    }

    bool in_markdown = false;
    bool md_in_quote = false;
    bool md_table_header = false;
    bool md_fmt_bold = false; 
    bool md_fmt_italic = false;
    bool md_fmt_code = false;
    bool md_fmt_underline = false;
    bool md_fmt_strikethrough = false;
    uint8_t md_heading_level = 0;
    bool pending_markdown_attr = false;
    bool pending_import_attr = false;
    int md_base_indent = -1;
    MarkdownState md_state = MD_NONE;

    std::vector<std::pair<int, bool>> md_list_stack; // indent, is_ordered
    std::vector<std::string> md_table_alignments;
    int md_table_col_index = 0;

    struct ParsingState {
        std::stack<std::string_view> tagStack;
        std::stack<bool> markdownStack;
        std::string body_attributes;
        bool inside_head;
        bool templateEnabled;
        
        bool in_markdown;
        bool md_in_quote;
        bool md_table_header;
        bool md_fmt_bold;
        bool md_fmt_italic;
        bool md_fmt_code;
        bool md_fmt_underline;
        bool md_fmt_strikethrough;
        uint8_t md_heading_level;
        bool pending_markdown_attr;
        bool pending_import_attr;
        int md_base_indent;
        MarkdownState md_state;
        std::vector<std::pair<int, bool>> md_list_stack;
        std::vector<std::string> md_table_alignments;
        int md_table_col_index;
    };
    
    ParsingState captureState() {
        return {
            tagStack, markdownStack, body_attributes, inside_head, templateEnabled,
            in_markdown, md_in_quote, md_table_header,
            md_fmt_bold, md_fmt_italic, md_fmt_code, md_fmt_underline, md_fmt_strikethrough,
            md_heading_level, pending_markdown_attr, pending_import_attr, md_base_indent, md_state,
            md_list_stack, md_table_alignments, md_table_col_index
        };
    }
    
    void restoreState(const ParsingState& s) {
        tagStack = s.tagStack;
        markdownStack = s.markdownStack;
        body_attributes = s.body_attributes;
        inside_head = s.inside_head;
        templateEnabled = s.templateEnabled;
        
        in_markdown = s.in_markdown;
        md_in_quote = s.md_in_quote;
        md_table_header = s.md_table_header;
        md_fmt_bold = s.md_fmt_bold;
        md_fmt_italic = s.md_fmt_italic;
        md_fmt_code = s.md_fmt_code;
        md_fmt_underline = s.md_fmt_underline;
        md_fmt_strikethrough = s.md_fmt_strikethrough;
        md_heading_level = s.md_heading_level;
        pending_markdown_attr = s.pending_markdown_attr;
        pending_import_attr = s.pending_import_attr;
        md_base_indent = s.md_base_indent;
        md_state = s.md_state;
        md_list_stack = s.md_list_stack;
        md_table_alignments = s.md_table_alignments;
        md_table_col_index = s.md_table_col_index;
    }

    void resetMarkdownState() {
        in_markdown = false;
        pending_markdown_attr = false;
        md_state = MD_NONE;
        md_base_indent = -1;
        md_table_header = false;
        md_list_stack.clear();
        md_table_alignments.clear();
        md_table_col_index = 0;
        
        md_fmt_bold = false;
        md_fmt_italic = false;
        md_fmt_code = false;
        md_fmt_underline = false;
        md_fmt_strikethrough = false;
        md_in_quote = false;
    }

    void pushText(std::string& buffer) {
        if(options.onText && !(it - value_start == 0)){
            std::string_view text(value_start, it - value_start);
            text = (!options.compact && !inside_head)? text: trim(text, true);

            if(text.size() > 0) {
                options.onText(buffer, tagStack, text, userData);
            }
        }
    }

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

        if(!pending_import_file.empty()) {
            std::string file = pending_import_file;
            pending_import_file.clear(); // Clear it before recursion
            
            try {
                inlineFile(file);
            } catch(...) {}
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

    // bad code
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