<img src="https://cdn.extragon.cloud/file/3e1df84164d20daef3e178bd1c08b9e5.png?size=140" alt="Akeno icon">

# Akeno

Akeno is a fast, rich, modular, mostly automated Node.JS web, websocket, CDN, and API server.<br>
It uses its universal config system to make it easy to manage large quantities of projects or servers all at once.<br>
<br>
It has a performance-first webserver, with automated caching, code compression, and a custom HTML parser which allows you to write clean and easier-to-read code, with less maintenance needed.

---

![🚀 Fast](https://github.com/the-lstv/Akeno/assets/62482747/ab7031f0-9fb4-4908-81dc-b91cafcc66c4)
---
Akeno excels in top-notch performance.

The entire server is started and ready in 5ms or less on average, and uses uWebSockets for its HTTP and WebSocket traffic - making it **8.5x** faster than the already fast framework Fastify (according to [this](https://github.com/uNetworking/uWebSockets.js)).

On top of that, Akeno has smart caching directly to memory, automatic cache header, automatic ?mtime query parametter for file changes, and much more.

Akeno automatically compresses all of your HTML, CSS and JS code on the fly - saving you the hassle of having to make copies or compress yourself.
Just write the code and watch the magic happen in real time.

Akeno is also fully modular. On first startup, it only loads what is necesarry. Everything else is loaded as requested, on the fly.
