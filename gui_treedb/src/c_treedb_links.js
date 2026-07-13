/***********************************************************************
 *          c_treedb_links.js
 *
 *      C_TREEDB_LINKS — owns ONE C_IEVENT_CLI per configured backend
 *      connection (named service "treedb_links").
 *
 *      Unlike gui_agent's single-link model (one control center), the
 *      TreeDB browser opens a direct WebSocket to each backend the user
 *      configured, on OTHER hosts. Each connection is the C_IEVENT_CLI
 *      entry to ONE yuno (public wss url + remote role + service). Each
 *      transport carries the forwarded access_token in its identity_card
 *      `jwt` (the BFF cookie cannot travel cross-origin — see c_login.js /
 *      YUNO_AUTH.md §2.2).
 *
 *      Responsibilities:
 *        - lifecycle of the per-connection C_IEVENT_CLIs (create/start/
 *          stop/destroy), keyed by connection id;
 *        - hand the live transport to the treedb views as their
 *          `gobj_remote_yuno` (they talk to it directly: gobj_command +
 *          EV_TREEDB_NODE_* subscriptions);
 *        - re-publish the CONNECTION-level events (EV_ON_OPEN / EV_ON_CLOSE
 *          / EV_ON_ID_NAK) to its subscriber (the app root), tagged with
 *          `conn_id`, so the app can drive the picker + token recovery;
 *        - discover the connected yuno's C_NODE / C_TRANGER services
 *          (`services` command): automatically on the first EV_ON_OPEN of a
 *          connection with no stored services, on demand from the Settings
 *          refresh button. The WHOLE found list is persisted in the
 *          connection's `services` (C_TREEDB_CONFIG), preserving the
 *          user's `selected` flags;
 *        - keep every live transport's `jwt` fresh so a reconnect after a
 *          token refresh re-sends a valid identity_card.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error,
    gobj_read_pointer_attr,
    gobj_subscribe_event,
    gobj_publish_event,
    gobj_find_service,
    gobj_send_event,
    gobj_yuno,
    gobj_create,
    gobj_name, gobj_short_name,
    gobj_write_str_attr,
    gobj_start_tree, gobj_stop_tree, gobj_destroy,
    gobj_is_running,
    gobj_current_state,
    gobj_command,
} from "@yuneta/gobj-js";

import {
    treedb_config_conn_services,
    treedb_config_get_connection,
} from "./c_treedb_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_LINKS";

/*  A scan that gets no full answer set gives up after this.  */
const SCAN_TIMEOUT_MS = 15000;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events (the app root)"),
SDATA_END()
];

let PRIVATE_DATA = {
    conns:       null,  /*  conn_id  -> { iev, name, role }  */
    by_name:     null,  /*  iev name -> conn_id            */
    open_errors: null,  /*  conn_id  -> { url, reason }  (last connect failure)  */
    scans:       null,  /*  conn_id  -> in-flight node scan state  */
    token:       "",    /*  forwarded access_token (jwt)   */
    seq:         0,     /*  monotonic iev-name counter     */
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
    priv.conns = {};
    priv.by_name = {};
    priv.open_errors = {};
    priv.scans = {};
    priv.token = "";
    priv.seq = 0;

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
    treedb_links_close_all(gobj);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    treedb_links_close_all(gobj);
}




                    /***************************
                     *      Public functions
                     ***************************/




/***************************************************************
 *  Store the forwarded access_token and push it onto every live
 *  transport's `jwt` attr, so the next reconnect re-sends a valid
 *  identity_card. C_IEVENT_CLI reads `jwt` at identity-card send time,
 *  so updating the attr is enough — no need to recreate a connected iev.
 ***************************************************************/
function treedb_links_set_token(gobj, token)
{
    let priv = gobj.priv;
    priv.token = token || "";
    for(let conn_id in priv.conns) {
        let iev = priv.conns[conn_id].iev;
        if(iev) {
            gobj_write_str_attr(iev, "jwt", priv.token);
        }
    }
}

/***************************************************************
 *  Ensure a transport exists (and is started) for a connection.
 *  conn = {id, url, remote_yuno_role, remote_yuno_service}.
 *  Returns the transport gobj, or null on bad input.
 ***************************************************************/
