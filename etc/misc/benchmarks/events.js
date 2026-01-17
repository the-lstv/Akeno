'use strict';

// We test against a few popular EventEmitter implementations

// EventEmitter 1
const { EventEmitter } = require('events');

// EventEmitter 2
const EventEmitter2 = require('eventemitter2').EventEmitter2;

// EventEmitter 3
const EventEmitter3 = require('eventemitter3');

// Tseep
const { EventEmitter: Tseep } = require('tseep');

// Tseep Safe
const { EventEmitter: TseepSafe } = require('tseep/lib/ee-safe');

// Drip
const { EventEmitter: Drip } = require('drip');

// emitix
const { EventEmitter: EmitixEventEmitter } = require('emitix');

// fastemitter
const fastemitter = require('fastemitter');


const EMITS = 100_000;
const LISTENERS = 50;
// const EMITS = 1;
// const LISTENERS = 1_000_000;
const TEST_ONCE = false;

console.log(`\nListeners per event: ${LISTENERS}`);
console.log(`Emit iterations:      ${EMITS}\n`);


class EventHandler {
    static REMOVE_LISTENER = Symbol("event-remove");
    static optimize = true;

    // Not available in node by default
    static AsyncFunction = typeof AsyncFunction !== 'undefined' ? AsyncFunction : (async function(){}).constructor;
    static Function = Function;

    static EventObject = class EventObject {
        compiled = null;
        listeners = [];
        free = [];
        aliases = null;
        completed = false;
        warned = false;
        data = null;

        break = false;
        results = false;
        async = false;
        await = false;
        deopt = false;

        _isEvent = true;

        remove(index) {
            if(this.listeners.length === 1) {
                this.listeners.length = 0;
                this.free.length = 0;
                return;
            }

            this.listeners[index] = null;
            this.free.push(index);
            this.compiled = null; // Invalidate compiled function
        }

        emit(data) {
            return EventHandler.emit(this, data);
        }

        /**
         * Recompile the event's internal emit function for performance.
         * Compilation may get skipped in which case the normal emit loop is used.
         */
        recompile() {
            const listeners = this.listeners;
            const listenersCount = listeners.length;

            // TODO: Unroll for large amounts of listeners
            if (listenersCount < 2 || listenersCount >= 950 || EventHandler.optimize === false || this.await === true || this.deopt === true) return;

            const collectResults = this.results === true;
            const breakOnFalse = this.break === true;

            const parts = [];
            parts.push("var l=listeners;");
            for (let i = 0; i < listenersCount; i++) {
                const li = listeners[i];
                if (li === null) continue;
                parts.push("var f", i, "=l[", i, "].callback;");
            }

            parts.push(
                "l=undefined;return(function(a,b,c,d,e){var v"
            );

            if (collectResults) parts.push(",r=[]");
            parts.push(";");

            // Main call loop
            for (let i = 0; i < listenersCount; i++) {
                const li = listeners[i];
                if (li === null) continue;

                if(this.await === true) {
                    parts.push("v=await f");
                } else {
                    parts.push("v=f");
                }

                parts.push(i, "(a,b,c,d,e);");

                // Optional break behavior
                if (breakOnFalse) {
                    parts.push("if(v===false)return", collectResults ? " r" : "", ";");
                }

                if (li.once) {
                    if (collectResults) {
                        parts.push("if(v!==RL)r.push(v);");
                    }
                    parts.push("event.remove(", i, ");");
                } else {
                    if (collectResults) {
                        parts.push("if(v===RL){event.remove(", i, ")}else{r.push(v)};");
                    } else {
                        parts.push("if(v===RL){event.remove(", i, ")};");
                    }
                }
            }

            if (collectResults) parts.push("return r;");
            parts.push("})");

            const constructor = this.await? EventHandler.AsyncFunction: EventHandler.Function;
            const factory = new constructor("RL", "listeners", "event", parts.join(""));
            this.compiled = factory(EventHandler.REMOVE_LISTENER, listeners, this);
        }
    }

    /**
     * @param {object} target Possibly deprecated; Binds the event handler methods to a target object.
     * @param {object} options Event handler options.
     */
    constructor(target, options = {}) {
        EventHandler.prepareHandler(this, options);
        if(target){
            target._events = this;

            ["emit", "quickEmit", "on", "once", "off"].forEach(method => {
                if (!target.hasOwnProperty(method)) target[method] = this[method].bind(this);
            });

            this.target = target;
        }
    }

