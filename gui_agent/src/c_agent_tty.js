/***********************************************************************
 *          c_agent_tty.js
 *
 *      C_AGENT_TTY — an interactive SSH-style terminal to a node, a
 *      routed stage view PINNED to a single node (the `node` attr, set
 *      by the Terminal workspace tab at /terminal/node/<id>). The node
 *      picker (C_NODES, all versions) chooses which nodes get a tab; the
 *      empty-state route /terminal/node carries node="".
 *
 *      Transport (all over the shared C_AGENT_LINK, no new connection —
 *      the PTY is served by BOTH yuno_agent and yuno_agent22, so any
 *      agent version answers):
 *          - OPEN : command-agent agent_id=<node>
 *                   cmd2agent="open-console name=<c> cx=<cols> cy=<rows>"
 *                   -> the node's agent forks a C_PTY (bash).
 *          - OUTPUT: EV_TTY_DATA {data:{name, content64}} (raw PTY bytes,
 *                    base64) re-published by the link -> xterm.write().
 *          - INPUT : write-tty {agent_id:<node>, name:<c>, content64}
 *                    (keystrokes, base64).
 *          - CLOSE : command-agent cmd2agent="close-console name=<c>".
 *
 *      EV_TTY_DATA carries only the console `name`, not the node, and the
 *      one shared link delivers every tab's stream — so each tab owns a
 *      GLOBALLY UNIQUE console name and filters EV_TTY_* by it. The
 *      OPEN/CLOSE command-agent calls are tagged console_purpose="tty" so
 *      the Commands/Statistics panels ignore their dispatch acks.
 *
 *      Resize: the PTY geometry is fixed at open time (the agent exposes
 *      cx/cy at open-console but has no runtime TIOCSWINSZ/SIGWINCH path),
 *      so we fit xterm once before opening and keep that geometry for the
 *      session; a reconnect opens a FRESH console at the current size.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr, gobj_write_str_attr,
    gobj_subscribe_event,
    gobj_find_service,
    createElement2,
    refresh_language,
    msg_iev_write_key,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {current_theme} from "./theme.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TTY";

/*  xterm palettes, one per theme (kept Intl-free like the rest of the
 *  app). Set at create; a live theme toggle is not propagated to an open
 *  terminal (v1). */
const TERM_THEME_DARK  = {background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#d4d4d4"};
const TERM_THEME_LIGHT = {background: "#ffffff", foreground: "#1e1e1e", cursor: "#1e1e1e"};


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,       "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",        0,  "terminal", "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "node",         0,  "",         "Pinned node id (host/uuid); '' = empty state"),
SDATA(data_type_t.DTP_STRING,   "console_name", 0,  "",         "Current unique PTY console name (session key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",   0,  null,       "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",     0,  null,       "C_AGENT_LINK service"),
SDATA_END()
];

let PRIVATE_DATA = {};
let __gclass__ = null;




                    /******************************
                     *      Framework Methods
                     ******************************/




/***************************************************************
 *          Framework Method: Create
 ***************************************************************/
