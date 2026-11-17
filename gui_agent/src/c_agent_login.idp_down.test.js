/***********************************************************************
 *          c_agent_login.idp_down.test.js
 *
 *      A session whose IdP is down (the BFF answers its refresh 502
 *      auth_service_unavailable) cannot be refreshed anywhere else: its
 *      refresh_token belongs to that IdP. C_AGENT_LOGIN keeps it while
 *      the access token lives, and ends it with that code at the
 *      REFRESH_IDP_DOWN_MAX-th (3) such answer once the token is dead, so
 *      the login form can open a session at an IdP that answers (the
 *      BFF's `issuers`). An answer that is not the BFF's (a 502 page of a
 *      proxy) does not count: when the BFF does not answer, a login would
 *      not either.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, afterAll, vi} from "vitest";

globalThis.document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
};
globalThis.window = globalThis;
globalThis.location = {hostname: "localhost"};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const {
    SDATA_END,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create_service,
    gobj_start, gobj_send_event, gobj_current_state,
    register_c_timer,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_login} = await import("./c_agent_login.js");

const EXPIRES_IN = 40;      /*  s: the refresh goes at 30 s, the token dies at 40 s  */

const heard = [];
let answers = {};           /*  segment -> {status, data}  */
let login = null;

/*  A fetch that answers each segment with its {status, data}  */
function fake_fetch(url)
{
    const segment = String(url).split("/").pop();
    const {status, data} = answers[segment];
    return Promise.resolve({
        ok:      status >= 200 && status < 300,
        status:  status,
        headers: new Headers(),
        json:    () => data === undefined? Promise.reject(new Error("not json")) : Promise.resolve(data),
    });
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(() => {});
    register_c_timer();
    register_c_agent_login();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

    const login_out = [
        "EV_LOGIN_ACCEPTED", "EV_LOGIN_REFRESHED", "EV_REFRESH_FAILED",
        "EV_LOGIN_DENIED", "EV_RESTORE_FAILED", "EV_LOGOUT_DONE",
    ];
    const record = (gobj, event, kw) => {
        heard.push({event, kw});
        return 0;
    };
    gclass_create(
        "C_TEST_SINK",
        login_out.map((ev) => [ev, 0]),
        [["ST_IDLE", login_out.map((ev) => [ev, record, null])]],
        {},
        0,
        [SDATA_END()],
        {}, 0, 0, 0, 0
    );

    const yuno = gobj_create_yuno("yuno", "C_TEST_YUNO", {});
    const sink = gobj_create_service("sink", "C_TEST_SINK", {}, yuno);
    login = gobj_create_service("login", "C_AGENT_LOGIN", {subscriber: sink}, yuno);
});

afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function pass_time(ms)
{
    await vi.advanceTimersByTimeAsync(ms);
}

async function open_session()
{
    answers.login = {status: 200, data: {
        success: true, username: "u", expires_in: EXPIRES_IN, refresh_expires_in: 1800
    }};
    gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
    await pass_time(10);
    expect(gobj_current_state(login)).toBe("ST_LOGIN");
    heard.length = 0;
}

describe("C_AGENT_LOGIN: the IdP of the session is down", () => {
    test("kept while the access token lives, ended at the 3rd answer after", async () => {
        answers.refresh = {status: 200, data: {success: false, error_code: "x"}};
        gobj_start(login);              /*  the restore of the start: no session  */
        await pass_time(10);
        await open_session();

        answers.refresh = {status: 502, data: {
            success: false, error_code: "auth_service_unavailable", error: "IdP down"
        }};
        /*  refreshes at 30 s and 35 s: the token lives (until 40 s)  */
        await pass_time(36000);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED", "EV_REFRESH_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");

        /*  the third at 45 s: the token is dead, the session ends with the code  */
        await pass_time(10000);
        expect(heard.map((h) => h.event)).toEqual(
            ["EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_LOGIN_DENIED"]);
        expect(heard[2].kw.error_code).toBe("auth_service_unavailable");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a 502 that is not the BFF's never ends it", async () => {
        await open_session();

        answers.refresh = {status: 502, data: undefined};   /*  the page of a proxy  */
        await pass_time(5 * 60 * 1000);
        expect(heard.length).toBeGreaterThan(3);
        expect(heard.every((h) => h.event === "EV_REFRESH_FAILED")).toBe(true);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
    });
});
