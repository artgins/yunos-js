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
    kw_get_str,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
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
    priv.copy_flash_timer = null;
    priv.tabulator = null;    /*  Tabulator instance for table-mode answers  */
    priv.commands = {};       /*  name -> {name, params[], desc} from `help`  */
    priv.commands_loaded = false;
    priv.pending = false;     /*  a command is in flight → CONSOLE_RESPONSE shows
                                  the "running…" placeholder; cleared when the
                                  answer renders or the link drops.  */
    priv.req_seq = 0;         /*  monotonic id of the latest user command; a
                                  command-agent answer echoes its seq in
                                  __md_iev__ so a late answer for a superseded
                                  command is dropped instead of overwriting the
                                  panel (rapid-command race).  */

    /*  Shell-style history recall (Up/Down): hist_idx walks priv.history
     *  (0 = most recent); -1 = editing the live line. hist_draft keeps the
     *  in-progress text so Down past the newest restores it.  */
    priv.hist_idx = -1;
    priv.hist_draft = "";
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
        return;   /*  empty-state panel: nothing to refresh  */
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
                ["div", {class: "has-text-grey has-text-centered", style: "max-width:32rem;"},
                    [
                        ["p", {class: "is-size-4 mb-2"},
                            [["span", {class: "icon is-large"}, [["i", {class: "yi-terminal"}]]]]],
                        ["p", {class: "is-size-5", i18n: "no consoles"},
                            "No consoles open"],
                        ["p", {class: "is-size-6 mt-2", i18n: "pick nodes hint"},
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
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    destroy_table(gobj);
    let priv = gobj.priv;
    if(priv.copy_flash_timer) {
        clearTimeout(priv.copy_flash_timer);
        priv.copy_flash_timer = null;
    }
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
        priv.history = agent_config_get_history(config0);
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
        keydown: (ev) => {
            if(ev.key === "Enter") {
                ev.preventDefault();
                send_command(gobj);
            } else if(ev.key === "Tab") {
                /*  Complete the command word to the unique match / common
                 *  prefix; only swallow Tab when it actually completes. */
                if(complete_command(gobj)) {
                    ev.preventDefault();
                }
            } else if(ev.key === "ArrowUp") {
                ev.preventDefault();
                recall_history(gobj, +1);   /*  older  */
            } else if(ev.key === "ArrowDown") {
                ev.preventDefault();
                recall_history(gobj, -1);   /*  newer / back to draft  */
            }
        },
        input: () => {
            priv.hist_idx = -1;   /*  typing leaves history-recall mode  */
            update_hint(gobj);
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
    $exec.addEventListener("click", () => send_command(gobj));

    /*  Clear as its OWN addon button (right of history), NOT an in-input ✕:
     *  on mobile the in-input ✕ sits under the typing thumb and gets tapped
     *  by accident. Wipes the command AND the response panel. */
    let $clear = createElement2(
        ["button", {class: "CONSOLE_CLEAR button", type: "button", title: t("clear")},
            [["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]]]]
    );
    $clear.addEventListener("click", () => clear_console(gobj));

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

    let $copy = createElement2(
        ["button", {class: "CONSOLE_COPY button is-small is-ghost", type: "button",
                    title: t("copy response")},
            [["span", {class: "icon is-small"}, [["i", {class: "yi-copy"}]]]]]
    );
    $copy.disabled = true;
    $copy.addEventListener("click", () => copy_response(gobj));
    priv.$copy = $copy;
    priv.$copy_icon = $copy.querySelector("i");

    let $status_row = createElement2(
        ["div", {class: "CONSOLE_STATUS_ROW",
                 style: "display:flex; align-items:center; gap:0.5rem;"},
            [$status, $copy]]
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
                    ["div", {class: "control"}, [$clear]],
                    ["div", {class: "control"}, [$exec]]
                ]],
                $hint,
                $status_row,
                $data,
                $comment
            ]
        ]
    );
    gobj_write_attr(gobj, "$container", $c);

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
            close_popovers(gobj);
        }
    };
    document.addEventListener("click", priv.doc_click);

    refresh_language($c, t);
}

/***************************************************************
 *  Push a command onto the in-memory history.
 ***************************************************************/
