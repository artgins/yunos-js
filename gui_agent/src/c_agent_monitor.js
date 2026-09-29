/***********************************************************************
 *          c_agent_monitor.js
 *
 *      C_AGENT_MONITOR — the live view of the Scenarios workspace: the
 *      yunos of one scenario, live. Two ways to show them (`view.mode`
 *      of the scenario, switchable here):
 *        - GRAPH: the yunos in the order the messages flow (left to
 *          right), each card with its cpu %, its messages per second in
 *          and out, its queue when it has one and what the agent says of
 *          it (playing, paused, stopped...); and under it two CHARTS,
 *          messages per second and cpu, over a window of history.
 *        - CARDS: every counter of every yuno, one card each -- what the
 *          Statistics workspace was before it became a kind of scenario.
 *
 *      What it watches is a SCENARIO (monitor_helpers.js): where the
 *      yunos are, the yunos, the links between them and the commands of
 *      its actions. The one watched is kept in C_AGENT_CONFIG
 *      (`monitor_scenario`) with where it came from (`monitor_source`):
 *        - "saved": one the CONTROL CENTER keeps, opened from the list
 *          (C_SCENARIOS) or saved from here (`save-scenario`);
 *        - "selection": the yunos ticked in the tree tab, as cards
 *          (C_AGENT_CONFIG turns the ticks into it);
 *        - "local": written here and kept in this browser only -- a
 *          control center older than 7.25.14 keeps none.
 *      This view follows that setting (EV_MONITOR_SCENARIO_CHANGED):
 *      the list, the tree and its own editor all change the scenario by
 *      writing it there, and the view adopts whatever is written.
 *
 *      TRANSPORT, one of two, chosen by the scenario:
 *        - `agent_url`: the agent of the node under test DIRECTLY
 *          (C_MONITOR_LINK, wss://<node>:1993): one hop, one node.
 *        - `node`: through the CONTROL CENTER, on the console's own link
 *          (C_AGENT_LINK), each command wrapped in `command-agent
 *          agent_id=<node>` -- so one scenario can span several nodes, and
 *          no token has to leave the BFF. That link is SHARED with the
 *          other workspaces: the view subscribes to it only while it
 *          connects or monitors, lets through only the answers it tagged,
 *          and skips the control center's dispatch acks (a frame whose
 *          command is `command-agent`), acting on one only when the
 *          dispatch itself failed.
 *      Each reading is a `list-yunos` per node plus, per yuno, two
 *      `stats-yuno`: `service=__yuno__` for its cpu (computed by the yuno
 *      itself every second) and its own service for its message counters.
 *      Every parameter travels IN the command line (monitor_helpers.js
 *      says why), and every request is tagged in __md_iev__
 *      (monitor_kind, monitor_yuno = the yuno's key, monitor_node), which
 *      the agent and the control center echo, so each answer finds its
 *      card.
 *
 *      LINKS PROPOSED. While monitoring, the scenario editor can ask every
 *      yuno for its `view-config` and propose the `links` from what they
 *      listen on and connect to (derive_links). It rewrites the links of
 *      the text being edited and nothing else: the operator reads them
 *      and saves, or not.
 *
 *      PUSHED, OR POLLED -- per node. The view asks each agent for a
 *      `watch-yuno-stats` (its yunos, the period) and the agent SENDS the
 *      readings as EV_YUNO_STATS -- state, cpu and service stats of each
 *      yuno -- every `monitor_refresh` seconds, until the session ends,
 *      the view asks it to stop (a hidden tab does) or the watch is not
 *      renewed within its ttl (the view renews it every ttl/3: behind a
 *      control center the agent never sees the browser leave). Through
 *      the control center the events come back relayed by it. An agent
 *      that does not know the command (older than 7.25.13), or a control
 *      center that does not relay the event, answers the watch with an
 *      error and the view POLLS that node: per tick a `list-yunos` and
 *      two `stats-yuno` per yuno, the DELIBERATE exception to the
 *      no-polling rule approved for this view on 2026-09-29. Either way a
 *      periodic C_TIMER closes each period into a row of the history
 *      (and sends the requests of the polled nodes); it runs only in
 *      ST_MONITORING and while this tab is the visible one. Each pushed
 *      event names its node by the `monitor_node` the watch was tagged
 *      with, which the agent keeps in the route it sends along.
 *
 *      RATES. A yuno's own `rxMsgsec`/`txMsgsec` is used when its service
 *      reports one (an application service computes it on its own
 *      timer); otherwise the rate comes from the `rxMsgs`/`txMsgs`
 *      counters and a monotonic clock. The chart plots, per yuno, the
 *      direction the scenario names as its throughput (`rate`).
 *
 *      ACTIONS. A scenario that declares actions gets their controls:
 *      start, pause, resume, stop, report -- each a list of steps, a
 *      command to one yuno of the scenario -- and restart (stop, every
 *      yuno asked to zero its counters with `stats-yuno stats=__reset__`
 *      -- only a service that honours the reset does it -- the history
 *      cleared, start). Each asks for confirmation first and shows the
 *      commands it will send; stop and restart in red. Only in
 *      ST_MONITORING: a control confirmed after the link went down is
 *      refused, not queued. A scenario the control center keeps is RUN
 *      by the control center (`run-scenario`): the steps one after the
 *      other, and the run written with the answer of every step, which
 *      the Runs button lists. Any other one is run from here, every step
 *      sent at once. What a `report` answers is shown in a dialog.
 *      A control is one at a time: its buttons are off while it runs,
 *      every request of it carries its number (`monitor_seq`) and its
 *      phase, and an answer of another one is dropped. A restart goes
 *      in PHASES, each waiting for every answer of the one before: stop,
 *      the counters to zero, start -- a phase that fails ends it there.
 *      A control run from here that is not answered in time, or whose
 *      link drops, is said so instead of staying "running".
 *
 *      GENERATIONS. Every request carries the generation of the scenario
 *      shown (`monitor_gen`, bumped when another one is adopted): a
 *      reading asked for the one before, or pushed by its watch, is
 *      dropped instead of landing on a card of the same key.
 *
 *      States:
 *          ST_DISCONNECTED  no link (no scenario, or the user left).
 *          ST_CONNECTING    the link is being made, or is retrying.
 *          ST_MONITORING    in session: readings on the clock.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA,
    SDATA_END,
    data_type_t,
    gclass_create,
    log_error,
    log_warning,
    gobj_parent,
    gobj_name,
    gobj_short_name,
    gobj_read_attr,
    gobj_read_pointer_attr,
    gobj_write_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_send_event,
    gobj_create_pure_child,
    gobj_find_service,
    gobj_current_state,
    gobj_change_state,
    gobj_destroy,
    gobj_is_running,
    gobj_stop,
    set_timeout_periodic,
    clear_timeout,
    createElement2,
    refresh_language,
    msg_iev_write_key,
    msg_iev_read_key,
    msg_iev_get_stack,
    kw_get_str,
} from "@yuneta/gobj-js";

import i18next, {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {
    yui_shell_confirm_yesno,
    yui_shell_confirm_danger,
    yui_shell_show_modal,
} from "@yuneta/gobj-ui/src/shell_modals.js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    agent_config_get_monitor,
    agent_config_set_monitor,
    MONITOR_REFRESH_CHOICES,
    MONITOR_WINDOW_CHOICES,
} from "./c_agent_config.js";
import {esc, fmt_value} from "./agent_helpers.js";
import {
    SCENARIO_TEMPLATE,
    scenario_controls,
    action_steps,
    scenario_document,
    cc_lacks_command,
    lines,
    scenario_nodes,
    derive_links,
    parse_scenario,
    validate_scenario,
    layout_graph,
    pick_rate,
    prune_history,
    cpu_level,
    yuno_run_state,
    fmt_rate,
} from "./monitor_helpers.js";

/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_MONITOR";

const CARD_W = 208;
const CARD_H = 148;
const CHART_H = 220;
const SVG_NS = "http://www.w3.org/2000/svg";

/*  One shape per meaning: start and resume are two different actions.  */
const CONTROL_ICONS = {
    start:   "yi-play",
    pause:   "yi-pause",
    resume:  "yi-forward-step",
    stop:    "yi-square",
    report:  "yi-circle-info",
    restart: "yi-arrows-rotate"
};

/*  The kinds of the requests this view makes of the control center
 *  itself (not of an agent): answered in any state.  */
const CC_KINDS = ["cc_save", "cc_delete", "cc_runs", "cc_run"];

const DANGEROUS_CONTROLS = ["stop", "restart"];

/***************************************************************
 *              Data
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,       "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",        0,  "scenario", "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",   0,  null,       "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",     0,  null,       "C_MONITOR_LINK service (direct)"),
SDATA(data_type_t.DTP_POINTER,  "cc_link_svc",  0,  null,       "C_AGENT_LINK service (control center)"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",   0,  null,       "C_AGENT_CONFIG service"),
SDATA_END()
];

let PRIVATE_DATA = {
    gobj_timer:     null,
    scenario:       null,   /*  validated scenario, or null  */
    source:         "local", /*  where it comes from: local | saved | selection  */
    view_mode:      "graph", /*  graph | cards: the scenario's, switchable here  */
    cc_scenarios:   null,   /*  the control center keeps scenarios: true / false / null (not known)  */
    cc_run:         null,   /*  a run of the control center in flight: {control, phase}  */
    stats_cards:    {},     /*  yuno key -> element refs of its card in cards mode  */
    pending_save:   null,   /*  the scenario a save-scenario in flight writes  */
    model:          {},     /*  yuno key -> live figures (see new_model)  */
    rows:           [],     /*  history rows {tm, "cpu:<key>", "rate:<key>"}  */
    last_tick:      0,      /*  performance.now() of the previous reading  */
    last_update:    0,      /*  Date.now() of the last answer  */
    error:          null,   /*  {key, detail} shown in the status line  */
    visible:        true,
    editing:        false,
    rate_chart:     null,
    cpu_chart:      null,
    cards:          {},     /*  yuno key -> element refs of its card  */
    edge_labels:    [],     /*  [{from, to, $text}]  */
    control:        null,   /*  last control: {control, ok, text}  */
    control_buttons: {},    /*  control -> its button  */
    watching:       null,   /*  the link whose events reach this view  */
    push:           {},     /*  node -> the agent pushes: null = asked, not answered yet  */
    watch_renew_ms: 20000,  /*  renew a watch this often (ttl / 3 of the agent's answer)  */
    watch_sent_at:  0,      /*  performance.now() of the last watch sent  */
    discovery:      null,   /*  {pending: {key: true}, configs: {key: config}, failed: [key]}  */
    generation:     0,      /*  of the scenario shown: tags every request  */
    control_seq:    0,      /*  number of the last control sent  */
};

