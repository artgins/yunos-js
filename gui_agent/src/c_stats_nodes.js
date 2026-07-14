/***********************************************************************
 *          c_stats_nodes.js
 *
 *      C_STATS_NODES — the Statistics workspace node picker, a TREE:
 *      top rows are the nodes (list-agents, agent >= min_version) and
 *      each node expands to its running yunos as sub-rows (list-yunos,
 *      fetched per node). A checkbox on a YUNO row selects it — each
 *      selected yuno opens its own Statistics tab (a card of its
 *      SDF_RSTATS counters). The C_NODES flat picker stays for the
 *      Commands / Terminal workspaces; this tree is Statistics-only.
 *
 *      Selection reuses the shared per-workspace machinery: a yuno is
 *      stored as a composite id "node<US>yuno_id" (stats_sel_id), so the
 *      C_APP workspaces controller builds one tab per selected yuno.
 *
 *      Like the other pickers it owns no transport: it drives the shared
 *      C_AGENT_LINK. Answers are re-published to every panel, so its
 *      list-yunos fetches are tagged console_purpose="statnodes" +
 *      console_node=<node> (both echoed in __md_iev__) — the Console
 *      (no purpose) and the Statistics card (purpose "stats") ignore them.
 *      No polling: the tree loads on open and on the Refresh button.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent, gobj_name,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_short_name,
    gobj_find_service,
    createElement2,
    refresh_language,
    msg_iev_get_stack,
    msg_iev_write_key,
    msg_iev_read_key,
    kw_get_str,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    agent_config_is_node_selected,
    agent_config_toggle_selected_node,
    stats_sel_id,
} from "./c_agent_config.js";
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_STATS_NODES";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,       "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "nodes",    "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "statistics", "Owning workspace (selection bucket)"),
SDATA(data_type_t.DTP_STRING,   "min_version", 0,  "",         "Only list nodes with version >= this (empty = all)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,       "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,       "Tabulator instance"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,       "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,       "C_AGENT_CONFIG service"),
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
    priv.table_id = `statnodes_table_${gobj_name(gobj)}`;
    priv.nodes = [];              /*  parsed list-agents (node rows)  */
    priv.yunos = {};              /*  node id -> [yuno rows] (loaded)  */
    priv.render_pending = false;  /*  one-shot setData debounce  */

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
    }
    let config = gobj_find_service("agent_config", true);
    gobj_write_attr(gobj, "config_svc", config);
    if(config) {
        gobj_subscribe_event(config, "EV_SELECTED_NODES_CHANGED", {}, gobj);
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
    create_table(gobj);
    render_state(gobj);
    request_agents(gobj);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
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

function esc(s)
{
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => {
        return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c];
    });
}

/***************************************************************
 *  Dotted-version compare helpers (shared shape with C_NODES).
 ***************************************************************/
function version_tuple(v)
{
    return String(v || "").split(".").map((x) => parseInt(x, 10) || 0);
}

function version_gte(a, b)
{
    if(!b) {
        return true;
    }
    let A = version_tuple(a);
    let B = version_tuple(b);
    let n = Math.max(A.length, B.length);
    for(let i = 0; i < n; i++) {
        let d = (A[i] || 0) - (B[i] || 0);
        if(d !== 0) {
            return d > 0;
        }
    }
    return true;
}

function version_cmp(a, b)
{
    let A = version_tuple(a);
    let B = version_tuple(b);
    let n = Math.max(A.length, B.length);
    for(let i = 0; i < n; i++) {
        let d = (A[i] || 0) - (B[i] || 0);
        if(d !== 0) {
            return d;
        }
    }
    return 0;
}

/***************************************************************
 *  A node's id: host preferred, else uuid.
 ***************************************************************/
function node_id(n)
{
    return (n && (n.host || n.uuid)) || "";
}

/***************************************************************
 *  Parse one list-agents line into a node.
 ***************************************************************/
function parse_agent_line(s)
{
    s = String(s || "");
    let uuid = (/UUID:(\S+)/.exec(s) || [])[1] || "";
    let rv   = /\(([^,]+),\s*([^)]+)\)/.exec(s);
    let host = (/HOSTNAME:'([^']*)'/.exec(s) || [])[1] || "";
    return {
        uuid:    uuid,
        role:    rv ? rv[1].trim() : "",
        version: rv ? rv[2].trim() : "",
        host:    host
    };
}

