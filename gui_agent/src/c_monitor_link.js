/***********************************************************************
 *          c_monitor_link.js
 *
 *      C_MONITOR_LINK — a DIRECT link to one yuneta_agent (named service
 *      "monitor_link"), for the Monitor workspace.
 *
 *      Every other workspace reaches the nodes through the control center
 *      (C_AGENT_LINK). The Monitor talks to the agent of the node under
 *      test itself, on its public port (wss://<node>:1993): one hop, no
 *      control center in the middle of a measurement.
 *
 *      THE TOKEN. The console's session is the BFF's httpOnly cookie, and
 *      a cookie scoped to this host never reaches another one. So the
 *      link asks the BFF for the access_token (POST /auth/token, the
 *      opt-in endpoint behind `expose_access_token` + origin pinning,
 *      YUNO_AUTH.md) and puts it in the identity card. The token is short
 *      lived, and C_IEVENT_CLI re-reads its `jwt` attr at every card it
 *      sends, so the link keeps that attr fresh:
 *        - each time the login refreshes the cookies (EV_LOGIN_REFRESHED
 *          of "agent_login"), and
 *        - once after an identity NAK, which is what an expired token
 *          looks like; C_IEVENT_CLI retries by itself with the new one.
 *      A second NAK in a row is a real refusal (the user is not in that
 *      agent's authz): the link gives up and says so (EV_LINK_FAILED).
 *
 *      States: ST_IDLE (no link) -> ST_FETCHING (asking for the token)
 *      -> ST_LINKED (a C_IEVENT_CLI exists; it may be in session or
 *      retrying). EV_DISCONNECT returns to ST_IDLE from anywhere, and so
 *      does a failure (no token, identity refused twice). A new
 *      EV_CONNECT from ST_LINKED closes the session it had, and that
 *      close arrives in ST_FETCHING.
 *
 *      Input:  EV_CONNECT {url}, EV_DISCONNECT, EV_SEND_COMMAND {command,
 *              kw}, EV_SEND_STATS {stats, kw}.
 *      Output: EV_ON_OPEN, EV_ON_CLOSE, EV_ON_OPEN_ERROR, EV_LINK_FAILED
 *              {error_code, comment}, EV_MT_COMMAND_ANSWER,
 *              EV_MT_STATS_ANSWER. The two answers are also PUBLIC: the
 *              agent addresses them to this service by name.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA,
    SDATA_END,
    data_type_t,
    event_flag_t,
    gclass_create,
    log_error,
    log_info,
    log_warning,
    gobj_read_pointer_attr,
    gobj_read_str_attr,
    gobj_write_attr,
    gobj_write_str_attr,
    gobj_read_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_publish_event,
    gobj_send_event,
    gobj_change_state,
    gobj_find_service,
    gobj_yuno,
    gobj_create,
    gobj_start_tree,
    gobj_stop_tree,
    gobj_destroy,
    gobj_is_running,
    gobj_command,
    gobj_stats,
    gobj_short_name,
} from "@yuneta/gobj-js";

import {deploy_info} from "./conf/deploy.js";

/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_MONITOR_LINK";

/***************************************************************
 *              Data
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,   "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "url",          0,  "",     "Url of the agent (wss://<node>:1993)"),
SDATA(data_type_t.DTP_POINTER,  "iev",          0,  null,   "Current C_IEVENT_CLI"),
SDATA_END()
];

let PRIVATE_DATA = {
    token:      "",     /*  last access_token from the BFF  */
    nak_retry:  false,  /*  a NAK already asked for a fresh token  */
    seq:        0,      /*  name of the next transport  */
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
    /*
     *  SERVICE subscription model
     */
    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }
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
    close_link(gobj);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    close_link(gobj);
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Ask the BFF for the access_token of this session. The answer is
 *  an OS notification, so it only becomes an event; the token stays
 *  out of the kw (the machine trace dumps it).
 ***************************************************************/
function fetch_token(gobj)
{
    let url = `${deploy_info().bff_url}/auth/token`;
    fetch(url, {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"}
    })
    .then((resp) => resp.json()
        .catch(() => ({}))
        .then((data) => ({status: resp.status, data: data || {}})))
    .then(({status, data}) => {
        let token = (data.success && data.access_token) ? data.access_token : "";
        gobj.priv.token = token;
        gobj_send_event(gobj, "EV_TOKEN_FETCHED", {
            ok:     !!token,
            status: status,
            error:  data.error || ""
        }, gobj);
    })
    .catch((err) => {
        gobj.priv.token = "";
        gobj_send_event(gobj, "EV_TOKEN_FETCHED", {
            ok:     false,
            status: 0,
            error:  (err && err.message) ? err.message : String(err)
        }, gobj);
    });
}

/***************************************************************
 *  Why a token did not come, as an i18n key for the view.
 ***************************************************************/
