/***********************************************************************
 *          c_agent_treedb_link.js
 *
 *      C_AGENT_TREEDB_LINK — the ROUTING ADAPTER that lets gobj-ui's
 *      treedb views talk to a treedb living inside a yuno of a remote
 *      node, through the ONE control-center session this app already
 *      has.
 *
 *      WHY IT EXISTS
 *      -------------
 *      A treedb view issues its requests with
 *          gobj_command(gobj_remote_yuno, "descs"/"nodes"/"update-node",
 *                       kw, src = itself)
 *      and expects the answer as EV_MT_COMMAND_ANSWER.  With a direct
 *      C_IEVENT_CLI that is one hop.  From this console the treedb is
 *      two hops away — control center -> node's agent -> the yuno — and
 *      each hop wraps the command in the next one's:
 *          command-agent agent_id=<node>
 *              cmd2agent="command-yuno id=<yuno> service=<treedb>
 *                         command=<the view's command>"
 *
 *      `gobj_command()` dispatches to `gclass.gmt.mt_command_parser`
 *      BEFORE anything else, so a gclass implementing it can take the
 *      view's command verbatim, re-wrap it, and answer the view in the
 *      shape it already understands.  Hand this gobj to
 *      `yui_mount_service_view()` as the `transport` and the library
 *      views work unchanged — no gobj-ui change, one login, one socket.
 *
 *      THE THREE THINGS IT WAS BORN KNOWING
 *      ------------------------------------
 *      1. `command-yuno` uses its WHOLE kw as the filter that SELECTS
 *         the yuno (`gobj_list_nodes(..., kw, ...)` in cmd_command_yuno),
 *         so a top-level `id` names the yuno, never the node the view
 *         means, and the command answers "Yuno not found".  The filter
 *         keeps only keys that are columns of the agent's `yunos` topic,
 *         so `treedb_name` / `topic_name` / `record` / `options` travel
 *         safely — a top-level `id` does not, and is refused loudly here
 *         instead of dying as a mystery two hops away.
 *
 *      2. The controlcenter's `command-agent` DELETES id/command/service
 *         and the other command-yuno parameters from the kw before
 *         forwarding (they belong to the agent's command, not to the
 *         controlcenter's), which is why they travel INLINE in the
 *         cmd2agent command line and not as kw fields.
 *
 *      3. The answer arrives with the command_stack frame of the hop
 *         that produced it, and the view keys its whole answer handling
 *         on that frame's `command` being ITS command ("descs", "nodes",
 *         …).  So the adapter pushes the original frame back on top
 *         before delivering — the view never learns it was routed.
 *
 *      WHAT IS LOST BY ROUTING: the live subscriptions.  `command-yuno`
 *      is request/response, so the treedb's EV_TREEDB_NODE_* never
 *      travel.  A schema does not change under you, so the cost is
 *      small — but a view that wrote a record would show a stale table,
 *      which reads as a failed write.  For its OWN writes the adapter
 *      therefore echoes the corresponding EV_TREEDB_NODE_* locally, from
 *      the answer it just received.  It is a LOCAL echo, not the
 *      treedb's event: another operator's change is not seen here.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_read_str_attr, gobj_read_pointer_attr,
    gobj_subscribe_event, gobj_unsubscribe_event,
    gobj_change_state, gobj_current_state,
    gobj_publish_event,
    gobj_send_event,
    gobj_short_name,
    gobj_is_destroying,
    msg_iev_write_key,
    msg_iev_read_key,
    msg_iev_push_stack,
    msg_iev_get_stack,
    kw_get_str,
    is_object,
    empty_string,
} from "@yuneta/gobj-js";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_TREEDB_LINK";

/*  Marker every request carries in __md_iev__, echoed back by the whole
 *  chain.  The other panels of this app filter on `console_purpose`
 *  (the Console swallows any purpose but its own, the pickers theirs),
 *  so a purpose of our own keeps our answers invisible to them — and
 *  theirs invisible to us.  */
const PURPOSE = "treedb";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),

SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,  "C_AGENT_LINK service (the control-center session)"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",    "agent_id of the node holding the yuno"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",    "Id of the yuno holding the treedb"),
SDATA(data_type_t.DTP_STRING,   "treedb_name", 0,  "",    "Service name of the treedb inside that yuno"),
SDATA_END()
];

let PRIVATE_DATA = {
    seq:     0,     /*  request counter, echoed in __md_iev__  */
    pending: null,  /*  seq -> {view, command, md_command, treedb_name, topic_name, record}  */
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

    priv.seq = 0;
    priv.pending = {};

    /*
     *  SERVICE subscription model
     *
     *  A transport's audience is whoever asks for it — here the hosted
     *  view, which subscribes to the node events on its `gobj_remote_yuno`
     *  exactly as it would on a C_IEVENT_CLI. The parent is NOT the
     *  audience: with the CHILD model it received the echoed
     *  EV_TREEDB_NODE_* it has no reason to declare, and answered
     *  "Event NOT DEFINED in state" on every write.
     */
    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }
}

