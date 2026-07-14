/***********************************************************************
 *          c_app.js
 *
 *      C_TREEDB_APP — application root (the default service). Mirrors
 *      gui_agent's C_APP, adapted for the multi-backend TreeDB browser:
 *
 *        1. Owns the BFF login flow (C_TREEDB_LOGIN), the connection config
 *           (C_TREEDB_CONFIG) and the per-connection transports
 *           (C_TREEDB_LINKS).
 *        2. Shows the pre-shell login screen when there is no session
 *           (ST_LOGGED_OUT) and the shell once there is one (ST_SESSION):
 *           the session is a STATE, not an `if(priv.shell)`.
 *        3. Builds the declarative shell (C_YUI_SHELL) on login and tears it
 *           down on logout.
 *        4. Forwards the access_token (from /auth/token) onto every link so
 *           it travels in each C_IEVENT_CLI identity_card, and re-forwards a
 *           rotated token on refresh.
 *        5. Builds each workspace's tabs (Topics / Graphs): a fixed picker
 *           tab (C_TREEDB_PICKER) + one dynamic tab per selected treedb of a
 *           CONNECTED backend, mounting the treedb view with the live
 *           transport as its gobj_remote_yuno (via yui_shell_set_submenu, so
 *           the live pointer can travel in target.kw).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error, log_warning, gobj_short_name,
    gobj_read_attr, gobj_write_str_attr,
    gobj_create_service, gobj_create_pure_child,
    gobj_subscribe_event, gobj_send_event, gobj_publish_event,
    gobj_change_state,
    gobj_find_service,
    gobj_start_tree, gobj_stop_tree, gobj_destroy, gobj_is_running,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import pkg from "../package.json";

import {yui_shell_show_modal} from "@yuneta/gobj-ui/src/shell_modals.js";

import {
    yui_shell_set_avatar_provider,
    yui_shell_refresh_avatars,
    yui_shell_set_translator,
    yui_shell_set_toolbar_item_icon,
    yui_shell_set_submenu,
    yui_shell_navigate,
} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_get_selected,
    treedb_config_get_active_tab,
    treedb_config_normalize_sel,
    treedb_config_conn_services,
} from "./c_treedb_config.js";

import {
    treedb_links_get_iev,
    treedb_links_is_connected,
} from "./c_treedb_links.js";

import {setup_dev, dev_window_was_open} from "@yuneta/gobj-ui/src/yui_dev.js";

import {switch_locale, current_locale} from "./locales/locales.js";
import {current_theme, toggle_theme} from "./theme.js";
import {mount_login} from "./login.js";
import {deploy_info} from "./conf/deploy.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_APP";

/*  The two workspaces and the treedb view each mounts.  */
const WORKSPACES = {
    topics: {view: "C_YUI_TREEDB_TOPICS", icon: "yi-table"},
    graphs: {view: "C_YUI_TREEDB_GRAPH",  icon: "yi-hexagon-nodes"}
};

/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_JSON,     "config",      0,  null,  "Shell config (app_config.json)"),
SDATA(data_type_t.DTP_BOOLEAN,  "use_hash",    0,  true,  "Pass-through to C_YUI_SHELL"),
SDATA(data_type_t.DTP_STRING,   "username",    0,  "",    "Authenticated username"),
SDATA_END()
];

