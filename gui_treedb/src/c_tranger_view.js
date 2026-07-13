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
 *        - mt_start → `topics` command → one Bulma tab per topic;
 *        - selecting a topic → `list-keys` (keys + record counts, kept
 *          for the picker) and an empty card dashboard;
 *        - the toolbar "Keys" button opens a Tabulator of the topic's keys
 *          (sortable by record count, header-filter), presented responsively:
 *          a moveable C_YUI_WINDOW on desktop, the shell's adaptive modal
 *          sheet on mobile. It persists while views are opened/closed; each
 *          row's "Rows"/"Live" button is colored ONLY while that view is
 *          open for the key and toggles it. A key's "Rows" opens an options
 *          form (server-side match conditions: time / rowid range, user_flag
 *          masks) and then a Rows card; "Live" opens a Live card directly;
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
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t, kw_flag_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_write_attr,
    gobj_read_pointer_attr, gobj_read_str_attr,
    gobj_parent, gobj_short_name,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_publish_event,
    gobj_command,
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
    treedb_config_add_tranger_view,
    treedb_config_remove_tranger_view,
    treedb_config_get_live_max,
    LIVE_MAX_DEFAULT,
} from "./c_treedb_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TRANGER_VIEW";

/*  Records per page in a Rows card (Tabulator's paginationSize).  */
const PAGE_SIZE = 100;

/*  Rows kept in a Live card's rolling buffer (newest on top): the user's
 *  setting (C_TREEDB_CONFIG `live_max`, Settings), read when the card is
 *  created and frozen in the card — changing the setting must not resize a
 *  buffer that is already filling.  */

/*  Columns a card shows on a phone; the rest are hidden (the full record
 *  is one row-click away, as JSON).  */
const MOBILE_COLS = 3;

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
    cur_topic:   "",     /*  selected topic  */
    pending_seg: "",     /*  topic asked via EV_SHOW before topics loaded  */
    keys:        null,   /*  [{key, records}] of cur_topic (from list-keys)  */
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
    priv.cur_topic = "";
    priv.pending_seg = "";
    priv.keys = null;
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
    close_all_cards(gobj);
    close_picker(gobj);
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
        open_keys_picker(gobj);
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
                    [$keys_btn, $meta]],
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
 *  Command to remote service: list the topics.
 ***************************************************************/
function request_topics(gobj)
{
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    let ret = gobj_command(remote, "topics", {service: service}, gobj);
    if(ret) {
        log_error(ret);
    }
}

/***************************************************************
 *  Command to remote service: list the keys of a topic (with their
 *  record counts) for the Keys picker.
 ***************************************************************/