function treedb_links_ensure(gobj, conn)
{
    let priv = gobj.priv;
    if(!conn || !conn.id || !conn.url) {
        return null;
    }
    let existing = priv.conns[conn.id];
    if(existing && existing.iev) {
        return existing.iev;
    }

    let name = "iev-" + (++priv.seq);
    let iev = gobj_create(name, "C_IEVENT_CLI", {
        url:                 conn.url,
        remote_yuno_role:    conn.remote_yuno_role || "",
        remote_yuno_service: conn.remote_yuno_service || "",
        remote_yuno_name:    "",
        jwt:                 priv.token,
        /*
         *  THIS backend's services, not the union of every configured one. The
         *  identity_card falls back to the yuno's `required_services` when this
         *  is empty — and that list is necessarily the union, so each backend
         *  was told the service names of all the others and got a card naming
         *  services it does not host. conn_coords includes the selection, so
         *  changing it recreates the transport and the card is re-sent.
         */
        required_services:   treedb_config_conn_services(conn)
                                 .filter((s) => s.selected)
                                 .map((s) => s.service),
        /*
         *  The `subscriber` attr makes the iev deliver its LOCAL published
         *  events (EV_ON_OPEN/CLOSE/ID_NAK/OPEN_ERROR) to us via a null (all)
         *  subscription, which stays LOCAL. Subscribing to SPECIFIC events on
         *  a C_IEVENT_CLI instead is treated as a REMOTE subscription and is
         *  forwarded to the backend as __subscribing__ (which logs
         *  "SUBSCRIBING event ignored"). The treedb views subscribe to this
         *  iev separately for their own answers / EV_TREEDB_NODE_* events.
         */
        subscriber:          gobj
    }, gobj_yuno());

    priv.conns[conn.id] = {
        iev: iev,
        name: name,
        coords: conn_coords(conn),
        role: conn.remote_yuno_role || ""
    };
    priv.by_name[name] = conn.id;

    gobj_start_tree(iev);
    return iev;
}

/***************************************************************
 *  The connection coordinates that, when changed, require recreating
 *  the transport (C_IEVENT_CLI bakes them at mt_create). Label is NOT
 *  here — it is display only.
 ***************************************************************/
function conn_coords(conn)
{
    /*  The SELECTED services are included so (de)selecting one reopens
     *  the connection: they feed the yuno's required_services, which is
     *  baked into the identity_card the backend uses to authorize
     *  per-service command access. The rest of the discovered list is
     *  informative only — a refresh that preserves the selection must
     *  NOT bounce the transport.  */
    let selected = treedb_config_conn_services(conn)
        .filter((s) => s.selected)
        .map((s) => s.service)
        .sort()
        .join(",");
    return (conn.url || "") + "|" + (conn.remote_yuno_role || "")
        + "|" + (conn.remote_yuno_service || "")
        + "|" + selected;
}

/***************************************************************
 *  Reconcile the live transports with the configured connections:
 *  open ENABLED ones (create missing, recreate those whose coordinates
 *  changed) and close the disabled / removed ones. Unchanged enabled
 *  connections keep their live session (open tabs undisturbed).
 *  `enabled` is the user's connect intent (the Settings button) — a
 *  configured-but-disabled connection never opens a transport, so
 *  editing a row never auto-connects.
 ***************************************************************/
function treedb_links_sync(gobj, connections)
{
    let priv = gobj.priv;
    let wanted = {};
    for(let conn of (connections || [])) {
        if(!conn || !conn.id || !conn.url || !conn.enabled) {
            continue;
        }
        wanted[conn.id] = true;
        let e = priv.conns[conn.id];
        if(!e) {
            treedb_links_ensure(gobj, conn);
        } else if(e.coords !== conn_coords(conn)) {
            treedb_links_reopen(gobj, conn);
        }
    }
    for(let id of Object.keys(priv.conns)) {
        if(!wanted[id]) {
            treedb_links_close(gobj, id);
        }
    }
}

/***************************************************************
 *  The live transport for a connection, or null.
 ***************************************************************/
function treedb_links_get_iev(gobj, conn_id)
{
    let priv = gobj.priv;
    let e = priv.conns[conn_id];
    return (e && e.iev) ? e.iev : null;
}

