/***********************************************************************
 *          tranger_view_i18n_keys.test.js
 *
 *      What the error banner of C_TRANGER_VIEW says reaches t() through
 *      the parameter of show_error(), and its fallback is BUILT from the
 *      name of the command that failed (`${command} failed`):
 *      validate-locales reads neither, and asks for those keys only
 *      because the view publishes them (C_TRANGER_VIEW_ERROR_I18N_KEYS).
 *      This test ties the list to the source: a key
 *      handed to show_error(), or a command whose failure reaches the
 *      generic error path, that the list lacks -- or a key the list holds
 *      that nothing hands -- fails here.
 *
 *      The source is read, never run, with the reader validate-locales
 *      reads it with -- the one of the gobj-ui this app builds with --, so
 *      a command or a key named by a const, an import of one, or a call of
 *      a function that returns it is read as its value (up
 *      to then only a literal was, and a command sent through a const
 *      escaped). A command or a key the reader cannot follow fails, with
 *      its line, unless it is one of the few that are data on purpose.
 *
 *      A key reached through a table is read as validate-locales reads it:
 *      a const followed to its literals, and a read marked
 *      `/* i18n: <NAME>_I18N_KEYS *\/` as every key of the list the module
 *      publishes under that name (`/* i18n: data *\/`: no key). The calls
 *      are found by the NAME of the function, so any other use of that name
 *      (an alias, a table of functions, `.call()`, a callback) would hide
 *      its calls: it fails, with its line.
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
const {parse_source, walk, leaves_of, var_leaves, line_of, published_lists, markers_of, marker_of} =
    await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);

/***************************************************************
 *  A module parsed, never run: {name, ast, markers}
 ***************************************************************/
function module_of(name, code, url)
{
    let ast = parse_source(code, url);
    return {name: name, ast: ast, markers: markers_of(ast)};
}

const FILE = new URL("./c_tranger_view.js", import.meta.url);
const SOURCE = readFileSync(FILE, "utf8");
const VIEW = module_of("c_tranger_view.js", SOURCE, FILE);

/*  The commands answered BEFORE the generic error path: get-page rejects
 *  its own Promise, print-tranger hands its own key, and open-list is only
 *  the read of the snaps, whose failure is logged  */
const ANSWERED_BEFORE = ["get-page", "print-tranger", "open-list"];

/*  What show_error() is handed that is no key of the list, on purpose:
 *  the backend's own words, the fallback built from the command (read
 *  below, from the commands sent), and the key handed before, shown again
 *  on a language change  */
const SHOW_ERROR_DATA = ["comment", "`${command} failed`", "priv.error_key"];

/***************************************************************
 *  The strings a value can be, as validate-locales reads a key: a
 *  literal, every branch of ?: / || / ??, a const (or an import of
 *  one) to its value, a call of a function whose every return is one,
 *  a `let` into everything it is given, a read marked with a list into
 *  the keys of that list. Into `out.strings`; anything else -- data, a
 *  call it does not follow -- into `out.unread`, with its line, unless
 *  its text is one of `data` or it is marked as data.
 ***************************************************************/
