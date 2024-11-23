## Planned in the future
- Once implemented by uWS, add low-level request caching in the C++ layer over the current caching system on the Node.JS layer
- More complete HTTP3 implementation and WebTransport
- Enhance the config

## Planned in 1.5.3
- Refactoration of the CLI, add `akeno update`
- Make hot-reloading of web applications work again
- Refactor the code so it is not hard-coded for Linux systems and a specific directory, rather allow installs from anywhere
- Builtin multi-threading support
- Port the remaining uses of the old parser to the new one
- Remove the old parser
- Fast dynamic HTML generation
- Separate user management addon with much improved cache, profiles, etc. management

## New in 1.5.2
- Added a fast (global) code compression cache - disk-based, memory-mapped, shared across all addons and instances.
- Removed old code and extensions
- Light refactoration
- Fixed processing caching and enhanced routing speed
- Deprecated request helpers - backend.request shoud now be used for clarity and efficiency
- Moved LS.Framework request handler to its own repo
- The version variable is now streamlined, instead of existing all over the place
- Expanded support from Fedora/RHEL to Debian-based, Arch-based, Alpine, and openSUSE distros.

## New in 1.5.1
- Experimental HTTP3 support added
- The new parser is now stable and in production (currently only for HTML content)
- Deprecated the old parser
- Compatibility between the new and old parsers restored
- Dynamic web processing has been sped up by 4x on average

## New in 1.5.0
- Experimental rewrite of the old parser added
- Debugging support added via --inspect
- Streaming enhancements
- A powerful request + ws proxy has been added
- HTTP requests over a WebSocket connection are now supported as an experiment

## New in 1.4.x
- Slight improvements in code
- Refactored API, user management, user cache
- Officially renamed to Akeno
- Setup script added
- Removed periodicall hit counting by default for performance