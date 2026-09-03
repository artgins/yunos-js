/***********************************************************************
 *          c_agent_console.js
 *
 *      C_AGENT_CONSOLE — control-plane CLI to a yuneta agent, a routed
 *      stage view (mounted by C_YUI_SHELL at /commands/node/<id>).
 *
 *      The v2 successor of the old webix "Yuneta CLI": a command input
 *      with history + a response area. It does NOT own a transport —
 *      it uses the shared C_AGENT_LINK ("agent_link"), which owns the
 *      single C_IEVENT_CLI to the active agent. The console subscribes
 *      to the link's re-published events (EV_ON_OPEN/CLOSE/OPEN_ERROR/
 *      ID_NAK/MT_COMMAND_ANSWER) and sends commands with
 *      agent_link_command(). Connection state drives this panel's own
 *      status line; per-node liveness shows as a coloured glyph on the
 *      workspace tabs (C_APP), not a global toolbar dot.
 *
 *      Auth (jwt for OAuth2 agents) lands in the login service; until a
 *      user signs in, an OAuth2 agent answers the identity card with a
 *      NAK, which this view surfaces.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_find_service,
    createElement2,
    refresh_language,
    empty_string,
    msg_iev_get_stack,
    msg_iev_write_key,
    msg_iev_read_key,
    gobj_send_event,
    gobj_is_destroying,
    gobj_name,
    gobj_short_name,
    gobj_create_pure_child,
    gobj_create_service,
    gobj_start,
    gobj_is_running,
    gobj_stop_tree,
    gobj_destroy,
    set_timeout,
    clear_timeout,
    kw_get_str,
    kw_get_local_storage_value,
    kw_set_local_storage_value,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";

import {TabulatorFull as Tabulator} from "tabulator-tables";
import {yui_copy_text, yui_copy_table_json} from "@yuneta/gobj-ui/src/yui_clipboard.js";
import {
    yui_selection_column,
    yui_selection_settings,
    yui_selection_bar,
    yui_wire_selection,
    yui_clear_selection,
} from "@yuneta/gobj-ui/src/yui_table_select.js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    split_args,
    apply_shortkey,
    normalize_history,
} from "./agent_helpers.js";
import {
    agent_config_get_display_mode,
    agent_config_get_history,
    agent_config_set_history,
    agent_config_get_shortkeys,
    agent_config_set_shortkey,
    agent_config_remove_shortkey,
} from "./c_agent_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_CONSOLE";

const HISTORY_MAX = 30;

/*  CONSOLE_RESPONSE_TEXT font size (mirrors the Terminal's TTY_HOST control):
 *  the persisted value is the shared DEFAULT, driven from Settings only; the
 *  A− / A+ buttons in the status row nudge each console's LIVE size temporarily
 *  (priv.font_size), never persisted. Clamped to [MIN, MAX]; DEFAULT matches
 *  the historical hardcoded 12px.  */
const CONSOLE_FONT_SIZE_DEFAULT = 12;
const CONSOLE_FONT_SIZE_MIN     = 8;
const CONSOLE_FONT_SIZE_MAX     = 28;

/*  A few common agent commands seeded into the command completions, plus the
 *  local (client-side) shortkey-management commands so Tab-completion and the
 *  "?" popover surface them too.  */
const SEED_COMMANDS = [
    "help", "list-yunos", "stats", "list-binaries", "view-config",
    "shortkeys", "add-shortkey", "remove-shortkey"
];


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,        "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "console",   "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,        "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,        "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,        "C_AGENT_CONFIG service"),
SDATA(data_type_t.DTP_BOOLEAN,  "connected",   0,  false,       "True while in session with the agent"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",          "Agent id this panel targets (host/uuid); '' = empty state"),
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
    let priv = gobj.priv;
    priv.history = [];
    priv.got_nak = false;
    priv.$input = null;
    priv.$status = null;
    priv.$comment = null;
    priv.$data = null;
    priv.$hint = null;
    priv.$copy = null;         /*  copy-response button (right of the status line)  */
    priv.$copy_icon = null;
    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);
    priv.tabulator = null;    /*  Tabulator instance for table-mode answers  */
    priv.selection = null;    /*  the selection bar of that table  */
    priv.json_view = null;    /*  C_YUI_JSON instance for object/array answers  */
    priv.json_text = null;    /*  what the viewer shows, for the copy button  */
    priv.commands = {};       /*  name -> {name, params[], desc} from `help`  */
    priv.commands_loaded = false;
    priv.pending = false;     /*  a command is in flight → CONSOLE_RESPONSE shows
                                  the "running…" placeholder; cleared when the
                                  answer renders or the link drops.  */
    priv.tab_completed = false; /*  did EV_COMPLETE_COMMAND consume the Tab?
                                    read back by the keydown handler, which
                                    owes the browser a synchronous answer.  */
    priv.req_seq = 0;         /*  monotonic id of the latest user command; a
                                  command-agent answer echoes its seq in
                                  __md_iev__ so a late answer for a superseded
                                  command is dropped instead of overwriting the
                                  panel (rapid-command race).  */

    /*  Shell-style history recall (Up/Down): hist_idx walks priv.history
     *  (0 = most recent); -1 = editing the live line. hist_draft keeps the
     *  in-progress text so Down past the newest restores it. priv.history
     *  is DEDUPED: entries {cmd, count, last}, most-recently-used first.  */
    priv.hist_idx = -1;
    priv.hist_draft = "";
    /*  History popover order: "time" | "freq" — a browser-persisted
     *  preference, remembered across sessions.  */
    priv.hist_sort = (kw_get_local_storage_value("console_hist_sort", "time", false) === "freq")
        ? "freq" : "time";
    priv.popovers = {};        /*  {HELP|HIST|SK: {dd, content}} input-row popovers  */
    priv.doc_click = null;     /*  outside-click closer for the popovers  */

    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    /*  Use the shared link; subscribe to its re-published events. */
    let link = gobj_find_service("agent_link", true);
    gobj_write_attr(gobj, "link_svc", link);
    if(link) {
        gobj_subscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_OPEN_ERROR", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_ID_NAK", {}, gobj);
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
    }

    /*  config_svc is used for the persistent display_mode.  This panel
     *  is pinned to a single node (the `node` attr), so it does NOT track
     *  the global active_node. */
    gobj_write_attr(gobj, "config_svc", gobj_find_service("agent_config", true));

    if(empty_string(gobj_read_attr(gobj, "node"))) {
        build_empty_state(gobj);   /*  no node -> "select nodes in Nodos"  */
    } else {
        build_ui(gobj);
    }
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{

    if(empty_string(gobj_read_attr(gobj, "node"))) {
        return 0;   /*  empty-state panel: nothing to refresh  */
    }
    refresh_status(gobj);
    ensure_commands_cache(gobj);
    watch_activation(gobj);
}

/***************************************************************
 *  Empty-state panel (no node): shown at the console home when no
 *  nodes are selected. Prompts the operator to pick nodes in Nodos.
 ***************************************************************/
function build_empty_state(gobj)
{
    let $c = createElement2(
        ["div", {class: "C_AGENT_CONSOLE CONSOLE_CARD view-card",
                 style: "display:flex; align-items:center; justify-content:center; height:100%;"},
            [
                ["div", {class: "CONSOLE_EMPTY has-text-grey has-text-centered",
                         style: "max-width:32rem;"},
                    [
                        ["p", {class: "CONSOLE_EMPTY_ICON is-size-4 mb-2"},
                            [["span", {class: "icon is-large"}, [["i", {class: "yi-terminal"}]]]]],
                        ["p", {class: "CONSOLE_EMPTY_TITLE is-size-5", i18n: "no consoles"},
                            "No consoles open"],
                        ["p", {class: "CONSOLE_EMPTY_HINT is-size-6 mt-2", i18n: "pick nodes hint"},
                            "Select one or more nodes in Nodes to open a console tab for each."]
                    ]
                ]
            ]
        ]
    );
    gobj_write_attr(gobj, "$container", $c);
    refresh_language($c, t);
}

/***************************************************************
 *  Reflect the real state in the status line + dot. The dot tracks
 *  the control-center link; the message also tells the operator to
 *  pick a node once connected.
 ***************************************************************/
function refresh_status(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));
    let node = gobj_read_attr(gobj, "node") || "";

    if(connected) {
        set_status(gobj, true, node
            ? `${t("connected")} · ${node}`
            : t("select a node"));
    } else {
        /*  Not connected to the control center; link events drive the
         *  detailed message (NAK reason, cannot connect). */
        set_status(gobj, false, "");
    }
}

/***************************************************************
 *  Focus the command input whenever this tab (re)becomes the visible one,
 *  so selecting a Commands tab lets you type straight away. The shell
 *  reveals a keep_alive view by removing `is-hidden` from its $container
 *  (there is no activation hook), so watch that class flip.
 ***************************************************************/
function watch_activation(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c || typeof MutationObserver === "undefined") {
        return;
    }
    priv.vis_obs = new MutationObserver(function() {
        if(!$c.classList.contains("is-hidden") && priv.$input) {
            priv.$input.focus();
        }
    });
    priv.vis_obs.observe($c, {attributes: true, attributeFilter: ["class"]});
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
    }
    destroy_table(gobj);
    destroy_json_view(gobj);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    destroy_table(gobj);
    destroy_json_view(gobj);
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    if(priv.doc_click) {
        document.removeEventListener("click", priv.doc_click);
        priv.doc_click = null;
    }
    let $c = gobj_read_attr(gobj, "$container");
    if($c && $c.parentNode) {
        $c.parentNode.removeChild($c);
    }
    gobj_write_attr(gobj, "$container", null);
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Update the connection dot (shell) + the local status line.
 ***************************************************************/
