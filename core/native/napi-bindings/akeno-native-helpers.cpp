// #include "x-parser.cpp"

#include <napi.h>
// #include <v8.h>
#include <unordered_map>
#include <fstream>
#include <sys/stat.h>
#include <memory>
#include <utility>

#include "../external/xxHash/xxh3.h"

#include "ParserContext.h"
#include "ParserWrapper.h"

// !! TODO: Use v8 directly instead of napi, and remove the napi dependency

void ParserContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ParserContext", {
        InstanceMethod("write", &ParserContext::write),
        InstanceMethod("onText", &ParserContext::write), // Special case
        InstanceMethod("getTagName", &ParserContext::getTagName),
        InstanceMethod("setBodyAttributes", &ParserContext::setBodyAttributes),
        // InstanceMethod("writeHead", &ParserContext::writeHead),
        InstanceMethod("import", &ParserContext::import),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("context", func);
}

ParserContext::ParserContext(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<ParserContext>(info), env_(info.Env()) {
    if (info.Length() < 1 || !info[0].IsExternal()) {
        Napi::TypeError::New(info.Env(), "Expected an external reference to a ParserWrapper instance").ThrowAsJavaScriptException();
        return;
    }

    parser = info[0].As<Napi::External<ParserWrapper>>().Data();

    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object obj = info[1].As<Napi::Object>();
        this->Value().Set("data", obj);
    }

    this->Value().Set("embedded", Napi::Boolean::New(info.Env(), true));
    this->Value().Set("strict", Napi::Boolean::New(info.Env(), false));
}

void ParserContext::write(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || (!info[0].IsString() && !info[0].IsBuffer())) {
        Napi::TypeError::New(info.Env(), "Expected a string or a buffer").ThrowAsJavaScriptException();
        return;
    }

    if (info[0].IsBuffer()) {
        Napi::Buffer<char> buffer = info[0].As<Napi::Buffer<char>>();
        *parser->ctx.output += std::string(buffer.Data(), buffer.Length());
        return;
    }

    *parser->ctx.output += info[0].As<Napi::String>().Utf8Value();
}

Napi::Value ParserContext::getTagName(const Napi::CallbackInfo& info) {
    if (!parser->ctx.tagStack.empty()) {
        const auto& top = parser->ctx.tagStack.top();
        return Napi::String::New(env_, top.data(), top.size());
    }

    return env_.Null();
}

void ParserContext::setBodyAttributes(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
        return;
    }

    parser->ctx.body_attributes = info[0].As<Napi::String>().Utf8Value();
}

// void ParserContext::writeHead(const Napi::CallbackInfo& info) {
//     if (info.Length() < 1 || !info[0].IsString()) {
//         Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
//         return;
//     }

//     *result += info[0].As<Napi::String>().Utf8Value();
// }

void ParserContext::import(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
        return;
    }

    std::string filePath = info[0].As<Napi::String>().Utf8Value();

    try {
        parser->ctx.inlineFile(filePath);
    } catch (const std::runtime_error& e) {
        Napi::Error::New(info.Env(), e.what()).ThrowAsJavaScriptException();
    }
}










Napi::Object ParserWrapper::Init(Napi::Env env, Napi::Object exports) {
    exports.Set("parser", DefineClass(env, "ParserWrapper", {
        InstanceMethod("fromString", &ParserWrapper::fromString),
        InstanceMethod("fromFile", &ParserWrapper::fromFile),
        InstanceMethod("createContext", &ParserWrapper::createContext),
        InstanceMethod("needsUpdate", &ParserWrapper::needsUpdate)
    }));
    return exports;
}

