/***********************************************************************
 *          c_tranger_view.js
 *
 *      C_TRANGER_VIEW — read-only control panel over a remote C_TRANGER
 *      service: its topics and, per topic, a dashboard of record views.
 *
 *      Hosted by C_TREEDB_VIEW exactly like the treedb editors (same
 *      contract: `gobj_remote_yuno` is the live transport and
 *      `treedb_name` is the remote service name). Model:
 *
 *        - mt_start → `topics expanded=1` command → one Bulma tab per topic
 *          (expanded because a topic's `system_flag` is what tells whether
 *          its t/tm are seconds or milliseconds);
 *        - selecting a topic → `list-keys` (keys + record counts + the time
 *          span of each key, kept for the picker and for the Rows options)
 *          and an empty card dashboard;
 *        - the toolbar "Keys" button opens a Tabulator of the topic's keys
 *          (sortable by record count, header-filter), presented responsively:
 *          a moveable C_YUI_WINDOW on desktop, the shell's adaptive modal
 *          sheet on mobile. It persists while views are opened/closed; each
 *          row's "Rows"/"Live" button is colored ONLY while that view is
 *          open for the key and toggles it. A key's "Rows" opens an options
 *          form (server-side match conditions) and then a Rows card; "Live"
 *          opens a Live card directly. The options form offers BOTH time
 *          axes of a tranger record — `t` (persistence: when it was stored)
 *          and `tm` (message origin: when it happened) — as two independent
 *          ranges the iterator ANDs, each bounded to the key's real extent
 *          (list-keys reports it) and fillable from quick presets. Plus
 *          rowid range and user_flag masks;
 *        - a "Rows" card is a records Tabulator using its NATIVE remote
 *          pagination: `open-iterator` builds the key's server-side row
 *          index (pre-filtered by the chosen match conditions) and
 *          Tabulator's `ajaxRequestFunc` pulls each page via `get-page`
 *          (bridged to the async gobj_command answer with a per-request
 *          Promise). The iterator is closed (`close-iterator`) when the
 *          card, topic or view goes away;
 *        - a "Live" card streams new appends (`open-rt` +
 *          EV_TRANGER_RECORD_ADDED), newest on top, no history;
 *        - per-column header filters (client-side, over the LOADED page)
 *          replace a global search box: type `>200`, `<=5`, `=ok` or a
 *          plain substring. No polling (Yuneta rule);
 *        - a row click opens the full record JSON in the shell dialog.
 *
 *      Publishes EV_TOPIC_SELECTED (CHILD model → C_TREEDB_VIEW) so the
 *      selected topic deep-links into the URL, and honours EV_SHOW to
 *      restore it.
 *
 *      FSM — every action crosses the automaton (JS GUI rule: the browser is
 *      just another OS, so a click / an on_close / a dialog confirm is an OS
 *      notification, and a DOM handler's only job is to turn it into an
 *      event). The `machine` trace is therefore the execution log of this
 *      view; nothing happens outside it.
 *
 *        ST_DISCONNECTED   — no session yet: the topics are unknown. The only
 *                            way forward is EV_ON_OPEN (the link came up),
 *                            which asks for them.
 *        ST_LOADING_TOPICS — `topics` asked, waiting. A service with NO topics
 *                            rests here (error banner): there is nothing to
 *                            browse, so opening cards/keys is impossible BY
 *                            CONSTRUCTION, not by an `if` that silently
 *                            no-ops the button.
 *        ST_TOPIC_SELECTED — a topic is selected: keys, cards and options live
 *                            here. An EV_OPEN_CARD arriving in any other state
 *                            fails LOUDLY and names its sender.
 *
 *      Cards are NOT child gobjs (they stay inside this gclass); what crosses
 *      the FSM is what HAPPENS to them: EV_OPEN_CARD / EV_CLOSE_CARD /
 *      EV_REFRESH_CARD / EV_CLEAR_CARD / EV_APPLY_MATCH_COND, plus the re-arm
 *      driven by EV_ON_OPEN. Widget plumbing that is not an action stays a
 *      plain call: Tabulator's `ajaxRequestFunc` (it must RETURN a Promise —
 *      it is a data source, not an event) and the `tableBuilt` redraw.
 *
 *          Copyright (c) 2024-2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t, kw_flag_t,
    gclass_create, log_error, log_warning,
    gobj_read_attr, gobj_write_attr,
    gobj_read_pointer_attr, gobj_read_str_attr,
    gobj_parent, gobj_short_name,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_publish_event,
    gobj_send_event,
    gobj_change_state,
    gobj_command,
    gobj_current_state, gobj_is_destroying,
    gobj_create_service, gobj_find_service, gobj_destroy, is_gobj,
    createElement2, refresh_language,
    msg_iev_get_stack,
    kw_get_str, kw_get_dict,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {yui_shell_show_modal, yui_shell_popup_layer} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {
    treedb_config_get_tranger_views,
    treedb_config_get_live_max,
    LIVE_MAX_DEFAULT,
} from "./c_treedb_config.js";
import {treedb_links_get_iev} from "./c_treedb_links.js";

import {
    SF_T_MS,
    SF_TM_MS,
    to_epoch,
    epoch_to_local_input,
    flatten_record,
    op_filter,
    encode_seg,
    decode_seg,
} from "./tranger_helpers.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TRANGER_VIEW";

/*  Records per page in a Rows card (Tabulator's paginationSize).  */
const PAGE_SIZE = 100;

/*  A card's key when it follows the WHOLE topic instead of one key: what
 *  `open-rt` takes as "every key" (an empty key), and what identifies the
 *  card in find_card / the persisted view set. A topic has no key named ""
 *  — tranger keys are non-empty — so it can never collide with a real one.  */
const ALL_KEYS = "";

/*  How long a get-page answer may take before its Promise is failed. The
 *  link being UP does not guarantee an answer (a reaped iterator, a dropped
 *  answer): without a deadline the request would sit in priv.pending for the
 *  life of the tab and its table would spin forever.  */
const PAGE_TIMEOUT_MS = 20000;

/*  How long a Copy/Share button says "Copied" before going back to its own
 *  label — feedback, not a mode.  */
const COPY_FEEDBACK_MS = 1500;

/*  Rows kept in a Live card's rolling buffer (newest on top): the user's
 *  setting (C_TREEDB_CONFIG `live_max`, Settings), read when the card is
 *  created and frozen in the card — changing the setting must not resize a
 *  buffer that is already filling.  */

/*  Columns a card shows on a phone; the rest are hidden (the full record
 *  is one row-click away, as JSON). The first three are the metadata ones
 *  (t, tm, rowid), so this leaves one record field visible.  */
const MOBILE_COLS = 4;

/*  A tranger record carries TWO timestamps (t = persistence, tm = message
 *  origin) and they are two independent axes: the iterator's match_cond takes
 *  both ranges and ANDs them, so the Rows-options modal offers both. Their
 *  unit (seconds, or milliseconds when the topic's system_flag says so) is
 *  what SF_T_MS / SF_TM_MS decide — see tranger_helpers.js.  */

/*  Quick ranges offered by the modal, as a span BACK FROM NOW (seconds).
 *  "today" is special-cased (it starts at local midnight, not N seconds
 *  ago) and so is "span" (the key's own extent).  */
const TIME_PRESETS = [
    {id: "1h",    label: "last hour",   secs: 3600},
    {id: "24h",   label: "last 24h",    secs: 24 * 3600},
    {id: "7d",    label: "last 7 days", secs: 7 * 24 * 3600},
    {id: "today", label: "today",       secs: 0},
    {id: "span",  label: "full span",   secs: 0}
];

/*  Table height inside a card (its own pager sits below): follows the
 *  viewport, capped — a short screen must not be eaten by one card.  */
const CARD_TABLE_HEIGHT = "min(60vh, 560px)";

/*  Injected once (inline styles cannot carry these); scoped by the
 *  gclass class. Card chrome + the scrollable dashboard column.  */
const STYLE_ID = "C_TRANGER_VIEW_style";
const STYLE_CSS = `
.C_TRANGER_VIEW .TRANGER_DASHBOARD {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
}
/*  The card IS a Bulma .box: spacing is the mb-6 helper on the element (3rem,
    the top of Bulma's scale — a stack of tables needs a wide gutter to read as
    separate objects). Bulma has no shadow helper, so the depth comes from its
    OWN customization knob: the .box CSS variable, overridden here to a much
    darker drop shadow + a hairline ring (the ring is what keeps the card
    legible in dark mode, where a shadow on a dark background barely shows).  */
.C_TRANGER_VIEW .TRANGER_CARD {
    --bulma-box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.22),
        0 0 0.6rem 0.1rem rgba(0, 0, 0, 0.42),
        0 0 1.2rem 0.2rem rgba(0, 0, 0, 0.25);
    /*  Bulma's .box radius knob (its radius-large = 0.75rem reads rectangular
        at this card size). Same reason as the shadow above: no helper exists,
        so use the component's own variable, never a raw border-radius.  */
    --bulma-box-radius: 0.9rem;
}
/*  The head band is the card's top edge and the table is its bottom edge:
    both have their own background and square corners, so they must be
    rounded WITH the box or they poke out of it and flatten the curve. The
    table sits inside the p-2 gutter, hence the slightly tighter radius.  */
.C_TRANGER_VIEW .TRANGER_CARD_HEAD {
    background: var(--bulma-scheme-main-bis, #fafafa);
    border-bottom: 1px solid var(--bulma-border, #dbdbdb);
    border-top-left-radius: var(--bulma-box-radius);
    border-top-right-radius: var(--bulma-box-radius);
}
.C_TRANGER_VIEW .TRANGER_CARD_TABLE .tabulator {
    border-bottom-left-radius: calc(var(--bulma-box-radius) - 0.25rem);
    border-bottom-right-radius: calc(var(--bulma-box-radius) - 0.25rem);
    overflow: hidden;
}
.C_TRANGER_VIEW .TRANGER_CARD_TITLE {
    flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; font-weight: 600;
}
.TRANGER_LIVE_DOT {
    display: inline-block; width: 0.55em; height: 0.55em;
    border-radius: 50%; background: #48c774; vertical-align: middle;
}
/*  In the Keys picker the Live dot follows the button state: neutral
 *  (colorless) while the Live view is CLOSED, and only green/visible once
 *  it is OPEN (button turns is-success). The card-header dot keeps the
 *  base green — that card is always an active live view.  */
.TRANGER_KEY_LIVE .TRANGER_LIVE_DOT {
    background: currentColor; opacity: 0.4;
}
.TRANGER_KEY_LIVE.is-success .TRANGER_LIVE_DOT {
    background: #fff; opacity: 1;
}
/*  Tabulator's footer is one nowrap flex row: counter + paginator (flex:1,
    basis 0). On a narrow (mobile) width the paginator just shrinks and its
    page-size + First/Prev/Next/Last clip off the right — flex-wrap can't
    save it (basis 0 never wraps to a new line). So on mobile STACK the
    footer vertically: counter on one line, the full pager (left-aligned,
    wrapping) below.

    Scoped to the tranger tables through their CONTAINERS: the Keys picker
    hangs off TRANGER_KEYS_PICKER (the wrapper), never off TRANGER_KEYS_TABLE
    — Tabulator turns the div you hand it INTO the .tabulator element (it just
    adds the class), so a ".TRANGER_KEYS_TABLE .tabulator" descendant selector
    asks for an element inside itself and matches nothing.
    NOTE: this is a template literal — no backticks in these comments.  */
.C_TRANGER_VIEW .tabulator .tabulator-footer,
.TRANGER_KEYS_PICKER .tabulator .tabulator-footer {
    white-space: normal;
}
@media (max-width: 768px) {
    .C_TRANGER_VIEW .tabulator .tabulator-footer .tabulator-footer-contents,
    .TRANGER_KEYS_PICKER .tabulator .tabulator-footer .tabulator-footer-contents {
        flex-direction: column; align-items: flex-start; gap: 0.3rem;
    }
    .C_TRANGER_VIEW .tabulator .tabulator-footer .tabulator-paginator,
    .TRANGER_KEYS_PICKER .tabulator .tabulator-footer .tabulator-paginator {
        flex: none; width: 100%; text-align: left;
    }
    .C_TRANGER_VIEW .tabulator .tabulator-footer .tabulator-page-counter,
    .TRANGER_KEYS_PICKER .tabulator .tabulator-footer .tabulator-page-counter {
        margin-left: 0;
    }
}
`;

function inject_style()
{
    if(typeof document === "undefined" || document.getElementById(STYLE_ID)) {
        return;
    }
    let style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
}

/***************************************************************
 *  Tabulator's built-in `paginationCounter: "rows"` is hardcoded
 *  English ("Showing 1-100 of 399600 rows"). Same line, but through
 *  our i18n. Used by every paginated tranger table (Rows cards and
 *  the Keys picker), so the two footers read alike.
 ***************************************************************/
function rows_counter()
{
    return function(pageSize, currentRow, currentPage, totalRows) {
        let from = totalRows ? currentRow : 0;
        let to = Math.min(currentRow + pageSize - 1, totalRows);
        return t("showing rows", {from: from, to: to, total: totalRows});
    };
}


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",       0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_POINTER,  "gobj_remote_yuno", 0,  null,  "Live transport (C_IEVENT_CLI)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name",      0,  "",    "Remote C_TRANGER service name"),
SDATA(data_type_t.DTP_STRING,   "conn_id",          0,  "",    "Connection id (scopes persisted open key-views)"),
SDATA(data_type_t.DTP_BOOLEAN,  "system",           0,  false, "Unused (hosting contract symmetry)"),
SDATA(data_type_t.DTP_POINTER,  "$container",       0,  null,  "Root HTML element (mounted by the shell)"),
SDATA_END()
];

