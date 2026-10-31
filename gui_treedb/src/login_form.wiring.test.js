// @vitest-environment jsdom
/***********************************************************************
 *          login_form.wiring.test.js
 *
 *      A logout that settles with the login form up: a logout asked for
 *      while the login is in flight waits for it (ST_WAIT_TOKEN of
 *      C_TREEDB_LOGIN) and its EV_LOGOUT_DONE is the answer, and the app is
 *      in ST_LOGGED_OUT then, not in ST_SESSION. The form, busy since the
 *      submit, is given back, and it says when the server did not end the
 *      session, unless the login that waited for the logout goes out next.
 *
 *      Driven through the real C_TREEDB_APP, C_TREEDB_LOGIN, C_TREEDB_LINKS
 *      and C_TREEDB_CONFIG, in jsdom; the BFF and the form are doubles.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";

/*  What is looked at is what the form is told, and a submit is what it
 *  hands to the app. `busy` is what the real form sets by itself at a
 *  submit.  */
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
    SDATA_END,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create_service, gobj_find_service,
    gobj_start, gobj_stop_tree, gobj_destroy, gobj_send_event,
    gobj_current_state, gobj_is_destroying,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_treedb_config} = await import("./c_treedb_config.js");
const {register_c_treedb_links} = await import("./c_treedb_links.js");
const {register_c_login} = await import("./c_login.js");
const {register_c_app} = await import("./c_app.js");

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

const NO_SESSION = {status: 401, data: {success: false, error_code: "missing_refresh_token", error: "x"}};
const LOGIN_OK = {success: true, username: "u", expires_in: 300};

beforeAll(() => {
    vi.stubGlobal("fetch", fake_fetch);
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(log_sink);
    register_c_timer();
    register_c_treedb_config();
    register_c_treedb_links();
    register_c_login();
    register_c_app();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

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
    localStorage.clear();
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

/*  The app on its login form, with no session to restore.  */
async function form_up()
{
    answers.refresh = NO_SESSION;
    const app = gobj_create_service("treedb_app", "C_TREEDB_APP", {}, yuno);
    built.push(app);
    gobj_start(app);
    await pass_time(10);
    /*  The app may arm another log sink: take the log back.  */
    set_log_callback(log_sink);
    logged.length = 0;
    expect(gobj_current_state(app)).toBe("ST_LOGGED_OUT");
    expect(login_screens.length).toBe(1);
    return {app, login: gobj_find_service("treedb_login", true), screen: login_screens[0]};
}

describe("a logout that settles with the form up (ST_LOGGED_OUT)", () => {

    test("gives the form back", async () => {
        const {app, login, screen} = await form_up();
        const pending = later_answer();
        answers.login = pending.answer;
        answers.logout = {status: 200, data: {success: true}};

        screen.submit({username: "u", password: "p"});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending.give(200, LOGIN_OK);
        await pass_time(10);
        expect(asked).toEqual(["refresh", "login", "logout"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(gobj_current_state(app)).toBe("ST_LOGGED_OUT");
        expect(not_defined()).toEqual([]);
        expect(screen.busy).toBe(false);
        expect(screen.error).toBe("");
        expect(login_screens.length).toBe(1);
    });

    test("says when the server did not end the session", async () => {
        const {default: i18next} = await import("i18next");
        const {en} = await import("./locales/en.js");
        await i18next.init({lng: "en", resources: {en}});
        const {login, screen} = await form_up();
        const pending = later_answer();
        answers.login = pending.answer;
        answers.logout = {status: 503, data: {success: false, error_code: "server_busy", error: "x"}};

        screen.submit({username: "u", password: "p"});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending.give(200, LOGIN_OK);
        await pass_time(10);
        expect(not_defined()).toEqual([]);
        expect(screen.busy).toBe(false);
        expect(typeof screen.error).toBe("function");
        expect(screen.error()).toBe(`${en.translation["logout not ended at the identity server"]} ` +
            `(${en.translation["server_busy"]})`);
    });

    test("stays busy when the login that waited for it goes out next", async () => {
        const {login, screen} = await form_up();
        const pending = later_answer();
        const logout = later_answer();
        const held = later_answer();
        answers.login = pending.answer;
        answers.logout = logout.answer;

        screen.submit({username: "u", password: "p"});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending.give(200, LOGIN_OK);
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGGING_OUT");

        /*  What the form hands in during the logout waits for it.  */
        gobj_send_event(login, "EV_DO_LOGIN", {username: "v", password: "p"}, login);
        answers.login = held.answer;
        logout.give(200, {success: true});
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");
        expect(screen.busy).toBe(true);

        held.give(401, {success: false, error_code: "invalid_credentials", error: "x"});
        await pass_time(10);
        expect(screen.busy).toBe(false);
        expect(not_defined()).toEqual([]);
    });
});
