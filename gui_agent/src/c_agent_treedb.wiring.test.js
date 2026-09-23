/***********************************************************************
 *          c_agent_treedb.wiring.test.js
 *
 *      The Schemas tab (C_AGENT_TREEDB) driven through its FSM on a
 *      document double, with a fake control-center link underneath. What
 *      the 2026-09-23 review found lived in the WIRING, where the helpers'
 *      own tests could not see it:
 *
 *        M1  after a Save the rebuilt editor was handed the drafts from
 *            BEFORE the Save (EV_DRAFTS_WANTED answered from a merged,
 *            never reset set);
 *        M2  ac_apply_answer counted owners, so one owner applying A and
 *            refusing B skipped the restart, and an owner with nothing to
 *            apply next to a refusal restarted the yuno for nothing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  The toasts: what the tab SAYS is asserted on the call.  */
const shown = [];
vi.mock("@yuneta/gobj-ui/src/shell_modals.js", () => ({
    yui_shell_show_error: (shell, message) => {
        shown.push(message);
        return {close() {}};
    },
    yui_shell_show_modal: () => ({close() {}}),
}));

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_start, gobj_send_event, gobj_current_state, gobj_parent,
    gobj_change_state, gobj_create_pure_child, gobj_write_attr,
    gobj_gclass_name,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_treedb} = await import("./c_agent_treedb.js");

const NODE = "node_1";
const YUNO = "yuno_1";

const logged = [];
const sent = [];            /*  every command the tab sent through the link  */
const editors = [];         /*  the fake schema editors, in creation order  */

/*  The session under the link: whatever the tab sends lands here.  */
function iev_command_parser(gobj, command, kw, src)
{
    sent.push({command, kw});
    return null;
}

/*  What C_AGENT_TREEDB_VIEW does when its editor is mounted -- the
 *  editor is lazy, and it asks the tab for the drafts. The fake tree
 *  mounts one editor as it starts.  */
function fake_tree_start(gobj)
{
    const editor = gobj_create_pure_child(`editor_${editors.length}`, "C_YUI_SCHEMA_EDITOR", {}, gobj);
    editor.got = [];
    editors.push(editor);
    gobj_send_event(gobj_parent(gobj), "EV_DRAFTS_WANTED", {}, editor);
}

