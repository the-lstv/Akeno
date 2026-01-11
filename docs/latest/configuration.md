## Configuration
The main configuration file is in the `config` file in where you have installed Akeno (usually `/usr/lib/akeno`).

The syntax follows the [Atrium](https://github.com/the-lstv/atrium) format (I plan to add multiple formats in the future eg. `json`, similarly to how Caddy does it).

> [!NOTE]
>  In many places, the type is number/string, but mutiple values are supported (eg. ports and domains) - you can simply do "port: 1, 2, 3" for multiple values.

Overview of blocks (incomplete):
- `system`
    - `mode:enum`: development, production (default), testing or maintenance
    - `logLevel:int`: Number 0 to 5 - 0 only logs critical errors, 5 logs everything including verbose messages. Defaults to 5 in development mode, 2 in production mode.
- `protocols`
    - `ipc` IPC
        - `enabled:bool`: Whether to enable IPC (needed when using as a global server - usually not needed for dedicated servers)
        - `path:string`: The path to the IPC socket (default: /tmp/akeno.backend.sock)
        - `windowsPipeName:string`: Named pipe to use on Windows systems (default: akeno.backend.sock)
        - `openPermissions:bool`: If true, the socket will be open to all users (so it can be used without sudo).
    - `http` HTTP
        - `enabled:bool`: Whether to enable HTTP
        - `port:number`: Port (or a list of ports) to listen on.
        - `websockets:bool`: Whether to enable WebSockets (default: dev-only). "dev-only" disables unsecured WebSockets in production.
    - `https` HTTPS
        - `enabled:bool`: Whether to enable HTTPS
        - `port:number`: Port (or a list of ports) to listen on.
        - `websockets:bool`: Whether to enable WebSockets (default: true).
    - `h3` HTTP/3 protocol (experimental)
        - `enabled:bool`: Whether to enable HTTP/3
        - `port:number`: Port (or a list of ports) to listen on.
> [!NOTE]
> TIP: If you are using certbot, the default config should simply just work out of the box.
> [!WARNING]
> There currently isn't an API for per-domain certificates - it is planned, but currently it is recommended to simply use certBase and keyBase. It is planned to be added sometime in 1.6.8.
- `ssl` Configure SSL certificates for HTTPS and H3.
    - `key:string`: Default private key.
    - `cert:string`: Default certificate.
    - `domains:string`: List of domains to load certificates for (you can use wildcards eg. `*.example.com`).
    - `certBase:string`: Base path to certificates, `{domain}` will be replaced with the domain name.
    - `keyBase:string`: Base path to private keys, `{domain}` will be replaced with the domain name.
    - `autoAddDomains:bool`: If true, Akeno will automatically add new domains it encounters.
- `web` Configure web server settings.
    - `locations:string`: List of folders/locations to serve. Wildcards are supported (eg. `/www/sites/*` will load folders inside as websites if they contain an `app.conf` file).
    - `compress:bool`: Enable compression (brotli, gzip, etc.)
    - `compress-code:bool`: Enable code compression (js, css, html and inline scripts/styles, etc.)

### Example server config:
```nginx
system mode: development;

protocols {
    ipc {
        enabled;
        path: "/tmp/akeno.backend.sock";
    }

    http {
        port: 80, 8080;
    }

    https {
        port: 443;
    }
}

web {
    compress;
    compress-code;
    locations: "/www/sites/*", "/home/user/my_site";
}
```
