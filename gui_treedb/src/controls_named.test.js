/***********************************************************************
 *          controls_named.test.js
 *
 *      A control without a name is a bug (yunetas CLAUDE.md, gobj-ui
 *      README "Conventions"): every input, select, textarea and button
 *      this app builds -- and anything with the role of one -- carries a
 *      `title` AND an `aria-label`, and a name given with `t()` carries
 *      its key (`data-i18n-title`, `data-i18n-aria-label`), or it stays in
 *      the language it was built in.
 *
 *      This is a check of the SOURCE, not of the DOM: the modules of the
 *      app are parsed (acorn), never run. What it reads:
 *
 *        - every createElement2 spec `["tag", attrs, ...]` whose attrs are
 *          an object written in place, an `Object.assign()` of objects
 *          written in place, or a variable of the same function given one
 *          of those (`let attrs = {...}; ["button", attrs]`);
 *        - every tag of an html string: a template literal, a string
 *          literal, or a `+` chain of them (`'<input ' + '...>'` is read as
 *          one string);
 *        - every `document.createElement("input"|"select"|"textarea"|
 *          "button")` held in a variable: the function that creates it must
 *          give that variable a `title` and an `aria-label`.
 *
 *      What it refuses on a control: a missing `title` or `aria-label`. On
 *      any element: a name that is a string LITERAL (untranslated: it never
 *      changes language), a `t()` name without its `data-i18n-*` key, and a
 *      `t(k1)` whose `data-i18n-*` names another key (`k2`) -- compared as
 *      written, literal or variable. A name that is data (a role id, a
 *      command, a connection) is a variable and needs no key. A control
 *      whose name is painted with its state after it is built says so with
 *      a `named by <function>` comment inside its attrs.
 *
 *      What it CANNOT see, and is checked on the deployed page, switching
 *      language: what a widget draws for itself (Tabulator's header
 *      filters and row-selection boxes, Tom Select's box) and what gobj-ui
 *      builds; a name written later than its element, by a setAttribute()
 *      in another function; attrs reached through a parameter, a property
 *      or a spread; an element that behaves as a control without the tag or
 *      the role of one (an `<a>` or a `<div>` with a click handler); and
 *      whether the translated text says the right thing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import * as acorn from "acorn";

const SRC = new URL("./", import.meta.url);
const CONTROLS = ["input", "select", "textarea", "button"];
const CONTROL_ROLES = ["button", "switch", "checkbox", "tab", "menuitem"];
const NAMES = ["title", "aria-label"];

function sources()
{
    return readdirSync(SRC)
        .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
        .sort();
}

/***************************************************************
 *  Visit every node with the chain of its ancestors (nearest last)
 ***************************************************************/
function walk(node, visit, up = [])
{
    if(!node || typeof node.type !== "string") {
        return;
    }
    visit(node, up);
    up.push(node);
    for(let k of Object.keys(node)) {
        let v = node[k];
        if(Array.isArray(v)) {
            for(let c of v) {
                walk(c, visit, up);
            }
        } else if(v && typeof v.type === "string") {
            walk(v, visit, up);
        }
    }
    up.pop();
}

const FUNCTION_RE = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

function enclosing_function(up)
{
    for(let i = up.length - 1; i >= 0; i--) {
        if(FUNCTION_RE.test(up[i].type)) {
            return up[i];
        }
    }
    return up[0];   /*  the module  */
}

function prop_name(p)
{
    if(p.type !== "Property") {
        return null;
    }
    if(p.key.type === "Identifier") {
        return p.key.name;
    }
    if(p.key.type === "Literal") {
        return String(p.key.value);
    }
    return null;
}

function is_t_call(node)
{
    return node && node.type === "CallExpression" &&
        node.callee.type === "Identifier" && node.callee.name === "t";
}

function is_object_assign(node)
{
    return node && node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" && node.callee.object.name === "Object" &&
        node.callee.property.type === "Identifier" && node.callee.property.name === "assign";
}

/***************************************************************
 *  The properties of attrs written in place: an object, or an
 *  Object.assign() of objects. null when they cannot be read here.
 ***************************************************************/
function written_props(node)
{
    if(node && node.type === "ObjectExpression") {
        return node.properties;
    }
    if(is_object_assign(node)) {
        let props = [];
        for(let a of node.arguments) {
            if(a.type === "ObjectExpression") {
                props.push(...a.properties);
            } else if(a.type === "LogicalExpression" && a.right.type === "ObjectExpression" &&
                    a.right.properties.length === 0) {
                continue;   /*  `extra || {}`: what a caller adds  */
            } else {
                return null;
            }
        }
        return props;
    }
    return null;
}