let PRIVATE_DATA = {
    shell:        null,
    login_ui:     null,
    nak_conns:    null,   /*  conn_ids awaiting the in-flight token refresh  */
    nak_recovered: null,  /*  conn_ids already reopened once with a fresh token  */
    refreshing:   false,  /*  a BFF refresh is in flight (dedupes concurrent NAKs)  */
    ever_connected: null, /*  conn_ids that reached session at least once (keep tab)  */
    mounted_base: "",     /*  last EV_ROUTE_CHANGED base (resolved route)  */
    about_modal:  null,   /*  the open About dialog (closed on logout)  */
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
    gobj.priv.nak_conns = {};
    gobj.priv.nak_recovered = {};
    gobj.priv.ever_connected = {};
    gobj.priv.mounted_base = "";

    /*  Config service (child of self).  */
    let config = gobj_create_service("treedb_config", "C_TREEDB_CONFIG", {}, gobj);
    gobj_subscribe_event(config, "EV_SELECTED_TREEDBS_CHANGED", {}, gobj);
    gobj_subscribe_event(config, "EV_CONNECTIONS_CHANGED", {}, gobj);

    /*  Login service (child of self); subscribe to all its output events.  */
    gobj_create_service("treedb_login", "C_TREEDB_LOGIN", {subscriber: gobj}, gobj);

    /*  Per-connection transports (child of self); subscribe to the
     *  connection events it re-publishes.
     *
     *  No `subscriber` attr here: that would ADD a null (all-events)
     *  subscription on top of the explicit ones below, and a null
     *  subscription does NOT dedupe against a named one — every event would
     *  be delivered TWICE (a second EV_ON_ID_NAK re-entering ac_on_id_nak is
     *  what re-armed the refresh->reopen->NAK loop this app tries to break).  */
    let links = gobj_create_service("treedb_links", "C_TREEDB_LINKS", {}, gobj);
    gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
    gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
    gobj_subscribe_event(links, "EV_ON_ID_NAK", {}, gobj);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    /*  Starts config + login + links. login.mt_start runs
     *  try_restore_session → EV_LOGIN_ACCEPTED or EV_RESTORE_FAILED. */
    gobj_start_tree(gobj);
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
                     *      Local Methods
                     ***************************/




function compute_initials(gobj)
{
    let name = gobj_read_attr(gobj, "username") || "";
    if(!name) {
        return "";
    }
    let local = String(name).split("@")[0];
    let parts = local.split(/[._\-\s]+/).filter(Boolean);
    let ini = parts.slice(0, 2).map(p => p[0]).join("");
    return (ini || local.slice(0, 2)).toUpperCase();
}

/***************************************************************
 *  Pre-shell login screen.
 ***************************************************************/
function show_login_screen(gobj)
{
    let priv = gobj.priv;
    if(priv.login_ui) {
        return;
    }
    priv.login_ui = mount_login({
        on_submit: function(creds) {
            let login = gobj_find_service("treedb_login", false);
            if(login) {
                gobj_send_event(login, "EV_DO_LOGIN", creds, gobj);
            }
        }
    });
}

function hide_login_screen(gobj)
{
    let priv = gobj.priv;
    if(priv.login_ui) {
        priv.login_ui.unmount();
        priv.login_ui = null;
    }
}

/***************************************************************
 *  Build the declarative shell (once).
 ***************************************************************/
function build_shell(gobj)
{
    let priv = gobj.priv;
    if(priv.shell) {
        return priv.shell;
    }

    let shell = gobj_create_pure_child("shell", "C_YUI_SHELL", {
        config:   gobj_read_attr(gobj, "config"),
        use_hash: gobj_read_attr(gobj, "use_hash")
    }, gobj);
    priv.shell = shell;
    gobj_subscribe_event(shell, "EV_TOGGLE_THEME",    {}, gobj);
    gobj_subscribe_event(shell, "EV_TOGGLE_LANGUAGE", {}, gobj);
    gobj_subscribe_event(shell, "EV_LOGOUT",          {}, gobj);
    gobj_subscribe_event(shell, "EV_OPEN_DEVTOOLS",   {}, gobj);
    gobj_subscribe_event(shell, "EV_OPEN_ABOUT",      {}, gobj);
    gobj_subscribe_event(shell, "EV_NAV_ITEM_CLOSE",  {}, gobj);
    gobj_subscribe_event(shell, "EV_ROUTE_CHANGED",   {}, gobj);
    gobj_start_tree(shell);

    yui_shell_set_avatar_provider(shell, () => compute_initials(gobj));
    yui_shell_set_translator(shell, t);
    refresh_language(document.body, t);
    update_theme_icon(gobj);

    if(dev_window_was_open() && !gobj_find_service("Developer-Window", false)) {
        setup_dev(gobj, true);
    }
    return shell;
}

function update_theme_icon(gobj)
{
    let priv = gobj.priv;
    if(!priv.shell) {
        return;
    }
    let icon = (current_theme() === "light") ? "yi-sun" : "yi-moon";
    yui_shell_set_toolbar_item_icon(priv.shell, "theme", icon);
}

function destroy_shell(gobj)
{
    let priv = gobj.priv;
    if(priv.shell) {
        if(gobj_is_running(priv.shell)) {
            gobj_stop_tree(priv.shell);
        }
        gobj_destroy(priv.shell);
        priv.shell = null;
    }
}

/***************************************************************
 *  Route helpers.
 ***************************************************************/
function picker_route(ws)
{
    return "/" + ws + "/connections";
}

function db_home_route(ws)
{
    return "/" + ws + "/db";
}

function db_tab_route(ws, sel_id_)
{
    return db_home_route(ws) + "/" + encodeURIComponent(sel_id_);
}

/***************************************************************
 *  The fixed picker tab of a workspace.
 ***************************************************************/
function picker_item(ws)
{
    return {
        id:       "picker",
        name:     "connections",
        icon:     "yi-cloudversify",
        route:    picker_route(ws),
        closable: false,
        target: {
            stage:     "main",
            gclass:    "C_TREEDB_PICKER",
            kw:        {workspace: ws, title: "connections"},
            lifecycle: "keep_alive"
        }
    };
}

/***************************************************************
 *  (Re)build one workspace's tabs: picker + one tab per selected treedb
 *  whose connection has a live transport.
 *
 *  A tab is emitted once its connection reaches session (EV_ON_OPEN sets
 *  `ever_connected`) and is KEPT across a later transient WS drop — coloured
 *  `yui-nav-disconnected` (red) instead of being removed. Dropping it would
 *  make the shell prune + destroy the mounted C_TREEDB_VIEW on every clean
 *  1001 flap, only to rebuild it on reconnect (churn: lost scroll/selection,
 *  re-`descs`/`nodes` storms). The C_IEVENT_CLI transport survives a clean
 *  close and auto-reconnects underneath, so the view's resolved pointer stays
 *  valid and its subscriptions resend — mirrors how gui_agent keeps node tabs
 *  mounted and only recolours them. The tab is removed only when its transport
 *  is actually gone (`!iev`: connection removed, or closed by the NAK give-up).
 ***************************************************************/
function rebuild_workspace_tabs(gobj, ws)
{
    let priv = gobj.priv;
    if(!priv.shell || !WORKSPACES[ws]) {
        return;
    }
    let spec = WORKSPACES[ws];
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    let selected = config ? treedb_config_get_selected(config, ws) : [];
    let items = [picker_item(ws)];

    for(let raw_sel of selected) {
        let sel = treedb_config_normalize_sel(raw_sel);
        if(!sel) {
            continue;
        }
        let iev = links ? treedb_links_get_iev(links, sel.conn_id) : null;
        let connected = links ? treedb_links_is_connected(links, sel.conn_id) : false;
        let ever = !!priv.ever_connected[sel.conn_id];
        if(!iev || (!connected && !ever)) {
            /*  No transport yet, or never connected: the picker shows it as
             *  connecting; the tab appears on its first EV_ON_OPEN.  */
            continue;
        }
        /*  C_TRANGER services open the raw-records browser (Topics only —
         *  the picker doesn't offer them in Graphs).  */
        let view_gclass = (sel.gclass === "C_TRANGER") ? "C_TRANGER_VIEW" : spec.view;
        items.push({
            id:       "db-" + sel.id,
            name:     sel.label || sel.service || sel.treedb_name,
            icon:     (sel.gclass === "C_TRANGER") ? "yi-floppy-disk" : spec.icon,
            route:    db_tab_route(ws, sel.id),
            /*  Red label while the backend is dropped; the view stays mounted. */
            class:    connected ? "" : "yui-nav-disconnected",
            closable: true,
            target: {
                stage:     "main",
                /*  C_TREEDB_VIEW hosts the real treedb view AS A SERVICE so
                 *  C_IEVENT_CLI can route its command answers back (a pure
                 *  shell child is not findable by gobj_find_service).  */
                gclass:    "C_TREEDB_VIEW",
                kw: {
                    view_gclass: view_gclass,
                    treedb_name: sel.service || sel.treedb_name,
                    workspace:   ws,
                    conn_id:     sel.conn_id,
                    /*  This tab's route, so the view can deep-link its
                     *  selected topic / operation mode as <base_route>/<seg>. */
                    base_route:  db_tab_route(ws, sel.id),
                    system:      false
                },
                lifecycle: "keep_alive"
            }
        });
    }
    yui_shell_set_submenu(priv.shell, ws, items);

    /*  The submenu (picker tab + dynamic treedb tabs) is (re)built here,
     *  after the initial refresh_language, so translate the fresh nav DOM
     *  or its i18n labels render as the raw English key until the next
     *  language toggle. */
    refresh_language(document.body, t);
}

function rebuild_all_workspaces(gobj)
{
    for(let ws in WORKSPACES) {
        rebuild_workspace_tabs(gobj, ws);
    }
}

/***************************************************************
 *  The route to land on when entering a workspace (clicking its primary
 *  nav item): its last-active tab when that treedb still has a tab, else the
 *  first open tab, else the picker. Persisting the active tab is what makes
 *  switching topics ↔ graphs return to the tab you were on instead of the
 *  connection manager. "Has a tab" matches rebuild_workspace_tabs (transport
 *  exists AND connected OR ever-connected).
 ***************************************************************/
function workspace_first_route(gobj, ws)
{
    let priv = gobj.priv;
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    let selected = config ? treedb_config_get_selected(config, ws) : [];
    let has_tab = function(s) {
        if(!links || !s) {
            return false;
        }
        let iev = treedb_links_get_iev(links, s.conn_id);
        return !!iev &&
            (treedb_links_is_connected(links, s.conn_id) || !!priv.ever_connected[s.conn_id]);
    };
    let open = selected.filter(has_tab);
    if(!open.length) {
        return picker_route(ws);
    }
    let active = config ? treedb_config_get_active_tab(config, ws) : "";
    if(active && open.some((s) => s && s.id === active)) {
        return db_tab_route(ws, active);
    }
    return db_tab_route(ws, open[0].id);
}

/***************************************************************
 *  Re-navigate to the treedb tab named in the URL once its backend
 *  connection is up.
 *
 *  On F5 (or a mid-session reconnect) the hash is /<ws>/db/<sel>, but the
 *  dynamic tab only exists after EV_ON_OPEN rebuilds it. Until then the
 *  shell resolves the route to its declared ancestor (/<ws>/db → the
 *  picker), so a reload lands on the connection manager instead of the tab
 *  the operator was on. Called right after the tabs are (re)built: if the
 *  URL points at a treedb whose tab now exists, jump to it.
 ***************************************************************/
function restore_tab_from_url(gobj)
{
    let priv = gobj.priv;
    if(!priv.shell) {
        return;
    }
    let cur = gobj_read_attr(priv.shell, "current_route") || "";
    let ws = ws_from_route(cur);
    if(!ws) {
        return;
    }
    let prefix = db_home_route(ws) + "/";
    if(cur.indexOf(prefix) !== 0) {
        /*  Not a treedb-tab URL (e.g. the picker) — nothing to restore.  */
        return;
    }
    /*  The tail is <sel>[/<topic-or-mode>]: the tab is keyed by the FIRST
     *  segment (<sel>); a deeper subpath is the view's selected topic / mode,
     *  which the treedb view restores itself once we land on the full route. */
    let sel_id_ = decode_tail(cur.slice(prefix.length).split("/")[0]);
    let base_route = db_tab_route(ws, sel_id_);
    if(priv.mounted_base === base_route) {
        /*  Already resting on this tab (base resolved to it exactly).  */
        return;
    }
    /*  Only jump once the tab actually exists: its treedb must be selected
     *  AND its backend connected — the same condition rebuild_workspace_tabs
     *  uses to emit the tab.  */
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    let selected = config ? treedb_config_get_selected(config, ws) : [];
    let hit = selected.find((s) => s && s.id === sel_id_);
    if(!hit || !(links && treedb_links_is_connected(links, hit.conn_id))) {
        /*  Tab not available yet; a later EV_ON_OPEN retries this.  */
        return;
    }
    /*  Deferred: EV_ON_OPEN is a published event, so navigating synchronously
     *  would re-enter the shell mid-publish. Navigate to the FULL route so the
     *  view's selected topic / mode is restored too.  */
    setTimeout(function() {
        if(gobj.priv.shell) {
            yui_shell_navigate(gobj.priv.shell, cur);
        }
    }, 0);
}

/***************************************************************
 *  Reconcile the live transports with the configured connections
 *  (open new, recreate edited, close removed).
 ***************************************************************/
function sync_connections(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    if(!config || !links) {
        return;
    }
    let conns = treedb_config_get_connections(config);

    /*
     *  The C_IEVENT_CLI identity_card advertises `required_services`. The
     *  backend's C_AUTHZ only authorizes commands to the treedb services
     *  listed there — with an empty list it grants only the connected service
     *  and silently DROPS a `descs` to treedb_wattyzer.
     *
     *  treedb_links sets it PER CONNECTION now (C_IEVENT_CLI's own attr, which
     *  falls back to the yuno's when empty). The yuno-wide attr is necessarily
     *  the UNION of every configured backend's selection, so using it told each
     *  backend the service names of all the others — and handed it a card
     *  listing services it does not host. (conn_coords includes the selection,
     *  so a selection change recreates that transport and re-sends its card.)
     */

    /*  Forget per-connection state for connections no longer configured. */
    let alive = {};
    for(let c of conns) {
        alive[c.id] = true;
    }
    for(let priv_map of [gobj.priv.ever_connected, gobj.priv.nak_recovered, gobj.priv.nak_conns]) {
        for(let conn_id of Object.keys(priv_map)) {
            if(!alive[conn_id]) {
                delete priv_map[conn_id];
            }
        }
    }

    gobj_send_event(links, "EV_SYNC_CONNECTIONS", {connections: conns}, gobj);
}

/***************************************************************
 *  Which workspace a route belongs to, or "".
 ***************************************************************/
function ws_from_route(route)
{
    let m = /^\/([^/]+)\//.exec(String(route || ""));
    let ws = m ? m[1] : "";
    return WORKSPACES[ws] ? ws : "";
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Login accepted (fresh or restored): the session begins. Forward the
 *  token onto the links, build the shell, open every configured
 *  connection. ST_SESSION is what makes the shell chrome, the routing and
 *  the connection events reachable at all — with no session, a
 *  EV_ROUTE_CHANGED or a EV_ON_OPEN can only be a bug, and now it says so.
 ***************************************************************/
function ac_login_accepted(gobj, event, kw, src)
{
    if(kw && kw.username) {
        gobj_write_str_attr(gobj, "username", kw.username);
    }
    hide_login_screen(gobj);
    gobj_change_state(gobj, "ST_SESSION");

    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_send_event(links, "EV_SET_TOKEN",
            {token: (kw && kw.access_token) || ""}, gobj);
    }

    build_shell(gobj);
    yui_shell_refresh_avatars(gobj.priv.shell);

    sync_connections(gobj);
    rebuild_all_workspaces(gobj);
    return 0;
}

/***************************************************************
 *  Token refreshed: push the rotated token onto the links, and
 *  reopen any connection that NAK'd (its identity_card carried the
 *  expired token).
 ***************************************************************/
function ac_login_refreshed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.refreshing = false;

    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_send_event(links, "EV_SET_TOKEN",
            {token: (kw && kw.access_token) || ""}, gobj);
    }
    for(let conn_id of Object.keys(priv.nak_conns)) {
        let conn = config ? treedb_config_get_connection(config, conn_id) : null;
        if(conn && links) {
            /*  Mark it "refreshed once": a repeat NAK after this reopen is a
             *  genuine rejection, caught in ac_on_id_nak (no more looping). */
            priv.nak_recovered[conn_id] = true;
            gobj_send_event(links, "EV_REOPEN_CONN", {conn_id: conn_id}, gobj);
        }
    }
    priv.nak_conns = {};
    return 0;
}

