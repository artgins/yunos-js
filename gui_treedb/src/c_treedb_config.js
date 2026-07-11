/***********************************************************************
 *          c_treedb_config.js
 *
 *      C_TREEDB_CONFIG — app-level config service (named "treedb_config").
 *
 *      Unlike the controlcenter model (where the single backend is derived
 *      from the serving host), the TreeDB browser talks to backends on
 *      OTHER hosts that the USER configures at runtime. This service owns,
 *      persisted in browser localStorage:
 *
 *        - connections: the list of backend endpoints the user added
 *            [{id, label, url, remote_yuno_role, remote_yuno_service}, ...]
 *          The access_token forwarded in each C_IEVENT_CLI identity_card is
 *          NOT stored here (it is fetched from the BFF per session — see
 *          c_login.js); only the non-secret connection coordinates are.
 *
 *        - selected_treedbs: which (connection, treedb) pairs are open as
 *          tabs, PER WORKSPACE ("topics" / "graphs"):
 *            {workspace: [{id, conn_id, treedb_name, label}, ...]}
 *          id is the composite conn_id<US>treedb_name (sel_id/sel_parse).
 *
 *        - active_tabs: the last-active tab per workspace, so returning to a
 *          workspace (or a fresh load) restores it.
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


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_CONFIG";

/*  Composite id for a selected (connection, treedb) pair. US = ASCII unit
 *  separator, absent from urls / role names / treedb names.  */
const SEL_SEP = "\x1f";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",       0,                        null, "Subscriber of output events"),
SDATA(data_type_t.DTP_JSON,     "connections",      sdata_flag_t.SDF_PERSIST, "[]", "Configured backends: [{id,label,url,remote_yuno_role,remote_yuno_service,treedbs,services}]"),
SDATA(data_type_t.DTP_JSON,     "selected_treedbs", sdata_flag_t.SDF_PERSIST, "{}", "Open (conn,treedb) tabs per workspace: {workspace: [{id,conn_id,treedb_name,label}]}"),
SDATA(data_type_t.DTP_JSON,     "active_tabs",      sdata_flag_t.SDF_PERSIST, "{}", "Last-active tab per workspace: {workspace: sel_id}"),
SDATA(data_type_t.DTP_STRING,   "display_mode",     sdata_flag_t.SDF_PERSIST, "table", "Record display: table | form (raw JSON)"),
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
 *  Composite id for a selected (connection, treedb) pair, and its
 *  inverse.
 ***************************************************************/
function sel_id(conn_id, treedb_name)
{
    return String(conn_id || "") + SEL_SEP + String(treedb_name || "");
}

function sel_parse(id)
{
    let s = String(id || "");
    let i = s.indexOf(SEL_SEP);
    if(i < 0) {
        return {conn_id: s, treedb_name: ""};
    }
    return {conn_id: s.slice(0, i), treedb_name: s.slice(i + 1)};
}

/***************************************************************
 *  A stable id for a connection, derived from its coordinates so the
 *  same backend+service is never duplicated.
 ***************************************************************/
function connection_id(conn)
{
    return `${conn.url || ""}#${conn.remote_yuno_service || ""}`;
}

/***************************************************************
 *  Sanitize a scanned-services list:
 *  [{yuno_role, yuno_name, service, gclass}] (gclass C_NODE | C_TRANGER).
 ***************************************************************/
function sanitize_services(list)
{
    if(!Array.isArray(list)) {
        return [];
    }
    return list.filter((s) => s && s.service && s.gclass).map((s) => ({
        yuno_role: s.yuno_role || "",
        yuno_name: s.yuno_name || "",
        service:   s.service,
        gclass:    s.gclass
    }));
}

/***************************************************************
 *  A stable per-connection key for a browsable service. Legacy manual
 *  treedbs use the bare service name (so persisted selections survive);
 *  scanned services are qualified by their owning yuno.
 ***************************************************************/
