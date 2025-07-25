// #include "x-parser.cpp"

#include <napi.h>
#include <unordered_map>
#include <fstream>
#include <sys/stat.h>
#include <memory>
#include <utility>

#include "../external/xxHash/xxh3.h"

#include "ParserContext.h"
#include "ParserWrapper.h"

// static time_t getFileLastModifiedTime(const std::string& filePath) {
//     struct stat fileStat;
//     if (stat(filePath.c_str(), &fileStat) == 0) {
//         return fileStat.st_mtime;
//     }
//     return 0;
// }




/*
    TODO optimizations:
    - Use a buffer for the input/result string
    - Use StringView on the JS side to avoid copying strings
*/







void ParserContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ParserContext", {
        InstanceMethod("write", &ParserContext::write),
        InstanceMethod("onText", &ParserContext::write),
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
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(info.Env(), "Expected a string").ThrowAsJavaScriptException();
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
    ParserContext* run = Napi::ObjectWrap<ParserContext>::Unwrap(ctxObj);

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
    bool nested = false;

    Napi::Value dataValue = ctxObj.Get("data");
    if (dataValue.IsObject()) {
        Napi::Object dataObj = dataValue.As<Napi::Object>();
        Napi::Value pathValue = dataObj.Get("path");
        if (pathValue.IsString()) {
            appPath = pathValue.As<Napi::String>().Utf8Value();
        }

        Napi::Value nestedValue = dataObj.Get("nested");
        if (nestedValue.IsBoolean()) {
            nested = nestedValue.As<Napi::Boolean>().Value();
        }
    }

    ctx.templateEnabled = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;

    // Generated by Copilot
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








Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    ParserWrapper::Init(env, exports);
    ParserContext::Init(env, exports);

    exports.Set("version", Napi::String::New(env, "1.0.0"));

    return exports;
}

Napi::FunctionReference ParserContext::constructor;

NODE_API_MODULE(parser, InitAll)
