/***********************************************************************
 *          c_agent_monitor.js
 *
 *      C_AGENT_MONITOR — the Monitor workspace: the yunos of one test,
 *      live. A GRAPH of the yunos in the order the messages flow (left to
 *      right), each card with its cpu %, its messages per second in and
 *      out, its queue when it has one and what the agent says of it
 *      (playing, paused, stopped...); and under it two CHARTS, messages
 *      per second and cpu, over a window of history.
 *
 *      What it watches is a SCENARIO (monitor_helpers.js): where the
 *      yunos are, the yunos, and the links between them. It is written
 *      as JSON in the view itself and kept in C_AGENT_CONFIG.
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
 *      PUSHED, OR POLLED. Talking to an agent directly, the view asks it
 *      for a `watch-yuno-stats` (the yunos, the period) and the agent
 *      SENDS the readings as EV_YUNO_STATS -- state, cpu and service
 *      stats of each yuno -- every `monitor_refresh` seconds, until the
 *      session ends or the view asks it to stop (a hidden tab does). An
 *      agent that does not know the command (older than 7.25.13) answers
 *      it with an error and the view falls back to POLLING: per tick a
 *      `list-yunos` and two `stats-yuno` per yuno, the DELIBERATE
 *      exception to the no-polling rule approved for this view on
 *      2026-09-29. Through the control center it always polls, until the
 *      control center relays EV_YUNO_STATS. Either way a periodic C_TIMER
 *      closes each period into a row of the history (and, polling, sends
 *      the requests); it runs only in ST_MONITORING and while this tab is
 *      the visible one.
 *
 *      RATES. A yuno's own `rxMsgsec`/`txMsgsec` is used when its service
 *      reports one (an application service computes it on its own
 *      timer); otherwise the rate comes from the `rxMsgs`/`txMsgs`
 *      counters and a monotonic clock. The chart plots, per yuno, the
 *      direction the scenario names as its throughput (`rate`).
 *
 *      TEST CONTROLS. A scenario with a `test` block is a test, and the
 *      view shows its controls: start, pause, resume, stop -- each a list
 *      of commands of the generator, sent as `command-yuno` in order --
 *      and restart (stop, every yuno asked to zero its counters with
 *      `stats-yuno stats=__reset__` -- only a service that honours the
 *      reset does it -- the history cleared, start). Each
 *      asks for confirmation first and shows the commands it will send;
 *      stop and restart in red. Only in ST_MONITORING: a control confirmed
 *      after the link went down is refused, not queued. A scenario
 *      without `test` (production) shows none.
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

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {
    yui_shell_confirm_yesno,
    yui_shell_confirm_danger,
} from "@yuneta/gobj-ui/src/shell_modals.js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    agent_config_get_monitor,
    agent_config_set_monitor,
    MONITOR_REFRESH_CHOICES,
    MONITOR_WINDOW_CHOICES,
} from "./c_agent_config.js";
import {
    SCENARIO_TEMPLATE,
    test_controls,
    test_command_lines,
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
    restart: "yi-arrows-rotate"
};
const DANGEROUS_CONTROLS = ["stop", "restart"];

/***************************************************************
 *              Data
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,       "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",        0,  "monitor",  "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",   0,  null,       "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",     0,  null,       "C_MONITOR_LINK service (direct)"),
SDATA(data_type_t.DTP_POINTER,  "cc_link_svc",  0,  null,       "C_AGENT_LINK service (control center)"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",   0,  null,       "C_AGENT_CONFIG service"),
SDATA_END()
];

let PRIVATE_DATA = {
    gobj_timer:     null,
    scenario:       null,   /*  validated scenario, or null  */
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
    push:           null,   /*  the agent pushes the readings: null = asked, not answered yet  */
    discovery:      null,   /*  {pending: {key: true}, configs: {key: config}, failed: [key]}  */
};

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

    let settings = config ? agent_config_get_monitor(config) : {scenario: null};
    if(settings.scenario) {
        let r = validate_scenario(settings.scenario);
        if(r.ok) {
            priv.scenario = r.scenario;
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
    watch_link(gobj, null);
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
    }
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
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
    let $sel = createElement2(
        ["select", {class: cls,
                    title: t(key), "data-i18n-title": key,
                    "aria-label": t(key), "data-i18n-aria-label": key},
            choices.map((v) => ["option", {value: String(v)}, `${v} ${unit}`]),
            {change: (e) => gobj_send_event(gobj, event,
                {value: parseInt(e.target.value, 10)}, gobj)}]
    );
    $sel.value = String(value);
    return $sel;
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
    priv.$state = createElement2(["span", {class: "MONITOR_STATE tag"}, ""]);
    priv.$connect = tool_button("MONITOR_CONNECT is-primary", "yi-plug", "monitor connect",
        "EV_CONNECT", gobj, true);
    priv.$disconnect = tool_button("MONITOR_DISCONNECT", "yi-plug-slash", "monitor disconnect",
        "EV_DISCONNECT", gobj, true);
    priv.$refresh = tool_select("MONITOR_REFRESH", "monitor refresh",
        MONITOR_REFRESH_CHOICES, "s", settings.refresh, "EV_SET_REFRESH", gobj);
    priv.$window = tool_select("MONITOR_WINDOW", "monitor window",
        MONITOR_WINDOW_CHOICES, "min", settings.window, "EV_SET_WINDOW", gobj);
    priv.$clear = tool_button("MONITOR_CLEAR", "yi-broom", "monitor clear history",
        "EV_CLEAR_HISTORY", gobj, false);
    priv.$edit = tool_button("MONITOR_EDIT", "yi-pen", "monitor scenario",
        "EV_EDIT_SCENARIO", gobj, true);

    let $toolbar = createElement2(
        ["div", {class: "MONITOR_TOOLBAR"}, [
            ["div", {class: "MONITOR_TITLE"}, [priv.$name, priv.$state]],
            ["div", {class: "MONITOR_TOOLS"}, [
                priv.$connect,
                priv.$disconnect,
                ["div", {class: "select"}, [priv.$refresh]],
                ["div", {class: "select"}, [priv.$window]],
                priv.$clear,
                priv.$edit
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
    priv.$control = createElement2(["span", {class: "MONITOR_CONTROL is-size-7"}, [
        ["span", {class: "MONITOR_CONTROL_NAME has-text-weight-semibold"}, ""],
        ["span", {class: "MONITOR_CONTROL_TEXT is-family-monospace"}, ""]
    ]]);
    priv.$test = createElement2(
        ["div", {class: "MONITOR_TEST"}, [
            ["span", {class: "MONITOR_TEST_LABEL tag is-warning is-light", i18n: "monitor test"},
                t("monitor test")],
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
            ["p", {i18n: "monitor no scenario"}, t("monitor no scenario")]
        ]]
    );

    priv.$graph = createElement2(["div", {class: "MONITOR_GRAPH"}, []]);

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
    if(has && priv.scenario.name) {
        priv.$name.removeAttribute("data-i18n");
        priv.$name.textContent = priv.scenario.name;
    } else {
        priv.$name.setAttribute("data-i18n", "monitor");
        priv.$name.textContent = t("monitor");
    }
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
    show(priv.$graph, has);
    show(priv.$charts, has);
}

/***************************************************************
 *  One button per control the scenario's test declares.
 ***************************************************************/
function build_test_controls(gobj)
{
    let priv = gobj.priv;
    clear_node(priv.$test_buttons);
    priv.control_buttons = {};
    let test = priv.scenario ? priv.scenario.test : null;
    for(let control of test_controls(test)) {
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
    for(let control of Object.keys(priv.control_buttons)) {
        priv.control_buttons[control].disabled = !monitoring;
    }
    let $name = priv.$control.querySelector(".MONITOR_CONTROL_NAME");
    let $text = priv.$control.querySelector(".MONITOR_CONTROL_TEXT");
    let c = priv.control;
    if(c) {
        let key = `monitor ${c.control}`;
        $name.setAttribute("data-i18n", key);
        $name.textContent = t(key);
        if(c.not_sent) {
            $text.setAttribute("data-i18n", "monitor control not sent");
            $text.textContent = t("monitor control not sent");
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
    show(priv.$test, Object.keys(priv.control_buttons).length > 0);
}

function render_all(gobj)
{
    build_test_controls(gobj);
    build_graph(gobj);
    paint_all_cards(gobj);
    render_status(gobj);
}

function set_error(gobj, key, detail)
{
    gobj.priv.error = key ? {key: key, detail: detail || ""} : null;
    render_status(gobj);
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
    control_center: ["EV_ON_OPEN", "EV_ON_CLOSE", "EV_ON_OPEN_ERROR",
                     "EV_MT_COMMAND_ANSWER", "EV_MT_STATS_ANSWER"]
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
        ack: ack
    };
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

    if(priv.push !== false) {
        return;     /*  pushed by the agent, or still asking whether it can  */
    }
    for(let node of scenario_nodes(priv.scenario)) {
        send_request(gobj, lines.yunos(), "yunos", "", node);
    }
    for(let y of priv.scenario.yunos) {
        send_request(gobj, lines.cpu(y), "cpu", y.key, y.node);
        send_request(gobj, lines.app(y), "app", y.key, y.node);
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
    let test = priv.scenario.test;
    let plan = [];
    let add_lines = (c) => {
        for(let line of test_command_lines(test, c)) {
            plan.push({line: line, node: test.node || "", kind: "control", key: test.yuno});
        }
    };
    if(control === "restart") {
        if(test.stop) {
            add_lines("stop");
        }
        for(let y of priv.scenario.yunos) {
            plan.push({line: lines.reset(y), node: y.node || "", kind: "app", key: y.key});
        }
        add_lines("start");
    } else {
        add_lines(control);
    }
    return plan;
}

/***************************************************************
 *  Ask the agent to push the readings (direct link only), or to stop.
 ***************************************************************/
function refresh_ms(gobj)
{
    let config = gobj_read_attr(gobj, "config_svc");
    return (config ? agent_config_get_monitor(config).refresh : 2) * 1000;
}

function send_watch(gobj)
{
    let priv = gobj.priv;
    if(priv.scenario.place !== "direct" || priv.push === false) {
        return;
    }
    send_request(gobj, lines.watch(priv.scenario.yunos, refresh_ms(gobj)), "watch", "", "");
}

function send_unwatch(gobj)
{
    let priv = gobj.priv;
    if(priv.scenario.place !== "direct" || priv.push !== true) {
        return;
    }
    send_request(gobj, lines.unwatch(), "watch", "", "");
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

function open_editor(gobj)
{
    let priv = gobj.priv;
    priv.editing = true;
    let base = priv.scenario || SCENARIO_TEMPLATE;
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
        log_error(`${gobj_short_name(gobj)}: EV_CONNECT without a scenario`);
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
    /*  Directly, first ask the agent to push; through the control
     *  center there is nothing to ask yet, poll.  */
    priv.push = priv.scenario.place === "direct" ? null : false;
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
    let failed = typeof kw.result === "number" && kw.result < 0;
    if(a.ack && !failed) {
        return 0;   /*  the control center dispatched it; the answer follows  */
    }
    if(kind === "yunos") {
        if(failed) {
            set_error(gobj, "monitor no answer", kw.comment || `list-yunos ${a.node}`);
            return 0;
        }
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
        if(failed) {
            if(priv.push !== false) {
                log_warning(`${gobj_short_name(gobj)}: the agent does not push the stats ` +
                    `(${kw.comment || "no comment"}), polling them`);
                priv.push = false;
                poll_tick(gobj);
            }
        } else {
            priv.push = true;
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
    if(kind === "control") {
        let c = priv.control;
        let control = msg_iev_read_key(kw, "monitor_control");
        if(!c || c.control !== control) {
            log_warning(`${gobj_short_name(gobj)}: answer of a control no longer shown (${control})`);
            return 0;
        }
        if(failed) {
            c.ok = false;
            c.text = kw.comment || t("monitor no answer");
            log_warning(`${gobj_short_name(gobj)}: control '${control}' failed: ${c.text}`);
        } else if(c.ok) {
            c.text = kw.comment || "";
        }
        render_status(gobj);
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
    let d = (kw && kw.data) || {};
    let hit = false;
    for(let y of priv.scenario.yunos) {
        if(y.id !== d.yuno_id) {
            continue;
        }
        if(d.kind === "state") {
            priv.model[y.key].run = d.missing ? "missing" : yuno_run_state(d);
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
 *  Save the scenario written in the editor. A new agent means a new
 *  link; the same agent keeps its session and only the yunos change.
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
    let old_where = priv.scenario
        ? `${priv.scenario.place}|${priv.scenario.agent_url || ""}` : "";
    priv.scenario = r.scenario;
    agent_config_set_monitor(config, {scenario: r.scenario});
    priv.editing = false;

    reset_model(gobj);
    gobj_start_charts(gobj);
    render_all(gobj);

    let st = gobj_current_state(gobj);
    let new_where = `${r.scenario.place}|${r.scenario.agent_url || ""}`;
    if(st === "ST_DISCONNECTED" || new_where !== old_where) {
        gobj_send_event(gobj, "EV_CONNECT", {}, gobj);
    } else if(st === "ST_MONITORING") {
        send_watch(gobj);
        poll_tick(gobj);
    }
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
    if(!priv.scenario || !priv.scenario.test || test_controls(priv.scenario.test).indexOf(control) < 0) {
        log_error(`${gobj_short_name(gobj)}: EV_TEST_CONTROL of no control of this test: '${control}'`);
        return -1;
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to confirm the control '${control}'`);
        return -1;
    }
    let plan_lines = control_plan(gobj, control).map((p) => (p.node ? `[${p.node}] ` : "") + p.line);
    let $msg = createElement2(
        ["div", {class: "MONITOR_CONFIRM"}, [
            ["p", {class: "MONITOR_CONFIRM_TEXT", i18n: `monitor confirm ${control}`},
                t(`monitor confirm ${control}`)],
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
    let plan = control_plan(gobj, control);
    priv.control = {control: control, ok: true, text: ""};
    if(control === "restart") {
        priv.rows = [];
        gobj_start_charts(gobj);
    }
    for(let p of plan) {
        send_request(gobj, p.line, p.kind, p.key, p.node,
            p.kind === "control" ? {monitor_control: control} : null);
    }
    render_status(gobj);
    return 0;
}

/***************************************************************
 *  The dialog was answered after the link went down: nothing was
 *  sent, and the operator is told so.
 ***************************************************************/
function ac_test_not_sent(gobj, event, kw, src)
{
    log_warning(`${gobj_short_name(gobj)}: control '${kw.control}' confirmed out of session, not sent`);
    gobj.priv.control = {control: kw.control, ok: false, text: "", not_sent: true};
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
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,   null],
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
        ["EV_YUNO_STATS",           0]
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
