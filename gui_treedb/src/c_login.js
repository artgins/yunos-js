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
 *    {username, expires_in, refresh_expires_in}.
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
 *  ever retrying. Every call to the BFF has it: /auth/login, /auth/refresh,
 *  /auth/logout and /auth/token.  */
const BFF_TIMEOUT_MS = 15000;

/*  The error_code a denial of the login or of the session can carry, all
 *  keys of the locales: the whole catalog of the BFF (c_auth_bff.h) and
 *  the codes this module gives a failure the BFF did not answer with an
 *  error_code. The app shows t(error_code) when it is one of these, so
 *  the message changes with the language; the BFF's `error` text is a
 *  developer fallback, English only, and is shown only for a code that
 *  is not here.  */
export const AUTH_ERROR_I18N_KEYS = [
    "invalid_credentials", "session_expired", "account_disabled", "auth_rate_limited",
    "auth_service_unavailable", "auth_config_error", "auth_unexpected_error",
    "auth_empty_response", "auth_timeout", "token_too_large",
    "method_not_allowed", "missing_body", "missing_params", "redirect_uri_not_allowed",
    "origin_not_allowed", "missing_refresh_token", "missing_access_token",
    "unknown_endpoint", "server_busy", "internal_error",
    "network_error", "auth_bad_response"
];

/*  Backoff for a refresh that failed for a reason that may pass (the
 *  network went, the BFF answered 502 or 429). The session is NOT dead —
 *  the refresh token in the httpOnly cookie is still there — so retry
 *  instead of logging the user out, and back off so a BFF that is down is
 *  not hammered.  */
const REFRESH_RETRY_MIN_MS = 5000;
const REFRESH_RETRY_MAX_MS = 60000;

/*  A refresh the BFF answers with an error_code ends the session when its
 *  status is a 4xx (the BFF's "no") and is retried when it is a 5xx (an
 *  outage). These codes say the opposite of their status: a 429 passes
 *  with time, and these 5xx come back on every retry (a BFF misconfigured,
 *  an IdP answer the BFF cannot use, a token too large for a cookie, a bug
 *  of the BFF), so the session ends with their message.  */
const REFRESH_RETRIED_CODES = ["auth_rate_limited"];
const REFRESH_FINAL_CODES = [
    "auth_config_error", "auth_unexpected_error", "token_too_large", "internal_error"
];

/*  An answer that is not the BFF's json (the login page of a proxy, a 200
 *  {}) may never change: the fifth since the last refresh that landed
 *  ends the session with "auth_bad_response" and the login form says it,
 *  instead of retrying for ever with nothing shown. Answers of another
 *  kind in between (a 5xx, no answer) do not start the count over; only
 *  a refresh that lands does.  */
const REFRESH_BAD_ANSWERS_MAX = 5;

/*  A 429 passes with time, but not always soon: the fifth since the last
 *  refresh that landed ends the session with "auth_rate_limited", and so
 *  does one whose Retry-After is longer than REFRESH_RETRY_AFTER_MAX_MS.
 *  A retried failure waits for its Retry-After (seconds or an HTTP-date)
 *  when it is longer than the backoff, up to REFRESH_RETRY_AFTER_MAX_MS.  */
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
    bad_answers:        0,      /*  answers not the BFF's json since the last refresh that landed  */
    rate_limited:       0,      /*  429 answers since the last refresh that landed  */
    generation:         0,      /*  the session the requests in flight belong to  */
    refresh_in_flight:  -1,     /*  the generation of the refresh in flight, -1 when none  */
    held_login:         null,   /*  {username, password} asked for while the logout was in flight  */
    held_logout:        false,  /*  a logout asked for while the login was in flight  */
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
 *  POST to a BFF /auth/<segment> endpoint (with `body` as its JSON, when
 *  given), with a deadline, and always resolve to the same shape:
 *  {ok, status, data, timed_out, retry_after}: `status` 0 is no answer,
 *  `data` is {error} when the body is not json or did not come in time
 *  (bff_error_code() names each case), and `retry_after` is the
 *  Retry-After header as it came ("" when none, or none readable: a
 *  cross-origin answer shows it only when the server exposes it).
 *  `resp.json()` is guarded: a body that is not json (a proxy error
 *  page) is a failure of the call, never a rejection of the user.
 ***************************************************************/
