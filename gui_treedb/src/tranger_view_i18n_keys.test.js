/***********************************************************************
 *          tranger_view_i18n_keys.test.js
 *
 *      What the error banner of C_TRANGER_VIEW says reaches t() through
 *      the parameter of show_error(), and its fallback is BUILT from the
 *      name of the command that failed (`${command} failed`):
 *      validate-locales reads neither, and asks for those keys only
 *      because the view publishes them (C_TRANGER_VIEW_ERROR_I18N_KEYS).
 *      This test ties the list to the source (REV-CLOUD V23.5.3): a key
 *      handed to show_error(), or a command whose failure reaches the
 *      generic error path, that the list lacks -- or a key the list holds
 *      that nothing hands -- fails here. The source is read, never run,
 *      the way validate-locales reads it.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import {parse} from "acorn";

const SOURCE = readFileSync(new URL("./c_tranger_view.js", import.meta.url), "utf8");
const AST = parse(SOURCE, {ecmaVersion: "latest", sourceType: "module"});

/*  The commands answered BEFORE the generic error path: get-page rejects
 *  its own Promise, print-tranger hands its own key, and open-list is only
 *  the read of the snaps, whose failure is logged  */
const ANSWERED_BEFORE = ["get-page", "print-tranger", "open-list"];

function walk(node, visit)
{
    visit(node);
    for(let key of Object.keys(node)) {
        let v = node[key];
        if(Array.isArray(v)) {
            for(let c of v) {
                if(c && typeof c.type === "string") {
                    walk(c, visit);
                }
            }
        } else if(v && typeof v.type === "string" && key !== "loc") {
            walk(v, visit);
        }
    }
}

/*  The non-empty string literals a value can be: a literal, every branch
 *  of ?: / || / ??  */
function literals(n, out)
{
    if(n.type === "Literal" && typeof n.value === "string" && n.value) {
        out.add(n.value);
    } else if(n.type === "ConditionalExpression") {
        literals(n.consequent, out);
        literals(n.alternate, out);
    } else if(n.type === "LogicalExpression") {
        literals(n.left, out);
        literals(n.right, out);
    }
}

/*  A list as the module publishes it: an `export const` array of literals  */
function published(name)
{
    let out = null;
    walk(AST, (n) => {
        if(n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.id.name === name) {
            out = n.init.elements.map((e) => e.value);
        }
    });
    return out;
}

/*  Every command the view sends: gobj_command(<remote>, "<command>", ...)  */
function commands_sent()
{
    let out = new Set();
    walk(AST, (n) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "gobj_command"
                && n.arguments[1] && n.arguments[1].type === "Literal") {
            out.add(n.arguments[1].value);
        }
    });
    return [...out];
}

/*  Every literal key handed to show_error(gobj, <key>)  */
function keys_handed()
{
    let out = new Set();
    walk(AST, (n) => {
        if(n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "show_error"
                && n.arguments[1]) {
            literals(n.arguments[1], out);
        }
    });
    return [...out];
}

describe("REV-CLOUD V23.5.3: what the error banner of C_TRANGER_VIEW says", () => {
    test("the commands answered before the generic error path still are, and the fallback is built there", () => {
        for(let c of ANSWERED_BEFORE) {
            expect(SOURCE, c).toContain(`if(command === "${c}"`);
        }
        expect(SOURCE).toContain("show_error(gobj, comment || `${command} failed`)");
        expect(commands_sent().length).toBeGreaterThan(ANSWERED_BEFORE.length);
    });

    test("C_TRANGER_VIEW_ERROR_I18N_KEYS holds every key show_error() is handed, " +
         "`${command} failed` for every other command, and nothing else", () => {
        let expected = new Set(keys_handed());
        for(let c of commands_sent()) {
            if(!ANSWERED_BEFORE.includes(c)) {
                expected.add(`${c} failed`);
            }
        }
        expect([...published("C_TRANGER_VIEW_ERROR_I18N_KEYS")].sort()).toEqual([...expected].sort());
    });
});
