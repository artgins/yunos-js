/***********************************************************************
 *          c_agent_treedb.js
 *
 *      C_AGENT_TREEDB — the Schemas workspace tab: gobj-ui's treedb
 *      editor pointed at ONE yuno's `treedb_system_schema`, the treedb
 *      that holds every schema of that yuno AS DATA (treedbs -> topics
 *      -> cols).  Editing it there is how a schema is changed without
 *      touching the C literal; the change reaches the yuno when it is
 *      restarted (kill-yuno + run-yuno), which is the agent's job and
 *      the reason this console — and not the gui_treedb data browser —
 *      is where schema editing lives.
 *
 *      Two pieces are mounted here:
 *
 *        - C_AGENT_TREEDB_LINK, the routing adapter, which turns the
 *          view's commands into `command-agent`/`command-yuno` on the
 *          single control-center session (see its header).
 *        - C_YUI_TREEDB_TOPICS, the library view, mounted as a NAMED
 *          SERVICE with the adapter injected as its transport
 *          (`yui_mount_service_view`), so it works unchanged.
 *
 *      The view is mounted only once the session is up: it fetches its
 *      schema in ITS mt_start and a second fetch would rebuild its topic
 *      services on top of the first ones.  Until then this tab shows a
 *      notice, and EV_ON_OPEN mounts it.
 *
 *      NOT ROUTED (yet): the view's topic selection is not mirrored into
 *      the URL, so a reload lands on the topic grid.  gui_treedb's
 *      C_TREEDB_VIEW does that bridging and is the model to copy when
 *      this workspace earns it.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_str_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_create_pure_child,
    gobj_find_service,
    gobj_subscribe_event,
    gobj_send_event,
    gobj_start, gobj_stop, gobj_is_running,
    set_timeout, clear_timeout,
    gobj_has_event,
    gobj_short_name,
    createElement2,
    empty_string,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {
    yui_mount_service_view,
} from "@yuneta/gobj-ui/src/c_yui_service_view.js";

import {agent_link_is_connected} from "./c_agent_link.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TREEDB";

/*  The treedb every yuno keeps its own schemas in.  */
const SYSTEM_TREEDB = "treedb_system_schema";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,          "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "schemas",     "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "schemas",     "Owning workspace (selection bucket)"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",            "Node holding the yuno"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",            "Yuno whose schemas are edited"),
SDATA(data_type_t.DTP_STRING,   "yuno_label",  0,  "",            "Yuno label role^name"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  SYSTEM_TREEDB, "Treedb service inside that yuno"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,          "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,          "Root HTMLElement"),
SDATA_END()
];

let PRIVATE_DATA = {
    mount_timer: null,  /*  deferred mount on session open (see ac_on_open)  */
    adapter: null,  /*  C_AGENT_TREEDB_LINK (pure child)  */
    view:    null,  /*  C_YUI_TREEDB_TOPICS (named service)  */
    $body:   null,  /*  where the view's container is mounted  */
    $notice: null,  /*  shown while there is nothing to mount  */
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
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    let link = link_service(gobj);
    if(link) {
        gobj_subscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_CLOSE", {}, gobj);
    }

    build_ui(gobj);
    build_adapter(gobj);
}

/***************************************************************
 *          Framework Method: Start
 *
 *  The adapter starts FIRST: it subscribes to the link's answers,
 *  and the view's very first request goes out in its own mt_start.
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    if(priv.adapter && !gobj_is_running(priv.adapter)) {
        gobj_start(priv.adapter);
    }
    mount_view(gobj);
    render_state(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    if(priv.mount_timer) {
        clear_timeout(priv.mount_timer);
        priv.mount_timer = null;
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
 *  The view is a SERVICE created with this gobj as its parent and
 *  the adapter is a pure child: gobj_destroy cascades onto both.
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;

    priv.view = null;
    priv.adapter = null;
    priv.$body = null;
    priv.$notice = null;

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
 *  The shared control-center session.
 ***************************************************************/
function link_service(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!link) {
        link = gobj_find_service("agent_link", true);
        gobj_write_attr(gobj, "link_svc", link);
    }
    return link;
}

/***************************************************************
 *  Root DOM: a wrapper this tab owns, so the hosted view can be
 *  mounted (and re-mounted) inside it without the shell noticing.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    priv.$notice = createElement2(
        ["div", {class: "TREEDB_NOTICE p-4 has-text-grey",
                 i18n: "not connected to an agent"},
            t("not connected to an agent")]
    );
    priv.$body = createElement2(
        ["div", {class: "TREEDB_BODY", style: "flex:1 1 auto; min-height:0;"}, []]
    );

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} TREEDB_CARD view-card`,
                 style: "display:flex; flex-direction:column; height:100%;"},
            [priv.$notice, priv.$body]]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *  The routing adapter, one per tab: it carries WHICH treedb this
 *  tab edits (node, yuno, service) and is the transport the library
 *  view talks to.
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
            link_svc:    link_service(gobj),
            node:        gobj_read_str_attr(gobj, "node"),
            yuno_id:     gobj_read_str_attr(gobj, "yuno_id"),
            treedb_name: gobj_read_str_attr(gobj, "treedb_name")
        },
        gobj
    );
    if(!priv.adapter) {
        log_error(`${gobj_short_name(gobj)}: cannot create the treedb adapter`);
    }
}

/***************************************************************
 *  A unique, lower-case suffix per tab: the hosted view is a NAMED
 *  SERVICE and a duplicate name is not fatal — gobj-js REBINDS the
 *  name and one tab's answers would land in the other.
 ***************************************************************/