    static prepareHandler(target, options = {}){
        target.events = new Map();
        if(options) target.eventOptions = options;
    }

    /**
     * Prepare or update an event object with given name and options.
     * @param {string|symbol} name Name of the event.
     * @param {object} options Event options.
     * @returns {EventObject} Prepared event object.
     * 
     * @warning If you are going to use the event reference, remember to dispose of it properly to avoid memory leaks.
     */
    prepareEvent(name, options = undefined){
        let event = this.events.get(name);

        if(!event) {
            event = new EventHandler.EventObject();
            this.events.set(name, event);
        }

        if(options){
            if(options.completed !== undefined) {
                event.completed = options.completed;
                if(!event.completed) event.data = null;
            }

            if(options.break !== undefined) event.break = !!options.break;
            if(options.results !== undefined) event.results = !!options.results;
            if(options.async !== undefined) event.async = !!options.async;
            if(options.await !== undefined) {
                event.await = !!options.await;
                this.compiled = null; // Need to recompile
            }
            if(options.deopt !== undefined) {
                event.deopt = !!options.deopt;
                this.compiled = null; // Remove compiled function
            }

            if(options.data !== undefined) event.data = options.data;
        }

        return event;
    }

    on(name, callback, options){
        const event = name._isEvent? name: (this.events.get(name) || this.prepareEvent(name));
        if(event.completed) {
            if(event.data) Array.isArray(event.data) ? callback.apply(null, event.data) : callback(event.data); else callback();
            if(options && options.once) return;
        }

        options ||= {};
        options.callback = callback;

        const free = event.free;
        if (free.length > 0) {
            event.listeners[free.pop()] = options;
        } else {
            const amount = event.listeners.push(options);
            if(amount > (this.eventOptions?.maxListeners || 1000) && !event.warned) {
                console.warn(`EventHandler: Possible memory leak detected. ${event.listeners.length} listeners added for event '${name.toString()}'.`);
                event.warned = true;
            }
        }

        event.compiled = null; // Invalidate compiled function
    }

    off(name, callback){
        const event = (name._isEvent? name: this.events.get(name));
        if(!event) return;

        const listeners = event.listeners;

        for(let i = 0; i < listeners.length; i++){
            const listener = listeners[i];
            if(!listener) continue;

            if(listener.callback === callback){
                event.remove(i);
            }
        }
    }

    once(name, callback, options){
        options ??= {};
        options.once = true;
        return this.on(name, callback, options);
    }

    /**
     * Emit an event with the given name and data.
     * @param {string|object} name Name of the event to emit or it's reference
     * @param {Array} data Array of values to pass
     * @param {object} event Optional emit options override
     * @returns {null|Array|Promise<null|Array>} Array of results (if options.results is true) or null. If event.await is true, returns a Promise.
     */
    emit(name, data) {
        const event = name._isEvent ? name : this.events.get(name);
        if (!event || event.listeners.length === 0) return event && event.await ? Promise.resolve(null) : null;

        const listeners = event.listeners;
        const listenerCount = listeners.length;

        const collectResults = event.results === true;

        const isArray = data && Array.isArray(data);
        if(!isArray) data = [data];
        const dataLen = isArray ? data.length : 0;

        let a = undefined, b = undefined, c = undefined, d = undefined, e = undefined;

        if (dataLen > 0) a = data[0];
        if (dataLen > 1) b = data[1];
        if (dataLen > 2) c = data[2];
        if (dataLen > 3) d = data[3];
        if (dataLen > 4) e = data[4];

        // Awaiting path
        if (event.await === true) {
            if(!event.compiled) {
                event.recompile();
            }

            if(event.compiled) {
                return event.compiled(a, b, c, d, e);
            }

            const breakOnFalse = event.break === true;
            const returnData = collectResults ? [] : null;

            return (async () => {
                for (let i = 0; i < listeners.length; i++) {
                    const listener = listeners[i];
                    if (listener === null) continue;

                    let result = (dataLen < 6)? listener.callback(a, b, c, d, e): listener.callback.apply(null, data);
                    if (result && typeof result.then === 'function') {
                        result = await result;
                    }

                    if (collectResults) returnData.push(result);

                    if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                        event.remove(i);
                    }

                    if (breakOnFalse && result === false) break;
                }
                return returnData;
            })();
        }

