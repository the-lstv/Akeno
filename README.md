<p align="center">
  <img src="https://github.com/user-attachments/assets/a742cb99-7423-4be7-8e2c-f12b8324fae7" width="900"/>

</p>

Akeno is a really fast, modular server and web application runtime/framework written in C++ and JavaScript, primarily intended for:<br>
- Static and dynamic web sites/apps
- Realtime web apps of nearly any scale
- Low-latency APIs
- Local protocols, game servers, etc.
- Database servers
- Content delivery
- User management

It supports various configurations for HTTP, HTTPS, HTTP3 (experimental), and WebSocket protocols.<br>
Thanks to its modularity, it can be easily expanded.


The most interesting part is its powerful webserver, which is highly optimized and has some very cool features that make developing and deploying websites or apps really simple!


---
### Quick start
Currently requires node, npm, git, gcc, g++, and python (attempts to install automatically if not found). We plan to reduce the amount of dependencies to just two in future updates by packaging prebuilt binaries.<br>

> [!NOTE]
> At this time Akeno only officially works on Linux x86_64. Official Windows support is not planned yet. Windows support is highly experimental and can blow up at any time. If you have any issues on Windows, please open an issue on GitHub and I will try to help you out, but I make no guarantees that Akeno will work as advertised under Windows.

```sh
# We are currently revising the installation script! Please be patient, I apologize for the inconvenience
# Akeno is still in beta as of now, but it is getting really close for a stable release.
```
You can then start Akeno anywhere with
```sh
akeno start
```
To run under a process manager, in this case PM2 (recommended), you can run:
```sh
sudo akeno pm2-setup
```
This makes Akeno run automatically on startup and enables commands like `akeno restart` and `akeno update` etc.
<br><br>


