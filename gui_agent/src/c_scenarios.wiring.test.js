/***********************************************************************
 *          c_scenarios.wiring.test.js
 *
 *      The Scenarios workspace driven through its FSMs: the list
 *      (C_SCENARIOS) and the live view (C_AGENT_MONITOR), tied by the
 *      REAL C_AGENT_CONFIG -- the one place the scenario watched is
 *      written, and followed. The links, the shell, the charts and the
 *      table are doubles. What is asserted is what each side SENDS, and
 *      what each answer of the control center does.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const confirm = {answer: true, asked: []};
const modals = [];
vi.mock("@yuneta/gobj-ui/src/shell_modals.js", () => ({
    yui_shell_show_modal: (shell, $content, opts) => {
        const modal = {$content, opts, closed: false};
        modals.push(modal);
        return {close() {
            modal.closed = true;
        }};
    },
    yui_shell_confirm_yesno: (shell, $msg, opts) => {
        confirm.asked.push({kind: "yesno", opts});
        return Promise.resolve(confirm.answer);
    },
    yui_shell_confirm_danger: (shell, $msg, opts) => {
        confirm.asked.push({kind: "danger", opts});
        return Promise.resolve(confirm.answer);
    },
}));

const navigated = [];
const test_shell = {shell: null};
vi.mock("@yuneta/gobj-ui/src/c_yui_shell.js", () => ({
    yui_shell_of: () => test_shell.shell,
    yui_shell_navigate: (shell, route) => {
        navigated.push(route);
        return 0;
    },
}));

vi.mock("@yuneta/gobj-ui/src/yui_tabulator_i18n.js", () => ({
    yui_tabulator_lang: () => ({}),
    yui_tabulator_relocalize: () => {},
}));

/*  The gobj tree's window: a gobj that keeps what the host hands it.  */
const tree_double = vi.hoisted(() => ({opened: [], got: [], make: null}));
vi.mock("@yuneta/gobj-ui/src/yui_gobj_tree_view.js", () => ({
    open_gobj_tree_view: (host, opts) => {
        const handle = {tree: tree_double.make(host, opts), win: null, modal: null, opts: opts};
        tree_double.opened.push(handle);
        return handle;
    },
    close_gobj_tree_view: (handle) => {
        if(handle) {
            handle.closed = true;
        }
    },
}));

vi.mock("@yuneta/gobj-ui/src/yui_inputs.js", () => ({
    attach_clear: () => {},
}));

vi.mock("tabulator-tables", () => ({
    TabulatorFull: class {
        constructor(el, options) {
            this.options = options;
            this.data = [];
        }
        on(ev, fn) {
            if(ev === "tableBuilt") {
                fn();
            }
        }
        setData(d) {
            this.data = d;
        }
        setFilter() {}
        clearFilter() {}
        setColumns() {}
        destroy() {}
    }
}));

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_start, gobj_send_event, gobj_publish_event, gobj_current_state, gobj_change_state,
    gobj_read_attr,
    gobj_name,
    clean_name,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_config, agent_config_get_monitor, agent_config_set_monitor,
       agent_config_toggle_selected_node, stats_sel_id,
       agent_config_set_permissions} = await import("./c_agent_config.js");
const {register_c_agent_monitor} = await import("./c_agent_monitor.js");
const {register_c_agent_yuno_tree} = await import("./c_agent_yuno_tree.js");
const {register_c_scenarios} = await import("./c_scenarios.js");
const {validate_scenario} = await import("./monitor_helpers.js");

const logged = [];
const sent = [];
const chart_loads = [];

function iev_command_parser(gobj, command, kw, src)
{
    sent.push({command, kw});
    return null;
}

let yuno = null;
let host = null;
let link = null;
let mlink = null;
let config = null;
let n_views = 0;

