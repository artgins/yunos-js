/***********************************************************************
 *          c_treedb_settings.js
 *
 *      C_TREEDB_SETTINGS — the Settings page: an EDITABLE Tabulator table
 *      of backend connections, persisted to browser localStorage (via
 *      C_TREEDB_CONFIG, whose `connections` attr is SDF_PERSIST).
 *
 *      The table is the single source of truth for connections: editing a
 *      cell, adding a row, or deleting a row writes the whole list back to
 *      C_TREEDB_CONFIG, which persists it and publishes
 *      EV_CONNECTIONS_CHANGED; the app root then reconciles the live
 *      transports (open new, recreate edited, close removed). The picker in
 *      each workspace only SELECTS which services to open — connection
 *      management lives here.
 *
 *      Each connection points at a node's AGENT. The scan button of a row
 *      asks C_TREEDB_LINKS to discover, via that agent (list-yunos +
 *      command-yuno services), the C_NODE / C_TRANGER services of every
 *      running yuno of the node. The discovered services render as
 *      dataTree SUB-ROWS with a checkbox; checked services persist in the
 *      connection's `services` and become browsable in the picker
 *      ("connections" tab). Scan results themselves are ephemeral — only
 *      the checked services survive a reload.
 *
 *      A view: builds its own `$container` for the shell to mount.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t, event_flag_t,
    gclass_create, log_error,
    gobj_read_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_find_service,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_set_connections,
    treedb_config_set_conn_services,
    treedb_config_conn_services,
    treedb_config_service_key,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_is_scanning,
    treedb_links_scan,
} from "./c_treedb_links.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_SETTINGS";

/*  Child (service) row id separator: conn.id <STX> service key.  */
const CHILD_SEP = "\x02";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Tab title"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTML element (mounted by the shell)"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,  "Tabulator instance"),
SDATA(data_type_t.DTP_STRING,   "table_id",    0,  "",    "DOM id of the table div"),
SDATA_END()
];

