/***********************************************************************
 *          c_agent_stats.js
 *
 *      C_AGENT_STATS — live statistics of a yuno, a routed stage view
 *      (mounted by C_YUI_SHELL at /stats/live).
 *
 *      Like the Console, it owns no transport: it uses the shared
 *      C_AGENT_LINK ("agent_link") and routes everything through the
 *      control center. Three steps, all over `command-agent`:
 *          1. list-agents        -> fills the NODE selector.
 *          2. list-yunos (node)  -> fills the YUNO selector (running).
 *          3. stats-yuno id=<y>  -> the yuno's SDF_RSTATS counters,
 *                                   rendered as a Tabulator table.
 *
 *      The shared link re-publishes every answer to ALL panels, so this
 *      view tags its own list-yunos / stats-yuno fetches with
 *      console_purpose="stats" (echoed back in __md_iev__) and only
 *      handles those; the list-agents answer is shared (the Nodes panel
 *      and C_APP consume it too). The Console ignores any answer carrying
 *      a non-console purpose.
 *
 *      No polling (a discarded pattern in Yuneta): the table refreshes on
 *      selection change and on the explicit Refresh button.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent, gobj_name,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr, gobj_write_str_attr,
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
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    agent_config_get_active_node,
    agent_config_set_active_node,
} from "./c_agent_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_STATS";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,     "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "stats",  "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,     "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,     "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,     "C_AGENT_CONFIG service"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,     "Tabulator instance"),
SDATA(data_type_t.DTP_JSON,     "nodes",       0,  "[]",     "Parsed list-agents result"),
SDATA(data_type_t.DTP_JSON,     "yunos",       0,  "[]",     "Running yunos of the selected node"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",       "Selected node id (host/uuid)"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",       "Selected yuno id"),
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
    priv.table_id = `stats_table_${gobj_name(gobj)}`;

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
    gobj_write_attr(gobj, "config_svc", gobj_find_service("agent_config", true));

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
    create_table(gobj);
    render_state(gobj);
    request_agents(gobj);

    /*  Tabulator headers are rendered by formatters, not data-i18n DOM,
     *  so rebuild the columns on a language switch (no browser refresh).  */
    priv.on_lang = () => {
        let table = gobj_read_attr(gobj, "tabulator");
        if(table && table._ready) {
            table.setColumns(make_columns());
        }
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
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        table.destroy();
        gobj_write_attr(gobj, "tabulator", null);
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

/***************************************************************
 *  Minimal HTML escaping for values rendered as Tabulator
 *  formatter HTML.
 ***************************************************************/
function esc(s)
{
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => {
        return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c];
    });
}

/***************************************************************
 *  Parse one list-agents line:
 *  "UUID:<uuid> (<role>,<ver>),  HOSTNAME:'<host>'"
 ***************************************************************/
function parse_agent_line(s)
{
    s = String(s || "");
    let uuid = (/UUID:(\S+)/.exec(s) || [])[1] || "";
    let host = (/HOSTNAME:'([^']*)'/.exec(s) || [])[1] || "";
    return {
        id:   host || uuid,
        host: host,
        uuid: uuid
    };
}

