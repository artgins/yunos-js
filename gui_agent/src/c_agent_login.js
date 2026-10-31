/***********************************************************************
 *          c_agent_login.js
 *
 *      C_AGENT_LOGIN — OIDC login via the auth BFF (named service
 *      "agent_login"), the same model gui_treedb and the applications use.
 *
 *      Security: tokens are NEVER in JavaScript. The browser
 *      POSTs username/password to the BFF /auth/login; the BFF exchanges
 *      them with Keycloak server-side and writes access/refresh tokens as
 *      httpOnly, Secure, SameSite=Strict cookies scoped to this host.
 *      The agent WebSocket upgrade then carries those cookies
 *      automatically (same-host), so the JS side only ever sees
 *      {username, expires_in}. Refresh / logout / session-restore also go
 *      through the BFF.
 *
 *      The BFF base URL comes from the (user-configurable) auth config in
 *      C_AGENT_CONFIG; empty defaults to https://<host>:1806. The BFF
 *      MUST be same-host as the SPA (its cookie is scoped to this host).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error, log_info, log_warning,
    gobj_name, gobj_short_name,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_change_state, gobj_current_state,
    gobj_subscribe_event, gobj_publish_event, gobj_send_event,
    gobj_find_service,
    gobj_create_pure_child,
    set_timeout, clear_timeout,
} from "@yuneta/gobj-js";

import {deploy_info} from "./conf/deploy.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_LOGIN";

/*
 *  A BFF call that never answers must not hang the login or the session:
 *  every call to the BFF (/auth/login, /auth/refresh, /auth/logout, and
 *  the monitor's /auth/token) is aborted after this, headers AND body,
 *  and ends as a call that failed. Without it a stalled /auth/refresh
 *  never resolved, so the refresh timer was never re-armed and the
 *  session drifted to expiry with nothing retrying.
 */
const BFF_TIMEOUT_MS = 15000;

/*
 *  The error_code a denial can carry that the app shows translated: the
 *  whole catalog of the BFF (c_auth_bff.h), the codes this module gives
 *  a call the BFF did not answer with one, and the one the app gives an
 *  identity the control center refused (ac_on_id_nak() of C_APP). Any
 *  other code shows the BFF's English `error`.
 */
export const AUTH_ERROR_I18N_KEYS = [
    "invalid_credentials", "session_expired", "account_disabled", "auth_rate_limited",
    "auth_service_unavailable", "auth_config_error", "auth_unexpected_error",
    "auth_empty_response", "auth_timeout", "token_too_large",
    "method_not_allowed", "missing_body", "missing_params", "redirect_uri_not_allowed",
    "origin_not_allowed", "missing_refresh_token", "missing_access_token",
    "unknown_endpoint", "server_busy", "internal_error",
    "network_error", "auth_bad_response", "authentication required"
];

/*
 *  Backoff of a refresh that failed for a reason that may pass (no
 *  answer, a 5xx, a 429): keep the session and retry, instead of tearing
 *  the shell down to the login form for a failure that heals itself.
 *  Mirrors gui_treedb.
 */
const REFRESH_RETRY_MIN_MS = 5000;
const REFRESH_RETRY_MAX_MS = 60000;

/*
 *  A refresh the BFF answers with an error_code ends the session when its
 *  status is a 4xx (the BFF's "no") and is retried when it is a 5xx (an
 *  outage). These codes say the opposite of their status: a 429 passes
 *  with time, and these 5xx come back on every retry (a BFF misconfigured,
 *  an IdP answer the BFF cannot use, a token too large for a cookie, a
 *  bug of the BFF), so the session ends with their message.
 */
const REFRESH_RETRIED_CODES = ["auth_rate_limited"];
const REFRESH_FINAL_CODES = [
    "auth_config_error", "auth_unexpected_error", "token_too_large", "internal_error"
];

/*
 *  An answer that is not the BFF's json (the login page of a proxy, a 200
 *  {}) may never change: the fifth since the last refresh that landed
 *  ends the session with "auth_bad_response" and the login form says it,
 *  instead of retrying for ever with nothing shown. Answers of another
 *  kind in between (a 5xx, no answer) do not start the count over; only
 *  a refresh that lands does.
 */
const REFRESH_BAD_ANSWERS_MAX = 5;

/*
 *  A 429 passes with time, but not always soon: the fifth since the last
 *  refresh that landed ends the session with "auth_rate_limited", and so
 *  does one whose Retry-After is longer than REFRESH_RETRY_AFTER_MAX_MS.
 *  A retried failure waits for its Retry-After (seconds or an HTTP-date)
 *  when it is longer than the backoff, up to REFRESH_RETRY_AFTER_MAX_MS.
 */
