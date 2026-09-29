/***********************************************************************
 *          c_agent_users.wiring.test.js
 *
 *      The Users tab (C_AGENT_USERS) driven through its FSM, with the
 *      link, the shell and the table replaced by doubles: what it SENDS
 *      for each action, in which order, and what it does with each kind
 *      of answer -- the control center's dispatch ack, a refused
 *      dispatch, the yuno's answer, a late one, none at all.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  What the confirm dialogs answer, and what they were asked.  */
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

const test_shell = {shell: null};
vi.mock("@yuneta/gobj-ui/src/c_yui_shell.js", () => ({
    yui_shell_of: () => test_shell.shell,
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
            this.handlers = {};
        }
        on(ev, fn) {
            this.handlers[ev] = fn;
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
const {register_c_agent_users} = await import("./c_agent_users.js");

const NODE = "node_1";
const YUNO = "1996";

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
let iev = null;
let n_views = 0;

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();
    register_c_agent_users();

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_SHELL", [["EV_LANGUAGE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT]],
        [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_SESSION", []], ["ST_DISCONNECTED", []]],
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

    yuno = gobj_create_yuno("users_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
    test_shell.shell = gobj_create_service("shell", "C_TEST_SHELL", {}, yuno);
    host = gobj_create("host", "C_TEST_HOST", {}, yuno);
});

beforeEach(() => {
    logged.length = 0;
    sent.length = 0;
    modals.length = 0;
    confirm.answer = true;
    confirm.asked.length = 0;
    gobj_change_state(iev, "ST_SESSION");
});

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

function warnings()
{
    return logged.filter((l) => l.level === "warning").map((l) => l.msg);
}

/*  A new tab, started with the session up: its load is in flight.  */
function new_view()
{
    const v = gobj_create(`users_${++n_views}`, "C_AGENT_USERS",
        {node: NODE, yuno_id: YUNO, yuno_label: "controlcenter^artgins.com"}, host);
    gobj_start(v);
    return v;
}

/*  The inner command of a request: `command="users"` in its cmd2agent.  */
function inner(req)
{
    const m = /command="([^"]+)"/.exec(req.kw.cmd2agent);
    return m ? m[1] : "";
}

function service_of(req)
{
    const m = /service="([^"]+)"/.exec(req.kw.cmd2agent);
    return m ? m[1] : "";
}

/*  An answer to `req`, the way the link re-publishes it: the request's
 *  own __md_iev__ echoed, with the frame of the hop that answers.  */
function answer(view, req, {result = 0, data = null, comment = "", outer = "command-yuno"} = {})
{
    gobj_send_event(view, "EV_MT_COMMAND_ANSWER", {
        result: result,
        comment: comment,
        data: data,
        __md_iev__: Object.assign({}, req.kw.__md_iev__, {
            command_stack: [{command: outer, kw: {}}]
        })
    }, link);
}

/*  The dispatch ack of the control center, then the yuno's answer.  */
function reply(view, req, opts)
{
    answer(view, req, {outer: "command-agent", comment: "Command sent to 1 nodes"});
    answer(view, req, opts);
}

const SERVICES = [
    {service: "__yuno__", gclass: "C_YUNO"},
    {service: "authz", gclass: "C_AUTHZ"},
    {service: "treedb_authzs", gclass: "C_NODE"},
    {service: "controlcenter", gclass: "C_CONTROLCENTER"}
];
const USERS = [
    {id: "yuneta", roles: [{id: "root", topic_name: "roles", hook_name: "users"}],
     disabled: false, time: 1789920406, __sessions: {}, __md_treedb__: {immutable: true}},
    {id: "claudia@artgins.com", roles: ["roles^root^users"], disabled: false,
     time: 1790000000, __sessions: {a: {}}}
];
const ROLES = [
    {id: "root", description: "Super-Owner of system", service: "*", realm_id: "*"},
    {id: "controlcenter", description: "Controlcenter", service: "controlcenter"}
];

/*  Take a new tab to READY, the store read and this yuno its master.  */
function ready_view(master = true)
{
    const v = new_view();
    expect(sent.map(inner)).toEqual(["services"]);
    reply(v, sent[0], {data: SERVICES});
    const [users, roles, info] = sent.slice(1);
    reply(v, users, {data: USERS});
    reply(v, roles, {data: ROLES});
    reply(v, info, {data: {master: master}});
    expect(gobj_current_state(v)).toBe("ST_READY");
    sent.length = 0;
    return v;
}

