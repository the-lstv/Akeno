// TODO: FIXME: This is a temporary "fast" router implementation, later it will be replaced with a proper, faster modular C++ router

const Units = require('akeno:units');


// To be implemented
// class DomainRouterScope {
//     constructor(router) {
//         this.router = router;
//     }
// }

class DomainRouter extends Units.Module {
    constructor() {
        super({
            name: 'DomainRouter',
            description: 'A simple domain routing system for Akeno.',
            version: '1.0.0',
            id: 'akeno.domain-router',
        });

        this.routes = new Map();
        this.wildcardRoutes = [];
    }

    *expandPattern(pattern) {
        if (typeof pattern !== 'string') {
            throw new Error('Pattern must be a string');
        }

        const group = pattern.indexOf('{');
        if (group !== -1) {
            const endGroup = pattern.indexOf('}', group);
            if (endGroup === -1) {
                throw new Error(`Unmatched group in pattern: ${pattern}`);
            }

            const groupValues = pattern.slice(group + 1, endGroup);
            const patternStart = pattern.slice(0, group);
            const patternEnd = pattern.slice(endGroup + 1);

            for (let value of groupValues.split(',')) {
                value = value.trim();
                if (value) {
                    yield* this.expandPattern(patternStart + value + patternEnd);
                }
            }
            return;
        }

        yield pattern;
    }

    add(pattern, handler) {
        if (typeof pattern !== 'string' || !handler) {
            throw new Error('Invalid route definition');
        }

        if(pattern.endsWith('.')) {
            pattern = pattern.slice(0, -1);
        }

        // Expand pattern groups
        for (const expandedPattern of this.expandPattern(pattern)) {
            // TODO: Handle domain level patterns (something.*.com) and infinite subdomain matching (**.example.com)

            if (expandedPattern.indexOf('*') !== -1) {
                const segments = expandedPattern.split('*');
                this.wildcardRoutes.push({ parts: segments, handler, pattern: expandedPattern });
                return;
            }


            if (this.routes.has(expandedPattern)) {
                this.warn(`Warning: Route already exists for domain: ${expandedPattern}, it is being overwritten.`);
            }

            this.routes.set(expandedPattern, handler);
        }
    }

    remove(pattern) {
        if (typeof pattern !== 'string') {
            throw new Error('Invalid route pattern');
        }

        for (const expandedPattern of this.expandPattern(pattern)) {
            this.routes.delete(expandedPattern);
            this.wildcardRoutes = this.wildcardRoutes.filter(route => route.pattern !== expandedPattern);
        }
    }

    route(domain) {
        const handler = this.routes.get(domain);
        if (handler) {
            return handler;
        }

        // Check for wildcard routes
        for (const { parts, handler } of this.wildcardRoutes) {
            let pos = 0;
            let failed = false;

            // If first part is non-empty, must match start of string
            if (parts[0] && !domain.startsWith(parts[0])) continue;
            if (parts[0]) pos += parts[0].length;

            for (let i = 1; i < parts.length; ++i) {
                if (!parts[i]) continue;
                let nextIdx = domain.indexOf(parts[i], pos);
                if (nextIdx === -1) {
                    failed = true;
                    break;
                }
                pos = nextIdx + parts[i].length;
            }

            // If last part is non-empty, must match end of string
            if (parts[parts.length - 1] && !domain.endsWith(parts[parts.length - 1])) continue;

            if (!failed) {
                return handler;
            }
        }

        return false;
    }
}

module.exports = { DomainRouter };