/***************************************************************
 *  The properties of the attrs of a spec: written in place, or in
 *  a variable of the same function given them where it is
 *  declared (plus `v.name = ...` writes of it in that function).
 ***************************************************************/
function attrs_props(attrs, up)
{
    let props = written_props(attrs);
    if(props) {
        return props;
    }
    if(!attrs || attrs.type !== "Identifier") {
        return null;
    }
    let fn = enclosing_function(up);
    let found = null;
    let extra = [];
    walk(fn, (n) => {
        if(n.type === "VariableDeclarator" && n.id.type === "Identifier" &&
                n.id.name === attrs.name && n.init) {
            found = written_props(n.init);
        }
        if(n.type === "AssignmentExpression" && n.left.type === "MemberExpression" &&
                n.left.object.type === "Identifier" && n.left.object.name === attrs.name) {
            let key = n.left.computed
                ? (n.left.property.type === "Literal" ? String(n.left.property.value) : null)
                : n.left.property.name;
            if(key) {
                extra.push({type: "Property", key: {type: "Literal", value: key}, value: n.right});
            }
        }
    });
    return found ? [...found, ...extra] : null;
}

/***************************************************************
 *  What is wrong with the names of one element, [] if nothing.
 *  `control`: it must have both names; otherwise only a name it
 *  has is checked.
 ***************************************************************/
function name_faults(src, props, control)
{
    let by = {};
    for(let p of props) {
        let name = prop_name(p);
        if(name) {
            by[name] = p.value;
        }
    }
    let faults = [];
    for(let name of NAMES) {
        let v = by[name];
        if(!v) {
            if(control) {
                faults.push(`no ${name}`);
            }
            continue;
        }
        if(v.type === "Literal" && typeof v.value === "string" && v.value.trim()) {
            faults.push(`${name} is the literal "${v.value}": t() it, with its key`);
            continue;
        }
        if(!is_t_call(v)) {
            continue;   /*  data  */
        }
        let key = by[`data-i18n-${name}`];
        if(!key) {
            faults.push(`${name} by t() without data-i18n-${name}`);
            continue;
        }
        let arg = v.arguments[0];
        if(arg && src.slice(arg.start, arg.end) !== src.slice(key.start, key.end)) {
            faults.push(`${name} is t(${src.slice(arg.start, arg.end)}) and data-i18n-${name} is ` +
                src.slice(key.start, key.end));
        }
    }
    return faults;
}

/***************************************************************
 *  The faults of the tags of one html string (`${...}` kept as
 *  written, so a t() inside it can be read)
 ***************************************************************/
