/***********************************************************************
 *          c_agent_treedb.js
 *
 *      C_AGENT_TREEDB — the Schemas workspace tab: gobj-ui's treedb
 *      editor pointed at ONE treedb of ONE yuno of ONE node, reached
 *      through the agent by C_AGENT_TREEDB_LINK (see its header).
 *
 *      WHICH treedb is discovered, not assumed.  A yuno exposes its
 *      treedbs as SERVICES, so one round trip answers it:
 *          command-yuno id=<yuno> service=__yuno__ command=services
 *      and the `C_NODE` rows of that answer are the treedbs this console
 *      can talk to.  The tab opens `treedb_system_schema` — the one that
 *      holds the yuno's schemas AS DATA (treedbs -> topics -> cols), and
 *      the reason this workspace exists — and offers the rest in a
 *      selector, because an operator already on the node should not need
 *      a second SPA and a second session to look at the data.
 *
 *      Discovery also answers the question the tab could not ask before:
 *      a yuno with NO treedb (a gate, a pure timeranger yuno) now says
 *      so, instead of mounting a view that answers with an error toast
 *      per topic.
 *
 *      Editing a schema takes effect when the owning yuno is restarted
 *      (kill-yuno + run-yuno), which is the agent's job and the reason
 *      this console — and not the gui_treedb data browser — is where
 *      schema editing lives.
 *
 *      STATES, because each is a different screen and a different set of
 *      legal actions:
 *          ST_IDLE         no yuno picked, or no session yet
 *          ST_DISCOVERING  `services` in flight
 *          ST_EMPTY        the yuno exposes no treedb
 *          ST_READY        a treedb is mounted
 *
 *      NOT ROUTED (yet): neither the selected treedb nor the view's
 *      topic is mirrored into the URL, so a reload lands on the default
 *      treedb's topic grid.  gui_treedb's C_TREEDB_VIEW does that
 *      bridging and is the model to copy.
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
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running, gobj_is_destroying,
    set_timeout, clear_timeout,
    gobj_has_event,
    gobj_change_state, gobj_current_state,
    gobj_short_name,
    createElement2,
    empty_string,
    msg_iev_write_key,
    msg_iev_read_key,
    msg_iev_get_stack,
    kw_get_str,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {
    yui_mount_service_view,
} from "@yuneta/gobj-ui/src/c_yui_service_view.js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TREEDB";

/*  The treedb every yuno with a C_TREEDB keeps its own schemas in.  */
const SYSTEM_TREEDB = "treedb_system_schema";

/*  Marker of OUR discovery request in __md_iev__: the link re-publishes
 *  every answer to every panel, and each filters on its own purpose.  */
const PURPOSE = "treedbs";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,          "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "schemas",     "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "schemas",     "Owning workspace (selection bucket)"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",            "Node holding the yuno"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",            "Yuno whose treedbs are opened"),
SDATA(data_type_t.DTP_STRING,   "yuno_label",  0,  "",            "Yuno label role^name"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  "",            "Treedb currently open (discovered)"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,          "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,          "Root HTMLElement"),
SDATA_END()
];

