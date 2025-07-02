const fs = require("fs");
const HTMLParser = require("./dist/html-parser.node");
const htmlparser = require("htmlparser2");




const file_path = "./test.xw";
let html_string = fs.readFileSync(file_path, "utf8");



const parser = new HTMLParser.parser({
    buffer: true,
    // compact: true,

    onText(text, parent, context) {
        // console.log(JSON.stringify(text), " -> ", parent);

        console.log(context);

        if(text === "test_import") {
            context.import("./test.xw");
            return;
        }
        

        return text;
        // if(!text.trim()) return;

        // context.onText("<b>");
        // context.onText(text.trim());
        // context.onText("</b>");
    }
});





const context = parser.createContext({});

console.log(parser.fromString(`<head>
    <title>Test</title>
</head>

<body>
    <span>test_import</span>
    <div>
        Reactivity test: {{ value }}
    </div>
</body>`, context).toString());

// console.log(parser.fromString(`<head>
//     <title>Test</title>
// </head>

// <body>
//     <div>
//         Reactivity test: {{ value }}
//     </div>
// </body>`, context).toString());

// console.log(context);



// console.log(parser.fromString(`
// <head>
//     <title>Test</title>
// </head>

// <body>
//     <div>
//         Test
//     </div>
// </body>`, context).toString());

// console.log(parser.fromString(html_string, context).toString());
// console.log(parser.fromFile(file_path, context).toString());
// console.log(parser.fromFile(file_path, context).toString());
// console.log(parser.fromFile(file_path, context).toString());
// console.log(parser.fromString(html_string, context).toString());
// console.log(parser.fromString(html_string, context).toString());
// console.log(parser.fromFile(file_path, context).toString());


// const testDurationSeconds = 5;
// let iterations = 0;
// let totalRuntime = 0;

// let startTime = performance.now();
// let currentTime = startTime;

// while ((currentTime - startTime) / 1000 < testDurationSeconds) {
//     let iterationStartTime = performance.now();

//     // parser.fromFile(file_path, context);
//     parser.fromString(html_string, context);
//     // parser.fromFile(file_path, new HTMLParser.context);

//     let iterationEndTime = performance.now();
//     totalRuntime += (iterationEndTime - iterationStartTime);
//     iterations++;
//     currentTime = performance.now();
// }

// let duration = (currentTime - startTime) / 1000; // convert to seconds
// let opsPerSecond = iterations / duration;
// let averageRuntime = totalRuntime / iterations;

// console.log(`Operations per second (custom parser): ${opsPerSecond.toFixed(6)}`);
// console.log(`Average runtime per operation (custom parser): ${averageRuntime.toFixed(6)} ms`);
// console.log(`Total number of runs in ${testDurationSeconds}s (custom parser): ${iterations}`);

// iterations = 0;
// totalRuntime = 0;
// startTime = performance.now();
// currentTime = startTime;

// const voidElements = new Set([
//     "area",
//     "base",
//     "basefont",
//     "br",
//     "col",
//     "command",
//     "embed",
//     "frame",
//     "hr",
//     "img",
//     "input",
//     "isindex",
//     "keygen",
//     "link",
//     "meta",
//     "param",
//     "source",
//     "track",
//     "wbr",
// ]);

// while ((currentTime - startTime) / 1000 < testDurationSeconds) {
//     let iterationStartTime = performance.now();

//     let string = "";

//     function push(value) {
//         string += value;
//     }

//     const parser = new htmlparser.Parser({
//         onopentag(name, attribs) {
//             let result = "<";

//             script_type = name === "script" && attribs.type? attribs.type: null;
//             currentTag = name;

//             if(!attribs.class) attribs.class = "";

//             result += name;

//             for(let attr in attribs) {
//                 if (attr === "class" || attr === "id") continue;

//                 if (attr.startsWith('.')) {
//                     attribs.class += " " + attr.slice(1).replaceAll(".", " ");
//                     continue
//                 }

//                 if (attr.startsWith('%') || attr.startsWith('#')) {
//                     attribs.id = attr.slice(1)
//                     continue
//                 }

//                 let value = attribs[attr];

//                 if(value){
//                     if (value.includes(`"`) && value.includes(`'`)) {
//                         value = `"${value.replace(/"/g, '&quot;')}"`;
//                     } else if (value.includes('"')) {
//                         value = `'${value}'`;
//                     } else if (value.includes(" ") || value.includes("'")) {
//                         value = `"${value}"`;
//                     }

//                     result += ` ${attr}=${value}`;
//                     continue
//                 }

//                 result += " " + attr;
//             }

//             if (attribs.class) result += ` class="${attribs.class.trim()}"`;
//             if (attribs.id) result += ` id=${attribs.id.replaceAll(" ", "")}`;

//             push(result + ">");
//         },

//         ontext(text) {
//             push(text);
//         },

//         onclosetag(name) {
//             if(voidElements.has(name)) return;
//             push(`</${name}>`);
//         }
//     }, {
//         lowerCaseAttributeNames: false
//     });

//     parser.write(html_string);
//     parser.end();

//     let iterationEndTime = performance.now();
//     totalRuntime += (iterationEndTime - iterationStartTime);
//     iterations++;
//     currentTime = performance.now();
// }

// duration = (currentTime - startTime) / 1000; // convert to seconds
// opsPerSecond = iterations / duration;
// averageRuntime = totalRuntime / iterations;

// console.log(`Operations per second (htmlparser2): ${opsPerSecond.toFixed(6)}`);
// console.log(`Average runtime per operation (htmlparser2): ${averageRuntime.toFixed(6)} ms`);
// console.log(`Total number of runs in ${testDurationSeconds}s (htmlparser2): ${iterations}`);