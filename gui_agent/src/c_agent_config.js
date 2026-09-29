/***********************************************************************
 *          c_agent_config.js
 *
 *      C_AGENT_CONFIG — app-level config service (named "agent_config").
 *
 *      In the controlcenter model the SPA does NOT store agent URLs: the
 *      single backend is the control center co-located on this host
 *      (derived in conf/deploy.js), and the operable nodes come live from
 *      `list-agents`. The only persisted choice is which node is active
 *      (its hostname or UUID, as returned by the control center).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, sdata_flag_t, event_flag_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_save_persistent_attrs,
    gobj_subscribe_event,
    gobj_publish_event,
} from "@yuneta/gobj-js";

import {selection_scenario} from "./monitor_helpers.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_CONFIG";

/*  Console command shortkeys, seeded like ycli's default set. The first
 *  token typed in the console is looked up here; a match expands to the
 *  template, with $1 $2 … replaced by the following positional args.  */
const DEFAULT_SHORTKEYS = {
    "s":     "stats-yuno yuno_role=logcenter",
    "ss":    "command-yuno yuno_role=logcenter command=display-summary",
    "r":     "command-yuno yuno_role=logcenter command=reset-counters",
    "tt":    "t yuno_running=1",
    "error": "command-yuno yuno_role=logcenter command=search text=\"$1\"",
};


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,                        null, "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "active_node",  sdata_flag_t.SDF_PERSIST, "",      "Active node (hostname/UUID from list-agents)"),
SDATA(data_type_t.DTP_STRING,   "display_mode", sdata_flag_t.SDF_PERSIST, "table", "Command answer display: table | form (JSON tree) | raw (text)"),
SDATA(data_type_t.DTP_STRING,   "nav_mode",     sdata_flag_t.SDF_PERSIST, "stack", "How a node tree shows the way in: stack | back | path"),
SDATA(data_type_t.DTP_JSON,     "selected_nodes", sdata_flag_t.SDF_PERSIST, "{}",  "Selected nodes per workspace: {workspace: [{id, host}, ...]}"),
SDATA(data_type_t.DTP_JSON,     "active_tabs",  sdata_flag_t.SDF_PERSIST, "{}",    "Last-active node tab per workspace: {workspace: node_id}"),
SDATA(data_type_t.DTP_JSON,     "cmd_history",  sdata_flag_t.SDF_PERSIST, "[]",    "Global console command history: [cmd,...] most-recent first (shared by all nodes)"),
SDATA(data_type_t.DTP_DICT,     "monitor_scenario", sdata_flag_t.SDF_PERSIST, "{}", "Scenarios: the scenario watched (see monitor_helpers.js), {} = none yet"),
SDATA(data_type_t.DTP_STRING,   "monitor_source", sdata_flag_t.SDF_PERSIST, "local", "Scenarios: where the scenario watched comes from: local (this browser) | saved (the control center's) | selection (the yunos ticked in the tree)"),
SDATA(data_type_t.DTP_INTEGER,  "monitor_refresh", sdata_flag_t.SDF_PERSIST, 2,    "Monitor: seconds between two readings of the yunos"),
SDATA(data_type_t.DTP_INTEGER,  "monitor_window", sdata_flag_t.SDF_PERSIST, 15,    "Monitor: minutes of history kept in the charts"),
SDATA(data_type_t.DTP_JSON,     "shortkeys",    sdata_flag_t.SDF_PERSIST, JSON.stringify(DEFAULT_SHORTKEYS), "Console command shortkeys {key: template}; $1 $2 … are positional args (ycli parity)"),
SDATA_END()
];

/*  Global history cap (defensive; the console caps its own working copy). */
const HISTORY_MAX = 50;

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
     *  SERVICE subscription model
     */
    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
}




                    /***************************
                     *      Public functions
                     ***************************/




/***************************************************************
 *  Active node (hostname/UUID), or "".
 ***************************************************************/
function agent_config_get_active_node(gobj)
{
    return gobj_read_attr(gobj, "active_node") || "";
}

/***************************************************************
 *  Set the active node, persist it, notify subscribers.
 ***************************************************************/
function agent_config_set_active_node(gobj, node)
{
    gobj_write_attr(gobj, "active_node", node || "");
    gobj_save_persistent_attrs(gobj, "active_node");
    gobj_publish_event(gobj, "EV_ACTIVE_NODE_CHANGED", {active_node: node || ""});
}

/***************************************************************
 *  Command-answer display mode, mirroring ycommand's display_mode
 *  attribute:
 *
 *      "table"  a Tabulator table when the answer carries a schema,
 *               the JSON tree otherwise  (default)
 *      "form"   always the JSON tree, schema or not
 *      "raw"    the literal text, as it arrived
 *
 *  "form" used to mean the literal text; that is "raw" now, and the
 *  tree took its place, because reading JSON is the common case and
 *  reading the bytes is the exception.
 ***************************************************************/