/***************************************************************
 *  The last connect failure for a connection, or null. {url, reason, code}.
 *  Set on EV_ON_OPEN_ERROR, cleared on EV_ON_OPEN.
 ***************************************************************/
function treedb_links_get_open_error(gobj, conn_id)
{
    return gobj.priv.open_errors[conn_id] || null;
}

/***************************************************************
 *  The backend REJECTED this connection's identity and a fresh token did
 *  not fix it (no role for its services, or the BFF is not exposing the
 *  access_token at all): close the transport — retrying only feeds the
 *  refresh→reopen→NAK loop — and keep the cause STICKY in open_errors.
 *
 *  Sticky because a rejection is not a connect failure that heals itself:
 *  nothing will clear it until the connection is reconnected on purpose
 *  (EV_ON_OPEN clears it) or its coordinates change. Before this, the
 *  give-up path closed the transport in silence and the picker sat on
 *  "Connecting…" forever for a connection nobody was even retrying.
 ***************************************************************/
function treedb_links_reject(gobj, conn_id, reason)
{
    let priv = gobj.priv;
    let e = priv.conns[conn_id];
    let url = e ? String(e.coords || "").split("|")[0] : "";

    treedb_links_close(gobj, conn_id);      /*  drops open_errors[conn_id]  */

    priv.open_errors[conn_id] = {
        url:      url,
        reason:   reason || "",
        code:     0,
        rejected: true
    };
}

/***************************************************************
 *  True while a connection is in session.
 ***************************************************************/
function treedb_links_is_connected(gobj, conn_id)
{
    let iev = treedb_links_get_iev(gobj, conn_id);
    return !!(iev && gobj_current_state(iev) === "ST_SESSION");
}

/***************************************************************
 *  Discover the C_NODE / C_TRANGER services of the yuno behind a
 *  connection: ONE `services` command to its C_YUNO
 *  (service=__yuno__). The wss API gives no view beyond the connected
 *  yuno (there is no cross-yuno listing), so the scan is exactly that
 *  yuno's own services. On success the WHOLE found list is persisted
 *  in the connection's `services` (preserving `selected` flags) and
 *  the result is published as EV_TREEDB_SCAN_DONE {conn_id, services,
 *  errors}; a scan that cannot start (or times out) ends in the same
 *  event with the failure in `errors` (EV_TREEDB_SCAN_ERROR when it
 *  cannot even start).
 *
 *  Runs automatically on the first EV_ON_OPEN of a connection with no
 *  stored services; the Settings refresh button re-runs it.
 *
 *  This service is the requester (not the Settings view) because command
 *  answers are routed back by service name and the shell mounts views as
 *  pure children.
 ***************************************************************/
function treedb_links_scan(gobj, conn_id)
{
    let priv = gobj.priv;
    let e = priv.conns[conn_id];
    let iev = (e && e.iev) ? e.iev : null;
    if(!iev || gobj_current_state(iev) !== "ST_SESSION") {
        gobj_publish_event(gobj, "EV_TREEDB_SCAN_ERROR",
            {conn_id: conn_id, error: "backend not connected"});
        return -1;
    }
    if(priv.scans[conn_id]) {
        return 0;   /*  scan already in progress  */
    }
    priv.scans[conn_id] = {
        services: null,   /*  found list; null = no successful answer yet  */
        errors:   [],
        timer:    setTimeout(function() {
            finish_scan(gobj, conn_id, "scan timeout");
        }, SCAN_TIMEOUT_MS)
    };

    gobj_command(iev, "services", {service: "__yuno__"}, gobj);
    return 0;
}

/***************************************************************
 *  True while a connection's scan is in flight.
 ***************************************************************/
function treedb_links_is_scanning(gobj, conn_id)
{
    return !!gobj.priv.scans[conn_id];
}

/***************************************************************
 *  Close a scan: persist the found list (only on a successful answer
 *  — a failure must not wipe the stored services) and publish the
 *  result.
 ***************************************************************/
