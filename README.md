<img src="https://github.com/user-attachments/assets/4fdca083-82db-4682-97b6-40e915194134" alt="Akeno icon"> <br>

Akeno is a really fast, modular server and web application runtime/framework written in C++ and JavaScript, primarily intended for:<br>
- Static and dynamic web sites/apps
- Realtime web apps of nearly any scale
- Low-latency APIs
- Content delivery
- User management

It supports various configurations for HTTP, HTTPS, HTTP3 (experimental), and WebSocket protocols.<br>
Though thanks to its modularity, it can be easily expanded.


The most interesting part is its powerful webserver, which is highly optimized and has some very cool features that make developing and deploying websites or apps really simple!


---
### Quick installation
Requires node, npm, git, gcc, g++, and python (attempts to install automatically if not found). We plan to reduce the amount of dependencies to just two in future updates by packaging prebuilt binaries.<br>

**NOTE:** At this time Akeno only works on Linux x86_64. Official Windows support is not planned yet. While Akeno may run on Windows, its support is highly experimental and may not fully work up to expectations.<br>
```sh
# We are currently revising the installation script! Please be patient, I appologize for the inconvenience
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
<br><br>

<img src="https://github.com/user-attachments/assets/99f5da80-56ab-471b-8203-3cebbc98f659" width="650"><br>

Akeno is heavily focused on speed, efficiency and low-latency, making it very scalable and responsive, so you and your clients no longer have to deal with slow web apps.

The entire server is started and ready in a few milliseconds on average, depending on loaded modules. This is already miles ahead of most full-featured servers.

For HTTP and WebSocket traffic, we use [uWebSockets](https://github.com/uNetworking/uWebSockets) (a low-level, incredibly optimized web server written in C++) - which is one of the fastest standard-compliant servers in the world, **~8.5x** faster than the already fast framework Fastify.

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

<img src="https://github.com/user-attachments/assets/33f241f6-ffca-4ab2-844b-cd60dbc8c782" width="650"><br>

Akeno is fully modular. On first startup, it only loads what is necesarry. Everything else is loaded as requested, on the fly.
This includes API extensions - simply create a JS file with your server-side API in your web app's directory, hot-reload the config and your API is ready to use.


<br><br>

<img src="https://github.com/user-attachments/assets/18f7f7e4-cc63-4da5-a740-4b5bcb2b7719" width="650"><br>

Akeno offers a full-featured command line interface that you can use to control the server on runtime, see stats and manage apps.<br>
It also offers modules and libraries you can use to control and manage the server externally with ease!

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
<br><br>

_The only thing left is to pair it with [LS](https://github.com/the-lstv/LS/) ;)_
