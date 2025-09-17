/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2025
    License: GPL-3.0
    Version: 1.1.0
    Description: A routing/matching module for Akeno, allowing to match domains and paths with wildcards and groups.
*/

// TODO: FIXME: This is a temporary "fast" router implementation, later it will be replaced with a proper, faster modular C++ router

const Units = require('akeno:units');

/**
 * Simple routing class to match groups and wildcards. Much faster than picomatch (sometimes up to 50x in some cases).
 */
class Matcher extends Units.Module {
    constructor(options = {}, info = null) {
        super(info);

        this.exactMatches = new Map();
        this.wildcards = options.simpleMatcher? new SimpleWildcardMatcher(): new WildcardMatcher(options.segmentChar || "/", []);
        this.fallback = null;
        this.options = options;
    }

    *expandPattern(pattern) {
        if (typeof pattern !== 'string') {
            throw new Error('Pattern must be a string');
        }

        // Expand only groups not preceded by '!'. Negated groups are preserved for the matcher.
        let searchFrom = 0;
        while (true) {
            const group = pattern.indexOf('{', searchFrom);
            if (group === -1) break;
            const prevChar = group > 0 ? pattern[group - 1] : null;
            if (prevChar !== '!') {
                const endGroup = pattern.indexOf('}', group);
                if (endGroup === -1) {
                    throw new Error(`Unmatched group in pattern: ${pattern}`);
                }

                const groupValues = pattern.slice(group + 1, endGroup);
                const patternStart = pattern.slice(0, group);
                const patternEnd = pattern.slice(endGroup + 1);

                for (let value of groupValues.split(',')) {
                    value = value.trim();
                    const next = patternStart + value + (value === "" && patternEnd.startsWith('.') ? patternEnd.slice(1) : patternEnd);
                    yield* this.expandPattern(next);
                }
                return;
            }
            searchFrom = group + 1;
        }

        yield pattern;
    }

    add(pattern, handler) {
        if (typeof pattern !== 'string' || !handler) {
            throw new Error('Invalid route definition');
        }

        if (pattern.endsWith('.')) {
            pattern = pattern.slice(0, -1);
        }

        if (pattern === '*' || pattern === '**') {
            this.fallback = handler;
            return;
        }

        if (!pattern) {
            return;
        }

        // Expand pattern groups (non-negated only)
        for (const expandedPattern of this.expandPattern(pattern)) {
            // Route patterns with wildcards or negated groups to the wildcard matcher
            if (expandedPattern.indexOf('*') !== -1 || expandedPattern.indexOf('!{') !== -1) {
                this.wildcards.add(expandedPattern, handler);
                continue;
            }

            const existingHandler = this.exactMatches.get(expandedPattern);
            if (existingHandler && existingHandler !== handler) {
                if(this.options.mergeObjects) {
                    handler = Object.assign(existingHandler, handler);
                    continue;
                }

                this.warn(`Warning: Route already exists for domain: ${expandedPattern}, it is being overwritten.`);
            }

            this.exactMatches.set(expandedPattern, handler);
        }
    }

    clear() {
        this.exactMatches.clear();
        this.wildcards.patterns = [];
        this.fallback = null;
    }

    remove(pattern) {
        if (typeof pattern !== 'string') {
            throw new Error('Invalid route pattern');
        }

        for (const expandedPattern of this.expandPattern(pattern)) {
            this.exactMatches.delete(expandedPattern);
            this.wildcards.filter(route => route.pattern !== expandedPattern);
        }
    }

    match(input) {
        // Check exact matches first
        const handler = this.exactMatches.get(input);
        if (handler) {
            return handler;
        }

        // Check wildcard matches
        const wildcardHandler = this.wildcards.match(input);
        if (wildcardHandler) {
            return wildcardHandler;
        }

        // If no specific route found, return the fallback route
        if (this.fallback) {
            return this.fallback;
        }

        return false;
    }
}


class WildcardMatcher {
    constructor(segmentChar = "/", patterns = []) {
        this.segmentChar = segmentChar || "/";
        this.patterns = patterns || [];
    }

    add(pattern, handler = pattern) {
        const rawParts = this.split(pattern);
        const parts = rawParts.map(p => {
            if (p.length > 3 && p.startsWith('!{') && p.endsWith('}')) {
                const values = p.slice(2, -1).split(',').map(v => v.trim()).filter(v => v !== '');
                return { type: 'negSet', set: new Set(values) };
            }
            return p;
        });
        this.patterns.push({ parts, handler, pattern });
    }

    filter(callback) {
        this.patterns = this.patterns.filter(callback);
        return this;
    }