function html_faults(raw)
{
    /*  Each `${...}` is one opaque token while the tags are read (its
     *  quotes and `>` are code, not markup), and comes back in a value  */
    let held = [];
    let html = "";
    for(let i = 0; i < raw.length; i++) {
        if(raw[i] === "$" && raw[i + 1] === "{") {
            let depth = 0;
            let j = i + 1;
            for(; j < raw.length; j++) {
                if(raw[j] === "{") {
                    depth++;
                } else if(raw[j] === "}") {
                    depth--;
                    if(depth === 0) {
                        break;
                    }
                }
            }
            held.push(raw.slice(i, j + 1));
            html += `\u0001${held.length - 1}\u0002`.padEnd(j + 1 - i, "\u0003");
            i = j;
        } else {
            html += raw[i];
        }
    }
    let restore = (s) => s.replace(/\u0001(\d+)\u0002\u0003*/g, (m0, n) => held[Number(n)]);

    let found = [];
    let re = /<([a-zA-Z]+)\b((?:[^>"]|"[^"]*")*)>/g;
    let m;
    while((m = re.exec(html)) !== null) {
        let tag = m[1];
        let attrs = m[2];
        tag = tag.toLowerCase();
        if(/\btype="hidden"/.test(attrs)) {
            continue;
        }
        let role = attrs.match(/(^|\s)role="([^"]*)"/);
        let control = CONTROLS.includes(tag) || !!(role && CONTROL_ROLES.includes(role[2]));
        let faults = [];
        for(let name of NAMES) {
            let v = attrs.match(new RegExp(`(^|\\s)${name}="([^"]*)"`));
            if(!v) {
                if(control) {
                    faults.push(`no ${name}`);
                }
                continue;
            }
            let value = restore(v[2]);
            if(value.trim() && !value.includes("${")) {
                faults.push(`${name} is the literal "${value}": t() it, with its key`);
                continue;
            }
            let tk = value.match(/^\$\{t\(\s*("[^"]*"|'[^']*'|[\w.$]+)\s*(,[^)]*)?\)\}$/);
            if(!tk) {
                continue;   /*  data, or a translation escaped into markup  */
            }
            let k = attrs.match(new RegExp(`(^|\\s)data-i18n-${name}="([^"]*)"`));
            if(!k) {
                faults.push(`${name} by t() without data-i18n-${name}`);
                continue;
            }
            let lit = tk[1].trim().match(/^["'](.*)["']$/);
            let key = lit ? lit[1] : `\${${tk[1].trim()}}`;
            if(key !== restore(k[2])) {
                faults.push(`${name} is t(${tk[1].trim()}) and data-i18n-${name} is "${restore(k[2])}"`);
            }
        }
        for(let fault of faults) {
            found.push({at: m.index, tag, fault});
        }
    }
    return found;
}

function is_plus(n)
{
    return n && n.type === "BinaryExpression" && n.operator === "+";
}

/***************************************************************
 *  The leaves of a `+` chain, in order
 ***************************************************************/
function plus_leaves(n, out = [])
{
    if(is_plus(n)) {
        plus_leaves(n.left, out);
        plus_leaves(n.right, out);
    } else {
        out.push(n);
    }
    return out;
}

/***************************************************************
 *  A string expression as one html text, with the line where
 *  each piece of it starts. null if it holds no string.
 ***************************************************************/
function html_of(src, node)
{
    let leaves = is_plus(node) ? plus_leaves(node) : [node];
    let text = "";
    let pieces = [];
    let any = false;
    for(let leaf of leaves) {
        pieces.push({at: text.length, line: leaf.loc.start.line});
        if(leaf.type === "Literal" && typeof leaf.value === "string") {
            text += leaf.value;
            any = true;
        } else if(leaf.type === "TemplateLiteral") {
            text += src.slice(leaf.start + 1, leaf.end - 1);
            any = true;
        } else {
            text += "${" + src.slice(leaf.start, leaf.end) + "}";
        }
    }
    if(!any) {
        return null;
    }
    let line_at = (offset) => {
        let piece = pieces[0];
        for(let p of pieces) {
            if(p.at <= offset) {
                piece = p;
            }
        }
        return piece.line + text.slice(piece.at, offset).split("\n").length - 1;
    };
    return {text, line_at};
}

/***************************************************************
 *  A `document.createElement(<control>)` held in a variable: the
 *  function that creates it names it.
 ***************************************************************/
function created_control_faults(src, n, up)
{
    let callee = n.callee;
    if(callee.type !== "MemberExpression" || callee.property.name !== "createElement" ||
            !n.arguments[0] || n.arguments[0].type !== "Literal" ||
            !CONTROLS.includes(String(n.arguments[0].value).toLowerCase())) {
        return [];
    }
    let parent = up[up.length - 1];
    let v = null;
    if(parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
        v = parent.id.name;
    } else if(parent.type === "AssignmentExpression" && parent.left.type === "Identifier") {
        v = parent.left.name;
    }
    if(!v) {
        return ["created and never held, so never named"];
    }
    let body = src.slice(enclosing_function(up).start, enclosing_function(up).end);
    let esc = v.replace(/\$/g, "\\$");
    if(new RegExp(`${esc}\\.type\\s*=\\s*["']hidden["']`).test(body)) {
        return [];
    }
    let faults = [];
    if(!new RegExp(`${esc}\\.(title\\s*=|setAttribute\\(\\s*["']title["'])`).test(body)) {
        faults.push("no title");
    }
    if(!new RegExp(`${esc}\\.(ariaLabel\\s*=|setAttribute\\(\\s*["']aria-label["'])`).test(body)) {
        faults.push("no aria-label");
    }
    return faults;
}

function scan_source(file, src)
{
    let comments = [];
    let ast = acorn.parse(src, {
        ecmaVersion: "latest", sourceType: "module", locations: true, onComment: comments
    });
    let found = [];
    walk(ast, (n, up) => {
        let parent = up[up.length - 1];

        if(n.type === "ArrayExpression" && n.elements.length >= 2) {
            let [tag, attrs] = n.elements;
            if(!tag || tag.type !== "Literal" || typeof tag.value !== "string" ||
                    !/^[a-z][a-z0-9]*$/.test(tag.value)) {
                return;
            }
            let props = attrs_props(attrs, up);
            if(!props) {
                return;
            }
            let type = props.find((p) => prop_name(p) === "type");
            if(tag.value === "input" && type && type.value.value === "hidden") {
                return;
            }
            let role = props.find((p) => prop_name(p) === "role");
            let control = CONTROLS.includes(tag.value) ||
                !!(role && CONTROL_ROLES.includes(role.value.value));
            let named_later = attrs.type !== "Identifier" && comments.some((c) =>
                c.start >= attrs.start && c.end <= attrs.end && /named by \w+/.test(c.value));
            if(control && named_later) {
                return;
            }
            for(let fault of name_faults(src, props, control)) {
                found.push(`${file}:${n.loc.start.line} <${tag.value}> ${fault}`);
            }
            return;
        }

        if(n.type === "CallExpression") {
            for(let fault of created_control_faults(src, n, up)) {
                found.push(`${file}:${n.loc.start.line} createElement(${n.arguments[0].raw}) ${fault}`);
            }
            return;
        }

        /*  A string: alone, or the top of a `+` chain (its pieces are
         *  read with it, never alone)  */
        let is_string = n.type === "TemplateLiteral" ||
            (n.type === "Literal" && typeof n.value === "string");
        if(!is_string && !is_plus(n)) {
            return;
        }
        if(is_plus(parent)) {
            return;
        }
        if(parent && parent.type === "Property" && parent.key === n) {
            return;
        }
        if(parent && (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration" ||
                parent.type === "ExportAllDeclaration")) {
            return;
        }
        let html = html_of(src, n);
        if(!html || !html.text.includes("<")) {
            return;
        }
        for(let f of html_faults(html.text)) {
            found.push(`${file}:${html.line_at(f.at)} <${f.tag}> ${f.fault}`);
        }
    });
    return found;
}

function scan(file)
{
    return scan_source(file, readFileSync(new URL(file, SRC), "utf8"));
}

describe("every control is named, in a language that can change", () => {
    test("the scan reads the sources of the app", () => {
        expect(sources().length).toBeGreaterThan(10);
    });

    test("title + aria-label on every control; a t() name with its key", () => {
        let found = [];
        for(let f of sources()) {
            found.push(...scan(f));
        }
        expect(found).toEqual([]);
    });
});

/*
 *  The scan itself, on the shapes REV-CLOUD V46.3 got past it: each one
 *  must be found.
 */
describe("the scan finds what it says it finds", () => {
    let faults = (code) => scan_source("x.js", code);

    test("an <input> written in two string pieces", () => {
        let f = faults(
            'function f() { return `<input type="checkbox" class="X"${c} ` +\n' +
            '    `aria-label="${esc(t("k"))}">`; }');
        expect(f).toEqual(["x.js:1 <input> no title"]);
    });

    test("a literal name, in a spec and in html", () => {
        expect(faults('let a = ["button", {title: "Save", "aria-label": t("save"), ' +
            '"data-i18n-aria-label": "save"}];'))
            .toEqual(['x.js:1 <button> title is the literal "Save": t() it, with its key']);
        expect(faults('let h = `<span title="Hi"></span>`;'))
            .toEqual(['x.js:1 <span> title is the literal "Hi": t() it, with its key']);
    });

    test("t(k1) with data-i18n-*: k2, literal or variable", () => {
        expect(faults('let a = ["button", {title: t("a"), "data-i18n-title": "b", ' +
            '"aria-label": t(k), "data-i18n-aria-label": j}];'))
            .toEqual([
                'x.js:1 <button> title is t("a") and data-i18n-title is "b"',
                "x.js:1 <button> aria-label is t(k) and data-i18n-aria-label is j"
            ]);
        expect(faults('let h = `<button title="${t("a")}" data-i18n-title="b" ' +
            'aria-label="${t("a")}" data-i18n-aria-label="a">`;'))
            .toEqual(['x.js:1 <button> title is t("a") and data-i18n-title is "b"']);
    });

    test("attrs in a variable, or by Object.assign()", () => {
        expect(faults('function f() { let attrs = {type: "button"}; return ["button", attrs]; }'))
            .toEqual(["x.js:1 <button> no title", "x.js:1 <button> no aria-label"]);
        expect(faults('function f(x) { let attrs = {title: t("k"), "data-i18n-title": "k"};\n' +
            'attrs["aria-label"] = t("k"); attrs["data-i18n-aria-label"] = "k";\n' +
            'return ["button", attrs]; }')).toEqual([]);
        expect(faults('let a = ["input", Object.assign({type: "text"}, extra || {})];'))
            .toEqual(["x.js:1 <input> no title", "x.js:1 <input> no aria-label"]);
    });

    test("document.createElement() of a control", () => {
        expect(faults('function f() { let $b = document.createElement("button"); return $b; }'))
            .toEqual(['x.js:1 createElement("button") no title',
                      'x.js:1 createElement("button") no aria-label']);
        expect(faults('function f() { let $b = document.createElement("input");\n' +
            '$b.title = t("k"); $b.setAttribute("aria-label", t("k")); return $b; }')).toEqual([]);
        expect(faults('function f() { let $h = document.createElement("input"); ' +
            '$h.type = "hidden"; return $h; }')).toEqual([]);
    });
});