const REFRESH_RATE_LIMITED_MAX = 5;
const REFRESH_RETRY_AFTER_MAX_MS = 5 * 60 * 1000;

/*  The names of an HTTP-date (http_date_ms()), case-sensitive, in the
 *  order of Date.getUTCDay() and Date.getUTCMonth().  */
const HTTP_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HTTP_DAY_NAMES_LONG = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];
const HTTP_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,  "C_AGENT_CONFIG service"),
SDATA(data_type_t.DTP_STRING,   "username",    0,  "",    "Authenticated username"),
SDATA_END()
];

let PRIVATE_DATA = {
    gobj_timer:      null,
    timeout_refresh: 0,
    retry_ms:        0,      /*  current transient-failure backoff (0 = none)  */
    bad_answers:     0,      /*  answers not the BFF's json since the last refresh that landed  */
    rate_limited:    0,      /*  429 answers since the last refresh that landed  */
    generation:      0,      /*  the session the requests in flight belong to  */
    refresh_in_flight: -1,   /*  the generation of the refresh in flight, -1 when none  */
    held_login:      null,   /*  {username, password} asked for while the logout was in flight  */
    held_logout:     false,  /*  a logout asked for while the login was in flight  */
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

    /*
     *  SERVICE subscription model
     */
    const subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(subscriber) {
        gobj_subscribe_event(gobj, null, {}, subscriber);
    }

    gobj_write_attr(gobj, "config_svc", gobj_find_service("agent_config", true));
}

/***************************************************************
 *          Framework Method: Start
 *  Try to restore a session from the httpOnly cookies (F5).
 ***************************************************************/
function mt_start(gobj)
{
    gobj_change_state(gobj, "ST_WAIT_TOKEN");
    try_restore_session(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    clear_timeout(gobj.priv.gobj_timer);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
}




                    /***************************
                     *      Public functions
                     ***************************/




/***************************************************************
 *  Username of the current session, or "".
 ***************************************************************/
function agent_login_username(gobj)
{
    return (gobj && gobj.priv) ? (gobj_read_attr(gobj, "username") || "") : "";
}

/***************************************************************
 *  True while a session is established (cookie held by browser).
 ***************************************************************/
function agent_login_is_logged_in(gobj)
{
    return !!(gobj && gobj_current_state(gobj) === "ST_LOGIN");
}




                    /***************************
                     *      Local Methods
                     ***************************/




function bff_base(gobj)
{
    return deploy_info().bff_url;
}

/***************************************************************
 *  POST to the BFF /auth/<segment> (with `body` as its JSON, when
 *  given) with a deadline, BFF_TIMEOUT_MS, that covers the headers and
 *  the body. Always resolves, to the same shape:
 *  {ok, status, data, timed_out, retry_after}: `status` 0 is no answer,
 *  `data` is {error} when the body is not json or did not come in time
 *  (bff_error_code() names each case), and `retry_after` is the
 *  Retry-After header as it came ("" when none, or none readable: a
 *  cross-origin answer shows it only when the server exposes it). Also
 *  used by C_MONITOR_LINK for /auth/token.
 ***************************************************************/
export function post_bff(gobj, segment, body)
{
    const url = `${bff_base(gobj)}/auth/${segment}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BFF_TIMEOUT_MS);
    let request = {
        method:      "POST",
        credentials: "include",
        headers:     {"Content-Type": "application/json"},
        signal:      controller.signal
    };
    if(body !== undefined) {
        request.body = JSON.stringify(body);
    }
    return fetch(url, request)
    .then((resp) => resp.json()
        .then((data) => ({
            ok:          resp.ok,
            status:      resp.status,
            data:        data || {},
            timed_out:   false,
            retry_after: resp.headers.get("Retry-After") || ""
        }))
        .catch((err) => {
            const timed_out = is_abort(err);
            return {
                ok:          false,
                status:      resp.status,
                data:        {error: timed_out ?
                    `no answer from the BFF at ${url} in time` :
                    `HTTP ${resp.status} with a body that is not the BFF's json (${err && err.message})`},
                timed_out:   timed_out,
                retry_after: resp.headers.get("Retry-After") || ""
            };
        }))
    .catch((err) => {
        const timed_out = is_abort(err);
        return {
            ok:          false,
            status:      0,
            data:        {error: timed_out ? `no answer from the BFF at ${url} in time` : bff_hint(err, url)},
            timed_out:   timed_out,
            retry_after: ""
        };
    })
    .finally(() => clearTimeout(timer));
}

/***************************************************************
 *  True when `err` is the abort of our deadline.
 ***************************************************************/