function request_keys(gobj, topic_name)
{
    if(!topic_name) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    let ret = gobj_command(remote, "list-keys",
        {
            service:    service,
            topic_name: topic_name,
            __md_command__: {topic_name: topic_name}   /*  echoed back for correlation  */
        }, gobj);
    if(ret) {
        log_error(ret);
    }
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
            select_topic(gobj, topic);
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
 ***************************************************************/
function select_topic(gobj, topic_name)
{
    let priv = gobj.priv;
    if(!topic_name || !(priv.topics || []).includes(topic_name)) {
        return;
    }
    close_all_cards(gobj);
    close_picker(gobj);     /*  keys are per-topic; reopen for the new one  */
    priv.cur_topic = topic_name;
    priv.keys = null;
    render_tabs(gobj);
    show_error(gobj, "");
    update_meta(gobj);
    request_keys(gobj, topic_name);
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
    let n_keys = priv.keys ? priv.keys.length : 0;
    let text = `${n_keys} ${t("keys")}`;
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
    if(!priv.cur_topic) {
        return;
    }
    if(priv.picker_win || priv.picker_modal) {
        return;     /*  already open  */
    }

    let mobile = is_mobile();
    let shell = yui_shell_of(gobj);

    /*  The record counts come from `list-keys`, a snapshot taken when the
     *  topic was selected — they go stale as the backend appends. No polling
     *  (Yuneta rule): ask again HERE, every time the picker is opened (the
     *  answer repaints the table if it is already up), and let live records
     *  bump the count of their key (see ac_tranger_record_added).  */
    request_keys(gobj, priv.cur_topic);

    let $tbl = createElement2(["div", {class: "TRANGER_KEYS_TABLE"}, []]);
    let $box = createElement2(
        ["div", {class: "TRANGER_KEYS_PICKER",
                 style: mobile ? "" : "height:100%; display:flex; flex-direction:column;"},
            [$tbl]]);

    /*  on_close (both paths) releases the table and clears the refs so
     *  nothing leaks on any dismiss (X / dock / Escape / back).  */
    if(mobile) {
        if(!shell) {
            return;
        }
        priv.picker_modal = yui_shell_show_modal(shell, $box, {
            dialog: true,
            logical_class: "TRANGER_KEYS_SHEET",
            title:  `${priv.cur_topic} · ${t("keys")}`,
            t:      t,
            on_close: () => {
                if(priv.picker_tbl) {
                    try {
                        priv.picker_tbl.destroy();
                    } catch(e) {
                        /*  already gone  */
                    }
                    priv.picker_tbl = null;
                }
                priv.picker_modal = null;
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
                    if(priv.picker_tbl) {
                        try {
                            priv.picker_tbl.destroy();
                        } catch(e) {
                            /*  already gone  */
                        }
                        priv.picker_tbl = null;
                    }
                    priv.picker_win = null;
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
    let picker = new Tabulator($tbl, {
        height:         mobile ? "min(60vh, 460px)" : "100%",
        index:          "key",     /*  row identity: updateData() finds by it  */
        layout:         "fitColumns",
        placeholder:    t("no keys"),
        pagination:     true,
        paginationSize: 15,
        paginationSizeSelector: [15, 30, 50, 100],
        paginationCounter: rows_counter(),
        initialSort:    [{column: "records", dir: "desc"}],
        data:           priv.keys || [],
        /*  Compact widths on a phone: fitColumns cannot shrink a column below
         *  its minWidth/width, so the desktop set (150+110+160) overflows a
         *  ~300px sheet and Tabulator adds a horizontal scrollbar — two-axis
         *  scrolling inside a modal. The action buttons go icon-only there
         *  (their labels are is-hidden-mobile), hence the narrower column.  */
        columns: [
            {title: t("key"), field: "key", minWidth: mobile ? 100 : 150,
                headerFilter: "input"},
            {title: t("records"), field: "records", width: mobile ? 70 : 110,
                hozAlign: "right", sorter: "number"},
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
                /*  destroyed before the frame  */
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
            /*  already gone  */
        }
        priv.picker_tbl = null;
    }
    priv.picker_win = null;
    priv.picker_modal = null;
    if(win && is_gobj(win)) {
        try {
            gobj_destroy(win);
        } catch(e) {
            /*  already gone  */
        }
    }
    if(modal && typeof modal.close === "function") {
        try {
            modal.close();
        } catch(e) {
            /*  already gone  */
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
        /*  table gone  */
    }
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
    treedb_config_add_tranger_view(cfg, conn_id,
        gobj_read_str_attr(gobj, "treedb_name"),
        card.topic, card.key, card.mode, card.match_cond || {});
}

function unpersist_view(gobj, card)
{
    let cfg = config_service();
    let conn_id = gobj_read_str_attr(gobj, "conn_id");
    if(!cfg || !conn_id) {
        return;
    }
    treedb_config_remove_tranger_view(cfg, conn_id,
        gobj_read_str_attr(gobj, "treedb_name"),
        card.topic, card.key, card.mode);
}

/***************************************************************
 *  Reopen the saved key-views for the current topic (called once its
 *  keys are loaded). Only keys that still exist are restored; a restore
 *  does NOT re-persist (already saved) and add_card skips duplicates.
 ***************************************************************/
function restore_saved_views(gobj)
{
    let priv = gobj.priv;
    let cfg = config_service();
    let conn_id = gobj_read_str_attr(gobj, "conn_id");
    if(!cfg || !conn_id || !priv.cur_topic) {
        return;
    }
    let saved = treedb_config_get_tranger_views(cfg, conn_id,
        gobj_read_str_attr(gobj, "treedb_name"), priv.cur_topic);
    if(!saved.length) {
        return;
    }
    let present = {};
    for(let k of (priv.keys || [])) {
        present[String(k.key)] = true;
    }
    for(let v of saved) {
        if(!present[String(v.key)]) {
            continue;   /*  key no longer exists; skip the stale restore  */
        }
        add_card(gobj, String(v.key), v.mode, v.match_cond || {}, true);
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
            let card = priv.cards.find((c) => c.key === key && c.mode === "rows");
            if(card) {
                close_card(gobj, card);
            }
            return;
        }
        open_rows_options(gobj, key);
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
            let card = priv.cards.find((c) => c.key === key && c.mode === "live");
            if(card) {
                close_card(gobj, card);
            }
            return;
        }
        add_card(gobj, key, "live");
    });

    return createElement2(
        ["div", {class: "is-flex TRANGER_KEY_ACTIONS"}, [$rows, $live]]);
}

/***************************************************************
 *  Parse a "datetime-local" input value into epoch seconds (the tranger
 *  `t` unit). Empty / unparseable → 0 (unset).
 ***************************************************************/
function to_epoch_secs(v)
{
    if(!v) {
        return 0;
    }
    let ms = Date.parse(v);
    if(Number.isNaN(ms)) {
        return 0;
    }
    return Math.floor(ms / 1000);
}

/***************************************************************
 *  Inverse of to_epoch_secs(): an epoch (secs) as the LOCAL wall-clock
 *  string a `datetime-local` input takes ("YYYY-MM-DDTHH:MM"). Used to
 *  preload the form when editing an open card's conditions.
 ***************************************************************/
function epoch_to_local_input(secs)
{
    if(!secs) {
        return "";
    }
    let d = new Date(secs * 1000);
    let pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/***************************************************************
 *  Build the Rows-options form: the server-side match conditions
 *  forwarded to `open-iterator` (all optional; blank = the full key).
 *
 *  `match_cond` preloads the fields (editing the conditions of an open
 *  card); `editing` only swaps the confirm button (open a new card vs
 *  apply to this one) — the fields are the same either way.
 *  Returns {$box, inputs, $open}.
 ***************************************************************/
function build_rows_options_form(match_cond, editing)
{
    let mc = match_cond || {};

    let mk_input = (cls, type, ph, val) => createElement2(
        ["input", {class: `input ${cls}`, type: type, placeholder: ph || "",
                   value: (val === 0 || val === undefined || val === null) ? "" : String(val)}]);

    let inputs = {
        from_t:      mk_input("TRANGER_OPT_FROM_T",      "datetime-local", "",
                        epoch_to_local_input(mc.from_t)),
        to_t:        mk_input("TRANGER_OPT_TO_T",        "datetime-local", "",
                        epoch_to_local_input(mc.to_t)),
        from_rowid:  mk_input("TRANGER_OPT_FROM_ROWID",  "number", t("1-based; negative = from end"),
                        mc.from_rowid),
        to_rowid:    mk_input("TRANGER_OPT_TO_ROWID",    "number", t("0 = last"),
                        mc.to_rowid),
        mask_set:    mk_input("TRANGER_OPT_MASK_SET",    "number", t("user_flag bits"),
                        mc.user_flag_mask_set),
        mask_notset: mk_input("TRANGER_OPT_MASK_NOTSET", "number", t("user_flag bits"),
                        mc.user_flag_mask_notset)
    };

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
                ["div", {class: "columns is-mobile is-multiline"},
                    [
                        ["div", {class: "column is-half"}, [field("from time", inputs.from_t)]],
                        ["div", {class: "column is-half"}, [field("to time", inputs.to_t)]],
                        ["div", {class: "column is-half"}, [field("from rowid", inputs.from_rowid)]],
                        ["div", {class: "column is-half"}, [field("to rowid", inputs.to_rowid)]],
                        ["div", {class: "column is-half"}, [field("user-flag mask set", inputs.mask_set)]],
                        ["div", {class: "column is-half"}, [field("user-flag mask clear", inputs.mask_notset)]]
                    ]
                ],
                ["div", {class: "has-text-right mt-2 TRANGER_OPT_ACTIONS"}, [$open]]
            ]
        ]);

    return {$box: $box, inputs: inputs, $open: $open};
}

/***************************************************************
 *  Collect a match_cond from the Rows-options form: only fields the
 *  user actually set (0/blank = unset), so the iterator applies exactly
 *  what was asked.
 ***************************************************************/
function collect_rows_match_cond(inputs)
{
    let mc = {};
    let ft = to_epoch_secs(inputs.from_t.value);
    if(ft) {
        mc.from_t = ft;
    }
    let tt = to_epoch_secs(inputs.to_t.value);
    if(tt) {
        mc.to_t = tt;
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
    return mc;
}

/***************************************************************
 *  Open the Rows-options dialog for `key`. Confirming closes the options
 *  dialog and opens the Rows card with the chosen match_cond; the Keys
 *  picker window stays open (its Rows button turns active).
 ***************************************************************/
function open_rows_options(gobj, key)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        return;
    }
    let form = build_rows_options_form();
    let opt_modal = yui_shell_show_modal(shell, form.$box, {
        dialog: true,
        logical_class: "TRANGER_ROWS_OPTIONS",
        title:  `${key} · ${t("rows")}`,
        t:      t
    });
    form.$open.addEventListener("click", () => {
        let match_cond = collect_rows_match_cond(form.inputs);
        if(opt_modal && typeof opt_modal.close === "function") {
            opt_modal.close();
        }
        add_card(gobj, key, "rows", match_cond);
    });
}

/***************************************************************
 *  Edit the match conditions of an OPEN Rows card: the same dialog,
 *  preloaded with what the card is currently showing. Confirming applies
 *  them in place (the card stays, its data is re-fetched).
 ***************************************************************/
function open_card_options(gobj, card)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        return;
    }
    let form = build_rows_options_form(card.match_cond, true);
    let opt_modal = yui_shell_show_modal(shell, form.$box, {
        dialog: true,
        logical_class: "TRANGER_ROWS_OPTIONS",
        title:  `${card.key} · ${t("rows")}`,
        t:      t
    });
    form.$open.addEventListener("click", () => {
        let match_cond = collect_rows_match_cond(form.inputs);
        if(opt_modal && typeof opt_modal.close === "function") {
            opt_modal.close();
        }
        apply_card_match_cond(gobj, card, match_cond);
    });
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
    let priv = gobj.priv;
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }

    close_iterator(gobj, card.iterator_id);

    card.match_cond = match_cond || {};
    card.iterator_id = `spa-${priv.tok}-${++priv.iter_seq}`;

    let iter_kw = {
        service:     gobj_read_str_attr(gobj, "treedb_name"),
        iterator_id: card.iterator_id,
        topic_name:  card.topic,
        key:         card.key
    };
    Object.assign(iter_kw, card.match_cond);
    let ret = gobj_command(remote, "open-iterator", iter_kw, gobj);
    if(ret) {
        log_error(ret);
        return;
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
        /*  destroyed mid-flight  */
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
    if(!priv.cur_topic || (mode !== "rows" && mode !== "live")) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
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
        tabulator: null, $el: null, $count: null, match_cond: match_cond || {},
        live_max: cfg ? treedb_config_get_live_max(cfg) : LIVE_MAX_DEFAULT,
        iterator_id: null, rt_id: null, subscribed: false,
        built: false, seeded: false, pending: []
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
        close_card(gobj, card);
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
            open_card_options(gobj, card);
        });
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
            rearm_rows_card(gobj, card);    /*  the iterator is a snapshot  */
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
            if(card.tabulator) {
                card.tabulator.clearData();
                update_live_count(card);
            }
        });
    }

    let head_children = [];
    if(mode === "live") {
        head_children.push(
            ["span", {class: "TRANGER_LIVE_DOT ml-1 mr-2 is-flex-shrink-0",
                      title: t("live")}, ""]);
    }
    head_children.push(["span", {class: "TRANGER_CARD_TITLE"}, `${key} · ${t(mode)}`]);

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
    let priv = gobj.priv;
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    let service = gobj_read_str_attr(gobj, "treedb_name");
    card.iterator_id = `spa-${priv.tok}-${++priv.iter_seq}`;

    /*  Arm the iterator FIRST; the Tabulator's first get-page (fired on
     *  build) is processed after it by the remote's FIFO command order.
     *  The chosen match_cond pre-filters the index, so total_rows / paging
     *  already reflect it.  */
    let iter_kw = {
        service:     service,
        iterator_id: card.iterator_id,
        topic_name:  card.topic,
        key:         card.key
    };
    Object.assign(iter_kw, card.match_cond || {});
    let ret = gobj_command(remote, "open-iterator", iter_kw, gobj);
    if(ret) {
        log_error(ret);
    }

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
        show_record_dialog(gobj, row.getData().__rec, card.key);
    });
    /*  Re-measure once built + laid out (autoResize handles later window
     *  resizes), so the columns fit the card instead of a stale width.  */
    table.on("tableBuilt", function() {
        requestAnimationFrame(function() {
            try {
                table.redraw(true);
            } catch(e) {
                /*  destroyed before the frame  */
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
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    let service = gobj_read_str_attr(gobj, "treedb_name");
    card.rt_id = `spa-${priv.tok}-rt-${++priv.iter_seq}`;

    let table = new Tabulator($table, {
        height:         CARD_TABLE_HEIGHT,
        layout:         "fitDataFill",
        placeholder:    t("waiting for records"),
        columnDefaults: {headerHozAlign: "left", headerSort: false, resizable: true},
        columns:        [],
        data:           []
    });
    table.on("rowClick", function(e, row) {
        show_record_dialog(gobj, row.getData().__rec, card.key);
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
                /*  destroyed before the frame  */
            }
        });
    });
    card.tabulator = table;

    /*  Arm the feed, then subscribe to its pushes.  */
    let ret = gobj_command(remote, "open-rt",
        {
            service:    service,
            rt_id:      card.rt_id,
            topic_name: card.topic,
            key:        card.key
        }, gobj);
    if(ret) {
        log_error(ret);
    }
    gobj_subscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
        {__service__: service, __filter__: {topic_name: card.topic, key: card.key}},
        gobj);
    card.subscribed = true;
}