/***************************************************************
 *  A connection opened: paint its treedb tabs.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    if(conn_id) {
        /*  Reached session → keep its tab across later transient drops. */
        gobj.priv.ever_connected[conn_id] = true;
        /*  Reconnected successfully → clear its recovery marks so a LATER
         *  token expiry is treated as a fresh, retriable NAK again. */
        delete gobj.priv.nak_recovered[conn_id];
        delete gobj.priv.nak_conns[conn_id];
    }
    rebuild_all_workspaces(gobj);
    restore_tab_from_url(gobj);
    return 0;
}

/***************************************************************
 *  A connection dropped: its tabs go away (rebuild omits it).
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    rebuild_all_workspaces(gobj);
    return 0;
}

/***************************************************************
 *  A connection's identity was NAK'd: usually an expired access_token.
 *
 *  First NAK for a connection → ONE silent BFF refresh, then reopen it with
 *  the fresh token (ac_login_refreshed). If it NAKs AGAIN after that reopen
 *  (the fresh token is genuinely rejected by that backend — e.g. no role for
 *  the treedb, or `expose_access_token` off so the forwarded token is empty),
 *  give up on THAT connection: close its transport so it stops the
 *  refresh→reopen→NAK loop. We do NOT log the user out — the BFF session and
 *  the other backends are unaffected (unlike gui_agent, which is single-link
 *  and logs out on the second NAK).
 ***************************************************************/
