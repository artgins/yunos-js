/***********************************************************************
 *          c_login.js
 *
 *          C_TREEDB_LOGIN — OAuth2 login via the auth_bff (Backend For
 *          Frontend) plus access-token retrieval for multi-backend
 *          identity_card forwarding.
 *
 *  Security model:
 *  - Username/password go to the BFF /auth/login; the BFF exchanges them
 *    with the IdP server-side and sets httpOnly, Secure, SameSite=Strict
 *    cookies that JS cannot read. Refresh/logout go through the BFF too.
 *    So for the co-located BFF the JS side only ever sees
 *    {username, expires_in, refresh_expires_in} — SEC-06.
 *  - THE TREEDB EXCEPTION: this SPA also connects to treedb backends on
 *    OTHER hosts, where the BFF cookie cannot travel. After a successful
 *    login/refresh it therefore fetches the access_token from the BFF
 *    (POST /auth/token, an opt-in endpoint gated by `expose_access_token`
 *    + Origin pinning on the BFF — see YUNO_AUTH.md §2.2) and publishes it
 *    with EV_LOGIN_ACCEPTED / EV_LOGIN_REFRESHED so the app root can
 *    forward it in each C_IEVENT_CLI identity_card. A short access_token
 *    TTL keeps the window small.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA,
    SDATA_END,
    data_type_t,
    gclass_create,
    event_flag_t,
    log_error,
    log_info,
    log_warning,
    gobj_subscribe_event,
    gobj_send_event,
    gobj_read_attr,
    gobj_write_attr,
    sprintf,
    gobj_change_state,
    gobj_read_pointer_attr,
    gobj_short_name,
    gobj_publish_event,
    set_timeout,
    clear_timeout,
    gobj_create_pure_child,
    gobj_name,
    gobj_start,
    gobj_stop,
    build_path,
} from "@yuneta/gobj-js";

import {deploy_info} from "./conf/deploy.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_LOGIN";


/***************************************************************
 *              Data
 ***************************************************************/
/*---------------------------------------------*
 *          Attributes
 *---------------------------------------------*/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,   "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "username",     0,  "",     "Authenticated username"),
SDATA(data_type_t.DTP_STRING,   "bff_url",      0,  "",     "Base URL of the BFF auth endpoint"),
SDATA(data_type_t.DTP_STRING,   "access_token", 0,  "",     "Forwarded access_token (from /auth/token)"),
SDATA_END()
];

let PRIVATE_DATA = {
    timeout_refresh:    0,
    refresh_expires_in: 0,
    gobj_timer:         null,
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

    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);

    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }

    gobj_write_attr(gobj, "bff_url", deploy_info().bff_url);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    gobj_start(priv.gobj_timer);

    /*
     *  Try to restore the session from httpOnly cookies on page load
     *  (e.g. after F5). If the BFF refresh succeeds, fire
     *  EV_LOGIN_ACCEPTED; if not, publish EV_RESTORE_FAILED so the app
     *  shows the login form.
     */
    gobj_change_state(gobj, "ST_WAIT_TOKEN");
    try_restore_session(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    gobj_stop(priv.gobj_timer);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  POST username/password to the BFF /auth/login endpoint.
 ***************************************************************/
function do_bff_login(gobj, username, password)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");

    fetch(build_path(bff_url, "auth", "login"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"},
        body:        JSON.stringify({username, password})
    })
    .then(resp => resp.json().then(data => ({ok: resp.ok, status: resp.status, data})))
    .then(({ok, status, data}) => {
        if(ok && data.success) {
            gobj_write_attr(gobj, "username", data.username || data.email || "");
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", data, gobj);
        } else {
            const error_code = data.error_code || `http_${status}`;
            const error      = data.error || `HTTP ${status}`;
            log_info(sprintf("%s: BFF login error: %s (%s)",
                gobj_short_name(gobj), error_code, error));
            gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error}, gobj);
        }
    })
    .catch(err => {
        log_error(`${gobj_short_name(gobj)}: BFF login fetch failed: ${err.message}`);
        gobj_send_event(gobj, "EV_LOGIN_DENIED",
            {error_code: "network_error", error: "Network error during login"}, gobj);
    });
}

/***************************************************************
 *  Call the BFF /auth/logout endpoint.
 ***************************************************************/
function do_bff_logout(gobj)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");

    fetch(build_path(bff_url, "auth", "logout"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"}
    })
    .then(resp => resp.json().catch(() => ({})))
    .then(() => {
        gobj_send_event(gobj, "EV_LOGOUT_DONE", {}, gobj);
    })
    .catch(err => {
        log_error(`${gobj_short_name(gobj)}: BFF logout error: ${err.message}`);
        gobj_send_event(gobj, "EV_LOGOUT_DONE", {error: err.message}, gobj);
    });
}

