#pragma once

#include <napi.h>
#include <stack>
#include <string>
#include <unordered_map>
#include <memory>
#include "../external/xxHash/xxh3.h"

#include "../x-parser.cpp"

class ParserContext; // Forward declaration

class ParserWrapper : public Napi::ObjectWrap<ParserWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    ParserWrapper(const Napi::CallbackInfo& info);
    HTMLParserOptions parserOptions;
    HTMLParsingContext ctx;

private:
    Napi::Env env_;
    Napi::FunctionReference onTextRef_;
    Napi::FunctionReference onOpeningTagRef_;
    Napi::FunctionReference onClosingTagRef_;
    Napi::FunctionReference onInlineRef_;

    Napi::Value createContext(const Napi::CallbackInfo& info);
    Napi::Value fromString(const Napi::CallbackInfo& info);
    Napi::Value fromFile(const Napi::CallbackInfo& info);
};