function ac_on_id_nak(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = (kw && kw.conn_id) || "";

    /*  Second NAK after a refresh for THIS connection → real rejection, not a
     *  stale-token race. Stop retrying it (breaks the loop); leave the rest. */
    if(conn_id && priv.nak_recovered[conn_id]) {
        delete priv.nak_recovered[conn_id];
        delete priv.nak_conns[conn_id];
        delete priv.ever_connected[conn_id];   /*  transport gone → drop its tab  */

        let reason = (kw && kw.comment) || "identity rejected";
        log_error(`${gobj_short_name(gobj)}: connection '${conn_id}' rejected ` +
                  `by the backend after a token refresh: ${reason}`);

        let links = gobj_find_service("treedb_links", false);
        if(links) {
            /*  Not a bare close: a close leaves NO trace and the picker sits on
             *  "Connecting…" for a connection nobody is retrying. Reject it —
             *  the transport goes and the cause stays visible.  */
            gobj_send_event(links, "EV_REJECT_CONN",
                {conn_id: conn_id, reason: reason}, gobj);
        }

        /*  Clear the user's connect intent too. Closing the transport alone was
         *  not enough: `enabled` stayed true, so the NEXT EV_CONNECTIONS_CHANGED
         *  (any unrelated edit) re-synced it back up and re-armed the very
         *  refresh→reopen→NAK loop this branch exists to break. Reconnecting is
         *  now a deliberate act in Settings, once the roles are fixed.  */
        let config = gobj_find_service("treedb_config", false);
        if(config) {
            gobj_send_event(config, "EV_SET_CONN_ENABLED",
                {conn_id: conn_id, enabled: false}, gobj);
        }

        rebuild_all_workspaces(gobj);
        return 0;
    }

    if(conn_id) {
        priv.nak_conns[conn_id] = true;
    }
    /*  `refreshing` dedupes concurrent NAKs into a single refresh request. */
    if(!priv.refreshing) {
        priv.refreshing = true;
        let login = gobj_find_service("treedb_login", false);
        if(login) {
            gobj_send_event(login, "EV_DO_REFRESH", {}, gobj);
        }
    }
    return 0;
}