function set_status(gobj, connected, text)
{
    gobj_write_attr(gobj, "connected", !!connected);

    let priv = gobj.priv;
    if(priv.$status) {
        priv.$status.textContent = text || "";
        priv.$status.classList.toggle("has-text-success", !!connected);
        priv.$status.classList.toggle("has-text-grey", !connected);
    }
}

/***************************************************************
 *  Build the command input + response DOM.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    /*  Restore the global persisted command history (shared by all nodes;
     *  survives reload and tab close/reopen); priv.history is the mutable
     *  working copy.  */
    let config0 = gobj_read_attr(gobj, "config_svc");
    if(config0) {
        priv.history = normalize_history(agent_config_get_history(config0));
    }

    /*  No native <datalist>: its dropdown hijacks Up/Down to browse command
     *  NAMES, burying the history. Up/Down now recall history (shell-style);
     *  command discovery is served by Tab completion, the live hint line and
     *  the "?" popover. */
    let $input = createElement2(["input", {
        class:        "CONSOLE_INPUT input is-family-monospace",
        type:         "text",
        placeholder:  "help",
        autocomplete: "off",
        "aria-label": "command"
    }, null, {
        /*  Each key that MEANS something is an event; the handler only
         *  translates and, where the browser needs a synchronous answer,
         *  reads back whether the key was consumed.  */
        keydown: (ev) => {
            if(ev.key === "Enter") {
                ev.preventDefault();
                gobj_send_event(gobj, "EV_EXEC_COMMAND", {}, gobj);
            } else if(ev.key === "Tab") {
                /*  Complete the command word to the unique match / common
                 *  prefix; only swallow Tab when it actually completed, so
                 *  Tab still leaves the input when there is nothing to
                 *  complete. The action cannot call preventDefault (a DOM
                 *  event must never travel in a kw), so it reports through
                 *  priv.tab_completed. */
                priv.tab_completed = false;
                gobj_send_event(gobj, "EV_COMPLETE_COMMAND", {}, gobj);
                if(priv.tab_completed) {
                    ev.preventDefault();
                }
            } else if(ev.key === "ArrowUp") {
                ev.preventDefault();
                gobj_send_event(gobj, "EV_HISTORY_RECALL", {dir: +1}, gobj);  /*  older  */
            } else if(ev.key === "ArrowDown") {
                ev.preventDefault();
                gobj_send_event(gobj, "EV_HISTORY_RECALL", {dir: -1}, gobj);  /*  newer  */
            }
        },
        input: () => {
            gobj_send_event(gobj, "EV_INPUT_CHANGED", {}, gobj);
        }
    }]);
    priv.$input = $input;

    /*  Icon + label; the label is hidden on mobile (is-hidden-mobile) so the
     *  input keeps its width — the icon alone carries the action there. */
    let $exec = createElement2(
        ["button", {class: "CONSOLE_EXEC button is-primary", type: "button"}, [
            ["span", {class: "icon"}, [["i", {class: "yi-terminal"}]]],
            ["span", {class: "is-hidden-mobile", i18n: "execute"}, "Execute"]
        ]]
    );
    $exec.addEventListener("click",
        () => gobj_send_event(gobj, "EV_EXEC_COMMAND", {}, gobj));

    /*  Clear as its OWN addon button (right of history), NOT an in-input ✕:
     *  on mobile the in-input ✕ sits under the typing thumb and gets tapped
     *  by accident. Wipes the command AND the response panel. */
    let $clear = createElement2(
        ["button", {class: "CONSOLE_CLEAR button", type: "button", title: t("clear"),
                    "data-i18n-title": "clear"},
            [["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]]]]
    );
    $clear.addEventListener("click",
        () => gobj_send_event(gobj, "EV_CLEAR", {}, gobj));

    let $input_control = createElement2(["div", {class: "CONSOLE_INPUT_CONTROL control is-expanded"}, [$input]]);

    /*  "?" (available commands) + history popovers. Clicking an item inserts
     *  it into the input to edit — it does NOT auto-run. Shortkeys are managed
     *  from Preferences (kept off the input row so it stays wide on mobile). */
    let help_pop = build_popover(gobj, "HELP", "yi-question", t("help"));
    let hist_pop = build_popover(gobj, "HIST", "yi-arrow-rotate-left", t("command history"));
    priv.popovers = {
        HELP: {dd: help_pop.dd, content: help_pop.content},
        HIST: {dd: hist_pop.dd, content: hist_pop.content},
    };

    /*  Status line + a copy button on the right that copies the current
     *  CONSOLE_RESPONSE_TEXT (raw JSON / text answers). Disabled while the
     *  response is a table or empty.  */
    let $status = createElement2(
        ["p", {class: "CONSOLE_STATUS has-text-grey", style: "flex:1; min-width:0; margin:0;"}, ""]);
    priv.$status = $status;

    /*  Seed this view's LIVE font size from the persisted default (Settings);
     *  the A− / A+ buttons nudge only this copy — temporary, like the Terminal. */
    priv.font_size = get_console_font_size();

    /*  Font size A− / [N px] / A+ for CONSOLE_RESPONSE_TEXT: a TEMPORARY,
     *  per-console nudge (the persisted default lives in Settings, mirroring the
     *  Terminal's TTY_HOST control). Icon-only buttons with a title carrying the
     *  meaning. */
    priv.$font_dec = createElement2(
        ["button", {class: "CONSOLE_FONT_DEC button is-ghost", type: "button",
                    title: t("font smaller"), "aria-label": t("font smaller"),
                    "data-i18n-title": "font smaller", "data-i18n-aria-label": "font smaller"},
            [["span", {class: "icon"}, [["i", {class: "yi-magnifying-glass-minus"}]]]],
            {click: () => gobj_send_event(gobj, "EV_FONT_SIZE", {delta: -1}, gobj)}]
    );
    priv.$font_size_label = createElement2(
        ["span", {class: "CONSOLE_FONT_SIZE is-size-7 has-text-grey",
                  style: "min-width:2.75rem; text-align:center;"},
            priv.font_size + " px"]
    );
    priv.$font_inc = createElement2(
        ["button", {class: "CONSOLE_FONT_INC button is-ghost", type: "button",
                    title: t("font larger"), "aria-label": t("font larger"),
                    "data-i18n-title": "font larger", "data-i18n-aria-label": "font larger"},
            [["span", {class: "icon"}, [["i", {class: "yi-magnifying-glass-plus"}]]]],
            {click: () => gobj_send_event(gobj, "EV_FONT_SIZE", {delta: +1}, gobj)}]
    );

    let $copy = createElement2(
        ["button", {class: "CONSOLE_COPY button is-ghost", type: "button",
                    title: t("copy response"), "data-i18n-title": "copy response"},
            [["span", {class: "icon"}, [["i", {class: "yi-copy"}]]]]]
    );
    $copy.disabled = true;
    $copy.addEventListener("click",
        () => gobj_send_event(gobj, "EV_COPY_RESPONSE", {}, gobj));
    priv.$copy = $copy;
    priv.$copy_icon = $copy.querySelector("i");

    let $status_row = createElement2(
        ["div", {class: "CONSOLE_STATUS_ROW",
                 style: "display:flex; align-items:center; gap:0.5rem;"},
            [$status, priv.$font_dec, priv.$font_size_label, priv.$font_inc, $copy]]
    );

    /*  Command helper: shows the matched command's signature + description
     *  as you type (from the `help` cache). Hidden when nothing matches. */
    let $hint = createElement2(
        ["p", {class: "CONSOLE_HINT is-size-7 is-family-monospace has-text-grey is-hidden",
               style: "white-space:pre-wrap; margin:0;"}, ""]
    );
    priv.$hint = $hint;

    /*  No hardcoded colours: let Bulma's theme-aware <pre> styling
     *  (--bulma-pre-*) drive background/text so both panels read well in
     *  light AND dark.  */
    let $comment = createElement2(
        ["pre", {class: "CONSOLE_COMMENT is-size-7 is-hidden",
                 style: "white-space:pre-wrap; padding:0.5rem; border-radius:4px; min-height:1.5rem;"},
            ""]
    );
    priv.$comment = $comment;

    /*  Response host: holds either a Tabulator table (schema answers) or
     *  a <pre> with raw JSON / text.  Tabulator manages its own scroll;
     *  the <pre> gets overflow:auto when used.  */
    let $data = createElement2(
        ["div", {class: "CONSOLE_RESPONSE", style: "flex:1; min-height:0;"}]
    );
    priv.$data = $data;

    let $c = createElement2(
        ["div", {class: "C_AGENT_CONSOLE CONSOLE_CARD view-card", style: "display:flex; flex-direction:column; height:100%; gap:0.5rem;"},
            [
                ["div", {class: "CONSOLE_INPUT_ROW field has-addons mb-0"}, [
                    $input_control,
                    help_pop.control,
                    hist_pop.control,
                    ["div", {class: "CONSOLE_CLEAR_CONTROL control"}, [$clear]],
                    ["div", {class: "CONSOLE_EXEC_CONTROL control"}, [$exec]]
                ]],
                $hint,
                $status_row,
                $data,
                $comment
            ]
        ]
    );
    gobj_write_attr(gobj, "$container", $c);

    /*  Seed the A− / A+ clamp-limit disabled state from the stored size.  */
    apply_console_font_size(gobj);

    /*  Outside-click closes any open popover.  */
    priv.doc_click = (ev) => {
        let inside = false;
        for(let k in priv.popovers) {
            if(priv.popovers[k].dd && priv.popovers[k].dd.contains(ev.target)) {
                inside = true;
                break;
            }
        }
        if(!inside) {
            gobj_send_event(gobj, "EV_CLOSE_POPOVERS", {}, gobj);
        }
    };
    document.addEventListener("click", priv.doc_click);

    refresh_language($c, t);
}

/***************************************************************
 *  Refresh priv.history from the GLOBAL persisted store. The command
 *  history is a single shared list across every node's console; each
 *  console keeps a working copy, so re-read the store before using it
 *  to pick up commands run in OTHER node tabs (and reloads). Called at
 *  every point of use: add, remove, recall start, popover open.
 ***************************************************************/
function sync_history_from_store(gobj)
{
    let priv = gobj.priv;
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        priv.history = normalize_history(agent_config_get_history(config));
    }
}

/***************************************************************
 *  Push a command onto the SHARED history: deduped — a re-run bumps
 *  the entry's count and moves it to the front (most recent). Merges
 *  onto the latest global list first, so a command run here never
 *  clobbers commands added from another node's console.
 ***************************************************************/
function add_history(gobj, cmd)
{
    let priv = gobj.priv;
    sync_history_from_store(gobj);   /*  merge onto the latest shared list  */
    let idx = priv.history.findIndex((e) => e.cmd === cmd);
    let entry;
    if(idx >= 0) {
        entry = priv.history.splice(idx, 1)[0];
        entry.count++;
    } else {
        entry = {cmd: cmd, count: 1, last: 0};
    }
    entry.last = Date.now();
    priv.history.unshift(entry);
    if(priv.history.length > HISTORY_MAX) {
        priv.history.pop();
    }
    /*  Persist globally so recall survives reloads / tab reopen and is
     *  shared across all nodes.  */
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        agent_config_set_history(config, priv.history);
    }
}

