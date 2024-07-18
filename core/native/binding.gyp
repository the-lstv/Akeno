{
	"targets": [
		{
			"target_name": "native",
			"sources": ["native.cpp"],
			"include_dirs": ["/www/node/shared_modules/node_modules/node-addon-api"],
			"cflags": ["-fexceptions"],
			"cflags_cc": ["-fexceptions"]
		}
	]
}