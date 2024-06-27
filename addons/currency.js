let ThisAPP
	fs = require("fs"),
	cachePath = "/www/content/akeno/addons/data/currencyCache.json",
	memoryCache = null,
	backend, isDev
;

ThisAPP = {
    Initialize(Backend){
        // backend = Backend;
        // isDev = Backend.isDev;

        // backend.registerHotPath("/v2/currency", ThisAPP.HandleRequest)
    },

    async HandleRequest({res}){
		let mtime = fs.statSync(cachePath).mtimeMs;


		if((Date.now() - mtime) > 9216000){
			ThisAPP.log("Refreshing conversion rates!")
			memoryCache = await(await fetch("https://api.currencyapi.com/v3/latest?apikey=cur_live_fCvYaBriqxMob7YUBhoKEFby1kEoq0Yhh5ZNdu5O")).buffer()
			fs.writeFileSync(cachePath, memoryCache)
		}

        res.send(memoryCache || fs.readFileSync(cachePath), {
			"cache-control": "public, max-age=128"
		})
    }
}

module.exports = ThisAPP;