/***************************************************************
 *  Is this yuno selected in the Statistics workspace (has a tab)?
 ***************************************************************/
function is_yuno_selected(gobj, node, yuno_id)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    return !!(config && agent_config_is_node_selected(config, ws, stats_sel_id(node, yuno_id)));
}

/***************************************************************
 *  Build the tree rows from priv.nodes + priv.yunos.
 *  Node row  : {_key, _type:"node", host, role, version, uuid, _children}
 *  Yuno row  : {_key, _type:"yuno", node, yuno_id, label, running}
 ***************************************************************/
function build_tree(gobj)
{
    let priv = gobj.priv;
    let tree = [];
    for(let n of priv.nodes) {
        let id = node_id(n);
        let children = [];
        let loaded = priv.yunos[id];
        if(Array.isArray(loaded)) {
            for(let y of loaded) {
                children.push(y);
            }
        }
        tree.push({
            _key:     id,
            _type:    "node",
            host:     n.host || id,
            role:     n.role || "",
            version:  n.version || "",
            uuid:     n.uuid || "",
            _children: children
        });
    }
    return tree;
}

/***************************************************************
 *  Push the current tree into Tabulator (debounced to one setData per
 *  microtask burst, so the flurry of per-node list-yunos answers does
 *  not rebuild the table many times).
 ***************************************************************/
function schedule_render(gobj)
{
    let priv = gobj.priv;
    if(priv.render_pending) {
        return;
    }
    priv.render_pending = true;
    setTimeout(() => {
        priv.render_pending = false;
        let table = gobj_read_attr(gobj, "tabulator");
        let tree = build_tree(gobj);
        if(table) {
            if(table._ready) {
                table.setData(tree);
            } else {
                table._pendingData = tree;
            }
        }
        update_count(gobj);
    }, 0);
}

/***************************************************************
 *  Static shell: search toolbar + Tabulator host + not-connected notice.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    let $input = createElement2(["input", {
        class:        "input",
        type:         "text",
        placeholder:  t("search nodes"),
        "aria-label": t("search nodes"),
        "data-i18n-aria-label": "search nodes"
    }, null, {
        input: () => apply_filter(gobj)
    }]);
    priv.$input = $input;

    let $count = createElement2(["span", {class: "is-size-7 has-text-grey"}, ""]);
    priv.$count = $count;

    let $search_control = createElement2(
        ["div", {class: "control has-icons-left", style: "flex:0 1 22rem; min-width:0;"}, [
            $input,
            ["span", {class: "icon is-left"}, [
                ["span", {class: "yi-magnifying-glass"}, ""]
            ]]
        ]]
    );
    attach_clear($search_control, $input);

    priv.$toolbar = createElement2(
        ["div", {class: "is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            $search_control,
            $count,
            ["button", {class: "button", type: "button", style: "margin-left:auto;", i18n: "refresh"},
                "Refresh", {click: () => request_agents(gobj)}]
        ]]
    );
    $c.appendChild(priv.$toolbar);

    priv.$tablewrap = createElement2(
        ["div", {style: "flex:1; min-height:0;"}, [
            ["div", {id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    priv.$notif = createElement2(
        ["div", {class: "notification is-light", style: "display:none;", i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  Columns: a checkbox (yuno rows only), the tree name column
 *  (node host / yuno role^name), and an info column.
 ***************************************************************/