/*  How long a phase of a control run from here waits for its answers.  */
const CONTROL_PHASE_MS = 30000;

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

    /*
     *  Create children
     */
    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);

    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    /*  The two transports. Neither is subscribed here: the one the
     *  scenario uses is, while connecting or monitoring (watch_link).  */
    gobj_write_attr(gobj, "link_svc", gobj_find_service("monitor_link", true));
    gobj_write_attr(gobj, "cc_link_svc", gobj_find_service("agent_link", true));
    let config = gobj_find_service("agent_config", true);
    gobj_write_attr(gobj, "config_svc", config);

    let settings = config ? agent_config_get_monitor(config) : {scenario: null, source: "local"};
    if(settings.scenario) {
        let r = validate_scenario(settings.scenario);
        if(r.ok) {
            priv.scenario = r.scenario;
            priv.source = settings.source;
            priv.view_mode = r.scenario.view.mode;
        } else {
            log_warning(`${gobj_short_name(gobj)}: the saved scenario is not valid ` +
                `(${r.error.key} ${r.error.detail}), ignored`);
        }
    }

    reset_model(gobj);

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} MONITOR_VIEW view-card`}, []]
    );
    gobj_write_attr(gobj, "$container", $c);
    build_dom(gobj);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    gobj_start_charts(gobj);
    render_all(gobj);
    watch_visibility(gobj);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    /*  What the list, the tree and the editor write is what this view
     *  shows; and the answers of the control center's own commands
     *  (save, delete, runs, run) come on the console's link whatever the
     *  scenario's transport, so that one is listened to always.  */
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        gobj_subscribe_event(config, "EV_MONITOR_SCENARIO_CHANGED", {}, gobj);
    }
    let cc_link = gobj_read_attr(gobj, "cc_link_svc");
    if(cc_link) {
        gobj_subscribe_event(cc_link, "EV_MT_COMMAND_ANSWER", {}, gobj);
    }

    /*  A dashboard shows: with a scenario, connect at once.  */
    if(priv.scenario) {
        gobj_send_event(gobj, "EV_CONNECT", {}, gobj);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    if(gobj_current_state(gobj) === "ST_MONITORING" && priv.scenario) {
        send_unwatch(gobj);
    }
    let was_direct = priv.watching && priv.watching.place === "direct";
    watch_link(gobj, null);
    if(was_direct) {
        gobj_send_event(gobj_read_attr(gobj, "link_svc"), "EV_DISCONNECT", {}, gobj);
    }
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
    }
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        gobj_unsubscribe_event(config, "EV_MONITOR_SCENARIO_CHANGED", {}, gobj);
    }
    let cc_link = gobj_read_attr(gobj, "cc_link_svc");
    if(cc_link) {
        gobj_unsubscribe_event(cc_link, "EV_MT_COMMAND_ANSWER", {}, gobj);
    }
    /*  The charts are hosted children: retire them here, not in
     *  mt_destroy (the framework destroys children first).  */
    destroy_charts(gobj);
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

function show($el, on)
{
    if($el) {
        $el.classList.toggle("is-hidden", !on);
    }
}

/***************************************************************
 *  A control: its visible label hides on a phone, the title and
 *  aria-label name it everywhere.
 ***************************************************************/
function tool_button(cls, icon, key, event, gobj, with_label)
{
    let children = [["span", {class: "icon"}, [["i", {class: icon}]]]];
    if(with_label) {
        children.push(["span", {class: "is-hidden-mobile", i18n: key}, t(key)]);
    }
    return createElement2(
        ["button", {class: `${cls} button`, type: "button",
                    title: t(key), "data-i18n-title": key,
                    "aria-label": t(key), "data-i18n-aria-label": key},
            children,
            {click: () => gobj_send_event(gobj, event, {}, gobj)}]
    );
}

function tool_select(cls, key, choices, unit, value, event, gobj)
{
    /*  An option's text is a number and a unit: it cannot carry a key,
     *  so relabel_select() writes it again when the language changes.  */
    let $sel = createElement2(
        ["select", {class: cls, "data-unit": unit,
                    title: t(key), "data-i18n-title": key,
                    "aria-label": t(key), "data-i18n-aria-label": key},
            choices.map((v) => ["option", {value: String(v)}, `${v} ${t(unit)}`]),
            {change: (e) => gobj_send_event(gobj, event,
                {value: parseInt(e.target.value, 10)}, gobj)}]
    );
    $sel.value = String(value);
    return $sel;
}

function relabel_select($sel)
{
    let unit = $sel.getAttribute("data-unit") || "";
    for(let $o of $sel.options) {
        $o.textContent = `${$o.value} ${t(unit)}`;
    }
}

/***************************************************************
 *  The static skeleton: toolbar, status line, scenario editor,
 *  empty notice, graph and the two chart blocks.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    let config = gobj_read_attr(gobj, "config_svc");
    let settings = config ? agent_config_get_monitor(config) : {refresh: 2, window: 15};

    priv.$name = createElement2(["span", {class: "MONITOR_NAME has-text-weight-semibold"}, ""]);
    priv.$source = createElement2(["span", {class: "MONITOR_SOURCE tag is-light"}, ""]);
    priv.$state = createElement2(["span", {class: "MONITOR_STATE tag"}, ""]);
    priv.$connect = tool_button("MONITOR_CONNECT is-primary", "yi-plug", "monitor connect",
        "EV_CONNECT", gobj, true);
    priv.$disconnect = tool_button("MONITOR_DISCONNECT", "yi-plug-slash", "monitor disconnect",
        "EV_DISCONNECT", gobj, true);
    priv.$refresh = tool_select("MONITOR_REFRESH", "monitor refresh",
        MONITOR_REFRESH_CHOICES, "unit seconds short", settings.refresh, "EV_SET_REFRESH", gobj);
    priv.$window = tool_select("MONITOR_WINDOW", "monitor window",
        MONITOR_WINDOW_CHOICES, "unit minutes short", settings.window, "EV_SET_WINDOW", gobj);
    priv.$clear = tool_button("MONITOR_CLEAR", "yi-broom", "monitor clear history",
        "EV_CLEAR_HISTORY", gobj, false);
    priv.$edit = tool_button("MONITOR_EDIT", "yi-pen", "monitor scenario",
        "EV_EDIT_SCENARIO", gobj, true);
    priv.$new = tool_button("MONITOR_NEW", "yi-plus", "scenario new",
        "EV_NEW_SCENARIO", gobj, false);
    priv.$runs = tool_button("MONITOR_RUNS", "yi-calendar-days", "scenario runs",
        "EV_SHOW_RUNS", gobj, false);
    priv.$delete = tool_button("MONITOR_DELETE is-danger is-outlined", "yi-trash", "scenario delete",
        "EV_DELETE_SCENARIO", gobj, false);
    /*  An <option> is text: it carries its key, and its value stays
     *  explicit, or a translated option would name a mode that is not.  */
    priv.$mode = createElement2(
        ["select", {class: "MONITOR_MODE",
                    title: t("scenario view"), "data-i18n-title": "scenario view",
                    "aria-label": t("scenario view"), "data-i18n-aria-label": "scenario view"},
            [["option", {value: "graph", i18n: "scenario view graph"}, t("scenario view graph")],
             ["option", {value: "cards", i18n: "scenario view cards"}, t("scenario view cards")]],
            {change: (e) => gobj_send_event(gobj, "EV_SET_VIEW_MODE", {mode: e.target.value}, gobj)}]
    );
    priv.$mode.value = priv.view_mode;

    let $toolbar = createElement2(
        ["div", {class: "MONITOR_TOOLBAR"}, [
            ["div", {class: "MONITOR_TITLE"}, [priv.$name, priv.$source, priv.$state]],
            ["div", {class: "MONITOR_TOOLS"}, [
                priv.$connect,
                priv.$disconnect,
                ["div", {class: "select"}, [priv.$mode]],
                ["div", {class: "select"}, [priv.$refresh]],
                ["div", {class: "select"}, [priv.$window]],
                priv.$clear,
                priv.$edit,
                priv.$new,
                priv.$runs,
                priv.$delete
            ]]
        ]]
    );

    priv.$url = createElement2(["span", {class: "MONITOR_URL"}, [
        ["span", {class: "MONITOR_URL_VIA"}, ""],
        ["span", {class: "MONITOR_URL_WHERE is-family-monospace"}, ""]
    ]]);
    priv.$updated = createElement2(["span", {class: "MONITOR_UPDATED"}, [
        ["span", {i18n: "monitor updated"}, t("monitor updated")],
        ["span", {class: "MONITOR_UPDATED_TIME is-family-monospace"}, ""]
    ]]);
    priv.$updated_time = priv.$updated.querySelector(".MONITOR_UPDATED_TIME");
    priv.$error = createElement2(["span", {class: "MONITOR_ERROR has-text-danger"}, [
        ["span", {class: "MONITOR_ERROR_TEXT"}, ""],
        ["span", {class: "MONITOR_ERROR_DETAIL is-family-monospace"}, ""]
    ]]);
    let $status = createElement2(
        ["div", {class: "MONITOR_STATUS is-size-7"}, [priv.$url, priv.$updated, priv.$error]]
    );

    /*  Test controls: filled from the scenario's test block.  */
    priv.$test_buttons = createElement2(["div", {class: "MONITOR_TEST_BUTTONS"}, []]);
    priv.$control_details = tool_button("MONITOR_CONTROL_DETAILS", "yi-circle-info",
        "scenario action answers", "EV_SHOW_OUTPUT", gobj, false);
    priv.$control = createElement2(["span", {class: "MONITOR_CONTROL is-size-7"}, [
        ["span", {class: "MONITOR_CONTROL_NAME has-text-weight-semibold"}, ""],
        ["span", {class: "MONITOR_CONTROL_TEXT is-family-monospace"}, ""],
        priv.$control_details
    ]]);
    priv.$test = createElement2(
        ["div", {class: "MONITOR_TEST"}, [
            ["span", {class: "MONITOR_TEST_LABEL tag is-warning is-light", i18n: "scenario actions"},
                t("scenario actions")],
            priv.$test_buttons,
            priv.$control
        ]]
    );

    /*  Scenario editor.  */
    priv.$text = createElement2(
        ["textarea", {class: "MONITOR_SCENARIO_TEXT textarea is-family-monospace is-size-7",
                      rows: 14, spellcheck: "false",
                      title: t("monitor scenario json"), "data-i18n-title": "monitor scenario json",
                      "aria-label": t("monitor scenario json"),
                      "data-i18n-aria-label": "monitor scenario json"}, ""]
    );
    priv.$edit_error = createElement2(["p", {class: "MONITOR_SCENARIO_ERROR has-text-danger is-size-7"}, [
        ["span", {class: "MONITOR_SCENARIO_ERROR_TEXT"}, ""],
        ["span", {class: "MONITOR_SCENARIO_ERROR_DETAIL is-family-monospace"}, ""]
    ]]);
    let $save = createElement2(
        ["button", {class: "MONITOR_SCENARIO_SAVE button is-primary", type: "button",
                    title: t("save"), "data-i18n-title": "save",
                    "aria-label": t("save"), "data-i18n-aria-label": "save"},
            [["span", {class: "icon"}, [["i", {class: "yi-floppy-disk"}]]],
             ["span", {i18n: "save"}, t("save")]],
            {click: () => gobj_send_event(gobj, "EV_SAVE_SCENARIO",
                {text: priv.$text.value}, gobj)}]
    );
    let $cancel = tool_button("MONITOR_SCENARIO_CANCEL", "yi-xmark", "cancel",
        "EV_CANCEL_EDIT", gobj, true);
    priv.$propose = tool_button("MONITOR_PROPOSE_LINKS", "yi-link", "monitor propose links",
        "EV_PROPOSE_LINKS", gobj, true);
    priv.$propose_status = createElement2(["p", {class: "MONITOR_PROPOSE_STATUS is-size-7"}, [
        ["span", {class: "MONITOR_PROPOSE_TEXT"}, ""],
        ["span", {class: "MONITOR_PROPOSE_DETAIL is-family-monospace"}, ""]
    ]]);
    priv.$editor = createElement2(
        ["div", {class: "MONITOR_EDITOR box"}, [
            ["p", {class: "MONITOR_EDITOR_HELP is-size-7 mb-2", i18n: "monitor scenario help"},
                t("monitor scenario help")],
            priv.$text,
            priv.$edit_error,
            priv.$propose_status,
            ["div", {class: "MONITOR_EDITOR_ACTIONS buttons is-right mt-2"}, [priv.$propose, $cancel, $save]]
        ]]
    );

    priv.$empty = createElement2(
        ["div", {class: "MONITOR_EMPTY notification is-light"}, [
            ["p", {i18n: "scenario none watched"}, t("scenario none watched")]
        ]]
    );

    priv.$graph = createElement2(["div", {class: "MONITOR_GRAPH"}, []]);
    priv.$cards = createElement2(["div", {class: "MONITOR_CARDS"}, []]);

    priv.$rate_box = createElement2(["div", {class: "MONITOR_CHART_BODY"}, []]);
    priv.$cpu_box = createElement2(["div", {class: "MONITOR_CHART_BODY"}, []]);
    priv.$charts = createElement2(
        ["div", {class: "MONITOR_CHARTS"}, [
            ["div", {class: "MONITOR_CHART MONITOR_CHART_RATE box"}, [
                ["p", {class: "MONITOR_CHART_TITLE", i18n: "monitor messages per second"},
                    t("monitor messages per second")],
                priv.$rate_box
            ]],
            ["div", {class: "MONITOR_CHART MONITOR_CHART_CPU box"}, [
                ["p", {class: "MONITOR_CHART_TITLE", i18n: "monitor cpu of one core"},
                    t("monitor cpu of one core")],
                priv.$cpu_box
            ]]
        ]]
    );

    $c.appendChild($toolbar);
    $c.appendChild($status);
    $c.appendChild(priv.$test);
    $c.appendChild(priv.$editor);
    $c.appendChild(priv.$empty);
    $c.appendChild(priv.$graph);
    $c.appendChild(priv.$cards);
    $c.appendChild(priv.$charts);
}

/***************************************************************
 *  The live figures of one yuno.
 ***************************************************************/
function new_model()
{
    return {
        run:        "unknown",  /*  yuno_run_state()  */
        cpu:        null,
        cpu_t:      0,          /*  performance.now() of the answer  */
        rx:         null,
        tx:         null,
        queue:      null,
        data:       null,       /*  the service stats, whole (cards mode)  */
        app_t:      0,
        prev_rx:    null,
        prev_tx:    null,
        errors:     {cpu: null, app: null}  /*  {key} or {text} per reading kind  */
    };
}

function reset_model(gobj)
{
    let priv = gobj.priv;
    priv.model = {};
    priv.rows = [];
    priv.last_tick = 0;
    if(priv.scenario) {
        for(let y of priv.scenario.yunos) {
            priv.model[y.key] = new_model();
        }
    }
}

/***************************************************************
 *  The charts: one series per yuno, rebuilt with the scenario.
 ***************************************************************/
function destroy_charts(gobj)
{
    let priv = gobj.priv;
    for(let k of ["rate_chart", "cpu_chart"]) {
        let ch = priv[k];
        if(ch) {
            priv[k] = null;
            if(gobj_is_running(ch)) {
                gobj_stop(ch);
            }
            gobj_destroy(ch);
        }
    }
    clear_node(priv.$rate_box);
    clear_node(priv.$cpu_box);
}

function gobj_start_charts(gobj)
{
    let priv = gobj.priv;
    destroy_charts(gobj);
    if(!priv.scenario) {
        return;
    }
    /*  Both charts start at zero: a rate or a cpu drawn from its own
     *  minimum turns a flat line into a cliff.  */
    let from_zero = {y: {range: (u, min, max) => [0, max > 0 ? max * 1.1 : 1]}};
    let make = (name, $box, prefix) => {
        let $host = createElement2(["div", {class: "MONITOR_CHART_HOST"}, []]);
        $box.appendChild($host);
        let chart = gobj_create_pure_child(name, "C_YUI_UPLOT", {
            $container: $host,
            width:      600,
            height:     CHART_H,
            scales:     from_zero
        }, gobj);
        for(let y of priv.scenario.yunos) {
            gobj_send_event(chart, "EV_ADD_SERIE", {id: prefix + y.key, label: y.label}, gobj);
        }
        return chart;
    };
    priv.rate_chart = make("rate_chart", priv.$rate_box, "rate:");
    priv.cpu_chart = make("cpu_chart", priv.$cpu_box, "cpu:");
    load_charts(gobj);
}

function load_charts(gobj)
{
    let priv = gobj.priv;
    if(!priv.rows.length) {
        return;
    }
    if(priv.rate_chart) {
        gobj_send_event(priv.rate_chart, "EV_LOAD_DATA", priv.rows, gobj);
    }
    if(priv.cpu_chart) {
        gobj_send_event(priv.cpu_chart, "EV_LOAD_DATA", priv.rows, gobj);
    }
}

/***************************************************************
 *  The graph: SVG edges under absolutely placed HTML cards.
 ***************************************************************/
function build_graph(gobj)
{
    let priv = gobj.priv;
    clear_node(priv.$graph);
    priv.cards = {};
    priv.edge_labels = [];
    if(!priv.scenario) {
        return;
    }
    let ids = priv.scenario.yunos.map((y) => y.key);
    let g = layout_graph(ids, priv.scenario.links, {card_w: CARD_W, card_h: CARD_H});

    let $canvas = createElement2(["div", {class: "MONITOR_GRAPH_CANVAS",
        style: `width:${g.width}px; height:${g.height}px;`}, []]);

    let svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "MONITOR_EDGES");
    svg.setAttribute("width", String(g.width));
    svg.setAttribute("height", String(g.height));
    let marker_id = `monitor-arrow-${gobj_name(gobj)}`.replace(/[^\w-]/g, "_");
    let defs = document.createElementNS(SVG_NS, "defs");
    let marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", marker_id);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("orient", "auto-start-reverse");
    let tip = document.createElementNS(SVG_NS, "path");
    tip.setAttribute("d", "M0,0 L10,5 L0,10 z");
    tip.setAttribute("class", "MONITOR_EDGE_TIP");
    marker.appendChild(tip);
    defs.appendChild(marker);
    svg.appendChild(defs);

    for(let e of g.edges) {
        let path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", "MONITOR_EDGE");
        path.setAttribute("d", e.d);
        path.setAttribute("marker-end", `url(#${marker_id})`);
        svg.appendChild(path);
        let text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "MONITOR_EDGE_LABEL");
        text.setAttribute("x", String(e.mx));
        text.setAttribute("y", String(e.my - 6));
        text.setAttribute("text-anchor", "middle");
        svg.appendChild(text);
        priv.edge_labels.push({from: e.from, to: e.to, $text: text});
    }
    $canvas.appendChild(svg);

    for(let y of priv.scenario.yunos) {
        let pos = g.nodes[y.key];
        let $dot = createElement2(["span", {class: "MONITOR_NODE_STATE"}, ""]);
        let $cpu = createElement2(["span", {class: "MONITOR_NODE_CPU_VALUE is-family-monospace"}, ""]);
        let $bar = createElement2(["span", {class: "MONITOR_NODE_CPU_FILL"}, ""]);
        let $rx = createElement2(["span", {class: "MONITOR_NODE_RX_VALUE is-family-monospace"}, ""]);
        let $tx = createElement2(["span", {class: "MONITOR_NODE_TX_VALUE is-family-monospace"}, ""]);
        let $q = createElement2(["span", {class: "MONITOR_NODE_QUEUE_VALUE is-family-monospace"}, ""]);
        let $qrow = createElement2(["div", {class: "MONITOR_NODE_ROW MONITOR_NODE_QUEUE"}, [
            ["span", {class: "MONITOR_NODE_KEY", i18n: "monitor queue"}, t("monitor queue")],
            $q
        ]]);
        let $err = createElement2(["div", {class: "MONITOR_NODE_ERROR has-text-danger"}, ""]);
        let $card = createElement2(
            ["div", {class: "MONITOR_NODE card",
                     style: `left:${pos.x}px; top:${pos.y}px; width:${CARD_W}px; height:${CARD_H}px;`}, [
                ["div", {class: "MONITOR_NODE_HEAD"}, [
                    $dot,
                    ["span", {class: "MONITOR_NODE_LABEL has-text-weight-bold"}, y.label],
                    ["span", {class: "MONITOR_NODE_ID is-family-monospace"}, y.id]
                ]],
                ["div", {class: "MONITOR_NODE_WHERE is-family-monospace" + (y.node ? "" : " is-hidden")},
                    y.node || ""],
                ["div", {class: "MONITOR_NODE_ROW MONITOR_NODE_CPU"}, [
                    ["span", {class: "MONITOR_NODE_KEY", i18n: "monitor cpu"}, t("monitor cpu")],
                    ["span", {class: "MONITOR_NODE_CPU_BAR"}, [$bar]],
                    $cpu
                ]],
                ["div", {class: "MONITOR_NODE_ROW MONITOR_NODE_RX"}, [
                    ["span", {class: "MONITOR_NODE_KEY", i18n: "monitor in"}, t("monitor in")],
                    $rx
                ]],
                ["div", {class: "MONITOR_NODE_ROW MONITOR_NODE_TX"}, [
                    ["span", {class: "MONITOR_NODE_KEY", i18n: "monitor out"}, t("monitor out")],
                    $tx
                ]],
                $qrow,
                $err
            ]]
        );
        $canvas.appendChild($card);
        priv.cards[y.key] = {$card, $dot, $cpu, $bar, $rx, $tx, $q, $qrow, $err};
    }
    priv.$graph.appendChild($canvas);
}