function clean_id(gobj)
{
    let node = gobj_read_str_attr(gobj, "node") || "node";
    let yuno = gobj_read_str_attr(gobj, "yuno_id") || "yuno";
    return `${node}_${yuno}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

/***************************************************************
 *  Mount the library view — once, and only with the session up: it
 *  fetches its schema in mt_start, and a second fetch would build a
 *  second set of topic services over the first.
 ***************************************************************/
function mount_view(gobj)
{
    let priv = gobj.priv;

    if(priv.view || !priv.adapter) {
        return;
    }
    if(empty_string(gobj_read_str_attr(gobj, "node")) ||
            empty_string(gobj_read_str_attr(gobj, "yuno_id"))) {
        return;     /*  the empty-state route (/schemas/node): nothing to open  */
    }
    let link = link_service(gobj);
    if(!link || !agent_link_is_connected(link)) {
        return;     /*  ac_on_open mounts it when the session lands  */
    }

    let view = yui_mount_service_view(gobj, {
        gclass:    "C_YUI_TREEDB_TOPICS",
        name:      `treedb_view_${clean_id(gobj)}`,
        kw: {
            treedb_name:        gobj_read_str_attr(gobj, "treedb_name"),
            /*  The schemas live in the `__system__`-flavoured topics of
             *  this treedb (treedbs / topics / cols), so they must NOT be
             *  filtered out as system topics.  */
            system:             true,
            with_cards_landing: true
        },
        transport: priv.adapter
    });
    if(!view) {
        return;     /*  Error already logged  */
    }
    priv.view = view;

    let $v = gobj_read_attr(view, "$container");
    if($v) {
        priv.$body.appendChild($v);
    } else {
        log_error(`${gobj_short_name(gobj)}: hosted view exposes no $container`);
    }
    if(gobj_is_running(gobj) && !gobj_is_running(view)) {
        gobj_start(view);
    }
}

/***************************************************************
 *  Notice vs view.
 ***************************************************************/
function render_state(gobj)
{
    let priv = gobj.priv;
    if(!priv.$notice || !priv.$body) {
        return;
    }
    let mounted = !!priv.view;
    priv.$notice.classList.toggle("is-hidden", mounted);
    priv.$body.classList.toggle("is-hidden", !mounted);
    if(!mounted) {
        let key = empty_string(gobj_read_str_attr(gobj, "yuno_id"))
            ? "select a yuno"
            : "not connected to an agent";
        priv.$notice.setAttribute("i18n", key);
        priv.$notice.textContent = t(key);
    }
}

/***************************************************************
 *  Tell the hosted view whether the session is up, so it can
 *  enable/disable its remote-only actions.
 ***************************************************************/
function notify_view_transport(gobj, connected)
{
    let priv = gobj.priv;
    if(priv.view && gobj_has_event(priv.view, "EV_TRANSPORT_STATE", 0)) {
        gobj_send_event(priv.view, "EV_TRANSPORT_STATE", {connected: connected}, gobj);
    }
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Session up: mount the view if it was waiting for it.
 *
 *  DEFERRED, and not for tidiness: we are inside the link's
 *  publication, and the ADAPTER is another subscriber of the same
 *  event. Mounting here would start the view — whose mt_start fetches
 *  the schema — while the adapter may not have been given the edge
 *  yet, so its own state would still say "not in session" and the
 *  fetch would be refused. Next tick every subscriber has seen it.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(priv.mount_timer) {
        clear_timeout(priv.mount_timer);
    }
    priv.mount_timer = set_timeout(function() {
        priv.mount_timer = null;
        mount_view(gobj);
        render_state(gobj);
        notify_view_transport(gobj, true);
    }, 0);
    return 0;
}

/***************************************************************
 *  Session down. The view stays mounted (its schema is still valid
 *  and the adapter re-resolves the link on the next request); only
 *  its remote-only actions are disabled.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    notify_view_transport(gobj, false);
    return 0;
}

/***************************************************************
 *  The hosted view selected a topic. Not routed into the URL yet
 *  (see the header) — swallowed here so the CHILD publication does
 *  not die as "Event NOT DEFINED in state".
 ***************************************************************/
function ac_topic_selected(gobj, event, kw, src)
{
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
            ["EV_ON_OPEN",              ac_on_open,        null],
            ["EV_ON_CLOSE",             ac_on_close,       null],
            ["EV_TOPIC_SELECTED",       ac_topic_selected, null],
            ["EV_RECORD_WRITTEN",       ac_topic_selected, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",        0],
        ["EV_ON_CLOSE",       0],
        ["EV_TOPIC_SELECTED", 0],
        ["EV_RECORD_WRITTEN", 0]
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
function register_c_agent_treedb()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_treedb};