        if(listenerCount === 1) {
            const listener = listeners[0];

            let result = listener.callback(a, b, c, d, e);

            if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                event.remove(0);
            }

            return collectResults? [result]: null;
        }

        if(!event.compiled) {
            event.recompile();
        }

        if(event.compiled) {
            return event.compiled(a, b, c, d, e);
        }

        const breakOnFalse = event.break === true;
        const returnData = collectResults ? [] : null;

        if(dataLen < 6){
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                if (listener === null) continue;

                let result = listener.callback(a, b, c, d, e);
                if (collectResults) returnData.push(result);

                if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                    event.remove(i);
                }

                if (breakOnFalse && result === false) break;
            }
        } else {
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                if (listener === null) continue;

                let result = listener.callback.apply(null, data);
                if (collectResults) returnData.push(result);

                if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                    event.remove(i);
                }

                if (breakOnFalse && result === false) break;
            }
        }

        return returnData;
    }

    /**
     * Faster emit, without checking or collecting return values. Limited to 5 arguments.
     * @warning This does not guarantee EventHandler.REMOVE_LISTENER or any other return value functionality. Async events are not supported with quickEmit.
     * @param {string|object} event Event name or reference.
     * @param {*} a First argument.
     * @param {*} b Second argument.
     * @param {*} c Third argument.
     * @param {*} d Fourth argument.
     * @param {*} e Fifth argument.
     */
    quickEmit(name, a, b, c, d, e){
        const event = name._isEvent ? name : this.events.get(name);
        if (!event || event.listeners.length === 0) return false;

        if(event.await === true) {
            throw new Error("quickEmit cannot be used with async/await events.");
        }

        if(event.listeners.length === 1) {
            const listener = event.listeners[0];
            listener.callback(a, b, c, d, e);
            if (listener.once) {
                event.remove(0);
            }
            return;
        }

        if(!event.compiled) {
            event.recompile();
        }

        if(event.compiled) {
            event.compiled(a, b, c, d, e);
            return;
        }

        const listeners = event.listeners;
        for(let i = 0, len = listeners.length; i < len; i++){
            const listener = listeners[i];
            if(listener === null) continue;

            if(listener.once) {
                event.remove(i);
            }

            listener.callback(a, b, c, d, e);
        }
    }

    flush(){
        this.events.clear();
    }

    /**
     * Create an alias for an existing event.
     * They will become identical and share listeners.
     * @param {*} name Original event name.
     * @param {*} alias Alias name.
     */
    alias(name, alias){
        const event = (name._isEvent? name: this.events.get(name)) || this.prepareEvent(name);
        event.aliases ??= [];

        if(!event.aliases.includes(alias)) event.aliases.push(alias);
        this.events.set(alias, event);
    }

    completed(name, data = undefined, options = null){
        this.emit(name, data);

        options ??= {};
        options.completed = true;
        options.data = data;

        this.prepareEvent(name, options);
    }
}

class OldEventHandler {
    static REMOVE_LISTENER = Symbol("event-remove");

    /**
     * @param {object} target Possibly deprecated; Binds the event handler methods to a target object.
     */
    constructor(target){
        EventHandler.prepareHandler(this);
        if(target){
            target._events = this;

            ["emit", "on", "once", "off", "invoke"].forEach(method => {
                if (!target.hasOwnProperty(method)) target[method] = this[method].bind(this);
            });

            this.target = target;
        }
    }

    static prepareHandler(target){
        target.events = new Map;
    }

    prepareEvent(name, options){
        if(options && options.completed === false) {
            // Clear data once uncompleted
            options.data = null;
        }

        let event = this.events.get(name);
        if(!event) {
            event = { listeners: [], empty: [], ...options, _isEvent: true };
            this.events.set(name, event);
        } else if(options){
            Object.assign(event, options);
        }

        return event;
    }

    on(name, callback, options){
        const event = (name._isEvent? name: this.events.get(name)) || this.prepareEvent(name);
        if(event.completed) {
            if(event.data) callback(...event.data); else callback();
            if(options && options.once) return this;
        }

        const index = event.empty.length > 0 ? event.empty.pop() : event.listeners.length;

        const listener = event.listeners[index] = { callback, index, ...options };
        return listener;
    }