let PRIVATE_DATA = {
    topics:      null,   /*  topic names from the `topics` answer  */
    topic_flags: null,   /*  topic_name -> system_flag: says whether t/tm are
                             seconds or milliseconds (SF_T_MS / SF_TM_MS). An
                             old backend answers `topics` with plain names and
                             leaves this empty — seconds, as it always was  */
    cur_topic:   "",     /*  selected topic  */
    pending_seg: "",     /*  topic asked via EV_SHOW before topics loaded  */
    pending_card: null,  /*  card carried by a shared link, until its keys land  */
    keys:        null,   /*  the picker's CURRENT PAGE: [{key, records, fr_t,
                             to_t, fr_tm, to_tm}]. NOT every key of the topic —
                             the backend filters/sorts/pages them  */
    key_spans:   null,   /*  key -> {fr_t, to_t, fr_tm, to_tm} of the CURRENT
                             topic, remembered from EVERY list-keys answer (a
                             page, the count, the saved-view check). The picker's
                             page cannot be the source: a card restored from a
                             link or from the saved set opens without the picker
                             ever being built, and a key of another page is not
                             in it either — the Rows options then lost their
                             bounds and the "full span" preset  */
    keys_total:  0,      /*  how many keys the topic has (list-keys total_rows)  */
    wanted_views: null,  /*  views waiting for their keys to be confirmed  */
    cards:       null,   /*  [{key, mode, iterator_id, tabulator, $el}]  */
    tok:         "",     /*  per-view token: keeps iterator_ids unique across
                             reloads so they never collide with iterators a
                             previous session leaked on the backend  */
    iter_seq:    0,      /*  iterator_id uniquifier  */
    req_seq:     0,      /*  get-page request uniquifier  */
    pending:     null,   /*  req_id -> {resolve, reject} (get-page Promise bridge)  */
    picker_win:  null,   /*  C_YUI_WINDOW hosting the Keys picker, desktop (or null)  */
    picker_modal: null,  /*  shell modal hosting the Keys picker, mobile (or null)  */
    picker_tbl:  null,   /*  the picker's Tabulator (or null)  */
    $tabs:       null,
    $meta:       null,
    $error:      null,
    $dashboard:  null,   /*  cards column  */
    $copy_btn:   null,   /*  button awaiting clipboard feedback (or null)  */
    copy_label:  "",     /*  its label, to restore after the feedback  */
    $empty:      null,   /*  empty-dashboard hint  */
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
    priv.topics = null;
    priv.topic_flags = {};
    priv.cur_topic = "";
    priv.pending_seg = "";
    priv.pending_card = null;
    priv.keys = null;
    priv.key_spans = {};
    priv.keys_total = 0;
    priv.wanted_views = null;
    priv.cards = [];
    priv.tok = Math.random().toString(36).slice(2, 10);
    priv.iter_seq = 0;
    priv.req_seq = 0;
    priv.pending = {};
    priv.picker_win = null;
    priv.picker_modal = null;
    priv.picker_tbl = null;

    build_ui(gobj);

    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    /*  The server-side state of a card (its iterator, its realtime feed) is
     *  owned by the SESSION that opened it, and the backend reaps both when
     *  that session dies: a dropped websocket leaves every open card holding
     *  a dead iterator_id / rt_id. C_IEVENT_CLI resends the event
     *  SUBSCRIPTIONS on reopen, but nothing re-opens what a COMMAND created,
     *  so watch the link and re-arm.
     *
     *  Watch it on the LOCAL treedb_links service (as the host C_TREEDB_VIEW
     *  does), NEVER by subscribing on the C_IEVENT_CLI itself: every explicit
     *  subscription there is FORWARDED to the remote service as
     *  `__subscribing__` (c_ievent_cli's send_remote_subscription), and
     *  asking a C_TRANGER for an event it does not publish breaks the
     *  session — topics/list-keys stop arriving and the view goes blank.  */
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
    }

    /*  Mounted with no session (link still down): stay in ST_DISCONNECTED and
     *  let EV_ON_OPEN ask for the topics. Before the FSM this path just logged
     *  "no session" and NOTHING ever retried — the view stayed empty for the
     *  rest of its life.  */
    if(!live_transport(gobj)) {
        return;
    }
    gobj_change_state(gobj, "ST_LOADING_TOPICS");
    request_topics(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_unsubscribe_event(links, "EV_ON_OPEN", {}, gobj);
    }
    reject_pending(gobj, "view stopped");
    close_all_cards(gobj);
    close_picker(gobj);

    /*  A stopped view knows NOTHING: leaving the topic list, the keys and the
     *  selected topic behind meant a stop→start cycle re-entered with the
     *  previous session's topics still in priv and the FSM still in
     *  ST_TOPIC_SELECTED — cards openable against a service that had not
     *  answered `topics` yet.  */
    let priv = gobj.priv;
    priv.topics = null;
    priv.topic_flags = {};
    priv.keys = null;
    priv.key_spans = {};
    priv.keys_total = 0;
    priv.wanted_views = null;
    priv.cur_topic = "";
    priv.pending_seg = "";
    priv.pending_card = null;
    gobj_change_state(gobj, "ST_DISCONNECTED");
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
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
 *  Build the container: topic tabs + toolbar (Keys button + meta) +
 *  the scrollable card dashboard.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    inject_style();

    let $tabs = createElement2(
        ["ul", {class: "TRANGER_TOPIC_TABS"}, []]);
    priv.$tabs = $tabs;

    let $keys_btn = createElement2(
        ["button", {class: "button TRANGER_KEYS_BTN",
                    title: t("keys"), "aria-label": t("keys")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-table"}]]],
                ["span", {i18n: "keys"}, t("keys")]
            ]
        ]);
    $keys_btn.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_OPEN_KEYS", {}, gobj);
    });

    /*  Live on the WHOLE topic: `open-rt` takes an empty key as "every key of
     *  the topic". Following a busy topic used to mean opening one Live card
     *  per key — and you cannot even do that for a topic whose keys are
     *  created as the data arrives.  */
    let $live_btn = createElement2(
        ["button", {class: "button ml-2 TRANGER_LIVE_TOPIC_BTN",
                    title: t("live on the whole topic"),
                    "aria-label": t("live on the whole topic")},
            [
                ["span", {class: "TRANGER_LIVE_DOT mr-2"}, ""],
                ["span", {class: "is-hidden-mobile", i18n: "live topic"},
                    t("live topic")]
            ]
        ]);
    $live_btn.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_OPEN_CARD", {key: ALL_KEYS, mode: "live"}, gobj);
    });

    let $meta = createElement2(
        ["span", {class: "is-size-7 has-text-grey ml-3 TRANGER_META"}, ""]);
    priv.$meta = $meta;

    let $error = createElement2(
        ["div", {class: "notification is-danger is-light is-hidden TRANGER_ERROR"}, ""]);
    priv.$error = $error;

    let $empty = createElement2(
        ["div", {class: "has-text-grey p-4 TRANGER_EMPTY", i18n: "open a key view"},
            t("open a key view")]);
    priv.$empty = $empty;

    /*  Padding = the room the card shadows need: the scrolling column clips
     *  horizontally (overflow-y:auto forces overflow-x to auto), so a
     *  full-width card would get its lateral shadow cut at the edge. pt-3 so
     *  the FIRST card is not flush against the toolbar; asymmetric sides
     *  (pl-2 / pr-5) leave the wider gutter on the right, where the scrollbar
     *  and the thumb live.  */
    let $dashboard = createElement2(
        ["div", {class: "TRANGER_DASHBOARD pt-3 pl-2 pr-5"}, [$empty]]);
    priv.$dashboard = $dashboard;

    let $container = createElement2(
        ["div", {class: "C_TRANGER_VIEW p-3",
                 style: "height:100%; display:flex; flex-direction:column;"},
            [
                ["div", {class: "tabs is-boxed mb-2 TRANGER_TOPICS"}, [$tabs]],
                ["div", {class: "is-flex is-align-items-center mb-2 TRANGER_TOOLBAR"},
                    [$keys_btn, $live_btn, $meta]],
                $error,
                $dashboard
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Inline error banner (a failed command must be seen, not swallowed —
 *  and not block the whole SPA with an app modal).
 ***************************************************************/
function show_error(gobj, msg)
{
    let priv = gobj.priv;
    if(!priv.$error) {
        return;
    }
    if(!msg) {
        priv.$error.classList.add("is-hidden");
        priv.$error.textContent = "";
        return;
    }
    priv.$error.textContent = t(msg);
    priv.$error.classList.remove("is-hidden");
}

/***************************************************************
 *  The transport gobj, alive or not in session — null only when there is
 *  none or a reconnect destroyed it.
 *
 *  This is the transport to UNSUBSCRIBE on, and only that. A subscription
 *  is LOCAL state of the iev (gobj_unsubscribe_event drops it from its
 *  subscription list whatever its state; mt_subscription_deleted merely
 *  skips the remote notification when there is no session). Guarding the
 *  unsubscribe with live_transport() — which requires ST_SESSION — meant a
 *  card closed DURING a flap kept its subscription: C_IEVENT_CLI resent it
 *  on reopen (resend_subscriptions) and records kept arriving for a card
 *  that no longer existed, inflating the picker's key counts.
 ***************************************************************/
function alive_transport(gobj)
{
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote || !is_gobj(remote) || gobj_is_destroying(remote)) {
        return null;
    }
    return remote;
}

/***************************************************************
 *  The transport to COMMAND through, or null when it cannot carry a
 *  command right now (no transport, transport destroyed by a reconnect,
 *  or websocket down).
 *
 *  Every caller MUST go through this. `gobj_command()` returns null BOTH
 *  on success AND after logging "Not in session", so its return value can
 *  never tell the two apart: a `if(ret) { log_error(ret); }` guard on a
 *  dead link is silently unreachable, the command evaporates, and anything
 *  waiting for its answer (get-page's Promise) waits forever.
 ***************************************************************/
function live_transport(gobj)
{
    let remote = alive_transport(gobj);
    if(!remote) {
        return null;
    }
    if(gobj_current_state(remote) !== "ST_SESSION") {
        return null;
    }
    return remote;
}

/***************************************************************
 *  Take a get-page request out of the pending set (and disarm its
 *  watchdog). Returns the entry, or null when the req_id is unknown.
 ***************************************************************/
function take_pending(gobj, req_id)
{
    let priv = gobj.priv;
    let pend = req_id ? priv.pending[req_id] : null;
    if(!pend) {
        return null;
    }
    delete priv.pending[req_id];
    if(pend.timer) {
        clearTimeout(pend.timer);
        pend.timer = null;
    }
    return pend;
}

/***************************************************************
 *  Settle every get-page Promise still waiting for an answer that will
 *  never land (session died / view stopping / its card closed). Tabulator
 *  shows its error placeholder instead of spinning forever, and
 *  priv.pending does not grow one entry per lost request.
 *
 *  With a `card`, only that card's requests are settled — a closed card
 *  must not leave an answer in flight that later resolves a Promise for a
 *  destroyed table.
 ***************************************************************/
function reject_pending(gobj, reason, card)
{
    let priv = gobj.priv;
    let ids = Object.keys(priv.pending || {});
    for(let req_id of ids) {
        let pend = priv.pending[req_id];
        if(card && pend && pend.card !== card) {
            continue;
        }
        take_pending(gobj, req_id);
        if(pend && pend.reject) {
            pend.reject(new Error(reason));
        }
    }
}

/***************************************************************
 *  Command to remote service: list the topics.
 *
 *  `expanded=1` asks for a dict per topic instead of a bare name — what we
 *  are after is its `system_flag`, the only thing that says whether the
 *  topic's t/tm are seconds or milliseconds. A backend older than that
 *  parameter simply ignores it and answers the old array of names; the
 *  answer handler takes both shapes.
 ***************************************************************/
function request_topics(gobj)
{
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot list topics`);
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    gobj_command(remote, "topics", {service: service, expanded: 1}, gobj);
}

/***************************************************************
 *  What the user typed in the Keys search, as a regex the backend can
 *  match: the term is a plain SUBSTRING, so every regex metacharacter in
 *  it is escaped. `rkey` is matched unanchored, so an escaped term is
 *  exactly a substring search — no anchors needed.
 ***************************************************************/
function rx_escape(s)
{
    return String(s === null || s === undefined ? "" : s)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/***************************************************************
 *  Command to remote service: ONE PAGE of the topic's keys.
 *
 *  The keys used to be asked for in full, always: a topic with a hundred
 *  thousand keys was transferred whole into the browser and filtered
 *  there. The backend filters, sorts and pages them now (`list-keys` with
 *  rkey / order / desc / from / limit), and the picker is a remote-paginated
 *  table like the records one — same Promise bridge, same envelope
 *  ({total_rows, pages, data}).
 ***************************************************************/
function request_keys_page(gobj, page, size, rkey, order, desc)
{
    let priv = gobj.priv;
    return new Promise(function(resolve, reject) {
        let remote = live_transport(gobj);
        if(!remote) {
            let msg = `${gobj_short_name(gobj)}: no session, cannot list keys of ` +
                      `'${priv.cur_topic}'`;
            log_error(msg);
            reject(new Error(msg));
            return;
        }
        let req_id = `k${++priv.req_seq}`;
        let timer = setTimeout(function() {
            gobj_send_event(gobj, "EV_PAGE_TIMEOUT", {req_id: req_id}, gobj);
        }, PAGE_TIMEOUT_MS);

        priv.pending[req_id] = {
            resolve: resolve, reject: reject, card: null, timer: timer
        };

        gobj_command(remote, "list-keys",
            {
                service:    gobj_read_str_attr(gobj, "treedb_name"),
                topic_name: priv.cur_topic,
                rkey:       rkey || "",
                order:      order || "key",
                desc:       desc ? 1 : 0,
                from:       (page - 1) * size + 1,
                limit:      size,
                /*  The topic travels so a page of a topic the user has since
                 *  left can be told apart from the current one: its rows would
                 *  otherwise land in the key/span state of the NEW topic.  */
                __md_command__: {req_id: req_id, purpose: "page",
                                 topic_name: priv.cur_topic}
            }, gobj);
    });
}

/***************************************************************
 *  Command to remote service: how many keys the topic has (the toolbar
 *  count). `limit=1` so the answer is one row plus the total — the count
 *  must not cost a transfer of every key.
 ***************************************************************/
function request_keys_count(gobj, topic_name)
{
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot count the keys of ` +
                  `'${topic_name}'`);
        return;
    }
    gobj_command(remote, "list-keys",
        {
            service:    gobj_read_str_attr(gobj, "treedb_name"),
            topic_name: topic_name,
            from:       1,
            limit:      1,
            __md_command__: {topic_name: topic_name, purpose: "count"}
        }, gobj);
}

/***************************************************************
 *  Command to remote service: do these saved key-views still point at keys
 *  that EXIST? One bounded query (`rkey` = the alternation of the saved
 *  keys) instead of the full key list the presence check used to be read
 *  from.
 ***************************************************************/