let PRIVATE_DATA = {
    scan_results: null,   /*  conn_id -> last scan's yunos [{yuno_role,yuno_name,services}]  */
    $scan_errors: null,   /*  scan failure report area  */
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
    priv.scan_results = {};

    gobj_write_attr(gobj, "table_id", "treedb_settings_table");
    build_ui(gobj);

    /*  Refresh the status column when a connection goes up/down, and
     *  reload the tree when a scan finishes. NOT subscribed to
     *  EV_CONNECTIONS_CHANGED: the table is the source of those changes,
     *  so reloading from them would fight the editor.  */
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(links, "EV_TREEDB_SCAN_DONE", {}, gobj);
        gobj_subscribe_event(links, "EV_TREEDB_SCAN_ERROR", {}, gobj);
    }
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    /*  The shell has appended $container by now, so the table div is in
     *  the DOM and Tabulator can attach.  */
    create_table(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        try {
            table.destroy();
        } catch(e) {
            /*  already gone  */
        }
        gobj_write_attr(gobj, "tabulator", null);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 *
 *  Remove our $container from the DOM (the view is lazy_destroy: a
 *  hidden leftover copy would shadow the fixed table div id of the
 *  next Settings instance, leaving its Tabulator invisible).
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
 *  A stable connection id (survives coordinate edits).
 ***************************************************************/
function new_id()
{
    if(typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return "c-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
}

/***************************************************************
 *  Build the root container (header + Add button + table div).
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;
    let table_id = gobj_read_attr(gobj, "table_id");

    let $add = createElement2(
        ["button", {class: "button is-primary is-small SETTINGS_ADD", id: "treedb-settings-add",
                    i18n: "add connection"}, "Add connection"]);
    $add.addEventListener("click", () => {
        add_row(gobj);
    });

    let $scan_errors = createElement2(
        ["div", {class: "is-size-7 has-text-danger mb-2 is-hidden SETTINGS_SCAN_ERRORS"}, []]);
    priv.$scan_errors = $scan_errors;

    let $container = createElement2(
        ["div", {class: "ytreedb-settings p-4", gclass: "C_TREEDB_SETTINGS"},
            [
                ["div", {class: "level mb-3"}, [
                    ["div", {class: "level-left"}, [
                        ["h2", {class: "title is-5", i18n: "connections"}, "Connections"]
                    ]],
                    ["div", {class: "level-right"}, [$add]]
                ]],
                ["p", {class: "is-size-7 has-text-grey mb-3 SETTINGS_HELP", i18n: "connections help"},
                    "Edit cells inline. Each URL points at a node's agent; " +
                    "scan a row to pick the node services to browse."],
                $scan_errors,
                ["div", {id: table_id}, []]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Connection rows for the table (treedbs array -> string), with the
 *  discovered/selected node services as dataTree children.
 ***************************************************************/
function rows_from_config(gobj)
{
    let priv = gobj.priv;
    let config = gobj_find_service("treedb_config", false);
    let conns = config ? treedb_config_get_connections(config) : [];
    return conns.map((c) => {
        let row = {
            id:                  c.id,
            label:               c.label || "",
            url:                 c.url || "",
            remote_yuno_role:    c.remote_yuno_role || "",
            remote_yuno_service: c.remote_yuno_service || "",
            treedbs:             Array.isArray(c.treedbs) ? c.treedbs.join(", ") : ""
        };
        let children = service_children(gobj, c);
        if(children.length) {
            row._children = children;
        }
        return row;
    });
}

/***************************************************************
 *  The service sub-rows of a connection: the last scan's discoveries
 *  (checked state = persisted in conn.services) plus any persisted
 *  service the scan didn't (re)find — kept visible and checked.
 ***************************************************************/
function service_children(gobj, conn)
{
    let priv = gobj.priv;

    /*  Persisted (checked) services, keyed. Only scanned entries
     *  (yuno_role set) render as sub-rows: manual `treedbs` names keep
     *  living in the treedbs column.  */
    let checked = {};
    for(let e of treedb_config_conn_services(conn)) {
        if(e.yuno_role) {
            checked[e.key] = e;
        }
    }

    let children = [];
    let seen = {};
    let scanned = priv.scan_results[conn.id];
    for(let y of (scanned || [])) {
        for(let s of (y.services || [])) {
            let svc = {
                yuno_role: y.yuno_role || "",
                yuno_name: y.yuno_name || "",
                service:   s.service,
                gclass:    s.gclass
            };
            svc.key = treedb_config_service_key(svc);
            seen[svc.key] = true;
            children.push(child_row(conn, svc, !!checked[svc.key]));
        }
    }
    for(let key in checked) {
        if(!seen[key]) {
            children.push(child_row(conn, checked[key], true));
        }
    }
    return children;
}

function child_row(conn, svc, is_checked)
{
    return {
        id:       conn.id + CHILD_SEP + svc.key,
        _child:   true,
        _conn_id: conn.id,
        _svc:     svc,
        _checked: is_checked
    };
}

/***************************************************************
 *  Write the whole table back to C_TREEDB_CONFIG (persist +
 *  reconcile links), treedbs string -> array. Only parent rows are
 *  connections; each keeps its persisted scanned `services` (the
 *  checkbox column edits those separately).
 ***************************************************************/
function persist(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    let config = gobj_find_service("treedb_config", false);
    let list = table.getData().filter((r) => r && !r._child).map((r) => {
        let prev = config ? treedb_config_get_connection(config, r.id) : null;
        return {
            id:                  r.id || new_id(),
            label:               (r.label || "").trim() || (r.url || "").trim(),
            url:                 (r.url || "").trim(),
            remote_yuno_role:    (r.remote_yuno_role || "").trim(),
            remote_yuno_service: (r.remote_yuno_service || "").trim(),
            treedbs:             String(r.treedbs || "").split(",").map((s) => s.trim()).filter(Boolean),
            services:            (prev && Array.isArray(prev.services)) ? prev.services : []
        };
    });
    if(config) {
        treedb_config_set_connections(config, list);
    }
}

/***************************************************************
 *  Add a blank connection row and persist.
 ***************************************************************/
function add_row(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    table.addRow({
        id: new_id(), label: "", url: "",
        remote_yuno_role: "", remote_yuno_service: "", treedbs: ""
    }, false).then(() => {
        persist(gobj);
    });
}

/***************************************************************
 *  Toggle a service sub-row's checkbox: add/remove it from the
 *  connection's persisted `services`.
 ***************************************************************/
function toggle_service(gobj, row)
{
    let d = row.getData();
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, d._conn_id) : null;
    if(!conn || !d._svc) {
        return;
    }
    let list = (Array.isArray(conn.services) ? conn.services : []).slice();
    let idx = list.findIndex((s) => s && treedb_config_service_key(s) === d._svc.key);
    if(idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push({
            yuno_role: d._svc.yuno_role,
            yuno_name: d._svc.yuno_name,
            service:   d._svc.service,
            gclass:    d._svc.gclass
        });
    }
    treedb_config_set_conn_services(config, d._conn_id, list);
    row.update({_checked: idx < 0});
}

/***************************************************************
 *  Launch the node scan of a connection row.
 ***************************************************************/
function scan_connection(gobj, row)
{
    let d = row.getData();
    if(d._child) {
        return;
    }
    let links = gobj_find_service("treedb_links", false);
    if(!links) {
        log_error(`${GCLASS_NAME}: treedb_links service not found`);
        return;
    }
    show_scan_errors(gobj, []);
    treedb_links_scan(links, d.id);
    try {
        row.reformat();
    } catch(e) {
        /*  table mid-rebuild  */
    }
}

/***************************************************************
 *  Paint (or clear) the scan failure report.
 ***************************************************************/
function show_scan_errors(gobj, errors)
{
    let priv = gobj.priv;
    let $box = priv.$scan_errors;
    if(!$box) {
        return;
    }
    while($box.firstChild) {
        $box.removeChild($box.firstChild);
    }
    if(!errors || !errors.length) {
        $box.classList.add("is-hidden");
        return;
    }
    for(let err of errors) {
        let $line = createElement2(["div", {class: "SETTINGS_SCAN_ERROR"}, []]);
        $line.textContent = (err.yuno ? `${err.yuno}: ` : "") + t(err.error || "scan failed");
        $box.appendChild($line);
    }
    $box.classList.remove("is-hidden");
}

/***************************************************************
 *  Column definitions. Shared by parent (connection) and child
 *  (service) rows: children only use the tree column, the checkbox
 *  and the gclass tag; parent-only cells are blank on them.
 ***************************************************************/
function make_columns(gobj)
{
    function is_parent(cell)
    {
        return !cell.getData()._child;
    }

    function label_formatter(cell)
    {
        let d = cell.getData();
        let $span = document.createElement("span");
        if(!d._child) {
            $span.textContent = d.label || "";
            return $span;
        }
        $span.classList.add("SETTINGS_SERVICE");
        let $svc = document.createElement("span");
        $svc.textContent = d._svc.service;
        $svc.classList.add("has-text-weight-semibold");
        let $yuno = document.createElement("span");
        $yuno.textContent = `  ·  ${d._svc.yuno_role}` + (d._svc.yuno_name ? `^${d._svc.yuno_name}` : "");
        $yuno.classList.add("has-text-grey", "is-size-7");
        $span.appendChild($svc);
        $span.appendChild($yuno);
        return $span;
    }

    function gclass_formatter(cell)
    {
        let d = cell.getData();
        if(!d._child) {
            return "";
        }
        let $tag = document.createElement("span");
        $tag.classList.add("tag", "is-size-7", "SETTINGS_SERVICE_GCLASS");
        $tag.classList.add(d._svc.gclass === "C_TRANGER" ? "is-warning" : "is-info");
        $tag.classList.add("is-light");
        $tag.textContent = d._svc.gclass;
        return $tag;
    }

    function check_formatter(cell)
    {
        let d = cell.getData();
        if(!d._child) {
            return "";
        }
        let icon = d._checked ? "yi-square-check" : "yi-square";
        return `<span class="icon SETTINGS_SERVICE_CHECK" role="checkbox" `
             + `aria-checked="${d._checked ? "true" : "false"}" `
             + `title="${t("browse this service")}">`
             + `<i class="${icon}"></i></span>`;
    }

    function check_click(e, cell)
    {
        let d = cell.getData();
        if(!d._child) {
            return;
        }
        toggle_service(gobj, cell.getRow());
    }

    function scan_formatter(cell)
    {
        let d = cell.getData();
        if(d._child) {
            return "";
        }
        let links = gobj_find_service("treedb_links", false);
        let scanning = links ? treedb_links_is_scanning(links, d.id) : false;
        let connected = links ? treedb_links_is_connected(links, d.id) : false;
        let icon = scanning ? "yi-arrows-rotate" : "yi-magnifying-glass";
        let cls = connected ? "" : " has-text-grey-light";
        let title = scanning ? t("scanning") : t("scan node services");
        return `<span class="icon SETTINGS_SCAN${cls}" title="${title}" `
             + `aria-label="${title}"><i class="${icon}"></i></span>`;
    }

    function scan_click(e, cell)
    {
        let d = cell.getData();
        if(d._child) {
            return;
        }
        let links = gobj_find_service("treedb_links", false);
        if(links && treedb_links_is_scanning(links, d.id)) {
            return;
        }
        scan_connection(gobj, cell.getRow());
    }

    function status_formatter(cell)
    {
        let d = cell.getData();
        if(d._child) {
            return "";
        }
        let links = gobj_find_service("treedb_links", false);
        let connected = links ? treedb_links_is_connected(links, d.id) : false;
        let color = connected ? "#48c78e" : "#b5b5b5";
        return `<span title="${connected ? t("connected") : t("disconnected")}" `
             + `style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;`
             + `background:${color};"></span>`;
    }

    function del_formatter(cell)
    {
        if(cell.getData()._child) {
            return "";
        }
        return `<span class="icon has-text-danger" aria-label="${t("remove")}">`
             + `<i class="yi-trash"></i></span>`;
    }

    function del_click(e, cell)
    {
        if(cell.getData()._child) {
            return;
        }
        let row = cell.getRow();
        row.delete().then(() => {
            persist(gobj);
        });
    }

    /*
     *  minWidth per column so `fitColumns` never shrinks them below a
     *  legible size: on a narrow (mobile) viewport Tabulator then scrolls
     *  the table horizontally instead of squishing the columns unreadable;
     *  on desktop the widthGrow weights fill the extra width.
     */
    return [
        {title: t("label"),   field: "label",               editor: "input", editable: is_parent,
            minWidth: 220, widthGrow: 2, formatter: label_formatter},
        {title: t("url"),     field: "url",                 editor: "input", editable: is_parent,
            minWidth: 200, widthGrow: 2},
        {title: t("role"),    field: "remote_yuno_role",    editor: "input", editable: is_parent,
            minWidth: 120, widthGrow: 1},
        {title: t("service"), field: "remote_yuno_service", editor: "input", editable: is_parent,
            minWidth: 120, widthGrow: 1},
        {title: t("treedbs"), field: "treedbs",             editor: "input", editable: is_parent,
            minWidth: 150, widthGrow: 2},
        {title: "", field: "_gclass", width: 110, minWidth: 110, headerSort: false,
            formatter: gclass_formatter},
        {title: "", field: "_checked", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: check_formatter, cellClick: check_click},
        {title: "", field: "_scan", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: scan_formatter, cellClick: scan_click},
        {title: "", field: "_status", width: 56, minWidth: 56, headerSort: false, hozAlign: "center",
            formatter: status_formatter},
        {title: "", field: "_del", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: del_formatter, cellClick: del_click}
    ];
}

/***************************************************************
 *  Create the Tabulator instance and load the persisted rows.
 ***************************************************************/
function create_table(gobj)
{
    let table_id = gobj_read_attr(gobj, "table_id");

    /*  Attach Tabulator to OUR table div (not the global `#id` selector):
     *  a stale hidden container with the same id would win the
     *  document-wide query and swallow the table.  */
    let $container = gobj_read_attr(gobj, "$container");
    let $div = $container ? $container.querySelector(`#${table_id}`) : null;
    if(!$div) {
        log_error(`${GCLASS_NAME}: table div '${table_id}' not found in $container`);
        return;
    }

    let settings = {
        index:          "id",
        layout:         "fitColumns",
        maxHeight:      "70vh",
        placeholder:    t("no connections - click add connection"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        dataTree:               true,
        dataTreeChildField:     "_children",
        dataTreeStartExpanded:  true,
        dataTreeElementColumn:  "label",
        columns:        make_columns(gobj)
    };

    let table = new Tabulator($div, settings);
    table.on("tableBuilt", function() {
        table.setData(rows_from_config(gobj));
    });
    /*  Any inline cell edit → persist the whole table.  */
    table.on("cellEdited", function() {
        persist(gobj);
    });
    gobj_write_attr(gobj, "tabulator", table);
}

/***************************************************************
 *  Reload the whole tree (scan finished: children changed).
 ***************************************************************/
function reload_table(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    try {
        table.setData(rows_from_config(gobj));
    } catch(e) {
        /*  table mid-rebuild  */
    }
}

/***************************************************************
 *  Refresh the status/scan columns (a connection went up/down).
 ***************************************************************/
function refresh_status(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    try {
        table.getRows().forEach((row) => {
            row.reformat();
        });
    } catch(e) {
        /*  table mid-rebuild  */
    }
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_conn_status(gobj, event, kw, src)
{
    refresh_status(gobj);
    return 0;
}

/***************************************************************
 *  Scan finished: remember its results (children of that row) and
 *  reload the tree. Failures (per-yuno or global) are reported above
 *  the table — never swallowed.
 ***************************************************************/
function ac_scan_done(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let conn_id = (kw && kw.conn_id) || "";
    if(!conn_id) {
        return 0;
    }
    priv.scan_results[conn_id] = (kw && kw.yunos) || [];
    show_scan_errors(gobj, (kw && kw.errors) || []);
    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Scan could not start (backend not connected).
 ***************************************************************/
function ac_scan_error(gobj, event, kw, src)
{
    show_scan_errors(gobj, [{yuno: "", error: (kw && kw.error) || "scan failed"}]);
    refresh_status(gobj);
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
            ["EV_ON_OPEN",            ac_conn_status, null],
            ["EV_ON_CLOSE",           ac_conn_status, null],
            ["EV_TREEDB_SCAN_DONE",   ac_scan_done,   null],
            ["EV_TREEDB_SCAN_ERROR",  ac_scan_error,  null]
        ]]
    ];

    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_TREEDB_SCAN_DONE",  0],
        ["EV_TREEDB_SCAN_ERROR", 0]
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

function register_c_treedb_settings()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_settings};
