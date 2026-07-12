/***********************************************************************
 *          c_tranger_view.js
 *
 *      C_TRANGER_VIEW — read-only browser of a remote C_TRANGER
 *      service: its topics and, per topic, a two-level keys→records
 *      browser with real server-side cursor pagination.
 *
 *      Hosted by C_TREEDB_VIEW exactly like the treedb editors (same
 *      contract: `gobj_remote_yuno` is the live transport and
 *      `treedb_name` is the remote service name). Data flow:
 *
 *        - mt_start → `topics` command → one Bulma tab per topic;
 *        - selecting a topic → `list-keys` → the left keys pane (each
 *          key with its record count), auto-selecting the first key;
 *        - selecting a key → `open-iterator` (a per-key row index, no
 *          upfront load) + `get-page` (first page) → the records
 *          Tabulator plus a page navigator (⏮ ◀ page N/M ▶ ⏭). The
 *          iterator stays open server-side; paging just issues
 *          `get-page from_rowid=(n-1)*limit+1`. The previous iterator is
 *          closed on key/topic change and on stop (`close-iterator`).
 *          No polling (Yuneta rule).
 *        - the keys filter narrows the keys list client-side; a row
 *          click opens the full record as JSON in the shell's adaptive
 *          dialog; "Refresh" reloads the current page on demand.
 *
 *      `open-iterator` and `get-page` are sent back-to-back — the remote
 *      processes commands FIFO over the one connection, so the iterator
 *      exists by the time the page read runs, saving a round trip.
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

/*  Records fetched per page (per-key cursor window).  */
const PAGE_SIZE = 100;

/*  At most this many record fields become table columns; the rest
 *  stay reachable through the row's JSON dialog.  */