function request_saved_keys(gobj, topic_name, keys)
{
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot check the saved views of ` +
                  `'${topic_name}'`);
        return;
    }
    let rkey = "^(" + keys.map(rx_escape).join("|") + ")$";
    gobj_command(remote, "list-keys",
        {
            service:    gobj_read_str_attr(gobj, "treedb_name"),
            topic_name: topic_name,
            rkey:       rkey,
            __md_command__: {topic_name: topic_name, purpose: "restore"}
        }, gobj);
}

/***************************************************************
 *  Paint the topic tabs.
 ***************************************************************/
function render_tabs(gobj)
{
    let priv = gobj.priv;
    let $tabs = priv.$tabs;
    while($tabs.firstChild) {
        $tabs.removeChild($tabs.firstChild);
    }
    for(let topic of (priv.topics || [])) {
        let $a = createElement2(["a", {class: "TRANGER_TOPIC_TAB"}, topic]);
        $a.addEventListener("click", (ev) => {
            ev.preventDefault();
            gobj_send_event(gobj, "EV_SELECT_TOPIC", {topic: topic}, gobj);
        });
        let $li = createElement2(
            ["li", {class: "TRANGER_TOPIC_TAB_ITEM" +
                           (topic === priv.cur_topic ? " is-active" : "")}, [$a]]);
        $tabs.appendChild($li);
    }
}

/***************************************************************
 *  Select a topic: mark its tab, drop any open cards, (re)load its
 *  keys for the picker, publish the selection for the URL deep link.
 *  The work of ac_select_topic (which owns the state change).
 ***************************************************************/
function do_select_topic(gobj, topic_name)
{
    let priv = gobj.priv;
    close_all_cards(gobj);
    close_picker(gobj);     /*  keys are per-topic; reopen for the new one  */
    priv.cur_topic = topic_name;
    priv.keys = null;
    priv.key_spans = {};    /*  spans are per topic  */
    priv.keys_total = 0;
    render_tabs(gobj);
    show_error(gobj, "");
    update_meta(gobj);

    /*  Two bounded queries instead of the whole key list: how many keys the
     *  topic has (the toolbar count), and which of the SAVED views still point
     *  at a key that exists. The picker asks for its own page when it opens.  */
    request_keys_count(gobj, topic_name);
    ask_saved_views(gobj, topic_name);

    gobj_publish_event(gobj, "EV_TOPIC_SELECTED", {topic: topic_name});
}

/***************************************************************
 *  Toolbar meta: key count of the current topic + open card count.
 ***************************************************************/
function update_meta(gobj)
{
    let priv = gobj.priv;
    if(!priv.$meta) {
        return;
    }
    if(!priv.cur_topic) {
        priv.$meta.textContent = "";
        return;
    }
    /*  The TOTAL the backend reports, not what the picker's page happens to
     *  hold — the page is 15 rows of however many the topic has.  */
    let text = `${priv.keys_total || 0} ${t("keys")}`;
    if(priv.cards.length > 0) {
        text += ` · ${priv.cards.length} ${t("views")}`;
    }
    priv.$meta.textContent = text;
}

/***************************************************************
 *  True on a phone-width viewport (Bulma's mobile breakpoint).
 ***************************************************************/
function is_mobile()
{
    return typeof window !== "undefined" && window.innerWidth <= 768;
}

/***************************************************************
 *  Keys picker: a Tabulator of the topic's keys (sorted by record count,
 *  header-filtered). Each row's "Rows" / "Live" buttons are colored ONLY
 *  while that view is open for the key (they toggle it off on click).
 *  Presentation is responsive: a moveable C_YUI_WINDOW on desktop, the
 *  shell's adaptive modal sheet on mobile (a window is awkward on a
 *  phone). Either way it persists while cards are opened/closed, and a
 *  second "Keys" click is a no-op while it is up.
 ***************************************************************/
function open_keys_picker(gobj)
{
    let priv = gobj.priv;
    /*  No !cur_topic guard: only ST_TOPIC_SELECTED declares EV_OPEN_KEYS, so
     *  a Keys click with no topic is a LOUD FSM error naming its sender —
     *  never the silent no-op button it used to be.  */
    if(priv.picker_win || priv.picker_modal) {
        return;     /*  already open  */
    }

    let mobile = is_mobile();
    let shell = yui_shell_of(gobj);

    /*  No explicit key request here any more: the picker's Tabulator asks for
     *  its own page on build (ajaxRequestFunc), so opening it is what refreshes
     *  the counts — they go stale as the backend appends, and there is no
     *  polling (Yuneta rule). A live record still bumps the count of its key
     *  while the picker is up (see ac_tranger_record_added).  */

    let $tbl = createElement2(["div", {class: "TRANGER_KEYS_TABLE"}, []]);
    let $box = createElement2(
        ["div", {class: "TRANGER_KEYS_PICKER",
                 style: mobile ? "" : "height:100%; display:flex; flex-direction:column;"},
            [$tbl]]);

    /*  A dismiss (X / dock / Escape / back) is an OS notification: turn it
     *  into EV_PICKER_CLOSED and let the action release the table + refs.  */
    if(mobile) {
        if(!shell) {
            log_error(`${gobj_short_name(gobj)}: no shell, cannot open the Keys sheet`);
            return;
        }
        priv.picker_modal = yui_shell_show_modal(shell, $box, {
            dialog: true,
            logical_class: "TRANGER_KEYS_SHEET",
            title:  `${priv.cur_topic} · ${t("keys")}`,
            t:      t,
            on_close: () => {
                /*  A teardown (mt_stop / destroy) already released the picker
                 *  and cleared the refs; sending there would only log
                 *  "gobj dst DESTROYED".  */
                if(gobj_is_destroying(gobj)) {
                    return;
                }
                gobj_send_event(gobj, "EV_PICKER_CLOSED", {}, gobj);
            }
        });
    } else {
        /*  Mount the window in the shell's popup layer (z-index 20), NOT on
         *  document.body: a body-level window lands in the root stacking
         *  context above the shell's modal layer (z-index 99) and would hide
         *  every modal opened from it (the Rows-options form, record
         *  dialogs). Inside the popup layer, the modal layer — a higher
         *  sibling — always renders above the window.  */
        let $win_parent = (shell && yui_shell_popup_layer(shell)) ||
            (typeof document !== "undefined" && document.getElementById("top-layer")) ||
            null;

        priv.picker_win = gobj_create_service(
            `tranger-keys-${priv.tok}`,
            "C_YUI_WINDOW",
            {
                $parent: $win_parent,
                subscriber: null,
                modal:      false,
                showMax:    true,
                showFooter: false,
                resizable:  true,
                center:     true,
                auto_save_size_and_position: true,
                width:      560,
                height:     520,
                logical_class: "TRANGER_KEYS_WINDOW",
                title:      `${priv.cur_topic} · ${t("keys")}`,
                icon:       "yi-table",
                body:       $box,
                /*  No window manager: the Keys picker is a helper of THIS
                 *  view, not a first-class app window — it must not land in
                 *  the dock/taskbar, nor outlive the topic it belongs to.
                 *  Without a manager, minimize collapses it in place.  */
                manager:    null,
                on_close: () => {
                    if(gobj_is_destroying(gobj)) {
                        return;     /*  teardown already released the picker  */
                    }
                    gobj_send_event(gobj, "EV_PICKER_CLOSED", {}, gobj);
                }
            },
            gobj
        );
        if(!priv.picker_win) {
            log_error(`${gobj_short_name(gobj)}: cannot create Keys window`);
            return;
        }
    }

    /*  The host (window body / modal sheet) is mounted synchronously, so
     *  the Tabulator can build against a live element right away.  */
    /*  Remote everything — pagination, sort AND filter. The picker used to be
     *  handed every key of the topic and do all three in the browser; a topic
     *  with a hundred thousand keys made that a transfer of the whole index and
     *  a sort of it on the main thread. The backend does it (list-keys with
     *  rkey / order / desc / from / limit) and the browser holds one page.  */
    let picker = new Tabulator($tbl, {
        height:         mobile ? "min(60vh, 460px)" : "100%",
        index:          "key",     /*  row identity: updateData() finds by it  */
        layout:         "fitColumns",
        placeholder:    t("no keys"),
        pagination:     true,
        paginationMode: "remote",
        sortMode:       "remote",
        filterMode:     "remote",
        paginationSize: 15,
        paginationSizeSelector: [15, 30, 50, 100],
        paginationCounter: rows_counter(),
        initialSort:    [{column: "records", dir: "desc"}],
        ajaxURL:        "list-keys",    /*  dummy: only triggers ajaxRequestFunc  */
        ajaxRequestFunc: function(url, config, params) {
            let sorter = (params.sort && params.sort[0]) || null;
            let filter = (params.filter || []).find((f) => f.field === "key");
            return request_keys_page(
                gobj,
                params.page || 1,
                params.size || 15,
                filter ? rx_escape(filter.value) : "",
                sorter ? sorter.field : "records",
                sorter ? sorter.dir === "desc" : true
            );
        },
        /*  Compact widths on a phone: fitColumns cannot shrink a column below
         *  its minWidth/width, so the desktop set (150+110+160) overflows a
         *  ~300px sheet and Tabulator adds a horizontal scrollbar — two-axis
         *  scrolling inside a modal. The action buttons go icon-only there
         *  (their labels are is-hidden-mobile), hence the narrower column.  */
        columns: [
            {title: t("key"), field: "key", minWidth: mobile ? 100 : 150,
                headerFilter: "input"},
            {title: t("records"), field: "records", width: mobile ? 70 : 110,
                hozAlign: "right"},
            {title: t("actions"), field: "_act", headerSort: false,
                width: mobile ? 96 : 160,
                formatter: (cell) => build_key_actions(gobj, cell)}
        ]
    });
    priv.picker_tbl = picker;

    /*
     *  The host lays out AFTER this synchronous build, so Tabulator's first
     *  width measurement can be off — fitColumns then overshoots (a too-wide
     *  `key` column + horizontal scroll). Re-measure once the table is
     *  initialized AND laid out.
     */
    picker.on("tableBuilt", () => {
        requestAnimationFrame(() => {
            try {
                picker.redraw(true);
            } catch(e) {
                log_warning(`${GCLASS_NAME}: destroyed before the frame: ${e}`);
            }
        });
    });
}

/***************************************************************
 *  Close the Keys picker window (topic switch / stop). on_close releases
 *  the table and clears the refs.
 ***************************************************************/
function close_picker(gobj)
{
    let priv = gobj.priv;
    let win = priv.picker_win;
    let modal = priv.picker_modal;
    /*  Own the teardown here (topic switch / stop): destroy the table and
     *  clear the refs, then dismiss whichever presenter is up. gobj_destroy
     *  on the window fires its mt_destroy (DOM + dock unregister); the
     *  modal's close() fires its on_close — both now no-ops on the table
     *  (already gone) and refs (already null).  */
    if(priv.picker_tbl) {
        try {
            priv.picker_tbl.destroy();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
        priv.picker_tbl = null;
    }
    priv.picker_win = null;
    priv.picker_modal = null;
    if(win && is_gobj(win)) {
        try {
            gobj_destroy(win);
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
    }
    if(modal && typeof modal.close === "function") {
        try {
            modal.close();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
    }
}

/***************************************************************
 *  Re-run the picker's per-row action formatters so the Rows/Live buttons
 *  reflect the current open-card set (called after a card opens/closes).
 ***************************************************************/
function refresh_picker_actions(gobj)
{
    let priv = gobj.priv;
    if(!priv.picker_tbl) {
        return;
    }
    try {
        priv.picker_tbl.getRows().forEach((r) => r.reformat());
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table gone: ${e}`);
    }
}

/***************************************************************
 *  The open card for (key, mode), or null. There is at most ONE (add_card
 *  dedups), and every open card belongs to cur_topic (a topic switch closes
 *  them all), so the pair identifies a card unambiguously.
 *
 *  This is why the card EVENTS carry {key, mode} and never the card object
 *  itself: a kw must stay PLAIN JSON. The machine trace dumps it
 *  (`trace_json(kw)`), and a card holds its Tabulator and its DOM nodes —
 *  circular structures that would throw on serialization, breaking the very
 *  trace this FSM exists to feed. {key, mode} also reads better in the log.
 ***************************************************************/
function find_card(gobj, key, mode)
{
    let priv = gobj.priv;
    return priv.cards.find(
        (c) => c.key === String(key) && c.mode === mode) || null;
}

/***************************************************************
 *  The config service that owns the persisted open key-views (per
 *  connection). null if unavailable — persistence then no-ops.
 ***************************************************************/
function config_service()
{
    return gobj_find_service("treedb_config", false) || null;
}

/***************************************************************
 *  Persist / unpersist an open key-view (scoped by conn_id + treedb +
 *  topic). No-op without a conn_id or the config service.
 ***************************************************************/
function persist_view(gobj, card)
{
    let cfg = config_service();
    let conn_id = gobj_read_str_attr(gobj, "conn_id");
    if(!cfg || !conn_id) {
        return;
    }
    gobj_send_event(cfg, "EV_ADD_TRANGER_VIEW",
        {
            conn_id:     conn_id,
            treedb_name: gobj_read_str_attr(gobj, "treedb_name"),
            topic:       card.topic,
            key:         card.key,
            mode:        card.mode,
            match_cond:  card.match_cond || {}
        }, gobj);
}

function unpersist_view(gobj, card)
{
    let cfg = config_service();
    let conn_id = gobj_read_str_attr(gobj, "conn_id");
    if(!cfg || !conn_id) {
        return;
    }
    gobj_send_event(cfg, "EV_REMOVE_TRANGER_VIEW",
        {
            conn_id:     conn_id,
            treedb_name: gobj_read_str_attr(gobj, "treedb_name"),
            topic:       card.topic,
            key:         card.key,
            mode:        card.mode
        }, gobj);
}

/***************************************************************
 *  The key-views to reopen for the current topic: the persisted ones, plus
 *  the card a shared link asked for.
 *
 *  A view bound to a KEY can only be restored if the key still exists, and
 *  the browser no longer holds the topic's key list to check that against —
 *  so ask, with one bounded query (see request_saved_keys). The whole-topic
 *  Live card is bound to no key, so it opens straight away.
 ***************************************************************/
function ask_saved_views(gobj, topic_name)
{
    let priv = gobj.priv;
    let cfg = config_service();
    let conn_id = gobj_read_str_attr(gobj, "conn_id");

    let wanted = [];
    if(cfg && conn_id && topic_name) {
        for(let v of treedb_config_get_tranger_views(cfg, conn_id,
                gobj_read_str_attr(gobj, "treedb_name"), topic_name)) {
            wanted.push({key: String(v.key), mode: v.mode,
                         match_cond: v.match_cond || {}, restoring: true});
        }
    }
    if(priv.pending_card) {
        /*  A linked card is a deliberate open, so it IS persisted (no
         *  `restoring`) — it must survive the next visit like one opened by
         *  hand.  */
        wanted.push({key: String(priv.pending_card.key),
                     mode: priv.pending_card.mode,
                     match_cond: priv.pending_card.match_cond || {},
                     restoring: false});
        priv.pending_card = null;
    }
    if(!wanted.length) {
        return;
    }

    priv.wanted_views = wanted;

    let keyed = wanted.filter((v) => v.key !== ALL_KEYS);
    for(let v of wanted) {
        if(v.key === ALL_KEYS) {
            gobj_send_event(gobj, "EV_OPEN_CARD", v, gobj);
        }
    }
    if(!keyed.length) {
        priv.wanted_views = null;
        return;
    }
    request_saved_keys(gobj, topic_name, keyed.map((v) => v.key));
}

/***************************************************************
 *  The answer: open the wanted views whose key still exists, and say so
 *  when one does not (a stale saved view is silent — the user never asked
 *  for it today — but a SHARED LINK pointing nowhere must be reported: the
 *  user is looking for exactly that).
 ***************************************************************/
