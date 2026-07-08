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
 *      GLOBALLY UNIQUE console name and filters EV_TTY_* by it. The name
 *      is STABLE per tab+node (per-tab sessionStorage id, see
 *      console_name_for): a page refresh re-opens the SAME console and
 *      the agent (> 7.7.1) re-attaches to the live PTY — the shell
 *      survives F5 — instead of leaking a new PTY per refresh until
 *      max_consoles. Against an older agent the open answers "Console
 *      already open" and the tab falls back to per-open random names.
 *      OPEN/CLOSE command-agent calls are tagged console_purpose="tty" so
 *      the Commands/Statistics panels ignore their dispatch acks.
 *
 *      Resize is CLIENT-ONLY: the node PTY geometry is frozen at open
 *      (cx/cy passed to open-console; the agent has no runtime resize
 *      path — same contract as a native terminal running ycommand). The
 *      xterm refits LOCALLY on every host resize (devtools, window,
 *      soft keyboard, rotation — see install_resize_refit) so the
 *      input line stays reachable.
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
    msg_iev_get_stack,
    msg_iev_write_key,
    msg_iev_read_key,
    kw_get_str,
    kw_get_local_storage_value,
    kw_set_local_storage_value,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {SerializeAddon} from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {agent_config_remove_selected_node} from "./c_agent_config.js";
import {current_theme} from "./theme.js";
import {install_touch_scroll} from "./tty_touch_scroll.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TTY";

/*  xterm palettes, one per theme (kept Intl-free like the rest of the
 *  app). Set at create; a live theme toggle is not propagated to an open
 *  terminal (v1). */
const TERM_THEME_DARK  = {background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#d4d4d4"};
const TERM_THEME_LIGHT = {background: "#ffffff", foreground: "#1e1e1e", cursor: "#1e1e1e"};

/*  xterm font size. The DEFAULT is a browser-persisted preference set in
 *  Settings → Preferences and used by every Terminal tab when it (re)opens.
 *  The toolbar A− / A+ buttons only nudge THIS tab's live size (priv.font_size)
 *  and are NOT persisted, so reopening the tab falls back to the default.  */
const FONT_SIZE_DEFAULT = 19;
const FONT_SIZE_MIN     = 8;
const FONT_SIZE_MAX     = 28;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,       "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",        0,  "terminal", "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",    0,  "terminal", "Owning workspace (for self-close deselection)"),
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
        /*  Surface open-console / write-tty command FAILURES (e.g. the user
         *  lacks the open-console authz) instead of hanging on "Connecting…". */
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
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
    watch_activation(gobj);

    /*  Defer the xterm fit+open until the stage is laid out and visible
     *  (a fit against a zero-size container yields 0 cols/rows). */
    gobj.priv.boot = setTimeout(() => {
        gobj.priv.boot = null;
        create_terminal(gobj);
        open_console(gobj);
    }, 0);

    /*  Persist the screen when the page goes away (refresh/close);
     *  restored on the re-attach's EV_TTY_OPEN (see restore_screen).
     *  BOTH events: beforeunload fires earliest (desktop refresh, before
     *  any ws/gobj teardown can touch the term); pagehide covers mobile,
     *  where beforeunload often doesn't fire (bfcache). Saving twice is
     *  an idempotent overwrite.  */
    gobj.priv.unload_save = () => {
        save_screen(gobj);
    };
    window.addEventListener("beforeunload", gobj.priv.unload_save);
    window.addEventListener("pagehide", gobj.priv.unload_save);
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
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
    }
    if(priv.resize_obs) {
        priv.resize_obs.disconnect();
        priv.resize_obs = null;
    }
    if(priv.unload_save) {
        window.removeEventListener("beforeunload", priv.unload_save);
        window.removeEventListener("pagehide", priv.unload_save);
        priv.unload_save = null;
    }
    /*  Best-effort: tell the node to close the PTY (frees the bash). */
    close_console(gobj);
    if(priv.touch_teardown) {
        priv.touch_teardown();
        priv.touch_teardown = null;
    }
    if(priv.term) {
        priv.term.dispose();
        priv.term = null;
    }
    priv.fit = null;
    priv.serializer = null;
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
 *  A STABLE, globally-unique console name for this tab+node. The
 *  node id can carry dots (hostname), which are unsafe as a gobj
 *  service name, so sanitize. The suffix is a per-tab id persisted
 *  in sessionStorage: a page refresh re-opens the SAME console and
 *  the agent re-attaches to the live PTY (the shell survives F5)
 *  instead of forking a new bash per refresh until max_consoles.
 *  sessionStorage is per-tab, so the name still discriminates
 *  tabs/browsers/users on the shared link. (Browser "duplicate tab"
 *  copies sessionStorage — two twin tabs on the SAME node would
 *  share the console; accepted quirk.)
 ***************************************************************/