const MAX_FIELD_COLUMNS = 8;


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
    cur_key:     "",     /*  selected key  */
    keys_filter: "",     /*  client-side keys-list filter term  */
    iterator_id: null,   /*  currently open server-side iterator id, or null  */
    iter_seq:    0,      /*  iterator_id uniquifier  */
    total_rows:  0,      /*  rows of the current key (from get-page)  */
    pages:       0,      /*  number of pages of the current key  */
    cur_page:    1,      /*  1-based current page  */
    limit:       PAGE_SIZE,
    tabulator:   null,
    $tabs:       null,
    $keys:       null,   /*  keys list mount point  */
    $keys_search:null,   /*  keys filter input  */
    $meta:       null,   /*  record-count / page line  */
    $error:      null,   /*  inline load-error banner  */
    $table:      null,   /*  Tabulator mount point  */
    $pagenav:    null,   /*  page navigator bar  */
    $prev:       null,
    $next:       null,
    $pageinfo:   null,
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
    priv.cur_key = "";
    priv.keys_filter = "";
    priv.iterator_id = null;
    priv.iter_seq = 0;
    priv.total_rows = 0;
    priv.pages = 0;
    priv.cur_page = 1;
    priv.limit = PAGE_SIZE;

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
    let priv = gobj.priv;
    close_iterator(gobj);
    if(priv.tabulator) {
        try {
            priv.tabulator.destroy();
        } catch(e) {
            /*  already gone  */
        }
        priv.tabulator = null;
    }
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
 *  Build the container: topic tabs + toolbar + a two-pane body
 *  (keys list | records table + page navigator).
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    let $tabs = createElement2(
        ["ul", {class: "TRANGER_TOPIC_TABS"}, []]);
    priv.$tabs = $tabs;

    let $refresh = createElement2(
        ["button", {class: "button TRANGER_REFRESH",
                    title: "Refresh", "aria-label": "Refresh"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "refresh"}, "Refresh"]
            ]
        ]);
    $refresh.addEventListener("click", () => {
        load_page(gobj, gobj.priv.cur_page);
    });

    let $meta = createElement2(
        ["span", {class: "is-size-7 has-text-grey ml-2 TRANGER_META"}, ""]);
    priv.$meta = $meta;

    /*
     *  Keys filter: a live, as-you-type substring filter over the keys
     *  ALREADY loaded in the left pane (client-side — never hits the
     *  backend). The ✕ clears it.
     */
    let $keys_search = createElement2(
        ["input", {class: "input is-small TRANGER_KEYS_SEARCH_INPUT",
                   type: "search", placeholder: t("filter keys"),
                   title: t("filter the loaded keys"),
                   "aria-label": t("filter the loaded keys")}]);
    priv.$keys_search = $keys_search;
    $keys_search.addEventListener("input", () => {
        gobj.priv.keys_filter = gobj.priv.$keys_search.value || "";
        render_keys(gobj);
    });

    let $error = createElement2(
        ["div", {class: "notification is-danger is-light is-hidden TRANGER_ERROR"}, ""]);
    priv.$error = $error;

    /*
     *  Left pane: keys list (own vertical scroll).
     */
    let $keys = createElement2(
        ["div", {class: "TRANGER_KEYS_LIST",
                 style: "flex:1 1 auto; min-height:0; overflow-y:auto;"}, []]);
    priv.$keys = $keys;

    let $keys_pane = createElement2(
        ["div", {class: "TRANGER_KEYS_PANE mr-3",
                 style: "flex:0 0 240px; display:flex; flex-direction:column; " +
                        "min-height:0; min-width:0;"},
            [
                ["div", {class: "TRANGER_KEYS_HEAD mb-2"}, [$keys_search]],
                $keys
            ]
        ]);

    /*
     *  Right pane: records table + page navigator.
     */
    let $table = createElement2(
        ["div", {class: "TRANGER_RECORDS", style: "flex:1 1 auto; min-height:0;"}, []]);
    priv.$table = $table;

    let $pagenav = build_pagenav(gobj);

    let $records_pane = createElement2(
        ["div", {class: "TRANGER_RECORDS_PANE",
                 style: "flex:1 1 300px; display:flex; flex-direction:column; " +
                        "min-height:0; min-width:0;"},
            [$table, $pagenav]
        ]);

    let $body = createElement2(
        ["div", {class: "TRANGER_BODY",
                 style: "flex:1 1 auto; min-height:0; display:flex; " +
                        "flex-wrap:wrap; align-items:stretch;"},
            [$keys_pane, $records_pane]
        ]);

    let $container = createElement2(
        ["div", {class: "p-3", gclass: "C_TRANGER_VIEW",
                 style: "height:100%; display:flex; flex-direction:column;"},
            [
                ["div", {class: "tabs is-boxed mb-2 TRANGER_TOPICS"}, [$tabs]],
                ["div", {class: "is-flex is-align-items-center mb-2 TRANGER_TOOLBAR"},
                    [$refresh, $meta]],
                $error,
                $body
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  The page navigator bar: ◀ page N/M ▶.
 ***************************************************************/
function build_pagenav(gobj)
{
    let priv = gobj.priv;

    function nav_button(cls, icon, title, i18n_key, handler) {
        let $b = createElement2(
            ["button", {class: "button is-small " + cls,
                        title: t(title), "aria-label": t(title),
                        "data-i18n-title": i18n_key, "data-i18n-aria-label": i18n_key},
                [["span", {class: "icon"}, [["i", {class: icon}]]]]
            ]);
        $b.addEventListener("click", handler);
        return $b;
    }

    let $prev = nav_button("TRANGER_PAGE_PREV", "yi-arrow-left",
        "Previous page", "previous page", () => {
            go_page(gobj, gobj.priv.cur_page - 1);
        });
    let $next = nav_button("TRANGER_PAGE_NEXT", "yi-arrow-right",
        "Next page", "next page", () => {
            go_page(gobj, gobj.priv.cur_page + 1);
        });
    priv.$prev = $prev;
    priv.$next = $next;

    let $pageinfo = createElement2(
        ["span", {class: "is-size-7 has-text-grey mx-2 TRANGER_PAGE_INFO"}, ""]);
    priv.$pageinfo = $pageinfo;

    let $pagenav = createElement2(
        ["div", {class: "is-flex is-align-items-center mt-2 TRANGER_PAGENAV",
                 style: "flex:0 0 auto;"},
            [$prev, $pageinfo, $next]
        ]);
    priv.$pagenav = $pagenav;
    return $pagenav;
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
 *  record counts) for the left pane.
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
        {service: service, topic_name: topic_name}, gobj);
    if(ret) {
        log_error(ret);
    }
}

/***************************************************************
 *  Close the currently open server-side iterator, if any. Fire and
 *  forget — the answer is not needed (the backend also closes iterators
 *  at its own destroy).
 ***************************************************************/
function close_iterator(gobj)
{
    let priv = gobj.priv;
    if(!priv.iterator_id) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(remote) {
        let service = gobj_read_str_attr(gobj, "treedb_name");
        gobj_command(remote, "close-iterator",
            {service: service, iterator_id: priv.iterator_id}, gobj);
    }
    priv.iterator_id = null;
}

/***************************************************************
 *  Open a fresh iterator for `key` and request its first page. The two
 *  commands are sent back-to-back (the remote processes them FIFO).
 ***************************************************************/
function open_key(gobj, key)
{
    let priv = gobj.priv;
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");

    close_iterator(gobj);

    let iterator_id = `spa-${++priv.iter_seq}`;
    priv.iterator_id = iterator_id;
    priv.cur_page = 1;
    priv.total_rows = 0;
    priv.pages = 0;

    let ret = gobj_command(remote, "open-iterator",
        {
            service:     service,
            iterator_id: iterator_id,
            topic_name:  priv.cur_topic,
            key:         key
        }, gobj);
    if(ret) {
        log_error(ret);
    }

    request_page(gobj, iterator_id, 1);
}

/***************************************************************
 *  Command to remote service: read one page of an open iterator.
 ***************************************************************/
function request_page(gobj, iterator_id, page)
{
    let priv = gobj.priv;
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    let from_rowid = (page - 1) * priv.limit + 1;

    let ret = gobj_command(remote, "get-page",
        {
            service:     service,
            iterator_id: iterator_id,
            from_rowid:  from_rowid,
            limit:       priv.limit,
            page:        page      /*  echoed back for correlation  */
        }, gobj);
    if(ret) {
        log_error(ret);
    }
}

/***************************************************************
 *  Re-read a page of the CURRENT key (Refresh / page-nav).
 ***************************************************************/
function load_page(gobj, page)
{
    let priv = gobj.priv;
    if(!priv.iterator_id) {
        return;
    }
    request_page(gobj, priv.iterator_id, page);
}

/***************************************************************
 *  Navigate to a page, clamped to [1, pages].
 ***************************************************************/
function go_page(gobj, page)
{
    let priv = gobj.priv;
    if(!priv.iterator_id || priv.pages <= 0) {
        return;
    }
    if(page < 1) {
        page = 1;
    }
    if(page > priv.pages) {
        page = priv.pages;
    }
    if(page === priv.cur_page) {
        return;
    }
    request_page(gobj, priv.iterator_id, page);
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
        let $a = createElement2(["a", {}, topic]);
        $a.addEventListener("click", (ev) => {
            ev.preventDefault();
            select_topic(gobj, topic);
        });
        let $li = createElement2(
            ["li", {class: topic === priv.cur_topic ? "is-active" : ""}, [$a]]);
        $tabs.appendChild($li);
    }
}