function is_abort(err)
{
    return !!(err && err.name === "AbortError");
}

/***************************************************************
 *  The year of an rfc850-date, whose text gives two digits of it
 *  (RFC 9110 5.6.7): the latest year with those digits that does not
 *  put the date more than 50 years after `now_ms`. So it holds in
 *  both ways: "06-Nov-76" read on 2026-10-31 is 1976, because 2076 is
 *  six days too far, and "05" read in 2060 is 2105, not 2005.
 ***************************************************************/
function rfc850_year(two_digits, month_index, day, clock, now_ms)
{
    const [hour, minute, second] = clock.split(":").map(Number);
    let limit = new Date(now_ms);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);

    const year = Math.floor(limit.getUTCFullYear() / 100) * 100 + two_digits;
    let when = new Date(0);
    when.setUTCFullYear(year, month_index, day);
    when.setUTCHours(hour, minute, second, 0);
    return (when.getTime() > limit.getTime()) ? year - 100 : year;
}

/***************************************************************
 *  The time an HTTP-date (RFC 9110 5.6.7) names, in epoch ms, or
 *  NaN when `text` is none: an IMF-fixdate ("Sun, 06 Nov 1994
 *  08:49:37 GMT"), or one of the two obsolete forms a recipient
 *  must read, rfc850-date ("Sunday, 06-Nov-94 08:49:37 GMT",
 *  rfc850_year() gives its year) and asctime-date ("Sun Nov  6
 *  08:49:37 1994", in GMT too). Names are case-sensitive,
 *  the day of the month, the hour, minute and second must exist
 *  (second 60 is a leap second), and the day name must be the one
 *  of that date: the rule the BFF passes a Retry-After of the IdP
 *  on with.
 ***************************************************************/
