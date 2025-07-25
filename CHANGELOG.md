## TO-DO
- Add a fast C++ side content cache replacing the current temporary one
- Implement a proper database system
- Complete package manager for addons/modules
- Rework many parts, including the CLI, dynamic content, and the router
- Write a proper documentation
- Add a proper installation script


## New in 1.6.5-beta
- Reworked webserver routing, optimized web app routing performance
- Added a flexible webserver class
- CLI enhancements
- Reworked IPC module
- Template system
- Better caching system, template and compiled content caching
- Many more major changes

## New in 1.6.2-beta
- Better compression cache management
- Improved cache hit ratio (smarter compression caching)
- Router performance improved
- Changed request routing syntax
- Async file operations
- Re-added cache timeout
- helper.nextSegment() replaces the deprecated helper.next()
- Bugfixes and performance improvements

## New in 1.6.1-beta
- Added a new DomainRouter module, which handles internal hostname routing
- Apps can now register hostnames more easily via a uniform API, with group and wildcard support (eg. `*.example.{com,net}`)

## New in 1.6.0-beta
- Major changes all around (basically, preparing for a 2.0.0 release)
- A brand new versioning utility, for consistent versioning and matching for all modules, addons, etc.
- Added pre-release and build metadata to versioning
- Complete core redesign around a new modular Unit system
- Folder structure cleanup
- Deprecated all inconsistent or broken baked-in addons (web, api, CDN) and wrapped them as modules/addons
- Deprecated the old logging system and added an improved one
- Added an addon system and "package manager" to make extending and building with Akeno easy.
- Added custom Unit types for consistency across the whole system
- Deprecated HTTP traffic for websites and API - in production mode, HTTP will now redirect to HTTPS automatically unless explicitly disabled per application
- PM2 name lowercased (Akeno -> akeno)
- Changed config structure
- Added support for auto compression via Brotli or Gzip
- Deprecated "Initialize" callback in modules. Use onLoad instead and do not rely on the backend object being provided.
- Deprecated "HandleRequest" and "HandleSocket" callbacks - a new method will be introduced in the future.
- Added module aliases, eg. `require('akeno:backend')` instead of initialize callbacks.

## New in 1.5.9
- *(changes not tracked)*

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
- Officially renamed to Akeno (from "ExtraGon API")
- Setup script added
- Removed periodicall hit counting by default for performance

*(Versions prior to 1.4 were a non-open-source server software used exclusively by ExtraGon and LSTV.space's services.)*