function finish_scan(gobj, conn_id, error)
{
    let priv = gobj.priv;
    let scan = priv.scans[conn_id];
    if(!scan) {
        return;
    }
    delete priv.scans[conn_id];
    if(scan.timer) {
        clearTimeout(scan.timer);
        scan.timer = null;
    }
    if(error) {
        scan.errors.push({yuno: "", error: error});
    }

    /*  The scan report only reaches the UI through Settings, which is a
     *  lazy_destroy view: a discovery that failed while the user was in the
     *  picker used to vanish without a trace — the picker just said "no
     *  services selected". The log is the one place that always sees it.  */
    for(let err of scan.errors) {
        log_error(`${gobj_short_name(gobj)}: discovery of '${conn_id}' failed: ` +
                  `${err.error}`);
    }

    if(scan.services === null) {
        /*  Failure / close: nothing to store — report immediately.  */
        gobj_publish_event(gobj, "EV_TREEDB_SCAN_DONE", {
            conn_id:  conn_id,
            services: [],
            errors:   scan.errors
        });
        return;
    }

    /*
     *  Success: store + report DEFERRED. We are inside the transport's
     *  command-answer dispatch, and storing publishes
     *  EV_CONNECTIONS_CHANGED, whose sync path may REOPEN this very
     *  transport (a refresh that dropped a selected service changes the
     *  connection coords) — destroying the publisher inside its own
     *  dispatch is forbidden. The is_running guard only skips the
     *  teardown race (service stopping while the timer is pending).
     */
    setTimeout(function() {
        if(!gobj_is_running(gobj)) {
            return;
        }
        let config = gobj_find_service("treedb_config", false);
        if(config) {
            gobj_send_event(config, "EV_STORE_SCANNED_SERVICES",
                {conn_id: conn_id, services: scan.services}, gobj);
        }
        gobj_publish_event(gobj, "EV_TREEDB_SCAN_DONE", {
            conn_id:  conn_id,
            services: scan.services,
            errors:   scan.errors
        });
    }, 0);
}

/***************************************************************
 *  Tear down one connection's transport.
 ***************************************************************/
function treedb_links_close(gobj, conn_id)
{
    let priv = gobj.priv;
    delete priv.open_errors[conn_id];
    if(priv.scans[conn_id]) {
        finish_scan(gobj, conn_id, "connection closed");
    }
    let e = priv.conns[conn_id];
    if(!e) {
        return;
    }
    delete priv.conns[conn_id];
    delete priv.by_name[e.name];
    if(e.iev) {
        if(gobj_is_running(e.iev)) {
            gobj_stop_tree(e.iev);
        }
        gobj_destroy(e.iev);
    }
}

/***************************************************************
 *  Tear down every connection.
 ***************************************************************/
function treedb_links_close_all(gobj)
{
    let priv = gobj.priv;
    if(!priv.conns) {
        return;
    }
    for(let conn_id of Object.keys(priv.conns)) {
        treedb_links_close(gobj, conn_id);
    }
}

/***************************************************************
 *  Recreate a connection's transport (e.g. after a token refresh
 *  triggered by a NAK). Recreating — vs reconfiguring — is required
 *  because C_IEVENT_CLI bakes wanted_yuno_* at mt_create.
 ***************************************************************/
