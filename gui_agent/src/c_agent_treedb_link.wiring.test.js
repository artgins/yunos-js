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
const answers_b = [];
const echoes = [];

let yuno = null;
let link = null;
let view = null;
let table = null;

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
    /*  A view that also hears the local echo of the node events, as the
     *  treedb tables do on their transport.  */
    const NODE_EVENTS = ["EV_TREEDB_NODE_CREATED", "EV_TREEDB_NODE_UPDATED",
        "EV_TREEDB_NODE_DELETED", "EV_TREEDB_NODE_LINKED", "EV_TREEDB_NODE_UNLINKED"];
    gclass_create("C_TEST_TABLE",
        [["EV_MT_COMMAND_ANSWER", 0]].concat(NODE_EVENTS.map((e) => [e, 0])),
        [["ST_IDLE", [["EV_MT_COMMAND_ANSWER", (gobj, ev, kw) => {
            answers.push(kw);
            return 0;
        }, null]].concat(NODE_EVENTS.map((e) => [e, (gobj, ev, kw) => {
            echoes.push({event: ev, kw});
            return 0;
        }, null]))]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    /*  A second view, on a second adapter over the SAME link.  */
    gclass_create("C_TEST_VIEW_B", [["EV_MT_COMMAND_ANSWER", 0]],
        [["ST_IDLE", [["EV_MT_COMMAND_ANSWER", (gobj, ev, kw) => {
            answers_b.push(kw);
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
    table = gobj_create_service("the_table", "C_TEST_TABLE", {}, yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    sent.length = 0;
    answers.length = 0;
    answers_b.length = 0;
    echoes.length = 0;
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


/*  What the controlcenter and the node answer, the way the link hands
 *  them over: the request's __md_iev__ back, with the frame of the hop
 *  that answered on top.  */
function reply(a, req, hop, result, data, comment)
{
    const kw = {
        result: result,
        comment: comment || "",
        data: data,
        __md_iev__: JSON.parse(JSON.stringify(req.kw.__md_iev__))
    };
    kw.__md_iev__.command_stack = [{command: hop, kw: {}}];
    gobj_send_event(a, "EV_MT_COMMAND_ANSWER", kw, link);
}

function warnings()
{
    return logged.filter((l) => l.level === "warning").map((l) => l.msg);
}

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

describe("M-1: the session closes with requests in flight", () => {

    test("every request in flight is answered as failed, at once", () => {
        const a = adapter("c1");
        gobj_command(a, "update-node",
            {topic_name: "users", record: {id: "x"}, __md_command__: {topic_name: "users", form_write: 3}},
            view);
        gobj_command(a, "nodes", {topic_name: "roles", __md_command__: {topic_name: "roles"}}, view);
        expect(sent.length).toBe(2);

        gobj_send_event(a, "EV_ON_CLOSE", {}, link);
        expect(answers.length).toBe(2);
        for(const kw of answers) {
            expect(kw.result).toBe(-1);
            expect(kw.comment).toBe("the connection dropped");
        }
        const frames = answers.map((kw) => msg_iev_get_stack(view, kw, "command_stack", true));
        expect(frames.map((f) => f.command).sort()).toEqual(["nodes", "update-node"]);
        expect(frames.find((f) => f.command === "update-node").kw.form_write).toBe(3);

        /*  Settled: the deadline has nothing left to say.  */
        vi.advanceTimersByTime(120 * 1000);
        expect(answers.length).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
        expect(errors()).toEqual([]);
    });
});

describe("L-2: a failed dispatch ack", () => {

    test("it settles its request AND disarms the deadline it no longer needs", () => {
        const a = adapter("f1");
        gobj_command(a, "update-node", {topic_name: "users", record: {id: "x"}}, view);
        expect(vi.getTimerCount()).toBe(1);

        reply(a, sent[0], "command-agent", -1, null, "no node found");
        expect(answers.length).toBe(1);
        expect(answers[0].result).toBe(-1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("M-2: the deadline", () => {

    test("it counts from the controlcenter's dispatch ack, not from the queueing", () => {
        const a = adapter("d1");
        gobj_command(a, "nodes", {topic_name: "users"}, view);

        /*  The frame took 50 s to reach the controlcenter.  */
        vi.advanceTimersByTime(50 * 1000);
        reply(a, sent[0], "command-agent", 0, null, "Command sent to 1 nodes");
        expect(answers).toEqual([]);

        vi.advanceTimersByTime(20 * 1000);  /*  70 s from the queueing  */
        expect(answers).toEqual([]);

        vi.advanceTimersByTime(41 * 1000);  /*  61 s from the ack  */
        expect(answers.length).toBe(1);
        expect(answers[0].comment).toBe("the node did not answer");
    });

    test("a write carrying __files__ waits in proportion to what it carries", () => {
        const a = adapter("d2");
        /*  1.25 MiB of base64: 10 s more at the floor of 128 KiB/s.  */
        const content64 = "A".repeat(1280 * 1024);
        gobj_command(a, "update-node", {
            topic_name: "devices",
            record: {id: "dev-1", __files__: {foto: {content64: content64, original_name: "f.png"}}}
        }, view);

        vi.advanceTimersByTime(65 * 1000);
        expect(answers).toEqual([]);
        vi.advanceTimersByTime(6 * 1000);
        expect(answers.length).toBe(1);
        expect(answers[0].result).toBe(-1);
    });

    test("a write answered AFTER its deadline: said, and its echo reaches the table", () => {
        const a = adapter("d3", {subscriber: table});
        gobj_command(a, "update-node",
            {topic_name: "users", record: {id: "x", name: "new"}, options: {create: true},
             __md_command__: {topic_name: "users", form_write: 1}},
            table);
        vi.advanceTimersByTime(61 * 1000);
        expect(answers.length).toBe(1);
        expect(answers[0].result).toBe(-1);

        /*  The node did it after all.  */
        reply(a, sent[0], "command-yuno", 0, {id: "x", name: "new"});
        expect(answers.length).toBe(1);     /*  the form was answered once  */
        expect(echoes.length).toBe(1);
        expect(echoes[0].event).toBe("EV_TREEDB_NODE_CREATED");
        expect(echoes[0].kw.node).toEqual({id: "x", name: "new"});
        expect(warnings().some((w) => w.includes("after its deadline") && w.includes("done"))).toBe(true);
    });

    test("a read or a refusal answered after its deadline: said, nothing delivered", () => {
        const a = adapter("d4", {subscriber: table});
        gobj_command(a, "nodes", {topic_name: "users"}, table);
        gobj_command(a, "update-node", {topic_name: "users", record: {id: "y"}}, table);
        vi.advanceTimersByTime(61 * 1000);
        expect(answers.length).toBe(2);

        reply(a, sent[0], "command-yuno", 0, [{id: "x"}]);
        reply(a, sent[1], "command-yuno", -1, null, "refused");
        expect(answers.length).toBe(2);
        expect(echoes).toEqual([]);
        expect(warnings().filter((w) => w.includes("after its deadline")).length).toBe(2);
    });
});


/*  The link re-publishes every answer of the session to EVERY adapter
 *  subscribed to it: what one answer does, it does to all of them.  */
function publish(adapters, req, hop, result, data, comment)
{
    for(const a of adapters) {
        reply(a, req, hop, result, data, comment);
    }
}

describe("two treedb views mounted on one link", () => {

    test("an answer reaches the view that asked, and only that one", () => {
        const view_b = gobj_create_service("view_b1", "C_TEST_VIEW_B", {}, yuno);
        const a = adapter("t1a", {subscriber: table});
        const b = adapter("t1b", {subscriber: view_b});
        gobj_command(a, "update-node", {topic_name: "users", record: {id: "x"}}, table);
        gobj_command(b, "nodes", {topic_name: "roles"}, view_b);
        expect(sent.length).toBe(2);

        /*  b's answer, heard by both adapters.  */
        publish([a, b], sent[1], "command-yuno", 0, [{id: "r"}]);
        expect(answers).toEqual([]);            /*  not a's write  */
        expect(answers_b.length).toBe(1);
        expect(answers_b[0].data).toEqual([{id: "r"}]);

        publish([a, b], sent[0], "command-yuno", 0, {id: "x"});
        expect(answers.length).toBe(1);
        expect(answers_b.length).toBe(1);
        expect(errors()).toEqual([]);
    });

    test("another view's answer is not a LATE answer of ours: no false echo", () => {
        const view_b = gobj_create_service("view_b2", "C_TEST_VIEW_B", {}, yuno);
        const a = adapter("t2a", {subscriber: table});
        const b = adapter("t2b", {subscriber: view_b});
        gobj_command(a, "delete-node", {topic_name: "users", record: {id: "x"}}, table);
        vi.advanceTimersByTime(61 * 1000);      /*  a's delete: settled, remembered  */
        expect(answers.length).toBe(1);

        gobj_command(b, "nodes", {topic_name: "roles"}, view_b);
        publish([a, b], sent[1], "command-yuno", 0, [{id: "r"}]);
        expect(echoes).toEqual([]);             /*  no EV_TREEDB_NODE_DELETED of x  */
        expect(answers_b.length).toBe(1);
        expect(warnings().filter((w) => w.includes("after its deadline"))).toEqual([]);
    });
});

describe("a request remembered for its late answer", () => {

    test("keeps what the echo needs, not the base64 it carried", () => {
        const a = adapter("r1", {subscriber: table});
        const content64 = "QUJD".repeat(64 * 1024);
        gobj_command(a, "update-node", {
            topic_name: "devices", options: {create: true},
            record: {id: "dev-1", name: "d", __files__: {foto: {content64: content64, original_name: "f.png"}}}
        }, table);
        vi.advanceTimersByTime(10 * 60 * 1000);
        expect(answers.length).toBe(1);

        /*  The view is a gobj (circular): not the question here.  */
        const kept = JSON.stringify(a.priv.late, (k, v) => (k === "view" ? undefined : v));
        expect(kept).not.toContain(content64.slice(0, 64));
        expect(kept.length).toBeLessThan(4096);

        /*  ...and the echo of a late success is still right.  */
        reply(a, sent[0], "command-yuno", 0, {id: "dev-1", name: "d"});
        expect(echoes.length).toBe(1);
        expect(echoes[0].event).toBe("EV_TREEDB_NODE_CREATED");
        expect(echoes[0].kw.topic_name).toBe("devices");
    });

    test("a late delete still echoes the record it named", () => {
        const a = adapter("r2", {subscriber: table});
        gobj_command(a, "delete-node", {topic_name: "users", record: {id: "x", name: "n"}}, table);
        vi.advanceTimersByTime(61 * 1000);
        reply(a, sent[0], "command-yuno", 0, null);
        expect(echoes.length).toBe(1);
        expect(echoes[0].event).toBe("EV_TREEDB_NODE_DELETED");
        expect(echoes[0].kw.node).toEqual({id: "x", name: "n"});
    });
});
