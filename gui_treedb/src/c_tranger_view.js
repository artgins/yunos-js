/***********************************************************************
 *          c_tranger_view.js
 *
 *      C_TRANGER_VIEW — read-only browser of a remote C_TRANGER
 *      service: its topics and, per topic, the stored records.
 *
 *      Hosted by C_TREEDB_VIEW exactly like the treedb editors (same
 *      contract: `gobj_remote_yuno` is the live transport — or a
 *      C_TREEDB_PROXY when the service lives in another yuno of the
 *      node — and `treedb_name` is the remote service name). Data flow:
 *
 *        - mt_start → `topics` command → one Bulma tab per topic;
 *        - selecting a topic → one-shot `open-list` (return_data=1,
 *          from_rowid=-N: the LAST N records per key) → Tabulator with
 *          generic columns derived from the records themselves
 *          (t / key / rowid + the record's own fields);
 *        - a row click opens the full record as JSON in the shell's
 *          adaptive dialog; "Load more" grows N and reloads; "Refresh"
 *          reloads on demand (no realtime events cross-yuno, and no
 *          polling — Yuneta rule).
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

/*  Records fetched per key on first load; ×4 per "Load more".  */
const FIRST_PAGE = 100;

/*  At most this many record fields become table columns; the rest
 *  stay reachable through the row's JSON dialog.  */
const MAX_FIELD_COLUMNS = 8;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",       0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_POINTER,  "gobj_remote_yuno", 0,  null,  "Live transport (or C_TREEDB_PROXY)"),
SDATA(data_type_t.DTP_STRING,   "treedb_name",      0,  "",    "Remote C_TRANGER service name"),
SDATA(data_type_t.DTP_BOOLEAN,  "system",           0,  false, "Unused (hosting contract symmetry)"),
SDATA(data_type_t.DTP_POINTER,  "$container",       0,  null,  "Root HTML element (mounted by the shell)"),
SDATA_END()
];