function http_date_ms(text, now_ms)
{
    let day_name, day, month, year, clock;
    let day_names = HTTP_DAY_NAMES;
    let two_digit_year = false;
    let m = text.match(/^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/);
    if(m) {
        [, day_name, day, month, year, clock] = m;
        year = Number(year);
    } else if((m = text.match(/^([A-Za-z]+), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/))) {
        [, day_name, day, month, year, clock] = m;
        day_names = HTTP_DAY_NAMES_LONG;
        two_digit_year = true;
    } else if((m = text.match(/^([A-Za-z]{3}) ([A-Za-z]{3}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/))) {
        [, day_name, month, day, clock, year] = m;
        year = Number(year);
    } else {
        return NaN;
    }
    const month_index = HTTP_MONTHS.indexOf(month);
    const [hour, minute, second] = clock.split(":").map(Number);
    day = Number(day);
    if(month_index < 0 || hour > 23 || minute > 59 || second > 60) {
        return NaN;
    }
    if(two_digit_year) {
        year = rfc850_year(Number(year), month_index, day, clock, now_ms);
    }
    let when = new Date(0);
    when.setUTCFullYear(year, month_index + 1, 0);     /*  the last day of that month  */
    if(day < 1 || day > when.getUTCDate()) {
        return NaN;
    }
    when.setUTCFullYear(year, month_index, day);
    if(day_names[when.getUTCDay()] !== day_name) {
        return NaN;
    }
    when.setUTCHours(hour, minute, second, 0);
    return when.getTime();
}

/***************************************************************
 *  The milliseconds a Retry-After header asks to wait (RFC 9110
 *  10.2.3): delay-seconds, 1*DIGIT, of any length (a delay no number
 *  holds is the longest one that does: every delay past
 *  REFRESH_RETRY_AFTER_MAX_MS is treated alike, so it is the digits'
 *  value and not their count that decides), or an HTTP-date (0 when
 *  it is already past). 0 for no header, and -1 for any other text:
 *  a sign, a fraction, two values, a date of another format, a date
 *  that is none.
 ***************************************************************/
function retry_after_ms(retry_after, now_ms)
{
    const text = String(retry_after || "").replace(/^[ \t]+|[ \t]+$/g, "");
    if(!text) {
        return 0;
    }
    if(/^\d+$/.test(text)) {
        return Math.min(Number(text) * 1000, Number.MAX_SAFE_INTEGER);
    }
    const when = http_date_ms(text, now_ms);
    if(Number.isNaN(when)) {
        return -1;
    }
    return Math.max(0, when - now_ms);
}

/***************************************************************
 *  The error_code of a login the BFF did not answer with one: no
 *  answer in BFF_TIMEOUT_MS is "auth_timeout", no answer at all
 *  "network_error", a 5xx with no error_code (a gateway, or a BFF down
 *  behind one) "auth_service_unavailable", and any other answer with
 *  no error_code "auth_bad_response": an empty body, a body cut
 *  halfway, a page in HTML, a json that is not the BFF's, whatever its
 *  status. A 429 is "auth_rate_limited" whatever its body, the BFF's
 *  own or that of a proxy that rate limits, even one that brings an
 *  error_code of its own, which would otherwise read as a denial and
 *  end the session: it is retried after its Retry-After and counted
 *  with the other 429s.
 ***************************************************************/
function bff_error_code({status, data, timed_out})
{
    if(status === 429) {
        return "auth_rate_limited";
    }
    if(data && data.error_code) {
        return data.error_code;
    }
    if(timed_out) {
        return "auth_timeout";
    }
    if(status === 0) {
        return "network_error";
    }
    if(status >= 500) {
        return "auth_service_unavailable";
    }
    return "auth_bad_response";
}

/***************************************************************
 *  What an answer that failed said, for the log: its text, the code it
 *  brought when it has none (a 429 is named by its status, whatever
 *  code it carries), or its status.
 ***************************************************************/
function bff_error_text({status, data})
{
    return data.error || data.error_code || `HTTP ${status}`;
}

/***************************************************************
 *  True when a refresh the BFF answered with `error_code` ends the
 *  session (see REFRESH_RETRIED_CODES / REFRESH_FINAL_CODES).
 ***************************************************************/
function refresh_code_ends_session(error_code, status)
{
    if(REFRESH_RETRIED_CODES.includes(error_code)) {
        return false;
    }
    if(REFRESH_FINAL_CODES.includes(error_code)) {
        return true;
    }
    return status < 500;
}

/***************************************************************
 *  True when `kw` is the answer of a request made for an earlier
 *  session: a logout, a denial or a new login came after the request
 *  went out (priv.generation moved). Its action drops it, so a late
 *  answer never moves the session that replaced it.
 ***************************************************************/
function is_superseded(gobj, event, kw)
{
    const generation = gobj.priv.generation;
    if(kw && kw.generation === generation) {
        return false;
    }
    log_info(`${gobj_short_name(gobj)}: ${event} of a superseded request dropped ` +
        `(request of session ${kw && kw.generation}, now ${generation})`);
    return true;
}

/***************************************************************
 *  The session ends: no refresh left armed, ST_LOGOUT, every request
 *  still in flight superseded, and EV_LOGIN_DENIED published with the
 *  cause for the login form.
 ***************************************************************/
function end_session(gobj, error_code, error)
{
    let priv = gobj.priv;
    clear_timeout(priv.gobj_timer);
    priv.generation++;
    gobj_write_attr(gobj, "username", "");
    gobj_change_state(gobj, "ST_LOGOUT");
    gobj_publish_event(gobj, "EV_LOGIN_DENIED", {
        error_code: error_code || "",
        error:      error || ""
    });
}

/***************************************************************
 *  POST username/password to the BFF /auth/login. The BFF sets
 *  httpOnly cookies and returns {success, username, expires_in,
 *  refresh_expires_in}.
 ***************************************************************/
function do_bff_login(gobj, username, password)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "login", {username, password}).then((answer) => {
        const {ok, status, data} = answer;
        if(ok && data.success) {
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", {
                ...data,
                username:   data.username || data.email || username,
                generation: generation
            }, gobj);
            return;
        }
        const error_code = bff_error_code(answer);
        const error      = bff_error_text(answer);
        if(data.error_code === error_code) {
            /*  The BFF's own denial: it logged the cause itself.  */
            log_info(`${gobj_short_name(gobj)}: BFF login denied: ${error_code} (${error})`);
        } else {
            log_error(`${gobj_short_name(gobj)}: BFF login failed: ${error_code} (${error})`);
        }
        gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error, generation}, gobj);
    });
}

/***************************************************************
 *  POST /auth/refresh (reads refresh_token cookie, rotates cookies).
 *
 *  A refresh the BFF answers with an error_code that a retry would give
 *  again ends the session: EV_LOGIN_DENIED (refresh_code_ends_session()).
 *  Anything else keeps it: EV_REFRESH_FAILED backs off and retries with
 *  the shell, the link and the open views left as they are, and
 *  ac_refresh_failed() ends the session after REFRESH_BAD_ANSWERS_MAX
 *  answers that are not the BFF's json. The error_code is the one of a
 *  login (bff_error_code): a failure of the transport (no answer, no
 *  answer in time, 5xx) or a 429 is a WARNING; an answer that is not the
 *  BFF's json (a page of a proxy, a json with neither success nor
 *  error_code, whatever its status) is "auth_bad_response", an ERROR, as
 *  at the login.
 ***************************************************************/