function restore_saved_views(gobj, existing_keys)
{
    let priv = gobj.priv;
    let wanted = priv.wanted_views || [];
    priv.wanted_views = null;

    let present = {};
    for(let k of (existing_keys || [])) {
        present[String(k.key)] = true;
    }

    for(let v of wanted) {
        if(v.key === ALL_KEYS) {
            continue;   /*  already opened: it is bound to no key  */
        }
        if(!present[v.key]) {
            if(!v.restoring) {
                log_error(`${gobj_short_name(gobj)}: the shared link points at ` +
                          `key '${v.key}', which '${priv.cur_topic}' does not have`);
                show_error(gobj, "the link points at a key this topic does not have");
            }
            continue;   /*  stale saved view: skip it  */
        }
        gobj_send_event(gobj, "EV_OPEN_CARD", v, gobj);
    }
}

/***************************************************************
 *  The per-row action buttons of the Keys picker. A button is colored
 *  (active) ONLY while its view is open for the key; clicking an active
 *  button closes that view, an inactive one opens it.
 ***************************************************************/
function build_key_actions(gobj, cell)
{
    let priv = gobj.priv;
    let key = String(cell.getRow().getData().key);
    let rows_open = priv.cards.some((c) => c.key === key && c.mode === "rows");
    let live_open = priv.cards.some((c) => c.key === key && c.mode === "live");

    let $rows = createElement2(
        ["button", {class: "button is-small TRANGER_KEY_ROWS" +
                           (rows_open ? " is-link is-selected" : ""),
                    type: "button", title: t("rows"), "aria-label": t("rows")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-eye"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "rows"}, t("rows")]
            ]
        ]);
    $rows.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if(rows_open) {
            gobj_send_event(gobj, "EV_CLOSE_CARD",
                {key: key, mode: "rows"}, gobj);
            return;
        }
        gobj_send_event(gobj, "EV_OPEN_OPTIONS", {key: key}, gobj);
    });

    let $live = createElement2(
        ["button", {class: "button is-small ml-1 TRANGER_KEY_LIVE" +
                           (live_open ? " is-success is-selected" : ""),
                    type: "button", title: t("live"), "aria-label": t("live")},
            [
                ["span", {class: "TRANGER_LIVE_DOT mr-1"}, ""],
                ["span", {class: "is-hidden-mobile", i18n: "live"}, t("live")]
            ]
        ]);
    $live.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if(live_open) {
            gobj_send_event(gobj, "EV_CLOSE_CARD",
                {key: key, mode: "live"}, gobj);
            return;
        }
        gobj_send_event(gobj, "EV_OPEN_CARD", {key: key, mode: "live"}, gobj);
    });

    return createElement2(
        ["div", {class: "is-flex TRANGER_KEY_ACTIONS"}, [$rows, $live]]);
}

/***************************************************************
 *  The time unit of the CURRENT topic, per axis: true when the topic
 *  stores that timestamp in milliseconds (system_flag sf_t_ms / sf_tm_ms)
 *  instead of seconds. Unknown topic (old backend, no `expanded` answer)
 *  → seconds, the historical assumption.
 ***************************************************************/
function topic_time_units(gobj)
{
    let priv = gobj.priv;
    let flags = (priv.topic_flags && priv.topic_flags[priv.cur_topic]) || 0;
    return {
        t_ms:  (flags & SF_T_MS)  !== 0,
        tm_ms: (flags & SF_TM_MS) !== 0
    };
}

/***************************************************************
 *  Remember the time span of every key a `list-keys` answer carried
 *  (every row of every answer has them — a page of the picker, the count
 *  query, the saved-view check), keyed by the STRINGIFIED key: a topic
 *  with numeric keys answers with numbers while every caller hands us a
 *  string.
 *
 *  The picker's current page cannot be the source of a span: a card
 *  restored from the saved set or from a shared link opens before the
 *  picker is ever built, and a key that lives on another page of it is not
 *  there either. Both used to open their Rows options with no bounds and a
 *  dead "full span" preset.
 ***************************************************************/
function remember_key_spans(gobj, rows)
{
    let priv = gobj.priv;
    if(!priv.key_spans) {
        priv.key_spans = {};
    }
    for(let row of (Array.isArray(rows) ? rows : [])) {
        if(!row || row.key === undefined || row.key === null) {
            continue;
        }
        priv.key_spans[String(row.key)] = {
            fr_t:  row.fr_t  || 0,
            to_t:  row.to_t  || 0,
            fr_tm: row.fr_tm || 0,
            to_tm: row.to_tm || 0
        };
    }
}

/***************************************************************
 *  The time span of a key, as `list-keys` reported it:
 *  {fr_t, to_t, fr_tm, to_tm}, each in the topic's own unit and 0 when
 *  the backend did not report it (older c_tranger) or when no answer has
 *  named that key yet. Never null — an all-zeros span reads as "unknown",
 *  which every caller already handles as "no bounds".
 ***************************************************************/
function key_span(gobj, key)
{
    let priv = gobj.priv;
    let span = (priv.key_spans || {})[String(key)];
    return {
        fr_t:  (span && span.fr_t)  || 0,
        to_t:  (span && span.to_t)  || 0,
        fr_tm: (span && span.fr_tm) || 0,
        to_tm: (span && span.to_tm) || 0
    };
}

/***************************************************************
 *  One time-range block of the modal: from/to pickers bounded to what the
 *  key actually holds, the preset buttons, and the span caption.
 *
 *  `axis` is "t" (persistence) or "tm" (message origin) — they are two
 *  independent match conditions and the iterator ANDs them, so each gets
 *  its own block instead of a selector that would let the user express
 *  only one of the two.
 *
 *  Returns {$block, $from, $to}.
 ***************************************************************/
function build_time_range_block(axis, from_val, to_val, ms, span_from, span_to)
{
    let up = axis.toUpperCase();
    let mk = (which, val) => createElement2(
        ["input", {class: `input TRANGER_OPT_${which}_${up}`,
                   type: "datetime-local", step: "1",
                   /*  Bounded to the key's real extent: a range outside it can
                    *  only ever return zero rows, and the bounds double as a
                    *  hint of what there is to look at.  */
                   min: epoch_to_local_input(span_from, ms),
                   max: epoch_to_local_input(span_to, ms),
                   value: epoch_to_local_input(val, ms)}]);

    let $from = mk("FROM", from_val);
    let $to = mk("TO", to_val);

    let $presets = createElement2(
        ["div", {class: `is-flex is-flex-wrap-wrap TRANGER_OPT_PRESETS_${up}`}, []]);
    for(let preset of TIME_PRESETS) {
        let $btn = createElement2(
            ["button", {class: "button is-small is-light mr-1 mt-1 " +
                               `TRANGER_OPT_PRESET TRANGER_OPT_PRESET_${preset.id.toUpperCase()}`,
                        type: "button", title: t(preset.label),
                        "aria-label": t(preset.label)},
                [["span", {i18n: preset.label}, t(preset.label)]]
            ]);
        $btn.addEventListener("click", () => {
            apply_time_preset(preset, $from, $to, ms, span_from, span_to);
        });
        $presets.appendChild($btn);
    }
    let $clear = createElement2(
        ["button", {class: "button is-small is-light mr-1 mt-1 TRANGER_OPT_PRESET_CLEAR",
                    type: "button", title: t("clear"), "aria-label": t("clear")},
            [["span", {i18n: "clear"}, t("clear")]]
        ]);
    $clear.addEventListener("click", () => {
        $from.value = "";
        $to.value = "";
    });
    $presets.appendChild($clear);

    let caption = (span_from && span_to)
        ? `${epoch_to_local_input(span_from, ms).replace("T", " ")} → ` +
          `${epoch_to_local_input(span_to, ms).replace("T", " ")}`
        : t("span unknown");

    let $block = createElement2(
        ["div", {class: `TRANGER_OPT_RANGE TRANGER_OPT_RANGE_${up}`},
            [
                ["p", {class: "label mb-1", i18n: axis === "t" ? "t persistence" : "tm message origin"},
                    t(axis === "t" ? "t persistence" : "tm message origin")],
                ["div", {class: "columns is-mobile is-multiline mb-0"},
                    [
                        ["div", {class: "column is-half"},
                            [
                                ["label", {class: "label is-small mb-1", i18n: "from"}, t("from")],
                                ["div", {class: "control"}, [$from]]
                            ]
                        ],
                        ["div", {class: "column is-half"},
                            [
                                ["label", {class: "label is-small mb-1", i18n: "to"}, t("to")],
                                ["div", {class: "control"}, [$to]]
                            ]
                        ]
                    ]
                ],
                $presets,
                ["p", {class: "is-size-7 has-text-grey mt-1 TRANGER_OPT_SPAN"}, caption]
            ]
        ]);

    return {$block: $block, $from: $from, $to: $to};
}

/***************************************************************
 *  Fill a range block from a quick preset. "span" is the key's own
 *  extent; "today" starts at local midnight; the rest are a window back
 *  from now. The `to` end is left OPEN for the now-relative ones — an
 *  iterator with no to_t keeps matching records that land while the card
 *  is open, and pinning it to "now" would silently exclude them.
 ***************************************************************/
function apply_time_preset(preset, $from, $to, ms, span_from, span_to)
{
    if(preset.id === "span") {
        $from.value = epoch_to_local_input(span_from, ms);
        $to.value = epoch_to_local_input(span_to, ms);
        return;
    }

    let from_ms;
    if(preset.id === "today") {
        let d = new Date();
        d.setHours(0, 0, 0, 0);
        from_ms = d.getTime();
    } else {
        from_ms = Date.now() - preset.secs * 1000;
    }

    $from.value = epoch_to_local_input(ms ? from_ms : Math.floor(from_ms / 1000), ms);
    $to.value = "";
}

/***************************************************************
 *  Build the Rows-options form: the server-side match conditions
 *  forwarded to `open-iterator` (all optional; blank = the full key).
 *
 *  The two time axes get a block each — `t` (persistence) and `tm`
 *  (message origin) — bounded to `span`, the key's real extent as
 *  list-keys reported it. `units` says whether the topic keeps them in
 *  seconds or milliseconds; every value handed to / read from the pickers
 *  crosses that conversion, so the numbers put on the wire are always in
 *  the topic's own unit.
 *
 *  `match_cond` preloads the fields (editing the conditions of an open
 *  card); `editing` only swaps the confirm button (open a new card vs
 *  apply to this one) — the fields are the same either way.
 *  Returns {$box, inputs, ranges, $open}.
 ***************************************************************/
function build_rows_options_form(match_cond, editing, span, units)
{
    let mc = match_cond || {};

    let mk_input = (cls, type, ph, val) => createElement2(
        ["input", {class: `input ${cls}`, type: type, placeholder: ph || "",
                   value: (val === 0 || val === undefined || val === null) ? "" : String(val)}]);

    let range_t = build_time_range_block("t", mc.from_t, mc.to_t, units.t_ms,
                        span.fr_t, span.to_t);
    let range_tm = build_time_range_block("tm", mc.from_tm, mc.to_tm, units.tm_ms,
                        span.fr_tm, span.to_tm);

    let inputs = {
        from_rowid:  mk_input("TRANGER_OPT_FROM_ROWID",  "number", t("1-based; negative = from end"),
                        mc.from_rowid),
        to_rowid:    mk_input("TRANGER_OPT_TO_ROWID",    "number", t("0 = last"),
                        mc.to_rowid),
        mask_set:    mk_input("TRANGER_OPT_MASK_SET",    "number", t("user_flag bits"),
                        mc.user_flag_mask_set),
        mask_notset: mk_input("TRANGER_OPT_MASK_NOTSET", "number", t("user_flag bits"),
                        mc.user_flag_mask_notset)
    };

    let ranges = {
        t:  {$from: range_t.$from,  $to: range_t.$to,  ms: units.t_ms},
        tm: {$from: range_tm.$from, $to: range_tm.$to, ms: units.tm_ms}
    };

    /*  The iterator can index the key from the END (open-iterator's
     *  `backward`). In a log that is what you almost always want — the last
     *  records, not the first ones the key ever got — and it is the only way
     *  to reach them without paging by hand through 400k rows to the end.  */
    let $backward = createElement2(["input", {type: "checkbox",
        class: "TRANGER_OPT_BACKWARD"}]);
    $backward.checked = !!mc.backward;
    inputs.backward = $backward;

    let field = (label, input) => ["div", {class: "field TRANGER_OPT_FIELD"},
        [
            ["label", {class: "label mb-1", i18n: label}, t(label)],
            ["div", {class: "control"}, [input]]
        ]];

    let $open = createElement2(
        ["button", {class: "button is-link TRANGER_OPT_OPEN", type: "button"},
            [
                ["span", {class: "icon"},
                    [["i", {class: editing ? "yi-square-check" : "yi-eye"}]]],
                ["span", {i18n: editing ? "apply" : "open rows"},
                    t(editing ? "apply" : "open rows")]
            ]
        ]);

    let $box = createElement2(
        ["div", {class: "TRANGER_ROWS_OPTIONS",
                 style: "width:min(92vw, 460px); max-width:100%;"},
            [
                ["p", {class: "is-size-7 has-text-grey mb-3", i18n: "leave blank for the full key"},
                    t("leave blank for the full key")],
                range_t.$block,
                ["hr", {class: "my-3"}, ""],
                range_tm.$block,
                ["hr", {class: "my-3"}, ""],
                ["div", {class: "columns is-mobile is-multiline"},
                    [
                        ["div", {class: "column is-half"}, [field("from rowid", inputs.from_rowid)]],
                        ["div", {class: "column is-half"}, [field("to rowid", inputs.to_rowid)]],
                        ["div", {class: "column is-half"}, [field("user-flag mask set", inputs.mask_set)]],
                        ["div", {class: "column is-half"}, [field("user-flag mask clear", inputs.mask_notset)]]
                    ]
                ],
                ["label", {class: "checkbox is-block mt-2 TRANGER_OPT_BACKWARD_FIELD"},
                    [$backward,
                     ["span", {class: "ml-2", i18n: "newest first"}, t("newest first")]]],
                ["div", {class: "has-text-right mt-2 TRANGER_OPT_ACTIONS"}, [$open]]
            ]
        ]);

    return {$box: $box, inputs: inputs, ranges: ranges, $open: $open};
}

/***************************************************************
 *  Collect a match_cond from the Rows-options form: only fields the
 *  user actually set (0/blank = unset), so the iterator applies exactly
 *  what was asked. The four time bounds go out in the topic's unit.
 ***************************************************************/