function make_columns(gobj)
{
    /*  Name: the tree column. Node -> host; yuno -> role^name label,
     *  bold when that yuno has an open Statistics tab.  */
    function name_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "yuno") {
            let sel = is_yuno_selected(gobj, r.node, r.yuno_id);
            let cls = sel ? "has-text-weight-bold" : "";
            return `<span class="${cls}">${esc(r.label)}</span>`;
        }
        return `<span class="has-text-weight-semibold">${esc(r.host)}</span>`;
    }

    /*  Info: node -> "v<version> · <role>"; yuno -> running badge.  */
    function info_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "yuno") {
            return r.running
                ? `<span class="has-text-success is-size-7">${esc(t("running"))}</span>`
                : `<span class="has-text-grey is-size-7">${esc(t("stopped"))}</span>`;
        }
        let v = r.version ? `v${esc(r.version)}` : "";
        let role = r.role ? ` · ${esc(r.role)}` : "";
        return `<span class="is-size-7 has-text-grey">${v}${role}</span>`;
    }

    /*  Checkbox: only yuno rows are selectable (a node is a container).  */
    function sel_formatter(cell)
    {
        let r = cell.getData();
        if(r._type !== "yuno") {
            return "";
        }
        let checked = is_yuno_selected(gobj, r.node, r.yuno_id) ? " checked" : "";
        return `<input type="checkbox" class="node-sel"${checked} aria-label="open stats tab">`;
    }

    function sel_click(e, cell)
    {
        let r = cell.getData();
        if(r._type !== "yuno") {
            return;
        }
        let config = gobj_read_attr(gobj, "config_svc");
        let ws = gobj_read_attr(gobj, "workspace");
        if(config) {
            agent_config_toggle_selected_node(config, ws,
                {id: stats_sel_id(r.node, r.yuno_id), host: r.label});
        }
    }

    return [
        {title: "", field: "_sel", width: 44, headerSort: false, hozAlign: "center",
            formatter: sel_formatter, cellClick: sel_click},
        {title: t("name"), field: "name", formatter: name_formatter, widthGrow: 2},
        {title: t("status"), field: "info", formatter: info_formatter, widthGrow: 1}
    ];
}

/***************************************************************
 *  Create the Tabulator tree.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;

    let settings = {
        ...yui_tabulator_lang(t),   /*  Tabulator's OWN chrome, in our language  */
        index:                 "_key",
        layout:                "fitColumns",
        maxHeight:             "100%",
        placeholder:           t("no nodes"),
        columnDefaults:        {headerHozAlign: "left", resizable: false},
        columns:               make_columns(gobj),
        dataTree:              true,
        dataTreeStartExpanded: false,
        dataTreeElementColumn: "name",
        dataTreeChildField:    "_children"
    };

    let table = new Tabulator(`#${priv.table_id}`, settings);
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        if(table._pendingData !== undefined) {
            table.setData(table._pendingData);
            delete table._pendingData;
        }
        update_count(gobj);
    });
    gobj_write_attr(gobj, "tabulator", table);
}

/***************************************************************
 *  Re-run the formatters (selection changed elsewhere).
 ***************************************************************/
function refresh_active(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(table && table._ready) {
        table.getRows().forEach((row) => {
            row.reformat();
            let subs = row.getTreeChildren ? row.getTreeChildren() : [];
            subs.forEach((s) => s.reformat());
        });
    }
}

/***************************************************************
 *  Toggle table/toolbar vs the not-connected notice.
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
 *  Count of nodes (top-level rows).
 ***************************************************************/
function update_count(gobj)
{
    let priv = gobj.priv;
    if(!priv.$count) {
        return;
    }
    priv.$count.textContent = `${priv.nodes.length}`;
}

/***************************************************************
 *  Live search across node host/role/version and yuno labels.
 ***************************************************************/
function apply_filter(gobj)
{
    let priv = gobj.priv;
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    let term = String(priv.$input.value || "").trim().toLowerCase();
    if(term) {
        table.setFilter((data) => {
            if(data._type === "yuno") {
                return String(data.label || "").toLowerCase().includes(term);
            }
            return ["host", "role", "version"].some((k) => {
                return String(data[k] || "").toLowerCase().includes(term);
            });
        });
    } else {
        table.clearFilter();
    }
}




                    /***************************
                     *      Requests
                     ***************************/




/***************************************************************
 *  Ask the control center for the connected nodes.
 ***************************************************************/
function request_agents(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        agent_link_command(link, "list-agents", {});
    }
}

/***************************************************************
 *  Ask ONE node for its yunos (on tree-row expand). Tagged so only
 *  this picker consumes the answer.
 ***************************************************************/
function request_yunos(gobj, node)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!node || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {agent_id: node, cmd2agent: "list-yunos"};
    msg_iev_write_key(kw_send, "console_purpose", "statnodes");
    msg_iev_write_key(kw_send, "console_node", node);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Build a node's yuno child rows from a list-yunos answer (running
 *  yunos only; those are the ones with live counters).
 ***************************************************************/