/***************************************************************
 *  Paint one card (and the labels of its outgoing edges) from its
 *  model. Text only: the card is never rebuilt, so nothing flickers.
 ***************************************************************/
function paint_card(gobj, id)
{
    let priv = gobj.priv;
    paint_stats_card(gobj, id);
    let c = priv.cards[id];
    let m = priv.model[id];
    if(!c || !m) {
        return;
    }
    let level = cpu_level(m.cpu);
    c.$card.className = `MONITOR_NODE card MONITOR_NODE--cpu-${level} MONITOR_NODE--${m.run}`;
    let state_key = `monitor yuno ${m.run}`;
    c.$dot.className = `MONITOR_NODE_STATE MONITOR_NODE_STATE--${m.run}`;
    c.$dot.setAttribute("title", t(state_key));
    c.$dot.setAttribute("data-i18n-title", state_key);
    c.$dot.setAttribute("aria-label", t(state_key));
    c.$dot.setAttribute("data-i18n-aria-label", state_key);
    c.$dot.setAttribute("role", "img");

    c.$cpu.textContent = typeof m.cpu === "number" ? `${m.cpu} %` : "–";
    c.$bar.style.width = `${typeof m.cpu === "number" ? Math.max(0, Math.min(100, m.cpu)) : 0}%`;
    c.$rx.textContent = fmt_rate(m.rx);
    c.$tx.textContent = fmt_rate(m.tx);
    show(c.$qrow, typeof m.queue === "number");
    c.$q.textContent = typeof m.queue === "number" ? String(m.queue) : "";
    let err = m.errors.cpu || m.errors.app;
    if(err && err.key) {
        c.$err.setAttribute("data-i18n", err.key);
        c.$err.textContent = t(err.key);
    } else {
        c.$err.removeAttribute("data-i18n");
        c.$err.textContent = (err && err.text) || "";
    }

    for(let el of priv.edge_labels) {
        if(el.from === id || el.to === id) {
            let src = priv.model[el.from];
            let dst = priv.model[el.to];
            let v = (src && typeof src.tx === "number") ? src.tx
                  : (dst && typeof dst.rx === "number") ? dst.rx : null;
            el.$text.textContent = v === null ? "" : `${fmt_rate(v)}/s`;
        }
    }
}

function paint_all_cards(gobj)
{
    for(let id of Object.keys(gobj.priv.model)) {
        paint_card(gobj, id);
    }
}

/***************************************************************
 *  Toolbar, status line and what is shown for the current state.
 ***************************************************************/
function render_status(gobj)
{
    let priv = gobj.priv;
    let st = gobj_current_state(gobj);
    let state_key = st === "ST_MONITORING" ? "monitor monitoring"
                  : st === "ST_CONNECTING" ? "monitor connecting" : "monitor disconnected";
    let state_cls = st === "ST_MONITORING" ? "is-success"
                  : st === "ST_CONNECTING" ? "is-warning" : "is-light";
    priv.$state.className = `MONITOR_STATE tag ${state_cls}`;
    priv.$state.setAttribute("data-i18n", state_key);
    priv.$state.textContent = t(state_key);

    let has = !!priv.scenario;
    if(has) {
        priv.$name.removeAttribute("data-i18n");
        priv.$name.textContent = priv.scenario.id;
        priv.$name.setAttribute("title", priv.scenario.description || priv.scenario.id);
    } else {
        priv.$name.setAttribute("data-i18n", "scenario");
        priv.$name.textContent = t("scenario");
        priv.$name.removeAttribute("title");
    }
    let source_key = `scenario source ${priv.source}`;
    priv.$source.setAttribute("data-i18n", source_key);
    priv.$source.textContent = t(source_key);
    show(priv.$source, has);
    let saved = has && priv.source === "saved";
    show(priv.$runs, saved);
    show(priv.$delete, saved);
    priv.$mode.value = priv.view_mode;
    let $via = priv.$url.querySelector(".MONITOR_URL_VIA");
    let $where = priv.$url.querySelector(".MONITOR_URL_WHERE");
    if(has && priv.scenario.place === "control_center") {
        $via.setAttribute("data-i18n", "monitor via control center");
        $via.textContent = t("monitor via control center");
        $where.textContent = scenario_nodes(priv.scenario).join(", ");
    } else {
        $via.removeAttribute("data-i18n");
        $via.textContent = "";
        $where.textContent = has ? priv.scenario.agent_url : "";
    }
    priv.$propose.disabled = st !== "ST_MONITORING";

    show(priv.$connect, has && st === "ST_DISCONNECTED");
    show(priv.$disconnect, st !== "ST_DISCONNECTED");
    show(priv.$updated, priv.last_update > 0);
    priv.$updated_time.textContent = priv.last_update
        ? new Date(priv.last_update).toLocaleTimeString() : "";

    let $et = priv.$error.querySelector(".MONITOR_ERROR_TEXT");
    let $ed = priv.$error.querySelector(".MONITOR_ERROR_DETAIL");
    if(priv.error) {
        $et.setAttribute("data-i18n", priv.error.key);
        $et.textContent = t(priv.error.key);
        $ed.textContent = priv.error.detail ? ` ${priv.error.detail}` : "";
    } else {
        $et.removeAttribute("data-i18n");
        $et.textContent = "";
        $ed.textContent = "";
    }
    show(priv.$error, !!priv.error);

    render_control(gobj);
    show(priv.$editor, priv.editing);
    show(priv.$empty, !has && !priv.editing);
    let cards = priv.view_mode === "cards";
    show(priv.$graph, has && !cards);
    show(priv.$charts, has && !cards);
    show(priv.$cards, has && cards);
}

