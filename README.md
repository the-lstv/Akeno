<img src="https://cdn.extragon.cloud/file/a6ee0da416b4eebcd4c9899fa9caa0d7.png" alt="Akeno icon"> <br>

Akeno is a really fast, modular server and web application runtime/framework, primarily intended for:<br>
- Static and dynamic web sites/apps
- Realtime web apps
- Low-latency APIs
- Content delivery
- User management

It supports various configurations for HTTP, HTTPS, HTTP3 (experimental), and WebSocket protocols.<br>
Though thanks to its modularity, it can be easily expanded.


The most interesting part is its webserver, which is extremely optimized and has some very nice features that make developing and deploying websites or apps really simple!


---
### Quick installation
Requires node, npm, git, gcc, g++, and python (attempts to install automatically if not found). We plan to reduce the amount of dependencies to just two in future updates by packaging prebuilt binaries.<br>

**NOTE:** At this time Akeno only works on Linux x86_64. Official Windows support is not planned yet. While Akeno may run on Windows, its support is highly experimental and may not fully work up to expectations.<br>
```sh
curl run.lstv.space/install-akeno -s -o /tmp/akeno-setup && sudo bash /tmp/akeno-setup
```
You can then start Akeno with
```sh
akeno start
```
Or, to run under a process manager (recommended):
```sh
sudo pm2 start /usr/lib/akeno/app.js --name Akeno
```

---
<br>

![🚀 Fast](https://github.com/the-lstv/Akeno/assets/62482747/d7f3466c-c833-4fca-a57b-e93f7aca0882)
---

Akeno is heavily focused on speed, efficiency and low-latency, making it very scalable and responsive, so you and your clients no longer have to deal with slow web apps.

The entire server is started and ready in a few milliseconds on average, depending on loaded modules. This is already miles ahead of most full-featured servers.

For HTTP and WebSocket traffic, we use [uWebSockets](https://github.com/uNetworking/uWebSockets.js) (a low-level, incredibly optimized web server written in C++) - which is one of the fastest standard-compliant servers in the world, **~8.5x** faster than the already fast framework Fastify.

Even with a full setup including routing, caching, dynamic content and encryption, Akeno is still multiple times faster than even the most minimal express server, out of the box.

Akeno's powerful content preprocessor, which can handle advanced HTML templates in real time or even our custom application syntax, can prepare a full response including compilation without cache in less than 1-2ms. This is even faster for basic HTML documents simpler transformations like compression.
This makes Akeno faster than most frameworks out there!
With memory cache (which is automatic and based on file changes), the response can be prepared in as low as a few microseconds.

Akeno automatically handles cache for websites and assets, having both server-side compilation cache and client-side cache via an ?mtime query parametter, which is added automatically to all assets and resources.

This means that you no longer have to worry about caching or cache busting - Akeno ensures that your clients always get the latest version of your content, while still utilizing caching to the fullest extent.

Akeno can also compresses all of your code on the fly.<br>

Just write your code and let Akeno optimize it in real time, without any extra hassles.<br><br>

Akeno is faster than popular servers like Nginx for both static and dynamic content.<br>


<br><br>


![🗃️ Modular](https://github.com/the-lstv/Akeno/assets/62482747/dceb9b55-d46d-468b-9338-95369bb568d7)
---
Akeno is fully modular. On first startup, it only loads what is necesarry. Everything else is loaded as requested, on the fly.
This includes API extensions - simply create a JS file with your server-side API in your web app's directory, hot-reload the config and your API is ready to use.


<br><br>


![🖥️ CLI](https://github.com/the-lstv/Akeno/assets/62482747/924f2a21-91f4-4a42-9c22-bbe25f44ec48)
---
Akeno offers a full-featured command line interface that you can use to control the server on runtime, see stats and manage apps.

<br>

## Examples
- ### Creating a simple web app (minimal example, 4 steps)
1. Create a new directory for your app in a directory that is defined in your config.
2. In your terminal, go to that directory and run `akeno init website .`
3. Optionally, edit the newly created app.conf file and add the domains you want to use:
   ```nginx
   server {
      domains: *; # Place the domains you want to use
   }

   # ...
   ```
4. Reload akeno (With `akeno reload`, or `akeno restart` for full server restart)<br>
And, done! Your app is now accessible from the domains you have entered, as long as they are pointing to your server's IP. No further configuration needed - its that easy.


<br>


- ### Say hello to the builtin custom dynamic syntax
Tired of the messy, repetetive and long HTML templates? How about doing it the Akeno way instead!<br>
Let's say that you want to make a simple page with a title, favicon and a font from Google fonts, and want to use Bootstrap icons:
```html
<head>

    @use (bootstrap-icons:1.11.3);

    @fonts (Poppins);

    @page {
        title: "Hello world!";
        favicon: /icon.svg;

        # Apply the added font
        font: Poppins;
    }

</head>

<body>
    <div #id .class>
        <h1>Hello world! <i .bi-stars /></h1>
    </div>
</body>
```
Simply use .xw instead of .html as your file extension and this syntax will autmatically work.<br>
That's it! Much cleaner and easier to write & read. All the boring stuff is done for you. Akeno even cleans and compresses the code for you (HTML, CSS, and JS).
<br>



<br><br>
## Debug Akeno easily with DevTools (or other inspectors)! 
![Debugger](https://github.com/user-attachments/assets/c659ef12-eb18-4679-a94c-6bc1f7ff4bbd) <br>
Starting with version 1.5, Akeno is compatible with the node `--inspect` flag and allows you to debug or test your server with DevTools!<br><br>
### How to enable:
1. Open chrome://inspect/ and click "Open dedicated DevTools for Node"
2. Start Akeno in dev mode and with the `--inspect` flag (`akeno start --inspect`)
3. Enjoy debugging! The process will be detected and attached automatically. You can directly access the backend (`backend` is a global getter to the backend object).

Exposed properties by default:
- Backend as `backend`
- AddonCache as `addons`
- API as `api`
- resolve as `router` (core HTTP router)
- proxyReq as `proxyRouter` (proxy router)
- app as `uws` (uWebSockets instance)
- SSLApp as `uws_ssl` (only if SSL is enabled)<br>
- H3App as `uws_h3` (only if H3 is enabled)<br>

Any other variables are *not* acessible to the debugger even if global, unless you expose them manually!<br>

From within your addons, scripts or handlers you can use `backend.exposeToDebugger(key, value)` to expose an object globally (as a getter to prevent copying - readonly).<br>
This method will silently do nothing if inspect is disabled, so you can call it even in production.
