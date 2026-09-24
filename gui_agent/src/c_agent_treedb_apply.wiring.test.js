/***********************************************************************
 *          c_agent_treedb_apply.wiring.test.js
 *
 *      The Schemas tab (C_AGENT_TREEDB): the Apply against what is in
 *      flight beside it. Same harness as c_agent_treedb.wiring.test.js,
 *      with a shell and a modal that say when they are opened and
 *      closed.
 *
 *        - a Save in flight: Apply was lit, and confirmed before the
 *          save answered, the apply dropped the save's answers and Save
 *          stayed off for good;
 *        - the Apply dialog outlived what it showed: a Save, or a new
 *          saved-schema round, left it listing the old changes, and its
 *          Apply answered "Event NOT DEFINED" outside ST_READY;
 *        - the late answers of an apply step were dropped with no word;
 *        - the rounds were counted per tab, so a tab opened again took
 *          the answer of an old tab's round as its own.
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
const modals = [];
vi.mock("@yuneta/gobj-ui/src/shell_modals.js", () => ({
    yui_shell_show_error: (shell, message) => {
        shown.push(message);
        return {close() {}};
    },
    yui_shell_show_info: (shell, message) => {
        infos.push(message);
        return {close() {}};
    },
    yui_shell_show_modal: (shell, $content, opts) => {
        const modal = {$content, opts, closed: false};
        modals.push(modal);
        return {close() {
            modal.closed = true;
        }};
    },
}));

vi.mock("@yuneta/gobj-ui/src/c_yui_shell.js", () => ({
    yui_shell_of: () => ({fake_shell: true}),
    yui_shell_navigate: () => 0,
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
    modals.length = 0;
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


function warnings()
{
    return logged.filter((l) => l.level === "warning").map((l) => l.msg);
}

function not_defined()
{
    return logged.filter((l) => /NOT DEFINED/i.test(l.msg)).map((l) => l.msg);
}

/*  A treedb with something saved to apply.  */
const APPLICABLE = {owner_a: [{treedb_name: "treedb_x", result: 0,
    data: {can_apply: true, saved_schema_version: 2, in_use_schema_version: 1, draft_changed: {}}}]};

const SAVED_CHANGED = "the saved schemas changed: open apply again";
const NOT_READY = "the tab is busy: open apply again when it is ready";

/*  The whole restart, answered.  */
function run_the_apply(tab)
{
    for(const r of take(is("apply-schema"))) {
        answer(tab, r, 0, [{treedb_name: "treedb_x", result: 0, data: {applied: true}}]);
    }
    const [k] = take(is("kill-yuno"));
    answer(tab, k, 0, []);
    const [r] = take(is("run-yuno"));
    answer(tab, r, 0, []);
    const [p] = take(is("play-yuno"));
    answer(tab, p, 0, []);
}

describe("Apply while a Save is in flight", () => {

    test("Apply is off until the save answers, and says why", () => {
        const tab = build("s1", APPLICABLE);
        expect(tab.priv.$apply.disabled).toBe(false);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(tab.priv.$apply.disabled).toBe(true);
        expect(tab.priv.$apply.getAttribute("data-i18n-title")).toBe("apply waits for the save");
    });

    test("EV_APPLY_CHANGES that arrives anyway is refused: no dialog", () => {
        const tab = build("s2", APPLICABLE);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        gobj_send_event(tab, "EV_APPLY_CHANGES", {}, tab);
        expect(modals.length).toBe(0);
        expect(tab.priv.modal).toBe(null);
        expect(errors().some((e) => /apply refused, a save is in flight/.test(e))).toBe(true);
    });

    test("Save, Apply confirmed before the save answers: refused, and Save works after", () => {
        const tab = build("s3", APPLICABLE);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        const saves = take(is("save-schema"));
        expect(saves.length).toBe(2);
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        expect(gobj_current_state(tab)).toBe("ST_READY");
        expect(take(is("apply-schema"))).toEqual([]);

        for(const req of saves) {
            answer(tab, req, 0, [{treedb_name: "treedb_x", result: 0, data: {schema_version: 3}}]);
        }
        discover(tab, APPLICABLE);
        expect(gobj_current_state(tab)).toBe("ST_READY");
        expect(tab.priv.save_left).toBe(0);
        expect(tab.priv.$save.disabled).toBe(false);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(take(is("save-schema")).length).toBe(2);
        expect(not_defined()).toEqual([]);
    });

    test("an answer of this tab that lands during the apply is said, not dropped", () => {
        const tab = build("s4", APPLICABLE);
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        expect(gobj_current_state(tab)).toBe("ST_APPLYING");
        /*  A saved-schema of a round the apply ended.  */
        const fake = {kw: {__md_iev__: {
            console_purpose: "treedbsaved", console_node: NODE, console_yuno: YUNO,
            console_owner: "owner_a", saved_round: "999999"
        }}};
        answer(tab, fake, 0, []);
        expect(warnings().some((w) => /treedbsaved.*during the apply.*ignored/.test(w))).toBe(true);
        run_the_apply(tab);
        discover(tab, APPLICABLE);
        expect(gobj_current_state(tab)).toBe("ST_READY");
        expect(errors()).toEqual([]);
    });
});

