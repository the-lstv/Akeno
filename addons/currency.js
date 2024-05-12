let ThisAPP
	fs = require("fs"),
	cachePath = "/www/content/akeno/addons/data/currencyCache.json",
	memoryCache = null
;

ThisAPP = {
    async HandleRequest({send, res}){

		res.wait = true;

		let data, mtime = fs.statSync(cachePath).mtimeMs;

		if((Date.now() - mtime) > 9216000){
			ThisAPP.log("Refreshing conversion rates!")
			memoryCache = await(await fetch("https://api.currencyapi.com/v3/latest?apikey=cur_live_fCvYaBriqxMob7YUBhoKEFby1kEoq0Yhh5ZNdu5O")).text()
			fs.writeFileSync(cachePath, memoryCache)
		}

        send(memoryCache || fs.readFileSync(cachePath, "utf8"))
    }
}

module.exports = ThisAPP;