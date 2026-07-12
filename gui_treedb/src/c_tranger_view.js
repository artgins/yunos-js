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
 *        - the toolbar "Keys" button opens a modal sheet with a Tabulator
 *          of the topic's keys (sortable by record count, header-filter),
 *          each row offering "Rows" (and, later, "Live") — picking one
 *          adds a card to the dashboard and closes the picker;
 *        - a "Rows" card is a records Tabulator using its NATIVE remote
 *          pagination: `open-iterator` builds the key's server-side row
 *          index and Tabulator's `ajaxRequestFunc` pulls each page via
 *          `get-page` (bridged to the async gobj_command answer with a
 *          per-request Promise). The iterator is closed (`close-iterator`)
 *          when the card, topic or view goes away;
 *        - a row click opens the full record JSON in the shell dialog.
 *          No polling (Yuneta rule). "Live" (realtime push) is deferred
 *          to backend Phase C (EVF_PUBLIC_EVENT on EV_TRANGER_RECORD_ADDED).
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
    createElement2, refresh_language,
    msg_iev_get_stack,
    kw_get_str, kw_get_dict,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {yui_shell_show_modal} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TRANGER_VIEW";

/*  Records per page in a Rows card (Tabulator's paginationSize).  */
const PAGE_SIZE = 100;

/*  Max rows kept in a Live card's rolling buffer (newest on top).  */
const LIVE_MAX = 500;

/*  Fixed table height inside a card (its own pager sits below).  */
const CARD_TABLE_HEIGHT = "320px";

/*  Injected once (inline styles cannot carry these); scoped by the
 *  gclass class. Card chrome + the scrollable dashboard column.  */