/***************************************************************
 *  One button per control the scenario's test declares.
 ***************************************************************/
function build_test_controls(gobj)
{
    let priv = gobj.priv;
    clear_node(priv.$test_buttons);
    priv.control_buttons = {};
    for(let control of scenario_controls(priv.scenario)) {
        let key = `monitor ${control}`;
        let danger = DANGEROUS_CONTROLS.indexOf(control) >= 0;
        let $btn = createElement2(
            ["button", {class: `MONITOR_TEST_${control.toUpperCase()} button` +
                               (danger ? " is-danger is-outlined" : ""),
                        type: "button",
                        title: t(key), "data-i18n-title": key,
                        "aria-label": t(key), "data-i18n-aria-label": key},
                [
                    ["span", {class: "icon"}, [["i", {class: CONTROL_ICONS[control]}]]],
                    ["span", {class: "is-hidden-mobile", i18n: key}, t(key)]
                ],
                {click: () => gobj_send_event(gobj, "EV_TEST_CONTROL", {control: control}, gobj)}]
        );
        priv.$test_buttons.appendChild($btn);
        priv.control_buttons[control] = $btn;
    }
}

function render_control(gobj)
{
    let priv = gobj.priv;
    let monitoring = gobj_current_state(gobj) === "ST_MONITORING";
    let c = priv.control;
    let busy = !!(c && c.running);
    for(let control of Object.keys(priv.control_buttons)) {
        priv.control_buttons[control].disabled = !monitoring || busy;
    }
    let $name = priv.$control.querySelector(".MONITOR_CONTROL_NAME");
    let $text = priv.$control.querySelector(".MONITOR_CONTROL_TEXT");
    if(c) {
        let key = `monitor ${c.control}`;
        $name.setAttribute("data-i18n", key);
        $name.textContent = t(key);
        if(c.not_sent) {
            $text.setAttribute("data-i18n", "monitor control not sent");
            $text.textContent = t("monitor control not sent");
        } else if(c.running) {
            $text.setAttribute("data-i18n", "scenario run in flight");
            $text.textContent = t("scenario run in flight");
        } else if(c.text_key) {
            $text.setAttribute("data-i18n", c.text_key);
            $text.textContent = t(c.text_key);
        } else {
            $text.removeAttribute("data-i18n");
            $text.textContent = c.text || "";
        }
    } else {
        $name.removeAttribute("data-i18n");
        $name.textContent = "";
        $text.textContent = "";
    }
    priv.$control.classList.toggle("has-text-danger", !!(c && !c.ok));
    show(priv.$control, !!c);
    show(priv.$control_details, !!(c && c.outputs && c.outputs.length));
    show(priv.$test, Object.keys(priv.control_buttons).length > 0);
}

function render_all(gobj)
{
    build_test_controls(gobj);
    build_graph(gobj);
    build_cards(gobj);
    paint_all_cards(gobj);
    render_status(gobj);
}

function set_error(gobj, key, detail, from_reading)
{
    gobj.priv.error = key ? {key: key, detail: detail || "", reading: !!from_reading} : null;
    render_status(gobj);
}

/*  A reading answered: an error that only a reading had set is over.  */
function clear_reading_error(gobj)
{
    let e = gobj.priv.error;
    if(e && e.reading) {
        set_error(gobj, null);
    }
}

/***************************************************************
 *  Readings.
 ***************************************************************/
function send_request(gobj, line, kind, key, node, md)
{
    let kw = {};
    msg_iev_write_key(kw, "monitor_kind", kind);
    msg_iev_write_key(kw, "monitor_yuno", key || "");
    msg_iev_write_key(kw, "monitor_node", node || "");
    msg_iev_write_key(kw, "monitor_gen", gobj.priv.generation);
    for(let k of Object.keys(md || {})) {
        msg_iev_write_key(kw, k, md[k]);
    }
    if(gobj.priv.scenario.place === "control_center") {
        kw.agent_id = node;
        kw.cmd2agent = line;
        agent_link_command(gobj_read_attr(gobj, "cc_link_svc"), "command-agent", kw);
    } else {
        gobj_send_event(gobj_read_attr(gobj, "link_svc"), "EV_SEND_COMMAND",
            {command: line, kw: kw}, gobj);
    }
}

/***************************************************************
 *  Subscribe the view to one link's events (null: to none). Only
 *  the transport the scenario uses reaches it, and only while it
 *  connects or monitors: C_AGENT_LINK is shared with every other
 *  workspace.
 ***************************************************************/
const LINK_EVENTS = {
    direct: ["EV_ON_OPEN", "EV_ON_CLOSE", "EV_ON_OPEN_ERROR", "EV_LINK_FAILED",
             "EV_MT_COMMAND_ANSWER", "EV_MT_STATS_ANSWER", "EV_YUNO_STATS"],
    /*  Its EV_MT_COMMAND_ANSWER is listened to always (mt_create).  */
    control_center: ["EV_ON_OPEN", "EV_ON_CLOSE", "EV_ON_OPEN_ERROR",
                     "EV_MT_STATS_ANSWER", "EV_YUNO_STATS"]
};

function watch_link(gobj, place)
{
    let priv = gobj.priv;
    if(priv.watching) {
        for(let ev of LINK_EVENTS[priv.watching.place]) {
            gobj_unsubscribe_event(priv.watching.link, ev, {}, gobj);
        }
        priv.watching = null;
    }
    if(!place) {
        return;
    }
    let link = gobj_read_attr(gobj, place === "control_center" ? "cc_link_svc" : "link_svc");
    if(!link) {
        log_error(`${gobj_short_name(gobj)}: no link service for '${place}'`);
        return;
    }
    for(let ev of LINK_EVENTS[place]) {
        gobj_subscribe_event(link, ev, {}, gobj);
    }
    priv.watching = {place: place, link: link};
}

/***************************************************************
 *  What an answer is: ours or not, and a control-center dispatch
 *  ack or the real thing. Answers {kind, key, node, ack}; kind "" =
 *  not ours (another workspace's, on the shared link).
 ***************************************************************/
function answer_of(gobj, kw)
{
    let kind = msg_iev_read_key(kw, "monitor_kind") || "";
    let ack = false;
    if(kind && gobj.priv.scenario && gobj.priv.scenario.place === "control_center") {
        let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
        ack = kw_get_str(gobj, stk, "command", "", 0) === "command-agent";
    }
    return {
        kind: kind,
        key: msg_iev_read_key(kw, "monitor_yuno") || "",
        node: msg_iev_read_key(kw, "monitor_node") || "",
        gen: msg_iev_read_key(kw, "monitor_gen"),
        ack: ack
    };
}

/*  Of the scenario shown now, and of a yuno of it on that node?  */
function answer_is_current(gobj, a)
{
    let priv = gobj.priv;
    if(a.gen !== priv.generation || !priv.scenario) {
        return false;
    }
    let y = a.key ? priv.scenario.yunos.find((x) => x.key === a.key) : null;
    return !a.key || (!!y && (y.node || "") === a.node);
}

/***************************************************************
 *  One reading: close the previous one into the history, then ask
 *  again. A figure that did not arrive since the last reading is a
 *  gap in the chart, not the old value drawn again.
 ***************************************************************/
function poll_tick(gobj)
{
    let priv = gobj.priv;
    let now = performance.now();
    if(priv.last_tick > 0) {
        /*  Fresh = arrived within the last period and a half: a pushed
         *  reading keeps its own phase against this timer.  */
        let fresh_from = now - 1.5 * (now - priv.last_tick);
        let row = {tm: Date.now() / 1000};
        for(let y of priv.scenario.yunos) {
            let m = priv.model[y.key];
            let fresh_cpu = m.cpu_t > fresh_from;
            let fresh_app = m.app_t > fresh_from;
            let rate = y.rate === "tx" ? m.tx : m.rx;
            row["cpu:" + y.key] = (fresh_cpu && typeof m.cpu === "number") ? m.cpu : null;
            row["rate:" + y.key] = (fresh_app && typeof rate === "number") ? Math.round(rate) : null;
        }
        priv.rows.push(row);
        let config = gobj_read_attr(gobj, "config_svc");
        let window_min = config ? agent_config_get_monitor(config).window : 15;
        prune_history(priv.rows, row.tm, window_min * 60);
        load_charts(gobj);
    }
    priv.last_tick = now;

    let c = priv.control;
    if(c && c.running && c.deadline && now > c.deadline) {
        log_warning(`${gobj_short_name(gobj)}: control '${c.control}' (${c.phase}) ` +
            `not answered in time, ${c.pending} answers missing`);
        control_over(gobj, false, "scenario run timed out");
    }

    if(now - priv.watch_sent_at > priv.watch_renew_ms) {
        send_watch(gobj);
    }
    poll_requests(gobj, null);
}

/***************************************************************
 *  The requests of the nodes that do not push (all of them when
 *  `only_node` is null).
 ***************************************************************/
function poll_requests(gobj, only_node)
{
    let priv = gobj.priv;
    for(let node of scenario_nodes(priv.scenario)) {
        if(priv.push[node] !== false || (only_node !== null && node !== only_node)) {
            continue;
        }
        send_request(gobj, lines.yunos(), "yunos", "", node);
        for(let y of priv.scenario.yunos) {
            if((y.node || "") !== node) {
                continue;
            }
            send_request(gobj, lines.cpu(y), "cpu", y.key, y.node);
            send_request(gobj, lines.app(y), "app", y.key, y.node);
        }
    }
}

/***************************************************************
 *  What a control sends, in order: the one list that says it, or --
 *  for restart -- stop, every yuno's counters to zero, and start.
 *  The same plan is shown in the confirmation and then sent.
 ***************************************************************/
function control_plan(gobj, control)
{
    let priv = gobj.priv;
    let plan = [];
    let add_steps = (a) => {
        for(let st of action_steps(priv.scenario, a)) {
            plan.push({line: st.line, node: st.node, kind: "control", key: st.key});
        }
    };
    if(control === "restart") {
        add_steps("stop");
        for(let y of priv.scenario.yunos) {
            plan.push({line: lines.reset(y), node: y.node || "", kind: "app", key: y.key});
        }
        add_steps("start");
    } else {
        add_steps(control);
    }
    return plan;
}

/***************************************************************
 *  A scenario the control center keeps is RUN by it: the steps one
 *  after the other, and the run written. Any other runs from here.
 ***************************************************************/
function run_by_control_center(gobj)
{
    let priv = gobj.priv;
    return !!priv.scenario && priv.source === "saved" && priv.cc_scenarios !== false &&
           priv.scenario.place === "control_center";
}

/***************************************************************
 *  A request to the control center itself, on the console's link.
 ***************************************************************/
function cc_request(gobj, command, kw, kind, md)
{
    let link = gobj_read_attr(gobj, "cc_link_svc");
    if(!link || !agent_link_is_connected(link)) {
        return -1;
    }
    msg_iev_write_key(kw, "monitor_kind", kind);
    for(let k of Object.keys(md || {})) {
        msg_iev_write_key(kw, k, md[k]);
    }
    return agent_link_command(link, command, kw);
}

/***************************************************************
 *  Ask each agent to push the readings of its yunos, or to stop.
 ***************************************************************/