/***************************************************************
 *  Custom Tabulator header-filter: parse a leading comparison operator
 *  from the typed term (`>=`, `<=`, `!=`, `>`, `<`, `=`) and compare —
 *  numeric when both sides parse as numbers (so `Voltage  >200` works),
 *  else string. No operator ⇒ case-insensitive substring match. Empty
 *  term ⇒ no filtering. Runs client-side over the LOADED page.
 ***************************************************************/
function op_filter(headerValue, rowValue)
{
    let term = String(headerValue === null || headerValue === undefined ? "" : headerValue).trim();
    if(!term) {
        return true;
    }
    let cell = (rowValue === null || rowValue === undefined) ? "" : rowValue;
    let m = term.match(/^(>=|<=|!=|>|<|=)\s*(.*)$/);
    if(m) {
        let op = m[1];
        let rhs = m[2].trim();
        let a = Number(cell);
        let b = Number(rhs);
        if(rhs !== "" && !Number.isNaN(a) && !Number.isNaN(b)) {
            switch(op) {
                case ">":  return a > b;
                case "<":  return a < b;
                case ">=": return a >= b;
                case "<=": return a <= b;
                case "=":  return a === b;
                case "!=": return a !== b;
                default:   return true;
            }
        }
        let s = String(cell).toLowerCase();
        let r = rhs.toLowerCase();
        switch(op) {
            case ">":  return s > r;
            case "<":  return s < r;
            case ">=": return s >= r;
            case "<=": return s <= r;
            case "=":  return s === r;
            case "!=": return s !== r;
            default:   return true;
        }
    }
    return String(cell).toLowerCase().indexOf(term.toLowerCase()) !== -1;
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
            if(d.field === "t") {
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
 *  Feed a live record into a card: buffer until the table is built, then
 *  prepend (newest on top) and trim to the card's live_max.
 ***************************************************************/
function push_live_record(card, record)
{
    if(!card.tabulator) {
        return;
    }
    let row = flatten_record(record);
    if(!card.built) {
        card.pending.push(row);
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
            /*  table gone  */
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
                        /*  gone  */
                    }
                }
            }
        }
        update_live_count(card);
    }).catch(function() {
        /*  table torn down mid-append  */
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
        return;     /*  table gone  */
    }
    card.$count.textContent = `${n} / ${card.live_max}`;
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
    if(card.tabulator) {
        try {
            card.tabulator.destroy();
        } catch(e) {
            /*  already gone  */
        }
        card.tabulator = null;
    }
    if(card.$el && card.$el.parentNode) {
        card.$el.parentNode.removeChild(card.$el);
    }
    if(card.mode === "live") {
        if(card.subscribed) {
            let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
            if(remote) {
                gobj_unsubscribe_event(remote, "EV_TRANGER_RECORD_ADDED",
                    {__service__: gobj_read_str_attr(gobj, "treedb_name"),
                     __filter__: {topic_name: card.topic, key: card.key}}, gobj);
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
 ***************************************************************/
function close_iterator(gobj, iterator_id)
{
    if(!iterator_id) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    gobj_command(remote, "close-iterator",
        {service: service, iterator_id: iterator_id}, gobj);
}

/***************************************************************
 *  Fire-and-forget close of a server-side realtime feed.
 ***************************************************************/
function close_rt(gobj, rt_id)
{
    if(!rt_id) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
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
        let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
        if(!remote) {
            reject(new Error("No transport"));
            return;
        }
        let service = gobj_read_str_attr(gobj, "treedb_name");
        let req_id = `q${++priv.req_seq}`;
        priv.pending[req_id] = {resolve: resolve, reject: reject};

        let from_rowid = (page - 1) * size + 1;
        let ret = gobj_command(remote, "get-page",
            {
                service:     service,
                iterator_id: card.iterator_id,
                from_rowid:  from_rowid,
                limit:       size,
                __md_command__: {req_id: req_id}   /*  echoed back for correlation  */
            }, gobj);
        if(ret) {
            delete priv.pending[req_id];
            reject(new Error(String(ret)));
        }
    });
}

/***************************************************************
 *  Flatten a tranger record for the records table: metadata columns
 *  (t formatted, rowid) first, then the record's own fields; the full
 *  record is kept in __rec (no column) for the row dialog.
 ***************************************************************/
function flatten_record(r)
{
    let md = (r && r.__md_tranger__) || {};
    let row = {
        t:     fmt_ts(md.t),
        rowid: md.g_rowid !== undefined ? md.g_rowid : (md.rowid || "")
    };
    if(r && typeof r === "object") {
        for(let k in r) {
            if(k === "__md_tranger__" || k === "t" || k === "rowid") {
                continue;
            }
            let v = r[k];
            row[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
        }
    }
    row.__rec = r;
    return row;
}

/***************************************************************
 *  Format a tranger timestamp (seconds) for the t column.
 ***************************************************************/
function fmt_ts(secs)
{
    if(!secs) {
        return "";
    }
    try {
        let d = new Date(secs * 1000);
        return d.toISOString().replace("T", " ").slice(0, 19);
    } catch(e) {
        return String(secs);
    }
}

/***************************************************************
 *  Full record as JSON in the shell's adaptive dialog.
 ***************************************************************/
function show_record_dialog(gobj, record, key)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        return;
    }
    let $pre = createElement2(
        ["pre", {class: "is-size-7 TRANGER_RECORD_JSON",
                 style: "max-width:80vw; max-height:70vh; overflow:auto;"}, ""]);
    $pre.textContent = JSON.stringify(record, null, 4);
    yui_shell_show_modal(shell, $pre, {
        dialog: true,
        logical_class: "TRANGER_RECORD_DIALOG",
        title:  `${gobj.priv.cur_topic} · ${key}`,
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
        let pend = req_id ? priv.pending[req_id] : null;
        if(pend) {
            delete priv.pending[req_id];
            if(result < 0) {
                pend.reject(new Error(comment || "get-page failed"));
            } else {
                let page = data || {};
                let rows = (Array.isArray(page.data) ? page.data : []).map(flatten_record);
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

    if(result < 0) {
        show_error(gobj, comment || `${command} failed`);
        return 0;
    }

    switch(command) {
        case "topics": {
            priv.topics = (Array.isArray(data) ? data : []).filter(
                (name) => typeof name === "string"
            );
            let topic = priv.pending_seg && priv.topics.includes(priv.pending_seg)
                ? priv.pending_seg
                : priv.topics[0];
            priv.pending_seg = "";
            if(topic) {
                select_topic(gobj, topic);
            } else {
                render_tabs(gobj);
                show_error(gobj, "no topics");
            }
            break;
        }

        case "list-keys": {
            let topic = kw_get_str(gobj, kw_command, "topic_name", "", 0);
            if(topic !== priv.cur_topic) {
                break;      /*  stale answer of a previous topic  */
            }
            priv.keys = Array.isArray(data) ? data : [];
            update_meta(gobj);
            /*  The picker asks for a fresh list every time it opens, so an
             *  answer that lands while it is up must repaint it.  */
            if(priv.picker_tbl) {
                try {
                    priv.picker_tbl.replaceData(priv.keys);
                } catch(e) {
                    /*  table gone  */
                }
            }
            restore_saved_views(gobj);
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
 *  The link reopened (dropped websocket, token refresh): every open card
 *  holds server-side state that no longer exists — the backend reaps the
 *  iterators and realtime feeds of a session when it dies. A Rows card
 *  would page against a dead iterator ("No records", pager collapsed) and
 *  a Live card would never see a record again. Re-arm both.
 ************************************************************/
function ac_transport_open(gobj, event, kw, src)
{
    let priv = gobj.priv;

    if(kw && kw.conn_id && kw.conn_id !== gobj_read_str_attr(gobj, "conn_id")) {
        return 0;   /*  another connection  */
    }

    if(priv.cur_topic) {
        request_keys(gobj, priv.cur_topic);
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
 *  Re-open a Rows card's iterator (new id, same match conditions) and
 *  re-fetch its page. Also what Refresh does: an iterator is a SNAPSHOT
 *  (its row index is built when it is opened), so appends made since are
 *  invisible to it — re-asking for the page would return the same rows
 *  and the same total, and Last would never reach the new records.
 ************************************************************/
function rearm_rows_card(gobj, card)
{
    let priv = gobj.priv;
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }

    /*  Drop the previous iterator: on a Refresh it is alive and would linger
     *  on the backend; after a reconnect it is already gone and the close is
     *  a harmless no-op there.  */
    close_iterator(gobj, card.iterator_id);

    card.iterator_id = `spa-${priv.tok}-${++priv.iter_seq}`;

    let iter_kw = {
        service:     gobj_read_str_attr(gobj, "treedb_name"),
        iterator_id: card.iterator_id,
        topic_name:  card.topic,
        key:         card.key
    };
    Object.assign(iter_kw, card.match_cond || {});
    let ret = gobj_command(remote, "open-iterator", iter_kw, gobj);
    if(ret) {
        log_error(ret);
        return;
    }
    if(card.tabulator) {
        try {
            card.tabulator.replaceData();
        } catch(e) {
            /*  destroyed mid-flight  */
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
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }

    close_rt(gobj, card.rt_id);      /*  no-op if the session already died  */

    card.rt_id = `spa-${priv.tok}-rt-${++priv.iter_seq}`;

    let ret = gobj_command(remote, "open-rt",
        {
            service:    gobj_read_str_attr(gobj, "treedb_name"),
            rt_id:      card.rt_id,
            topic_name: card.topic,
            key:        card.key
        }, gobj);
    if(ret) {
        log_error(ret);
    }
}

/************************************************************
 *  Parent (routing) informs the topic to restore: href's right
 *  part after '?' (same contract as C_YUI_TREEDB_TOPICS).
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
    if(priv.topics) {
        select_topic(gobj, seg);
    } else {
        priv.pending_seg = seg;
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
                push_live_record(card, record);
            }
            continue;
        }
        if(card.topic === topic && card.key === key) {
            push_live_record(card, record);
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
        /*  table gone  */
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

    const states = [
        ["ST_IDLE", [
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_TRANGER_RECORD_ADDED", ac_tranger_record_added,  null],
            ["EV_ON_OPEN",              ac_transport_open,        null],
            ["EV_SHOW",                 ac_show,                  null]
        ]]
    ];

    const event_types = [
        ["EV_MT_COMMAND_ANSWER",    event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_TRANGER_RECORD_ADDED", event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_ON_OPEN",              0],
        ["EV_TOPIC_SELECTED",       event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_SHOW",                 0]
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