function collect_rows_match_cond(form)
{
    let inputs = form.inputs;
    let ranges = form.ranges;
    let mc = {};

    for(let axis of ["t", "tm"]) {
        let range = ranges[axis];
        let from = to_epoch(range.$from.value, range.ms);
        if(from) {
            mc[`from_${axis}`] = from;
        }
        let to = to_epoch(range.$to.value, range.ms);
        if(to) {
            mc[`to_${axis}`] = to;
        }
    }

    let fr = parseInt(inputs.from_rowid.value, 10);
    if(!Number.isNaN(fr) && fr !== 0) {
        mc.from_rowid = fr;
    }
    let tr = parseInt(inputs.to_rowid.value, 10);
    if(!Number.isNaN(tr) && tr !== 0) {
        mc.to_rowid = tr;
    }
    let ms = parseInt(inputs.mask_set.value, 10);
    if(!Number.isNaN(ms) && ms !== 0) {
        mc.user_flag_mask_set = ms;
    }
    let mn = parseInt(inputs.mask_notset.value, 10);
    if(!Number.isNaN(mn) && mn !== 0) {
        mc.user_flag_mask_notset = mn;
    }
    if(inputs.backward && inputs.backward.checked) {
        mc.backward = 1;
    }
    return mc;
}

/***************************************************************
 *  The Rows-options dialog. One dialog for the two ways in:
 *
 *    - a key with no card yet (`card` null): confirming OPENS a Rows card
 *      with the chosen conditions (the Keys picker stays up, its Rows
 *      button turns active);
 *    - an OPEN card (`card` given): the same form, preloaded with what
 *      that card is showing; confirming APPLIES the conditions in place.
 *
 *  Only the confirm button and the event it makes differ — the fields, the
 *  span bounds and the units are the same either way.
 ***************************************************************/
function open_rows_options(gobj, key, card)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot open the Rows options`);
        return;
    }
    let editing = !!card;
    let form = build_rows_options_form(
        editing ? card.match_cond : null, editing,
        key_span(gobj, key), topic_time_units(gobj));

    let opt_modal = yui_shell_show_modal(shell, form.$box, {
        dialog: true,
        logical_class: "TRANGER_ROWS_OPTIONS",
        title:  `${key} · ${t("rows")}`,
        t:      t
    });
    form.$open.addEventListener("click", () => {
        let match_cond = collect_rows_match_cond(form);
        if(opt_modal && typeof opt_modal.close === "function") {
            opt_modal.close();
        }
        gobj_send_event(gobj,
            editing ? "EV_APPLY_MATCH_COND" : "EV_OPEN_CARD",
            {key: key, mode: "rows", match_cond: match_cond}, gobj);
    });
}

/***************************************************************
 *  Arm a Rows card's SERVER-side iterator: a fresh id, the card's match
 *  conditions, and `open-iterator`. The id is new every time because an
 *  iterator is a SNAPSHOT — its row index is built when it is opened — so
 *  re-reading one is never how a card is refreshed, re-armed after a
 *  reconnect, or re-filtered.
 *
 *  The CALLER closes the previous iterator (when there is one to close):
 *  a first mount has none, and a mount whose link died must not close an
 *  id the backend never knew.
 *
 *  Returns true when it was armed. On a dead link it leaves iterator_id
 *  NULL — an id that was never opened would make the next close-iterator
 *  name an iterator the backend never had, and its error answer paints a
 *  misleading banner.
 ***************************************************************/
function arm_iterator(gobj, card)
{
    let priv = gobj.priv;
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, iterator not armed ` +
                  `for '${card.topic}' ('${card.key}')`);
        card.iterator_id = null;
        return false;
    }

    card.iterator_id = `spa-${priv.tok}-${++priv.iter_seq}`;

    let iter_kw = {
        service:     gobj_read_str_attr(gobj, "treedb_name"),
        iterator_id: card.iterator_id,
        topic_name:  card.topic,
        key:         card.key
    };
    Object.assign(iter_kw, card.match_cond || {});
    gobj_command(remote, "open-iterator", iter_kw, gobj);
    return true;
}

/***************************************************************
 *  Apply new match conditions to an open Rows card. The conditions live
 *  in the SERVER-side iterator (they pre-filter its row index), so they
 *  cannot be changed in place: close the old iterator, open a new one
 *  with the new conditions, and re-fetch from page 1 (the old page number
 *  is meaningless against a different row set). The card, its Tabulator
 *  and its columns stay — only the data behind them changes.
 ***************************************************************/
function apply_card_match_cond(gobj, card, match_cond)
{
    close_iterator(gobj, card.iterator_id);

    card.match_cond = match_cond || {};
    if(!arm_iterator(gobj, card)) {
        return;     /*  Error already logged  */
    }

    persist_view(gobj, card);   /*  upsert: the saved view carries match_cond  */

    if(!card.tabulator) {
        return;
    }
    try {
        if(card.tabulator.getPage() > 1) {
            card.tabulator.setPage(1);      /*  re-fetches page 1 via ajax  */
        } else {
            card.tabulator.replaceData();
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: destroyed mid-flight: ${e}`);
    }
}

/***************************************************************
 *  Add a card to the dashboard for `key` in `mode`:
 *    - "rows": records Tabulator with native remote pagination
 *      (open-iterator + get-page).
 *    - "live": a rolling Tabulator fed by a realtime feed (open-rt +
 *      subscribe to EV_TRANGER_RECORD_ADDED), newest on top.
 *  One card per (key, mode); a duplicate request is ignored.
 ***************************************************************/
function add_card(gobj, key, mode, match_cond, restoring)
{
    let priv = gobj.priv;
    /*  cur_topic is guaranteed by ST_TOPIC_SELECTED (the only state that
     *  declares EV_OPEN_CARD); an unknown mode is a caller bug.  */
    if(mode !== "rows" && mode !== "live") {
        log_error(`${gobj_short_name(gobj)}: bad card mode '${mode}'`);
        return;
    }
    if(mode === "rows" && key === ALL_KEYS) {
        /*  Only the realtime feed takes "every key": an iterator indexes ONE
         *  key (open-iterator requires it).  */
        log_error(`${gobj_short_name(gobj)}: a Rows card needs a key`);
        return;
    }
    if(!live_transport(gobj)) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot open a '${mode}' card`);
        return;
    }
    for(let c of priv.cards) {
        if(c.key === key && c.mode === mode) {
            return;
        }
    }

    let cfg = config_service();

    let card = {
        key: key, mode: mode, topic: priv.cur_topic,
        tabulator: null, $el: null, $count: null, $pause: null, $share: null,
        match_cond: match_cond || {},
        live_max: cfg ? treedb_config_get_live_max(cfg) : LIVE_MAX_DEFAULT,
        iterator_id: null, rt_id: null, subscribed: false,
        built: false, seeded: false, pending: [],
        paused: false, held: []   /*  Live: records that arrived while paused  */
    };

    /*  p-2: the card is a .box with p-0 (the header band must run edge to
     *  edge), so the breathing room around the table is set here.  */
    let $table = createElement2(["div", {class: "TRANGER_CARD_TABLE p-2"}, []]);

    let $close = createElement2(
        ["button", {class: "button TRANGER_CARD_CLOSE",
                    title: t("close"), "aria-label": t("close")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "close"}, t("close")]
            ]
        ]);
    $close.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_CLOSE_CARD",
            {key: card.key, mode: card.mode}, gobj);
    });

    /*  Rows only: reopen the options dialog, preloaded with THIS card's
     *  conditions, and apply the edit in place.  */
    let $options = null;
    if(mode === "rows") {
        $options = createElement2(
            ["button", {class: "button TRANGER_CARD_OPTIONS",
                        title: t("options"), "aria-label": t("options")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-cog"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "options"}, t("options")]
                ]
            ]);
        $options.addEventListener("click", () => {
            gobj_send_event(gobj, "EV_OPEN_CARD_OPTIONS",
                {key: card.key, mode: card.mode}, gobj);
        });
    }

    /*  Export what the table HOLDS — the loaded page of a Rows card, the
     *  rolling buffer of a Live one. Deliberately not "export the key": that
     *  is a server-side dump of possibly millions of records, and this SPA has
     *  no streaming download. The title says exactly what travels.  */
    let $export = createElement2(
        ["button", {class: "button TRANGER_CARD_EXPORT",
                    title: t("download the rows loaded in this table as csv"),
                    "aria-label": t("export")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-download"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "export"}, t("export")]
            ]
        ]);
    $export.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_EXPORT_CARD",
            {key: card.key, mode: card.mode}, gobj);
    });

    /*  A link to THIS card — its key, its mode and its match conditions —
     *  instead of "open the topic and set the same six fields I did".  */
    let $share = createElement2(
        ["button", {class: "button TRANGER_CARD_SHARE",
                    title: t("copy a link to this card"),
                    "aria-label": t("share")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-link"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "share"}, t("share")]
            ]
        ]);
    $share.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_SHARE_CARD",
            {key: card.key, mode: card.mode}, gobj);
    });
    card.$share = $share;

    /*  On a phone the card shows only the first MOBILE_COLS columns — a record
     *  with a dozen fields is 1000+px wide and the table just scrolls sideways.
     *  That was a one-way door: nothing could bring a hidden column back, and
     *  the choice of WHICH four to keep was ours, not the reader's.  */
    let $cols = createElement2(
        ["button", {class: "button TRANGER_CARD_COLUMNS",
                    title: t("choose the columns to show"),
                    "aria-label": t("columns")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-table"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "columns"}, t("columns")]
            ]
        ]);
    $cols.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_OPEN_COLUMNS",
            {key: card.key, mode: card.mode}, gobj);
    });

    /*  Live only: hold the table still without closing the feed. Records that
     *  arrive while paused are BUFFERED (capped like the table itself), not
     *  dropped — pausing to read a row must not cost you the rows that land
     *  while you read it.  */
    let $pause = null;
    if(mode === "live") {
        $pause = createElement2(
            ["button", {class: "button TRANGER_CARD_PAUSE",
                        title: t("pause"), "aria-label": t("pause")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-pause"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "pause"}, t("pause")]
                ]
            ]);
        $pause.addEventListener("click", () => {
            gobj_send_event(gobj, "EV_TOGGLE_PAUSE",
                {key: card.key, mode: card.mode}, gobj);
        });
        card.$pause = $pause;
    }

    /*  mode-specific action: Rows -> Refresh (reload page), Live -> Clear.  */
    let $action;
    if(mode === "rows") {
        $action = createElement2(
            ["button", {class: "button TRANGER_CARD_REFRESH",
                        title: t("refresh"), "aria-label": t("refresh")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "refresh"}, t("refresh")]
                ]
            ]);
        $action.addEventListener("click", () => {
            gobj_send_event(gobj, "EV_REFRESH_CARD",
                {key: card.key, mode: card.mode}, gobj);
        });
    } else {
        $action = createElement2(
            ["button", {class: "button TRANGER_CARD_CLEAR",
                        title: t("clear"), "aria-label": t("clear")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-broom"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "clear"}, t("clear")]
                ]
            ]);
        $action.addEventListener("click", () => {
            gobj_send_event(gobj, "EV_CLEAR_CARD",
                {key: card.key, mode: card.mode}, gobj);
        });
    }

    let head_children = [];
    if(mode === "live") {
        head_children.push(
            ["span", {class: "TRANGER_LIVE_DOT ml-1 mr-2 is-flex-shrink-0",
                      title: t("live")}, ""]);
    }
    let title = key === ALL_KEYS ? t("all keys") : key;
    head_children.push(["span", {class: "TRANGER_CARD_TITLE"}, `${title} · ${t(mode)}`]);

    /*  Live has no pager, so no "Showing x of N" footer: without this the
     *  rolling buffer is a black box (is it 12 rows or the 500 cap?).  */
    if(mode === "live") {
        card.$count = createElement2(
            ["span", {class: "TRANGER_CARD_COUNT tag is-light ml-2 is-flex-shrink-0",
                      title: t("rows buffered - oldest are dropped at the cap")},
                `0 / ${card.live_max}`]);
        head_children.push(card.$count);
    }

    /*  The filter hint does not fit a phone header as text — there it is the
     *  same message behind an info icon (title/aria-label), so a mobile user
     *  is not left with column filters and no idea of their scope.  */
    head_children.push(
        ["span", {class: "TRANGER_CARD_FILTERHINT is-size-7 has-text-grey ml-2 is-hidden-mobile",
                  title: t("column filters apply to the loaded rows only")},
            t("filters loaded rows")]);
    head_children.push(
        ["span", {class: "TRANGER_CARD_FILTERHINT_ICON icon is-small has-text-grey ml-2 " +
                         "is-flex-shrink-0 is-hidden-tablet",
                  title: t("column filters apply to the loaded rows only"),
                  "aria-label": t("column filters apply to the loaded rows only")},
            [["i", {class: "yi-circle-info"}]]]);
    head_children.push(["span", {class: "TRANGER_CARD_SPACER", style: "flex:1 1 auto;"}, ""]);
    if($options) {
        head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$options]]);
    }
    if($pause) {
        head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$pause]]);
    }
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$cols]]);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$export]]);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$share]]);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$action]]);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$close]]);
    let $head = createElement2(
        ["div", {class: "TRANGER_CARD_HEAD is-flex is-align-items-center p-2"},
            head_children]);

    let $el = createElement2(
        ["div", {class: "box p-0 mb-6 TRANGER_CARD"}, [$head, $table]]);
    card.$el = $el;

    priv.cards.push(card);
    if(priv.$empty) {
        priv.$empty.classList.add("is-hidden");
    }
    priv.$dashboard.appendChild($el);
    update_meta(gobj);
    refresh_picker_actions(gobj);
    if(!restoring) {
        persist_view(gobj, card);
    }

    if(mode === "rows") {
        mount_rows_table(gobj, card, $table);
    } else {
        mount_live_table(gobj, card, $table);
    }
}

/***************************************************************
 *  Rows card: open a per-key iterator and mount a records Tabulator with
 *  native remote pagination (get-page bridged to gobj_command).
 ***************************************************************/
function mount_rows_table(gobj, card, $table)
{
    /*  Arm the iterator FIRST; the Tabulator's first get-page (fired on build)
     *  is processed after it by the remote's FIFO command order. The chosen
     *  match_cond pre-filters the index, so total_rows / paging already
     *  reflect it. A link that went down between add_card()'s check and here
     *  leaves it unarmed (logged): the table is mounted anyway — the card is
     *  persisted, and EV_ON_OPEN re-arms it.  */
    arm_iterator(gobj, card);

    let table = new Tabulator($table, {
        height:         CARD_TABLE_HEIGHT,
        layout:         "fitDataFill",
        placeholder:    t("no records"),
        columnDefaults: {headerHozAlign: "left", headerSort: false, resizable: true},
        pagination:     true,
        paginationMode: "remote",
        filterMode:     "local",   /*  the head search filters the loaded page  */
        paginationSize: PAGE_SIZE,
        paginationSizeSelector: [50, 100, 200, 500],
        paginationCounter: rows_counter(),
        ajaxURL:        "get-page",     /*  dummy: only triggers ajaxRequestFunc  */
        ajaxRequestFunc: function(url, config, params) {
            return request_page(gobj, card, params.page || 1, params.size || PAGE_SIZE);
        },
        autoColumns:    true,
        autoColumnsDefinitions: tune_columns
    });
    table.on("rowClick", function(e, row) {
        gobj_send_event(gobj, "EV_SHOW_RECORD",
            {record: row.getData().__rec, key: card.key}, gobj);
    });
    /*  Re-measure once built + laid out (autoResize handles later window
     *  resizes), so the columns fit the card instead of a stale width.  */
    table.on("tableBuilt", function() {
        requestAnimationFrame(function() {
            try {
                table.redraw(true);
            } catch(e) {
                log_warning(`${GCLASS_NAME}: destroyed before the frame: ${e}`);
            }
        });
    });
    card.tabulator = table;
}

