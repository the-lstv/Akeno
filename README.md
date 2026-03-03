![Group 357](https://github.com/user-attachments/assets/f6377875-ba97-4a1b-80aa-2ce5ff0374ae)

Atrium is the parser that powers [Akeno](https://github.com/the-lstv/Akeno).<br>
It is extremely fast, zero-dependency, memory-efficient and highly configurable and versatile parser written in JavaScript.

It efficiently manages block states and only clones objects when necesarry.

---

### Usage
This is the most basic way to use the parser:
```js
const { parse } = require("./atrium")

parse("hello { world }", {
  onBlock(block) {
    console.log(block) // { name: "hello", attributes: [], properties: { world: [ true ] } }
  }
})
```
Options include:
- `content`: the content to parse
- `embedded`: run in embedded mode
- `strict`: if true, errors will terminate parsing
- `onBlock`: called when a block is parsed
- `onText`: called on text in embed mode
- `onError`: called on syntax errors
- `asArray`: if the parse function should return an array of blocks
- `asLookupTable`: if the parse function should a lookup map for efficient data access

### Syntax
![Syntax](https://github.com/user-attachments/assets/29618798-503f-464b-8028-7d9619207594)


### Embedded mode
Atrium also works inside text, like HTML, using embedded mode.<br>
Embedded mode requires all blocks to begin with "@".
```js
const { parse } = require("./atrium")

parse("<div> @hello ("World"); </div>", {
  embedded: true,
  onBlock(block) {
    console.log(block)
  },
  onText(text) {
    console.log(text) // "<div> ", " </div>"
  }
})
```

### Streaming (Currently not fully implemented)
Streaming allows for realtime or more efficient parsing, when you receive content in chunks, to avoid having to concat all chunks and parse them all at once.
```js
const { parserStream } = require("./atrium")

const stream = new parserStream({
  onBlock(block) {
    console.log(block)
  }
})

stream.write("blo")
stream.write("ck {")
stream.write("} ") // At this point, onBlock would be called

stream.end()
```

### Performance
Atrium is highly optimized for both speed and memory efficiency.<br>
This is so it can be used in places where latency and efficiency matter (like webservers, dynamic scripting, etc.).<br>
You can use this performance as an advantage for any usecase - from config files to realtime scripting.

### Flexibility
Atrium has an extremely flexible syntax, allowing you to use it in many ways.<br>
All of the following are valid block definitions:
```js
block;
block key;
block();
block() key;
block() { key }
block { key }
```
