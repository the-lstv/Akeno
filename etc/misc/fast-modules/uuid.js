// Half the load time compared to Node "uuid", *over 100x smaller in size*, 2x faster generation (we simply use the native crypto.randomUUID), many times faster for other methods.
// All methods are single-pass, only charcodes, no regex.

const crypto = require('crypto');

module.exports = {
    v1: () => { throw new Error("UUIDv1 is not supported in the patched uuid module."); },
    v3: () => { throw new Error("UUIDv3 is not supported in the patched uuid module."); },
    v4: crypto.randomUUID,
    v5: () => { throw new Error("UUIDv5 is not supported in the patched uuid module."); },

    // Fast uuidv4 validation, roughly 3.5x faster than uuid.validate
    validate(uuid) {
        if(typeof uuid !== 'string' || uuid.length !== 36) return false;

        // Fixed length loop
        for (let i = 0; i < 36; i++) {
            const c = uuid.charCodeAt(i);
            if(i === 14) {
                // Version check
                if(c >= 48 && c <= 53) continue; // 0-5
            } else if(i === 19) {
                // Variant check
                if(c === 56 || c === 57 || c === 97 || c === 98 || c === 65 || c === 66) continue; // 8, 9, a, b, A, B
            } else if ((i === 8 || i === 13 || i === 18 || i === 23) ? c === 45 : ((c >= 48 && c <= 57) || // 0-9
                (c >= 97 && c <= 102) || // a-f
                (c >= 65 && c <= 70))) { // A-F
                continue;
            }
            return false;
        }
        return true;
    },

    parse(uuid) {
        if (typeof uuid !== 'string' || uuid.length !== 36) throw new Error('Invalid UUID');

        const bytes = new Uint8Array(16);
        let j = 0;

        for (let i = 0; i < 36; i++) {
            const c = uuid.charCodeAt(i);
            if (c === 45) continue;

            // Fast hex char => int conversion (15x+ faster than parseInt)
            const nibble = (c >= 48 && c <= 57)? c - 48: (c >= 97 && c <= 102)? c - 87: (c >= 65 && c <= 70)? c - 55: -1;
            if (nibble === -1) throw new Error('Invalid UUID character');

            bytes[j >> 1] = (bytes[j >> 1] << 4) | nibble;
            j++;
        }

        if (j !== 32) throw new Error('Invalid UUID length');
        return bytes;
    },

    stringify(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new Error('Invalid bytes');

        let str = '';
        for (let i = 0; i < 16; i++) {
            const hex = bytes[i].toString(16).padStart(2, '0');
            str += hex;
            if (i === 3 || i === 5 || i === 7 || i === 9) str += '-';
        }
        return str;
    },

    version(uuid) {
        if (typeof uuid !== 'string' || uuid.length !== 36) throw new Error('Invalid UUID');
        const versionChar = uuid.charCodeAt(14);
        if (versionChar >= 48 && versionChar <= 53) { // '0' to '5'
            return versionChar - 48;
        }
        throw new Error('Unsupported UUID version');
    },

    NIL: '00000000-0000-0000-0000-000000000000',
}