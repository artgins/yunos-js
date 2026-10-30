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
const {parse_source, walk, leaves_of, var_leaves, line_of, published_lists} =
    await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);

const FILE = new URL("./c_tranger_view.js", import.meta.url);
const SOURCE = readFileSync(FILE, "utf8");
const AST = parse_source(SOURCE, FILE);

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
 *  a `let` into everything it is given. Into `out.strings`; anything
 *  else -- data, a call it does not follow -- into `out.unread`, with
 *  its line, unless its text is one of `data`.
 ***************************************************************/
function read_strings(node, scope, out, data = [])
{
    let unread = (leaf) => {
        let program = (leaf.scope && leaf.scope[0] && typeof leaf.scope[0].code === "string")? leaf.scope[0] : AST;
        let text = program.code.slice(leaf.node.start, leaf.node.end);
        if(program === AST && data.includes(text)) {
            return;
        }
        out.unread.push(`${program === AST? "c_tranger_view.js" : "a module it imports"}:` +
                        `${line_of(program, leaf.node.start)}: ${text}`);
    };
    for(let leaf of leaves_of(node, scope)) {
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

/*  The strings handed at argument `index` of every call of `callee` (by its name)  */
function handed(callee, index, data = [])
{
    let out = {strings: new Set(), unread: []};
    walk(AST, (n, ancestors) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === callee
                && n.arguments[index]) {
            read_strings(n.arguments[index], [...ancestors, n], out, data);
        }
    });
    return {strings: [...out.strings], unread: out.unread};
}

/*  A list as the module publishes it (an `export const` array of literals)  */
function published(name)
{
    let list = published_lists(AST).lists.find((l) => l.name === name);
    return list? list.keys : null;
}

/*  Every command the view sends: gobj_command(<remote>, <command>, ...)  */
function commands_sent()
{
    return handed("gobj_command", 1);
}

/*  Every key handed to show_error(gobj, <key>)  */
function keys_handed()
{
    return handed("show_error", 1, SHOW_ERROR_DATA);
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
        expect([...published("C_TRANGER_VIEW_ERROR_I18N_KEYS")].sort()).toEqual([...expected].sort());
    });
});
