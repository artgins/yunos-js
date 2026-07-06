/***********************************************************************
 *          c_treedb_view.js
 *
 *      C_TREEDB_VIEW — a thin adapter the shell mounts in a workspace tab
 *      (wattyzer's C_WZ_TREEDB model, adapted for multi-connection).
 *
 *      WHY IT EXISTS: the TreeDB editor gclasses (C_YUI_TREEDB_TOPICS /
 *      C_YUI_TREEDB_GRAPH) issue their backend requests with
 *      `gobj_command(gobj_remote_yuno, "descs"/"nodes"/…, kw, src=self)`.
 *      C_IEVENT_CLI routes the answer back with
 *      `gobj_find_service(gobj_name(src))` — which only finds REGISTERED
 *      SERVICES. The declarative shell mounts views with `gobj_create` (a
 *      pure child, NOT a service), so a treedb view mounted directly would
 *      never receive its command answers and would show nothing.
 *
 *      This wrapper is the pure child the shell creates; in mt_create it
 *      instantiates the REAL treedb view as a NAMED SERVICE and re-exposes
 *      its `$container`. The live transport is NOT passed in kw (a live
 *      pointer does not survive the shell's kw path); instead the wrapper
 *      resolves it from C_TREEDB_LINKS by `conn_id` (a plain string), the
 *      same way wattyzer's C_WZ_TREEDB resolves `__remote_service__`.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_write_attr,
    gobj_create_service,
    gobj_find_service,
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running,
    createElement2,
} from "@yuneta/gobj-js";

import {treedb_links_get_iev} from "./c_treedb_links.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_VIEW";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "view_gclass", 0,  "",    "Treedb view gclass to host (C_YUI_TREEDB_TOPICS | C_YUI_TREEDB_GRAPH)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  "",    "TreeDB to browse"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "",    "Owning workspace (for a unique service name)"),
SDATA(data_type_t.DTP_STRING,   "conn_id",     0,  "",    "Connection id (resolves the live transport)"),
SDATA(data_type_t.DTP_BOOLEAN,  "system",      0,  false, "System treedb view"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Tab title"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTML element (mounted by the shell)"),
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
    let conn_id     = gobj_read_attr(gobj, "conn_id");

    /*
     *  Resolve the live transport by connection id — a pointer cannot be
     *  passed reliably through the shell's kw path.
     */
    let links = gobj_find_service("treedb_links", false);
    let remote = links ? treedb_links_get_iev(links, conn_id) : null;

    if(!view_gclass || !remote) {
        log_error(`${GCLASS_NAME}: no live transport for conn_id '${conn_id}'`);
        gobj_write_attr(gobj, "$container", createElement2(
            ["div", {class: "p-4 has-text-grey", i18n: "backend not connected"},
                "Backend not connected."]
        ));
        return;
    }

    /*
     *  Create the real treedb view as a NAMED SERVICE so C_IEVENT_CLI can
     *  route its command answers / EV_TREEDB_NODE_* back (gobj_find_service).
     *  Unique, lower-case name per (workspace, connection, treedb).
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

    /*  The treedb view builds its own $container in ITS mt_create; expose
     *  it as ours so the shell mounts/toggles the same DOM.  */
    let $c = gobj_read_attr(view, "$container");
    if(!$c) {
        log_error(`${GCLASS_NAME}: hosted view '${view_gclass}' did not expose $container`);
        $c = createElement2(["div", {}, ""]);
    }
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 *
 *  Start the hosted view here so its data fetch (descs) runs when the
 *  shell shows the tab (the shell sends no EV_SHOW).
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
                     *      Actions
                     ***************************/




/***************************************************************
 *  The hosted view uses the CHILD subscription model, so it publishes
 *  its events to us (its parent). We don't bridge them to the URL yet;
 *  accept them as no-ops so they don't trip "event NOT defined in state".
 ***************************************************************/
function ac_noop(gobj, event, kw, src)
{
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

    const states = [
        ["ST_IDLE", [
            ["EV_TOPIC_SELECTED",         ac_noop, null],
            ["EV_OPERATION_MODE_CHANGED", ac_noop, null]
        ]]
    ];

    const event_types = [
        ["EV_TOPIC_SELECTED",         0],
        ["EV_OPERATION_MODE_CHANGED", 0]
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

function register_c_treedb_view()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_view};
