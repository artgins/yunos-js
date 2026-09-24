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
 *      ...unless the treedb belongs to the AGENT itself, which is not a
 *      managed yuno and answers for its own services with its own
 *      `command-agent service=<treedb>`.  That is the only difference,
 *      and it lives in cmd2agent_service() (agent_helpers.js).
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
 *      the answer it just received — except for a link, which the answer
 *      does not describe: LINKED/UNLINKED are rebuilt from the two refs
 *      of the REQUEST, which is where the graph put them.  It is a LOCAL
 *      echo either way, not the treedb's event: another operator's
 *      change is not seen here.
 *
 *      EVERY REQUEST IS ANSWERED. A view that sent a write waits for its
 *      answer with the form busy, and two hops can lose one: the
 *      controlcenter acks the dispatch and the node's agent never answers
 *      (an agent restarting, a yuno that died under the command). So each
 *      request carries a DEADLINE (a real time) and a C_TIMER child
 *      settles the ones past it as failed, with a comment the view shows.
 *      The session closing settles every request in flight the same way,
 *      at once: their answers died with it. And a request this adapter
 *      cannot even route is refused in the RETURN of mt_command_parser (a
 *      string, as every caller of gobj_command() reads a failure), never
 *      with a null that reads as "sent".
 *
 *      THE DEADLINE (request_timeout()). It is armed at the queueing and
 *      armed AGAIN at the controlcenter's dispatch ack, so the time the
 *      frame took to reach the controlcenter is not taken from the node's
 *      answer. It is REQUEST_TIMEOUT for everything but a write carrying
 *      `__files__`, which gets REQUEST_TIMEOUT plus the time its base64
 *      needs at UPLOAD_FLOOR: an upload of up to 128 MB (~171 MB of
 *      base64, two hops) is not a request that went unanswered after a
 *      minute. It is scaled and NOT disabled: an agent that never answers
 *      an upload must still end with the form answered, in a time
 *      proportional to what it carried (~23 min for the largest).
 *
 *      A LATE ANSWER -- one that arrives after its deadline settled the
 *      request -- is not dropped in silence: it is logged as a warning,
 *      and when it is a WRITE that succeeded its node event is echoed, so
 *      the tables show what the treedb holds (the form was already
 *      answered, as failed; a second answer to it would re-settle a write
 *      it has forgotten). A late read or a late refusal changes nothing
 *      on screen and is only logged: the view already said it failed, and
 *      a refresh asks again. Settled requests are remembered for LATE_KEEP
 *      (at most LATE_MAX of them) for this.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error, log_warning,
    gobj_create_pure_child,
    set_timeout, clear_timeout,
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
    kw_get_bool,
    is_object,
    empty_string,
} from "@yuneta/gobj-js";

import {cmd2agent_service} from "./agent_helpers.js";
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

/*  How long a routed request may go unanswered before it is settled as
 *  failed, counted from its dispatch ack (see the header). A deadline,
 *  not a performance target: the node answers when the command is DONE,
 *  and a big `nodes` two hops away is slow.  */
const REQUEST_TIMEOUT = 60 * 1000;

/*  The slowest link an upload is waited for, in bytes of base64 per
 *  second, two hops included: a floor, so a slow uplink is not reported
 *  as a node that did not answer.  */
const UPLOAD_FLOOR = 128 * 1024;

/*  How long, and how many, settled requests are remembered to recognise
 *  their late answers.  */
const LATE_KEEP = 30 * 60 * 1000;
const LATE_MAX = 64;

/*  The comments of a request settled here: i18n KEYS, which the view's
 *  error toast translates.  */
const NO_ANSWER_KEY = "the node did not answer";
const CLOSED_KEY = "the connection dropped";

/*  The request counter, ONE for the page and not one per adapter: every
 *  adapter subscribed to the link hears every answer of the session, and
 *  tells its own by `treedb_seq`. A counter per adapter started at 1 in
 *  each, so with two treedb views mounted an answer to one was taken by
 *  the other -- delivered to the wrong view, or read as a LATE answer of
 *  a request it had given up, which echoed a node event (a DELETED) that
 *  never happened.  */