    split(path) {
        if (path === "" || !path) return [""];
        if (path[0] !== this.segmentChar) path = this.segmentChar + path;
        return path.split(this.segmentChar);
    }

    /**
     * Fast wildcard matching with segment support.
     * @param {string} input - The input string to match against.
     */
    match(input) {
        const path = this.split(input);

        for (const { parts, handler } of this.patterns) {
            // Exact match
            if (parts.length === 1) {
                const only = parts[0];
                if (only === "**" || (typeof only === 'string' && path.length === 1 && ((only === "*" && path[0] !== "") || only === path[0]))) {
                    return handler;
                }
                if (typeof only === 'object' && only && only.type === 'negSet') {
                    if (path.length === 1 && path[0] !== "" && !only.set.has(path[0])) {
                        return handler;
                    }
                }
                continue;
            }

            let pi = 0, si = 0;
            let starPi = -1, starSi = -1;

            while (si < path.length) {
                const part = parts[pi];
                if (pi < parts.length && part === "**") {
                    starPi = pi;
                    starSi = si;
                    pi++;
                } else if (pi < parts.length && part === "*") {
                    if (path[si] === "") break;
                    pi++;
                    si++;
                } else if (pi < parts.length && typeof part === 'object' && part && part.type === 'negSet') {
                    if (path[si] === "" || part.set.has(path[si])) {
                        break;
                    }
                    pi++;
                    si++;
                } else if (pi < parts.length && part === path[si]) {
                    pi++;
                    si++;
                } else if (starPi !== -1) {
                    pi = starPi + 1;
                    starSi++;
                    si = starSi;
                } else {
                    break;
                }
            }

            while (pi < parts.length && parts[pi] === "**") pi++;
            if (pi === parts.length && si === path.length) {
                return handler;
            }
        }
        return null;
    }
}


class SimpleWildcardMatcher {
    constructor(patterns = []) {
        this.patterns = patterns || [];
    }

    add(pattern, handler) {
        const parts = pattern.split('*');
        const compiled = {
            parts,
            handler,
            pattern,
            hasPrefix: parts[0] !== '',
            hasSuffix: parts[parts.length - 1] !== '',
            nonEmptyParts: parts.filter(p => p !== '')
        };

        this.patterns.push(compiled);
    }

    filter(callback) {
        this.patterns = this.patterns.filter(callback);
        return this;
    }

    /**
     * Simple wildcard matching without segment support.
     * @param {string} input - The input string to match against.
     */
    match(input) {
        for (const compiled of this._compiledPatterns) {
            const { parts, handler, hasPrefix, hasSuffix, nonEmptyParts } = compiled;
            
            // Quick prefix/suffix checks
            if (hasPrefix && !input.startsWith(parts[0])) continue;
            if (hasSuffix && !input.endsWith(parts[parts.length - 1])) continue;
            
            // If only prefix/suffix, we're done
            if (nonEmptyParts.length <= 2) {
                return handler;
            }
            
            // Full matching for complex patterns
            let pos = hasPrefix ? parts[0].length : 0;
            let failed = false;

            for (let i = 1; i < parts.length - 1; ++i) {
                if (!parts[i]) continue;
                let nextIdx = input.indexOf(parts[i], pos);
                if (nextIdx === -1) {
                    failed = true;
                    break;
                }
                pos = nextIdx + parts[i].length;
            }

            if (!failed) {
                return handler;
            }
        }
        return null;
    }
}


class DomainRouter extends Matcher {
    constructor(options) {
        super({ segmentChar: ".", ...options }, {
            name: 'DomainRouter',
            description: 'A simple domain routing system for Akeno.',
            version: '1.0.0',
            id: 'akeno.domain-router',
        });
    }

    dump() {
        const handlerMap = new Map();

        for (const [pattern, handler] of this.exactMatches.entries()) {
            if (!handlerMap.has(handler)) handlerMap.set(handler, []);
            handlerMap.get(handler).push(pattern);
        }

        for (const route of this.wildcards.patterns) {
            const handler = route.handler;
            const pattern = route.pattern;
            if (!handlerMap.has(handler)) handlerMap.set(handler, []);
            handlerMap.get(handler).push(pattern);
        }

        return Array.from(handlerMap.entries()).map(([handler, patterns]) => ({
            handler,
            patterns
        }));
    }
}

class PathMatcher extends Matcher {
    constructor(options) {
        super({ segmentChar: "/", ...options }, {
            name: 'PathMatcher',
            description: 'A simple path matching system for Akeno.',
            version: '1.0.0',
            id: 'akeno.path-matcher',
        });
    }
}

module.exports = { Matcher, WildcardMatcher, SimpleWildcardMatcher, DomainRouter, PathMatcher };