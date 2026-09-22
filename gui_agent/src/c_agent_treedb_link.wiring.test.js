/***********************************************************************
 *          c_agent_treedb_link.wiring.test.js
 *
 *      C_AGENT_TREEDB_LINK, the two-hop adapter, driven through its FSM:
 *      every request a view sends is ANSWERED -- by the node, or by the
 *      deadline when the node's agent never does; and a request it cannot
 *      route is refused in the RETURN, not with a null that reads as
 *      "sent" (a low of the 2026-09-23 review).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_start, gobj_send_event, gobj_command,
    gobj_change_state,
    msg_iev_get_stack,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_treedb_link} = await import("./c_agent_treedb_link.js");

const logged = [];
const sent = [];
const answers = [];

let yuno = null;
let link = null;
let view = null;

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_SESSION", []]], {
        mt_command_parser: (gobj, command, kw) => {
            sent.push({command, kw});
            return null;
        }
    }, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create(
        "C_TEST_LINK",
        [
            ["EV_ON_OPEN",           event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_CLOSE",          event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_MT_COMMAND_ANSWER", event_flag_t.EVF_OUTPUT_EVENT]
        ],
        [["ST_IDLE", []]],
        {}, 0,
        [SDATA(data_type_t.DTP_POINTER, "iev", 0, null, "session"), SDATA_END()],
        {}, 0, 0, 0, 0
    );
    /*  The view that asks: it hears the answer as EV_MT_COMMAND_ANSWER.  */
    gclass_create("C_TEST_VIEW", [["EV_MT_COMMAND_ANSWER", 0]],
        [["ST_IDLE", [["EV_MT_COMMAND_ANSWER", (gobj, ev, kw) => {
            answers.push(kw);
            return 0;
        }, null]]]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    register_c_agent_treedb_link();

    yuno = gobj_create_yuno("link_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    const iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
    view = gobj_create_service("the_view", "C_TEST_VIEW", {}, yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    sent.length = 0;
    answers.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

function adapter(name, kw)
{
    const a = gobj_create_service(name, "C_AGENT_TREEDB_LINK", Object.assign({
        link_svc: link, node: "node_1", yuno_id: "yuno_1", treedb_name: "treedb_x",
        subscriber: view
    }, kw || {}), yuno);
    gobj_start(a);
    return a;
}

describe("every request is answered", () => {

    test("the node's agent never answers: the deadline settles the write as FAILED", () => {
        const a = adapter("a1");
        const ret = gobj_command(a, "update-node",
            {topic_name: "users", record: {id: "x"}, __md_command__: {topic_name: "users", form_write: 1}},
            view);
        expect(ret).toBe(null);
        expect(sent.length).toBe(1);

        vi.advanceTimersByTime(59 * 1000);
        expect(answers).toEqual([]);

        vi.advanceTimersByTime(2 * 1000);
        expect(answers.length).toBe(1);
        expect(answers[0].result).toBe(-1);
        expect(answers[0].comment).toBe("the node did not answer");
        /*  The view's own frame on top: it reads the answer as its write's.  */
        const frame = msg_iev_get_stack(view, answers[0], "command_stack", true);
        expect(frame.command).toBe("update-node");
        expect(frame.kw.form_write).toBe(1);
        expect(logged.filter((l) => l.level === "error").length).toBe(1);
    });

    test("an answer in time disarms it: nothing more arrives", () => {
        const a = adapter("a2");
        gobj_command(a, "nodes", {topic_name: "users"}, view);
        const req = sent[0];
        const kw = {result: 0, data: [], __md_iev__: JSON.parse(JSON.stringify(req.kw.__md_iev__))};
        kw.__md_iev__.command_stack = [{command: "command-yuno", kw: {}}];
        gobj_send_event(a, "EV_MT_COMMAND_ANSWER", kw, link);
        expect(answers.length).toBe(1);

        vi.advanceTimersByTime(120 * 1000);
        expect(answers.length).toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a request that cannot be routed is refused in the return", () => {
        const a = adapter("a3", {yuno_id: ""});
        const ret = gobj_command(a, "update-node", {topic_name: "users", record: {}}, view);
        expect(typeof ret).toBe("string");
        expect(ret).toContain("incomplete");
        expect(sent.length).toBe(0);

        const b = adapter("a4");
        expect(gobj_command(b, "update-node", {id: "x"}, view)).toContain("top-level 'id'");
        expect(sent.length).toBe(0);
    });
});