function do_bff_refresh(gobj)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "refresh").then((answer) => {
        const {ok, status, data} = answer;
        if(ok && data.success) {
            gobj_send_event(gobj, "EV_LOGIN_REFRESHED", {...data, generation}, gobj);
            return;
        }
        const error_code = bff_error_code(answer);
        const error      = bff_error_text(answer);
        if(data.error_code && refresh_code_ends_session(error_code, status)) {
            /*  The BFF's own answer: it logged the cause itself.  */
            log_info(`${gobj_short_name(gobj)}: BFF refresh denied: ${error_code} (${error})`);
            gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error, generation}, gobj);
            return;
        }
        const wait_ms = retry_after_ms(answer.retry_after, Date.now());
        const msg = `${gobj_short_name(gobj)}: BFF refresh failed: ${error_code} (${error})` +
            (answer.retry_after ? `, Retry-After: ${answer.retry_after}` +
                (wait_ms < 0 ? " (unreadable, ignored)" : "") : "");
        if(error_code === "auth_bad_response") {
            log_error(msg);
        } else {
            log_warning(msg);
        }
        gobj_send_event(gobj, "EV_REFRESH_FAILED", {
            error_code, error, generation, retry_after_ms: Math.max(0, wait_ms)
        }, gobj);
    });
}

/***************************************************************
 *  POST /auth/logout (revokes + clears cookies). EV_LOGOUT_DONE comes
 *  when the call has settled -- answered, or aborted by its deadline,
 *  after which the browser takes no Set-Cookie of it -- so the cookies
 *  it clears are cleared before any login made after it. A logout the
 *  BFF did not answer with success (refused, failed, never answered)
 *  is still a logout HERE, and EV_LOGOUT_DONE says it was not one on
 *  the server (`ended_on_server` false, with the `error_code` of
 *  bff_error_code()): the cookies are still there, and a reload of the
 *  page would restore the session. Whatever the failure it is a
 *  WARNING, by the rule of a decoder: the peer did it, no contract of
 *  ours is broken.
 ***************************************************************/
function do_bff_logout(gobj)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "logout").then((answer) => {
        const {ok, data} = answer;
        const ended_on_server = !!(ok && data.success);
        const error_code = ended_on_server ? "" : bff_error_code(answer);
        if(!ended_on_server) {
            /*  What the peer did, not a broken contract of ours: a WARNING.  */
            log_warning(`${gobj_short_name(gobj)}: BFF logout failed: ${error_code} ` +
                `(${bff_error_text(answer)}) — dropping the local session anyway`);
        }
        gobj_send_event(gobj, "EV_LOGOUT_DONE", {
            generation, ended_on_server, error_code, error: data.error || ""
        }, gobj);
    });
}

/***************************************************************
 *  On load, try to restore a session via /auth/refresh (the
 *  cookies, if still valid). No error shown on failure — it's the
 *  normal "no session yet" case.
 ***************************************************************/
function try_restore_session(gobj)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "refresh").then(({ok, data}) => {
        if(ok && data.success) {
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", {
                ...data,
                username:   data.username || data.email || "",
                generation: generation
            }, gobj);
            return;
        }
        gobj_send_event(gobj, "EV_RESTORE_FAILED", {generation}, gobj);
    });
}

/***************************************************************
 *  Arm the refresh timer to run before the access token expires,
 *  so the cookie the WebSocket carries stays valid.
 ***************************************************************/
function save_session_info(gobj, data)
{
    let priv = gobj.priv;
    let access_expires = parseInt(data.expires_in, 10) || 300;
    priv.timeout_refresh = Math.max(Math.floor(access_expires * 0.75), access_expires - 30);
    if(priv.timeout_refresh <= 0) {
        priv.timeout_refresh = 2;
    }
    priv.retry_ms = 0;      /*  a refresh landed: the backoff starts over  */
    priv.bad_answers = 0;
    priv.rate_limited = 0;
    set_timeout(priv.gobj_timer, priv.timeout_refresh * 1000);
}

/***************************************************************
 *  End the session: every request of it still in flight is superseded
 *  from now on, no refresh is armed, and the BFF is asked to end it
 *  (EV_LOGOUT_DONE when it has settled). The state is ST_LOGGING_OUT.
 ***************************************************************/
function start_logout(gobj)
{
    gobj.priv.generation++;
    clear_timeout(gobj.priv.gobj_timer);
    do_bff_logout(gobj);
}

/***************************************************************
 *  The login settled (`event`, any answer) with a logout asked for
 *  while it was in flight (ac_hold_logout()): that logout goes out
 *  now, so the cookies the login may have set are cleared, and its
 *  EV_LOGOUT_DONE is the answer. True when it went out.
 ***************************************************************/