const SAVED = {
    id: "stress", node: "ctrl", description: "sim -> gate",
    yunos: [{key: "sim", id: "stress", service: "sim_controllers", rate: "tx"}, {key: "gate", id: "2120"}],
    links: [["sim", "gate"]],
    actions: {
        start: [{yuno: "sim", command: "set-controllers controllers=10"}],
        stop:  [{yuno: "sim", command: "set-controllers controllers=0"}],
        report: [{yuno: "gate", service: "__yuno__", command: "view-config"}]
    }
};

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();
    register_c_agent_config();
    register_c_agent_monitor();
    register_c_agent_yuno_tree();
    register_c_scenarios();

    const keep = (gobj, event, kw) => {
        tree_double.got.push({event, kw});
        return 0;
    };
    gclass_create("C_TEST_TREE",
        [["EV_LOAD_TREE", 0], ["EV_TRACE_INFO", 0], ["EV_GCLASS_DESCRIPTION", 0]],
        [["ST_IDLE", [
            ["EV_LOAD_TREE", keep, null],
            ["EV_TRACE_INFO", keep, null],
            ["EV_GCLASS_DESCRIPTION", keep, null]
        ]]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    let n_trees = 0;
    tree_double.make = (host, opts) => gobj_create(`tree_double_${++n_trees}`, "C_TEST_TREE", {}, host);

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_SHELL", [["EV_LANGUAGE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT],
                                   ["EV_ROUTE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT]],
        [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_SESSION", []], ["ST_DISCONNECTED", []]],
        {mt_command_parser: iev_command_parser}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    const link_events = [
        ["EV_ON_OPEN",           event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_ON_CLOSE",          event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_ON_OPEN_ERROR",     event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_LINK_FAILED",       event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_MT_COMMAND_ANSWER", event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_MT_STATS_ANSWER",   event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_YUNO_STATS",        event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_SCENARIO_RUN_ENDED", event_flag_t.EVF_OUTPUT_EVENT]
    ];
    gclass_create("C_TEST_LINK", link_events, [["ST_IDLE", []]], {}, 0,
        [SDATA(data_type_t.DTP_POINTER, "iev", 0, null, "session"), SDATA_END()], {}, 0, 0, 0, 0);
    /*  The direct link (C_MONITOR_LINK): what the view sends it is kept,
     *  as what it sends through the console's link.  */
    gclass_create("C_TEST_MLINK",
        link_events.concat([["EV_CONNECT", 0], ["EV_DISCONNECT", 0], ["EV_SEND_COMMAND", 0]]),
        [["ST_IDLE", [
            ["EV_CONNECT", () => 0, null],
            ["EV_DISCONNECT", () => 0, null],
            ["EV_SEND_COMMAND", (gobj, event, kw) => {
                sent.push({command: kw.command, kw: kw.kw, direct: true});
                return 0;
            }, null]
        ]]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_YUI_UPLOT", [["EV_ADD_SERIE", 0], ["EV_LOAD_DATA", 0]],
        [["ST_IDLE", [["EV_ADD_SERIE", () => 0, null], ["EV_LOAD_DATA", (gobj, event, kw) => {
            chart_loads.push({chart: gobj_name(gobj), rows: Array.isArray(kw) ? kw.length : -1});
            return 0;
        }, null]]]],
        {}, 0, [
            SDATA(data_type_t.DTP_POINTER, "$container", 0, null, ""),
            SDATA(data_type_t.DTP_INTEGER, "width", 0, 0, ""),
            SDATA(data_type_t.DTP_INTEGER, "height", 0, 0, ""),
            SDATA(data_type_t.DTP_JSON, "scales", 0, null, ""),
            SDATA_END()
        ], {}, 0, 0, 0, 0);

    yuno = gobj_create_yuno("scenarios_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    const iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
    mlink = gobj_create_service("monitor_link", "C_TEST_MLINK", {}, yuno);
    config = gobj_create_service("agent_config", "C_AGENT_CONFIG", {}, yuno);
    gobj_start(config);
    test_shell.shell = gobj_create_service("shell", "C_TEST_SHELL", {}, yuno);
    host = gobj_create("host", "C_TEST_HOST", {}, yuno);
});

beforeEach(() => {
    logged.length = 0;
    sent.length = 0;
    modals.length = 0;
    navigated.length = 0;
    confirm.answer = true;
    confirm.asked.length = 0;
    agent_config_set_monitor(config, {scenario: {}, source: "local"});
    agent_config_set_permissions(config, null);
    sent.length = 0;
});

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

function new_monitor()
{
    const v = gobj_create(`monitor_${++n_views}`, "C_AGENT_MONITOR", {}, host);
    gobj_start(v);
    return v;
}

function new_list()
{
    const v = gobj_create(`list_${++n_views}`, "C_SCENARIOS", {}, host);
    gobj_start(v);
    return v;
}

/*  The answer of a request made on the console's link.  */
function answer(view, req, {result = 0, data = null, comment = "", outer} = {})
{
    gobj_send_event(view, "EV_MT_COMMAND_ANSWER", {
        result: result, comment: comment, data: data,
        __md_iev__: Object.assign({}, req.kw.__md_iev__, {
            command_stack: [{command: outer || req.command, kw: {}}]
        })
    }, link);
}

/*  The stats answer of a request relayed by the control center.  */
function stats_answer(view, req, {result = 0, data = {}, comment = ""} = {})
{
    gobj_send_event(view, "EV_MT_STATS_ANSWER", {
        result: result, comment: comment, data: data,
        __md_iev__: Object.assign({}, req.kw.__md_iev__, {
            command_stack: [{command: "stats-yuno", kw: {}}]
        })
    }, link);
}

function watch_saved(scenario)
{
    agent_config_set_monitor(config, {scenario: validate_scenario(scenario).scenario, source: "saved"});
}

const find = (cmd) => sent.filter((r) => r.command === cmd);

describe("the list of the control center's scenarios", () => {

    test("asks for them, shows them, and opens one in the live view", () => {
        const list = new_list();
        expect(find("scenarios").length).toBe(1);
        expect(gobj_current_state(list)).toBe("ST_LOADING");
        answer(list, find("scenarios")[0], {data: [
            Object.assign({}, SAVED, {runs: [{size: 3}], updated_at: 1790000000, updated_by: "ana"})
        ]});
        expect(gobj_current_state(list)).toBe("ST_READY");
        expect(gobj_read_attr(list, "tabulator").data).toEqual([{
            id: "stress", description: "sim -> gate", group: "", yunos: 2, runs: 3,
            updated_at: 1790000000, updated_by: "ana"
        }]);
        /*  When it was saved: the clock of 24 hours, whatever the language  */
        const col = gobj_read_attr(list, "tabulator").options.columns.find((c) => c.field === "updated_at");
        const when = col.formatter({getData: () => gobj_read_attr(list, "tabulator").data[0]});
        expect(when).toMatch(/\b\d{2}:\d{2}:\d{2}\b/);
        expect(when).not.toMatch(/AM|PM/i);

        gobj_send_event(list, "EV_OPEN_SCENARIO", {scenario_id: "stress"}, list);
        let m = agent_config_get_monitor(config);
        expect(m.source).toBe("saved");
        expect(m.scenario.id).toBe("stress");
        expect(navigated).toEqual(["/scenarios/live/stress"]);
        expect(errors()).toEqual([]);
    });

    test("shown again, it reads the list again: the runs counted may have moved", () => {
        const list = new_list();
        answer(list, find("scenarios")[0], {data: [Object.assign({}, SAVED, {runs: [{size: 1}]})]});
        expect(gobj_read_attr(list, "tabulator").data[0].runs).toBe(1);
        sent.length = 0;
        gobj_send_event(list, "EV_VISIBILITY", {visible: false}, list);
        expect(find("scenarios").length).toBe(0);
        gobj_send_event(list, "EV_VISIBILITY", {visible: true}, list);
        expect(find("scenarios").length).toBe(1);
        answer(list, find("scenarios")[0], {data: [Object.assign({}, SAVED, {runs: [{size: 2}]})]});
        expect(gobj_read_attr(list, "tabulator").data[0].runs).toBe(2);
        /*  while a read is in flight, being shown asks nothing more  */
        gobj_send_event(list, "EV_VISIBILITY", {visible: false}, list);
        gobj_send_event(list, "EV_REFRESH", {}, list);
        gobj_send_event(list, "EV_VISIBILITY", {visible: true}, list);
        expect(find("scenarios").length).toBe(2);
        expect(errors()).toEqual([]);
    });

    test("while it is read again, a row still opens, and a change is read after", () => {
        sent.length = 0;
        const list = new_list();
        answer(list, find("scenarios")[0], {data: [Object.assign({}, SAVED)]});
        gobj_send_event(list, "EV_REFRESH", {}, list);
        expect(gobj_current_state(list)).toBe("ST_LOADING");
        gobj_send_event(list, "EV_OPEN_SCENARIO", {scenario_id: "stress"}, list);
        expect(agent_config_get_monitor(config).scenario.id).toBe("stress");
        /*  that open was a change while loading: read once more after  */
        answer(list, find("scenarios")[1], {data: [Object.assign({}, SAVED)]});
        expect(find("scenarios").length).toBe(3);
        expect(gobj_current_state(list)).toBe("ST_LOADING");
        expect(errors()).toEqual([]);
    });

    test("a control center that keeps no scenario is said, not failed", () => {
        const list = new_list();
        answer(list, find("scenarios")[0], {result: -1,
            comment: "controlcenter^x: command not available: 'scenarios'. Try 'help' command."});
        expect(gobj_current_state(list)).toBe("ST_UNSUPPORTED");
        expect(errors()).toEqual([]);
    });
});

describe("the live view of a scenario the control center keeps", () => {

    test("follows the scenario written in the config, and connects through the control center", () => {
        const mon = new_monitor();
        expect(gobj_current_state(mon)).toBe("ST_DISCONNECTED");
        watch_saved(SAVED);
        expect(gobj_current_state(mon)).toBe("ST_MONITORING");
        expect(mon.priv.scenario.id).toBe("stress");
        expect(mon.priv.source).toBe("saved");
        /*  The control center builds the watch from the scenario: the
         *  console names the scenario and the node, never the agent's line  */
        let watch = find("watch-scenario");
        expect(watch.map((r) => [r.kw.scenario_id, r.kw.node, r.kw.keys])).toEqual([["stress", "ctrl", ""]]);
        expect(find("command-agent").filter((r) => /watch-yuno-stats/.test(r.kw.cmd2agent))).toEqual([]);
        /*  The control center passes the marker on to the agent only when
         *  its client wrote it (SDK 7.25.21)  */
        expect(watch[0].kw.__relays__).toEqual(["EV_YUNO_STATS"]);
        expect(errors()).toEqual([]);
    });

    test("a control center older than watch-scenario: the watch through command-agent", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        let ws = find("watch-scenario").pop();     /*  this view's: the last one created  */
        sent.length = 0;
        answer(mon, ws, {result: -1,
            comment: "controlcenter^x: command not available: 'watch-scenario'. Try 'help' command."});
        let watch = find("command-agent").filter((r) => /watch-yuno-stats/.test(r.kw.cmd2agent));
        expect(watch.map((r) => r.kw.agent_id)).toEqual(["ctrl"]);
        expect(watch[0].kw.__relays__).toEqual(["EV_YUNO_STATS"]);
        /*  and so it goes on: the stop too  */
        sent.length = 0;
        gobj_send_event(mon, "EV_DISCONNECT", {}, mon);
        expect(find("watch-scenario")).toEqual([]);
        expect(find("command-agent").map((r) => r.kw.cmd2agent)).toEqual(["watch-yuno-stats stop=1"]);
        expect(errors()).toEqual([]);
    });

    test("a yuno paused is left out of the watch by its key", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "gate"}, mon);
        expect(find("watch-scenario").map((r) => r.kw.keys)).toEqual(["sim"]);
        sent.length = 0;
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "sim"}, mon);
        expect(find("watch-scenario").map((r) => r.kw.stop)).toEqual([true]);
        expect(errors()).toEqual([]);
    });

    test("the route names the scenario: a link opens it, and the url says the one shown", () => {
        const mon = new_monitor();
        gobj_publish_event(test_shell.shell, "EV_ROUTE_CHANGED",
            {route: "/scenarios/live/stress", base: "/scenarios/live", subpath: "stress"});
        /*  Every live view of this run hears the shell: the last is this one  */
        let asked = find("scenarios");
        expect(asked.length > 0 && asked.every((r) => r.kw.scenario_id === "stress")).toBe(true);
        answer(mon, asked.pop(), {data: [SAVED]});
        expect(mon.priv.scenario.id).toBe("stress");
        expect(mon.priv.source).toBe("saved");
        expect(navigated).toEqual([]);      /*  the url already says it  */

        /*  The bare route: the url is given the scenario shown  */
        gobj_publish_event(test_shell.shell, "EV_ROUTE_CHANGED",
            {route: "/scenarios/live", base: "/scenarios/live", subpath: ""});
        expect(navigated.length > 0 && navigated.every((r) => r === "/scenarios/live/stress")).toBe(true);

        /*  One that cannot be opened (not there, or not this user's) says so  */
        sent.length = 0;
        gobj_publish_event(test_shell.shell, "EV_ROUTE_CHANGED",
            {route: "/scenarios/live/other", base: "/scenarios/live", subpath: "other"});
        answer(mon, find("scenarios").pop(), {result: -1, comment: "controlcenter^x: no permission to 'read-scenarios'"});
        expect(mon.priv.scenario.id).toBe("stress");
        expect(mon.priv.error.key).toBe("scenario not opened");

        /*  Another route is not this view's  */
        sent.length = 0;
        gobj_publish_event(test_shell.shell, "EV_ROUTE_CHANGED",
            {route: "/scenarios/list", base: "/scenarios/list", subpath: ""});
        expect(find("scenarios")).toEqual([]);
        expect(errors()).toEqual([]);
    });

    test("a run that ended anywhere is read again; while it runs, the line says when it stops", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_publish_event(link, "EV_SCENARIO_RUN_ENDED", {});
        let runs = find("scenario-runs").filter((r) => r.kw.scenario_id === "stress");
        let docs = find("scenarios").filter((r) => r.kw.scenario_id === "stress");
        expect(runs.length > 0 && docs.length > 0).toBe(true);
        answer(mon, runs.pop(), {data: [{action: "start", result: 0, steps: [{result: 0}]}]});
        expect(mon.priv.run_state).toBe("running");
        const at = Math.floor(Date.now() / 1000) + 2100;
        answer(mon, docs.pop(), {data: [Object.assign({}, SAVED, {stop_at: at})]});
        expect(mon.priv.stop_at).toBe(at);
        expect(mon.priv.$stop_at.classList.contains("is-hidden")).toBe(false);
        expect(mon.priv.$stop_at.textContent).toMatch(/\d{2}:\d{2}/);

        /*  Stopped (by its max_run, or by anybody): the line goes  */
        sent.length = 0;
        gobj_publish_event(link, "EV_SCENARIO_RUN_ENDED", {});
        answer(mon, find("scenario-runs").pop(), {data: [{action: "stop", result: 0, steps: [{result: 0}]}]});
        answer(mon, find("scenarios").pop(), {data: [SAVED]});
        expect(mon.priv.run_state).toBe("stopped");
        expect(mon.priv.$stop_at.classList.contains("is-hidden")).toBe(true);
        expect(errors()).toEqual([]);
    });

    test("a user who may only read the scenario: no controls, no edit, no command to the agents", () => {
        agent_config_set_permissions(config, {
            "read-scenarios": ["stress"], "run-scenarios": false, "write-scenarios": false,
            "command-agent": false, "list-agents": false
        });
        const mon = new_monitor();
        watch_saved(SAVED);
        gobj_send_event(mon, "EV_SET_VIEW_MODE", {mode: "cards"}, mon);
        expect(Object.keys(mon.priv.control_buttons)).toEqual([]);
        expect(mon.priv.$edit.classList.contains("is-hidden")).toBe(true);
        expect(mon.priv.$new.classList.contains("is-hidden")).toBe(true);
        expect(mon.priv.$delete.classList.contains("is-hidden")).toBe(true);
        expect(mon.priv.$runs.classList.contains("is-hidden")).toBe(false);
        let card = mon.priv.stats_cards.sim;
        expect(card.$once.classList.contains("is-hidden")).toBe(true);
        expect(card.$tree.classList.contains("is-hidden")).toBe(true);
        expect(card.$live.classList.contains("is-hidden")).toBe(false);
        /*  Nothing of this view through command-agent (the views of the
         *  tests before are alive too, and one of them asks that way)  */
        expect(find("command-agent").filter((r) =>
            r.kw.__md_iev__.monitor_gen === mon.priv.generation && mon.priv.cc_watch !== false)).toEqual([]);
        expect(find("watch-scenario").length > 0).toBe(true);

        /*  Given run-scenarios while it is open (the control center told
         *  it, C_APP asked again): the controls appear, no reload  */
        agent_config_set_permissions(config, {
            "read-scenarios": ["stress"], "run-scenarios": ["stress"], "command-agent": false
        });
        expect(Object.keys(mon.priv.control_buttons)).toEqual(["start", "stop", "report", "restart"]);
        /*  and taken away again  */
        agent_config_set_permissions(config, {
            "read-scenarios": ["stress"], "run-scenarios": false, "command-agent": false
        });
        expect(Object.keys(mon.priv.control_buttons)).toEqual([]);
        expect(errors()).toEqual([]);
    });

    test("an action is RUN by the control center, and its answer is the run", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_TEST_CONFIRMED", {control: "report"}, mon);
        let runs = find("run-scenario");
        expect(runs.length).toBe(1);
        expect(runs[0].kw).toMatchObject({scenario_id: "stress", action: "report"});
        expect(find("command-agent").length).toBe(0);     /*  nothing sent to the agents from here  */
        expect(mon.priv.control.running).toBe(true);

        answer(mon, runs[0], {comment: "controlcenter^x: run stress.1: report done, 1 steps", data: [{
            id: "stress.1", result: 0,
            steps: [{yuno: "gate", line: "command-yuno id=2120 service=__yuno__ command=view-config",
                     result: 0, comment: "", data: {a: 1}}]
        }]});
        expect(mon.priv.control.ok).toBe(true);
        expect(mon.priv.control.running).toBe(false);
        expect(mon.priv.control.outputs).toEqual([{yuno: "gate",
            line: "command-yuno id=2120 service=__yuno__ command=view-config",
            result: 0, comment: "", data: {a: 1}}]);

        gobj_send_event(mon, "EV_SHOW_OUTPUT", {}, mon);
        expect(modals.length).toBe(1);
        expect(errors()).toEqual([]);
    });

    test("restart: the stop is run, the counters go to zero, and then the start", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_TEST_CONFIRMED", {control: "restart"}, mon);
        let stop = find("run-scenario");
        expect(stop.map((r) => r.kw.action)).toEqual(["stop"]);
        answer(mon, stop[0], {data: [{id: "stress.2", result: 0, steps: []}]});
        let resets = find("command-agent").filter((r) => /stats=__reset__/.test(r.kw.cmd2agent));
        expect(resets.length).toBe(2);
        /*  The start waits for every reset: a counter zeroed after the
         *  start would wipe the first figures of the new run.  */
        expect(find("run-scenario").map((r) => r.kw.action)).toEqual(["stop"]);
        expect(mon.priv.control_buttons.start.disabled).toBe(true);
        answer(mon, resets[0]);                         /*  the dispatch ack: not the answer  */
        stats_answer(mon, resets[0]);
        expect(find("run-scenario").map((r) => r.kw.action)).toEqual(["stop"]);
        answer(mon, resets[1], {result: -1, comment: "Yuno not found", outer: "stats-yuno"});
        expect(find("run-scenario").map((r) => r.kw.action)).toEqual(["stop", "start"]);
        answer(mon, find("run-scenario")[1], {data: [{id: "stress.3", result: 0, steps: []}]});
        expect(mon.priv.control.running).toBe(false);
        expect(mon.priv.control.ok).toBe(true);
        expect(mon.priv.control_buttons.start.disabled).toBe(false);
        expect(errors()).toEqual([]);
    });

    test("one control at a time, and an answer of another one is dropped", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_TEST_CONFIRMED", {control: "report"}, mon);
        let first = find("run-scenario")[0];
        gobj_send_event(mon, "EV_TEST_CONFIRMED", {control: "report"}, mon);
        expect(find("run-scenario").length).toBe(1);     /*  refused, not sent  */
        answer(mon, first, {data: [{id: "stress.4", result: 0, steps: []}]});
        expect(mon.priv.control.running).toBe(false);
        answer(mon, first, {data: [{id: "stress.4", result: 0, steps: []}]});
        expect(logged.some((l) => /no longer waited for/.test(l.msg))).toBe(true);
        expect(errors()).toEqual([]);
    });

    test("a readings answer of the scenario shown before is dropped", () => {
        sent.length = 0;
        const mon = new_monitor();
        watch_saved(Object.assign({}, SAVED, {id: "before"}));
        let watch = find("watch-scenario").pop();
        answer(mon, watch, {result: -1, comment: "Yuno not found", outer: "watch-yuno-stats"});
        let cpu = find("command-agent").filter((r) => /service=__yuno__/.test(r.kw.cmd2agent))[0];
        watch_saved(Object.assign({}, SAVED, {id: "other"}));
        stats_answer(mon, cpu, {data: {cpu: 77}});
        expect(Object.values(mon.priv.model).some((m) => m.cpu === 77)).toBe(false);
        expect(errors()).toEqual([]);
    });

    test("save: the same scenario is written again at once, another name is asked first", async () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_EDIT_SCENARIO", {}, mon);
        let text = mon.priv.$text.value;
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: text}, mon);
        let saves = find("save-scenario");
        expect(saves.length).toBe(1);
        expect(saves[0].kw.scenario.id).toBe("stress");
        expect(saves[0].kw.scenario.place).toBe(undefined);
        expect(confirm.asked).toEqual([]);
        answer(mon, saves[0], {comment: "saved", data: [Object.assign({}, SAVED, {description: "new"})]});
        expect(agent_config_get_monitor(config).scenario.description).toBe("new");

        sent.length = 0;
        let other = JSON.parse(text);
        other.id = "stress-copy";
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: JSON.stringify(other)}, mon);
        expect(find("save-scenario").length).toBe(0);
        expect(confirm.asked.map((a) => a.kind)).toEqual(["yesno"]);
        await Promise.resolve();
        await Promise.resolve();
        expect(find("save-scenario").map((r) => r.kw.scenario.id)).toEqual(["stress-copy"]);
    });

    test("save: over the revision it was read at, and told when somebody saved it since", () => {
        const mon = new_monitor();
        agent_config_set_monitor(config, {scenario: validate_scenario(
            Object.assign({}, SAVED, {__md_treedb__: {g_rowid: 7}})).scenario, source: "saved"});
        sent.length = 0;
        gobj_send_event(mon, "EV_EDIT_SCENARIO", {}, mon);
        expect(mon.priv.$text.value).not.toMatch(/revision|__md_treedb__/);
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: mon.priv.$text.value}, mon);
        let save = find("save-scenario")[0];
        expect(save.kw.revision).toBe(7);
        expect(save.kw.scenario.revision).toBe(undefined);
        answer(mon, save, {data: [Object.assign({}, SAVED, {__md_treedb__: {g_rowid: 8}})]});
        expect(agent_config_get_monitor(config).scenario.revision).toBe(8);

        sent.length = 0;
        gobj_send_event(mon, "EV_EDIT_SCENARIO", {}, mon);
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: mon.priv.$text.value}, mon);
        save = find("save-scenario")[0];
        expect(save.kw.revision).toBe(8);
        answer(mon, save, {result: -1, comment: "controlcenter^x: scenario 'stress' was saved by " +
            "ana since you read it (revision 9, yours 8): read it again"});
        expect(mon.priv.$edit_error.querySelector(".MONITOR_SCENARIO_ERROR_TEXT")
            .getAttribute("data-i18n")).toBe("scenario changed since read");
        expect(agent_config_get_monitor(config).scenario.revision).toBe(8);
        expect(errors()).toEqual([]);
    });

    test("a control center that keeps no scenario: saved in the browser", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_EDIT_SCENARIO", {}, mon);
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: mon.priv.$text.value}, mon);
        answer(mon, find("save-scenario")[0], {result: -1,
            comment: "controlcenter^x: command not available: 'save-scenario'. Try 'help' command."});
        expect(agent_config_get_monitor(config).source).toBe("local");
        expect(mon.priv.cc_scenarios).toBe(false);
        /*  and from then on, what is saved stays in the browser without asking  */
        sent.length = 0;
        gobj_send_event(mon, "EV_EDIT_SCENARIO", {}, mon);
        gobj_send_event(mon, "EV_SAVE_SCENARIO", {text: mon.priv.$text.value}, mon);
        expect(find("save-scenario").length).toBe(0);
    });

    test("delete: asked in red, then the view is left without a scenario", async () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_DELETE_SCENARIO", {}, mon);
        expect(confirm.asked.map((a) => a.kind)).toEqual(["danger"]);
        await Promise.resolve();
        await Promise.resolve();
        let del = find("delete-scenario");
        expect(del.map((r) => r.kw.scenario_id)).toEqual(["stress"]);
        answer(mon, del[0], {comment: "deleted"});
        expect(agent_config_get_monitor(config).scenario).toBe(null);
        expect(mon.priv.scenario).toBe(null);
        expect(gobj_current_state(mon)).toBe("ST_DISCONNECTED");
    });

    test("runs: asked of the control center and shown", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        sent.length = 0;
        gobj_send_event(mon, "EV_SHOW_RUNS", {}, mon);
        let r = find("scenario-runs");
        expect(r.map((x) => x.kw.scenario_id)).toEqual(["stress"]);
        answer(mon, r[0], {data: [{id: "stress.1", action: "start", username: "ana", result: 0,
                                   started_at: 1790000000, steps: []}]});
        expect(modals.map((m) => m.opts.logical_class)).toEqual(["MONITOR_RUNS_DIALOG"]);
        /*  The clock of 24 hours, whatever the language (gobj-ui 7.26.52)  */
        const when = modals[0].$content.querySelector(".MONITOR_RUN_WHEN").textContent;
        expect(when).toMatch(/\b\d{2}:\d{2}:\d{2}\b/);
        expect(when).not.toMatch(/AM|PM/i);
        expect(errors()).toEqual([]);
    });
});

