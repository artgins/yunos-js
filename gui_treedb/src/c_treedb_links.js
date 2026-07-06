/***********************************************************************
 *          c_treedb_links.js
 *
 *      C_TREEDB_LINKS — owns ONE C_IEVENT_CLI per configured backend
 *      connection (named service "treedb_links").
 *
 *      Unlike gui_agent's single-link model (one control center), the
 *      TreeDB browser opens a direct WebSocket to each backend the user
 *      configured, on OTHER hosts. Each transport carries the forwarded
 *      access_token in its identity_card `jwt` (the BFF cookie cannot
 *      travel cross-origin — see c_login.js / YUNO_AUTH.md §2.2).
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
    gobj_yuno,
    gobj_create,
    gobj_name,
    gobj_write_str_attr,
    gobj_start_tree, gobj_stop_tree, gobj_destroy,
    gobj_is_running,
    gobj_current_state,
} from "@yuneta/gobj-js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_LINKS";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events (the app root)"),
SDATA_END()
];

let PRIVATE_DATA = {
    conns:   null,  /*  conn_id  -> { iev, name }      */
    by_name: null,  /*  iev name -> conn_id            */
    token:   "",    /*  forwarded access_token (jwt)   */
    seq:     0,     /*  monotonic iev-name counter     */
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
        jwt:                 priv.token
    }, gobj_yuno());

    /*
     *  Subscribe ONLY to the connection-level events (not null/all): the
     *  treedb views subscribe to this same iev for their own answers /
     *  EV_TREEDB_NODE_* events, so this service must not also receive
     *  events it does not declare ("event NOT defined in state").
     */
    gobj_subscribe_event(iev, "EV_ON_OPEN",   {}, gobj);
    gobj_subscribe_event(iev, "EV_ON_CLOSE",  {}, gobj);
    gobj_subscribe_event(iev, "EV_ON_ID_NAK", {}, gobj);

    priv.conns[conn.id] = {iev: iev, name: name};
    priv.by_name[name] = conn.id;

    gobj_start_tree(iev);
    return iev;
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
 *  The services_roles of a connection (captured on its last EV_ON_OPEN),
 *  {} when unknown. This is how the picker discovers which treedbs a
 *  backend exposes to the user: {treedb_name: [roles]}.
 ***************************************************************/
function treedb_links_get_services_roles(gobj, conn_id)
{
    let priv = gobj.priv;
    let e = priv.conns[conn_id];
    return (e && e.services_roles) ? e.services_roles : {};
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
 *  Tear down one connection's transport.
 ***************************************************************/
function treedb_links_close(gobj, conn_id)
{
    let priv = gobj.priv;
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
    /*  Capture the identity ack's services_roles for the picker.  */
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    if(conn_id && priv.conns[conn_id]) {
        priv.conns[conn_id].services_roles = (kw && kw.services_roles) || {};
    }
    return republish(gobj, src, "EV_ON_OPEN", kw);
}

function ac_on_close(gobj, event, kw, src)
{
    /*  Clear the cached services_roles: the connection is down.  */
    let priv = gobj.priv;
    let conn_id = priv.by_name[gobj_name(src)] || "";
    if(conn_id && priv.conns[conn_id]) {
        priv.conns[conn_id].services_roles = {};
    }
    return republish(gobj, src, "EV_ON_CLOSE", kw);
}

function ac_on_id_nak(gobj, event, kw, src)
{
    return republish(gobj, src, "EV_ON_ID_NAK", kw);
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
            ["EV_ON_OPEN",   ac_on_open,   null],
            ["EV_ON_CLOSE",  ac_on_close,  null],
            ["EV_ON_ID_NAK", ac_on_id_nak, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *  Re-published to the app root (optional subscriber).
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_ON_OPEN",   out],
        ["EV_ON_CLOSE",  out],
        ["EV_ON_ID_NAK", out]
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
    treedb_links_get_iev,
    treedb_links_get_services_roles,
    treedb_links_is_connected,
    treedb_links_close,
    treedb_links_close_all,
    treedb_links_reopen,
};