function treedb_config_service_key(svc)
{
    if(!svc.yuno_role) {
        return svc.service;
    }
    return `${svc.yuno_role}^${svc.yuno_name || ""}:${svc.service}`;
}

/***************************************************************
 *  The browsable services of a connection, normalized:
 *  [{key, yuno_role, yuno_name, service, gclass, direct}]
 *    - legacy `treedbs` names → direct C_NODE services of the
 *      connected yuno (addressed with a plain `service` kw);
 *    - scanned `services` → direct only when they live in the yuno
 *      the transport is connected to; else commands must be wrapped
 *      in command-yuno (see c_treedb_proxy.js).
 ***************************************************************/
function treedb_config_conn_services(conn)
{
    let out = [];
    if(!conn) {
        return out;
    }
    for(let name of (Array.isArray(conn.treedbs) ? conn.treedbs : [])) {
        out.push({
            key:       name,
            yuno_role: "",
            yuno_name: "",
            service:   name,
            gclass:    "C_NODE",
            direct:    true
        });
    }
    for(let svc of sanitize_services(conn.services)) {
        let direct = !svc.yuno_role || svc.yuno_role === (conn.remote_yuno_role || "");
        let entry = {
            key:       treedb_config_service_key(svc),
            yuno_role: svc.yuno_role,
            yuno_name: svc.yuno_name,
            service:   svc.service,
            gclass:    svc.gclass,
            direct:    direct
        };
        /*  A scanned direct C_NODE duplicates a manual treedb name.  */
        if(!out.some((e) => e.key === entry.key ||
                (direct && e.direct && e.service === entry.service))) {
            out.push(entry);
        }
    }
    return out;
}

/***************************************************************
 *  Replace ONE connection's scanned services (the Settings scan
 *  checkboxes edit this), persist, notify.
 ***************************************************************/
function treedb_config_set_conn_services(gobj, conn_id, services)
{
    let list = treedb_config_get_connections(gobj);
    let idx = list.findIndex((c) => c && c.id === conn_id);
    if(idx < 0) {
        return;
    }
    list[idx] = Object.assign({}, list[idx], {services: sanitize_services(services)});
    gobj_write_attr(gobj, "connections", list);
    gobj_save_persistent_attrs(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list, conn: list[idx]});
}

/***************************************************************
 *  The configured connections, [] when none. Returns a fresh copy.
 ***************************************************************/
function treedb_config_get_connections(gobj)
{
    let list = gobj_read_attr(gobj, "connections");
    return Array.isArray(list) ? list.slice() : [];
}

/***************************************************************
 *  One connection by id, or null.
 ***************************************************************/
function treedb_config_get_connection(gobj, id)
{
    return treedb_config_get_connections(gobj).find((c) => c && c.id === id) || null;
}

/***************************************************************
 *  Add or replace a connection (keyed by connection_id), persist, notify.
 *  Returns the stored connection (with its resolved id).
 ***************************************************************/
function treedb_config_upsert_connection(gobj, conn)
{
    if(!conn || !conn.url) {
        return null;
    }
    let stored = {
        id:                  conn.id || connection_id(conn),
        label:               conn.label || conn.url,
        url:                 conn.url,
        remote_yuno_role:    conn.remote_yuno_role || "",
        remote_yuno_service: conn.remote_yuno_service || "",
        /*
         *  The treedb names to browse on this backend. Required for backends
         *  whose identity ack's services_roles lists only the connected
         *  service (e.g. db_history_wz), not the treedbs. When empty the
         *  picker falls back to services_roles (works for controlcenter-style
         *  backends that DO list their treedbs there).
         */
        treedbs:             Array.isArray(conn.treedbs) ? conn.treedbs : [],
        /*
         *  The node services (C_NODE/C_TRANGER of any yuno of the node)
         *  selected from a Settings scan (see c_treedb_links scan).
         */
        services:            sanitize_services(conn.services)
    };
    let list = treedb_config_get_connections(gobj);
    let idx = list.findIndex((c) => c && c.id === stored.id);
    if(idx >= 0) {
        list[idx] = stored;
    } else {
        list.push(stored);
    }
    gobj_write_attr(gobj, "connections", list);
    gobj_save_persistent_attrs(gobj, "connections");
    /*  `conn` lets the app (re)open just the affected transport.  */
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list, conn: stored});
    return stored;
}

