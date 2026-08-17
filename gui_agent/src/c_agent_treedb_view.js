/***********************************************************************
 *          c_agent_treedb_view.js
 *
 *      C_AGENT_TREEDB_VIEW — ONE treedb of one yuno, mounted as the
 *      LINK node of the Schemas tree (see c_agent_treedb.js).
 *
 *      WHERE THE STRUCTURE ENDS.  The Schemas tab is a tree of nodes —
 *      the tab is the root and each treedb the yuno exposes is a child
 *      — and a treedb is where the structure stops: below it there are
 *      topics, records and columns, which are DATA and belong to a
 *      viewer, not to one gobj per row.  So the treedb node is declared
 *      `link` and this gclass is its viewer: it owns the tail of the
 *      url (`<topic>[/info]`, or `schema`) exactly as it would if the
 *      shell had mounted it at a declared route.
 *
 *      WHAT IT OWNS
 *          - the routing adapter (C_AGENT_TREEDB_LINK), one per mount:
 *            it carries WHICH treedb is open and is the transport the
 *            library view talks to.
 *          - the library view (C_YUI_TREEDB_TOPICS) on top of it.
 *          - the translation between the node's `subpath` and the
 *            view's own events, in both directions.
 *
 *      WHAT IT DOES NOT OWN: the yuno.  Discovery, the apply sequence
 *      and the pending-changes flag are yuno-level and stay in the tab;
 *      a write seen here is therefore SENT to the owning tab
 *      (`gobj_send_event`), never published — this gobj's parent is a
 *      C_YUI_NODE, which declares none of these events.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_str_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_gclass_name,
    gobj_create_pure_child,
    gobj_find_service,
    gobj_subscribe_event, gobj_unsubscribe_event,
    gobj_send_event,
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running,
    gobj_has_event,
    gobj_short_name, gobj_name,
    createElement2,
    empty_string,
} from "@yuneta/gobj-js";

import {yui_mount_service_view} from "@yuneta/gobj-ui/src/c_yui_service_view.js";
import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {agent_link_is_connected} from "./c_agent_link.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TREEDB_VIEW";

/*  The gclass of the tab that owns the yuno: what a write is reported
 *  to, found by walking up the tree this view hangs from.  */
const OWNER_GCLASS = "C_AGENT_TREEDB";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,   "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "node",        0,  "",     "Node holding the yuno"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",     "Yuno holding the treedb"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  "",     "Treedb this view opens"),
SDATA(data_type_t.DTP_STRING,   "base_route",  0,  "",     "This treedb node's route: the url carries <topic>[/info] under it"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,   "Root HTMLElement"),
SDATA_END()
];

