<p align="center"><img src="https://github.com/the-lstv/Akeno/assets/62482747/d29fb374-aef6-444f-88b1-43aede48fe41" alt="Akeno icon"></p>

Akeno is a fast, rich, modular, mostly automated Node.JS web (static and dynamic), WebSocket, CDN, and API server which comes as a full-featured suite with DNS, SSL, DB and user management (all available optionally as addons).<br>
It uses its universal config system to make it easy to manage large quantities of projects or servers all at once.<br>
<br>
It has a performance-first webserver, with automated caching, code compression, and a custom HTML parser which allows you to write clean and easier-to-read code, with less maintenance needed.

**WARNING:** The latest update has bought MANY breaking changes to the server!

---
Quick installation (Fedora Linux Server Edition) <br>
Required: `node`, `pm2` (npm i -g pm2), ``
```sh
curl run.lstv.space/install-akeno -s -o /tmp/akeno-setup && sudo bash /tmp/akeno-setup
```
To run automatically on startup and enable `akeno -i`:
```sh
sudo pm2 start /www/content/akeno/app.js --name egapi # If your path differs from the default, replace it.
```

---
<br>

![🚀 Fast](https://github.com/the-lstv/Akeno/assets/62482747/d7f3466c-c833-4fca-a57b-e93f7aca0882)
---

Akeno excels in top-notch performance.

The entire server is started and ready in **5ms** or less on average (making it faster than most modern large servers which can take minutes), and uses uWebSockets (a low-level, incredibly optimized C++ web server) for its HTTP and WebSocket traffic - making it **8.5x** faster than the already fast framework Fastify (according to [uWS](https://github.com/uNetworking/uWebSockets.js)).

On top of that, Akeno has smart caching directly to memory, automatic cache header, automatic ?mtime query parametter for file changes, and much more.

Akeno automatically compresses all of your HTML, CSS and JS code on the fly - saving you the hassle of having to make copies or compress yourself.
Just write the code and watch the magic happen in real time.


<br><br>


![🗃️ Modular](https://github.com/the-lstv/Akeno/assets/62482747/dceb9b55-d46d-468b-9338-95369bb568d7)
---
Akeno is also fully modular. On first startup, it only loads what is necesarry. Everything else is loaded as requested, on the fly.
This includes API extensions - simply create a JS file with your server-side API in your web app's directory, hot-reload the config and your API is ready to use.


<br><br>


![🖥️ CLI](https://github.com/the-lstv/Akeno/assets/62482747/924f2a21-91f4-4a42-9c22-bbe25f44ec48)
---
Akeno offers a full-featured command line interface that you can use to control the server on runtime, see stats, manage apps, or interact with its API.