function treedb_links_reopen(gobj, conn)
{
    treedb_links_close(gobj, conn && conn.id);
    return treedb_links_ensure(gobj, conn);
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Re-publish a transport event to the app root, tagged with the
 *  originating connection id (resolved from the transport's name).
 ***************************************************************/
function republish(gobj, src, event, kw)
{
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    let out = Object.assign({}, kw || {});
    out.conn_id = conn_id;
    gobj_publish_event(gobj, event, out);
    return 0;
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_on_open(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    /*  Connected → clear any prior connect-failure state. */
    if(conn_id) {
        delete priv.open_errors[conn_id];
    }
    let ret = republish(gobj, src, "EV_ON_OPEN", kw);

    /*  First session of a never-scanned connection → discover its
     *  services automatically (the Settings refresh re-runs it later).  */
    if(conn_id) {
        let config = gobj_find_service("treedb_config", false);
        let conn = config ? treedb_config_get_connection(config, conn_id) : null;
        if(conn && !treedb_config_conn_services(conn).length) {
            treedb_links_scan(gobj, conn_id);
        }
    }
    return ret;
}

function ac_on_close(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    if(conn_id && priv.scans[conn_id]) {
        finish_scan(gobj, conn_id, "connection closed");
    }
    return republish(gobj, src, "EV_ON_CLOSE", kw);
}

/***************************************************************
 *  Answer to the scan's `services` command (we only send commands
 *  while scanning, so any answer routed to this service belongs to a
 *  scan).
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    let scan = conn_id ? priv.scans[conn_id] : null;

    if(!scan) {
        /*  Late answer of a finished/timed-out scan.  */
        return 0;
    }

    let result = (kw && kw.result !== undefined) ? kw.result : -1;
    let comment = (kw && kw.comment) || "";
    let data = kw ? kw.data : null;

    let e = priv.conns[conn_id];
    let yuno = (e && e.role) || "";

    if(result < 0) {
        scan.errors.push({
            yuno:  yuno,
            error: String(comment || "services failed")
        });
    } else if(!Array.isArray(data)) {
        /*  `result >= 0` with an answer that is not a list is a FAILURE, not
         *  an empty yuno: taking it as `[]` walked into finish_scan's success
         *  branch and REPLACED the connection's stored services with nothing —
         *  the very thing that branch exists to prevent. Leave scan.services
         *  null (= no successful answer) and report.  */
        log_error(`${gobj_short_name(gobj)}: 'services' answered a ` +
                  `${typeof data}, expected a list (yuno '${yuno}')`);
        scan.errors.push({
            yuno:  yuno,
            error: "bad services answer"
        });
    } else {
        scan.services = data
            .filter((r) => r && (r.gclass === "C_NODE" || r.gclass === "C_TRANGER"))
            .map((r) => ({service: r.service, gclass: r.gclass}));
    }
    finish_scan(gobj, conn_id, null);
    return 0;
}

function ac_on_id_nak(gobj, event, kw, src)
{
    return republish(gobj, src, "EV_ON_ID_NAK", kw);
}

/***************************************************************
 *  The iev could not open (bad URL / cert / port / backend down).
 *  C_IEVENT_CLI keeps retrying forever by design, so without surfacing this
 *  the picker would show "connecting" indefinitely. Record the failure per
 *  connection and re-publish it (tagged with conn_id) so the picker can show
 *  the cause. (The transport keeps retrying — a fixed backend recovers on its
 *  own and clears the error via EV_ON_OPEN.)
 ***************************************************************/
function ac_on_open_error(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    if(conn_id) {
        priv.open_errors[conn_id] = {
            url:    (kw && kw.url) || "",
            reason: (kw && kw.reason) || "",
            code:   (kw && kw.code) || 0
        };
    }
    return republish(gobj, src, "EV_ON_OPEN_ERROR", kw);
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
            ["EV_ON_OPEN",            ac_on_open,            null],
            ["EV_ON_CLOSE",           ac_on_close,           null],
            ["EV_ON_ID_NAK",          ac_on_id_nak,          null],
            ["EV_ON_OPEN_ERROR",      ac_on_open_error,      null],
            ["EV_MT_COMMAND_ANSWER",  ac_mt_command_answer,  null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *  Re-published to the app root (optional subscriber).
     *  EV_MT_COMMAND_ANSWER must be PUBLIC: C_IEVENT_CLI routes command
     *  answers back to this service by name and checks that flag.
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_ON_OPEN",            out],
        ["EV_ON_CLOSE",           out],
        ["EV_ON_ID_NAK",          out],
        ["EV_ON_OPEN_ERROR",      out],
        ["EV_TREEDB_SCAN_DONE",   out],
        ["EV_TREEDB_SCAN_ERROR",  out],
        ["EV_MT_COMMAND_ANSWER",  event_flag_t.EVF_PUBLIC_EVENT]
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
function register_c_treedb_links()
{
    return create_gclass(GCLASS_NAME);
}

export {
    register_c_treedb_links,
    treedb_links_set_token,
    treedb_links_ensure,
    treedb_links_sync,
    treedb_links_get_iev,
    treedb_links_get_open_error,
    treedb_links_reject,
    treedb_links_is_connected,
    treedb_links_scan,
    treedb_links_is_scanning,
    treedb_links_close,
    treedb_links_close_all,
    treedb_links_reopen,
};