function set_node_yunos(gobj, node, data)
{
    let priv = gobj.priv;
    let rows = [];
    if(Array.isArray(data)) {
        for(let y of data) {
            if(!y || y.yuno_running === false) {
                continue;
            }
            let id = y.id;
            if(!id) {
                continue;
            }
            let role = y.yuno_role || "";
            let name = y.yuno_name || "";
            let label = (role && name) ? `${role}^${name}` : (role || name || id);
            rows.push({
                _key:     stats_sel_id(node, id),
                _type:    "yuno",
                node:     node,
                yuno_id:  id,
                label:    label,
                running:  y.yuno_running !== false
            });
        }
    }
    priv.yunos[node] = rows;
    schedule_render(gobj);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_selected_nodes_changed(gobj, event, kw, src)
{
    let ws = gobj_read_attr(gobj, "workspace");
    if(kw && kw.workspace && kw.workspace !== ws) {
        return 0;
    }
    refresh_active(gobj);
    return 0;
}

function ac_on_open(gobj, event, kw, src)
{
    request_agents(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  Command answer — our list-agents (nodes) and our tagged
 *  list-yunos (a node's children).
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let purpose = msg_iev_read_key(kw, "console_purpose");
    let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let command = kw_get_str(gobj, stk, "command", "", 0);

    /*  Our per-node yunos (tagged "statnodes").  */
    if(purpose === "statnodes") {
        if(command !== "command-agent") {
            let node = msg_iev_read_key(kw, "console_node") || "";
            if(node) {
                set_node_yunos(gobj, node, kw.data);
            }
        }
        return 0;
    }
    /*  Anything else tagged (Console/Stats card) is not ours.  */
    if(purpose) {
        return 0;
    }
    /*  Untagged list-agents = the node list.  */
    if(command !== "list-agents") {
        return 0;
    }
    let nodes = [];
    if(Array.isArray(kw.data)) {
        let min = gobj_read_attr(gobj, "min_version") || "";
        for(let line of kw.data) {
            let n = parse_agent_line(line);
            if(version_gte(n.version, min)) {
                nodes.push(n);
            }
        }
    }
    nodes.sort((a, b) => version_cmp(b.version, a.version));   /*  highest version first  */
    priv.nodes = nodes;
    /*  Keep already-loaded yunos for nodes that are still present.  */
    let present = {};
    nodes.forEach((n) => { present[node_id(n)] = true; });
    Object.keys(priv.yunos).forEach((k) => {
        if(!present[k]) {
            delete priv.yunos[k];
        }
    });
    schedule_render(gobj);
    render_state(gobj);
    /*  Eagerly fetch each node's yunos so the tree shows expandable
     *  sub-rows (a collapsed node with no children has no toggle). One
     *  list-yunos per node — bounded, on-demand (open / Refresh), not
     *  polled. Each answer fills that node's children (schedule_render).  */
    for(let n of nodes) {
        request_yunos(gobj, node_id(n));
    }
    return 0;
}





/***************************************************************
 *  The language changed (the shell publishes it).
 *
 *  refresh_language() reaches every node that CARRIES its key; a Tabulator
 *  does not: its column headers, its paginator, its placeholder and whatever
 *  its formatters paint come from t() at RENDER time and are drawn ONCE. Hand
 *  the table the new language and rebuild its columns.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    yui_tabulator_relocalize(table, t);
    try {
        table.options.placeholder = t("no nodes");
        table.setColumns(make_columns(gobj));
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: cannot re-render the table: ${e}`);
        return -1;
    }
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
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
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null],
            ["EV_ON_OPEN",              ac_on_open,                null],
            ["EV_ON_CLOSE",             ac_on_close,               null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,      null],
            ["EV_SELECTED_NODES_CHANGED", ac_selected_nodes_changed, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_ON_OPEN",              0],
        ["EV_ON_CLOSE",             0],
        ["EV_MT_COMMAND_ANSWER",    0],
        ["EV_SELECTED_NODES_CHANGED", 0]
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

function register_c_stats_nodes()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_stats_nodes};