/***************************************************************
 *  Live card: mount an empty rolling Tabulator, arm the backend realtime
 *  feed (open-rt) and subscribe to its pushes. New records prepend
 *  (newest on top), capped at the card's live_max; columns are seeded from the first
 *  record (the feed loads no history).
 ***************************************************************/
function mount_live_table(gobj, card, $table)
{
    let priv = gobj.priv;
    let remote = live_transport(gobj);
    let service = gobj_read_str_attr(gobj, "treedb_name");
    card.rt_id = null;

    let table = new Tabulator($table, {
        height:         CARD_TABLE_HEIGHT,
        layout:         "fitDataFill",
        placeholder:    t("waiting for records"),
        columnDefaults: {headerHozAlign: "left", headerSort: false, resizable: true},
        columns:        [],
        data:           []
    });
    table.on("rowClick", function(e, row) {
        gobj_send_event(gobj, "EV_SHOW_RECORD",
            {record: row.getData().__rec, key: card.key}, gobj);
    });
    table.on("tableBuilt", function() {
        card.built = true;
        let pend = card.pending;
        card.pending = [];
        for(let row of pend) {
            push_live_row(card, row);
        }
        requestAnimationFrame(function() {
            try {
                table.redraw(true);
            } catch(e) {
                log_warning(`${GCLASS_NAME}: destroyed before the frame: ${e}`);
            }
        });
    });
    card.tabulator = table;

    /*  Arm the feed, then subscribe to its pushes.  */
    if(!remote) {
        /*  Link down between add_card()'s check and here: the empty table
         *  stays mounted (the card is persisted) — EV_ON_OPEN re-arms it.
         *  rt_id stays null: nothing was opened, so nothing is closed.  */
        log_error(`${gobj_short_name(gobj)}: no session, feed not armed for '${card.topic}'`);
        return;
    }
    card.rt_id = `spa-${priv.tok}-rt-${++priv.iter_seq}`;
    gobj_command(remote, "open-rt",
        {
            service:    service,
            rt_id:      card.rt_id,
            topic_name: card.topic,
            key:        card.key      /*  ALL_KEYS ("") = the whole topic  */
        }, gobj);
    gobj_subscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
        {__service__: service, __filter__: live_filter(card)}, gobj);
    card.subscribed = true;
}

/***************************************************************
 *  The subscription filter of a Live card. A whole-topic card must NOT
 *  filter by key: the events carry the record's REAL key, so a `key: ""`
 *  filter would match nothing and the card would never see a record.
 ***************************************************************/
function live_filter(card)
{
    if(card.key === ALL_KEYS) {
        return {topic_name: card.topic};
    }
    return {topic_name: card.topic, key: card.key};
}

/***************************************************************
 *  Shared column tuning for the auto/seeded columns (drop __rec, no
 *  header sort, per-column operator header filter, tidy the metadata
 *  columns).
 *
 *  On a phone only the first MOBILE_COLS columns are shown: a record with
 *  a dozen fields, each at minWidth 90, is 1000+px wide and the card just
 *  scrolls sideways. Nothing is lost — a row click opens the FULL record
 *  as JSON, which is the way to read a wide record on a phone anyway.
 ***************************************************************/
function tune_columns(defs)
{
    let mobile = is_mobile();
    let shown = 0;

    return defs
        .filter((d) => d.field !== "__rec")
        .map((d) => {
            d.headerSort = false;
            d.minWidth = 90;
            d.headerFilter = "input";
            d.headerFilterFunc = op_filter;
            d.headerFilterLiveFilter = true;
            d.headerFilterPlaceholder = "= < >";
            if(d.field === "rowid") {
                d.width = 80;
                d.hozAlign = "right";
            }
            if(d.field === "t" || d.field === "tm") {
                d.minWidth = 150;
            }
            if(mobile) {
                shown++;
                if(shown > MOBILE_COLS) {
                    d.visible = false;
                }
            }
            return d;
        });
}

/***************************************************************
 *  Build column defs from a flattened row (Live: autoColumns can't
 *  generate from an initially-empty table, so seed them on first record).
 ***************************************************************/
function columns_from_row(row)
{
    let defs = [];
    for(let k in row) {
        if(k === "__rec") {
            continue;
        }
        defs.push({title: k, field: k});
    }
    return tune_columns(defs);
}

/***************************************************************
 *  Feed a live record into a card: buffer until the table is built (or
 *  while the card is PAUSED), then prepend (newest on top) and trim to the
 *  card's live_max.
 ***************************************************************/
function push_live_record(card, record, key)
{
    if(!card.tabulator) {
        return;
    }
    let row = flatten_record(record, card.key === ALL_KEYS ? key : "");
    if(!card.built) {
        card.pending.push(row);
        return;
    }
    if(card.paused) {
        /*  Held, not dropped: pausing to read a row must not cost you the rows
         *  that land while you read it. Capped like the table — a pause left
         *  on for an hour is not a licence to grow without bound.  */
        card.held.push(row);
        if(card.held.length > card.live_max) {
            card.held.shift();
        }
        update_live_count(card);
        return;
    }
    push_live_row(card, row);
}

function push_live_row(card, row)
{
    let table = card.tabulator;
    if(!table) {
        return;
    }
    if(!card.seeded) {
        card.seeded = true;
        try {
            table.setColumns(columns_from_row(row));
        } catch(e) {
            log_warning(`${GCLASS_NAME}: table gone: ${e}`);
        }
    }
    Promise.resolve(table.addData([row], true)).then(function() {
        let over = table.getDataCount() - card.live_max;
        if(over > 0) {
            let rows = table.getRows();
            for(let i = 0; i < over; i++) {
                let r = rows[rows.length - 1 - i];
                if(r) {
                    try {
                        r.delete();
                    } catch(e) {
                        log_warning(`${GCLASS_NAME}: gone: ${e}`);
                    }
                }
            }
        }
        update_live_count(card);
    }).catch(function(e) {
        log_warning(`${GCLASS_NAME}: table torn down mid-append: ${e}`);
    });
}

/***************************************************************
 *  Refresh a Live card's row counter: what the rolling buffer holds and
 *  the cap it is trimmed to.
 ***************************************************************/
function update_live_count(card)
{
    if(!card.$count || !card.tabulator) {
        return;
    }
    let n = 0;
    try {
        n = card.tabulator.getDataCount();
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table gone: ${e}`);
        return;
    }
    let held = card.held ? card.held.length : 0;
    card.$count.textContent = held
        ? `${n} / ${card.live_max} (+${held})`
        : `${n} / ${card.live_max}`;
}

/***************************************************************
 *  Close a card: close its iterator, destroy the table, unmount.
 *  `forget` (default true) drops it from the persisted open-views set —
 *  a deliberate user close. A teardown close (topic switch / stop) passes
 *  false so the view is restored on return.
 ***************************************************************/
function close_card(gobj, card, forget)
{
    let priv = gobj.priv;
    if(forget !== false) {
        unpersist_view(gobj, card);
    }
    let i = priv.cards.indexOf(card);
    if(i >= 0) {
        priv.cards.splice(i, 1);
    }
    /*  Its get-page requests are in flight against a table that is about to be
     *  destroyed: settle them here, or their answer resolves a Promise nobody
     *  owns any more (and their watchdog fires on a card that is gone).  */
    reject_pending(gobj, "card closed", card);
    if(card.tabulator) {
        try {
            card.tabulator.destroy();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
        card.tabulator = null;
    }
    if(card.$el && card.$el.parentNode) {
        card.$el.parentNode.removeChild(card.$el);
    }
    if(card.mode === "live") {
        if(card.subscribed) {
            /*  Unsubscribe on the transport whenever it is ALIVE, in session
             *  or not: the subscription is local state of the iev and a
             *  websocket that is merely down will resend it on reopen. Only a
             *  DESTROYED transport (reconnect) took its subscriptions with it
             *  — unsubscribing there logs "gobj NULL or DESTROYED".  */
            let remote = alive_transport(gobj);
            if(remote) {
                gobj_unsubscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
                    {__service__: gobj_read_str_attr(gobj, "treedb_name"),
                     __filter__: live_filter(card)}, gobj);
            }
            card.subscribed = false;
        }
        close_rt(gobj, card.rt_id);
    } else {
        close_iterator(gobj, card.iterator_id);
    }
    if(priv.cards.length === 0 && priv.$empty) {
        priv.$empty.classList.remove("is-hidden");
    }
    update_meta(gobj);
    refresh_picker_actions(gobj);
}

/***************************************************************
 *  Close every open card (topic switch / stop).
 ***************************************************************/
function close_all_cards(gobj)
{
    let priv = gobj.priv;
    let cards = (priv.cards || []).slice();
    for(let card of cards) {
        close_card(gobj, card, false);   /*  teardown: keep them persisted  */
    }
}

/***************************************************************
 *  Fire-and-forget close of a server-side iterator.
 *
 *  No session = nothing to close: the backend already reaped the
 *  iterators of a dead session. Deliberately silent, not an error path.
 ***************************************************************/
function close_iterator(gobj, iterator_id)
{
    if(!iterator_id) {
        return;
    }
    let remote = live_transport(gobj);
    if(!remote) {
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    gobj_command(remote, "close-iterator",
        {service: service, iterator_id: iterator_id}, gobj);
}

/***************************************************************
 *  Fire-and-forget close of a server-side realtime feed.
 *  Same contract as close_iterator(): no session = already reaped.
 ***************************************************************/
function close_rt(gobj, rt_id)
{
    if(!rt_id) {
        return;
    }
    let remote = live_transport(gobj);
    if(!remote) {
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    gobj_command(remote, "close-rt",
        {service: service, rt_id: rt_id}, gobj);
}

/***************************************************************
 *  Tabulator remote-pagination request: send get-page and return a
 *  Promise resolved when its answer lands (bridged in the answer
 *  handler by the echoed req_id). Resolves with Tabulator's expected
 *  {data, last_page} shape.
 ***************************************************************/
function request_page(gobj, card, page, size)
{
    let priv = gobj.priv;
    return new Promise(function(resolve, reject) {
        let remote = live_transport(gobj);
        if(!remote) {
            /*  Reject NOW: a command sent on a dead link is dropped and its
             *  answer never lands, so a registered pending entry would leave
             *  Tabulator spinning forever and leak one entry per request.  */
            let msg = `${gobj_short_name(gobj)}: no session, cannot get page ${page}`;
            log_error(msg);
            reject(new Error(msg));
            return;
        }
        let service = gobj_read_str_attr(gobj, "treedb_name");
        let req_id = `q${++priv.req_seq}`;

        /*  Watchdog: the link can stay UP and the answer still never land (the
         *  backend dropped it, the iterator died under us). Without it the
         *  entry lived forever in priv.pending and Tabulator span forever. The
         *  timer only turns the browser notification into an EVENT — the
         *  rejection happens in the action, like everything else here.  */
        let timer = setTimeout(function() {
            gobj_send_event(gobj, "EV_PAGE_TIMEOUT", {req_id: req_id}, gobj);
        }, PAGE_TIMEOUT_MS);

        priv.pending[req_id] = {
            resolve: resolve, reject: reject, card: card, timer: timer
        };

        let from_rowid = (page - 1) * size + 1;
        gobj_command(remote, "get-page",
            {
                service:     service,
                iterator_id: card.iterator_id,
                from_rowid:  from_rowid,
                limit:       size,
                __md_command__: {req_id: req_id}   /*  echoed back for correlation  */
            }, gobj);
    });
}

/***************************************************************
 *  Full record as JSON in the shell's adaptive dialog.
 ***************************************************************/
function show_record_dialog(gobj, record, key)
{
    let priv = gobj.priv;
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot show the record`);
        return;
    }
    let json = JSON.stringify(record, null, 4);

    let $pre = createElement2(
        ["pre", {class: "is-size-7 TRANGER_RECORD_JSON",
                 style: "max-width:80vw; max-height:70vh; overflow:auto;"}, ""]);
    $pre.textContent = json;

    /*  Reading a record in a browser and then having to retype it into a
     *  ticket is the most common thing this dialog is used for.  */
    let $copy = createElement2(
        ["button", {class: "button is-small mt-2 TRANGER_RECORD_COPY",
                    title: t("copy"), "aria-label": t("copy")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-copy"}]]],
                ["span", {i18n: "copy"}, t("copy")]
            ]
        ]);
    $copy.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_COPY_RECORD", {text: json}, gobj);
    });
    priv.$copy_btn = $copy;

    let $box = createElement2(
        ["div", {class: "TRANGER_RECORD_BOX"}, [$pre, $copy]]);

    yui_shell_show_modal(shell, $box, {
        dialog: true,
        logical_class: "TRANGER_RECORD_DIALOG",
        title:  `${priv.cur_topic} · ${key === ALL_KEYS ? t("all keys") : key}`,
        t:      t
    });
}




                    /***************************
                     *      Actions
                     ***************************/