/***************************************************************
 *  Command helper: cache this node's command list once, by fetching
 *  `help` and parsing it. The answer is tagged console_purpose:"cache"
 *  in __md_iev__ so ac_mt_command_answer routes it here (not to the
 *  response panel).
 ***************************************************************/
function ensure_commands_cache(gobj)
{
    let priv = gobj.priv;
    if(priv.commands_loaded) {
        return;
    }
    let node = gobj_read_attr(gobj, "node") || "";
    let link = gobj_read_attr(gobj, "link_svc");
    if(!node || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {agent_id: node, cmd2agent: "help"};
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_purpose", "cache");
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Parse a `help` answer into {name -> {name, params[], desc}}.
 *  Command lines look like:
 *    - list-yunos            (1 ) [id='?'] [realm_id='?'] ... . List all yunos
 ***************************************************************/
function parse_help(text)
{
    let cmds = {};
    let lines = String(text || "").split("\n");
    for(let line of lines) {
        let m = /^-\s+(\S+)\s*(?:\(([^)]*)\))?\s*(.*)$/.exec(line);
        if(!m) {
            continue;
        }
        let name = m[1];
        let rest = m[3] || "";
        let params = [];
        let re = /\[([a-zA-Z0-9_]+)=/g;
        let pm;
        while((pm = re.exec(rest)) !== null) {
            params.push(pm[1]);
        }
        let desc = rest.replace(/\[[^\]]*\]/g, "").replace(/^[\s.]+/, "").trim();
        cmds[name] = {name: name, params: params, desc: desc};
    }
    return cmds;
}

/***************************************************************
 *  Store the parsed command cache + refresh the hint.
 ***************************************************************/
function load_commands_cache(gobj, help_text)
{
    let priv = gobj.priv;
    priv.commands = parse_help(help_text);
    priv.commands_loaded = true;
    update_hint(gobj);
}

/***************************************************************
 *  Set the input value programmatically (history recall / popover
 *  insert / clear) and refresh the hint. It does NOT go through the
 *  input event, so it never disturbs the history-recall pointer.
 ***************************************************************/
function set_input_value(gobj, text)
{
    let priv = gobj.priv;
    if(!priv.$input) {
        return;
    }
    priv.$input.value = text;
    let n = String(text).length;
    priv.$input.setSelectionRange(n, n);
    update_hint(gobj);
}

/***************************************************************
 *  Shell-style history recall. dir=+1 older, dir=-1 newer. On the first
 *  Up we stash the live line (hist_draft) so Down past the newest brings
 *  it back. priv.history[0] is the most recently used entry (deduped, so
 *  Up never shows the same command twice).
 ***************************************************************/
function recall_history(gobj, dir)
{
    let priv = gobj.priv;
    if(!priv.$input) {
        return;
    }
    /*  Starting a fresh recall: refresh from the shared store so Up/Down
     *  walks the latest history (incl. commands run in other node tabs).
     *  Not mid-walk — that would shift the indices under hist_idx.  */
    if(priv.hist_idx === -1) {
        sync_history_from_store(gobj);
    }
    if(priv.history.length === 0) {
        return;
    }
    if(priv.hist_idx === -1 && dir > 0) {
        priv.hist_draft = priv.$input.value;
    }
    let idx = priv.hist_idx + dir;
    if(idx >= priv.history.length) {
        idx = priv.history.length - 1;   /*  clamp at the oldest  */
    }
    let text;
    if(idx < 0) {
        priv.hist_idx = -1;
        text = priv.hist_draft;   /*  back to the live line  */
    } else {
        priv.hist_idx = idx;
        text = priv.history[idx].cmd;
    }
    set_input_value(gobj, text);
}

/***************************************************************
 *  Put text in the input (replacing it), focus + move caret to end.
 *  Used by the "?" and history popovers — it does NOT execute.
 ***************************************************************/
function insert_command(gobj, text)
{
    let priv = gobj.priv;
    if(!priv.$input) {
        return;
    }
    priv.hist_idx = -1;
    close_popovers(gobj);
    priv.$input.focus();
    set_input_value(gobj, text);
}

/***************************************************************
 *  Clear button: wipe the command AND the response panel, then
 *  refocus the input (what the old in-input ✕ did).
 ***************************************************************/
function clear_console(gobj)
{
    let priv = gobj.priv;
    priv.hist_idx = -1;
    set_input_value(gobj, "");
    show_comment(gobj, "", 0);   /*  hide the comment line  */
    show_data(gobj, null);       /*  tear down table + empty the response  */
    if(priv.$input) {
        priv.$input.focus();
    }
}

/***************************************************************
 *  Build a Bulma dropdown popover (theme-aware, self-contained) with an
 *  icon trigger. kind is "HELP" | "HIST"; content is filled on open.
 *  Returns {control, dd, content} for wiring into the input row.
 ***************************************************************/
function build_popover(gobj, kind, icon, title)
{
    let $content = createElement2(
        ["div", {class: `CONSOLE_${kind}_CONTENT dropdown-content`,
                 style: "max-height:22rem; overflow:auto;"}, []]
    );
    let $btn = createElement2(
        ["button", {class: `CONSOLE_${kind}_BTN button`, type: "button",
                    "aria-haspopup": "true", title: title},
            [["span", {class: "icon"}, [["i", {class: icon}]]]]]
    );
    let $dd = createElement2(
        ["div", {class: `CONSOLE_${kind}_DD dropdown`}, [
            ["div", {class: "dropdown-trigger"}, [$btn]],
            ["div", {class: "dropdown-menu", role: "menu"}, [$content]]
        ]]
    );
    $btn.addEventListener("click", (ev) => {
        ev.stopPropagation();   /*  don't let the doc handler close it first  */
        gobj_send_event(gobj, "EV_TOGGLE_POPOVER", {kind: kind}, gobj);
    });
    /*  CONSOLE_POP_CONTROL is made position:static in app.css so the menu
     *  anchors to the input row and spans it full width.  */
    return {
        control: createElement2(["div", {class: "control CONSOLE_POP_CONTROL"}, [$dd]]),
        dd: $dd,
        content: $content
    };
}

/***************************************************************
 *  Open one popover (filling it), closing the others.
 ***************************************************************/
function toggle_popover(gobj, kind)
{
    let priv = gobj.priv;
    let target = priv.popovers[kind];
    if(!target || !target.dd) {
        return;
    }
    let open = !target.dd.classList.contains("is-active");
    close_popovers(gobj);
    target.dd.classList.toggle("is-active", open);
    if(open) {
        if(kind === "HELP") {
            fill_help_popover(gobj);
        } else if(kind === "HIST") {
            fill_hist_popover(gobj);
        }
    }
}

/***************************************************************
 *  Close all popovers.
 ***************************************************************/
function close_popovers(gobj)
{
    let priv = gobj.priv;
    for(let k in priv.popovers) {
        if(priv.popovers[k].dd) {
            priv.popovers[k].dd.classList.remove("is-active");
        }
    }
}

/***************************************************************
 *  Fill the "?" popover: available commands (seed + cached), each
 *  showing its name + parameter signature; the description is the
 *  tooltip. Clicking inserts "name " ready for parameters.
 ***************************************************************/
function fill_help_popover(gobj)
{
    let priv = gobj.priv;
    let $c = priv.popovers.HELP && priv.popovers.HELP.content;
    if(!$c) {
        return;
    }
    $c.replaceChildren();
    let names = command_names(gobj).sort();
    if(names.length === 0) {
        $c.appendChild(createElement2(
            ["div", {class: "HELP_EMPTY dropdown-item has-text-grey", i18n: "no commands"},
                t("no commands")]));
        return;
    }
    for(let name of names) {
        let cmd = priv.commands[name];
        let sig = (cmd && cmd.params && cmd.params.length)
            ? " " + cmd.params.map((p) => `[${p}]`).join(" ") : "";
        let $item = createElement2(
            ["a", {class: "HELP_ITEM dropdown-item is-family-monospace",
                   style: "white-space:normal;", title: (cmd && cmd.desc) ? cmd.desc : ""},
                [
                    ["span", {class: "HELP_ITEM_NAME has-text-weight-semibold"}, name],
                    ["span", {class: "HELP_ITEM_SIG has-text-grey"}, sig]
                ]
            ]
        );
        $item.addEventListener("click", (ev) => {
            ev.preventDefault();
            gobj_send_event(gobj, "EV_INSERT_COMMAND", {text: name + " "}, gobj);
        });
        $c.appendChild($item);
    }
}

/***************************************************************
 *  Remove one command from the history (row ✕ button) and persist.
 ***************************************************************/
function remove_history(gobj, cmd)
{
    let priv = gobj.priv;
    sync_history_from_store(gobj);   /*  remove from the latest shared list  */
    let idx = priv.history.findIndex((e) => e.cmd === cmd);
    if(idx < 0) {
        return;
    }
    priv.history.splice(idx, 1);
    priv.hist_idx = -1;   /*  recall pointer may now be stale  */
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        agent_config_set_history(config, priv.history);
    }
}

