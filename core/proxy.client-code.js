const originalFetch = window.fetch;
window.fetch = function (url, ...args) {
    url = translateURL(url);

    return originalFetch(url, ...args);
}

const originalWebSocket = window.WebSocket;
window.WebSocket = function (url, ...args) {
    url = translateURL(url, "ws");

    return new originalWebSocket(url, ...args);
}

const originalXHR = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    url = translateURL(url);

    return originalXHR.call(this, method, url, ...rest);
};

const originalEventSource = window.EventSource;
window.EventSource = function(url, config) {
    url = translateURL(url);

    return new originalEventSource(url, config);
};

const originalSendBeacon = window.navigator.sendBeacon;
window.navigator.sendBeacon = function(url, data) {
    url = translateURL(url);

    return originalSendBeacon.call(this, url, data);
};

function modifyElementAttributes(element) {
    if (element.src) element.src = translateURL(element.src)
    if (element.href) element.href = translateURL(element.href)
}


const observer = new MutationObserver((mutationsList) => {
        mutationsList.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Only process element nodes
                modifyElementAttributes(node);
            }
        });
    });
})

const originalSetAttribute = Element.prototype.setAttribute;

function setAttribute (attr, value) {
    if (attr === 'src' || attr === 'href' || attr === 'action' || attr === 'data' || attr === 'srcset' || attr === 'poster') {
        value = translateURL(value);
    }

    return originalSetAttribute.call(this, attr, value);
};

Element.prototype.setAttribute = setAttribute;

const originalCreateElement = document.createElement;

document.createElement = function (tagName, ...options) {

    let element = originalCreateElement.call(this, tagName, ...options);

    Object.defineProperties(element, {
        src: {
            configurable: true,
            enumerable: true,
            get(){
                return element.getAttribute("src")
            },
            set(value){
                return setAttribute.call(element, "src", value);
            }
        },

        href: {
            configurable: true,
            enumerable: true,
            get(){
                return element.getAttribute("href")
            },
            set(value){
                return setAttribute.call(element, "href", value);
            }
        }
    })

    element.setAttribute = setAttribute;

    return element
};

let PROXY_URL = decodeURIComponent(window.location.pathname).substring(1);

try {
    if(!PROXY_URL.startsWith("http")) PROXY_URL = `https://${PROXY_TARGET}/${PROXY_URL}`;
    PROXY_URL = new URL(PROXY_URL)
} catch {
    console.error("[Proxy] Failed parsing proxy value")
}

window._location_ = {
    origin: PROXY_ORIGIN,

    pathname: PROXY_URL.pathname,

    protocol: PROXY_URL.protocol,

    get hash() {
        return PROXY_URL.hash
    },

    host: PROXY_TARGET,

    hostname: PROXY_TARGET,

    search: PROXY_URL.search,

    port: PROXY_URL.port,

    set href(value) {
        window.location.href = translateURL(value);
    },

    get href() {
        return PROXY_URL.href;
    },

    assign(url) {
        window.location.assign(translateURL(url));
    },

    replace(url) {
        window.location.replace(translateURL(url));
    },

    reload() {
        window.location.reload();
    },

    toString(){
        return _location_.href
    },

    valueOf(){
        return _location_
    }
}

document._location_ = window._location_