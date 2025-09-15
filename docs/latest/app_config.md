## App configuration file
For web apps using `Units.WebApp` (eg. websites defined in the config file in `locations`), there is a `app.conf` file that contains configuration specific to the app.
The syntax is the same as the server config, but the blocks are different.
Here is a basic overview:

- `server` - Configuration for the app server.
    - `domains:string`: List of domains to serve the app on (you can use wildcards (* for one segment and ** for all - eg. `subdomain.*.com` or `**.com`) and groups (eg. `example.{com,net}`), and optional matching (`{sub,}.example.com`)).
    - `canonical:string`: Optional - canonical (primary) domain. This does not affect the server but may be used in some cases.
    - `root:string`: Optional - root directory override for the app files (defaults to the location of the app.conf file). You can reference the original root by prefixing paths with "~" (eg. `~/my_app`).
    - `redirect_https:bool`: If true, all HTTP requests will be redirected to HTTPS.
    - `redirect_www:bool`: If true, requests to `www.**` will be redirected to `**`.

*(in the future, i plan to allow multiple server blocks - currently, there can only be one)*
- `location(...path)` - Sets options for specific locations. Supports wildcards (* and **, eg. `/*` matches only files in "/", `/**` matches files in all subdirectories as well).
    - `alias:string`: Serve files from a different location (eg. `location(favicon.ico) alias: /assets/icon.svg` will serve from `/assets/icon.svg` at `/favicon.ico`).
    - `deny:boolean`: If true, access to this location will be denied.
    - `redirect:string`: Set a redirect to a different URL at this location.
- `redirect(...path)` - Same as location.redirect, set a redirect.
    - `to:string`: The target URL to redirect to.
- `browserSupport` - Specifies the minimum browser versions that the app supports - if a browser does not match, a message will be shown instead.
    - `chrome:number`: Minimum Chrome version.
    - `firefox:number`: Minimum Firefox version.
    - `safari:number`: Minimum Safari version.
    - `edge:number`: Minimum Edge version.
- `errors` - Define error pages.
    - `[error-code]:string`: Path to the error page for the given error code (eg. `404: /errors/404.html`).
    - `default:string`: Fallback path to the default error page for all codes
- `ratelimit` - Define rate limiting for the app.
    - `limit:number`: Maximum number of requests per interval, defaults to 1000.
    - `interval:number`: Time interval for the rate limit in milliseconds, defaults to 1 minute.

Just like in the Atrium syntax, blocks can be defined in multiple ways: `ratelimit limit: 50;` is the same as `ratelimit { limit: 50; }`, and even just `ratelimit;` will work and use the default values.

### Example
Here is a basic example of an app.conf file:

```nginx
server {
    domains: example.{com, net, localhost};
}

# Deny access to some folders/files
location(/node_modules/**, ".git") deny;

# Route /home and /settings to /index.html
location(/{home, settings}) alias: /index.html;

redirect(/example) to: "https://www.example.com";

errors 404: /errors/404.html;

# Setup a rate limit of 5000 req/min
ratelimit limit: 5000;

browserSupport {
    chrome: 90;
    firefox: 80;
}
```
