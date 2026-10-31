/***********************************************************************
 *          login_form.wiring.test.js
 *
 *      The login form while a session is alive, and when a logout settles
 *      under it.
 *
 *      The app brings the form back, with "cannot connect - reconnecting",
 *      when the first open of the link fails after the login was accepted
 *      (ac_on_open_error): the login service is in ST_LOGIN then, and the
 *      form takes a submit. That submit replaces the session: the logout
 *      goes first, so no session is left behind, and the login goes out when
 *      it settles. The form stays busy across the two.
 *
 *      When the link opens at last, the form goes: the shell is built under
 *      it, and nobody else takes it away.
 *
 *      A session that ends before the link ever opened stops the link, as
 *      one that ends with the shell up.
 *
 *      A logout that settles with the form up gives the form back, unless
 *      the login that waited for it goes out next.
 *
 *      Driven through the real C_APP, C_AGENT_LOGIN, C_AGENT_LINK,
 *      C_AGENT_CONFIG and C_MONITOR_LINK; the transport, the BFF and the
 *      form are doubles.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  The form is HTML the document double does not parse: what is looked at
 *  is what it is told, and a submit is what it hands to the app. `busy` is
 *  what the real form sets by itself at a submit.  */
const login_screens = [];
vi.mock("./login.js", () => ({
    mount_login: (opts) => {
        const screen = {
            error: "", busy: false, mounted: true,
            submit(creds) {
                screen.busy = true;
                opts.on_submit(creds);
            }
        };
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
    gobj_start_up, gobj_create_yuno, gobj_create_service, gobj_find_service,
    gobj_start, gobj_stop_tree, gobj_destroy, gobj_send_event, gobj_publish_event,
    gobj_subscribe_event, gobj_read_pointer_attr, gobj_read_attr, gobj_current_state,
    gobj_is_destroying, gobj_is_running,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_config} = await import("./c_agent_config.js");
const {register_c_agent_link} = await import("./c_agent_link.js");
const {register_c_agent_login} = await import("./c_agent_login.js");
const {register_c_monitor_link} = await import("./c_monitor_link.js");
const {register_c_app} = await import("./c_app.js");
const {default: i18next} = await import("i18next");
const {en} = await import("./locales/en.js");
const {es} = await import("./locales/es.js");

const logged = [];
const log_sink = (level, msg) => {
    logged.push({level: String(level), msg: String(msg)});
};
const asked = [];
let answers = {};
let yuno = null;

function fake_fetch(url)
{
    const segment = String(url).split("/").pop();
    asked.push(segment);
    const answer = answers[segment];
    return (typeof answer === "function") ? answer() : answered(answer.status, answer.data);
}

function answered(status, data)
{
    return Promise.resolve({
        ok:      status >= 200 && status < 300,
        status:  status,
        headers: new Headers(),
        json:    () => Promise.resolve(data),
    });
}

/*  An answer the test gives when it wants.  */
function later_answer()
{
    let give = null;
    const answer = () => new Promise((resolve) => {
        give = (status, data) => resolve(answered(status, data));
    });
    return {answer, give: (status, data) => give(status, data)};
}

const SESSION = {status: 200, data: {success: true, username: "u", expires_in: 300}};
const NO_SESSION = {status: 401, data: {success: false, error_code: "missing_refresh_token", error: "x"}};

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

beforeAll(async () => {
    await i18next.init({lng: "en", keySeparator: false, nsSeparator: false, resources: {en, es}});
    vi.stubGlobal("fetch", fake_fetch);
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(log_sink);
    register_c_timer();
    register_c_agent_config();
    register_c_agent_link();
    register_c_agent_login();
    register_c_monitor_link();
    register_c_app();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

    const publish = (out) => (gobj, event, kw) => {
        gobj_publish_event(gobj, out, kw || {});
        return 0;
    };
    gclass_create(
        "C_IEVENT_CLI",
        [
            ["EV_ON_OPEN", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_CLOSE", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_OPEN_ERROR", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_ON_ID_NAK", event_flag_t.EVF_OUTPUT_EVENT],
            ["EV_FAKE_OPEN", 0],
            ["EV_FAKE_OPEN_ERROR", 0],
        ],
        [
            ["ST_IDLE", [
                ["EV_FAKE_OPEN", publish("EV_ON_OPEN"), null],
                ["EV_FAKE_OPEN_ERROR", publish("EV_ON_OPEN_ERROR"), null],
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
            SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );

    yuno = gobj_create_yuno("form_yuno", "C_TEST_YUNO", {});
    gobj_start(yuno);
});

const built = [];

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    asked.length = 0;
    answers = {};
    login_screens.length = 0;
});

afterEach(() => {
    for(const g of built.splice(0)) {
        if(!gobj_is_destroying(g)) {
            gobj_stop_tree(g);
            gobj_destroy(g);
        }
    }
    vi.useRealTimers();
});

async function pass_time(ms)
{
    await vi.advanceTimersByTimeAsync(ms);
}

function not_defined()
{
    return logged.filter((l) => l.level === "error" && /NOT DEFINED/.test(l.msg)).map((l) => l.msg);
}

/*  The app started, with its restore answered `restore`.  */
async function app_started(restore)
{
    answers.refresh = restore;
    const app = gobj_create_service("app", "C_APP", {}, yuno);
    const link = gobj_find_service("agent_link", true);
    const monitor = gobj_find_service("monitor_link", true);
    built.push(app, link, monitor);
    gobj_start(app);
    await pass_time(10);
    /*  The app arms the developer window's log sink: take the log back.  */
    set_log_callback(log_sink);
    logged.length = 0;
    return {
        app, link,
        login: gobj_find_service("agent_login", true),
    };
}

/*  A session whose first open of the link failed: the form is back, the
 *  login in ST_LOGIN, and nobody is logged out.  */
async function open_failed()
{
    const started = await app_started(SESSION);
    expect(gobj_current_state(started.login)).toBe("ST_LOGIN");
    expect(login_screens).toEqual([]);
    const iev = gobj_read_attr(started.link, "iev");
    expect(iev).toBeTruthy();
    gobj_send_event(iev, "EV_FAKE_OPEN_ERROR", {url: "wss://cc.example:1996"}, iev);
    expect(login_screens.length).toBe(1);
    expect(login_screens[0].error()).toContain("wss://cc.example:1996");
    return {...started, iev, screen: login_screens[0]};
}

describe("the form the failed open of the link brings back", () => {

    test("a submit replaces the session: the logout first, then the login", async () => {
        const {link, login, screen} = await open_failed();
        const logout = later_answer();
        const new_login = later_answer();
        answers.logout = logout.answer;
        answers.login = new_login.answer;
        asked.length = 0;

        screen.submit({username: "v", password: "p"});
        await pass_time(10);
        expect(not_defined()).toEqual([]);
        expect(asked).toEqual(["logout"]);
        expect(gobj_current_state(login)).toBe("ST_LOGGING_OUT");
        expect(screen.busy).toBe(true);

        logout.give(200, {success: true});
        await pass_time(10);
        expect(asked).toEqual(["logout", "login"]);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");
        expect(gobj_is_running(link)).toBe(false);
        expect(screen.mounted).toBe(true);
        expect(screen.busy).toBe(true);

        new_login.give(200, {success: true, username: "v", expires_in: 300});
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(screen.mounted).toBe(false);
        expect(gobj_is_running(link)).toBe(true);
        expect(login_screens.length).toBe(1);
        expect(not_defined()).toEqual([]);
    });

    test("a login that replaced the session and is denied: the form is given back with why", async () => {
        const {login, screen} = await open_failed();
        answers.logout = {status: 200, data: {success: true}};
        answers.login = {status: 401, data: {
            success: false, error_code: "invalid_credentials", error: "x"
        }};

        screen.submit({username: "v", password: "bad"});
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(screen.busy).toBe(false);
        expect(screen.error()).toBe(`${en.translation["login failed"]}: ` +
            `${en.translation["invalid_credentials"]}`);
    });

    test("a logout that failed does not stop the login that came after it", async () => {
        const {login, screen} = await open_failed();
        answers.logout = {status: 503, data: {success: false, error_code: "server_busy", error: "x"}};
        answers.login = {status: 200, data: {success: true, username: "v", expires_in: 300}};
        asked.length = 0;

        screen.submit({username: "v", password: "p"});
        await pass_time(10);
        expect(asked).toEqual(["logout", "login"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(screen.mounted).toBe(false);
    });

    test("the link opens at last: the form goes, and the session is the same", async () => {
        const {login, iev, screen} = await open_failed();
        asked.length = 0;
        gobj_send_event(iev, "EV_FAKE_OPEN", {}, iev);
        await pass_time(10);
        expect(screen.mounted).toBe(false);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(asked).toEqual([]);
        expect(not_defined()).toEqual([]);
    });

    test("the link fails again while a submit replaces the session: the form stays busy", async () => {
        const {iev, screen} = await open_failed();
        const logout = later_answer();
        answers.logout = logout.answer;
        answers.login = {status: 200, data: {success: true, username: "v", expires_in: 300}};

        screen.submit({username: "v", password: "p"});
        await pass_time(10);
        const error = screen.error;
        gobj_send_event(iev, "EV_FAKE_OPEN_ERROR", {url: "wss://cc.example:1996"}, iev);
        expect(screen.busy).toBe(true);
        expect(screen.error).toBe(error);

        logout.give(200, {success: true});
        await pass_time(10);
        expect(screen.mounted).toBe(false);
    });

    test("the link opens while a submit replaces the session: the form stays", async () => {
        const {iev, screen} = await open_failed();
        const logout = later_answer();
        answers.logout = logout.answer;
        answers.login = {status: 200, data: {success: true, username: "v", expires_in: 300}};

        screen.submit({username: "v", password: "p"});
        await pass_time(10);
        gobj_send_event(iev, "EV_FAKE_OPEN", {}, iev);
        await pass_time(10);
        expect(screen.mounted).toBe(true);
        expect(screen.busy).toBe(true);

        logout.give(200, {success: true});
        await pass_time(10);
        expect(screen.mounted).toBe(false);
        expect(not_defined()).toEqual([]);
    });
});

describe("a session that ends before the link ever opened", () => {

    test("takes the link with it: it would go on retrying with no session", async () => {
        const {link, login, screen} = await open_failed();
        answers.refresh = {status: 401, data: {
            success: false, error_code: "session_expired", error: "x"
        }};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(gobj_is_running(link)).toBe(false);
        expect(screen.error()).toBe(`${en.translation["login failed"]}: ` +
            `${en.translation["session_expired"]}`);
        expect(not_defined()).toEqual([]);
    });
});

describe("a logout that settles with the form up", () => {

    test("the form is given back: a held logout has no login to wait for", async () => {
        const {login} = await app_started(NO_SESSION);
        const screen = login_screens[0];
        expect(screen.mounted).toBe(true);

        const pending = later_answer();
        answers.login = pending.answer;
        answers.logout = {status: 200, data: {success: true}};
        screen.submit({username: "u", password: "p"});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending.give(200, {success: true, username: "u", expires_in: 300});
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(screen.busy).toBe(false);
        expect(screen.error).toBe("");
        expect(not_defined()).toEqual([]);
    });

    test("and it says when the server did not end it", async () => {
        const {login} = await app_started(NO_SESSION);
        const screen = login_screens[0];

        const pending = later_answer();
        answers.login = pending.answer;
        answers.logout = {status: 503, data: {success: false, error_code: "server_busy", error: "x"}};
        screen.submit({username: "u", password: "p"});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending.give(200, {success: true, username: "u", expires_in: 300});
        await pass_time(10);
        expect(screen.busy).toBe(false);
        expect(screen.error()).toBe(`${en.translation["logout not ended on the server"]} ` +
            `(${en.translation["server_busy"]})`);
    });
});