function post_bff(gobj, segment, body)
{
    const bff_url = gobj_read_attr(gobj, "bff_url");
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
    return fetch(build_path(bff_url, "auth", segment), request)
    .then((resp) => resp.json()
        .then((data) => ({
            ok:          resp.ok,
            status:      resp.status,
            data:        data || {},
            timed_out:   false,
            retry_after: resp.headers.get("Retry-After") || ""
        }))
        .catch((err) => {
            const timed_out = !!(err && err.name === "AbortError");
            return {
                ok:          false,
                status:      resp.status,
                data:        {error: timed_out ?
                    "no answer from the BFF in time" :
                    `HTTP ${resp.status} with a body that is not the BFF's json (${err && err.message})`},
                timed_out:   timed_out,
                retry_after: resp.headers.get("Retry-After") || ""
            };
        }))
    .catch((err) => ({
        ok:          false,
        status:      0,
        data:        {error: err && err.message ? err.message : String(err)},
        timed_out:   !!(err && err.name === "AbortError"),
        retry_after: ""
    }))
    .finally(() => clearTimeout(timer));
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
 *  The error_code of a call the BFF did not answer with one: no answer
 *  in BFF_TIMEOUT_MS is "auth_timeout", no answer at all
 *  "network_error", a 5xx with no error_code (a gateway, or a BFF down
 *  behind one) "auth_service_unavailable", and any other answer with no
 *  error_code "auth_bad_response": an empty body, a body cut halfway, a
 *  page in HTML, a json that is not the BFF's, whatever its status. A
 *  429 is "auth_rate_limited" whatever its body, the BFF's own or that
 *  of a proxy that rate limits, even one that brings an error_code of
 *  its own, which would otherwise read as a denial and end the session:
 *  it is retried after its Retry-After and counted with the other 429s.
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
    log_info(sprintf("%s: %s of a superseded request dropped (request of session %s, now %d)",
        gobj_short_name(gobj), event, String(kw && kw.generation), generation));
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
    gobj_write_attr(gobj, "access_token", "");
    gobj_change_state(gobj, "ST_LOGOUT");
    gobj_publish_event(gobj, "EV_LOGIN_DENIED", {
        error_code: error_code || "",
        error:      error || ""
    });
}

/***************************************************************
 *  POST username/password to the BFF /auth/login endpoint.
 ***************************************************************/
function do_bff_login(gobj, username, password)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "login", {username, password}).then((answer) => {
        const {ok, status, data} = answer;
        if(ok && data.success) {
            gobj_send_event(gobj, "EV_LOGIN_ACCEPTED", {
                ...data,
                username:   data.username || data.email || "",
                generation: generation
            }, gobj);
            return;
        }
        const error_code = bff_error_code(answer);
        const error      = bff_error_text(answer);
        if(data.error_code === error_code) {
            /*  The BFF's own denial: it logged the cause itself.  */
            log_info(sprintf("%s: BFF login denied: %s (%s)",
                gobj_short_name(gobj), error_code, error));
        } else {
            log_error(sprintf("%s: BFF login failed: %s (%s)",
                gobj_short_name(gobj), error_code, error));
        }
        gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error, generation}, gobj);
    });
}

