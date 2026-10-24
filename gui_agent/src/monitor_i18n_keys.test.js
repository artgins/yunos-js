/***********************************************************************
 *          monitor_i18n_keys.test.js
 *
 *      The keys the monitor BUILDS from data -- `monitor ${control}`,
 *      `monitor confirm ${control}`, `monitor yuno ${run}`, `scenario
 *      source ${source}` -- are read by no scan: validate-locales asks for
 *      them only because the monitor publishes them, and checks a marker
 *      over such a template only against the SHAPE of the keys of its
 *      lists. What ties each list to the values the monitor can build it
 *      from is this test (REV-CLOUD V23.5.3): a key dropped from a list, or
 *      a control, a state or a source added without its key, fails here.
 *
 *      The states are read from the SOURCE with the reader validate-locales
 *      reads it with -- the one of the gobj-ui this app builds with --, so a
 *      state named by a const, an import of one, or a call of a function
 *      that returns it is read as its value (REV-CLOUD V24.5: up to here
 *      only a literal was, and a state written through a const escaped).
 *      A state the reader cannot follow fails, with its line.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const {SCENARIO_ACTIONS, scenario_controls, yuno_run_state, run_state_of_action, charts_follow} =
    await import("./monitor_helpers.js");
const {MONITOR_SOURCES} = await import("./c_agent_config.js");
const {
    C_AGENT_MONITOR_I18N_KEYS,
    C_AGENT_MONITOR_CONFIRM_I18N_KEYS,
    C_AGENT_MONITOR_STATE_I18N_KEYS,
    C_AGENT_MONITOR_SOURCE_I18N_KEYS,
    C_AGENT_MONITOR_HELD_I18N_KEYS,
    C_AGENT_MONITOR_HELP_I18N_KEYS
} = await import("./c_agent_monitor.js");

/*  The published reader (validate-locales.mjs is no export of the package:
 *  it is found next to one)  */
const GOBJ_UI = pathToFileURL(createRequire(import.meta.url).resolve("@yuneta/gobj-ui/src/c_yui_shell.js"));
const {parse_source, walk, leaves_of, var_leaves, line_of, prop_name} =
    await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);

const FUNCTION_RE = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

/***************************************************************
 *  Every control the monitor can build a button for: each action a
 *  scenario may declare, and what scenario_controls() derives from
 *  them when a scenario declares them all (restart, from start and
 *  stop).
 ***************************************************************/
function every_control()
{
    let actions = {};
    for(let a of SCENARIO_ACTIONS) {
        actions[a] = [{yuno: "y", command: "c"}];
    }
    return [...new Set([...SCENARIO_ACTIONS, ...scenario_controls({actions})])].sort();
}

/***************************************************************
 *  A module of the app parsed, never run, with its file: an import
 *  in it is followed into the module it names
 ***************************************************************/
function parsed(file)
{
    let url = new URL(file, import.meta.url);
    let ast = parse_source(readFileSync(url, "utf8"), url);
    Object.defineProperty(ast, "file", {value: file, enumerable: false});
    return ast;
}

/***************************************************************
 *  The strings a value can be, as validate-locales reads a key: a
 *  literal, every branch of ?: / || / ??, a const (or an import of
 *  one) to its value, a call of a function whose every return is one,
 *  a `let` into everything it is given. Into `out.strings`; anything
 *  else -- data, a call it does not follow, a `let` given one -- into
 *  `out.unread`, with its file and line.
 ***************************************************************/
function read_strings(ast, node, scope, out)
{
    let unread = (leaf) => {
        let program = (leaf.scope && leaf.scope[0] && typeof leaf.scope[0].code === "string")? leaf.scope[0] : ast;
        out.unread.push(`${program.file || "a module it imports"}:${line_of(program, leaf.node.start)}: ` +
                        program.code.slice(leaf.node.start, leaf.node.end));
    };
    for(let leaf of leaves_of(node, scope)) {
        if(leaf.kind === "key") {
            out.strings.add(leaf.value);
        } else if(leaf.kind === "unknown" && leaf.var_root) {
            let r = var_leaves(leaf.var_root);
            let keys = r.leaves.filter((l) => l.kind === "key").map((l) => l.value);
            if(r.complete) {
                keys.forEach((k) => out.strings.add(k));
            } else {
                unread(leaf);
            }
        } else if(leaf.kind !== "nothing") {
            unread(leaf);
        }
    }
}

/*  Is a member expression `.run` (or `["run"]`)?  */
function is_run_member(m)
{
    return m.type === "MemberExpression" && ((!m.computed && m.property.type === "Identifier" && m.property.name === "run")
        || (m.computed && m.property.type === "Literal" && m.property.value === "run"));
}

