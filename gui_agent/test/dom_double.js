/***********************************************************************
 *          dom_double.js
 *
 *      A copy of gobj-ui's test/dom_double.js (7.25.5), which the npm
 *      tarball does not ship. Keep the two in step.
 *
 *      A DOCUMENT DOUBLE for the wiring tests: enough of the DOM for a
 *      gclass to build its tree in mt_create, so the test can drive its
 *      FSM with real events -- which is what a helper test cannot see.
 *      The vitest suite runs in node, with no jsdom; the helpers stay
 *      pure and are tested without this, and a test that needs a gclass
 *      alive installs it first:
 *
 *          import {install_dom_double} from "../test/dom_double.js";
 *          install_dom_double();
 *          const {register_c_x} = await import("../src/c_x.js");
 *
 *      It is a double, not a browser: no layout, no CSS, events are
 *      only what a caller dispatches. Selectors: compound simple ones
 *      (tag, #id, .class, [attr], [attr="v"]), the descendant space, and
 *      comma lists.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

class FakeClassList {
    constructor() {
        this.set = new Set();
    }
    add(...names) {
        for(const n of names) {
            if(n) {
                this.set.add(n);
            }
        }
    }
    remove(...names) {
        for(const n of names) {
            this.set.delete(n);
        }
    }
    toggle(name, force) {
        const on = (force === undefined)? !this.set.has(name) : !!force;
        if(on) {
            this.set.add(name);
        } else {
            this.set.delete(name);
        }
        return on;
    }
    contains(name) {
        return this.set.has(name);
    }
    replace(a, b) {
        if(this.set.has(a)) {
            this.set.delete(a);
            this.set.add(b);
        }
    }
    get length() {
        return this.set.size;
    }
    toString() {
        return [...this.set].join(" ");
    }
    [Symbol.iterator]() {
        return this.set[Symbol.iterator]();
    }
}

function make_style()
{
    const style = {
        cssText: "",
        setProperty(k, v) {
            style[k] = v;
        },
        removeProperty(k) {
            delete style[k];
        },
        getPropertyValue(k) {
            return style[k] || "";
        }
    };
    return style;
}

class FakeNode {
    constructor() {
        this.parentNode = null;
        this.childNodes = [];
    }
    get parentElement() {
        return this.parentNode;
    }
    get firstChild() {
        return this.childNodes[0] || null;
    }
    get lastChild() {
        return this.childNodes[this.childNodes.length - 1] || null;
    }
    get nextSibling() {
        if(!this.parentNode) {
            return null;
        }
        const k = this.parentNode.childNodes;
        return k[k.indexOf(this) + 1] || null;
    }
    get previousSibling() {
        if(!this.parentNode) {
            return null;
        }
        const k = this.parentNode.childNodes;
        return k[k.indexOf(this) - 1] || null;
    }
    remove() {
        if(this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }
}

class FakeText extends FakeNode {
    constructor(text) {
        super();
        this.nodeType = 3;
        this.data = String(text);
    }
    get textContent() {
        return this.data;
    }
    set textContent(v) {
        this.data = String(v);
    }
    cloneNode() {
        return new FakeText(this.data);
    }
}

class FakeElement extends FakeNode {
    constructor(tag) {
        super();
        this.nodeType = 1;
        this.tagName = String(tag || "div").toUpperCase();
        this.nodeName = this.tagName;
        this.attributes = {};
        this.classList = new FakeClassList();
        this.style = make_style();
        this.dataset = {};
        this.listeners = {};
        this.value = "";
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.scrollTop = 0;
        this.scrollLeft = 0;
    }

    /*  Attributes  */
    setAttribute(k, v) {
        const s = String(v);
        if(k === "class") {
            this.classList = new FakeClassList();
            this.classList.add(...s.split(/\s+/).filter(Boolean));
            return;
        }
        if(k === "style") {
            this.style.cssText = s;
            return;
        }
        this.attributes[k] = s;
        if(k === "id") {
            this.id = s;
        }
        if(k === "value") {
            this.value = s;
        }
        if(k.startsWith("data-")) {
            const key = k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
            this.dataset[key] = s;
        }
    }
    getAttribute(k) {
        if(k === "class") {
            return this.className;
        }
        if(k === "id" && this.id) {
            return this.id;
        }
        return Object.prototype.hasOwnProperty.call(this.attributes, k)? this.attributes[k] : null;
    }
    hasAttribute(k) {
        return this.getAttribute(k) !== null;
    }
    removeAttribute(k) {
        if(k === "class") {
            this.classList = new FakeClassList();
            return;
        }
        delete this.attributes[k];
    }
    toggleAttribute(k, force) {
        const on = (force === undefined)? !this.hasAttribute(k) : !!force;
        if(on) {
            this.setAttribute(k, "");
        } else {
            this.removeAttribute(k);
        }
        return on;
    }
    get className() {
        return this.classList.toString();
    }
    set className(v) {
        this.setAttribute("class", v);
    }
    get title() {
        return this.getAttribute("title") || "";
    }
    set title(v) {
        this.setAttribute("title", v);
    }

    /*  Tree  */
    get children() {
        return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get firstElementChild() {
        return this.children[0] || null;
    }
    get lastElementChild() {
        const c = this.children;
        return c[c.length - 1] || null;
    }
    get nextElementSibling() {
        let n = this.nextSibling;
        while(n && n.nodeType !== 1) {
            n = n.nextSibling;
        }
        return n;
    }
    get previousElementSibling() {
        let n = this.previousSibling;
        while(n && n.nodeType !== 1) {
            n = n.previousSibling;
        }
        return n;
    }
    get childElementCount() {
        return this.children.length;
    }
    appendChild(child) {
        if(!child) {
            return child;
        }
        if(child.nodeType === 11) {
            for(const c of [...child.childNodes]) {
                this.appendChild(c);
            }
            return child;
        }
        if(child.parentNode) {
            child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    append(...nodes) {
        for(const n of nodes) {
            this.appendChild((typeof n === "string")? new FakeText(n) : n);
        }
    }
    prepend(...nodes) {
        for(const n of nodes.reverse()) {
            this.insertBefore((typeof n === "string")? new FakeText(n) : n, this.firstChild);
        }
    }
    insertBefore(child, ref) {
        if(!ref) {
            return this.appendChild(child);
        }
        if(child.parentNode) {
            child.parentNode.removeChild(child);
        }
        const i = this.childNodes.indexOf(ref);
        child.parentNode = this;
        if(i < 0) {
            this.childNodes.push(child);
        } else {
            this.childNodes.splice(i, 0, child);
        }
        return child;
    }
    insertAdjacentElement(where, el) {
        if(where === "afterbegin") {
            return this.insertBefore(el, this.firstChild);
        }
        if(where === "beforeend") {
            return this.appendChild(el);
        }
        if(where === "beforebegin" && this.parentNode) {
            return this.parentNode.insertBefore(el, this);
        }
        if(where === "afterend" && this.parentNode) {
            return this.parentNode.insertBefore(el, this.nextSibling);
        }
        return null;
    }
    insertAdjacentHTML() {
    }
    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if(i >= 0) {
            this.childNodes.splice(i, 1);
            child.parentNode = null;
        }
        return child;
    }
    replaceChild(nu, old) {
        this.insertBefore(nu, old);
        this.removeChild(old);
        return old;
    }
    replaceChildren(...nodes) {
        for(const c of [...this.childNodes]) {
            this.removeChild(c);
        }
        this.append(...nodes);
    }
    replaceWith(node) {
        if(this.parentNode) {
            this.parentNode.replaceChild(node, this);
        }
    }
    contains(node) {
        let n = node;
        while(n) {
            if(n === this) {
                return true;
            }
            n = n.parentNode;
        }
        return false;
    }
    cloneNode(deep) {
        const c = new FakeElement(this.tagName);
        Object.assign(c.attributes, this.attributes);
        c.classList.add(...this.classList.set);
        if(deep) {
            for(const k of this.childNodes) {
                c.appendChild(k.cloneNode(true));
            }
        }
        return c;
    }

    /*  Text  */
    get textContent() {
        return this.childNodes.map((n) => n.textContent).join("");
    }
    set textContent(v) {
        for(const c of [...this.childNodes]) {
            this.removeChild(c);
        }
        if(v !== null && v !== undefined && String(v) !== "") {
            this.appendChild(new FakeText(v));
        }
    }
    get innerText() {
        return this.textContent;
    }
    set innerText(v) {
        this.textContent = v;
    }
    get innerHTML() {
        return this.textContent;
    }
    set innerHTML(v) {
        this.textContent = String(v || "").replace(/<[^>]*>/g, "");
    }

    /*  Events  */
    addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    removeEventListener(type, fn) {
        const l = this.listeners[type] || [];
        const i = l.indexOf(fn);
        if(i >= 0) {
            l.splice(i, 1);
        }
    }
    dispatchEvent(ev) {
        ev.target = ev.target || this;
        for(const fn of [...(this.listeners[ev.type] || [])]) {
            fn.call(this, ev);
        }
        return true;
    }
    click() {
        this.dispatchEvent(fake_event("click"));
    }
    focus() {
    }
    blur() {
    }
    select() {
    }
    scrollIntoView() {
    }
    scrollTo() {
    }
    setPointerCapture() {
    }
    releasePointerCapture() {
    }
    getBoundingClientRect() {
        return {x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0};
    }
    get offsetWidth() {
        return 0;
    }
    get offsetHeight() {
        return 0;
    }
    get clientWidth() {
        return 0;
    }
    get clientHeight() {
        return 0;
    }
    get scrollWidth() {
        return 0;
    }
    get scrollHeight() {
        return 0;
    }

    /*  Selectors  */
    matches(selector) {
        return String(selector).split(",").some((one) => match_chain(this, parse_chain(one)));
    }
    closest(selector) {
        let n = this;
        while(n && n.nodeType === 1) {
            if(n.matches(selector)) {
                return n;
            }
            n = n.parentNode;
        }
        return null;
    }
    querySelectorAll(selector) {
        const out = [];
        const walk = (el) => {
            for(const c of el.children) {
                if(c.matches(selector)) {
                    out.push(c);
                }
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
    getElementsByClassName(name) {
        return this.querySelectorAll(`.${name}`);
    }
    getElementsByTagName(tag) {
        return this.querySelectorAll(tag);
    }
}

class FakeFragment extends FakeElement {
    constructor() {
        super("#fragment");
        this.nodeType = 11;
    }
}

/*  One compound simple selector: tag#id.a.b[x][y="v"]  */
function parse_compound(text)
{
    const c = {tag: null, id: null, classes: [], attrs: []};
    const re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)["']?([^"'\]]*)["']?)?\]|(\*)|(:[\w-]+(?:\([^)]*\))?)/g;
    let m;
    while((m = re.exec(text))) {
        if(m[1]) {
            c.tag = m[1].toUpperCase();
        } else if(m[2]) {
            c.id = m[2];
        } else if(m[3]) {
            c.classes.push(m[3]);
        } else if(m[4]) {
            c.attrs.push({name: m[4], op: m[5] || null, value: m[6]});
        }
    }
    return c;
}