describe("reading a users store", () => {

    test("services first, then users, roles and treedb-info, each ack dropped", () => {
        const v = new_view();
        expect(gobj_current_state(v)).toBe("ST_LOADING");
        expect(sent.length).toBe(1);
        expect(sent[0].command).toBe("command-agent");
        expect(sent[0].kw.agent_id).toBe(NODE);
        expect(sent[0].kw.cmd2agent).toBe('command-yuno id="1996" service="__yuno__" command="services"');

        answer(v, sent[0], {outer: "command-agent", comment: "Command sent to 1 nodes"});
        expect(sent.length).toBe(1);        /*  an ack is not the answer  */

        answer(v, sent[0], {data: SERVICES});
        expect(sent.slice(1).map((r) => [service_of(r), inner(r)])).toEqual([
            ["authz", "users"], ["authz", "roles"], ["treedb_authzs", "treedb-info"]
        ]);
        reply(v, sent[1], {data: USERS});
        reply(v, sent[2], {data: ROLES});
        expect(gobj_current_state(v)).toBe("ST_LOADING");
        reply(v, sent[3], {data: {master: true}});

        expect(gobj_current_state(v)).toBe("ST_READY");
        expect(v.priv.users.map((u) => u.id)).toEqual(["yuneta", "claudia@artgins.com"]);
        expect(v.priv.users[0].immutable).toBe(true);
        expect(v.priv.roles.map((r) => r.id)).toEqual(["controlcenter", "root"]);
        expect(v.priv.master).toBe(true);
        expect(gobj_read_attr(v, "tabulator").data.length).toBe(2);
        expect(errors()).toEqual([]);
    });

    test("a yuno with no users store says so and asks nothing more", () => {
        const v = new_view();
        reply(v, sent[0], {data: [{service: "authz", gclass: "C_AUTHZ"}]});
        expect(sent.length).toBe(1);
        expect(gobj_current_state(v)).toBe("ST_NO_USERS");
        expect(errors()).toEqual([]);
    });

    test("an agent too old for treedb-info leaves the master unknown, not a failure", () => {
        const v = new_view();
        reply(v, sent[0], {data: SERVICES});
        reply(v, sent[1], {data: USERS});
        reply(v, sent[2], {data: ROLES});
        reply(v, sent[3], {result: -1, comment: "command not available"});
        expect(gobj_current_state(v)).toBe("ST_READY");
        expect(v.priv.master).toBe(null);
        expect(v.priv.message).toBe(null);
    });

    test("a refused dispatch is the answer: the read fails and says why", () => {
        const v = new_view();
        answer(v, sent[0], {outer: "command-agent", result: -1, comment: "Agent not found"});
        expect(gobj_current_state(v)).toBe("ST_NO_USERS");
        expect(v.priv.message).toEqual({kind: "error", key: "users not read", text: "Agent not found"});
    });

    test("a read never answered is settled by its deadline, and a late answer is dropped", () => {
        const v = new_view();
        const first = sent[0];
        gobj_send_event(v, "EV_TIMEOUT", {}, v);
        expect(errors().length).toBe(1);
        expect(errors()[0]).toMatch(/not answered by node 'node_1' in 30 s/);
        expect(gobj_current_state(v)).toBe("ST_NO_USERS");

        answer(v, first, {data: SERVICES});
        expect(warnings()[0]).toMatch(/answer of a batch that is over/);
        expect(gobj_current_state(v)).toBe("ST_NO_USERS");
    });

    test("the answers of another yuno's tab are not ours", () => {
        const v = new_view();
        const other = JSON.parse(JSON.stringify(sent[0]));
        other.kw.__md_iev__.console_yuno = "1997";
        answer(v, other, {data: SERVICES});
        expect(sent.length).toBe(1);
        expect(gobj_current_state(v)).toBe("ST_LOADING");
    });
});