function token_error_code(kw)
{
    if(kw.status === 404) {
        return "monitor token not exposed";
    }
    if(kw.status === 0) {
        return "monitor token unreachable";
    }
    return "monitor token refused";
}

/***************************************************************
 *  Create and start the transport to the agent.
 ***************************************************************/
function open_link(gobj)
{
    let priv = gobj.priv;
    close_link(gobj);

    let iev = gobj_create("monitor_iev-" + (++priv.seq), "C_IEVENT_CLI", {
        url:                 gobj_read_str_attr(gobj, "url"),
        remote_yuno_role:    "yuneta_agent",
        remote_yuno_service: "agent",
        remote_yuno_name:    "",
        jwt:                 priv.token,
        /*  The agent's own service, not this yuno's required_services
         *  (those are the control center's).  */
        required_services:   ["agent"],
        /*  The subscriber attr: a LOCAL subscription to everything the
         *  transport publishes (a subscription to named events on a
         *  C_IEVENT_CLI would travel to the agent as __subscribing__).  */
        subscriber:          gobj
    }, gobj_yuno());
    gobj_write_attr(gobj, "iev", iev);
    gobj_start_tree(iev);
}

/***************************************************************
 *  Tear down the transport, if any.
 ***************************************************************/
function close_link(gobj)
{
    let iev = gobj_read_attr(gobj, "iev");
    if(iev) {
        gobj_write_attr(gobj, "iev", null);
        if(gobj_is_running(iev)) {
            gobj_stop_tree(iev);
        }
        gobj_destroy(iev);
    }
}

/***************************************************************
 *  Follow the login's cookie refreshes only while a link exists.
 ***************************************************************/
function watch_login(gobj, on)
{
    let login = gobj_find_service("agent_login", false);
    if(!login) {
        log_error(`${gobj_short_name(gobj)}: no agent_login service, the token will not be renewed`);
        return;
    }
    if(on) {
        gobj_subscribe_event(login, "EV_LOGIN_REFRESHED", {}, gobj);
    } else {
        gobj_unsubscribe_event(login, "EV_LOGIN_REFRESHED", {}, gobj);
    }
}

