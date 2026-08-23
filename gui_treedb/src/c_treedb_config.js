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
 *            [{id, label, url, remote_yuno_role, remote_yuno_service,
 *              enabled, services}, ...]
 *          url/role/service are the C_IEVENT_CLI entry coordinates of ONE
 *          yuno (its public wss endpoint). `enabled` is the user's connect
 *          INTENT: transports open only for enabled connections (the
 *          connect/disconnect button in Settings toggles it — editing a
 *          row never auto-connects). `services` is the FULL list of
 *          C_NODE / C_TRANGER services discovered in that yuno on the first
 *          connect (refreshed on demand from Settings), each flagged
 *          `selected` when the user picked it for browsing — only selected
 *          services are offered in the workspace pickers.
 *          The access_token forwarded in each C_IEVENT_CLI identity_card is
 *          NOT stored here (it is fetched from the BFF per session — see
 *          c_login.js); only the non-secret connection coordinates are.
 *
 *        - selected_treedbs: which (connection, treedb) pairs are open as
 *          tabs, PER WORKSPACE ("topics" / "graphs"):
 *            {workspace: [{id, conn_id, treedb_name, label}, ...]}
 *          id is the composite conn_id<US>treedb_name (sel_id).
 *
 *        - active_tabs: the last-active tab per workspace, so returning to a
 *          workspace (or a fresh load) restores it.
 *
 *        - expanded_conns: which connections show their services sub-table
 *          unfolded in Settings ({conn_id: true}; absent = folded, the
 *          default). Pure view state, kept out of `connections` on purpose:
 *          every change of that list makes the app root reconcile transports.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, sdata_flag_t, event_flag_t,
    gclass_create, log_error, gobj_short_name,
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
SDATA(data_type_t.DTP_JSON,     "connections",      sdata_flag_t.SDF_PERSIST, "[]", "Configured backends: [{id,label,url,remote_yuno_role,remote_yuno_service,enabled,services}]"),
SDATA(data_type_t.DTP_JSON,     "selected_treedbs", sdata_flag_t.SDF_PERSIST, "{}", "Open (conn,treedb) tabs per workspace: {workspace: [{id,conn_id,treedb_name,label}]}"),
SDATA(data_type_t.DTP_JSON,     "active_tabs",      sdata_flag_t.SDF_PERSIST, "{}", "Last-active tab per workspace: {workspace: sel_id}"),
SDATA(data_type_t.DTP_JSON,     "tranger_views",    sdata_flag_t.SDF_PERSIST, "{}", "Open Tranger key-views per connection: {conn_id: [{treedb_name,topic,key,mode,match_cond}]}"),
SDATA(data_type_t.DTP_JSON,     "expanded_conns",   sdata_flag_t.SDF_PERSIST, "{}", "Connections whose services sub-table is unfolded in Settings: {conn_id: true}"),
SDATA(data_type_t.DTP_INTEGER,  "live_max",         sdata_flag_t.SDF_PERSIST, 1000, "Rows kept in a Live card's rolling buffer (oldest dropped at the cap)"),
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
 *  Composite id for a selected (connection, treedb) pair.
 ***************************************************************/
function sel_id(conn_id, treedb_name)
{
    return String(conn_id || "") + SEL_SEP + String(treedb_name || "");
}

/***************************************************************
 *  Sanitize a discovered-services list:
 *  [{service, gclass, selected}] (gclass C_NODE | C_TRANGER).
 ***************************************************************/
function sanitize_services(list)
{
    if(!Array.isArray(list)) {
        return [];
    }
    return list.filter((s) => s && s.service && s.gclass).map((s) => ({
        service:  s.service,
        gclass:   s.gclass,
        selected: !!s.selected
    }));
}

/***************************************************************
 *  A stable per-connection key for a browsable service: the service
 *  name (every discovered service lives in the connected yuno).
 ***************************************************************/
function treedb_config_service_key(svc)
{
    return svc.service;
}