ParserWrapper::ParserWrapper(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<ParserWrapper>(info), 
      parserOptions(info.Length() > 0 && info[0].IsObject() ? info[0].As<Napi::Object>().Get("buffer").ToBoolean() : false), 
      ctx(parserOptions), 
      env_(info.Env()) {
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
                if (userData == nullptr || value.empty()) {
                    return;
                }

                bool isScriptOrStyle = false;
                if (!tagStack.empty()) {
                    const auto& top = tagStack.top();
                    isScriptOrStyle = (top == "script" || top == "style");
                }

                bool hasAtSymbol = value.find('@') != std::string_view::npos;
                if (!hasAtSymbol && !isScriptOrStyle) {
                    buffer.append(value);
                    return;
                }

                Napi::String valueStr = Napi::String::New(env_, value.data(), value.size());
                Napi::Value stackTop = env_.Null();
                if (!tagStack.empty()) {
                    const auto& top = tagStack.top();
                    stackTop = Napi::String::New(env_, top.data(), top.size());
                }

                Napi::Object* obj = static_cast<Napi::Object*>(userData);
                Napi::Value result = onTextRef_.Call({ valueStr, stackTop, *obj });

                if (result.IsString()) {
                    buffer.append(result.As<Napi::String>().Utf8Value());
                }

                if (result.IsBuffer()) {
                    Napi::Buffer<char> buf = result.As<Napi::Buffer<char>>();
                    buffer.append(buf.Data(), buf.Length());
                }

                if (result.IsBoolean() && result.As<Napi::Boolean>().Value()) {
                    buffer.append(value);
                }
            };
        }

        if (opts.Has("onOpeningTag")) {
            onOpeningTagRef_ = Napi::Persistent(opts.Get("onOpeningTag").As<Napi::Function>());
            parserOptions.onOpeningTag = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                if (userData == nullptr) {
                    return;
                }

                Napi::String tagStr = Napi::String::New(env_, tag.data(), tag.size());
                Napi::Value stackTop = env_.Null();
                if (!tagStack.empty()) {
                    const auto& top = tagStack.top();
                    stackTop = Napi::String::New(env_, top.data(), top.size());
                }

                Napi::Object* obj = static_cast<Napi::Object*>(userData);

                Napi::Value result = onOpeningTagRef_.Call({ tagStr, stackTop, *obj });
                if (result.IsString()) {
                    buffer.append(result.As<Napi::String>().Utf8Value());
                }
            };
        }

        if (opts.Has("onClosingTag")) {
            onClosingTagRef_ = Napi::Persistent(opts.Get("onClosingTag").As<Napi::Function>());
            parserOptions.onClosingTag = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                if (userData == nullptr) {
                    return;
                }

                Napi::String tagStr = Napi::String::New(env_, tag.data(), tag.size());
                Napi::Value stackTop = env_.Null();
                if (!tagStack.empty()) {
                    const auto& top = tagStack.top();
                    stackTop = Napi::String::New(env_, top.data(), top.size());
                }

                Napi::Object* obj = static_cast<Napi::Object*>(userData);

                Napi::Value result = onClosingTagRef_.Call({ tagStr, stackTop, *obj });
                if (result.IsString()) {
                    buffer.append(result.As<Napi::String>().Utf8Value());
                }
            };
        }

        if (opts.Has("onInline")) {
            onInlineRef_ = Napi::Persistent(opts.Get("onInline").As<Napi::Function>());
            parserOptions.onInline = [&](std::string& buffer, std::stack<std::string_view>& tagStack, std::string_view tag, void* userData) {
                if (userData == nullptr) {
                    return;
                }

                Napi::String tagStr = Napi::String::New(env_, tag.data(), tag.size());
                Napi::Value stackTop = env_.Null();
                if (!tagStack.empty()) {
                    const auto& top = tagStack.top();
                    stackTop = Napi::String::New(env_, top.data(), top.size());
                }

                Napi::Object* obj = static_cast<Napi::Object*>(userData);

                Napi::Value result = onInlineRef_.Call({ tagStr, stackTop, *obj });
                if (result.IsString()) {
                    buffer.append(result.As<Napi::String>().Utf8Value());
                }
            };
        }

        if (opts.Has("onEnd")) {
            onEndRef_ = Napi::Persistent(opts.Get("onEnd").As<Napi::Function>());
            parserOptions.onEnd = [&](void* userData) {
                if (userData == nullptr) {
                    return;
                }

                Napi::Object* obj = static_cast<Napi::Object*>(userData);
                onEndRef_.Call({ *obj });
            };
        }
    }
}

Napi::Value ParserWrapper::createContext(const Napi::CallbackInfo& info) {
    return ParserContext::constructor.New({ Napi::External<ParserWrapper>::New(env_, this), info[0] });
}

Napi::Value ParserWrapper::fromString(const Napi::CallbackInfo& info) {
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        Napi::TypeError::New(info.Env(), "Expected a string and a ParserContext instance").ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }

    std::string source = info[0].As<Napi::String>().Utf8Value();

    Napi::Object ctxObj = info[1].As<Napi::Object>();

    std::string result;
    ctx.write(source, &result, &ctxObj);
    ctx.end();

    return Napi::Buffer<char>::Copy(info.Env(), result.data(), result.size());
}