let __treedb_seq__ = 0;


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
    pending: null,  /*  seq -> {view, command, md_command, treedb_name, topic_name, record, options, timeout, deadline}  */
    late:    null,  /*  seq -> {pend, settled_at}: settled by the deadline, a late answer may still come  */
    timer:   null,  /*  C_TIMER child: the earliest deadline of `pending`  */
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

    priv.pending = {};
    priv.late = {};
    priv.timer = gobj_create_pure_child("deadline", "C_TIMER", {}, gobj);

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
    priv.late = {};
    if(priv.timer) {
        clear_timeout(priv.timer);
    }
}

/***************************************************************
 *          Framework Method: Command parser
 *
 *  THE PIECE: the view's command, re-wrapped for the two hops.
 *  Returns null when the request LEFT (the answer is asynchronous,
 *  as with the C_IEVENT_CLI the views normally talk to), and a
 *  STRING when it did not: a non-null return is how gobj_command()
 *  says "failed" to every caller, which logs it and does not wait.
 *  A null here used to mean both, and a form whose write could not
 *  be routed waited for an answer that was never asked for.
 ***************************************************************/
function mt_command_parser(gobj, command, kw, src)
{
    let priv = gobj.priv;

    if(!kw) {
        kw = {};
    }
    if(empty_string(command)) {
        return `${gobj_short_name(gobj)}: command without name`;
    }

    let node    = gobj_read_str_attr(gobj, "node");
    let yuno_id = gobj_read_str_attr(gobj, "yuno_id");
    let treedb  = kw_get_str(gobj, kw, "service", "", 0) ||
                  gobj_read_str_attr(gobj, "treedb_name");
    let link    = gobj_read_attr(gobj, "link_svc");

    if(empty_string(node) || empty_string(yuno_id) || empty_string(treedb)) {
        return `${gobj_short_name(gobj)}: cannot route '${command}' ` +
            `— node/yuno_id/treedb_name incomplete`;
    }
    if(!link || gobj_current_state(gobj) !== "ST_SESSION") {
        return `${gobj_short_name(gobj)}: cannot route '${command}' — not in session`;
    }

    /*  Trap 1: a top-level `id` would name the YUNO, not the node the
     *  caller means, and command-yuno would answer "Yuno not found".
     *  The library views send the record nested (`record={…}`); anything
     *  that does not has to be fixed at the caller, so say so here
     *  instead of routing a request that cannot work.  */
    if(Object.prototype.hasOwnProperty.call(kw, "id")) {
        return `${gobj_short_name(gobj)}: '${command}' carries a top-level 'id' ` +
            `— it would filter the YUNO, not the node. Send it nested.`;
    }

    let seq = ++__treedb_seq__;

    /*  Everything the view sent travels as kw, except what belongs to
     *  the hops: `service` is the INNER routing (inline in cmd2agent, and
     *  deleted from the kw by the controlcenter anyway) and
     *  `__md_command__` is the view's own echo, which we keep here and
     *  give back on the answer.  */
    let kw_send = Object.assign({}, kw);
    delete kw_send.service;
    delete kw_send.__md_command__;

    kw_send.agent_id = node;
    kw_send.cmd2agent = cmd2agent_service(yuno_id, treedb, command);

    msg_iev_write_key(kw_send, "console_purpose", PURPOSE);
    msg_iev_write_key(kw_send, "treedb_seq", String(seq));

    priv.pending[seq] = {
        view:        src,
        command:     command,
        md_command:  is_object(kw.__md_command__) ? kw.__md_command__ : {},
        treedb_name: kw_get_str(gobj, kw, "treedb_name", treedb, 0),
        topic_name:  kw_get_str(gobj, kw, "topic_name", "", 0),
        record:      is_object(kw.record) ? kw.record : null,
        /*  Kept because the ECHO depends on it: `create` says an
         *  update-node was a creation (see echo_node_event).  */
        options:     is_object(kw.options) ? kw.options : {},
        /*  A link names its two ends and no topic: `<topic>^<id>^<hook>`
         *  for the parent, `<topic>^<id>` for the child.  */
        parent_ref:  kw_get_str(gobj, kw, "parent_ref", "", 0),
        child_ref:   kw_get_str(gobj, kw, "child_ref", "", 0),
        timeout:     0,
        deadline:    0
    };
    let pend = priv.pending[seq];
    pend.timeout = request_timeout(pend.record);
    pend.deadline = now_msec() + pend.timeout;

    /*  No `src`: the answer is addressed to the link service, which
     *  re-publishes it to every panel — the app's established pattern.  */
    if(agent_link_command(link, "command-agent", kw_send) < 0) {
        delete priv.pending[seq];
        return `${gobj_short_name(gobj)}: cannot route '${command}' — the link has no transport`;
    }
    arm_deadline(gobj);

    return null;    /*  asynchronous answer  */
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  A monotonic clock in milliseconds: a deadline measured on the
 *  wall clock moves when the clock is set.
 ***************************************************************/
function now_msec()
{
    return (typeof performance !== "undefined" && performance.now)?
        performance.now() : Date.now();
}

/***************************************************************
 *  The deadline of a request (see the header): REQUEST_TIMEOUT, plus
 *  the time the base64 of its `__files__` needs at UPLOAD_FLOOR.
 ***************************************************************/
function request_timeout(record)
{
    let files = (record && is_object(record.__files__)) ? record.__files__ : null;
    let bytes = 0;

    if(files) {
        for(let col of Object.keys(files)) {
            let one = files[col];
            if(is_object(one) && typeof one.content64 === "string") {
                bytes += one.content64.length;
            }
        }
    }
    return REQUEST_TIMEOUT + Math.ceil(bytes * 1000 / UPLOAD_FLOOR);
}

/***************************************************************
 *  Settle a request as FAILED, in the shape of a refusal from the
 *  node, so the view does what it does with any refused request --
 *  the form comes back on what was typed, a load shows its error.
 ***************************************************************/
function settle_failed(gobj, pend, comment_key)
{
    deliver(gobj, pend, {
        result:  -1,
        comment: comment_key,
        schema:  null,
        data:    null
    });
}

/***************************************************************
 *  Remember a request the deadline settled, so its answer, if it
 *  still comes, is recognised. Bounded in time and in number, and
 *  in what it keeps: what late_answer() says and echo_node_event()
 *  publishes. Not the view (it was answered), and not the base64 of
 *  a write's `__files__` -- up to 171 MB, held for LATE_KEEP.
 ***************************************************************/
function remember_late(gobj, seq, pend)
{
    let priv = gobj.priv;
    let now = now_msec();

    for(let old of Object.keys(priv.late)) {
        if(now - priv.late[old].settled_at > LATE_KEEP) {
            delete priv.late[old];
        }
    }
    let keys = Object.keys(priv.late).sort((a, b) => Number(a) - Number(b));
    while(keys.length >= LATE_MAX) {
        delete priv.late[keys.shift()];
    }
    let record = null;
    if(pend.record) {
        record = Object.assign({}, pend.record);
        delete record.__files__;
    }
    priv.late[seq] = {
        pend: {
            command:     pend.command,
            treedb_name: pend.treedb_name,
            topic_name:  pend.topic_name,
            record:      record,
            options:     pend.options,
            parent_ref:  pend.parent_ref,
            child_ref:   pend.child_ref
        },
        settled_at: now
    };
}

/***************************************************************
 *  The answer of a request its deadline settled. Said, always; and
 *  a write that succeeded is echoed, so the tables show what the
 *  treedb holds. The view is not answered again: it was, as failed.
 ***************************************************************/
function late_answer(gobj, seq, kw, outer)
{
    let priv = gobj.priv;
    let late = priv.late[seq];
    let pend = late.pend;
    let ok = !(typeof kw.result === "number" && kw.result < 0);
    let what = `'${pend.command}' of '${pend.topic_name || pend.treedb_name}'`;
    let secs = Math.round((now_msec() - late.settled_at) / 1000);

    if(outer === "command-agent") {
        if(!ok) {
            delete priv.late[seq];
            log_warning(`${gobj_short_name(gobj)}: ${what}: dispatch refused ${secs} s ` +
                `after its deadline: ${kw.comment || ""}`);
        }
        return 0;   /*  a late dispatch ack: the real answer may still come  */
    }
    delete priv.late[seq];
    if(!ok) {
        log_warning(`${gobj_short_name(gobj)}: ${what} answered ${secs} s after its deadline: ` +
            `refused (${kw.comment || ""})`);
        return 0;
    }
    if(is_write(pend.command)) {
        log_warning(`${gobj_short_name(gobj)}: ${what} answered ${secs} s after its deadline: ` +
            `done -- the view was told it failed; its node event is echoed`);
        echo_node_event(gobj, pend, kw);
        return 0;
    }
    log_warning(`${gobj_short_name(gobj)}: ${what} answered ${secs} s after its deadline: ` +
        `not delivered, the view already reported it failed`);
    return 0;
}

/***************************************************************
 *  The commands this adapter echoes as node events.
 ***************************************************************/
function is_write(command)
{
    return ["create-node", "update-node", "delete-node",
            "link-nodes", "unlink-nodes"].includes(command);
}

/***************************************************************
 *  Point the timer at the earliest deadline still pending, or
 *  disarm it when nothing is.
 ***************************************************************/
function arm_deadline(gobj)
{
    let priv = gobj.priv;
    let earliest = null;

    if(!priv.timer) {
        return;
    }
    for(let seq of Object.keys(priv.pending)) {
        let d = priv.pending[seq].deadline;
        if(earliest === null || d < earliest) {
            earliest = d;
        }
    }
    if(earliest === null) {
        clear_timeout(priv.timer);
        return;
    }
    set_timeout(priv.timer, Math.max(1, Math.ceil(earliest - now_msec())));
}

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

    /*  A link is not a node event: it names the two ends it joined and
     *  the graph re-reads both from the treedb. The refs are the view's
     *  own, `<topic>^<id>[^<hook>]`.  */
    if(pend.command === "link-nodes" || pend.command === "unlink-nodes") {
        let parent = String(pend.parent_ref || "").split("^");
        let child = String(pend.child_ref || "").split("^");
        if(empty_string(parent[1]) || empty_string(child[1])) {
            return;     /*  a ref we cannot split: nothing honest to echo  */
        }
        gobj_publish_event(gobj,
            (pend.command === "link-nodes")
                ? "EV_TREEDB_NODE_LINKED" : "EV_TREEDB_NODE_UNLINKED",
            {
                treedb_name:       pend.treedb_name,
                parent_topic_name: parent[0],
                parent_id:         parent[1],
                child_topic_name:  child[0],
                child_id:          child[1]
            }
        );
        return;
    }

    switch(pend.command) {
        case "create-node":
            event = "EV_TREEDB_NODE_CREATED";
            node = is_object(kw.data) ? kw.data : pend.record;
            break;
        case "update-node":
            /*  `update-node` with `options.create` is an UPSERT, and it is
             *  how every view here creates a node — the fkey carried in
             *  the record only becomes a link through the `autolink` that
             *  travels with it, which plain create-node does not do.
             *
             *  So the ECHO has to say which of the two it was, and only
             *  the request knows: a subscriber told "updated" about a node
             *  it has never seen answers that its table is missing a row,
             *  which is true and is not the news. It is a creation.  */
            event = kw_get_bool(gobj, pend.options, "create", false, 0)
                ? "EV_TREEDB_NODE_CREATED" : "EV_TREEDB_NODE_UPDATED";
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
    let stack = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let outer = kw_get_str(gobj, stack, "command", "", 0);
    let pend = seq ? priv.pending[seq] : null;
    if(!pend) {
        if(seq && priv.late[seq]) {
            return late_answer(gobj, seq, kw, outer);
        }
        return 0;   /*  another treedb tab's request  */
    }

    if(outer === "command-agent") {
        if(typeof kw.result === "number" && kw.result < 0) {
            delete priv.pending[seq];
            arm_deadline(gobj);
            deliver(gobj, pend, kw);
            return 0;
        }
        /*  Dispatched: from here the node has the whole deadline.  */
        pend.deadline = now_msec() + pend.timeout;
        arm_deadline(gobj);
        return 0;   /*  success: the real answer is still coming  */
    }

    delete priv.pending[seq];
    arm_deadline(gobj);
    deliver(gobj, pend, kw);
    if(typeof kw.result === "number" && kw.result >= 0) {
        echo_node_event(gobj, pend, kw);
    }
    return 0;
}

/***************************************************************
 *  A deadline passed: every request past it is settled as FAILED
 *  (settle_failed()). A late answer, if one still comes, is
 *  recognised (remember_late(), late_answer()).
 ***************************************************************/
function ac_timeout(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let now = now_msec();

    for(let seq of Object.keys(priv.pending)) {
        let pend = priv.pending[seq];
        if(pend.deadline > now) {
            continue;
        }
        delete priv.pending[seq];
        log_error(
            `${gobj_short_name(gobj)}: '${pend.command}' of '${pend.topic_name || pend.treedb_name}' ` +
            `not answered by node '${gobj_read_str_attr(gobj, "node")}' in ${Math.round(pend.timeout / 1000)} s`
        );
        remember_late(gobj, seq, pend);
        settle_failed(gobj, pend, NO_ANSWER_KEY);
    }
    arm_deadline(gobj);
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
 *  The session dropped: every request in flight died with it, so
 *  each one is ANSWERED now, as failed -- wiped without an answer,
 *  a form stayed busy and a schema editor stuck in its load or its
 *  write until the page was reloaded. Nothing is remembered for a late answer: none can
 *  come through a session that is gone.
 *
 *  The state is already ST_DISCONNECTED here (the framework changes
 *  it before the action), which is how a view tells this failure
 *  from a refusal.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let pending = priv.pending;
    let seqs = Object.keys(pending);

    priv.pending = {};
    priv.late = {};
    arm_deadline(gobj);
    if(seqs.length > 0) {
        log_warning(`${gobj_short_name(gobj)}: the session closed with ${seqs.length} ` +
            `request(s) in flight: answered as failed`);
    }
    for(let seq of seqs) {
        settle_failed(gobj, pending[seq], CLOSED_KEY);
    }
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
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
            ["EV_TIMEOUT",           ac_timeout,           null]
        ]],
        ["ST_SESSION", [
            ["EV_ON_CLOSE",          ac_on_close,          "ST_DISCONNECTED"],
            ["EV_ON_OPEN",           ac_on_open,           null],
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
            ["EV_TIMEOUT",           ac_timeout,           null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *
     *  The five node events are declared as OUTPUT because the hosted
     *  views SUBSCRIBE to them on their transport — which is this gobj —
     *  and gobj_subscribe_event refuses an event that is not in the
     *  publisher's output list. They are published only as the local
     *  echo of our own writes (see the header), so a tab with no topic
     *  open has no subscriber for them: NO_WARN_SUBS.
     *
     *  LINKED/UNLINKED are the graph's: it subscribes to them treedb-wide
     *  the moment it loads a topic, so leaving them undeclared does not
     *  cost an edge that fails to redraw — it costs the SUBSCRIPTION,
     *  refused with an error before any write happens.
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_TREEDB_NODE_CREATED",  out],
        ["EV_TREEDB_NODE_UPDATED",  out],
        ["EV_TREEDB_NODE_DELETED",  out],
        ["EV_TREEDB_NODE_LINKED",   out],
        ["EV_TREEDB_NODE_UNLINKED", out],
        ["EV_MT_COMMAND_ANSWER",   0],
        ["EV_ON_OPEN",             0],
        ["EV_ON_CLOSE",            0],
        ["EV_TIMEOUT",             0]
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
