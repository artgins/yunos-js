/***********************************************************************
 *          wrapper_keys.test.js
 *
 *      Three helpers of the app hand a key to t() through a parameter, so
 *      validate-locales reads their keys from the list each module
 *      publishes, never from the calls:
 *
 *          segment()       c_account_view.js   PREF_SEGMENT_I18N_KEYS
 *                          (the `name` of each option)
 *          mk_sort_btn()   c_agent_console.js  HISTORY_SORT_I18N_KEYS
 *                          (its 4th argument)
 *          role_input(),   c_agent_users.js    USERS_ROLE_FIELD_I18N_KEYS
 *          role_check()    (their 2nd argument)
 *
 *      What ties each list to its calls is this test: every key a call
 *      hands is in the list, and every key of the list is handed. An option
 *      of segment() without its `name` is a button named "" whose key is
 *      "undefined" (the Display mode and Navigation segments of gui_agent
 *      1.1.8).
 *
 *      A key is read as validate-locales reads it -- with the reader of the
 *      gobj-ui this app builds with --: a literal, a const followed to its
 *      literals (a key reached through a table), and a read marked
 *      `/* i18n: <NAME>_I18N_KEYS *\/` as every key of the list the module
 *      publishes under that name (`/* i18n: data *\/`: no key). Anything
 *      else fails, with its line. The calls are found by the NAME of the
 *      helper, so any other use of that name (an alias, a table of
 *      functions, `.call()`, a callback) would hide its calls: it fails too.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

/*  The published reader (validate-locales.mjs is no export of the package:
 *  it is found next to one)  */
const GOBJ_UI = pathToFileURL(createRequire(import.meta.url).resolve("@yuneta/gobj-ui/src/c_yui_shell.js"));
const {parse_source, walk, leaves_of, var_leaves, line_of, published_lists, markers_of, marker_of, prop_name} =
    await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);

/***************************************************************
 *  A module parsed, never run: {name, ast, markers}
 ***************************************************************/
function module_of(name, code, url)
{
    let ast = parse_source(code, url);
    return {name: name, ast: ast, markers: markers_of(ast)};
}

function read_module(file)
{
    let url = new URL(file, import.meta.url);
    return module_of(file.replace(/^\.\//, ""), readFileSync(url, "utf8"), url);
}

/*  A list as the module publishes it (an `export const` array of literals)  */
function published(mod, name)
{
    let list = published_lists(mod.ast).lists.find((l) => l.name === name);
    return list? list.keys : null;
}

/***************************************************************
 *  The keys a value can be, as validate-locales reads a key: a
 *  literal, every branch of ?: / || / ??, a const (or an import of
 *  one) to its value, a `let` into everything it is given, a read
 *  marked with a list into the keys of that list. Into `out.keys`;
 *  anything else into `out.unread`, with its line.
 ***************************************************************/
function read_keys(mod, node, scope, out)
{
    let program_of = (leaf) => {
        return (leaf.scope && leaf.scope[0] && typeof leaf.scope[0].code === "string")? leaf.scope[0] : mod.ast;
    };
    let unread = (leaf, why = "") => {
        let program = program_of(leaf);
        out.unread.push(`${program === mod.ast? mod.name : "a module it imports"}:` +
                        `${line_of(program, leaf.node.start)}: ` +
                        `${program.code.slice(leaf.node.start, leaf.node.end)}${why}`);
    };
    for(let leaf of leaves_of(node, scope)) {
        let marker = (program_of(leaf) === mod.ast)? marker_of(leaf, mod.markers) : null;
        if(marker) {
            /*  `i18n: data` names no list: no key  */
            for(let name of marker.lists) {
                let keys = published(mod, name);
                if(keys) {
                    out.keys.push(...keys);
                } else {
                    unread(leaf, ` (marked with ${name}, which this module does not publish)`);
                }
            }
            continue;
        }
        if(leaf.kind === "key") {
            out.keys.push(leaf.value);
        } else if(leaf.kind === "unknown" && leaf.var_root) {
            let r = var_leaves(leaf.var_root);
            if(r.complete) {
                out.keys.push(...r.leaves.filter((l) => l.kind === "key").map((l) => l.value));
            } else {
                unread(leaf);
            }
        } else {
            unread(leaf);
        }
    }
}

/***************************************************************
 *  Is this occurrence of a function's name one that hides no call:
 *  a call by the name, the name declared or imported, or a property
 *  name that is no reference to it
 ***************************************************************/
function hides_no_call(n, parent)
{
    if(!parent) {
        return false;
    }
    switch(parent.type) {
        case "CallExpression":
            return parent.callee === n;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "VariableDeclarator":
            return parent.id === n;
        case "ImportSpecifier":
        case "ImportDefaultSpecifier":
            return true;
        case "Property":
            return parent.key === n && !parent.computed;   /*  `{f}`: its value is the use  */
        case "MemberExpression":
            return parent.property === n && !parent.computed;
        default:
            return false;
    }
}

/***************************************************************
 *  The keys handed at argument `index` of every call of the
 *  `callees`: {keys, unread}. A call without that argument, and any
 *  use of a callee's name that is not a call by it, go into `unread`.
 ***************************************************************/
function keys_handed(mod, callees, index)
{
    let out = {keys: [], unread: []};
    walk(mod.ast, (n, ancestors) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && callees.includes(n.callee.name)) {
            if(n.arguments[index]) {
                read_keys(mod, n.arguments[index], [...ancestors, n], out);
            } else {
                out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: ${n.callee.name}() ` +
                                `without its argument ${index + 1}`);
            }
        } else if(n.type === "Identifier" && callees.includes(n.name) &&
                !hides_no_call(n, ancestors[ancestors.length - 1])) {
            out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: ${n.name} used but not called by ` +
                            `its name, so its calls are not seen`);
        }
    });
    return out;
}

