/***********************************************************************
 *          c_agent_stats.js
 *
 *      C_AGENT_STATS — live statistics rendered as CARDS, one per yuno.
 *      A routed stage view with two shapes, chosen by the Statistics
 *      layout setting (Settings → Preferences):
 *
 *        - per-yuno tab  : pinned to one (node, yuno_id) -> ONE card.
 *        - single tab    : all:true + workspace -> a card per SELECTED
 *                          yuno (reads the tree picker's selection and
 *                          re-renders as it changes).
 *
 *      It owns no transport: it drives the shared C_AGENT_LINK, asking
 *      `stats-yuno id=<yuno_id>` (over command-agent) of each target node
 *      and rendering the flat {stat: value} answer. Every fetch is tagged
 *      console_purpose="stats" + console_node + console_yuno (echoed in
 *      __md_iev__) so each answer updates exactly its own card and other
 *      panels ignore it. No polling: on open, selection change, Refresh.
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
    msg_iev_write_key,
    msg_iev_read_key,
} from "@yuneta/gobj-js";

import i18next, {t} from "i18next";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    agent_config_get_selected_nodes,
    agent_config_get_stats_refresh,
    stats_sel_id,
    stats_sel_parse,
} from "./c_agent_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_STATS";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,         "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "statistics", "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,         "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,         "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,         "C_AGENT_CONFIG service"),
SDATA(data_type_t.DTP_BOOLEAN,  "all",         0,  false,        "true = one card per SELECTED yuno (single tab)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "statistics", "Selection bucket (all mode)"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",           "Pinned node id (per-yuno mode)"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",           "Pinned yuno id (per-yuno mode)"),
SDATA(data_type_t.DTP_STRING,   "yuno_label",  0,  "",           "Yuno label role^name (per-yuno mode)"),
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
    priv.cards = {};       /*  composite key -> {$body}  */
    priv.visible = true;   /*  poll only while the tab is shown  */

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
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
        gobj_subscribe_event(link, "EV_MT_STATS_ANSWER", {}, gobj);
    }
    /*  In "all" mode the card set tracks the tree picker's selection.  */
    let config = gobj_find_service("agent_config", true);
    gobj_write_attr(gobj, "config_svc", config);
    if(config) {
        gobj_subscribe_event(config, "EV_SELECTED_NODES_CHANGED", {}, gobj);
        gobj_subscribe_event(config, "EV_STATS_REFRESH_CHANGED", {}, gobj);
    }

    let $c = createElement2(
        ["div", {class: "view-card", style: "display:flex; flex-direction:column; height:100%;"}, []]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    build_dom(gobj);
    render_state(gobj);
    render_cards(gobj);
    watch_visibility(gobj);
    arm_poll(gobj);

    priv.on_lang = () => {
        let $c = gobj_read_attr(gobj, "$container");
        refresh_language($c, t);
        render_cards(gobj);
    };
    i18next.on("languageChanged", priv.on_lang);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    disarm_poll(gobj);
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
    }
    if(priv.on_lang) {
        i18next.off("languageChanged", priv.on_lang);
        priv.on_lang = null;
    }
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

function esc(s)
{
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => {
        return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c];
    });
}

/***************************************************************
 *  Format a counter value. Integers get "." thousands grouping
 *  (fixed separator — NOT navigator.language, the crash landmine).
 ***************************************************************/