describe("writing users", () => {

    test("create: the user alone, then one link per role, then the store is read again", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_CREATE_USER",
            {username: " new@artgins.com ", roles: ["root", "controlcenter"], disabled: true}, v);
        expect(gobj_current_state(v)).toBe("ST_WRITING");
        expect(sent.length).toBe(1);
        expect(inner(sent[0])).toBe("create-user");
        expect(sent[0].kw.username).toBe("new@artgins.com");
        expect(sent[0].kw.disabled).toBe(true);
        expect(sent[0].kw.role).toBe(undefined);    /*  a role here would be the only one  */

        reply(v, sent[0], {comment: "controlcenter^artgins.com: User created: new@artgins.com"});
        const links = sent.slice(1);
        expect(links.map((r) => [service_of(r), inner(r), r.kw.parent_ref, r.kw.child_ref])).toEqual([
            ["treedb_authzs", "link-nodes", "roles^root^users", "users^new@artgins.com"],
            ["treedb_authzs", "link-nodes", "roles^controlcenter^users", "users^new@artgins.com"]
        ]);
        reply(v, links[0]);
        reply(v, links[1]);

        /*  Read again, without asking which service keeps the users.  */
        expect(gobj_current_state(v)).toBe("ST_LOADING");
        expect(sent.slice(3).map(inner)).toEqual(["users", "roles", "treedb-info"]);
        expect(v.priv.message).toEqual(
            {kind: "ok", text: "controlcenter^artgins.com: User created: new@artgins.com"});
        expect(errors()).toEqual([]);
    });

    test("create: a refused user stops there, no role is linked", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_CREATE_USER", {username: "x@y", roles: ["root"], disabled: false}, v);
        reply(v, sent[0], {result: -1, comment: "READ-ONLY replica, the users store cannot be written here"});
        expect(sent.slice(1).map(inner)).toEqual(["users", "roles", "treedb-info"]);
        expect(v.priv.message.kind).toBe("error");
        expect(v.priv.message.key).toBe("users write failed");
        expect(v.priv.message.text).toMatch(/READ-ONLY replica/);
    });

    test("create: a bad or existing username sends nothing", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_CREATE_USER", {username: "rosa martinez", roles: [], disabled: false}, v);
        gobj_send_event(v, "EV_CREATE_USER", {username: "yuneta", roles: [], disabled: false}, v);
        expect(sent).toEqual([]);
        expect(gobj_current_state(v)).toBe("ST_READY");
    });

    test("roles: what was taken is unlinked and what was given is linked", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_SET_ROLES", {username: "claudia@artgins.com", roles: ["controlcenter"]}, v);
        expect(sent.map((r) => [inner(r), r.kw.parent_ref])).toEqual([
            ["unlink-nodes", "roles^root^users"],
            ["link-nodes", "roles^controlcenter^users"]
        ]);
    });

    test("disable: asked first, then disable-user", async () => {
        const v = ready_view();
        gobj_send_event(v, "EV_DISABLE_USER", {username: "claudia@artgins.com"}, v);
        expect(sent).toEqual([]);
        expect(confirm.asked.map((a) => a.kind)).toEqual(["yesno"]);
        await Promise.resolve();
        await Promise.resolve();
        expect(sent.map(inner)).toEqual(["disable-user"]);
        expect(sent[0].kw.username).toBe("claudia@artgins.com");
    });

    test("delete: asked in red, and forced when the user holds roles", async () => {
        const v = ready_view();
        gobj_send_event(v, "EV_DELETE_USER", {username: "claudia@artgins.com"}, v);
        expect(confirm.asked.map((a) => a.kind)).toEqual(["danger"]);
        await Promise.resolve();
        await Promise.resolve();
        expect(sent.map(inner)).toEqual(["delete-user"]);
        expect(sent[0].kw).toMatchObject({username: "claudia@artgins.com", force: true});
    });

    test("delete: a cancelled dialog sends nothing", async () => {
        const v = ready_view();
        confirm.answer = false;
        gobj_send_event(v, "EV_DELETE_USER", {username: "claudia@artgins.com"}, v);
        await Promise.resolve();
        await Promise.resolve();
        expect(sent).toEqual([]);
    });

    test("a write asked for while another is in flight is not sent, and says so", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_ENABLE_USER", {username: "claudia@artgins.com"}, v);
        expect(sent.length).toBe(1);
        gobj_send_event(v, "EV_DELETE_CONFIRMED", {username: "claudia@artgins.com", force: true}, v);
        expect(sent.length).toBe(1);
        expect(v.priv.message).toEqual({kind: "error", key: "users write not sent"});
        expect(errors()).toEqual([]);
    });

    test("the session dropping ends the write and says it was not answered", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_ENABLE_USER", {username: "claudia@artgins.com"}, v);
        gobj_change_state(iev, "ST_DISCONNECTED");
        gobj_send_event(v, "EV_ON_CLOSE", {}, link);
        expect(gobj_current_state(v)).toBe("ST_IDLE");
        expect(v.priv.message).toEqual({kind: "error", key: "users write not answered"});
        expect(v.priv.batch).toBe(null);
    });

    test("a row opens its sheet, read-only while the store is being read", () => {
        const v = ready_view();
        gobj_send_event(v, "EV_OPEN_USER", {username: "claudia@artgins.com"}, v);
        expect(modals.length).toBe(1);
        expect(modals[0].opts.title_prefix).toBe("claudia@artgins.com");
        gobj_send_event(v, "EV_REFRESH", {}, v);
        expect(modals[0].closed).toBe(false);   /*  a refresh does not close it  */
        gobj_send_event(v, "EV_OPEN_USER", {username: "yuneta"}, v);
        expect(modals[0].closed).toBe(true);
        expect(modals.length).toBe(2);
        expect(errors()).toEqual([]);
    });
});
