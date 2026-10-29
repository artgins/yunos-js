/***********************************************************************
 *          wrapper_keys.test.js
 *
 *      Three helpers of the app hand a key to t() through a parameter, so
 *      validate-locales reads their keys from the list each module
 *      publishes, never from the calls (REV-CLOUD V46.3):
 *
 *          segment()       c_account_view.js   PREF_SEGMENT_I18N_KEYS
 *                          (the `name` of each option)
 *          mk_sort_btn()   c_agent_console.js  HISTORY_SORT_I18N_KEYS
 *                          (its 4th argument)
 *          role_input(),   c_agent_users.js    USERS_ROLE_FIELD_I18N_KEYS
 *          role_check()    (their 2nd argument)
 *
 *      What ties each list to its calls is this test: every call hands a
 *      literal key, and every key is in the list. An option of segment()
 *      without its `name` is a button named "" whose key is "undefined"
 *      (the Display mode and Navigation segments of gui_agent 1.1.8).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import * as acorn from "acorn";

/***************************************************************
 *  The exported `<name>` array of string literals of a module,
 *  and the arguments of every call of `callee` in it.
 ***************************************************************/
function read_module(file, list_name, callee)
{
    let src = readFileSync(new URL(file, import.meta.url), "utf8");
    let ast = acorn.parse(src, {ecmaVersion: "latest", sourceType: "module", locations: true});
    let list = null;
    let calls = [];
    let walk = (n) => {
        if(!n || typeof n.type !== "string") {
            return;
        }
        if(n.type === "VariableDeclarator" && n.id.name === list_name && n.init &&
                n.init.type === "ArrayExpression") {
            list = n.init.elements.map((e) => e.value);
        }
        if(n.type === "CallExpression" && n.callee.type === "Identifier" &&
                callee.includes(n.callee.name)) {
            calls.push(n);
        }
        for(let k of Object.keys(n)) {
            let v = n[k];
            if(Array.isArray(v)) {
                v.forEach(walk);
            } else if(v && typeof v.type === "string") {
                walk(v);
            }
        }
    };
    walk(ast);
    return {list, calls};
}

function literal(n)
{
    return n && n.type === "Literal" && typeof n.value === "string" ? n.value : null;
}

describe("the keys a helper hands to t() are in the list its module publishes", () => {
    test("segment(): every option has a `name`, and it is in PREF_SEGMENT_I18N_KEYS", () => {
        let {list, calls} = read_module("./c_account_view.js", "PREF_SEGMENT_I18N_KEYS", ["segment"]);
        expect(calls.length).toBeGreaterThan(0);
        let names = [];
        let faults = [];
        for(let call of calls) {
            for(let opt of call.arguments[0].elements) {
                let p = opt.properties.find((q) => q.key.name === "name");
                let name = p ? literal(p.value) : null;
                if(name === null) {
                    faults.push(`c_account_view.js:${opt.loc.start.line} an option without a literal name`);
                } else {
                    names.push(name);
                }
            }
        }
        expect(faults).toEqual([]);
        expect([...new Set(names)].sort()).toEqual([...list].sort());
    });

    test("mk_sort_btn(): its 4th argument is in HISTORY_SORT_I18N_KEYS", () => {
        let {list, calls} = read_module("./c_agent_console.js", "HISTORY_SORT_I18N_KEYS", ["mk_sort_btn"]);
        let keys = calls.map((c) => literal(c.arguments[3]));
        expect(keys).not.toContain(null);
        expect([...new Set(keys)].sort()).toEqual([...list].sort());
    });

    test("role_input() / role_check(): their 2nd argument is in USERS_ROLE_FIELD_I18N_KEYS", () => {
        let {list, calls} = read_module("./c_agent_users.js", "USERS_ROLE_FIELD_I18N_KEYS",
            ["role_input", "role_check"]);
        let keys = calls.map((c) => literal(c.arguments[1]));
        expect(keys).not.toContain(null);
        expect([...new Set(keys)].sort()).toEqual([...list].sort());
    });
});
