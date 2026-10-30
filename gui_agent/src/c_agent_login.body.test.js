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
 *      A login answered with something that is not the BFF's json (an
 *      empty 200, a 200 in HTML, a body cut halfway, a 4xx page of a
 *      proxy) is "auth_bad_response", translated, and logged as an ERROR,
 *      as every failure that is not the BFF's own answer is; a denial the
 *      BFF gives with its error_code is logged as INFO.
 *
 *      A refresh answered with something that is not the BFF's json (a
 *      json with neither success nor error_code, a page in HTML, whatever
 *      its status) is "auth_bad_response", an ERROR, and keeps the
 *      session: EV_REFRESH_FAILED, retried with backoff. The fifth such
 *      answer since the last refresh that landed ends the session with
 *      "auth_bad_response" (the login page of a proxy never changes).
 *
 *      A refresh the BFF answers with an error_code ends the session when
 *      a retry would give it again (a 4xx, and the 5xx token_too_large,
 *      auth_unexpected_error, auth_config_error, internal_error), and is
 *      retried otherwise (an outage, and the 429 auth_rate_limited). The
 *      published EV_REFRESH_FAILED carries the error_code.
 *
 *      An answer of a request made for an earlier session (a refresh in
 *      flight when the user logged out and in again) is dropped: it does
 *      not end, or re-arm, the session that replaced it.
 *
 *      And a denial is said in the language of the app: every error_code
 *      of the BFF's catalog is a key of AUTH_ERROR_I18N_KEYS and of every
 *      locale (a refresh with no cookie left is "missing_refresh_token").
 *      The catalog is read from c_auth_bff.h when this repo is checked out
 *      inside the SDK, and the copy below must be equal to it; checked out
 *      alone, the copy is used and the test that compares them is skipped,
 *      with the reason in the report.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, afterAll, vi} from "vitest";
import {existsSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

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

/*  A copy of the error_code catalog of the BFF (c_auth_bff.h), for a
 *  checkout of this repo without the SDK around it.  */
const BFF_ERROR_CODES_COPY = [
    "invalid_credentials", "session_expired", "account_disabled", "auth_rate_limited",
    "auth_service_unavailable", "auth_config_error", "auth_unexpected_error",
    "auth_empty_response", "auth_timeout", "token_too_large",
    "method_not_allowed", "missing_body", "missing_params", "redirect_uri_not_allowed",
    "origin_not_allowed", "missing_refresh_token", "missing_access_token",
    "unknown_endpoint", "server_busy", "internal_error"
];

const BFF_HEADER = fileURLToPath(
    new URL("../../../../kernel/c/root-linux/src/c_auth_bff.h", import.meta.url));

/*  The codes of the catalog of c_auth_bff.h: its lines
 *  " *  <code>  <http status>  <meaning>". null when the header is not
 *  there (this repo checked out alone).  */
function read_bff_catalog(path)
{
    if(!existsSync(path)) {
        return null;
    }
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/^ \*  ([a-z][a-z_]*) +(\d{3}) /gm)].map((m) => m[1]);
}

const BFF_CATALOG = read_bff_catalog(BFF_HEADER);
const BFF_CATALOG_MISSING = `c_auth_bff.h not found at ${BFF_HEADER}: ` +
    "this repo is not checked out inside yunetas, so the copy of the catalog is not compared";
if(!BFF_CATALOG) {
    console.warn(BFF_CATALOG_MISSING);
}
const BFF_ERROR_CODES = BFF_CATALOG || BFF_ERROR_CODES_COPY;

const STALL = "stall";  /*  the headers come, the body never does  */

const heard = [];
const asked = [];
const logged = [];     /*  {level, msg} of every log of the module  */
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
 *  end, as a browser does. An answer that is a function answers the
 *  request itself (later_answer()).  */
function fake_fetch(url, request)
{
    const segment = String(url).split("/").pop();
    asked.push(segment);
    const answer = answers[segment];
    if(typeof answer === "function") {
        return answer(request);
    }
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
        json:   () => answer.reject ? Promise.reject(answer.reject) : Promise.resolve(answer.data),
    });
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level, msg: String(msg)});
    });
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
    if(gobj_current_state(login) === "ST_LOGIN") {
        await log_out();    /*  what an earlier test left  */
    }
    answers.login = OK_LOGIN;
    gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
    await pass_time(10);
    expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
    expect(gobj_current_state(login)).toBe("ST_LOGIN");
    heard.length = 0;
    asked.length = 0;
}

