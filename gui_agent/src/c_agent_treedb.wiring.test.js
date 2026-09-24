/***********************************************************************
 *          c_agent_treedb.wiring.test.js
 *
 *      The Schemas tab (C_AGENT_TREEDB) driven through its FSM on a
 *      document double, with a fake control-center link underneath. What
 *      is tested here lived in the WIRING, where the helpers' own tests
 *      could not see it:
 *
 *        - after a Save the rebuilt editor was handed the drafts from
 *          BEFORE the Save (EV_DRAFTS_WANTED answered from a merged,
 *          never reset set);
 *        - ac_apply_answer counted owners, so one owner applying A and
 *          refusing B skipped the restart, and an owner with nothing to
 *          apply next to a refusal restarted the yuno for nothing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  The toasts: what the tab SAYS is asserted on the call.  */
const shown = [];
const infos = [];
vi.mock("@yuneta/gobj-ui/src/shell_modals.js", () => ({
    yui_shell_show_error: (shell, message) => {
        shown.push(message);
        return {close() {}};
    },
    yui_shell_show_info: (shell, message) => {
        infos.push(message);
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
    infos.length = 0;
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

describe("the drafts after a Save", () => {

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

describe("apply counts treedbs, not owners", () => {

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

describe("a saved-schema round counts only its own answers", () => {

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

describe("a Save cut by the drop", () => {

    /*  It may have landed: what is saved, and so what Apply offers and
     *  which topics are drafts, is read again when the session is back.  */
    test("the saved schemas are read again on the next open", () => {
        const tab = build("d1", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(take(is("save-schema")).length).toBe(2);

        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        expect(take(is("saved-schema")).length).toBe(0);
        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        expect(take(is("saved-schema")).length).toBe(2);
        expect(errors()).toEqual([]);
    });
});

describe("the deadline of a Save and of a saved-schema round", () => {

    test("both are C_TIMER children of the tab", () => {
        const tab = build("s0", {});
        expect(gobj_gclass_name(tab.priv.save_timer)).toBe("C_TIMER");
        expect(gobj_gclass_name(tab.priv.saved_timer)).toBe("C_TIMER");
    });

    test("an owner that never answers save-schema is NAMED, and Save and Apply work again", () => {
        const tab = build("s1", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        const reqs = take(is("save-schema"));
        expect(reqs.length).toBe(2);
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        answer(tab, a, 0, [{treedb_name: "ta", result: 0, data: {schema_version: 5}}]);

        vi.advanceTimersByTime(29 * 1000);
        expect(tab.priv.save_left).toBe(1);
        expect(shown).toEqual([]);

        vi.advanceTimersByTime(2 * 1000);
        expect(tab.priv.save_left).toBe(0);
        expect(shown.length).toBe(1);
        const [sentence, owners] = shown[0];
        expect(sentence[1].i18n).toBe("save unanswered");
        expect(owners[2]).toContain("owner_b");
        expect(owners[2]).not.toContain("owner_a");
        expect(errors().some((e) => e.includes("owner_b"))).toBe(true);
        /*  Whether it landed is not known: the node is read again.  */
        expect(take(is("services")).length).toBe(1);
    });

    test("a Save answered in time leaves no deadline behind", () => {
        const tab = build("s2", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        for(const r of take(is("save-schema"))) {
            answer(tab, r, 0, []);
        }
        discover(tab, {});
        vi.advanceTimersByTime(61 * 1000);
        expect(shown).toEqual([]);
        expect(errors()).toEqual([]);
    });

    test("an owner that never answers saved-schema is NAMED, and the round ends", () => {
        const tab = gobj_create("s3", "C_AGENT_TREEDB", {
            node: NODE, yuno_id: YUNO, yuno_label: "role^yuno",
            base_route: "/schemas/s3", link_svc: link
        }, host);
        gobj_start(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        const reqs = take(is("saved-schema"));
        expect(reqs.length).toBe(2);
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        answer(tab, a, 0, []);
        expect(editors[editors.length - 1].got).toEqual([]);

        vi.advanceTimersByTime(31 * 1000);
        expect(tab.priv.saved_left).toBe(0);
        expect(shown.length).toBe(1);
        const [sentence, owners] = shown[0];
        expect(sentence[1].i18n).toBe("saved schemas unanswered");
        expect(owners[2]).toContain("owner_b");
        expect(owners[2]).not.toContain("owner_a");
        /*  The editor is told the drafts the round could gather.  */
        expect(editors[editors.length - 1].got).toEqual([{}]);
        expect(errors().some((e) => e.includes("owner_b"))).toBe(true);
    });

    test("a drop settles them: their deadlines do not fire after it", () => {
        const tab = build("s4", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        take(is("save-schema"));
        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        vi.advanceTimersByTime(61 * 1000);
        expect(shown).toEqual(["the connection dropped"]);
        expect(errors()).toEqual([]);
    });
});

describe("the apply deadline", () => {

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
        answer(tab, a, 0, [], "apply-schema, 0 treedb(s)");

        vi.advanceTimersByTime(29 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_APPLYING");
        expect(shown).toEqual([]);

        /*  Nothing the answers say was applied: no restart, and the
         *  silent owner is named with what that leaves unknown.  */
        vi.advanceTimersByTime(2 * 1000);
        expect(shown.length).toBe(1);
        const [sentence, step] = shown[0];
        expect(sentence[1].i18n).toBe("apply unanswered, nothing restarted");
        expect(step[2]).toContain("owner_b");
        expect(step[2]).not.toContain("owner_a");
        expect(errors().some((e) => e.includes("owner_b"))).toBe(true);
        expect(take(is("kill-yuno")).length).toBe(0);
        expect(take(is("services")).length).toBe(1);   /*  back to discovery  */
    });

    test("one owner applied, another silent: the restart goes on, the silent one is named", () => {
        const tab = build("t2b", {});
        tab.priv.dirty = true;      /*  a write of this tab is waiting for the apply  */
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        const reqs = take(is("apply-schema"));
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        const b = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_b");
        answer(tab, a, 0, [{treedb_name: "ta", result: 0, data: {applied: true}}]);

        vi.advanceTimersByTime(31 * 1000);

        /*  ta is a file in use that carries the saved schema: it is read
         *  by a restart, so the restart is not left for the next
         *  unrelated one to do in silence.  */
        expect(gobj_current_state(tab)).toBe("ST_KILLING");
        const kills = take(is("kill-yuno"));
        expect(kills.length).toBe(1);

        expect(shown.length).toBe(1);
        const [sentence, owners] = shown[0];
        expect(sentence[1].i18n).toBe("apply unanswered, restarting");
        expect(owners[2]).toContain("owner_b");
        expect(owners[2]).not.toContain("owner_a");
        expect(errors().some((e) => e.includes("owner_b"))).toBe(true);

        /*  owner_b's late answer does not move the sequence.  */
        answer(tab, b, 0, [{treedb_name: "tb", result: 0, data: {applied: true}}]);
        expect(gobj_current_state(tab)).toBe("ST_KILLING");

        answer(tab, kills[0], 0, []);
        expect(gobj_current_state(tab)).toBe("ST_STARTING");
        const [run] = take(is("run-yuno"));
        answer(tab, run, 0, []);
        expect(gobj_current_state(tab)).toBe("ST_PLAYING");
        const [play] = take(is("play-yuno"));
        answer(tab, play, 0, []);

        /*  Done, and still marked: what owner_b did is not known.  */
        expect(take(is("services")).length).toBe(1);
        expect(tab.priv.dirty).toBe(true);
        expect(shown.length).toBe(1);
    });

    test("one owner applied A and refused B, another silent: both are said", () => {
        const tab = build("t2c", {});
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        const reqs = take(is("apply-schema"));
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        answer(tab, a, -1, [
            {treedb_name: "ta", result: 0, data: {applied: true}},
            {treedb_name: "tb", result: -1, comment: "the saved schema of 'tb' does not parse",
             data: {applied: false}}
        ]);
        vi.advanceTimersByTime(31 * 1000);

        expect(take(is("kill-yuno")).length).toBe(1);
        expect(shown.length).toBe(2);
        expect(shown[0][0][1].i18n).toBe("apply unanswered, restarting");
        expect(shown[1][0][1].i18n).toBe("schema applied partially");
        expect(shown[1][1][2]).toContain("tb");
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

describe("a Save answered only 'nothing to save' while drafts are marked", () => {

    /*  treedb_x holds a SAVED schema (v5 over v4 in use), and the draft was
     *  then reverted to what is in use. saved-schema diffs the draft against
     *  the SAVED one, so it names `users`; save-schema diffs it against the
     *  one IN USE, and finds nothing.  */
    const STALE = {treedb_name: "treedb_x", result: 0, data: {
        draft_changed: {users: true}, saved: true, master: true, impose_c_schema: false,
        in_use_schema_version: 4, saved_schema_version: 5, can_apply: true,
        diff: {"topics`[0]`topic_version": {in_use: 1, saved: 2}}
    }};
    /*  A node with the C fix: the save withdrew the saved schema.  */
    const WITHDRAWN = {treedb_name: "treedb_x", result: 0, data: {
        draft_changed: {}, saved: false, master: true, impose_c_schema: false,
        in_use_schema_version: 4, saved_schema_version: 0, can_apply: false, diff: {}
    }};
    const NOTHING = {treedb_name: "treedb_x", result: 0,
        comment: "role^yuno: nothing to save, the draft of 'treedb_x' is the schema in use",
        data: {treedb_name: "treedb_x", changes: []}};
    /*  The same answer from a node with the C fix (1365a7224): it says it
     *  withdrew the saved schema, and carries a schema_version too.  */
    const WITHDRAWING = {treedb_name: "treedb_x", result: 0,
        comment: "role^yuno: the draft of 'treedb_x' is the schema in use: " +
            "the saved schema_version 5 is withdrawn",
        data: {treedb_name: "treedb_x", withdrawn: true, schema_version: 5,
            path: "/x/saved_schemas/treedb_x.treedb_schema.json", changes: []}};
    const SAVED = {treedb_name: "treedb_x", result: 0,
        comment: "role^yuno: saved 'treedb_x', schema_version 5",
        data: {treedb_name: "treedb_x", schema_version: 5, topic_versions: {users: 3}}};

    function save(tab, rows_a)
    {
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        for(const req of take(is("save-schema"))) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"? rows_a : []);
        }
    }

    function rediscover(tab, row_x)
    {
        const [services] = take(is("services"));
        expect(services).toBeTruthy();
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        for(const req of take(is("saved-schema"))) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"? [row_x] : []);
        }
        return editors[editors.length - 1];
    }

    test("the operator is told, and discovery runs again", () => {
        const tab = build("n1", {owner_a: [STALE]});
        expect(editors[0].got).toEqual([{treedb_x: ["users"]}]);

        save(tab, [NOTHING]);
        expect(infos.length).toBe(1);
        const [sentence, names] = infos[0];
        expect(sentence[1].i18n).toBe("nothing to save, the draft is the schema in use");
        expect(names[2]).toContain("treedb_x");
        expect(shown).toEqual([]);
        expect(gobj_current_state(tab)).toBe("ST_DISCOVERING");
    });

    test("old C (the saved schema stays): no draft marked, and Apply is OFF, said why", () => {
        const tab = build("n2", {owner_a: [STALE]});
        expect(tab.priv.$apply.disabled).toBe(false);
        save(tab, [NOTHING]);
        const editor = rediscover(tab, STALE);

        expect(editor.got).toEqual([{treedb_x: []}]);
        expect(tab.priv.$apply.disabled).toBe(true);
        expect(tab.priv.$apply.getAttribute("data-i18n-title")).toBe("a reverted draft is still saved");

        /*  And the keyboard path is refused too.  */
        gobj_send_event(tab, "EV_APPLY_CHANGES", {}, tab);
        expect(errors().some((e) => e.includes("reverted"))).toBe(true);
    });

    test("fixed C: the WITHDRAWAL is said, not 'nothing to save', and nothing is left to apply", () => {
        const tab = build("n3", {owner_a: [STALE]});
        save(tab, [WITHDRAWING]);
        expect(infos.length).toBe(1);
        const [sentence, names] = infos[0];
        expect(sentence[1].i18n).toBe("the draft is the schema in use, its saved schema was withdrawn");
        expect(names[2]).toContain("treedb_x");
        const editor = rediscover(tab, WITHDRAWN);

        expect(editor.got).toEqual([{treedb_x: []}]);
        expect(tab.priv.$apply.disabled).toBe(true);
        expect(tab.priv.$apply.getAttribute("data-i18n-title")).toBe("nothing saved to apply");
        expect(tab.priv.reverted).toEqual({});
    });

    test("a real save afterwards makes the saved schema applicable again", () => {
        const tab = build("n4", {owner_a: [STALE]});
        save(tab, [NOTHING]);
        rediscover(tab, STALE);
        expect(tab.priv.$apply.disabled).toBe(true);

        save(tab, [SAVED]);
        const editor = rediscover(tab, Object.assign({}, STALE,
            {data: Object.assign({}, STALE.data, {draft_changed: {}})}));
        expect(editor.got).toEqual([{treedb_x: []}]);
        expect(tab.priv.$apply.disabled).toBe(false);
    });

    test("a withdrawal is said even with nothing marked: Apply goes away", () => {
        const tab = build("n6", {owner_a: [WITHDRAWN]});
        save(tab, [WITHDRAWING]);
        expect(infos.length).toBe(1);
        expect(infos[0][0][1].i18n).toBe("the draft is the schema in use, its saved schema was withdrawn");
        expect(shown).toEqual([]);
    });

    test("nothing to save with nothing marked: nothing to say", () => {
        const tab = build("n5", {owner_a: [WITHDRAWN]});
        save(tab, [NOTHING]);
        expect(infos).toEqual([]);
        expect(shown).toEqual([]);
    });
});

function warnings()
{
    return logged.filter((l) => l.level === "warning").map((l) => l.msg);
}

function not_defined()
{
    return logged.filter((l) => /NOT DEFINED/i.test(l.msg)).map((l) => l.msg);
}

/*  A Save answered by every owner: the tab re-discovers, and the tree
 *  of before stays on screen while it does.  */
function save_and_answer(tab)
{
    gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
    for(const req of take(is("save-schema"))) {
        answer(tab, req, 0, []);
    }
}

/*  Save, Differences and Apply are declared in ST_READY only, and the
 *  toolbar was shown whenever a tree existed: during every re-discovery
 *  (after a Save, after a drop), each click answered "Event NOT DEFINED
 *  in state". And the discovery had no deadline: a node's agent that
 *  went silent left the tab in ST_DISCOVERING for good.  */
describe("the toolbar outside ST_READY, and the deadline of a discovery", () => {

    const APPLICABLE = {owner_a: [{treedb_name: "treedb_x", result: 0,
        data: {can_apply: true, saved_schema_version: 2, in_use_schema_version: 1, draft_changed: {}}}]};

    test("during the re-discovery after a Save, the three buttons are off", () => {
        const tab = build("t1", APPLICABLE);
        expect(tab.priv.$apply.disabled).toBe(false);
        save_and_answer(tab);
        expect(gobj_current_state(tab)).toBe("ST_DISCOVERING");
        expect(tab.priv.tree).toBeTruthy();
        expect(tab.priv.$save.disabled).toBe(true);
        expect(tab.priv.$diff.disabled).toBe(true);
        expect(tab.priv.$apply.disabled).toBe(true);
        expect(tab.priv.$apply.getAttribute("data-i18n-title")).toBe("loading");

        discover(tab, APPLICABLE);
        expect(tab.priv.$save.disabled).toBe(false);
        expect(tab.priv.$diff.disabled).toBe(false);
        expect(tab.priv.$apply.disabled).toBe(false);
        expect(not_defined()).toEqual([]);
    });

    test("a discovery the node never answers ends in ST_EMPTY, and says so", () => {
        const tab = build("t2", APPLICABLE);
        save_and_answer(tab);
        expect(take(is("services")).length).toBe(1);

        vi.advanceTimersByTime(29 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_DISCOVERING");
        vi.advanceTimersByTime(2 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_EMPTY");
        expect(tab.priv.tree).toBe(null);
        expect(tab.priv.$notice.classList.contains("is-hidden")).toBe(false);
        expect(tab.priv.$notice.getAttribute("i18n")).toBe("discovery unanswered");
        expect(tab.priv.$toolbar.classList.contains("is-hidden")).toBe(true);
        expect(errors().length).toBe(1);
        expect(errors()[0]).toContain("did not answer the discovery");
    });

    test("the probes of a discovery are under the same deadline", () => {
        const tab = build("t3", APPLICABLE);
        save_and_answer(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        expect(take(is("treedb-info")).length).toBe(1);
        vi.advanceTimersByTime(31 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_EMPTY");
        expect(errors()[0]).toContain("'treedb-info' of 1 treedb(s) owed");
    });

    test("a discovery answer after its deadline is said, and builds nothing", () => {
        const tab = build("t4", APPLICABLE);
        save_and_answer(tab);
        const [services] = take(is("services"));
        vi.advanceTimersByTime(31 * 1000);
        logged.length = 0;
        answer(tab, services, 0, SERVICES);
        expect(gobj_current_state(tab)).toBe("ST_EMPTY");
        expect(take(is("treedb-info"))).toEqual([]);
        expect(warnings().some((w) => w.includes("'services' answered with no discovery"))).toBe(true);
    });

    test("a discovery answered in time leaves no deadline behind", () => {
        const tab = build("t5", APPLICABLE);
        vi.advanceTimersByTime(61 * 1000);
        expect(gobj_current_state(tab)).toBe("ST_READY");
        expect(errors()).toEqual([]);
    });

    test("a drop during a discovery disarms its deadline", () => {
        const tab = build("t6", APPLICABLE);
        save_and_answer(tab);
        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        expect(gobj_current_state(tab)).toBe("ST_IDLE");
        expect(tab.priv.$save.disabled).toBe(true);
        vi.advanceTimersByTime(61 * 1000);
        expect(errors()).toEqual([]);
        expect(warnings().filter((w) => w.includes("discovery deadline"))).toEqual([]);
    });
});

/*  A failed re-discovery went to ST_EMPTY with the tree of before still
 *  up: its toolbar live (Apply lit from the old saved schemas, a click
 *  NOT DEFINED in ST_EMPTY) and the notice that says why hidden under it.  */
describe("a re-discovery that finds nothing takes the old tree down", () => {

    test("an error answer: the tree goes, the notice says the node's words", () => {
        const tab = build("e1", {});
        save_and_answer(tab);
        const [services] = take(is("services"));
        answer(tab, services, -1, null, "yuno not found");
        expect(gobj_current_state(tab)).toBe("ST_EMPTY");
        expect(tab.priv.tree).toBe(null);
        expect(tab.priv.saved).toBe(null);
        expect(tab.priv.$notice.classList.contains("is-hidden")).toBe(false);
        expect(tab.priv.$notice.textContent).toBe("yuno not found");
        expect(tab.priv.$toolbar.classList.contains("is-hidden")).toBe(true);
        expect(tab.priv.$apply.disabled).toBe(true);
    });

    test("no treedb any more: the tree goes too", () => {
        const tab = build("e2", {});
        save_and_answer(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, [{gclass: "C_TREEDB", service: "owner_a"}]);
        expect(gobj_current_state(tab)).toBe("ST_EMPTY");
        expect(tab.priv.tree).toBe(null);
        expect(tab.priv.$notice.getAttribute("i18n")).toBe("no treedb in this yuno");
    });
});

/*  A save-schema or saved-schema answer that came after its round ended
 *  (deadline, drop) returned before the only check that logs: the node's
 *  reason was lost with no trace.  */
describe("a late answer of a schema round is said", () => {

    test("save-schema answered after its deadline", () => {
        const tab = build("l1", {});
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        const reqs = take(is("save-schema"));
        vi.advanceTimersByTime(31 * 1000);
        logged.length = 0;
        const b = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_b");
        answer(tab, b, -1, null, "cannot write the schema file");
        const w = warnings().filter((m) => m.includes("'save-schema' of owner_b"));
        expect(w.length).toBe(1);
        expect(w[0]).toContain("result -1");
        expect(w[0]).toContain("cannot write the schema file");
        expect(w[0]).toContain(`round ${b.kw.__md_iev__.save_round}`);
    });

    test("saved-schema answered after its deadline", () => {
        const tab = gobj_create("l2", "C_AGENT_TREEDB", {
            node: NODE, yuno_id: YUNO, yuno_label: "role^yuno",
            base_route: "/schemas/l2", link_svc: link
        }, host);
        gobj_start(tab);
        const [services] = take(is("services"));
        answer(tab, services, 0, SERVICES);
        for(const probe of take(is("treedb-info"))) {
            answer(tab, probe, 0, {master: true});
        }
        const reqs = take(is("saved-schema"));
        vi.advanceTimersByTime(31 * 1000);
        logged.length = 0;
        answer(tab, reqs[0], 0, []);
        expect(warnings().some((m) => m.includes("'saved-schema' of") &&
            m.includes("answered after the round ended"))).toBe(true);
    });
});

/*  "Unsaved changes" is the Save's: a write in a DATA treedb lit it, and
 *  after a Save cut by a drop that DID land, nothing put it out.  */
describe("unsaved changes", () => {

    test("a write in a data treedb is not a draft", () => {
        const tab = build("u1", {});
        gobj_send_event(tab, "EV_RECORD_WRITTEN", {treedb_name: "treedb_data"}, tab);
        expect(tab.priv.dirty).toBe(false);
        expect(tab.priv.$pending.classList.contains("is-hidden")).toBe(true);

        gobj_send_event(tab, "EV_RECORD_WRITTEN", {treedb_name: "treedb_system_schema"}, tab);
        expect(tab.priv.dirty).toBe(true);
        expect(tab.priv.$pending.classList.contains("is-hidden")).toBe(false);
    });

    test("a Save cut by the drop that landed: the re-read shows no draft, the mark goes", () => {
        const tab = build("u2", {});
        gobj_send_event(tab, "EV_RECORD_WRITTEN", {treedb_name: "treedb_system_schema"}, tab);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        take(is("save-schema"));
        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        expect(tab.priv.dirty).toBe(true);

        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        for(const req of take(is("saved-schema"))) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"?
                [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {}}}] : []);
        }
        expect(tab.priv.dirty).toBe(false);
        expect(tab.priv.$pending.classList.contains("is-hidden")).toBe(true);
    });

    test("...and one that did NOT land keeps it", () => {
        const tab = build("u3", {});
        gobj_send_event(tab, "EV_RECORD_WRITTEN", {treedb_name: "treedb_system_schema"}, tab);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        take(is("save-schema"));
        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        for(const req of take(is("saved-schema"))) {
            answer(tab, req, 0, req.kw.__md_iev__.console_owner === "owner_a"?
                [{treedb_name: "treedb_x", result: 0, data: {draft_changed: {users: true}}}] : []);
        }
        expect(tab.priv.dirty).toBe(true);
    });

    test("a re-read cut short by its deadline proves nothing: the mark stays", () => {
        const tab = build("u4", {});
        gobj_send_event(tab, "EV_RECORD_WRITTEN", {treedb_name: "treedb_system_schema"}, tab);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        take(is("save-schema"));
        gobj_send_event(tab, "EV_ON_CLOSE", {}, link);
        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        const reqs = take(is("saved-schema"));
        answer(tab, reqs[0], 0, []);
        vi.advanceTimersByTime(31 * 1000);
        expect(tab.priv.dirty).toBe(true);
    });
});