/***************************************************************
 *  The discovered services of a connection, normalized:
 *  [{key, service, gclass, selected}]. All of them live in the yuno
 *  the transport is connected to (addressed with a plain `service`
 *  kw); only `selected` ones are offered in the workspace pickers.
 ***************************************************************/
function treedb_config_conn_services(conn)
{
    if(!conn) {
        return [];
    }
    return sanitize_services(conn.services).map((svc) => ({
        key:      treedb_config_service_key(svc),
        service:  svc.service,
        gclass:   svc.gclass,
        selected: svc.selected
    }));
}

/***************************************************************
 *  Persist an attr and SAY SO when the store refused it.
 *
 *  Every one of these writes goes to localStorage, and localStorage can
 *  say no: quota exceeded, Safari private mode, storage disabled. The
 *  return value was ignored at all eight call sites, so a rejected write
 *  was invisible — the in-memory attr and the UI showed the change as
 *  saved while nothing had reached the disk, and the next reload lost it.
 *  Nothing here can RECOVER from that, but the log must carry it.
 ***************************************************************/
function persist(gobj, attr)
{
    if(gobj_save_persistent_attrs(gobj, attr) < 0) {
        log_error(`${gobj_short_name(gobj)}: cannot persist '${attr}' ` +
                  `(browser storage full or blocked) — the change is only in memory`);
    }
}

/***************************************************************
 *  Replace ONE connection's services (the Settings checkboxes edit
 *  the `selected` flags through this), persist, notify.
 ***************************************************************/
function do_set_conn_services(gobj, conn_id, services)
{
    let list = treedb_config_get_connections(gobj);
    let idx = list.findIndex((c) => c && c.id === conn_id);
    if(idx < 0) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to mutate`);
        return;
    }
    list[idx] = Object.assign({}, list[idx], {services: sanitize_services(services)});
    gobj_write_attr(gobj, "connections", list);
    persist(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list, conn: list[idx]});
}

/***************************************************************
 *  Tick or untick the browse flag of EVERY service of MANY
 *  connections, in ONE write.
 *
 *  A pasted deploy centre is two hundred backends and a thousand
 *  treedbs: one EV_SET_CONN_SERVICES per connection would persist the
 *  config two hundred times and publish the change two hundred times,
 *  and every subscriber rebuilds its pickers on each one.
 *
 *  A connection with nothing discovered is left alone: there is
 *  nothing of it to browse, and writing it back would only churn.
 ***************************************************************/
function do_set_conns_browse(gobj, conn_ids, selected)
{
    let want = new Set(Array.isArray(conn_ids) ? conn_ids : []);
    let list = treedb_config_get_connections(gobj);
    let touched = 0;

    for(let i = 0; i < list.length; i++) {
        if(!list[i] || !want.has(list[i].id)) {
            continue;
        }
        let services = sanitize_services(list[i].services);
        if(!services.length) {
            continue;
        }
        list[i] = Object.assign({}, list[i], {
            services: services.map((svc) => Object.assign({}, svc, {selected: selected}))
        });
        touched++;
    }

    if(!touched) {
        return;
    }
    gobj_write_attr(gobj, "connections", list);
    persist(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list});
}

/***************************************************************
 *  Store a service-discovery result (first connect, or a Settings
 *  refresh): the WHOLE found list replaces the connection's services,
 *  keeping the `selected` flag of every service that survived the
 *  refresh. Persist + notify.
 ***************************************************************/
function do_store_scanned_services(gobj, conn_id, found)
{
    let list = treedb_config_get_connections(gobj);
    let idx = list.findIndex((c) => c && c.id === conn_id);
    if(idx < 0) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to mutate`);
        return;
    }
    let prev_selected = {};
    for(let svc of sanitize_services(list[idx].services)) {
        if(svc.selected) {
            prev_selected[svc.service] = true;
        }
    }
    let services = sanitize_services(found).map((svc) => ({
        service:  svc.service,
        gclass:   svc.gclass,
        selected: !!prev_selected[svc.service]
    }));
    list[idx] = Object.assign({}, list[idx], {services: services});
    gobj_write_attr(gobj, "connections", list);
    persist(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list, conn: list[idx]});
}

