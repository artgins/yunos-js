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
 *      Read from the SOURCE, never run: every `["tag", {attrs}, ...]` of
 *      createElement2 whose attrs are written in place, and every tag in
 *      the html of a template literal. A name that is DATA (a role id, a
 *      command) needs no key. A control named after it is built (a
 *      function that paints its name with its state) says so with a
 *      `named by <function>` comment inside its attrs.
 *
 *      What this cannot see -- a name set with setAttribute, and what a
 *      widget draws for itself -- is read on the deployed page (see the
 *      README of the app).
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

function walk(node, visit)
{
    if(!node || typeof node.type !== "string") {
        return;
    }
    visit(node);
    for(let k of Object.keys(node)) {
        let v = node[k];
        if(Array.isArray(v)) {
            for(let c of v) {
                walk(c, visit);
            }
        } else if(v && typeof v.type === "string") {
            walk(v, visit);
        }
    }
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

/***************************************************************
 *  What is wrong with the names of one element, [] if nothing.
 *  `control`: it must have both names; otherwise only a name it
 *  has is checked for its key.
 ***************************************************************/
function name_faults(attrs, control)
{
    let props = {};
    for(let p of attrs.properties) {
        let name = prop_name(p);
        if(name) {
            props[name] = p.value;
        }
    }
    let faults = [];
    for(let name of NAMES) {
        let v = props[name];
        if(!v) {
            if(control) {
                faults.push(`no ${name}`);
            }
            continue;
        }
        if(!is_t_call(v)) {
            continue;   /*  data, or a key no literal can say  */
        }
        let key = props[`data-i18n-${name}`];
        if(!key) {
            faults.push(`${name} by t() without data-i18n-${name}`);
            continue;
        }
        let arg = v.arguments[0];
        if(arg && arg.type === "Literal" && key.type === "Literal" && arg.value !== key.value) {
            faults.push(`${name} is t("${arg.value}") and data-i18n-${name} is "${key.value}"`);
        }
    }
    return faults;
}

function scan(file)
{
    let src = readFileSync(new URL(file, SRC), "utf8");
    let comments = [];
    let ast = acorn.parse(src, {
        ecmaVersion: "latest", sourceType: "module", locations: true, onComment: comments
    });
    let found = [];
    walk(ast, (n) => {
        if(n.type === "ArrayExpression" && n.elements.length >= 2) {
            let [tag, attrs] = n.elements;
            if(!tag || tag.type !== "Literal" || typeof tag.value !== "string" ||
                    !attrs || attrs.type !== "ObjectExpression") {
                return;
            }
            let type = attrs.properties.find((p) => prop_name(p) === "type");
            if(tag.value === "input" && type && type.value.value === "hidden") {
                return;
            }
            let role = attrs.properties.find((p) => prop_name(p) === "role");
            let control = CONTROLS.includes(tag.value) ||
                !!(role && CONTROL_ROLES.includes(role.value.value));
            let named_later = comments.some((c) =>
                c.start >= attrs.start && c.end <= attrs.end && /named by \w+/.test(c.value));
            if(control && named_later) {
                return;
            }
            for(let fault of name_faults(attrs, control)) {
                found.push(`${file}:${n.loc.start.line} <${tag.value}> ${fault}`);
            }
        }
        if(n.type === "TemplateLiteral") {
            let html = src.slice(n.start, n.end);
            let line0 = n.loc.start.line;
            let re = new RegExp(`<(${CONTROLS.join("|")})\\b([^>]*)>`, "g");
            let m;
            while((m = re.exec(html)) !== null) {
                let [, tag, attrs] = m;
                if(/\btype="hidden"/.test(attrs)) {
                    continue;
                }
                let line = line0 + html.slice(0, m.index).split("\n").length - 1;
                for(let name of NAMES) {
                    let has = new RegExp(`(^|\\s)${name}=`).test(attrs);
                    if(!has) {
                        found.push(`${file}:${line} <${tag}> no ${name}`);
                    } else if(new RegExp(`(^|\\s)${name}="\\$\\{t\\(`).test(attrs) &&
                            !attrs.includes(`data-i18n-${name}=`)) {
                        found.push(`${file}:${line} <${tag}> ${name} by t() without data-i18n-${name}`);
                    }
                }
            }
        }
    });
    return found;
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