describe("a scenario that is not the control center's", () => {

    test("is run from here: every step to its agent", () => {
        const mon = new_monitor();
        agent_config_set_monitor(config, {scenario: validate_scenario(SAVED).scenario, source: "local"});
        sent.length = 0;
        gobj_send_event(mon, "EV_TEST_CONFIRMED", {control: "start"}, mon);
        expect(find("run-scenario").length).toBe(0);
        let steps = find("command-agent").filter((r) => /set-controllers/.test(r.kw.cmd2agent));
        expect(steps.map((r) => [r.kw.agent_id, r.kw.cmd2agent])).toEqual([
            ["ctrl", "command-yuno id=stress service=sim_controllers command=set-controllers controllers=10"]
        ]);
    });

    test("an agent reached directly is asked to push with the marker it requires", () => {
        const mon = new_monitor();
        const direct = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993"});
        delete direct.node;
        agent_config_set_monitor(config, {scenario: validate_scenario(direct).scenario, source: "local"});
        expect(mon.priv.scenario.place).toBe("direct");
        sent.length = 0;
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        /*  The agent refuses a watch-yuno-stats whose requester does not
         *  say it takes EV_YUNO_STATS (SDK 7.25.21).  */
        let watch = sent.filter((r) => r.direct && /^watch-yuno-stats /.test(r.command));
        expect(watch.length).toBe(1);
        expect(watch[0].kw.__relays__).toEqual(["EV_YUNO_STATS"]);
        expect(errors()).toEqual([]);
    });

    test("yunos ticked BEFORE the live view exists are what it shows when it opens", () => {
        /*  The live tab is created the first time it is visited; the tree
         *  tab is used before that.  */
        agent_config_toggle_selected_node(config, "scenarios",
            {id: stats_sel_id("local", "2020"), host: "gate_central^2020"});
        const mon = new_monitor();
        expect(mon.priv.source).toBe("selection");
        expect(mon.priv.scenario.yunos.map((y) => y.id)).toEqual(["2020"]);
        expect(gobj_current_state(mon)).toBe("ST_MONITORING");
        agent_config_toggle_selected_node(config, "scenarios",
            {id: stats_sel_id("local", "2020"), host: "gate_central^2020"});
        expect(mon.priv.scenario).toBe(null);
    });

    test("the yunos ticked in the tree are watched as cards", () => {
        const mon = new_monitor();
        agent_config_toggle_selected_node(config, "scenarios",
            {id: stats_sel_id("wattyzer", "1620"), host: "db_history^1620"});
        let m = agent_config_get_monitor(config);
        expect(m.source).toBe("selection");
        expect(mon.priv.scenario.yunos.map((y) => [y.id, y.node, y.label]))
            .toEqual([["1620", "wattyzer", "db_history^1620"]]);
        expect(mon.priv.view_mode).toBe("cards");
        expect(gobj_current_state(mon)).toBe("ST_MONITORING");

        /*  a tick in another workspace's tree is not ours  */
        agent_config_toggle_selected_node(config, "users",
            {id: stats_sel_id("wattyzer", "1996"), host: "cc"});
        expect(mon.priv.scenario.yunos.length).toBe(1);

        /*  none ticked, none watched  */
        agent_config_toggle_selected_node(config, "scenarios",
            {id: stats_sel_id("wattyzer", "1620"), host: "db_history^1620"});
        expect(mon.priv.scenario).toBe(null);
        expect(errors()).toEqual([]);
    });

    test("a yuno paused leaves the watch; with none live the agent is asked to stop", () => {
        const mon = new_monitor();
        const direct = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993"});
        delete direct.node;
        agent_config_set_monitor(config, {scenario: validate_scenario(direct).scenario, source: "local"});
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        const watches = () => sent.filter((r) => r.direct && /^watch-yuno-stats /.test(r.command))
            .map((r) => r.command);
        expect(watches()).toEqual(["watch-yuno-stats ids=stress:sim_controllers,2120 period=2000"]);

        sent.length = 0;
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "sim"}, mon);
        expect(watches()).toEqual(["watch-yuno-stats ids=2120 period=2000"]);
        expect(mon.priv.stats_cards.sim.$paused.classList.contains("is-hidden")).toBe(false);

        /*  a reading the watch before the pause still pushes is dropped  */
        gobj_send_event(mon, "EV_YUNO_STATS", {
            data: {yuno_id: "stress", kind: "cpu", result: 0, data: {cpu: 7}},
            __md_iev__: {monitor_kind: "watch", monitor_gen: mon.priv.generation, monitor_node: ""}
        }, mlink);
        expect(mon.priv.model.sim.cpu).toBe(null);

        sent.length = 0;
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "gate"}, mon);
        expect(watches()).toEqual(["watch-yuno-stats stop=1"]);
        /*  asked to stop once: the renewal sends nothing  */
        sent.length = 0;
        gobj_send_event(mon, "EV_TIMEOUT_PERIODIC", {}, mon);
        mon.priv.watch_at = {};
        gobj_send_event(mon, "EV_TIMEOUT_PERIODIC", {}, mon);
        expect(watches()).toEqual([]);

        sent.length = 0;
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "sim"}, mon);
        expect(watches()).toEqual(["watch-yuno-stats ids=stress:sim_controllers period=2000"]);
        expect(mon.priv.stats_cards.sim.$paused.classList.contains("is-hidden")).toBe(true);
        expect(errors()).toEqual([]);
        expect(logged.filter((l) => l.level === "warning")).toEqual([]);
    });

    test("a yuno paused in the cards mode says so in the graph mode too", () => {
        const mon = new_monitor();
        const direct = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993",
            view: {mode: "cards"}});
        delete direct.node;
        agent_config_set_monitor(config, {scenario: validate_scenario(direct).scenario, source: "local"});
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "gate"}, mon);
        gobj_send_event(mon, "EV_SET_VIEW_MODE", {mode: "graph"}, mon);
        const node = (key) => mon.priv.cards[key].$card;
        const paused = (key) => node(key).querySelector(".MONITOR_NODE_PAUSED");
        expect(paused("gate").classList.contains("is-hidden")).toBe(false);
        expect(paused("gate").getAttribute("data-i18n")).toBe("monitor readings paused");
        expect(paused("sim").classList.contains("is-hidden")).toBe(true);

        gobj_send_event(mon, "EV_TOGGLE_LIVE", {key: "gate"}, mon);
        expect(paused("gate").classList.contains("is-hidden")).toBe(true);
        expect(errors()).toEqual([]);
    });

    test("read once asks for one yuno, and its state paints that card only", () => {
        const mon = new_monitor();
        const direct = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993"});
        delete direct.node;
        agent_config_set_monitor(config, {scenario: validate_scenario(direct).scenario, source: "local"});
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        sent.length = 0;
        gobj_send_event(mon, "EV_READ_ONCE", {key: "gate"}, mon);
        expect(sent.map((r) => r.command)).toEqual([
            "list-yunos id=2120",
            "stats-yuno id=2120 service=__yuno__",
            "stats-yuno id=2120"
        ]);
        answer(mon, sent[0], {data: [{id: "2120", yuno_running: true, yuno_playing: true}]});
        expect(mon.priv.model.gate.run).toBe("playing");
        expect(mon.priv.model.sim.run).toBe("unknown");
        /*  "updated at": a clock of 24 hours, whatever the language  */
        stats_answer(mon, sent[1], {data: {cpu: 3}});
        expect(mon.priv.last_update).toBeGreaterThan(0);
        expect(mon.priv.$updated_time.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(errors()).toEqual([]);
    });
});