/***************************************************************
 *  Build the static shell: the node/yuno selectors + Refresh
 *  toolbar, the Tabulator host, and the not-connected notice.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    /*  Node selector (all connected nodes).  */
    priv.$node = createElement2(["select", {"aria-label": t("select a node")}, null, {
        change: () => on_node_change(gobj)
    }]);
    let $node_wrap = createElement2(["div", {class: "select", style: "min-width:0;"}, [priv.$node]]);

    /*  Yuno selector (running yunos of the selected node).  */
    priv.$yuno = createElement2(["select", {"aria-label": t("select a yuno")}, null, {
        change: () => on_yuno_change(gobj)
    }]);
    let $yuno_wrap = createElement2(["div", {class: "select", style: "min-width:0;"}, [priv.$yuno]]);

    priv.$refresh = createElement2(
        ["button", {class: "button", type: "button", style: "margin-left:auto;", i18n: "refresh"},
            "Refresh", {click: () => request_stats(gobj)}]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem; flex-wrap:wrap;"}, [
            $node_wrap,
            $yuno_wrap,
            priv.$refresh
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  Tabulator host  */
    priv.$tablewrap = createElement2(
        ["div", {style: "flex:1; min-height:0;"}, [
            ["div", {id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    /*  Not-connected notice.  */
    priv.$notif = createElement2(
        ["div", {class: "notification is-light", style: "display:none;", i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  Column definitions. Rebuilt on create + on every language
 *  change so the two headers re-translate live.
 ***************************************************************/
function make_columns()
{
    /*  Numeric values right-aligned monospace; strings left. No Intl
     *  grouping (navigator.language is a known crash landmine here).  */
    function value_formatter(cell)
    {
        let v = cell.getValue();
        if(v === null || v === undefined) {
            return "";
        }
        if(typeof v === "number") {
            return `<span class="is-family-monospace">${esc(v)}</span>`;
        }
        return esc(v);
    }

    return [
        {title: t("statistic"), field: "stat", widthGrow: 2},
        {title: t("value"), field: "value", widthGrow: 1, hozAlign: "right",
            formatter: value_formatter}
    ];
}

/***************************************************************
 *  Fill a <select> with options, preserving `selected` when it is
 *  still present. `items` = [{value, label}], `placeholder` shows
 *  when the list is empty.
 ***************************************************************/
function fill_select($select, items, selected, placeholder)
{
    if(!$select) {
        return;
    }
    clear_node($select);
    if(!items.length) {
        $select.appendChild(createElement2(["option", {value: ""}, placeholder]));
        $select.disabled = true;
        return;
    }
    $select.disabled = false;
    for(let it of items) {
        let attrs = {value: it.value};
        if(it.value === selected) {
            attrs.selected = "selected";
        }
        $select.appendChild(createElement2(["option", attrs, it.label]));
    }
}

/***************************************************************
 *  Toggle the toolbar/table vs the not-connected notice.
 ***************************************************************/
function render_state(gobj)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));

    priv.$toolbar.style.display = connected ? "" : "none";
    priv.$tablewrap.style.display = connected ? "" : "none";
    priv.$notif.style.display = connected ? "none" : "";
}

/***************************************************************
 *  Create the (empty) Tabulator instance.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;

    let table = new Tabulator(`#${priv.table_id}`, {
        index:          "stat",
        layout:         "fitColumns",
        maxHeight:      "100%",
        placeholder:    t("no statistics"),
        columnDefaults: {headerHozAlign: "left", resizable: false},
        columns:        make_columns()
    });
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        if(table._pendingData !== undefined) {
            table.setData(table._pendingData);
            delete table._pendingData;
        }
    });
    gobj_write_attr(gobj, "tabulator", table);
}

/***************************************************************
 *  Push a stats {stat: value} object into the table as rows.
 ***************************************************************/
function set_stats(gobj, data)
{
    let rows = [];
    if(data && typeof data === "object" && !Array.isArray(data)) {
        for(let k of Object.keys(data)) {
            rows.push({stat: k, value: data[k]});
        }
    }
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        if(table._ready) {
            table.replaceData(rows);
        } else {
            table._pendingData = rows;
        }
    }
}




                    /***************************
                     *      Requests
                     ***************************/




/***************************************************************
 *  Ask the control center for the connected nodes (fills the node
 *  selector). The answer is shared with the Nodes panel + C_APP.
 ***************************************************************/
function request_agents(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        agent_link_command(link, "list-agents", {});
    }
}

/***************************************************************
 *  Ask the selected node for its yunos (fills the yuno selector).
 ***************************************************************/
function request_yunos(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    if(!node || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {agent_id: node, cmd2agent: "list-yunos"};
    msg_iev_write_key(kw_send, "console_purpose", "stats");
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Ask the selected node for the selected yuno's stats.
 ***************************************************************/
function request_stats(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    let node = gobj_read_attr(gobj, "node") || "";
    let yuno_id = gobj_read_attr(gobj, "yuno_id") || "";
    if(!node || !yuno_id || !link || !agent_link_is_connected(link)) {
        return;
    }
    /*  Target the single yuno by id; stats_to_yuno() defaults the service
     *  to the yuno_role, so the citizen gclass RSTATS come back.  */
    let kw_send = {agent_id: node, cmd2agent: `stats-yuno id="${yuno_id}"`};
    msg_iev_write_key(kw_send, "console_purpose", "stats");
    agent_link_command(link, "command-agent", kw_send);
}




                    /***************************
                     *      Selection
                     ***************************/




/***************************************************************
 *  Node list arrived — fill the node selector, keep or default
 *  the selection, then load its yunos.
 ***************************************************************/
function set_nodes(gobj, data)
{
    let nodes = [];
    if(Array.isArray(data)) {
        for(let line of data) {
            let n = parse_agent_line(line);
            if(n.id) {
                nodes.push(n);
            }
        }
    }
    gobj_write_attr(gobj, "nodes", nodes);

    /*  Keep the current node if still present; else the app's active
     *  node; else the first.  */
    let cur = gobj_read_attr(gobj, "node") || "";
    let config = gobj_read_attr(gobj, "config_svc");
    let active = config ? agent_config_get_active_node(config) : "";
    let ids = nodes.map((n) => n.id);
    let chosen = "";
    if(cur && ids.includes(cur)) {
        chosen = cur;
    } else if(active && ids.includes(active)) {
        chosen = active;
    } else if(ids.length) {
        chosen = ids[0];
    }

    fill_select(gobj.priv.$node,
        nodes.map((n) => ({value: n.id, label: n.host || n.id})),
        chosen, t("select a node"));

    if(chosen && chosen !== cur) {
        select_node(gobj, chosen);
    } else if(chosen) {
        request_yunos(gobj);
    }
}

/***************************************************************
 *  Adopt a node as the current one (persist it as the app active
 *  node) and reload its yunos.
 ***************************************************************/
function select_node(gobj, node)
{
    gobj_write_str_attr(gobj, "node", node);
    gobj_write_str_attr(gobj, "yuno_id", "");
    set_stats(gobj, null);
    let config = gobj_read_attr(gobj, "config_svc");
    if(config) {
        agent_config_set_active_node(config, node);
    }
    request_yunos(gobj);
}

/***************************************************************
 *  Yuno list arrived — fill the yuno selector (running only),
 *  keep or default the selection, then load its stats.
 ***************************************************************/
function set_yunos(gobj, data)
{
    let yunos = [];
    if(Array.isArray(data)) {
        for(let y of data) {
            /*  stats only make sense for a running yuno; a missing
             *  yuno_running field means "unknown" — keep it.  */
            if(y && y.yuno_running === false) {
                continue;
            }
            let id = y && y.id;
            if(id) {
                /*  Label as "role^name" (Yuneta's canonical yuno id form):
                 *  distinguishes several instances of the same role (each
                 *  still targets its own treedb id).  */
                let role = (y && y.yuno_role) || "";
                let name = (y && y.yuno_name) || "";
                let label = (role && name) ? `${role}^${name}` : (role || name || id);
                yunos.push({id: id, label: label});
            }
        }
    }
    gobj_write_attr(gobj, "yunos", yunos);

    let cur = gobj_read_attr(gobj, "yuno_id") || "";
    let ids = yunos.map((y) => y.id);
    let chosen = (cur && ids.includes(cur)) ? cur : (ids.length ? ids[0] : "");

    fill_select(gobj.priv.$yuno,
        yunos.map((y) => ({value: y.id, label: y.label})),
        chosen, t("select a yuno"));

    gobj_write_str_attr(gobj, "yuno_id", chosen);
    if(chosen) {
        request_stats(gobj);
    } else {
        set_stats(gobj, null);
    }
}

/***************************************************************
 *  Node selector changed (user).
 ***************************************************************/
function on_node_change(gobj)
{
    let node = gobj.priv.$node ? gobj.priv.$node.value : "";
    if(node && node !== (gobj_read_attr(gobj, "node") || "")) {
        select_node(gobj, node);
    }
}

/***************************************************************
 *  Yuno selector changed (user).
 ***************************************************************/
function on_yuno_change(gobj)
{
    let yuno_id = gobj.priv.$yuno ? gobj.priv.$yuno.value : "";
    gobj_write_str_attr(gobj, "yuno_id", yuno_id);
    if(yuno_id) {
        request_stats(gobj);
    } else {
        set_stats(gobj, null);
    }
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Link in session — (re)load the node list.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    render_state(gobj);
    request_agents(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  Command answer. The shared link re-publishes every answer:
 *    - list-agents        -> node selector (shared with Nodes/C_APP);
 *    - list-yunos         -> yuno selector (our tagged fetch);
 *  the stats counters do NOT arrive here — a `stats-yuno` answer is a
 *  __message__ (EV_MT_STATS_ANSWER), handled below; the `command-agent`
 *  reply here is just the dispatch ack (data null).
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let command = kw_get_str(gobj, stk, "command", "", 0);

    if(command === "list-agents") {
        set_nodes(gobj, kw.data);
        return 0;
    }

    /*  Only OUR list-yunos fetch carries this marker.  */
    if(msg_iev_read_key(kw, "console_purpose") !== "stats") {
        return 0;
    }

    if(command === "list-yunos") {
        set_yunos(gobj, kw.data);
        return 0;
    }

    /*  Anything else (e.g. the command-agent dispatch ack) is not
     *  rendered here — the real counters come via EV_MT_STATS_ANSWER.  */
    return 0;
}

/***************************************************************
 *  Stats answer. A `stats-yuno` reply is a __message__, re-published
 *  by the link as EV_MT_STATS_ANSWER (the Console never subscribes to
 *  it, so no cross-talk). `data` is a flat {stat: value} object.
 ***************************************************************/
function ac_mt_stats_answer(gobj, event, kw, src)
{
    /*  Only our own tagged stats-yuno fetches.  */
    if(msg_iev_read_key(kw, "console_purpose") !== "stats") {
        return 0;
    }
    set_stats(gobj, kw.data);
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

/***************************************************************
 *          Register GClass
 ***************************************************************/
function register_c_agent_stats()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_stats};
