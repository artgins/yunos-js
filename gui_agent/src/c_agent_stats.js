/***********************************************************************
 *          c_agent_stats.js
 *
 *      C_AGENT_STATS — live statistics of a single YUNO, a routed stage
 *      view. One instance is PINNED to a (node, yuno_id) pair chosen in
 *      the Statistics tree picker (C_STATS_NODES); each selected yuno
 *      gets its own tab. The counters (SDF_RSTATS) render as ONE card.
 *      The empty-state route /statistics/node carries node="".
 *
 *      Like the Console it owns no transport: it drives the shared
 *      C_AGENT_LINK. It asks `stats-yuno id=<yuno_id>` of the pinned node
 *      (over command-agent) and renders the answer's flat {stat: value}
 *      object. The shared link re-publishes every answer to ALL panels,
 *      so this view tags its fetch with console_purpose="stats" +
 *      console_node + console_yuno (echoed back in __md_iev__) and renders
 *      only the answer matching all three — several yuno tabs coexist on
 *      the one link. No polling: refresh on open + the Refresh button.
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
    msg_iev_get_stack,
    msg_iev_write_key,
    msg_iev_read_key,
    kw_get_str,
} from "@yuneta/gobj-js";

import i18next, {t} from "i18next";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";


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
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",           "Pinned node id (host/uuid); '' = empty state"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",           "Pinned yuno id"),
SDATA(data_type_t.DTP_STRING,   "yuno_label",  0,  "",           "Yuno label (role^name) for the card header"),
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
    priv.last_stats = null;   /*  last rendered {stat: value} (re-render on lang)  */

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
    /*  Pinned yuno: fetch its stats. If the link is not open yet, the
     *  EV_ON_OPEN action retries.  */
    request_stats(gobj);

    priv.on_lang = () => {
        let $c = gobj_read_attr(gobj, "$container");
        refresh_language($c, t);
        set_stats(gobj, priv.last_stats);   /*  re-render header labels  */
    };
    i18next.on("languageChanged", priv.on_lang);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
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
 *  (fixed separator — NOT navigator.language, the known crash
 *  landmine); everything else prints as-is.
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
 *  Static shell: a Refresh toolbar, the card host, and the
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

    priv.$refresh = createElement2(
        ["button", {class: "button is-small", type: "button",
                    title: t("refresh"), "aria-label": t("refresh")},
            [["span", {class: "icon is-small"}, [["i", {class: "yi-arrows-rotate"}]]]],
            {click: () => request_stats(gobj)}]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            ["span", {class: "is-family-monospace is-size-7 has-text-weight-semibold"},
                gobj_read_attr(gobj, "yuno_label") || gobj_read_attr(gobj, "node") || t("statistics")],
            ["span", {style: "margin-left:auto;"}, [priv.$refresh]]
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  Card host (scrolls when the counters overflow).  */
    priv.$cards = createElement2(
        ["div", {class: "STATS_CARDS", style: "flex:1; min-height:0; overflow:auto;"}, []]
    );
    $c.appendChild(priv.$cards);

    /*  Not-connected notice.  */
    priv.$notif = createElement2(
        ["div", {class: "notification is-light", style: "display:none;", i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  Render the pinned yuno's counters as ONE card: role^name header,
 *  node subtitle, then a stat/value table.
 ***************************************************************/
function set_stats(gobj, data)
{
    let priv = gobj.priv;
    priv.last_stats = data;
    if(!priv.$cards) {
        return;
    }
    clear_node(priv.$cards);

    let node = gobj_read_attr(gobj, "node") || "";
    let label = gobj_read_attr(gobj, "yuno_label") || gobj_read_attr(gobj, "yuno_id") || "";

    let rows = [];
    if(data && typeof data === "object" && !Array.isArray(data)) {
        for(let k of Object.keys(data)) {
            rows.push([k, data[k]]);
        }
    }

    let body;
    if(!rows.length) {
        body = ["p", {class: "has-text-grey is-size-7", i18n: "no statistics"}, "No statistics"];
    } else {
        let trs = rows.map(([k, v]) => {
            return `<tr><td>${esc(k)}</td>` +
                   `<td class="has-text-right is-family-monospace">${esc(fmt_value(v))}</td></tr>`;
        }).join("");
        /*  Raw-HTML content (a string starting with '<') is parsed and
         *  appended by createElement2 — the table is agent-sourced but
         *  every cell is esc()'d above.  */
        body = ["div", {class: "STATS_TABLE", style: "overflow:auto;"},
            `<table class="table is-fullwidth is-narrow is-size-7"><tbody>${trs}</tbody></table>`];
    }

    let card = createElement2(
        ["div", {class: "card STATS_CARD", style: "max-width:640px;"},
            [
                ["div", {class: "card-content", style: "padding:0.9rem;"},
                    [
                        ["p", {class: "is-size-6 has-text-weight-bold is-family-monospace"}, esc(label)],
                        ["p", {class: "is-size-7 has-text-grey mb-2"}, esc(node)],
                        body
                    ]
                ]
            ]
        ]
    );
    priv.$cards.appendChild(card);
    refresh_language(priv.$cards, t);
}

/***************************************************************
 *  Toggle the card vs the not-connected notice.
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
 *  Ask the pinned node for the pinned yuno's stats.
 ***************************************************************/
function request_stats(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    let yuno_id = gobj_read_attr(gobj, "yuno_id") || "";
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
 *  Is this answer ours? (purpose + node + yuno all match).
 ***************************************************************/
function is_mine(gobj, kw)
{
    if(msg_iev_read_key(kw, "console_purpose") !== "stats") {
        return false;
    }
    let my_node = gobj_read_attr(gobj, "node") || "";
    let ans_node = msg_iev_read_key(kw, "console_node");
    if(my_node && ans_node && ans_node !== my_node) {
        return false;
    }
    let my_yuno = gobj_read_attr(gobj, "yuno_id") || "";
    let ans_yuno = msg_iev_read_key(kw, "console_yuno");
    if(my_yuno && ans_yuno && ans_yuno !== my_yuno) {
        return false;
    }
    return true;
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_on_open(gobj, event, kw, src)
{
    render_state(gobj);
    request_stats(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The stats-yuno dispatch ack (data null). Surface only a failed
 *  dispatch (e.g. no authz); the counters arrive via EV_MT_STATS_ANSWER.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    if(!is_mine(gobj, kw)) {
        return 0;
    }
    if(typeof kw.result === "number" && kw.result < 0) {
        set_stats(gobj, null);   /*  clear; the notice/empty card shows  */
    }
    return 0;
}

/***************************************************************
 *  Stats answer — a `stats-yuno` reply (flat {stat: value}).
 ***************************************************************/
function ac_mt_stats_answer(gobj, event, kw, src)
{
    if(!is_mine(gobj, kw)) {
        return 0;
    }
    set_stats(gobj, kw.data);
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
            ["EV_MT_STATS_ANSWER",   ac_mt_stats_answer,   null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_MT_COMMAND_ANSWER", 0],
        ["EV_MT_STATS_ANSWER",   0]
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