/************************************************************
 *  Remote response
 ************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;

    let result = kw ? kw.result : -1;
    let comment = (kw && kw.comment) || "";
    let data = kw ? kw.data : null;

    let __command__ = msg_iev_get_stack(gobj, kw, "command_stack", true);
    let command = kw_get_str(gobj, __command__, "command", "", kw_flag_t.KW_REQUIRED);
    let kw_command = kw_get_dict(gobj, __command__, "kw", {}, kw_flag_t.KW_REQUIRED);

    /*
     *  get-page is bridged to a per-request Promise (Tabulator's remote
     *  pagination), correlated by the echoed req_id — handled before the
     *  generic error path so a failed page rejects its own Promise.
     */
    if(command === "get-page") {
        let req_id = kw_command ? kw_command.req_id : null;
        let pend = take_pending(gobj, req_id);
        if(!pend) {
            /*  Its Promise is already settled (timed out, card closed, session
             *  reopened): nothing to resolve, but never silently.  */
            log_error(`${gobj_short_name(gobj)}: get-page answer for an ` +
                      `unknown request '${req_id}' (already settled?)`);
        } else {
            if(result < 0) {
                log_error(`${gobj_short_name(gobj)}: get-page failed: ` +
                          `${comment || "(no comment)"}`);
                pend.reject(new Error(comment || "get-page failed"));
            } else {
                let page = data || {};
                /*  NOT `.map(flatten_record)`: map would hand it the INDEX as
                 *  its second argument, which is the key parameter.  */
                let rows = (Array.isArray(page.data) ? page.data : [])
                    .map((rec) => flatten_record(rec));
                /*  `last_row` is the exact row count: without it Tabulator
                 *  ESTIMATES the total as last_page * page_size (its
                 *  remoteRowCountEstimate) and the counter lies — "Showing
                 *  390001-100 of 100 rows".  */
                pend.resolve({
                    data:      rows,
                    last_page: Math.max(1, page.pages || 1),
                    last_row:  Math.max(0, page.total_rows || 0)
                });
            }
        }
        return 0;
    }

    /*
     *  The Keys picker is remote-paginated too, so its page comes back through
     *  the same Promise bridge — the rows are key descriptors, not records, so
     *  they travel as they are.
     */
    if(command === "list-keys" && kw_command && kw_command.purpose === "page") {
        let req_id = kw_command.req_id || null;
        let pend = take_pending(gobj, req_id);
        if(!pend) {
            log_error(`${gobj_short_name(gobj)}: list-keys answer for an ` +
                      `unknown request '${req_id}' (already settled?)`);
            return 0;
        }
        if(result < 0) {
            log_error(`${gobj_short_name(gobj)}: list-keys failed: ` +
                      `${comment || "(no comment)"}`);
            pend.reject(new Error(comment || "list-keys failed"));
            return 0;
        }
        if(kw_command.topic_name !== priv.cur_topic) {
            /*  A page of a topic the user has left: its table is gone with the
             *  picker. Benign race, not an error — but it must not overwrite
             *  the keys and the spans of the topic showing now.  */
            pend.reject(new Error("stale topic"));
            return 0;
        }
        if(Array.isArray(data)) {
            /*  A backend older than the paged list-keys ignores from/limit and
             *  answers the whole key list, as it always did. Do not leave the
             *  picker empty for that: show the lot as a single page. The search
             *  and the sort are then the backend's `order`-less answer — i.e.
             *  gone — so say so once, LOUDLY, instead of silently pretending
             *  the filter did something.  */
            log_warning(`${GCLASS_NAME}: this backend answers list-keys with the ` +
                        `whole key list (no rkey/from/limit): no server-side key ` +
                        `search or paging`);
            priv.keys = data;
            priv.keys_total = data.length;
            remember_key_spans(gobj, data);
            update_meta(gobj);
            pend.resolve({data: priv.keys, last_page: 1, last_row: priv.keys_total});
            return 0;
        }

        let page = data || {};
        priv.keys = Array.isArray(page.data) ? page.data : [];
        priv.keys_total = Math.max(0, page.total_rows || 0);
        remember_key_spans(gobj, priv.keys);
        update_meta(gobj);
        pend.resolve({
            data:      priv.keys,
            last_page: Math.max(1, page.pages || 1),
            last_row:  priv.keys_total
        });
        return 0;
    }

    if(result < 0) {
        show_error(gobj, comment || `${command} failed`);
        return 0;
    }

    switch(command) {
        case "topics": {
            /*  Two shapes: `expanded=1` gives a desc per topic (what we asked
             *  for), an older backend gives plain names. Both are legitimate
             *  answers — with names only, system_flag stays unknown and t/tm
             *  are read as seconds, which is what the view did before.  */
            priv.topics = [];
            priv.topic_flags = {};
            for(let item of (Array.isArray(data) ? data : [])) {
                if(typeof item === "string") {
                    priv.topics.push(item);
                    continue;
                }
                if(item && typeof item === "object" && item.topic_name) {
                    priv.topics.push(item.topic_name);
                    priv.topic_flags[item.topic_name] = item.system_flag || 0;
                }
            }
            let topic = priv.pending_seg && priv.topics.includes(priv.pending_seg)
                ? priv.pending_seg
                : priv.topics[0];
            priv.pending_seg = "";
            if(topic) {
                gobj_send_event(gobj, "EV_SELECT_TOPIC", {topic: topic}, gobj);
            } else {
                /*  A service with no topics: nothing to browse. Rest in
                 *  ST_LOADING_TOPICS — Keys/cards are undeclared there, so
                 *  they cannot be opened at all.  */
                render_tabs(gobj);
                show_error(gobj, "no topics");
            }
            break;
        }

        case "list-keys": {
            /*  Three different questions come back here, and the purpose says
             *  which: a PAGE for the picker (bridged to its Promise, above),
             *  the topic's key COUNT, or which saved views still point at a key
             *  that exists.  */
            let purpose = kw_get_str(gobj, kw_command, "purpose", "", 0);
            let topic = kw_get_str(gobj, kw_command, "topic_name", "", 0);
            if(topic !== priv.cur_topic) {
                break;      /*  stale answer of a previous topic  */
            }

            if(purpose === "count") {
                /*  `limit=1` was asked, so the answer is the paged envelope —
                 *  unless the backend is older than it, in which case it is the
                 *  whole key list and its length IS the count.  */
                priv.keys_total = Array.isArray(data)
                    ? data.length
                    : ((data && data.total_rows) || 0);
                remember_key_spans(gobj,
                    Array.isArray(data) ? data : (data && data.data));
                update_meta(gobj);
                break;
            }
            if(purpose === "restore") {
                /*  The rows of the saved-view check carry the span of every key
                 *  a restored card is about to open on: this is what gives that
                 *  card's Rows options their bounds without the picker.  */
                let rows = Array.isArray(data) ? data : [];
                remember_key_spans(gobj, rows);
                restore_saved_views(gobj, rows);
                break;
            }

            log_error(`${gobj_short_name(gobj)}: list-keys answer with no purpose ` +
                      `('${purpose}')`);
            break;
        }

        case "open-iterator":
        case "close-iterator":
        case "open-rt":
        case "close-rt": {
            break;      /*  fire and forget  */
        }

        default:
            log_error(`${gobj_short_name(gobj)} Command unknown: ${command}`);
    }

    return 0;
}

/************************************************************
 *  The link reopened (dropped websocket, token refresh).
 *
 *  From ST_DISCONNECTED it is what gets the view going: ask for the topics.
 *
 *  From ST_TOPIC_SELECTED every open card holds server-side state that no
 *  longer exists — the backend reaps the iterators and realtime feeds of a
 *  session when it dies. A Rows card would page against a dead iterator
 *  ("No records", pager collapsed) and a Live card would never see a record
 *  again. Re-arm both.
 ************************************************************/
function ac_transport_open(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = gobj_read_str_attr(gobj, "conn_id");

    if(kw && kw.conn_id && kw.conn_id !== conn_id) {
        return 0;   /*  another connection  */
    }

    /*  In-flight get-page answers belong to the session that just died.  */
    reject_pending(gobj, "session reopened");

    /*  Two different reopens land here:
     *
     *  - the SAME transport reconnected (websocket flap): our
     *    gobj_remote_yuno is still the live one — re-arm, that is what this
     *    action is for.
     *  - the transport was RECREATED (token refresh / coords edit): the iev
     *    we hold is DESTROYED, and commanding it only logs "gobj NULL or
     *    DESTROYED" once per card. The host (C_TREEDB_VIEW) owns that case:
     *    it rebuilds us against the new transport. Do nothing here.  */
    let links = gobj_find_service("treedb_links", false);
    let live = links ? treedb_links_get_iev(links, conn_id) : null;
    if(!live || live !== gobj_read_pointer_attr(gobj, "gobj_remote_yuno")) {
        return 0;   /*  transport recreated — the host rebinds us  */
    }

    if(gobj_current_state(gobj) === "ST_DISCONNECTED") {
        gobj_change_state(gobj, "ST_LOADING_TOPICS");
        request_topics(gobj);
        return 0;
    }

    if(priv.cur_topic) {
        request_keys_count(gobj, priv.cur_topic);
        if(priv.picker_tbl) {
            /*  The picker's rows belong to the session that just died: make it
             *  re-ask for its page (it is remote-paginated now).  */
            try {
                priv.picker_tbl.setPage(priv.picker_tbl.getPage() || 1);
            } catch(e) {
                log_warning(`${GCLASS_NAME}: picker refetch failed: ${e}`);
            }
        }
    }
    for(let card of priv.cards) {
        if(card.mode === "rows") {
            rearm_rows_card(gobj, card);
        } else {
            rearm_live_card(gobj, card);
        }
    }
    return 0;
}

/************************************************************
 *  Select a topic (tab click, deep-link restore, or the first topic of
 *  the `topics` answer). Entering ST_TOPIC_SELECTED is what makes the
 *  Keys picker and the cards reachable at all.
 ************************************************************/
function ac_select_topic(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let topic = (kw && kw.topic) || "";

    if(!topic || !(priv.topics || []).includes(topic)) {
        log_error(`${gobj_short_name(gobj)}: unknown topic '${topic}' ` +
                  `(from ${src ? gobj_short_name(src) : "?"})`);
        return -1;
    }
    do_select_topic(gobj, topic);
    gobj_change_state(gobj, "ST_TOPIC_SELECTED");
    return 0;
}

/************************************************************
 *  Open the Keys picker of the current topic.
 ************************************************************/
function ac_open_keys(gobj, event, kw, src)
{
    open_keys_picker(gobj);
    return 0;
}

/************************************************************
 *  The Keys picker was dismissed (X / dock / Escape / back), or torn
 *  down by close_picker(): release its Tabulator and clear the refs.
 ************************************************************/
function ac_picker_closed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.picker_tbl) {
        try {
            priv.picker_tbl.destroy();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
        priv.picker_tbl = null;
    }
    priv.picker_win = null;
    priv.picker_modal = null;
    return 0;
}

/************************************************************
 *  Open the Rows-options dialog for a key (its confirm sends
 *  EV_OPEN_CARD with the chosen match conditions).
 ************************************************************/
function ac_open_options(gobj, event, kw, src)
{
    open_rows_options(gobj, (kw && kw.key) || "", null);
    return 0;
}

/************************************************************
 *  The card an event refers to, by {key, mode}. A miss means the card
 *  closed between the click and the event: loud, and the action bails.
 ************************************************************/
function card_of_event(gobj, event, kw, src)
{
    let card = find_card(gobj, (kw && kw.key) || "", (kw && kw.mode) || "");
    if(!card) {
        log_error(`${gobj_short_name(gobj)}: ${event} on an unknown card ` +
                  `'${(kw && kw.key) || ""}' (${(kw && kw.mode) || ""}) ` +
                  `from ${src ? gobj_short_name(src) : "?"}`);
    }
    return card;
}

/************************************************************
 *  Edit the match conditions of an OPEN Rows card (its confirm sends
 *  EV_APPLY_MATCH_COND).
 ************************************************************/
function ac_open_card_options(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    open_rows_options(gobj, card.key, card);
    return 0;
}

/************************************************************
 *  Apply new match conditions to an open Rows card.
 ************************************************************/
function ac_apply_match_cond(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    apply_card_match_cond(gobj, card, (kw && kw.match_cond) || {});
    return 0;
}

/************************************************************
 *  Open a card (Rows or Live) for a key of the current topic.
 ************************************************************/
function ac_open_card(gobj, event, kw, src)
{
    add_card(gobj,
        String((kw && kw.key) !== undefined ? kw.key : ""),
        (kw && kw.mode) || "",
        (kw && kw.match_cond) || {},
        !!(kw && kw.restoring));
    return 0;
}

/************************************************************
 *  Close a card. `forget` (default true) also drops it from the
 *  persisted open-views set — a deliberate user close.
 ************************************************************/
function ac_close_card(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    close_card(gobj, card, !kw || kw.forget !== false);
    return 0;
}

/************************************************************
 *  Refresh a Rows card: its iterator is a SNAPSHOT, so it is re-opened
 *  (see rearm_rows_card) rather than re-read.
 ************************************************************/
function ac_refresh_card(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    rearm_rows_card(gobj, card);
    return 0;
}

/************************************************************
 *  Empty a Live card's rolling buffer (the feed stays open).
 ************************************************************/
function ac_clear_card(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    if(card.tabulator) {
        try {
            card.tabulator.clearData();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: destroyed mid-flight: ${e}`);
        }
        update_live_count(card);
    }
    return 0;
}

/************************************************************
 *  A get-page answer did not land within PAGE_TIMEOUT_MS: fail its Promise
 *  so the table shows its error placeholder instead of spinning, and say so
 *  — a silent timeout is indistinguishable from an empty topic.
 ************************************************************/
function ac_page_timeout(gobj, event, kw, src)
{
    let req_id = (kw && kw.req_id) || "";
    let pend = take_pending(gobj, req_id);
    if(!pend) {
        return 0;   /*  the answer landed first: nothing to do  */
    }
    let msg = `${gobj_short_name(gobj)}: get-page '${req_id}' timed out ` +
              `after ${PAGE_TIMEOUT_MS} ms`;
    log_error(msg);
    show_error(gobj, "the backend did not answer in time");
    pend.reject(new Error(msg));
    return 0;
}

/************************************************************
 *  Pause / resume a Live card. The FEED stays open — only the table stops
 *  moving — so nothing is lost: the records that arrive while paused are
 *  held and flushed, oldest first, on resume.
 ************************************************************/
function ac_toggle_pause(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    if(card.mode !== "live") {
        log_error(`${gobj_short_name(gobj)}: only a Live card can pause`);
        return -1;
    }

    card.paused = !card.paused;

    if(!card.paused) {
        let held = card.held;
        card.held = [];
        for(let row of held) {
            push_live_row(card, row);
        }
    }
    update_live_count(card);
    paint_pause_button(card);
    return 0;
}

/***************************************************************
 *  The pause button says what it WILL do (pause / resume) and is colored
 *  while the card is held.
 ***************************************************************/
function paint_pause_button(card)
{
    if(!card.$pause) {
        return;
    }
    let label = card.paused ? t("resume") : t("pause");
    card.$pause.title = label;
    card.$pause.setAttribute("aria-label", label);
    card.$pause.classList.toggle("is-warning", card.paused);
    card.$pause.classList.toggle("is-selected", card.paused);

    let $icon = card.$pause.querySelector("i");
    if($icon) {
        $icon.className = card.paused ? "yi-play" : "yi-pause";
    }
    let $text = card.$pause.querySelector("span:not(.icon)");
    if($text) {
        $text.textContent = label;
        $text.setAttribute("i18n", card.paused ? "resume" : "pause");
    }
}

/************************************************************
 *  Download what the card's table HOLDS as CSV: the loaded page of a Rows
 *  card, the rolling buffer of a Live one. Not the key — that is a
 *  server-side dump this SPA cannot stream.
 ************************************************************/
function ac_export_card(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    if(!card.tabulator) {
        log_error(`${gobj_short_name(gobj)}: no table to export ` +
                  `('${card.key}', ${card.mode})`);
        return -1;
    }

    let key = card.key === ALL_KEYS ? "all-keys" : card.key;
    let name = `${priv.cur_topic}-${key}-${card.mode}.csv`
        .replace(/[^\w.\-]+/g, "_");
    try {
        /*  Tabulator writes the VISIBLE columns of the loaded rows, header
         *  filters applied — which is exactly what the user is looking at.  */
        card.tabulator.download("csv", name);
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: CSV export failed: ${e}`);
        show_error(gobj, "export failed");
        return -1;
    }
    return 0;
}