/***************************************************************
 *  Set a connection's connect INTENT (the Settings connect/disconnect
 *  button), persist, notify. The app root reacts by opening/closing
 *  its transport (treedb_links_sync).
 ***************************************************************/
function do_set_conn_enabled(gobj, conn_id, enabled)
{
    let list = treedb_config_get_connections(gobj);
    let idx = list.findIndex((c) => c && c.id === conn_id);
    if(idx < 0) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to mutate`);
        return;
    }
    list[idx] = Object.assign({}, list[idx], {enabled: !!enabled});
    gobj_write_attr(gobj, "connections", list);
    persist(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list, conn: list[idx]});
}

/***************************************************************
 *  Set the connect INTENT of MANY connections in ONE write.
 *
 *  Each entry carries its own value ({id, enabled}) because this is how
 *  a set is edited, not how a switch is thrown: the dialog that sends
 *  it shows the intent of every connection and applies what the
 *  operator left ticked — some on, some off, in the same gesture. A
 *  connection the list does not name is not touched.
 *
 *  One write and ONE publication: the app root reconciles transports on
 *  the change, and publishing per connection would have it reconcile
 *  the whole set once per connection.
 ***************************************************************/
function do_set_conns_enabled(gobj, wanted)
{
    let want = new Map();
    for(let w of (Array.isArray(wanted) ? wanted : [])) {
        if(w && w.id) {
            want.set(w.id, !!w.enabled);
        }
    }

    let list = treedb_config_get_connections(gobj);
    let touched = 0;
    for(let i = 0; i < list.length; i++) {
        if(!list[i] || !want.has(list[i].id)) {
            continue;
        }
        let enabled = want.get(list[i].id);
        if(!!list[i].enabled === enabled) {
            continue;       /*  already there: nothing to write  */
        }
        list[i] = Object.assign({}, list[i], {enabled: enabled});
        touched++;
    }

    if(!touched) {
        return;
    }
    gobj_write_attr(gobj, "connections", list);
    persist(gobj, "connections");
    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: list});
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
 *  Replace the WHOLE connections list (the Settings Tabulator editor is
 *  the source of truth), persist, notify. Drops selected treedbs that
 *  point at a connection id no longer present.
 ***************************************************************/
function do_set_connections(gobj, list)
{
    let clean = Array.isArray(list) ? list.filter((c) => c && c.id) : [];
    gobj_write_attr(gobj, "connections", clean);
    persist(gobj, "connections");

    let alive = {};
    for(let c of clean) {
        alive[c.id] = true;
    }

    /*  Prune open tabs whose connection is gone.  */
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

    /*  And the saved Tranger key-views of a connection that is gone: its wss
     *  endpoint no longer exists, so its open/closed state goes with it.
     *  (This ran only in a remove_connection() that nothing ever called, so
     *  deleting a connection in Settings leaked its views in localStorage.)  */
    let tv = read_tranger_views(gobj);
    let dropped = false;
    for(let conn_id in tv) {
        if(!alive[conn_id]) {
            delete tv[conn_id];
            dropped = true;
        }
    }
    if(dropped) {
        write_tranger_views(gobj, tv);
    }

    /*  Same for the fold state of a connection that is gone: an id is never
     *  reused, so its entry would sit in localStorage forever.  */
    let expanded = read_expanded_conns(gobj);
    let folded = false;
    for(let conn_id in expanded) {
        if(!alive[conn_id]) {
            delete expanded[conn_id];
            folded = true;
        }
    }
    if(folded) {
        gobj_write_attr(gobj, "expanded_conns", expanded);
        persist(gobj, "expanded_conns");
    }

    gobj_publish_event(gobj, "EV_CONNECTIONS_CHANGED", {connections: clean});
}

/***************************************************************
 *  Which connections show their services sub-table unfolded in
 *  Settings. Persisted so the page comes back the way it was left, and
 *  dropped with the connection like the Tranger views below.
 *
 *  It lives in its OWN attr, not as a field of the connection, and it
 *  publishes NOTHING: `connections` is the wiring (url, intent,
 *  discovered services) and every change of it makes the app root
 *  reconcile transports and the pickers refresh — a fold/unfold is a
 *  view state that must not wake any of that. Shape: {conn_id: true};
 *  only unfolded ones are stored, so the default is folded.
 ***************************************************************/
function read_expanded_conns(gobj)
{
    let raw = gobj_read_attr(gobj, "expanded_conns");
    if(raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}

/***************************************************************
 *  Is this connection's sub-table unfolded? (false when never touched)
 ***************************************************************/
function treedb_config_is_conn_expanded(gobj, conn_id)
{
    if(!conn_id) {
        return false;
    }
    return !!read_expanded_conns(gobj)[conn_id];
}

/***************************************************************
 *  Fold / unfold one connection's sub-table, persist. No event: the
 *  caller repaints the row it just toggled.
 ***************************************************************/
function do_set_conn_expanded(gobj, conn_id, expanded)
{
    if(!conn_id) {
        log_error(`${gobj_short_name(gobj)}: EV_SET_CONN_EXPANDED without conn_id`);
        return;
    }
    let map = read_expanded_conns(gobj);
    if(expanded) {
        map[conn_id] = true;
    } else {
        delete map[conn_id];
    }
    gobj_write_attr(gobj, "expanded_conns", map);
    persist(gobj, "expanded_conns");
}

/***************************************************************
 *  Open Tranger key-views, persisted PER CONNECTION so they survive
 *  reloads and are restored when the user returns to a topic; the whole
 *  set for a connection is dropped when that connection is removed.
 *  Shape: {conn_id: [{treedb_name, topic, key, mode, match_cond}]}.
 ***************************************************************/
function read_tranger_views(gobj)
{
    let raw = gobj_read_attr(gobj, "tranger_views");
    if(raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}

function write_tranger_views(gobj, map)
{
    gobj_write_attr(gobj, "tranger_views", map);
    persist(gobj, "tranger_views");
}

/***************************************************************
 *  The saved views for one (conn_id, treedb_name, topic) scope.
 ***************************************************************/
function treedb_config_get_tranger_views(gobj, conn_id, treedb_name, topic)
{
    if(!conn_id) {
        return [];
    }
    let list = read_tranger_views(gobj)[conn_id] || [];
    return list.filter((v) =>
        v && v.treedb_name === treedb_name && v.topic === topic
    );
}

/***************************************************************
 *  Persist a view as open (idempotent per conn/treedb/topic/key/mode;
 *  a re-add refreshes its match_cond).
 ***************************************************************/
function do_add_tranger_view(gobj, conn_id, treedb_name, topic, key, mode, match_cond)
{
    if(!conn_id) {
        return;
    }
    let map = read_tranger_views(gobj);
    let list = map[conn_id] || [];
    list = list.filter((v) => !(v &&
        v.treedb_name === treedb_name && v.topic === topic &&
        v.key === key && v.mode === mode));
    list.push({
        treedb_name: treedb_name,
        topic:       topic,
        key:         key,
        mode:        mode,
        match_cond:  match_cond || {}
    });
    map[conn_id] = list;
    write_tranger_views(gobj, map);
}

/***************************************************************
 *  Mark a view as closed (drop it from persistence).
 ***************************************************************/
function do_remove_tranger_view(gobj, conn_id, treedb_name, topic, key, mode)
{
    if(!conn_id) {
        return;
    }
    let map = read_tranger_views(gobj);
    let list = map[conn_id];
    if(!Array.isArray(list)) {
        return;
    }
    let kept = list.filter((v) => !(v &&
        v.treedb_name === treedb_name && v.topic === topic &&
        v.key === key && v.mode === mode));
    if(kept.length === list.length) {
        return;
    }
    if(kept.length > 0) {
        map[conn_id] = kept;
    } else {
        delete map[conn_id];
    }
    write_tranger_views(gobj, map);
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
    persist(gobj, "selected_treedbs");
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
function do_set_selected(gobj, workspace, list)
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
 *  {conn_id, svc: {key, service, gclass}, label}.
 *  Legacy persisted entries only have treedb_name — normalize on read.
 ***************************************************************/
function do_toggle_selected(gobj, workspace, sel)
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
            /*  legacy field name, still read by older selections  */
            treedb_name: sel.svc.service,
            label:       sel.label || sel.svc.service
        });
    }
    do_set_selected(gobj, workspace, list);
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
        svc_key: s.treedb_name || "",
        service: s.treedb_name || "",
        gclass:  "C_NODE"
    });
}

/***************************************************************
 *  Remove one selected id from a workspace (tab close).
 ***************************************************************/
function do_remove_selected(gobj, workspace, id)
{
    if(!id) {
        return;
    }
    let list = treedb_config_get_selected(gobj, workspace).filter((s) => s && s.id !== id);
    do_set_selected(gobj, workspace, list);
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
function do_set_active_tab(gobj, workspace, id)
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
    persist(gobj, "active_tabs");
}

/***************************************************************
 *  Rows kept in a Live card's rolling buffer. It is a BROWSER memory
 *  bound (the backend keeps no live data), so it is clamped: a bad value
 *  would either make the card useless or eat the tab's memory.
 ***************************************************************/
const LIVE_MAX_DEFAULT = 1000;
const LIVE_MAX_MIN = 50;
const LIVE_MAX_MAX = 100000;

function treedb_config_get_live_max(gobj)
{
    let n = parseInt(gobj_read_attr(gobj, "live_max"), 10);
    if(Number.isNaN(n) || n <= 0) {
        return LIVE_MAX_DEFAULT;
    }
    return clamp_live_max(n);
}

function do_set_live_max(gobj, n)
{
    let v = parseInt(n, 10);
    if(Number.isNaN(v) || v <= 0) {
        v = LIVE_MAX_DEFAULT;
    }
    gobj_write_attr(gobj, "live_max", clamp_live_max(v));
    persist(gobj, "live_max");
}

function clamp_live_max(n)
{
    if(n < LIVE_MAX_MIN) {
        return LIVE_MAX_MIN;
    }
    if(n > LIVE_MAX_MAX) {
        return LIVE_MAX_MAX;
    }
    return n;
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Every MUTATION of the config is an event.
 *
 *  It used to be a set of exported functions that four other gclasses
 *  called directly, each ending in a gobj_publish_event fired from inside
 *  a FOREIGN gobj's DOM callback: nothing about the config's life reached
 *  the `machine` trace, and the notification came out of a stack that had
 *  no business owning it. Now a caller sends an event and the work — write,
 *  persist, publish — happens here, in this gobj's own action.
 *
 *  READS stay plain exported functions (treedb_config_get_*): reading an
 *  attr changes no state and there is nothing to audit.
 ***************************************************************/
function ac_set_connections(gobj, event, kw, src)
{
    do_set_connections(gobj, (kw && kw.connections) || []);
    return 0;
}

function ac_set_conn_services(gobj, event, kw, src)
{
    do_set_conn_services(gobj, (kw && kw.conn_id) || "", (kw && kw.services) || []);
    return 0;
}

function ac_set_conns_enabled(gobj, event, kw, src)
{
    let conns = (kw && Array.isArray(kw.conns)) ? kw.conns : null;
    if(!conns) {
        log_error(`${GCLASS_NAME}: EV_SET_CONNS_ENABLED without conns`);
        return -1;
    }
    do_set_conns_enabled(gobj, conns);
    return 0;
}

function ac_set_conns_browse(gobj, event, kw, src)
{
    let ids = (kw && Array.isArray(kw.conn_ids)) ? kw.conn_ids : null;
    if(!ids) {
        log_error(`${GCLASS_NAME}: EV_SET_CONNS_BROWSE without conn_ids`);
        return -1;
    }
    do_set_conns_browse(gobj, ids, !!(kw && kw.selected));
    return 0;
}

function ac_store_scanned_services(gobj, event, kw, src)
{
    do_store_scanned_services(gobj, (kw && kw.conn_id) || "", (kw && kw.services) || []);
    return 0;
}

function ac_set_conn_enabled(gobj, event, kw, src)
{
    do_set_conn_enabled(gobj, (kw && kw.conn_id) || "", !!(kw && kw.enabled));
    return 0;
}

/***************************************************************
 *  Fold or unfold MANY connections in one write.
 *
 *  kw: {conn_ids: [...], expanded}
 ***************************************************************/
function ac_set_conns_expanded(gobj, event, kw, src)
{
    let ids = (kw && Array.isArray(kw.conn_ids)) ? kw.conn_ids : null;
    if(!ids) {
        log_error(`${GCLASS_NAME}: EV_SET_CONNS_EXPANDED without conn_ids`);
        return -1;
    }
    let expanded = !!(kw && kw.expanded);
    let map = read_expanded_conns(gobj);
    for(let id of ids) {
        if(!id) {
            continue;
        }
        if(expanded) {
            map[id] = true;
        } else {
            delete map[id];
        }
    }
    gobj_write_attr(gobj, "expanded_conns", map);
    persist(gobj, "expanded_conns");
    return 0;
}

function ac_set_conn_expanded(gobj, event, kw, src)
{
    do_set_conn_expanded(gobj, (kw && kw.conn_id) || "", !!(kw && kw.expanded));
    return 0;
}

/***************************************************************
 *  Select or deselect MANY services in ONE write.
 *
 *  kw: {workspace, sels: [{conn_id, svc, label}], on}
 *
 *  One user gesture is one change: ticking a connection's box opens a
 *  dozen treedbs, and sending a dozen EV_TOGGLE_SELECTED would persist
 *  the config a dozen times and rebuild the workspace tabs a dozen
 *  times — the same list arriving at the shell over and over.
 ***************************************************************/
function ac_set_services_selected(gobj, event, kw, src)
{
    let workspace = (kw && kw.workspace) || "";
    let sels = (kw && Array.isArray(kw.sels)) ? kw.sels : null;
    let on = !!(kw && kw.on);

    if(!sels) {
        log_error(`${GCLASS_NAME}: EV_SET_SERVICES_SELECTED with no selections`);
        return -1;
    }

    let list = treedb_config_get_selected(gobj, workspace).slice();
    for(let sel of sels) {
        if(!sel || !sel.conn_id || !sel.svc || !sel.svc.key) {
            log_error(`${GCLASS_NAME}: EV_SET_SERVICES_SELECTED with a bad selection`);
            continue;
        }
        let id = sel_id(sel.conn_id, sel.svc.key);
        let idx = list.findIndex((s) => s && s.id === id);
        if(on && idx < 0) {
            list.push({
                id:          id,
                conn_id:     sel.conn_id,
                svc_key:     sel.svc.key,
                service:     sel.svc.service,
                gclass:      sel.svc.gclass,
                /*  legacy field name, still read by older selections  */
                treedb_name: sel.svc.service,
                label:       sel.label || sel.svc.service
            });
        } else if(!on && idx >= 0) {
            list.splice(idx, 1);
        }
    }
    do_set_selected(gobj, workspace, list);
    return 0;
}

function ac_toggle_selected(gobj, event, kw, src)
{
    let sel = kw ? kw.sel : null;
    if(!sel || !sel.conn_id || !sel.svc || !sel.svc.key) {
        log_error(`${GCLASS_NAME}: EV_TOGGLE_SELECTED with a bad selection`);
        return -1;
    }
    do_toggle_selected(gobj, (kw && kw.workspace) || "", sel);
    return 0;
}

function ac_remove_selected(gobj, event, kw, src)
{
    do_remove_selected(gobj, (kw && kw.workspace) || "", (kw && kw.id) || "");
    return 0;
}

function ac_set_active_tab(gobj, event, kw, src)
{
    do_set_active_tab(gobj, (kw && kw.workspace) || "", (kw && kw.id) || "");
    return 0;
}

function ac_set_live_max(gobj, event, kw, src)
{
    do_set_live_max(gobj, kw ? kw.live_max : 0);
    return 0;
}

function ac_add_tranger_view(gobj, event, kw, src)
{
    do_add_tranger_view(gobj,
        (kw && kw.conn_id) || "", (kw && kw.treedb_name) || "",
        (kw && kw.topic) || "", (kw && kw.key) || "", (kw && kw.mode) || "",
        (kw && kw.match_cond) || {});
    return 0;
}

function ac_remove_tranger_view(gobj, event, kw, src)
{
    do_remove_tranger_view(gobj,
        (kw && kw.conn_id) || "", (kw && kw.treedb_name) || "",
        (kw && kw.topic) || "", (kw && kw.key) || "", (kw && kw.mode) || "");
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
            ["EV_SET_CONNECTIONS",       ac_set_connections,       null],
            ["EV_SET_CONN_SERVICES",     ac_set_conn_services,     null],
            ["EV_SET_CONNS_BROWSE",      ac_set_conns_browse,      null],
            ["EV_STORE_SCANNED_SERVICES", ac_store_scanned_services, null],
            ["EV_SET_CONN_ENABLED",      ac_set_conn_enabled,      null],
            ["EV_SET_CONNS_ENABLED",     ac_set_conns_enabled,     null],
            ["EV_SET_CONN_EXPANDED",     ac_set_conn_expanded,     null],
            ["EV_SET_CONNS_EXPANDED",    ac_set_conns_expanded,    null],
            ["EV_TOGGLE_SELECTED",       ac_toggle_selected,       null],
            ["EV_SET_SERVICES_SELECTED", ac_set_services_selected, null],
            ["EV_REMOVE_SELECTED",       ac_remove_selected,       null],
            ["EV_SET_ACTIVE_TAB",        ac_set_active_tab,        null],
            ["EV_SET_LIVE_MAX",          ac_set_live_max,          null],
            ["EV_ADD_TRANGER_VIEW",      ac_add_tranger_view,      null],
            ["EV_REMOVE_TRANGER_VIEW",   ac_remove_tranger_view,   null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        /*  input: the mutations (see the Actions banner)  */
        ["EV_SET_CONNECTIONS",          0],
        ["EV_SET_CONN_SERVICES",        0],
        ["EV_SET_CONNS_BROWSE",         0],
        ["EV_STORE_SCANNED_SERVICES",   0],
        ["EV_SET_CONN_ENABLED",         0],
        ["EV_SET_CONNS_ENABLED",        0],
        ["EV_SET_CONN_EXPANDED",        0],
        ["EV_SET_CONNS_EXPANDED",       0],
        ["EV_TOGGLE_SELECTED",          0],
        ["EV_SET_SERVICES_SELECTED",    0],
        ["EV_REMOVE_SELECTED",          0],
        ["EV_SET_ACTIVE_TAB",           0],
        ["EV_SET_LIVE_MAX",             0],
        ["EV_ADD_TRANGER_VIEW",         0],
        ["EV_REMOVE_TRANGER_VIEW",      0],
        /*  output  */
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
    treedb_config_conn_services,
    treedb_config_service_key,
    treedb_config_normalize_sel,
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_get_selected,
    treedb_config_is_selected,
    treedb_config_get_active_tab,
    treedb_config_get_live_max,
    LIVE_MAX_DEFAULT,
    LIVE_MAX_MIN,
    LIVE_MAX_MAX,
    treedb_config_get_tranger_views,
    treedb_config_is_conn_expanded,
};