let PRIVATE_DATA = {
    link:    null,  /*  C_AGENT_LINK, the shared session  */
    adapter: null,  /*  C_AGENT_TREEDB_LINK (pure child)  */
    view:    null,  /*  C_YUI_TREEDB_TOPICS (named service)  */
    seg:     null,  /*  subpath last applied or navigated (loop guard)  */
    $body:   null,
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

    /*
     *  CHILD subscription model
     *
     *  The parent is the treedb's C_YUI_NODE and it declares none of
     *  this view's events, so nothing is ever PUBLISHED from here: what
     *  the owning tab has to know is sent to it (owner_tab()).
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    priv.link = gobj_find_service("agent_link", true);

    build_ui(gobj);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    if(priv.link) {
        gobj_subscribe_event(priv.link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(priv.link, "EV_ON_CLOSE", {}, gobj);
    }
    mount_view(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    if(priv.link) {
        gobj_unsubscribe_event(priv.link, "EV_ON_OPEN", {}, gobj);
        gobj_unsubscribe_event(priv.link, "EV_ON_CLOSE", {}, gobj);
    }
    if(priv.view && gobj_is_running(priv.view)) {
        gobj_stop(priv.view);
    }
    if(priv.adapter && gobj_is_running(priv.adapter)) {
        gobj_stop(priv.adapter);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 *
 *  The view is a service created with this gobj as its parent and
 *  the adapter is a pure child: gobj_destroy cascades onto both.
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;

    priv.view = null;
    priv.adapter = null;
    priv.link = null;
    priv.$body = null;

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
 *  Root DOM: a body this view owns, so the library view can be
 *  mounted inside it without the node noticing.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    priv.$body = createElement2(
        ["div", {class: "TREEDB_VIEW_BODY", style: "flex:1 1 auto; min-height:0;"}, []]
    );

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} TREEDB_VIEW_CARD`,
                 style: "display:flex; flex-direction:column; height:100%;"},
            [priv.$body]]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *  The tab that owns the yuno — the ancestor that discovered this
 *  treedb and can restart the yuno that holds it. It is an ancestor
 *  by construction: the tree hangs from it.
 ***************************************************************/
function owner_tab(gobj)
{
    let g = gobj_parent(gobj);

    while(g) {
        if(gobj_gclass_name(g) === OWNER_GCLASS) {
            return g;
        }
        g = gobj_parent(g);
    }
    log_error(`${gobj_short_name(gobj)}: no ${OWNER_GCLASS} above this view`);
    return null;
}

/***************************************************************
 *  A unique, lower-case suffix per mount: the hosted view is a
 *  NAMED SERVICE and a duplicate name is not fatal — gobj-js
 *  REBINDS the name and one tab's answers would land in the other.
 ***************************************************************/
function clean_id(gobj)
{
    let node = gobj_read_str_attr(gobj, "node") || "node";
    let yuno = gobj_read_str_attr(gobj, "yuno_id") || "yuno";
    let treedb = gobj_read_str_attr(gobj, "treedb_name") || "db";
    return `${node}_${yuno}_${treedb}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

/***************************************************************
 *  The routing adapter: it carries WHICH treedb is open (node,
 *  yuno, service) and is the transport the library view talks to.
 ***************************************************************/
function build_adapter(gobj)
{
    let priv = gobj.priv;

    priv.adapter = gobj_create_pure_child(
        `treedb_link_${clean_id(gobj)}`,
        "C_AGENT_TREEDB_LINK",
        {
            /*  No `subscriber`: the adapter is a transport, and its only
             *  audience is the hosted view, which subscribes to it on its
             *  own (SERVICE model). Handing it this gobj would deliver the
             *  echoed EV_TREEDB_NODE_* here, where they mean nothing.  */
            link_svc:    priv.link,
            node:        gobj_read_str_attr(gobj, "node"),
            yuno_id:     gobj_read_str_attr(gobj, "yuno_id"),
            treedb_name: gobj_read_str_attr(gobj, "treedb_name")
        },
        gobj
    );
    if(!priv.adapter) {
        log_error(`${gobj_short_name(gobj)}: cannot create the treedb adapter`);
        return -1;
    }
    gobj_start(priv.adapter);
    return 0;
}

/***************************************************************
 *  Mount the library view on this treedb. It fetches its schema in
 *  mt_start, so this runs once: another treedb is another NODE of
 *  the tree, with its own view.
 ***************************************************************/
function mount_view(gobj)
{
    let priv = gobj.priv;

    if(priv.view) {
        return 0;
    }
    if(empty_string(gobj_read_str_attr(gobj, "treedb_name"))) {
        log_error(`${gobj_short_name(gobj)}: mounted without a treedb name`);
        return -1;
    }
    if(!priv.adapter && build_adapter(gobj) < 0) {
        return -1;      /*  Error already logged  */
    }

    /*  The url under this treedb is `<topic>[/info]` (or `schema`), so
     *  the library view's base IS this node's route: from there it
     *  routes its own topics (cards, landing toggle, site map). No
     *  `graph` action: this workspace mounts no graph view, and a card
     *  icon that navigates nowhere is worse than one that is not
     *  there.  */
    let base = base_route(gobj);
    let kw = {
        treedb_name:        gobj_read_str_attr(gobj, "treedb_name"),
        /*  A schema lives in the `__system__`-flavoured topics of its
         *  treedb (treedbs / topics / cols), so system topics must NOT
         *  be filtered out. In a data treedb it only adds __snaps__.  */
        system:             true,
        with_cards_landing: true
    };
    if(!empty_string(base)) {
        /*  `base_route` is a ROUTE (the site map matches it); the card and
         *  landing templates are HREFS and carry the '#', or the anchor
         *  leaves the SPA on click — same convention as gui_treedb.  */
        kw.base_route = base;
        kw.card_action_routes = {
            info:  `#${base}/{topic}/info`,
            table: `#${base}/{topic}`
        };
        kw.landing_routes = {cards: `#${base}`, schema: `#${base}/schema`};
    }

    let view = yui_mount_service_view(gobj, {
        gclass:    "C_YUI_TREEDB_TOPICS",
        name:      `treedb_view_${clean_id(gobj)}`,
        kw:        kw,
        transport: priv.adapter
    });
    if(!view) {
        return -1;      /*  Error already logged  */
    }
    priv.view = view;

    let $v = gobj_read_attr(view, "$container");
    if($v) {
        priv.$body.appendChild($v);
    } else {
        log_error(`${gobj_short_name(gobj)}: hosted view exposes no $container`);
    }
    if(!gobj_is_running(view)) {
        gobj_start(view);
    }
    notify_view_transport(gobj, agent_link_is_connected(priv.link));
    return 0;
}

/***************************************************************
 *  This view's route: the treedb node's own, handed down at
 *  creation because a node's route never changes.
 ***************************************************************/
