'use strict';

const { EventEmitter } = require('events');


const EMITS = 500_000;
const LISTENERS = 100;
// const EMITS = 1;
// const LISTENERS = 10_000_000;
const TEST_ONCE = false;

console.log(`\nListeners per event: ${LISTENERS}`);
console.log(`Emit iterations:      ${EMITS}\n`);


class EventHandler {
    static REMOVE_LISTENER = Symbol("event-remove");

    static EMPTY = [];

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
        target.events = new Map();
    }

    #createEventObject(){
        return {
            listeners: [],
            free: [],
            once: false,
            completed: false,
            data: null,
            _isEvent: true
        };
    }

    prepareEvent(name, options = {}){
        let event = this.events.get(name);

        if(!event) {
            event = this.#createEventObject();
            this.events.set(name, event);
        }

        if(options){
            if(options.once !== undefined) event.once = !!options.once;
            if(options.completed !== undefined) {
                event.completed = options.completed;
                if(!event.completed) event.data = null;
            }

            if(options.data !== undefined) event.data = options.data;
        }

        return event;
    }

    on(name, callback, options){
        const event = (name._isEvent? name: this.events.get(name)) || this.prepareEvent(name);
        const free = event.free || (event.free = []);
        let index;

        options ??= {};
        options.callback = callback;

        if (free.length > 0) {
            index = free.pop();
            event.listeners[index] = options;
        } else {
            index = event.listeners.length;
            event.listeners.push(options);
        }

        return index;
    }

    off(name, callback){
        const event = (name._isEvent? name: this.events.get(name));
        if(!event) return;

        const listeners = event.listeners;

        for(let i = 0; i < listeners.length; i++){
            if(listeners[i].callback === callback){
                listeners[i] = null;
                event.free.push(i);
            }
        }
    }

    once(name, callback, options){
        return this.on(name, callback, Object.assign(options || {}, { once: true }));
    }

    /**
     * Emit an event with the given name and data.
     * @param {string|object} name Name of the event to emit or it's reference
     * @param {Array} data Array of values to pass
     * @param {object} options Optional emit options override
     * @returns Array of results (if options.results is true) or null
     */
    emit(name, data, options) {
        const event = name._isEvent ? name : this.events.get(name);
        if (!event) return null;

        options ??= event;

        const listeners = event.listeners;
        const free = event.free;

        const collectResults = options.results === true;
        const breakOnFalse = options.break === true;

        const returnData = collectResults ? [] : null;
        const dataRef = Array.isArray(data) ? data : [data];

        for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i];
            if (listener === null) continue;

            let result = Reflect.apply(listener.callback, null, dataRef);

            if (collectResults) returnData.push(result);
            if (breakOnFalse && result === false) break;

            if (listener.once || result === EventHandler.REMOVE_LISTENER) {
                listeners[i] = null;
                free.push(i);
            }
        }

        return returnData;
    }

    /**
     * Quickly emit an event, without checking return values - to be used only in specific scenarios.
     * @param {*} event Event object.
     * @param {*} data Data array.
     */
    quickEmit(name, data){
        const event = name._isEvent ? name : this.events.get(name);
        if (!event) return null;

        const listeners = event.listeners;
        const free = event.free;

        const dataRef = Array.isArray(data)? data: [data];

        for(let i = 0, len = listeners.length; i < len; i++){
            const listener = listeners[i];
            if(listener === null) continue;

            if(listener.once) {
                listeners[i] = null;
                free.push(i);
            }

            Reflect.apply(listener.callback, null, dataRef);
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

        this.prepareEvent(name, {
            ...options,
            completed: true,
            data
        })
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

    quickEmit(event, data){
        if(!event._isEvent) throw new Error("Event must be a valid event object when using quickEmit");

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

        this.prepareEvent(name, {
            ...options,
            completed: true,
            data
        })
    }
}


const testedImpl = EventHandler;
// const testedImpl = OldEventHandler;

function bench(name, fn, iterations = 1_000_000) {
    // Warmup
    for (let i = 0; i < 50; i++) fn();

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn();
    const end = process.hrtime.bigint();

    const ns = Number(end - start);
    const ms = ns / 1e6;

    console.log(`${name.padEnd(35)} → ${(ms).toFixed(2)} ms`);
}


const nodeEE = new EventEmitter();
nodeEE.setMaxListeners(LISTENERS + 10);
for (let i = 0; i < LISTENERS; i++) {
    nodeEE.on('evt', (a,b,c) => {});
}

bench('Node EventEmitter', () => {
    nodeEE.emit('evt', 1, 2, 3);
}, EMITS);


const myEvents = new testedImpl();
for (let i = 0; i < LISTENERS; i++) {
    myEvents.on('evt', (a,b,c) => {});
}

bench('Custom emit(name)', () => {
    myEvents.emit('evt', [1,2,3]);
}, EMITS);


const myEvents12 = new testedImpl();
for (let i = 0; i < LISTENERS; i++) {
    myEvents12.on('evt', (a,b,c) => {});
}

bench('Custom emit(name) (second pass)', () => {
    myEvents12.emit('evt', [1,2,3]);
}, EMITS);


const myEvents2 = new testedImpl();
const refEvt = myEvents2.prepareEvent('evt');
for (let i = 0; i < LISTENERS; i++) {
    myEvents2.on(refEvt, (a,b,c) => {});
}

bench('Custom emit(ref)', () => {
    myEvents2.emit(refEvt, [1,2,3]);
}, EMITS);


const myEvents_ = new testedImpl();
const refEvt2 = myEvents_.prepareEvent('evt');
for (let i = 0; i < LISTENERS; i++) {
    myEvents_.on(refEvt2, (a,b,c) => {});
}

const o = { a:1, b:2, c:3 }
bench('Custom emit(ref) + no spread', () => {
    myEvents_.emit(refEvt2, o);
}, EMITS);

const myEvents__ = new testedImpl();
const refEvt3 = myEvents__.prepareEvent('evt');
for (let i = 0; i < LISTENERS; i++) {
    myEvents__.on(refEvt3, (a,b,c) => {});
}

bench('Custom emit(ref) + no data', () => {
    myEvents__.emit(refEvt3, null);
}, EMITS);


const myEvents3 = new testedImpl();
const fastEvt = myEvents3.prepareEvent('evt');
for (let i = 0; i < LISTENERS; i++) {
    fastEvt.listeners.push({ callback: (a,b,c) => {} });
}

bench('Custom quickEmit(ref)', () => {
    myEvents3.quickEmit(fastEvt, [1,2,3]);
}, EMITS);


const listeners = [];
for (let i = 0; i < LISTENERS; i++) {
    listeners.push((a,b,c) => {});
}

bench('Max theoretical throughput', () => {
    for(let i = 0; i < listeners.length; i++) {
        listeners[i](1,2,3);
    }
}, EMITS);

const listeners2 = [];
for (let i = 0; i < LISTENERS; i++) {
    listeners2.push((a,b,c) => {});
}

bench('Max practical throughput', () => {
    for(let i = 0; i < listeners.length; i++) {
        listeners[i](...[1,2,3]);
    }
}, EMITS);


console.log('');


if(!TEST_ONCE) process.exit(0);

const nodeEE_once = new EventEmitter();
nodeEE_once.setMaxListeners(LISTENERS + 10);

bench('Node EventEmitter (once)', () => {
    // Add listeners each iteration since they're removed after first emit
    for (let i = 0; i < LISTENERS; i++) {
        nodeEE_once.once('evt', (a,b,c) => {});
    }
    nodeEE_once.emit('evt', 1, 2, 3);
}, EMITS);


const myEvents_once = new testedImpl();

bench('Custom once(name)', () => {
    // Add listeners each iteration since they're removed after first emit
    for (let i = 0; i < LISTENERS; i++) {
        myEvents_once.once('evt', (a,b,c) => {});
    }
    myEvents_once.emit('evt', [1,2,3]);
}, EMITS);


const myEvents_once2 = new testedImpl();
const refEvt_once = myEvents_once2.prepareEvent('evt');

bench('Custom once(ref)', () => {
    // Add listeners each iteration since they're removed after first emit
    for (let i = 0; i < LISTENERS; i++) {
        myEvents_once2.once(refEvt_once, (a,b,c) => {});
    }
    myEvents_once2.emit(refEvt_once, [1,2,3]);
}, EMITS);


const myEvents_mixed = new testedImpl();
const mixedEvt = myEvents_mixed.prepareEvent('evt');

// Add half regular, half once listeners
for (let i = 0; i < LISTENERS / 2; i++) {
    myEvents_mixed.on(mixedEvt, (a,b,c) => {});
}

bench('Custom mixed (50% once)', () => {
    // Add once listeners each iteration
    for (let i = 0; i < LISTENERS / 2; i++) {
        myEvents_mixed.once(mixedEvt, (a,b,c) => {});
    }
    myEvents_mixed.emit(mixedEvt, [1,2,3]);
}, EMITS);


const myEvents_preonce = new testedImpl();
const preOnceEvt = myEvents_preonce.prepareEvent('evt');

// Pre-register all once listeners
for (let i = 0; i < LISTENERS; i++) {
    myEvents_preonce.once(preOnceEvt, (a,b,c) => {});
}

bench('Custom pre-reg once (1 emit)', () => {
    myEvents_preonce.emit(preOnceEvt, [1,2,3]);
}, 1); // Single emit to test cleanup performance


const myEvents_cleanup = new testedImpl();
const cleanupEvt = myEvents_cleanup.prepareEvent('evt');

console.log('Once cleanup efficiency test:');
console.log('Adding 10000 once listeners, then emitting...');

const cleanupStart = process.hrtime.bigint();

// Add many once listeners
for (let i = 0; i < 10000; i++) {
    myEvents_cleanup.once(cleanupEvt, (a,b,c) => {});
}

const addTime = process.hrtime.bigint();

// Emit once to trigger cleanup
myEvents_cleanup.emit(cleanupEvt, [1,2,3]);

const cleanupEnd = process.hrtime.bigint();

const addNs = Number(addTime - cleanupStart);
const cleanupNs = Number(cleanupEnd - addTime);

console.log(`Add 10k once listeners:      ${(addNs / 1e6).toFixed(2)} ms`);
console.log(`Emit + cleanup:              ${(cleanupNs / 1e6).toFixed(2)} ms`);
console.log(`Free slots after cleanup:    ${cleanupEvt.free ? cleanupEvt.free.length : 0}`);


console.log('');