/***************************************************************
 *          Framework Method: Start
 *
 *  The link re-publishes every answer to all its subscribers, so
 *  ours are picked out by the marker (see ac_mt_command_answer).
 *  The session may already be up when this tab is opened, so the
 *  state is set from it — the edges only arrive from now on.
 ***************************************************************/
function mt_start(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(link) {
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_CLOSE", {}, gobj);
        if(agent_link_is_connected(link)) {
            gobj_change_state(gobj, "ST_SESSION");
        }
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    if(link) {
        gobj_unsubscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
        gobj_unsubscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_unsubscribe_event(link, "EV_ON_CLOSE", {}, gobj);
    }
    gobj_change_state(gobj, "ST_DISCONNECTED");
    priv.pending = {};
}

/***************************************************************
 *          Framework Method: Command parser
 *
 *  THE PIECE: the view's command, re-wrapped for the two hops.
 *  Returns null (asynchronous answer), exactly like the
 *  C_IEVENT_CLI the views normally talk to.
 ***************************************************************/
function mt_command_parser(gobj, command, kw, src)
{
    let priv = gobj.priv;

    if(!kw) {
        kw = {};
    }
    if(empty_string(command)) {
        log_error(`${gobj_short_name(gobj)}: command without name`);
        return null;
    }

    let node    = gobj_read_str_attr(gobj, "node");
    let yuno_id = gobj_read_str_attr(gobj, "yuno_id");
    let treedb  = kw_get_str(gobj, kw, "service", "", 0) ||
                  gobj_read_str_attr(gobj, "treedb_name");
    let link    = gobj_read_attr(gobj, "link_svc");

    if(empty_string(node) || empty_string(yuno_id) || empty_string(treedb)) {
        log_error(
            `${gobj_short_name(gobj)}: cannot route '${command}' ` +
            `— node/yuno_id/treedb_name incomplete`
        );
        return null;
    }
    if(!link || gobj_current_state(gobj) !== "ST_SESSION") {
        log_error(`${gobj_short_name(gobj)}: cannot route '${command}' — not in session`);
        return null;
    }

    /*  Trap 1: a top-level `id` would name the YUNO, not the node the
     *  caller means, and command-yuno would answer "Yuno not found".
     *  The library views send the record nested (`record={…}`); anything
     *  that does not has to be fixed at the caller, so say so here
     *  instead of routing a request that cannot work.  */
    if(Object.prototype.hasOwnProperty.call(kw, "id")) {
        log_error(
            `${gobj_short_name(gobj)}: '${command}' carries a top-level 'id' ` +
            `— it would filter the YUNO, not the node. Send it nested.`
        );
        return null;
    }

    let seq = ++priv.seq;

    /*  Everything the view sent travels as kw, except what belongs to
     *  the hops: `service` is the INNER routing (inline in cmd2agent, and
     *  deleted from the kw by the controlcenter anyway) and
     *  `__md_command__` is the view's own echo, which we keep here and
     *  give back on the answer.  */
    let kw_send = Object.assign({}, kw);
    delete kw_send.service;
    delete kw_send.__md_command__;

    kw_send.agent_id = node;
    kw_send.cmd2agent =
        `command-yuno id="${yuno_id}" service="${treedb}" command="${command}"`;

    msg_iev_write_key(kw_send, "console_purpose", PURPOSE);
    msg_iev_write_key(kw_send, "treedb_seq", String(seq));

    priv.pending[seq] = {
        view:        src,
        command:     command,
        md_command:  is_object(kw.__md_command__) ? kw.__md_command__ : {},
        treedb_name: kw_get_str(gobj, kw, "treedb_name", treedb, 0),
        topic_name:  kw_get_str(gobj, kw, "topic_name", "", 0),
        record:      is_object(kw.record) ? kw.record : null
    };

    /*  No `src`: the answer is addressed to the link service, which
     *  re-publishes it to every panel — the app's established pattern.  */
    agent_link_command(link, "command-agent", kw_send);

    return null;    /*  asynchronous answer  */
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Give the answer to the view that asked, with ITS command back on
 *  top of the command_stack: the view keys everything it does on that
 *  frame, and what arrives carries the frame of the routing hop.
 ***************************************************************/
function deliver(gobj, pend, kw)
{
    if(!pend.view || gobj_is_destroying(pend.view)) {
        return;     /*  the tab was closed while the answer travelled  */
    }
    msg_iev_push_stack(gobj, kw, "command_stack", {
        command: pend.command,
        kw:      pend.md_command
    });
    gobj_send_event(pend.view, "EV_MT_COMMAND_ANSWER", kw, gobj);
}

/***************************************************************
 *  Local echo of the treedb node event that the routed path cannot
 *  carry (see the header). Only for OUR OWN successful writes, and
 *  only what the answer proves: create/update give back the stored
 *  node, delete gives back nothing, so the record we sent is used.
 ***************************************************************/
function echo_node_event(gobj, pend, kw)
{
    let event;
    let node;

    switch(pend.command) {
        case "create-node":
            event = "EV_TREEDB_NODE_CREATED";
            node = is_object(kw.data) ? kw.data : pend.record;
            break;
        case "update-node":
            event = "EV_TREEDB_NODE_UPDATED";
            node = is_object(kw.data) ? kw.data : pend.record;
            break;
        case "delete-node":
            event = "EV_TREEDB_NODE_DELETED";
            node = pend.record;
            break;
        default:
            return;     /*  not a write: nothing to echo  */
    }
    if(!node || empty_string(pend.topic_name)) {
        return;
    }
    gobj_publish_event(gobj, event, {
        treedb_name: pend.treedb_name,
        topic_name:  pend.topic_name,
        node:        node
    });
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  The link re-publishes EVERY answer of the session to EVERY panel.
 *  Ours carry our purpose and our seq; anything else belongs to the
 *  Console, a picker or a stats card.
 *
 *  Each routed request produces TWO answers: the controlcenter's
 *  synchronous dispatch ack ("Command sent to N nodes", whose stack
 *  frame is `command-agent`) and, later, the yuno's real answer.  The
 *  ack is swallowed on success and forwarded on failure — a dispatch
 *  that found no node is the only news the view will ever get.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(msg_iev_read_key(kw, "console_purpose") !== PURPOSE) {
        return 0;
    }
    let seq = msg_iev_read_key(kw, "treedb_seq");
    let pend = seq ? priv.pending[seq] : null;
    if(!pend) {
        return 0;   /*  another treedb tab's request  */
    }

    let stack = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let outer = kw_get_str(gobj, stack, "command", "", 0);

    if(outer === "command-agent") {
        if(typeof kw.result === "number" && kw.result < 0) {
            delete priv.pending[seq];
            deliver(gobj, pend, kw);
        }
        return 0;   /*  success: the real answer is still coming  */
    }

    delete priv.pending[seq];
    deliver(gobj, pend, kw);
    if(typeof kw.result === "number" && kw.result >= 0) {
        echo_node_event(gobj, pend, kw);
    }
    return 0;
}

/***************************************************************
 *  The session is up. The state is not decoration: the library asks
 *  its transport for it (`gobj_current_state(remote) === "ST_SESSION"`)
 *  to decide whether its remote-only actions are usable, so a façade
 *  that never leaves one state would answer that question wrong on
 *  every internal refresh.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    return 0;
}

/***************************************************************
 *  The session dropped: every request in flight died with it.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    gobj.priv.pending = {};
    return 0;
}




                    /***************************
                     *              FSM
                     ***************************/




/*---------------------------------------------*
 *          Global methods table
 *---------------------------------------------*/
const gmt = {
    mt_create:          mt_create,
    mt_start:           mt_start,
    mt_stop:            mt_stop,
    mt_command_parser:  mt_command_parser
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
     *  The two states of the SESSION this façade stands for, named as
     *  C_IEVENT_CLI names them because that is what the library reads
     *  off its transport. An answer can still land in ST_DISCONNECTED
     *  (it was in flight when the socket dropped), so it is handled in
     *  both.
     *---------------------------------------------*/
    const states = [
        ["ST_DISCONNECTED", [
            ["EV_ON_OPEN",           ac_on_open,           "ST_SESSION"],
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null]
        ]],
        ["ST_SESSION", [
            ["EV_ON_CLOSE",          ac_on_close,          "ST_DISCONNECTED"],
            ["EV_ON_OPEN",           ac_on_open,           null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *
     *  The three node events are declared as OUTPUT because the hosted
     *  view SUBSCRIBES to them on its transport — which is this gobj —
     *  and gobj_subscribe_event refuses an event that is not in the
     *  publisher's output list. They are published only as the local
     *  echo of our own writes (see the header), so a tab with no topic
     *  open has no subscriber for them: NO_WARN_SUBS.
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_TREEDB_NODE_CREATED", out],
        ["EV_TREEDB_NODE_UPDATED", out],
        ["EV_TREEDB_NODE_DELETED", out],
        ["EV_MT_COMMAND_ANSWER",   0],
        ["EV_ON_OPEN",             0],
        ["EV_ON_CLOSE",            0]
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
function register_c_agent_treedb_link()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_treedb_link};