### Common usecases for Akeno
Akeno can serve as a great upgrade or replacement to Nginx/Apache as a proxy or static file server, especially if you already have a setup that utilizes Node.js.<br>
Akeno is faster than Nginx in almost all cases *(that I've tested)*, and it can do nearly everything Nginx does (including multi-domain HTTPS, which is one of the most common reasons people use Nginx as a reverse proxy), and it does it with similar ease (similar config, most features out of the box). Akeno even has more modern web features to enhance your development experience and handles things like code minification and smart caching.<br>
With Akeno, you can remove the need to proxy through Nginx, and can build your Node backend directly on top of Akeno, for a more seamless and scalable setup.<br>
And on top of that you get WebSocket support out of the box, with no extra setup needed.

---

<img src="https://github.com/user-attachments/assets/8cbdac91-1e57-43a3-9fff-86b22c1b99b7" width="650"><br>

⚡ To ensure minimal latency, fast response times, and high throughput, Akeno is designed to be extremely optimized and lightweight.<br>

The server usually starts up in less than 10ms (depending on modules and loaded applications - but even on complex servers with over 50 web applications, the time is commonly under 300ms), and most requests are handled in <0.5ms, including routing, compression, and (cached) dynamic content. <br>
We plan to make this even faster in the future by moving all critical parts to C++, and hopefully making most requests handled directly in C++ without hitting JS at all in most requests.

In the core, we use [uWebSockets](https://github.com/uNetworking/uWebSockets) (a low-level, incredibly optimized web server written in C++) - which is one of the fastest standard-compliant servers in the world, **~8.5x** faster than the already fast framework Fastify. <br>

Even with a full setup including routing, caching, dynamic content and encryption, Akeno is still multiple times faster than even the most minimal Express.js server with just a single response, out of the box.

Akeno's powerful content preprocessor, which handles complex HTML templates and custom syntax, can prepare a full response including parsing without cache in less than a few milliseconds, then caches it.<br>
This makes Akeno faster than most frameworks out there.<br>

(For instance, the homepage of [this site](https://lstv.space) uses templates and dynamic content including automatic code compression, and only takes ~4ms to compile, with subsequent requests taking <0.5ms.)

With memory cache (which is automatic and based on file changes), the response can be prepared in as low as a few microseconds, and that is about to be even less when we add quick cache paths.<br>

Akeno ensures that your clients always get the latest version of your content, while still utilizing caching to the fullest extent.<br>

Other neat features include:
- Automatic Brotli and Gzip compression support with cache
- Code minification for HTML, CSS, and JS
- Cache management and automatic invalidation on changes
- Cache busting via ?mtime query parameter based on file changes
- Streaming support for large files
- Small overhead per application or context, allowing you to scale to thousands of applications without any issues

All of this is done automatically, and is neatly integrated using robust methods.

Simply write your code and let Akeno optimize it in real time, without any extra hassles.<br><br>

<br><br>

<img src="https://github.com/user-attachments/assets/458ecc3a-c9ad-4dfb-9bbe-159a7805a889" width="650"><br>

Akeno uses a universal Unit system where all components are treated as Units, which provides a unified and easy to extend API.<br>
Modules, addons, applications, protocols, components and the backend itself are all an instance of a Unit.<br>
Units are loaded as needed on demand, avoiding initial overhead.

Akeno is a very flexible server and can be used for various purposes in various ways.


<br><br>

<img src="https://github.com/user-attachments/assets/2893babc-5738-4906-8562-01e5a9154e96" width="650"><br>

Akeno offers a full-featured command line interface that you can use to control the server at runtime, see stats, and manage apps.<br>
It also offers modules and libraries you can use to control and manage the server externally with ease!

<br>

## Examples
- ### Creating a simple web app (minimal example, 3 steps)
1. Create a new directory for your app in a directory that is defined in your config.
2. Create an `app.conf` file, example:
   ```nginx
   server {
      domains: "{www,}.example.{com, net, localhost}";
   }

   # ...

   # Example redirect;
   redirect (/path) to: "https://example.com";
   # Deny access to a path
   location (/private) deny;
   ```
3. Reload Akeno (Either with a hot reload `akeno reload`, or `akeno restart` for a full server restart)<br>
And, done! Your app is now accessible from the domains you have entered, as long as they are pointing to your server's IP. No further configuration needed.

<br>

- ### Quick webserver
To quickly spin up a temporary web server anywhere, you can use the `akeno serve` command:
```sh
akeno serve ./ -h "localhost"
# Or to listen on a specific port:
akeno serve ./ -p 8080
```


- ### Custom webserver
And of course, Akeno provides a full JS API to create your own servers.
```js
const backend = require('akeno:backend');

// Basic handler
backend.domainRouter.add("{www,}.example.*", (req, res) => {
    res.end("Hello world!");
});

// File server with automatic cache, ETag, and compression support
// TIP: FileServer can also be used manually (in any other handler, as needed) via the .serve(req, res, ?file) method, and files can be added and pre-cached with .add(), including defining custom headers etc. - the API is very flexible.
backend.domainRouter.add("localhost", new backend.helper.FileServer({
    root: "/path/to/files",
    automatic: true
}));
```


<br>


### Say hello to the builtin custom HTML syntax
Tired of the messy, repetitive and long HTML templates? How about doing it the Akeno way instead!<br>
Let's say that you want to make a simple page with a title, favicon and a font from Google fonts, and want to use Bootstrap icons:
```html
<head>

    @use (bootstrap-icons:1.11.3, google-fonts[Poppins:400,700]);

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

Akeno will automatically and efficiently handle all dependencies and boilerplate (html tag, basic meta tags) for you.<br>
There's more:
- `@use` imports libraries, packages, and other resources, including CSS, JS, JSON, preloads, and so on, and handles cache.
  - Syntax: `@use (library:version[components]);`, eg. `@use (ls:5.0.0[Reactive]);` or `@use (/assets/js/index.js)`.
  - In the future, defining custom sources and aliases will be possible too.
- `@page` defines the page's metadata, like title, favicon, and more.
- `@import` imports other HTML files in place.
- `@importRaw` imports raw content from a file.
- `{{ variable }}` is a reactive syntax, which works together with LS.Reactive.
  - There's more you can do with it, eg. `{{ user.name:String || "Guest" }}` etc.
---
- Shortened syntax is supported for IDs, classes, etc.
  - Classes can be defined with a dot: `<div .class .another-class>`.
  - Element ID can be defined with a hash: `<div #id>`.
  - Self-closing tags on any element are supported, eg. `<i .bi-stars />`.
  - There is a `<template::syntax>` reserved for future use.

<br>

_The only thing left is to pair it with [LS](https://github.com/the-lstv/LS/) ;)_