/***************************************************************
 *  No valid session on load — show the login form (no error).
 ***************************************************************/
function ac_restore_failed(gobj, event, kw, src)
{
    show_login_screen(gobj);
    return 0;
}

/***************************************************************
 *  Reset the token-recovery bookkeeping (leaving a session, whichever
 *  way).
 ***************************************************************/
function forget_nak_state(gobj)
{
    let priv = gobj.priv;
    priv.refreshing = false;
    priv.nak_conns = {};
    priv.nak_recovered = {};
}

/***************************************************************
 *  The BFF refused the credentials (ST_LOGGED_OUT): paint the error on
 *  the login form. There is no shell and no link to tear down — which is
 *  the whole reason this is a STATE and no longer an `if(priv.shell)`
 *  inside one action doing both jobs.
 ***************************************************************/
function ac_login_denied(gobj, event, kw, src)
{
    let priv = gobj.priv;
    forget_nak_state(gobj);

    let msg = (kw && (kw.error || kw.error_code)) || t("login failed");
    show_login_screen(gobj);
    if(priv.login_ui) {
        priv.login_ui.set_busy(false);
        priv.login_ui.set_error(`${t("login failed")}: ${msg}`);
    }
    return 0;
}

/***************************************************************
 *  The BFF said NO to a session that WAS alive (ST_SESSION): the refresh
 *  token is dead. Tear the session down — shell, transports — and go back
 *  to the login form with the cause.
 *
 *  The links are closed BEFORE the state change on purpose: closing a
 *  transport publishes its EV_ON_CLOSE, and that event is only declared in
 *  ST_SESSION (a connection event has no meaning with no session). Leaving
 *  ST_SESSION first would make each one a loud "event not defined".
 ***************************************************************/