function refresh_ms(gobj)
{
    let config = gobj_read_attr(gobj, "config_svc");
    return (config ? agent_config_get_monitor(config).refresh : 2) * 1000;
}

function send_watch(gobj)
{
    let priv = gobj.priv;
    priv.watch_sent_at = performance.now();
    for(let node of scenario_nodes(priv.scenario)) {
        if(priv.push[node] === false) {
            continue;
        }
        let yunos = priv.scenario.yunos.filter((y) => (y.node || "") === node);
        send_request(gobj, lines.watch(yunos, refresh_ms(gobj)), "watch", "", node);
    }
}

/*  Every node that pushes, or may (its watch unanswered yet). Only on
 *  a link in session: a direct link that closes ends the watch at the
 *  agent by itself.  */
function send_unwatch(gobj)
{
    let priv = gobj.priv;
    if(priv.scenario.place === "control_center" &&
            !agent_link_is_connected(gobj_read_attr(gobj, "cc_link_svc"))) {
        return;
    }
    for(let node of scenario_nodes(priv.scenario)) {
        if(priv.push[node] !== false) {
            send_request(gobj, lines.unwatch(), "unwatch", "", node);
        }
    }
}

function arm_poll(gobj)
{
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    if(priv.visible && gobj_current_state(gobj) === "ST_MONITORING") {
        let config = gobj_read_attr(gobj, "config_svc");
        let secs = config ? agent_config_get_monitor(config).refresh : 2;
        set_timeout_periodic(priv.gobj_timer, secs * 1000);
    }
}

/***************************************************************
 *  Poll only what someone is looking at: the shell hides a
 *  keep_alive view by toggling `is-hidden` on its container. The
 *  observer only translates that flip into an event.
 ***************************************************************/
function watch_visibility(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c || typeof MutationObserver === "undefined") {
        return;
    }
    priv.vis_obs = new MutationObserver(function() {
        let vis = !$c.classList.contains("is-hidden");
        if(vis !== priv.visible) {
            gobj_send_event(gobj, "EV_VISIBILITY", {visible: vis}, gobj);
        }
    });
    priv.vis_obs.observe($c, {attributes: true, attributeFilter: ["class"]});
}

/***************************************************************
 *  Links proposed: ask every yuno of the saved scenario for its
 *  config; when the last one has answered, derive the links and
 *  write them into the text being edited.
 ***************************************************************/
function discovery_answer(gobj, key, config)
{
    let priv = gobj.priv;
    let d = priv.discovery;
    if(!d || !d.pending[key]) {
        log_warning(`${gobj_short_name(gobj)}: config answer of no proposal (${key})`);
        return 0;
    }
    delete d.pending[key];
    if(config && typeof config === "object") {
        d.configs[key] = config;
    } else {
        d.failed.push(key);
    }
    if(Object.keys(d.pending).length) {
        render_propose(gobj);
        return 0;
    }
    priv.discovery = null;

    let entries = priv.scenario.yunos
        .filter((y) => d.configs[y.key])
        .map((y) => ({key: y.key, node: y.node || "", config: d.configs[y.key]}));
    let links = derive_links(entries);

    let edited;
    try {
        edited = JSON.parse(priv.$text.value);
    } catch(e) {
        set_edit_error(gobj, {key: "scenario invalid json", detail: e.message});
        return 0;
    }
    let keys = (Array.isArray(edited.yunos) ? edited.yunos : [])
        .map((y) => (y && (y.key || y.id)) || "");
    edited.links = links.filter(([a, b]) => keys.indexOf(a) >= 0 && keys.indexOf(b) >= 0);
    priv.$text.value = JSON.stringify(edited, null, 4);
    d.done = {count: edited.links.length, failed: d.failed};
    render_propose(gobj, d.done);
    return 0;
}

function render_propose(gobj, done)
{
    let priv = gobj.priv;
    let $text = priv.$propose_status.querySelector(".MONITOR_PROPOSE_TEXT");
    let $detail = priv.$propose_status.querySelector(".MONITOR_PROPOSE_DETAIL");
    let key = "";
    let detail = "";
    if(priv.discovery) {
        key = "monitor proposing links";
        detail = `${Object.keys(priv.discovery.pending).length}`;
    } else if(done) {
        key = done.failed.length ? "monitor links proposed with gaps" : "monitor links proposed";
        detail = done.failed.length ? `${done.count} · ${done.failed.join(", ")}` : `${done.count}`;
    }
    if(key) {
        $text.setAttribute("data-i18n", key);
        $text.textContent = t(key);
    } else {
        $text.removeAttribute("data-i18n");
        $text.textContent = "";
    }
    $detail.textContent = detail ? ` ${detail}` : "";
    show(priv.$propose_status, !!key);
}

function open_editor(gobj, fresh)
{
    let priv = gobj.priv;
    priv.editing = true;
    let base = (!fresh && priv.scenario) ? scenario_document(priv.scenario) : SCENARIO_TEMPLATE;
    priv.$text.value = JSON.stringify(base, null, 4);
    set_edit_error(gobj, null);
    render_propose(gobj, null);
    render_status(gobj);
}

function set_edit_error(gobj, error)
{
    let priv = gobj.priv;
    let $et = priv.$edit_error.querySelector(".MONITOR_SCENARIO_ERROR_TEXT");
    let $ed = priv.$edit_error.querySelector(".MONITOR_SCENARIO_ERROR_DETAIL");
    if(error) {
        $et.setAttribute("data-i18n", error.key);
        $et.textContent = t(error.key);
        $ed.textContent = error.detail ? ` ${error.detail}` : "";
    } else {
        $et.removeAttribute("data-i18n");
        $et.textContent = "";
        $ed.textContent = "";
    }
}




/***************************************************************
 *  CARDS mode: one card per yuno with every counter of its service
 *  -- what the Statistics workspace showed. Built with the scenario,
 *  painted with each reading.
 ***************************************************************/
function build_cards(gobj)
{
    let priv = gobj.priv;
    clear_node(priv.$cards);
    priv.stats_cards = {};
    if(!priv.scenario) {
        return;
    }
    for(let y of priv.scenario.yunos) {
        let $state = createElement2(["span", {class: "MONITOR_CARD_STATE tag is-light"}, ""]);
        let $cpu = createElement2(["span", {class: "MONITOR_CARD_CPU is-family-monospace"}, ""]);
        let $body = createElement2(["div", {class: "MONITOR_CARD_BODY"}, ""]);
        let $err = createElement2(["p", {class: "MONITOR_CARD_ERROR has-text-danger is-size-7"}, ""]);
        let $card = createElement2(
            ["div", {class: "MONITOR_CARD box"}, [
                ["div", {class: "MONITOR_CARD_HEAD"}, [
                    ["span", {class: "MONITOR_CARD_LABEL has-text-weight-bold"}, y.label],
                    ["span", {class: "MONITOR_CARD_ID is-family-monospace has-text-grey"},
                        y.node ? `${y.node} · ${y.id}` : y.id]
                ]],
                ["div", {class: "MONITOR_CARD_ROW"}, [
                    $state,
                    ["span", {class: "MONITOR_CARD_KEY", i18n: "monitor cpu"}, t("monitor cpu")],
                    $cpu
                ]],
                $body,
                $err
            ]]
        );
        priv.$cards.appendChild($card);
        priv.stats_cards[y.key] = {$state, $cpu, $body, $err};
    }
}

function paint_stats_card(gobj, key)
{
    let priv = gobj.priv;
    let c = priv.stats_cards[key];
    let m = priv.model[key];
    if(!c || !m) {
        return;
    }
    let state_key = `monitor yuno ${m.run}`;
    c.$state.setAttribute("data-i18n", state_key);
    c.$state.textContent = t(state_key);
    c.$cpu.textContent = typeof m.cpu === "number" ? `${m.cpu} %` : "–";

    let data = m.data;
    if(data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length) {
        let trs = Object.keys(data).map((k) =>
            `<tr class="MONITOR_CARD_COUNTER"><td class="MONITOR_CARD_COUNTER_NAME">${esc(k)}</td>` +
            `<td class="MONITOR_CARD_COUNTER_VALUE has-text-right is-family-monospace">` +
            `${esc(fmt_value(data[k]))}</td></tr>`).join("");
        c.$body.innerHTML = `<table class="MONITOR_CARD_COUNTERS table is-fullwidth is-narrow is-size-7">` +
            `<tbody>${trs}</tbody></table>`;
    } else {
        c.$body.innerHTML = `<p class="MONITOR_CARD_EMPTY has-text-grey is-size-7">` +
            `${esc(t("no statistics"))}</p>`;
    }
    let err = m.errors.cpu || m.errors.app;
    if(err && err.key) {
        c.$err.setAttribute("data-i18n", err.key);
        c.$err.textContent = t(err.key);
    } else {
        c.$err.removeAttribute("data-i18n");
        c.$err.textContent = (err && err.text) || "";
    }
}

/***************************************************************
 *  Show the scenario C_AGENT_CONFIG holds: the list, the tree and
 *  the editor all write it there, and this is the one place it is
 *  taken from. A new place (agent, or the control center) means a
 *  new connection; the same one keeps its session and only the yunos
 *  change.
 ***************************************************************/
function adopt_scenario(gobj)
{
    let priv = gobj.priv;
    let config = gobj_read_attr(gobj, "config_svc");
    let settings = config ? agent_config_get_monitor(config) : {scenario: null, source: "local"};
    let next = null;
    if(settings.scenario) {
        let r = validate_scenario(settings.scenario);
        if(r.ok) {
            next = r.scenario;
        } else {
            log_warning(`${gobj_short_name(gobj)}: the scenario to show is not valid ` +
                `(${r.error.key} ${r.error.detail}), ignored`);
        }
    }
    let st = gobj_current_state(gobj);
    let old_where = priv.scenario ? `${priv.scenario.place}|${priv.scenario.agent_url || ""}` : "";
    if(st === "ST_MONITORING" && priv.scenario) {
        send_unwatch(gobj);
    }
    priv.scenario = next;
    priv.generation++;
    priv.source = settings.source;
    priv.view_mode = next ? next.view.mode : "graph";
    priv.control = null;
    priv.editing = false;
    reset_model(gobj);
    gobj_start_charts(gobj);
    render_all(gobj);

    if(!next) {
        if(st !== "ST_DISCONNECTED") {
            gobj_send_event(gobj, "EV_DISCONNECT", {}, gobj);
        }
        return;
    }
    let new_where = `${next.place}|${next.agent_url || ""}`;
    if(st === "ST_DISCONNECTED" || new_where !== old_where) {
        gobj_send_event(gobj, "EV_CONNECT", {}, gobj);
    } else if(st === "ST_MONITORING") {
        priv.push = {};
        for(let node of scenario_nodes(priv.scenario)) {
            priv.push[node] = null;
        }
        if(priv.visible) {
            send_watch(gobj);
            poll_tick(gobj);
        }
    }
}

/***************************************************************
 *  A document in a dialog, as indented json.
 ***************************************************************/
