/***********************************************************************
 *          transport_teardown.wiring.test.js
 *
 *      Who ends a transport, or a scan's watchdog, and from WHERE.
 *
 *      A subscriber must not destroy the tree of the gobj that is
 *      publishing to it: gobj_publish_event() dispatches synchronously,
 *      and the publisher's own code goes on when the publication returns,
 *      on a gobj that is gone. The C kernel says it since 7.26.10, and
 *      gobj-js since 7.26.22: "Destroying a gobj while its tree is
 *      publishing". Two places of this app did it:
 *
 *      - a connection refused AGAIN after a token refresh: the app root
 *        rejected it inside the transport's own EV_ON_ID_NAK, and the
 *        reject destroyed that transport under its publication;
 *
 *      - a scan that timed out: C_TREEDB_LINKS ended it inside the
 *        EV_TIMEOUT of the scan's C_TIMER, and the end destroyed that
 *        timer under its publication.
 *
 *      Both end on the next turn now, from an event the gclass posts to
 *      itself. What is checked here holds with any gobj-js: the publisher
 *      is alive when its publication returns, and the end comes one turn
 *      later.
 *
 *      Driven through the real gclasses (C_TREEDB_APP, C_TREEDB_LINKS,
 *      C_TREEDB_CONFIG, C_TIMER); the transport and the login are doubles
 *      that publish what the real ones publish.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";

/*  The config persists in localStorage.  */
const storage = new Map();
globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => {
        storage.set(k, String(v));
    },
    removeItem: (k) => {
        storage.delete(k);
    },
    clear: () => {
        storage.clear();
    },
};

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create_service, gobj_find_service,
    gobj_start, gobj_send_event, gobj_publish_event, gobj_subscribe_event,
    gobj_read_pointer_attr, gobj_change_state, gobj_current_state,
    gobj_is_destroying, gobj_destroy, gobj_stop_tree,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_treedb_config} = await import("./c_treedb_config.js");
const {
    register_c_treedb_links,
    treedb_links_get_iev,
    treedb_links_get_open_error,
    treedb_links_is_scanning,
} = await import("./c_treedb_links.js");
const {register_c_app} = await import("./c_app.js");

const logged = [];
const log_sink = (level, msg) => {
    logged.push({level: String(level), msg: String(msg)});
};
const heard = [];
let yuno = null;

/*  What the transport does: its NAK is published from an action, and
 *  after the publication it is still running.  */
let alive_after_nak = null;

function service_subscription(gobj)
{
    /*
     *  SERVICE subscription model
     */
    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }
}

beforeAll(() => {
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(log_sink);
    register_c_timer();
    register_c_treedb_config();
    register_c_treedb_links();
    register_c_app();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

    gclass_create(
        "C_IEVENT_CLI",
        [
            ["EV_ON_OPEN", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_CLOSE", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_ID_NAK", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_FAKE_NAK", 0],
        ],
        [
            ["ST_SESSION", [
                ["EV_FAKE_NAK", (gobj, event, kw) => {
                    gobj_publish_event(gobj, "EV_ON_ID_NAK", {comment: kw.comment});
                    alive_after_nak = !gobj_is_destroying(gobj);
                    return 0;
                }, null],
            ]],
        ],
        {
            mt_create: service_subscription,
            mt_command_parser: () => null,
        },
        0,
        [
            SDATA(data_type_t.DTP_STRING, "url", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_role", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_service", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_name", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "jwt", 0, "", ""),
            SDATA(data_type_t.DTP_JSON, "required_services", 0, null, ""),
            SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );

    const login_out = [
        "EV_LOGIN_ACCEPTED", "EV_LOGIN_REFRESHED", "EV_REFRESH_FAILED",
        "EV_LOGIN_DENIED", "EV_RESTORE_FAILED", "EV_LOGOUT_DONE",
    ];
    gclass_create(
        "C_TREEDB_LOGIN",
        login_out.map((ev) => [ev, event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS])
            .concat([["EV_DO_REFRESH", 0]]),
        [
            ["ST_LOGIN", [
                ["EV_DO_REFRESH", (gobj, event) => {
                    heard.push(event);
                    return 0;
                }, null]
            ]],
            /*  A logout in flight: the real login takes no refresh then.  */
            ["ST_LOGGING_OUT", []],
        ],
        {mt_create: service_subscription},
        0,
        [SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""), SDATA_END()],
        {}, 0, 0, 0, 0
    );

    /*  Who hears what the links publish, in the scan test.  */
    const scan_out = ["EV_TREEDB_SCAN_DONE", "EV_TREEDB_SCAN_ERROR"];
    gclass_create(
        "C_TEST_LINKS_HOST",
        scan_out.map((ev) => [ev, 0]),
        [["ST_IDLE", scan_out.map((ev) => [ev, (gobj, event, kw) => {
            heard.push({event: event, kw: kw});
            return 0;
        }, null])]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0
    );

    yuno = gobj_create_yuno("teardown_yuno", "C_TEST_YUNO", {});
    gobj_start(yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    heard.length = 0;
    alive_after_nak = null;
    storage.clear();
});

/*  What a test built goes, passed or failed: a service name is taken
 *  until its gobj is destroyed.  */
const built = [];

afterEach(() => {
    for(const g of built.splice(0)) {
        if(!gobj_is_destroying(g)) {
            gobj_stop_tree(g);
            gobj_destroy(g);
        }
    }
    vi.useRealTimers();
});

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

const CONN = {id: "c1", url: "wss://backend.example:1800", enabled: true,
    remote_yuno_role: "db", remote_yuno_service: "treedb_db"};

describe("a connection refused while a logout is in flight", () => {

    test("asks for no refresh: the logout closes the links when it settles", () => {
        const app = gobj_create_service("treedb_app", "C_TREEDB_APP", {}, yuno);
        built.push(app);
        gobj_start(app);
        gobj_change_state(app, "ST_SESSION");
        const links = gobj_find_service("treedb_links", true);
        gobj_send_event(links, "EV_SYNC_CONNECTIONS", {connections: [CONN]}, app);
        const iev = treedb_links_get_iev(links, "c1");
        expect(iev).toBeTruthy();
        gobj_change_state(iev, "ST_SESSION");
        /*  The app may arm another log sink: take the log back.  */
        set_log_callback(log_sink);
        logged.length = 0;

        const login = gobj_find_service("treedb_login", true);
        gobj_change_state(login, "ST_LOGGING_OUT");
        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "token expired"}, iev);
        vi.advanceTimersToNextTimer();
        gobj_change_state(login, "ST_LOGIN");

        expect(heard).toEqual([]);
        expect(app.priv.refreshing).toBeFalsy();
        expect(errors().filter((m) => /NOT DEFINED/.test(m))).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && /no session to refresh/.test(l.msg)).length)
            .toBe(1);
    });
});