/***************************************************************
 *  Call the BFF /auth/logout endpoint. A logout the BFF never confirmed is
 *  still a logout HERE: the local session is dropped either way, and
 *  EV_LOGOUT_DONE says it was not one on the server (`ended_on_server`
 *  false, with the `error_code` of bff_error_code()). `cookies_cleared`
 *  says what is left: every answer of the BFF to a logout it served
 *  clears them, its 5xx too (see c_auth_bff.h), so the session may only
 *  be open at the identity server. A refusal of the BFF (403, 400), a
 *  page of a gateway or no answer leave them, and a reload of the page
 *  would restore the session.
 *  EV_LOGOUT_DONE comes when the call has settled -- answered, or aborted
 *  by its deadline, after which the browser takes no Set-Cookie of it --
 *  so the cookies it clears are cleared before any login made after it.
 *  Whatever the failure it is a WARNING, by the rule of a decoder: the
 *  peer did it, no contract of ours is broken.
 ***************************************************************/
function do_bff_logout(gobj)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "logout").then((answer) => {
        const {ok, status, data} = answer;
        const ended_on_server = !!(ok && data.success);
        const cookies_cleared = ended_on_server || (status >= 500 && !!data.error_code);
        const error_code = ended_on_server ? "" : bff_error_code(answer);
        if(!ended_on_server) {
            /*  What the peer did, not a broken contract of ours: a WARNING.  */
            log_warning(sprintf("%s: BFF logout failed: %s (%s) — dropping the local session anyway",
                gobj_short_name(gobj), error_code, bff_error_text(answer)));
        }
        gobj_send_event(gobj, "EV_LOGOUT_DONE", {
            generation, ended_on_server, cookies_cleared, error_code, error: data.error || ""
        }, gobj);
    });
}

/***************************************************************
 *  Call the BFF /auth/refresh endpoint.
 *
 *  A refresh the BFF answers with an error_code that a retry would give
 *  again ends the session: EV_LOGIN_DENIED (refresh_code_ends_session()).
 *  Anything else keeps it: EV_REFRESH_FAILED retries with backoff and
 *  leaves the shell, the links and the open cards exactly as they are,
 *  and ac_refresh_failed() ends the session after REFRESH_BAD_ANSWERS_MAX
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
            log_info(sprintf("%s: BFF refresh denied: %s (%s)",
                gobj_short_name(gobj), error_code, error));
            gobj_send_event(gobj, "EV_LOGIN_DENIED", {error_code, error, generation}, gobj);
            return;
        }
        const wait_ms = retry_after_ms(answer.retry_after, Date.now());
        const msg = sprintf("%s: BFF refresh failed: %s (%s)%s",
            gobj_short_name(gobj), error_code, error,
            answer.retry_after ? `, Retry-After: ${answer.retry_after}` +
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
 *  Try to restore the session from httpOnly cookies on page load.
 *  Anything short of a success shows the login form — on a cold load there
 *  is no session to protect, so a transient failure is not worth a retry
 *  loop the user cannot see.
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
 *  Fetch the access_token from the BFF (POST /auth/token) so the SPA
 *  can forward it in each C_IEVENT_CLI identity_card, then publish the
 *  output event with the token. If the endpoint is disabled (flag off
 *  → 404) or fails, publish with an empty token and warn: same-origin
 *  cookie auth still works; cross-origin backends will NAK until the
 *  BFF opts in.
 ***************************************************************/