function show_json_dialog(gobj, logical, title_key, prefix, value)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to show '${title_key}'`);
        return;
    }
    let $content = createElement2(
        ["div", {class: `${logical} box`}, [
            ["pre", {class: `${logical}_JSON is-size-7`, style: "white-space:pre-wrap;"},
                JSON.stringify(value, null, 4)]
        ]]
    );
    yui_shell_show_modal(shell, $content, {
        dialog: true, wide: true, logical_class: logical,
        title: title_key, title_prefix: prefix, t: t
    });
}

/***************************************************************
 *  The runs of the scenario, newest first: when, what, who, how it
 *  went, and the answer of every step.
 ***************************************************************/
function show_runs_dialog(gobj, runs, scenario_id)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to show the runs`);
        return;
    }
    let rows = (Array.isArray(runs) ? runs : []).map((r) => {
        let ok = typeof r.result === "number" && r.result >= 0;
        let steps = (Array.isArray(r.steps) ? r.steps : []).map((st) =>
            `${st.yuno || ""}: ${st.command || ""} → ${typeof st.result === "number" ? st.result : "–"}` +
            (st.comment ? ` ${st.comment}` : "")).join("\n");
        return ["tr", {class: "MONITOR_RUN"}, [
            ["td", {class: "MONITOR_RUN_WHEN is-family-monospace"},
                r.started_at ? new Date(r.started_at * 1000).toLocaleString(i18next.language || undefined) : ""],
            ["td", {class: "MONITOR_RUN_ACTION", i18n: `monitor ${r.action}`}, t(`monitor ${r.action}`)],
            ["td", {class: "MONITOR_RUN_USER"}, r.username || ""],
            ["td", {class: `MONITOR_RUN_RESULT ${ok ? "has-text-success" : "has-text-danger"}`,
                    i18n: ok ? "scenario run ok" : "scenario run failed"},
                t(ok ? "scenario run ok" : "scenario run failed")],
            ["td", {class: "MONITOR_RUN_STEPS is-family-monospace is-size-7",
                    style: "white-space:pre-wrap;"}, steps]
        ]];
    });
    let $content = createElement2(
        ["div", {class: "MONITOR_RUNS box"}, rows.length ? [
            ["div", {class: "table-container"}, [
                ["table", {class: "MONITOR_RUNS_TABLE table is-fullwidth is-narrow is-size-7"}, [
                    ["thead", {}, [["tr", {}, [
                        ["th", {i18n: "scenario run when"}, t("scenario run when")],
                        ["th", {i18n: "scenario run action"}, t("scenario run action")],
                        ["th", {i18n: "user"}, t("user")],
                        ["th", {i18n: "status"}, t("status")],
                        ["th", {i18n: "scenario run steps"}, t("scenario run steps")]
                    ]]]],
                    ["tbody", {}, rows]
                ]]
            ]]
        ] : [["p", {class: "has-text-grey", i18n: "scenario no runs"}, t("scenario no runs")]]]
    );
    yui_shell_show_modal(shell, $content, {
        dialog: true, wide: true, logical_class: "MONITOR_RUNS_DIALOG",
        title: "scenario runs", title_prefix: scenario_id || "", t: t
    });
}

/***************************************************************
 *  The answer of a request made of the control center itself: save,
 *  delete, runs, or a run of an action. Answered in any state.
 ***************************************************************/
function cc_answer(gobj, a, kw)
{
    let priv = gobj.priv;
    let failed = typeof kw.result === "number" && kw.result < 0;
    let lacks = failed && cc_lacks_command(kw.comment);
    if(lacks) {
        priv.cc_scenarios = false;
    } else if(!failed) {
        priv.cc_scenarios = true;
    }
    let config = gobj_read_attr(gobj, "config_svc");

    if(a.kind === "cc_save") {
        let pending = priv.pending_save;
        priv.pending_save = null;
        if(!pending) {
            log_warning(`${gobj_short_name(gobj)}: answer of a save no longer waited for`);
            return 0;
        }
        if(lacks) {
            /*  This control center keeps no scenario: in the browser, then.  */
            agent_config_set_monitor(config, {scenario: pending, source: "local"});
            set_error(gobj, "scenario kept in this browser", "");
            return 0;
        }
        if(failed) {
            set_edit_error(gobj, {key: "scenario not saved", detail: kw.comment || ""});
            return 0;
        }
        let doc = Array.isArray(kw.data) && kw.data[0] ? kw.data[0] : null;
        let r = doc ? validate_scenario(doc) : {ok: false};
        agent_config_set_monitor(config, {scenario: r.ok ? r.scenario : pending, source: "saved"});
        return 0;
    }
    let scenario_id = msg_iev_read_key(kw, "monitor_scenario") || "";
    if(a.kind === "cc_delete") {
        if(failed) {
            set_error(gobj, "scenario not deleted", kw.comment || "");
            return 0;
        }
        /*  Only the one shown is taken off the view: another may have been
         *  opened while the delete was on its way.  */
        if(priv.scenario && priv.source === "saved" && priv.scenario.id === scenario_id) {
            agent_config_set_monitor(config, {scenario: {}, source: "local"});
        }
        return 0;
    }
    if(a.kind === "cc_runs") {
        if(failed) {
            set_error(gobj, "scenario runs not read", kw.comment || "");
            return 0;
        }
        show_runs_dialog(gobj, kw.data, scenario_id);
        return 0;
    }
    if(a.kind === "cc_run") {
        return cc_run_answer(gobj, kw, failed);
    }
    log_warning(`${gobj_short_name(gobj)}: control-center answer of no request (${a.kind})`);
    return 0;
}

/***************************************************************
 *  The control center ran an action (or a phase of a restart): the
 *  answer is the run, with every step's.
 ***************************************************************/
function cc_run_answer(gobj, kw, failed)
{
    let run = Array.isArray(kw.data) && kw.data[0] ? kw.data[0] : null;
    let outputs = ((run && Array.isArray(run.steps)) ? run.steps : []).map((st) =>
        ({yuno: st.yuno, line: st.line, result: st.result, comment: st.comment, data: st.data}));
    return control_answered(gobj, kw, failed, outputs);
}

/***************************************************************
 *  A control: its phases, each waiting for all its answers.
 *
 *  c = {control, seq, phase, pending, deadline, running, ok,
 *       text (data, not translated) | text_key, outputs, by_cc}
 ***************************************************************/
function control_md(c)
{
    return {monitor_control: c.control, monitor_phase: c.phase, monitor_seq: c.seq};
}

/*  Send the requests of the phase `phase` of the control in flight.  */
function control_phase(gobj, phase)
{
    let priv = gobj.priv;
    let c = priv.control;
    c.phase = phase;
    c.deadline = performance.now() + CONTROL_PHASE_MS;
    if(phase === "reset") {
        /*  Only while monitoring: the answers come on the monitor's link.  */
        if(gobj_current_state(gobj) !== "ST_MONITORING") {
            log_warning(`${gobj_short_name(gobj)}: restart stopped before the counters ` +
                `were reset: not monitoring`);
            return control_over(gobj, false, "scenario run interrupted");
        }
        priv.rows = [];
        gobj_start_charts(gobj);
        c.pending = priv.scenario.yunos.length;
        for(let y of priv.scenario.yunos) {
            send_request(gobj, lines.reset(y), "reset", y.key, y.node || "", control_md(c));
        }
        if(!c.pending) {
            return control_next(gobj);
        }
        render_status(gobj);
        return 0;
    }
    if(c.by_cc) {
        c.pending = 1;
        /*  The control center runs the steps one by one, each with its
         *  own deadline: give it the time of all of them.  */
        c.deadline = performance.now() + CONTROL_PHASE_MS *
            (action_steps(priv.scenario, phase).length + 1);
        let md = Object.assign(control_md(c), {monitor_scenario: priv.scenario.id});
        if(cc_request(gobj, "run-scenario", {scenario_id: priv.scenario.id, action: phase},
                "cc_run", md) < 0) {
            c.not_sent = true;
            return control_over(gobj, false, "");
        }
        render_status(gobj);
        return 0;
    }
    let steps = action_steps(priv.scenario, phase);
    c.pending = steps.length;
    for(let st of steps) {
        send_request(gobj, st.line, "control", st.key, st.node, control_md(c));
    }
    if(!c.pending) {
        return control_next(gobj);
    }
    render_status(gobj);
    return 0;
}

/*  The phase after the one just answered, or the end.  */
function control_next(gobj)
{
    let c = gobj.priv.control;
    if(c.control === "restart") {
        if(c.phase === "stop") {
            return control_phase(gobj, "reset");
        }
        if(c.phase === "reset") {
            return control_phase(gobj, "start");
        }
    }
    return control_over(gobj, c.ok, "");
}

/*  The control ends: `text_key` says why, when it is not an answer.  */
function control_over(gobj, ok, text_key)
{
    let c = gobj.priv.control;
    c.running = false;
    c.pending = 0;
    c.deadline = 0;
    c.ok = !!ok && c.ok;
    if(text_key) {
        c.text_key = text_key;
    }
    render_status(gobj);
    return 0;
}

/*  A control in flight lost the link its answers come on.  */
function control_interrupted(gobj)
{
    let c = gobj.priv.control;
    if(c && c.running) {
        log_warning(`${gobj_short_name(gobj)}: control '${c.control}' (${c.phase}) interrupted`);
        control_over(gobj, false, "scenario run interrupted");
    }
}

/***************************************************************
 *  One answer of the control in flight (a step, a reset, a run of
 *  the control center). A reset that fails does not end a restart --
 *  a yuno that is not running has no counters to zero; anything
 *  else that fails ends the control after its phase.
 ***************************************************************/
function control_answered(gobj, kw, failed, outputs)
{
    let priv = gobj.priv;
    let c = priv.control;
    let control = msg_iev_read_key(kw, "monitor_control");
    let phase = msg_iev_read_key(kw, "monitor_phase");
    let seq = msg_iev_read_key(kw, "monitor_seq");
    if(!c || !c.running || c.seq !== seq || c.phase !== phase) {
        log_warning(`${gobj_short_name(gobj)}: answer of a control no longer waited for ` +
            `(${control}, ${phase})`);
        return 0;
    }
    for(let o of outputs) {
        c.outputs.push(o);
    }
    if(failed && phase !== "reset") {
        c.ok = false;
        c.text = kw.comment || "";
        c.text_key = kw.comment ? "" : "monitor no answer";
        log_warning(`${gobj_short_name(gobj)}: control '${control}' (${phase}) failed: ` +
            `${kw.comment || "no comment"}`);
    } else if(!failed && c.ok && phase !== "reset") {
        c.text = kw.comment || "";
        c.text_key = "";
    }
    c.pending--;
    if(c.pending > 0) {
        render_status(gobj);
        return 0;
    }
    if(!c.ok) {
        return control_over(gobj, false, "");
    }
    return control_next(gobj);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Connect to the scenario's agent.
 ***************************************************************/
function ac_connect(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.scenario) {
        /*  The state changed before this action: undo it.  */
        log_error(`${gobj_short_name(gobj)}: EV_CONNECT without a scenario`);
        gobj_change_state(gobj, "ST_DISCONNECTED");
        gobj_send_event(gobj, "EV_EDIT_SCENARIO", {}, gobj);
        return -1;
    }
    set_error(gobj, null);
    clear_timeout(priv.gobj_timer);
    priv.last_tick = 0;

    /*  Stop listening BEFORE the direct link drops the session it had:
     *  that close was asked for, it is not a drop.  */
    let was_direct = priv.watching && priv.watching.place === "direct";
    watch_link(gobj, null);
    let mlink = gobj_read_attr(gobj, "link_svc");
    if(priv.scenario.place === "direct") {
        gobj_send_event(mlink, "EV_CONNECT", {url: priv.scenario.agent_url}, gobj);
        watch_link(gobj, "direct");
    } else {
        if(was_direct) {
            gobj_send_event(mlink, "EV_DISCONNECT", {}, gobj);
        }
        watch_link(gobj, "control_center");
        /*  The control center's link is the console's own: when it is
         *  already in session there is nothing to wait for.  */
        if(agent_link_is_connected(gobj_read_attr(gobj, "cc_link_svc"))) {
            gobj_send_event(gobj, "EV_ON_OPEN", {}, gobj);
        }
    }
    render_status(gobj);
    return 0;
}

function ac_disconnect(gobj, event, kw, src)
{
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    /*  Tell the agents to stop pushing, while the link is still up: behind
     *  a control center they would push until the watch expires.  */
    if(priv.scenario && priv.scenario.place === "control_center" && priv.watching) {
        send_unwatch(gobj);
    }
    /*  A run of the control center still answers on the console's link;
     *  one run from here does not any more.  */
    if(!(priv.control && priv.control.by_cc)) {
        control_interrupted(gobj);
    }
    let was_direct = priv.watching && priv.watching.place === "direct";
    watch_link(gobj, null);
    if(was_direct) {
        gobj_send_event(gobj_read_attr(gobj, "link_svc"), "EV_DISCONNECT", {}, gobj);
    }
    priv.discovery = null;
    render_status(gobj);
    return 0;
}

function ac_on_open(gobj, event, kw, src)
{
    let priv = gobj.priv;
    set_error(gobj, null);
    /*  First ask every agent to push; a node whose watch is refused is
     *  polled from then on.  */
    priv.push = {};
    for(let node of scenario_nodes(priv.scenario)) {
        priv.push[node] = null;
    }
    arm_poll(gobj);
    if(priv.visible) {
        send_watch(gobj);
        poll_tick(gobj);
    }
    return 0;
}