async function log_out()
{
    answers.logout = {status: 200, data: {success: true}};
    gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
    await pass_time(10);
    expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    heard.length = 0;
    asked.length = 0;
}

/*  An answer the test gives when it wants: `answer` goes into `answers`,
 *  and `give(status, data)` sends it.  */
function later_answer()
{
    let give = null;
    const answer = () => new Promise((resolve) => {
        give = (status, data) => resolve({
            ok:     status >= 200 && status < 300,
            status: status,
            json:   () => Promise.resolve(data),
        });
    });
    return {answer, give: (status, data) => give(status, data)};
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

    test("a refresh of a live session: EV_REFRESH_FAILED, and a retry the BFF denies ends it", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = STALL;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");

        heard.length = 0;
        answers.refresh = {status: 401, data: {
            success: false, error_code: "session_expired", error: "Session expired"
        }};
        await pass_time(5000 + 10);     /*  the retry of the backoff  */
        expect(asked).toEqual(["refresh", "refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("session_expired");
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

describe("C_AGENT_LOGIN: a login answered with something that is not the BFF's json", () => {
    const not_json = new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
    const cut = new TypeError("network error");

    async function login_answered(answer)
    {
        heard.length = 0;
        logged.length = 0;
        answers = {login: answer};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        return heard[0].kw;
    }

    function errors_naming(code)
    {
        return logged.filter((l) => l.level === "error" && l.msg.includes(code));
    }

    test.each([
        ["an empty 200", {status: 200, reject: new SyntaxError("Unexpected end of JSON input")}],
        ["a 200 in HTML", {status: 200, reject: not_json}],
        ["a body cut halfway", {status: 200, reject: cut}],
        ["a 200 json that is not the BFF's", {status: 200, data: {}}],
        ["a 404 page of a proxy", {status: 404, reject: not_json}],
    ])("%s: auth_bad_response, translated, and an ERROR", async (label, answer) => {
        const kw = await login_answered(answer);
        expect(kw.error_code).toBe("auth_bad_response");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_bad_response");
        expect(errors_naming("auth_bad_response").length).toBe(1);
    });

    test("a 5xx with no error_code is auth_service_unavailable, an ERROR", async () => {
        const kw = await login_answered({status: 502, reject: not_json});
        expect(kw.error_code).toBe("auth_service_unavailable");
        expect(errors_naming("auth_service_unavailable").length).toBe(1);
    });

    test("a body that does not come in time is auth_timeout, an ERROR", async () => {
        heard.length = 0;
        logged.length = 0;
        answers = {login: STALL};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(errors_naming("auth_timeout").length).toBe(1);
    });

    test("a denial the BFF gives with its error_code is INFO, not an ERROR", async () => {
        const kw = await login_answered({status: 401, data: {
            success: false, error_code: "invalid_credentials", error: "Invalid user credentials"
        }});
        expect(kw.error_code).toBe("invalid_credentials");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("invalid_credentials")).length)
            .toBe(1);
    });
});

describe("C_AGENT_LOGIN: a refresh answered with something that is not the BFF's json", () => {
    const not_json = new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");

    test.each([
        ["a 200 json that is not the BFF's", {status: 200, data: {foo: 1}}],
        ["a 200 page in HTML", {status: 200, reject: not_json}],
        ["a 401 page in HTML", {status: 401, reject: not_json}],
        ["a 401 json with no error_code", {status: 401, data: {success: false}}],
    ])("%s: an ERROR naming auth_bad_response, the session kept and retried", async (label, answer) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.level === "error" && l.msg.includes("auth_bad_response")).length)
            .toBe(1);
        expect(logged.filter((l) => l.level === "info")).toEqual([]);

        heard.length = 0;
        answers.refresh = {status: 401, data: {
            success: false, error_code: "session_expired", error: "Session expired"
        }};
        await pass_time(5000 + 10);     /*  the retry of the backoff  */
        expect(asked).toEqual(["refresh", "refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("session_expired");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("AUTH_ERROR_I18N_KEYS", () => {
    test("the copy in this test is the catalog of c_auth_bff.h", (ctx) => {
        ctx.skip(!BFF_CATALOG, BFF_CATALOG_MISSING);
        expect(BFF_CATALOG.length).toBeGreaterThan(0);
        expect([...BFF_ERROR_CODES_COPY].sort()).toEqual([...BFF_CATALOG].sort());
    });

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

describe("C_AGENT_LOGIN: a refresh answered for ever with something that is not the BFF's json", () => {
    const not_json = new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");

    test.each([
        ["a 401 page in HTML (the login page of a proxy)", {status: 401, reject: not_json}],
        ["a 200 {}", {status: 200, data: {}}],
    ])("%s: 5 tries, then the session ends with auth_bad_response", async (label, answer) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000, 40000]) {
            expect(gobj_current_state(login)).toBe("ST_LOGIN");
            await pass_time(backoff + 10);
        }
        expect(asked.filter((x) => x === "refresh").length).toBe(5);
        const events = heard.map((h) => h.event);
        expect(events).toEqual([
            "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED",
            "EV_LOGIN_DENIED"
        ]);
        expect(heard[4].kw.error_code).toBe("auth_bad_response");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_bad_response");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");

        await pass_time(15 * 60 * 1000);
        expect(asked.filter((x) => x === "refresh").length).toBe(5);
    });

    test("a refresh that lands in between starts the count over", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: 200, data: {}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000]) {
            await pass_time(backoff + 10);
        }
        expect(heard.map((h) => h.event).filter((e) => e === "EV_REFRESH_FAILED").length).toBe(4);

        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        await pass_time(40000 + 10);
        expect(heard[heard.length - 1].event).toBe("EV_LOGIN_REFRESHED");

        heard.length = 0;
        answers.refresh = {status: 200, data: {}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000]) {
            await pass_time(backoff + 10);
        }
        expect(heard.map((h) => h.event)).toEqual([
            "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED"
        ]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        await log_out();
    });
});

