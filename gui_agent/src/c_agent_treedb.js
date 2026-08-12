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
 *      APPLYING a schema is restarting the yuno that opened it, so the
 *      tab offers it: `kill-yuno` -> `run-yuno play=0` -> `play-yuno`,
 *      confirmed first because it disconnects every client of that yuno.
 *      Each command answers ONCE and only when it is done (the agent
 *      counts the channel closing and re-opening), so the sequence needs
 *      neither timer nor polling — and it ends by re-discovering, which
 *      re-mounts the view against the schema the yuno has just re-read.
 *
 *      STATES, because each is a different screen and a different set of
 *      legal actions:
 *          ST_IDLE         no yuno picked, or no session yet
 *          ST_DISCOVERING  `services` in flight
 *          ST_EMPTY        the yuno exposes no treedb
 *          ST_READY        a treedb is mounted
 *          ST_KILLING      apply: waiting for the yuno to die
 *          ST_STARTING     apply: waiting for it to connect back
 *          ST_PLAYING      apply: waiting for its services to play
 *
 *      THE URL CARRIES THE POSITION, as everywhere else in the shell:
 *      under this tab's route the subpath is `<treedb>[/<topic>[/info]]`
 *      (or `<treedb>/schema`). The first segment is OURS — changing it is
 *      a remount — and the rest belongs to the hosted view, which routes
 *      its own topics because it is mounted with `base_route` =
 *      <our route>/<treedb>. So a reload, a Back or a shared link lands
 *      where the operator was.
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
    gobj_subscribe_event, gobj_unsubscribe_event,
    gobj_send_event,
    gobj_start, gobj_stop, gobj_destroy, gobj_is_running,
    gobj_post_event,
    gobj_has_event,
    gobj_change_state, gobj_current_state,
    gobj_short_name, gobj_name,
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
import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_shell_show_modal, yui_shell_show_error} from "@yuneta/gobj-ui/src/shell_modals.js";

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

/*  How long a step of the apply sequence may take before the tab stops
 *  waiting. Generous: the agent answers each one when it is DONE, and
 *  "done" for a kill is the killed yuno's channel closing.  */
const APPLY_TIMEOUT = 30 * 1000;


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
SDATA(data_type_t.DTP_STRING,   "base_route",  0,  "",            "This tab's declared route: the URL carries <treedb>[/<topic>] under it"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,          "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,          "Root HTMLElement"),
SDATA_END()
];

