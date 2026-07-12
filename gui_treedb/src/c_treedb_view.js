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
    gobj_parent, gobj_name,
    gobj_subscribe_event, gobj_unsubscribe_event, gobj_send_event,
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running, gobj_is_destroying,
    createElement2,
} from "@yuneta/gobj-js";

import {yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";

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
SDATA(data_type_t.DTP_STRING,   "view_gclass", 0,  "",    "View gclass to host (C_YUI_TREEDB_TOPICS | C_YUI_TREEDB_GRAPH | C_TRANGER_VIEW)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  "",    "Remote service to browse (treedb/tranger service name)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "",    "Owning workspace (for a unique service name)"),
SDATA(data_type_t.DTP_STRING,   "conn_id",     0,  "",    "Connection id (resolves the live transport)"),
SDATA(data_type_t.DTP_BOOLEAN,  "system",      0,  false, "System treedb view"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Tab title"),
SDATA(data_type_t.DTP_STRING,   "base_route",  0,  "",    "This view's declared tab route (for the topic/mode deep link)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTML element (mounted by the shell)"),
SDATA_END()
];

let PRIVATE_DATA = {
    view:         null,   /*  the hosted treedb view (a service)  */
    sel_event:    null,   /*  child event bridged to the URL subpath  */
    seg:          null,   /*  last applied/navigated subpath (dedup guard)  */
    rebind_timer: null,   /*  pending deferred transport rebind  */
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
    let conn_id     = gobj_read_attr(gobj, "conn_id");

    /*
     *  Bridge the hosted view's selection <-> the URL subpath so a reload /
     *  deep link restores it (ported from wattyzer's C_WZ_TREEDB):
     *    - the view publishes its selection (CHILD model → delivered to us):
     *      TOPICS → EV_TOPIC_SELECTED (topic), GRAPH → EV_OPERATION_MODE_CHANGED
     *      (reading/edition/…). We navigate the shell to <base_route>/<seg>.
     *    - the shell publishes EV_ROUTE_CHANGED {base, subpath}; when `base` is
     *      OUR tab route we apply the subpath to the view. The `seg` dedup
     *      breaks the child→navigate→route_changed→child loop.
     *  The connection is already encoded in base_route (via the sel id), so no
     *  extra conn_id handling is needed here.
     */
    priv.sel_event = (view_gclass === "C_YUI_TREEDB_GRAPH")
        ? "EV_OPERATION_MODE_CHANGED"
        : "EV_TOPIC_SELECTED";

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

    build_hosted_view(gobj, remote);
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

    /*
     *  Subscriptions live in mt_start to stay symmetric with the
     *  unsubscribes in mt_stop (a stop+start cycle keeps them). The shell
     *  mounts a view with gobj_create → appendChild → gobj_start and only
     *  then broadcasts EV_ROUTE_CHANGED, so subscribing here still
     *  precedes the first broadcast. EV_ON_OPEN watches OUR connection:
     *  C_TREEDB_LINKS RECREATES the transport on a token refresh
     *  (treedb_links_reopen) or a coords edit — a mounted view that kept
     *  the old pointer would talk to a destroyed gobj forever (looks
     *  connected, never loads). ac_transport_open rebinds it in place.
     */
    let shell = gobj_parent(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
    }

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
    if(priv.rebind_timer) {
        clearTimeout(priv.rebind_timer);
        priv.rebind_timer = null;
    }
    /*  Unsubscribe the shell's EV_ROUTE_CHANGED while the parent is alive. */
    let shell = gobj_parent(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_unsubscribe_event(links, "EV_ON_OPEN", {}, gobj);
    }
    if(priv.view && gobj_is_running(priv.view)) {
        gobj_stop(priv.view);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 *
 *  The hosted view is a SERVICE created with this gobj as parent, so
 *  gobj_destroy cascades to it — do NOT destroy it again here
 *  ("gobj NULL or DESTROYED"). Cleanup already ran in mt_stop. Just drop
 *  our references (mirrors wattyzer's C_WZ_TREEDB.mt_destroy).
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;
    priv.view = null;
    let $c = gobj_read_attr(gobj, "$container");
    if($c && $c.parentNode) {
        $c.parentNode.removeChild($c);
    }
    gobj_write_attr(gobj, "$container", null);
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

/***************************************************************
 *  Create the real treedb view as a NAMED SERVICE so C_IEVENT_CLI can
 *  route its command answers / EV_TREEDB_NODE_* back (gobj_find_service).
 *  Unique, lower-case name per (workspace, connection, service). Writes
 *  the hosted view's $container as ours so the shell mounts/toggles the
 *  same DOM. Returns the view (or null — error already logged).
 ***************************************************************/
function build_hosted_view(gobj, remote)
{
    let priv = gobj.priv;
    let view_gclass = gobj_read_attr(gobj, "view_gclass");

    let view = gobj_create_service(
        service_name(gobj),
        view_gclass,
        {
            gobj_remote_yuno: remote,
            treedb_name:      gobj_read_attr(gobj, "treedb_name"),
            conn_id:          gobj_read_attr(gobj, "conn_id"),
            system:           gobj_read_attr(gobj, "system")
        },
        gobj
    );
    priv.view = view;
    if(!view) {
        log_error(`${GCLASS_NAME}: cannot create hosted view '${view_gclass}'`);
        return null;
    }

    /*  The treedb view builds its own $container in ITS mt_create; expose
     *  it as ours so the shell mounts/toggles the same DOM.  */
    let $c = gobj_read_attr(view, "$container");
    if(!$c) {
        log_error(`${GCLASS_NAME}: hosted view '${view_gclass}' did not expose $container`);
        $c = createElement2(["div", {}, ""]);
    }
    gobj_write_attr(gobj, "$container", $c);
    return view;
}

/***************************************************************
 *  Apply a URL segment to the hosted view: TOPICS → show that topic;
 *  GRAPH → set that operation mode.
 ***************************************************************/
function apply_seg(gobj, seg)
{
    let priv = gobj.priv;
    if(!priv.view || !seg) {
        return;
    }
    if(priv.sel_event === "EV_OPERATION_MODE_CHANGED") {
        gobj_send_event(priv.view, "EV_SET_OPERATION_MODE",
            {operation_mode: seg}, gobj);
    } else {
        gobj_send_event(priv.view, "EV_SHOW",
            {href: `${gobj_name(priv.view)}?${seg}`}, gobj);
    }
}

/***************************************************************
 *  The live transport the hosted view is effectively bound to.
 ***************************************************************/
function bound_transport(gobj)
{
    let priv = gobj.priv;
    return priv.view ? gobj_read_attr(priv.view, "gobj_remote_yuno") : null;
}

/***************************************************************
 *  The connection's transport was RECREATED (token-refresh reopen or a
 *  coords edit): the hosted view holds a pointer to the DESTROYED iev
 *  (baked as its gobj_remote_yuno at create, plus its EV_TREEDB_NODE_*
 *  subscriptions). Rebuild it in place against the new transport: destroy
 *  the old service, create a fresh one (it resolves + subscribes the new
 *  iev in its mt_create) and swap the $container in the mounted DOM.
 ***************************************************************/
function rebind_hosted_view(gobj)
{
    let priv = gobj.priv;
    if(gobj_is_destroying(gobj)) {
        return;
    }
    let conn_id = gobj_read_attr(gobj, "conn_id");
    let links = gobj_find_service("treedb_links", false);
    let remote = links ? treedb_links_get_iev(links, conn_id) : null;
    if(!remote) {
        return;     /*  connection gone meanwhile; the app prunes the tab  */
    }
    if(priv.view && bound_transport(gobj) === remote) {
        return;     /*  same transport (plain WS flap) — nothing to rebind  */
    }

    /*
     *  Remember WHERE the old container is mounted BEFORE destroying the
     *  old view: the treedb views remove their own $container from the DOM
     *  in mt_destroy (destroy_ui), so after gobj_destroy $old.parentNode is
     *  already null and a plain replaceChild would silently never mount the
     *  new container (its Tabulators attach by #id selector and need to be
     *  IN the document).
     */
    let $old = gobj_read_attr(gobj, "$container");
    let $parent = ($old && $old.parentNode) ? $old.parentNode : null;
    let $next = $old ? $old.nextSibling : null;
    let was_hidden = ($old && $old.classList.contains("is-hidden"));

    if(priv.view) {
        if(gobj_is_running(priv.view)) {
            gobj_stop(priv.view);
        }
        gobj_destroy(priv.view);
        priv.view = null;
    }

    let view = build_hosted_view(gobj, remote);
    if(!view) {
        return;     /*  Error already logged  */
    }

    /*  Mount the new container where the shell had mounted the old one,
     *  keeping the shell's show/hide state (it toggles is-hidden on the
     *  attr it re-reads).  */
    let $new = gobj_read_attr(gobj, "$container");
    if($parent && $new && $new !== $old) {
        if(was_hidden) {
            $new.classList.add("is-hidden");
        }
        if($old && $old.parentNode === $parent) {
            $parent.replaceChild($new, $old);
        } else {
            $parent.insertBefore(
                $new,
                ($next && $next.parentNode === $parent) ? $next : null
            );
        }
    }

    if(gobj_is_running(gobj)) {
        if(!gobj_is_running(view)) {
            gobj_start(view);
        }
    }

    /*  Restore the URL-selected topic / operation mode on the fresh view.  */
    apply_seg(gobj, priv.seg);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Child → selection changed (TOPICS: a topic tab; GRAPH: the operation
 *  mode). Mirror it into the URL as <base_route>/<seg> so reload / deep
 *  link restores it. The `seg` dedup skips the navigate when this is just
 *  the echo of a segment we applied in ac_route_changed.
 ***************************************************************/
function ac_child_selected(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let seg = kw && (kw.topic !== undefined ? kw.topic : kw.operation_mode);
    if(!seg || seg === priv.seg) {
        return 0;
    }
    let base_route = gobj_read_attr(gobj, "base_route");
    let shell = gobj_parent(gobj);
    if(shell && base_route) {
        priv.seg = seg;
        yui_shell_navigate(shell, `${base_route}/${seg}`);
    }
    return 0;
}

/***************************************************************
 *  Shell → route changed. Only react when `base` is OUR tab route (several
 *  treedb views are mounted at once — one per open tab); apply the subpath
 *  to the hosted view: TOPICS → show that topic; GRAPH → set that operation
 *  mode. The `seg` dedup skips re-applying a segment the child selected.
 ***************************************************************/
function ac_route_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let base = (kw && kw.base) || "";
    if(base !== gobj_read_attr(gobj, "base_route")) {
        return 0;   /*  not our tab  */
    }
    let subpath = kw && kw.subpath;
    if(!subpath || subpath === priv.seg || !priv.view) {
        return 0;
    }
    priv.seg = subpath;
    apply_seg(gobj, subpath);
    return 0;
}

/***************************************************************
 *  C_TREEDB_LINKS → a connection reached session. Only OUR connection
 *  matters, and only when its transport gobj is NOT the one the hosted
 *  view holds — i.e. treedb_links RECREATED it (token-refresh reopen or a
 *  coords edit; a plain WS reconnect keeps the same gobj and is ignored).
 *  Deferred: we are inside treedb_links' publish, and the rebind destroys
 *  gobjs — re-entering the publisher synchronously is forbidden.
 ***************************************************************/
function ac_transport_open(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = gobj_read_attr(gobj, "conn_id");
    if(!kw || kw.conn_id !== conn_id) {
        return 0;   /*  another connection  */
    }
    let links = gobj_find_service("treedb_links", false);
    let remote = links ? treedb_links_get_iev(links, conn_id) : null;
    if(!remote) {
        return 0;
    }
    if(priv.view && bound_transport(gobj) === remote) {
        return 0;   /*  same transport — subscriptions resend on their own  */
    }
    if(priv.rebind_timer) {
        clearTimeout(priv.rebind_timer);
    }
    priv.rebind_timer = setTimeout(function() {
        priv.rebind_timer = null;
        rebind_hosted_view(gobj);
    }, 0);
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
            ["EV_TOPIC_SELECTED",         ac_child_selected, null],
            ["EV_OPERATION_MODE_CHANGED", ac_child_selected, null],
            ["EV_ROUTE_CHANGED",          ac_route_changed,  null],
            ["EV_ON_OPEN",                ac_transport_open, null]
        ]]
    ];

    const event_types = [
        ["EV_TOPIC_SELECTED",         0],
        ["EV_OPERATION_MODE_CHANGED", 0],
        ["EV_ROUTE_CHANGED",          0],
        ["EV_ON_OPEN",                0]
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
