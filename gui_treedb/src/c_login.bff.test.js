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
 *      The deadline covers the BODY too: a login whose headers come and
 *      whose body never does is "auth_timeout" as well, not `http_200`.
 *
 *      And every error_code of the BFF's catalog (c_auth_bff.h) is a key
 *      of AUTH_ERROR_I18N_KEYS and of every locale: a refresh with no
 *      cookie left ("missing_refresh_token") is said in the language of
 *      the app.
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

/*  An answer with its own status (the others are a 200).  */
function answer_with(status, data)
{
    return {__status__: status, data: data};
}

function abort_error()
{
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    return err;
}

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
    const until_aborted = () => new Promise((resolve, reject) => {
        if(!request.signal) {
            return;     /*  a call with no deadline: it waits for ever  */
        }
        request.signal.addEventListener("abort", () => reject(abort_error()));
    });
    if(answers[segment] === STALL) {
        return Promise.resolve({
            ok:     true,
            status: 200,
            json:   until_aborted,
        });
    }
    if(answers[segment]) {
        const answer = answers[segment];
        const status = answer.__status__ || 200;
        const data   = answer.__status__ ? answer.data : answer;
        return Promise.resolve({
            ok:     status >= 200 && status < 300,
            status: status,
            json:   () => Promise.resolve(data),
        });
    }
    return until_aborted();
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

    test("a login whose body never comes: denied with auth_timeout", async () => {
        heard.length = 0;
        answers.logout = {success: true};
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");

        heard.length = 0;
        answers.login = STALL;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a refresh with no cookie left: missing_refresh_token, a key of the locales", async () => {
        heard.length = 0;
        answers = {
            login: {success: true, username: "u", expires_in: 300, refresh_expires_in: 1800},
            token: {success: true, access_token: "x.y.z"},
        };
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");

        heard.length = 0;
        answers.refresh = answer_with(401, {
            success: false, error_code: "missing_refresh_token", error: "Missing refresh_token cookie"
        });
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("missing_refresh_token");
        expect(AUTH_ERROR_I18N_KEYS).toContain("missing_refresh_token");
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