function mt_create(gobj)
{
    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    let link = gobj_find_service("agent_link", true);
    gobj_write_attr(gobj, "link_svc", link);
    if(link) {
        gobj_subscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(link, "EV_TTY_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_TTY_DATA", {}, gobj);
        gobj_subscribe_event(link, "EV_TTY_CLOSE", {}, gobj);
    }

    let $c = createElement2(
        ["div", {class: "view-card C_AGENT_TTY", style: "display:flex; flex-direction:column; height:100%;"}, []]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    build_dom(gobj);

    /*  Defer the xterm fit+open until the stage is laid out and visible
     *  (a fit against a zero-size container yields 0 cols/rows). */
    gobj.priv.boot = setTimeout(() => {
        gobj.priv.boot = null;
        create_terminal(gobj);
        open_console(gobj);
    }, 0);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    if(priv.boot) {
        clearTimeout(priv.boot);
        priv.boot = null;
    }
    /*  Best-effort: tell the node to close the PTY (frees the bash). */
    close_console(gobj);
    if(priv.term) {
        priv.term.dispose();
        priv.term = null;
    }
    priv.fit = null;
    gobj_write_str_attr(gobj, "console_name", "");
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    let $c = gobj_read_attr(gobj, "$container");
    if($c && $c.parentNode) {
        $c.parentNode.removeChild($c);
    }
    gobj_write_attr(gobj, "$container", null);
}




                    /***************************
                     *      Local Methods
                     ***************************/




function clear_node($n)
{
    while($n && $n.firstChild) {
        $n.removeChild($n.firstChild);
    }
}

/***************************************************************
 *  base64 (raw PTY bytes) -> Uint8Array for xterm.write().
 ***************************************************************/
function base64_to_bytes(b64)
{
    let bin = atob(b64 || "");
    let bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

/***************************************************************
 *  Keystroke string (UTF-8) -> base64 for write-tty.
 ***************************************************************/
function utf8_to_base64(str)
{
    let bytes = new TextEncoder().encode(str);
    let bin = "";
    for(let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

/***************************************************************
 *  A globally-unique console name for this tab's session. The node
 *  id can carry dots (hostname), which are unsafe as a gobj service
 *  name, so sanitize; a random suffix guarantees uniqueness across
 *  tabs and reconnects (no collision with a stale PTY of the same
 *  name on the node).
 ***************************************************************/
function new_console_name(node)
{
    let sani = String(node || "node").replace(/[^A-Za-z0-9_-]/g, "_");
    return `tty_${sani}_${Math.random().toString(36).slice(2, 8)}`;
}

/***************************************************************
 *  Build the static shell: a one-line toolbar (node + reconnect) and
 *  the xterm host.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    let node = gobj_read_attr(gobj, "node") || "";

    priv.$status = createElement2(["span", {class: "is-size-7 has-text-grey"}, ""]);

    priv.$reconnect = createElement2(
        ["button", {class: "button is-small", type: "button", style: "margin-left:auto;", i18n: "reconnect"},
            "Reconnect", {click: () => open_console(gobj)}]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            ["span", {class: "is-family-monospace is-size-7 has-text-weight-semibold"}, node || t("select a node")],
            priv.$status,
            priv.$reconnect
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  xterm host — fills the card; xterm paints its own background.  */
    priv.$term = createElement2(
        ["div", {class: "TTY_HOST", style: "flex:1; min-height:0; overflow:hidden;"}, []]
    );
    $c.appendChild(priv.$term);

    refresh_language($c, t);
}

/***************************************************************
 *  Create the xterm instance + fit addon, mount it in the host.
 ***************************************************************/
function create_terminal(gobj)
{
    let priv = gobj.priv;
    if(priv.term) {
        return;
    }
    let theme = (current_theme() === "light") ? TERM_THEME_LIGHT : TERM_THEME_DARK;
    let term = new Terminal({
        cursorBlink:  true,
        convertEol:   false,
        fontFamily:   "monospace",
        fontSize:     13,
        scrollback:   5000,
        theme:        theme
    });
    let fit = new FitAddon();
    term.loadAddon(fit);
    term.open(priv.$term);
    try {
        fit.fit();
    } catch(e) {
        /*  container not sized yet — keep xterm's default geometry  */
    }
    /*  Keystrokes -> node PTY.  */
    term.onData((d) => send_keys(gobj, d));
    priv.term = term;
    priv.fit = fit;
}

/***************************************************************
 *  Reflect a short status line under the toolbar.
 ***************************************************************/
function set_status(gobj, key, text)
{
    let priv = gobj.priv;
    if(!priv.$status) {
        return;
    }
    clear_node(priv.$status);
    priv.$status.appendChild(createElement2(["span", {i18n: key}, text]));
    refresh_language(priv.$status, t);
}

/***************************************************************
 *  Open a fresh PTY on the pinned node, sized to the current xterm
 *  geometry. Generates a new unique console name (the session key)
 *  and routes open-console through command-agent (the control center
 *  has no open-console of its own).
 ***************************************************************/
function open_console(gobj)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    if(!node) {
        set_status(gobj, "select a node", "Select a node");
        return;
    }
    if(!link || !agent_link_is_connected(link)) {
        set_status(gobj, "disconnected", "Disconnected");
        return;
    }

    /*  Re-fit now so cx/cy match what the user sees, then freeze it for
     *  the session (no runtime resize path on the agent side).  */
    let cols = 80;
    let rows = 24;
    if(priv.fit && priv.term) {
        try {
            priv.fit.fit();
        } catch(e) {
            /*  keep defaults  */
        }
        cols = priv.term.cols || cols;
        rows = priv.term.rows || rows;
    }

    let name = new_console_name(node);
    gobj_write_str_attr(gobj, "console_name", name);

    let kw = {agent_id: node, cmd2agent: `open-console name=${name} cx=${cols} cy=${rows}`};
    msg_iev_write_key(kw, "console_purpose", "tty");
    agent_link_command(link, "command-agent", kw);
    set_status(gobj, "connecting", "Connecting…");
}

/***************************************************************
 *  Close the current PTY on the node (best-effort).
 ***************************************************************/
function close_console(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    let name = gobj_read_attr(gobj, "console_name") || "";
    if(!node || !name || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw = {agent_id: node, cmd2agent: `close-console name=${name}`};
    msg_iev_write_key(kw, "console_purpose", "tty");
    agent_link_command(link, "command-agent", kw);
}

/***************************************************************
 *  Send keystrokes to the node's PTY (base64).
 *
 *  Routed through command-agent (NOT the control center's own
 *  write-tty command): command-agent matches the node by UUID OR
 *  hostname and forwards the whole kw to the agent's write-tty
 *  (which reads name + content64). The control center's direct
 *  write-tty matches only the UUID and, on no match, DROPS the
 *  requester's socket — so sending write-tty with a hostname
 *  agent_id would kill the link on every keystroke. Same path as
 *  open-console/close-console. Tagged console_purpose="tty" so the
 *  Commands console ignores the dispatch ack.
 ***************************************************************/
function send_keys(gobj, data)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    let name = gobj_read_attr(gobj, "console_name") || "";
    if(!data || !node || !name || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw = {agent_id: node, cmd2agent: "write-tty", name: name, content64: utf8_to_base64(data)};
    msg_iev_write_key(kw, "console_purpose", "tty");
    agent_link_command(link, "command-agent", kw);
}

/***************************************************************
 *  Is this EV_TTY_* answer for OUR console? (the one shared link
 *  delivers every tab's stream, discriminated by console name).
 ***************************************************************/
function is_my_console(gobj, kw)
{
    let data = kw && kw.data;
    let name = data && data.name;
    let mine = gobj_read_attr(gobj, "console_name") || "";
    return !!(mine && name && name === mine);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Link in session — (re)open a console if none is live.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    open_console(gobj);
    return 0;
}

/***************************************************************
 *  Link dropped — the node-side PTY route is gone; mark it.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    gobj_write_str_attr(gobj, "console_name", "");
    set_status(gobj, "disconnected", "Disconnected");
    if(gobj.priv.term) {
        gobj.priv.term.writeln("\r\n\x1b[90m[disconnected]\x1b[0m");
    }
    return 0;
}

/***************************************************************
 *  Our PTY opened on the node.
 ***************************************************************/
function ac_tty_open(gobj, event, kw, src)
{
    if(!is_my_console(gobj, kw)) {
        return 0;
    }
    set_status(gobj, "connected", "Connected");
    if(gobj.priv.term) {
        gobj.priv.term.focus();
    }
    return 0;
}

/***************************************************************
 *  PTY output bytes -> xterm.
 ***************************************************************/
function ac_tty_data(gobj, event, kw, src)
{
    if(!is_my_console(gobj, kw)) {
        return 0;
    }
    let content64 = kw.data && kw.data.content64;
    if(gobj.priv.term && content64) {
        gobj.priv.term.write(base64_to_bytes(content64));
    }
    return 0;
}

/***************************************************************
 *  PTY closed on the node (the shell exited).
 ***************************************************************/
function ac_tty_close(gobj, event, kw, src)
{
    if(!is_my_console(gobj, kw)) {
        return 0;
    }
    gobj_write_str_attr(gobj, "console_name", "");
    set_status(gobj, "closed", "Closed");
    if(gobj.priv.term) {
        gobj.priv.term.writeln("\r\n\x1b[90m[console closed]\x1b[0m");
    }
    return 0;
}




                    /***************************
                     *              FSM
                     ***************************/




/*---------------------------------------------*
 *          Global methods table
 *---------------------------------------------*/
const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy
};

/***************************************************************
 *          Create the GClass
 ***************************************************************/
function create_gclass(gclass_name)
{
    if(__gclass__) {
        log_error(`GClass ALREADY created: ${gclass_name}`);
        return -1;
    }

    /*---------------------------------------------*
     *          States
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",   ac_on_open,   null],
            ["EV_ON_CLOSE",  ac_on_close,  null],
            ["EV_TTY_OPEN",  ac_tty_open,  null],
            ["EV_TTY_DATA",  ac_tty_data,  null],
            ["EV_TTY_CLOSE", ac_tty_close, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",   0],
        ["EV_ON_CLOSE",  0],
        ["EV_TTY_OPEN",  0],
        ["EV_TTY_DATA",  0],
        ["EV_TTY_CLOSE", 0]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,  // lmt
        attrs_table,
        PRIVATE_DATA,
        0,  // authz_table
        0,  // command_table
        0,  // s_user_trace_level
        0   // gclass_flag
    );

    if(!__gclass__) {
        return -1;
    }

    return 0;
}

/***************************************************************
 *          Register GClass
 ***************************************************************/
function register_c_agent_tty()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_tty};