/***************************************************************
 *  Call the BFF /auth/refresh endpoint.
 ***************************************************************/
function do_bff_refresh(gobj)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");

    fetch(build_path(bff_url, "auth", "refresh"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"}
    })
    .then(resp => resp.json())
    .then(data => {
        if(data.success) {
            gobj_send_event(gobj, "EV_LOGIN_REFRESHED", data, gobj);
        } else {
            const error_code = data.error_code || "refresh_denied";
            const error      = data.error || "Refresh denied";
            log_info(sprintf("%s: BFF refresh denied: %s (%s)",
                gobj_short_name(gobj), error_code, error));
            gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error}, gobj);
        }
    })
    .catch(err => {
        log_error(`${gobj_short_name(gobj)}: BFF refresh failed: ${err.message}`);
        gobj_send_event(gobj, "EV_LOGIN_DENIED",
            {error_code: "network_error", error: "Network error during refresh"}, gobj);
    });
}

/***************************************************************
 *  Try to restore the session from httpOnly cookies on page load.
 ***************************************************************/
function try_restore_session(gobj)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");

    fetch(build_path(bff_url, "auth", "refresh"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"}
    })
    .then(resp => resp.json())
    .then(data => {
        if(data.success) {
            gobj_write_attr(gobj, "username", data.username || data.email || "");
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", data, gobj);
        } else {
            gobj_change_state(gobj, "ST_LOGOUT");
            gobj_publish_event(gobj, "EV_RESTORE_FAILED", {});
        }
    })
    .catch(() => {
        gobj_change_state(gobj, "ST_LOGOUT");
        gobj_publish_event(gobj, "EV_RESTORE_FAILED", {});
    });
}

/***************************************************************
 *  Fetch the access_token from the BFF (POST /auth/token) so the SPA
 *  can forward it in each C_IEVENT_CLI identity_card, then publish the
 *  output event with the token. If the endpoint is disabled (flag off
 *  → 404) or fails, publish with an empty token and warn: same-origin
 *  cookie auth still works; cross-origin backends will NAK until the
 *  BFF opts in.
 ***************************************************************/
function fetch_and_publish(gobj, out_event)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");

    fetch(build_path(bff_url, "auth", "token"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"}
    })
    .then(resp => resp.json().then(data => ({ok: resp.ok, data})))
    .then(({ok, data}) => {
        let token = (ok && data.success && data.access_token) ? data.access_token : "";
        if(!token) {
            log_warning(sprintf("%s: /auth/token returned no access_token "
                + "(is expose_access_token enabled on the BFF?)", gobj_short_name(gobj)));
        }
        gobj_write_attr(gobj, "access_token", token);
        /*
         *  Resolve the username for the avatar initials. /auth/login returns
         *  it, but /auth/refresh (session restore on F5) does NOT — so fall
         *  back to the identity claims in the access_token (the authoritative
         *  identity; gui_agent gets its name from the control-center's
         *  EV_ON_OPEN instead, which gui_treedb has no single equivalent of).
         */
        let username = gobj_read_attr(gobj, "username");
        if(!username && token) {
            username = username_from_jwt(token);
            if(username) {
                gobj_write_attr(gobj, "username", username);
            }
        }
        gobj_publish_event(gobj, out_event, {username, access_token: token});
    })
    .catch(err => {
        log_warning(`${gobj_short_name(gobj)}: /auth/token fetch failed: ${err.message}`);
        gobj_write_attr(gobj, "access_token", "");
        gobj_publish_event(gobj, out_event,
            {username: gobj_read_attr(gobj, "username"), access_token: ""});
    });
}

/***************************************************************
 *  Extract a display identity from the access_token (JWT) claims, for the
 *  avatar initials when the BFF response carried no username (restore path).
 *  Read-only claim inspection for display — the token was already validated
 *  by the backend.
 ***************************************************************/
function username_from_jwt(token)
{
    try {
        let part = String(token).split(".")[1];
        if(!part) {
            return "";
        }
        part = part.replace(/-/g, "+").replace(/_/g, "/");
        while(part.length % 4) {
            part += "=";
        }
        let bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
        let claims = JSON.parse(new TextDecoder().decode(bytes));
        return claims.name || claims.preferred_username || claims.email || "";
    } catch(e) {
        return "";
    }
}