/***************************************************************
 *  Replace the WHOLE connections list (the Settings Tabulator editor is
 *  the source of truth), persist, notify. Drops selected treedbs that
 *  point at a connection id no longer present.
 ***************************************************************/
function treedb_config_set_connections(gobj, list)
{
    let clean = Array.isArray(list) ? list.filter((c) => c && c.id) : [];
    gobj_write_attr(gobj, "connections", clean);
    gobj_save_persistent_attrs(gobj, "connections");

    /*  Prune open tabs whose connection is gone.  */
    let alive = {};
    for(let c of clean) {
        alive[c.id] = true;
    }
    let map = read_selection_map(gobj);
    let touched = false;
    for(let ws in map) {
        let kept = (map[ws] || []).filter((s) => s && alive[s.conn_id]);
        if(kept.length !== (map[ws] || []).length) {
            map[ws] = kept;
            touched = true;
        }
    }
    if(touched) {
        write_selection_map(gobj, map);
    }

    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: clean});
}

/***************************************************************
 *  Remove a connection and every selected treedb that belonged to it,
 *  persist, notify.
 ***************************************************************/
function treedb_config_remove_connection(gobj, id)
{
    if(!id) {
        return;
    }
    let list = treedb_config_get_connections(gobj).filter((c) => c && c.id !== id);
    gobj_write_attr(gobj, "connections", list);
    gobj_save_persistent_attrs(gobj, "connections");

    /*  Drop that connection's open tabs from every workspace.  */
    let map = read_selection_map(gobj);
    let touched = false;
    for(let ws in map) {
        let kept = (map[ws] || []).filter((s) => s && s.conn_id !== id);
        if(kept.length !== (map[ws] || []).length) {
            map[ws] = kept;
            touched = true;
        }
    }
    if(touched) {
        write_selection_map(gobj, map);
    }

    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list});
}

/***************************************************************
 *  Selected (connection, treedb) tabs, kept PER WORKSPACE.
 ***************************************************************/
