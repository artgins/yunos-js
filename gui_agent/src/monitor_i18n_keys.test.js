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
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import {parse} from "acorn";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const {SCENARIO_ACTIONS, scenario_controls, yuno_run_state} = await import("./monitor_helpers.js");
const {MONITOR_SOURCES} = await import("./c_agent_config.js");
const {
    C_AGENT_MONITOR_I18N_KEYS,
    C_AGENT_MONITOR_CONFIRM_I18N_KEYS,
    C_AGENT_MONITOR_STATE_I18N_KEYS,
    C_AGENT_MONITOR_SOURCE_I18N_KEYS
} = await import("./c_agent_monitor.js");

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
 *  A module parsed, never run, and a visit of every node of it
 ***************************************************************/
function parsed(file)
{
    return parse(readFileSync(new URL(file, import.meta.url), "utf8"), {ecmaVersion: "latest", sourceType: "module"});
}

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

/*  The string literals a value can be: a literal, every branch of ?: / || / ??  */
function literals(n, out)
{
    if(n.type === "Literal" && typeof n.value === "string") {
        out.add(n.value);
    } else if(n.type === "ConditionalExpression") {
        literals(n.consequent, out);
        literals(n.alternate, out);
    } else if(n.type === "LogicalExpression") {
        literals(n.left, out);
        literals(n.right, out);
    }
}

/***************************************************************
 *  Every state the monitor can give a yuno (`m.run`), read from the
 *  code that writes one: what yuno_run_state() returns, and every
 *  literal the monitor itself writes as a `run` (the "unknown" of a
 *  card no answer reached yet, a "missing").
 ***************************************************************/
function every_run_state()
{
    let states = new Set();
    let fn = null;
    walk(parsed("./monitor_helpers.js"), (n) => {
        if(n.type === "FunctionDeclaration" && n.id && n.id.name === "yuno_run_state") {
            fn = n;
        }
    });
    walk(fn.body, (n) => {
        if(n.type === "ReturnStatement" && n.argument) {
            literals(n.argument, states);
        }
    });
    walk(parsed("./c_agent_monitor.js"), (n) => {
        if(n.type === "Property" && !n.computed && n.key.type === "Identifier" && n.key.name === "run") {
            literals(n.value, states);
        } else if(n.type === "AssignmentExpression" && n.left.type === "MemberExpression"
                && !n.left.computed && n.left.property.name === "run") {
            literals(n.right, states);
        }
    });
    return [...states].sort();
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

    test("the run states are read from the code that writes them", () => {
        let states = every_run_state();
        for(let row of [null, {}, {yuno_disabled: true}, {yuno_running: true},
                        {yuno_running: true, yuno_playing: true}]) {
            expect(states).toContain(yuno_run_state(row));
        }
        expect(states).toContain("unknown");
    });

    test("C_AGENT_MONITOR_STATE_I18N_KEYS holds `monitor yuno ${run}` for every run state, and nothing else", () => {
        expect([...C_AGENT_MONITOR_STATE_I18N_KEYS].sort())
            .toEqual(every_run_state().map((s) => `monitor yuno ${s}`).sort());
    });

    test("C_AGENT_MONITOR_SOURCE_I18N_KEYS holds `scenario source ${source}` for every source, and nothing else", () => {
        expect([...C_AGENT_MONITOR_SOURCE_I18N_KEYS].sort())
            .toEqual([...MONITOR_SOURCES].map((s) => `scenario source ${s}`).sort());
    });
});