describe("the gobj tree of a yuno of the live view", () => {
    const DIRECT = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993"});
    delete DIRECT.node;

    const TREE = {
        "C_YUNO^gate": {
            gclass: "C_YUNO", name: "gate", fullname: "C_YUNO^gate", gobj_trace_level: [],
            children: {
                "C_TCP^tcp1": {gclass: "C_TCP", name: "tcp1", fullname: "C_YUNO^gate`C_TCP^tcp1",
                               gobj_trace_level: ["traffic"], children: {}}
            }
        }
    };

    function open_gate()
    {
        const mon = new_monitor();
        agent_config_set_monitor(config, {scenario: validate_scenario(DIRECT).scenario, source: "local"});
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        sent.length = 0;
        tree_double.got.length = 0;
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        return mon;
    }

    const lines = () => sent.filter((r) => r.direct && /^command-yuno /.test(r.command));
    const reply = (mon, req, data, result = 0) => answer(mon, req, {data: data, result: result});

    const TREE_OPTIONS = '["fullname","shortname","gclass","name","parent","state","running",' +
        '"playing","service","disabled","volatil","gobj_flags","gobj_trace_level","bottom_gobj","commands",' +
        '"play_methods"]';
    const cmd = (r) => r.command.replace(/^command-yuno id=2120 service=__yuno__ command=/, "");

    test("opens with the tree of the yuno, read through the view's transport", () => {
        const mon = open_gate();
        expect(lines().map(cmd)).toEqual([
            `view-gobj-tree options=${TREE_OPTIONS}`, "get-gclass-trace", "get-global-trace"
        ]);
        expect(lines()[0].kw.__md_iev__.monitor_kind).toBe("ytree");
        const [tree, gon, glon] = lines();
        reply(mon, tree, TREE);
        expect(tree_double.got).toEqual([]);    /*  the three, or nothing  */
        reply(mon, gon, [{gclass: "C_TCP", trace_levels: ["connections"]}]);
        reply(mon, glon, []);
        expect(tree_double.got.map((g) => g.event)).toEqual(["EV_LOAD_TREE"]);
        expect(tree_double.got[0].kw.tree).toEqual(TREE);
        /*  tcp1 traces `traffic`, which its gclass does not hold  */
        expect(mon.priv.ytrees.gate.priv.own_traces).toBe(1);
        expect(mon.priv.ytrees.gate.priv.gclass_traces).toBe(1);
        expect(errors()).toEqual([]);
    });

    test("a gobj whose traces all come from its gclass has none of its own", () => {
        const mon = open_gate();
        const [tree, gon, glon] = lines();
        reply(mon, tree, TREE);
        reply(mon, gon, [{gclass: "C_TCP", trace_levels: ["traffic"]}]);
        reply(mon, glon, []);
        expect(mon.priv.ytrees.gate.priv.own_traces).toBe(0);
        expect(tree_double.got.map((g) => g.event)).toEqual(["EV_LOAD_TREE"]);
    });

    test("a card's gclass: its four trace answers reach the tree as one", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        sent.length = 0;
        gobj_send_event(child, "EV_TRACE_INFO_WANTED", {gclass: "C_TCP"}, child);
        expect(lines().map((r) => r.command.replace(/^command-yuno id=2120 service=__yuno__ command=/, "")))
            .toEqual(["info-gclass-trace gclass=C_TCP", "info-global-trace",
                      "get-gclass-trace gclass=C_TCP", "get-global-trace"]);
        const [lv, glv, on, gon] = lines();
        reply(mon, lv, [{gclass: "C_TCP", trace_levels: {traffic: "dump", connections: "conn"}}]);
        reply(mon, glv, [{trace_levels: {machine: "machine"}}]);
        reply(mon, on, []);
        expect(tree_double.got.filter((g) => g.event === "EV_TRACE_INFO")).toEqual([]);
        reply(mon, gon, ["machine"]);
        expect(tree_double.got.filter((g) => g.event === "EV_TRACE_INFO").map((g) => g.kw)).toEqual([{
            gclass: "C_TCP", error: "",
            gclass_levels: {traffic: "dump", connections: "conn"},
            global_levels: {machine: "machine"},
            gclass_on: [], global_on: ["machine"], set_id: null
        }]);
        expect(errors()).toEqual([]);
    });

    test("a trace set: one command per level, then the tree and the levels are read again", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        sent.length = 0;
        gobj_send_event(child, "EV_SET_TRACE_LEVEL", {scope: "gobj", gobj: "C_YUNO^gate`C_TCP^tcp1",
            gclass: "C_TCP", levels: ["traffic", "machine"], set: false}, child);
        expect(lines().map((r) => r.command.replace(/^command-yuno id=2120 service=__yuno__ command=/, "")))
            .toEqual(["set-gobj-trace gobj=C_YUNO^gate`C_TCP^tcp1 level=traffic set=0",
                      "set-gobj-trace gobj=C_YUNO^gate`C_TCP^tcp1 level=machine set=0"]);
        const sets = lines();
        sent.length = 0;
        reply(mon, sets[0], []);
        expect(lines()).toEqual([]);
        reply(mon, sets[1], []);
        expect(lines().map(cmd))
            .toEqual([`view-gobj-tree options=${TREE_OPTIONS}`, "get-gclass-trace", "get-global-trace",
                      "info-gclass-trace gclass=C_TCP", "info-global-trace",
                      "get-gclass-trace gclass=C_TCP", "get-global-trace"]);

        sent.length = 0;
        gobj_send_event(child, "EV_SET_TRACE_LEVEL", {scope: "gclass", gobj: "C_YUNO^gate`C_TCP^tcp1",
            gclass: "C_TCP", levels: ["connections"], set: true}, child);
        expect(lines().map((r) => r.command.replace(/^command-yuno id=2120 service=__yuno__ command=/, "")))
            .toEqual(["set-gclass-trace gclass=C_TCP level=connections set=1"]);

        /*  The yuno's scope: set-global-trace, then the root's gclass is
         *  read again -- its answer carries the yuno's levels.  */
        const gsets = lines();
        reply(mon, gsets[0], []);
        sent.length = 0;
        gobj_send_event(child, "EV_SET_TRACE_LEVEL", {scope: "global", gobj: "C_YUNO^gate",
            gclass: "C_YUNO", levels: ["ev_kw"], set: true}, child);
        const globals = lines();
        expect(globals.map(cmd)).toEqual(["set-global-trace level=ev_kw set=1"]);
        sent.length = 0;
        reply(mon, globals[0], []);
        expect(lines().map(cmd).slice(3))
            .toEqual(["info-gclass-trace gclass=C_YUNO", "info-global-trace",
                      "get-gclass-trace gclass=C_YUNO", "get-global-trace"]);
        expect(errors()).toEqual([]);
    });

    /*  gobj-ui 7.27.33: an answer says which set it follows, so a read
     *  asked BEFORE a set and answered after it cannot unlock what the
     *  set locked (REV-CLOUD V40.2).  */
    test("the answers read after a set carry its set_id; any other read, null", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        const [tree, gon, glon] = lines();
        reply(mon, tree, TREE);
        reply(mon, gon, []);
        reply(mon, glon, []);
        expect(tree_double.got.map((g) => [g.event, g.kw.set_id])).toEqual([["EV_LOAD_TREE", null]]);
        const infos = () => tree_double.got.filter((g) => g.event === "EV_TRACE_INFO")
            .map((g) => [g.kw.gclass, g.kw.set_id]);
        const answer_info = (reqs) => {
            reply(mon, reqs[0], [{gclass: "C_TCP", trace_levels: {traffic: "dump"}}]);
            reply(mon, reqs[1], [{trace_levels: {machine: "machine"}}]);
            reply(mon, reqs[2], []);
            reply(mon, reqs[3], []);
        };

        /*  a card is opened: its read is asked, not answered yet  */
        sent.length = 0;
        gobj_send_event(child, "EV_TRACE_INFO_WANTED", {gclass: "C_TCP"}, child);
        const card_read = lines();
        expect(card_read.length).toBe(4);

        /*  a box is ticked before the answer  */
        sent.length = 0;
        gobj_send_event(child, "EV_SET_TRACE_LEVEL", {scope: "gobj", gobj: "C_YUNO^gate`C_TCP^tcp1",
            gclass: "C_TCP", levels: ["machine"], set: true, set_id: 7}, child);
        const set = lines();
        expect(set.map(cmd)).toEqual(["set-gobj-trace gobj=C_YUNO^gate`C_TCP^tcp1 level=machine set=1"]);

        /*  the card's read arrives: it is no set's  */
        tree_double.got.length = 0;
        answer_info(card_read);
        expect(infos()).toEqual([["C_TCP", null]]);

        /*  the set is answered: the tree and C_TCP are read again, as the set's  */
        sent.length = 0;
        reply(mon, set[0], []);
        const after = lines();
        expect(after.length).toBe(7);
        tree_double.got.length = 0;
        reply(mon, after[0], TREE);
        reply(mon, after[1], []);
        reply(mon, after[2], []);
        answer_info(after.slice(3));
        expect(tree_double.got.map((g) => [g.event, g.kw.set_id]))
            .toEqual([["EV_LOAD_TREE", 7], ["EV_TRACE_INFO", 7]]);

        /*  the viewer's own read after a set of the yuno's scope carries it too  */
        sent.length = 0;
        tree_double.got.length = 0;
        gobj_send_event(child, "EV_TRACE_INFO_WANTED", {gclass: "C_TCP", set_id: 8}, child);
        answer_info(lines());
        expect(infos()).toEqual([["C_TCP", 8]]);
        expect(errors()).toEqual([]);
    });

    test("a read asked again before the set's own read is answered keeps the set's number", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        const [tree, gon, glon] = lines();
        reply(mon, tree, TREE);
        reply(mon, gon, []);
        reply(mon, glon, []);

        sent.length = 0;
        gobj_send_event(child, "EV_SET_TRACE_LEVEL", {scope: "gclass", gobj: "",
            gclass: "C_TCP", levels: ["traffic"], set: true, set_id: 3}, child);
        const set = lines();
        sent.length = 0;
        reply(mon, set[0], []);
        expect(lines().length).toBe(7);     /*  the set's reads, not answered yet  */

        /*  Refresh and the card, pressed now: their reads overtake the
         *  set's -- and are after the set, so they answer it  */
        sent.length = 0;
        gobj_send_event(child, "EV_TREE_WANTED", {}, child);
        gobj_send_event(child, "EV_TRACE_INFO_WANTED", {gclass: "C_TCP"}, child);
        const again = lines();
        expect(again.length).toBe(7);
        tree_double.got.length = 0;
        reply(mon, again[0], TREE);
        reply(mon, again[1], []);
        reply(mon, again[2], []);
        reply(mon, again[3], [{gclass: "C_TCP", trace_levels: {traffic: "dump"}}]);
        reply(mon, again[4], [{trace_levels: {machine: "machine"}}]);
        reply(mon, again[5], []);
        reply(mon, again[6], []);
        expect(tree_double.got.map((g) => [g.event, g.kw.set_id]))
            .toEqual([["EV_LOAD_TREE", 3], ["EV_TRACE_INFO", 3]]);
        expect(errors()).toEqual([]);
    });

    test("out of session a request is answered with an error at once", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        gobj_send_event(mon, "EV_DISCONNECT", {}, mon);
        sent.length = 0;
        gobj_send_event(child, "EV_TREE_WANTED", {}, child);
        expect(lines()).toEqual([]);
        expect(child.priv.error).toEqual({key: "monitor disconnected"});
        expect(errors()).toEqual([]);
    });

    test("opened twice is one window; closed by the reader, it is gone on the next turn", async () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        const opened = tree_double.opened.length;
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        expect(tree_double.opened.length).toBe(opened);
        expect(mon.priv.ytrees.gate).toBe(child);

        gobj_send_event(child, "EV_VIEW_CLOSED", {}, child);
        expect(mon.priv.ytrees.gate).toBe(child);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mon.priv.ytrees.gate).toBe(undefined);
        expect(errors()).toEqual([]);
    });

    test("a tree whose key now names the yuno of another node is closed, not re-aimed", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        const handle = tree_double.opened[tree_double.opened.length - 1];
        const child = mon.priv.ytrees.gate;
        expect(find("command-agent").filter((r) => /command=view-gobj-tree/.test(r.kw.cmd2agent))
            .map((r) => r.kw.agent_id)).toEqual(["ctrl"]);

        /*  the same yuno in another scenario: the tree stays  */
        watch_saved(Object.assign({}, SAVED, {description: "the same yunos"}));
        expect(mon.priv.ytrees.gate).toBe(child);

        /*  `gate` is now the 2120 of another node: its tree is not that one  */
        sent.length = 0;
        watch_saved(Object.assign({}, SAVED, {node: "other"}));
        expect(mon.priv.ytrees.gate).toBe(undefined);
        expect(handle.closed).toBe(true);
        expect(find("command-agent").filter((r) => /service=__yuno__ command=/.test(r.kw.cmd2agent)
            && r.kw.agent_id === "other" && !/stats-yuno|list-yunos/.test(r.kw.cmd2agent))).toEqual([]);
        expect(errors()).toEqual([]);
    });

    test("a request goes to the node of the tree that asks it, and only a tree asks", () => {
        const mon = new_monitor();
        watch_saved(SAVED);
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        const child = mon.priv.ytrees.gate;
        sent.length = 0;
        gobj_send_event(child, "EV_TREE_WANTED", {}, child);
        expect(find("command-agent").map((r) => r.kw.agent_id)).toEqual(["ctrl", "ctrl", "ctrl"]);

        sent.length = 0;
        gobj_send_event(mon, "EV_YUNO_TREE_REQUEST", {key: "gate", what: "set", seq: 99,
            line: "command-yuno id=2120 service=__yuno__ command=set-global-trace level=machine set=1"}, host);
        expect(sent).toEqual([]);
        expect(errors().some((m) => /not the gobj tree of 'gate'/.test(m))).toBe(true);
    });

    test("two cards of one yuno: each tree has its own window", () => {
        const mon = new_monitor();
        const two = Object.assign({}, SAVED, {
            yunos: SAVED.yunos.concat([{key: "gate_tcp", id: "2120", service: "tcp"}])
        });
        expect(validate_scenario(two).ok).toBe(true);
        watch_saved(two);
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate_tcp"}, mon);
        const names = tree_double.opened.slice(-2).map((h) => h.opts.name);
        expect(names[0]).not.toBe(names[1]);
        expect(errors()).toEqual([]);
    });

    /*  The window is a SERVICE, named by the card's node and key, and
     *  both may hold a `-` (NAME_RE), and a `^` that clean_name() turns
     *  into the `_` another may hold: none of these pairs may share a
     *  name ("service ALREADY registered", the second tree not opened).  */
    /*  gobj-js registers and finds a service by its name LOWERCASED, so
     *  two names that differ only in case are one service too: the keys
     *  `Gate` and `gate` of one node, or of the nodes `Central` and
     *  `central` (REV-CLOUD V40.3.2).  */
    test("two cards whose node and key read alike still get two windows", () => {
        const window_name = (h) => clean_name(h.opts.name);
        for(const [one, two] of [
            [{key: "b-c", id: "2120", node: "a"},   {key: "c", id: "2121", node: "a-b"}],
            [{key: "x^y", id: "2120", node: "n"},   {key: "x_y", id: "2121", node: "n"}],
            [{key: "Gate", id: "2120", node: "n"},  {key: "gate", id: "2121", node: "n"}],
            [{key: "Gate", id: "2120", node: "Central"}, {key: "gate", id: "2121", node: "central"}],
        ]) {
            const mon = new_monitor();
            const sc = Object.assign({}, SAVED, {yunos: [one, two], links: [],
                actions: {start: [{yuno: one.key, command: "x"}]}});
            const v = validate_scenario(sc);
            expect(v.ok, JSON.stringify(v.error)).toBe(true);
            watch_saved(sc);
            gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: one.key}, mon);
            gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: two.key}, mon);
            const names = tree_double.opened.slice(-2).map(window_name);
            expect(names[0].toLowerCase(), JSON.stringify([one, two]))
                .not.toBe(names[1].toLowerCase());
            /*  what clean_name() would change is not in it  */
            expect(names.map((n) => tree_double.opened.slice(-2)
                .some((h) => h.opts.name === n))).toEqual([true, true]);
        }
        expect(errors()).toEqual([]);
    });

    test("asked to show a window it does not have, the tree says so and opens one", () => {
        const mon = open_gate();
        const child = mon.priv.ytrees.gate;
        child.priv.view = null;     /*  as when the window could not be opened  */
        const opened = tree_double.opened.length;
        gobj_send_event(mon, "EV_OPEN_YUNO_TREE", {key: "gate"}, mon);
        expect(errors().some((m) => /no window/.test(m))).toBe(true);
        expect(tree_double.opened.length).toBe(opened + 1);
        expect(child.priv.view).toBe(tree_double.opened[opened]);
    });

    test("a tree whose yuno leaves the scenario is closed with it", () => {
        const mon = open_gate();
        const handle = tree_double.opened[tree_double.opened.length - 1];
        const fewer = Object.assign({}, DIRECT, {yunos: [DIRECT.yunos[0]], links: [],
            actions: {start: DIRECT.actions.start, stop: DIRECT.actions.stop}});
        expect(validate_scenario(fewer).ok).toBe(true);
        agent_config_set_monitor(config, {scenario: validate_scenario(fewer).scenario, source: "local"});
        expect(mon.priv.ytrees.gate).toBe(undefined);
        expect(handle.closed).toBe(true);
        expect(errors()).toEqual([]);
    });
});