/***************************************************************
 *  Preload the input with `add-shortkey key= command="<cmd>"` and
 *  park the caret right after `key=` so the user just names it and
 *  hits Enter (the existing local command does the rest). No new
 *  dialog: same insert-to-edit flow as every popover item.
 ***************************************************************/
function insert_add_shortkey(gobj, cmd)
{
    let quote = cmd.includes("\"") ? "'" : "\"";
    let prefix = "add-shortkey key=";
    insert_command(gobj, `${prefix} command=${quote}${cmd}${quote}`);
    let priv = gobj.priv;
    if(priv.$input) {
        priv.$input.setSelectionRange(prefix.length, prefix.length);
    }
}

/***************************************************************
 *  Fill the history popover: DEDUPED commands with a use counter,
 *  orderable by recency (default) or by frequency — the header
 *  toggles priv.hist_sort. Clicking a row inserts the command line;
 *  its + button preloads add-shortkey for it; its ✕ button deletes
 *  the entry from the history (popover stays open and refreshes).
 ***************************************************************/
function fill_hist_popover(gobj)
{
    let priv = gobj.priv;
    let $c = priv.popovers.HIST && priv.popovers.HIST.content;
    if(!$c) {
        return;
    }
    sync_history_from_store(gobj);   /*  show the latest shared history  */
    $c.replaceChildren();
    if(priv.history.length === 0) {
        $c.appendChild(createElement2(
            ["div", {class: "HISTORY_EMPTY dropdown-item has-text-grey", i18n: "no history yet"},
                t("no history yet")]));
        return;
    }

    /*  Sort header: recency vs frequency.  */
    let mk_sort_btn = (mode, key, text) => {
        let $b = createElement2(
            ["button", {class: "HISTORY_SORT button", type: "button", i18n: key}, text]);
        if(priv.hist_sort === mode) {
            $b.classList.add("is-info", "is-selected");
        }
        $b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            gobj_send_event(gobj, "EV_HISTORY_SORT", {mode: mode}, gobj);
        });
        return $b;
    };
    $c.appendChild(createElement2(
        ["div", {class: "HISTORY_SORT_ROW dropdown-item", style: "display:flex; gap:0.5rem;"},
            [mk_sort_btn("time", "recent", t("recent")),
             mk_sort_btn("freq", "frequent", t("frequent"))]]));
    $c.appendChild(createElement2(
        ["hr", {class: "HISTORY_DIVIDER dropdown-divider"}]));

    let entries = priv.history.slice();
    if(priv.hist_sort === "freq") {
        entries.sort((a, b) => (b.count - a.count) || (b.last - a.last));
    }
    for(let e of entries) {
        let $run = createElement2(
            ["button", {class: "HISTORY_RUN button is-ghost", type: "button",
                        title: t("run this command"), "aria-label": t("run this command"),
                        "data-i18n-title": "run this command",
                        "data-i18n-aria-label": "run this command"},
                [["span", {class: "icon"}, [["i", {class: "yi-play"}]]]]]);
        $run.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            gobj_send_event(gobj, "EV_RUN_HISTORY", {cmd: e.cmd}, gobj);
        });
        let $add = createElement2(
            ["button", {class: "HISTORY_ADD button is-ghost", type: "button",
                        title: t("add to shortkeys"), "aria-label": t("add to shortkeys"),
                        "data-i18n-title": "add to shortkeys",
                        "data-i18n-aria-label": "add to shortkeys"},
                [["span", {class: "icon"}, [["i", {class: "yi-plus"}]]]]]);
        $add.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            gobj_send_event(gobj, "EV_ADD_SHORTKEY", {cmd: e.cmd}, gobj);
        });
        let $del = createElement2(
            ["button", {class: "HISTORY_DEL button is-ghost", type: "button",
                        title: t("remove from history"), "aria-label": t("remove from history"),
                        "data-i18n-title": "remove from history",
                        "data-i18n-aria-label": "remove from history"},
                [["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]]]]);
        $del.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            gobj_send_event(gobj, "EV_REMOVE_HISTORY", {cmd: e.cmd}, gobj);
        });
        let $item = createElement2(
            ["a", {class: "HISTORY_ITEM dropdown-item is-family-monospace",
                   style: "white-space:normal; display:flex; align-items:center; gap:0.5rem;",
                   title: e.cmd},
                [
                    ["span", {class: "HISTORY_ITEM_CMD",
                              style: "flex:1; min-width:0; overflow-wrap:anywhere;"}, e.cmd],
                    ["span", {class: "HISTORY_ITEM_COUNT is-size-7 has-text-grey"}, `×${e.count}`]
                ]
            ]
        );
        $item.appendChild($run);
        $item.appendChild($add);
        $item.appendChild($del);
        $item.addEventListener("click", (ev) => {
            ev.preventDefault();
            gobj_send_event(gobj, "EV_INSERT_COMMAND", {text: e.cmd}, gobj);
        });
        $c.appendChild($item);
    }
}

/***************************************************************
 *  Run a history entry in one gesture: drop it in the input and
 *  send it. Picking a line from the history and then having to
 *  aim at Execute was two steps for one intention.
 ***************************************************************/
function ac_run_history(gobj, event, kw, src)
{
    let cmd = kw_get_str(gobj, kw, "cmd", "", 0);

    if(!cmd) {
        log_error(`${GCLASS_NAME}: EV_RUN_HISTORY without a command`);
        return -1;
    }

    insert_command(gobj, cmd);
    send_command(gobj);
    return 0;
}

/***************************************************************
 *  Show the current command's signature under the input.
 ***************************************************************/
function update_hint(gobj)
{
    let priv = gobj.priv;
    if(!priv.$hint || !priv.$input) {
        return;
    }
    let val = String(priv.$input.value || "").replace(/^\*/, "").trimStart();
    let word = val.split(/\s+/)[0] || "";
    let cmd = word ? priv.commands[word] : null;
    if(cmd) {
        let sig = (cmd.params.length ? " " + cmd.params.map((p) => `[${p}]`).join(" ") : "");
        let desc = cmd.desc ? `  —  ${cmd.desc}` : "";
        priv.$hint.textContent = word + sig + desc;
        priv.$hint.classList.remove("is-hidden");
    } else {
        priv.$hint.textContent = "";
        priv.$hint.classList.add("is-hidden");
    }
}

/***************************************************************
 *  All known command names (seed + cached).
 ***************************************************************/
function command_names(gobj)
{
    let pool = new Set(SEED_COMMANDS);
    for(let name in gobj.priv.commands) {
        pool.add(name);
    }
    return Array.from(pool);
}

/***************************************************************
 *  Longest common prefix of a non-empty string array.
 ***************************************************************/
function longest_common_prefix(arr)
{
    return arr.reduce((a, b) => {
        let i = 0;
        while(i < a.length && i < b.length && a[i] === b[i]) {
            i++;
        }
        return a.slice(0, i);
    });
}

/***************************************************************
 *  Tab completion of the LAST token: the command name when still on
 *  the first word, otherwise a parameter of that command (the ones
 *  not yet used on the line), completed to the common prefix / unique
 *  match.  Params complete with a trailing '=' (ready for the value).
 *  Returns true when it changed the input.
 ***************************************************************/