function base_route(gobj)
{
    return gobj_read_str_attr(gobj, "base_route");
}

/***************************************************************
 *  Put a subpath in the URL, so a reload or a shared link lands
 *  where the operator is. `push` because these are user moves and
 *  browser Back should undo them one at a time.
 ***************************************************************/
function navigate_seg(gobj, seg)
{
    let priv = gobj.priv;
    let base = base_route(gobj);
    let shell = yui_shell_of(gobj);

    if(empty_string(base) || !shell) {
        return -1;      /*  a view with no route of its own: nothing to mirror  */
    }
    if(seg === priv.seg) {
        return 0;       /*  echo of what we just applied  */
    }
    priv.seg = seg;
    yui_shell_navigate(shell, seg ? `${base}/${seg}` : base, {push: true});
    return 0;
}

/***************************************************************
 *  Apply the part of the subpath this view owns: a bare topic
 *  opens its table, `<topic>/info` its info panel, `schema` the
 *  schema-graph landing, and nothing at all the topic grid.
 ***************************************************************/
function apply_seg(gobj, seg)
{
    let priv = gobj.priv;

    if(!priv.view) {
        return;
    }
    if(empty_string(seg)) {
        gobj_send_event(priv.view, "EV_SHOW", {href: ""}, gobj);
        return;
    }
    if(seg === "schema") {
        gobj_send_event(priv.view, "EV_SET_LANDING_VIEW", {view: "schema"}, gobj);
        return;
    }
    if(seg.endsWith("/info")) {
        gobj_send_event(priv.view, "EV_SHOW_TOPIC_INFO",
            {topic: seg.slice(0, -"/info".length)}, gobj);
        return;
    }
    gobj_send_event(priv.view, "EV_SHOW",
        {href: `${gobj_name(priv.view)}?${seg}`}, gobj);
}

/***************************************************************
 *  Tell the hosted view whether the session is up, so it can
 *  enable/disable its remote-only actions.
 ***************************************************************/
function notify_view_transport(gobj, connected)
{
    let priv = gobj.priv;

    if(priv.view && gobj_has_event(priv.view, "EV_TRANSPORT_STATE", 0)) {
        gobj_send_event(priv.view, "EV_TRANSPORT_STATE", {connected: !!connected}, gobj);
    }
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  The session came up / went down. The view stays mounted either
 *  way — its schema is still valid and the adapter re-resolves the
 *  link on the next request — only its remote-only actions change.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    notify_view_transport(gobj, true);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    notify_view_transport(gobj, false);
    return 0;
}

/***************************************************************
 *  The node handed us the tail of the url (ROUTING.md §5): under
 *  this treedb everything left is the view's.
 ***************************************************************/
function ac_route_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let seg = (kw && kw.subpath) || "";

    if(seg === (priv.seg || "")) {
        return 0;   /*  the echo of what we just navigated  */
    }
    priv.seg = seg;
    apply_seg(gobj, seg);
    return 0;
}

/***************************************************************
 *  The hosted view selected a topic: mirror it into the URL, so a
 *  reload or a shared link lands on it. An EMPTY topic is the way
 *  back to the topic grid.
 ***************************************************************/
function ac_topic_selected(gobj, event, kw, src)
{
    let topic = kw ? kw.topic : undefined;

    if(topic === undefined) {
        return 0;   /*  a stray echo  */
    }
    navigate_seg(gobj, topic || "");
    return 0;
}

/***************************************************************
 *  The hosted view WROTE a record. The treedb has it; the yuno that
 *  opened the treedb has not re-read it — and re-reading it means
 *  restarting that yuno, which is the TAB's job. So the write is
 *  reported upwards, where the apply button lives.
 ***************************************************************/
function ac_record_written(gobj, event, kw, src)
{
    let tab = owner_tab(gobj);

    if(!tab) {
        return -1;      /*  Error already logged  */
    }
    gobj_send_event(tab, "EV_RECORD_WRITTEN", {
        treedb_name: gobj_read_str_attr(gobj, "treedb_name")
    }, gobj);
    return 0;
}




/***************************************************************
 *              FSM
 ***************************************************************/
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
     *
     *  One state: a mounted treedb view is either showing the topic
     *  grid or one topic, and that is the hosted view's own state
     *  machine, not this one's.
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_ROUTE_CHANGED",        ac_route_changed,     null],
            ["EV_TOPIC_SELECTED",       ac_topic_selected,    null],
            ["EV_RECORD_WRITTEN",       ac_record_written,    null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_ROUTE_CHANGED",     0],
        ["EV_TOPIC_SELECTED",    0],
        ["EV_RECORD_WRITTEN",    0]
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
function register_c_agent_treedb_view()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_treedb_view};
