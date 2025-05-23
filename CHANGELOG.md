## Planned in the future
- Once implemented by uWS, add low-level request caching in the C++ layer over the current caching system on the Node.JS layer
- More complete HTTP3 implementation and WebTransport
- Enhance the config
- Builtin multi-threading support

## New in 1.5.6
- Hot-reloading support
- Modules & experimental multithreading support
- Many enhancements and bugfixes

## New in 1.5.5
X URL routing now uses Globs
- Web app URL routers now use Globs
- All web requests now include ETag
- Overall code enhancements and small performance & memory efficiency improvements
- Separate user management addon with much improved cache, profiles, etc. management

## New in 1.5.4
- Ported the remaining uses of the old parser to the new one
- Removed the old parser (compatibility remains)
- Increased performance of the main request handler
- Fixed old naming of block's properties to be more accurate (values => attributes, key => name)
- Experimenting with fast dynamic HTML generation (or "server side rendering" as people call it)
- Breaking change: Removed all non-builtin request helpers from `req` and `res` objects - Instead, call `backend.helper.name(req, res, ...arguments)` - this is for efficiency and so that the request handler is less crowded. (I know, its ugly. Maybe the request/responce prototypes could be used?)

## New in 1.5.3
- Refactoration and fixes of the CLI, new commands, among other enhancements
- Added an Unix socket for IPC and internal queries
- Removed the outdated and slow __internal handler
- Make hot-reloading of web applications work again
- Installation script is now supported across multiple distros
- Temporarily removed chunked parsing and the .write() and .flush() methods from the parser
- Deprecated request helpers - its recommended to migrate to backend.helper

## New in 1.5.2
- Added a fast (global) code compression cache - disk-based, memory-mapped, shared across all addons and instances.
- Removed old code and extensions
- Light refactoration
- Fixed processing caching and enhanced routing speed
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