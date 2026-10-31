/***********************************************************************
 *          c_monitor_link.bff.test.js
 *
 *      C_MONITOR_LINK asks the BFF for the access_token (/auth/token)
 *      with the deadline of every other call to the BFF, headers and
 *      body: a BFF that never answers, or that sends the headers and then
 *      goes silent, ends in EV_TOKEN_FETCHED with no token, so the link
 *      fails out loud (EV_LINK_FAILED "monitor token unreachable", back
 *      to ST_IDLE) instead of staying in ST_FETCHING for ever.
 *
 *      Only the answer of the last token asked for is taken: a token of
 *      a link dropped before it came (the session ended, another link
 *      was asked for) does not open the next link, and a renewal answered
 *      after a newer one does not replace it. The token reaches the link
 *      through EV_TOKEN_FETCHED, whose trace masks it and shows the
 *      number of its request.
 *
 *      A link refused twice is dropped on the next turn: a new link asked
 *      for before the drop lands (in ST_FETCHING, or already in
 *      ST_LINKED) is not dropped with it, and the drop is defined in
 *      every state. The link stops following the login's cookie refreshes
 *      when it is refused, not when the drop lands: a refresh in between
 *      has nothing to renew, and ST_IDLE does not declare it.
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
    SDATA, SDATA_END, data_type_t,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create_service,
    gobj_start, gobj_send_event, gobj_current_state, gobj_read_attr,
    gobj_set_gobj_trace, gobj_name, gobj_publish_event, gobj_read_pointer_attr,
    gobj_subscribe_event,
    event_flag_t,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_monitor_link} = await import("./c_monitor_link.js");

const BFF_TIMEOUT_MS = 15000;

const heard = [];
const asked = [];
const traced = [];         /*  the json the trace dumps  */
const logged = [];         /*  {level, msg} of every other log  */
let stall_body = false;    /*  the headers come, the body never does  */
const later = [];          /*  when not null: each request waits here for give(token)  */
let answer_later = false;
let link = null;
let login = null;

function abort_error()
{
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    return err;
}

/*  Wait for the abort of `signal`, as a browser does; with no signal
 *  (a call with no deadline) it waits for ever.  */
function until_aborted(signal)
{
    return new Promise((resolve, reject) => {
        if(!signal) {
            return;
        }
        signal.addEventListener("abort", () => reject(abort_error()));
    });
}

function fake_fetch(url, request)
{
    asked.push(String(url).split("/").pop());
    if(answer_later) {
        return new Promise((resolve) => {
            later.push((token) => resolve({
                ok:      true,
                status:  200,
                headers: new Headers(),
                json:    () => Promise.resolve({success: true, access_token: token}),
            }));
        });
    }
    if(stall_body) {
        return Promise.resolve({
            ok:      true,
            status:  200,
            headers: new Headers(),
            json:    () => until_aborted(request.signal),
        });
    }
    return until_aborted(request.signal);
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        if(level === "json") {
            traced.push(msg);
        } else {
            logged.push({level: String(level), msg: String(msg)});
        }
    });
    register_c_monitor_link();

    /*  A transport that only holds its attrs: the jwt is what is looked at.  */
    gclass_create(
        "C_IEVENT_CLI", [], [["ST_IDLE", []]], {}, 0,
        [
            SDATA(data_type_t.DTP_STRING, "url", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_role", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_service", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "remote_yuno_name", 0, "", ""),
            SDATA(data_type_t.DTP_STRING, "jwt", 0, "", ""),
            SDATA(data_type_t.DTP_LIST, "required_services", 0, "[]", ""),
            SDATA(data_type_t.DTP_POINTER, "subscriber", 0, null, ""),
            SDATA_END()
        ],
        {}, 0, 0, 0, 0
    );

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

    const link_out = [
        "EV_ON_OPEN", "EV_ON_CLOSE", "EV_ON_OPEN_ERROR", "EV_LINK_FAILED",
        "EV_MT_COMMAND_ANSWER", "EV_MT_STATS_ANSWER", "EV_YUNO_STATS",
    ];
    const record = (gobj, event, kw) => {
        heard.push({event, kw});
        return 0;
    };
    gclass_create(
        "C_TEST_SINK",
        link_out.map((ev) => [ev, 0]),
        [["ST_IDLE", link_out.map((ev) => [ev, record, null])]],
        {},
        0,
        [SDATA_END()],
        {}, 0, 0, 0, 0
    );

    /*  The login: what the link follows, while a link exists.  */
    gclass_create(
        "C_TEST_LOGIN",
        [["EV_LOGIN_REFRESHED", event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS]],
        [["ST_IDLE", []]],
        {},
        0,
        [SDATA_END()],
        {}, 0, 0, 0, 0
    );

    const yuno = gobj_create_yuno("yuno", "C_TEST_YUNO", {});
    login = gobj_create_service("agent_login", "C_TEST_LOGIN", {}, yuno);
    const sink = gobj_create_service("sink", "C_TEST_SINK", {}, yuno);
    link = gobj_create_service("monitor_link", "C_MONITOR_LINK", {subscriber: sink}, yuno);
    gobj_start(link);
});

afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function pass_time(ms)
{
    await vi.advanceTimersByTimeAsync(ms);
}

describe("C_MONITOR_LINK: /auth/token has a deadline", () => {
    test("a BFF that never answers: EV_LINK_FAILED after the deadline", async () => {
        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        expect(gobj_current_state(link)).toBe("ST_FETCHING");
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(asked).toEqual(["token"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LINK_FAILED"]);
        expect(heard[0].kw.error_code).toBe("monitor token unreachable");
        expect(gobj_current_state(link)).toBe("ST_IDLE");
    });

    test("a BFF that sends the headers and goes silent: the same", async () => {
        heard.length = 0;
        asked.length = 0;
        stall_body = true;
        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        await pass_time(BFF_TIMEOUT_MS - 10);
        expect(heard).toEqual([]);
        await pass_time(20);
        expect(asked).toEqual(["token"]);
        expect(heard.map((h) => h.event)).toEqual(["EV_LINK_FAILED"]);
        expect(heard[0].kw.error_code).toBe("monitor token unreachable");
        expect(gobj_current_state(link)).toBe("ST_IDLE");
    });
});

describe("C_MONITOR_LINK: only the answer of the last token asked for is taken", () => {
    test("a token of a link dropped before it came does not open the next link", async () => {
        heard.length = 0;
        asked.length = 0;
        stall_body = false;
        answer_later = true;
        later.length = 0;

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        expect(gobj_current_state(link)).toBe("ST_IDLE");
        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        expect(gobj_current_state(link)).toBe("ST_FETCHING");
        expect(later.length).toBe(2);

        later[0]("token-of-the-dropped-link");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_FETCHING");
        expect(gobj_read_attr(link, "iev")).toBe(null);

        later[1]("token-of-this-link");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");
        expect(gobj_read_attr(gobj_read_attr(link, "iev"), "jwt")).toBe("token-of-this-link");
    });

    test("a renewal answered after a newer one does not replace it", async () => {
        later.length = 0;
        gobj_send_event(link, "EV_LOGIN_REFRESHED", {}, link);
        gobj_send_event(link, "EV_LOGIN_REFRESHED", {}, link);
        expect(later.length).toBe(2);

        later[1]("token-2");
        await pass_time(10);
        later[0]("token-1");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");
        expect(gobj_read_attr(gobj_read_attr(link, "iev"), "jwt")).toBe("token-2");

        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        answer_later = false;
    });
});

describe("C_MONITOR_LINK: the trace of EV_TOKEN_FETCHED", () => {
    test("masks the token and shows the number of its request", async () => {
        heard.length = 0;
        answer_later = true;
        later.length = 0;
        traced.length = 0;
        gobj_set_gobj_trace(link, "machine", true);
        gobj_set_gobj_trace(link, "ev_kw", true);

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        later[0]("a.secret.token");
        await pass_time(10);
        gobj_set_gobj_trace(link, "machine", false);
        gobj_set_gobj_trace(link, "ev_kw", false);

        const fetched = traced.filter((jn) => jn && Object.hasOwn(jn, "access_token"));
        expect(fetched.length).toBe(1);
        expect(fetched[0].access_token).not.toBe("a.secret.token");
        for(const [key, value] of Object.entries(fetched[0])) {
            if(key !== "access_token") {
                expect([key, value]).not.toEqual([key, "********"]);
            }
        }
        expect(Object.values(fetched[0]).filter((v) => typeof v === "number" && v > 0).length)
            .toBeGreaterThan(0);

        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        answer_later = false;
    });
});

describe("C_MONITOR_LINK: the drop of a link refused twice", () => {
    test("lands in whatever state the next link is in, and drops only its own transport", async () => {
        heard.length = 0;
        logged.length = 0;
        answer_later = true;
        later.length = 0;

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        later[0]("token-1");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");
        const refused = gobj_read_attr(link, "iev");

        /*  Refused, renewed, refused again: the drop is posted.  */
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "expired"}, refused);
        later[1]("token-2");
        await pass_time(10);
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "no authz"}, refused);
        expect(gobj_current_state(link)).toBe("ST_IDLE");
        expect(heard.map((h) => h.event)).toEqual(["EV_LINK_FAILED"]);
        expect(logged.filter((l) => l.level === "warning" && l.msg.includes("no authz")).length).toBe(1);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);

        /*  A new link is asked for before the drop lands.  */
        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-b:1993"}, link);
        expect(gobj_current_state(link)).toBe("ST_FETCHING");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_FETCHING");
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);

        /*  ...and the token of the new link opens it.  */
        later[2]("token-3");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");
        const next = gobj_read_attr(link, "iev");
        expect(gobj_name(next)).not.toBe(gobj_name(refused));
        expect(gobj_read_attr(next, "jwt")).toBe("token-3");

        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        answer_later = false;
    });

    test("landing after the next link opened, it leaves that link alone", async () => {
        heard.length = 0;
        logged.length = 0;
        answer_later = true;
        later.length = 0;

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        later[0]("token-1");
        await pass_time(10);
        const refused = gobj_read_attr(link, "iev");
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "expired"}, refused);
        later[1]("token-2");
        await pass_time(10);

        /*  The second refusal, the next link and its token before the
         *  drop lands: the token is a promise, the drop the next turn.  */
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "no authz"}, refused);
        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-b:1993"}, link);
        later[2]("token-3");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");
        const next = gobj_read_attr(link, "iev");
        expect(next).toBeTruthy();
        expect(gobj_name(next)).not.toBe(gobj_name(refused));
        expect(gobj_read_attr(next, "jwt")).toBe("token-3");
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);

        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        answer_later = false;
    });

    test("a cookie refresh between the refusal and the drop lands nowhere", async () => {
        heard.length = 0;
        logged.length = 0;
        answer_later = true;
        later.length = 0;

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        later[0]("token-1");
        await pass_time(10);
        const refused = gobj_read_attr(link, "iev");
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "expired"}, refused);
        later[1]("token-2");
        await pass_time(10);

        /*  Refused twice: back in ST_IDLE, the transport goes next turn.  */
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "no authz"}, refused);
        expect(gobj_current_state(link)).toBe("ST_IDLE");
        logged.length = 0;
        gobj_publish_event(login, "EV_LOGIN_REFRESHED", {});
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);
        expect(later.length).toBe(2);

        await pass_time(10);
        expect(gobj_read_attr(link, "iev")).toBe(null);
        expect(logged.filter((l) => l.level === "error")).toEqual([]);
        answer_later = false;
    });

    test("the next link follows the refreshes again", async () => {
        heard.length = 0;
        logged.length = 0;
        answer_later = true;
        later.length = 0;

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-a:1993"}, link);
        later[0]("token-1");
        await pass_time(10);
        const refused = gobj_read_attr(link, "iev");
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "expired"}, refused);
        later[1]("token-2");
        await pass_time(10);
        gobj_send_event(link, "EV_ON_ID_NAK", {comment: "no authz"}, refused);
        await pass_time(10);

        gobj_send_event(link, "EV_CONNECT", {url: "wss://node-b:1993"}, link);
        later[2]("token-3");
        await pass_time(10);
        expect(gobj_current_state(link)).toBe("ST_LINKED");

        gobj_publish_event(login, "EV_LOGIN_REFRESHED", {});
        expect(later.length).toBe(4);
        later[3]("token-4");
        await pass_time(10);
        expect(gobj_read_attr(gobj_read_attr(link, "iev"), "jwt")).toBe("token-4");
        expect(logged.filter((l) => l.msg.includes("NOT DEFINED"))).toEqual([]);

        gobj_send_event(link, "EV_DISCONNECT", {}, link);
        answer_later = false;
    });
});