function ac_session_expired(gobj, event, kw, src)
{
    let priv = gobj.priv;
    forget_nak_state(gobj);

    let msg = (kw && (kw.error || kw.error_code)) || t("login failed");

    destroy_shell(gobj);
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_send_event(links, "EV_CLOSE_ALL", {}, gobj);
    }
    gobj_change_state(gobj, "ST_LOGGED_OUT");

    show_login_screen(gobj);
    if(priv.login_ui) {
        priv.login_ui.set_busy(false);
        priv.login_ui.set_error(`${t("login failed")}: ${msg}`);
    }
    return 0;
}

/***************************************************************
 *  A token refresh could not be MADE (network down, BFF unreachable). The
 *  session is alive — the login service is already retrying with backoff —
 *  so change NOTHING: the shell, the links and the open cards stay. But say
 *  so, because until it succeeds the links are running on a token that will
 *  expire, and a NAK afterwards must not read as a mystery.
 *
 *  `refreshing` is cleared: it dedupes concurrent NAKs into ONE refresh, and
 *  leaving it set after a failed one would swallow the next NAK's recovery.
 ***************************************************************/
function ac_refresh_failed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.refreshing = false;

    let secs = Math.round(((kw && kw.retry_ms) || 0) / 1000);
    log_warning(`${gobj_short_name(gobj)}: token refresh failed ` +
                `(${(kw && kw.error) || "?"}) — retrying in ${secs}s, ` +
                `session kept`);
    return 0;
}

/***************************************************************
 *  Logout requested (shell user menu) → ask the BFF.
 ***************************************************************/
function ac_logout(gobj, event, kw, src)
{
    let login = gobj_find_service("treedb_login", false);
    if(login) {
        gobj_send_event(login, "EV_DO_LOGOUT", {}, gobj);
    }
    return 0;
}

/***************************************************************
 *  Logout done — tear down shell + links, back to login.
 *
 *  Same order as ac_session_expired: the transports are closed while we
 *  are still in ST_SESSION (their EV_ON_CLOSE is only declared there), and
 *  the state changes after.
 ***************************************************************/
function ac_logout_done(gobj, event, kw, src)
{
    forget_nak_state(gobj);
    gobj_write_str_attr(gobj, "username", "");
    destroy_shell(gobj);
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_send_event(links, "EV_CLOSE_ALL", {}, gobj);
    }
    gobj_change_state(gobj, "ST_LOGGED_OUT");
    show_login_screen(gobj);
    return 0;
}

/***************************************************************
 *  Shell chrome — theme / language toggles.
 ***************************************************************/
function ac_toggle_theme(gobj, event, kw, src)
{
    toggle_theme();
    update_theme_icon(gobj);
    return 0;
}

/***************************************************************
 *  The language changed. refresh_language() re-translates every node that
 *  CARRIES its key (data-i18n / data-i18n-title / data-i18n-aria-label),
 *  but a view that composed a string with t() at build time — a card title,
 *  a row counter, a Tabulator header — holds no key and cannot be reached
 *  that way. So say it happened: the views that build DOM imperatively
 *  subscribe and re-render their own translated parts.
 ***************************************************************/
function ac_toggle_language(gobj, event, kw, src)
{
    switch_locale(current_locale() === "es" ? "en" : "es");
    refresh_language(document.body, t);
    gobj_publish_event(gobj, "EV_LANGUAGE_CHANGED", {locale: current_locale()});
    return 0;
}

function ac_open_devtools(gobj, event, kw, src)
{
    let win = gobj_find_service("Developer-Window", false);
    if(win) {
        if(gobj_is_running(win)) {
            gobj_stop_tree(win);
        }
        gobj_destroy(win);
        return 0;
    }
    setup_dev(gobj, true);
    return 0;
}

/***************************************************************
 *  EV_OPEN_ABOUT — the "About" entry in the account menu. Opens a
 *  product card (mark + version + deployment + doc link) as the
 *  standardized adaptive dialog (desktop X top-right / mobile back
 *  top-left). Self-contained: no view gclass, just a DOM node handed
 *  to the shell modal. Idempotent toggle.
 ***************************************************************/