describe("the Apply dialog follows what it shows", () => {

    test("a Save closes it, and says so: what it listed is about to change", () => {
        const tab = build("d1", APPLICABLE);
        gobj_send_event(tab, "EV_APPLY_CHANGES", {}, tab);
        expect(modals.length).toBe(1);
        gobj_send_event(tab, "EV_SAVE_SCHEMA", {}, tab);
        expect(modals[0].closed).toBe(true);
        expect(tab.priv.modal).toBe(null);
        expect(shown).toEqual([SAVED_CHANGED]);
        expect(take(is("save-schema")).length).toBe(2);
    });

    test("a new saved-schema round closes it too", () => {
        const tab = build("d2", APPLICABLE);
        gobj_send_event(tab, "EV_APPLY_CHANGES", {}, tab);
        tab.priv.saved_interrupted = true;          /*  as a close in a round leaves it  */
        gobj_send_event(tab, "EV_ON_OPEN", {}, link);
        expect(take(is("saved-schema")).length).toBe(2);
        expect(modals[0].closed).toBe(true);
        expect(shown).toEqual([SAVED_CHANGED]);
    });

    test.each(["ST_DISCOVERING", "ST_IDLE", "ST_EMPTY", "ST_APPLYING"])(
        "its Apply in %s is refused and said, not NOT DEFINED", (state) => {
            const tab = build(`d3_${state}`, APPLICABLE);
            gobj_change_state(tab, state);
            gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
            expect(not_defined()).toEqual([]);
            expect(take(is("apply-schema"))).toEqual([]);
            expect(shown).toEqual([NOT_READY]);
            expect(warnings().some((w) => /EV_APPLY_CONFIRMED refused in/.test(w))).toBe(true);
        });
});

describe("a late answer of an apply step is said", () => {

    test("an apply-schema answered after its deadline, while the kill runs", () => {
        const tab = build("l1", APPLICABLE);
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        const reqs = take(is("apply-schema"));
        const a = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_a");
        const b = reqs.find((r) => r.kw.__md_iev__.console_owner === "owner_b");
        answer(tab, a, 0, [{treedb_name: "treedb_x", result: 0, data: {applied: true}}]);
        vi.advanceTimersByTime(31 * 1000);          /*  owner_b silent: restart anyway  */
        expect(gobj_current_state(tab)).toBe("ST_KILLING");
        logged.length = 0;
        answer(tab, b, 0, []);
        expect(warnings().some((w) => /'apply' of owner_b answered after its step, in ST_KILLING: ignored/.test(w))).toBe(true);
    });

    test("a step answered after the sequence ended", () => {
        const tab = build("l2", APPLICABLE);
        gobj_send_event(tab, "EV_APPLY_CONFIRMED", {}, tab);
        const reqs = take(is("apply-schema"));
        vi.advanceTimersByTime(31 * 1000);          /*  nobody answered: nothing restarted  */
        expect(gobj_current_state(tab)).toBe("ST_DISCOVERING");
        logged.length = 0;
        answer(tab, reqs[0], 0, []);
        expect(warnings().some((w) => /'apply' of owner_[ab] answered after the apply ended: ignored/.test(w))).toBe(true);
    });
});

describe("the rounds are counted for the module, not per tab", () => {

    test("a tab opened again never shares a round number with the one before", () => {
        const one = build("r1", {});
        const two = build("r2", {});
        expect(two.priv.saved_round).not.toBe(one.priv.saved_round);
        gobj_send_event(one, "EV_SAVE_SCHEMA", {}, one);
        gobj_send_event(two, "EV_SAVE_SCHEMA", {}, two);
        expect(two.priv.save_round).not.toBe(one.priv.save_round);
    });
});