function complete_command(gobj)
{
    let priv = gobj.priv;
    let raw = String(priv.$input.value || "");
    let star = raw.charAt(0) === "*" ? "*" : "";
    let body = star ? raw.slice(1) : raw;

    let last_space = body.lastIndexOf(" ");
    let cur = body.slice(last_space + 1);        /*  token being typed  */
    let before = body.slice(0, last_space + 1);  /*  keeps the trailing space  */

    let candidates;
    if(last_space < 0) {
        /*  Completing the command name.  */
        candidates = command_names(gobj);
    } else {
        /*  Completing a parameter of the first word.  */
        let name = body.trimStart().split(/\s+/)[0] || "";
        let cmd = priv.commands[name];
        if(!cmd || !cmd.params.length) {
            return false;
        }
        let used = {};
        let re = /([a-zA-Z0-9_]+)=/g;
        let m;
        while((m = re.exec(body)) !== null) {
            used[m[1]] = true;
        }
        candidates = cmd.params
            .filter((p) => !used[p])
            .map((p) => `${p}=`);
    }

    let matches = candidates.filter((c) => c.indexOf(cur) === 0);
    if(matches.length === 0) {
        return false;
    }
    let common = longest_common_prefix(matches);
    if(common.length > cur.length) {
        priv.$input.value = star + before + common;
        update_hint(gobj);
        return true;
    }
    if(matches.length === 1) {
        /*  Command names get a trailing space; params already end with '='. */
        let suffix = (last_space < 0) ? " " : "";
        priv.$input.value = star + before + matches[0] + suffix;
        update_hint(gobj);
        return true;
    }
    return false;
}

/***************************************************************
 *  Render a command answer / status comment.
 ***************************************************************/
function show_comment(gobj, comment, result)
{
    let priv = gobj.priv;
    if(!priv.$comment) {
        return;
    }
    let is_error = typeof result === "number" && result < 0;
    let text = comment || "";
    priv.$comment.textContent = text;
    priv.$comment.classList.toggle("has-text-danger", is_error);
    /*  Only surface the comment line on an error answer; on success the
     *  payload goes to CONSOLE_RESPONSE, so keep it hidden to reclaim
     *  vertical space (matters on mobile). */
    priv.$comment.classList.toggle("is-hidden", !(is_error && text !== ""));
}

/***************************************************************
 *  Read the persisted CONSOLE_RESPONSE_TEXT font size (clamped),
 *  falling back to DEFAULT when unset or out of range.
 ***************************************************************/
function get_console_font_size()
{
    let v = parseInt(
        kw_get_local_storage_value("console_font_size", CONSOLE_FONT_SIZE_DEFAULT, true), 10);
    if(!(v >= CONSOLE_FONT_SIZE_MIN && v <= CONSOLE_FONT_SIZE_MAX)) {
        return CONSOLE_FONT_SIZE_DEFAULT;
    }
    return v;
}

/***************************************************************
 *  Persist the DEFAULT CONSOLE_RESPONSE_TEXT font size (clamped).
 *  Driven from Settings → Preferences ONLY; the per-console A− / A+
 *  buttons do not call this, so a toolbar nudge never changes the
 *  default. A NaN input keeps the current value. Returns the stored
 *  size.
 ***************************************************************/
function set_console_font_size(size)
{
    let n = parseInt(size, 10);
    if(isNaN(n)) {
        return get_console_font_size();
    }
    if(n < CONSOLE_FONT_SIZE_MIN) {
        n = CONSOLE_FONT_SIZE_MIN;
    }
    if(n > CONSOLE_FONT_SIZE_MAX) {
        n = CONSOLE_FONT_SIZE_MAX;
    }
    kw_set_local_storage_value("console_font_size", n);
    return n;
}

/***************************************************************
 *  Reflect THIS view's live font size (priv.font_size) onto the
 *  response text and the A− / A+ controls (px readout + clamp-limit
 *  disabled state). Safe to call before any answer is rendered.
 ***************************************************************/
function apply_console_font_size(gobj)
{
    let priv = gobj.priv;
    let size = priv.font_size || get_console_font_size();

    if(priv.$data) {
        let $pre = priv.$data.querySelector(".CONSOLE_RESPONSE_TEXT");
        if($pre) {
            $pre.style.fontSize = size + "px";
        }
        /*  The viewer is the other face of the same answer, so A− / A+
         *  has to reach it too; set on its root, it cascades to the tree. */
        let $json = priv.$data.querySelector(".CONSOLE_RESPONSE_JSON");
        if($json) {
            $json.style.fontSize = size + "px";
        }
    }
    if(priv.$font_size_label) {
        priv.$font_size_label.textContent = size + " px";
    }
    if(priv.$font_dec) {
        priv.$font_dec.disabled = size <= CONSOLE_FONT_SIZE_MIN;
    }
    if(priv.$font_inc) {
        priv.$font_inc.disabled = size >= CONSOLE_FONT_SIZE_MAX;
    }
}

/***************************************************************
 *  A− / A+ toolbar buttons: nudge ONLY this view's live font size
 *  (priv.font_size) and re-apply it — a TEMPORARY, per-console
 *  change, never persisted, so reopening returns to the default set
 *  in Settings. A no-op at the clamp limits. (Mirrors the Terminal's
 *  per-tab change_font_size.)
 ***************************************************************/
function change_console_font_size(gobj, delta)
{
    let priv = gobj.priv;
    let cur = priv.font_size || get_console_font_size();
    let next = cur + delta;
    if(next < CONSOLE_FONT_SIZE_MIN) {
        next = CONSOLE_FONT_SIZE_MIN;
    }
    if(next > CONSOLE_FONT_SIZE_MAX) {
        next = CONSOLE_FONT_SIZE_MAX;
    }
    if(next === cur) {
        return;
    }
    priv.font_size = next;
    apply_console_font_size(gobj);
}

/***************************************************************
 *  Render a command answer's payload into CONSOLE_RESPONSE.
 *
 *  Mirrors ycommand's display_webix_result mapped to the console:
 *    - array + table mode + schema  -> interactive Tabulator table
 *    - array + form/no-schema       -> JSON tree viewer (C_YUI_JSON)
 *    - object                       -> JSON tree viewer (C_YUI_JSON)
 *    - "raw" mode                   -> the text exactly as it arrived
 *    - no data but a (non-error)    -> paint the comment; this is how
 *      comment (e.g. `help`)           `help` arrives: text in comment,
 *                                       data + schema null.
 *  Errors keep their short comment in the CONSOLE_COMMENT line.
 ***************************************************************/
function show_data(gobj, data, schema, mode, comment, result)
{
    let priv = gobj.priv;
    if(!priv.$data) {
        return;
    }
    priv.pending = false;   /*  a real render supersedes the "running…" state  */
    mode = mode || "table"; /*  internal callers pass none  */

    /*  Tear down any previous table/viewer + content.  */
    destroy_table(gobj);
    destroy_json_view(gobj);
    priv.$data.replaceChildren();
    set_copy_enabled(gobj, false);   /*  nothing to copy yet  */

    /*  Table mode: array payload + schema -> Tabulator.  */
    if(mode === "table" && Array.isArray(data) && Array.isArray(schema) && schema.length) {
        render_table(gobj, schema, data);
        return;
    }

    /*  A structured answer is a TREE, not a wall of text: object and array
     *  payloads go to the JSON viewer, which brings the search box, the
     *  per-node collapse and its own copy. Only "raw" keeps the <pre>, for
     *  when what you want is the answer exactly as it arrived. Strings and
     *  comment-only answers (`help`) are text in every mode.  */
    if(mode !== "raw" && data !== null && typeof data === "object") {
        render_json_view(gobj, data);
        return;
    }

    /*  Otherwise paint "what arrives": the data as raw JSON/text, or the
     *  comment when the answer carries its text there (help) and is not
     *  an error.  */
    let text = null;
    if(data !== null && data !== undefined) {
        if(typeof data === "string") {
            text = data;
        } else {
            try {
                text = JSON.stringify(data, null, 4);
            } catch(e) {
                text = String(data);
            }
        }
    } else if(comment && !(typeof result === "number" && result < 0)) {
        text = comment;
    }

    if(text === null || text === "") {
        return;
    }
    priv.$data.appendChild(createElement2(
        ["pre", {class: "CONSOLE_RESPONSE_TEXT",
                 style: "margin:0; height:100%; overflow:auto; white-space:pre-wrap; " +
                        "font-size:" + (priv.font_size || get_console_font_size()) + "px; " +
                        "padding:0.5rem;"},
            text]
    ));
    set_copy_enabled(gobj, true);   /*  there is text to copy now  */
}

/***************************************************************
 *  Paint a visible "running…" placeholder into CONSOLE_RESPONSE while a
 *  command is in flight, so a sent command gives immediate feedback
 *  instead of a blank pane. The answer replaces it (show_data does
 *  replaceChildren), as does a disconnect/error repaint. No timeout —
 *  matching the no-polling model; the placeholder simply stays until an
 *  answer (or a link drop) arrives.
 ***************************************************************/
function show_pending(gobj)
{
    let priv = gobj.priv;
    if(!priv.$data) {
        return;
    }
    priv.pending = true;
    destroy_table(gobj);
    destroy_json_view(gobj);
    set_copy_enabled(gobj, false);   /*  nothing to copy while pending  */
    priv.$data.replaceChildren(createElement2(
        ["p", {class: "CONSOLE_PENDING is-size-7 has-text-grey",
               style: "margin:0; padding:0.5rem;"},
            `${t("running")} …`]
    ));
}

/***************************************************************
 *  Clear the "running…" placeholder when a pending command can no
 *  longer complete (the link dropped, or the identity was refused).
 *  Only touches CONSOLE_RESPONSE when a command was actually pending,
 *  so a valid last answer stays put across an idle disconnect.
 ***************************************************************/
function clear_pending(gobj)
{
    let priv = gobj.priv;
    if(!priv.pending) {
        return;
    }
    priv.pending = false;
    destroy_json_view(gobj);
    if(priv.$data) {
        priv.$data.replaceChildren();
    }
    set_copy_enabled(gobj, false);
}

/***************************************************************
 *  Enable/disable the copy button and reset its icon to the neutral
 *  "copy" glyph (clearing any lingering "copied" flash).
 ***************************************************************/