let yuno = null;
let host = null;
let link = null;

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();

    gclass_create("C_TEST_HOST", [["EV_ROUTE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT]],
        [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_SESSION", []]],
        {mt_command_parser: iev_command_parser}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
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
    gclass_create(
        "C_YUI_NODE",
        [["EV_ROUTE_CHANGED", 0]],
        [["ST_IDLE", [["EV_ROUTE_CHANGED", () => 0, null]]]],
        {
            mt_create: (gobj) => {
                gobj_write_attr(gobj, "$container", document.createElement("div"));
            },
            mt_start: fake_tree_start
        },
        0,
        [
            SDATA(data_type_t.DTP_STRING,  "node_id",           0, "",    ""),
            SDATA(data_type_t.DTP_STRING,  "label",             0, "",    ""),
            SDATA(data_type_t.DTP_STRING,  "base_route",        0, "",    ""),
            SDATA(data_type_t.DTP_STRING,  "nav_mode",          0, "",    ""),
            SDATA(data_type_t.DTP_BOOLEAN, "remember_position", 0, false, ""),
            SDATA(data_type_t.DTP_JSON,    "projection",        0, null,  ""),
            SDATA(data_type_t.DTP_JSON,    "children",          0, null,  ""),
            SDATA(data_type_t.DTP_POINTER, "$container",        0, null,  ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );
    gclass_create(
        "C_YUI_SCHEMA_EDITOR",
        [["EV_DRAFTS", 0]],
        [["ST_IDLE", [["EV_DRAFTS", (gobj, ev, kw) => {
            gobj.got.push(kw.drafts);
            return 0;
        }, null]]]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0
    );
    register_c_agent_treedb();

    yuno = gobj_create_yuno("wiring_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    const iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
    host = gobj_create("host", "C_TEST_HOST", {}, yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    sent.length = 0;
    shown.length = 0;
    editors.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

/*  The answers, the way the link delivers them: the request's own
 *  __md_iev__ keys back, and the frame of the hop that answered.  */
function answer(tab, request, result, data, comment)
{
    const kw = {
        result: result,
        comment: comment || "",
        data: data,
        __md_iev__: JSON.parse(JSON.stringify(request.kw.__md_iev__ || {}))
    };
    kw.__md_iev__.command_stack = [{command: "command-yuno", kw: {}}];
    gobj_send_event(tab, "EV_MT_COMMAND_ANSWER", kw, link);
}

function take(pred)
{
    const out = sent.filter(pred);
    for(const s of out) {
        sent.splice(sent.indexOf(s), 1);
    }
    return out;
}

function is(cmd_part)
{
    return (s) => s.command === "command-agent" && String(s.kw.cmd2agent).includes(cmd_part);
}

const SERVICES = [
    {gclass: "C_NODE", service: "treedb_system_schema"},
    {gclass: "C_TREEDB", service: "owner_a"},
    {gclass: "C_TREEDB", service: "owner_b"}
];

/*  Discovery, the master probe and the saved-schema round, answered.  */
function discover(tab, saved_rows_by_owner)
{
    const [services] = take(is("services"));
    expect(services).toBeTruthy();
    answer(tab, services, 0, SERVICES);
    for(const probe of take(is("treedb-info"))) {
        answer(tab, probe, 0, {master: true});
    }
    for(const req of take(is("saved-schema"))) {
        const owner = req.kw.__md_iev__.console_owner;
        answer(tab, req, 0, saved_rows_by_owner[owner] || []);
    }
}

function build(name, saved_rows_by_owner)
{
    const tab = gobj_create(name, "C_AGENT_TREEDB", {
        node: NODE, yuno_id: YUNO, yuno_label: "role^yuno",
        base_route: `/schemas/${name}`, link_svc: link
    }, host);
    gobj_start(tab);
    discover(tab, saved_rows_by_owner);
    expect(gobj_current_state(tab)).toBe("ST_READY");
    return tab;
}

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

describe("M1: the drafts after a Save", () => {

    test("the editor rebuilt after a Save is never handed the drafts from before it", () => {
        const tab = build("m1", {
            owner_a: [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {users: true}}}]
        });
        expect(editors.length).toBe(1);
        expect(editors[0].got).toEqual([{treedb_x: ["users"]}]);

        /*  Save: every owner answers 0, and the tab re-discovers.  */
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        for(const req of take(is("save-schema"))) {
            answer(tab, req, 0, []);
        }

        /*  The rebuild: the new editor asks, and the round is in flight --
         *  nothing true to say yet, so nothing is said.  */
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        expect(editors.length).toBe(2);
        expect(editors[1].got).toEqual([]);

        /*  The round lands: the new set, complete, and it replaces.  */
        for(const req of take(is("saved-schema"))) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"?
                [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {}}}] : []);
        }
        expect(editors[1].got).toEqual([{treedb_x: []}]);
        expect(errors()).toEqual([]);
    });

    test("an editor mounted after the round gets the round's set", () => {
        const tab = build("m1b", {
            owner_b: [{treedb_name: "treedb_y", result: 0, data: {draft_changed: {roles: true}}}]
        });
        const late = gobj_create_pure_child("late_editor", "C_YUI_SCHEMA_EDITOR", {}, tab.priv.tree);
        late.got = [];
        gobj_send_event(tab, "EV_DRAFTS_WANTED", {}, late);
        expect(late.got).toEqual([{treedb_y: ["roles"]}]);
    });
});

describe("M2: apply counts treedbs, not owners", () => {

    function apply(tab)
    {
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        expect(gobj_current_state(tab)).toBe("ST_APPLYING");
        const reqs = take(is("apply-schema"));
        expect(reqs.length).toBe(2);
        const by_owner = {};
        for(const r of reqs) {
            by_owner[r.kw.__md_iev__.console_owner] = r;
        }
        return by_owner;
    }

    test("one owner applies A and refuses B, the other had none: RESTART, B named", () => {
        const tab = build("m2a", {});
        const req = apply(tab);
        answer(tab, req.owner_a, -1, [
            {treedb_name: "ta", result: 0, comment: "in place", data: {applied: true}},
            {treedb_name: "tb", result: -1, comment: "the saved schema of 'tb' does not parse",
             data: {applied: false}}
        ], "apply-schema, 2 treedb(s), FAILED for: tb");
        answer(tab, req.owner_b, 0, [], "apply-schema, 0 treedb(s)");

        expect(gobj_current_state(tab)).toBe("ST_KILLING");
        expect(take(is("kill-yuno")).length).toBe(1);

        /*  The toast: the sentence keeps its KEY, the refusals are data.  */
        expect(shown.length).toBe(1);
        const [sentence, refusals] = shown[0];
        expect(sentence[1].i18n).toBe("schema applied partially");
        expect(refusals[2]).toContain("tb");
    });

    test("an owner with nothing to apply beside a refusal: NO restart", () => {
        const tab = build("m2b", {});
        const req = apply(tab);
        answer(tab, req.owner_a, 0, [], "apply-schema, 0 treedb(s)");
        answer(tab, req.owner_b, -1, [
            {treedb_name: "tb", result: -1, comment: "the saved schema of 'tb' does not parse",
             data: {applied: false}}
        ]);

        expect(take(is("kill-yuno")).length).toBe(0);
        expect(take(is("services")).length).toBe(1);   /*  back to discovery  */
        expect(shown).toEqual(["the saved schema of 'tb' does not parse"]);
    });

    test("a 7.25.3 node (no data.applied): a row with result 0 was applied", () => {
        const tab = build("m2c", {});
        const req = apply(tab);
        answer(tab, req.owner_a, -1, [
            {treedb_name: "ta", result: 0, comment: "in place", data: null},
            {treedb_name: "tb", result: -1, comment: "cannot write the schema of 'tb'", data: null}
        ]);
        answer(tab, req.owner_b, 0, []);
        expect(take(is("kill-yuno")).length).toBe(1);
    });

    test("nothing applied and nothing refused: no restart, and a KEY is shown", () => {
        const tab = build("m2d", {});
        const req = apply(tab);
        answer(tab, req.owner_a, 0, []);
        answer(tab, req.owner_b, 0, []);
        expect(take(is("kill-yuno")).length).toBe(0);
        expect(shown).toEqual(["nothing saved to apply"]);
    });
});

describe("L-1: a saved-schema round counts only its own answers", () => {

    test("a late answer of an earlier round is not counted in the next one", () => {
        /*  Round A is sent and not answered.  */
        const tab = gobj_create("l1", "C_AGENT_TREEDB", {
            node: NODE, yuno_id: YUNO, yuno_label: "role^yuno",
            base_route: "/schemas/l1", link_svc: link
        }, host);
        gobj_start(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        const round_a = take(is("saved-schema"));
        expect(round_a.length).toBe(2);

        /*  A Save, and its re-discovery: round B is sent.  */
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        for(const req of take(is("save-schema"))) {
            answer(tab, req, 0, []);
        }
        const [services2] = take(is("services"));
        answer(tab, services2, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        const round_b = take(is("saved-schema"));
        expect(round_b.length).toBe(2);
        const editor = editors[editors.length - 1];

        /*  Round A answers now, with what was true before the Save.  */
        for(const req of round_a) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"?
                [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {users: true}}}] : []);
        }
        expect(editor.got).toEqual([]);     /*  round B has not answered  */

        for(const req of round_b) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"?
                [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {}}}] : []);
        }
        expect(editor.got).toEqual([{treedb_x: []}]);
        expect(errors()).toEqual([]);
    });
});