Napi::Value ParserWrapper::fromFile(const Napi::CallbackInfo& info) {
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        Napi::TypeError::New(info.Env(), "Expected a string and a ParserContext instance").ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }

    std::string filePath = info[0].As<Napi::String>().Utf8Value();

    Napi::Object ctxObj = info[1].As<Napi::Object>();

    std::string appPath;

    Napi::Value dataValue = ctxObj.Get("data");
    if (dataValue.IsObject()) {
        Napi::Object dataObj = dataValue.As<Napi::Object>();
        Napi::Value pathValue = dataObj.Get("path");
        if (pathValue.IsString()) {
            appPath = pathValue.As<Napi::String>().Utf8Value();
        }
    }

    ctx.templateEnabled = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;

    FileCache& result = ctx.fromFile(filePath, &ctxObj, appPath);

    // Create a shared_ptr to manage the lifetime of the string data
    auto* storagePtr = new std::shared_ptr<std::string>(std::make_shared<std::string>(std::move(ctx.exportCopy(&result))));

    Napi::Value data = Napi::Buffer<char>::New(
        info.Env(),
        const_cast<char*>((*storagePtr)->data()),
        (*storagePtr)->size(),
        [](Napi::Env env, char* data, void* hint) {
            auto* sp = static_cast<std::shared_ptr<std::string>*>(hint);
            delete sp; // Decrease ref count and delete holder
        },
        storagePtr
    );

    return data;
}

Napi::Value ParserWrapper::needsUpdate(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }

    std::string filePath = info[0].As<Napi::String>().Utf8Value();

    bool needsUpdate = ctx.needsUpdate(filePath);
    return Napi::Boolean::New(info.Env(), needsUpdate);
}


enum LogLevel {
    LOG_DEBUG = 0,
    LOG_INFO = 1,
    LOG_WARN = 3,
    LOG_ERROR = 4,
    LOG_FATAL = 5
};


static int lineCount = 0;

// TODO: Detect whether to use ansi and fancy logs
// TODO: Performance sucks, need to optimize and refactor this


void WriteLog(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected level (number), source (string), and data").ThrowAsJavaScriptException();
        return;
    }

    int level = info[0].As<Napi::Number>().Int32Value();
    std::string source = info[1].As<Napi::String>().Utf8Value();
    const size_t sourceLen = source.length();

    const char* color = level >= LogLevel::LOG_ERROR ? "1;31" : (level == LogLevel::LOG_WARN ? "1;33" : "36");
    const char* suffix = level > LogLevel::LOG_ERROR ? "0;1" : "0";

    if (level > LogLevel::LOG_ERROR) {
        std::cout << "* ";
    }

    std::cout << "\x1b[" << color << "m[" << source << "]\x1b[" << suffix << "m";

    std::string continuation = "\n";
    if (sourceLen > 0) {
        continuation += std::string(sourceLen - 1, ' ');
    }
    continuation += "\x1b[90m⤷\x1b[0m   ";

    for (size_t i = 2; i < info.Length(); ++i) {
        if (!info[i].IsString()) {
            std::cout << " [object]";
            continue;
        }

        std::string arg = info[i].As<Napi::String>().Utf8Value();
        std::string_view view(arg);

        std::cout << " ";
        size_t start = 0;
        size_t newline;
        while ((newline = view.find('\n', start)) != std::string_view::npos) {
            std::cout.write(view.data() + start, newline - start);
            std::cout << continuation;
            start = newline + 1;
        }

        if (start < arg.size()) {
            std::cout.write(arg.data() + start, arg.size() - start);
        }
    }

    lineCount++;

    std::cout << '\n';

    // if (lineCount % 10 == 0 || level >= LOG_ERROR) {
    //     std::cout << std::flush;
    // }
}





Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    ParserWrapper::Init(env, exports);
    ParserContext::Init(env, exports);

    exports.Set("version", Napi::String::New(env, "1.1.0"));
    exports.Set("writeLog", Napi::Function::New(env, WriteLog));

    return exports;
}

Napi::FunctionReference ParserContext::constructor;

NODE_API_MODULE(parser, InitAll)
