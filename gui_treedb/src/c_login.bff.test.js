/***********************************************************************
 *          c_login.bff.test.js
 *
 *      Every call C_TREEDB_LOGIN makes to the BFF has a deadline, and a
 *      call the BFF never answers ends in an event, never in a wait:
 *
 *        - /auth/login: EV_LOGIN_DENIED with error_code "auth_timeout",
 *          a key of the locales, so the login form says it in the
 *          language of the app (it said "network_error" before);
 *        - /auth/token: the login is published with an empty token
 *          (before, the fetch had no deadline and the session hung in
 *          ST_WAIT_TOKEN for as long as the BFF stayed silent).
 *
 *      The BFF is a fetch() that never answers: only its AbortSignal can
 *      end it, as a browser does.
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
const {register_c_login, AUTH_ERROR_I18N_KEYS} = await import("./c_login.js");

const BFF_TIMEOUT_MS = 15000;

const heard = [];
const asked = [];
let answers = {};      /*  segment -> json answer; a segment not here is never answered  */
let login = null;

/*  A fetch that answers only the segments of `answers`; the rest wait
 *  until their signal aborts them.  */
function fake_fetch(url, request)
{
    const segment = String(url).split("/").pop();
    asked.push(segment);
    if(answers[segment]) {
        const data = answers[segment];
        return Promise.resolve({
            ok:     true,
            status: 200,
            json:   () => Promise.resolve(data),
        });
    }
    return new Promise((resolve, reject) => {
        if(!request.signal) {
            return;     /*  a call with no deadline: it waits for ever  */
        }
        request.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
        });
    });
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(() => {});
    register_c_timer();
    register_c_login();

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
    login = gobj_create_service("login", "C_TREEDB_LOGIN", {subscriber: sink}, yuno);
});

afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function pass_time(ms)
{
    await vi.advanceTimersByTimeAsync(ms);
}

describe("C_TREEDB_LOGIN: a BFF that never answers", () => {
    test("restore (/auth/refresh) ends in EV_RESTORE_FAILED after the deadline", async () => {
        gobj_start(login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(asked).toEqual(["refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_RESTORE_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("/auth/login denied with auth_timeout, a key of the locales", async () => {
        heard.length = 0;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_timeout");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("/auth/token silent: the login is published with an empty token", async () => {
        heard.length = 0;
        asked.length = 0;
        answers = {login: {success: true, username: "u", expires_in: 300, refresh_expires_in: 1800}};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(asked).toEqual(["login", "token"]);
        expect(heard).toEqual([]);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
        expect(heard[0].kw.access_token).toBe("");
        expect(heard[0].kw.username).toBe("u");
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
    });
});
