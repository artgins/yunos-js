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
    msg_iev_get_stack, msg_iev_push_stack,
    kw_get_str, kw_get_dict,
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
 *          Framework Method: Command
 *
 *  Wrap the view's command into command-yuno on the live transport.
 *  `kw.service` (the target service inside the yuno) is exactly the
 *  parameter command-yuno forwards, so it rides along untouched; the
 *  view's __md_command__ echo is preserved inside OUR echo and
 *  restored in ac_mt_command_answer.
 ***************************************************************/
function mt_command(gobj, command, kw, src)
{
    let iev = gobj_read_pointer_attr(gobj, "iev");
    if(!iev) {
        log_error(`${gobj_short_name(gobj)}: no live transport`);
        return -1;
    }
    kw = kw || {};
    let inner_md = kw.__md_command__ || {};
    delete kw.__md_command__;

    let kw2 = Object.assign({}, kw, {
        command:   command,
        yuno_role: gobj_read_attr(gobj, "yuno_role"),
        yuno_name: gobj_read_attr(gobj, "yuno_name"),
        __md_command__: {
            __inner_command__: command,
            __inner_md__:      inner_md
        }
    });
    return gobj_command(iev, "command-yuno", kw2, gobj);
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
    let stack = msg_iev_get_stack(gobj, kw, "command_stack", true);
    let md = kw_get_dict(gobj, stack, "kw", {}, 0);
    let inner_command = kw_get_str(gobj, md, "__inner_command__", "", 0);
    if(!inner_command) {
        log_error(`${gobj_short_name(gobj)}: answer without inner command echo`);
        return 0;
    }
    msg_iev_push_stack(gobj, kw, "command_stack", {
        command: inner_command,
        kw:      md.__inner_md__ || {}
    });
    gobj_send_event(view, "EV_MT_COMMAND_ANSWER", kw, gobj);
    return 0;
}




                    /***************************
                     *              FSM
                     ***************************/




const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy,
    mt_command: mt_command
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