describe("a connection refused again after a token refresh", () => {

    test("is rejected on the next turn, not inside its transport's EV_ON_ID_NAK", () => {
        const app = gobj_create_service("treedb_app", "C_TREEDB_APP", {}, yuno);
        built.push(app);
        gobj_start(app);
        /*  A session, without the shell: what is driven here is the
         *  connection, and the app draws nothing without a shell.  */
        gobj_change_state(app, "ST_SESSION");
        const links = gobj_find_service("treedb_links", true);
        gobj_send_event(links, "EV_SYNC_CONNECTIONS", {connections: [CONN]}, app);
        const iev = treedb_links_get_iev(links, "c1");
        expect(iev).toBeTruthy();
        gobj_change_state(iev, "ST_SESSION");

        /*  The first NAK asks for a fresh token.  */
        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "token expired"}, iev);
        expect(heard).toEqual(["EV_DO_REFRESH"]);
        expect(alive_after_nak).toBe(true);
        /*  ...and the refresh came back and reopened it (ac_login_refreshed
         *  marks the connection as refreshed once).  */
        app.priv.nak_recovered.c1 = true;

        /*  The second one is a refusal.  */
        alive_after_nak = null;
        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "no role"}, iev);
        expect(alive_after_nak).toBe(true);
        expect(gobj_is_destroying(iev)).toBe(false);

        vi.advanceTimersToNextTimer();
        expect(gobj_is_destroying(iev)).toBe(true);
        expect(treedb_links_get_iev(links, "c1")).toBe(null);
        expect(treedb_links_get_open_error(links, "c1")).toEqual(
            expect.objectContaining({rejected: true, reason: "no role"}));
        expect(errors().filter((m) => /Destroying a gobj/.test(m))).toEqual([]);
        expect(errors().filter((m) => /NOT DEFINED/.test(m))).toEqual([]);

    });
});

describe("a scan that times out", () => {

    test("ends on the next turn, not inside its watchdog's EV_TIMEOUT", () => {
        const host = gobj_create_service("links_host", "C_TEST_LINKS_HOST", {}, yuno);
        const links = gobj_create_service("scan_links", "C_TREEDB_LINKS",
            {subscriber: host}, yuno);
        built.push(links, host);
        gobj_start(links);
        gobj_send_event(links, "EV_SYNC_CONNECTIONS", {connections: [CONN]}, host);
        const iev = treedb_links_get_iev(links, "c1");
        gobj_change_state(iev, "ST_SESSION");

        gobj_send_event(links, "EV_SCAN_CONN", {conn_id: "c1"}, host);
        expect(treedb_links_is_scanning(links, "c1")).toBe(true);
        const timer = links.priv.scans.c1.timer;

        /*  The watchdog fires: its EV_TIMEOUT is delivered, and it is
         *  still there when that returns.  */
        vi.advanceTimersToNextTimer();
        expect(gobj_is_destroying(timer)).toBe(false);
        expect(heard).toEqual([]);

        vi.advanceTimersToNextTimer();
        expect(gobj_is_destroying(timer)).toBe(true);
        expect(treedb_links_is_scanning(links, "c1")).toBe(false);
        expect(heard).toEqual([{
            event: "EV_TREEDB_SCAN_DONE",
            kw: {conn_id: "c1", services: [], errors: [{yuno: "", error: "scan timeout"}]}
        }]);
        expect(errors().filter((m) => /Destroying a gobj/.test(m))).toEqual([]);

    });
});