function set_copy_enabled(gobj, enabled)
{
    let priv = gobj.priv;
    if(!priv.$copy) {
        return;
    }
    priv.$copy.disabled = !enabled;
    clear_timeout(priv.gobj_timer);
    priv.$copy.classList.remove("has-text-success");
    if(priv.$copy_icon) {
        priv.$copy_icon.className = "yi-copy";
    }
}

/***************************************************************
 *  Copy the current CONSOLE_RESPONSE_TEXT to the clipboard. Uses the
 *  async Clipboard API (HTTPS) with a legacy execCommand fallback for
 *  non-secure contexts. Flashes a check icon on success.
 ***************************************************************/
function copy_response(gobj)
{
    let priv = gobj.priv;

    /*  Table mode: the rows, as JSON — the selection if there is one,
     *  otherwise whatever the current filters leave on screen.  */
    if(priv.tabulator) {
        yui_copy_table_json(priv.tabulator).then(function(copied) {
            if(copied) {
                flash_copied(gobj);
            }
        });
        return;
    }

    /*  Viewer mode: the whole answer, not the part left expanded.  */
    if(priv.json_view && priv.json_text) {
        yui_copy_text(priv.json_text).then(function(ok) {
            if(ok) {
                flash_copied(gobj);
            }
        });
        return;
    }

    /*  Text mode: the <pre> as it reads.  */
    let pre = priv.$data ? priv.$data.querySelector(".CONSOLE_RESPONSE_TEXT") : null;
    let text = pre ? pre.textContent : "";
    if(!text) {
        return;
    }
    yui_copy_text(text).then(function(ok) {
        if(ok) {
            flash_copied(gobj);
        }
    });
}

/***************************************************************
 *  Briefly show a check icon on the copy button after a successful
 *  copy, then restore the neutral copy glyph.
 ***************************************************************/
function flash_copied(gobj)
{
    let priv = gobj.priv;
    if(!priv.$copy) {
        return;
    }
    priv.$copy.classList.add("has-text-success");
    if(priv.$copy_icon) {
        priv.$copy_icon.className = "yi-square-check";
    }
    /*  Going back is EV_TIMEOUT, an FSM transition that shows in the
     *  machine trace -- not a setTimeout nobody can see.  */
    set_timeout(priv.gobj_timer, 1200);
}

/***************************************************************
 *  The "copied" mark has had its moment.
 ***************************************************************/
function ac_timeout(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(priv.$copy) {
        priv.$copy.classList.remove("has-text-success");
    }
    if(priv.$copy_icon) {
        priv.$copy_icon.className = "yi-copy";
    }
    return 0;
}

/***************************************************************
 *  Execute what is in the input — Enter or the Execute button. THE
 *  action of this workspace: it has to be visible in the machine trace,
 *  which is why it is an event and not a call from the DOM handler.
 ***************************************************************/
function ac_exec_command(gobj, event, kw, src)
{
    send_command(gobj);
    return 0;
}

/***************************************************************
 *  Tab: complete the command name or the parameter being typed.
 *  Reports back through priv.tab_completed whether the key was
 *  consumed — the keydown handler needs that answer synchronously to
 *  decide preventDefault, and a DOM event cannot travel in a kw.
 ***************************************************************/
function ac_complete_command(gobj, event, kw, src)
{
    gobj.priv.tab_completed = complete_command(gobj);
    return 0;
}

/***************************************************************
 *  Up / Down: walk the shared command history (dir +1 = older).
 ***************************************************************/
function ac_history_recall(gobj, event, kw, src)
{
    recall_history(gobj, (kw && kw.dir) || 0);
    return 0;
}

/***************************************************************
 *  The user typed: that leaves history-recall mode and re-matches the
 *  command hint.
 ***************************************************************/
function ac_input_changed(gobj, event, kw, src)
{
    gobj.priv.hist_idx = -1;
    update_hint(gobj);
    return 0;
}

/***************************************************************
 *  Clear (✕): wipe the command AND the response panel.
 ***************************************************************/
function ac_clear(gobj, event, kw, src)
{
    clear_console(gobj);
    return 0;
}

/***************************************************************
 *  Copy the answer to the clipboard (table answers go as JSON).
 ***************************************************************/
function ac_copy_response(gobj, event, kw, src)
{
    copy_response(gobj);
    return 0;
}

/***************************************************************
 *  A− / A+ : this console's live response font size (temporary; the
 *  shared default lives in Preferences).
 ***************************************************************/
function ac_font_size(gobj, event, kw, src)
{
    change_console_font_size(gobj, (kw && kw.delta) || 0);
    return 0;
}

/***************************************************************
 *  The "?" (commands) or history popover trigger. `kind` is the
 *  identity of the popover ("HELP" | "HIST"), never its element.
 ***************************************************************/
function ac_toggle_popover(gobj, event, kw, src)
{
    toggle_popover(gobj, (kw && kw.kind) || "");
    return 0;
}

/***************************************************************
 *  A click outside every popover closes them.
 ***************************************************************/
function ac_close_popovers(gobj, event, kw, src)
{
    close_popovers(gobj);
    return 0;
}

/***************************************************************
 *  Drop a command in the input to edit (a popover row, a command
 *  name from "?"). It does NOT run it — that is EV_RUN_HISTORY.
 ***************************************************************/
function ac_insert_command(gobj, event, kw, src)
{
    insert_command(gobj, (kw && kw.text) || "");
    return 0;
}

/***************************************************************
 *  Preload `add-shortkey key= command="<cmd>"` with the caret on the
 *  key, so naming it and pressing Enter creates the shortkey.
 ***************************************************************/
function ac_add_shortkey(gobj, event, kw, src)
{
    insert_add_shortkey(gobj, (kw && kw.cmd) || "");
    return 0;
}

/***************************************************************
 *  Remove one entry from the shared history (row ✕); the popover
 *  stays open and redraws.
 ***************************************************************/
function ac_remove_history(gobj, event, kw, src)
{
    remove_history(gobj, (kw && kw.cmd) || "");
    fill_hist_popover(gobj);
    return 0;
}

/***************************************************************
 *  Recent vs Frequent in the history popover (the choice is
 *  remembered in the browser).
 ***************************************************************/
function ac_history_sort(gobj, event, kw, src)
{
    let mode = (kw && kw.mode) || "time";
    gobj.priv.hist_sort = mode;
    kw_set_local_storage_value("console_hist_sort", mode);
    fill_hist_popover(gobj);
    return 0;
}

/***************************************************************
 *  Build a Tabulator table from a ycommand-style schema. Follows the
 *  treedb table convention: skip internal columns (id starting with
 *  '_') and fillspace==0 columns; boolean -> tickCross; integer/real
 *  -> right-aligned numeric.
 ***************************************************************/
function render_table(gobj, schema, data)
{
    let priv = gobj.priv;

    /*  Ticking rows narrows what Copy takes. `yui_copy_table_json()` has
     *  always copied the SELECTION when there is one and the whole screen
     *  otherwise — this table simply never had a way to make one, so the
     *  first half of that sentence was unreachable. `list-yunos` on a busy
     *  node answers forty rows, and the three you are looking at are the
     *  point of looking.
     *
     *  The bar carries no action: there is nothing to DO to an answer of the
     *  control center from here (it is a projection of what the agent said,
     *  not something this app owns). It says how many are ticked and offers
     *  the way out — the doing is the Copy button that was already there.  */
    priv.selection = yui_selection_bar(t, {
        name:     "CONSOLE",
        actions:  [],
        on_clear: () => gobj_send_event(gobj, "EV_CLEAR_SELECTION", {}, gobj)
    });
    priv.$data.appendChild(priv.selection.$el);

    let host = createElement2(["div", {class: "CONSOLE_RESPONSE_TABLE"}]);
    priv.$data.appendChild(host);

    priv.tabulator = new Tabulator(host, {
        ...yui_tabulator_lang(t),   /*  Tabulator's OWN chrome, in our language  */
        ...yui_selection_settings(),
        data:           data,
        layout:         "fitDataFill",
        columns:        [yui_selection_column()].concat(make_columns_from_schema(schema)),
        columnDefaults: {headerHozAlign: "left"},
        maxHeight:      "100%",
        placeholder:    "—"
    });
    /*  A tick is an OS notification like any other: it becomes an event. */
    yui_wire_selection(priv.tabulator, function(count) {
        if(gobj_is_destroying(gobj)) {
            return;
        }
        gobj_send_event(gobj, "EV_SELECTION_CHANGED", {count: count}, gobj);
    });

    /*  A table answer IS copyable — as the rows, in JSON. Without this
     *  the button stayed dead for every command that answers with a
     *  table (`top`, `list-yunos`…), which is most of them.  */
    set_copy_enabled(gobj, true);
}

/***************************************************************
 *  Mount the lazy JSON tree viewer (C_YUI_JSON) into CONSOLE_RESPONSE
 *  and feed it the answer.
 *
 *  No `subscriber`: the viewer publishes EV_EXPAND_PATH only for
 *  `kw_collapse()` sentinels, and an agent command answer arrives
 *  whole -- there is no path to re-issue, so there is nothing for us
 *  to answer. With no sentinels it is a plain collapsible tree.
 *
 *  No `title` either: the workspace tab already names the answer.
 ***************************************************************/