let PRIVATE_DATA = {
    treedbs:     null,  /*  discovered C_NODE service names  */
    notice:      "",    /*  explicit text when a key does not say it all  */
    adapter:     null,  /*  C_AGENT_TREEDB_LINK (pure child)  */
    view:        null,  /*  C_YUI_TREEDB_TOPICS (named service)  */
    dirty:       false, /*  something was written since the last apply  */
    seg:         null,  /*  subpath last applied or navigated (loop guard)  */
    apply_timer: null,  /*  deadline of the step in flight  */
    modal:       null,  /*  the apply confirmation  */
    $toolbar:    null,  /*  treedb selector + apply  */
    $select:     null,
    $apply:      null,
    $pending:    null,
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
    priv.dirty = false;

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
    /*  The HOST, not "the shell": this is a subscription, so it goes to
     *  whoever PUBLISHES EV_ROUTE_CHANGED — the parent. (To TALK to the
     *  shell, yui_shell_of().) In mt_start to pair with mt_stop, and
     *  still before the shell's first broadcast, which follows the mount. */
    let host = gobj_parent(gobj);
    if(host) {
        gobj_subscribe_event(host, "EV_ROUTE_CHANGED", {}, gobj);
    }
    start_discovery(gobj);
    render_state(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    let host = gobj_parent(gobj);
    if(host) {
        gobj_unsubscribe_event(host, "EV_ROUTE_CHANGED", {}, gobj);
    }
    clear_apply_timer(gobj);
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

    if(priv.modal) {
        priv.modal.close();
        priv.modal = null;
    }
    priv.view = null;
    priv.adapter = null;
    priv.$toolbar = null;
    priv.$select = null;
    priv.$apply = null;
    priv.$pending = null;
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
    /*  What actually publishes an edited schema: the owning yuno has to
     *  re-read it, and that means a restart. The button says `apply`
     *  because that is the intent; the confirmation says what it does.  */
    priv.$apply = createElement2(
        ["button", {class: "button TREEDB_APPLY",
                    title: t("apply schema"), "aria-label": t("apply schema"),
                    "data-i18n-title": "apply schema",
                    "data-i18n-aria-label": "apply schema"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                ["span", {i18n: "apply"}, t("apply")]
            ],
            {click: (e) => {
                e.stopPropagation();
                gobj_send_event(gobj, "EV_APPLY_CHANGES", {}, gobj);
            }}
        ]
    );
    priv.$pending = createElement2(
        ["span", {class: "TREEDB_PENDING has-text-warning-dark is-hidden",
                  i18n: "pending changes"},
            t("pending changes")]
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
                ["div", {class: "select"}, [priv.$select]],
                ["div", {class: "TREEDB_TOOLBAR_END is-align-items-center",
                         style: "display:flex; gap:.5rem; margin-left:auto;"},
                    [priv.$pending, priv.$apply]]
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

    /*  The URL under this tab is `<treedb>[/<topic>[/info]]`, so the
     *  library view's own base is OUR route plus the treedb: from there
     *  it routes its topics itself (cards, landing toggle, site map) and
     *  the treedb segment stays ours. No `graph` action: this workspace
     *  mounts no graph view, and a card icon that navigates nowhere is
     *  worse than one that is not there.  */
    let vbase = view_base_route(gobj);
    let kw = {
        treedb_name:        gobj_read_str_attr(gobj, "treedb_name"),
        /*  A schema lives in the `__system__`-flavoured topics of its
         *  treedb (treedbs / topics / cols), so system topics must NOT
         *  be filtered out. In a data treedb it only adds __snaps__.  */
        system:             true,
        with_cards_landing: true
    };
    if(vbase) {
        /*  `base_route` is a ROUTE (the site map matches it); the card and
         *  landing templates are HREFS and carry the '#', or the anchor
         *  leaves the SPA on click — same convention as gui_treedb.  */
        kw.base_route = vbase;
        kw.card_action_routes = {
            info:  `#${vbase}/{topic}/info`,
            table: `#${vbase}/{topic}`
        };
        kw.landing_routes = {cards: `#${vbase}`, schema: `#${vbase}/schema`};
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
    if(gobj_is_running(gobj) && !gobj_is_running(view)) {
        gobj_start(view);
    }
    return 0;
}

/***************************************************************
 *  Say in the URL which treedb is open, without adding a Back
 *  entry: nobody navigated here, the tab just landed on its
 *  default. Skipped when the URL already carries a position.
 ***************************************************************/
function stamp_treedb_in_url(gobj)
{
    let priv = gobj.priv;
    let base = base_route(gobj);
    let treedb = gobj_read_str_attr(gobj, "treedb_name");
    let shell = yui_shell_of(gobj);

    if(empty_string(base) || empty_string(treedb) || !shell) {
        return;
    }
    if(!empty_string(priv.seg)) {
        return;     /*  a deep link is being applied: leave it alone  */
    }
    priv.seg = treedb;
    yui_shell_navigate(shell, `${base}/${treedb}`, {push: false});
}

/***************************************************************
 *  This tab's route, and the hosted view's under it.
 ***************************************************************/
function base_route(gobj)
{
    return gobj_read_str_attr(gobj, "base_route");
}

function view_base_route(gobj)
{
    let base = base_route(gobj);
    let treedb = gobj_read_str_attr(gobj, "treedb_name");
    if(empty_string(base) || empty_string(treedb)) {
        return "";
    }
    return `${base}/${treedb}`;
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
        return -1;      /*  a tab with no route of its own: nothing to mirror  */
    }
    if(seg === priv.seg) {
        return 0;       /*  echo of what we just applied  */
    }
    priv.seg = seg;
    yui_shell_navigate(shell, seg ? `${base}/${seg}` : base, {push: true});
    return 0;
}

/***************************************************************
 *  Apply the part of the subpath the hosted view owns: a bare
 *  topic opens its table, `<topic>/info` its info panel, `schema`
 *  the schema-graph landing, and nothing at all the topic grid.
 ***************************************************************/
function apply_view_seg(gobj, seg)
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
 *  The apply button: `is-warning` while this tab knows of a write
 *  that no restart has published yet.
 ***************************************************************/
function render_apply(gobj)
{
    let priv = gobj.priv;
    if(!priv.$apply || !priv.$pending) {
        return;
    }
    priv.$apply.classList.toggle("is-warning", priv.dirty);
    priv.$pending.classList.toggle("is-hidden", !priv.dirty);
}

/***************************************************************
 *  True when an answer carries OUR markers (the link re-publishes
 *  every answer of the session to every panel).
 ***************************************************************/
function is_ours(gobj, kw)
{
    return msg_iev_read_key(kw, "console_purpose") === PURPOSE &&
        msg_iev_read_key(kw, "console_node") === gobj_read_str_attr(gobj, "node") &&
        msg_iev_read_key(kw, "console_yuno") === gobj_read_str_attr(gobj, "yuno_id");
}

/***************************************************************
 *  One step of the apply sequence. Each of the three commands
 *  answers ONCE and only when it is DONE: kill-yuno waits for the
 *  killed yuno's channel to close, run-yuno for the launched one to
 *  connect back (that is why `play=0` — the implicit play would add
 *  a second answer). So the sequence needs no timer and no polling:
 *  every step is driven by the answer of the one before.
 ***************************************************************/
function send_apply_step(gobj, step, cmd_line)
{
    let priv = gobj.priv;
    let node = gobj_read_str_attr(gobj, "node");
    let yuno = gobj_read_str_attr(gobj, "yuno_id");
    let link = link_service(gobj);

    if(!link || !agent_link_is_connected(link)) {
        log_error(`${gobj_short_name(gobj)}: cannot '${step}' — not in session`);
        return -1;
    }

    /*  A DEADLINE, which is a real time and not a deferral: an agent
     *  without the ac_final_count fix drops the answer of these commands
     *  entirely (see the SDK CHANGELOG), and the first step of the
     *  sequence is the KILL — waiting in silence there leaves the yuno
     *  dead with nobody told. */
    clear_apply_timer(gobj);
    /*  window.setTimeout, NOT gobj-js's set_timeout(gobj, msec): that one
     *  drives a C_TIMER gobj, and called browser-style it just logs
     *  "not GObj TYPE" and arms nothing. Importing it shadows the global,
     *  which is how this deadline silently did not exist.  */
    priv.apply_timer = setTimeout(function() {
        priv.apply_timer = null;
        gobj_send_event(gobj, "EV_APPLY_TIMEOUT", {step: step}, gobj);
    }, APPLY_TIMEOUT);
    let kw_send = {agent_id: node, cmd2agent: cmd_line};
    msg_iev_write_key(kw_send, "console_purpose", PURPOSE);
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno);
    msg_iev_write_key(kw_send, "apply_step", step);
    agent_link_command(link, "command-agent", kw_send);
    return 0;
}

/***************************************************************
 *  Disarm the deadline of the step in flight.
 ***************************************************************/
function clear_apply_timer(gobj)
{
    let priv = gobj.priv;
    if(priv.apply_timer) {
        clearTimeout(priv.apply_timer);
        priv.apply_timer = null;
    }
}

/***************************************************************
 *  The apply sequence ended. Whatever the yuno is now, discovery
 *  says it — and re-mounting from that answer is what makes the tab
 *  show the schema the yuno has actually re-read.
 *
 *  A failure is reported as a toast, not as the notice: discovery
 *  replaces the notice with the view a second later, and an error
 *  that disappears before it is read is not reported at all.
 ***************************************************************/
function end_apply(gobj, error_comment)
{
    let priv = gobj.priv;

    clear_apply_timer(gobj);
    if(error_comment) {
        yui_shell_show_error(yui_shell_of(gobj), error_comment, {t: t});
    } else {
        priv.dirty = false;
    }
    priv.notice = "";
    render_apply(gobj);
    start_discovery(gobj);
    render_state(gobj);
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

    render_apply(gobj);
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
    let state = gobj_current_state(gobj);
    let key;
    if(state === "ST_KILLING" || state === "ST_STARTING" || state === "ST_PLAYING") {
        key = "applying";
    } else if(empty_string(gobj_read_str_attr(gobj, "yuno_id"))) {
        key = "select a yuno";
    } else if(!agent_link_is_connected(link_service(gobj))) {
        key = "not connected to an agent";
    } else if(state === "ST_EMPTY") {
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
 *  Session up with nothing mounted: discover — but NEXT CYCLE.
 *
 *  We are inside the link's publication, and the ADAPTER (built at
 *  the end of discovery) is another subscriber of the same event.
 *  Discovering from here would end up starting the view — whose
 *  mt_start fetches the schema — while the adapter may not have been
 *  given the edge yet, so its own state would still say "not in
 *  session" and the fetch would be refused.
 *
 *  A deferral is NOT a time, so it is a posted event and not a timer:
 *  the event keeps its name in the trace, which a generic timeout
 *  would not.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    gobj_post_event(gobj, "EV_DISCOVER", {}, gobj);
    return 0;
}

/***************************************************************
 *  The deferred discovery of ac_on_open.
 ***************************************************************/
function ac_discover(gobj, event, kw, src)
{
    gobj.priv.notice = "";
    start_discovery(gobj);
    render_state(gobj);
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
    stamp_treedb_in_url(gobj);
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
        render_state(gobj);
        return 0;
    }
    /*  From the URL (kw.seg) the position is already in the address bar
     *  and only the view's half is left to apply; from the selector it is
     *  a user move, so the URL follows it.  */
    if(kw && typeof kw.seg === "string") {
        apply_view_seg(gobj, kw.seg);
    } else {
        navigate_seg(gobj, name);
    }
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The hosted view selected a topic: mirror it into the URL as
 *  `<treedb>/<topic>`, so a reload or a shared link lands on it.
 *  An EMPTY topic is the way back to the topic grid.
 ***************************************************************/
function ac_view_notice(gobj, event, kw, src)
{
    let topic = kw ? kw.topic : undefined;
    let treedb = gobj_read_str_attr(gobj, "treedb_name");

    if(topic === undefined || empty_string(treedb)) {
        return 0;   /*  a stray echo, or nothing mounted  */
    }
    navigate_seg(gobj, topic ? `${treedb}/${topic}` : treedb);
    return 0;
}

/***************************************************************
 *  The shell moved. Only OUR tab's route matters — several of
 *  these tabs are open at once — and under it the first segment is
 *  the treedb (ours) and the rest is the view's.
 *
 *  Changing treedb from the URL is a REMOUNT, so it goes through
 *  the same event the selector sends; the view's part is applied
 *  after it, when the schema is in.
 ***************************************************************/
function ac_route_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let base = base_route(gobj);

    if(empty_string(base) || !kw || kw.base !== base) {
        return 0;   /*  not our tab  */
    }
    let seg = kw.subpath || "";
    if(seg === (priv.seg || "")) {
        return 0;   /*  the echo of what we just navigated  */
    }
    priv.seg = seg;

    let cut = seg.indexOf("/");
    let treedb = (cut < 0) ? seg : seg.slice(0, cut);
    let rest = (cut < 0) ? "" : seg.slice(cut + 1);

    if(!empty_string(treedb) && treedb !== gobj_read_str_attr(gobj, "treedb_name")) {
        gobj_send_event(gobj, "EV_SELECT_TREEDB", {treedb: treedb, seg: rest}, gobj);
        return 0;
    }
    apply_view_seg(gobj, rest);
    return 0;
}

