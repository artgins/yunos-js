/***********************************************************************
 *          c_agent_console.wiring.test.js
 *
 *      The console (C_AGENT_CONSOLE) shows a structured answer in the
 *      lazy JSON viewer (C_YUI_JSON). An answer can carry `__collapsed__`
 *      stubs: `print-tranger expanded=1` of a C_NODE or a C_TRANGER
 *      collapses every list and dict above 100 items (kw_collapse() in
 *      kwid.c). A click on a stub makes the viewer PUBLISH EV_EXPAND_PATH
 *      and show "loading" until its host answers.
 *
 *      Until gui_agent 0.22.96 the console created the viewer with no
 *      subscriber: EV_EXPAND_PATH (EVF_NO_WARN_SUBS) went to nobody, in
 *      silence, and the stub stayed on "loading" for the life of the
 *      answer -- C_YUI_JSON ignores every click on a pending path. The
 *      console now answers that it cannot, by design: the answer came
 *      whole, and a command in general has no path to re-issue.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

if(typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_start, gobj_send_event, gobj_change_state,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_yui_json} = await import("@yuneta/gobj-ui/src/c_yui_json.js");
const {register_c_agent_console} = await import("./c_agent_console.js");

const NODE = "node_1";
const logged = [];
const sent = [];

function iev_command_parser(gobj, command, kw, src)
{
    sent.push({command, kw});
    return null;
}

let yuno = null;
let link = null;
let host = null;

beforeAll(async () => {
    const i18next = (await import("i18next")).default;
    await i18next.init({lng: "en", resources: {}});
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();
    register_c_yui_json();
    register_c_agent_console();

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_SESSION", []], ["ST_DISCONNECTED", []]],
        {mt_command_parser: iev_command_parser}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create(
        "C_TEST_LINK",
        [
            ["EV_ON_OPEN",           event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_CLOSE",          event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_OPEN_ERROR",     event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_ID_NAK",         event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_MT_COMMAND_ANSWER", event_flag_t.EVF_OUTPUT_EVENT]
        ],
        [["ST_IDLE", []]],
        {}, 0,
        [SDATA(data_type_t.DTP_POINTER, "iev", 0, null, "session"), SDATA_END()],
        {}, 0, 0, 0, 0
    );
    gclass_create(
        "C_TEST_CONFIG",
        [],
        [["ST_IDLE", []]],
        {}, 0,
        [
            SDATA(data_type_t.DTP_STRING, "display_mode", 0, "table", ""),
            SDATA(data_type_t.DTP_LIST,   "cmd_history",  0, "[]",    ""),
            SDATA(data_type_t.DTP_DICT,   "shortkeys",    0, "{}",    ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );

    yuno = gobj_create_yuno("console_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    const iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
    gobj_create_service("agent_config", "C_TEST_CONFIG", {}, yuno);
    host = gobj_create("host", "C_TEST_HOST", {}, yuno);
});

beforeEach(() => {
    logged.length = 0;
    sent.length = 0;
});

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

function warnings()
{
    return logged.filter((l) => l.level === "warning").map((l) => l.msg);
}

/*  The answer of a typed command, the way the link re-publishes it.  */
function answer(console_gobj, data)
{
    gobj_send_event(console_gobj, "EV_MT_COMMAND_ANSWER", {
        result: 0,
        comment: "",
        data: data,
        __md_iev__: {
            console_node: NODE,
            command_stack: [{command: "print-tranger", kw: {}}]
        }
    }, link);
}

describe("a console answer that carries __collapsed__ stubs", () => {

    test("a click on a stub is answered: it cannot be loaded here, by design", () => {
        const con = gobj_create("con1", "C_AGENT_CONSOLE", {node: NODE}, host);
        gobj_start(con);
        logged.length = 0;
        sent.length = 0;    /*  the help cache its start asks for  */

        /*  What `print-tranger expanded=1` answers for a big topic.  */
        answer(con, {topics: {users: {__collapsed__: {path: "topics`users", size: 250}}}});
        const viewer = con.priv.json_view;
        expect(viewer).toBeTruthy();

        gobj_send_event(viewer, "EV_EXPAND_COLLAPSED", {path: "topics`users", size: 250}, viewer);

        expect(viewer.priv.pending.has("topics`users")).toBe(false);
        expect(viewer.priv.errors.get("topics`users")).toEqual(
            {error: "this part cannot be loaded here", is_key: true});
        expect(errors()).toEqual([]);
        expect(warnings()).toEqual([
            "C_YUI_JSON: subtree not loaded at 'topics`users': this part cannot be loaded here"
        ]);
        /*  Nothing is asked of the agent for it.  */
        expect(sent).toEqual([]);
    });

    test("a new answer replaces the viewer, and its stubs are answered too", () => {
        const con = gobj_create("con2", "C_AGENT_CONSOLE", {node: NODE}, host);
        gobj_start(con);
        answer(con, {a: [{__collapsed__: {path: "a", size: 101}}]});
        answer(con, {b: [{__collapsed__: {path: "b", size: 101}}]});
        logged.length = 0;

        const viewer = con.priv.json_view;
        gobj_send_event(viewer, "EV_EXPAND_COLLAPSED", {path: "b", size: 101}, viewer);
        expect(viewer.priv.pending.has("b")).toBe(false);
        expect(errors()).toEqual([]);
    });
});
