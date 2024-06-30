let ThisAPP,
	fs = require("fs"),
	cachePath = "/www/content/akeno/addons/data/currencyCache.json",
	memoryCache = null,
	mtime = fs.statSync(cachePath).mtimeMs
;

ThisAPP = {
    async HandleRequest({res}){

		if((Date.now() - mtime) > 9216000){
			ThisAPP.log("Refreshing conversion rates!")

			memoryCache = Buffer.from(await(await fetch("https://api.currencyapi.com/v3/latest?apikey=cur_live_fCvYaBriqxMob7YUBhoKEFby1kEoq0Yhh5ZNdu5O")).arrayBuffer())

			fs.writeFileSync(cachePath, memoryCache)
			mtime = fs.statSync(cachePath).mtimeMs
		}

        res.send(memoryCache || fs.readFileSync(cachePath), {
			"cache-control": "public, max-age=128",
			"content-type": "application/json"
		})
    }
}

module.exports = ThisAPP;