let PRIVATE_DATA = {
    mount_timer: null,  /*  deferred discovery on session open (see ac_on_open)  */
    treedbs:     null,  /*  discovered C_NODE service names  */
    notice:      "",    /*  explicit text when a key does not say it all  */
    adapter:     null,  /*  C_AGENT_TREEDB_LINK (pure child)  */
    view:        null,  /*  C_YUI_TREEDB_TOPICS (named service)  */
    $toolbar:    null,  /*  treedb selector  */
    $select:     null,
    $notice:     null,  /*  shown while there is nothing to mount  */
    $body:       null,  /*  where the view's container is mounted  */
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

    priv.treedbs = [];

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
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
    }

    build_ui(gobj);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    start_discovery(gobj);
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
    priv.$toolbar = null;
    priv.$select = null;
    priv.$notice = null;
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
 *  mounted (and swapped) inside it without the shell noticing.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    priv.$select = createElement2(
        ["select", {class: "TREEDB_SELECT",
                    "aria-label": t("treedb"), "data-i18n-aria-label": "treedb"},
            [],
            {change: (e) => {
                /*  The DOM callback's only job: turn the change into an
                 *  event. The work belongs to the action.  */
                gobj_send_event(gobj, "EV_SELECT_TREEDB", {treedb: e.target.value}, gobj);
            }}
        ]
    );
    priv.$toolbar = createElement2(
        /*  NO `is-flex` here: it is a Bulma helper and carries !important,
         *  so it beats `is-hidden` (also !important) depending on which
         *  lands later in the sheet — the toolbar stayed visible, empty,
         *  on a yuno with no treedb. Inline display + is-hidden behaves:
         *  an !important rule beats a non-important inline style.  */
        ["div", {class: "TREEDB_TOOLBAR is-align-items-center is-hidden",
                 style: "display:flex; gap:.5rem; padding:.25rem .5rem;"},
            [
                ["span", {class: "TREEDB_TOOLBAR_LABEL has-text-grey", i18n: "treedb"},
                    t("treedb")],
                ["div", {class: "select"}, [priv.$select]]
            ]
        ]
    );
    priv.$notice = createElement2(
        ["div", {class: "TREEDB_NOTICE p-4 has-text-grey", i18n: "select a yuno"},
            t("select a yuno")]
    );
    priv.$body = createElement2(
        ["div", {class: "TREEDB_BODY", style: "flex:1 1 auto; min-height:0;"}, []]
    );

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} TREEDB_CARD view-card`,
                 style: "display:flex; flex-direction:column; height:100%;"},
            [priv.$toolbar, priv.$notice, priv.$body]]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *  Ask the yuno which services it runs; its C_NODE ones are the
 *  treedbs. Returns 0 when the request went out.
 ***************************************************************/
function request_treedbs(gobj)
{
    let node = gobj_read_str_attr(gobj, "node");
    let yuno = gobj_read_str_attr(gobj, "yuno_id");
    let link = link_service(gobj);

    if(empty_string(node) || empty_string(yuno)) {
        return -1;      /*  the empty-state route: nothing to discover  */
    }
    if(!link || !agent_link_is_connected(link)) {
        return -1;      /*  ac_on_open asks again when the session lands  */
    }

    let kw_send = {
        agent_id:  node,
        cmd2agent: `command-yuno id="${yuno}" service="__yuno__" command="services"`
    };
    msg_iev_write_key(kw_send, "console_purpose", PURPOSE);
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno);
    agent_link_command(link, "command-agent", kw_send);
    return 0;
}

/***************************************************************
 *  Discover, or explain why not. Called at start and on every
 *  session open that finds this tab with nothing mounted.
 ***************************************************************/
function start_discovery(gobj)
{
    if(request_treedbs(gobj) === 0) {
        gobj_change_state(gobj, "ST_DISCOVERING");
        return;
    }
    gobj_change_state(gobj, "ST_IDLE");
}

/***************************************************************
 *  The C_NODE services of the answer, `treedb_system_schema` first:
 *  it is what this workspace is for, and the default.
 ***************************************************************/
function treedbs_of(data)
{
    if(!Array.isArray(data)) {
        return [];
    }
    let names = data
        .filter((s) => s && s.gclass === "C_NODE" && !empty_string(s.service))
        .map((s) => s.service)
        .sort();

    let i = names.indexOf(SYSTEM_TREEDB);
    if(i > 0) {
        names.splice(i, 1);
        names.unshift(SYSTEM_TREEDB);
    }
    return names;
}

/***************************************************************
 *  A unique, lower-case suffix per mount: the hosted view is a
 *  NAMED SERVICE and a duplicate name is not fatal — gobj-js
 *  REBINDS the name and one tab's answers would land in the other.
 *  The treedb is part of it because switching treedb is a new mount.
 ***************************************************************/
function clean_id(gobj)
{
    let node = gobj_read_str_attr(gobj, "node") || "node";
    let yuno = gobj_read_str_attr(gobj, "yuno_id") || "yuno";
    let treedb = gobj_read_str_attr(gobj, "treedb_name") || "db";
    return `${node}_${yuno}_${treedb}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

/***************************************************************
 *  The routing adapter, one per mount: it carries WHICH treedb is
 *  open (node, yuno, service) and is the transport the library view
 *  talks to.
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
        return -1;
    }
    gobj_start(priv.adapter);
    return 0;
}

/***************************************************************
 *  Mount the library view on the current treedb. It fetches its
 *  schema in mt_start, so this runs once per mount — switching
 *  treedb tears the pair down and builds a fresh one.
 ***************************************************************/