let PRIVATE_DATA = {
    topics:      null,   /*  topic names from the `topics` answer  */
    cur_topic:   "",     /*  selected topic  */
    pending_seg: "",     /*  topic asked via EV_SHOW before topics loaded  */
    limits:      null,   /*  topic -> current per-key fetch limit  */
    seq:         0,      /*  one-shot list_id uniquifier  */
    tabulator:   null,
    $tabs:       null,
    $meta:       null,   /*  record-count line  */
    $error:      null,   /*  inline load-error banner  */
    $table:      null,   /*  Tabulator mount point  */
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
    priv.limits = {};
    priv.seq = 0;

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
 *  Build the container: topic tabs + toolbar + records table.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    let $tabs = createElement2(
        ["ul", {class: "TRANGER_TOPIC_TABS"}, []]);
    priv.$tabs = $tabs;

    let $refresh = createElement2(
        ["button", {class: "button is-small TRANGER_REFRESH",
                    title: "Refresh", "aria-label": "Refresh"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-arrows-rotate"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "refresh"}, "Refresh"]
            ]
        ]);
    $refresh.addEventListener("click", () => {
        load_records(gobj, gobj.priv.cur_topic);
    });

    let $more = createElement2(
        ["button", {class: "button is-small TRANGER_LOAD_MORE",
                    title: "Load more", "aria-label": "Load more"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-plus"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "load more"}, "Load more"]
            ]
        ]);
    $more.addEventListener("click", () => {
        let priv_ = gobj.priv;
        if(!priv_.cur_topic) {
            return;
        }
        priv_.limits[priv_.cur_topic] =
            (priv_.limits[priv_.cur_topic] || FIRST_PAGE) * 4;
        load_records(gobj, priv_.cur_topic);
    });

    let $meta = createElement2(
        ["span", {class: "is-size-7 has-text-grey ml-2 TRANGER_META"}, ""]);
    priv.$meta = $meta;

    let $error = createElement2(
        ["div", {class: "notification is-danger is-light is-hidden TRANGER_ERROR"}, ""]);
    priv.$error = $error;

    let $table = createElement2(
        ["div", {class: "TRANGER_RECORDS", style: "flex:1 1 auto; min-height:0;"}, []]);
    priv.$table = $table;

    let $container = createElement2(
        ["div", {class: "p-3", gclass: "C_TRANGER_VIEW",
                 style: "height:100%; display:flex; flex-direction:column;"},
            [
                ["div", {class: "tabs is-small is-boxed mb-2 TRANGER_TOPICS"}, [$tabs]],
                ["div", {class: "is-flex is-align-items-center mb-2 TRANGER_TOOLBAR"},
                    [$refresh, ["span", {class: "ml-2"}, [$more]], $meta]],
                $error,
                $table
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Inline error banner (a failed `topics`/`open-list` must be seen,
 *  not swallowed — and not block the whole SPA with an app modal).
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
 *  Command to remote service
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
 *  Command to remote service: one-shot read of the LAST `limit`
 *  records per key of a topic (open-list return_data auto-closes
 *  server side — see c_tranger.c).
 ***************************************************************/
function load_records(gobj, topic_name)
{
    let priv = gobj.priv;
    if(!topic_name) {
        return;
    }
    let remote = gobj_read_pointer_attr(gobj, "gobj_remote_yuno");
    if(!remote) {
        log_error(`${gobj_short_name(gobj)}: No gobj_remote_yuno defined`);
        return;
    }
    let service = gobj_read_str_attr(gobj, "treedb_name");
    let limit = priv.limits[topic_name] || FIRST_PAGE;
    priv.limits[topic_name] = limit;

    let kw = {
        service:     service,
        list_id:     `spa-${++priv.seq}`,
        topic_name:  topic_name,
        return_data: true,
        from_rowid:  -limit,
        __md_command__: {
            topic_name: topic_name,
            limit:      limit
        }
    };
    let ret = gobj_command(remote, "open-list", kw, gobj);
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
 *  Select a topic: mark its tab, load its records, publish the
 *  selection for the URL deep link.
 ***************************************************************/
function select_topic(gobj, topic_name)
{
    let priv = gobj.priv;
    if(!topic_name || !(priv.topics || []).includes(topic_name)) {
        return;
    }
    priv.cur_topic = topic_name;
    render_tabs(gobj);
    show_error(gobj, "");
    load_records(gobj, topic_name);
    gobj_publish_event(gobj, "EV_TOPIC_SELECTED", {topic: topic_name});
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
 *  Build/refresh the records Tabulator with generic columns: metadata
 *  first (t, key/rowid from __md_tranger__), then the record's own
 *  fields (union over the loaded records, capped — the row dialog
 *  always shows the full JSON).
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

    if(priv.tabulator) {
        try {
            priv.tabulator.destroy();
        } catch(e) {
            /*  already gone  */
        }
        priv.tabulator = null;
    }
    let table = new Tabulator(priv.$table, {
        layout:         "fitColumns",
        height:         "100%",
        placeholder:    t("no records"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        initialSort:    [{column: "_t", dir: "desc"}],
        columns:        columns,
        data:           rows
    });
    table.on("rowClick", function(e, row) {
        show_record_dialog(gobj, row.getData()._rec);
    });
    priv.tabulator = table;

    if(priv.$meta) {
        priv.$meta.textContent =
            `${records.length} ${t("records")} · ${t("last")} ` +
            `${priv.limits[priv.cur_topic] || FIRST_PAGE}/${t("key")}`;
    }
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
        title:  gobj.priv.cur_topic,
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

        case "open-list": {
            let topic = kw_get_str(gobj, kw_command, "topic_name", "", 0);
            if(topic !== priv.cur_topic) {
                break;      /*  stale answer of a previous topic  */
            }
            render_records(gobj, Array.isArray(data) ? data : []);
            break;
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
