const fs = require('fs');
const lmdb = require('lmdb');
const { xxh32, xxh64, xxh3 } = require("@node-rs/xxhash");

function getHash(algorithm, buffer) {
    if(algorithm === "xxh3" || !algorithm) return xxh3.xxh64(buffer).toString(16);
    if(algorithm === "xxh32") return xxh32(buffer).toString(16);
    if(algorithm === "xxh64") return xxh64(buffer).toString(16);
    if(algorithm === "xxh128") return xxh3.xxh128(buffer).toString(16);
    if(algorithm === "md5") return crypto.createHash('md5').update(buffer).digest('hex');
    return null;
}

class FileStorage {
    constructor(options = {}) {
        this.path = options.path || "./file_storage";
        this.splitLevels = typeof options.splitLevels === 'number' ? options.splitLevels : 2;

        if (!fs.existsSync(this.path)) {
            fs.mkdirSync(this.path, { recursive: true });
        }
    }

    getFilePath(hash) {
        if (this.splitLevels === 0) return hash;
        let parts = [];
        let pos = 0;
        for (let i = 0; i < this.splitLevels; i++) {
            if (pos + 2 > hash.length) break;
            parts.push(hash.slice(pos, pos + 2));
            pos += 2;
        }
        const dir = `${this.path}/${parts.join('/')}`;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const rest = hash.slice(pos);
        return parts.length > 0 ? `${parts.join('/')}/${rest}` : rest;
    }

    async write(hash, buffer) {
        const hashedPath = this.getFilePath(hash);
        await fs.promises.writeFile(`${this.path}/${hashedPath}`, buffer);
        return hashedPath; // store relative path in DB
    }

    async read(relativePath) {
        try {
            return await fs.promises.readFile(`${this.path}/${relativePath}`);
        } catch (error) {
            return null;
        }
    }

    async delete(relativePath) {
        const full = `${this.path}/${relativePath}`;
        if (fs.existsSync(full)) await fs.promises.unlink(full);
    }
}

class FileBucket {
    constructor(path, options = {}) {
        this.db = lmdb.open({ path, compression: true, cache: true });
        this.options = options;

        // Large file handling setup
        this.maxInlineSize = typeof options.maxInlineSize === 'number' ? options.maxInlineSize : 1024 * 1024 * 5; // default 5MB

        // Allow passing an instantiated storage, a storage class, or disable if none
        if (options.fileStorage) {
            if(options.fileStorage === true) {
                this.storage = new FileStorage();
            } else {
                this.storage = options.fileStorage;
            }
        } else {
            this.storage = null; // disabled
        }
    }

    async put(file, meta = null, customHash = null) {
        if (typeof file === "string") file = Buffer.from(file);
        if (!(file instanceof Buffer)) throw new Error("File must be a Buffer");

        const hash = customHash || getHash(this.options.hashAlgorithm, file);

        if(this.has(hash)) return hash; // already stored

        if(!this.storage && file.length > this.maxInlineSize) {
            throw new Error("File is too large to store inline and no storage backend configured (you can set { fileStorage: true } in options to enable the default storage).");
        }

        if(meta) {
            if(!await this.db.put("meta:" + hash, meta)) throw new Error("Failed to store metadata");
        }

        if (file.length > this.maxInlineSize) {
            const pathRef = await this.storage.write(hash, file);
            await this.db.put(hash, pathRef);
        } else {
            await this.db.put(hash, file);
        }
        return hash;
    }

    async get(key, readFromFile = true) {
        const data = await this.db.get(key);
        if (Buffer.isBuffer(data)) return Buffer.from(data); // TODO: This is worth checking; copying shouldn't be necessary (since we are calling get() which shouldn't reuse), but I did observe "use-after-free" issues at random times, so better safe than sorry
        if (typeof data === 'string' && this.storage) {
            if(!readFromFile) return this.storage.path + "/" + data;

            const buffer = await this.storage.read(data);
            if (buffer) return buffer;
            this.db.remove(key); // file missing, remove entry
            return null;
        }
        return null;
    }

    async getDirect(key) {
        return this.db.get(key);
    }

    has(key) {
        return this.db.doesExist(key);
    }

    getMeta(key) {
        return this.db.get("meta:" + key);
    }

    async remove(key) {
        await this.db.remove("meta:" + key);
        const value = await this.getDirect(key);
        if (typeof value === "string" && this.storage) await this.storage.delete(value);
        await this.db.remove(key);
    }

    getEntries(){
        return [...this.db.getKeys()];
    }
}

module.exports = { FileBucket, FileStorage, getHash };