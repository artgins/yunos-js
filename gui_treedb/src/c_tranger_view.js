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
    gobj_create_service, gobj_create_pure_child, gobj_find_service,
    gobj_start, gobj_stop, gobj_destroy, is_gobj,
    gobj_read_integer_attr,
    createElement2, refresh_language,
    msg_iev_get_stack,
    kw_get_str, kw_get_dict,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {yui_shell_show_modal, yui_shell_popup_layer} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {epoch_to_ms, infer_period} from "@yuneta/gobj-ui/src/yui_time.js";

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
    fmt_ts,
    flatten_record,
    op_filter,
    encode_seg,
    decode_seg,
    parse_keys_answer,
    parse_records_page,
    spans_from_rows,
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

/*  The granularities the Rows options offer per axis, handed to C_YUI_PERIOD
 *  (gobj-ui): a bucket is (unit, count), so this list is the whole
 *  configuration — the arrows, the labels and the calendar come with it.
 *
 *  These five are what a LOG is read with, and the set is deliberately SHORT:
 *  a strip the eye takes in at once beats one that holds every bucket the
 *  library can build. The rest of the catalog (quarter, semester, bimester,
 *  decade, 15min…) is one line away for the app that reports by quarter —
 *  this one does not.
 *
 *  No ROLLING windows here ("last 24h", "last 7 days"): in THIS use case they
 *  are redundant — "day" and "week" already answer the question, and a rolling
 *  window is not a bucket (it leaves the upper bound open, so a card re-filtered
 *  from one restores as "custom"). The picker still offers them to an app that
 *  wants them; this one does not.
 *
 *  Two more modes come from the picker itself: "All" (no bounds: the full
 *  key) and "Custom" (the two datetime-local inputs, for the range no bucket
 *  has — an incident between 18:03 and 18:07).  */
const PERIOD_MODES = ["hour", "day", "week", "month", "year"];

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
/*  The chrome of the view — the topic tabs, the toolbar, the error banner —
    must NEVER shrink: the only thing that gives is the dashboard, which has
    its own scroll. A flex item defaults to flex-shrink:1, so with cards in the
    dashboard the browser stole height from the tabs too (42px -> 22px): the
    active tab rose ~10px and, because Bulma's .tabs is overflow:hidden, its top
    border was CLIPPED. flex:0 0 auto is the fix, and min-height:0 on the
    dashboard (above) is what lets it absorb every pixel instead.  */
.C_TRANGER_VIEW .TRANGER_TOPICS,
.C_TRANGER_VIEW .TRANGER_TOOLBAR,
.C_TRANGER_VIEW .TRANGER_ERROR {
    flex: 0 0 auto;
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
    /*  A phone cannot fit the title AND six icon buttons on one line: the head
        WRAPS instead of running off the card. row-gap keeps the two lines apart
        when it does; on a desktop there is only ever one line and nothing here
        changes.  */
    flex-wrap: wrap;
    row-gap: 0.4rem;
}
/*  The actions travel as ONE block (so they wrap together, not one button at a
    time) and stay right-aligned — margin-left:auto does what the old flex:1
    spacer did, and keeps doing it when the block is alone on the second line.  */
.C_TRANGER_VIEW .TRANGER_CARD_ACTIONS {
    margin-left: auto;
    flex-wrap: wrap;
    justify-content: flex-end;
}
/*  The title is what gives: it ellipsizes instead of pushing the actions out
    (min-width:0 is what lets a flex item shrink below its content).  */
.C_TRANGER_VIEW .TRANGER_CARD_TITLE {
    min-width: 0;
}
/*  On a phone the actions land on their own line, and there they must fit in
    ONE: with the desktop gutters the sixth button (the ✕) fell to a third line
    on its own. Tighter horizontal padding and gaps — the button KEEPS its
    height, so the touch target stays ~40px, which is the point of the icon-only
    mobile buttons in the first place.  */
@media (max-width: 768px) {
    .C_TRANGER_VIEW .TRANGER_CARD_ACTIONS > span {
        margin-left: 0.25rem !important;
    }
    .C_TRANGER_VIEW .TRANGER_CARD_ACTIONS .button {
        padding-left: 0.55em;
        padding-right: 0.55em;
    }
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
/*  The toolbar's "Live topic" button toggles the whole-topic card and says
    so with the same language: colourless dot while it is closed, green while
    it is open. The BUTTON is not recoloured — it is a toolbar button, not a
    row action, and the dot is the state.  */
.TRANGER_LIVE_TOPIC_BTN .TRANGER_LIVE_DOT {
    background: currentColor; opacity: 0.4;
}
.TRANGER_LIVE_TOPIC_BTN.is-live .TRANGER_LIVE_DOT {
    background: #48c774; opacity: 1;
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
    bumped:      null,   /*  key -> last rowid counted by bump_key_count: one
                             physical append is DELIVERED once per feed alive
                             on its key, and the count must move once  */
    pending:     null,   /*  req_id -> {resolve, reject} (get-page Promise bridge)  */
    picker_win:  null,   /*  C_YUI_WINDOW hosting the Keys picker, desktop (or null)  */
    picker_modal: null,  /*  shell modal hosting the Keys picker, mobile (or null)  */
    picker_box:  null,   /*  the mobile sheet's content (its composed title is
                             re-written on a language switch)  */
    json_gobj:   null,   /*  C_YUI_JSON viewer of the raw tranger (or null)  */
    json_win:    null,   /*  C_YUI_WINDOW hosting it, desktop (or null)  */
    json_modal:  null,   /*  shell modal hosting it, mobile (or null)  */
    open_modals: null,   /*  transient modals (rows options / record / columns):
                             swept when the session dies, retitled on language  */
    error_key:   "",     /*  last show_error() key, re-rendered on language  */
    picker_tbl:  null,   /*  the picker's Tabulator (or null)  */
    rows_options: null,  /*  the Rows-options form while its dialog is up:
                             {$box, inputs, ranges, $open}. `ranges` holds the
                             two C_YUI_PERIOD pure children (t / tm), which die
                             with the dialog  */
    $tabs:       null,
    $live_btn:   null,   /*  toolbar "Live topic" toggle (its dot = card open)  */
    $meta:       null,
    $error:      null,
    $dashboard:  null,   /*  cards column  */
    $copy_btn:   null,   /*  button awaiting clipboard feedback (or null)  */
    copy_fb:     null,   /*  feedback being shown: {$btn, label} to restore  */
    copy_timer:  null,   /*  its reset timer (cleared if another copy lands)  */
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
    priv.bumped = {};
    priv.open_modals = [];
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
    /*  BOTH edges of the link, not only the rising one: watching EV_ON_OPEN
     *  alone left the view sitting in ST_TOPIC_SELECTED after the session died,
     *  with a toolbar that still looked alive — the Keys button then built its
     *  picker against a dead session and Tabulator painted a "Data Load Error"
     *  over the honest "no session" log. A dropped link is a STATE, and
     *  EV_ON_CLOSE is what says so.  */
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
    }

    /*  The SHELL publishes the language switch (yui_shell_language_changed):
     *  one contract for every view it mounts, ours and the library's.  */
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    /*  Mounted with no session (link still down): stay in ST_DISCONNECTED and
     *  let EV_ON_OPEN ask for the topics. Before the FSM this path just logged
     *  "no session" and NOTHING ever retried — the view stayed empty for the
     *  rest of its life.  */
    if(!live_transport(gobj)) {
        set_toolbar_enabled(gobj, false);
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
        gobj_unsubscribe_event(links, "EV_ON_CLOSE", {}, gobj);
    }
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
    reject_pending(gobj, "view stopped");
    close_all_cards(gobj);
    close_picker(gobj);
    close_json_viewer(gobj);
    close_view_modals(gobj);
    close_rows_options(gobj);   /*  belt: idempotent if the sweep ran it  */

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
                    title: t("keys"), "aria-label": t("keys"),
                    "data-i18n-title": "keys", "data-i18n-aria-label": "keys"},
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
     *  created as the data arrives.
     *
     *  The label is shown on a PHONE too (no is-hidden-mobile): this is the
     *  one button of the toolbar whose use is not guessable from its icon —
     *  a bare dot says nothing — and it is exactly what a mobile user wants
     *  to reach. It TOGGLES, like the picker's per-key Live buttons: the dot
     *  is green while the card is open and colourless while it is not, so
     *  the button says whether you are following the topic right now.  */
    let $live_btn = createElement2(
        ["button", {class: "button ml-2 TRANGER_LIVE_TOPIC_BTN",
                    title: t("live on the whole topic"),
                    "aria-label": t("live on the whole topic")},
            [
                ["span", {class: "TRANGER_LIVE_DOT mr-2"}, ""],
                ["span", {i18n: "live topic"}, t("live topic")]
            ]
        ]);
    $live_btn.addEventListener("click", () => {
        let open = !!find_card(gobj, ALL_KEYS, "live");
        gobj_send_event(gobj, open ? "EV_CLOSE_CARD" : "EV_OPEN_CARD",
            {key: ALL_KEYS, mode: "live"}, gobj);
    });
    priv.$live_btn = $live_btn;

    /*  Inspect the service's raw tranger json in a lazy tree viewer
     *  (print-tranger). A whole tranger can be huge, so the viewer drills
     *  in on demand — see open_json_viewer / EV_EXPAND_PATH.  */
    let $json_btn = createElement2(
        ["button", {class: "button ml-2 TRANGER_JSON_BTN",
                    title: t("raw json"), "aria-label": t("raw json"),
                    "data-i18n-title": "raw json", "data-i18n-aria-label": "raw json"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-eye"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "raw json"}, t("raw json")]
            ]
        ]);
    $json_btn.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_OPEN_JSON", {}, gobj);
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
                    [$keys_btn, $live_btn, $json_btn, $meta]],
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
    priv.error_key = msg || "";     /*  re-rendered on a language switch  */
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
 *  Every transient modal of the view (Rows options, record, columns)
 *  goes through here, for two reasons a bare yui_shell_show_modal cannot
 *  cover:
 *    - a dead session must SWEEP them (close_view_modals): a dialog that
 *      survives its transport keeps sending events into ST_DISCONNECTED,
 *      where its events are (rightly) not declared — every click a loud
 *      "Event NOT DEFINED in state" on a corpse.
 *    - a composed title (`${key} · ${t("rows")}`) cannot re-translate by
 *      data-i18n (the composed string is no key): `title_fn` re-composes
 *      it on EV_LANGUAGE_CHANGED.
 ***************************************************************/