describe("C_AGENT_LOGIN: a refresh the BFF answers with an error_code", () => {
    test("429 auth_rate_limited passes with time: retried, a WARNING, the error_code published", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = {status: 429, data: {
            success: false, error_code: "auth_rate_limited", error: "Too many login attempts"
        }};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(heard[0].kw.retry_ms).toBe(5000);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("auth_rate_limited")).length)
            .toBe(1);

        heard.length = 0;
        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        await pass_time(5000 + 10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_REFRESHED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        await log_out();
    });

    test.each([
        [500, "token_too_large"],
        [502, "auth_unexpected_error"],
        [500, "auth_config_error"],
        [500, "internal_error"],
    ])("%i %s comes back on every retry: the session ends with its message", async (status, code) => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: status, data: {success: false, error_code: code, error: "x"}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe(code);
        expect(AUTH_ERROR_I18N_KEYS).toContain(code);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        await pass_time(120000);
        expect(asked.filter((x) => x === "refresh").length).toBe(1);
    });

    test.each([
        [502, "auth_service_unavailable"],
        [503, "server_busy"],
        [504, "auth_timeout"],
        [502, "auth_empty_response"],
    ])("%i %s is an outage: retried with the session kept", async (status, code) => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: status, data: {success: false, error_code: code, error: "x"}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.error_code).toBe(code);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        await log_out();
    });
});

describe("C_AGENT_LOGIN: the answer of a request of an earlier session is dropped", () => {
    test("a refresh denied after a logout and a new login does not end the new session", async () => {
        heard.length = 0;
        await log_in();

        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        await log_out();

        logged.length = 0;
        const new_login = later_answer();
        answers.login = new_login.answer;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");

        refresh.give(401, {success: false, error_code: "session_expired", error: "Session expired"});
        await pass_time(10);
        expect(heard).toEqual([]);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");

        new_login.give(200, OK_LOGIN.data);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("superseded")).length)
            .toBe(1);
        await log_out();
    });

    test("a refresh of the old session that lands in the new one arms nothing", async () => {
        heard.length = 0;
        await log_in();

        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        await log_out();
        await log_in();

        logged.length = 0;
        refresh.give(200, {});
        await pass_time(10);
        expect(heard).toEqual([]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        await pass_time(5000 + 10);
        expect(asked).toEqual([]);
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("superseded")).length)
            .toBe(1);
        await log_out();
    });
});
