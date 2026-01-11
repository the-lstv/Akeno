## CLI
Akeno features a full CLI for easy management of your applications, modules, and server.

ℹ To display help for all commands, simply do:
```sh
akeno -h
```

Some basic commands include:
- `akeno ls` - List apps.
- `akeno reload <app>` - Hot-reload apps and config, optionally only a single app with zero downtime.
- `akeno restart` - (PM2 only), reload the server (full restart, with downtime).
- `akeno update` - Check for updates and pull updates when available - also restarts the server!

...And many more.