/***************************************************************
 *  In session the close is a drop: the link retries on its own.
 ***************************************************************/
function ac_on_close_drop(gobj, event, kw, src)
{
    clear_timeout(gobj.priv.gobj_timer);
    gobj.priv.last_tick = 0;
    gobj.priv.discovery = null;
    control_interrupted(gobj);
    render_status(gobj);
    return 0;
}

function ac_on_open_error(gobj, event, kw, src)
{
    let detail = (kw && kw.url) || "";
    set_error(gobj, "monitor cannot reach the agent", detail);
    return 0;
}

function ac_link_failed(gobj, event, kw, src)
{
    watch_link(gobj, null);
    set_error(gobj, (kw && kw.error_code) || "monitor cannot reach the agent",
        (kw && kw.comment) || "");
    return 0;
}

function ac_timeout_periodic(gobj, event, kw, src)
{
    poll_tick(gobj);
    return 0;
}

/***************************************************************
 *  A stats answer: the cpu or the counters of one yuno.
 ***************************************************************/
function ac_mt_stats_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let a = answer_of(gobj, kw);
    if(!a.kind) {
        return 0;   /*  another workspace's answer, on the shared link  */
    }
    let id = a.key;
    let kind = a.kind;
    if(kind === "reset") {
        let failed = typeof kw.result === "number" && kw.result < 0;
        return control_answered(gobj, kw, failed,
            [{yuno: id, result: kw.result, comment: kw.comment}]);
    }
    if(!answer_is_current(gobj, a)) {
        return 0;   /*  asked for the scenario shown before  */
    }
    let m = priv.model[id];
    if(!m || (kind !== "cpu" && kind !== "app")) {
        log_warning(`${gobj_short_name(gobj)}: stats answer of no reading (${kind}, ${id})`);
        return 0;
    }
    return apply_reading(gobj, id, kind, kw.result, kw.comment, kw.data);
}

/***************************************************************
 *  One reading of one yuno -- asked (polled) or pushed -- into its
 *  model and its card.
 ***************************************************************/
function apply_reading(gobj, id, kind, result, comment, data_)
{
    let priv = gobj.priv;
    let m = priv.model[id];
    let now = performance.now();
    priv.last_update = Date.now();
    if(typeof result === "number" && result < 0) {
        m.errors[kind] = comment ? {text: comment} : {key: "monitor no answer"};
        paint_card(gobj, id);
        render_status(gobj);
        return 0;
    }
    m.errors[kind] = null;
    clear_reading_error(gobj);
    let data = data_ || {};
    if(kind === "cpu") {
        m.cpu = typeof data.cpu === "number" ? data.cpu : null;
        m.cpu_t = now;
    } else {
        let rx = pick_rate(data, "rx", m.prev_rx, now);
        let tx = pick_rate(data, "tx", m.prev_tx, now);
        m.rx = rx.rate;
        m.prev_rx = rx.prev;
        m.tx = tx.rate;
        m.prev_tx = tx.prev;
        m.queue = typeof data.msgs_in_queue === "number" ? data.msgs_in_queue : null;
        m.data = data;
        m.app_t = now;
    }
    paint_card(gobj, id);
    render_status(gobj);
    return 0;
}

/***************************************************************
 *  A command answer: the list of yunos, or a stats-yuno that could
 *  not be dispatched (a yuno that is not running is "not found").
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let a = answer_of(gobj, kw);
    let kind = a.kind;
    if(!kind) {
        return 0;   /*  another workspace's answer, on the shared link  */
    }
    if(CC_KINDS.indexOf(kind) >= 0) {
        return cc_answer(gobj, a, kw);
    }
    let failed_ = typeof kw.result === "number" && kw.result < 0;
    if(kind === "unwatch") {
        if(failed_ && !a.ack) {
            log_warning(`${gobj_short_name(gobj)}: ${a.node || "the agent"} did not stop its watch: ` +
                `${kw.comment || "no comment"}`);
        }
        return 0;
    }
    if(kind === "reset" || kind === "control") {
        /*  A dispatch ack of the control center is not the answer;
         *  a dispatch that failed is.  */
        if(a.ack && !failed_) {
            return 0;
        }
        return control_answered(gobj, kw, failed_,
            [{yuno: a.key, result: kw.result, comment: kw.comment, data: kw.data}]);
    }
    if(gobj_current_state(gobj) !== "ST_MONITORING" || !answer_is_current(gobj, a)) {
        /*  A reading or a control asked before the session ended (or the
         *  scenario changed): its answer has no card to go to any more.  */
        return 0;
    }
    let failed = typeof kw.result === "number" && kw.result < 0;
    if(a.ack && !failed) {
        return 0;   /*  the control center dispatched it; the answer follows  */
    }
    if(kind === "yunos") {
        if(failed) {
            set_error(gobj, "monitor no answer", kw.comment || `list-yunos ${a.node}`, true);
            return 0;
        }
        clear_reading_error(gobj);
        let rows = Array.isArray(kw.data) ? kw.data : [];
        let by_id = {};
        rows.forEach((r) => {
            if(r && r.id !== undefined) {
                by_id[String(r.id)] = r;
            }
        });
        for(let y of priv.scenario.yunos) {
            if((y.node || "") !== a.node) {
                continue;
            }
            priv.model[y.key].run = yuno_run_state(by_id[y.id]);
            paint_card(gobj, y.key);
        }
        return 0;
    }
    if(kind === "config") {
        return discovery_answer(gobj, a.key, failed ? null : kw.data);
    }
    if(kind === "watch") {
        let node = a.node;
        if(failed && a.ack) {
            /*  The control center could not dispatch it (the node's agent
             *  is not connected there): asked again at the next renewal.  */
            set_error(gobj, "monitor no answer", `${node}: ${kw.comment || ""}`, true);
        } else if(failed) {
            if(priv.push[node] !== false) {
                log_warning(`${gobj_short_name(gobj)}: ${node || "the agent"} does not push the stats ` +
                    `(${kw.comment || "no comment"}), polling them`);
                priv.push[node] = false;
                poll_requests(gobj, node);
            }
        } else {
            clear_reading_error(gobj);
            priv.push[node] = true;
            let ttl = kw.data && typeof kw.data.ttl === "number" ? kw.data.ttl : 0;
            if(ttl > 0) {
                priv.watch_renew_ms = Math.max(1000, Math.floor(ttl / 3));
            }
        }
        return 0;
    }
    if(kind === "cpu" || kind === "app") {
        let id = a.key;
        let m = priv.model[id];
        if(m && typeof kw.result === "number" && kw.result < 0) {
            m.errors[kind] = kw.comment ? {text: kw.comment} : {key: "monitor no answer"};
            if(kind === "cpu") {
                m.cpu = null;
            } else {
                m.rx = null;
                m.tx = null;
                m.queue = null;
            }
            paint_card(gobj, id);
        }
        return 0;
    }
    log_warning(`${gobj_short_name(gobj)}: command answer of no reading (${kind})`);
    return 0;
}

/***************************************************************
 *  A reading pushed by the agent (watch-yuno-stats): the state, the
 *  cpu or the service stats of one yuno, for every card showing it.
 ***************************************************************/
function ac_yuno_stats(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(msg_iev_read_key(kw, "monitor_kind") !== "watch") {
        log_warning(`${gobj_short_name(gobj)}: pushed reading of no watch of this view`);
        return 0;
    }
    if(msg_iev_read_key(kw, "monitor_gen") !== priv.generation) {
        return 0;   /*  still pushed by the watch of the scenario shown before  */
    }
    let node = msg_iev_read_key(kw, "monitor_node") || "";
    let d = (kw && kw.data) || {};
    let hit = false;
    for(let y of priv.scenario.yunos) {
        if(y.id !== d.yuno_id || (y.node || "") !== node) {
            continue;
        }
        if(d.kind === "state") {
            let m = priv.model[y.key];
            m.run = d.missing ? "missing" : yuno_run_state(d);
            if(d.missing || !d.yuno_running) {
                /*  No cpu and no stats come for a yuno that does not run:
                 *  its last figures are not its figures any more.  */
                m.cpu = null;
                m.rx = null;
                m.tx = null;
                m.queue = null;
                m.prev_rx = null;
                m.prev_tx = null;
            }
            paint_card(gobj, y.key);
            hit = true;
        } else if(d.kind === "cpu" || (d.kind === "app" && (y.service || "") === (d.service || ""))) {
            apply_reading(gobj, y.key, d.kind, d.result, d.comment, d.data);
            hit = true;
        }
    }
    if(!hit) {
        log_warning(`${gobj_short_name(gobj)}: pushed reading of no card (${d.yuno_id}, ${d.kind})`);
    }
    return 0;
}

function ac_visibility(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.visible = !!(kw && kw.visible);
    if(gobj_current_state(gobj) !== "ST_MONITORING") {
        return 0;
    }
    if(priv.visible) {
        arm_poll(gobj);
        send_watch(gobj);
        poll_tick(gobj);
    } else {
        clear_timeout(priv.gobj_timer);
        priv.last_tick = 0;
        send_unwatch(gobj);
    }
    return 0;
}

function ac_set_refresh(gobj, event, kw, src)
{
    let config = gobj_read_attr(gobj, "config_svc");
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot save the reading interval`);
        return -1;
    }
    agent_config_set_monitor(config, {refresh: kw.value});
    arm_poll(gobj);
    if(gobj_current_state(gobj) === "ST_MONITORING" && gobj.priv.visible) {
        send_watch(gobj);
    }
    return 0;
}

function ac_set_window(gobj, event, kw, src)
{
    let config = gobj_read_attr(gobj, "config_svc");
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot save the history window`);
        return -1;
    }
    agent_config_set_monitor(config, {window: kw.value});
    let rows = gobj.priv.rows;
    if(rows.length) {
        prune_history(rows, rows[rows.length - 1].tm, kw.value * 60);
        load_charts(gobj);
    }
    return 0;
}

function ac_clear_history(gobj, event, kw, src)
{
    gobj.priv.rows = [];
    gobj_start_charts(gobj);
    return 0;
}

function ac_edit_scenario(gobj, event, kw, src)
{
    open_editor(gobj);
    return 0;
}

function ac_cancel_edit(gobj, event, kw, src)
{
    gobj.priv.editing = false;
    render_status(gobj);
    return 0;
}

/***************************************************************
 *  Save the scenario written in the editor: in the control center
 *  when it keeps scenarios, asked first when it would write a
 *  scenario other than the one watched (one of that name is
 *  replaced); in this browser when it keeps none. Whatever is saved
 *  is written to C_AGENT_CONFIG, and shown from there
 *  (adopt_scenario).
 ***************************************************************/
function ac_save_scenario(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let r = parse_scenario((kw && kw.text) || "");
    if(!r.ok) {
        set_edit_error(gobj, r.error);
        return -1;
    }
    let config = gobj_read_attr(gobj, "config_svc");
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot save the scenario`);
        return -1;
    }
    if(priv.cc_scenarios === false) {
        agent_config_set_monitor(config, {scenario: r.scenario, source: "local"});
        return 0;
    }
    let same = priv.source === "saved" && priv.scenario && priv.scenario.id === r.scenario.id;
    if(same) {
        return send_save(gobj, r.scenario);
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to confirm the save`);
        return -1;
    }
    let $msg = createElement2(
        ["div", {class: "MONITOR_CONFIRM_SAVE"}, [
            ["p", {i18n: "scenario confirm save as"}, t("scenario confirm save as")],
            ["p", {class: "has-text-weight-semibold mt-2 is-family-monospace"}, r.scenario.id]
        ]]
    );
    let text = kw.text;
    yui_shell_confirm_yesno(shell, $msg, {
        t: t, logical_class: "MONITOR_CONFIRM_SAVE_DIALOG", yes_label: "save", no_label: "cancel"
    }).then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_SAVE_CONFIRMED", {text: text}, gobj);
        }
    });
    return 0;
}

function ac_save_confirmed(gobj, event, kw, src)
{
    let r = parse_scenario((kw && kw.text) || "");
    if(!r.ok) {
        set_edit_error(gobj, r.error);
        return -1;
    }
    return send_save(gobj, r.scenario);
}

