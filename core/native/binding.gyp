{
  "targets": [
    {
      "target_name": "parser",
      "sources": ["napi-bindings/x-parser-napi.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags": ["-std=c++17", "-O3", "-fexceptions"],
      "cflags_cc": ["-std=c++17", "-O3", "-fexceptions"],
      # "cflags": ["-std=c++17", "-fexceptions"],
      # "cflags_cc": ["-std=c++17", "-fexceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}