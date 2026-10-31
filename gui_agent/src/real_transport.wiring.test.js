/***********************************************************************
 *          real_transport.wiring.test.js
 *
 *      An identity refused, through the REAL C_IEVENT_CLI: what it does
 *      around its EV_ON_ID_NAK is what a double cannot say. It closes the
 *      socket BEFORE it publishes, the close comes back as an event of a
 *      later turn, and from it the transport arms a retry of its own.
 *
 *      - The control center: a NAK asks for one silent refresh and the
 *        link reopens; a second one ends the session on the next turn. The
 *        form says it in the language of the app, no socket is opened
 *        after that, and nothing lands undefined anywhere.
 *
 *      - The monitor's link to an agent: a NAK renews the token and the
 *        transport retries with it by itself; a second one gives up. A
 *        cookie refresh in between lands nowhere.
 *
 *      Driven through the real C_APP, C_AGENT_LOGIN, C_AGENT_LINK,
 *      C_AGENT_CONFIG, C_MONITOR_LINK, C_IEVENT_CLI and C_TIMER; the
 *      WebSocket, the BFF and the form are doubles.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

const login_screens = [];
vi.mock("./login.js", () => ({
    mount_login: () => {
        const screen = {error: "", busy: false, mounted: true};
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
    gobj_start, gobj_stop_tree, gobj_destroy, gobj_send_event, gobj_publish_event,
    gobj_current_state, gobj_is_destroying, gobj_is_running, gobj_read_attr,
    register_c_timer, register_c_ievent_cli,
    set_log_callback,
} = await import("@yuneta/gobj-js");
const {register_c_agent_config} = await import("./c_agent_config.js");
const {register_c_agent_link} = await import("./c_agent_link.js");
const {register_c_agent_login} = await import("./c_agent_login.js");
const {register_c_monitor_link} = await import("./c_monitor_link.js");
const {register_c_app} = await import("./c_app.js");
const {default: i18next} = await import("i18next");
const {en} = await import("./locales/en.js");
const {es} = await import("./locales/es.js");

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
        this.sent = [];
        sockets.push(this);
    }
    send(data) {
        this.sent.push(data);
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
                    {src_yuno: "cc", src_role: "controlcenter", src_service: "controlcenter"}
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

beforeAll(async () => {
    await i18next.init({lng: "es", keySeparator: false, nsSeparator: false, resources: {en, es}});
    vi.stubGlobal("fetch", fake_fetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback(log_sink);
    register_c_timer();
    register_c_ievent_cli();
    register_c_agent_config();
    register_c_agent_link();
    register_c_agent_login();
    register_c_monitor_link();
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
    login_screens.length = 0;
    answers = {
        refresh: {status: 200, data: {success: true, username: "u", expires_in: 300}},
        logout:  {status: 200, data: {success: true}},
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

async function app_in_session()
{
    const app = gobj_create_service("app", "C_APP", {}, yuno);
    const link = gobj_find_service("agent_link", true);
    const monitor = gobj_find_service("monitor_link", true);
    built.push(app, link, monitor);
    gobj_start(app);
    await pass_time(10);
    /*  The app arms the developer window's log sink: take the log back.  */
    set_log_callback(log_sink);
    logged.length = 0;
    return {app, link, monitor, login: gobj_find_service("agent_login", true)};
}

describe("the control center refuses the identity", () => {

    test("once: a silent refresh, and the link reopens", async () => {
        const {link, login} = await app_in_session();
        expect(sockets.length).toBe(1);
        sockets[0].open();
        await pass_time(10);
        asked.length = 0;

        sockets[0].ack(-1, "token expired");
        await pass_time(10);
        expect(asked).toEqual(["refresh"]);
        expect(gobj_current_state(login)).toBe("ST_LOGIN");
        expect(gobj_is_running(link)).toBe(true);
        expect(sockets.length).toBe(2);
        expect(login_screens).toEqual([]);
        expect(defects()).toEqual([]);
    });

    test("twice: the session ends on the next turn, and no socket is opened after it", async () => {
        const {link, login} = await app_in_session();
        sockets[0].open();
        await pass_time(10);
        sockets[0].ack(-1, "token expired");
        await pass_time(10);
        sockets[1].open();
        await pass_time(10);
        asked.length = 0;

        sockets[1].ack(-1, "Authentication required");
        expect(login_screens).toEqual([]);
        await pass_time(10);
        expect(asked).toEqual(["logout"]);
        expect(gobj_current_state(login)).toBe("ST_LOGOUT");
        expect(gobj_is_running(link)).toBe(false);
        expect(login_screens.length).toBe(1);
        expect(login_screens[0].error()).toBe(`${es.translation["login failed"]}: ` +
            `${es.translation["authentication required"]}`);

        const opened = sockets.length;
        await pass_time(5 * 60 * 1000);
        expect(sockets.length).toBe(opened);
        expect(defects()).toEqual([]);
    });
});

describe("an agent refuses the identity of the monitor's link", () => {

    /*  The session is up, and so is the transport the Monitor opened.  */
    async function linked()
    {
        const {monitor, login} = await app_in_session();
        gobj_send_event(monitor, "EV_CONNECT", {url: "wss://node-a.example:1993"}, monitor);
        await pass_time(10);
        expect(gobj_current_state(monitor)).toBe("ST_LINKED");
        const socket = sockets[sockets.length - 1];
        expect(socket.url).toBe("wss://node-a.example:1993");
        socket.open();
        await pass_time(10);
        return {monitor, login, socket};
    }

    test("once: the token is renewed, and the transport retries with it by itself", async () => {
        const {monitor, socket} = await linked();
        asked.length = 0;
        const opened = sockets.length;

        socket.ack(-1, "token expired");
        await pass_time(10);
        expect(asked).toEqual(["token"]);
        expect(gobj_current_state(monitor)).toBe("ST_LINKED");

        await pass_time(60 * 1000);
        expect(sockets.length).toBeGreaterThan(opened);
        expect(defects()).toEqual([]);
    });

    test("twice: it gives up, and a cookie refresh before the drop lands nowhere", async () => {
        const {monitor, login, socket} = await linked();
        socket.ack(-1, "token expired");
        await pass_time(60 * 1000);
        const retry = sockets[sockets.length - 1];
        expect(retry).not.toBe(socket);
        retry.open();
        await pass_time(10);
        asked.length = 0;

        retry.ack(-1, "no authz");
        expect(gobj_current_state(monitor)).toBe("ST_IDLE");
        gobj_publish_event(login, "EV_LOGIN_REFRESHED", {username: "u"});
        expect(asked).toEqual([]);
        expect(defects()).toEqual([]);

        await pass_time(10);
        expect(gobj_read_attr(monitor, "iev")).toBe(null);
        const opened = sockets.length;
        await pass_time(5 * 60 * 1000);
        expect(sockets.length).toBe(opened);
        expect(defects()).toEqual([]);
    });
});