function mount_view(gobj)
{
    let priv = gobj.priv;

    if(priv.view) {
        return 0;
    }
    if(empty_string(gobj_read_str_attr(gobj, "treedb_name"))) {
        return -1;
    }
    if(!priv.adapter && build_adapter(gobj) < 0) {
        return -1;      /*  Error already logged  */
    }

    let view = yui_mount_service_view(gobj, {
        gclass:    "C_YUI_TREEDB_TOPICS",
        name:      `treedb_view_${clean_id(gobj)}`,
        kw: {
            treedb_name:        gobj_read_str_attr(gobj, "treedb_name"),
            /*  A schema lives in the `__system__`-flavoured topics of its
             *  treedb (treedbs / topics / cols), so system topics must NOT
             *  be filtered out. In a data treedb it only adds __snaps__.  */
            system:             true,
            with_cards_landing: true
        },
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
    if(gobj_is_running(gobj) && !gobj_is_running(view)) {
        gobj_start(view);
    }
    return 0;
}

/***************************************************************
 *  Tear the pair down. The adapter goes with the view: it holds the
 *  requests in flight for THAT view, and answering a destroyed one
 *  is how a stale answer lands in the next treedb's table.
 ***************************************************************/
function unmount_view(gobj)
{
    let priv = gobj.priv;

    if(priv.view) {
        let $v = gobj_read_attr(priv.view, "$container");
        if(gobj_is_running(priv.view)) {
            gobj_stop(priv.view);
        }
        gobj_destroy(priv.view);
        priv.view = null;
        /*  The view removes its own container in mt_destroy; this is the
         *  case where it did not.  */
        if($v && $v.parentNode) {
            $v.parentNode.removeChild($v);
        }
    }
    if(priv.adapter) {
        if(gobj_is_running(priv.adapter)) {
            gobj_stop(priv.adapter);
        }
        gobj_destroy(priv.adapter);
        priv.adapter = null;
    }
}

/***************************************************************
 *  Options of the selector, current one selected.
 ***************************************************************/
function render_selector(gobj)
{
    let priv = gobj.priv;
    if(!priv.$select) {
        return;
    }
    let current = gobj_read_str_attr(gobj, "treedb_name");

    priv.$select.replaceChildren();
    for(let name of priv.treedbs) {
        priv.$select.appendChild(
            createElement2(["option", {value: name}, name])
        );
    }
    priv.$select.value = current;
}

/***************************************************************
 *  What this tab shows in each state.
 ***************************************************************/
function render_state(gobj)
{
    let priv = gobj.priv;
    if(!priv.$notice || !priv.$body || !priv.$toolbar) {
        return;
    }
    let ready = !!priv.view;

    priv.$toolbar.classList.toggle("is-hidden", !ready);
    priv.$body.classList.toggle("is-hidden", !ready);
    priv.$notice.classList.toggle("is-hidden", ready);

    if(ready) {
        return;
    }
    if(priv.notice) {
        priv.$notice.removeAttribute("i18n");
        priv.$notice.textContent = priv.notice;
        return;
    }
    let key;
    if(empty_string(gobj_read_str_attr(gobj, "yuno_id"))) {
        key = "select a yuno";
    } else if(!agent_link_is_connected(link_service(gobj))) {
        key = "not connected to an agent";
    } else if(gobj_current_state(gobj) === "ST_EMPTY") {
        key = "no treedb in this yuno";
    } else {
        key = "loading";
    }
    priv.$notice.setAttribute("i18n", key);
    priv.$notice.textContent = t(key);
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
 *  Session up with nothing mounted: discover.
 *
 *  DEFERRED, and not for tidiness: we are inside the link's
 *  publication, and the ADAPTER (built at the end of discovery) is
 *  another subscriber of the same event. Mounting from here would
 *  start the view — whose mt_start fetches the schema — while the
 *  adapter may not have been given the edge yet, so its own state
 *  would still say "not in session" and the fetch would be refused.
 *  Next tick every subscriber has seen it.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(priv.mount_timer) {
        clear_timeout(priv.mount_timer);
    }
    priv.mount_timer = set_timeout(function() {
        priv.mount_timer = null;
        if(gobj_is_destroying(gobj)) {
            return;
        }
        priv.notice = "";
        start_discovery(gobj);
        render_state(gobj);
    }, 0);
    return 0;
}

/***************************************************************
 *  Session up while a treedb is already mounted: the view stays,
 *  only its remote-only actions are re-enabled.
 ***************************************************************/
function ac_on_open_ready(gobj, event, kw, src)
{
    notify_view_transport(gobj, true);
    return 0;
}

/***************************************************************
 *  Session down. A mounted view stays mounted (its schema is still
 *  valid and the adapter re-resolves the link on the next request);
 *  a discovery in flight will never be answered.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    notify_view_transport(gobj, false);
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The answer to OUR `services`. Two arrive: the controlcenter's
 *  dispatch ack (stack frame `command-agent`, interesting only when
 *  it failed) and the yuno's real answer.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(msg_iev_read_key(kw, "console_purpose") !== PURPOSE) {
        return 0;   /*  another panel's answer  */
    }
    if(msg_iev_read_key(kw, "console_node") !== gobj_read_str_attr(gobj, "node") ||
            msg_iev_read_key(kw, "console_yuno") !== gobj_read_str_attr(gobj, "yuno_id")) {
        return 0;   /*  another tab's discovery  */
    }

    let stack = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let outer = kw_get_str(gobj, stack, "command", "", 0);
    let failed = (typeof kw.result === "number" && kw.result < 0);

    if(outer === "command-agent" && !failed) {
        return 0;   /*  dispatch ok: the real answer is still coming  */
    }
    if(failed) {
        priv.treedbs = [];
        priv.notice = kw.comment || "";
        gobj_change_state(gobj, "ST_EMPTY");
        render_state(gobj);
        return 0;
    }

    priv.notice = "";
    priv.treedbs = treedbs_of(kw.data);
    if(priv.treedbs.length === 0) {
        gobj_change_state(gobj, "ST_EMPTY");
        render_state(gobj);
        return 0;
    }

    /*  Keep what was open if it survived a re-discovery, else the
     *  system schema, else whatever this yuno has.  */
    let current = gobj_read_str_attr(gobj, "treedb_name");
    if(priv.treedbs.indexOf(current) < 0) {
        gobj_write_attr(gobj, "treedb_name", priv.treedbs[0]);
    }
    render_selector(gobj);

    if(mount_view(gobj) < 0) {
        gobj_change_state(gobj, "ST_EMPTY");
        render_state(gobj);
        return 0;
    }
    gobj_change_state(gobj, "ST_READY");
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The operator picked another treedb of the same yuno: a new
 *  mount, transport included.
 ***************************************************************/
function ac_select_treedb(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let name = (kw && kw.treedb) || "";

    if(empty_string(name) || name === gobj_read_str_attr(gobj, "treedb_name")) {
        render_selector(gobj);      /*  undo a stray change of the widget  */
        return 0;
    }
    if(priv.treedbs.indexOf(name) < 0) {
        log_error(`${gobj_short_name(gobj)}: '${name}' is not a treedb of this yuno`);
        render_selector(gobj);
        return 0;
    }

    unmount_view(gobj);
    gobj_write_attr(gobj, "treedb_name", name);
    render_selector(gobj);
    if(mount_view(gobj) < 0) {
        gobj_change_state(gobj, "ST_EMPTY");
    }
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The hosted view selected a topic / wrote a record. Neither is
 *  routed into the URL yet (see the header) — handled here so the
 *  CHILD publication does not die as "Event NOT DEFINED in state".
 ***************************************************************/
function ac_view_notice(gobj, event, kw, src)
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
     *
     *  The answer event is declared in every state: the link
     *  re-publishes EVERY answer of the session to EVERY panel, so it
     *  arrives here whatever this tab is doing.
     *---------------------------------------------*/
    const view_events = [
        ["EV_TOPIC_SELECTED",       ac_view_notice,       null],
        ["EV_RECORD_WRITTEN",       ac_view_notice,       null]
    ];
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...view_events
        ]],
        ["ST_DISCOVERING", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_ON_CLOSE",             ac_on_close,          "ST_IDLE"],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...view_events
        ]],
        ["ST_EMPTY", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...view_events
        ]],
        ["ST_READY", [
            ["EV_ON_OPEN",              ac_on_open_ready,     null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...view_events
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_MT_COMMAND_ANSWER", 0],
        ["EV_SELECT_TREEDB",     0],
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
function register_c_agent_treedb()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_treedb};
