/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2024
    License: GPL-3.0
    Version: 1.0.0
    Description: Key-value database storage module built for Akeno
*/

let lmdb;

try {
    lmdb = require('node-lmdb');
} catch (e) {
    console.warn('Warning: node-lmdb module is not installed. Since we are stepping away from this module for countless issues, it is not required, but the database will be switched to memory-only mode.\n* Data will not be stored to disk! *');
    lmdb = null;
}

class KeyStorage {
    constructor(path, options){
        if(lmdb) this.env = new lmdb.Env();
        this.path = path;

        this.timeout = null;
        this.txn = null;
        
        this.dbi = {};

        if(options === true){
            this.open();
        }
    }

    open(options){
        if(!lmdb) return this;

        this.env.open({
            maxDbs: 3,
            mapSize: 2 * 1024 * 1024 * 1024,
            ...options,
            path: this.path,
        });

        return this;
    }

    openDbi(name, options, memoryCache = false){
        if(!lmdb) return new dbi(this, null, true);

        if(this.dbi[name]) return this.dbi[name];

        return this.dbi[name] = new dbi(this, this.env.openDbi({
            create: true,

            ...options, name
        }), memoryCache);
    }

    dbi(name){
        if(this.dbi[name]) return this.dbi[name]; else return null;
    }

    beginTxn(){
        if(!lmdb) return null;
        return this.env.beginTxn();
    }

    /**
     * @deprecated
     */

    queuePendingOperation(){
        if(this.timeout) return;

        this.timeout = setTimeout(() => this.commit(), 5);
    }

    /**
     * @deprecated
    */

    abortPendingWrite(){
        if(this.timeout){
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        if(this.txn){
            this.txn.abort();
            this.txn = null;
        }
    }

    commit(txn = this.txn){
        if(!txn || !lmdb) return;

        try {
            txn.commit();
            this.txn = null;
            this.timeout = null;
        } catch (error) {
            txn.abort();
            throw error;
        }
    }
}


// Newly, the dbi class is more compatible with JS Map

class dbi {
    constructor(parent, instance, memoryCache = false){
        this.parent = parent;
        this.env = parent.env;
        this.dbi = instance;
        this.memoryCache = !!memoryCache;
        this.cache = new Map;
    }

    beginTxn(){
        if(!lmdb) return null;
        return this.env.beginTxn();
    }

    set(txn, key, value){
        if(lmdb) {
            switch (true) {
                case value instanceof Buffer:
                    txn.putBinary(this.dbi, key, value);
                    break;
                case typeof value === "boolean":
                    txn.putBoolean(this.dbi, key, value);
                    break;
                case typeof value === "string":
                    txn.putString(this.dbi, key, value);
                    break;
                case typeof value === "object" || Array.isArray(value):
                    txn.putString(this.dbi, key, JSON.stringify(value));
                    break;
                case typeof value === "number":
                    txn.putNumber(this.dbi, key, value);
                    break;
                default:
                    throw new Error("Unsupported value type");
            }
        }

        if(this.memoryCache){
            this.cache.set(key, value);
        }

        return this;
    }

    commitSet(key, value){
        if(!lmdb) return this.set(null, key, value);
        const txn = this.env.beginTxn();
        try {
            this.set(txn, key, value);
        } finally {
            txn.commit();
        }
    }

    /**
     * @deprecated
     */

    deferSet(key, value){
        if(!lmdb) return this.set(null, key, value);
        if(!this.parent.txn) this.parent.txn = this.env.beginTxn();
        this.set(this.parent.txn, key, value);

        if(!this.parent.timeout) this.parent.queuePendingOperation();
        return this;
    }

    get(key, type){
        if(!lmdb) return this.cache.get(key) || null;

        if (this.memoryCache && this.cache.has(key)) {
            return this.cache.get(key);
        }

        const txn = this.env.beginTxn({ readOnly: true });

        try{
            return this.txnGet(txn, key, type);
        } finally {
            txn.abort();
        }
    }

    txnGet(txn, key, type){
        if(!lmdb) return this.cache.get(key) || null;

        switch (type) {
            case "binary": case "buffer": case Buffer:
                return txn.getBinary(this.dbi, key);

            case "boolean": case "bool": case Boolean:
                return txn.getBoolean(this.dbi, key);

            case "string": case String: case null: case undefined:
                return txn.getString(this.dbi, key);

            case "object": case "json": case Object: case Array:
                return JSON.parse(txn.getString(this.dbi, key));

            case "number": case Number:
                return txn.getNumber(this.dbi, key);

            default:
                throw new Error("Unsupported value type");
        }
    }

    multiRead(keys, type){
        const txn = this.env.beginTxn({ readOnly: true });
        const results = {};

        try {
            for (const key of keys) {
                if (this.memoryCache && this.cache.has(key)) {
                    results[key] = this.cache.get(key);
                    continue;
                }

                results[key] = this.txnGet(txn, key, type);
            }

            return results;
        } finally {
            txn.abort();
        }
    }

    delete(txn, key){
        this.cache.delete(key)
        if(!lmdb) return;

        return txn.del(this.dbi, key);
    }

    commitDelete(key){
        if(!lmdb) return this.delete(null, key);

        const txn = this.env.beginTxn();
        try {
            this.delete(txn, key);
        } finally {
            txn.commit();
        }
    }

    deferDelete(key){
        if(!lmdb) return this.delete(null, key);

        if(!this.parent.txn) this.parent.txn = this.env.beginTxn();
        this.delete(this.parent.txn, key);

        if(!this.parent.timeout) this.parent.queuePendingOperation();
        return this;
    }

    commit(){
        if(!lmdb) return;

        this.parent.commit();
    }

    hasCache(key){
        return this.cache.has(key);
    }

    getCache(key){
        return this.cache.get(key);
    }

    /**
     * @deprecated
     */

    exists(key){
        return this.has(key);
    }

    /**
     * @description Check if a key exists in the database
     */

    has(key){
        if(this.memoryCache && this.cache.has(key)){
            return true;
        }

        const txn = this.env.beginTxn({ readOnly: true });

        let cursor;
        try {
            cursor = new lmdb.Cursor(txn, this.dbi);
            return cursor.goToKey(key) !== null;
        } finally {
            if (cursor) cursor.close();
            txn.abort();
        }
    }
}

export default KeyStorage;