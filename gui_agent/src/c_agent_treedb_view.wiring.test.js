/***********************************************************************
 *          c_agent_treedb_view.wiring.test.js
 *
 *      C_AGENT_TREEDB_VIEW forwards the session edges to the view it
 *      hosts (EV_TRANSPORT_STATE). The view's TRANSPORT is the routing
 *      adapter it built, which hears the same edge from the same link
 *      -- AFTER this gclass, because it subscribed later. Forwarded at
 *      once, "connected" reached the schema editor while its transport
 *      still said ST_DISCONNECTED, and the reload it asked for on the
 *      reconnect was refused: "cannot route 'nodes' -- not in session",
 *      three times, seen live on artgins.yunetacontrol.com with gobj-ui
 *      7.25.6 (whose editor reloads on the reconnect after a drop).
 *
 *      The library views are replaced by a fake that records, at each
 *      edge, what its transport says.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const seen = [];
let watched = "";     /*  only the views of the mount under test record  */

vi.mock("@yuneta/gobj-ui/src/c_yui_service_view.js", async () => {
    const gjs = await import("@yuneta/gobj-js");
    return {
        yui_mount_service_view: (host, spec) => {
            return gjs.gobj_create_service(spec.name, "C_FAKE_HOSTED",
                {transport: spec.transport}, host);
        }
    };
});
vi.mock("@yuneta/gobj-ui/src/lib_graph.js", () => ({
    set_pressed_state: () => 0,
}));
vi.mock("@yuneta/gobj-ui/src/c_yui_shell.js", () => ({
    yui_shell_of: () => null,
    yui_shell_navigate: () => 0,
}));

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_start, gobj_change_state, gobj_current_state, gobj_publish_event,
    gobj_read_pointer_attr, gobj_write_attr, gobj_name,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_treedb_link} = await import("./c_agent_treedb_link.js");
const {register_c_agent_treedb_view} = await import("./c_agent_treedb_view.js");

const logged = [];
let yuno = null;
let iev = null;
let link = null;

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();

    gclass_create("C_TEST_HOST", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_IEV", [], [["ST_DISCONNECTED", []], ["ST_SESSION", []]], {
        mt_command_parser: () => null
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
    /*  The hosted library view: what it records is the question.  */
    const noop = () => 0;
    gclass_create(
        "C_FAKE_HOSTED",
        [["EV_TRANSPORT_STATE", 0], ["EV_SHOW", 0], ["EV_HIDE", 0], ["EV_SET_LANDING_VIEW", 0],
         ["EV_SHOW_TOPIC_INFO", 0]],
        [["ST_IDLE", [
            ["EV_TRANSPORT_STATE", (gobj, ev, kw) => {
                const transport = gobj_read_pointer_attr(gobj, "transport");
                if(gobj_name(gobj).includes(watched)) {
                    seen.push({connected: kw.connected, transport: gobj_current_state(transport)});
                }
                return 0;
            }, null],
            ["EV_SHOW", noop, null],
            ["EV_HIDE", noop, null],
            ["EV_SET_LANDING_VIEW", noop, null],
            ["EV_SHOW_TOPIC_INFO", noop, null]
        ]]],
        {
            mt_create: (gobj) => {
                gobj_write_attr(gobj, "$container", document.createElement("div"));
            }
        },
        0,
        [
            SDATA(data_type_t.DTP_POINTER, "transport",  0, null, ""),
            SDATA(data_type_t.DTP_POINTER, "$container", 0, null, ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );
    register_c_agent_treedb_link();
    register_c_agent_treedb_view();

    yuno = gobj_create_yuno("view_yuno", "C_TEST_HOST", {});
    gobj_start(yuno);
    iev = gobj_create_service("iev", "C_TEST_IEV", {}, yuno);
    gobj_change_state(iev, "ST_SESSION");
    link = gobj_create_service("agent_link", "C_TEST_LINK", {iev: iev}, yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    seen.length = 0;
    logged.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

function mount(name)
{
    watched = `yuno_${name}_`;
    const host = gobj_create(`${name}_host`, "C_TEST_HOST", {}, yuno);
    const view = gobj_create(name, "C_AGENT_TREEDB_VIEW", {
        node: "node_1", yuno_id: `yuno_${name}`, treedb_name: "treedb_system_schema"
    }, host);
    gobj_start(view);
    vi.runOnlyPendingTimers();
    seen.length = 0;
    /*  What the mount says without the owning tab above it is not the
     *  question here.  */
    logged.length = 0;
    return view;
}

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

describe("the session edges reach the hosted views AFTER their transport", () => {

    test("'connected' is forwarded once the adapter is in session", () => {
        gobj_change_state(iev, "ST_DISCONNECTED");
        mount("v1");

        gobj_change_state(iev, "ST_SESSION");
        gobj_publish_event(link, "EV_ON_OPEN", {});
        vi.runOnlyPendingTimers();
        /*  Two hosted views on the system-schema treedb: the tables and
         *  the schema editor.  */
        expect(seen.length).toBe(2);
        for(const s of seen) {
            expect(s).toEqual({connected: true, transport: "ST_SESSION"});
        }
        expect(errors()).toEqual([]);
    });

    test("'disconnected' is forwarded once the adapter has settled its requests", () => {
        gobj_change_state(iev, "ST_SESSION");
        mount("v2");

        gobj_change_state(iev, "ST_DISCONNECTED");
        gobj_publish_event(link, "EV_ON_CLOSE", {});
        vi.runOnlyPendingTimers();
        expect(seen.length).toBe(2);
        for(const s of seen) {
            expect(s).toEqual({connected: false, transport: "ST_DISCONNECTED"});
        }
        expect(errors()).toEqual([]);
    });
});
