<img src="https://cdn.extragon.cloud/file/a6ee0da416b4eebcd4c9899fa9caa0d7.png" alt="Akeno icon"> <br>

Akeno is a really fast, modular server, primarily intended for:<br>
- Efficient APIs
- Static and dynamic web sites/apps
- Realtime web apps
- Content delivery
- User management

It supports various configurations for HTTP, HTTPS, HTTP3 (experimental), and WebSocket protocols.<br>
Though thanks to its modularity, it can be easily expanded.
<br><br>
It also has a built-in webserver, which is extremely optimized and has some very nice features that make developing and deploying websites or apps really simple!
<br><br>**NOTE:** At this time Akeno only works on Linux. Windows support is not planned yet due to no interest. Note that thanks to the modular nature of Akeno, some features may work on Windows just fine.<br>

---
Quick installation (on Linux) - requires node, npm, git, gcc, g++, and python (attempts to install automatically if not found)<br>
```sh
# We are currently revising the installation script! Please be patient, I appologize for the inconvenience
```
You can start Akeno with
```sh
akeno start
```
To run under a process manager (recommended):
```sh
sudo pm2 start /usr/lib/akeno/app.js --name Akeno
```

---
<br>

![🚀 Fast](https://github.com/the-lstv/Akeno/assets/62482747/d7f3466c-c833-4fca-a57b-e93f7aca0882)
---

Akeno is focused on speed and efficiency.

The entire server is started and ready in **10ms** on average, depending on added modules (making it faster than most modern large servers), and uses uWebSockets (a low-level, incredibly optimized C++ web server) for its HTTP and WebSocket traffic - making it **8.5x** faster than the already fast framework Fastify (according to [uWS](https://github.com/uNetworking/uWebSockets.js)).

Even with a full setup with routing and caching, it is still multiple times faster than even the most minimal express server, out of the box. 

On top of that, Akeno automatically handles cache, and adds an ?mtime query parametter for file changes for your static JS/CSS resources with no code changes required, so you dont have to worry about your clients getting outdated content, while still utilizing caching to the fullest.

Akeno can also automatically compresses all of your HTML, CSS and JS code on the fly - saving you the hassle of having to make copies or compress yourself.<br>
Just write the code and watch the magic happen in real time.<br><br>

Akeno is also faster than popular servers like Nginx for both static and dynamic content.<br>


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

## Updates: New in 1.5.4
- Parser performance increased over 32x 🚀
- Moved the parser to a separate [repo](https://github.com/the-lstv/Atrium) and now included as a submodule
<br><br>

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
4. Reload akeno (either `akeno reload --hot` or `akeno reload` for full reload)<br>
And, done! Your app is now accessible from the domains you have entered, as long as they are pointing to your server's IP. No further configuration needed.


<br>


- ### Say hello to the builtin custom dynamic syntax
Tired of the repetetive and long HTML templates? How about doing it the Akeno way instead!<br>
Let's say that you want to make a simple site with a title, favicon and a font from Google fonts, and a script:
```html
<head>

    @manifest {
         title: "This is an example :)";
         favicon: /icon.svg;
    }

    @resources {
         fonts: Poppins; # Defaults to Google fonts
         js: /main.js;
    }

</head>

<body>
    Hello world!
</body>
```
That's it! All the repetetive work is done for you. Akeno even cleans and compresses the code for you (HTML, CSS, and JS).<br>
Also, Akeno will automatically check for local changes and assign a `?mtime` query which, to efficiently keep cache functional while making sure the content is always up-to-date for your users.
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