/***************************************************************
 *  The `name` of every option written in a call of segment():
 *  {keys, unread}. Options that are not written in the call are
 *  not read, and say so.
 ***************************************************************/
function segment_names(mod)
{
    let out = {keys: [], unread: []};
    walk(mod.ast, (n, ancestors) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "segment") {
            let options = n.arguments[0];
            if(!options || options.type !== "ArrayExpression") {
                out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: segment() given options ` +
                                `that are not written in the call`);
                return;
            }
            for(let opt of options.elements) {
                let p = (opt && opt.type === "ObjectExpression")?
                    opt.properties.find((q) => q.type === "Property" && prop_name(q) === "name") : null;
                if(!p) {
                    out.unread.push(`${mod.name}:${line_of(mod.ast, (opt || n).start)}: an option without a name`);
                    continue;
                }
                read_keys(mod, p.value, [...ancestors, n], out);
            }
        } else if(n.type === "Identifier" && n.name === "segment" &&
                !hides_no_call(n, ancestors[ancestors.length - 1])) {
            out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: segment used but not called by its ` +
                            `name, so its calls are not seen`);
        }
    });
    return out;
}

function sorted_set(keys)
{
    return [...new Set(keys)].sort();
}

describe("the keys a helper hands to t() are in the list its module publishes", () => {
    test("segment(): every option has a `name`, and it is in PREF_SEGMENT_I18N_KEYS", () => {
        let mod = read_module("./c_account_view.js");
        let {keys, unread} = segment_names(mod);
        expect(keys.length).toBeGreaterThan(0);
        expect(unread).toEqual([]);
        expect(sorted_set(keys)).toEqual([...published(mod, "PREF_SEGMENT_I18N_KEYS")].sort());
    });

    test("mk_sort_btn(): its 4th argument is in HISTORY_SORT_I18N_KEYS", () => {
        let mod = read_module("./c_agent_console.js");
        let {keys, unread} = keys_handed(mod, ["mk_sort_btn"], 3);
        expect(unread).toEqual([]);
        expect(sorted_set(keys)).toEqual([...published(mod, "HISTORY_SORT_I18N_KEYS")].sort());
    });

    test("role_input() / role_check(): their 2nd argument is in USERS_ROLE_FIELD_I18N_KEYS", () => {
        let mod = read_module("./c_agent_users.js");
        let {keys, unread} = keys_handed(mod, ["role_input", "role_check"], 1);
        expect(unread).toEqual([]);
        expect(sorted_set(keys)).toEqual([...published(mod, "USERS_ROLE_FIELD_I18N_KEYS")].sort());
    });
});

describe("what the reader of this test sees, on a module written for it", () => {
    const FIXTURE = module_of("fixture.js", [
        'export const FIXTURE_I18N_KEYS = ["marked one", "marked two"];',
        'const TABLE = {busy: "from a table"};',
        'const ROWS = [["a", "from a list"]];',
        'function role_input(cls, key) {}',
        'function segment(options) {}',
        'const OPTIONS = [{name: "out of the call"}];',
        'function f(kw, k) {',
        '    role_input("A", "a literal");',
        '    role_input("B", TABLE.busy);',
        '    for(const [cls, key] of ROWS) {',
        '        role_input(cls, key);',
        '    }',
        '    role_input("C", /* i18n: FIXTURE_I18N_KEYS */ k);',
        '    role_input("D", /* i18n: data */ kw.comment);',
        '    role_input("E", /* i18n: OTHER_I18N_KEYS */ k);',
        '    role_input("F", kw.key);',
        '    role_input("G");',
        '    const say = role_input;',
        '    [role_input].forEach((fn) => fn("H", "hidden in a table"));',
        '    role_input.call(null, "I", "hidden by call");',
        '    ROWS.forEach(role_input);',
        '    const handlers = {role_input};',
        '    const names = {role_input: "a property, no use of the function"};',
        '    segment([{name: TABLE.busy}, {name: /* i18n: FIXTURE_I18N_KEYS */ k}, {text: "no name"}]);',
        '    segment(OPTIONS);',
        '    let picked = "from a let";',
        '    if(kw.other) {',
        '        picked = "from a let, too";',
        '    }',
        '    role_input("J", picked);',
        '    return [say, handlers, names.role_input];',
        '}'
    ].join("\n"), new URL("file:///fixture.js"));

    test("a key through a table, a list or a marked read is read; a call it cannot see is said", () => {
        let {keys, unread} = keys_handed(FIXTURE, ["role_input"], 1);
        expect(sorted_set(keys)).toEqual(
            ["a literal", "from a let", "from a let, too", "from a list", "from a table",
             "marked one", "marked two"].sort());
        expect(unread).toEqual([
            "fixture.js:15: k (marked with OTHER_I18N_KEYS, which this module does not publish)",
            "fixture.js:16: kw.key",
            "fixture.js:17: role_input() without its argument 2",
            "fixture.js:18: role_input used but not called by its name, so its calls are not seen",
            "fixture.js:19: role_input used but not called by its name, so its calls are not seen",
            "fixture.js:20: role_input used but not called by its name, so its calls are not seen",
            "fixture.js:21: role_input used but not called by its name, so its calls are not seen",
            "fixture.js:22: role_input used but not called by its name, so its calls are not seen"
        ]);
    });

    test("segment(): a name through a table or a marked read is read; an option without one is said", () => {
        let {keys, unread} = segment_names(FIXTURE);
        expect(sorted_set(keys)).toEqual(["from a table", "marked one", "marked two"].sort());
        expect(unread).toEqual([
            "fixture.js:24: an option without a name",
            "fixture.js:25: segment() given options that are not written in the call"
        ]);
    });
});
