## Upcomming in 1.6.0
- Now using our own database system [LSDB](https://github.com/the-lstv/lsdb) instead of LMDB
- Now using a customized fork of uWebSockets.js which implements Akeno features on the C++ side
- Migrated a part of the router to the native server


## New in 1.5.8
- Changes to the file structure
    - Moved /cdn to /addons/cdn
    - Addons now have their own folder
- Replaced htmlparser2 with a custom native parser
- Complete revamp of the custom app syntax, brief summary of changes:
    - Replaced the bad and inconsistent `@resources` and `@manifest` directives with clean and unified `@use` and `@page` directives with an improved module system
    - Removed previously deprecated behavior
    - Added syntax for reactivity (eg. `{{ variable || default }}`)
    - Any element can now be self-closing
    - Improved options for meta tags and SEO
    - Better performance and less memory usage
    - You can now use `@import` to statically import content or `@use(/header_file)` to link header files
    - Added an experimental feature called "header files", which is a more efficient way to share configuration and data between pages without any extra parsing overhead
    - Temporarily removed dynamic page functionality as it is planned to be re-implemented better in the future


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