function agent_config_get_display_mode(gobj)
{
    return gobj_read_attr(gobj, "display_mode") || "table";
}

/***************************************************************
 *  Set the display mode and persist it.
 ***************************************************************/
function agent_config_set_display_mode(gobj, mode)
{
    gobj_write_attr(gobj, "display_mode", mode || "table");
    gobj_save_persistent_attrs(gobj, "display_mode");
}

/***************************************************************
 *  Scenarios settings: the scenario watched (a validated object, or
 *  null) and where it comes from, the seconds between two readings
 *  and the minutes of history kept. A node that cannot push the
 *  readings is polled: the DELIBERATE exception to the no-polling rule
 *  approved for this view (2026-09-29).
 ***************************************************************/
const MONITOR_SOURCES = ["local", "saved", "selection"];

const MONITOR_REFRESH_CHOICES = [1, 2, 5, 10, 30];
const MONITOR_WINDOW_CHOICES = [5, 15, 30, 60];

function agent_config_get_monitor(gobj)
{
    let scenario = gobj_read_attr(gobj, "monitor_scenario");
    let refresh = parseInt(gobj_read_attr(gobj, "monitor_refresh"), 10);
    let window_min = parseInt(gobj_read_attr(gobj, "monitor_window"), 10);
    let source = gobj_read_attr(gobj, "monitor_source");
    return {
        scenario: (scenario && Array.isArray(scenario.yunos)) ? scenario : null,
        source:   MONITOR_SOURCES.indexOf(source) >= 0 ? source : "local",
        refresh:  MONITOR_REFRESH_CHOICES.indexOf(refresh) >= 0 ? refresh : 2,
        window:   MONITOR_WINDOW_CHOICES.indexOf(window_min) >= 0 ? window_min : 15
    };
}

/***************************************************************
 *  Write the given settings ({scenario?, source?, refresh?, window?})
 *  and persist exactly those. A new scenario is published
 *  (EV_MONITOR_SCENARIO_CHANGED): the list and the tree set it, the
 *  live view shows it.
 ***************************************************************/
function agent_config_set_monitor(gobj, patch)
{
    let names = [];
    if(patch && patch.scenario !== undefined) {
        gobj_write_attr(gobj, "monitor_scenario", patch.scenario || {});
        names.push("monitor_scenario");
    }
    if(patch && patch.source !== undefined) {
        gobj_write_attr(gobj, "monitor_source",
            MONITOR_SOURCES.indexOf(patch.source) >= 0 ? patch.source : "local");
        names.push("monitor_source");
    }
    if(patch && patch.refresh !== undefined) {
        gobj_write_attr(gobj, "monitor_refresh", parseInt(patch.refresh, 10));
        names.push("monitor_refresh");
    }
    if(patch && patch.window !== undefined) {
        gobj_write_attr(gobj, "monitor_window", parseInt(patch.window, 10));
        names.push("monitor_window");
    }
    if(names.length) {
        gobj_save_persistent_attrs(gobj, names);
    }
    if(patch && (patch.scenario !== undefined || patch.source !== undefined)) {
        gobj_publish_event(gobj, "EV_MONITOR_SCENARIO_CHANGED", {
            source: gobj_read_attr(gobj, "monitor_source")
        });
    }
}

/***************************************************************
 *  Navigation mode of the app's node trees (C_YUI_NODE): how the way
 *  in is shown — one strip per level ("stack", the default), a single
 *  "← parent" ("back"), or the whole trail as one breadcrumb ("path").
 *
 *  ONE choice for the app and not one per tree: the only tree today is
 *  the Schemas drill-down (yuno → treedb → topic), and it exists once
 *  per open tab. Keying the choice by tree route would ask the operator
 *  the same question again for every yuno they open.
 ***************************************************************/
const NAV_MODES = ["stack", "back", "path"];

function agent_config_get_nav_mode(gobj)
{
    let v = gobj_read_attr(gobj, "nav_mode");
    if(NAV_MODES.indexOf(v) < 0) {
        return "stack";
    }
    return v;
}

/***************************************************************
 *  Set the navigation mode, persist it, notify (the open Schemas
 *  tabs re-shape their live tree).
 ***************************************************************/
function agent_config_set_nav_mode(gobj, mode)
{
    if(NAV_MODES.indexOf(mode) < 0) {
        log_error(`${GCLASS_NAME}: unknown nav_mode '${mode}'`);
        return;
    }
    gobj_write_attr(gobj, "nav_mode", mode);
    gobj_save_persistent_attrs(gobj, "nav_mode");
    gobj_publish_event(gobj, "EV_NAV_MODE_CHANGED", {nav_mode: mode});
}

