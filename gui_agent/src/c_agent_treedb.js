/***********************************************************************
 *          c_agent_treedb.js
 *
 *      C_AGENT_TREEDB — the Schemas workspace tab: the treedbs of ONE
 *      yuno of ONE node, reached through the agent by
 *      C_AGENT_TREEDB_LINK (see its header).
 *
 *      WHICH treedb is discovered, not assumed.  A yuno exposes its
 *      treedbs as SERVICES, so one round trip answers it:
 *          command-yuno id=<yuno> service=__yuno__ command=services
 *      and the `C_NODE` rows of that answer are the treedbs this console
 *      can talk to.  The tab opens `treedb_system_schema` — the one that
 *      holds the yuno's schemas AS DATA (treedbs -> topics -> cols), and
 *      the reason this workspace exists — and offers the rest beside it,
 *      because an operator already on the node should not need a second
 *      SPA and a second session to look at the data.
 *
 *      THE TREEDBS ARE A TREE OF NODES, not a `<select>`.  What the
 *      discovery answers is a level of navigation — yuno -> treedb ->
 *      topic — so it is declared as one: this tab builds a C_YUI_NODE
 *      rooted at its own route, with one child per discovered treedb,
 *      and each child is a `link` node whose viewer (C_AGENT_TREEDB_VIEW)
 *      owns everything below it in the url.  Two things follow, and both
 *      are the reason for the change: the way in is drawn by the tree
 *      (a strip of treedbs, a "<- back", or a breadcrumb — the operator
 *      chooses in Preferences, `nav_mode`), and the shape of the
 *      workspace reaches the site map by itself.
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
 *      (or `<treedb>/schema`). The first segment names a node of the
 *      tree and the rest is the tail its viewer owns, so a reload, a
 *      Back or a shared link lands where the operator was — and this
 *      tab does not route any of it by hand.
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

import {yui_node_set_nav_mode} from "@yuneta/gobj-ui/src/c_yui_node.js";
import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_shell_show_modal, yui_shell_show_error} from "@yuneta/gobj-ui/src/shell_modals.js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {agent_config_get_nav_mode} from "./c_agent_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TREEDB";

/*  The treedb every yuno with a C_TREEDB keeps its own schemas in.  */
const SYSTEM_TREEDB = "treedb_system_schema";

/*  Marker of the per-treedb `treedb-info` request: it answers whether this
 *  yuno is the MASTER of that treedb, which decides whether its editor is
 *  mounted read-only. Kept apart from the discovery marker below because the
 *  link re-publishes every answer to every panel.  */
const MASTER_PURPOSE = "treedbmaster";

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
SDATA(data_type_t.DTP_STRING,   "base_route",  0,  "",            "This tab's declared route: the tree of treedbs is rooted here"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,          "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,          "Root HTMLElement"),
SDATA_END()
];

