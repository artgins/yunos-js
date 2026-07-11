/***********************************************************************
 *          c_treedb_proxy.js
 *
 *      C_TREEDB_PROXY — command proxy for services living in ANOTHER
 *      yuno of the node (not the one the transport is connected to).
 *
 *      The backend's C_IEVENT_SRV resolves `kw.service` only inside its
 *      own yuno, so commands to a scanned service of a different yuno
 *      must travel wrapped in the agent's `command-yuno`. The hosted
 *      view keeps its normal contract — `gobj_command(gobj_remote_yuno,
 *      cmd, kw, src)` — by receiving THIS gobj as its gobj_remote_yuno:
 *
 *        - mt_command wraps each command into
 *          `command-yuno {command, yuno_role, yuno_name, service, ...}`
 *          on the live transport, with the proxy itself as requester
 *          (a NAMED service, so C_IEVENT_CLI routes the answer back);
 *        - the answer arrives with OUR command_stack echo ("command-yuno");
 *          ac_mt_command_answer rewrites the stack to the INNER command
 *          (+ the view's original __md_command__) and re-injects
 *          EV_MT_COMMAND_ANSWER into the hosted view, which dispatches
 *          exactly as if the service had answered directly.
 *
 *      EV_TREEDB_NODE_* are declared as output events that never fire:
 *      realtime treedb events do not cross yunos, so the view's
 *      subscriptions are accepted and simply stay silent (views refresh
 *      on demand).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_read_pointer_attr,
    gobj_send_event,
    gobj_command,
    gobj_short_name,
    msg_iev_push_stack,
    msg_iev_write_key, msg_iev_read_key,
} from "@yuneta/gobj-js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_PROXY";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "iev",        0,  null,  "Live transport (C_IEVENT_CLI) to the node's agent"),
SDATA(data_type_t.DTP_STRING,   "yuno_role",  0,  "",    "Target yuno role (command-yuno filter)"),
SDATA(data_type_t.DTP_STRING,   "yuno_name",  0,  "",    "Target yuno name (command-yuno filter)"),
SDATA(data_type_t.DTP_POINTER,  "view",       0,  null,  "Hosted view the answers are re-injected into"),
SDATA_END()
];

let PRIVATE_DATA = {};
let __gclass__ = null;




                    /******************************
                     *      Framework Methods
                     ******************************/




/***************************************************************
 *          Framework Method: Create
 ***************************************************************/
function mt_create(gobj)
{
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
}

/***************************************************************
 *          Framework Method: Command parser
 *
 *  gobj_command dispatches to mt_command_parser (C_IEVENT_CLI registers
 *  its own mt_command under this same key); a gclass WITHOUT it and
 *  without a command_table answers "command table not available". We
 *  intercept every command here and wrap it into command-yuno on the
 *  live transport. `kw.service` (the target service inside the yuno) is
 *  moved into the command string (see below); the view's __md_command__
 *  echo is preserved inside OUR echo and restored in ac_mt_command_answer.
 ***************************************************************/
function mt_command_parser(gobj, command, kw, src)
{
    let iev = gobj_read_pointer_attr(gobj, "iev");
    if(!iev) {
        log_error(`${gobj_short_name(gobj)}: no live transport`);
        return -1;
    }
    kw = kw || {};
    let inner_md = kw.__md_command__ || {};
    delete kw.__md_command__;

    /*
     *  The hosted view addresses its service via kw.service (the target
     *  service INSIDE the remote yuno). That field must NOT reach
     *  C_IEVENT_CLI as-is: it is what the transport uses as the ievent
     *  dst_service, and a kw.service="treedb_x" would route command-yuno
     *  itself to a non-existent "treedb_x" service of the AGENT. So move
     *  it into the command STRING (`command-yuno service=<svc>`): the kw
     *  then carries no `service`, dst_service falls back to the agent's
     *  C_AGENT, and command-yuno parses the inner service from the string
     *  (same mechanism as ycommand).
     */
    let inner_service = kw.service || "";
    delete kw.service;

    let kw2 = Object.assign({}, kw, {
        command:   command,
        yuno_role: gobj_read_attr(gobj, "yuno_role"),
        yuno_name: gobj_read_attr(gobj, "yuno_name")
    });
    /*
     *  Carry the inner command + the view's __md_command__ in __md_iev__,
     *  not the command_stack: command-yuno is a multi-hop forward, and each
     *  hop pushes/pops its OWN command_stack frame, so the view's frame does
     *  not survive to the answer. __md_iev__ round-trips end-to-end (the
     *  same channel the scan uses); ac_mt_command_answer rebuilds the
     *  command_stack frame the hosted view expects.
     */
    msg_iev_write_key(kw2, "proxy_cmd", command);
    msg_iev_write_key(kw2, "proxy_md", inner_md);
    let wrapped = "command-yuno" + (inner_service ? ` service=${inner_service}` : "");
    return gobj_command(iev, wrapped, kw2, gobj);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Answer of a wrapped command: pop OUR command-yuno stack echo,
 *  push the inner command's stack and re-inject into the view.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let view = gobj_read_pointer_attr(gobj, "view");
    if(!view) {
        log_error(`${gobj_short_name(gobj)}: no hosted view to answer to`);
        return 0;
    }
    let inner_command = msg_iev_read_key(kw, "proxy_cmd") || "";
    let inner_md = msg_iev_read_key(kw, "proxy_md") || {};
    if(!inner_command) {
        log_error(`${gobj_short_name(gobj)}: answer without inner command echo`);
        return 0;
    }
    /*
     *  Rebuild the command_stack frame the hosted view reads
     *  (msg_iev_get_stack "command" + "kw"), so the view dispatches the
     *  answer exactly as if its own C_IEVENT_CLI had answered directly.
     */
    msg_iev_push_stack(gobj, kw, "command_stack", {
        command: inner_command,
        kw:      inner_md
    });
    gobj_send_event(view, "EV_MT_COMMAND_ANSWER", kw, gobj);
    return 0;
}




                    /***************************
                     *              FSM
                     ***************************/




const gmt = {
    mt_create:         mt_create,
    mt_start:          mt_start,
    mt_stop:           mt_stop,
    mt_destroy:        mt_destroy,
    mt_command_parser: mt_command_parser
};

function create_gclass(gclass_name)
{
    if(__gclass__) {
        log_error(`GClass ALREADY created: ${gclass_name}`);
        return -1;
    }

    const states = [
        ["ST_IDLE", [
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null]
        ]]
    ];

    /*  EV_MT_COMMAND_ANSWER must be PUBLIC (C_IEVENT_CLI routes answers
     *  back by service name and checks that flag). EV_TREEDB_NODE_* are
     *  accepted subscriptions that never fire (no realtime cross-yuno).  */
    const never = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_MT_COMMAND_ANSWER",   event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_TREEDB_NODE_CREATED", never],
        ["EV_TREEDB_NODE_UPDATED", never],
        ["EV_TREEDB_NODE_DELETED", never]
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

function register_c_treedb_proxy()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_proxy};