function fmt_value(v)
{
    if(v === null || v === undefined) {
        return "";
    }
    if(typeof v === "number" && Number.isInteger(v)) {
        let neg = v < 0 ? "-" : "";
        let s = String(Math.abs(v));
        return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
    return String(v);
}

/***************************************************************
 *  The yunos to show, as [{node, yuno_id, label}]. "all" mode reads
 *  the tree picker's selection; per-yuno mode is the single pinned pair.
 ***************************************************************/
function compute_targets(gobj)
{
    if(gobj_read_attr(gobj, "all")) {
        let config = gobj_read_attr(gobj, "config_svc");
        let ws = gobj_read_attr(gobj, "workspace") || "statistics";
        let sel = config ? agent_config_get_selected_nodes(config, ws) : [];
        return sel.map((it) => {
            let p = stats_sel_parse(it.id);
            return {node: p.node, yuno_id: p.yuno_id, label: it.host || p.yuno_id};
        });
    }
    let node = gobj_read_attr(gobj, "node") || "";
    let yuno_id = gobj_read_attr(gobj, "yuno_id") || "";
    if(!node || !yuno_id) {
        return [];
    }
    return [{node: node, yuno_id: yuno_id, label: gobj_read_attr(gobj, "yuno_label") || yuno_id}];
}

/***************************************************************
 *  Counters table for one card's body (agent-sourced, cells esc()'d).
 ***************************************************************/
function table_html(data)
{
    let rows = [];
    if(data && typeof data === "object" && !Array.isArray(data)) {
        for(let k of Object.keys(data)) {
            rows.push([k, data[k]]);
        }
    }
    if(!rows.length) {
        return `<p class="has-text-grey is-size-7">${esc(t("no statistics"))}</p>`;
    }
    let trs = rows.map(([k, v]) => {
        return `<tr><td>${esc(k)}</td>` +
               `<td class="has-text-right is-family-monospace">${esc(fmt_value(v))}</td></tr>`;
    }).join("");
    return `<table class="table is-fullwidth is-narrow is-size-7"><tbody>${trs}</tbody></table>`;
}

/***************************************************************
 *  Static shell: a header/Refresh toolbar, the cards host, and the
 *  not-connected notice.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    let is_all = !!gobj_read_attr(gobj, "all");
    let heading = is_all
        ? t("statistics")
        : (gobj_read_attr(gobj, "yuno_label") || gobj_read_attr(gobj, "node") || t("statistics"));

    priv.$refresh = createElement2(
        ["button", {class: "button is-small", type: "button",
                    title: t("refresh"), "aria-label": t("refresh")},
            [["span", {class: "icon is-small"}, [["i", {class: "yi-arrows-rotate"}]]]],
            {click: () => render_cards(gobj)}]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            ["span", {class: "is-family-monospace is-size-7 has-text-weight-semibold"}, heading],
            ["span", {style: "margin-left:auto;"}, [priv.$refresh]]
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  Cards host: wraps into a responsive grid on wide screens.  */
    priv.$cards = createElement2(
        ["div", {class: "STATS_CARDS is-flex", style: "flex:1; min-height:0; overflow:auto; " +
                 "flex-wrap:wrap; gap:0.75rem; align-content:flex-start;"}, []]
    );
    $c.appendChild(priv.$cards);

    priv.$notif = createElement2(
        ["div", {class: "notification is-light", style: "display:none;", i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  (Re)build the cards for the current targets and fetch each one's
 *  stats. Called on start, on selection change (all mode), and Refresh.
 ***************************************************************/
function render_cards(gobj)
{
    let priv = gobj.priv;
    if(!priv.$cards) {
        return;
    }
    clear_node(priv.$cards);
    priv.cards = {};

    let targets = compute_targets(gobj);
    if(!targets.length) {
        priv.$cards.appendChild(createElement2(
            ["p", {class: "has-text-grey is-size-7 p-2", i18n: "pick yunos hint"},
                "Select one or more yunos in Nodes."]
        ));
        refresh_language(priv.$cards, t);
        return;
    }

    for(let tgt of targets) {
        let $body = createElement2(
            ["div", {class: "STATS_TABLE", style: "overflow:auto;"},
                `<p class="has-text-grey is-size-7">…</p>`]
        );
        let $card = createElement2(
            ["div", {class: "card STATS_CARD", style: "width:20rem; max-width:100%;"},
                [
                    ["div", {class: "card-content", style: "padding:0.9rem;"},
                        [
                            ["p", {class: "is-size-6 has-text-weight-bold is-family-monospace"}, tgt.label],
                            ["p", {class: "is-size-7 has-text-grey mb-2"}, tgt.node],
                            $body
                        ]
                    ]
                ]
            ]
        );
        priv.$cards.appendChild($card);
        priv.cards[stats_sel_id(tgt.node, tgt.yuno_id)] = {$body: $body};
        request_stats_for(gobj, tgt.node, tgt.yuno_id);
    }
}

/***************************************************************
 *  Fill one card's body from a stats answer.
 ***************************************************************/
function fill_card(gobj, node, yuno_id, data)
{
    let priv = gobj.priv;
    let card = priv.cards[stats_sel_id(node, yuno_id)];
    if(card && card.$body) {
        card.$body.innerHTML = table_html(data);
    }
}

/***************************************************************
 *  Toggle the cards vs the not-connected notice.
 ***************************************************************/
function render_state(gobj)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));

    priv.$toolbar.style.display = connected ? "" : "none";
    priv.$cards.style.display = connected ? "" : "none";
    priv.$notif.style.display = connected ? "none" : "";
}




                    /***************************
                     *      Requests
                     ***************************/




/***************************************************************
 *  Ask a node for one yuno's stats.
 ***************************************************************/
function request_stats_for(gobj, node, yuno_id)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!node || !yuno_id || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {agent_id: node, cmd2agent: `stats-yuno id="${yuno_id}"`};
    msg_iev_write_key(kw_send, "console_purpose", "stats");
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno_id);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Auto-refresh. A DELIBERATE, opt-in exception to Yuneta's no-polling
 *  rule (default 2 s, configurable / disable-able in Settings): while the
 *  link is up, re-request every visible card's stats on a fixed cadence.
 *  It only re-fetches the CURRENT targets — the card DOM is not rebuilt,
 *  each answer just refills its own body — so no flicker/scroll reset.
 ***************************************************************/