function bubble(gobj, event, kw)
{
    gobj_publish_event(gobj, event, kw || {});
    return 0;
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Connect to `url`: first the token, then the transport.
 ***************************************************************/
function ac_connect(gobj, event, kw, src)
{
    let url = (kw && kw.url) || "";
    if(!url) {
        log_error(`${gobj_short_name(gobj)}: EV_CONNECT without url`);
        return -1;
    }
    if(gobj_read_attr(gobj, "iev")) {
        close_link(gobj);
        watch_login(gobj, false);
    }
    gobj_write_str_attr(gobj, "url", url);
    gobj.priv.nak_retry = false;
    fetch_token(gobj);
    return 0;
}

/***************************************************************
 *  Drop the link, whatever it was doing.
 ***************************************************************/
function ac_disconnect(gobj, event, kw, src)
{
    let had_link = !!gobj_read_attr(gobj, "iev");
    close_link(gobj);
    if(had_link) {
        watch_login(gobj, false);
    }
    return 0;
}

/***************************************************************
 *  The token for a new link.
 ***************************************************************/
function ac_token_for_link(gobj, event, kw, src)
{
    if(!kw.ok) {
        let code = token_error_code(kw);
        log_warning(`${gobj_short_name(gobj)}: no access_token from the BFF ` +
            `(status ${kw.status}${kw.error ? ", " + kw.error : ""})`);
        gobj_change_state(gobj, "ST_IDLE");
        return bubble(gobj, "EV_LINK_FAILED", {
            error_code: code,
            comment:    kw.error || `HTTP ${kw.status}`
        });
    }
    watch_login(gobj, true);
    open_link(gobj);
    return 0;
}

/***************************************************************
 *  A fresh token for the link that exists: the transport sends it in
 *  its next identity card.
 ***************************************************************/
function ac_token_renewed(gobj, event, kw, src)
{
    if(!kw.ok) {
        log_warning(`${gobj_short_name(gobj)}: the access_token could not be renewed ` +
            `(status ${kw.status}${kw.error ? ", " + kw.error : ""})`);
        return 0;
    }
    let iev = gobj_read_attr(gobj, "iev");
    if(iev) {
        gobj_write_str_attr(iev, "jwt", gobj.priv.token);
    }
    return 0;
}

/***************************************************************
 *  The link was dropped while its token was on the way: nothing to
 *  give it to.
 ***************************************************************/
function ac_token_late(gobj, event, kw, src)
{
    log_info(`${gobj_short_name(gobj)}: access_token arrived after the link was dropped`);
    return 0;
}

/***************************************************************
 *  The login rotated the cookies: take the new token.
 ***************************************************************/
function ac_login_refreshed(gobj, event, kw, src)
{
    fetch_token(gobj);
    return 0;
}

function ac_on_open(gobj, event, kw, src)
{
    gobj.priv.nak_retry = false;
    return bubble(gobj, "EV_ON_OPEN", kw);
}

function ac_on_close(gobj, event, kw, src)
{
    return bubble(gobj, "EV_ON_CLOSE", kw);
}

function ac_on_open_error(gobj, event, kw, src)
{
    return bubble(gobj, "EV_ON_OPEN_ERROR", kw);
}

/***************************************************************
 *  The agent refused the identity card. The first time it is taken
 *  for an expired token: ask for a fresh one, the transport retries
 *  on its own. Twice in a row is a refusal of the user: give up.
 ***************************************************************/
function ac_on_id_nak(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let comment = (kw && kw.comment) || "";
    if(!priv.nak_retry) {
        priv.nak_retry = true;
        log_warning(`${gobj_short_name(gobj)}: identity refused by ` +
            `${gobj_read_str_attr(gobj, "url")} (${comment}), renewing the token`);
        fetch_token(gobj);
        return 0;
    }
    log_error(`${gobj_short_name(gobj)}: identity refused again by ` +
        `${gobj_read_str_attr(gobj, "url")}: ${comment}`);
    close_link(gobj);
    watch_login(gobj, false);
    gobj_change_state(gobj, "ST_IDLE");
    return bubble(gobj, "EV_LINK_FAILED", {
        error_code: "monitor identity refused",
        comment:    comment
    });
}

function ac_send_command(gobj, event, kw, src)
{
    let iev = gobj_read_attr(gobj, "iev");
    return gobj_command(iev, kw.command, kw.kw || {}, gobj);
}

function ac_send_stats(gobj, event, kw, src)
{
    let iev = gobj_read_attr(gobj, "iev");
    return gobj_stats(iev, kw.stats || "", kw.kw || {}, gobj);
}

function ac_mt_command_answer(gobj, event, kw, src)
{
    return bubble(gobj, "EV_MT_COMMAND_ANSWER", kw);
}

function ac_mt_stats_answer(gobj, event, kw, src)
{
    return bubble(gobj, "EV_MT_STATS_ANSWER", kw);
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
     *  The state changes BEFORE the action runs, so the close of a
     *  deliberate disconnect (C_IEVENT_CLI delivers it while being
     *  stopped) arrives in ST_IDLE and is reported from there.
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_CONNECT",              ac_connect,             "ST_FETCHING"],
            ["EV_DISCONNECT",           ac_disconnect,          null],
            ["EV_TOKEN_FETCHED",        ac_token_late,          null],
            ["EV_ON_CLOSE",             ac_on_close,            null]
        ]],
        ["ST_FETCHING", [
            ["EV_CONNECT",              ac_connect,             null],
            ["EV_DISCONNECT",           ac_disconnect,          "ST_IDLE"],
            ["EV_TOKEN_FETCHED",        ac_token_for_link,      "ST_LINKED"],
            ["EV_ON_CLOSE",             ac_on_close,            null]
        ]],
        ["ST_LINKED", [
            ["EV_CONNECT",              ac_connect,             "ST_FETCHING"],
            ["EV_DISCONNECT",           ac_disconnect,          "ST_IDLE"],
            ["EV_TOKEN_FETCHED",        ac_token_renewed,       null],
            ["EV_LOGIN_REFRESHED",      ac_login_refreshed,     null],
            ["EV_ON_OPEN",              ac_on_open,             null],
            ["EV_ON_CLOSE",             ac_on_close,            null],
            ["EV_ON_OPEN_ERROR",        ac_on_open_error,       null],
            ["EV_ON_ID_NAK",            ac_on_id_nak,           null],
            ["EV_SEND_COMMAND",         ac_send_command,        null],
            ["EV_SEND_STATS",           ac_send_stats,          null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,   null],
            ["EV_MT_STATS_ANSWER",      ac_mt_stats_answer,     null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const answer = out | event_flag_t.EVF_PUBLIC_EVENT;
    const event_types = [
        ["EV_CONNECT",              0],
        ["EV_DISCONNECT",           0],
        ["EV_TOKEN_FETCHED",        0],
        ["EV_LOGIN_REFRESHED",      0],
        ["EV_SEND_COMMAND",         0],
        ["EV_SEND_STATS",           0],
        ["EV_ON_ID_NAK",            0],
        ["EV_ON_OPEN",              out],
        ["EV_ON_CLOSE",             out],
        ["EV_ON_OPEN_ERROR",        out],
        ["EV_LINK_FAILED",          out],
        ["EV_MT_COMMAND_ANSWER",    answer],
        ["EV_MT_STATS_ANSWER",      answer]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,  // lmt,
        attrs_table,
        PRIVATE_DATA,
        0,  // authz_table,
        0,  // command_table,
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
function register_c_monitor_link()
{
    return create_gclass(GCLASS_NAME);
}

export { register_c_monitor_link };