function console_name_for(node)
{
    let sani = String(node || "node").replace(/[^A-Za-z0-9_-]/g, "_");
    let client_id = "";
    try {
        client_id = sessionStorage.getItem("tty_client_id") || "";
        if(!client_id) {
            client_id = Math.random().toString(36).slice(2, 8);
            sessionStorage.setItem("tty_client_id", client_id);
        }
    } catch(e) {
        client_id = Math.random().toString(36).slice(2, 8);
    }
    return `tty_${sani}_${client_id}`;
}

/***************************************************************
 *  Screen persistence across a page refresh (sessionStorage,
 *  keyed by node). On F5 the agent RE-ATTACHES to the live PTY,
 *  which repaints nothing — the prompt was printed to the previous
 *  page — so the tab saves its own last screen at pagehide and
 *  writes it back on EV_TTY_OPEN (the saved blob is xterm-serialize
 *  output: clean escape sequences, safe to replay into a fresh term).
 ***************************************************************/
function screen_key(node)
{
    let sani = String(node || "node").replace(/[^A-Za-z0-9_-]/g, "_");
    return `tty_screen_${sani}`;
}

function save_screen(gobj)
{
    let priv = gobj.priv;
    let node = gobj_read_attr(gobj, "node") || "";
    /*  Don't require console_name: if the ws onclose managed to run
     *  during the unload (before this handler), ac_on_close already
     *  cleared it — the screen is still worth saving.  */
    if(!node || !priv.term || !priv.serializer) {
        return;
    }
    try {
        sessionStorage.setItem(
            screen_key(node),
            priv.serializer.serialize({scrollback: 200})
        );
    } catch(e) {
        /*  storage quota — lose the screen, not the session  */
    }
}

function restore_screen(gobj)
{
    let node = gobj_read_attr(gobj, "node") || "";
    let saved = "";
    try {
        saved = sessionStorage.getItem(screen_key(node)) || "";
        if(saved) {
            /*  one-shot: a later EV_TTY_OPEN on this page (Reconnect)
             *  must not repaint an old screen over the live one  */
            sessionStorage.removeItem(screen_key(node));
        }
    } catch(e) {
        return;
    }
    if(saved && gobj.priv.term) {
        /*  reset first: coming back from bfcache the term still holds the
         *  live screen and a bare write would paint the dump on top of it  */
        gobj.priv.term.reset();
        gobj.priv.term.write(saved);
    }
}

/***************************************************************
 *  Mobile soft-key accessory bar. A phone's on-screen keyboard has no
 *  Esc / Tab / Ctrl / arrow / Home-End keys, so a shell can't complete
 *  (Tab), walk history (↑ ↓), edit the line (← →) or interrupt (^C).
 *  These buttons inject the exact byte sequences those keys emit; on
 *  desktop the bar is hidden (physical keys already produce them, see
 *  onData). `"__ctrl__"` is the sticky modifier (see set_ctrl_armed):
 *  arm it, then the next key — from this bar OR the soft keyboard —
 *  is sent as its control character. `"__kb__"` toggles the browser
 *  soft keyboard, which is OFF by default (see set_soft_keyboard):
 *  tapping the terminal focuses it but does NOT summon the keyboard,
 *  so the whole screen stays for output; press Kbd to type.
 *  `"__paste__"` reads the clipboard into the PTY (see
 *  paste_clipboard) — the native long-press menu is suppressed, this
 *  key is the mobile paste path.
 ***************************************************************/