function parse_chain(selector)
{
    return String(selector).replace(/:scope\s*>?/g, "").replace(/>/g, " ")
        .trim().split(/\s+/).filter(Boolean).map(parse_compound);
}

function match_compound(el, c)
{
    if(!el || el.nodeType !== 1) {
        return false;
    }
    if(c.tag && el.tagName !== c.tag) {
        return false;
    }
    if(c.id && el.getAttribute("id") !== c.id) {
        return false;
    }
    for(const k of c.classes) {
        if(!el.classList.contains(k)) {
            return false;
        }
    }
    for(const a of c.attrs) {
        const v = el.getAttribute(a.name);
        if(v === null) {
            return false;
        }
        if(a.op === "=" && v !== a.value) {
            return false;
        }
        if(a.op === "*=" && !v.includes(a.value)) {
            return false;
        }
        if(a.op === "^=" && !v.startsWith(a.value)) {
            return false;
        }
        if(a.op === "$=" && !v.endsWith(a.value)) {
            return false;
        }
        if(a.op === "~=" && !v.split(/\s+/).includes(a.value)) {
            return false;
        }
    }
    return true;
}

function match_chain(el, chain)
{
    if(!chain.length) {
        return false;
    }
    if(!match_compound(el, chain[chain.length - 1])) {
        return false;
    }
    let i = chain.length - 2;
    let n = el.parentNode;
    while(i >= 0 && n) {
        if(match_compound(n, chain[i])) {
            i--;
        }
        n = n.parentNode;
    }
    return i < 0;
}

