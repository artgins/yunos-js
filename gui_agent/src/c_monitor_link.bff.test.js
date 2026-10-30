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
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_monitor_link} = await import("./c_monitor_link.js");

const BFF_TIMEOUT_MS = 15000;

const heard = [];
const asked = [];
let stall_body = false;    /*  the headers come, the body never does  */
let link = null;

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
    if(stall_body) {
        return Promise.resolve({
            ok:     true,
            status: 200,
            json:   () => until_aborted(request.signal),
        });
    }
    return until_aborted(request.signal);
}

beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fake_fetch);

    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(() => {});
    register_c_monitor_link();

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

    const yuno = gobj_create_yuno("yuno", "C_TEST_YUNO", {});
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