/***************************************************************
 *  Every state the monitor can give a yuno (`m.run`), read from the
 *  code that writes one: what yuno_run_state() returns, and every value
 *  the monitor itself writes as a `run` (the "unknown" of a card no
 *  answer reached yet, a "missing", yuno_run_state() followed into
 *  what it returns). -> {strings, unread}
 ***************************************************************/
function every_run_state()
{
    let out = {strings: new Set(), unread: []};
    let helpers = parsed("./monitor_helpers.js");
    let fn = null;
    walk(helpers, (n) => {
        if(n.type === "FunctionDeclaration" && n.id && n.id.name === "yuno_run_state") {
            fn = n;
        }
    });
    walk(helpers, (n, ancestors) => {
        if(n.type === "ReturnStatement" && n.argument
                && [...ancestors].reverse().find((a) => FUNCTION_RE.test(a.type)) === fn) {
            read_strings(helpers, n.argument, [...ancestors, n], out);
        }
    });
    let monitor = parsed("./c_agent_monitor.js");
    walk(monitor, (n, ancestors) => {
        let scope = [...ancestors, n];
        if(n.type === "Property" && prop_name(n) === "run" && ancestors[ancestors.length - 1].type === "ObjectExpression") {
            read_strings(monitor, n.value, scope, out);
        } else if(n.type === "AssignmentExpression" && is_run_member(n.left)) {
            read_strings(monitor, n.right, scope, out);
        }
    });
    return {strings: [...out.strings].sort(), unread: out.unread};
}

describe("REV-CLOUD V23.5.3: the keys the monitor builds from data", () => {
    test("the controls are read from the code that offers them", () => {
        expect(every_control().length).toBeGreaterThan(SCENARIO_ACTIONS.length - 1);
        expect(every_control()).toContain("restart");
    });

    test("C_AGENT_MONITOR_I18N_KEYS holds `monitor ${control}` for every control, and nothing else", () => {
        expect([...C_AGENT_MONITOR_I18N_KEYS].sort()).toEqual(every_control().map((c) => `monitor ${c}`).sort());
    });

    test("C_AGENT_MONITOR_CONFIRM_I18N_KEYS holds `monitor confirm ${control}` for every control, and nothing else", () => {
        expect([...C_AGENT_MONITOR_CONFIRM_I18N_KEYS].sort())
            .toEqual(every_control().map((c) => `monitor confirm ${c}`).sort());
    });

    test("the run states are read from the code that writes them, and no state hides from the reader", () => {
        let {strings, unread} = every_run_state();
        expect(unread, "a state the reader cannot follow: write it as a literal or a const").toEqual([]);
        for(let row of [null, {}, {yuno_disabled: true}, {yuno_running: true},
                        {yuno_running: true, yuno_playing: true}]) {
            expect(strings).toContain(yuno_run_state(row));
        }
        expect(strings).toContain("unknown");
    });

    test("C_AGENT_MONITOR_STATE_I18N_KEYS holds `monitor yuno ${run}` for every run state, and nothing else", () => {
        expect([...C_AGENT_MONITOR_STATE_I18N_KEYS].sort())
            .toEqual(every_run_state().strings.map((s) => `monitor yuno ${s}`).sort());
    });

    test("C_AGENT_MONITOR_SOURCE_I18N_KEYS holds `scenario source ${source}` for every source, and nothing else", () => {
        expect([...C_AGENT_MONITOR_SOURCE_I18N_KEYS].sort())
            .toEqual([...MONITOR_SOURCES].map((s) => `scenario source ${s}`).sort());
    });

    test("C_AGENT_MONITOR_HELP_I18N_KEYS holds `monitor ${control} help` for every control, and nothing else", () => {
        let controls = scenario_controls({actions: Object.fromEntries(
            SCENARIO_ACTIONS.map((a) => [a, [{yuno: "a", command: "x"}]]))});
        expect([...C_AGENT_MONITOR_HELP_I18N_KEYS].sort())
            .toEqual(controls.map((c) => `monitor ${c} help`).sort());
    });

    test("C_AGENT_MONITOR_HELD_I18N_KEYS holds `monitor charts held ${state}` for every state that holds the charts", () => {
        let can = {actions: {start: [{yuno: "a", command: "x"}], stop: [{yuno: "a", command: "y"}]}};
        let held = [];
        for(let a of [...SCENARIO_ACTIONS, "restart"]) {
            let st = run_state_of_action(a);
            if(st && !charts_follow(can, st) && held.indexOf(st) < 0) {
                held.push(st);
            }
        }
        expect([...C_AGENT_MONITOR_HELD_I18N_KEYS].sort())
            .toEqual(held.map((s) => `monitor charts held ${s}`).sort());
    });
});
