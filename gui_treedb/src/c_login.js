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
    gobj_current_state,
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

/*  A BFF call that never answers must not hang the session: without a
 *  deadline a stalled /auth/refresh simply never resolved, so the refresh
 *  timer was never re-armed and the session drifted to expiry with nothing
 *  ever retrying.  */
const BFF_TIMEOUT_MS = 15000;

/*  Backoff for a refresh that failed for a TRANSIENT reason (the network
 *  went, the BFF answered 502). The session is NOT dead — the refresh token
 *  in the httpOnly cookie is still there — so retry instead of logging the
 *  user out, and back off so a BFF that is down is not hammered.  */
const REFRESH_RETRY_MIN_MS = 5000;
const REFRESH_RETRY_MAX_MS = 60000;


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
    gobj_timer:         null,
    refresh_at:         0,      /*  epoch ms the refresh timer is due at  */
    retry_ms:           0,      /*  current transient-failure backoff (0 = none)  */
    on_wake:            null,   /*  visibilitychange / online listener  */
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
     *  Coming back from a sleeping laptop / a dead network is an OS
     *  notification like any other: its handler's only job is to make it an
     *  event. Background tabs get their timers throttled, so the refresh timer
     *  fires LATE — often after the access_token is already dead, which the
     *  backend answers with a NAK and the user experiences as "it logged me
     *  out while I was away". The action checks the deadline on wake.
     */
    priv.on_wake = function() {
        if(document.visibilityState !== "visible") {
            return;
        }
        gobj_send_event(gobj, "EV_WAKEUP", {}, gobj);
    };
    document.addEventListener("visibilitychange", priv.on_wake);
    window.addEventListener("online", priv.on_wake);

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
    if(priv.on_wake) {
        document.removeEventListener("visibilitychange", priv.on_wake);
        window.removeEventListener("online", priv.on_wake);
        priv.on_wake = null;
    }
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
 *  POST to a BFF /auth/<segment> endpoint, with a deadline, and always
 *  resolve to the same shape: {ok, status, data, transient}.
 *
 *  `transient` is the distinction the whole session hangs on: a failure of
 *  the TRANSPORT (the network went, the request timed out, the BFF answered
 *  5xx, the body was not JSON — a proxy error page) says NOTHING about the
 *  user's credentials. Reading `resp.json()` unguarded made a 502 throw and
 *  land in the same catch as a real rejection, so a blink of the network
 *  logged the user out and tore down every open card. Only the BFF ANSWERING
 *  "no" is a denial.
 ***************************************************************/
function post_bff(gobj, segment)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BFF_TIMEOUT_MS);

    return fetch(build_path(bff_url, "auth", segment), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"},
        signal:      controller.signal
    })
    .then((resp) => resp.json()
        .then((data) => ({
            ok:        resp.ok,
            status:    resp.status,
            data:      data || {},
            transient: !resp.ok && resp.status >= 500
        }))
        .catch(() => ({
            /*  A body that is not JSON is never a verdict on the user: it is a
             *  gateway/proxy page. 4xx keeps its meaning (denied), 5xx and the
             *  rest are transport noise.  */
            ok:        false,
            status:    resp.status,
            data:      {},
            transient: !(resp.status >= 400 && resp.status < 500)
        })))
    .catch((err) => ({
        ok:        false,
        status:    0,
        data:      {error: err && err.message ? err.message : String(err)},
        transient: true    /*  fetch rejected: offline, DNS, TLS, or our abort  */
    }))
    .finally(() => clearTimeout(timer));
}

/***************************************************************
 *  POST username/password to the BFF /auth/login endpoint.
 ***************************************************************/
function do_bff_login(gobj, username, password)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BFF_TIMEOUT_MS);

    fetch(build_path(bff_url, "auth", "login"), {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"},
        body:        JSON.stringify({username, password}),
        signal:      controller.signal
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
    })
    .finally(() => clearTimeout(timer));
}

/***************************************************************
 *  Call the BFF /auth/logout endpoint. A logout the BFF never confirmed is
 *  still a logout HERE: the local session is dropped either way.
 ***************************************************************/
function do_bff_logout(gobj)
{
    post_bff(gobj, "logout").then(({ok, data}) => {
        if(!ok) {
            log_warning(sprintf("%s: BFF logout failed (%s) — dropping the local session anyway",
                gobj_short_name(gobj), data.error || "?"));
        }
        gobj_send_event(gobj, "EV_LOGOUT_DONE", {}, gobj);
    });
}

/***************************************************************
 *  Call the BFF /auth/refresh endpoint.
 *
 *  A TRANSIENT failure does not end the session: it becomes
 *  EV_REFRESH_FAILED, which retries with backoff and leaves the shell, the
 *  links and the open cards exactly as they are. Only the BFF answering
 *  "no" is EV_LOGIN_DENIED.
 ***************************************************************/