function send_save(gobj, scenario)
{
    let priv = gobj.priv;
    priv.pending_save = scenario;
    if(cc_request(gobj, "save-scenario", {scenario: scenario_document(scenario)}, "cc_save") < 0) {
        priv.pending_save = null;
        set_edit_error(gobj, {key: "not connected to an agent", detail: ""});
        return -1;
    }
    set_edit_error(gobj, null);
    return 0;
}

function ac_new_scenario(gobj, event, kw, src)
{
    open_editor(gobj, true);
    return 0;
}

/***************************************************************
 *  Delete the scenario watched from the control center: asked in
 *  red first, its runs go with it.
 ***************************************************************/
function ac_delete_scenario(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let shell = yui_shell_of(gobj);
    if(!priv.scenario || priv.source !== "saved" || !shell) {
        log_error(`${gobj_short_name(gobj)}: EV_DELETE_SCENARIO with no saved scenario shown`);
        return -1;
    }
    let id = priv.scenario.id;
    let $msg = createElement2(
        ["div", {class: "MONITOR_CONFIRM_DELETE"}, [
            ["p", {i18n: "scenario confirm delete"}, t("scenario confirm delete")],
            ["p", {class: "has-text-weight-semibold mt-2 is-family-monospace"}, id]
        ]]
    );
    yui_shell_confirm_danger(shell, $msg, {
        t: t, logical_class: "MONITOR_CONFIRM_DELETE_DIALOG",
        confirm_label: "scenario delete", cancel_label: "cancel"
    }).then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_DELETE_CONFIRMED", {scenario_id: id}, gobj);
        }
    });
    return 0;
}

function ac_delete_confirmed(gobj, event, kw, src)
{
    if(cc_request(gobj, "delete-scenario", {scenario_id: kw.scenario_id}, "cc_delete",
            {monitor_scenario: kw.scenario_id}) < 0) {
        set_error(gobj, "not connected to an agent", "");
    }
    return 0;
}

function ac_show_runs(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.scenario || priv.source !== "saved") {
        log_error(`${gobj_short_name(gobj)}: EV_SHOW_RUNS with no saved scenario shown`);
        return -1;
    }
    if(cc_request(gobj, "scenario-runs", {scenario_id: priv.scenario.id}, "cc_runs",
            {monitor_scenario: priv.scenario.id}) < 0) {
        set_error(gobj, "not connected to an agent", "");
    }
    return 0;
}

/***************************************************************
 *  What the last action answered, step by step -- a report is
 *  worth nothing more than this.
 ***************************************************************/
function ac_show_output(gobj, event, kw, src)
{
    let c = gobj.priv.control;
    if(!c || !c.outputs || !c.outputs.length) {
        log_error(`${gobj_short_name(gobj)}: EV_SHOW_OUTPUT with no answer to show`);
        return -1;
    }
    show_json_dialog(gobj, "MONITOR_OUTPUT_DIALOG", `monitor ${c.control}`,
        gobj.priv.scenario ? gobj.priv.scenario.id : "", c.outputs);
    return 0;
}

function ac_set_view_mode(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let mode = kw && kw.mode;
    if(mode !== "graph" && mode !== "cards") {
        log_error(`${gobj_short_name(gobj)}: EV_SET_VIEW_MODE of no mode: '${mode}'`);
        return -1;
    }
    priv.view_mode = mode;
    render_status(gobj);
    paint_all_cards(gobj);
    load_charts(gobj);
    return 0;
}

/***************************************************************
 *  The scenario watched changed in C_AGENT_CONFIG: show it.
 ***************************************************************/
function ac_scenario_changed(gobj, event, kw, src)
{
    adopt_scenario(gobj);
    return 0;
}

/***************************************************************
 *  Propose the links of the scenario being monitored from the
 *  configs of its yunos. A new request forgets the one before it.
 ***************************************************************/
function ac_propose_links(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.discovery = {pending: {}, configs: {}, failed: []};
    for(let y of priv.scenario.yunos) {
        priv.discovery.pending[y.key] = true;
    }
    for(let y of priv.scenario.yunos) {
        send_request(gobj, lines.config(y), "config", y.key, y.node);
    }
    render_propose(gobj);
    return 0;
}

/***************************************************************
 *  A control button: ask first, showing what will be sent. The
 *  answer of the dialog is an OS notification: it only becomes an
 *  event.
 ***************************************************************/
function ac_test_control(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let control = (kw && kw.control) || "";
    if(!priv.scenario || scenario_controls(priv.scenario).indexOf(control) < 0) {
        log_error(`${gobj_short_name(gobj)}: EV_TEST_CONTROL of no control of this test: '${control}'`);
        return -1;
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to confirm the control '${control}'`);
        return -1;
    }
    let plan_lines = control_plan(gobj, control).map((p) => (p.node ? `[${p.node}] ` : "") + p.line);
    let who = run_by_control_center(gobj) ? "scenario run by the control center" : "scenario run from here";
    let $msg = createElement2(
        ["div", {class: "MONITOR_CONFIRM"}, [
            ["p", {class: "MONITOR_CONFIRM_TEXT", i18n: `monitor confirm ${control}`},
                t(`monitor confirm ${control}`)],
            ["p", {class: "MONITOR_CONFIRM_WHO is-size-7 has-text-grey mt-2", i18n: who}, t(who)],
            ["p", {class: "MONITOR_CONFIRM_LIST_TITLE is-size-7 has-text-weight-semibold mt-3",
                   i18n: "monitor commands that will run"}, t("monitor commands that will run")],
            ["pre", {class: "MONITOR_CONFIRM_COMMANDS is-size-7 has-text-left"}, plan_lines.join("\n")]
        ]]
    );
    let label = `monitor ${control}`;
    let opts = {t: t, logical_class: "MONITOR_CONFIRM_DIALOG"};
    let asked = DANGEROUS_CONTROLS.indexOf(control) >= 0
        ? yui_shell_confirm_danger(shell, $msg, Object.assign(opts, {confirm_label: label}))
        : yui_shell_confirm_yesno(shell, $msg, Object.assign(opts, {yes_label: label, no_label: "cancel"}));
    asked.then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_TEST_CONFIRMED", {control: control}, gobj);
        }
    });
    return 0;
}

/***************************************************************
 *  Confirmed: send the plan, in order, over the one link.
 ***************************************************************/
function ac_test_confirmed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let control = kw.control;
    if(priv.control && priv.control.running) {
        log_warning(`${gobj_short_name(gobj)}: control '${control}' confirmed while ` +
            `'${priv.control.control}' runs, not sent`);
        return 0;
    }
    priv.control = {
        control:  control,
        seq:      ++priv.control_seq,
        phase:    "",
        pending:  0,
        deadline: 0,
        running:  true,
        ok:       true,
        text:     "",
        text_key: "",
        outputs:  [],
        by_cc:    run_by_control_center(gobj)
    };
    return control_phase(gobj, control === "restart" ? "stop" : control);
}

/***************************************************************
 *  The dialog was answered after the link went down: nothing was
 *  sent, and the operator is told so.
 ***************************************************************/
function ac_test_not_sent(gobj, event, kw, src)
{
    log_warning(`${gobj_short_name(gobj)}: control '${kw.control}' confirmed out of session, not sent`);
    gobj.priv.control = {control: kw.control, ok: false, text: "", text_key: "", not_sent: true,
                         outputs: []};
    render_status(gobj);
    return 0;
}

/***************************************************************
 *  The shell switched language: what carries its key is re-read;
 *  the chart legends and the state tooltips are rebuilt.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    relabel_select(gobj.priv.$refresh);
    relabel_select(gobj.priv.$window);
    paint_all_cards(gobj);
    render_status(gobj);
    return 0;
}

/***************************************************************
 *              FSM
 ***************************************************************/
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
     *  EV_ON_CLOSE is a DROP, and exists only while monitoring: the
     *  view stops listening to a link before it leaves it on purpose.
     *---------------------------------------------*/
    const common = [
        ["EV_VISIBILITY",           ac_visibility,          null],
        ["EV_SET_REFRESH",          ac_set_refresh,         null],
        ["EV_SET_WINDOW",           ac_set_window,          null],
        ["EV_CLEAR_HISTORY",        ac_clear_history,       null],
        ["EV_EDIT_SCENARIO",        ac_edit_scenario,       null],
        ["EV_CANCEL_EDIT",          ac_cancel_edit,         null],
        ["EV_SAVE_SCENARIO",        ac_save_scenario,       null],
        ["EV_SAVE_CONFIRMED",       ac_save_confirmed,      null],
        ["EV_NEW_SCENARIO",         ac_new_scenario,        null],
        ["EV_DELETE_SCENARIO",      ac_delete_scenario,     null],
        ["EV_DELETE_CONFIRMED",     ac_delete_confirmed,    null],
        ["EV_SHOW_RUNS",            ac_show_runs,           null],
        ["EV_SHOW_OUTPUT",          ac_show_output,         null],
        ["EV_SET_VIEW_MODE",        ac_set_view_mode,       null],
        ["EV_MONITOR_SCENARIO_CHANGED", ac_scenario_changed, null],
        /*  the control center's answers come in any state (cc_answer);
         *  a reading's only matters while monitoring  */
        ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,   null],
        ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null]
    ];
    const states = [
        ["ST_DISCONNECTED", [
            ["EV_CONNECT",              ac_connect,             "ST_CONNECTING"],
            ["EV_TEST_CONFIRMED",       ac_test_not_sent,       null],
            ...common
        ]],
        ["ST_CONNECTING", [
            ["EV_CONNECT",              ac_connect,             null],
            ["EV_DISCONNECT",           ac_disconnect,          "ST_DISCONNECTED"],
            ["EV_ON_OPEN",              ac_on_open,             "ST_MONITORING"],
            ["EV_ON_OPEN_ERROR",        ac_on_open_error,       null],
            ["EV_LINK_FAILED",          ac_link_failed,         "ST_DISCONNECTED"],
            ["EV_TEST_CONFIRMED",       ac_test_not_sent,       null],
            ...common
        ]],
        ["ST_MONITORING", [
            ["EV_CONNECT",              ac_connect,             "ST_CONNECTING"],
            ["EV_DISCONNECT",           ac_disconnect,          "ST_DISCONNECTED"],
            ["EV_ON_CLOSE",             ac_on_close_drop,       "ST_CONNECTING"],
            ["EV_MT_STATS_ANSWER",      ac_mt_stats_answer,     null],
            ["EV_TIMEOUT_PERIODIC",     ac_timeout_periodic,    null],
            ["EV_YUNO_STATS",           ac_yuno_stats,          null],
            ["EV_TEST_CONTROL",         ac_test_control,        null],
            ["EV_TEST_CONFIRMED",       ac_test_confirmed,      null],
            ["EV_PROPOSE_LINKS",        ac_propose_links,       null],
            ...common
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_CONNECT",              0],
        ["EV_DISCONNECT",           0],
        ["EV_ON_OPEN",              0],
        ["EV_ON_CLOSE",             0],
        ["EV_ON_OPEN_ERROR",        0],
        ["EV_LINK_FAILED",          0],
        ["EV_MT_STATS_ANSWER",      0],
        ["EV_MT_COMMAND_ANSWER",    0],
        ["EV_TIMEOUT_PERIODIC",     0],
        ["EV_VISIBILITY",           0],
        ["EV_SET_REFRESH",          0],
        ["EV_SET_WINDOW",           0],
        ["EV_CLEAR_HISTORY",        0],
        ["EV_EDIT_SCENARIO",        0],
        ["EV_CANCEL_EDIT",          0],
        ["EV_SAVE_SCENARIO",        0],
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_TEST_CONTROL",         0],
        ["EV_TEST_CONFIRMED",       0],
        ["EV_PROPOSE_LINKS",        0],
        ["EV_YUNO_STATS",           0],
        ["EV_SAVE_CONFIRMED",       0],
        ["EV_NEW_SCENARIO",         0],
        ["EV_DELETE_SCENARIO",      0],
        ["EV_DELETE_CONFIRMED",     0],
        ["EV_SHOW_RUNS",            0],
        ["EV_SHOW_OUTPUT",          0],
        ["EV_SET_VIEW_MODE",        0],
        ["EV_MONITOR_SCENARIO_CHANGED", 0]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,  // lmt,
        attrs_table,
        PRIVATE_DATA,
        0,  // authz_table,
        0,  // command_table,
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
function register_c_agent_monitor()
{
    return create_gclass(GCLASS_NAME);
}

export { register_c_agent_monitor };