/***************************************************************
 *  Select a topic: mark its tab, load its keys, publish the selection
 *  for the URL deep link.
 ***************************************************************/
function select_topic(gobj, topic_name)
{
    let priv = gobj.priv;
    if(!topic_name || !(priv.topics || []).includes(topic_name)) {
        return;
    }
    close_iterator(gobj);
    priv.cur_topic = topic_name;
    priv.keys = null;
    priv.cur_key = "";
    priv.keys_filter = "";
    if(priv.$keys_search) {
        priv.$keys_search.value = "";
    }
    priv.cur_page = 1;
    priv.total_rows = 0;
    priv.pages = 0;
    render_tabs(gobj);
    render_keys(gobj);      /*  shows "loading" until list-keys answers  */
    clear_records(gobj);
    update_pagenav(gobj);
    show_error(gobj, "");
    request_keys(gobj, topic_name);
    gobj_publish_event(gobj, "EV_TOPIC_SELECTED", {topic: topic_name});
}

/***************************************************************
 *  Select a key: mark it active, open its iterator and load page 1.
 ***************************************************************/
function select_key(gobj, key)
{
    let priv = gobj.priv;
    if(!key) {
        return;
    }
    priv.cur_key = key;
    render_keys(gobj);
    show_error(gobj, "");
    open_key(gobj, key);
}