function do_bff_refresh(gobj)
{
    post_bff(gobj, "refresh").then(({ok, status, data, transient}) => {
        if(transient) {
            let reason = data.error || `HTTP ${status}`;
            log_warning(sprintf("%s: BFF refresh could not be made (%s) — retrying",
                gobj_short_name(gobj), reason));
            gobj_send_event(gobj, "EV_REFRESH_FAILED", {error: reason}, gobj);
            return;
        }
        if(ok && data.success) {
            gobj_send_event(gobj, "EV_LOGIN_REFRESHED", data, gobj);
            return;
        }
        const error_code = data.error_code || `http_${status}`;
        const error      = data.error || "Refresh denied";
        log_info(sprintf("%s: BFF refresh denied: %s (%s)",
            gobj_short_name(gobj), error_code, error));
        gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error}, gobj);
    });
}

/***************************************************************
 *  Try to restore the session from httpOnly cookies on page load.
 *  Anything short of a success shows the login form — on a cold load there
 *  is no session to protect, so a transient failure is not worth a retry
 *  loop the user cannot see.
 ***************************************************************/
function try_restore_session(gobj)
{
    post_bff(gobj, "refresh").then(({ok, data}) => {
        if(ok && data.success) {
            gobj_write_attr(gobj, "username", data.username || data.email || "");
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", data, gobj);
            return;
        }
        gobj_send_event(gobj, "EV_RESTORE_FAILED", {}, gobj);
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
        gobj_send_event(gobj, "EV_TOKEN_FETCHED",
            {out_event: out_event, username: username, access_token: token}, gobj);
    })
    .catch(err => {
        log_warning(`${gobj_short_name(gobj)}: /auth/token fetch failed: ${err.message}`);
        gobj_write_attr(gobj, "access_token", "");
        gobj_send_event(gobj, "EV_TOKEN_FETCHED",
            {out_event: out_event, username: gobj_read_attr(gobj, "username"),
             access_token: ""}, gobj);
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

    let access_expires = data.expires_in || 300;
    priv.timeout_refresh = Math.max(
        Math.floor(access_expires * 0.75),
        access_expires - 30
    );
    if(priv.timeout_refresh <= 0) {
        priv.timeout_refresh = 2;
    }
    priv.retry_ms = 0;      /*  a refresh landed: the backoff starts over  */
    arm_refresh(gobj, priv.timeout_refresh * 1000);
}

/***************************************************************
 *  Arm the refresh timer and REMEMBER when it is due. The deadline is what
 *  the wake-up path consults: a laptop that slept through the timer wakes
 *  with a browser-throttled timer that fires late (or after the token is
 *  already dead), and nothing else in the SPA would notice.
 ***************************************************************/
function arm_refresh(gobj, ms)
{
    let priv = gobj.priv;
    priv.refresh_at = Date.now() + ms;
    set_timeout(priv.gobj_timer, ms);
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
    clear_timeout(gobj.priv.gobj_timer);    // session dead: no dangling refresh timer into ST_LOGOUT
    gobj_write_attr(gobj, "username", "");
    gobj_write_attr(gobj, "access_token", "");
    gobj_publish_event(gobj, "EV_LOGIN_DENIED", kw);
    return 0;
}

function ac_logout_done(gobj, event, kw, src)
{
    clear_timeout(gobj.priv.gobj_timer);    // session dead: no dangling refresh timer into ST_LOGOUT
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

/***************************************************************
 *  No session to restore on page load (no/expired cookies). Not an
 *  error: the app just shows the login form.
 *
 *  The fetch callback SENDS this instead of changing state and publishing
 *  by itself: a promise is an OS notification, and its only job is to turn
 *  it into an event. Before, the state change lived outside the FSM and
 *  EV_RESTORE_FAILED was declared in `event_types` but handled in NO
 *  state — a transition that existed only in hand-written code.
 ***************************************************************/
function ac_restore_failed(gobj, event, kw, src)
{
    gobj_publish_event(gobj, "EV_RESTORE_FAILED", {});
    return 0;
}

/***************************************************************
 *  The access_token came back from the BFF (/auth/token): publish the
 *  output event the flow asked for (EV_LOGIN_ACCEPTED on a fresh login /
 *  restore, EV_LOGIN_REFRESHED on a rotation) with the token, so the app
 *  can forward it in every C_IEVENT_CLI identity_card.
 ***************************************************************/
function ac_token_fetched(gobj, event, kw, src)
{
    let out_event = (kw && kw.out_event) || "";
    if(out_event !== "EV_LOGIN_ACCEPTED" && out_event !== "EV_LOGIN_REFRESHED") {
        log_error(sprintf("%s: EV_TOKEN_FETCHED with a bad out_event: %s",
            gobj_short_name(gobj), out_event));
        return -1;
    }
    gobj_publish_event(gobj, out_event, {
        username:     (kw && kw.username) || "",
        access_token: (kw && kw.access_token) || ""
    });
    return 0;
}

function ac_timeout(gobj, event, kw, src)
{
    do_bff_refresh(gobj);
    return 0;
}

/***************************************************************
 *  The refresh could not be MADE (network down, BFF 502, request timed
 *  out). The session is not denied — the refresh cookie is untouched — so
 *  keep it, back off, and try again. Tearing the SPA down to the login
 *  form on a blink of the network destroyed the shell, closed every link
 *  and lost every open card, for a failure that heals itself.
 ***************************************************************/
function ac_refresh_failed(gobj, event, kw, src)
{
    let priv = gobj.priv;

    priv.retry_ms = priv.retry_ms
        ? Math.min(priv.retry_ms * 2, REFRESH_RETRY_MAX_MS)
        : REFRESH_RETRY_MIN_MS;
    arm_refresh(gobj, priv.retry_ms);

    gobj_publish_event(gobj, "EV_REFRESH_FAILED", {
        error:    (kw && kw.error) || "",
        retry_ms: priv.retry_ms
    });
    return 0;
}

/***************************************************************
 *  The tab came back to the foreground, or the network came back. A
 *  background tab's timers are throttled, so the refresh may be overdue by
 *  minutes: if its deadline has passed, refresh NOW instead of waiting for
 *  a timer the browser is holding back.
 ***************************************************************/
function ac_wakeup(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(gobj_current_state(gobj) !== "ST_LOGIN") {
        return 0;       /*  no session to keep alive  */
    }
    if(!priv.refresh_at || Date.now() < priv.refresh_at) {
        return 0;       /*  the timer is still ahead of us: let it fire  */
    }
    log_info(sprintf("%s: back from sleep with the refresh overdue — refreshing now",
        gobj_short_name(gobj)));
    clear_timeout(priv.gobj_timer);
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

    /*
     *  EV_WAKEUP is declared in EVERY state: it is an OS notification (the tab
     *  came to the foreground, the network came back), not a user action — it
     *  lands whenever the OS decides, session or no session. Its action is the
     *  one that knows there is nothing to do without one.
     */
    const states = [
        ["ST_LOGOUT", [
            ["EV_DO_LOGIN",        ac_do_login,        "ST_WAIT_TOKEN"],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_WAKEUP",          ac_wakeup,          null],
            ["EV_DO_LOGOUT",       ac_clear_session,   null],
            ["EV_LOGOUT_DONE",     ac_clear_session,   null],
            /*
             *  A refresh is only ever initiated from ST_LOGIN (NAK recovery),
             *  but its async result can resolve after a concurrent logout has
             *  moved us here: EV_LOGIN_DENIED is already handled above, and a
             *  stale EV_LOGIN_REFRESHED success is discarded (we are logged out
             *  on purpose) instead of raising "event not defined".
             */
            ["EV_LOGIN_REFRESHED", ac_clear_session,   null],
            /*
             *  Same shape: the /auth/token fetch of a session that was logged
             *  out while it was in flight. The token is stale — drop it.
             */
            ["EV_TOKEN_FETCHED",   ac_clear_session,   null],
            /*
             *  And the transient failure of a refresh that was in flight when
             *  the user logged out: there is no session left to keep alive, so
             *  it must NOT re-arm the retry timer.
             */
            ["EV_REFRESH_FAILED",  ac_clear_session,   null]
        ]],

        ["ST_WAIT_TOKEN", [
            ["EV_DO_LOGIN",        ac_do_login,        null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  "ST_LOGIN"],
            ["EV_LOGIN_DENIED",    ac_login_denied,    "ST_LOGOUT"],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  "ST_LOGOUT"],
            ["EV_WAKEUP",          ac_wakeup,          null]
        ]],

        ["ST_LOGIN", [
            ["EV_DO_LOGOUT",       ac_do_logout,       null],
            ["EV_DO_REFRESH",      ac_do_refresh,      null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    "ST_LOGOUT"],
            ["EV_LOGOUT_DONE",     ac_logout_done,     "ST_LOGOUT"],
            ["EV_TOKEN_FETCHED",   ac_token_fetched,   null],
            ["EV_TIMEOUT",         ac_timeout,         null],
            ["EV_WAKEUP",          ac_wakeup,          null]
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
        ["EV_REFRESH_FAILED",  out],
        ["EV_LOGOUT_DONE",     out],
        ["EV_RESTORE_FAILED",  out],
        ["EV_TOKEN_FETCHED",   0],
        ["EV_TIMEOUT",         0],
        ["EV_WAKEUP",          0]
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