    off(name, callback){
        const event = name._isEvent? name: this.events.get(name);
        if(!event) return;

        for(let i = 0; i < event.listeners.length; i++){
            if(event.listeners[i].callback === callback) {
                event.empty.push(i);
                event.listeners[i] = null;
            }
        }

        return this;
    }

    once(name, callback, options){
        return this.on(name, callback, Object.assign(options || {}, { once: true }));
    }

    /**
     * @deprecated To be removed in 5.3.0
    */
    invoke(name, ...data){
        return this.emit(name, data, { results: true });
    }

    /**
     * Emit an event with the given name and data.
     * @param {string|object} name Name of the event or an event object.
     * @param {Array} data Data to pass to the event listeners.
     * @param {object} options Override options for the event emission.
     * @returns {Array|null} Returns an array of results or null.
     */

    emit(name, data, options = null) {
        if (!name || !this.events) return;

        const event = name._isEvent ? name : this.events.get(name);
        if (!options) options = event;

        const returnData = options && options.results ? [] : null;
        if (!event) return returnData;

        const hasData = Array.isArray(data) && data.length > 0;

        for (let listener of event.listeners) {
            if (!listener || typeof listener.callback !== "function") continue;

            try {
                const result = hasData ? listener.callback(...data) : listener.callback();

                if (options.break && result === false) break;
                if (options.results) returnData.push(result);

                if (result === EventHandler.REMOVE_LISTENER) {
                    event.empty.push(listener.index);
                    event.listeners[listener.index] = null;
                    listener = null;
                    continue;
                }
            } catch (error) {
                console.error(`Error in listener for event '${name}':`, listener, error);
            }

            if (listener && listener.once) {
                event.empty.push(listener.index);
                event.listeners[listener.index] = null;
                listener = null;
            }
        }

        if (options.async && options.results) {
            return Promise.all(returnData);
        }

        return returnData;
    }

    /**
     * Quickly emit an event without checks - to be used only in specific scenarios.
     * @param {*} event Event object.
     * @param {*} data Data array.
     */

    quickEmit(event, ...data){
        event = event._isEvent ? event : this.events.get(event);
        if (!event) return;

        for(let i = 0, len = event.listeners.length; i < len; i++){
            const listener = event.listeners[i];
            if(!listener || typeof listener.callback !== "function") continue;

            if(listener.once) {
                event.empty.push(listener.index);
                event.listeners[listener.index] = null;
            }

            listener.callback(...data);
        }
    }

    flush(){
        this.events.clear();
    }

    /**
     * Create an alias for an existing event.
     * They will become identical and share listeners.
     * @param {*} name Original event name.
     * @param {*} alias Alias name.
     */
    alias(name, alias){
        const event = (name._isEvent? name: this.events.get(name)) || this.prepareEvent(name);
        event.aliases ??= [];

        if(!event.aliases.includes(alias)) event.aliases.push(alias);
        this.events.set(alias, event);
    }

    completed(name, data = [], options = {}){
        this.emit(name, data);

        options ??= {};
        options.completed = true;
        options.data = data;

        this.prepareEvent(name, options);
    }
}

const payloads = [
    undefined, [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]
];

function iife(fn) {
    fn();
}

let check = 0;
function addListener(events) {
    if(LISTENERS === 0) return events;

    if(events.setMaxListeners) {
        events.setMaxListeners(LISTENERS + 10);
    }

    if(events.maxListeners !== undefined) {
        events.maxListeners = LISTENERS + 10;
    }

    if(events.eventOptions !== undefined) {
        events.eventOptions.maxListeners = LISTENERS + 10;
    }

    if(Array.isArray(events)) {
        // For reference throughput tests
        for (let i = 0; i < LISTENERS; i++) {
            events.push((a, b, c) => { check++; });
        }
        return events;
    }

    for (let i = 0; i < LISTENERS; i++) {
        events.on('evt', (a, b, c, d, e) => { return check++; });
    }

    return events;
}

class BenchmarkWrapper {
    constructor(bench) {
        this.results = new Map();
        this.runner = bench;
        this.multiRun = false;
    }

    run(times = 1) {
        this.results.clear();
        this.multiRun = times > 1;
        if(this.multiRun) console.log(`Processing ${times} runs...`);
        for(let i = 0; i < times; i++) {
            this.runner(this);
        }
        return this;
    }
    