function add_history(gobj, cmd)
{
    let priv = gobj.priv;
    if(priv.history[0] === cmd) {
        return;
    }
    priv.history.unshift(cmd);
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
 *  it back. priv.history[0] is the most recent command.
 ***************************************************************/
function recall_history(gobj, dir)
{
    let priv = gobj.priv;
    if(!priv.$input || priv.history.length === 0) {
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
        text = priv.history[idx];
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
        ["div", {class: "dropdown-content", style: "max-height:22rem; overflow:auto;"}, []]
    );
    let $btn = createElement2(
        ["button", {class: "button", type: "button", "aria-haspopup": "true", title: title},
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
        toggle_popover(gobj, kind);
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
            ["div", {class: "dropdown-item has-text-grey", i18n: "no commands"}, t("no commands")]));
        return;
    }
    for(let name of names) {
        let cmd = priv.commands[name];
        let sig = (cmd && cmd.params && cmd.params.length)
            ? " " + cmd.params.map((p) => `[${p}]`).join(" ") : "";
        let $item = createElement2(
            ["a", {class: "dropdown-item is-family-monospace",
                   style: "white-space:normal;", title: (cmd && cmd.desc) ? cmd.desc : ""},
                [
                    ["span", {class: "has-text-weight-semibold"}, name],
                    ["span", {class: "has-text-grey"}, sig]
                ]
            ]
        );
        $item.addEventListener("click", (ev) => {
            ev.preventDefault();
            insert_command(gobj, name + " ");
        });
        $c.appendChild($item);
    }
}

/***************************************************************
 *  Fill the history popover: recent commands, most-recent first.
 *  Clicking inserts the full command line.
 ***************************************************************/
function fill_hist_popover(gobj)
{
    let priv = gobj.priv;
    let $c = priv.popovers.HIST && priv.popovers.HIST.content;
    if(!$c) {
        return;
    }
    $c.replaceChildren();
    if(priv.history.length === 0) {
        $c.appendChild(createElement2(
            ["div", {class: "dropdown-item has-text-grey", i18n: "no history yet"}, t("no history yet")]));
        return;
    }
    for(let cmd of priv.history) {
        let $item = createElement2(
            ["a", {class: "dropdown-item is-family-monospace", style: "white-space:normal;", title: cmd}, cmd]
        );
        $item.addEventListener("click", (ev) => {
            ev.preventDefault();
            insert_command(gobj, cmd);
        });
        $c.appendChild($item);
    }
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
 *  Render a command answer's payload into CONSOLE_RESPONSE.
 *
 *  Mirrors ycommand's display_webix_result mapped to the console:
 *    - array + table mode + schema  -> interactive Tabulator table
 *    - array + form/no-schema       -> raw JSON
 *    - object                       -> raw JSON
 *    - no data but a (non-error)    -> paint the comment; this is how
 *      comment (e.g. `help`)           `help` arrives: text in comment,
 *                                       data + schema null.
 *  Errors keep their short comment in the CONSOLE_COMMENT line.
 ***************************************************************/
function show_data(gobj, data, schema, raw, comment, result)
{
    let priv = gobj.priv;
    if(!priv.$data) {
        return;
    }
    priv.pending = false;   /*  a real render supersedes the "running…" state  */

    /*  Tear down any previous table + content.  */
    destroy_table(gobj);
    priv.$data.replaceChildren();
    set_copy_enabled(gobj, false);   /*  no CONSOLE_RESPONSE_TEXT to copy yet  */

    /*  Table mode: array payload + schema -> Tabulator.  */
    if(!raw && Array.isArray(data) && Array.isArray(schema) && schema.length) {
        render_table(gobj, schema, data);
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
                text = JSON.stringify(data, null, 2);
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
                        "font-size:12px; padding:0.5rem;"},
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
    if(priv.copy_flash_timer) {
        clearTimeout(priv.copy_flash_timer);
        priv.copy_flash_timer = null;
    }
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
    let pre = priv.$data ? priv.$data.querySelector(".CONSOLE_RESPONSE_TEXT") : null;
    let text = pre ? pre.textContent : "";
    if(!text) {
        return;
    }
    if(navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            flash_copied(gobj);
        }).catch(() => {
            if(legacy_copy(text)) {
                flash_copied(gobj);
            }
        });
    } else if(legacy_copy(text)) {
        flash_copied(gobj);
    }
}

