/***********************************************************************
 *          c_agent_login.body.test.js
 *
 *      The deadline of a call C_AGENT_LOGIN makes to the BFF covers the
 *      BODY of the answer, not only its headers: a BFF (or a proxy) that
 *      sends the headers and then goes silent ends in the same event as
 *      one that sends nothing:
 *
 *        - the restore on load (/auth/refresh): EV_RESTORE_FAILED;
 *        - /auth/login: EV_LOGIN_DENIED with error_code "auth_timeout";
 *        - the refresh of a live session: EV_REFRESH_FAILED, which keeps
 *          the session and retries;
 *        - /auth/logout: EV_LOGOUT_DONE.
 *
 *      And a denial is said in the language of the app: a refresh denied
 *      with no error_code is "refresh_denied", and every error_code of the
 *      BFF's catalog (c_auth_bff.h) is a key of AUTH_ERROR_I18N_KEYS and of
 *      every locale (a refresh with no cookie left is
 *      "missing_refresh_token").
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
const {register_c_agent_login, AUTH_ERROR_I18N_KEYS} = await import("./c_agent_login.js");
const {en} = await import("./locales/en.js");
const {es} = await import("./locales/es.js");

const BFF_TIMEOUT_MS = 15000;

/*  The error_code catalog of the BFF (c_auth_bff.h).  */
const BFF_ERROR_CODES = [
    "invalid_credentials", "session_expired", "account_disabled", "auth_rate_limited",
    "auth_service_unavailable", "auth_config_error", "auth_unexpected_error",
    "auth_empty_response", "auth_timeout", "token_too_large",
    "method_not_allowed", "missing_body", "missing_params", "redirect_uri_not_allowed",
    "origin_not_allowed", "missing_refresh_token", "missing_access_token",
    "unknown_endpoint", "server_busy", "internal_error"
];

const STALL = "stall";  /*  the headers come, the body never does  */

const heard = [];
const asked = [];
let answers = {};      /*  segment -> STALL, or {status, data}  */
let login = null;

const OK_LOGIN = {status: 200, data: {success: true, username: "u", expires_in: 300, refresh_expires_in: 1800}};

function abort_error()
{
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    return err;
}

/*  A fetch whose body, for a STALL segment, only its AbortSignal can
 *  end, as a browser does.  */
function fake_fetch(url, request)
{
    const segment = String(url).split("/").pop();
    asked.push(segment);
    const answer = answers[segment];
    if(answer === STALL) {
        return Promise.resolve({
            ok:     true,
            status: 200,
            json:   () => new Promise((resolve, reject) => {
                if(!request.signal) {
                    return;     /*  a call with no deadline: it waits for ever  */
                }
                if(request.signal.aborted) {
                    reject(abort_error());
                    return;
                }
                request.signal.addEventListener("abort", () => reject(abort_error()));
            }),
        });
    }
    return Promise.resolve({
        ok:     answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json:   () => Promise.resolve(answer.data),
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

async function log_in()
{
    answers.login = OK_LOGIN;
    gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
    await pass_time(10);
    expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
    expect(gobj_current_state(login)).toBe("ST_LOGIN");
    heard.length = 0;
    asked.length = 0;
}

describe("C_AGENT_LOGIN: a BFF that sends the headers and then goes silent", () => {
    test("restore (/auth/refresh) ends in EV_RESTORE_FAILED after the deadline", async () => {
        answers = {refresh: STALL};
        gobj_start(login);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(asked).toEqual(["refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_RESTORE_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("/auth/login denied with auth_timeout", async () => {
        heard.length = 0;
        answers = {login: STALL};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a refresh of a live session: EV_REFRESH_FAILED, and the retry denied says refresh_denied", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = STALL;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");

        heard.length = 0;
        answers.refresh = {status: 401, data: {success: false}};
        await pass_time(5000 + 10);     /*  the retry of the backoff  */
        expect(asked).toEqual(["refresh", "refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("refresh_denied");
        expect(AUTH_ERROR_I18N_KEYS).toContain("refresh_denied");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a refresh with no cookie left: missing_refresh_token, a key of the locales", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: 401, data: {
            success: false, error_code: "missing_refresh_token", error: "Missing refresh_token cookie"
        }};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("missing_refresh_token");
        expect(AUTH_ERROR_I18N_KEYS).toContain("missing_refresh_token");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("/auth/logout ends in EV_LOGOUT_DONE after the deadline", async () => {
        heard.length = 0;
        await log_in();

        answers.logout = STALL;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(asked).toEqual(["logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("AUTH_ERROR_I18N_KEYS", () => {
    test("every error_code of the BFF's catalog is a key the app translates", () => {
        for(const code of BFF_ERROR_CODES) {
            expect(AUTH_ERROR_I18N_KEYS, code).toContain(code);
        }
    });

    test("every key of AUTH_ERROR_I18N_KEYS is in every locale", () => {
        for(const code of AUTH_ERROR_I18N_KEYS) {
            expect(en.translation[code], `en ${code}`).toBeTypeOf("string");
            expect(es.translation[code], `es ${code}`).toBeTypeOf("string");
        }
    });
});
