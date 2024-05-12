let verbose=!1,fs=require("fs"),exec=require('node:child_process').exec,time=Date.now(),
css=fs.readFileSync("./content/ls.css","utf8"),
jsSize=getFilesize("./content/ls.js"),
size=+css.length,
remove=[
    "\n",
    "\r",
    "\t",
    ["   "," "],
    ["  "," "],
    ["  "," "],
    "*//*",
    [";}","}"],
    ["; ",";"],
    [" }","}"],
    ["} ","}"],
    [" {","{"],
    ["{ ","{"],
    ["0.","."],
    [" :",":"],
    [": ",":"],
    [":0px",":0"],
    [", ",","]
];
function getFilesize(filename) {
    var stats = fs.statSync(filename);
    var fileSizeInBytes = stats.size;
    return fileSizeInBytes;
}
let babel=exec('cd /www/node/shared_modules && npx babel /www/content/extragon/cdn/content/ls.js --out-file /www/content/extragon/cdn/content/ls.compat.js --config-file /www/node/shared_modules/babel.config.js');
babel.stdout.on('data', (data) => {
    if(verbose)console.log(`babel: ${data}`);
})
babel.stderr.on('data', (data) => {
    console.error(`[91mbabel error: ${data}[0m`);
})
babel.on('close',(code)=>{
    let uglifyjs=exec('npx uglifyjs -m -c --comments "/--(.*?)--|\\<(.*?)\\>/" -o ./content/ls.min.js -- ./content/ls.compat.js');
    uglifyjs.stdout.on('data', (data) => {
        if(verbose)console.log(`UglifyJS: ${data}`);
    })
    uglifyjs.stderr.on('data', (data) => {
        console.error(`[91mUglifyJS error: ${data}[0m`);
    })
    uglifyjs.on('close',(code)=>{
        remove.forEach(r=>{
            let w="";
            if(Array.isArray(r)){w=r[1];r=r[0]}
            css=css.replaceAll(r,w)
        })
        fs.writeFileSync("./content/ls.min.css",css)
        let sn=getFilesize("./content/ls.min.js"),
            cs=getFilesize("./content/ls.compat.js");
        console.log(`[92mDone!\nJS: Original size: ${jsSize}, compat size: ${cs}, new size: ${sn}, lost: ${jsSize-sn}\nCSS: Original size: ${size}, new size: ${css.length}, lost: ${size-css.length}\nIn total, took ${Date.now()-time}ms\nTotal bundle size: ${css.length+sn} (instead of ${size+jsSize})[0m`)
    });
});