function fake_event(type, init)
{
    return Object.assign({
        type: type,
        bubbles: true,
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
        },
        stopImmediatePropagation() {
        }
    }, init || {});
}

function fake_storage()
{
    const m = new Map();
    return {
        getItem: (k) => (m.has(k)? m.get(k) : null),
        setItem: (k, v) => {
            m.set(k, String(v));
        },
        removeItem: (k) => {
            m.delete(k);
        },
        clear: () => {
            m.clear();
        },
        key: (i) => [...m.keys()][i] || null,
        get length() {
            return m.size;
        }
    };
}

/************************************************************
 *  Put the double on globalThis: document, window and the node
 *  classes a module may test with `instanceof`. Idempotent.
 ************************************************************/
function install_dom_double()
{
    if(globalThis.__dom_double__) {
        return globalThis.__dom_double__;
    }
    const html = new FakeElement("html");
    const head = new FakeElement("head");
    const body = new FakeElement("body");
    html.appendChild(head);
    html.appendChild(body);

    const doc_listeners = new FakeElement("#document");
    const document = {
        nodeType: 9,
        documentElement: html,
        head: head,
        body: body,
        activeElement: body,
        createElement: (tag) => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag),
        createTextNode: (text) => new FakeText(text),
        createDocumentFragment: () => new FakeFragment(),
        createComment: () => new FakeText(""),
        getElementById: (id) => html.querySelector(`#${id}`),
        querySelector: (s) => html.querySelector(s),
        querySelectorAll: (s) => html.querySelectorAll(s),
        getElementsByClassName: (n) => html.getElementsByClassName(n),
        addEventListener: (t, f) => doc_listeners.addEventListener(t, f),
        removeEventListener: (t, f) => doc_listeners.removeEventListener(t, f),
        dispatchEvent: (e) => doc_listeners.dispatchEvent(e),
        hasFocus: () => false,
        visibilityState: "visible",
        hidden: false,
        cookie: ""
    };

    const win_listeners = new FakeElement("#window");
    const location = {
        href: "http://localhost/", hash: "", pathname: "/", search: "",
        origin: "http://localhost", host: "localhost", hostname: "localhost",
        protocol: "http:", port: "",
        assign() {
        },
        replace() {
        },
        reload() {
        }
    };
    const history = {
        length: 1,
        state: null,
        pushState(state, title, url) {
            this.state = state;
            if(typeof url === "string" && url.includes("#")) {
                location.hash = url.slice(url.indexOf("#"));
            }
        },
        replaceState(state, title, url) {
            this.pushState(state, title, url);
        },
        back() {
        },
        forward() {
        },
        go() {
        }
    };
    const window = {
        console: console,
        document: document,
        location: location,
        history: history,
        navigator: {language: "en", languages: ["en"], userAgent: "dom-double", maxTouchPoints: 0},
        innerWidth: 1280,
        innerHeight: 800,
        devicePixelRatio: 1,
        localStorage: fake_storage(),
        sessionStorage: fake_storage(),
        addEventListener: (t, f) => win_listeners.addEventListener(t, f),
        removeEventListener: (t, f) => win_listeners.removeEventListener(t, f),
        dispatchEvent: (e) => win_listeners.dispatchEvent(e),
        matchMedia: (q) => ({
            matches: false, media: q,
            addEventListener() {
            },
            removeEventListener() {
            },
            addListener() {
            },
            removeListener() {
            }
        }),
        getComputedStyle: () => make_style(),
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        setTimeout: (...a) => setTimeout(...a),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (...a) => setInterval(...a),
        clearInterval: (id) => clearInterval(id),
        scrollTo() {
        },
        open() {
            return null;
        },
        print() {
        }
    };
    window.window = window;
    window.self = window;

    const defs = {
        document: document,
        window: window,
        location: location,
        history: history,
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
        matchMedia: window.matchMedia,
        getComputedStyle: window.getComputedStyle,
        requestAnimationFrame: window.requestAnimationFrame,
        cancelAnimationFrame: window.cancelAnimationFrame,
        Node: FakeNode,
        Text: FakeText,
        Element: FakeElement,
        HTMLElement: FakeElement,
        HTMLInputElement: FakeElement,
        HTMLSelectElement: FakeElement,
        HTMLTextAreaElement: FakeElement,
        HTMLButtonElement: FakeElement,
        DocumentFragment: FakeFragment,
        SVGElement: class FakeSVGElement extends FakeElement {},
        Event: function(type, init) {
            return fake_event(type, init);
        },
        CustomEvent: function(type, init) {
            return fake_event(type, init);
        }
    };
    for(const [k, v] of Object.entries(defs)) {
        try {
            Object.defineProperty(globalThis, k, {value: v, writable: true, configurable: true});
        } catch(e) {
            globalThis[k] = v;
        }
    }
    if(!globalThis.navigator || !globalThis.navigator.language) {
        try {
            Object.defineProperty(globalThis, "navigator",
                {value: window.navigator, writable: true, configurable: true});
        } catch(e) {
            /*  node 21+ owns a read-only navigator: keep it  */
        }
    }
    globalThis.__dom_double__ = {document, window};
    return globalThis.__dom_double__;
}

export {install_dom_double, fake_event, FakeElement};