const KEYBAR_ROWS = [
    [
        ["^C",      "\x03"],
        ["|",       "|"],
        ["/",       "/"],
        ["-",       "-"],
        ["_",       "_"],
        ["Home",    "\x1b[H"],
        ["End",     "\x1b[F"],
        ["Paste",   "__paste__"]
    ],
    [
        ["Kbd",     "__kb__"],
        ["Esc",     "\x1b"],
        ["Tab",     "\t"],
        ["Ctrl",    "__ctrl__"],
        ["←",  "\x1b[D"],
        ["↑",  "\x1b[A"],
        ["↓",  "\x1b[B"],
        ["→",  "\x1b[C"],
        ["↵",  "\r"]
    ]
];

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

    /*  Font size A− / A+ (icon-only; a title carries the meaning on mobile).  */
    priv.$font_dec = createElement2(
        ["button", {class: "button is-small", type: "button", style: "margin-left:auto;",
                    title: t("font smaller"), "aria-label": t("font smaller")},
            ["span", {class: "icon is-small"}, [["i", {class: "yi-magnifying-glass-minus"}]]],
            {click: () => change_font_size(gobj, -1)}]
    );
    priv.$font_inc = createElement2(
        ["button", {class: "button is-small", type: "button",
                    title: t("font larger"), "aria-label": t("font larger")},
            ["span", {class: "icon is-small"}, [["i", {class: "yi-magnifying-glass-plus"}]]],
            {click: () => change_font_size(gobj, +1)}]
    );

    /*  Reconnect: icon + label; the label is hidden on mobile so the button
     *  stays legible (icon-only) on a narrow toolbar.  */
    priv.$reconnect = createElement2(
        ["button", {class: "button is-small", type: "button",
                    title: t("reconnect"), "aria-label": t("reconnect")},
            [
                ["span", {class: "icon is-small"}, [["i", {class: "yi-arrows-rotate"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "reconnect"}, "Reconnect"]
            ],
            {click: () => open_console(gobj)}]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            ["span", {class: "is-family-monospace is-size-7 has-text-weight-semibold"}, node || t("select a node")],
            priv.$status,
            priv.$font_dec,
            priv.$font_inc,
            priv.$reconnect
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  Mobile-only soft-key accessory bar (hidden on desktop), on TOP of
     *  the xterm so it sits at a fixed height under the toolbar instead of
     *  riding the keyboard-driven reflows at the card bottom.  */
    $c.appendChild(build_keybar(gobj));

    /*  xterm host — fills the card; xterm paints its own background.  */
    priv.$term = createElement2(
        ["div", {class: "TTY_HOST",
                 style: "flex:1; min-height:0; overflow:hidden; overscroll-behavior:contain;"}, []]
    );
    $c.appendChild(priv.$term);

    refresh_language($c, t);
}

/***************************************************************
 *  Build the two-row mobile key bar (see KEYBAR_ROWS). Each button
 *  emits on `pointerdown` and preventDefaults it, so the xterm keeps
 *  focus and the soft keyboard stays open. Hidden on tablet+ via
 *  `is-hidden-tablet`; the inline `display:flex` only takes effect on
 *  mobile where that utility does not apply.
 ***************************************************************/
function build_keybar(gobj)
{
    let priv = gobj.priv;

    let rows = KEYBAR_ROWS.map(function(row) {
        let btns = row.map(function(pair) {
            let label = pair[0];
            let seq = pair[1];
            if(seq === "__paste__") {
                label = t("paste");
            }
            /*  Enter is the most-used key: double flex share.  */
            let grow = (seq === "\r") ? 2 : 1;
            /*  Arrow/Enter glyphs are unreadable at Bulma's is-small size:
             *  bump them (line-height 1 keeps the button height uniform).  */
            let glyph = /^[←↑↓→↵]$/.test(label) ? "font-size:1.15rem; line-height:1; " : "";
            /*  Enter is THE key: scale the GLYPH only — transform is purely
             *  visual (no layout), so the button/row height doesn't grow.  */
            let content = (seq === "\r")
                ? [["span", {style: "display:inline-block; transform:scale(1.5);"}, label]]
                : label;
            let $b = createElement2(
                ["button", {
                    class: "button is-small is-family-monospace TTY_KEY",
                    type: "button", tabindex: "-1",
                    style: `flex:${grow} 1 0; min-width:2.1rem; padding-left:0.3rem; ` +
                           "padding-right:0.3rem; " + glyph,
                    "aria-label": label
                }, content]
            );
            $b.addEventListener("pointerdown", function(e) {
                e.preventDefault();          /*  keep xterm focused / keyboard open  */
                if(seq === "__ctrl__") {
                    set_ctrl_armed(gobj, !priv.ctrl_armed);
                    return;
                }
                if(seq === "__kb__") {
                    set_soft_keyboard(gobj, !priv.kb_on, true);
                    return;
                }
                if(seq === "__paste__") {
                    paste_clipboard(gobj, $b);
                    return;
                }
                tty_input(gobj, seq, true);
            });
            if(seq === "__ctrl__") {
                priv.$ctrl = $b;
            }
            if(seq === "__kb__") {
                priv.$kb = $b;
            }
            return $b;
        });
        return createElement2(["div", {class: "is-flex", style: "gap:0.25rem;"}, btns]);
    });

    priv.$keybar = createElement2(
        ["div", {class: "TTY_KEYBAR is-hidden-tablet",
                 style: "flex:0 0 auto; display:flex; flex-direction:column; " +
                        "gap:0.25rem; margin-bottom:0.4rem;"}, rows]
    );
    return priv.$keybar;
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
    /*  Seed this tab's live size from the persisted default (Settings). The
     *  A− / A+ buttons mutate priv.font_size only; a fresh view (reopened tab)
     *  starts from the default again. */
    priv.font_size = get_font_size();
    let term = new Terminal({
        cursorBlink:  true,
        convertEol:   false,
        fontFamily:   "monospace",
        fontSize:     priv.font_size,
        scrollback:   5000,
        theme:        theme
    });
    let fit = new FitAddon();
    term.loadAddon(fit);
    let serializer = new SerializeAddon();
    term.loadAddon(serializer);
    term.open(priv.$term);
    try {
        fit.fit();
    } catch(e) {
        /*  container not sized yet — keep xterm's default geometry  */
    }
    /*  Keystrokes -> node PTY (through the sticky-Ctrl gate).  */
    term.onData((d) => tty_input(gobj, d, false));
    priv.term = term;
    priv.fit = fit;
    priv.serializer = serializer;

    /*  Touch scrolling (xterm has none of its own) + native long-press
     *  menu suppression. Desktop is unaffected (touch events never fire). */
    priv.touch_teardown = install_touch_scroll(term, priv.$term);

    /*  Mobile (key bar visible): the browser soft keyboard is OPT-IN —
     *  start suppressed; the Kbd bar key summons it (see set_soft_keyboard). */
    if(!keybar_hidden(priv)) {
        set_soft_keyboard(gobj, false, false);
    } else {
        priv.kb_on = true;
    }

    /*  Keep the terminal filling its host across viewport changes.  */
    install_resize_refit(gobj);
}

/***************************************************************
 *  Is the mobile key bar hidden (desktop/tablet ≥ Bulma tablet
 *  breakpoint)? Computed style, so an is-hidden ancestor (inactive
 *  keep_alive tab) doesn't fake a "hidden" answer.
 ***************************************************************/
function keybar_hidden(priv)
{
    if(!priv.$keybar) {
        return true;
    }
    return getComputedStyle(priv.$keybar).display === "none";
}

/***************************************************************
 *  Enable/suppress the browser soft keyboard. xterm types through a
 *  hidden textarea; inputmode="none" tells the browser NOT to summon
 *  the virtual keyboard on focus (physical keyboards are unaffected),
 *  so on mobile the whole screen stays for terminal output until the
 *  user asks to type. `refocus` (the Kbd key) blurs+refocuses so the
 *  browser re-reads inputmode and shows/hides the keyboard right away;
 *  silent state syncs (init, rotation) skip it. The Kbd bar key
 *  reflects the state like the sticky Ctrl.
 ***************************************************************/
function set_soft_keyboard(gobj, on, refocus)
{
    let priv = gobj.priv;
    priv.kb_on = !!on;
    let ta = priv.term && priv.term.textarea;
    if(ta) {
        ta.inputMode = priv.kb_on ? "text" : "none";
        if(refocus) {
            ta.blur();
            ta.focus();
        }
    }
    if(priv.$kb) {
        priv.$kb.classList.toggle("is-info", priv.kb_on);
        priv.$kb.classList.toggle("is-selected", priv.kb_on);
    }
}

/***************************************************************
 *  Refit the xterm to its host whenever the host resizes: desktop window
 *  or devtools resize, the Android soft keyboard (opening/closing shrinks
 *  the layout viewport via interactive-widget=resizes-content), rotation,
 *  split-screen. Without this the xterm stays frozen at its open-time
 *  geometry with overflow:hidden — the bottom rows (the prompt) get
 *  clipped out of view and xterm's own scroll can't reach them (it moves
 *  the buffer, not the DOM). Debounced to one fit per frame; skipped
 *  while the tab is hidden (a fit against a zero-size box yields
 *  0 cols/rows). CLIENT-ONLY: the node PTY geometry stays frozen at open
 *  (no resize command on the agent side), only the LOCAL display reflows.
 *  If the viewport was following the bottom (the normal shell case),
 *  keep it pinned to the prompt after the refit; a user scrolled up
 *  reading history is left where they were.
 ***************************************************************/
function install_resize_refit(gobj)
{
    let priv = gobj.priv;
    if(typeof ResizeObserver === "undefined" || !priv.$term) {
        return;
    }
    let pending = false;
    priv.resize_obs = new ResizeObserver(function() {
        if(pending) {
            return;
        }
        pending = true;
        requestAnimationFrame(function() {
            pending = false;
            if(!priv.fit || !priv.term) {
                return;
            }
            if(priv.$term.clientHeight <= 0 || priv.$term.clientWidth <= 0) {
                return;                     /*  hidden/detached — don't fit to 0  */
            }
            let buf = priv.term.buffer.active;
            let at_bottom = (buf.viewportY >= buf.baseY);
            try {
                priv.fit.fit();
            } catch(e) {
                /*  transient zero-size — keep geometry  */
                return;
            }
            if(at_bottom) {
                priv.term.scrollToBottom();
            }
            /*  Escape hatch: a tablet rotated to landscape crosses the
             *  Bulma breakpoint and HIDES the key bar — the Kbd toggle
             *  goes with it, so never leave the keyboard suppressed
             *  with no way to bring it back.  */
            if(!priv.kb_on && keybar_hidden(priv)) {
                set_soft_keyboard(gobj, true, false);
            }
        });
    });
    priv.resize_obs.observe(priv.$term);
}

/***************************************************************
 *  Focus the xterm whenever this tab (re)becomes the visible one, so
 *  selecting a Terminal tab lets you type straight away. The shell reveals
 *  a keep_alive view by removing `is-hidden` from its $container (there is
 *  no activation hook), so watch that class flip. The first connect is
 *  already focused by ac_tty_open; this covers switching back to a tab.
 ***************************************************************/
function watch_activation(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c || typeof MutationObserver === "undefined") {
        return;
    }
    priv.vis_obs = new MutationObserver(function() {
        if(!$c.classList.contains("is-hidden") && priv.term) {
            priv.term.focus();
        }
    });
    priv.vis_obs.observe($c, {attributes: true, attributeFilter: ["class"]});
}

/***************************************************************
 *  The DEFAULT xterm font size — a browser-persisted preference (set in
 *  Settings). Clamped to [FONT_SIZE_MIN, FONT_SIZE_MAX]; falls back to
 *  FONT_SIZE_DEFAULT when unset or out of range. Every Terminal tab seeds
 *  its live size from this on (re)open.
 ***************************************************************/
function get_font_size()
{
    let v = parseInt(kw_get_local_storage_value("tty_font_size", FONT_SIZE_DEFAULT, true), 10);
    if(!(v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX)) {
        return FONT_SIZE_DEFAULT;
    }
    return v;
}

/***************************************************************
 *  Persist the DEFAULT font size (clamped). Driven from Settings →
 *  Preferences ONLY — the per-tab A− / A+ buttons do not call this, so a
 *  toolbar nudge never changes the default. Returns the stored value; a
 *  NaN/out-of-range input is clamped/ignored.
 ***************************************************************/
function set_font_size(size)
{
    let n = parseInt(size, 10);
    if(isNaN(n)) {
        return get_font_size();
    }
    if(n < FONT_SIZE_MIN) {
        n = FONT_SIZE_MIN;
    }
    if(n > FONT_SIZE_MAX) {
        n = FONT_SIZE_MAX;
    }
    kw_set_local_storage_value("tty_font_size", n);
    return n;
}

/***************************************************************
 *  A− / A+ toolbar buttons: nudge ONLY this tab's live font size
 *  (priv.font_size) and re-render + refit its xterm — a TEMPORARY,
 *  per-terminal change, never persisted, so reopening the tab returns to
 *  the default. A no-op at the clamp limits. The node PTY geometry is fixed
 *  at open, so the display just reflows locally.
 ***************************************************************/
function change_font_size(gobj, delta)
{
    let priv = gobj.priv;
    let cur = priv.font_size || get_font_size();
    let next = cur + delta;
    if(next < FONT_SIZE_MIN) {
        next = FONT_SIZE_MIN;
    }
    if(next > FONT_SIZE_MAX) {
        next = FONT_SIZE_MAX;
    }
    if(next === cur) {
        return;
    }
    priv.font_size = next;
    if(priv.term) {
        priv.term.options.fontSize = next;
        if(priv.fit) {
            try {
                priv.fit.fit();
            } catch(e) {
                /*  container not sized yet — keep geometry  */
            }
        }
    }
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
 *  Open (or RE-ATTACH to) the PTY on the pinned node, sized to the
 *  current xterm geometry. The console name is stable per tab+node
 *  (see console_name_for): if a PTY of that name is already live on
 *  the node — page refresh, link drop, Reconnect — the agent
 *  re-attaches to it instead of forking a new shell, so no close
 *  is needed (or wanted) before opening. Routed through
 *  command-agent (the control center has no open-console of its
 *  own).
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

    let name = console_name_for(node);
    if(priv.fresh_suffix) {
        /*  Old-agent fallback: unique name per open (see the
         *  "Console already open" answer in ac_mt_command_answer).  */
        name = `${name}_${Math.random().toString(36).slice(2, 6)}`;
    }

    /*  A previous console under a DIFFERENT name (old-agent fallback)
     *  would be orphaned on the node: close it. Same name = the agent
     *  re-attaches to the live PTY, no close wanted.  */
    let old_name = gobj_read_attr(gobj, "console_name") || "";
    if(old_name && old_name !== name) {
        close_console(gobj);
    }

    gobj_write_str_attr(gobj, "console_name", name);

    let kw = {agent_id: node, cmd2agent: `open-console name=${name} cx=${cols} cy=${rows}`};
    msg_iev_write_key(kw, "console_purpose", "tty");
    msg_iev_write_key(kw, "console_node", node);
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
    /*  Best-effort: tag with a purpose OTHER than "tty" so its ack (which
     *  may fail with result<0 when the PTY is already gone) is ignored by
     *  ac_mt_command_answer — otherwise a close done as part of a reconnect
     *  would clear the freshly-opened console_name and flash "Failed". The
     *  Commands console ignores any non-empty, non-"cache" purpose too.  */
    let kw = {agent_id: node, cmd2agent: `close-console name=${name}`};
    msg_iev_write_key(kw, "console_purpose", "tty_close");
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
    msg_iev_write_key(kw, "console_node", node);
    agent_link_command(link, "command-agent", kw);
}

/***************************************************************
 *  Single gate for every keystroke — xterm onData AND the mobile key
 *  bar. Applies the sticky-Ctrl modifier: when armed, a single soft-
 *  keyboard character becomes its control byte (Ctrl-C = \x03…), then
 *  the modifier disarms. Bar keys pass `from_bar=true` and carry their
 *  own literal sequence, so they only consume/clear the arm.
 ***************************************************************/
function tty_input(gobj, data, from_bar)
{
    let priv = gobj.priv;
    if(priv.ctrl_armed) {
        set_ctrl_armed(gobj, false);
        if(!from_bar) {
            let c = ctrl_char(data);
            if(c !== null) {
                data = c;
            }
        }
    }
    send_keys(gobj, data);
    if(priv.term) {
        priv.term.focus();
    }
}

/***************************************************************
 *  Paste key: read the clipboard (needs the user gesture + permission)
 *  and feed it to the PTY via term.paste() — bracketed-paste aware,
 *  same onData path as typing. On denial or an unsupported browser
 *  flash ✗ on the key.
 ***************************************************************/
function paste_clipboard(gobj, $b)
{
    let priv = gobj.priv;
    let fail = () => {
        if($b) {
            let old = $b.textContent;
            $b.textContent = "✗";
            setTimeout(() => {
                $b.textContent = old;
            }, 700);
        }
    };
    if(!navigator.clipboard || !navigator.clipboard.readText) {
        fail();
        return;
    }
    navigator.clipboard.readText().then((text) => {
        if(text && priv.term) {
            priv.term.paste(text);
            priv.term.focus();
        }
    }).catch(fail);
}

/***************************************************************
 *  Arm/disarm the sticky Ctrl modifier and reflect it on the button.
 ***************************************************************/
function set_ctrl_armed(gobj, on)
{
    let priv = gobj.priv;
    priv.ctrl_armed = !!on;
    if(priv.$ctrl) {
        priv.$ctrl.classList.toggle("is-info", priv.ctrl_armed);
        priv.$ctrl.classList.toggle("is-selected", priv.ctrl_armed);
    }
}

/***************************************************************
 *  Map a single character to its Ctrl-<char> control byte (a→\x01 …
 *  z→\x1a, @[\]^_ and space→\x00, ?→\x7f). Returns null when the char
 *  has no control mapping (then the raw char is sent unchanged).
 ***************************************************************/
function ctrl_char(s)
{
    if(typeof s !== "string" || s.length !== 1) {
        return null;
    }
    let code = s.charCodeAt(0);
    if(code >= 97 && code <= 122) {          /*  a-z  */
        code -= 96;
    } else if(code >= 64 && code <= 95) {    /*  @ A-Z [ \ ] ^ _  */
        code -= 64;
    } else if(code === 32) {                 /*  space -> NUL  */
        code = 0;
    } else if(code === 63) {                 /*  ? -> DEL  */
        code = 127;
    } else {
        return null;
    }
    return String.fromCharCode(code);
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
    restore_screen(gobj);
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
    /*  Close only the tab whose console name matches, so several Terminal
     *  tabs stay discriminated. An OLD agent (before the c_pty EV_TTY_CLOSE
     *  stray-brace fix, commit 00d31c5c8) publishes the close with a NULL kw
     *  — no name — so this won't fire and `exit` leaves the tab open; the fix
     *  for that is upgrading the agent, not a client-side guess. */
    if(!is_my_console(gobj, kw)) {
        return 0;
    }
    gobj_write_str_attr(gobj, "console_name", "");
    set_status(gobj, "closed", "Closed");
    if(gobj.priv.term) {
        gobj.priv.term.writeln("\r\n\x1b[90m[console closed]\x1b[0m");
    }
    /*
     *  A deliberate exit (the shell ended) closes the whole tab: deselect this
     *  node from its workspace, same as clicking the tab ✕. Deferred with a
     *  timer — deselecting now rebuilds the workspace tabs and would destroy
     *  THIS view from inside its own published-event callback.
     */
    let ws = gobj_read_attr(gobj, "workspace") || "terminal";
    let node = gobj_read_attr(gobj, "node") || "";
    setTimeout(() => {
        let config = gobj_find_service("agent_config", false);
        if(config && node) {
            agent_config_remove_selected_node(config, ws, node);
        }
    }, 0);
    return 0;
}

/***************************************************************
 *  Command answer for our own tty commands (open-console /
 *  write-tty / close-console, all tagged console_purpose="tty").
 *  Success is signalled by EV_TTY_OPEN, so here we only surface
 *  FAILURES — otherwise a failed open-console (e.g. the logged-in
 *  user lacks the privileged open-console authz) would leave the
 *  tab hanging on "Connecting…" forever. Filter by node so only the
 *  pinned tab reacts.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    if(msg_iev_read_key(kw, "console_purpose") !== "tty") {
        return 0;
    }
    let my_node = gobj_read_attr(gobj, "node") || "";
    let ans_node = msg_iev_read_key(kw, "console_node");
    if(my_node && ans_node && ans_node !== my_node) {
        return 0;
    }
    if(typeof kw.result === "number" && kw.result < 0) {
        let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
        let command = kw_get_str(gobj, stk, "command", "", 0);

        /*  A failed write-tty is TRANSIENT (per-keystroke): keep
         *  console_name so a later Reconnect/close still issues
         *  close-console (close_console needs the name — clearing it here
         *  orphaned the remote bash). A console that is genuinely gone is
         *  cleaned via the agent's EV_TTY_CLOSE, not here.  */
        if(command === "write-tty") {
            if(gobj.priv.term) {
                let comment = (kw.comment && String(kw.comment)) || t("write tty failed");
                gobj.priv.term.writeln("\r\n\x1b[31m" + comment + "\x1b[0m");
            }
            return 0;
        }

        /*  OLD agent compat (pre stable-name re-attach, yunetas <= 7.7.1):
         *  re-opening our stable name after a refresh answers -1 "Console
         *  already open", and that agent still routes the tty stream to the
         *  DEAD requester channel — re-attach is impossible. Fall back to
         *  per-open random names (the old behavior; PTYs leak on the node
         *  until its agent is upgraded).  */
        let comment_ = (kw.comment && String(kw.comment)) || "";
        if(command.indexOf("open-console") === 0
            && comment_.indexOf("Console already open") >= 0
            && !gobj.priv.fresh_suffix
        ) {
            gobj.priv.fresh_suffix = true;
            open_console(gobj);
            return 0;
        }

        /*  A failed open-console is fatal for the session.  */
        gobj_write_str_attr(gobj, "console_name", "");
        set_status(gobj, "failed", "Failed");
        if(gobj.priv.term) {
            let comment = (kw.comment && String(kw.comment)) || t("open console failed");
            gobj.priv.term.writeln("\r\n\x1b[31m" + comment + "\x1b[0m");
        }
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
            ["EV_TTY_CLOSE", ac_tty_close, null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null]
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
        ["EV_TTY_CLOSE", 0],
        ["EV_MT_COMMAND_ANSWER", 0]
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

export {
    register_c_agent_tty,
    get_font_size,
    set_font_size,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    FONT_SIZE_DEFAULT,
};
