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
 *      app are parsed (acorn), never run. The elements it reads:
 *
 *        - every createElement2 spec `["tag", attrs, ...]` whose attrs it
 *          can read (attrs_of()): an object written in place, its spreads
 *          read the same way; an `Object.assign()` of what it reads (an
 *          `extra || {}` is what a caller adds, and is skipped); a
 *          variable given one of those where it is declared -- in the
 *          function, in a function around it, or in the module -- plus
 *          its `v.name = ...` writes; a call of a function of the same
 *          module (declared, or a variable given a function) with ONE
 *          `return`, read the same way;
 *        - every tag of an html string: a template literal, a string
 *          literal, or a `+` chain of them (`'<input ' + '...>'` is read as
 *          one string);
 *        - every `document.createElement("<tag>")` held in a variable: what
 *          the function that declares the variable writes into it
 *          (`v.title`, `v.ariaLabel`, `v.type`, `v.dataset.i18nTitle`,
 *          `v.dataset.i18nAriaLabel`, `v.setAttribute("<name>", ...)`) is
 *          read as its attrs. A control created and never held is a fault.
 *
 *      In all three the tag is read when it is a string literal, a
 *      template with no `${}`, a `+` of those (`"but" + "ton"`), or a
 *      const of the file given one (`[TAG, attrs]`, `"<" + TAG + ">"`,
 *      `` `<${TAG}>` ``, `document.createElement(TAG)`), and read in
 *      lower case, as the DOM reads it (`["BUTTON", attrs]` is a
 *      button). A name means what it means where it is used: the
 *      nearest block that declares it (a `let`, a `const`), then the
 *      function (a `var`), then the functions around it, then the
 *      module -- so a const shadowed in a block is the one of that
 *      block, and a `v.title = ...` is read for the `v` it writes.
 *
 *      A control is an input (not `type="hidden"`), select, textarea or
 *      button, or an element whose role is button, switch, checkbox, tab
 *      or menuitem -- the type and the role read when they are literals.
 *
 *      What it refuses on a control: a missing `title` or `aria-label`. On
 *      any element: a name WRITTEN as text (literal_texts(): a string
 *      literal, a template with no `${}`, a `+` of those, any branch of
 *      `?:` / `||` / `??` that is one, a const of the file given one --
 *      untranslated, it never changes language); a name that is a `t()`
 *      call without its `data-i18n-*` key; and a `t(k1)` whose
 *      `data-i18n-*` names another key (`k2`) -- compared as written,
 *      literal or variable. In html, a name is text when it holds no
 *      `${}`, and a `${t(k)}` is held to its key the same way. A name
 *      that is data (a role id, a command, a connection; a template WITH
 *      `${}`) needs no key. A control whose name is painted with its
 *      state after it is built says so with a `named by <function>`
 *      comment inside its attrs.
 *
 *      What it CANNOT see, and is checked on the deployed page, switching
 *      language: what a widget draws for itself (Tabulator's header
 *      filters and row-selection boxes, Tom Select's box) and what gobj-ui
 *      builds; attrs reached through a parameter, a property
 *      (`opts.attrs`), an import, a helper with more than one `return`, a
 *      variable given its attrs by a later `v = {...}`, or a spread or an
 *      `Object.assign()` argument it cannot read (then the whole spec is
 *      skipped); a name written into an element by another function (a
 *      helper it is handed to), or into an element that no
 *      createElement() of the file made (a parameter, a query of the
 *      DOM); the key of a
 *      `t()` reached through a branch (`x ? t("a") : t("b")` is read as
 *      data); a name inside `${}` of an html string that is a branch
 *      (`title="${on ? "On" : "Off"}"`); an element that behaves as a
 *      control without the tag or the role of one (an `<a>` or a
 *      `<div>` with a click handler); an element whose TAG it cannot
 *      read -- a parameter, a `let` or a `var` (it may be given another
 *      value), a destructured const (`const {TAG} = ...`,
 *      `const [TAG] = ...`), a property, an import, a branch, a call, or
 *      a `+` with any of those in it (`[tag, {type: "button"}]`,
 *      `"<" + tag + ">"`, `document.createElement(t)` with `tag` / `t`
 *      one of those): the whole element is skipped, control or not; and
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

/*  The parent of each node of the file being scanned (scan_source())  */
let PARENT = new WeakMap();

/***************************************************************
 *  The functions around a node, the nearest first, and then the
 *  module
 ***************************************************************/
function scopes_of(node)
{
    let out = [];
    for(let p = PARENT.get(node); p; p = PARENT.get(p)) {
        if(FUNCTION_RE.test(p.type) || p.type === "Program") {
            out.push(p);
        }
    }
    return out;
}

/***************************************************************
 *  The names a declaration or a parameter binds
 ***************************************************************/
function pattern_names(p, out = [])
{
    if(!p) {
        return out;
    }
    switch(p.type) {
        case "Identifier":
            out.push(p.name);
            break;
        case "AssignmentPattern":
            pattern_names(p.left, out);
            break;
        case "RestElement":
            pattern_names(p.argument, out);
            break;
        case "ArrayPattern":
            for(let e of p.elements) {
                pattern_names(e, out);
            }
            break;
        case "ObjectPattern":
            for(let q of p.properties) {
                pattern_names(q.type === "RestElement" ? q : q.value, out);
            }
            break;
    }
    return out;
}

/***************************************************************
 *  Visit the nodes of a function (or of the module) that are its
 *  own: a function inside is visited, never entered
 ***************************************************************/
function own_walk(scope, visit)
{
    let go = (node) => {
        if(!node || typeof node.type !== "string") {
            return;
        }
        visit(node);
        if(node !== scope && FUNCTION_RE.test(node.type)) {
            return;
        }
        for(let k of Object.keys(node)) {
            let v = node[k];
            if(Array.isArray(v)) {
                for(let c of v) {
                    go(c);
                }
            } else if(v && typeof v.type === "string") {
                go(v);
            }
        }
    };
    go(scope.type === "Program" ? scope : scope.body);
}

const BLOCK_RE = /^(BlockStatement|StaticBlock|SwitchStatement|ForStatement|ForInStatement|ForOfStatement|CatchClause)$/;

/***************************************************************
 *  The node a declaration of `scope` binds its name in: the
 *  function (or the module) for a `var`, the nearest block for a
 *  `let`, a `const`, a class, a function declared in a block, an
 *  import or a catch parameter
 ***************************************************************/
function declaring_block(n, scope)
{
    let decl = (n.type === "VariableDeclarator") ? PARENT.get(n) : n;
    if(decl.type === "VariableDeclaration" && decl.kind === "var") {
        return scope;
    }
    if(n.type === "CatchClause") {
        return n;
    }
    for(let p = PARENT.get(decl); p && p !== scope; p = PARENT.get(p)) {
        if(BLOCK_RE.test(p.type)) {
            return p;
        }
    }
    return scope;
}

/***************************************************************
 *  What a name means where `node` is: the nearest block, then
 *  function, that declares it, then the module.
 *
 *      {kind: "var", decl, scope, is_const}  a variable (its declarator;
 *                                            `scope` is the block, or
 *                                            the function of a `var`)
 *      {kind: "function", fn}                a function of the module
 *      {kind: "param"} / {kind: "other"}     what cannot be read here
 *      null                                  not declared in the file
 ***************************************************************/
function binding(name, node)
{
    for(let s of scopes_of(node)) {
        /*  Every declaration of the name that is the function's own,
         *  by the block it binds in  */
        let by_block = new Map();
        own_walk(s, (n) => {
            let found = null;
            if(n.type === "VariableDeclarator" && pattern_names(n.id).includes(name)) {
                found = (n.id.type === "Identifier")
                    ? {kind: "var", decl: n, is_const: PARENT.get(n).kind === "const"}
                    : {kind: "other"};
            } else if(n.type === "FunctionDeclaration" && n !== s && n.id && n.id.name === name) {
                found = {kind: "function", fn: n};
            } else if(/^Import(Default|Namespace)?Specifier$/.test(n.type) && n.local.name === name) {
                found = {kind: "other"};
            } else if(n.type === "CatchClause" && pattern_names(n.param).includes(name)) {
                found = {kind: "other"};
            }
            if(found) {
                let block = declaring_block(n, s);
                if(found.kind === "var") {
                    found.scope = block;
                }
                if(!by_block.has(block)) {
                    by_block.set(block, found);
                }
            }
        });
        /*  The nearest block around `node` that declares it  */
        for(let p = node; p; p = PARENT.get(p)) {
            if(by_block.has(p)) {
                return by_block.get(p);
            }
            if(p === s) {
                break;
            }
        }
        if(s.type !== "Program") {
            if(s.params.some((p) => pattern_names(p).includes(name))) {
                return {kind: "param"};
            }
            if(s.type === "FunctionExpression" && s.id && s.id.name === name) {
                return {kind: "function", fn: s};
            }
        }
    }
    return null;
}

/***************************************************************
 *  Whether the name `id` is the variable `b` where `id` is (a
 *  block between them may declare another of the same name)
 ***************************************************************/
function is_binding(id, b)
{
    if(!b || b.kind !== "var") {
        return true;
    }
    let here = binding(id.name, id);
    return !!here && here.decl === b.decl;
}

/***************************************************************
 *  The function a name is bound to, or null
 ***************************************************************/
function function_of(b)
{
    if(!b) {
        return null;
    }
    if(b.kind === "function") {
        return b.fn;
    }
    if(b.kind === "var" && b.decl.init && FUNCTION_RE.test(b.decl.init.type)) {
        return b.decl.init;
    }
    return null;
}

/***************************************************************
 *  What a function returns: each `return` of its own, or the body
 *  of an arrow written as an expression
 ***************************************************************/
function returns_of(fn)
{
    if(fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement") {
        return [fn.body];
    }
    let out = [];
    own_walk(fn, (n) => {
        if(n.type === "ReturnStatement" && n.argument) {
            out.push(n.argument);
        }
    });
    return out;
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

function member_name(m)
{
    if(!m.computed && m.property.type === "Identifier") {
        return m.property.name;
    }
    if(m.computed && m.property.type === "Literal") {
        return String(m.property.value);
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

function as_prop(name, value)
{
    return {type: "Property", key: {type: "Literal", value: name}, value};
}

/***************************************************************
 *  What is written into a variable after it is declared
 *  (`v.name = ...`, `v["name"] = ...`), anywhere in the block --
 *  the function, the module -- that declares it, `b` its binding
 ***************************************************************/
function member_writes(b, name)
{
    let extra = [];
    walk(b.scope, (n) => {
        if(n.type === "AssignmentExpression" && n.left.type === "MemberExpression" &&
                n.left.object.type === "Identifier" && n.left.object.name === name &&
                is_binding(n.left.object, b)) {
            let key = member_name(n.left);
            if(key) {
                extra.push(as_prop(key, n.right));
            }
        }
    });
    return extra;
}

/***************************************************************
 *  The properties of the attrs of a spec, or null when they
 *  cannot be read here. Read:
 *
 *      - an object written in place, its spreads read the same way;
 *      - an Object.assign() of what is read the same way (an
 *        `extra || {}` is what a caller adds, and is skipped);
 *      - a variable -- of the function, of a function around it,
 *        or a const of the module -- given one of those where it
 *        is declared, plus the `v.name = ...` writes of it;
 *      - a call of a function of the module (declared, or a const
 *        given a function) with ONE return, read the same way.
 ***************************************************************/
function attrs_of(node, depth = 0)
{
    if(!node || depth > 8) {
        return null;
    }
    if(node.type === "ObjectExpression") {
        let props = [];
        for(let p of node.properties) {
            if(p.type === "SpreadElement") {
                let more = attrs_of(p.argument, depth + 1);
                if(!more) {
                    return null;
                }
                props.push(...more);
            } else {
                props.push(p);
            }
        }
        return props;
    }
    if(is_object_assign(node)) {
        let props = [];
        for(let a of node.arguments) {
            if(a.type === "LogicalExpression" && a.right.type === "ObjectExpression" &&
                    a.right.properties.length === 0) {
                continue;   /*  `extra || {}`: what a caller adds  */
            }
            let more = attrs_of(a, depth + 1);
            if(!more) {
                return null;
            }
            props.push(...more);
        }
        return props;
    }
    if(node.type === "Identifier") {
        let b = binding(node.name, node);
        if(!b || b.kind !== "var" || !b.decl.init) {
            return null;
        }
        let props = attrs_of(b.decl.init, depth + 1);
        if(!props) {
            return null;
        }
        return [...props, ...member_writes(b, node.name)];
    }
    if(node.type === "CallExpression" && node.callee.type === "Identifier") {
        let fn = function_of(binding(node.callee.name, node));
        if(!fn) {
            return null;
        }
        let returns = returns_of(fn);
        if(returns.length !== 1) {
            return null;
        }
        return attrs_of(returns[0], depth + 1);
    }
    return null;
}

/***************************************************************
 *  The texts a name is WRITTEN as, untranslated: a string
 *  literal, a template with no `${}`, a `+` of those, every branch
 *  of `?:` / `||` / `??` (the right one of `&&`), and a const
 *  given one of those. [] when no branch is such a text.
 ***************************************************************/
function literal_texts(v, depth = 0)
{
    if(!v || depth > 8) {
        return [];
    }
    let text = (s) => (typeof s === "string" && s.trim()) ? [s] : [];
    switch(v.type) {
        case "Literal":
            return text(v.value);
        case "TemplateLiteral":
            return (v.expressions.length === 0) ? text(v.quasis[0].value.cooked) : [];
        case "BinaryExpression": {
            if(v.operator !== "+") {
                return [];
            }
            let s = "";
            for(let leaf of plus_leaves(v)) {
                let piece = (leaf.type === "Literal" && typeof leaf.value === "string") ? leaf.value
                    : (leaf.type === "TemplateLiteral" && leaf.expressions.length === 0)
                        ? leaf.quasis[0].value.cooked : null;
                if(piece === null) {
                    return [];
                }
                s += piece;
            }
            return text(s);
        }
        case "ConditionalExpression":
            return [...literal_texts(v.consequent, depth + 1), ...literal_texts(v.alternate, depth + 1)];
        case "LogicalExpression":
            if(v.operator === "&&") {
                return literal_texts(v.right, depth + 1);
            }
            return [...literal_texts(v.left, depth + 1), ...literal_texts(v.right, depth + 1)];
        case "Identifier": {
            let b = binding(v.name, v);
            if(b && b.kind === "var" && b.is_const && b.decl.init) {
                return literal_texts(b.decl.init, depth + 1);
            }
            return [];
        }
        default:
            return [];
    }
}

/***************************************************************
 *  The text a tag is written as: a string literal, a template with
 *  no `${}`, a `+` of those, or a const of the file given one. null
 *  when it cannot be read here (a parameter, a `let` or a `var`, a
 *  destructured const, a property, an import, a branch, a call).
 ***************************************************************/
function tag_text(node, depth = 0)
{
    if(!node || depth > 8) {
        return null;
    }
    if(node.type === "Literal" && typeof node.value === "string") {
        return node.value;
    }
    if(node.type === "TemplateLiteral" && node.expressions.length === 0) {
        return node.quasis[0].value.cooked;
    }
    if(is_plus(node)) {
        let s = "";
        for(let leaf of plus_leaves(node)) {
            let piece = tag_text(leaf, depth + 1);
            if(piece === null) {
                return null;
            }
            s += piece;
        }
        return s;
    }
    if(node.type === "Identifier") {
        let b = binding(node.name, node);
        if(b && b.kind === "var" && b.is_const && b.decl.init) {
            return tag_text(b.decl.init, depth + 1);
        }
    }
    return null;
}

/***************************************************************
 *  What is wrong with the names of one element, [] if nothing.
 *  `control`: it must have both names; otherwise only a name it
 *  has is checked.
 ***************************************************************/
function name_faults(src, props, control)
{
    /*  Every value each attr is given: a spec gives one, an element
     *  written by hand may be given one per branch  */
    let by = {};
    for(let p of props) {
        let name = prop_name(p);
        if(name) {
            (by[name] = by[name] || []).push(p.value);
        }
    }
    let text = (n) => src.slice(n.start, n.end);
    let faults = [];
    for(let name of NAMES) {
        let values = by[name] || [];
        if(values.length === 0 && control) {
            faults.push(`no ${name}`);
        }
        for(let v of values) {
            let texts = literal_texts(v);
            if(texts.length > 0) {
                faults.push(`${name} is the literal "${texts[0]}": t() it, with its key`);
                continue;
            }
            if(!is_t_call(v)) {
                continue;   /*  data  */
            }
            let keys = by[`data-i18n-${name}`] || [];
            if(keys.length === 0) {
                faults.push(`${name} by t() without data-i18n-${name}`);
                continue;
            }
            let arg = v.arguments[0];
            if(arg && !keys.some((k) => text(k) === text(arg))) {
                faults.push(`${name} is t(${text(arg)}) and data-i18n-${name} is ` +
                    keys.map(text).join(" / "));
            }
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
    /*  A piece of code right after `<` (or `</`) is the tag: written
     *  as its text when tag_text() reads it, so the tag is read  */
    let tag_at = (expr) => {
        if(!/<\/?$/.test(text)) {
            return null;
        }
        let tag = tag_text(expr);
        return (tag !== null && /^[a-zA-Z][a-zA-Z0-9]*$/.test(tag)) ? tag : null;
    };
    for(let leaf of leaves) {
        pieces.push({at: text.length, line: leaf.loc.start.line});
        if(leaf.type === "Literal" && typeof leaf.value === "string") {
            text += leaf.value;
            any = true;
        } else if(leaf.type === "TemplateLiteral") {
            for(let i = 0; i < leaf.quasis.length; i++) {
                let q = leaf.quasis[i];
                text += src.slice(q.start, q.end);
                if(i < leaf.expressions.length) {
                    text += tag_at(leaf.expressions[i]) ?? src.slice(q.end, leaf.quasis[i + 1].start);
                }
            }
            any = true;
        } else {
            text += tag_at(leaf) ?? "${" + src.slice(leaf.start, leaf.end) + "}";
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

/*  What a property of an element written by hand is, as an attr  */
const ELEMENT_PROPS = {title: "title", ariaLabel: "aria-label", type: "type", role: "role"};
const DATASET_PROPS = {i18nTitle: "data-i18n-title", i18nAriaLabel: "data-i18n-aria-label"};

/***************************************************************
 *  What is written into an element held in `v`, as attrs:
 *  `v.title = ...`, `v.ariaLabel = ...`, `v.type = ...`,
 *  `v.dataset.i18nTitle = ...`, `v.setAttribute("<name>", ...)`,
 *  anywhere in the block that declares `v` (`b` its binding, if
 *  any), or in the function that creates the element
 ***************************************************************/
function element_writes(scope, v, b)
{
    let props = [];
    let is_v = (x) => x.type === "Identifier" && x.name === v && is_binding(x, b);
    walk(scope, (n) => {
        if(n.type === "AssignmentExpression" && n.left.type === "MemberExpression") {
            let m = n.left;
            let k = member_name(m);
            if(is_v(m.object) && Object.hasOwn(ELEMENT_PROPS, k)) {
                props.push(as_prop(ELEMENT_PROPS[k], n.right));
            } else if(m.object.type === "MemberExpression" && is_v(m.object.object) &&
                    member_name(m.object) === "dataset" && Object.hasOwn(DATASET_PROPS, k)) {
                props.push(as_prop(DATASET_PROPS[k], n.right));
            }
        }
        if(n.type === "CallExpression" && n.callee.type === "MemberExpression" &&
                is_v(n.callee.object) && member_name(n.callee) === "setAttribute" &&
                n.arguments.length >= 2 && n.arguments[0].type === "Literal") {
            props.push(as_prop(String(n.arguments[0].value), n.arguments[1]));
        }
    });
    return props;
}

/***************************************************************
 *  A `document.createElement("<tag>")`: what the function that
 *  holds it writes into it is read as its attrs, and held to the
 *  rule of a spec. A control created and never held is never
 *  named.
 ***************************************************************/
function created_element_faults(src, n)
{
    let callee = n.callee;
    if(callee.type !== "MemberExpression" || member_name(callee) !== "createElement") {
        return [];
    }
    let tag = tag_text(n.arguments[0]);
    if(tag === null) {
        return [];
    }
    tag = tag.toLowerCase();
    let parent = PARENT.get(n);
    let v = null;
    if(parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
        v = parent.id.name;
    } else if(parent.type === "AssignmentExpression" && parent.left.type === "Identifier") {
        v = parent.left.name;
    }
    if(!v) {
        return CONTROLS.includes(tag) ? ["created and never held, so never named"] : [];
    }
    let b = binding(v, n);
    let scope = (b && b.kind === "var") ? b.scope : scopes_of(n)[0];
    let props = element_writes(scope, v, b);
    let value_of = (name) => {
        let p = props.find((x) => prop_name(x) === name);
        return (p && p.value.type === "Literal") ? p.value.value : null;
    };
    if(tag === "input" && value_of("type") === "hidden") {
        return [];
    }
    let control = CONTROLS.includes(tag) || CONTROL_ROLES.includes(value_of("role"));
    return name_faults(src, props, control);
}

function scan_source(file, src)
{
    let comments = [];
    let ast = acorn.parse(src, {
        ecmaVersion: "latest", sourceType: "module", locations: true, onComment: comments
    });
    PARENT = new WeakMap();
    walk(ast, (n, up) => {
        PARENT.set(n, up[up.length - 1] || null);
    });
    let found = [];
    walk(ast, (n, up) => {
        let parent = up[up.length - 1];

        if(n.type === "ArrayExpression" && n.elements.length >= 2) {
            let [tag_node, attrs] = n.elements;
            let tag = tag_text(tag_node);
            if(tag === null) {
                return;
            }
            tag = tag.toLowerCase();    /*  as document.createElement() reads it  */
            if(!/^[a-z][a-z0-9]*$/.test(tag)) {
                return;
            }
            let props = attrs_of(attrs);
            if(!props) {
                return;
            }
            let value_of = (name) => {
                let p = props.find((x) => prop_name(x) === name);
                return (p && p.value.type === "Literal") ? p.value.value : null;
            };
            if(tag === "input" && value_of("type") === "hidden") {
                return;
            }
            let control = CONTROLS.includes(tag) || CONTROL_ROLES.includes(value_of("role"));
            let named_later = attrs.type === "ObjectExpression" && comments.some((c) =>
                c.start >= attrs.start && c.end <= attrs.end && /named by \w+/.test(c.value));
            if(control && named_later) {
                return;
            }
            for(let fault of name_faults(src, props, control)) {
                found.push(`${file}:${n.loc.start.line} <${tag}> ${fault}`);
            }
            return;
        }

        if(n.type === "CallExpression") {
            for(let fault of created_element_faults(src, n)) {
                let a = n.arguments[0];
            found.push(`${file}:${n.loc.start.line} createElement(${src.slice(a.start, a.end)}) ${fault}`);
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
 *  The scan itself, on the shapes a review got past it: each one
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
            '$b.title = t("k"); $b.setAttribute("aria-label", t("k"));\n' +
            '$b.dataset.i18nTitle = "k"; $b.setAttribute("data-i18n-aria-label", "k"); return $b; }'))
            .toEqual([]);
        expect(faults('function f() { let $h = document.createElement("input"); ' +
            '$h.type = "hidden"; return $h; }')).toEqual([]);
    });

    /*
     *  The shapes the scan of 1.1.9 / 1.0.7 got past
     */
    test("a name written as a template with no ${}, a branch or a const", () => {
        expect(faults('let a = ["button", {title: `Refresh`, "aria-label": t("k"), ' +
            '"data-i18n-aria-label": "k"}];'))
            .toEqual(['x.js:1 <button> title is the literal "Refresh": t() it, with its key']);
        expect(faults('let a = ["button", {title: on ? "On" : t("off"), "data-i18n-title": "off", ' +
            '"aria-label": "Re" + `fresh`}];'))
            .toEqual(['x.js:1 <button> title is the literal "On": t() it, with its key',
                      'x.js:1 <button> aria-label is the literal "Refresh": t() it, with its key']);
        expect(faults('const SAVE = "Save";\nfunction f() { return ["button", {title: SAVE, ' +
            '"aria-label": name}]; }'))
            .toEqual(['x.js:2 <button> title is the literal "Save": t() it, with its key']);
        expect(faults('let a = ["button", {title: `${host}:${port}`, "aria-label": host}];'))
            .toEqual([]);
    });

    test("document.createElement() of a control named with literals, or without its key", () => {
        expect(faults('function f() { let $b = document.createElement("button");\n' +
            '$b.title = "Save"; $b.setAttribute("aria-label", `Save`); return $b; }'))
            .toEqual(['x.js:1 createElement("button") title is the literal "Save": t() it, with its key',
                      'x.js:1 createElement("button") aria-label is the literal "Save": t() it, with its key']);
        expect(faults('function f() { let $b = document.createElement("input");\n' +
            '$b.title = t("k"); $b.ariaLabel = t("k"); $b.dataset.i18nTitle = "j"; return $b; }'))
            .toEqual(['x.js:1 createElement("input") title is t("k") and data-i18n-title is "j"',
                      'x.js:1 createElement("input") aria-label by t() without data-i18n-aria-label']);
        expect(faults('function f() { let $d = document.createElement("div");\n' +
            '$d.setAttribute("role", "button"); return $d; }'))
            .toEqual(['x.js:1 createElement("div") no title', 'x.js:1 createElement("div") no aria-label']);
        expect(faults('function f() { document.body.append(document.createElement("select")); }'))
            .toEqual(['x.js:1 createElement("select") created and never held, so never named']);
    });

    test("attrs in a const of the module, of an outer function, or returned by a helper", () => {
        expect(faults('const ATTRS = {type: "button", title: t("k"), "data-i18n-title": "k"};\n' +
            'function f() { return ["button", ATTRS]; }'))
            .toEqual(["x.js:2 <button> no aria-label"]);
        expect(faults('function f() { let attrs = {type: "button"};\n' +
            'return () => ["button", attrs]; }'))
            .toEqual(["x.js:2 <button> no title", "x.js:2 <button> no aria-label"]);
        expect(faults('function named(key) {\n' +
            '    return {title: t(key), "data-i18n-title": key, "aria-label": t(key), ' +
            '"data-i18n-aria-label": key};\n}\n' +
            'let a = ["button", named("save")];\n' +
            'let b = ["input", {...named("find"), type: "text"}];\n' +
            'let c = ["button", Object.assign({class: "x"}, named("k"))];')).toEqual([]);
        expect(faults('const half = (key) => ({title: t(key), "data-i18n-title": key});\n' +
            'let a = ["button", {...half("save"), class: "x"}];\n' +
            'let b = ["button", Object.assign(half("k"), {"aria-label": "Lit"})];'))
            .toEqual(["x.js:2 <button> no aria-label",
                      'x.js:3 <button> aria-label is the literal "Lit": t() it, with its key']);
    });

    /*
     *  A tag held in a const passed unnamed
     */
    test("a tag held in a const: in a spec, in html, in createElement()", () => {
        expect(faults('const TAG = "button";\nlet a = [TAG, {class: "x", type: "button"}];'))
            .toEqual(["x.js:2 <button> no title", "x.js:2 <button> no aria-label"]);
        expect(faults('const TAG = "input";\nlet h = "<" + TAG + \' type="text">\';'))
            .toEqual(["x.js:2 <input> no title", "x.js:2 <input> no aria-label"]);
        expect(faults('const TAG = `select`;\nlet h = `<${TAG} class="x">`;'))
            .toEqual(["x.js:2 <select> no title", "x.js:2 <select> no aria-label"]);
        expect(faults('const TAG = "button";\n' +
            'function f() { let $b = document.createElement(TAG); return $b; }'))
            .toEqual(["x.js:2 createElement(TAG) no title", "x.js:2 createElement(TAG) no aria-label"]);
        expect(faults('const TAG = "button";\nlet a = [TAG, {title: t("k"), "data-i18n-title": "k", ' +
            '"aria-label": t("k"), "data-i18n-aria-label": "k"}];')).toEqual([]);
    });

    test("a tag it cannot read is not read (listed in the header)", () => {
        expect(faults('function f(tag) { let $e = document.createElement(tag);\n' +
            'return ["<" + tag + ">", [tag, {type: "button"}], $e]; }')).toEqual([]);
        expect(faults('let tag = "button";\nlet a = [tag, {type: "button"}];')).toEqual([]);
        expect(faults('const TAG = make();\nlet a = [TAG, {type: "button"}];')).toEqual([]);
    });

    /*
     *  An upper-case tag, a tag of pieces, a const shadowed
     *  in a block
     */
    test("an upper-case tag in a spec, as the DOM reads it", () => {
        expect(faults('let a = ["BUTTON", {class: "x"}];'))
            .toEqual(["x.js:1 <button> no title", "x.js:1 <button> no aria-label"]);
        expect(faults('const TAG = "Input";\nlet a = [TAG, {type: "text"}];'))
            .toEqual(["x.js:2 <input> no title", "x.js:2 <input> no aria-label"]);
    });

    test("a tag written as a + of texts, in place or in a const", () => {
        expect(faults('let a = ["but" + "ton", {class: "x"}];'))
            .toEqual(["x.js:1 <button> no title", "x.js:1 <button> no aria-label"]);
        expect(faults('const TAG = "but" + `ton`;\nlet a = [TAG, {class: "x"}];'))
            .toEqual(["x.js:2 <button> no title", "x.js:2 <button> no aria-label"]);
        expect(faults('const TAG = "sel" + "ect";\nlet h = "<" + TAG + \' class="x">\';'))
            .toEqual(["x.js:2 <select> no title", "x.js:2 <select> no aria-label"]);
        expect(faults('const TAG = "in" + "put";\n' +
            'function f() { let $i = document.createElement(TAG); return $i; }'))
            .toEqual(["x.js:2 createElement(TAG) no title", "x.js:2 createElement(TAG) no aria-label"]);
    });

    test("a const shadowed in a block is the one of the block", () => {
        expect(faults('function f(x) {\n' +
            '    const TAG = "div";\n' +
            '    if(x) {\n' +
            '        const TAG = "button";\n' +
            '        return [TAG, {class: "x"}];\n' +
            '    }\n' +
            '    return [TAG, {title: name}];\n' +
            '}'))
            .toEqual(["x.js:5 <button> no title", "x.js:5 <button> no aria-label"]);
        expect(faults('function f(x) {\n' +
            '    if(x) {\n' +
            '        const TAG = "button";\n' +
            '    }\n' +
            '    const TAG = "span";\n' +
            '    return [TAG, {class: "x"}];\n' +
            '}')).toEqual([]);
        expect(faults('const SAVE = "Save";\n' +
            'function f() { { const SAVE = t("save"); return ["button", {title: SAVE, ' +
            '"data-i18n-title": "save", "aria-label": name}]; } }')).toEqual([]);
        expect(faults('function f() {\n' +
            '    let attrs = {type: "button"};\n' +
            '    { let attrs = {}; attrs.title = "Lit"; }\n' +
            '    return ["button", attrs];\n' +
            '}')).toEqual(["x.js:4 <button> no title", "x.js:4 <button> no aria-label"]);
    });

    test("a var or a destructured const holding the tag is not read (listed in the header)", () => {
        expect(faults('var tag = "button";\nlet a = [tag, {type: "button"}];')).toEqual([]);
        expect(faults('const {TAG} = {TAG: "button"};\nlet a = [TAG, {type: "button"}];')).toEqual([]);
        expect(faults('const [TAG] = ["button"];\nlet a = [TAG, {type: "button"}];')).toEqual([]);
    });
});
