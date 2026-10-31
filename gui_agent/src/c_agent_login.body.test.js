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
 *      proxy) is "auth_bad_response", translated, and logged as a WARNING,
 *      as every failure that is not the BFF's own answer is (the peer did
 *      it, no contract of ours is broken); a denial the BFF gives with its
 *      error_code is logged as INFO, with its text: a code no locale knows
 *      is not shown, so the log is where that text stays.
 *
 *      A refresh answered with something that is not the BFF's json (a
 *      json with neither success nor error_code, a page in HTML, whatever
 *      its status) is "auth_bad_response", a WARNING, and keeps the
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
 *      A retried refresh waits for the Retry-After of its answer (seconds
 *      or an HTTP-date) when it is longer than the backoff, up to 5
 *      minutes; a 429 whose Retry-After is longer, or the fifth 429 since
 *      the last refresh that landed, ends the session with
 *      "auth_rate_limited". The count of answers that are not the BFF's
 *      json is not started over by answers of another kind, only by a
 *      refresh that lands.
 *
 *      A logout in flight (ST_LOGGING_OUT) lets no refresh out (one asked
 *      for is refused out loud), a login asked for meanwhile waits for the
 *      logout to settle, and only the end of that logout ends the session.
 *
 *      A logout asked for while the login is in flight waits for the
 *      login and goes out when it settles, whatever its answer, so the
 *      cookies the login set are cleared; a login asked for after it drops
 *      it. A logout the BFF did not answer with success ends the session
 *      here all the same, and EV_LOGOUT_DONE says it did not end on the
 *      server (ended_on_server false, with the error_code), because the
 *      cookies are still there.
 *
 *      Any 429, with the BFF's json, without it (a proxy), or with a json
 *      and an error_code of its own, is "auth_rate_limited": retried after
 *      its Retry-After and counted with the other 429s. The Retry-After
 *      read is the one of RFC 9110: delay-seconds of any length, or an
 *      HTTP-date in its three forms, a real date in GMT, the two digits of
 *      an rfc850-date being the latest year not more than 50 years ahead;
 *      anything else is ignored, and the WARNING says so.
 *
 *      A logout that failed is a WARNING whatever the failure: the peer
 *      did it. EV_LOGOUT_DONE says when a login comes after it
 *      (login_follows).
 *
 *      One refresh at a time: a refresh asked for (EV_DO_REFRESH) or the
 *      refresh timer, while a refresh of the session is in flight, sends
 *      nothing: that one answers it. Two at once carry the same refresh
 *      token, and an IdP that revokes a refresh token used twice ends the
 *      session at the second.
 *
 *      The catalog of c_auth_bff.h is read line by line: a code with a
 *      digit or a tab is read, and any line of the catalog the reading
 *      cannot take -- a code line it cannot read, an indent of five or
 *      eight blanks, no blank after the "*", a meaning that goes on in
 *      another column, a CR -- fails the reading instead of being
 *      skipped.
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
    gobj_set_gobj_trace,
    gobj_start, gobj_stop, gobj_send_event, gobj_current_state,
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

/*  The column `index` of `line` is shown at, a tab going to the next
 *  multiple of 8.  */
function shown_column(line, index)
{
    let column = 0;
    for(let i = 0; i < index; i++) {
        column = (line[i] === "\t") ? (Math.floor(column / 8) + 1) * 8 : column + 1;
    }
    return column;
}

/*  The codes of the catalog in `text`, a c_auth_bff.h, read from its
 *  first "Codes emitted" to "New codes MUST". Every line of it is one of:
 *
 *    " *"                                    a blank line
 *    " *  -----..."                          a rule
 *    " *  Codes emitted ..."                 a heading
 *    " *  <code>  <status>  <meaning>"       a code line: two spaces or a
 *                                            tab before a snake_case code,
 *                                            a three-digit status, blanks
 *                                            between them
 *    " *    ...    <more of the meaning>"    a line that goes on with the
 *                                            meaning of the code line above
 *                                            it, starting in the column its
 *                                            meaning starts in
 *
 *  Any other line throws, whatever it holds: an indent of one, three, five
 *  or eight blanks, no blank after the "*", a line that goes on in another
 *  column or after a blank line, a CR (CRLF line endings). Nothing is
 *  skipped. A code can be listed once per status it is answered with.  */
function parse_bff_catalog(text)
{
    const from = text.indexOf("Codes emitted");
    const to = text.indexOf("New codes MUST");
    if(from < 0 || to < from) {
        throw new Error("c_auth_bff.h: no catalog from \"Codes emitted\" to \"New codes MUST\"");
    }
    const lines = text.slice(from, to).split("\n");
    const unreadable = (line, why) => new Error(
        `c_auth_bff.h: a line of the catalog that cannot be read (${why}): ${JSON.stringify(line)}`);
    if(lines[lines.length - 1] !== " *  ") {
        throw unreadable(lines[lines.length - 1], "not \" *  \" before \"New codes MUST\"");
    }
    let codes = [];
    let meaning_column = -1;    /*  of the code line that can go on, -1 when none  */
    for(const line of lines.slice(1, -1)) {
        if(line.includes("\r")) {
            throw unreadable(line, "a CR: CRLF line endings");
        }
        if(line === " *" || /^ \*  -+$/.test(line) || /^ \*  Codes emitted \S/.test(line)) {
            meaning_column = -1;
            continue;
        }
        const code = line.match(/^( \*(?:  |\t)([a-z][a-z0-9_]*)[ \t]+\d{3})(?:([ \t]+)\S.*)?$/);
        if(code) {
            codes.push(code[2]);
            meaning_column = code[3] ? shown_column(line, code[1].length + code[3].length) : -1;
            continue;
        }
        const more = line.match(/^ \*[ \t]+\S/);
        if(!more) {
            throw unreadable(line, "not a code line, a rule, a heading or a blank line");
        }
        const column = shown_column(line, more[0].length - 1);
        if(meaning_column < 0 || column !== meaning_column) {
            throw unreadable(line, meaning_column < 0 ?
                `indented to column ${column}, and no code line above it to go on with` :
                `indented to column ${column}, not to ${meaning_column}, where the meaning above starts`);
        }
    }
    return [...new Set(codes)];
}

