// @vitest-environment jsdom
/***********************************************************************
 *          real_transport.wiring.test.js
 *
 *      A connection refuses the identity, through the REAL C_IEVENT_CLI:
 *      what it does around its EV_ON_ID_NAK is what a double cannot say.
 *      It closes the socket BEFORE it publishes, the close comes back as an
 *      event of a later turn, and from it the transport arms a retry of
 *      its own.
 *
 *      A first NAK asks for one silent refresh, and the connection is
 *      reopened with the new token. A second one is a refusal: the
 *      transport goes on the next turn, the cause stays, no socket is
 *      opened after it, and nothing lands undefined anywhere.
 *
 *      Driven through the real C_TREEDB_APP, C_TREEDB_LOGIN, C_TREEDB_LINKS,
 *      C_TREEDB_CONFIG, C_IEVENT_CLI and C_TIMER, in jsdom; the WebSocket
 *      and the BFF are doubles, and the session is set by hand: the shell
 *      is not what is driven here.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";

vi.mock("./login.js", () => ({
    mount_login: () => ({
        set_error() {},
        clear_error() {},
        set_busy() {},
        unmount() {},
    })
}));

const {
    SDATA_END,
    gclass_create,
    gobj_start_up, gobj_create_yuno, gobj_create_service, gobj_find_service,
    gobj_start, gobj_stop_tree, gobj_destroy, gobj_send_event, gobj_change_state,
    gobj_is_destroying,
    register_c_timer, register_c_ievent_cli,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_treedb_config} = await import("./c_treedb_config.js");
const {
    register_c_treedb_links, treedb_links_get_iev, treedb_links_get_open_error,
} = await import("./c_treedb_links.js");
const {register_c_login} = await import("./c_login.js");
const {register_c_app} = await import("./c_app.js");

const logged = [];
const log_sink = (level, msg) => {
    logged.push({level: String(level), msg: String(msg)});
};
const asked = [];
let answers = {};
let yuno = null;

/*  A socket that opens when it is told, and whose close comes on a later
 *  turn, as a browser's does.  */
const sockets = [];
class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        sockets.push(this);
    }
    send() {
    }
    close(code, reason) {
        if(this.readyState >= FakeWebSocket.CLOSING) {
            return;
        }
        this.readyState = FakeWebSocket.CLOSING;
        setTimeout(() => {
            this.readyState = FakeWebSocket.CLOSED;
            if(this.onclose) {
                this.onclose({code: code || 1000, reason: reason || "", wasClean: true});
            }
        }, 0);
    }
    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen();
    }
    /*  The answer to the identity card.  */
    ack(result, comment) {
        this.onmessage({data: JSON.stringify({
            event: "EV_IDENTITY_CARD_ACK",
            kw: {
                result, comment, username: "u", services_roles: {},
                __md_iev__: {ievent_gate_stack: [
                    {src_yuno: "db", src_role: "db", src_service: "treedb_db"}
                ]}
            }
        })});
    }
}

function fake_fetch(url)
{
    const segment = String(url).split("/").pop();
    asked.push(segment);
    const answer = answers[segment];
    return Promise.resolve({
        ok:      answer.status >= 200 && answer.status < 300,
        status:  answer.status,
        headers: new Headers(),
        json:    () => Promise.resolve(answer.data),
    });
}

beforeAll(() => {
    vi.stubGlobal("fetch", fake_fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(log_sink);
    register_c_timer();
    register_c_ievent_cli();
    register_c_treedb_config();
    register_c_treedb_links();
    register_c_login();
    register_c_app();

    gclass_create("C_TEST_YUNO", [], [["ST_IDLE", []]], {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);

    yuno = gobj_create_yuno("transport_yuno", "C_TEST_YUNO", {});
    gobj_start(yuno);
});

const built = [];

beforeEach(() => {
    vi.useFakeTimers();
    logged.length = 0;
    asked.length = 0;
    sockets.length = 0;
    localStorage.clear();
    answers = {
        refresh: {status: 401, data: {success: false, error_code: "missing_refresh_token", error: "x"}},
        token:   {status: 200, data: {success: true, access_token: "a.b.c"}},
    };
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

function defects()
{
    return logged.filter((l) => l.level === "error" &&
        /NOT DEFINED|Destroying a gobj/.test(l.msg)).map((l) => l.msg);
}

const CONN = {id: "c1", url: "wss://backend.example:1800", enabled: true,
    remote_yuno_role: "db", remote_yuno_service: "treedb_db"};

/*  The app in session, with the connection's socket open.  */
async function in_session()
{
    const app = gobj_create_service("treedb_app", "C_TREEDB_APP", {}, yuno);
    built.push(app);
    gobj_start(app);
    await pass_time(10);
    set_log_callback(log_sink);
    logged.length = 0;
    const login = gobj_find_service("treedb_login", true);
    const links = gobj_find_service("treedb_links", true);
    gobj_change_state(login, "ST_LOGIN");
    gobj_change_state(app, "ST_SESSION");
    /*  The config says what the refresh reopens.  */
    gobj_send_event(gobj_find_service("treedb_config", true), "EV_SET_CONNECTIONS",
        {connections: [CONN]}, app);
    gobj_send_event(links, "EV_SYNC_CONNECTIONS", {connections: [CONN]}, app);
    await pass_time(10);
    expect(sockets.length).toBe(1);
    sockets[0].open();
    await pass_time(10);
    asked.length = 0;
    answers.refresh = {status: 200, data: {success: true, username: "u", expires_in: 300}};
    return {app, links};
}

describe("a backend refuses the identity", () => {

    test("once: a silent refresh, and the connection is reopened", async () => {
        const {app} = await in_session();
        sockets[0].ack(-1, "token expired");
        await pass_time(10);
        expect(asked).toEqual(["refresh", "token"]);
        expect(app.priv.nak_recovered.c1).toBe(true);
        expect(sockets.length).toBeGreaterThan(1);
        expect(defects()).toEqual([]);
    });

    test("twice: the transport goes on the next turn, the cause stays, nothing retries", async () => {
        const {links} = await in_session();
        sockets[0].ack(-1, "token expired");
        await pass_time(10);
        const retry = sockets[sockets.length - 1];
        retry.open();
        await pass_time(10);

        retry.ack(-1, "no role");
        await pass_time(10);
        expect(treedb_links_get_iev(links, "c1")).toBe(null);
        expect(treedb_links_get_open_error(links, "c1")).toEqual(
            expect.objectContaining({rejected: true, reason: "no role"}));

        const opened = sockets.length;
        await pass_time(5 * 60 * 1000);
        expect(sockets.length).toBe(opened);
        expect(defects()).toEqual([]);
    });
});