function read_strings(mod, node, scope, out, data = [])
{
    let program_of = (leaf) => {
        return (leaf.scope && leaf.scope[0] && typeof leaf.scope[0].code === "string")? leaf.scope[0] : mod.ast;
    };
    let unread = (leaf, why = "") => {
        let program = program_of(leaf);
        let text = program.code.slice(leaf.node.start, leaf.node.end);
        if(program === mod.ast && data.includes(text)) {
            return;
        }
        out.unread.push(`${program === mod.ast? mod.name : "a module it imports"}:` +
                        `${line_of(program, leaf.node.start)}: ${text}${why}`);
    };
    for(let leaf of leaves_of(node, scope)) {
        let marker = (program_of(leaf) === mod.ast)? marker_of(leaf, mod.markers) : null;
        if(marker) {
            /*  `i18n: data` names no list: no key  */
            for(let name of marker.lists) {
                let keys = published(mod, name);
                if(keys) {
                    keys.forEach((k) => out.strings.add(k));
                } else {
                    unread(leaf, ` (marked with ${name}, which this module does not publish)`);
                }
            }
            continue;
        }
        if(leaf.kind === "key") {
            out.strings.add(leaf.value);
        } else if(leaf.kind === "unknown" && leaf.var_root) {
            let r = var_leaves(leaf.var_root);
            if(r.complete) {
                r.leaves.filter((l) => l.kind === "key").forEach((l) => out.strings.add(l.value));
            } else {
                unread(leaf);
            }
        } else if(leaf.kind !== "nothing") {
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
 *  The strings handed at argument `index` of every call of `callee`.
 *  The calls are found by the name: any other use of the name is a
 *  call that would not be seen, and goes into `unread`, as does a call
 *  without that argument.
 ***************************************************************/
function handed(mod, callee, index, data = [])
{
    let out = {strings: new Set(), unread: []};
    walk(mod.ast, (n, ancestors) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === callee) {
            if(n.arguments[index]) {
                read_strings(mod, n.arguments[index], [...ancestors, n], out, data);
            } else {
                out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: ${callee}() ` +
                                `without its argument ${index + 1}`);
            }
        } else if(n.type === "Identifier" && n.name === callee &&
                !hides_no_call(n, ancestors[ancestors.length - 1])) {
            out.unread.push(`${mod.name}:${line_of(mod.ast, n.start)}: ${callee} used but not called by its ` +
                            `name, so its calls are not seen`);
        }
    });
    return {strings: [...out.strings], unread: out.unread};
}

/*  A list as the module publishes it (an `export const` array of literals)  */
function published(mod, name)
{
    let list = published_lists(mod.ast).lists.find((l) => l.name === name);
    return list? list.keys : null;
}

/*  Every command the view sends: gobj_command(<remote>, <command>, ...)  */
function commands_sent()
{
    return handed(VIEW, "gobj_command", 1);
}

/*  Every key handed to show_error(gobj, <key>)  */
function keys_handed()
{
    return handed(VIEW, "show_error", 1, SHOW_ERROR_DATA);
}

describe("what the error banner of C_TRANGER_VIEW says", () => {
    test("the commands answered before the generic error path still are, and the fallback is built there", () => {
        for(let c of ANSWERED_BEFORE) {
            expect(SOURCE, c).toContain(`if(command === "${c}"`);
        }
        expect(SOURCE).toContain("show_error(gobj, comment || `${command} failed`)");
        expect(commands_sent().strings.length).toBeGreaterThan(ANSWERED_BEFORE.length);
    });

    test("no command and no key handed hides from the reader", () => {
        expect(commands_sent().unread, "a command the reader cannot follow: name it with a literal or a const")
            .toEqual([]);
        expect(keys_handed().unread, "a key show_error() is handed that the reader cannot follow: hand it a " +
            "literal or a const, or name it in SHOW_ERROR_DATA with why").toEqual([]);
    });

    test("C_TRANGER_VIEW_ERROR_I18N_KEYS holds every key show_error() is handed, " +
         "`${command} failed` for every other command, and nothing else", () => {
        let expected = new Set(keys_handed().strings);
        for(let c of commands_sent().strings) {
            if(!ANSWERED_BEFORE.includes(c)) {
                expected.add(`${c} failed`);
            }
        }
        expect([...published(VIEW, "C_TRANGER_VIEW_ERROR_I18N_KEYS")].sort()).toEqual([...expected].sort());
    });
});

describe("what the reader of this test sees, on a module written for it", () => {
    const FIXTURE = module_of("fixture.js", [
        'export const FIXTURE_I18N_KEYS = ["marked one", "marked two"];',
        'const TABLE = {busy: "from a table"};',
        'const LIST = ["from a list"];',
        'function show_error(gobj, msg) {}',
        'function f(gobj, kw, k) {',
        '    show_error(gobj, "a literal");',
        '    show_error(gobj, TABLE.busy);',
        '    for(const key of LIST) {',
        '        show_error(gobj, key);',
        '    }',
        '    show_error(gobj, /* i18n: FIXTURE_I18N_KEYS */ k);',
        '    show_error(gobj, /* i18n: data */ kw.comment);',
        '    show_error(gobj, /* i18n: OTHER_I18N_KEYS */ k);',
        '    show_error(gobj, kw.key);',
        '    const say = show_error;',
        '    say(gobj, "hidden by an alias");',
        '    [show_error].forEach((fn) => fn(gobj, "hidden in a table"));',
        '    show_error.call(null, gobj, "hidden by call");',
        '    LIST.forEach(show_error);',
        '    const handlers = {show_error};',
        '    const names = {show_error: "a property, no use of the function"};',
        '    let picked = "from a let";',
        '    if(kw.other) {',
        '        picked = "from a let, too";',
        '    }',
        '    show_error(gobj, picked);',
        '    show_error(gobj);',
        '    return [handlers, names.show_error];',
        '}'
    ].join("\n"), new URL("file:///fixture.js"));

    test("a key through a table, a list or a marked read is read; a call it cannot see is said", () => {
        let {strings, unread} = handed(FIXTURE, "show_error", 1);
        expect(strings.sort()).toEqual(
            ["a literal", "from a let", "from a let, too", "from a list", "from a table",
             "marked one", "marked two"].sort());
        expect(unread).toEqual([
            "fixture.js:13: k (marked with OTHER_I18N_KEYS, which this module does not publish)",
            "fixture.js:14: kw.key",
            "fixture.js:15: show_error used but not called by its name, so its calls are not seen",
            "fixture.js:17: show_error used but not called by its name, so its calls are not seen",
            "fixture.js:18: show_error used but not called by its name, so its calls are not seen",
            "fixture.js:19: show_error used but not called by its name, so its calls are not seen",
            "fixture.js:20: show_error used but not called by its name, so its calls are not seen",
            "fixture.js:27: show_error() without its argument 2"
        ]);
    });
});
