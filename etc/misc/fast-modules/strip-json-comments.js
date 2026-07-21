/**
 * Strips JSON comments from a JSON string.
 * @param {*} jsonString JSON string to strip comments from.
 * @returns {string} JSON string without comments.
 * 
 * Benchmarked against tiny-jsonc and strip-json-comments (used by jsonc):
 * https://jsbm.dev/kdXHwmdsMErnj
 * 
 * About 6x faster than tiny-jsonc and 10x faster than strip-json-comments.
 * Since strip-json-comments is a dependency of the jsonc node module (which has so many dependencies for some reason), it's also fastr than that.
 * I couldn't test "jsonc" since it is somehow Node.js only.
 */
function stripJsonComments(jsonString) {
    let stringChar = null;
    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString.charCodeAt(i);

        if (stringChar) {
            if (char === stringChar) {
                stringChar = null;
            } else if (char === 92) { // \
                i++;
            }
            continue;
        }

        if (char === 34 || char === 39) { // " or '
            stringChar = char;
            continue;
        }

        if (char === 47) {
            const next = jsonString.charCodeAt(i + 1);

            // Single-line comments
            if (next === 47) {
                const eol = jsonString.indexOf("\n", i + 2);
                if (eol === -1) {
                    return jsonString.slice(0, i);
                }

                jsonString = jsonString.slice(0, i) + jsonString.slice(eol);
                i--;
                continue;
            }
            
            // Multi-line comments
            if (next === 42) {
                const eoc = jsonString.indexOf("*/", i + 2);
                if (eoc === -1) {
                    throw new Error("Unterminated comment in JSON string");
                }

                jsonString = jsonString.slice(0, i) + jsonString.slice(eoc + 2);
                i--;
                continue;
            }
        }
    }

    return jsonString;
}

module.exports = stripJsonComments;