function read_selection_map(gobj)
{
    let raw = gobj_read_attr(gobj, "selected_treedbs");
    if(raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}

function write_selection_map(gobj, map)
{
    gobj_write_attr(gobj, "selected_treedbs", map);
    gobj_save_persistent_attrs(gobj, "selected_treedbs");
}

/***************************************************************
 *  The selected treedbs of one workspace, [] when none.
 ***************************************************************/
function treedb_config_get_selected(gobj, workspace)
{
    let list = read_selection_map(gobj)[workspace];
    return Array.isArray(list) ? list : [];
}

/***************************************************************
 *  Is a (conn,treedb) selected in this workspace?
 ***************************************************************/
function treedb_config_is_selected(gobj, workspace, id)
{
    if(!id) {
        return false;
    }
    return treedb_config_get_selected(gobj, workspace).some((s) => s && s.id === id);
}

/***************************************************************
 *  Replace one workspace's selection, persist, notify.
 ***************************************************************/
function treedb_config_set_selected(gobj, workspace, list)
{
    let map = read_selection_map(gobj);
    map[workspace] = Array.isArray(list) ? list : [];
    write_selection_map(gobj, map);
    gobj_publish_event(gobj, "EV_SELECTED_TREEDBS_CHANGED",
        {workspace: workspace, selected: map[workspace]});
}

/***************************************************************
 *  Add or remove a service from a workspace's selection (toggle),
 *  preserving order for the remaining tabs. `sel` carries the
 *  normalized service entry (treedb_config_conn_services):
 *  {conn_id, svc: {key, service, gclass, yuno_role, yuno_name}, label}.
 *  Legacy persisted entries only have treedb_name — normalize on read.
 ***************************************************************/
function treedb_config_toggle_selected(gobj, workspace, sel)
{
    if(!sel || !sel.conn_id || !sel.svc || !sel.svc.key) {
        return;
    }
    let id = sel_id(sel.conn_id, sel.svc.key);
    let list = treedb_config_get_selected(gobj, workspace).slice();
    let idx = list.findIndex((s) => s && s.id === id);
    if(idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push({
            id:          id,
            conn_id:     sel.conn_id,
            svc_key:     sel.svc.key,
            service:     sel.svc.service,
            gclass:      sel.svc.gclass,
            yuno_role:   sel.svc.yuno_role || "",
            yuno_name:   sel.svc.yuno_name || "",
            /*  legacy field name, still read by older selections  */
            treedb_name: sel.svc.service,
            label:       sel.label || sel.svc.service
        });
    }
    treedb_config_set_selected(gobj, workspace, list);
}

/***************************************************************
 *  Normalize a persisted selection entry: pre-scan entries carry only
 *  {conn_id, treedb_name} (a direct C_NODE treedb of the connected yuno).
 ***************************************************************/
function treedb_config_normalize_sel(s)
{
    if(!s) {
        return null;
    }
    if(s.svc_key) {
        return s;
    }
    return Object.assign({}, s, {
        svc_key:   s.treedb_name || "",
        service:   s.treedb_name || "",
        gclass:    "C_NODE",
        yuno_role: "",
        yuno_name: ""
    });
}

/***************************************************************
 *  Remove one selected id from a workspace (tab close).
 ***************************************************************/
function treedb_config_remove_selected(gobj, workspace, id)
{
    if(!id) {
        return;
    }
    let list = treedb_config_get_selected(gobj, workspace).filter((s) => s && s.id !== id);
    treedb_config_set_selected(gobj, workspace, list);
}

/***************************************************************
 *  Last-active tab of a workspace ("" when none). Persisted so returning
 *  to the workspace — or a fresh load — restores that tab.
 ***************************************************************/
function treedb_config_get_active_tab(gobj, workspace)
{
    let map = gobj_read_attr(gobj, "active_tabs");
    if(map && typeof map === "object" && !Array.isArray(map)) {
        let id = map[workspace];
        return (typeof id === "string") ? id : "";
    }
    return "";
}

/***************************************************************
 *  Record a workspace's active tab and persist it. No-op when unchanged.
 ***************************************************************/
function treedb_config_set_active_tab(gobj, workspace, id)
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
 *  Record display mode: "table" (default) or "form" (raw JSON).
 ***************************************************************/
function treedb_config_get_display_mode(gobj)
{
    return gobj_read_attr(gobj, "display_mode") || "table";
}

function treedb_config_set_display_mode(gobj, mode)
{
    gobj_write_attr(gobj, "display_mode", mode || "table");
    gobj_save_persistent_attrs(gobj, "display_mode");
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
     *---------------------------------------------*/
    const event_types = [
        ["EV_CONNECTIONS_CHANGED",     event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS],
        ["EV_SELECTED_TREEDBS_CHANGED", event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS]
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
function register_c_treedb_config()
{
    return create_gclass(GCLASS_NAME);
}

export {
    register_c_treedb_config,
    sel_id,
    sel_parse,
    connection_id,
    treedb_config_conn_services,
    treedb_config_set_conn_services,
    treedb_config_service_key,
    treedb_config_normalize_sel,
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_upsert_connection,
    treedb_config_set_connections,
    treedb_config_remove_connection,
    treedb_config_get_selected,
    treedb_config_is_selected,
    treedb_config_set_selected,
    treedb_config_toggle_selected,
    treedb_config_remove_selected,
    treedb_config_get_active_tab,
    treedb_config_set_active_tab,
    treedb_config_get_display_mode,
    treedb_config_set_display_mode,
};