/***************************************************************
 *  The hosted view WROTE a record. The treedb has it; the yuno that
 *  opened the treedb has not re-read it, so from here on this tab
 *  carries a change nobody has applied. Say so on the button.
 ***************************************************************/
function ac_record_written(gobj, event, kw, src)
{
    gobj.priv.dirty = true;
    render_apply(gobj);
    return 0;
}

/***************************************************************
 *  Apply asked for. What it does is restart the owning yuno, and
 *  that disconnects every client of it — so it is confirmed, with
 *  the yuno named, before anything is sent.
 ***************************************************************/
function ac_apply_changes(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(priv.modal) {
        return 0;   /*  already asking  */
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to confirm the apply`);
        return 0;
    }
    let label = gobj_read_str_attr(gobj, "yuno_label") ||
                gobj_read_str_attr(gobj, "yuno_id");

    let $content = createElement2(
        ["div", {class: "TREEDB_APPLY_DIALOG box"}, [
            ["p", {class: "TREEDB_APPLY_TARGET has-text-weight-bold mb-2"},
                `${label} · ${gobj_read_str_attr(gobj, "node")}`],
            ["p", {class: "TREEDB_APPLY_WARN mb-4", i18n: "apply restart warning"},
                t("apply restart warning")],
            ["div", {class: "TREEDB_APPLY_ACTIONS is-align-items-center",
                     style: "display:flex; gap:.5rem; justify-content:flex-end;"}, [
                ["button", {class: "button TREEDB_APPLY_CANCEL"},
                    [["span", {i18n: "cancel"}, t("cancel")]],
                    {click: (e) => {
                        e.stopPropagation();
                        gobj_send_event(gobj, "EV_APPLY_CANCELLED", {}, gobj);
                    }}
                ],
                ["button", {class: "button is-warning TREEDB_APPLY_CONFIRM"},
                    [
                        ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                        ["span", {i18n: "apply"}, t("apply")]
                    ],
                    {click: (e) => {
                        e.stopPropagation();
                        gobj_send_event(gobj, "EV_APPLY_CONFIRMED", {}, gobj);
                    }}
                ]
            ]]
        ]]
    );

    priv.modal = yui_shell_show_modal(shell, $content, {
        dialog: true,
        logical_class: "TREEDB_APPLY_DIALOG",
        title: "apply schema",
        t: t,
        on_close: function() {
            priv.modal = null;
        }
    });
    return 0;
}

/***************************************************************
 *  Confirmation dismissed.
 ***************************************************************/
function ac_apply_cancelled(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.modal) {
        priv.modal.close();
        priv.modal = null;
    }
    return 0;
}

/***************************************************************
 *  Confirmed: the yuno restarts. The view goes FIRST — its backend
 *  is about to die, and a view whose every request will fail is a
 *  lie on screen. Discovery re-mounts it at the end of the sequence.
 ***************************************************************/
function ac_apply_confirmed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let yuno = gobj_read_str_attr(gobj, "yuno_id");

    if(priv.modal) {
        priv.modal.close();
        priv.modal = null;
    }
    unmount_view(gobj);
    priv.notice = "";

    if(send_apply_step(gobj, "kill", `kill-yuno id="${yuno}"`) < 0) {
        end_apply(gobj, t("not connected to an agent"));
        return 0;
    }
    gobj_change_state(gobj, "ST_KILLING");
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The answer of the step this tab is waiting for. Two arrive per
 *  command, as everywhere in this console: the controlcenter's
 *  dispatch ack (stack frame `command-agent`, interesting only when
 *  it failed) and the agent's real answer.
 ***************************************************************/
function ac_apply_answer(gobj, event, kw, src)
{
    let yuno = gobj_read_str_attr(gobj, "yuno_id");
    const expected = {
        ST_KILLING:  "kill",
        ST_STARTING: "run",
        ST_PLAYING:  "play"
    };
    let state = gobj_current_state(gobj);

    if(!is_ours(gobj, kw)) {
        return 0;
    }
    if(msg_iev_read_key(kw, "apply_step") !== expected[state]) {
        return 0;   /*  a late answer of another step (or of a discovery)  */
    }

    let stack = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let outer = kw_get_str(gobj, stack, "command", "", 0);
    let failed = (typeof kw.result === "number" && kw.result < 0);

    if(outer === "command-agent" && !failed) {
        return 0;   /*  dispatch ok: the real answer is still coming  */
    }
    if(failed) {
        end_apply(gobj, kw.comment || `${state}: failed`);
        return 0;
    }

    /*  `play=0` on purpose: with the implicit play, run-yuno answers
     *  TWICE (its own aggregate and the play), and a step that answers
     *  twice moves the sequence twice.  */
    if(state === "ST_KILLING") {
        if(send_apply_step(gobj, "run", `run-yuno id="${yuno}" play=0`) < 0) {
            end_apply(gobj, t("not connected to an agent"));
            return 0;
        }
        gobj_change_state(gobj, "ST_STARTING");
        return 0;
    }
    if(state === "ST_STARTING") {
        if(send_apply_step(gobj, "play", `play-yuno id="${yuno}"`) < 0) {
            end_apply(gobj, t("not connected to an agent"));
            return 0;
        }
        gobj_change_state(gobj, "ST_PLAYING");
        return 0;
    }

    /*  ST_PLAYING: the yuno is up and playing with the schema it just
     *  re-read. Discovery re-mounts the view against it.  */
    end_apply(gobj, "");
    return 0;
}

/***************************************************************
 *  The session dropped mid-sequence: the answer we wait for will
 *  never come, and what the yuno is now is unknown.
 ***************************************************************/
function ac_apply_broken(gobj, event, kw, src)
{
    clear_apply_timer(gobj);
    gobj.priv.notice = "";
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The step took too long. The commands answer when they are DONE,
 *  so silence is not slowness: it is an agent that cannot answer
 *  them (see the SDK CHANGELOG on ac_final_count). Say it with the
 *  step named, because after a `kill` the yuno is DOWN.
 ***************************************************************/
function ac_apply_timeout(gobj, event, kw, src)
{
    let step = (kw && kw.step) || "";
    let yuno = gobj_read_str_attr(gobj, "yuno_label") ||
               gobj_read_str_attr(gobj, "yuno_id");

    log_error(
        `${gobj_short_name(gobj)}: the node's agent did not answer '${step}' ` +
        `for '${yuno}'`
    );
    end_apply(gobj, `${t("apply timeout")} (${step})`);
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
        ["EV_RECORD_WRITTEN",       ac_record_written,    null]
    ];
    /*  The apply confirmation can be answered in any state it can be
     *  opened in, and it can only be opened where there is something to
     *  apply — but a dialog outlives a state change, so the two dismiss
     *  events are legal wherever it can still be on screen.  */
    const dialog_events = [
        ["EV_APPLY_CANCELLED",      ac_apply_cancelled,   null]
    ];
    /*  The shell broadcasts to every subscriber, so this arrives in any
     *  state; the action drops what is not this tab's route.  */
    const route_events = [
        ["EV_ROUTE_CHANGED",        ac_route_changed,     null]
    ];
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_DISCOVERING", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          "ST_IDLE"],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_EMPTY", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_READY", [
            ["EV_ON_OPEN",              ac_on_open_ready,     null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ["EV_SELECT_TREEDB",        ac_select_treedb,     null],
            ["EV_APPLY_CHANGES",        ac_apply_changes,     null],
            ["EV_APPLY_CONFIRMED",      ac_apply_confirmed,   null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        /*  The restart, one state per command in flight, so the trace
         *  says which one is being waited for. Each answers once and only
         *  when it is done — see send_apply_step().  */
        ["ST_KILLING", [
            ["EV_MT_COMMAND_ANSWER",    ac_apply_answer,      null],
            ["EV_APPLY_TIMEOUT",        ac_apply_timeout,     null],
            ["EV_ON_CLOSE",             ac_apply_broken,      "ST_IDLE"],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_STARTING", [
            ["EV_MT_COMMAND_ANSWER",    ac_apply_answer,      null],
            ["EV_APPLY_TIMEOUT",        ac_apply_timeout,     null],
            ["EV_ON_CLOSE",             ac_apply_broken,      "ST_IDLE"],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_PLAYING", [
            ["EV_MT_COMMAND_ANSWER",    ac_apply_answer,      null],
            ["EV_APPLY_TIMEOUT",        ac_apply_timeout,     null],
            ["EV_ON_CLOSE",             ac_apply_broken,      "ST_IDLE"],
            ...dialog_events,
            ...route_events,
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
        ["EV_APPLY_CHANGES",     0],
        ["EV_APPLY_CONFIRMED",   0],
        ["EV_APPLY_CANCELLED",   0],
        ["EV_APPLY_TIMEOUT",     0],
        ["EV_DISCOVER",          0],
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
function register_c_agent_treedb()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_treedb};