/***************************************************************
 *  Store session timing info (no tokens kept beyond the in-memory
 *  access_token). Arms the refresh timer before the access_token
 *  expires.
 ***************************************************************/
function save_session_info(gobj, data)
{
    let priv = gobj.priv;

    priv.refresh_expires_in = data.refresh_expires_in || 0;

    let access_expires = data.expires_in || 300;
    priv.timeout_refresh = Math.max(
        Math.floor(access_expires * 0.75),
        access_expires - 30
    );
    if(priv.timeout_refresh <= 0) {
        priv.timeout_refresh = 2;
    }
    set_timeout(priv.gobj_timer, priv.timeout_refresh * 1000);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_do_login(gobj, event, kw, src)
{
    const username = (kw && kw.username) ? kw.username : "";
    const password = (kw && kw.password) ? kw.password : "";
    do_bff_login(gobj, username, password);
    return 0;
}

function ac_do_logout(gobj, event, kw, src)
{
    do_bff_logout(gobj);
    return 0;
}

function ac_do_refresh(gobj, event, kw, src)
{
    do_bff_refresh(gobj);
    return 0;
}

/***************************************************************
 *  EV_LOGIN_ACCEPTED — BFF login/restore succeeded. Fetch the
 *  access_token, then publish EV_LOGIN_ACCEPTED with it.
 ***************************************************************/
function ac_login_accepted(gobj, event, kw, src)
{
    save_session_info(gobj, kw);
    fetch_and_publish(gobj, "EV_LOGIN_ACCEPTED");
    return 0;
}

/***************************************************************
 *  EV_LOGIN_REFRESHED — BFF refresh succeeded. Re-fetch the (rotated)
 *  access_token and publish it so the app pushes it onto live links.
 ***************************************************************/
function ac_login_refreshed(gobj, event, kw, src)
{
    save_session_info(gobj, kw);
    fetch_and_publish(gobj, "EV_LOGIN_REFRESHED");
    return 0;
}

function ac_login_denied(gobj, event, kw, src)
{
    gobj_write_attr(gobj, "username", "");
    gobj_write_attr(gobj, "access_token", "");
    gobj_publish_event(gobj, "EV_LOGIN_DENIED", kw);
    return 0;
}

function ac_logout_done(gobj, event, kw, src)
{
    gobj_write_attr(gobj, "username", "");
    gobj_write_attr(gobj, "access_token", "");
    gobj_publish_event(gobj, "EV_LOGOUT_DONE", kw);
    return 0;
}

function ac_clear_session(gobj, event, kw, src)
{
    gobj_write_attr(gobj, "username", "");
    gobj_write_attr(gobj, "access_token", "");
    return 0;
}

function ac_timeout(gobj, event, kw, src)
{
    do_bff_refresh(gobj);
    return 0;
}




                    /***************************
                     *          FSM
                     ***************************/




const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy
};

function create_gclass(gclass_name)
{
    if(__gclass__) {
        log_error(`GClass ALREADY created: ${gclass_name}`);
        return -1;
    }

    const states = [
        ["ST_LOGOUT", [
            ["EV_DO_LOGIN",        ac_do_login,        "ST_WAIT_TOKEN"],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_DO_LOGOUT",       ac_clear_session,   null],
            ["EV_LOGOUT_DONE",     ac_clear_session,   null]
        ]],

        ["ST_WAIT_TOKEN", [
            ["EV_DO_LOGIN",        ac_do_login,        null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  "ST_LOGIN"],
            ["EV_LOGIN_DENIED",    ac_login_denied,    "ST_LOGOUT"]
        ]],

        ["ST_LOGIN", [
            ["EV_DO_LOGOUT",       ac_do_logout,       null],
            ["EV_DO_REFRESH",      ac_do_refresh,      null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    "ST_LOGOUT"],
            ["EV_LOGOUT_DONE",     ac_logout_done,     "ST_LOGOUT"],
            ["EV_TIMEOUT",         ac_timeout,         null]
        ]]
    ];

    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_DO_LOGIN",        0],
        ["EV_DO_LOGOUT",       0],
        ["EV_DO_REFRESH",      0],
        ["EV_LOGIN_ACCEPTED",  out],
        ["EV_LOGIN_DENIED",    out],
        ["EV_LOGIN_REFRESHED", out],
        ["EV_LOGOUT_DONE",     out],
        ["EV_RESTORE_FAILED",  out],
        ["EV_TIMEOUT",         0]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,
        attrs_table,
        PRIVATE_DATA,
        0,
        0,
        0,
        0
    );

    return __gclass__ ? 0 : -1;
}

function register_c_login()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_login};
