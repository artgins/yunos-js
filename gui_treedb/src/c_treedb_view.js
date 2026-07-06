/***********************************************************************
 *          c_treedb_view.js
 *
 *      C_TREEDB_VIEW — a thin adapter the shell mounts in a workspace tab.
 *
 *      WHY IT EXISTS: the TreeDB editor gclasses (C_YUI_TREEDB_TOPICS /
 *      C_YUI_TREEDB_GRAPH) issue their backend requests with
 *      `gobj_command(gobj_remote_yuno, "descs"/"nodes"/…, kw, src=self)`.
 *      The C_IEVENT_CLI routes the answer back by looking the requester up
 *      with `gobj_find_service(gobj_name(src))` — which only finds
 *      REGISTERED SERVICES (__jn_services__). The declarative shell mounts
 *      views with `gobj_create` (a pure child, NOT a service), so a treedb
 *      view mounted directly would never receive its command answers and
 *      would show nothing.
 *
 *      This wrapper is the pure child the shell creates; in mt_create it
 *      instantiates the REAL treedb view as a NAMED SERVICE
 *      (gobj_create_service) and re-exposes that view's `$container` as its
 *      own, so the shell mounts the same DOM while the view is findable for
 *      answer routing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_create_service,
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running,
} from "@yuneta/gobj-js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_VIEW";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",       0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "view_gclass",      0,  "",    "Treedb view gclass to host (C_YUI_TREEDB_TOPICS | C_YUI_TREEDB_GRAPH)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name",      0,  "",    "TreeDB to browse"),
SDATA(data_type_t.DTP_STRING,   "workspace",        0,  "",    "Owning workspace (for a unique service name)"),
SDATA(data_type_t.DTP_STRING,   "conn_id",          0,  "",    "Connection id (for a unique service name)"),
SDATA(data_type_t.DTP_POINTER,  "gobj_remote_yuno", 0,  null,  "Live C_IEVENT_CLI transport of the connection"),
SDATA(data_type_t.DTP_BOOLEAN,  "system",           0,  false, "System treedb view"),
SDATA(data_type_t.DTP_STRING,   "title",            0,  "",    "Tab title"),
SDATA(data_type_t.DTP_POINTER,  "$container",       0,  null,  "Root HTML element (mounted by the shell)"),
SDATA_END()
];

let PRIVATE_DATA = {
    view: null,   /*  the hosted treedb view (a service)  */
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

    let view_gclass = gobj_read_attr(gobj, "view_gclass");
    let treedb_name = gobj_read_attr(gobj, "treedb_name");
    let remote      = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");

    if(!view_gclass || !remote) {
        log_error(`${GCLASS_NAME}: missing view_gclass or gobj_remote_yuno`);
        return;
    }

    /*
     *  Create the real treedb view as a NAMED SERVICE so C_IEVENT_CLI can
     *  route its command answers back (gobj_find_service). The name is
     *  unique per (workspace, connection, treedb) and lower-case (service
     *  names are looked up lower-cased).
     */
    let name = service_name(gobj);
    let view = gobj_create_service(
        name,
        view_gclass,
        {
            gobj_remote_yuno: remote,
            treedb_name:      treedb_name,
            system:           gobj_read_attr(gobj, "system")
        },
        gobj
    );
    priv.view = view;

    /*  The treedb view builds its own $container in ITS mt_create (the
     *  shell contract), so it is available now; re-expose it as ours.  */
    let $c = gobj_read_attr(view, "$container");
    if(!$c) {
        log_error(`${GCLASS_NAME}: hosted view '${view_gclass}' did not expose $container`);
        return;
    }
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;
    if(priv.view && !gobj_is_running(priv.view)) {
        gobj_start(priv.view);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    if(priv.view && gobj_is_running(priv.view)) {
        gobj_stop(priv.view);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;
    if(priv.view) {
        gobj_destroy(priv.view);
        priv.view = null;
    }
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  A unique, lower-case service name for the hosted view.
 ***************************************************************/
function service_name(gobj)
{
    let ws      = gobj_read_attr(gobj, "workspace")   || "ws";
    let conn_id = gobj_read_attr(gobj, "conn_id")     || "conn";
    let treedb  = gobj_read_attr(gobj, "treedb_name") || "db";
    let raw = `tv_${ws}_${conn_id}_${treedb}`;
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
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

    const states = [
        ["ST_IDLE", []]
    ];

    const event_types = [];

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

function register_c_treedb_view()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_view};