/***************************************************************
 *  Paint the keys list (filtered client-side by keys_filter), each key
 *  showing its record count. Click selects.
 ***************************************************************/
function render_keys(gobj)
{
    let priv = gobj.priv;
    let $keys = priv.$keys;
    if(!$keys) {
        return;
    }
    while($keys.firstChild) {
        $keys.removeChild($keys.firstChild);
    }

    let term = (priv.keys_filter || "").trim().toLowerCase();
    let list = (priv.keys || []).filter((entry) => {
        if(!term) {
            return true;
        }
        return String(entry.key).toLowerCase().indexOf(term) !== -1;
    });

    if(list.length === 0) {
        $keys.appendChild(createElement2(
            ["div", {class: "has-text-grey is-size-7 p-2 TRANGER_KEYS_EMPTY"},
                priv.keys === null ? t("loading") : t("no keys")]));
        return;
    }

    for(let entry of list) {
        let key = String(entry.key);
        let $count = createElement2(
            ["span", {class: "tag is-light ml-2 TRANGER_KEY_COUNT"},
                String(entry.records)]);
        let $item = createElement2(
            ["a", {class: "panel-block is-justify-content-space-between " +
                          "TRANGER_KEY_ITEM" +
                          (key === priv.cur_key ? " is-active has-background-link-light" : ""),
                   title: key},
                [
                    ["span", {class: "TRANGER_KEY_NAME",
                              style: "overflow:hidden; text-overflow:ellipsis; " +
                                     "white-space:nowrap;"}, key],
                    $count
                ]
            ]);
        $item.addEventListener("click", (ev) => {
            ev.preventDefault();
            select_key(gobj, key);
        });
        $keys.appendChild($item);
    }
}

/***************************************************************
 *  Enable/disable the page-nav buttons and refresh the page line.
 ***************************************************************/
function update_pagenav(gobj)
{
    let priv = gobj.priv;
    let has = priv.pages > 0;
    let at_first = priv.cur_page <= 1;
    let at_last = priv.cur_page >= priv.pages;

    if(priv.$prev) {
        priv.$prev.disabled = !has || at_first;
    }
    if(priv.$next) {
        priv.$next.disabled = !has || at_last;
    }
    if(priv.$pageinfo) {
        priv.$pageinfo.textContent = has
            ? `${t("page")} ${priv.cur_page}/${priv.pages}`
            : "";
    }
    update_meta(gobj);
}

/***************************************************************
 *  Meta line: current key, total records, page window.
 ***************************************************************/