/***************************************************************
 *  Clipboard fallback: a hidden textarea + execCommand("copy").
 *  Returns true if the copy command was accepted.
 ***************************************************************/
function legacy_copy(text)
{
    let ok = false;
    try {
        let ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
    } catch(e) {
        ok = false;
    }
    return ok;
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
    if(priv.copy_flash_timer) {
        clearTimeout(priv.copy_flash_timer);
    }
    priv.copy_flash_timer = setTimeout(() => {
        priv.copy_flash_timer = null;
        if(priv.$copy) {
            priv.$copy.classList.remove("has-text-success");
        }
        if(priv.$copy_icon) {
            priv.$copy_icon.className = "yi-copy";
        }
    }, 1200);
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
    let host = createElement2(["div", {class: "CONSOLE_RESPONSE_TABLE"}]);
    priv.$data.appendChild(host);

    priv.tabulator = new Tabulator(host, {
        data:           data,
        layout:         "fitDataFill",
        columns:        make_columns_from_schema(schema),
        columnDefaults: {headerHozAlign: "left"},
        maxHeight:      "100%",
        placeholder:    "—"
    });
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
}

/***************************************************************
 *  Split a command line into tokens, shell-style: whitespace
 *  separates, single/double quotes are removable delimiters that
 *  may appear anywhere in a token (so `command="a b"` is ONE token
 *  `command=a b`). Used to pick the shortkey / its positional args
 *  and to parse the local shortkey-management commands.
 ***************************************************************/
function split_args(s)
{
    let tokens = [];
    let cur = "";
    let has = false;      /*  saw a char (even in empty quotes) → emit a token  */
    let quote = null;
    for(let i = 0; i < s.length; i++) {
        let ch = s[i];
        if(quote) {
            if(ch === quote) {
                quote = null;
            } else {
                cur += ch;
            }
            has = true;
        } else if(ch === "\"" || ch === "'") {
            quote = ch;
            has = true;
        } else if(ch === " " || ch === "\t") {
            if(has) {
                tokens.push(cur);
                cur = "";
                has = false;
            }
        } else {
            cur += ch;
            has = true;
        }
    }
    if(has) {
        tokens.push(cur);
    }
    return tokens;
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
    let shortkeys = config ? agent_config_get_shortkeys(config) : null;
    if(!shortkeys) {
        return cmd;
    }
    let tokens = split_args(cmd);
    if(tokens.length === 0) {
        return cmd;
    }
    let key = tokens[0];
    if(!Object.prototype.hasOwnProperty.call(shortkeys, key)) {
        return cmd;
    }
    let out = shortkeys[key];
    let args = tokens.slice(1);
    /*  Replace $N high-to-low so $1 never clobbers $10, $11, …  */
    for(let i = args.length; i >= 1; i--) {
        out = out.split("$" + i).join(args[i - 1]);
    }
    return out;
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
     *  attr (default "table"); a leading '*' overrides it to "form" (raw
     *  JSON) for this one command. The '*' is a client-side flag — strip
     *  it before sending.  */
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
 *  back to the persistent `display_mode` attr. "form" => raw JSON.
 ***************************************************************/
function answer_is_raw(gobj, kw)
{
    let mode = msg_iev_read_key(kw, "display_mode");
    if(!mode) {
        let config = gobj_read_attr(gobj, "config_svc");
        mode = config ? agent_config_get_display_mode(config) : "table";
    }
    return mode === "form";
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
            show_data(gobj, kw.data, kw.schema, answer_is_raw(gobj, kw), kw.comment, kw.result);
        }
        return 0;
    }

    /*  Anything else is the agent's real answer to our command.  */
    show_comment(gobj, kw.comment, kw.result);
    show_data(gobj, kw.data, kw.schema, answer_is_raw(gobj, kw), kw.comment, kw.result);
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
            ["EV_ON_OPEN",           ac_on_open,           null],
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_ON_OPEN_ERROR",     ac_on_open_error,     null],
            ["EV_ON_ID_NAK",         ac_on_id_nak,         null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_ON_OPEN_ERROR",     0],
        ["EV_ON_ID_NAK",         0],
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
function register_c_agent_console()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_console};