function poll_tick(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!link || !agent_link_is_connected(link)) {
        return;
    }
    for(let tgt of compute_targets(gobj)) {
        request_stats_for(gobj, tgt.node, tgt.yuno_id);
    }
}

function disarm_poll(gobj)
{
    let priv = gobj.priv;
    if(priv.poll_timer) {
        clearInterval(priv.poll_timer);
        priv.poll_timer = null;
    }
}

function arm_poll(gobj)
{
    disarm_poll(gobj);
    let priv = gobj.priv;
    let config = gobj_read_attr(gobj, "config_svc");
    let secs = config ? agent_config_get_stats_refresh(config) : 0;
    let link = gobj_read_attr(gobj, "link_svc");
    if(secs > 0 && priv.visible && link && agent_link_is_connected(link)) {
        priv.poll_timer = setInterval(() => poll_tick(gobj), secs * 1000);
    }
}

/***************************************************************
 *  Poll only while this tab is the visible stage view — the shell
 *  reveals/hides a keep_alive view by toggling `is-hidden` on its
 *  $container (no hook), so watch that flip: on show, re-arm + refresh
 *  now; on hide, disarm so we don't hammer the control center for a tab
 *  nobody is looking at.
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
        if(vis === priv.visible) {
            return;
        }
        priv.visible = vis;
        if(vis) {
            arm_poll(gobj);
            poll_tick(gobj);   /*  fresh numbers the moment you return  */
        } else {
            disarm_poll(gobj);
        }
    });
    priv.vis_obs.observe($c, {attributes: true, attributeFilter: ["class"]});
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_on_open(gobj, event, kw, src)
{
    render_state(gobj);
    render_cards(gobj);
    arm_poll(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    disarm_poll(gobj);   /*  no point polling a dropped link  */
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  Auto-refresh interval changed in Settings — re-arm the timer.
 ***************************************************************/
function ac_stats_refresh_changed(gobj, event, kw, src)
{
    arm_poll(gobj);
    return 0;
}

/***************************************************************
 *  Selection changed (all mode) — rebuild the card set.
 ***************************************************************/
function ac_selected_nodes_changed(gobj, event, kw, src)
{
    if(!gobj_read_attr(gobj, "all")) {
        return 0;
    }
    let ws = gobj_read_attr(gobj, "workspace") || "statistics";
    if(kw && kw.workspace && kw.workspace !== ws) {
        return 0;
    }
    render_cards(gobj);
    return 0;
}

/***************************************************************
 *  stats-yuno dispatch ack (data null). A failed dispatch clears that
 *  yuno's card; the real counters arrive via EV_MT_STATS_ANSWER.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    if(msg_iev_read_key(kw, "console_purpose") !== "stats") {
        return 0;
    }
    if(typeof kw.result === "number" && kw.result < 0) {
        let node = msg_iev_read_key(kw, "console_node") || "";
        let yuno = msg_iev_read_key(kw, "console_yuno") || "";
        fill_card(gobj, node, yuno, null);
    }
    return 0;
}

/***************************************************************
 *  Stats answer — route the flat {stat: value} to its card.
 ***************************************************************/
function ac_mt_stats_answer(gobj, event, kw, src)
{
    if(msg_iev_read_key(kw, "console_purpose") !== "stats") {
        return 0;
    }
    let node = msg_iev_read_key(kw, "console_node") || "";
    let yuno = msg_iev_read_key(kw, "console_yuno") || "";
    fill_card(gobj, node, yuno, kw.data);
    return 0;
}




                    /***************************
                     *              FSM
                     ***************************/




const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy
};

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
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
            ["EV_MT_STATS_ANSWER",   ac_mt_stats_answer,   null],
            ["EV_SELECTED_NODES_CHANGED", ac_selected_nodes_changed, null],
            ["EV_STATS_REFRESH_CHANGED",  ac_stats_refresh_changed,  null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_MT_COMMAND_ANSWER", 0],
        ["EV_MT_STATS_ANSWER",   0],
        ["EV_SELECTED_NODES_CHANGED", 0],
        ["EV_STATS_REFRESH_CHANGED",  0]
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

function register_c_agent_stats()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_stats};
