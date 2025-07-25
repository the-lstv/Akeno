#pragma once

#include <napi.h>
#include <string>
#include <fstream>
#include <vector>

class ParserWrapper; // Forward declaration

class ParserContext : public Napi::ObjectWrap<ParserContext> {
public:
    static Napi::FunctionReference constructor;
    static void Init(Napi::Env env, Napi::Object exports);
    ParserContext(const Napi::CallbackInfo& info);

    std::string* head;

private:
    Napi::Env env_;
    ParserWrapper* parser;

    void write(const Napi::CallbackInfo& info);
    // void writeHead(const Napi::CallbackInfo& info);
    void import(const Napi::CallbackInfo& info);
    Napi::Value getTagName(const Napi::CallbackInfo& info);
    void setBodyAttributes(const Napi::CallbackInfo& info);
};