const STYLE_ID = "C_TRANGER_VIEW_style";
const STYLE_CSS = `
.C_TRANGER_VIEW .TRANGER_DASHBOARD {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
}
.C_TRANGER_VIEW .TRANGER_CARD { margin-bottom: 0.75rem; }
.C_TRANGER_VIEW .TRANGER_CARD_HEAD {
    border-bottom: 1px solid var(--bulma-border, #dbdbdb);
}
.C_TRANGER_VIEW .TRANGER_CARD_TITLE {
    flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; font-weight: 600;
}
.C_TRANGER_VIEW .TRANGER_CARD_SEARCH { flex: 1 1 auto; min-width: 80px; }
.TRANGER_LIVE_DOT {
    display: inline-block; width: 0.55em; height: 0.55em;
    border-radius: 50%; background: #48c774; vertical-align: middle;
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
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",       0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_POINTER,  "gobj_remote_yuno", 0,  null,  "Live transport (C_IEVENT_CLI)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name",      0,  "",    "Remote C_TRANGER service name"),
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
    request_topics(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    close_all_cards(gobj);
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

    let $dashboard = createElement2(
        ["div", {class: "TRANGER_DASHBOARD"}, [$empty]]);
    priv.$dashboard = $dashboard;

    let $container = createElement2(
        ["div", {class: "p-3", gclass: "C_TRANGER_VIEW",
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
 *  Keys picker: a modal sheet with a Tabulator of the topic's keys
 *  (sorted by record count, header-filtered). Each row offers "Rows"
 *  (opens a card) and a disabled "Live" (backend Phase C).
 ***************************************************************/
function open_keys_picker(gobj)
{
    let priv = gobj.priv;
    if(!priv.cur_topic) {
        return;
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        return;
    }

    let $tbl = createElement2(["div", {class: "TRANGER_KEYS_TABLE"}, []]);
    let $box = createElement2(
        ["div", {class: "TRANGER_KEYS_PICKER",
                 style: "width:min(92vw, 640px); max-width:100%;"}, [$tbl]]);

    /*  on_close fires on every dismiss path (button, X, background,
     *  escape) — release the picker table there so it never leaks.  */
    let picker = null;
    let modal = yui_shell_show_modal(shell, $box, {
        dialog: true,
        title:  `${priv.cur_topic} · ${t("keys")}`,
        t:      t,
        on_close: () => {
            if(picker) {
                try {
                    picker.destroy();
                } catch(e) {
                    /*  already gone  */
                }
                picker = null;
            }
        }
    });

    /*  The modal content is mounted synchronously, so the Tabulator can
     *  build against a live element right away.  */
    picker = new Tabulator($tbl, {
        height:         "min(60vh, 460px)",
        layout:         "fitColumns",
        placeholder:    t("no keys"),
        pagination:     true,
        paginationSize: 15,
        paginationSizeSelector: [15, 30, 50, 100],
        initialSort:    [{column: "records", dir: "desc"}],
        data:           priv.keys || [],
        columns: [
            {title: t("key"), field: "key", minWidth: 150,
                headerFilter: "input"},
            {title: t("records"), field: "records", width: 110, hozAlign: "right",
                sorter: "number"},
            {title: t("actions"), field: "_act", headerSort: false, width: 160,
                formatter: (cell) => build_key_actions(gobj, cell, modal)}
        ]
    });

    /*
     *  The modal lays out AFTER this synchronous build, so Tabulator's
     *  first width measurement can be the full-width layer, not the box —
     *  fitColumns then overshoots (a too-wide `key` column + horizontal
     *  scroll). Re-measure once the table is initialized AND laid out.
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
 *  The per-row action buttons of the Keys picker.
 ***************************************************************/
function build_key_actions(gobj, cell, modal)
{
    let key = String(cell.getRow().getData().key);

    let $rows = createElement2(
        ["button", {class: "button is-small is-link TRANGER_KEY_ROWS", type: "button",
                    title: t("rows"), "aria-label": t("rows")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-eye"}]]],
                ["span", {i18n: "rows"}, t("rows")]
            ]
        ]);
    $rows.addEventListener("click", (ev) => {
        ev.stopPropagation();
        add_card(gobj, key, "rows");
        if(modal && typeof modal.close === "function") {
            modal.close();
        }
    });

    let $live = createElement2(
        ["button", {class: "button is-small ml-1 TRANGER_KEY_LIVE", type: "button",
                    title: t("live"), "aria-label": t("live")},
            [
                ["span", {class: "TRANGER_LIVE_DOT mr-1"}, ""],
                ["span", {i18n: "live"}, t("live")]
            ]
        ]);
    $live.addEventListener("click", (ev) => {
        ev.stopPropagation();
        add_card(gobj, key, "live");
        if(modal && typeof modal.close === "function") {
            modal.close();
        }
    });

    return createElement2(
        ["div", {class: "is-flex TRANGER_KEY_ACTIONS"}, [$rows, $live]]);
}

/***************************************************************
 *  Add a card to the dashboard for `key` in `mode`:
 *    - "rows": records Tabulator with native remote pagination
 *      (open-iterator + get-page).
 *    - "live": a rolling Tabulator fed by a realtime feed (open-rt +
 *      subscribe to EV_TRANGER_RECORD_ADDED), newest on top.
 *  One card per (key, mode); a duplicate request is ignored.
 ***************************************************************/
function add_card(gobj, key, mode)
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

    let card = {
        key: key, mode: mode, topic: priv.cur_topic,
        tabulator: null, $el: null, search: "",
        iterator_id: null, rt_id: null, subscribed: false,
        built: false, seeded: false, pending: []
    };

    let $table = createElement2(["div", {class: "TRANGER_CARD_TABLE"}, []]);

    let $search = createElement2(
        ["input", {class: "input is-small TRANGER_CARD_SEARCH_INPUT",
                   type: "search", placeholder: t("search records"),
                   title: t("search in the loaded records"),
                   "aria-label": t("search in the loaded records")}]);
    $search.addEventListener("input", () => {
        card.search = $search.value || "";
        apply_card_filter(card);
    });
    let $search_control = createElement2(
        ["div", {class: "control has-icons-left ml-2 TRANGER_CARD_SEARCH"},
            [
                $search,
                ["span", {class: "icon is-small is-left"},
                    [["i", {class: "yi-magnifying-glass"}]]]
            ]
        ]);

    let $close = createElement2(
        ["button", {class: "button is-small TRANGER_CARD_CLOSE",
                    title: t("close"), "aria-label": t("close")},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "close"}, t("close")]
            ]
        ]);
    $close.addEventListener("click", () => {
        close_card(gobj, card);
    });

    /*  mode-specific action: Rows -> Refresh (reload page), Live -> Clear.  */
    let $action;
    if(mode === "rows") {
        $action = createElement2(
            ["button", {class: "button is-small TRANGER_CARD_REFRESH",
                        title: t("refresh"), "aria-label": t("refresh")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "refresh"}, t("refresh")]
                ]
            ]);
        $action.addEventListener("click", () => {
            if(card.tabulator) {
                card.tabulator.replaceData();
            }
        });
    } else {
        $action = createElement2(
            ["button", {class: "button is-small TRANGER_CARD_CLEAR",
                        title: t("clear"), "aria-label": t("clear")},
                [
                    ["span", {class: "icon"}, [["i", {class: "yi-xmark"}]]],
                    ["span", {class: "is-hidden-mobile", i18n: "clear"}, t("clear")]
                ]
            ]);
        $action.addEventListener("click", () => {
            if(card.tabulator) {
                card.tabulator.clearData();
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
    head_children.push($search_control);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$action]]);
    head_children.push(["span", {class: "ml-2 is-flex-shrink-0"}, [$close]]);
    let $head = createElement2(
        ["div", {class: "TRANGER_CARD_HEAD is-flex is-align-items-center p-2"},
            head_children]);

    let $el = createElement2(
        ["div", {class: "box p-0 TRANGER_CARD"}, [$head, $table]]);
    card.$el = $el;

    priv.cards.push(card);
    if(priv.$empty) {
        priv.$empty.classList.add("is-hidden");
    }
    priv.$dashboard.appendChild($el);
    update_meta(gobj);

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
     *  build) is processed after it by the remote's FIFO command order.  */
    let ret = gobj_command(remote, "open-iterator",
        {
            service:     service,
            iterator_id: card.iterator_id,
            topic_name:  card.topic,
            key:         card.key
        }, gobj);
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
        paginationCounter: "rows",
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
    /*  Re-apply the head search to every page as it loads, so the filter
     *  persists while paging (remote pagination replaces the page data).  */
    table.on("dataLoaded", function() {
        apply_card_filter(card);
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
 *  (newest on top), capped at LIVE_MAX; columns are seeded from the first
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
 *  Shared column tuning for the auto/seeded columns (drop __rec, no
 *  header sort, tidy the metadata columns).
 ***************************************************************/
function tune_columns(defs)
{
    return defs
        .filter((d) => d.field !== "__rec")
        .map((d) => {
            d.headerSort = false;
            d.minWidth = 90;
            if(d.field === "rowid") {
                d.width = 80;
                d.hozAlign = "right";
            }
            if(d.field === "t") {
                d.minWidth = 150;
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
 *  prepend (newest on top) and trim to LIVE_MAX.
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
        let over = table.getDataCount() - LIVE_MAX;
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
    }).catch(function() {
        /*  table torn down mid-append  */
    });
}

/***************************************************************
 *  Close a card: close its iterator, destroy the table, unmount.
 ***************************************************************/
function close_card(gobj, card)
{
    let priv = gobj.priv;
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
}

/***************************************************************
 *  Close every open card (topic switch / stop).
 ***************************************************************/
function close_all_cards(gobj)
{
    let priv = gobj.priv;
    let cards = (priv.cards || []).slice();
    for(let card of cards) {
        close_card(gobj, card);
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
 *  Filter a card's records table client-side over the LOADED page
 *  (remote pagination holds one page in memory): match `card.search`
 *  against every displayed field. Empty term clears the filter. Re-run
 *  on every page load so the filter persists as you page.
 ***************************************************************/
function apply_card_filter(card)
{
    if(!card.tabulator) {
        return;
    }
    let term = (card.search || "").trim().toLowerCase();
    if(!term) {
        card.tabulator.clearFilter(true);
        return;
    }
    card.tabulator.setFilter(function(data) {
        for(let k in data) {
            if(k === "__rec") {
                continue;
            }
            let v = data[k];
            if(v !== null && v !== undefined &&
                String(v).toLowerCase().indexOf(term) !== -1) {
                return true;
            }
        }
        return false;
    });
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
                pend.resolve({data: rows, last_page: Math.max(1, page.pages || 1)});
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
            break;
        }

        case "open-iterator":
        case "close-iterator": {
            break;      /*  fire and forget  */
        }

        default:
            log_error(`${gobj_short_name(gobj)} Command unknown: ${command}`);
    }

    return 0;
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
    let record = kw ? kw.record : null;
    if(!record) {
        return 0;
    }
    for(let card of priv.cards) {
        if(card.mode === "live" && card.topic === topic && card.key === key) {
            push_live_record(card, record);
        }
    }
    return 0;
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
            ["EV_SHOW",                 ac_show,                  null]
        ]]
    ];

    const event_types = [
        ["EV_MT_COMMAND_ANSWER",    event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_TRANGER_RECORD_ADDED", event_flag_t.EVF_PUBLIC_EVENT],
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
