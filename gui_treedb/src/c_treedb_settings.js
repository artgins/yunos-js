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
 *      each workspace only SELECTS which treedbs to open — connection
 *      management lives here.
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
    treedb_config_set_connections,
} from "./c_treedb_config.js";

import {treedb_links_is_connected} from "./c_treedb_links.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_SETTINGS";


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

let PRIVATE_DATA = {};
let __gclass__ = null;




                    /******************************
                     *      Framework Methods
                     ******************************/




/***************************************************************
 *          Framework Method: Create
 ***************************************************************/
function mt_create(gobj)
{
    gobj_write_attr(gobj, "table_id", "treedb_settings_table");
    build_ui(gobj);

    /*  Refresh the status column when a connection goes up/down. NOT
     *  subscribed to EV_CONNECTIONS_CHANGED: the table is the source of
     *  those changes, so reloading from them would fight the editor.  */
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
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
 ***************************************************************/
function mt_destroy(gobj)
{
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
    let table_id = gobj_read_attr(gobj, "table_id");

    let $add = createElement2(
        ["button", {class: "button is-primary is-small", id: "treedb-settings-add",
                    i18n: "add connection"}, "Add connection"]);
    $add.addEventListener("click", () => {
        add_row(gobj);
    });

    let $container = createElement2(
        ["div", {class: "ytreedb-settings p-4", gclass: "C_TREEDB_SETTINGS"},
            [
                ["div", {class: "level mb-3"}, [
                    ["div", {class: "level-left"}, [
                        ["h2", {class: "title is-5", i18n: "connections"}, "Connections"]
                    ]],
                    ["div", {class: "level-right"}, [$add]]
                ]],
                ["p", {class: "is-size-7 has-text-grey mb-3", i18n: "connections help"},
                    "Edit cells inline. TreeDBs is a comma-separated list of the treedb names to browse on that backend."],
                ["div", {id: table_id}, []]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Connection rows for the table (treedbs array -> string).
 ***************************************************************/
function rows_from_config(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let conns = config ? treedb_config_get_connections(config) : [];
    return conns.map((c) => ({
        id:                  c.id,
        label:               c.label || "",
        url:                 c.url || "",
        remote_yuno_role:    c.remote_yuno_role || "",
        remote_yuno_service: c.remote_yuno_service || "",
        treedbs:             Array.isArray(c.treedbs) ? c.treedbs.join(", ") : ""
    }));
}

/***************************************************************
 *  Write the whole table back to C_TREEDB_CONFIG (persist +
 *  reconcile links), treedbs string -> array.
 ***************************************************************/
function persist(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    let list = table.getData().map((r) => ({
        id:                  r.id || new_id(),
        label:               (r.label || "").trim() || (r.url || "").trim(),
        url:                 (r.url || "").trim(),
        remote_yuno_role:    (r.remote_yuno_role || "").trim(),
        remote_yuno_service: (r.remote_yuno_service || "").trim(),
        treedbs:             String(r.treedbs || "").split(",").map((s) => s.trim()).filter(Boolean)
    }));
    let config = gobj_find_service("treedb_config", false);
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
 *  Column definitions.
 ***************************************************************/
function make_columns(gobj)
{
    function status_formatter(cell)
    {
        let id = cell.getData().id;
        let links = gobj_find_service("treedb_links", false);
        let connected = links ? treedb_links_is_connected(links, id) : false;
        let color = connected ? "#48c78e" : "#b5b5b5";
        return `<span title="${connected ? t("connected") : t("disconnected")}" `
             + `style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;`
             + `background:${color};"></span>`;
    }

    function del_formatter()
    {
        return `<span class="icon has-text-danger" aria-label="${t("remove")}">`
             + `<i class="yi-trash"></i></span>`;
    }

    function del_click(e, cell)
    {
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
        {title: t("label"),   field: "label",               editor: "input", minWidth: 120, widthGrow: 1},
        {title: t("url"),     field: "url",                 editor: "input", minWidth: 210, widthGrow: 2},
        {title: t("role"),    field: "remote_yuno_role",    editor: "input", minWidth: 130, widthGrow: 1},
        {title: t("service"), field: "remote_yuno_service", editor: "input", minWidth: 150, widthGrow: 1},
        {title: t("treedbs"), field: "treedbs",             editor: "input", minWidth: 180, widthGrow: 2},
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

    let settings = {
        index:          "id",
        layout:         "fitColumns",
        maxHeight:      "70vh",
        placeholder:    t("no connections — click Add connection"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        columns:        make_columns(gobj)
    };

    let table = new Tabulator(`#${table_id}`, settings);
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
 *  Refresh the status column (a connection went up/down).
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
            ["EV_ON_OPEN",  ac_conn_status, null],
            ["EV_ON_CLOSE", ac_conn_status, null]
        ]]
    ];

    const event_types = [
        ["EV_ON_OPEN",  0],
        ["EV_ON_CLOSE", 0]
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