function show_view_modal(gobj, shell, $content, opts)
{
    let priv = gobj.priv;
    if(opts.title_fn) {
        opts.title = opts.title_fn();
    }
    let caller_on_close = opts.on_close;
    let entry = {modal: null, $content: $content, title_fn: opts.title_fn || null};
    opts.on_close = () => {
        let idx = priv.open_modals.indexOf(entry);
        if(idx >= 0) {
            priv.open_modals.splice(idx, 1);
        }
        if(caller_on_close) {
            caller_on_close();
        }
    };
    entry.modal = yui_shell_show_modal(shell, $content, opts);
    priv.open_modals.push(entry);
    return entry.modal;
}

function close_view_modals(gobj)
{
    let priv = gobj.priv;
    let entries = (priv.open_modals || []).slice();
    priv.open_modals = [];
    for(let entry of entries) {
        if(entry.modal && typeof entry.modal.close === "function") {
            entry.modal.close();
        }
    }
}

/***************************************************************
 *  Re-compose the composed titles a language switch cannot reach by
 *  attribute: the open transient modals' (title_fn) and the mobile Keys
 *  sheet's. The title node carries the composed string as its data-i18n
 *  too, so the shell's document-wide refresh maps it to itself instead
 *  of "translating" it away.
 ***************************************************************/