/***************************************************************
 *  Selected nodes are kept PER WORKSPACE ("commands" / "statistics"
 *  / "terminal"): each workspace has its own fixed node-picker tab
 *  and opens one dynamic tab per selected node. The persistent
 *  attr is a map {workspace: [{id, host}, ...]}. id is the agent_id
 *  used to route command-agent / write-tty; host is the display
 *  label.
 *
 *  Legacy note: earlier releases stored a single flat list (the
 *  Console was the only multi-node workspace). A persisted array is
 *  migrated on read under the "commands" workspace so an operator's
 *  open tabs survive the upgrade.
 ***************************************************************/
function read_selection_map(gobj)
{
    let raw = gobj_read_attr(gobj, "selected_nodes");
    if(Array.isArray(raw)) {
        return {commands: raw};
    }
    if(raw && typeof raw === "object") {
        return raw;
    }
    return {};
}

function write_selection_map(gobj, map)
{
    gobj_write_attr(gobj, "selected_nodes", map);
    gobj_save_persistent_attrs(gobj, "selected_nodes");
}

/***************************************************************
 *  The selected nodes of one workspace, [] when none.
 ***************************************************************/
function agent_config_get_selected_nodes(gobj, workspace)
{
    let list = read_selection_map(gobj)[workspace];
    return Array.isArray(list) ? list : [];
}

/***************************************************************
 *  Replace one workspace's selected-nodes list, persist, notify.
 ***************************************************************/
function agent_config_set_selected_nodes(gobj, workspace, list)
{
    let map = read_selection_map(gobj);
    map[workspace] = Array.isArray(list) ? list : [];
    write_selection_map(gobj, map);
    gobj_publish_event(gobj, "EV_SELECTED_NODES_CHANGED",
        {workspace: workspace, selected_nodes: map[workspace]});

    /*  The yunos ticked in the Scenarios tree ARE the scenario watched.
     *  Here, and not in the live view: that view is created the first time
     *  it is visited, and the ticks come before.  */
    if(workspace === SCENARIOS_TREE) {
        let items = map[workspace].map((it) => {
            let p = stats_sel_parse(it.id);
            return {node: p.node, yuno_id: p.yuno_id, label: it.host || p.yuno_id};
        });
        agent_config_set_monitor(gobj, {scenario: selection_scenario(items) || {}, source: "selection"});
    }
}

/*  The selection bucket of the Scenarios workspace's tree.  */
const SCENARIOS_TREE = "scenarios";

/***************************************************************
 *  The Statistics workspace selects YUNOS, not nodes. A yuno is
 *  identified by (node, yuno_id), stored through the SAME per-workspace
 *  selection machinery as a composite id "node<US>yuno_id" (US = the
 *  ASCII unit separator, absent from hostnames / uuids / yuno ids), so a
 *  selected yuno gets a tab and survives a reload like any other.
 ***************************************************************/
const STATS_SEP = "\x1f";

function stats_sel_id(node, yuno_id)
{
    return String(node || "") + STATS_SEP + String(yuno_id || "");
}

function stats_sel_parse(id)
{
    let s = String(id || "");
    let i = s.indexOf(STATS_SEP);
    if(i < 0) {
        return {node: s, yuno_id: ""};
    }
    return {node: s.slice(0, i), yuno_id: s.slice(i + 1)};
}

/***************************************************************
 *  Is a node id selected in this workspace?
 ***************************************************************/
function agent_config_is_node_selected(gobj, workspace, id)
{
    if(!id) {
        return false;
    }
    return agent_config_get_selected_nodes(gobj, workspace).some((n) => n && n.id === id);
}

/***************************************************************
 *  Add or remove a node {id, host} from a workspace's selection
 *  (toggle), preserving order for the remaining tabs.
 ***************************************************************/
function agent_config_toggle_selected_node(gobj, workspace, node)
{
    if(!node || !node.id) {
        return;
    }
    let list = agent_config_get_selected_nodes(gobj, workspace).slice();
    let idx = list.findIndex((n) => n && n.id === node.id);
    if(idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push({id: node.id, host: node.host || node.id});
    }
    agent_config_set_selected_nodes(gobj, workspace, list);
}

/***************************************************************
 *  Remove one node id from a workspace's selection (tab close).
 ***************************************************************/
function agent_config_remove_selected_node(gobj, workspace, id)
{
    if(!id) {
        return;
    }
    let list = agent_config_get_selected_nodes(gobj, workspace).filter((n) => n && n.id !== id);
    agent_config_set_selected_nodes(gobj, workspace, list);
}

/***************************************************************
 *  Last-active node tab of a workspace (the tab the operator was on),
 *  "" when none. Persisted so returning to the workspace — or a fresh
 *  load / login — restores that tab instead of always the first.
 ***************************************************************/