/*  The codes of the catalog of c_auth_bff.h at `path`, or null when the
 *  header is not there (this repo checked out alone).  */
function read_bff_catalog(path)
{
    if(!existsSync(path)) {
        return null;
    }
    return parse_bff_catalog(readFileSync(path, "utf8"));
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
const traced = [];     /*  the json the trace dumps  */
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
            ok:      true,
            status:  200,
            headers: new Headers(),
            json:    () => new Promise((resolve, reject) => {
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
        ok:      answer.status >= 200 && answer.status < 300,
        status:  answer.status,
        headers: new Headers(answer.headers || {}),
        json:    () => answer.reject ? Promise.reject(answer.reject) : Promise.resolve(answer.data),
    });
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        if(level === "json") {
            traced.push(msg);
        } else {
            logged.push({level, msg: String(msg)});
        }
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
            ok:      status >= 200 && status < 300,
            status:  status,
            headers: new Headers(),
            json:    () => Promise.resolve(data),
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

    function warnings_naming(code)
    {
        return logged.filter((l) => l.level === "warning" && l.msg.includes(code));
    }

    test.each([
        ["an empty 200", {status: 200, reject: new SyntaxError("Unexpected end of JSON input")}],
        ["a 200 in HTML", {status: 200, reject: not_json}],
        ["a body cut halfway", {status: 200, reject: cut}],
        ["a 200 json that is not the BFF's", {status: 200, data: {}}],
        ["a 404 page of a proxy", {status: 404, reject: not_json}],
    ])("%s: auth_bad_response, translated, and a WARNING", async (label, answer) => {
        const kw = await login_answered(answer);
        expect(kw.error_code).toBe("auth_bad_response");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_bad_response");
        expect(warnings_naming("auth_bad_response").length).toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a 5xx with no error_code is auth_service_unavailable, a WARNING", async () => {
        const kw = await login_answered({status: 502, reject: not_json});
        expect(kw.error_code).toBe("auth_service_unavailable");
        expect(warnings_naming("auth_service_unavailable").length).toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a body that does not come in time is auth_timeout, a WARNING", async () => {
        heard.length = 0;
        logged.length = 0;
        answers = {login: STALL};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(warnings_naming("auth_timeout").length).toBe(1);
    });

    test("a code no locale knows: its text stays in the log", async () => {
        const kw = await login_answered({status: 400, data: {
            success: false, error_code: "code_of_a_newer_bff", error: "what the newer BFF says"
        }});
        expect(kw.error_code).toBe("code_of_a_newer_bff");
        expect(logged.filter((l) => l.msg.includes("what the newer BFF says")).length).toBe(1);
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
    ])("%s: a WARNING naming auth_bad_response, the session kept and retried", async (label, answer) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("auth_bad_response")).length)
            .toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
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
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
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

describe("C_AGENT_LOGIN: a refresh answered with a 429, with or without Retry-After", () => {
    const rate_limited = (headers) => ({status: 429, headers: headers, data: {
        success: false, error_code: "auth_rate_limited", error: "Too many login attempts"
    }});

    test("Retry-After in seconds: the retry waits for it, not for the backoff", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = rate_limited({"Retry-After": "30"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.retry_ms).toBe(30000);
        await pass_time(5000 + 10);
        expect(asked).toEqual(["refresh"]);

        heard.length = 0;
        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        await pass_time(25000);
        expect(asked).toEqual(["refresh", "refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_REFRESHED"]);
        await log_out();
    });

    test("Retry-After as an HTTP-date: the retry waits until that date", async () => {
        heard.length = 0;
        await log_in();

        const when = new Date(Math.ceil((Date.now() + 20000) / 1000) * 1000);
        answers.refresh = rate_limited({"Retry-After": when.toUTCString()});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.retry_ms).toBeGreaterThan(19000);
        expect(heard[0].kw.retry_ms).toBeLessThanOrEqual(21000);
        await log_out();
    });

    test("an unreadable Retry-After: the backoff, and the WARNING says what came", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = rate_limited({"Retry-After": "soon"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard[0].kw.retry_ms).toBe(5000);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("Retry-After: soon")).length)
            .toBe(1);
        await log_out();
    });

    test("Retry-After longer than 5 minutes: the session ends at once with auth_rate_limited", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = rate_limited({"Retry-After": "3600"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        await pass_time(2 * 3600 * 1000);
        expect(asked).toEqual(["refresh"]);
    });

    test("no Retry-After: the fifth 429 since the last refresh that landed ends the session", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = rate_limited();
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000, 40000]) {
            expect(gobj_current_state(login)).toBe("ST_LOGIN");
            await pass_time(backoff + 10);
        }
        expect(heard.map((h) => h.event)).toEqual([
            "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED", "EV_REFRESH_FAILED",
            "EV_LOGIN_DENIED"
        ]);
        expect(heard[4].kw.error_code).toBe("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        await pass_time(15 * 60 * 1000);
        expect(asked.filter((x) => x === "refresh").length).toBe(5);
    });

    test("Retry-After of an outage longer than 5 minutes: the session is kept, the retry waits 5 minutes", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: 503, headers: {"Retry-After": "3600"}, data: {
            success: false, error_code: "server_busy", error: "Pending queue full"
        }};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.retry_ms).toBe(5 * 60 * 1000);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        await log_out();
    });
});