function take_held_logout(gobj, event)
{
    let priv = gobj.priv;
    if(!priv.held_logout) {
        return false;
    }
    priv.held_logout = false;
    log_info(`${gobj_short_name(gobj)}: ${event} with a logout asked for: logging out`);
    gobj_change_state(gobj, "ST_LOGGING_OUT");
    start_logout(gobj);
    return true;
}

/***************************************************************
 *  Send a refresh, `why` naming who asked for it, unless a refresh of
 *  this session is in flight: that one answers every caller. Two at
 *  once would both carry the same refresh token, the first rotates it,
 *  and an IdP that revokes a refresh token used twice ends the session
 *  at the second. The timer is disarmed: the answer arms it again.
 ***************************************************************/
function request_refresh(gobj, why)
{
    let priv = gobj.priv;
    if(priv.refresh_in_flight === priv.generation) {
        log_info(`${gobj_short_name(gobj)}: ${why} while a refresh is in flight: that one answers it`);
        return;
    }
    priv.refresh_in_flight = priv.generation;
    clear_timeout(priv.gobj_timer);
    do_bff_refresh(gobj);
}

/***************************************************************
 *  A "Failed to fetch" against the BFF is usually CORS/host/cert.
 ***************************************************************/
function bff_hint(err, url)
{
    if(err instanceof TypeError) {
        return `${err.message} — check the BFF is reachable at ${url} ` +
               `(same host as this app, cert trusted, allowed_origin set)`;
    }
    return err.message;
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  A new login: every request of the session before it is superseded,
 *  and a logout that waited for the login before it is dropped.
 ***************************************************************/
function ac_do_login(gobj, event, kw, src)
{
    if(gobj.priv.held_logout) {
        gobj.priv.held_logout = false;
        log_info(`${gobj_short_name(gobj)}: a login asked for: the logout that waited for the login ` +
            `is dropped`);
    }
    gobj.priv.generation++;
    do_bff_login(gobj, kw.username || "", kw.password || "");
    return 0;
}

/***************************************************************
 *  The user ends the session: every request of it still in flight is
 *  superseded from now on, no refresh is armed, and until the logout
 *  has settled (ST_LOGGING_OUT) no refresh and no login leaves.
 ***************************************************************/
function ac_do_logout(gobj, event, kw, src)
{
    start_logout(gobj);
    return 0;
}

/***************************************************************
 *  A logout asked for while the login (or the restore on load) is in
 *  flight waits for it: a logout that went out now could be answered
 *  before the login, whose answer would then set the cookies of a
 *  session nobody ends. It goes out when the login settles, whatever
 *  its answer (take_held_logout()). A login asked for after it drops
 *  it.
 ***************************************************************/
function ac_hold_logout(gobj, event, kw, src)
{
    gobj.priv.held_logout = true;
    log_info(`${gobj_short_name(gobj)}: a logout asked for while the login is in flight waits for it`);
    return 0;
}

/***************************************************************
 *  A login asked for while the logout is in flight (the app shows the
 *  login form as soon as a session is refused) waits for the logout:
 *  a login that went out now would have its cookies cleared by the
 *  answer of the logout. The last one asked for is the one sent.
 ***************************************************************/
function ac_hold_login(gobj, event, kw, src)
{
    gobj.priv.held_login = {
        username: (kw && kw.username) || "",
        password: (kw && kw.password) || ""
    };
    log_info(`${gobj_short_name(gobj)}: a login asked for while the logout is in flight ` +
        `waits for it`);
    return 0;
}

/***************************************************************
 *  A login asked for with a session alive (the login form the app
 *  brings back while the first open of its link fails, ac_on_open_error()
 *  of C_APP) replaces that session: the logout goes first, so none is
 *  left open on the server, and the login waits for it.
 ***************************************************************/
function ac_replace_session(gobj, event, kw, src)
{
    ac_hold_login(gobj, event, kw, src);
    start_logout(gobj);
    return 0;
}

/***************************************************************
 *  A logout asked for again while one is in flight: that one ends the
 *  session, so nothing more is sent, and a login that was waiting for
 *  it is dropped (the user asked to leave after asking to enter).
 ***************************************************************/
function ac_logout_in_flight(gobj, event, kw, src)
{
    let priv = gobj.priv;
    log_info(`${gobj_short_name(gobj)}: a logout is already in flight` +
        (priv.held_login ? ", the login that waited for it is dropped" : ""));
    priv.held_login = null;
    return 0;
}

/***************************************************************
 *  The answers of the BFF change the state in their action, after
 *  is_superseded(): a transition in the FSM table runs before the
 *  action, so it would move the session for an answer to drop.
 ***************************************************************/
function ac_login_accepted(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    if(take_held_logout(gobj, event)) {
        return 0;
    }
    gobj_change_state(gobj, "ST_LOGIN");
    gobj_write_attr(gobj, "username", kw.username || "");
    save_session_info(gobj, kw);
    log_info(`${gobj_name(gobj)}: login accepted for '${gobj_read_attr(gobj, "username")}'`);
    gobj_publish_event(gobj, "EV_LOGIN_ACCEPTED", {username: gobj_read_attr(gobj, "username")});
    return 0;
}

function ac_login_refreshed(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    gobj.priv.refresh_in_flight = -1;
    save_session_info(gobj, kw);
    gobj_publish_event(gobj, "EV_LOGIN_REFRESHED", {username: gobj_read_attr(gobj, "username")});
    return 0;
}

function ac_login_denied(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    if(take_held_logout(gobj, event)) {
        return 0;
    }
    end_session(gobj, kw.error_code, kw.error);
    return 0;
}

/***************************************************************
 *  No session to restore on load (no/expired cookies, or the BFF did
 *  not answer): the app shows the login form. The fetch callback SENDS
 *  this instead of changing state and publishing by itself, so the
 *  transition is the FSM's and the machine trace shows it.
 ***************************************************************/
function ac_restore_failed(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    if(take_held_logout(gobj, event)) {
        return 0;
    }
    gobj_change_state(gobj, "ST_LOGOUT");
    gobj_publish_event(gobj, "EV_RESTORE_FAILED", {});
    return 0;
}

/***************************************************************
 *  The logout settled: ST_LOGOUT, EV_LOGOUT_DONE published {
 *  ended_on_server, error_code, error, login_follows} (do_bff_logout()),
 *  and then the login that waited for it, if any, goes out: login_follows
 *  says so, and the form that handed it in stays busy.
 ***************************************************************/
function ac_logout_done(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    const held_login = priv.held_login;
    priv.held_login = null;

    clear_timeout(priv.gobj_timer);
    gobj_write_attr(gobj, "username", "");
    gobj_change_state(gobj, "ST_LOGOUT");
    gobj_publish_event(gobj, "EV_LOGOUT_DONE", {
        ended_on_server: !!kw.ended_on_server,
        error_code:      kw.error_code || "",
        error:           kw.error || "",
        login_follows:   !!held_login
    });

    if(held_login) {
        gobj_send_event(gobj, "EV_DO_LOGIN", held_login, gobj);
    }
    return 0;
}

function ac_clear_session(gobj, event, kw, src)
{
    gobj_write_attr(gobj, "username", "");
    return 0;
}

function ac_timeout(gobj, event, kw, src)
{
    request_refresh(gobj, "the refresh timer");
    return 0;
}

/***************************************************************
 *  EV_DO_REFRESH — force a token refresh now (e.g. the app got a
 *  WebSocket NAK after sleep: the access token expired but the
 *  refresh token may still be valid).  Success -> EV_LOGIN_REFRESHED
 *  (fresh cookie); a denial -> EV_LOGIN_DENIED (-> ST_LOGOUT, so the
 *  login form works again); a failure that may pass ->
 *  EV_REFRESH_FAILED, retried (do_bff_refresh()). With a refresh in
 *  flight, that one is the answer (request_refresh()).
 ***************************************************************/
function ac_do_refresh(gobj, event, kw, src)
{
    request_refresh(gobj, "a refresh asked for");
    return 0;
}

/***************************************************************
 *  The refresh failed for a reason that may pass: no answer, a 5xx, a
 *  429 of the BFF, or an answer that is not the BFF's json. The session
 *  is not denied — the refresh cookie is untouched — so keep it, back
 *  off, and try again. Tearing the SPA down to the login form on a
 *  blink of the network destroyed the shell, closed the link and lost
 *  every open view, for a failure that heals itself. The retry waits
 *  for the Retry-After of the answer when it is longer than the
 *  backoff, up to REFRESH_RETRY_AFTER_MAX_MS.
 *
 *  Some never heal soon enough, and end the session with a code the
 *  login form shows translated: the REFRESH_BAD_ANSWERS_MAX-th answer
 *  that is not the BFF's json since the last refresh that landed
 *  ("auth_bad_response": the login page of a proxy), and the
 *  REFRESH_RATE_LIMITED_MAX-th 429, or one whose Retry-After is longer
 *  than REFRESH_RETRY_AFTER_MAX_MS ("auth_rate_limited").
 ***************************************************************/
function ac_refresh_failed(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    priv.refresh_in_flight = -1;

    const retry_after = kw.retry_after_ms || 0;

    if(kw.error_code === "auth_bad_response") {
        priv.bad_answers++;
        if(priv.bad_answers >= REFRESH_BAD_ANSWERS_MAX) {
            log_error(`${gobj_short_name(gobj)}: ${priv.bad_answers} answers to the refresh ` +
                `that are not the BFF's json: the session ends`);
            end_session(gobj, "auth_bad_response",
                `${priv.bad_answers} answers that are not the BFF's json (${kw.error || ""})`);
            return 0;
        }
    }

    if(kw.error_code === "auth_rate_limited") {
        priv.rate_limited++;
        if(priv.rate_limited >= REFRESH_RATE_LIMITED_MAX || retry_after > REFRESH_RETRY_AFTER_MAX_MS) {
            log_warning(`${gobj_short_name(gobj)}: refresh rate limited ${priv.rate_limited} times, ` +
                `Retry-After ${Math.round(retry_after / 1000)}s: the session ends`);
            end_session(gobj, "auth_rate_limited", kw.error || "");
            return 0;
        }
    }

    priv.retry_ms = priv.retry_ms
        ? Math.min(priv.retry_ms * 2, REFRESH_RETRY_MAX_MS)
        : REFRESH_RETRY_MIN_MS;
    const wait_ms = Math.max(priv.retry_ms, Math.min(retry_after, REFRESH_RETRY_AFTER_MAX_MS));
    set_timeout(priv.gobj_timer, wait_ms);

    gobj_publish_event(gobj, "EV_REFRESH_FAILED", {
        error_code: kw.error_code || "",
        error:      kw.error || "",
        retry_ms:   wait_ms
    });
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
     *---------------------------------------------*/
    /*
     *  The answers of the BFF (EV_LOGIN_ACCEPTED, EV_LOGIN_DENIED,
     *  EV_LOGIN_REFRESHED, EV_REFRESH_FAILED, EV_RESTORE_FAILED,
     *  EV_LOGOUT_DONE) are declared in EVERY state: an answer can land
     *  after a logout, a denial or a new login made its request
     *  superseded (the user logs out and in again while a refresh is in
     *  flight), and its action drops it then (is_superseded()) and
     *  changes the state itself otherwise.
     *
     *  ST_LOGGING_OUT is the logout in flight: no refresh leaves
     *  (EV_DO_REFRESH is not declared, a sender that asks for one then
     *  is told out loud), a login waits for the logout, and only the
     *  EV_LOGOUT_DONE of this logout ends it.
     *
     *  ST_WAIT_TOKEN is the login (or the restore on load) in flight: a
     *  logout waits for it, and goes out when it settles.
     *
     *  ST_LOGIN takes a login too: the app shows the login form with a
     *  session alive while the first open of its link fails, and a login
     *  handed in there replaces the session (ST_LOGGING_OUT first).
     */
    const states = [
        ["ST_LOGOUT", [
            ["EV_DO_LOGIN",        ac_do_login,        "ST_WAIT_TOKEN"],
            ["EV_DO_LOGOUT",       ac_clear_session,   null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null]
        ]],
        ["ST_WAIT_TOKEN", [
            ["EV_DO_LOGIN",        ac_do_login,        null],
            ["EV_DO_LOGOUT",       ac_hold_logout,     null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null]
        ]],
        ["ST_LOGIN", [
            ["EV_DO_LOGIN",        ac_replace_session, "ST_LOGGING_OUT"],
            ["EV_DO_LOGOUT",       ac_do_logout,       "ST_LOGGING_OUT"],
            ["EV_DO_REFRESH",      ac_do_refresh,      null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_TIMEOUT",         ac_timeout,         null]
        ]],
        ["ST_LOGGING_OUT", [
            ["EV_DO_LOGIN",        ac_hold_login,      null],
            ["EV_DO_LOGOUT",       ac_logout_in_flight, null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const out = event_flag_t.EVF_OUTPUT_EVENT | event_flag_t.EVF_NO_WARN_SUBS;
    const event_types = [
        ["EV_DO_LOGIN",        0],
        ["EV_DO_LOGOUT",       0],
        ["EV_DO_REFRESH",      0],
        ["EV_TIMEOUT",         0],
        ["EV_LOGIN_ACCEPTED",  out],
        ["EV_LOGIN_REFRESHED", out],
        ["EV_REFRESH_FAILED",  out],
        ["EV_LOGIN_DENIED",    out],
        ["EV_LOGOUT_DONE",     out],
        ["EV_RESTORE_FAILED",  out]
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
function register_c_agent_login()
{
    return create_gclass(GCLASS_NAME);
}

export {
    register_c_agent_login,
    agent_login_username,
    agent_login_is_logged_in,
};