let PRIVATE_DATA = {
    treedbs:     null,  /*  discovered C_NODE service names  */
    notice:      "",    /*  explicit text when a key does not say it all  */
    tree:        null,  /*  C_YUI_NODE root: one child per treedb  */
    dirty:       false, /*  something was written since the last apply  */
    seg:         null,  /*  subpath of the url under this tab  */
    apply_timer: null,  /*  deadline of the step in flight  */
    modal:       null,  /*  the apply confirmation  */
    $toolbar:    null,  /*  pending flag + apply  */
    $apply:      null,
    $pending:    null,
    $notice:     null,  /*  shown while there is no tree  */
    $body:       null,  /*  where the tree's container is mounted  */
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
    priv.master = {};             /*  treedb name -> true|false (absent = unknown)  */
    priv.master_left = 0;         /*  treedb-info answers still owed  */
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

    /*  The operator can re-shape the tree from Preferences while this
     *  tab is open: the choice is one attr of the config service, and
     *  the change arrives as an event, not as a re-mount.  */
    let config = gobj_find_service("agent_config", false);
    if(config) {
        gobj_subscribe_event(config, "EV_NAV_MODE_CHANGED", {}, gobj);
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
    if(priv.tree && gobj_is_running(priv.tree)) {
        gobj_stop(priv.tree);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 *
 *  The tree is a pure child: gobj_destroy cascades onto it, and with
 *  it onto every treedb view and adapter it holds.
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;

    if(priv.modal) {
        priv.modal.close();
        priv.modal = null;
    }
    priv.tree = null;
    priv.$toolbar = null;
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
 *  Root DOM: a wrapper this tab owns, so the tree of treedbs can be
 *  mounted (and rebuilt) inside it without the shell noticing.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    /*  What actually publishes an edited schema: the owning yuno has to
     *  re-read it, and that means a restart. The button says `apply`
     *  because that is the intent; the confirmation says what it does.  */
    priv.$apply = createElement2(
        ["button", {class: "TREEDB_APPLY button",
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
 *  This tab's route: the tree of treedbs is rooted here, and a
 *  treedb node's own route is this plus its name.
 ***************************************************************/
function base_route(gobj)
{
    return gobj_read_str_attr(gobj, "base_route");
}

/***************************************************************
 *  The navigation mode the operator chose in Preferences — one for
 *  the app, read from the config service (default "stack").
 ***************************************************************/
function nav_mode(gobj)
{
    let config = gobj_find_service("agent_config", false);

    if(!config) {
        return "stack";
    }
    return agent_config_get_nav_mode(config);
}

/***************************************************************
 *  Ask ONE treedb whether this yuno is its MASTER (`treedb-info`,
 *  SDK >= 7.13.0). Only the master can write — the yuno refuses every
 *  write on a replica — so this is what decides whether the editor is
 *  mounted read-only instead of offering buttons that cannot work.
 *
 *  A link that is down answers itself: the count has to reach zero or
 *  the tab would wait in ST_DISCOVERING forever.
 ***************************************************************/
function probe_master(gobj, treedb_name)
{
    let link = link_service(gobj);
    let node = gobj_read_str_attr(gobj, "node");
    let yuno_id = gobj_read_str_attr(gobj, "yuno_id");

    if(!link || !agent_link_is_connected(link) || empty_string(node) || empty_string(yuno_id)) {
        master_answered(gobj, treedb_name, null);
        return;
    }
    let kw_send = {
        agent_id:  node,
        cmd2agent: `command-yuno id="${yuno_id}" service="${treedb_name}" command="treedb-info"`
    };
    msg_iev_write_key(kw_send, "console_purpose", MASTER_PURPOSE);
    /*  Tagged like the discovery request: the answer has to be recognisable
     *  as THIS tab's, or every other tab counts it as one of its own.  */
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno_id);
    msg_iev_write_key(kw_send, "console_treedb", treedb_name);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  One child spec per discovered treedb.
 *
 *  A `link` and not a branch: below a treedb there are topics,
 *  records and columns — data, and one gobj per row is exactly what
 *  a link node exists to prevent. The viewer gets the node's route
 *  as its base and owns everything under it.
 ***************************************************************/
function treedb_children(gobj)
{
    let priv = gobj.priv;
    let base = base_route(gobj);
    let children = [];

    for(let name of priv.treedbs) {
        children.push({
            id:    name,
            label: name,
            icon:  "yi-hexagon-nodes",
            link: {
                kind:   "treedb",
                gclass: "C_AGENT_TREEDB_VIEW",
                kw: {
                    node:        gobj_read_str_attr(gobj, "node"),
                    yuno_id:     gobj_read_str_attr(gobj, "yuno_id"),
                    treedb_name: name,
                    base_route:  `${base}/${name}`,
                    /*  Read-only ONLY when the yuno SAID it is not the master.
                     *  Unknown stays writable — see ac_master_answer.  */
                    readonly:    priv.master[name] === false
                }
            }
        });
    }
    return children;
}

/***************************************************************
 *  Build the tree of treedbs, rooted at this tab's route.
 *
 *  The projections are the two shapes this level can take: the tip
 *  (no treedb chosen yet) shows its children as CARDS, and a chosen
 *  one keeps them as a strip above it — tabs where there is width,
 *  a "<- back" where there is not. What the operator actually sees
 *  is that filtered by `nav_mode`, which is theirs to choose.
 ***************************************************************/
function build_tree(gobj)
{
    let priv = gobj.priv;
    let base = base_route(gobj);

    if(priv.tree) {
        return 0;
    }
    if(empty_string(base)) {
        log_error(`${gobj_short_name(gobj)}: no route for this tab: no tree can be rooted`);
        return -1;
    }
    if(!priv.treedbs.length) {
        return -1;      /*  nothing to build: ST_EMPTY says it  */
    }

    priv.tree = gobj_create_pure_child(
        "treedbs",
        "C_YUI_NODE",
        {
            node_id:    "treedbs",
            /*  The root IS the yuno, so it says which one: the breadcrumb
             *  reads "gate_central^2020 / treedb_authzs" and the back bar
             *  "<- gate_central^2020". A name, not an i18n key — i18next
             *  answers an unknown key with the key itself, which is the
             *  name, and that is what a data label wants.  */
            label:      gobj_read_str_attr(gobj, "yuno_label") ||
                        gobj_read_str_attr(gobj, "yuno_id"),
            base_route: base,
            nav_mode:   nav_mode(gobj),
            projection: {
                index:  {layout: "cards"},
                chrome: [
                    {layout: "tabs",    show_on: ">=tablet"},
                    {layout: "backbar", show_on: "<tablet"}
                ]
            },
            children:   treedb_children(gobj)
        },
        gobj
    );
    if(!priv.tree) {
        log_error(`${gobj_short_name(gobj)}: cannot create the treedb tree`);
        return -1;
    }
    let $t = gobj_read_attr(priv.tree, "$container");
    if($t) {
        priv.$body.appendChild($t);
    } else {
        log_error(`${gobj_short_name(gobj)}: the tree exposes no $container`);
    }
    gobj_start(priv.tree);
    return 0;
}

/***************************************************************
 *  Tear the tree down, and with it every treedb view and adapter
 *  it holds: the yuno they talk to is about to be restarted, and a
 *  view whose every request will fail is a lie on screen.
 ***************************************************************/
function destroy_tree(gobj)
{
    let priv = gobj.priv;

    if(!priv.tree) {
        return;
    }
    let $t = gobj_read_attr(priv.tree, "$container");
    if(gobj_is_running(priv.tree)) {
        gobj_stop(priv.tree);
    }
    gobj_destroy(priv.tree);
    priv.tree = null;
    /*  The node removes its own container in mt_destroy; this is the
     *  case where it did not.  */
    if($t && $t.parentNode) {
        $t.parentNode.removeChild($t);
    }
}

/***************************************************************
 *  Put the tree on the position the url already carries.
 *
 *  A tree that has just been built has heard no EV_ROUTE_CHANGED —
 *  the shell broadcasts one when the route CHANGES, and here it is
 *  the tree that arrived, not the user. So it is handed the current
 *  position in the very shape the shell would have given it.
 ***************************************************************/
function activate_tree(gobj)
{
    let priv = gobj.priv;
    let base = base_route(gobj);
    let seg = priv.seg || "";

    if(!priv.tree || empty_string(base)) {
        return;
    }
    gobj_send_event(priv.tree, "EV_ROUTE_CHANGED", {
        route:   seg ? `${base}/${seg}` : base,
        base:    base,
        subpath: seg
    }, gobj);
}

/***************************************************************
 *  Open the default treedb when the url says nothing more than the
 *  tab itself: `treedb_system_schema` is what this workspace is
 *  for, and landing on a card grid of one card to click is a step
 *  that says nothing. No Back entry: nobody navigated here.
 ***************************************************************/
function stamp_default_treedb(gobj)
{
    let priv = gobj.priv;
    let base = base_route(gobj);
    let shell = yui_shell_of(gobj);

    if(empty_string(base) || !shell || !priv.treedbs.length) {
        return;
    }
    if(!empty_string(priv.seg)) {
        return;     /*  a deep link is being applied: leave it alone  */
    }
    priv.seg = priv.treedbs[0];
    yui_shell_navigate(shell, `${base}/${priv.treedbs[0]}`, {push: false});
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
    let ready = !!priv.tree;

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





                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Session up with nothing mounted: discover — but NEXT CYCLE.
 *
 *  We are inside the link's publication, and the ADAPTERS (built at
 *  the end of discovery, one per treedb view) are other subscribers
 *  of the same event. Discovering from here would end up starting a
 *  view — whose mt_start fetches the schema — while its adapter may
 *  not have been given the edge yet, so its own state would still
 *  say "not in session" and the fetch would be refused.
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
 *  Session up while the tree is already built: nothing is
 *  re-discovered — the treedb views re-enable their own remote
 *  actions, each one from the same edge — and this tab only
 *  repaints the chrome that reads the session state.
 ***************************************************************/
function ac_on_open_ready(gobj, event, kw, src)
{
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  Session down. The tree stays up (a schema already fetched is
 *  still valid and each adapter re-resolves the link on its next
 *  request); a discovery in flight will never be answered.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
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

    /*  Two kinds of answer are OURS: the `services` discovery and the
     *  per-treedb `treedb-info`. Anything else belongs to another panel.  */
    let purpose = msg_iev_read_key(kw, "console_purpose");
    if(purpose !== PURPOSE && purpose !== MASTER_PURPOSE) {
        return 0;   /*  another panel's answer  */
    }

    /*  And it has to be THIS tab's. The filter used to sit below, guarding
     *  the discovery only, and the `treedb-info` branch went in above it: so
     *  every open Schemas tab — and the empty-state view, which has no node
     *  and no route — consumed every other tab's master answers, counted them
     *  as its own and built a tree from them. On the empty-state view that
     *  surfaced as "no route for this tab: no tree can be rooted".  */
    if(msg_iev_read_key(kw, "console_node") !== gobj_read_str_attr(gobj, "node") ||
            msg_iev_read_key(kw, "console_yuno") !== gobj_read_str_attr(gobj, "yuno_id")) {
        return 0;   /*  another tab's  */
    }

    if(purpose === MASTER_PURPOSE) {
        let stack_m = msg_iev_get_stack(gobj, kw, "command_stack", false);
        let outer_m = kw_get_str(gobj, stack_m, "command", "", 0);
        let failed_m = (typeof kw.result === "number" && kw.result < 0);
        if(outer_m === "command-agent" && !failed_m) {
            return 0;   /*  dispatch ack: the real answer is still coming  */
        }
        let name = msg_iev_read_key(kw, "console_treedb") || "";
        let master = (!failed_m && kw.data && typeof kw.data.master === "boolean")
            ? kw.data.master : null;
        return master_answered(gobj, name, master);
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

    /*  Discovery is not done: WHICH of them can be written is part of what
     *  the tree declares, and it has to be known BEFORE the nodes are built
     *  — the library reads `readonly` when it draws a topic's toolbar, once.
     *  So ask each treedb and stay in ST_DISCOVERING until they answer.  */
    priv.master = {};
    priv.master_left = priv.treedbs.length;
    for(let name of priv.treedbs) {
        probe_master(gobj, name);
    }
    return 0;
}

/***************************************************************
 *  One `treedb-info` answer (or its failure). When the last one lands,
 *  the tree is built — which is what ST_DISCOVERING was waiting for.
 *
 *  A treedb whose answer FAILED stays absent from priv.master, i.e.
 *  unknown, and unknown is treated as WRITABLE: a node older than the
 *  command cannot answer, and locking its editor would take away an
 *  editing session that works today. On such a node a write to a replica
 *  is still accepted and lost — the pre-7.13.0 behaviour, and a reason to
 *  upgrade the node rather than to guess here.
 ***************************************************************/
function master_answered(gobj, treedb_name, master)
{
    let priv = gobj.priv;

    if(priv.master_left <= 0) {
        /*  Nothing owed: a late or duplicated answer must not walk into the
         *  build below. Discovery is finished (or was never asked for).  */
        return 0;
    }
    if(treedb_name && typeof master === "boolean") {
        priv.master[treedb_name] = master;
    }
    priv.master_left--;
    if(priv.master_left > 0) {
        return 0;   /*  still waiting for the others  */
    }

    /*  A re-discovery answers a yuno that has just restarted, so the
     *  tree is built from what it says NOW: an old one would keep a
     *  node for a treedb the yuno no longer opens.  */
    destroy_tree(gobj);
    if(build_tree(gobj) < 0) {
        gobj_change_state(gobj, "ST_EMPTY");
        render_state(gobj);
        return 0;   /*  Error already logged (or simply nothing to build)  */
    }
    stamp_default_treedb(gobj);
    activate_tree(gobj);
    gobj_change_state(gobj, "ST_READY");
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  The shell moved. Only OUR tab's route matters — several of these
 *  tabs are open at once — and all this tab does with it is REMEMBER
 *  the position: the tree hears the same broadcast and resolves the
 *  subpath itself (which treedb, and what its viewer does under it).
 *  The position is kept because a tree built later — the first
 *  discovery, or the one that follows an apply — has to be put on it
 *  (activate_tree), and because it says whether the url already
 *  carries a treedb (stamp_default_treedb).
 ***************************************************************/
function ac_route_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let base = base_route(gobj);

    if(empty_string(base) || !kw || kw.base !== base) {
        return 0;   /*  not our tab  */
    }
    priv.seg = kw.subpath || "";
    return 0;
}

/***************************************************************
 *  The navigation mode changed in Preferences: the tree is not
 *  rebuilt for it — a mode FILTERS what each node draws, so the
 *  live tree is simply told, and the open treedb stays open.
 ***************************************************************/
function ac_nav_mode_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let mode = (kw && kw.nav_mode) || "";

    if(!priv.tree || empty_string(mode)) {
        return 0;   /*  nothing built yet: build_tree reads the choice  */
    }
    yui_node_set_nav_mode(priv.tree, mode);
    return 0;
}

/***************************************************************
 *  A treedb view of this tab WROTE a record (it sends this up: see
 *  its header). The treedb has it; the yuno that opened the treedb
 *  has not re-read it, so from here on this tab carries a change
 *  nobody has applied. Say so on the button.
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
                ["button", {class: "TREEDB_APPLY_CANCEL button"},
                    [["span", {i18n: "cancel"}, t("cancel")]],
                    {click: (e) => {
                        e.stopPropagation();
                        gobj_send_event(gobj, "EV_APPLY_CANCELLED", {}, gobj);
                    }}
                ],
                ["button", {class: "TREEDB_APPLY_CONFIRM button is-warning"},
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
 *  Confirmed: the yuno restarts. The tree goes FIRST — its backend
 *  is about to die, and a view whose every request will fail is a
 *  lie on screen. Discovery rebuilds it at the end of the sequence.
 ***************************************************************/
function ac_apply_confirmed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let yuno = gobj_read_str_attr(gobj, "yuno_id");

    if(priv.modal) {
        priv.modal.close();
        priv.modal = null;
    }
    destroy_tree(gobj);
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
        ["EV_ROUTE_CHANGED",        ac_route_changed,     null],
        ["EV_NAV_MODE_CHANGED",     ac_nav_mode_changed,  null]
    ];
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_DISCOVERING", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          "ST_IDLE"],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_EMPTY", [
            ["EV_ON_OPEN",              ac_on_open,           null],
            ["EV_DISCOVER",             ac_discover,          null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
            ...dialog_events,
            ...route_events,
            ...view_events
        ]],
        ["ST_READY", [
            ["EV_ON_OPEN",              ac_on_open_ready,     null],
            ["EV_ON_CLOSE",             ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer, null],
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
        ["EV_APPLY_CHANGES",     0],
        ["EV_APPLY_CONFIRMED",   0],
        ["EV_APPLY_CANCELLED",   0],
        ["EV_APPLY_TIMEOUT",     0],
        ["EV_DISCOVER",          0],
        ["EV_ROUTE_CHANGED",     0],
        ["EV_NAV_MODE_CHANGED",  0],
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