function retitle_modal($content, title)
{
    let $modal = $content && $content.closest ? $content.closest(".modal") : null;
    let $title = $modal ? $modal.querySelector(".MODAL_TITLE") : null;
    if(!$title) {
        return;
    }
    $title.textContent = title;
    $title.setAttribute("data-i18n", title);
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
 *  The toolbar follows the SESSION: with no link there is nothing to ask
 *  and nothing to browse, so its buttons are disabled — the same answer
 *  the connection picker gives (a disabled checkbox), and the reason the
 *  cursor says "not allowed" instead of the view failing on the click.
 *
 *  Not cosmetic: in ST_DISCONNECTED the FSM does not declare the user
 *  actions at all (by design — no session, nothing to open), so a click
 *  that got through would be a loud "Event NOT DEFINED in state" for what
 *  is a perfectly legitimate thing for a user to try.
 ***************************************************************/
function set_toolbar_enabled(gobj, enabled)
{
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    for(let $btn of $c.querySelectorAll(
            ".TRANGER_KEYS_BTN, .TRANGER_LIVE_TOPIC_BTN, .TRANGER_JSON_BTN")) {
        $btn.disabled = !enabled;
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
    set_toolbar_enabled(gobj, true);

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
 *  The Keys picker's columns. A function, not a literal, because its
 *  headers are OURS (t() at build time): a language switch hands the table
 *  a fresh set (see ac_language_changed) — a Tabulator header cannot be
 *  re-translated in place.
 *
 *  Compact widths on a phone: fitColumns cannot shrink a column below its
 *  minWidth/width, so the desktop set (150+110+160) overflows a ~300px sheet
 *  and Tabulator adds a horizontal scrollbar — two-axis scrolling inside a
 *  modal. The action buttons go icon-only there (their labels are
 *  is-hidden-mobile), hence the narrower column.
 ***************************************************************/
function picker_columns(gobj, mobile)
{
    return [
        {title: t("key"), field: "key", minWidth: mobile ? 100 : 150,
            headerFilter: "input"},
        {title: t("records"), field: "records", width: mobile ? 70 : 110,
            hozAlign: "right"},
        {title: t("actions"), field: "_act", headerSort: false,
            width: mobile ? 96 : 160,
            formatter: (cell) => build_key_actions(gobj, cell)}
    ];
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
        priv.picker_box = $box;
        priv.picker_modal = yui_shell_show_modal(shell, $box, {
            dialog: true,
            logical_class: "TRANGER_KEYS_SHEET",
            title_prefix: priv.cur_topic,
            title:  "keys",
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
                title_prefix: priv.cur_topic,
                title:      "keys",
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
        gobj_start(priv.picker_win);
    }

    /*  The host (window body / modal sheet) is mounted synchronously, so
     *  the Tabulator can build against a live element right away.  */
    /*  Remote everything — pagination, sort AND filter. The picker used to be
     *  handed every key of the topic and do all three in the browser; a topic
     *  with a hundred thousand keys made that a transfer of the whole index and
     *  a sort of it on the main thread. The backend does it (list-keys with
     *  rkey / order / desc / from / limit) and the browser holds one page.  */
    let picker = new Tabulator($tbl, {
        ...yui_tabulator_lang(t),   /*  Tabulator's own chrome (paginator) too  */
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
        columns: picker_columns(gobj, mobile)
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
 *  Raw-tranger JSON viewer: a C_YUI_JSON driving its own DOM, hosted in a
 *  moveable C_YUI_WINDOW on desktop / an adaptive modal sheet on mobile
 *  (same presentation split as the Keys picker). It is a helper of THIS
 *  view (CHILD model: it publishes EV_EXPAND_PATH back to us), single at a
 *  time, and it is whole-service (topic-independent), so a topic switch
 *  leaves it up — only a teardown / lost session closes it.
 *
 *  A tranger can be enormous, so the first fetch is collapsed
 *  (print-tranger with lists/dicts limits) and the viewer drills in on
 *  demand: EV_EXPAND_PATH -> print-tranger path=<path> -> EV_SUBTREE_LOADED.
 ***************************************************************/
function open_json_viewer(gobj)
{
    let priv = gobj.priv;
    if(priv.json_win || priv.json_modal) {
        return;     /*  already open  */
    }

    let mobile = is_mobile();
    let shell = yui_shell_of(gobj);
    let service = gobj_read_str_attr(gobj, "treedb_name");

    let jv = gobj_create_service(
        `tranger-json-${priv.tok}`,
        "C_YUI_JSON",
        {
            /*  No `title`: the host titles it — the window's title bar on
             *  desktop, the dialog's header on mobile. The viewer's own
             *  title would land INSIDE that host, doubling it.  */
            subscriber: gobj        /*  publishes EV_EXPAND_PATH to us  */
        },
        gobj
    );
    if(!jv) {
        log_error(`${gobj_short_name(gobj)}: cannot create the JSON viewer`);
        return;
    }
    priv.json_gobj = jv;
    gobj_start(jv);
    let $box = gobj_read_pointer_attr(jv, "$container");

    if(mobile) {
        if(!shell) {
            log_error(`${gobj_short_name(gobj)}: no shell, cannot open the JSON sheet`);
            close_json_viewer(gobj);
            return;
        }
        priv.json_modal = yui_shell_show_modal(shell, $box, {
            dialog:        true,
            logical_class: "TRANGER_JSON_SHEET",
            title_prefix: service,
            title:         "raw json",
            t:             t,
            on_close: () => {
                if(gobj_is_destroying(gobj)) {
                    return;
                }
                gobj_send_event(gobj, "EV_JSON_CLOSED", {}, gobj);
            }
        });
    } else {
        let $win_parent = (shell && yui_shell_popup_layer(shell)) ||
            (typeof document !== "undefined" && document.getElementById("top-layer")) ||
            null;

        priv.json_win = gobj_create_service(
            `tranger-jsonwin-${priv.tok}`,
            "C_YUI_WINDOW",
            {
                $parent:    $win_parent,
                subscriber: null,
                modal:      false,
                showMax:    true,
                showFooter: false,
                resizable:  true,
                center:     true,
                auto_save_size_and_position: true,
                width:      640,
                height:     620,
                logical_class: "TRANGER_JSON_WINDOW",
                title_prefix: service,
                title:      "raw json",
                icon:       "yi-eye",
                body:       $box,
                manager:    null,
                on_close: () => {
                    if(gobj_is_destroying(gobj)) {
                        return;
                    }
                    gobj_send_event(gobj, "EV_JSON_CLOSED", {}, gobj);
                }
            },
            gobj
        );
        if(!priv.json_win) {
            log_error(`${gobj_short_name(gobj)}: cannot create the JSON window`);
            close_json_viewer(gobj);
            return;
        }
        gobj_start(priv.json_win);
    }

    request_print_tranger(gobj, "");    /*  first fetch: whole tranger, collapsed  */
}

/***************************************************************
 *  Close the JSON viewer (user dismiss / topic teardown / stop). Destroys
 *  the viewer gobj and whichever presenter is up, then clears the refs.
 ***************************************************************/
function close_json_viewer(gobj)
{
    let priv = gobj.priv;
    let jv = priv.json_gobj;
    let win = priv.json_win;
    let modal = priv.json_modal;

    priv.json_gobj = null;
    priv.json_win = null;
    priv.json_modal = null;

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
    if(jv && is_gobj(jv)) {
        try {
            /*  STOP, then destroy — the viewer was STARTED in open_json_viewer.
             *  gobj_destroy() raises the `destroying` flag before it can stop a
             *  running gobj, so destroying it straight logs "Destroying a
             *  RUNNING gobj" + "gobj NULL or DESTROYED" and skips its mt_stop. */
            gobj_stop(jv);
            gobj_destroy(jv);
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
    }
}

/***************************************************************
 *  Fetch the raw tranger (or one subtree, when `path` is set) as bounded,
 *  drillable JSON. Collapsed at 100 so a huge tranger stays a small
 *  payload full of `__collapsed__` stubs the viewer expands on demand.
 ***************************************************************/
function request_print_tranger(gobj, path)
{
    let priv = gobj.priv;
    let remote = live_transport(gobj);
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: no session, cannot print-tranger`);
        let jv = priv.json_gobj;
        if(path && jv && is_gobj(jv) && !gobj_is_destroying(jv)) {
            gobj_send_event(jv, "EV_SUBTREE_ERROR",
                {path: path, error: t("no session")}, gobj);
        }
        return;
    }
    gobj_command(remote, "print-tranger",
        {
            service:     gobj_read_str_attr(gobj, "treedb_name"),
            expanded:    1,
            lists_limit: 100,
            dicts_limit: 100,
            path:        path || ""
        }, gobj);
}

/***************************************************************
 *  The toolbar's "Live topic" button reflects the whole-topic Live card:
 *  its dot is GREEN while that card is open and colourless while it is
 *  not, and its title says what a click will do (it toggles).
 ***************************************************************/
function paint_live_topic_btn(gobj)
{
    let priv = gobj.priv;
    let $btn = priv.$live_btn;
    if(!$btn) {
        return;
    }
    let open = !!find_card(gobj, ALL_KEYS, "live");
    $btn.classList.toggle("is-live", open);

    let label = open ? t("stop following the topic") : t("live on the whole topic");
    $btn.title = label;
    $btn.setAttribute("aria-label", label);
}

/***************************************************************
 *  Re-run the picker's per-row action formatters so the Rows/Live buttons
 *  reflect the current open-card set (called after a card opens/closes).
 ***************************************************************/
function refresh_picker_actions(gobj)
{
    let priv = gobj.priv;
    paint_live_topic_btn(gobj);     /*  same trigger: the open-card set changed  */
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
    priv.key_spans = Object.assign(priv.key_spans || {}, spans_from_rows(rows));
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
 *  The mode the picker must OPEN on, for a range that already exists
 *  (a card being re-filtered, a shared link, a restored view).
 *
 *  A match_cond carries numbers, not intentions: the two bounds of "week
 *  27" are indistinguishable from any other pair. So we ASK the algebra —
 *  a range whose ends land exactly on a bucket's boundaries IS that
 *  bucket, and comes back as it. Everything else was typed by hand and
 *  opens in "custom", where the user left it.
 *
 *  A range that is no bucket — typed by hand, or half-open — restores as
 *  "custom": no granularity lit, the arrows dead, and the two inputs
 *  carrying exactly what was queried. Lighting a granularity that does not
 *  match would claim the user asked for something else.
 ***************************************************************/
function restore_period_mode(from_val, to_val, ms)
{
    if(!from_val && !to_val) {
        return {mode: "span", anchor: Date.now()};
    }

    let from_ms = epoch_to_ms(from_val, ms);
    let to_ms = epoch_to_ms(to_val, ms);

    if(from_ms && to_ms) {
        /*  Only among the modes the control OFFERS: recognizing a range as a
         *  quarter the strip does not carry would name a mode that is not
         *  there. Compared in the TOPIC's unit — a seconds topic stored the
         *  bucket's end truncated, and a millisecond comparison never matched
         *  it (every saved week came back as a hand-typed range).  */
        let got = infer_period(from_val, to_val, PERIOD_MODES, ms);
        if(got) {
            return {mode: got.period.id, anchor: got.anchor};
        }
    }
    return {mode: "custom", anchor: from_ms || Date.now()};
}

/***************************************************************
 *  One time-range block of the modal: a C_YUI_PERIOD navigator, whose
 *  "custom" mode reveals the two datetime-local inputs this view has
 *  always had (bounded to what the key actually holds).
 *
 *  `axis` is "t" (persistence) or "tm" (message origin) — they are two
 *  independent match conditions and the iterator ANDs them, so each gets
 *  its own picker instead of a selector that would let the user express
 *  only one of the two. The picker is a PURE CHILD of the view (created
 *  with the dialog, destroyed with it — pure children are not auto-started,
 *  so it is started here), and it publishes EV_PERIOD_CHANGED back into
 *  this FSM.
 *
 *  Returns {$block, gobj, $from, $to, $resolved, ms}.
 ***************************************************************/
function build_time_block(gobj, match_cond, span, units)
{
    let mc = match_cond || {};

    /*  ONE axis, chosen. A record carries two timestamps and the iterator
     *  would happily AND both ranges, but nobody asks "stored last week AND
     *  reported in march" — you look at a log through ONE clock, and asking
     *  the user to fill two was asking them to answer a question they did not
     *  have. Which clock IS a real question, though, and a backfilled topic
     *  answers it differently: `t` is when the record landed, `tm` is when the
     *  thing it reports happened, and they can be hours apart.  */
    let axis = mc.from_tm || mc.to_tm ? "tm" : "t";

    let $from = createElement2(
        ["input", {class: "input TRANGER_OPT_FROM", type: "datetime-local", step: "1"}]);
    let $to = createElement2(
        ["input", {class: "input TRANGER_OPT_TO", type: "datetime-local", step: "1"}]);

    /*  Typing in them is an answer too: the hint must follow what the inputs
     *  now say, not what the granularity last resolved to.  */
    for(let $input of [$from, $to]) {
        $input.addEventListener("change", () => {
            gobj_send_event(gobj, "EV_TIME_RANGE_TYPED", {}, gobj);
        });
    }

    /*  ALWAYS on screen, and it IS the answer: the granularity fills these
     *  two with the bucket it resolves to, and the user is free to nudge them
     *  from there ("that week, but from wednesday"). One place shows the
     *  range, and it is the editable one — a read-only copy of the same two
     *  timestamps next to it was noise.  */
    let $range = createElement2(
        ["div", {class: "mt-2 TRANGER_OPT_CUSTOM"},
            [
                /*  NO `is-mobile`: that is the class that keeps columns side by
                 *  side on a phone, and half a phone is not enough for a
                 *  `datetime-local` — the control kept its width and CLIPPED the
                 *  value, so neither end of the range could be read. Stacked
                 *  below 769px, side by side above it.  */
                ["div", {class: "columns is-multiline mb-0"},
                    [
                        ["div", {class: "column is-half"},
                            [
                                ["label", {class: "label is-small mb-1", "data-i18n": "from"},
                                    t("from")],
                                ["div", {class: "control"}, [$from]]
                            ]
                        ],
                        ["div", {class: "column is-half"},
                            [
                                ["label", {class: "label is-small mb-1", "data-i18n": "to"},
                                    t("to")],
                                ["div", {class: "control"}, [$to]]
                            ]
                        ]
                    ]
                ],
            ]
        ]);

    let picker = gobj_create_pure_child("period", "C_YUI_PERIOD", {
        periods:       PERIOD_MODES,
        with_span:     true,
        /*  No "custom" MODE: the two inputs below are always there, so a mode
         *  whose whole job was to reveal them has nothing left to do.
         *  No resolved line either — the inputs say the same thing, and they
         *  can be edited.  */
        with_custom:   false,
        with_resolved: false
    }, gobj);
    gobj_start(picker);

    /*  The picker prints the two timestamps it resolves to; what IT cannot
     *  know is whether the key holds anything there. This line does.  */
    let $hint = createElement2(
        ["p", {class: "is-size-7 has-text-centered mt-1 TRANGER_OPT_HINT"}, ""]);
    /*  It closes the "which clock" half of the card: the gap under it is what
     *  separates that question from the "which period" one below.  */
    let $extent = createElement2(
        ["p", {class: "is-size-7 has-text-grey-light has-text-centered mb-5 " +
                      "TRANGER_OPT_SPAN"}, ""]);

    let $axis_btns = {};
    let $axis = createElement2(
        ["div", {class: "buttons has-addons is-centered mb-2 TRANGER_OPT_AXIS"}, []]);

    for(let id of ["t", "tm"]) {
        let $btn = createElement2(
            ["button", {class: `button TRANGER_OPT_AXIS_BTN ` +
                               `TRANGER_OPT_AXIS_${id.toUpperCase()}`, type: "button",
                        /*  The short name is the BUTTON; what it means is the
                         *  line under the pair. Two full sentences side by side
                         *  wrapped into an unreadable block on a phone.  */
                        title: t(id === "t" ? "t persistence" : "tm message origin"),
                        "data-i18n-title": id === "t" ? "t persistence" : "tm message origin"},
                [["span", {"data-i18n": id === "t" ? "axis t" : "axis tm"},
                    t(id === "t" ? "axis t" : "axis tm")]]
            ]);
        $btn.addEventListener("click", () => {
            gobj_send_event(gobj, "EV_SET_TIME_AXIS", {axis: id}, gobj);
        });
        $axis_btns[id] = $btn;
        $axis.appendChild($btn);
    }

    let $why = createElement2(
        ["p", {class: "is-size-7 has-text-grey has-text-centered mb-1 " +
                      "TRANGER_OPT_AXIS_WHY"}, ""]);

    /*  The warning sits right under the axis it is about: a period that finds
     *  nothing is a fact about THIS clock, and at the bottom of the card it
     *  read like a footnote to the whole form.  */
    let $block = createElement2(
        ["div", {class: "TRANGER_OPT_RANGE"},
            [$axis, $why, $extent, $hint, gobj_read_attr(picker, "$container"), $range]]);

    let time = {
        $block: $block, gobj: picker, axis: axis, $range: $range,
        $from: $from, $to: $to, $hint: $hint, $extent: $extent,
        $axis_btns: $axis_btns, $why: $why,
        span: span, units: units, match_cond: mc
    };

    apply_time_axis(time, axis);
    return time;
}

/***************************************************************
 *  Point the picker at one axis: its UNIT (a topic may keep t in seconds
 *  and tm in milliseconds), the extent the key covers on THAT axis, and
 *  the bounds the two custom inputs accept.
 *
 *  On the initial build the mode is derived from the match conditions of
 *  that axis, so reopening a card filtered by `tm` comes back on `tm`,
 *  showing the period it was filtered by.
 *
 *  On an axis switch (`preserve_mode`) the granularity the user has
 *  selected is KEPT and re-resolved against the new clock: picking "month"
 *  on `t` and switching to `tm` stays on "month" (the anchor is stored in
 *  milliseconds, independent of the axis unit). The absolute range is not
 *  carried as-is — the inputs follow the picker's re-resolved bounds, never
 *  the numbers that belonged to the other clock.
 *
 *  `keep_inputs` (a language refresh re-applying the same axis) re-renders
 *  the composed labels without touching the two inputs — the user may have
 *  typed a range by hand that matches no bucket.
 ***************************************************************/
function apply_time_axis(time, axis, {preserve_mode=false, keep_inputs=false}={})
{
    let mc = time.match_cond;
    let ms = axis === "t" ? time.units.t_ms : time.units.tm_ms;
    let span_from = axis === "t" ? time.span.fr_t : time.span.fr_tm;
    let span_to = axis === "t" ? time.span.to_t : time.span.to_tm;
    let from_val = axis === "t" ? mc.from_t : mc.from_tm;
    let to_val = axis === "t" ? mc.to_t : mc.to_tm;

    time.axis = axis;
    time.ms = ms;
    time.span_from = span_from;
    time.span_to = span_to;

    for(let id in time.$axis_btns) {
        let on = (id === axis);
        time.$axis_btns[id].classList.toggle("is-link", on);
        time.$axis_btns[id].classList.toggle("is-active", on);
    }
    time.$why.textContent = t(axis === "t"
        ? "when the record was stored"
        : "when the event actually happened");

    /*  Bounded to the key's real extent: a range outside it can only ever
     *  return zero rows, and the bounds double as a hint of what there is
     *  to look at.  */
    time.$from.min = epoch_to_local_input(span_from, ms);
    time.$from.max = epoch_to_local_input(span_to, ms);
    time.$to.min = time.$from.min;
    time.$to.max = time.$from.max;

    time.$extent.textContent = (span_from && span_to)
        ? `${t("the key holds")} ${epoch_to_local_input(span_from, ms).replace("T", " ")}` +
          ` → ${epoch_to_local_input(span_to, ms).replace("T", " ")}`
        : t("span unknown");

    /*  Which mode the picker opens on. Preserve the user's selection on an
     *  axis switch; otherwise restore it from this axis's match conditions.  */
    let mode;
    let anchor;
    if(preserve_mode) {
        mode = gobj_read_attr(time.gobj, "mode");
        anchor = gobj_read_integer_attr(time.gobj, "anchor");
    } else {
        let start = restore_period_mode(from_val, to_val, ms);
        mode = start.mode;
        anchor = start.anchor;
    }

    /*  Re-aim the picker: the attrs, then ONE event to make it re-read them.
     *  EV_REFRESH and not EV_SET_MODE on purpose — EV_SET_MODE publishes, and
     *  this runs while the dialog is still being BUILT (and again on an axis
     *  click, where the answer is not ready either). Nothing was asked yet.  */
    gobj_write_attr(time.gobj, "ms", ms);
    gobj_write_attr(time.gobj, "min", span_from);
    gobj_write_attr(time.gobj, "max", span_to);
    gobj_write_attr(time.gobj, "mode", mode);
    gobj_write_attr(time.gobj, "anchor", anchor);
    gobj_send_event(time.gobj, "EV_REFRESH", {}, time.gobj);

    /*  Fill the two inputs to match. On a plain (re)build they carry this
     *  axis's stored range; on an axis switch they follow the picker's
     *  freshly re-resolved bounds; on a language refresh they are left alone.  */
    if(!preserve_mode) {
        time.$from.value = epoch_to_local_input(from_val, ms);
        time.$to.value = epoch_to_local_input(to_val, ms);
    } else if(!keep_inputs) {
        sync_time_inputs(time);
    }
}

/***************************************************************
 *  Write what the picker resolved into the two inputs: they ARE the range
 *  that will be asked for, and the granularity is only a fast way to fill
 *  them. "All" empties them (no bounds = the full key).
 ***************************************************************/
function sync_time_inputs(time)
{
    let from = gobj_read_integer_attr(time.gobj, "from");
    let to = gobj_read_integer_attr(time.gobj, "to");

    time.$from.value = epoch_to_local_input(from, time.ms);
    time.$to.value = epoch_to_local_input(to, time.ms);
}

/***************************************************************
 *  Warn when the chosen period lands where the key has NOTHING.
 *
 *  The picker resolves a name into two timestamps; only the view knows the
 *  extent the key actually covers. A bucket entirely outside it can only
 *  ever open an empty card — and an empty card is indistinguishable from a
 *  broken query, so say it BEFORE opening it.
 ***************************************************************/
function paint_hint(time)
{
    let $hint = time.$hint;
    $hint.classList.remove("has-text-warning-dark");
    $hint.textContent = "";

    if(!time.span_from || !time.span_to) {
        return;                     /*  the key's extent is unknown: no claim  */
    }
    /*  Read the INPUTS, not the picker: they are what will be asked for, and
     *  the user may have nudged them off the bucket.  */
    let from = to_epoch(time.$from.value, time.ms);
    let to = to_epoch(time.$to.value, time.ms);
    if(!from && !to) {
        return;                     /*  the full key: never empty  */
    }

    let misses = (to && to < time.span_from) || (from && from > time.span_to);
    if(misses) {
        $hint.classList.add("has-text-warning-dark");
        $hint.textContent = t("the key has no records in this period");
    }
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
function build_rows_options_form(gobj, match_cond, editing, span, units)
{
    let mc = match_cond || {};

    let mk_input = (cls, type, ph, val) => createElement2(
        ["input", {class: `input ${cls}`, type: type, placeholder: ph || "",
                   value: (val === 0 || val === undefined || val === null) ? "" : String(val)}]);

    let time = build_time_block(gobj, mc, span, units);

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

    /*  THREE cards, because the form asks three different questions and a
     *  single column of fields made them look like one. The two time axes are
     *  NOT variants of each other — `t` is when a record was stored, `tm` is
     *  when the thing it reports happened, and they can be hours apart after a
     *  backfill — so each gets its own card and its own navigator, and the
     *  third holds what is not time at all.  */
    let card = (title, subtitle, logical, body) => createElement2(
        ["div", {class: `card mb-4 TRANGER_OPT_CARD ${logical}`},
            [
                /*  Title and subtitle on ONE line (Bulma's .card-header-title is
                 *  already a flex row; the `is-block` they used to carry is what
                 *  stacked them): three of these headers sit above a dialog that
                 *  scrolls on a phone, and a second line each was 3 lines of
                 *  vertical budget spent on nothing. It wraps on a narrow screen
                 *  rather than overflow.  */
                ["header", {class: "card-header"},
                    [["div", {class: "card-header-title is-flex-wrap-wrap"},
                        [
                            ["span", {class: "TRANGER_OPT_CARD_TITLE",
                                      "data-i18n": title}, t(title)],
                            ["span", {class: "ml-2 is-size-7 has-text-weight-normal " +
                                             "has-text-grey TRANGER_OPT_CARD_SUBTITLE",
                                      "data-i18n": subtitle},
                                t(subtitle)]
                        ]
                    ]]
                ],
                ["div", {class: "card-content p-3"}, body]
            ]
        ]);

    let $box = createElement2(
        /*  Fill the dialog. A hand-picked width narrower than the shell's
         *  own (640px) just left a band of dead space down the right side;
         *  the dialog is already the thing that decides how wide a popup may
         *  be, and it is responsive.  */
        ["div", {class: "TRANGER_ROWS_OPTIONS", style: "width:100%;"},
            [
                card("time", "which clock, and which period",
                     "TRANGER_OPT_CARD_TIME", [time.$block]),

                card("rows and flags", "leave blank for the full key",
                     "TRANGER_OPT_CARD_REST",
                    [
                        ["div", {class: "columns is-mobile is-multiline"},
                            [
                                ["div", {class: "column is-half"},
                                    [field("from rowid", inputs.from_rowid)]],
                                ["div", {class: "column is-half"},
                                    [field("to rowid", inputs.to_rowid)]],
                                ["div", {class: "column is-half"},
                                    [field("user-flag mask set", inputs.mask_set)]],
                                ["div", {class: "column is-half"},
                                    [field("user-flag mask clear", inputs.mask_notset)]]
                            ]
                        ],
                        ["label", {class: "checkbox is-block mt-2 TRANGER_OPT_BACKWARD_FIELD"},
                            [$backward,
                             ["span", {class: "ml-2", "data-i18n": "newest first"},
                                t("newest first")]]]
                    ]),

                ["div", {class: "has-text-centered TRANGER_OPT_ACTIONS"}, [$open]]
            ]
        ]);

    return {$box: $box, inputs: inputs, time: time, $open: $open};
}

/***************************************************************
 *  Collect a match_cond from the Rows-options form: only fields the
 *  user actually set (0/blank = unset), so the iterator applies exactly
 *  what was asked. The four time bounds go out in the topic's unit.
 ***************************************************************/
function collect_rows_match_cond(form)
{
    let inputs = form.inputs;
    let time = form.time;
    let mc = {};

    /*  ONE axis: the one the user chose. The other one carries no condition
     *  at all — the iterator ANDs whatever it is given, and a leftover range
     *  on the abandoned clock would quietly cut the answer down.  */
    let from;
    let to;

    /*  The INPUTS are the answer. The granularity filled them (and a click on
     *  another one refills them), but what leaves this dialog is what they say
     *  — so a range nudged by hand off the bucket is honoured instead of being
     *  silently overwritten by the bucket it came from.  */
    from = to_epoch(time.$from.value, time.ms);
    to = to_epoch(time.$to.value, time.ms);

    if(from) {
        mc[`from_${time.axis}`] = from;
    }
    if(to) {
        mc[`to_${time.axis}`] = to;
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
    let priv = gobj.priv;
    let editing = !!card;

    /*  A dialog already up owns a picker gobj named `period`: building a
     *  second one under the same parent would collide on the name. It cannot
     *  happen through the UI (the dialog is modal), so if it does, something
     *  else opened it.  */
    if(priv.rows_options) {
        log_error(`${gobj_short_name(gobj)}: the Rows options are already open`);
        return;
    }

    let form = build_rows_options_form(gobj,
        editing ? card.match_cond : null, editing,
        key_span(gobj, key), topic_time_units(gobj));

    priv.rows_options = form;
    paint_hint(form.time);

    let opt_modal = show_view_modal(gobj, shell, form.$box, {
        dialog: true,
        logical_class: "TRANGER_ROWS_OPTIONS",
        title_fn: () => `${key} · ${t("rows")}`,
        t:      t,
        /*  EVERY way out of the dialog lands here (the X, Escape, the
         *  backdrop, and the confirm button's own close()), so this is the
         *  one place the pickers die. A child gobj outliving its DOM is a
         *  leak the next dialog would trip over by name.  */
        on_close: () => {
            close_rows_options(gobj);
        }
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
 *  The Rows options are gone: destroy the two picker gobjs with them.
 *  Idempotent — the confirm path closes the modal itself, and the modal
 *  calls back here.
 ***************************************************************/
function close_rows_options(gobj)
{
    let priv = gobj.priv;
    let form = priv.rows_options;
    if(!form) {
        return;
    }
    priv.rows_options = null;

    let time = form.time;
    if(time && is_gobj(time.gobj)) {
        /*  STOP, then destroy — the picker was STARTED when it was built.
         *  gobj_destroy() raises the `destroying` flag BEFORE it tries to stop
         *  a still-running gobj, so its own stop is then refused ("gobj NULL or
         *  DESTROYED"): closing the dialog logged four errors and skipped
         *  mt_stop entirely. (mt_destroy still tore the calendar down, so
         *  nothing leaked — but a gclass is entitled to have its mt_stop run,
         *  and a screenful of framework errors hides the next real one.)  */
        gobj_stop(time.gobj);
        gobj_destroy(time.gobj);
    }
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

    let prev_match_cond = card.match_cond;
    card.match_cond = match_cond || {};
    if(!arm_iterator(gobj, card)) {
        /*  The card keeps running on its OLD conditions (the new iterator
         *  never opened), so memory must say so too — otherwise the next
         *  reconnect re-arms with conditions that were never applied while
         *  the persisted view still holds the old ones.  */
        card.match_cond = prev_match_cond;
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
                    title: t("close"), "aria-label": t("close"),
                        "data-i18n-title": "close", "data-i18n-aria-label": "close"},
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
                        title: t("options"), "aria-label": t("options"),
                        "data-i18n-title": "options", "data-i18n-aria-label": "options"},
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
                    "aria-label": t("export"),
                    "data-i18n-title": "download the rows loaded in this table as csv",
                    "data-i18n-aria-label": "export"},
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
                    "aria-label": t("share"),
                    "data-i18n-title": "copy a link to this card",
                    "data-i18n-aria-label": "share"},
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
                    "aria-label": t("columns"),
                    "data-i18n-title": "choose the columns to show",
                    "data-i18n-aria-label": "columns"},
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
                        title: t("refresh"), "aria-label": t("refresh"),
                        "data-i18n-title": "refresh", "data-i18n-aria-label": "refresh"},
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
    /*  The title is not one composed string any more: "<key> · <mode>" built
     *  with t() at create time carried no i18n key, so refresh_language() had
     *  nothing to grab and the card stayed "DVES_40C768 · Filas" in an English
     *  session for the rest of its life. The translatable HALVES carry their
     *  own key ("all keys", "rows"/"live"); the key of the topic is data and
     *  is not translated.  */
    let title_children = [];
    if(key === ALL_KEYS) {
        title_children.push(["span", {i18n: "all keys"}, t("all keys")]);
    } else {
        title_children.push(["span", {}, key]);
    }
    /*  The gap is CSS, not text: createElement2 TRIMS a text node, so neither
     *  " · " nor a hard space survives — the separator would land glued to both
     *  halves.  */
    title_children.push(["span", {class: "mx-1"}, "·"]);
    title_children.push(["span", {i18n: mode}, t(mode)]);
    head_children.push(["span", {class: "TRANGER_CARD_TITLE"}, title_children]);

    /*  Live has no pager, so no "Showing x of N" footer: without this the
     *  rolling buffer is a black box (is it 12 rows or the 500 cap?).  */
    if(mode === "live") {
        card.$count = createElement2(
            ["span", {class: "TRANGER_CARD_COUNT tag is-light ml-2 is-flex-shrink-0",
                      title: t("rows buffered - oldest are dropped at the cap"),
                      "data-i18n-title": "rows buffered - oldest are dropped at the cap"},
                `0 / ${card.live_max}`]);
        head_children.push(card.$count);
    }

    /*  The filter hint does not fit a phone header as text — there it is the
     *  same message behind an info icon (title/aria-label), so a mobile user
     *  is not left with column filters and no idea of their scope.  */
    head_children.push(
        ["span", {class: "TRANGER_CARD_FILTERHINT is-size-7 has-text-grey ml-2 is-hidden-mobile",
                  title: t("column filters apply to the loaded rows only"),
                  "data-i18n-title": "column filters apply to the loaded rows only",
                  i18n: "filters loaded rows"},
            t("filters loaded rows")]);
    head_children.push(
        ["span", {class: "TRANGER_CARD_FILTERHINT_ICON icon is-small has-text-grey ml-2 " +
                         "is-flex-shrink-0 is-hidden-tablet",
                  title: t("column filters apply to the loaded rows only"),
                  "aria-label": t("column filters apply to the loaded rows only"),
                  "data-i18n-title": "column filters apply to the loaded rows only",
                  "data-i18n-aria-label": "column filters apply to the loaded rows only"},
            [["i", {class: "yi-circle-info"}]]]);
    /*  The actions are ONE block, not six loose children of the head.
     *
     *  Loose, they could not wrap as a group: a Rows card carries six buttons
     *  (options, columns, export, share, refresh, close), each is-flex-shrink-0,
     *  and on a phone they simply ran off the right edge of the card — measured
     *  at 390px: card 332px wide, head content 400px, the close button ending 60px
     *  OUTSIDE the box. As a block they wrap to a second line of the head when
     *  they do not fit (see the CSS), still right-aligned (margin-left:auto —
     *  which also replaces the old flex:1 spacer).  */
    let action_children = [];
    if($options) {
        action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$options]]);
    }
    if($pause) {
        action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$pause]]);
    }
    action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$cols]]);
    action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$export]]);
    action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$share]]);
    action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$action]]);
    action_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$close]]);
    head_children.push(
        ["div", {class: "TRANGER_CARD_ACTIONS is-flex is-align-items-center"},
            action_children]);

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
        ...yui_tabulator_lang(t),
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
        ...yui_tabulator_lang(t),
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
 *  The subscription filter of a Live card: its OWN FEED, by `rt_id`.
 *
 *  Filtering by topic+key instead made two cards double each other's rows:
 *  the backend publishes a record once per open FEED (each publish carrying
 *  the rt_id of the feed that produced it), but a topic+key filter matches
 *  EVERY publish of that key — so with a per-key Live card and a whole-topic
 *  Live card open on the same key, each publish landed in BOTH subscriptions
 *  and each card painted it twice. The rt_id ADDRESSES the record (c_tranger
 *  says so: "a subscriber filters on its own rt_id"), and a card's feed is
 *  its own: one publish, one frame, one row.
 ***************************************************************/
function live_filter(card)
{
    return {rt_id: card.rt_id};
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

    show_view_modal(gobj, shell, $box, {
        dialog: true,
        logical_class: "TRANGER_RECORD_DIALOG",
        title_fn: () => `${priv.cur_topic} · ${key === ALL_KEYS ? t("all keys") : key}`,
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
                let page = parse_records_page(data);
                /*  NOT `.map(flatten_record)`: map would hand it the INDEX as
                 *  its second argument, which is the key parameter.  */
                pend.resolve({
                    data:      page.records.map((rec) => flatten_record(rec)),
                    last_page: page.last_page,
                    last_row:  page.last_row
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
        let answer = parse_keys_answer(data);
        if(answer.whole_list) {
            /*  A backend older than the paged list-keys ignores from/limit and
             *  answers the whole key list, as it always did. Do not leave the
             *  picker empty for that: show the lot as a single page. The search
             *  and the sort are then the backend's `order`-less answer — i.e.
             *  gone — so say so once, LOUDLY, instead of silently pretending
             *  the filter did something.  */
            log_warning(`${GCLASS_NAME}: this backend answers list-keys with the ` +
                        `whole key list (no rkey/from/limit): no server-side key ` +
                        `search or paging`);
        }
        priv.keys = answer.rows;
        priv.bumped = {};   /*  fresh snapshot: fresh dedupe watermarks  */
        priv.keys_total = answer.total_rows;
        remember_key_spans(gobj, answer.rows);
        update_meta(gobj);
        pend.resolve({
            data:      answer.rows,
            last_page: answer.pages,
            last_row:  answer.total_rows
        });
        return 0;
    }

    /*
     *  print-tranger feeds the JSON viewer, correlated by the echoed `path`:
     *  empty path is the first whole-tranger fetch (EV_SET_JSON), a set path
     *  is a lazy drill (EV_SUBTREE_LOADED). Handled before the generic error
     *  path so a failed drill marks its own branch instead of the whole view.
     */
    if(command === "print-tranger") {
        let jv = priv.json_gobj;
        if(!jv || !is_gobj(jv) || gobj_is_destroying(jv)) {
            /*  Viewer closed before its answer landed: benign, not an error.  */
            return 0;
        }
        let path = (kw_command && kw_command.path) || "";
        if(result < 0) {
            if(path) {
                gobj_send_event(jv, "EV_SUBTREE_ERROR",
                    {path: path, error: comment || "print-tranger failed"}, gobj);
            } else {
                show_error(gobj, comment || "print-tranger failed");
            }
            return 0;
        }
        if(path) {
            gobj_send_event(jv, "EV_SUBTREE_LOADED", {path: path, json: data}, gobj);
        } else {
            gobj_send_event(jv, "EV_SET_JSON", {json: data}, gobj);
        }
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
                let counted = parse_keys_answer(data);
                priv.keys_total = counted.total_rows;
                remember_key_spans(gobj, counted.rows);
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

    if(gobj_current_state(gobj) === "ST_LOADING_TOPICS") {
        /*  Reopened while the `topics` answer was in flight: that answer
         *  belongs to the session that died — ask again. Falling through to
         *  the re-arm path below would enable the toolbar with NO topic
         *  selected (the half-armed view its guard exists to prevent) and
         *  re-request nothing, wedging the view here if the answer was lost
         *  to the flap.  */
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
    set_toolbar_enabled(gobj, true);
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
 *  The link went down: there is no session, so there is nothing to browse.
 *
 *  Without this the view stayed in ST_TOPIC_SELECTED with a live-looking
 *  toolbar: opening the Keys picker then built its Tabulator against a dead
 *  session, whose `ajaxRequestFunc` rejected at once — "no session, cannot
 *  list keys" in the log and a "Data Load Error" painted over the picker.
 *
 *  The picker goes (its rows and its paginator belong to the session that
 *  died); the cards are torn down but stay PERSISTED, exactly as a topic
 *  switch does — EV_ON_OPEN asks for the topics again and the saved views
 *  reopen themselves. `pending_seg` carries the topic the user was on, so the
 *  reconnect comes back to it instead of falling back to the first one.
 ************************************************************/
function ac_transport_closed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = gobj_read_str_attr(gobj, "conn_id");

    if(kw && kw.conn_id && kw.conn_id !== conn_id) {
        return 0;   /*  another connection  */
    }

    reject_pending(gobj, "session closed");
    close_all_cards(gobj);      /*  teardown: they stay persisted  */
    close_picker(gobj);
    close_json_viewer(gobj);    /*  its data source (the tranger) is gone  */
    /*  The transient dialogs die with the session too: left up, the Rows
     *  options (and friends) keep a form whose every control sends events
     *  into ST_DISCONNECTED — a zombie whose clicks can only log errors.
     *  Their on_close chain releases what they hold (the period pickers).  */
    close_view_modals(gobj);
    set_toolbar_enabled(gobj, false);

    priv.pending_seg = priv.cur_topic || "";
    priv.topics = null;
    priv.topic_flags = {};
    priv.keys = null;
    priv.key_spans = {};
    priv.keys_total = 0;
    priv.wanted_views = null;
    priv.cur_topic = "";
    render_tabs(gobj);
    update_meta(gobj);
    show_error(gobj, "disconnected - connect in settings");

    gobj_change_state(gobj, "ST_DISCONNECTED");
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
    /*  The state change comes FIRST, and it is not cosmetic: do_select_topic()
     *  asks for the saved views, and that answer can come back SYNCHRONOUSLY
     *  (an already-loaded key list, nothing to query) — restore_views() then
     *  sends EV_OPEN_CARD from inside this very call. Selecting the topic
     *  before declaring the state left that event arriving in
     *  ST_LOADING_TOPICS, which does not declare it: *"Event NOT DEFINED in
     *  state"*, and the restored cards never opened. The topic IS selected the
     *  moment we commit to it; the work of selecting it comes after.  */
    gobj_change_state(gobj, "ST_TOPIC_SELECTED");
    do_select_topic(gobj, topic);
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
 *  Open the raw-tranger JSON viewer.
 ************************************************************/
function ac_open_json(gobj, event, kw, src)
{
    open_json_viewer(gobj);
    return 0;
}

/************************************************************
 *  The viewer asked to load a collapsed subtree: re-issue print-tranger
 *  for that path. The answer comes back through ac_mt_command_answer and
 *  is fed to the viewer as EV_SUBTREE_LOADED / EV_SUBTREE_ERROR.
 ************************************************************/
function ac_json_expand_path(gobj, event, kw, src)
{
    request_print_tranger(gobj, (kw && kw.path) || "");
    return 0;
}

/************************************************************
 *  The JSON viewer was dismissed (X / dock / Escape / back), or torn
 *  down by close_json_viewer(): release the viewer and clear the refs.
 ************************************************************/
function ac_json_closed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let jv = priv.json_gobj;
    priv.json_gobj = null;
    priv.json_win = null;
    priv.json_modal = null;
    if(jv && is_gobj(jv)) {
        try {
            /*  STOP before destroy — the viewer was STARTED in open_json_viewer
             *  (see close_json_viewer for the full rationale). */
            gobj_stop(jv);
            gobj_destroy(jv);
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
        }
    }
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
 *  A time picker of the Rows options moved (a granularity, an arrow, a
 *  date off its calendar). Nothing is queried yet — the dialog is still
 *  open — but the user must SEE what the name they just picked resolves
 *  to: "Week 27" is not two timestamps, and the iterator only takes two
 *  timestamps.
 *
 *  Which axis moved is told by the SENDER (the picker is named after its
 *  axis), not by the kw: a kw is plain JSON and the axis is already
 *  encoded in the identity of the gobj that published.
 ************************************************************/
function ac_period_changed(gobj, event, kw, src)
{
    let form = gobj.priv.rows_options;
    if(!form) {
        /*  The dialog is gone but a picker still published: it outlived its
         *  form, which is exactly the leak close_rows_options() prevents.  */
        log_error(`${gobj_short_name(gobj)}: EV_PERIOD_CHANGED with no Rows options open`);
        return -1;
    }

    sync_time_inputs(form.time);
    paint_hint(form.time);
    return 0;
}

/************************************************************
 *  The user typed a range by hand, off whatever bucket had filled the
 *  inputs. Nothing to re-resolve — the inputs already ARE the answer — but
 *  the "no records in this period" warning was computed from the OLD values
 *  and must follow.
 ************************************************************/
function ac_time_range_typed(gobj, event, kw, src)
{
    let form = gobj.priv.rows_options;
    if(!form) {
        log_error(`${gobj_short_name(gobj)}: EV_TIME_RANGE_TYPED with no Rows options open`);
        return -1;
    }
    paint_hint(form.time);
    return 0;
}

/************************************************************
 *  The user picked the other clock: `t` (when the record was stored) or
 *  `tm` (when the thing it reports happened).
 *
 *  It is not a cosmetic toggle: the two axes have their own UNIT (a topic
 *  may keep t in seconds and tm in milliseconds), their own extent for the
 *  key, and their own conditions in the card being edited. The picker is
 *  re-aimed at all three.
 ************************************************************/
function ac_set_time_axis(gobj, event, kw, src)
{
    let form = gobj.priv.rows_options;
    if(!form) {
        log_error(`${gobj_short_name(gobj)}: EV_SET_TIME_AXIS with no Rows options open`);
        return -1;
    }
    if(kw.axis !== "t" && kw.axis !== "tm") {
        log_error(`${gobj_short_name(gobj)}: not a time axis: ${kw.axis}`);
        return -1;
    }

    apply_time_axis(form.time, kw.axis, {preserve_mode: true});
    paint_hint(form.time);
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

    show_view_modal(gobj, shell, $list, {
        dialog: true,
        logical_class: "TRANGER_COLUMNS_DIALOG",
        title_fn: () => t("columns"),
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
    priv.$copy_btn = null;
    if(!$btn) {
        return 0;
    }

    /*  A feedback still pending on ANOTHER button is restored first: one
     *  slot and two copies inside the window left the first button stuck
     *  on "Copied" forever while its timer reset the second one early.  */
    clear_copy_feedback(gobj);

    let $text = $btn.querySelector("span:not(.icon)");
    let label = $text ? $text.textContent : "";
    if($text) {
        $text.textContent = ok ? t("copied") : t("copy failed");
    }
    $btn.classList.toggle("is-success", ok);
    $btn.classList.toggle("is-danger", !ok);

    priv.copy_fb = {$btn: $btn, label: label};
    /*  A button stuck on "Copied" forever reads as a mode, not as feedback.  */
    priv.copy_timer = setTimeout(function() {
        gobj_send_event(gobj, "EV_COPY_RESET", {}, gobj);
    }, COPY_FEEDBACK_MS);
    return 0;
}

/************************************************************
 *  Restore the button wearing the copy feedback, and drop its timer.
 *  Plain helper (no events): ac_copy_done needs it inline when a second
 *  copy lands inside the feedback window.
 ************************************************************/
function clear_copy_feedback(gobj)
{
    let priv = gobj.priv;
    if(priv.copy_timer) {
        clearTimeout(priv.copy_timer);
        priv.copy_timer = null;
    }
    let fb = priv.copy_fb;
    priv.copy_fb = null;
    if(!fb || !fb.$btn || !fb.$btn.isConnected) {
        return;     /*  its dialog / card is gone  */
    }
    let $text = fb.$btn.querySelector("span:not(.icon)");
    if($text && fb.label) {
        $text.textContent = fb.label;
    }
    fb.$btn.classList.remove("is-success", "is-danger");
}

/************************************************************
 *  The copy feedback has been read: put the button back as it was.
 ************************************************************/
function ac_copy_reset(gobj, event, kw, src)
{
    clear_copy_feedback(gobj);
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

    /*  The subscription is filtered by the feed's rt_id, and a re-arm mints a
     *  NEW one: the old subscription would sit filtering on a DEAD feed and the
     *  card would go silent after a reconnect. Drop it before opening the new
     *  feed, and take a fresh one on the new id.  */
    let service = gobj_read_str_attr(gobj, "treedb_name");
    if(card.subscribed) {
        gobj_unsubscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
            {__service__: service, __filter__: live_filter(card)}, gobj);
        card.subscribed = false;
    }

    card.rt_id = `spa-${priv.tok}-rt-${++priv.iter_seq}`;

    gobj_command(remote, "open-rt",
        {
            service:    service,
            rt_id:      card.rt_id,
            topic_name: card.topic,
            key:        card.key
        }, gobj);
    gobj_subscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
        {__service__: service, __filter__: live_filter(card)}, gobj);
    card.subscribed = true;
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
 *  The language changed (the app root publishes it after switching).
 *
 *  refresh_language() reaches every node that CARRIES its key (data-i18n,
 *  data-i18n-title, data-i18n-aria-label) — the buttons, the hints, the
 *  halves of a card title. What it cannot reach is what t() COMPOSED at
 *  render time and left as a plain string:
 *
 *    - the toolbar meta ("5 keys · 1 views"), rebuilt by update_meta;
 *    - the buttons whose label depends on STATE (pause/resume, the Live
 *      topic toggle): their key changes with the state, so they are
 *      repainted, not re-translated;
 *    - everything Tabulator rendered — the row counter ("Showing 1-100 of
 *      409194 rows"), the placeholders, the picker's column headers. A
 *      table re-renders those from OUR functions, so re-setting its columns
 *      and re-asking for its page is what puts them in the new language.
 ************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;

    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    update_meta(gobj);
    paint_live_topic_btn(gobj);

    /*  The long-lived error banner and the composed titles hold t()-built
     *  text with no key to re-translate by: re-render them here.  */
    if(priv.error_key) {
        show_error(gobj, priv.error_key);
    }
    for(let entry of (priv.open_modals || [])) {
        if(entry.title_fn) {
            retitle_modal(entry.$content, entry.title_fn());
        }
    }
    if(priv.picker_modal && priv.picker_box) {
        retitle_modal(priv.picker_box, `${priv.cur_topic} · ${t("keys")}`);
    }

    for(let card of priv.cards) {
        if(card.mode === "live") {
            paint_pause_button(card);
            update_live_count(card);
        }
        retranslate_table(gobj, card);
    }

    /*  The Rows options may be up: the time pickers compose their labels
     *  ("Week 27", a month name) at build time, so no attribute can reach
     *  them — they re-render on the event, like every widget's chrome.  */
    if(priv.rows_options) {
        let time = priv.rows_options.time;
        gobj_send_event(time.gobj, "EV_LANGUAGE_CHANGED", {}, gobj);
        apply_time_axis(time, time.axis,        /*  its labels are t()-composed  */
            {preserve_mode: true, keep_inputs: true});
        paint_hint(time);
    }

    if(priv.picker_tbl) {
        try {
            /*  The picker's headers ARE ours (t() at column-build time), so
             *  hand it a fresh set; the page comes back with the counter in the
             *  new language.  */
            yui_tabulator_relocalize(priv.picker_tbl, t);
            priv.picker_tbl.setColumns(picker_columns(gobj, is_mobile()));
            priv.picker_tbl.replaceData();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: picker gone: ${e}`);
        }
    }
    return 0;
}

/***************************************************************
 *  Put a card's table back in the current language. A Rows card re-asks
 *  for its page (that is what re-renders the footer counter through our
 *  rows_counter()); a Live card has no pager — only its placeholder, and
 *  only while it is empty.
 ***************************************************************/
function retranslate_table(gobj, card)
{
    let table = card.tabulator;
    if(!table) {
        return;
    }
    yui_tabulator_relocalize(table, t);     /*  its paginator, its notices  */
    try {
        if(card.mode === "rows") {
            table.replaceData();    /*  re-fetch: the footer is rebuilt with it  */
            return;
        }
        table.options.placeholder = t("waiting for records");
        if(table.getDataCount() === 0) {
            table.redraw(true);
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table gone: ${e}`);
    }
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
     *  duplicate our rows.
     *
     *  There is NO fallback for a payload without rt_id, on purpose: the
     *  subscription is filtered by {rt_id} and kw_match_simple answers
     *  no-match when the filter's key is ABSENT from the kw, so such a
     *  publish never reaches this action — and no released backend can send
     *  one anyway (open-rt and the rt_id field shipped together; a backend
     *  without rt_id refuses open-rt itself, which the card surfaces as the
     *  command error).  */
    for(let card of priv.cards) {
        if(card.mode !== "live") {
            continue;
        }
        if(rt_id && card.rt_id === rt_id) {
            push_live_record(card, record, key);
        }
    }

    /*  The picker count tracks PHYSICAL appends, but this action runs once
     *  per feed the record reached (a per-key card + a whole-topic card on
     *  the same key = two deliveries of the same append): dedupe by rowid,
     *  which the backend stamps per physical record.  */
    let rowid = (kw && kw.rowid) || 0;
    if(topic === priv.cur_topic && is_new_rowid(gobj, key, rowid)) {
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
/*  TRUE once per physical append: the backend stamps every published record
 *  with its rowid, and rowids only grow within a key. The map resets with
 *  each list-keys snapshot, so a reopened picker starts clean.  */
function is_new_rowid(gobj, key, rowid)
{
    let priv = gobj.priv;
    if(!rowid) {
        return true;    /*  no rowid, no way to dedupe: count it  */
    }
    if(!priv.bumped) {
        priv.bumped = {};
    }
    if(rowid <= (priv.bumped[key] || 0)) {
        return false;
    }
    priv.bumped[key] = rowid;
    return true;
}

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
            ["EV_COPY_DONE",            ac_copy_done,             null],
            ["EV_COPY_RESET",           ac_copy_reset,            null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_ON_CLOSE",             ac_transport_closed,      null],
            ["EV_SHOW",                 ac_show,                  null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,      null]
        ]],
        ["ST_LOADING_TOPICS", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_PAGE_TIMEOUT",         ac_page_timeout,          null],
            ["EV_COPY_DONE",            ac_copy_done,             null],
            ["EV_COPY_RESET",           ac_copy_reset,            null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_ON_CLOSE",             ac_transport_closed,      null],
            ["EV_SHOW",                 ac_show,                  null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,      null],
            ["EV_SELECT_TOPIC",         ac_select_topic,          null]
        ]],
        ["ST_TOPIC_SELECTED", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_PAGE_TIMEOUT",         ac_page_timeout,          null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_ON_CLOSE",             ac_transport_closed,      null],
            ["EV_SHOW",                 ac_show,                  null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,      null],
            ["EV_SELECT_TOPIC",         ac_select_topic,          null],
            /*  user actions  */
            ["EV_OPEN_KEYS",            ac_open_keys,             null],
            ["EV_PICKER_CLOSED",        ac_picker_closed,         null],
            ["EV_OPEN_JSON",            ac_open_json,             null],
            ["EV_EXPAND_PATH",          ac_json_expand_path,      null],
            ["EV_JSON_CLOSED",          ac_json_closed,           null],
            ["EV_OPEN_OPTIONS",         ac_open_options,          null],
            ["EV_OPEN_CARD_OPTIONS",    ac_open_card_options,     null],
            ["EV_SET_TIME_AXIS",        ac_set_time_axis,         null],
            ["EV_TIME_RANGE_TYPED",     ac_time_range_typed,      null],
            ["EV_PERIOD_CHANGED",       ac_period_changed,        null],
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
        ["EV_ON_CLOSE",             0],
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_TOPIC_SELECTED",       event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_SHOW",                 0],
        ["EV_SELECT_TOPIC",         0],
        ["EV_OPEN_KEYS",            0],
        ["EV_PICKER_CLOSED",        0],
        ["EV_OPEN_JSON",            0],
        ["EV_EXPAND_PATH",          0],
        ["EV_JSON_CLOSED",          0],
        ["EV_OPEN_OPTIONS",         0],
        ["EV_OPEN_CARD_OPTIONS",    0],
        ["EV_SET_TIME_AXIS",        0],
        ["EV_TIME_RANGE_TYPED",     0],
        ["EV_PERIOD_CHANGED",       0],
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
