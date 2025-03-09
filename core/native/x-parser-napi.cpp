#include "x-parser.cpp"

#include <napi.h>
#include <unordered_map>
#include <fstream>
#include <sys/stat.h>
#include <memory>

static time_t getFileLastModifiedTime(const std::string& filePath) {
    struct stat fileStat;
    if (stat(filePath.c_str(), &fileStat) == 0) {
        return fileStat.st_mtime;
    }
    return 0;
}


class ParserContext : public Napi::ObjectWrap<ParserContext> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("context", DefineClass(env, "ParserContext", {
            InstanceMethod("write", &ParserContext::onText),
            InstanceMethod("onText", &ParserContext::onText),
            InstanceMethod("import", &ParserContext::import),
        }));
        return exports;
    }

    ParserContext(const Napi::CallbackInfo& info) : Napi::ObjectWrap<ParserContext>(info) {
        if (info.Length() > 0 && info[0].IsObject()) {
            Napi::Object obj = info[0].As<Napi::Object>();
            this->Value().Set("data", obj);
        }

        this->Value().Set("embedded", Napi::Boolean::New(info.Env(), true));
        this->Value().Set("strict", Napi::Boolean::New(info.Env(), false));
    }

    std::string* result;

    void onText(const Napi::CallbackInfo& info) {
        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
            return;
        }

        *result += info[0].As<Napi::String>().Utf8Value();
    }

    void import(const Napi::CallbackInfo& info) {
        if (info.Length() < 1 || !info[0].IsObject()) {
            Napi::TypeError::New(info.Env(), "Expected an object").ThrowAsJavaScriptException();
            return;
        }

        Napi::Object obj = info[0].As<Napi::Object>();
        this->Value().Set("data", obj);
    }
};


class ParserWrapper : public Napi::ObjectWrap<ParserWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("parser", DefineClass(env, "ParserWrapper", {
            InstanceMethod("fromString", &ParserWrapper::fromString),
            InstanceMethod("fromFile", &ParserWrapper::fromFile)
        }));
        return exports;
    }

    ParserWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<ParserWrapper>(info), parserOptions(info.Length() > 0 && info[0].IsObject() ? info[0].As<Napi::Object>().Get("buffer").ToBoolean(): false), ctx(parserOptions) {
        if (info.Length() > 0 && info[0].IsObject()) {
            Napi::Object opts = info[0].As<Napi::Object>();

            if (opts.Has("compact")) {
                parserOptions.compact = opts.Get("compact").ToBoolean();
            }
            if (opts.Has("vanilla")) {
                parserOptions.vanilla = opts.Get("vanilla").ToBoolean();
            }
            if (opts.Has("header")) {
                parserOptions.header = opts.Get("header").ToString().Utf8Value();
            }
            if (opts.Has("onText")) {
                onTextRef_ = Napi::Persistent(opts.Get("onText").As<Napi::Function>());
                parserOptions.onText = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view value, void* userData) {
                    if (userData == nullptr) {
                        return;
                    }

                    Napi::Env env = onTextRef_.Env();
                    Napi::String valueStr = Napi::String::New(env, value.data(), value.size());
                    Napi::Value stackTop = env.Null();
                    if (!tagStack.empty()) {
                        const auto& top = tagStack.top();
                        stackTop = Napi::String::New(env, top.data(), top.size());
                    }

                    Napi::Object* obj = static_cast<Napi::Object*>(userData);

                    Napi::Value result = onTextRef_.Call({ valueStr, stackTop, *obj });
                    if (result.IsString()) {
                        buffer += result.As<Napi::String>().Utf8Value();
                    }
                };
            }
            if (opts.Has("onOpeningTag")) {
                onOpeningTagRef_ = Napi::Persistent(opts.Get("onOpeningTag").As<Napi::Function>());
                parserOptions.onOpeningTag = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                    if (userData == nullptr) {
                        return;
                    }

                    Napi::Env env = onOpeningTagRef_.Env();
                    Napi::String tagStr = Napi::String::New(env, tag.data(), tag.size());
                    Napi::Value stackTop = env.Null();
                    if (!tagStack.empty()) {
                        const auto& top = tagStack.top();
                        stackTop = Napi::String::New(env, top.data(), top.size());
                    }

                    Napi::Object* obj = static_cast<Napi::Object*>(userData);

                    Napi::Value result = onOpeningTagRef_.Call({ tagStr, stackTop, *obj });
                    if (result.IsString()) {
                        buffer += result.As<Napi::String>().Utf8Value();
                    }
                };
            }
            if (opts.Has("onClosingTag")) {
                onClosingTagRef_ = Napi::Persistent(opts.Get("onClosingTag").As<Napi::Function>());
                parserOptions.onClosingTag = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                    if (userData == nullptr) {
                        return;
                    }

                    Napi::Env env = onClosingTagRef_.Env();
                    Napi::String tagStr = Napi::String::New(env, tag.data(), tag.size());
                    Napi::Value stackTop = env.Null();
                    if (!tagStack.empty()) {
                        const auto& top = tagStack.top();
                        stackTop = Napi::String::New(env, top.data(), top.size());
                    }

                    Napi::Object* obj = static_cast<Napi::Object*>(userData);

                    Napi::Value result = onClosingTagRef_.Call({ tagStr, stackTop, *obj });
                    if (result.IsString()) {
                        buffer += result.As<Napi::String>().Utf8Value();
                    }
                };
            }
            if (opts.Has("onInline")) {
                onInlineRef_ = Napi::Persistent(opts.Get("onInline").As<Napi::Function>());
                parserOptions.onInline = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                    if (userData == nullptr) {
                        return;
                    }

                    Napi::Env env = onInlineRef_.Env();
                    Napi::String tagStr = Napi::String::New(env, tag.data(), tag.size());
                    Napi::Value stackTop = env.Null();
                    if (!tagStack.empty()) {
                        const auto& top = tagStack.top();
                        stackTop = Napi::String::New(env, top.data(), top.size());
                    }

                    Napi::Object* obj = static_cast<Napi::Object*>(userData);

                    Napi::Value result = onInlineRef_.Call({ tagStr, stackTop, *obj });
                    if (result.IsString()) {
                        buffer += result.As<Napi::String>().Utf8Value();;
                    }
                };
            }
        }
    }