function ac_open_about(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.about_modal) {                 /*  toggle: close  */
        priv.about_modal.close();
        return 0;
    }
    if(!priv.shell) {
        return 0;
    }

    let dep = deploy_info();

    let $content = createElement2(
        ["div", {class: "treedb-about", gclass: "C_TREEDB_APP", style: "max-width:560px;"},
            [
                ["div", {class: "box"},
                    [
                        ["div", {style: "display:flex; gap:1rem; align-items:center;"},
                            [
                                ["img", {
                                    src: "/treedb-mark.svg",
                                    alt: "TreeDB",
                                    width: "60",
                                    height: "60",
                                    style: "flex:0 0 auto;"
                                }],
                                ["div", {style: "flex:1 1 auto; min-width:0;"},
                                    [
                                        ["h2", {class: "title is-4", style: "margin-bottom:0.15rem;",
                                                i18n: "treedb console"}, "TreeDB Console"],
                                        ["p", {class: "subtitle is-6",
                                               style: "color:#5B6B7E; margin-bottom:0.6rem;"},
                                            `v${pkg.version || ""} · ${dep.tenant}`],
                                        ["p", {style: "color:#5B6B7E; margin-bottom:0.75rem;",
                                               i18n: "about description"},
                                            "Browse your TreeDB topics as tables and nodes as graphs " +
                                            "across every configured backend."],
                                        ["a", {
                                            class: "button is-link is-light is-small",
                                            href: "https://doc.yuneta.io",
                                            target: "_blank",
                                            rel: "noopener noreferrer"
                                        },
                                            [
                                                ["span", {class: "icon"}, [["span", {class: "yi-question"}]]],
                                                ["span", {i18n: "documentation"}, "Documentation"]
                                            ]
                                        ]
                                    ]
                                ]
                            ]
                        ]
                    ]
                ],
                ["p", {class: "is-size-7", style: "color:#9AA7B4; margin-top:0.5rem; text-align:right;"},
                    "© 2026 ArtGins"]
            ]
        ]
    );

    priv.about_modal = yui_shell_show_modal(priv.shell, $content, {
        dialog: true,
        logical_class: "TREEDB_ABOUT",
        title: "about",
        t: t,
        on_close: function() {
            priv.about_modal = null;
        }
    });
    return 0;
}

/***************************************************************
 *  A treedb was checked/unchecked in the picker → rebuild that
 *  workspace's tabs and navigate to (or away from) the tab.
 ***************************************************************/
function ac_selected_treedbs_changed(gobj, event, kw, src)
{
    let ws = (kw && kw.workspace) || "";
    if(!WORKSPACES[ws]) {
        return 0;
    }
    rebuild_workspace_tabs(gobj, ws);

    let shell = gobj.priv.shell;
    if(!shell) {
        return 0;
    }
    let config = gobj_find_service("treedb_config", false);
    let selected = config ? treedb_config_get_selected(config, ws) : [];
    let cur = gobj_read_attr(shell, "current_route") || "";

    /*  If the tab we're on was just deselected, move to a remaining tab
     *  (or the picker).  */
    let prefix = db_home_route(ws) + "/";
    if(cur.indexOf(prefix) === 0) {
        /*  The tab is keyed by the FIRST segment: a deeper subpath is the
         *  view's own topic/mode (/topics/db/<sel>/<topic>), not part of the
         *  selection id — without the split, a deep-linked topic never
         *  matched and every selection change navigated the user away.  */
        let id = decode_tail(cur.slice(prefix.length).split("/")[0]);
        if(!selected.some((s) => s && s.id === id)) {
            let first = selected.length ? db_tab_route(ws, selected[0].id) : picker_route(ws);
            yui_shell_navigate(shell, first);
        }
    }
    return 0;
}

/***************************************************************
 *  Connections list changed (added/removed) → open any new connection
 *  and rebuild tabs.
 ***************************************************************/
function ac_connections_changed(gobj, event, kw, src)
{
    sync_connections(gobj);
    rebuild_all_workspaces(gobj);
    return 0;
}

/***************************************************************
 *  A tab's ✕ → deselect that treedb in its workspace.
 ***************************************************************/
function ac_nav_item_close(gobj, event, kw, src)
{
    let item_id = (kw && kw.item_id) || "";
    if(item_id.indexOf("db-") !== 0) {
        return 0;
    }
    let sel_id_ = item_id.slice(3);
    let ws = ws_from_route((kw && kw.route) || "");
    if(!ws) {
        return 0;
    }
    let config = gobj_find_service("treedb_config", false);
    if(config) {
        gobj_send_event(config, "EV_REMOVE_SELECTED",
            {workspace: ws, id: sel_id_}, gobj);
    }
    return 0;
}

/***************************************************************
 *  Remember the active tab per workspace so a return / reload restores
 *  it.
 ***************************************************************/