function render_json_view(gobj, data)
{
    let priv = gobj.priv;

    let jv = gobj_create_service(
        `console-json-${gobj_name(gobj)}`,
        "C_YUI_JSON",
        {},
        gobj
    );
    if(!jv) {
        log_error(`${gobj_short_name(gobj)}: cannot create the JSON viewer`);
        return;
    }
    priv.json_view = jv;
    gobj_start(jv);

    let $box = gobj_read_pointer_attr(jv, "$container");
    if(!$box) {
        log_error(`${gobj_short_name(gobj)}: the JSON viewer has no container`);
        destroy_json_view(gobj);
        return;
    }
    $box.classList.add("CONSOLE_RESPONSE_JSON");
    $box.style.height = "100%";
    $box.style.minHeight = "0";
    priv.$data.appendChild($box);

    gobj_send_event(jv, "EV_SET_JSON", {json: data}, gobj);

    /*  Keep the text the console's own copy button hands over: the
     *  viewer's toolbar copies what is expanded, this copies the answer. */
    try {
        priv.json_text = JSON.stringify(data, null, 4);
    } catch(e) {
        priv.json_text = null;
    }
    apply_console_font_size(gobj);
    set_copy_enabled(gobj, priv.json_text !== null);
}

/***************************************************************
 *  Drop the JSON viewer, if any. Paired with destroy_table() at
 *  every teardown point: a new answer, a pending command, mt_stop
 *  and mt_destroy.
 *
 *  STOPPED BEFORE DESTROYED. `render_json_view()` starts it, so
 *  destroying it straight away destroys a RUNNING gobj: the
 *  framework rescues it -- it stops it itself -- but it logs an
 *  error first, and that error is right. It said so on every
 *  second command of a console session, which is the shape of
 *  noise that makes a real error stop being read.
 ***************************************************************/
function destroy_json_view(gobj)
{
    let priv = gobj.priv;
    if(priv.json_view) {
        if(gobj_is_running(priv.json_view)) {
            gobj_stop_tree(priv.json_view);
        }
        gobj_destroy(priv.json_view);
        priv.json_view = null;
    }
    priv.json_text = null;
}

/***************************************************************
 *  Map a ycommand schema (cols with id/header/fillspace/type) to
 *  Tabulator column definitions.
 ***************************************************************/
function make_columns_from_schema(schema)
{
    let columns = [];
    for(let col of schema) {
        if(!col.id || col.id[0] === "_") {
            continue;   /*  internal / hidden column  */
        }
        if(col.fillspace === 0) {
            continue;   /*  explicitly hidden (ycommand: fillspace 0)  */
        }
        let colDef = {
            title: col.header || col.id,
            field: col.id
        };
        switch(col.type) {
            case "boolean":
                colDef.hozAlign = "center";
                colDef.sorter = "boolean";
                colDef.formatter = "tickCross";
                break;
            case "integer":
            case "real":
                colDef.hozAlign = "right";
                colDef.sorter = "number";
                colDef.formatter = cell_scalar_or_json;
                break;
            default:
                colDef.formatter = cell_scalar_or_json;
                break;
        }
        columns.push(colDef);
    }
    return columns;
}

/***************************************************************
 *  Tabulator cell formatter: scalars as text, objects/arrays as
 *  compact JSON (Tabulator can't render objects). HTML-escaped.
 ***************************************************************/
function cell_scalar_or_json(cell)
{
    let v = cell.getValue();
    if(v === null || v === undefined) {
        return "";
    }
    if(typeof v === "object") {
        return esc_html(JSON.stringify(v));
    }
    return esc_html(String(v));
}

/***************************************************************
 *  Minimal HTML escaping for values inserted as Tabulator cell HTML.
 ***************************************************************/
function esc_html(s)
{
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

/***************************************************************
 *  Destroy the current Tabulator instance, if any.
 ***************************************************************/
function destroy_table(gobj)
{
    let priv = gobj.priv;
    if(priv.tabulator) {
        try {
            priv.tabulator.destroy();
        } catch(e) {
            /*  already gone  */
        }
        priv.tabulator = null;
    }
    priv.selection = null;      /*  its DOM goes with the response area  */
}

/***************************************************************
 *  Parse `k=v` tokens (already quote-resolved by split_args) into a
 *  plain object. Tokens without '=' are ignored. First token (the
 *  command name) is expected to be sliced off by the caller.
 ***************************************************************/
function parse_kv(tokens)
{
    let params = {};
    for(let tok of tokens) {
        let eq = tok.indexOf("=");
        if(eq > 0) {
            params[tok.slice(0, eq)] = tok.slice(eq + 1);
        }
    }
    return params;
}

/***************************************************************
 *  Client-side shortkey management, mirroring ycli's local
 *  commands. These manage the browser-persistent {key: template}
 *  dict and never travel to the agent. Returns true if the line
 *  was a local command (and was handled), false otherwise.
 *
 *      shortkeys
 *      add-shortkey key=<k> command="<template>"
 *      remove-shortkey key=<k>
 ***************************************************************/
function handle_local_command(gobj, cmd)
{
    let tokens = split_args(cmd);
    if(tokens.length === 0) {
        return false;
    }
    let name = tokens[0];
    let config = gobj_read_attr(gobj, "config_svc");

    if(name === "shortkeys") {
        show_comment(gobj, "", 0);
        show_data(gobj, config ? agent_config_get_shortkeys(config) : {});
        return true;
    }

    if(name === "add-shortkey") {
        let params = parse_kv(tokens.slice(1));
        if(!params.key) {
            show_comment(gobj, t("missing key"), -1);
            return true;
        }
        if(!params.command) {
            show_comment(gobj, t("missing command"), -1);
            return true;
        }
        if(config) {
            agent_config_set_shortkey(config, params.key, params.command);
            show_data(gobj, agent_config_get_shortkeys(config));
            show_comment(gobj, "", 0);
        }
        return true;
    }

    if(name === "remove-shortkey") {
        let params = parse_kv(tokens.slice(1));
        if(!params.key) {
            show_comment(gobj, t("missing key"), -1);
            return true;
        }
        let removed = config ? agent_config_remove_shortkey(config, params.key) : false;
        if(removed) {
            show_data(gobj, agent_config_get_shortkeys(config));
            show_comment(gobj, "", 0);
        } else {
            show_comment(gobj, t("shortkey not found"), -1);
        }
        return true;
    }

    return false;
}

/***************************************************************
 *  Expand a shortkey (ycli parity). If the first token matches a
 *  configured shortkey, return its template with $1 $2 … replaced
 *  by the following positional args; otherwise return cmd unchanged.
 ***************************************************************/
function expand_shortkey(gobj, cmd)
{
    let config = gobj_read_attr(gobj, "config_svc");
    return apply_shortkey(config ? agent_config_get_shortkeys(config) : null, cmd);
}

/***************************************************************
 *  Send the typed command to the ACTIVE NODE's agent, routed by
 *  the control center: command-agent agent_id=<node> cmd2agent=<cmd>.
 ***************************************************************/
function send_command(gobj)
{
    let priv = gobj.priv;
    let cmd = priv.$input ? priv.$input.value.trim() : "";
    if(!cmd) {
        return;
    }

    /*  Like ycommand: the display mode is the persistent `display_mode`
     *  attr (default "table"); a leading '*' overrides it to "form" — the
     *  JSON tree — for this one command, which is how you look at a table
     *  answer as the JSON it really is. The '*' is a client-side flag —
     *  strip it before sending.  */
    let config = gobj_read_attr(gobj, "config_svc");
    let mode = config ? agent_config_get_display_mode(config) : "table";
    if(cmd.charAt(0) === "*") {
        mode = "form";
        cmd = cmd.slice(1).trim();
        if(!cmd) {
            return;
        }
    }

    /*  Local shortkey-management commands (ycli parity) are handled here and
     *  never sent to the agent — they don't need a connected node. Bump the
     *  request id too, so a remote answer still in flight can't later clobber
     *  the local command's output.  */
    if(handle_local_command(gobj, cmd)) {
        add_history(gobj, cmd);
        priv.hist_idx = -1;
        priv.req_seq += 1;
        return;
    }

    let link = gobj_read_attr(gobj, "link_svc");
    if(!link || !gobj_read_attr(gobj, "connected")) {
        show_comment(gobj, t("not connected to an agent"), -1);
        return;
    }

    let node = gobj_read_attr(gobj, "node") || "";
    if(!node) {
        show_comment(gobj, t("select a node"), -1);
        return;
    }

    add_history(gobj, cmd);   /*  recall shows what was typed (the shortkey)  */
    priv.hist_idx = -1;   /*  a sent command resets history-recall  */

    /*  Shortkey expansion (ycli parity): a leading token matching a
     *  configured shortkey expands to its template ($1 $2 … = args).  */
    cmd = expand_shortkey(gobj, cmd);

    show_comment(gobj, "", 0);   /*  clear any prior error comment  */
    show_pending(gobj);          /*  visible "running…" until the answer arrives  */

    /*  Bump the request id so any answer still in flight for a PREVIOUS
     *  command becomes stale and is dropped on arrival (see
     *  ac_mt_command_answer). Otherwise, typing a slow command then a fast
     *  one lets the slow one's late answer overwrite the fast one's.  */
    priv.req_seq += 1;

    /*  src defaults to the link service; the answer routes back there
     *  and is re-published to EVERY console panel.  The display mode, this
     *  panel's node id, and the request seq travel in __md_iev__ and are
     *  echoed back, so each panel renders only its own node's answer to its
     *  own latest command ([[__md_iev__ round-trip]] / ycommand parity).  */
    let kw_send = {agent_id: node, cmd2agent: cmd};
    msg_iev_write_key(kw_send, "display_mode", mode);
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_seq", String(priv.req_seq));
    agent_link_command(link, "command-agent", kw_send);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Identity card accepted — we are in session.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    gobj.priv.got_nak = false;
    let remote = `${kw.remote_yuno_role || ""}^${kw.remote_yuno_name || ""}`;
    set_status(gobj, true, `${t("connected")} · ${remote}`);
    ensure_commands_cache(gobj);
    return 0;
}

/***************************************************************
 *  Channel dropped after a real session.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    set_status(gobj, false, t("disconnected"));
    clear_pending(gobj);   /*  a command in flight will never answer now  */
    return 0;
}