private:
    Napi::Value fromString(const Napi::CallbackInfo& info) {
        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
            Napi::TypeError::New(info.Env(), "Expected a string and a ParserContext instance").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }

        std::string source = info[0].As<Napi::String>().Utf8Value();
        
        Napi::Object ctxObj = info[1].As<Napi::Object>();
        ParserContext* run = Napi::ObjectWrap<ParserContext>::Unwrap(ctxObj);

        std::string result;
        run->result = &result;

        ctx.write(source, &result, &ctxObj);
        ctx.end(&result);

        return Napi::Buffer<char>::Copy(info.Env(), result.data(), result.size());
    }

    Napi::Value fromFile(const Napi::CallbackInfo& info) {
        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
            Napi::TypeError::New(info.Env(), "Expected a string and a ParserContext instance").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }

        std::string filePath = info[0].As<Napi::String>().Utf8Value();
        time_t currentTime = getFileLastModifiedTime(filePath);
        auto it = cache.find(filePath);

        if (it != cache.end() && it->second.lastModifiedTime == currentTime && info.Length() < 2) {
            return it->second.parsedData;
        }

        std::ifstream file(filePath, std::ios::in | std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            Napi::Error::New(info.Env(), "Unable to open file").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }

        std::streamsize size = file.tellg();
        file.seekg(0, std::ios::beg);
        std::vector<char> buffer(size);
        if (!file.read(buffer.data(), size)) {
            Napi::Error::New(info.Env(), "Error reading file").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }

        Napi::Object ctxObj = info[1].As<Napi::Object>();
        ParserContext* run = Napi::ObjectWrap<ParserContext>::Unwrap(ctxObj);

        std::string result;
        run->result = &result;

        ctx.write(std::string_view(buffer.data(), buffer.size()), &result, &ctxObj);
        ctx.end(&result);

        auto storage = std::make_shared<std::string>(std::move(result));

        Napi::Value data = Napi::Buffer<char>::New(info.Env(), const_cast<char*>(storage->data()), storage->size());

        cache[filePath] = { currentTime, data, storage };
        return data;
    }

    HTMLParserOptions parserOptions;
    HTMLParsingContext ctx;

    struct CacheEntry {
        time_t lastModifiedTime;
        Napi::Value parsedData;
        std::shared_ptr<std::string> storage;
    };

    static std::unordered_map<std::string, CacheEntry> cache;
    Napi::FunctionReference onTextRef_;
    Napi::FunctionReference onOpeningTagRef_;
    Napi::FunctionReference onClosingTagRef_;
    Napi::FunctionReference onInlineRef_;
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    ParserWrapper::Init(env, exports);
    ParserContext::Init(env, exports);

    exports.Set("version", Napi::String::New(env, "1.0.0"));

    return exports;
}

std::unordered_map<std::string, ParserWrapper::CacheEntry> ParserWrapper::cache;

NODE_API_MODULE(parser, InitAll)