describe("the session closes with the tab's own requests in flight", () => {

    test("a Save in flight is answered as failed, and Save works again", () => {
        const tab = build("c1", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(take(is("save-schema")).length).toBe(2);
        expect(tab.priv.$save.disabled).toBe(true);

        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        expect(shown).toEqual(["the connection dropped"]);
        expect(tab.priv.$save.disabled).toBe(false);

        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(take(is("save-schema")).length).toBe(2);
    });

    test("a comparison in flight is ended, and its button comes back", () => {
        const tab = build("c3", {});
        gobj_send_event(tab, "EV_DIFF_SCHEMA", {}, tab);
        expect(take(is("diff-schema")).length).toBe(2);
        expect(tab.priv.$diff.disabled).toBe(true);

        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        expect(tab.priv.$diff.disabled).toBe(false);
        expect(shown).toEqual(["the connection dropped"]);
    });

    test("a saved-schema round in flight is asked again when the session is back", () => {
        const tab = gobj_create("c2", "C_AGENT_TREEDB", {
            node: NODE, yuno_id: YUNO, yuno_label: "role^yuno",
            base_route: "/schemas/c2", link_svc: link
        }, host);
        gobj_start(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        expect(take(is("saved-schema")).length).toBe(2);

        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        const again = take(is("saved-schema"));
        expect(again.length).toBe(2);
        for(const req of again) {
            answer(tab, req, 0, []);
        }
        expect(editors[editors.length - 1].got).toEqual([{}]);
    });
});

describe("L-3: the apply deadline", () => {

    test("it is a C_TIMER child of the tab, not a window.setTimeout", () => {
        const tab = build("t1", {});
        expect(tab.priv.apply_timer).toBeTruthy();
        expect(gobj_gclass_name(tab.priv.apply_timer)).toBe("C_TIMER");
    });

    test("an owner that never answers apply-schema is NAMED when the step's 30 s pass", () => {
        const tab = build("t2", {});
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        const reqs = take(is("apply-schema"));
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        answer(tab, a, 0, [{treedb_name: "ta", result: 0, data: {applied: true}}]);

        vi.advanceTimersByTime(29 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_APPLYING");
        expect(shown).toEqual([]);

        vi.advanceTimersByTime(2 * 1000);
        expect(shown.length).toBe(1);
        const [sentence, step] = shown[0];
        expect(sentence[1].i18n).toBe("apply timeout");
        expect(step[2]).toContain("owner_b");
        expect(step[2]).not.toContain("owner_a");
        expect(errors().some((e) => e.includes("owner_b"))).toBe(true);
    });

    test("the kill step has its own 30 s, from when it is sent", () => {
        const tab = build("t3", {});
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        vi.advanceTimersByTime(20 * 1000);
        for(const r of take(is("apply-schema"))) {
            answer(tab, r, 0, [{treedb_name: r.kw.__md_iev__.console_owner, result: 0,
                data: {applied: true}}]);
        }
        expect(gobj_current_state(tab)).toBe("ST_KILLING");
        vi.advanceTimersByTime(20 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_KILLING");
        vi.advanceTimersByTime(11 * 1000);
        expect(shown.length).toBe(1);
        expect(shown[0][1][2]).toContain("kill");
    });
});
