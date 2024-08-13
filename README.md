<p align="center"><img src="https://github.com/the-lstv/Akeno/assets/62482747/d29fb374-aef6-444f-88b1-43aede48fe41" alt="Akeno icon"></p>

Akeno is a fast and modular, mostly automated Node.JS web (static and dynamic), WebSocket, CDN, and API server which comes as a full-featured suite along with DNS, SSL, DB and user management (all available optionally as addons).<br>
It uses its universal config system to make it easy to manage large quantities of projects or servers all at once.<br>
<br>
It has a performance-first webserver, with automated caching, code compression, and a custom HTML parser which allows you to write clean and easier-to-read code, with less maintenance needed.
<br><br>**NOTE:** Currently Akeno only works on Linux. Windows support is not planned anytime soon due to the complexity and missing features of the Windows platform and low interest. If you must run this on Windows, wsl is the only way.<br>

---
Quick installation (Fedora Linux) <br>
Required: `node`, `npm`, `git`
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

The entire server is started and ready in **10ms** or less on average (making it faster than most modern large servers which can even take minutes), and uses uWebSockets (a low-level, incredibly optimized C++ web server) for its HTTP and WebSocket traffic - making it **8.5x** faster than the already fast framework Fastify (according to [uWS](https://github.com/uNetworking/uWebSockets.js)).

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

## Examples
### 1 - Creating a simple web app (minimal example, 4 steps)
1. Create a new directory for your app
   (make sure it is included in your main (or imported) config file under `web > locations` - for entries that end with `/*`, all sub-directories will be automatically detected, eg. if you make your directory under `/www/content/web/` (added by default), you do **not** need to add an entry to the config each time you make a new app - they will be simply automatically added as long as there is an app.conf file in them)
2. Create an `app.conf` file and an `index.html` file
3. Place this basic config:
   ```
   server {
     domains: your.domain.name, ...;
   }
   ```
   (Of course, replacing the value with the actual domain names you want your website/app to live on. Wildcards are supported - `example.*`, `*.example.com`, `*.*.example.*` or `*-example.com` will all work, including just `*`. Additionally, to include an unlimited count of domain levels, use `**.example.com` to match both `a.example.com` and `b.a.example.com` and so on.)
4. Restart akeno<br>
And, done! Your app is now accessible from the domains you have entered, as long as they are pointing to your server's IP.


<br>


### 2 - Say hello to the builtin pre-processor
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

   <style>
      :root {
         font-family: Poppins;
      }
   </style>
</body>
```
That's it! All the repetetive work is done for you. Akeno even cleans and compresses the code for you (HTML, CSS, and JS)! (Including removing the script tag if the file cannot be resolved)<br>
Also - are you tired of your clients not receiving up-to-date resources and dont want to manually bump versions or add `?random` to each resource? Now you don't have to. Akeno will check for changes for local resources automatically and assign a `?mtime` query which contains the last time that the file was changed, to efficiently manage cache while keeping the content always up-to-date!
<br>



<br><br>
## New in v1.5: Debug Akeno easily with DevTools (or other inspectors)! 
![Debugger](https://github.com/user-attachments/assets/c659ef12-eb18-4679-a94c-6bc1f7ff4bbd) <br>
Starting version 1.5, Akeno is compatible with the node `--inspect` flag and allows you to debug or test your server with DevTools!<br><br>
### How to enable:
1. Open chrome://inspect/ and click "Open dedicated DevTools for Node"
2. Start Akeno in dev mode and with the `--inspect` flag
3. Enjoy debugging! The process will be detected and attached automatically. You can directly access the backend (`backend` is a global getter to the backend object).

Exposed properties by default:
- Backend as `backend`
- AddonCache as `addons`
- API as `api`
- resolve as `router` (core HTTP router)
- proxyReq as `proxyRouter` (proxy router)
- app as `uws` (uWebSockets instance)
- SSLApp as `uws_ssl` (only if SSL is enabled)<br>

Any other variables are *not* acessible to the debugger even if global, unless you expose them manually!<br>

From within your addons, scripts or handlers you can use `backend.exposeToDebugger(key, value)` to expose an object globally (as a getter to prevent copying - readonly).<br>
This method will silently do nothing if inspect is disabled, so you can call it even in production.