/***************************************************************
 *  WebSocket never opened (bad cert / port closed / no backend).
 ***************************************************************/
function ac_on_open_error(gobj, event, kw, src)
{
    /*  A NAK (auth rejection) already set an informative status + the
     *  agent's reason, and is followed by this generic close. Don't
     *  clobber it — just consume the NAK and leave the status as-is. */
    if(gobj.priv.got_nak) {
        gobj.priv.got_nak = false;
        return 0;
    }
    set_status(gobj, false, t("disconnected"));
    clear_pending(gobj);
    show_comment(gobj,
        `${t("cannot connect")}: ${kw.url || ""} (${kw.reason || kw.code || ""})`, -1);
    return 0;
}

/***************************************************************
 *  Identity card refused (auth required / rejected).
 ***************************************************************/
function ac_on_id_nak(gobj, event, kw, src)
{
    gobj.priv.got_nak = true;
    set_status(gobj, false, t("authentication required"));
    clear_pending(gobj);
    show_comment(gobj, kw.comment || t("identity card refused"), -1);
    return 0;
}

/***************************************************************
 *  Effective display mode for an answer: the value echoed back in
 *  __md_iev__ (set when the command was sent) wins; otherwise fall
 *  back to the persistent `display_mode` attr.
 *
 *  "table" | "form" (JSON tree) | "raw" (the text as it arrived).
 ***************************************************************/
function answer_display_mode(gobj, kw)
{
    let mode = msg_iev_read_key(kw, "display_mode");
    if(!mode) {
        let config = gobj_read_attr(gobj, "config_svc");
        mode = config ? agent_config_get_display_mode(config) : "table";
    }
    return mode;
}

/***************************************************************
 *  Command answer. The shared link re-publishes every answer; only
 *  render our own command-agent results (the node picker handles
 *  list-agents). Filter by the command in the command_stack.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let command = kw_get_str(gobj, stk, "command", "", 0);

    /*  The Nodes panel's own list-agents fetch — not ours. A list-agents
     *  the operator TYPED went through send_command, so its answer echoes
     *  this panel's markers (console_seq/console_node) in __md_iev__; the
     *  picker's fetch carries none. Swallow only the unmarked ones — the
     *  node/seq filters below then vet the marked answer as usual.  */
    if(command === "list-agents") {
        if(!msg_iev_read_key(kw, "console_seq") || !msg_iev_read_key(kw, "console_node")) {
            return 0;
        }
    }

    /*  Answers tagged with a non-console purpose (e.g. the Stats view's
     *  own list-yunos / stats-yuno fetches) are not ours — the console's
     *  own commands carry no purpose, and its help-cache fetch uses
     *  "cache" (handled below). The marker round-trips in __md_iev__.  */
    let purpose = msg_iev_read_key(kw, "console_purpose");
    if(purpose && purpose !== "cache") {
        return 0;
    }

    /*  Multi-agent: each command echoes its origin node in __md_iev__;
     *  render only answers for THIS panel's node.  */
    let my_node = gobj_read_attr(gobj, "node") || "";
    let ans_node = msg_iev_read_key(kw, "console_node");
    if(my_node && ans_node && ans_node !== my_node) {
        return 0;
    }

    /*  Rapid-command race: a user command echoes its seq (send_command).
     *  Both the dispatch ack and the real answer of a superseded command
     *  carry an older seq — drop them so they can't overwrite the panel with
     *  a stale result. Answers without a seq (e.g. the help-cache fetch,
     *  handled next) are unaffected.  */
    let ans_seq = msg_iev_read_key(kw, "console_seq");
    if(ans_seq && ans_seq !== String(gobj.priv.req_seq)) {
        return 0;
    }

    /*  Command-cache fetch (a `help` sent by ensure_commands_cache):
     *  swallow the controlcenter dispatch ack (command === "command-agent")
     *  and parse the agent's real answer into the completion cache — never
     *  render either into the panel, not even a failed dispatch ack, since
     *  the user never issued this command.  */
    if(purpose === "cache") {
        if(command !== "command-agent") {
            load_commands_cache(gobj, kw.comment);
        }
        return 0;
    }

    /*  command-agent forwards cmd2agent to the agent and returns TWO
     *  answers: (1) the controlcenter's synchronous dispatch ack
     *  ("Command sent to N nodes"), and (2) the agent's asynchronous
     *  real answer, whose stack carries the INNER command we typed.
     *  Surface the ack only when the dispatch itself failed (no agent
     *  matched / not authorized) — on success just wait for (2).  */
    if(command === "command-agent") {
        if(typeof kw.result === "number" && kw.result < 0) {
            show_comment(gobj, kw.comment, kw.result);
            show_data(gobj, kw.data, kw.schema, answer_display_mode(gobj, kw), kw.comment, kw.result);
        }
        return 0;
    }

    /*  Anything else is the agent's real answer to our command.  */
    show_comment(gobj, kw.comment, kw.result);
    show_data(gobj, kw.data, kw.schema, answer_display_mode(gobj, kw), kw.comment, kw.result);
    return 0;
}






/***************************************************************
 *  The language changed (the shell publishes it): the answer table is a
 *  Tabulator — headers, paginator, placeholder and formatters are drawn ONCE,
 *  from t() at render time, and no data-i18n attribute reaches them.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    yui_tabulator_relocalize(priv.tabulator, t);
    if(priv.selection) {
        priv.selection.refresh();   /*  a count composed at render time  */
    }
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    return 0;
}



/***************************************************************
 *  The selection of the answer table changed: the bar says how many,
 *  and Copy takes those instead of the screen.
 ***************************************************************/
function ac_selection_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.selection) {
        priv.selection.set_count((kw && kw.count) || 0);
    }
    return 0;
}

/***************************************************************
 *  The way out of a selection.
 ***************************************************************/
function ac_clear_selection(gobj, event, kw, src)
{
    let priv = gobj.priv;
    yui_clear_selection(priv.tabulator);
    if(priv.selection) {
        priv.selection.set_count(0);
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
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,   null],
            ["EV_SELECTION_CHANGED", ac_selection_changed, null],
            ["EV_CLEAR_SELECTION",   ac_clear_selection,   null],
            ["EV_ON_OPEN",           ac_on_open,           null],
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_ON_OPEN_ERROR",     ac_on_open_error,     null],
            ["EV_ON_ID_NAK",         ac_on_id_nak,         null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
            ["EV_RUN_HISTORY",       ac_run_history,       null],
            ["EV_TIMEOUT",           ac_timeout,           null],
            /*  from the card: input row, popovers, status row  */
            ["EV_EXEC_COMMAND",      ac_exec_command,      null],
            ["EV_COMPLETE_COMMAND",  ac_complete_command,  null],
            ["EV_HISTORY_RECALL",    ac_history_recall,    null],
            ["EV_INPUT_CHANGED",     ac_input_changed,     null],
            ["EV_CLEAR",             ac_clear,             null],
            ["EV_COPY_RESPONSE",     ac_copy_response,     null],
            ["EV_FONT_SIZE",         ac_font_size,         null],
            ["EV_TOGGLE_POPOVER",    ac_toggle_popover,    null],
            ["EV_CLOSE_POPOVERS",    ac_close_popovers,    null],
            ["EV_INSERT_COMMAND",    ac_insert_command,    null],
            ["EV_ADD_SHORTKEY",      ac_add_shortkey,      null],
            ["EV_REMOVE_HISTORY",    ac_remove_history,    null],
            ["EV_HISTORY_SORT",      ac_history_sort,      null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_SELECTION_CHANGED", 0],
        ["EV_CLEAR_SELECTION",   0],
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_ON_OPEN_ERROR",     0],
        ["EV_ON_ID_NAK",         0],
        ["EV_MT_COMMAND_ANSWER", 0],
        ["EV_RUN_HISTORY",       0],
        ["EV_TIMEOUT",           0],
        ["EV_EXEC_COMMAND",      0],
        ["EV_COMPLETE_COMMAND",  0],
        ["EV_HISTORY_RECALL",    0],
        ["EV_INPUT_CHANGED",     0],
        ["EV_CLEAR",             0],
        ["EV_COPY_RESPONSE",     0],
        ["EV_FONT_SIZE",         0],
        ["EV_TOGGLE_POPOVER",    0],
        ["EV_CLOSE_POPOVERS",    0],
        ["EV_INSERT_COMMAND",    0],
        ["EV_ADD_SHORTKEY",      0],
        ["EV_REMOVE_HISTORY",    0],
        ["EV_HISTORY_SORT",      0]
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
function register_c_agent_console()
{
    return create_gclass(GCLASS_NAME);
}

export {
    register_c_agent_console,
    get_console_font_size,
    set_console_font_size,
    CONSOLE_FONT_SIZE_MIN,
    CONSOLE_FONT_SIZE_MAX,
};