function fetch_and_publish(gobj, out_event)
{
    const generation = gobj.priv.generation;
    post_bff(gobj, "token").then(({ok, status, data, timed_out}) => {
        let token = (ok && data.success && data.access_token) ? data.access_token : "";
        if(!token) {
            if(status === 0 || timed_out) {
                log_warning(sprintf("%s: /auth/token fetch failed: %s",
                    gobj_short_name(gobj), timed_out ? "no answer in time" : (data.error || "?")));
            } else {
                log_warning(sprintf("%s: /auth/token returned no access_token "
                    + "(is expose_access_token enabled on the BFF?)", gobj_short_name(gobj)));
            }
        }
        gobj_send_event(gobj, "EV_TOKEN_FETCHED",
            {out_event: out_event, access_token: token, generation: generation}, gobj);
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
 *  access_token): how long the refresh timer waits, so it runs before
 *  the access_token expires. Who calls this arms it: a refresh at once,
 *  a login when its token has come (ac_token_fetched()), because until
 *  then the session is not published, the app is not in session, and a
 *  refresh out in between would answer to nobody.
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
    priv.bad_answers = 0;
    priv.rate_limited = 0;
    priv.refresh_at = 0;
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
    log_info(sprintf("%s: %s with a logout asked for: logging out", gobj_short_name(gobj), event));
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
        log_info(sprintf("%s: %s while a refresh is in flight: that one answers it",
            gobj_short_name(gobj), why));
        return;
    }
    priv.refresh_in_flight = priv.generation;
    clear_timeout(priv.gobj_timer);
    do_bff_refresh(gobj);
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




/***************************************************************
 *  A new login: every request of the session before it is superseded,
 *  and a logout that waited for the login before it is dropped.
 ***************************************************************/
function ac_do_login(gobj, event, kw, src)
{
    if(gobj.priv.held_logout) {
        gobj.priv.held_logout = false;
        log_info(sprintf("%s: a login asked for: the logout that waited for the login is dropped",
            gobj_short_name(gobj)));
    }
    gobj.priv.generation++;
    const username = (kw && kw.username) ? kw.username : "";
    const password = (kw && kw.password) ? kw.password : "";
    do_bff_login(gobj, username, password);
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
    log_info(sprintf("%s: a logout asked for while the login is in flight waits for it", gobj_short_name(gobj)));
    return 0;
}

/***************************************************************
 *  A login asked for while the logout is in flight waits for the
 *  logout: a login that went out now would have its cookies cleared by
 *  the answer of the logout. The last one asked for is the one sent.
 ***************************************************************/
function ac_hold_login(gobj, event, kw, src)
{
    gobj.priv.held_login = {
        username: (kw && kw.username) || "",
        password: (kw && kw.password) || ""
    };
    log_info(sprintf("%s: a login asked for while the logout is in flight waits for it",
        gobj_short_name(gobj)));
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
    log_info(sprintf("%s: a logout is already in flight%s", gobj_short_name(gobj),
        priv.held_login ? ", the login that waited for it is dropped" : ""));
    priv.held_login = null;
    return 0;
}

function ac_do_refresh(gobj, event, kw, src)
{
    request_refresh(gobj, "a refresh asked for");
    return 0;
}

/***************************************************************
 *  EV_LOGIN_ACCEPTED — BFF login/restore succeeded. Fetch the
 *  access_token, then publish EV_LOGIN_ACCEPTED with it.
 *
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
    fetch_and_publish(gobj, "EV_LOGIN_ACCEPTED");
    return 0;
}

/***************************************************************
 *  EV_LOGIN_REFRESHED — BFF refresh succeeded. Re-fetch the (rotated)
 *  access_token and publish it so the app pushes it onto live links.
 ***************************************************************/
function ac_login_refreshed(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    gobj.priv.refresh_in_flight = -1;
    save_session_info(gobj, kw);
    arm_refresh(gobj, gobj.priv.timeout_refresh * 1000);
    fetch_and_publish(gobj, "EV_LOGIN_REFRESHED");
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
 *  The logout settled: ST_LOGOUT, EV_LOGOUT_DONE published {
 *  ended_on_server, cookies_cleared, error_code, error, login_follows}
 *  (do_bff_logout()),
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
    gobj_write_attr(gobj, "access_token", "");
    gobj_change_state(gobj, "ST_LOGOUT");
    gobj_publish_event(gobj, "EV_LOGOUT_DONE", {
        ended_on_server: !!kw.ended_on_server,
        cookies_cleared: !!kw.cookies_cleared,
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
 *  The access_token came back from the BFF (/auth/token): publish the
 *  output event the flow asked for (EV_LOGIN_ACCEPTED on a fresh login /
 *  restore, EV_LOGIN_REFRESHED on a rotation) with the token, so the app
 *  can forward it in every C_IEVENT_CLI identity_card.
 *
 *  The username is for the avatar initials. /auth/login and /auth/refresh
 *  return it, read from the access_token's claims; when the BFF could not
 *  read them it answers it empty, so it falls back to the claims of the
 *  token here (the authoritative identity; gui_agent gets its name from
 *  the control-center's EV_ON_OPEN instead, which gui_treedb has no single
 *  equivalent of).
 ***************************************************************/
function ac_token_fetched(gobj, event, kw, src)
{
    if(is_superseded(gobj, event, kw)) {
        return 0;
    }
    let out_event = (kw && kw.out_event) || "";
    if(out_event !== "EV_LOGIN_ACCEPTED" && out_event !== "EV_LOGIN_REFRESHED") {
        log_error(sprintf("%s: EV_TOKEN_FETCHED with a bad out_event: %s",
            gobj_short_name(gobj), out_event));
        return -1;
    }
    if(out_event === "EV_LOGIN_ACCEPTED") {
        arm_refresh(gobj, gobj.priv.timeout_refresh * 1000);
    }
    const token = (kw && kw.access_token) || "";
    gobj_write_attr(gobj, "access_token", token);
    let username = gobj_read_attr(gobj, "username");
    if(!username && token) {
        username = username_from_jwt(token);
        if(username) {
            gobj_write_attr(gobj, "username", username);
        }
    }
    gobj_publish_event(gobj, out_event, {
        username:     username || "",
        access_token: token
    });
    return 0;
}

function ac_timeout(gobj, event, kw, src)
{
    request_refresh(gobj, "the refresh timer");
    return 0;
}

/***************************************************************
 *  The refresh failed for a reason that may pass: network down, a 5xx,
 *  a 429 of the BFF, a request timed out, an answer that is not the
 *  BFF's json. The session is not denied — the refresh cookie is
 *  untouched — so keep it, back off, and try again. Tearing the SPA down
 *  to the login form on a blink of the network destroyed the shell,
 *  closed every link and lost every open card, for a failure that heals
 *  itself. The retry waits for the Retry-After of the answer when it is
 *  longer than the backoff, up to REFRESH_RETRY_AFTER_MAX_MS.
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
            log_error(sprintf("%s: %d answers to the refresh that are not the BFF's json: "
                + "the session ends", gobj_short_name(gobj), priv.bad_answers));
            end_session(gobj, "auth_bad_response",
                `${priv.bad_answers} answers that are not the BFF's json (${kw.error || ""})`);
            return 0;
        }
    }

    if(kw.error_code === "auth_rate_limited") {
        priv.rate_limited++;
        if(priv.rate_limited >= REFRESH_RATE_LIMITED_MAX || retry_after > REFRESH_RETRY_AFTER_MAX_MS) {
            log_warning(sprintf("%s: refresh rate limited %d times, Retry-After %ds: the session ends",
                gobj_short_name(gobj), priv.rate_limited, Math.round(retry_after / 1000)));
            end_session(gobj, "auth_rate_limited", kw.error || "");
            return 0;
        }
    }

    priv.retry_ms = priv.retry_ms
        ? Math.min(priv.retry_ms * 2, REFRESH_RETRY_MAX_MS)
        : REFRESH_RETRY_MIN_MS;
    const wait_ms = Math.max(priv.retry_ms, Math.min(retry_after, REFRESH_RETRY_AFTER_MAX_MS));
    arm_refresh(gobj, wait_ms);

    gobj_publish_event(gobj, "EV_REFRESH_FAILED", {
        error_code: kw.error_code || "",
        error:      kw.error || "",
        retry_ms:   wait_ms
    });
    return 0;
}

/***************************************************************
 *  The tab came back to the foreground, or the network came back. A
 *  background tab's timers are throttled, so the refresh may be overdue by
 *  minutes: if its deadline has passed, refresh NOW instead of waiting for
 *  a timer the browser is holding back -- unless the refresh is already
 *  in flight (the timer fired, late, before the wake-up): that one is the
 *  refresh (request_refresh()).
 ***************************************************************/
function ac_wakeup(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(gobj_current_state(gobj) !== "ST_LOGIN") {
        return 0;       /*  no session to keep alive  */
    }
    if(!priv.refresh_at || Date.now() < priv.refresh_at) {
        return 0;       /*  no timer yet, or it is still ahead of us: let it fire  */
    }
    log_info(sprintf("%s: back from sleep with the refresh overdue", gobj_short_name(gobj)));
    request_refresh(gobj, "a wake-up");
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
     *
     *  So are the answers of the BFF (EV_LOGIN_ACCEPTED, EV_LOGIN_DENIED,
     *  EV_LOGIN_REFRESHED, EV_REFRESH_FAILED, EV_RESTORE_FAILED,
     *  EV_TOKEN_FETCHED, EV_LOGOUT_DONE): an answer can land after a logout,
     *  a denial or a new login made its request superseded (the user logs
     *  out and in again while a refresh is in flight), and its action drops
     *  it then (is_superseded()) and changes the state itself otherwise.
     *
     *  ST_LOGGING_OUT is the logout in flight: no refresh leaves
     *  (EV_DO_REFRESH is not declared, a sender that asks for one then is
     *  told out loud), a login waits for the logout, and only the
     *  EV_LOGOUT_DONE of this logout ends it.
     *
     *  ST_WAIT_TOKEN is the login (or the restore on load) in flight: a
     *  logout waits for it, and goes out when it settles.
     */
    const states = [
        ["ST_LOGOUT", [
            ["EV_DO_LOGIN",        ac_do_login,        "ST_WAIT_TOKEN"],
            ["EV_WAKEUP",          ac_wakeup,          null],
            ["EV_DO_LOGOUT",       ac_clear_session,   null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null],
            ["EV_TOKEN_FETCHED",   ac_token_fetched,   null]
        ]],

        ["ST_WAIT_TOKEN", [
            ["EV_DO_LOGIN",        ac_do_login,        null],
            ["EV_DO_LOGOUT",       ac_hold_logout,     null],
            ["EV_WAKEUP",          ac_wakeup,          null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null],
            ["EV_TOKEN_FETCHED",   ac_token_fetched,   null]
        ]],

        ["ST_LOGIN", [
            ["EV_DO_LOGOUT",       ac_do_logout,       "ST_LOGGING_OUT"],
            ["EV_DO_REFRESH",      ac_do_refresh,      null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_TIMEOUT",         ac_timeout,         null],
            ["EV_WAKEUP",          ac_wakeup,          null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null],
            ["EV_TOKEN_FETCHED",   ac_token_fetched,   null]
        ]],

        ["ST_LOGGING_OUT", [
            ["EV_DO_LOGIN",        ac_hold_login,      null],
            ["EV_DO_LOGOUT",       ac_logout_in_flight, null],
            ["EV_LOGOUT_DONE",     ac_logout_done,     null],
            ["EV_WAKEUP",          ac_wakeup,          null],
            ["EV_LOGIN_ACCEPTED",  ac_login_accepted,  null],
            ["EV_LOGIN_DENIED",    ac_login_denied,    null],
            ["EV_LOGIN_REFRESHED", ac_login_refreshed, null],
            ["EV_REFRESH_FAILED",  ac_refresh_failed,  null],
            ["EV_RESTORE_FAILED",  ac_restore_failed,  null],
            ["EV_TOKEN_FETCHED",   ac_token_fetched,   null]
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
