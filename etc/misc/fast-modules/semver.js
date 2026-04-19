/**
 * A wrapper around the node semver module.
 * 
 * Why? Because the "semver" module is bloated and slow.
 * Somehow it takes 10ms just to load, which is not acceptable in high-performance scenarios.
 * 
 * Our implementation in core/unit.js is a lot faster and in only 350 lines, compared to semver's 110Kb monolith of a library.
 * It is not a perfect semver implementation (far from), but it covers 99% of common use cases, and avoids Regex.
 */

const { Version } = require('../../../core/unit');

function inc(v, type, copy = true) {
    const ver = (v instanceof Version && !copy) ? v : new Version(v);
    if (type === 'major') ver.increment(1, 0, 0);
    else if (type === 'minor') ver.increment(0, 1, 0);
    else if (type === 'patch') ver.increment(0, 0, 1);
    return ver.toString();
}

class SemVer extends Version {
    get version() { return `${this.major}.${this.minor}.${this.patch}`; } // whatever i guses 🤷
    get raw() { return this.toString(); } // kind of a stupid API design; it's not really "raw" (processing still happens, and it isn't "raw")
    get prerelease() { return this.release || "" } // In the semver module it has to always return a string for whatever reason
    get build() { return super._build || "" } // Just learn to use null 🙏
    set build(v) { super._build = v; }
    inc(type) { inc(this, type, false); return this; }
    compare(other) { return this.diff(other); }
}

class Range {
    constructor(range) { this.range = range; }
    // In Units.Version, a range is just a simple string/version rather than a separate instance, so this wrapper is a bit pointless in that context
    test(v) { return new Version(v).compare(this.range); }
}

// Map semver API to Units.Version
module.exports = {
    parse(v, opts) { if(!Version.isValid(v)) return null; return new SemVer(v); },
    valid(v, opts) { return Version.isValid(v) ? new SemVer(v).toString() : null },
    major(v) { return new SemVer(v).major; },
    minor(v) { return new SemVer(v).minor; },
    patch(v) { return new SemVer(v).patch; },
    compare(a, b) { return new SemVer(a).diff(b); },
    coerce(v) { return SemVer.coerce(v); },
    gt(a, b) { return SemVer.matches(a, b, ">") > 0; },
    gte(a, b) { return SemVer.matches(a, b, ">=") >= 0; },
    lt(a, b) { return SemVer.matches(a, b, "<") < 0; },
    lte(a, b) { return SemVer.matches(a, b, "<=") <= 0; },
    eq(a, b) { return SemVer.diff(a, b) === 0; },
    neq(a, b) { return SemVer.diff(a, b) !== 0; },
    satisfies(v, range, opts) { return new Version(v).compare(range); },
    inc,
    diff: SemVer.diff,
    SemVer,
    Range
};