describe("the charts of the graph mode", () => {
    test("in the cards mode the history is kept but no hidden chart is redrawn", () => {
        const mon = new_monitor();
        const direct = Object.assign({}, SAVED, {agent_url: "wss://agent.example.com:1993",
            view: {mode: "cards"}});
        delete direct.node;
        agent_config_set_monitor(config, {scenario: validate_scenario(direct).scenario, source: "local"});
        expect(mon.priv.view_mode).toBe("cards");
        gobj_send_event(mon, "EV_ON_OPEN", {}, mlink);
        chart_loads.length = 0;
        gobj_send_event(mon, "EV_TIMEOUT_PERIODIC", {}, mon);
        gobj_send_event(mon, "EV_TIMEOUT_PERIODIC", {}, mon);
        expect(mon.priv.rows.length).toBeGreaterThan(0);
        expect(chart_loads).toEqual([]);

        gobj_send_event(mon, "EV_SET_VIEW_MODE", {mode: "graph"}, mon);
        expect(chart_loads.map((l) => [l.chart, l.rows])).toEqual([
            ["rate_chart", mon.priv.rows.length], ["cpu_chart", mon.priv.rows.length]
        ]);
        chart_loads.length = 0;
        gobj_send_event(mon, "EV_TIMEOUT_PERIODIC", {}, mon);
        expect(chart_loads.map((l) => l.chart)).toEqual(["rate_chart", "cpu_chart"]);
        expect(errors()).toEqual([]);
    });
});