function update_meta(gobj)
{
    let priv = gobj.priv;
    if(!priv.$meta) {
        return;
    }
    if(!priv.cur_key) {
        priv.$meta.textContent = "";
        return;
    }
    let text = `${priv.cur_key} · ${priv.total_rows} ${t("records")}`;
    if(priv.pages > 0) {
        text += ` · ${priv.limit}/${t("page")}`;
    }
    priv.$meta.textContent = text;
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
 *  Tear down the records table (topic/key switch).
 ***************************************************************/
function clear_records(gobj)
{
    let priv = gobj.priv;
    if(priv.tabulator) {
        try {
            priv.tabulator.destroy();
        } catch(e) {
            /*  already gone  */
        }
        priv.tabulator = null;
    }
}

/***************************************************************
 *  Build/refresh the records Tabulator with generic columns: metadata
 *  first (t, g_rowid from __md_tranger__), then the record's own fields
 *  (union over the page's records, capped — the row dialog always shows
 *  the full JSON).
 ***************************************************************/
function render_records(gobj, records)
{
    let priv = gobj.priv;

    let fields = [];
    for(let r of records) {
        if(!r || typeof r !== "object") {
            continue;
        }
        for(let k in r) {
            if(k === "__md_tranger__" || fields.includes(k)) {
                continue;
            }
            fields.push(k);
        }
        if(fields.length >= MAX_FIELD_COLUMNS) {
            break;
        }
    }
    fields = fields.slice(0, MAX_FIELD_COLUMNS);

    let rows = records.map((r, i) => {
        let md = (r && r.__md_tranger__) || {};
        let row = {
            _idx:   i,
            _t:     md.t || 0,
            _rowid: md.g_rowid !== undefined ? md.g_rowid : (md.rowid || ""),
            _rec:   r
        };
        for(let f of fields) {
            let v = r ? r[f] : undefined;
            row["f_" + f] = (v !== null && typeof v === "object")
                ? JSON.stringify(v)
                : v;
        }
        return row;
    });

    let columns = [
        {title: "t", field: "_t", minWidth: 150, widthGrow: 1, sorter: "number",
            formatter: (cell) => fmt_ts(cell.getValue())},
        {title: "rowid", field: "_rowid", width: 80, sorter: "number"}
    ];
    for(let f of fields) {
        columns.push({title: f, field: "f_" + f, minWidth: 100, widthGrow: 1});
    }

    clear_records(gobj);
    let table = new Tabulator(priv.$table, {
        layout:         "fitColumns",
        height:         "100%",
        placeholder:    t("no records"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        initialSort:    [{column: "_rowid", dir: "asc"}],
        columns:        columns,
        data:           rows
    });
    table.on("rowClick", function(e, row) {
        show_record_dialog(gobj, row.getData()._rec);
    });
    priv.tabulator = table;
}

/***************************************************************
 *  Full record as JSON in the shell's adaptive dialog.
 ***************************************************************/
function show_record_dialog(gobj, record)
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
        title:  `${gobj.priv.cur_topic} · ${gobj.priv.cur_key}`,
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
            render_keys(gobj);
            if(priv.keys.length > 0) {
                select_key(gobj, String(priv.keys[0].key));
            } else {
                clear_records(gobj);
                update_pagenav(gobj);
            }
            break;
        }

        case "open-iterator": {
            /*  Nothing to render here — the paired get-page carries the
             *  page. Only surfaces a late error (handled above).  */
            break;
        }

        case "get-page": {
            let iterator_id = kw_get_str(gobj, kw_command, "iterator_id", "", 0);
            if(iterator_id !== priv.iterator_id) {
                break;      /*  stale answer of a previous key/iterator  */
            }
            let page = data || {};
            priv.total_rows = page.total_rows || 0;
            priv.pages = page.pages || 0;
            /*  the requested page was echoed back for correlation  */
            let asked = (kw_command && kw_command.page) || 1;
            priv.cur_page = asked;
            render_records(gobj, Array.isArray(page.data) ? page.data : []);
            update_pagenav(gobj);
            break;
        }

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
            ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
            ["EV_SHOW",              ac_show,              null]
        ]]
    ];

    const event_types = [
        ["EV_MT_COMMAND_ANSWER", event_flag_t.EVF_PUBLIC_EVENT],
        ["EV_TOPIC_SELECTED",    event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_SHOW",              0]
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
