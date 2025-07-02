{
  "targets": [
    {
      "target_name": "parser",
      "sources": ["napi-bindings/x-parser-napi.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags": ["-std=c++17", "-O3", "-flto", "-fexceptions"],
      "cflags_cc": ["-std=c++17", "-O3", "-flto", "-fexceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}