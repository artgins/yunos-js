/***********************************************************************
 *          session_refused.wiring.test.js
 *
 *      A control-center identity refused AGAIN after a silent token
 *      refresh ends the session: the shell goes, the link is stopped and
 *      its transport destroyed, and the login screen comes back.
 *
 *      That happened inside the transport's own EV_ON_ID_NAK publication:
 *      stopping C_AGENT_LINK destroys its C_IEVENT_CLI, and the transport
 *      was destroyed under the publication it was still running. A
 *      subscriber must not destroy the tree of its publisher
 *      synchronously -- the C kernel says it since 7.26.10, gobj-js since
 *      7.26.22 ("Destroying a gobj while its tree is publishing"). The
 *      end of the session runs on the next turn now, from an event the
 *      app posts to itself.
 *
 *      What is checked holds with any gobj-js: the transport is alive
 *      when its publication returns, and the session ends one turn later.
 *
 *      Driven through the real C_APP, C_AGENT_LINK, C_AGENT_CONFIG and
 *      C_MONITOR_LINK; the transport, the login and the shell are doubles.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  The login screen is HTML the document double does not parse: what
 *  matters here is that it comes back.  */
const login_screens = [];
vi.mock("./login.js", () => ({
    mount_login: () => {
        const screen = {error: "", busy: null, mounted: true};
        login_screens.push(screen);
        return {
            set_error(msg) {
                screen.error = msg;
            },
            clear_error() {
                screen.error = "";
            },
            set_busy(busy) {
                screen.busy = busy;
            },
            unmount() {
                screen.mounted = false;
            }
        };
    }
}));

const {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create, gobj_create_service,
    gobj_find_service,
    gobj_start, gobj_send_event, gobj_publish_event, gobj_subscribe_event,
    gobj_read_pointer_attr, gobj_read_attr, gobj_change_state,
    gobj_is_destroying, gobj_is_running,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_config} = await import("./c_agent_config.js");
const {register_c_agent_link} = await import("./c_agent_link.js");
const {register_c_monitor_link} = await import("./c_monitor_link.js");
const {register_c_app} = await import("./c_app.js");

const logged = [];
const log_sink = (level, msg) => {
    logged.push({level: String(level), msg: String(msg)});
};
const heard = [];
let yuno = null;

/*  The transport publishes its NAK from an action, and is still running
 *  when the publication returns.  */
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
    register_c_agent_config();
    register_c_agent_link();
    register_c_monitor_link();
    register_c_app();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    gclass_create("C_TEST_SHELL", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

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
        {mt_create: service_subscription},
        0,
        [
            SDATA(data_type_t.DTP_STRING, "url", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_role", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_service", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_name", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "jwt", 0, "", ""),
            SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );

    const login_out = [
        "EV_LOGIN_ACCEPTED", "EV_LOGIN_REFRESHED", "EV_REFRESH_FAILED",
        "EV_LOGIN_DENIED", "EV_RESTORE_FAILED", "EV_LOGOUT_DONE",
    ];
    const login_in = ["EV_DO_REFRESH", "EV_DO_LOGOUT"];
    gclass_create(
        "C_AGENT_LOGIN",
        login_out.map((ev) => [ev, event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS])
            .concat(login_in.map((ev) => [ev, 0])),
        [
            ["ST_LOGIN", login_in.map((ev) => [ev, (gobj, event) => {
                heard.push(event);
                return 0;
            }, null])],
            /*  A logout in flight: the real login takes no refresh then.  */
            ["ST_LOGGING_OUT", []],
        ],
        {mt_create: service_subscription},
        0,
        [SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""), SDATA_END()],
        {}, 0, 0, 0, 0
    );

    yuno = gobj_create_yuno("refused_yuno", "C_TEST_YUNO", {});
    gobj_start(yuno);
});

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    heard.length = 0;
    alive_after_nak = null;
});

afterEach(() => {
    vi.useRealTimers();
});

function errors()
{
    return logged.filter((l) => l.level === "error").map((l) => l.msg);
}

/*  The app with its link in session, made once: its services are
 *  named, so a second app would clash with the first.  */
let session = null;
function app_in_session()
{
    if(!session) {
        const app = gobj_create_service("app", "C_APP", {}, yuno);
        gobj_start(app);
        const link = gobj_find_service("agent_link", true);
        gobj_start(link);
        const iev = gobj_read_attr(link, "iev");
        expect(iev).toBeTruthy();
        gobj_change_state(iev, "ST_SESSION");
        session = {app, link, iev};
        /*  The app arms the developer window's log sink: take the log
         *  back, without the lines it replays.  */
        set_log_callback(log_sink);
        logged.length = 0;
    }
    return session;
}

describe("an identity refused while a logout is in flight", () => {

    test("asks for no refresh: the logout ends the link when it settles", () => {
        const {iev} = app_in_session();
        const login = gobj_find_service("agent_login", true);
        gobj_change_state(login, "ST_LOGGING_OUT");

        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "token expired"}, iev);
        vi.advanceTimersToNextTimer();
        gobj_change_state(login, "ST_LOGIN");
        expect(heard).toEqual([]);
        expect(login_screens).toEqual([]);
        expect(errors().filter((m) => /NOT DEFINED/.test(m))).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && /no session to refresh/.test(l.msg)).length)
            .toBe(1);
    });
});

describe("an identity refused again after a token refresh", () => {

    test("ends the session on the next turn, not inside the transport's EV_ON_ID_NAK", () => {
        const {app, link, iev} = app_in_session();
        /*  A session: what the app tears down when it ends.  */
        const shell = gobj_create("shell", "C_TEST_SHELL", {}, yuno);
        gobj_start(shell);
        app.priv.shell = shell;

        /*  The first NAK asks for a silent refresh.  */
        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "token expired"}, iev);
        expect(heard).toEqual(["EV_DO_REFRESH"]);
        expect(alive_after_nak).toBe(true);

        /*  The second one ends the session.  */
        alive_after_nak = null;
        gobj_send_event(iev, "EV_FAKE_NAK", {comment: "authentication required"}, iev);
        expect(alive_after_nak).toBe(true);
        expect(gobj_is_destroying(iev)).toBe(false);
        expect(gobj_is_destroying(shell)).toBe(false);
        expect(login_screens).toEqual([]);

        vi.advanceTimersToNextTimer();
        expect(heard).toEqual(["EV_DO_REFRESH", "EV_DO_LOGOUT"]);
        expect(gobj_is_destroying(shell)).toBe(true);
        expect(app.priv.shell).toBe(null);
        expect(login_screens.length).toBe(1);
        expect(login_screens[0].mounted).toBe(true);
        expect(gobj_is_running(link)).toBe(false);
        expect(gobj_is_destroying(iev)).toBe(true);
        expect(errors().filter((m) => /Destroying a gobj/.test(m))).toEqual([]);
        expect(errors().filter((m) => /NOT DEFINED/.test(m))).toEqual([]);
    });
});