function agent_config_get_active_tab(gobj, workspace)
{
    let map = gobj_read_attr(gobj, "active_tabs");
    if(map && typeof map === "object" && !Array.isArray(map)) {
        let id = map[workspace];
        return (typeof id === "string") ? id : "";
    }
    return "";
}

/***************************************************************
 *  Record a workspace's active node tab and persist it. No-op (no
 *  write) when it is unchanged, so navigating between tabs doesn't
 *  churn localStorage.
 ***************************************************************/
function agent_config_set_active_tab(gobj, workspace, id)
{
    if(!workspace) {
        return;
    }
    let cur = gobj_read_attr(gobj, "active_tabs");
    let map = (cur && typeof cur === "object" && !Array.isArray(cur)) ? Object.assign({}, cur) : {};
    if(map[workspace] === (id || "")) {
        return;
    }
    map[workspace] = id || "";
    gobj_write_attr(gobj, "active_tabs", map);
    gobj_save_persistent_attrs(gobj, "active_tabs");
}

/***************************************************************
 *  Persisted console command history, global to all nodes: deduped
 *  entries {cmd, count, last}, most-recently-used first (the console
 *  normalizes the legacy plain-string format on load). Returns a
 *  fresh copy so the caller can mutate it freely.
 ***************************************************************/
function agent_config_get_history(gobj)
{
    let list = gobj_read_attr(gobj, "cmd_history");
    return Array.isArray(list) ? list.slice() : [];
}

/***************************************************************
 *  Replace the global command history and persist it. The console
 *  owns dedup/cap on its working copy; we bound it defensively.
 ***************************************************************/
function agent_config_set_history(gobj, list)
{
    let bounded = (Array.isArray(list) ? list : []).slice(0, HISTORY_MAX);
    gobj_write_attr(gobj, "cmd_history", bounded);
    gobj_save_persistent_attrs(gobj, "cmd_history");
}

/***************************************************************
 *  Console command shortkeys {key: template}, global to all nodes
 *  (ycli parity). Returns the live dict, or {} if unset.
 ***************************************************************/
function agent_config_get_shortkeys(gobj)
{
    let dict = gobj_read_attr(gobj, "shortkeys");
    return (dict && typeof dict === "object" && !Array.isArray(dict)) ? dict : {};
}

/***************************************************************
 *  Add or replace a shortkey (ycli's add-shortkey), then persist.
 ***************************************************************/
function agent_config_set_shortkey(gobj, key, command)
{
    if(!key || !command) {
        return;
    }
    let dict = Object.assign({}, agent_config_get_shortkeys(gobj));
    dict[key] = command;
    gobj_write_attr(gobj, "shortkeys", dict);
    gobj_save_persistent_attrs(gobj, "shortkeys");
}

/***************************************************************
 *  Remove a shortkey (ycli's remove-shortkey), then persist.
 *  Returns true if the key existed and was removed.
 ***************************************************************/
function agent_config_remove_shortkey(gobj, key)
{
    let dict = Object.assign({}, agent_config_get_shortkeys(gobj));
    if(!Object.prototype.hasOwnProperty.call(dict, key)) {
        return false;
    }
    delete dict[key];
    gobj_write_attr(gobj, "shortkeys", dict);
    gobj_save_persistent_attrs(gobj, "shortkeys");
    return true;
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
        ["ST_IDLE", []]
    ];

    /*---------------------------------------------*
     *          Events
     ***************************************************************/
    const event_types = [
        ["EV_ACTIVE_NODE_CHANGED",    event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS],
        ["EV_SELECTED_NODES_CHANGED", event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS],
        ["EV_MONITOR_SCENARIO_CHANGED", event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS],
        ["EV_NAV_MODE_CHANGED",       event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS]
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
function register_c_agent_config()
{
    return create_gclass(GCLASS_NAME);
}

export {
    register_c_agent_config,
    agent_config_get_active_node,
    agent_config_set_active_node,
    agent_config_get_display_mode,
    agent_config_set_display_mode,
    agent_config_get_nav_mode,
    agent_config_set_nav_mode,
    agent_config_get_monitor,
    agent_config_set_monitor,
    MONITOR_REFRESH_CHOICES,
    MONITOR_WINDOW_CHOICES,
    NAV_MODES,
    agent_config_get_selected_nodes,
    agent_config_set_selected_nodes,
    agent_config_is_node_selected,
    agent_config_toggle_selected_node,
    agent_config_remove_selected_node,
    agent_config_get_active_tab,
    agent_config_set_active_tab,
    stats_sel_id,
    stats_sel_parse,
    agent_config_get_history,
    agent_config_set_history,
    agent_config_get_shortkeys,
    agent_config_set_shortkey,
    agent_config_remove_shortkey,
};