    // !!! FIXME: Not to be used as of now for any kind of analysis as it is not accurate
    analyze() {
        console.log('Benchmark analysis:');

        const rows = [];
        if(this.multiRun) for (const [name, results] of this.results) {
            const total = results.reduce((a, b) => a + b, 0);
            const avg = total / results.length;
            const opsPerSecond = 1_000_000_000 / avg; // Calculate operations per second
            const stdDev = Math.sqrt(results.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / results.length);
            const min = Math.min(...results);
            const max = Math.max(...results);
            const median = results.slice().sort((a, b) => a - b)[Math.floor(results.length / 2)];
            
            console.log(`${name.padEnd(35)}  → ops/s: ${opsPerSecond.toFixed(2)},  stdDev: ${(stdDev / 1_000_000).toFixed(2)} ms,  min: ${(min / 1_000_000).toFixed(2)} ms,  max: ${(max / 1_000_000).toFixed(2)} ms,  median: ${(median / 1_000_000).toFixed(2)} ms (runs: ${results.length})`);
            
            rows.push([name, opsPerSecond.toFixed(2), (stdDev / 1_000_000).toFixed(2), (min / 1_000_000).toFixed(2), (max / 1_000_000).toFixed(2), (median / 1_000_000).toFixed(2), results.length]);
        }

        const sorted = Array.from(this.results.entries())
            .map(([name, results]) => {
                const total = results.reduce((a, b) => a + b, 0);
                const avg = total / results.length;
                const opsPerSecond = 1_000_000_000 / avg;
                return [name, opsPerSecond.toFixed(2)];
            })
            .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));

        console.log('\nSorted by fastest to slowest (ops/s):');
        sorted.forEach((row, idx) => {
            console.log(`${idx + 1}. ${row[0].padEnd(35)} → ${row[1]} ops/s`);
        });

        let table =
            '| Listeners | Emit calls | Sample size |\n|-----------|------------|-------------|\n' +
            `| ${LISTENERS} | ${EMITS} | ${this.multiRun ? rows[0][6] : 1} |\n\n` +
            '\n| Benchmark | ops/s | StdDev (ms) | Min (ms) | Max (ms) | Median (ms) |\n|-----------|-------|-------------|----------|----------|-------------|\n' +
            rows.map(row => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} | ${row[5]} |`).join('\n');
        return table;
    }

    bench(name, fn, iterations = 1_000_000) {
        // Warmup
        if(iterations !== 1) for (let i = 0; i < 2000; i++) fn();

        // Optional: give optimizer some breathing room
        if (global.gc) global.gc();

        check = 0;

        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) fn();
        const end = process.hrtime.bigint();

        if (check !== iterations * LISTENERS) {
            console.warn(`Warning: Possible bug in test '${name}'. Listeners called: ${check} times, expected: ${iterations * LISTENERS}.`);
        }

        const ns = Number(end - start);

        if(!this.multiRun) {
            console.log(`${name.padEnd(45)} → ${(ns / 1_000_000).toFixed(2)} ms`);
        }

        const results = this.results.get(name);
        if (results) {
            results.push(ns);
        } else {
            this.results.set(name, [ns]);
        }
        return ns;
    }

    runBenchmarks(impl, name) {
        const isEvH = impl === EventHandler || impl === OldEventHandler;
        const events = addListener(new impl());

        for(let i = 0; i < 7; i++) {
            if(i === 0) {
                this.bench(`${name} emit(name, none)`, () => {
                    return events.emit('evt');
                }, EMITS);
            } else {
                const payload = payloads[i] && payloads[i].slice();
                this.bench(`${name} emit(name, [${i}])`, () => {
                    if(isEvH) {
                        return events.emit('evt', payload);
                    } else {
                        return events.emit('evt', payload[0], payload[1], payload[2], payload[3], payload[4], payload[5]);
                    }
                }, EMITS);
            }
        }

        // Also test quickEmit and event ref
        if(isEvH) {
            const refEvt = events.prepareEvent('evt');
            this.bench(`${name} emit(ref, [3])`, () => {
                return events.emit(refEvt, [1, 2, 3]);
            }, EMITS);

            this.bench(`${name} emit(ref, object)`, () => {
                return events.emit(refEvt, {});
            }, EMITS);

            this.bench(`${name} quickEmit(name, [3])`, () => {
                return events.quickEmit('evt', 1, 2, 3);
            }, EMITS);

            this.bench(`${name} quickEmit(ref, [3])`, () => {
                return events.quickEmit(refEvt, 1, 2, 3);
            }, EMITS);

            const asyncRefEvt = events.prepareEvent('evt', { await: true });
            this.bench(`${name} emit(ref, [3], await)`, () => {
                return events.emit(asyncRefEvt, [1, 2, 3]);
            }, EMITS);
        }

        if(TEST_ONCE) {
            // Also test once
            this.bench(`${name} once(name, [3])`, () => {
                events.once('evt', (a, b, c) => { });
                return events.emit('evt', [1, 2, 3]);
            }, EMITS);
        }

        // if(isEvH) {
        //     this.bench(`${name} remove all`, () => {
        //         for(let event of events.events.values()) {
        //             for(let i = event.listeners.length -1; i >=0; i--) {
        //                 event.remove(i);
        //             }
        //         }
        //     }, 1);
        // }
    }
}

const benchmark = new BenchmarkWrapper((collector) => {
    iife(() => {
        const listeners = addListener([]);
        
        return collector.bench('Max theoretical throughput', () => {
            for(let i = 0; i < listeners.length; i++) {
                listeners[i](1,2,3);
            }
        }, EMITS);
    });

    iife(() => {
        const listeners = addListener([]);

        return collector.bench('Max practical throughput', () => {
            for(let i = 0; i < listeners.length; i++) {
                listeners[i](...[1,2,3]);
            }
        }, EMITS);
    });

    iife(() => {
        const listeners = addListener([]);
        const setup = new Function("listeners", listeners.map((l, i) => `var f${i}=listeners[${i}];`).join("") + "return (function(a,b,c){" + listeners.map((l, i) => `f${i}(a,b,c)`).join(";") + "})");
        const compiled = setup(listeners);

        return collector.bench('Perfect case throughput', () => {
            compiled(1, 2, 3);
        }, EMITS);
    });

    // Existing benchmarks
    collector.runBenchmarks(EventHandler, 'EventHandler2');         // The new EventHandler being benchmarked here

    EventHandler.optimize = false;
    collector.runBenchmarks(EventHandler, 'EventHandler2 (deopt)'); // Always uses loops instead of compiled functions to see the loop path performance
    collector.runBenchmarks(OldEventHandler, 'EventHandler');       // Old version for reference, which was only made to compete with DOM events.. so not a very high bar :P

    collector.runBenchmarks(Tseep, 'Tseep');                        // Tseep is still the king here and is very consistent (though EventHandler2.quickEmit(ref) is beats it slightly thanks to avoiding Map lookup)
    collector.runBenchmarks(TseepSafe, 'TseepSafe');                // Loop-based variant of Tseep, EventHandler2's loop variant beats it about 2x :D

    collector.runBenchmarks(EventEmitter, 'EventEmitter1');         // Node.js built-in, today seems to be comparable to EE2 and EE3
    collector.runBenchmarks(EventEmitter2, 'EventEmitter2');        // All EE1, EE2 and EE3 perform very similarly and are beaten by EventHandler2 & Tseep in every test case, even the loop variants, likely due to their internal structure
    collector.runBenchmarks(EventEmitter3, 'EventEmitter3');

    // // The following libraries seem to no longer be maintained and have issues, so the benchmarks are more for education rather than practical use.
    // collector.runBenchmarks(EmitixEventEmitter, 'emitix');          // Emitix seems to be the slowest one despite claiming to be the fastest in their benchmarks. It is fast in one case only (no args).
    // collector.runBenchmarks(fastemitter, 'fastemitter');            // Fastemitter seems to be dropping calls (eg. only 500000 out of 1000000 get called), maybe it limits to 5 listeners without letting you know.
    // collector.runBenchmarks(Drip, 'Drip');                          // Drip seems to be crashing with < 7 listeners, and it also drops calls at > 7 listeners. Does it hard-code to 7 listeners?? That can't be right
});

if (require.main === module) {
    benchmark.run()//.analyze();
    console.log(check === EMITS * LISTENERS);
}

module.exports = { EventHandler };