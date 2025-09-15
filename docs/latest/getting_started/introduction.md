---
title: Getting started
description: Get started with Akeno, installation, and basic usage.
keywords: getting started
---

# Getting started
Akeno can be used in many ways at once - you can use it as a global server and host sites from configured paths via a config file (like Nginx), interact with it via an API, or create the server itself within your application.

To install Akeno, you can run the installation script - installs to `/usr/lib/akeno` by default:
```sh
curl -o- https://run.extragon.cloud/akeno | bash
```

On Windows: Akeno is currently not supported on Windows natively - you can try running it in WSL (Windows Subsystem for Linux), or try cloning the repo manually and build `/core/native/`. I will create Windows builds if enough interest is shown - but Linux is better for these applications, anyway. For development, WSL is an option.

Then you can run it with:
```sh
akeno start
```

Or under PM2 (to keep it running in the background and after reboots, all platforms)
```sh
akeno pm2-setup
```

Or as a service via systemd (Linux)
```sh
akeno systemd-setup
systemctl enable --now akeno
```