/************************************************************
 *  Copy the record shown in the dialog to the clipboard, as the JSON the
 *  dialog is showing.
 ************************************************************/
function ac_copy_record(gobj, event, kw, src)
{
    return copy_to_clipboard(gobj, (kw && kw.text) || "");
}

/************************************************************
 *  The column chooser of a card: one checkbox per column, checked when the
 *  column is shown. It is the only way back from the mobile hiding — and it
 *  hands the choice of what matters to the person reading the record, which
 *  is where it belongs.
 ************************************************************/
function ac_open_columns(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    let shell = yui_shell_of(gobj);
    if(!shell || !card.tabulator) {
        log_error(`${gobj_short_name(gobj)}: no shell or no table, ` +
                  `cannot choose columns`);
        return -1;
    }

    let cols = [];
    try {
        cols = card.tabulator.getColumns();
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: cannot read the columns: ${e}`);
        return -1;
    }

    let $list = createElement2(
        ["div", {class: "TRANGER_COLUMNS_LIST",
                 style: "min-width:min(80vw, 260px); max-height:60vh; overflow:auto;"}, []]);

    for(let col of cols) {
        let field = col.getField();
        if(!field || field === "__rec") {
            continue;
        }
        let $cb = createElement2(["input", {type: "checkbox"}]);
        $cb.checked = col.isVisible();
        $cb.addEventListener("change", () => {
            gobj_send_event(gobj, "EV_TOGGLE_COLUMN",
                {key: card.key, mode: card.mode,
                 field: field, visible: $cb.checked}, gobj);
        });
        $list.appendChild(createElement2(
            ["label", {class: "checkbox is-block mb-1 TRANGER_COLUMN_ITEM"},
                [$cb, ["span", {class: "ml-2"}, field]]]));
    }

    yui_shell_show_modal(shell, $list, {
        dialog: true,
        logical_class: "TRANGER_COLUMNS_DIALOG",
        title: t("columns"),
        t: t
    });
    return 0;
}

/************************************************************
 *  Show / hide one column of a card.
 ************************************************************/
function ac_toggle_column(gobj, event, kw, src)
{
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }
    let field = (kw && kw.field) || "";
    if(!field || !card.tabulator) {
        log_error(`${gobj_short_name(gobj)}: no column '${field}' to toggle`);
        return -1;
    }
    try {
        if(kw.visible) {
            card.tabulator.showColumn(field);
        } else {
            card.tabulator.hideColumn(field);
        }
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: cannot toggle column '${field}': ${e}`);
        return -1;
    }
    return 0;
}

/************************************************************
 *  Share a card: put the URL that REBUILDS it on the clipboard.
 *
 *  The link carries the topic, the key, the mode and the match conditions,
 *  so "look at key X between A and B" is one link instead of a paragraph of
 *  instructions. It navigates first — the shared URL becomes the one in the
 *  address bar, so what you send is what you are looking at — and the
 *  browser's own location is then the single source of the text copied.
 ************************************************************/
function ac_share_card(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let card = card_of_event(gobj, event, kw, src);
    if(!card) {
        return -1;      /*  Error already logged  */
    }

    priv.$copy_btn = card.$share;
    gobj_publish_event(gobj, "EV_TOPIC_SELECTED",
        {topic: encode_seg(priv.cur_topic, card)});

    return copy_to_clipboard(gobj, window.location.href);
}

/***************************************************************
 *  Put `text` on the clipboard, and turn the settled promise into an
 *  event (a resolved promise is an OS notification like any other; the
 *  feedback belongs in the action).
 ***************************************************************/
function copy_to_clipboard(gobj, text)
{
    if(!text) {
        log_error(`${gobj_short_name(gobj)}: nothing to copy`);
        return -1;
    }
    if(!navigator.clipboard || !navigator.clipboard.writeText) {
        /*  Non-secure origin (plain http): the API is not there at all.  */
        log_error(`${gobj_short_name(gobj)}: no clipboard API ` +
                  `(is this a secure origin?)`);
        show_error(gobj, "the browser did not allow the copy");
        return -1;
    }
    navigator.clipboard.writeText(text).then(function() {
        gobj_send_event(gobj, "EV_COPY_DONE", {ok: true}, gobj);
    }).catch(function(e) {
        log_error(`${gobj_short_name(gobj)}: clipboard write failed: ${e}`);
        gobj_send_event(gobj, "EV_COPY_DONE", {ok: false}, gobj);
    });
    return 0;
}

/************************************************************
 *  The clipboard write settled: tell the user, on the button itself.
 ************************************************************/
function ac_copy_done(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let ok = !!(kw && kw.ok);
    let $btn = priv.$copy_btn;
    if(!$btn) {
        return 0;
    }
    let $text = $btn.querySelector("span:not(.icon)");
    if($text) {
        priv.copy_label = $text.textContent;
        $text.textContent = ok ? t("copied") : t("copy failed");
    }
    $btn.classList.toggle("is-success", ok);
    $btn.classList.toggle("is-danger", !ok);

    /*  A button stuck on "Copied" forever reads as a mode, not as feedback.  */
    setTimeout(function() {
        gobj_send_event(gobj, "EV_COPY_RESET", {}, gobj);
    }, COPY_FEEDBACK_MS);
    return 0;
}

/************************************************************
 *  The copy feedback has been read: put the button back as it was.
 ************************************************************/
function ac_copy_reset(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let $btn = priv.$copy_btn;
    priv.$copy_btn = null;
    if(!$btn || !$btn.isConnected) {
        return 0;   /*  its dialog / card is gone  */
    }
    let $text = $btn.querySelector("span:not(.icon)");
    if($text && priv.copy_label) {
        $text.textContent = priv.copy_label;
    }
    $btn.classList.remove("is-success", "is-danger");
    return 0;
}

/************************************************************
 *  A row was clicked: show the full record as JSON.
 ************************************************************/
function ac_show_record(gobj, event, kw, src)
{
    show_record_dialog(gobj, kw ? kw.record : null, (kw && kw.key) || "");
    return 0;
}

/************************************************************
 *  Re-open a Rows card's iterator (new id, same match conditions) and
 *  re-fetch its page. Also what Refresh does: an iterator is a SNAPSHOT
 *  (its row index is built when it is opened), so appends made since are
 *  invisible to it — re-asking for the page would return the same rows
 *  and the same total, and Last would never reach the new records.
 ************************************************************/
function rearm_rows_card(gobj, card)
{
    /*  Drop the previous iterator: on a Refresh it is alive and would linger
     *  on the backend; after a reconnect it is already gone and the close is
     *  a harmless no-op there.  */
    close_iterator(gobj, card.iterator_id);

    if(!arm_iterator(gobj, card)) {
        return;     /*  Error already logged  */
    }
    if(card.tabulator) {
        try {
            card.tabulator.replaceData();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: destroyed mid-flight: ${e}`);
        }
    }
}

/************************************************************
 *  Re-open a Live card's realtime feed (new id). The rolling buffer is
 *  kept: those records were real, only the feed died.
 ************************************************************/
function rearm_live_card(gobj, card)
{
    let priv = gobj.priv;
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot re-arm the Live card of '${card.topic}'`);
        return;
    }

    close_rt(gobj, card.rt_id);      /*  no-op if the session already died  */

    card.rt_id = `spa-${priv.tok}-rt-${++priv.iter_seq}`;

    gobj_command(remote, "open-rt",
        {
            service:    gobj_read_str_attr(gobj, "treedb_name"),
            rt_id:      card.rt_id,
            topic_name: card.topic,
            key:        card.key
        }, gobj);
}

/************************************************************
 *  Parent (routing) informs the segment to restore: href's right part
 *  after '?' (same contract as C_YUI_TREEDB_TOPICS).
 *
 *  The segment is the topic, and OPTIONALLY the card a shared link carries
 *  (key + mode + match conditions). The card can only be opened once the
 *  topic's keys are known, so it waits in `pending_card`.
 ************************************************************/
function ac_show(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let href = (kw && kw.href) || "";
    let i = href.indexOf("?");
    let seg = i >= 0 ? href.slice(i + 1) : "";
    if(!seg) {
        return 0;
    }

    let parsed = decode_seg(seg);
    if(!parsed.topic) {
        log_error(`${gobj_short_name(gobj)}: link with no topic: '${seg}'`);
        return -1;
    }
    priv.pending_card = parsed.card;

    if(priv.topics) {
        gobj_send_event(gobj, "EV_SELECT_TOPIC", {topic: parsed.topic}, gobj);
    } else {
        /*  Topics not loaded yet (ST_DISCONNECTED / ST_LOADING_TOPICS): the
         *  `topics` answer picks it up.  */
        priv.pending_seg = parsed.topic;
    }
    return 0;
}

/************************************************************
 *  A remote realtime record arrived (subscribed by a Live card): route
 *  it to the matching live card(s) — newest on top.
 ************************************************************/
function ac_tranger_record_added(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let topic = (kw && kw.topic_name) || "";
    let key = (kw && kw.key) || "";
    let rt_id = (kw && kw.rt_id) || "";
    let record = kw ? kw.record : null;
    if(!record) {
        return 0;
    }

    /*  The backend runs the publish callback once per OPEN FEED, so a record
     *  arrives once per feed alive on that key — including feeds leaked by a
     *  session that died without close-rt. `rt_id` says which feed produced
     *  it: route it to THAT card and nothing else, so a foreign feed cannot
     *  duplicate our rows. Backends older than the rt_id field send none:
     *  fall back to topic+key (and to their duplicates).  */
    for(let card of priv.cards) {
        if(card.mode !== "live") {
            continue;
        }
        if(rt_id) {
            if(card.rt_id === rt_id) {
                push_live_record(card, record, key);
            }
            continue;
        }
        /*  A whole-topic card takes every key of its topic (that is what its
         *  feed was opened on).  */
        if(card.topic === topic && (card.key === ALL_KEYS || card.key === key)) {
            push_live_record(card, record, key);
        }
    }

    if(topic === priv.cur_topic) {
        bump_key_count(gobj, key);
    }
    return 0;
}

/************************************************************
 *  A live append means one more record on its key: keep the Keys
 *  picker's count in step instead of leaving the `list-keys` snapshot
 *  frozen until the picker is reopened. Only keys with an open Live
 *  card produce these events — the rest are refreshed on open.
 ************************************************************/
function bump_key_count(gobj, key)
{
    let priv = gobj.priv;
    let entry = (priv.keys || []).find((k) => String(k.key) === String(key));
    if(!entry) {
        return;
    }
    entry.records = (parseInt(entry.records, 10) || 0) + 1;

    if(!priv.picker_tbl) {
        return;
    }
    try {
        priv.picker_tbl.updateData([{key: entry.key, records: entry.records}]);
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table gone: ${e}`);
    }
}




                    /***************************
                     *              FSM
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
     *  The transport events (EV_MT_COMMAND_ANSWER, EV_TRANGER_RECORD_ADDED,
     *  EV_ON_OPEN) and the routing ones (EV_SHOW) are declared in EVERY state:
     *  they are driven by the backend / the host, not by the user, and they
     *  can legitimately land at any moment — a live record still in flight
     *  when a topic switch closed its card is a benign race, not a bug worth
     *  an error. EV_PAGE_TIMEOUT is one of them: its watchdog was armed in a
     *  state the view may well have left by the time it fires. The USER
     *  actions are declared ONLY in ST_TOPIC_SELECTED: with no topic there is
     *  nothing to open, so they must fail loudly.
     */
    const states = [
        ["ST_DISCONNECTED", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_PAGE_TIMEOUT",         ac_page_timeout,          null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_SHOW",                 ac_show,                  null]
        ]],
        ["ST_LOADING_TOPICS", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_PAGE_TIMEOUT",         ac_page_timeout,          null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_SHOW",                 ac_show,                  null],
            ["EV_SELECT_TOPIC",         ac_select_topic,          null]
        ]],
        ["ST_TOPIC_SELECTED", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_PAGE_TIMEOUT",         ac_page_timeout,          null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_SHOW",                 ac_show,                  null],
            ["EV_SELECT_TOPIC",         ac_select_topic,          null],
            /*  user actions  */
            ["EV_OPEN_KEYS",            ac_open_keys,             null],
            ["EV_PICKER_CLOSED",        ac_picker_closed,         null],
            ["EV_OPEN_OPTIONS",         ac_open_options,          null],
            ["EV_OPEN_CARD_OPTIONS",    ac_open_card_options,     null],
            ["EV_APPLY_MATCH_COND",     ac_apply_match_cond,      null],
            ["EV_OPEN_CARD",            ac_open_card,             null],
            ["EV_CLOSE_CARD",           ac_close_card,            null],
            ["EV_REFRESH_CARD",         ac_refresh_card,          null],
            ["EV_CLEAR_CARD",           ac_clear_card,            null],
            ["EV_TOGGLE_PAUSE",         ac_toggle_pause,          null],
            ["EV_EXPORT_CARD",          ac_export_card,           null],
            ["EV_SHOW_RECORD",          ac_show_record,           null],
            ["EV_COPY_RECORD",          ac_copy_record,           null],
            ["EV_SHARE_CARD",           ac_share_card,            null],
            ["EV_OPEN_COLUMNS",         ac_open_columns,          null],
            ["EV_TOGGLE_COLUMN",        ac_toggle_column,         null],
            ["EV_COPY_DONE",            ac_copy_done,             null],
            ["EV_COPY_RESET",           ac_copy_reset,            null]
        ]]
    ];

    const event_types = [
        ["EV_MT_COMMAND_ANSWER",    event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_TRANGER_RECORD_ADDED", event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_PAGE_TIMEOUT",         0],
        ["EV_ON_OPEN",              0],
        ["EV_TOPIC_SELECTED",       event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_SHOW",                 0],
        ["EV_SELECT_TOPIC",         0],
        ["EV_OPEN_KEYS",            0],
        ["EV_PICKER_CLOSED",        0],
        ["EV_OPEN_OPTIONS",         0],
        ["EV_OPEN_CARD_OPTIONS",    0],
        ["EV_APPLY_MATCH_COND",     0],
        ["EV_OPEN_CARD",            0],
        ["EV_CLOSE_CARD",           0],
        ["EV_REFRESH_CARD",         0],
        ["EV_CLEAR_CARD",           0],
        ["EV_TOGGLE_PAUSE",         0],
        ["EV_EXPORT_CARD",          0],
        ["EV_SHOW_RECORD",          0],
        ["EV_COPY_RECORD",          0],
        ["EV_SHARE_CARD",           0],
        ["EV_OPEN_COLUMNS",         0],
        ["EV_TOGGLE_COLUMN",        0],
        ["EV_COPY_DONE",            0],
        ["EV_COPY_RESET",           0]
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

function register_c_tranger_view()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_tranger_view};