describe("C_AGENT_LOGIN: what the count of answers that are not the BFF's json counts", () => {
    test("an answer of another kind in between does not start it over: only a refresh that lands does", async () => {
        heard.length = 0;
        await log_in();

        const bad = {status: 200, data: {}};
        const outage = {status: 502, data: {success: false, error_code: "auth_service_unavailable", error: "x"}};
        const sequence = [bad, bad, outage, bad, outage, bad, bad];
        answers.refresh = sequence[0];
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(let i = 1; i < sequence.length; i++) {
            expect(gobj_current_state(login)).toBe("ST_LOGIN");
            answers.refresh = sequence[i];
            await pass_time(heard[heard.length - 1].kw.retry_ms + 10);
        }
        expect(asked.length).toBe(7);
        expect(heard.map((h) => h.event).slice(-1)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[heard.length - 1].kw.error_code).toBe("auth_bad_response");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("C_AGENT_LOGIN: a logout in flight", () => {
    test("no refresh leaves while it is in flight, and it closes nothing but its own session", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        const logout = later_answer();
        answers.logout = logout.answer;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGGING_OUT");

        /*  A refresh asked for now is refused out loud and does not leave.  */
        answers.refresh = {status: 401, data: {
            success: false, error_code: "session_expired", error: "Session expired"
        }};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["logout"]);
        expect(logged.filter((l) => l.level === "error" && l.msg.includes("EV_DO_REFRESH")).length)
            .toBe(1);

        /*  A login asked for now waits for the logout.  */
        answers.login = OK_LOGIN;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(asked).toEqual(["logout"]);
        expect(heard).toEqual([]);

        logout.give(200, {success: true});
        await pass_time(10);
        expect(asked).toEqual(["logout", "login"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE", "EV_LOGIN_ACCEPTED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED") && !l.msg.includes("EV_DO_REFRESH")))
            .toEqual([]);
        await log_out();
    });

    test("a logout asked again while it is in flight sends nothing more, and drops a login that waited", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        const logout = later_answer();
        answers.logout = logout.answer;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        logout.give(200, {success: true});
        await pass_time(10);
        expect(asked).toEqual(["logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("no refresh timer fires while it is in flight", async () => {
        heard.length = 0;
        await log_in();

        answers.logout = STALL;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(asked).toEqual(["logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        await pass_time(15 * 60 * 1000);
        expect(asked).toEqual(["logout"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("C_AGENT_LOGIN: one refresh at a time", () => {
    /*  The refresh timer of a login of expires_in 300 is due at 270 s.  */
    const REFRESH_DUE_MS = 270 * 1000;

    test("a refresh asked for while one is in flight is answered by that one", async () => {
        heard.length = 0;   /*  what an earlier test left  */
        await log_in();

        logged.length = 0;
        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["refresh"]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("in flight")).length).toBe(1);

        refresh.give(200, {success: true, expires_in: 300});
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_REFRESHED"]);

        /*  It landed: the next one leaves.  */
        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["refresh", "refresh"]);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        await log_out();
    });

    test("the refresh timer that falls due while an asked refresh is in flight sends no second one", async () => {
        await log_in();

        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(REFRESH_DUE_MS + 10);
        expect(asked).toEqual(["refresh"]);

        refresh.give(200, {success: true, expires_in: 300});
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_REFRESHED"]);
        await log_out();
    });

    test("a refresh in flight when the session ended does not hold back the refresh of the next one", async () => {
        await log_in();

        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        await log_out();
        await log_in();

        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["refresh"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_REFRESHED"]);
        await log_out();
    });
});

describe("C_AGENT_LOGIN: the Retry-After it reads is the one of RFC 9110", () => {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const two = (n) => String(n).padStart(2, "0");
    const clock = (d) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
    const in_a_minute = () => new Date(Math.ceil((Date.now() + 60000) / 1000) * 1000);
    const imf = (d) => `${DAYS[d.getUTCDay()].slice(0, 3)}, ${two(d.getUTCDate())} ` +
        `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${clock(d)} GMT`;
    const rfc850 = (d) => `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())}-` +
        `${MONTHS[d.getUTCMonth()]}-${two(d.getUTCFullYear() % 100)} ${clock(d)} GMT`;
    const asctime = (d) => `${DAYS[d.getUTCDay()].slice(0, 3)} ${MONTHS[d.getUTCMonth()]} ` +
        `${String(d.getUTCDate()).padStart(2, " ")} ${clock(d)} ${d.getUTCFullYear()}`;
    const year = () => new Date(Date.now()).getUTCFullYear();

    /*  [what, Retry-After, the wait it asks for (null: none, unreadable)]  */
    test.for([
        ["delay-seconds", () => "60", 60000],
        ["delay-seconds with leading zeros", () => "0060", 60000],
        ["delay-seconds of ten digits (a wait of 5 minutes at most)", () => "9999999999", 9999999999000],
        ["delay-seconds of eleven digits (a delay is a delay: 5 minutes at most)", () => "99999999999", 99999999999000],
        ["an IMF-fixdate", () => imf(in_a_minute()), 60000],
        ["an rfc850-date", () => rfc850(in_a_minute()), 60000],
        ["an asctime-date, in GMT whatever the zone of the browser", () => asctime(in_a_minute()), 60000],
        ["an IMF-fixdate already past", () => "Sun, 06 Nov 1994 08:49:37 GMT", 0],
        ["a negative count", () => "-5", null],
        ["a fraction", () => "3.5", null],
        ["a count with a sign", () => "+60", null],
        ["two values", () => "60, 70", null],
        ["an ISO date", () => in_a_minute().toISOString(), null],
        ["a day of the month that does not exist", () => `Fri, 31 Nov ${year() + 1} 10:00:00 GMT`, null],
        ["a day of the month out of range", () => `Wed, 99 Oct ${year() + 1} 10:00:00 GMT`, null],
        ["a time out of range", () => `Wed, 01 Oct ${year() + 1} 99:99:99 GMT`, null],
        ["a day name that is no day", () => `Xyz, 01 Oct ${year() + 1} 10:00:00 GMT`, null],
        ["a day name that is not the one of the date", () => imf(in_a_minute()).replace(
            /^[A-Z][a-z]{2}/, (d) => (d === "Mon" ? "Tue" : "Mon")), null],
        ["an rfc850-date whose day name is not the one of the date", () => rfc850(in_a_minute())
            .replace(/^[A-Z][a-z]+day/, (d) => (d === "Monday" ? "Tuesday" : "Monday")), null],
        ["a month that is no month", () => `Wed, 01 Xyz ${year() + 1} 10:00:00 GMT`, null],
        ["names in lower case", () => imf(in_a_minute()).toLowerCase(), null],
        ["another zone than GMT", () => imf(in_a_minute()).replace("GMT", "UTC"), null],
        ["a date with no zone", () => imf(in_a_minute()).replace(" GMT", ""), null],
    ])("%s", async ([label, retry_after, wait_ms]) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        const text = retry_after();
        answers.refresh = ((headers) => ({status: 503, headers: headers, data: {
            success: false, error_code: "server_busy", error: "Pending queue full"
        }}))({"Retry-After": text});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        const unreadable = logged.filter((l) => l.level === "warning" &&
            l.msg.includes(`Retry-After: ${text} (unreadable, ignored)`));
        if(wait_ms === null) {
            expect(heard[0].kw.retry_ms).toBe(5000);
            expect(unreadable.length).toBe(1);
        } else {
            const retry_ms = Math.max(5000, Math.min(wait_ms, 5 * 60 * 1000));
            expect(heard[0].kw.retry_ms).toBeGreaterThanOrEqual(Math.max(5000, retry_ms - 1000));
            expect(heard[0].kw.retry_ms).toBeLessThanOrEqual(retry_ms + 1000);
            expect(unreadable.length).toBe(0);
        }
        await log_out();
    });
});

describe("C_AGENT_LOGIN: a 429 that is not the BFF's json is a 429", () => {
    test("a refresh: auth_rate_limited, a WARNING, and the retry waits for its Retry-After", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = ((headers) => ({status: 429, headers: headers,
            reject: new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")}))({"Retry-After": "30"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(heard[0].kw.retry_ms).toBe(30000);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("auth_rate_limited")).length)
            .toBe(1);
        await log_out();
    });

    test("a refresh: a Retry-After longer than 5 minutes ends the session at once", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = ((headers) => ({status: 429, headers: headers,
            reject: new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")}))({"Retry-After": "301"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a refresh: the fifth since the last refresh that landed ends the session", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = ((headers) => ({status: 429, headers: headers,
            reject: new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")}))();
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000, 40000]) {
            expect(gobj_current_state(login)).toBe("ST_LOGIN");
            await pass_time(backoff + 10);
        }
        expect(heard.map((h) => h.event).slice(-1)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[heard.length - 1].kw.error_code).toBe("auth_rate_limited");
        expect(asked.filter((x) => x === "refresh").length).toBe(5);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a login: denied with auth_rate_limited, a key of the locales", async () => {
        heard.length = 0;
        answers.login = ((headers) => ({status: 429, headers: headers,
            reject: new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")}))({"Retry-After": "30"});
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(AUTH_ERROR_I18N_KEYS).toContain("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("C_AGENT_LOGIN: a logout asked for while the login is in flight", () => {
    test("waits for the login, and then logs out: the cookies it set are cleared", async () => {
        heard.length = 0;
        if(gobj_current_state(login) === "ST_LOGIN") {
            await log_out();
        }
        logged.length = 0;
        asked.length = 0;
        const pending_login = later_answer();
        answers.login = pending_login.answer;
        const logout = later_answer();
        answers.logout = logout.answer;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["login"]);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");

        pending_login.give(200, OK_LOGIN.data);
        await pass_time(10);
        expect(asked).toEqual(["login", "logout"]);
        expect(gobj_current_state(login)).toBe("ST_LOGGING_OUT");
        expect(heard).toEqual([]);

        logout.give(200, {success: true});
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.ended_on_server).toBe(true);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a login denied meanwhile: the logout is sent all the same, and it is what is answered", async () => {
        heard.length = 0;
        asked.length = 0;
        logged.length = 0;
        const pending_login = later_answer();
        answers.login = pending_login.answer;
        answers.logout = {status: 200, data: {success: true}};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        pending_login.give(401, {success: false, error_code: "invalid_credentials", error: "x"});
        await pass_time(10);
        expect(asked).toEqual(["login", "logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a login asked for after it drops it: the user asked to enter after asking to leave", async () => {
        heard.length = 0;
        asked.length = 0;
        logged.length = 0;
        const pending_login = later_answer();
        answers.login = pending_login.answer;
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        pending_login.give(200, OK_LOGIN.data);
        await pass_time(10);
        expect(asked.filter((x) => x === "logout")).toEqual([]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_ACCEPTED"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        await log_out();
    });
});

describe("C_AGENT_LOGIN: a logout the server did not end", () => {
    test.for([
        ["a 403 of the BFF (an Origin it does not allow)", 403,
            {success: false, error_code: "origin_not_allowed", error: "Origin not allowed"}, "origin_not_allowed", false],
        ["a 400 of the BFF (a cookie longer than it writes)", 400,
            {success: false, error_code: "token_too_large", error: "x"}, "token_too_large", true],
        ["a 404 of the BFF", 404,
            {success: false, error_code: "unknown_endpoint", error: "x"}, "unknown_endpoint", true],
        ["a 429 of a rate limiter in front", 429,
            {error_code: "rate_limit_exceeded"}, "auth_rate_limited", false],
        ["a 500 of the BFF", 500,
            {success: false, error_code: "auth_config_error", error: "x"}, "auth_config_error", true],
        ["a 502 of the BFF", 502,
            {success: false, error_code: "auth_service_unavailable", error: "x"}, "auth_service_unavailable", true],
        ["a 503 of the BFF", 503,
            {success: false, error_code: "server_busy", error: "Pending queue full"}, "server_busy", true],
        ["a 504 of the BFF", 504,
            {success: false, error_code: "auth_timeout", error: "x"}, "auth_timeout", true],
        ["a 503 json of a gateway, with no code", 503, {message: "down"}, "auth_service_unavailable", false],
        ["a 502 page of a gateway", 502, null, "auth_service_unavailable", false],
    ])("%s: the session ends here, and EV_LOGOUT_DONE says the server did not end it",
    async ([label, status, data, error_code, cookies_cleared]) => {
        heard.length = 0;
        await log_in();

        answers.logout = (data ? {status: status, data: data} :
            {status: status, reject: new SyntaxError("Unexpected token '<'")});
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.ended_on_server).toBe(false);
        expect(heard[0].kw.error_code).toBe(error_code);
        expect(heard[0].kw.cookies_cleared).toBe(cookies_cleared);
        expect(AUTH_ERROR_I18N_KEYS).toContain(error_code);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a logout the BFF answered with success: EV_LOGOUT_DONE says it ended there", async () => {
        heard.length = 0;
        await log_in();

        answers.logout = {status: 200, data: {success: true}};
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.ended_on_server).toBe(true);
        expect(heard[0].kw.error_code).toBe("");
    });
});

describe("C_AGENT_LOGIN: a 429 with a json of its own is a 429", () => {
    const foreign = (headers) => ({status: 429, data: {error_code: "rate_limit_exceeded", error: "slow down"}, headers: headers});

    test("a refresh: auth_rate_limited, retried after its Retry-After, the session kept", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = foreign({"Retry-After": "30"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(heard[0].kw.retry_ms).toBe(30000);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("auth_rate_limited")).length)
            .toBe(1);
        await log_out();
    });

    test("a refresh: the code of the answer stays in the log, when it brought no text", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = {status: 429, data: {error_code: "rate_limit_exceeded"}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("rate_limit_exceeded")).length)
            .toBe(1);
        await log_out();
    });

    test("a refresh: a Retry-After longer than 5 minutes ends the session, as any 429", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = foreign({"Retry-After": "301"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a refresh: the fifth since the last refresh that landed ends the session", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = foreign();
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        for(const backoff of [5000, 10000, 20000, 40000]) {
            expect(gobj_current_state(login)).toBe("ST_LOGIN");
            await pass_time(backoff + 10);
        }
        expect(asked.filter((x) => x === "refresh").length).toBe(5);
        expect(heard[heard.length - 1].event).toBe("EV_LOGIN_DENIED");
        expect(heard[heard.length - 1].kw.error_code).toBe("auth_rate_limited");
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a login: denied with auth_rate_limited, and a WARNING: it is not a denial of the BFF", async () => {
        heard.length = 0;
        logged.length = 0;
        answers.login = foreign({"Retry-After": "30"});
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("auth_rate_limited")).length)
            .toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("denied"))).toEqual([]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("the 429 of the BFF, with its own code, is still its own denial of a login", async () => {
        heard.length = 0;
        logged.length = 0;
        answers.login = {status: 429, data: {success: false, error_code: "auth_rate_limited", error: "Too many login attempts"}};
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        await pass_time(10);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "info" && l.msg.includes("auth_rate_limited")).length)
            .toBe(1);
    });

    test("a logout: EV_LOGOUT_DONE with auth_rate_limited", async () => {
        heard.length = 0;
        await log_in();

        answers.logout = foreign();
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard[0].event).toBe("EV_LOGOUT_DONE");
        expect(heard[0].kw.ended_on_server).toBe(false);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
    });
});

describe("C_AGENT_LOGIN: a Retry-After is a delay whatever its number of digits", () => {
    const rate_limited = (headers) => ({status: 429, data: {success: false, error_code: "auth_rate_limited", error: "Too many"}, headers: headers});

    test.each([
        ["ten digits", "9999999999"],
        ["eleven digits", "99999999999"],
        ["twenty digits", "99999999999999999999"],
        ["four hundred digits, past what a number holds", "9".repeat(400)],
    ])("a 429 with %s ends the session at once", async (label, retry_after) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = rate_limited({"Retry-After": retry_after});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGIN_DENIED"]);
        expect(heard[0].kw.error_code).toBe("auth_rate_limited");
        expect(logged.filter((l) => l.msg.includes("unreadable"))).toEqual([]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("twelve digits that are a short delay are that delay", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = rate_limited({"Retry-After": "000000000030"});
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        expect(heard[0].kw.retry_ms).toBe(30000);
        await log_out();
    });
});

describe("C_AGENT_LOGIN: the two-digit year of an rfc850-date, RFC 9110 5.6.7", () => {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const two = (n) => String(n).padStart(2, "0");

    /*  The date in `iso` as an rfc850-date, with the day name of that date
     *  and the last two digits of its year.  */
    function rfc850(iso)
    {
        const d = new Date(iso);
        return `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-` +
            `${two(d.getUTCFullYear() % 100)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:` +
            `${two(d.getUTCSeconds())} GMT`;
    }

    const NOW_2026 = "2026-10-31T12:00:00Z";
    const NOW_2060 = "2060-06-01T00:00:00Z";
    const NOW_2099 = "2099-12-31T23:00:00Z";

    /*  The date is read into the future, or the past, or it is not a date
     *  once its year is the one the rule gives: its day name is that of
     *  another year.  */
    test.each([
        ["50 years ahead to the second is ahead", NOW_2026, "2076-10-31T12:00:00Z", "ahead"],
        ["a second more than 50 years ahead is in the past", NOW_2026, "1976-10-31T12:00:01Z", "past"],
        ["so its day name is that of the past", NOW_2026, "2076-10-31T12:00:01Z", "unreadable"],
        ["the same year, past the same day: in the past", NOW_2026, "1976-11-06T08:49:37Z", "past"],
        ["the same year, past the same day: never ahead", NOW_2026, "2076-11-06T08:49:37Z", "unreadable"],
        ["a year far ahead is the last one past", NOW_2026, "1999-01-01T00:00:00Z", "past"],
        ["never 2099", NOW_2026, "2099-01-01T00:00:00Z", "unreadable"],
        ["a year of this century, already past", NOW_2026, "2005-06-15T10:00:00Z", "past"],
        ["in 2060, 05 is 2105: 45 years ahead", NOW_2060, "2105-03-04T10:00:00Z", "ahead"],
        ["in 2060, 05 is not 2005", NOW_2060, "2005-03-04T10:00:00Z", "unreadable"],
        ["in 2060, 50 is 2050: 2150 is 90 years ahead", NOW_2060, "2050-03-04T10:00:00Z", "past"],
        ["in 2060, 2110 to the day is ahead", NOW_2060, "2110-06-01T00:00:00Z", "ahead"],
        ["in 2060, a day more is 2010", NOW_2060, "2010-06-02T00:00:00Z", "past"],
        ["at the end of 2099, 00 is the next year", NOW_2099, "2100-01-01T01:00:00Z", "ahead"],
    ])("%s", async (label, now, date, outcome) => {
        const before = Date.now();
        vi.setSystemTime(new Date(now));
        try {
            heard.length = 0;
            await log_in();
            vi.setSystemTime(new Date(now));    /*  "to the second" is meant  */

            logged.length = 0;
            const text = rfc850(date);
            answers.refresh = {status: 503, data: {success: false, error_code: "server_busy", error: "Pending queue full"}, headers: {"Retry-After": text}};
            gobj_send_event(login, "EV_DO_REFRESH", {}, login);
            await pass_time(10);
            expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
            expect(heard[0].kw.retry_ms).toBe((outcome === "ahead") ? 5 * 60 * 1000 : 5000);
            expect(logged.filter((l) => l.level === "warning" &&
                l.msg.includes(`Retry-After: ${text} (unreadable, ignored)`)).length)
                .toBe((outcome === "unreadable") ? 1 : 0);
            await log_out();
        } finally {
            vi.setSystemTime(before);
        }
    });
});

describe("C_AGENT_LOGIN: an HTTP-date has to be a date", () => {
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const two = (n) => String(n).padStart(2, "0");

    /*  An IMF-fixdate of a day that does not exist, with the day name of
     *  the day it would roll over to: only the limit of the month refuses
     *  it.  */
    function rolled_over(year, month, day)
    {
        const name = DAY_NAMES[new Date(Date.UTC(year, month, day)).getUTCDay()];
        return `${name}, ${two(day)} ${MONTHS[month]} ${year} 10:00:00 GMT`;
    }

    /*  An IMF-fixdate a little over a minute ahead whose second is `second`.  */
    function at_second(second)
    {
        const d = new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000);
        return `${DAY_NAMES[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ` +
            `${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(second)} GMT`;
    }

    async function retried_after(text)
    {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.refresh = {status: 503, data: {success: false, error_code: "server_busy", error: "Pending queue full"}, headers: {"Retry-After": text}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_REFRESH_FAILED"]);
        const retry_ms = heard[0].kw.retry_ms;
        const unreadable = logged.filter((l) => l.msg.includes("(unreadable, ignored)")).length;
        await log_out();
        return {retry_ms, unreadable};
    }

    test.each([
        ["31 of a month of 30", () => rolled_over(new Date(Date.now()).getUTCFullYear() + 1, 10, 31)],
        ["29 of February of a year that is not leap", () => rolled_over(2031, 1, 29)],
        ["30 of February of a leap year", () => rolled_over(2032, 1, 30)],
        ["day 00", () => rolled_over(new Date(Date.now()).getUTCFullYear() + 1, 11, 0)],
    ])("%s, with the day name of the day it rolls over to, is ignored", async (label, text) => {
        const {retry_ms, unreadable} = await retried_after(text());
        expect(retry_ms).toBe(5000);
        expect(unreadable).toBe(1);
    });

    test("29 of February of a leap year is a date", async () => {
        const {unreadable} = await retried_after("Sun, 29 Feb 2032 10:00:00 GMT");
        expect(unreadable).toBe(0);
    });

    test("second 60 is a leap second: a date, and the minute after", async () => {
        const minute = new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000).getTime();
        const {retry_ms, unreadable} = await retried_after(at_second(60));
        expect(unreadable).toBe(0);
        expect(Math.abs(retry_ms - (minute + 60000 - Date.now()))).toBeLessThan(2000);
    });

    test.each([
        ["second 61", () => at_second(61)],
        ["hour 24", () => at_second(0).replace(/ \d{2}:(\d{2}):00 GMT$/, " 24:$1:00 GMT")],
        ["minute 60", () => at_second(0).replace(/:\d{2}:00 GMT$/, ":60:00 GMT")],
    ])("%s is ignored", async (label, text) => {
        const {retry_ms, unreadable} = await retried_after(text());
        expect(retry_ms).toBe(5000);
        expect(unreadable).toBe(1);
    });
});

describe("C_AGENT_LOGIN: what a logout that failed says", () => {
    test.for([
        ["a 200 that is not the BFF's json", {status: 200, data: {}}, "auth_bad_response"],
        ["a 200 with success false", {status: 200, data: {success: false}}, "auth_bad_response"],
        ["a 500 that says success", {status: 500, data: {success: true}}, "auth_service_unavailable"],
        ["a 403 that says success", {status: 403, data: {success: true}}, "auth_bad_response"],
        ["a 403 of the BFF", {status: 403, data: {success: false, error_code: "origin_not_allowed", error: "x"}}, "origin_not_allowed"],
    ])("%s: not ended on the server, and a WARNING, never an ERROR", async ([label, answer, error_code]) => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.logout = answer;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.ended_on_server).toBe(false);
        expect(heard[0].kw.error_code).toBe(error_code);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("BFF logout failed") &&
            l.msg.includes(error_code)).length).toBe(1);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("a logout that never leaves (no network): network_error, a WARNING", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.logout = () => Promise.reject(new TypeError("Failed to fetch"));
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard[0].kw.ended_on_server).toBe(false);
        expect(heard[0].kw.error_code).toBe("network_error");
        expect(heard[0].kw.cookies_cleared).toBe(false);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("BFF logout failed")).length)
            .toBe(1);
    });

    test("a logout that does not come in time: auth_timeout, a WARNING", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        answers.logout = (request) => new Promise((resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(abort_error()));
        });
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(BFF_TIMEOUT_MS + 10);
        expect(heard[0].kw.ended_on_server).toBe(false);
        expect(heard[0].kw.error_code).toBe("auth_timeout");
        expect(heard[0].kw.cookies_cleared).toBe(false);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("BFF logout failed")).length)
            .toBe(1);
    });
});

describe("C_AGENT_LOGIN: a kw is plain json", () => {
    test("a delay no number holds travels as a number that json can say", async () => {
        heard.length = 0;
        await log_in();

        traced.length = 0;
        gobj_set_gobj_trace(login, "machine", true);
        gobj_set_gobj_trace(login, "ev_kw", true);
        answers.refresh = {status: 503, data: {success: false, error_code: "server_busy", error: "x"},
            headers: {"Retry-After": "9".repeat(400)}};
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(10);
        gobj_set_gobj_trace(login, "machine", false);
        gobj_set_gobj_trace(login, "ev_kw", false);

        const failed = traced.filter((jn) => jn && Object.hasOwn(jn, "retry_after_ms"));
        expect(failed.length).toBe(1);
        expect(Number.isFinite(failed[0].retry_after_ms)).toBe(true);
        await log_out();
    });
});

describe("C_AGENT_LOGIN: a refresh in flight disarms the timer", () => {
    test("the timer does not fall due while it is out", async () => {
        heard.length = 0;
        await log_in();

        logged.length = 0;
        const refresh = later_answer();
        answers.refresh = refresh.answer;
        gobj_send_event(login, "EV_DO_REFRESH", {}, login);
        await pass_time(270 * 1000 + 10);
        expect(asked).toEqual(["refresh"]);
        expect(logged.filter((l) => l.msg.includes("the refresh timer"))).toEqual([]);

        refresh.give(200, {success: true, expires_in: 300});
        await pass_time(10);
        await log_out();
    });

    test("a refresh that lands arms the next one", async () => {
        heard.length = 0;
        await log_in();

        answers.refresh = {status: 200, data: {success: true, expires_in: 300}};
        await pass_time(270 * 1000 + 10);
        expect(asked.filter((x) => x === "refresh").length).toBe(1);
        await pass_time(270 * 1000 + 10);
        expect(asked.filter((x) => x === "refresh").length).toBe(2);
        await log_out();
    });
});

describe("C_AGENT_LOGIN: a logout asked for while the restore on load is in flight", () => {
    async function restart()
    {
        if(gobj_current_state(login) === "ST_LOGIN") {
            await log_out();
        }
        heard.length = 0;
        asked.length = 0;
        logged.length = 0;
        gobj_stop(login);
        const restore = later_answer();
        answers.refresh = restore.answer;
        gobj_start(login);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");
        return restore;
    }

    test("no session to restore: the logout goes out all the same, and it is what is answered", async () => {
        const restore = await restart();
        answers.logout = {status: 200, data: {success: true}};
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(asked).toEqual(["refresh"]);

        restore.give(401, {success: false, error_code: "missing_refresh_token", error: "x"});
        await pass_time(10);
        expect(asked).toEqual(["refresh", "logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
    });

    test("a session restored: it is logged out, and never published", async () => {
        const restore = await restart();
        answers.logout = {status: 200, data: {success: true}};
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);

        restore.give(200, {success: true, username: "u", expires_in: 300});
        await pass_time(10);
        expect(asked).toEqual(["refresh", "logout"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });
});

describe("C_AGENT_LOGIN: EV_LOGOUT_DONE says when a login comes after it", () => {
    test("a login that waited for the logout: login_follows", async () => {
        heard.length = 0;
        await log_in();

        const logout = later_answer();
        answers.logout = logout.answer;
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        gobj_send_event(login, "EV_DO_LOGIN", {username: "u", password: "p"}, login);
        const held = later_answer();
        answers.login = held.answer;
        logout.give(200, {success: true});
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.login_follows).toBe(true);
        expect(gobj_current_state(login)).toBe("ST_WAIT_TOKEN");
        held.give(401, {success: false, error_code: "invalid_credentials", error: "x"});
        await pass_time(10);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
    });

    test("no login waiting: it does not", async () => {
        heard.length = 0;
        await log_in();

        answers.logout = {status: 200, data: {success: true}};
        gobj_send_event(login, "EV_DO_LOGOUT", {}, login);
        await pass_time(10);
        expect(heard.map((h) => h.event)).toEqual(["EV_LOGOUT_DONE"]);
        expect(heard[0].kw.login_follows).toBe(false);
    });
});

describe("the reading of the catalog of c_auth_bff.h", () => {
    const block = (lines) => [
        " *  ---------------------------------------------------------------------",
        " *  Codes emitted by the login/token path (after talking to IdP)",
        " *  ---------------------------------------------------------------------",
        ...lines,
        " *",
        " *  New codes MUST be added here first",
    ].join("\n");

    test("a code with a digit, and a tab after the status, are read", () => {
        expect(parse_bff_catalog(block([
            " *  invalid_credentials       401  Wrong username or password",
            " *                                 a meaning that goes on",
            " *  oauth2_failed             401  A code with a digit",
            " *  tabbed_code\t400\tA tab after the status",
            " *\ttab_indented              400  A tab before the code",
            " *                                     its meaning goes on, a tab being 8 columns",
        ]))).toEqual(["invalid_credentials", "oauth2_failed", "tabbed_code", "tab_indented"]);
    });

    test.each([
        ["a code with a hyphen", " *  oauth-failed              401  x"],
        ["a code in capitals", " *  OAuth_failed              401  x"],
        ["a status that is not three digits", " *  oauth2_failed             4xx  x"],
    ])("%s is not skipped: the reading fails", (label, line) => {
        expect(() => parse_bff_catalog(block([line]))).toThrow(/catalog/);
    });

    test.each([
        ["an indent of one blank", " * oauth2_failed             401  x"],
        ["an indent of three blanks", " *   oauth2_failed             401  x"],
        ["an indent of five blanks", " *     oauth2_failed             401  x"],
        ["an indent of eight blanks", " *        oauth2_failed             401  x"],
        ["no blank after the \"*\"", " *oauth2_failed             401  x"],
        ["a line with no \" *\"", "oauth2_failed               401  x"],
        ["a blank line with a blank after the \"*\"", " * "],
    ])("%s is not skipped: the reading fails", (label, line) => {
        expect(() => parse_bff_catalog(block([line]))).toThrow(/catalog/);
    });

    test.each([
        ["a code line", " *  oauth2_failed             401  x\r"],
        ["a blank line", " *\r"],
        ["a rule", " *  -----\r"],
    ])("a CR at the end of %s fails the reading, and says it", (label, line) => {
        expect(() => parse_bff_catalog(block([line]))).toThrow(/a CR/);
    });

    test("a code line glued to \"New codes MUST\" fails the reading", () => {
        expect(() => parse_bff_catalog([
            " *  Codes emitted by the login/token path (after talking to IdP)",
            " *  invalid_credentials       401  Wrong username or password",
            " *  oauth2_failed             401  x New codes MUST be added here first",
        ].join("\n"))).toThrow(/catalog/);
    });

    test.each([
        ["one column short", " *                                a meaning that goes on"],
        ["one column too far", " *                                  a meaning that goes on"],
        ["at five blanks", " *     a meaning that goes on"],
    ])("a meaning that goes on %s is not skipped: the reading fails", (label, line) => {
        expect(() => parse_bff_catalog(block([
            " *  invalid_credentials       401  Wrong username or password",
            line,
        ]))).toThrow(/catalog/);
    });

    test("a meaning that goes on after a blank line, or after a rule, fails the reading", () => {
        for(const before of [" *", " *  -----"]) {
            expect(() => parse_bff_catalog(block([
                " *  invalid_credentials       401  Wrong username or password",
                before,
                " *                                 a meaning that goes on",
            ]))).toThrow(/catalog/);
        }
    });

    test.for([
        ["a code indented five blanks", (t) => t.replace(" *  server_busy ", " *     server_busy ")],
        ["a code indented eight blanks", (t) => t.replace(" *  server_busy ", " *        server_busy ")],
        ["a code with no blank after the \"*\"", (t) => t.replace(" *  server_busy ", " *server_busy ")],
        ["a meaning that goes on one column short", (t) => t.replace(
            "\n *                                 valid", "\n *                                valid")],
        ["CRLF line endings", (t) => t.replaceAll("\n", "\r\n")],
    ])("the real header with %s fails the reading", ([label, mutate], ctx) => {
        ctx.skip(!BFF_CATALOG, BFF_CATALOG_MISSING);
        const text = readFileSync(BFF_HEADER, "utf8");
        const mutant = mutate(text);
        expect(mutant).not.toBe(text);
        expect(() => parse_bff_catalog(mutant)).toThrow(/catalog/);
    });

    test("a code added to the real header is seen, so the copy no longer matches it", (ctx) => {
        ctx.skip(!BFF_CATALOG, BFF_CATALOG_MISSING);
        const text = readFileSync(BFF_HEADER, "utf8").replace(
            " *  server_busy ",
            " *  oauth2_failed             401  A code with a digit\n *  server_busy "
        );
        const mutant = parse_bff_catalog(text);
        expect(mutant).toContain("oauth2_failed");
        expect([...mutant].sort()).not.toEqual([...BFF_ERROR_CODES_COPY].sort());
    });
});
