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
> At this time Akeno only officially works on Linux x86_64. Official Windows support is not planned yet. Windows support is highly experimental and can blow up at any time. One way to run on Windows is via WSL2, though I didn't test.

```sh
# We are currently revising the installation script! Please be patient, I apologize for the inconvenience
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

---
<br><br>

<img src="https://github.com/user-attachments/assets/8cbdac91-1e57-43a3-9fff-86b22c1b99b7" width="650"><br>

Akeno is heavily focused on speed, and not only benchmark magic, but true optimization on every step, to ensure efficiency and low latency, making it very scalable and responsive, so you and your clients no longer have to deal with slow or unstable web apps.

The entire server is started and ready in a few milliseconds on average, depending on loaded modules. This is already miles ahead of most full-featured servers.

In the core, we use [uWebSockets](https://github.com/uNetworking/uWebSockets) (a low-level, incredibly optimized web server written in C++) - which is one of the fastest standard-compliant servers in the world, **~8.5x** faster than the already fast framework Fastify. <br>
I later plan to switch to a fork that embeds Akeno directly, though that is still in the works.

Even with a full setup including routing, caching, dynamic content and encryption, Akeno is still multiple times faster than even the most minimal Express.js server, out of the box *(cached)*.

Akeno's powerful content preprocessor, which handles complex HTML templates and custom syntax, can prepare a full response including parsing without cache in less than a few milliseconds, then caches it.<br>
This makes Akeno faster than most frameworks out there!<br>
With memory cache (which is automatic and based on file changes), the response can be prepared in as low as a few microseconds, and that is about to be even less when we add quick cache paths.<br>

Akeno ensures that your clients always get the latest version of your content, while still utilizing caching to the fullest extent.<br>

Other cool features include:
- Automatic Brotli and Gzip compression support with cache
- Code minification for HTML, CSS, and JS
- Cache management and invalidation
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


<br>


### Say hello to the builtin custom HTML syntax
Tired of the messy, repetetive and long HTML templates? How about doing it the Akeno way instead!<br>
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

<br>
<br>
<br>
<br>

I also want to later make it possible to define and extend with custom blocks and behavior, eg.
```js
Akeno.web.defineBlock('my-block', (context, block) => {
    // Any synchronous code can run here, and we can use context.write to place data in place
    context.write(`<div class="my-block">${block.properties.text}</div>`);
});
```
```html
@my-block {
    text: "Hello world!";
}

And maybe even define backend code inside HTML (though I am really not sure about this yet - I think APIs are better and safer):
<script type="server/javascript">
    // Runs on the backend
    this.write("Hi from Akeno!");
</script>
```
*(This is not yet implemented, concept only)*