function ac_route_changed(gobj, event, kw, src)
{
    let base = (kw && kw.base) || "";
    let ws = ws_from_route(base);
    if(!ws) {
        return 0;
    }
    /*  Remember the resolved base so restore_tab_from_url can tell an
     *  unbuilt-tab fallback (base === /<ws>/db, the picker is showing) from
     *  a real, resolved treedb tab (base === /<ws>/db/<sel>).  */
    gobj.priv.mounted_base = base;

    let prefix = db_home_route(ws) + "/";
    if(base.indexOf(prefix) === 0) {
        /*  A real, resolved treedb tab (base is /<ws>/db/<sel>) → remember it
         *  as this workspace's active tab, so switching away and back returns
         *  here.  */
        let sel_id_ = decode_tail(base.slice(prefix.length));
        if(sel_id_) {
            let config = gobj_find_service("treedb_config", false);
            if(config) {
                gobj_send_event(config, "EV_SET_ACTIVE_TAB",
                    {workspace: ws, id: sel_id_}, gobj);
            }
        }
        return 0;
    }

    if(base === db_home_route(ws)) {
        /*  Landed on the workspace home /<ws>/db. Two ways to get here:
         *    - F5 fallback: the hash is /<ws>/db/<sel>[/<topic>] but the tab
         *      is not built yet → base resolves to the ancestor with a
         *      subpath. Persist the sel; restore_tab_from_url jumps to it on
         *      the next EV_ON_OPEN. Do NOT redirect here (it would clobber the
         *      hash before restore can read it).
         *    - primary-nav: clicking the workspace's menu item lands on its
         *      default (/<ws>/db) with NO subpath → go to the last-active tab.  */
        let sub = decode_tail(((kw && kw.subpath) || "").split("/")[0]);
        if(sub) {
            let config = gobj_find_service("treedb_config", false);
            if(config) {
                gobj_send_event(config, "EV_SET_ACTIVE_TAB",
                    {workspace: ws, id: sub}, gobj);
            }
            return 0;
        }
        let target = workspace_first_route(gobj, ws);
        if(target && target !== base) {
            /*  Deferred so we don't re-enter navigate mid-publish. */
            setTimeout(function() {
                if(gobj.priv.shell) {
                    yui_shell_navigate(gobj.priv.shell, target);
                }
            }, 0);
        }
        return 0;
    }
    return 0;
}

function decode_tail(s)
{
    try {
        return decodeURIComponent(s);
    } catch(e) {
        return s;
    }
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

    /*
     *  The app has two lives, and they were both crammed into one ST_IDLE
     *  with the session kept in `priv.shell`: ac_login_denied asked
     *  `if(priv.shell)` to tell "the password is wrong" from "your session
     *  died while you were working". They are STATES.
     *
     *  ST_LOGGED_OUT — no session: the login screen. The only events that can
     *                  legitimately land are the login service's answers.
     *  ST_SESSION    — a session: the shell is up, the transports are open.
     *                  The chrome, the routing, the workspace tabs and the
     *                  connection events live HERE, so any of them arriving
     *                  with no session fails LOUDLY and names its sender
     *                  instead of running against a shell that is not there.
     */
    const states = [
        ["ST_LOGGED_OUT", [
            ["EV_LOGIN_ACCEPTED",   ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",     ac_login_denied,    null],
            ["EV_RESTORE_FAILED",   ac_restore_failed,  null]
        ]],
        ["ST_SESSION", [
            ["EV_LOGIN_REFRESHED",  ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",   ac_refresh_failed,  null],
            /*  the BFF said no to a session that WAS alive  */
            ["EV_LOGIN_DENIED",     ac_session_expired, null],
            ["EV_LOGOUT",           ac_logout,          null],
            ["EV_LOGOUT_DONE",      ac_logout_done,     null],
            /*  connections  */
            ["EV_ON_OPEN",          ac_on_open,         null],
            ["EV_ON_CLOSE",         ac_on_close,        null],
            ["EV_ON_ID_NAK",        ac_on_id_nak,       null],
            /*  shell chrome  */
            ["EV_TOGGLE_THEME",     ac_toggle_theme,    null],
            ["EV_TOGGLE_LANGUAGE",  ac_toggle_language, null],
            ["EV_OPEN_DEVTOOLS",    ac_open_devtools,   null],
            ["EV_OPEN_ABOUT",       ac_open_about,      null],
            /*  workspace tabs  */
            ["EV_SELECTED_TREEDBS_CHANGED", ac_selected_treedbs_changed, null],
            ["EV_CONNECTIONS_CHANGED",      ac_connections_changed,      null],
            ["EV_NAV_ITEM_CLOSE",   ac_nav_item_close,  null],
            ["EV_ROUTE_CHANGED",    ac_route_changed,   null]
        ]]
    ];

    const event_types = [
        ["EV_LOGIN_ACCEPTED",   0],
        ["EV_LOGIN_REFRESHED",  0],
        ["EV_REFRESH_FAILED",   0],
        ["EV_LOGIN_DENIED",     0],
        ["EV_RESTORE_FAILED",   0],
        ["EV_LOGOUT_DONE",      0],
        ["EV_ON_OPEN",          0],
        ["EV_ON_CLOSE",         0],
        ["EV_ON_ID_NAK",        0],
        ["EV_LOGOUT",           0],
        ["EV_TOGGLE_THEME",     0],
        ["EV_TOGGLE_LANGUAGE",  0],
        ["EV_OPEN_DEVTOOLS",    0],
        ["EV_OPEN_ABOUT",       0],
        ["EV_SELECTED_TREEDBS_CHANGED", 0],
        ["EV_CONNECTIONS_CHANGED",      0],
        ["EV_NAV_ITEM_CLOSE",   0],
        ["EV_ROUTE_CHANGED",    0],
        /*  output: the views that build DOM with t() re-render on it  */
        ["EV_LANGUAGE_CHANGED", event_flag_t.EVF_OUTPUT_EVENT|event_flag_t.EVF_NO_WARN_SUBS]
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

function register_c_app()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_app};
