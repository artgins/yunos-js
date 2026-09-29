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
    gobj_start, gobj_send_event, gobj_current_state, gobj_change_state,
    gobj_read_attr,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_config, agent_config_get_monitor, agent_config_set_monitor,
       agent_config_toggle_selected_node, stats_sel_id} = await import("./c_agent_config.js");
const {register_c_agent_monitor} = await import("./c_agent_monitor.js");
const {register_c_scenarios} = await import("./c_scenarios.js");
const {validate_scenario} = await import("./monitor_helpers.js");

const logged = [];
const sent = [];

function iev_command_parser(gobj, command, kw, src)
{
    sent.push({command, kw});
    return null;
}

let yuno = null;
let host = null;
let link = null;
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
    register_c_scenarios();

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_SHELL", [["EV_LANGUAGE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT]],
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
        ["EV_YUNO_STATS",        event_flag_t.EVF_OUTPUT_EVENT]
    ];
    gclass_create("C_TEST_LINK", link_events, [["ST_IDLE", []]], {}, 0,
        [SDATA(data_type_t.DTP_POINTER, "iev", 0, null, "session"), SDATA_END()], {}, 0, 0, 0, 0);
    /*  The direct link: this test never uses it, but the view finds it.  */
    gclass_create("C_TEST_MLINK", link_events.concat([["EV_CONNECT", 0], ["EV_DISCONNECT", 0]]),
        [["ST_IDLE", [["EV_CONNECT", () => 0, null], ["EV_DISCONNECT", () => 0, null]]]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_YUI_UPLOT", [["EV_ADD_SERIE", 0], ["EV_LOAD_DATA", 0]],
        [["ST_IDLE", [["EV_ADD_SERIE", () => 0, null], ["EV_LOAD_DATA", () => 0, null]]]],
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
    gobj_create_service("monitor_link", "C_TEST_MLINK", {}, yuno);
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

        gobj_send_event(list, "EV_OPEN_SCENARIO", {scenario_id: "stress"}, list);
        let m = agent_config_get_monitor(config);
        expect(m.source).toBe("saved");
        expect(m.scenario.id).toBe("stress");
        expect(navigated).toEqual(["/scenarios/live"]);
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
        let watch = find("command-agent").filter((r) => /watch-yuno-stats/.test(r.kw.cmd2agent));
        expect(watch.map((r) => r.kw.agent_id)).toEqual(["ctrl"]);
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
        let watch = find("command-agent").filter((r) => /watch-yuno-stats/.test(r.kw.cmd2agent)).pop();
        answer(mon, watch, {result: -1, comment: "command not available", outer: "watch-yuno-stats"});
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
});
