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
 *      Each connection is the C_IEVENT_CLI entry to ONE yuno: its public
 *      wss url + remote role + service. Transports open ONLY from the
 *      connect/disconnect button of a row (the persisted `enabled`
 *      intent) — editing a row's coordinates never auto-connects; it
 *      DISABLES the connection until the user reconnects. On the first
 *      connect C_TREEDB_LINKS discovers that yuno's C_NODE / C_TRANGER
 *      services automatically (`services` command) and persists the
 *      WHOLE found list in the connection's `services`; the refresh
 *      button of a row re-runs the discovery. The services of a connection
 *      render as a TABLE OF THEIR OWN, nested in its row, with its own
 *      header (service / class / browse) and only its own fields — as
 *      dataTree children they were rows of THIS table and wore ITS columns:
 *      a service's name under "Label", its gclass and its checkbox under two
 *      blank, unlabelled ones. Its checkbox edits the service's `selected`
 *      flag — selected services are the ones offered in the workspace
 *      pickers ("connections" tab of Topics / Graphs).
 *      Deleting a row asks for confirmation (shell yes/no dialog).
 *
 *      A view: builds its own `$container` for the shell to mount.
 *
 *      Every click of the table is an EVENT (the SPA's contract: a DOM
 *      handler's only job is to make one). A Tabulator `cellClick` — the
 *      service checkbox, the refresh, the connect/disconnect, the ✕ — sends
 *      EV_TOGGLE_SERVICE / EV_REFRESH_SERVICES / EV_TOGGLE_CONN_ENABLED /
 *      EV_REMOVE_CONN carrying IDENTITIES (conn_id, svc_key: a kw must stay
 *      plain JSON), and the work happens in the action. Even the removal's
 *      confirmation comes back as one (EV_CONFIRM_REMOVE_CONN), so no state
 *      is mutated inside a promise's `.then`. Widget plumbing that is not an
 *      action stays a plain call (the `cellEdited` → persist of the inline
 *      editor, the formatters).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning, gobj_short_name,
    gobj_read_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_find_service,
    gobj_send_event,
    gobj_parent,
    gobj_is_destroying,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {yui_shell_confirm_yesno} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";

import {
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_conn_services,
    treedb_config_get_live_max,
    LIVE_MAX_MIN,
    LIVE_MAX_MAX,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_is_scanning,
} from "./c_treedb_links.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_SETTINGS";

/*  What an exported connections file says it is. A file that does not say so
 *  is still accepted if it carries a `connections` list (or IS one) — an
 *  operator hand-writing the list is a legitimate way in — but the marker is
 *  what lets a future format be told apart from this one.  */
const EXPORT_KIND = "yuneta.treedb.connections";
const EXPORT_VERSION = 1;


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
    $scan_errors: null,   /*  refresh failure report area  */
    $import_file: null,   /*  hidden <input type=file> of the Import button  */
    subtables:    null,   /*  conn_id -> the services Tabulator inside its row  */
    resize_pending: false,/*  a parent re-measure is already queued for this frame  */
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
    gobj.priv.subtables = {};
    gobj_write_attr(gobj, "table_id", "treedb_settings_table");
    build_ui(gobj);
}

/***************************************************************
 *          Framework Method: Start
 *
 *  Subscriptions live HERE so they pair with the unsubscribes in mt_stop.
 *  This view is `lazy_destroy`: it is destroyed and re-created on every
 *  visit to Settings, so a subscription taken in mt_create and never undone
 *  added a whole set per visit — each one delivering into a gobj that had
 *  already been destroyed.
 ***************************************************************/
function mt_start(gobj)
{
    /*  Refresh the status column when a connection goes up/down, and
     *  reload the tree when a discovery finishes (auto on first connect,
     *  or the refresh button). NOT subscribed to EV_CONNECTIONS_CHANGED:
     *  the table is the source of those changes, so reloading from them
     *  would fight the editor.  */
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(links, "EV_TREEDB_SCAN_DONE", {}, gobj);
        gobj_subscribe_event(links, "EV_TREEDB_SCAN_ERROR", {}, gobj);
    } else {
        log_error(`${gobj_short_name(gobj)}: no treedb_links service: ` +
                  `Settings will not see a connection open, close or scan`);
    }

    /*  The table's headers, its placeholder and everything its formatters
     *  paint (the connect/refresh tooltips, the service checkbox, the status
     *  dot) are rendered by Tabulator from OUR t() calls — no i18n key lives in
     *  that DOM, so refresh_language() cannot reach it. The shell publishes the
     *  switch and the action re-renders the table.  */
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    /*  The shell has appended $container by now, so the table div is in
     *  the DOM and Tabulator can attach.  */
    create_table(gobj);
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
        gobj_unsubscribe_event(links, "EV_TREEDB_SCAN_DONE", {}, gobj);
        gobj_unsubscribe_event(links, "EV_TREEDB_SCAN_ERROR", {}, gobj);
    }

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    drop_all_subtables(gobj);

    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        try {
            table.destroy();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: already gone: ${e}`);
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
        gobj_send_event(gobj, "EV_ADD_CONN", {}, gobj);
    });

    /*  The connection set is browser-local: without these, moving it to another
     *  browser (or another operator's machine) means retyping every row.  */
    let $export = createElement2(
        ["button", {class: "button is-small ml-2 SETTINGS_EXPORT",
                    title: t("download the connections as a json file"),
                    "aria-label": t("export"),
                    "data-i18n-title": "download the connections as a json file",
                    "data-i18n-aria-label": "export"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-download"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "export"}, t("export")]
            ]
        ]);
    $export.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_EXPORT_CONNS", {}, gobj);
    });

    /*  The file input is the OS's, so it stays hidden behind our own button:
     *  its `change` does nothing but turn the picked file into an event.  */
    let $file = createElement2(
        ["input", {type: "file", accept: "application/json,.json",
                   class: "is-hidden SETTINGS_IMPORT_FILE"}]);
    $file.addEventListener("change", () => {
        let file = $file.files && $file.files[0];
        $file.value = "";       /*  so picking the same file twice fires again  */
        if(!file) {
            return;
        }
        file.text()
            .then((text) => {
                gobj_send_event(gobj, "EV_IMPORT_CONNS", {text: text}, gobj);
            })
            .catch((e) => {
                gobj_send_event(gobj, "EV_IMPORT_CONNS",
                    {text: "", error: String(e)}, gobj);
            });
    });
    priv.$import_file = $file;

    let $import = createElement2(
        ["button", {class: "button is-small ml-2 SETTINGS_IMPORT",
                    title: t("add the connections of a json file"),
                    "aria-label": t("import"),
                    "data-i18n-title": "add the connections of a json file",
                    "data-i18n-aria-label": "import"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-plus"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "import"}, t("import")]
            ]
        ]);
    $import.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_PICK_IMPORT_FILE", {}, gobj);
    });

    let $scan_errors = createElement2(
        ["div", {class: "is-size-7 has-text-danger mb-2 is-hidden SETTINGS_SCAN_ERRORS"}, []]);
    priv.$scan_errors = $scan_errors;

    let $container = createElement2(
        ["div", {class: "C_TREEDB_SETTINGS ytreedb-settings p-4"},
            [
                ["div", {class: "level mb-3"}, [
                    ["div", {class: "level-left"}, [
                        ["h2", {class: "title is-5", i18n: "connections"}, "Connections"]
                    ]],
                    ["div", {class: "level-right"}, [$add, $export, $import, $file]]
                ]],
                ["p", {class: "is-size-7 has-text-grey mb-3 SETTINGS_HELP", i18n: "connections help"},
                    "Edit cells inline. Each URL is a yuno's public wss endpoint " +
                    "(plus its role and service). Connect with the plug button — " +
                    "services are discovered on the first connect; check the ones " +
                    "to browse."],
                $scan_errors,
                ["div", {id: table_id}, []],
                build_live_max_field(gobj)
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Live-buffer setting: how many rows a Live card keeps (newest on top;
 *  the oldest are dropped at the cap). It bounds the BROWSER's memory —
 *  the backend keeps no live data — so the value is clamped by
 *  C_TREEDB_CONFIG. Applied to cards opened from now on: an open card
 *  keeps the cap it was created with.
 ***************************************************************/
function build_live_max_field(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let cur = config ? treedb_config_get_live_max(config) : LIVE_MAX_MIN;

    let $input = createElement2(
        ["input", {class: "input is-small SETTINGS_LIVE_MAX", type: "number",
                   min: String(LIVE_MAX_MIN), max: String(LIVE_MAX_MAX),
                   step: "50", value: String(cur),
                   style: "max-width:9rem;"}]);
    $input.addEventListener("change", () => {
        let cfg = gobj_find_service("treedb_config", false);
        if(!cfg) {
            log_error(`${GCLASS_NAME}: treedb_config service not found`);
            return;
        }
        gobj_send_event(cfg, "EV_SET_LIVE_MAX", {live_max: $input.value}, gobj);
        /*  Echo back what was STORED: the value is clamped, so a typed
         *  1000000 must not keep showing 1000000 in the field. The send is
         *  synchronous, so the clamped value is already persisted here.  */
        $input.value = String(treedb_config_get_live_max(cfg));
    });

    return ["div", {class: "SETTINGS_LIVE mt-5"},
        [
            ["h2", {class: "title is-5 mb-2", i18n: "live buffer"}, "Live buffer"],
            ["p", {class: "is-size-7 has-text-grey mb-3 SETTINGS_LIVE_HELP",
                   i18n: "live buffer help"},
                "Rows a Live card keeps in memory. The oldest are dropped when " +
                "the cap is reached; nothing is lost — the records stay in the " +
                "backend and can be read in a Rows card. Applies to cards opened " +
                "from now on."],
            ["div", {class: "field SETTINGS_LIVE_FIELD"},
                [
                    ["label", {class: "label is-small mb-1", i18n: "rows per live card"},
                        "Rows per Live card"],
                    ["div", {class: "control"}, [$input]]
                ]
            ]
        ]];
}

/***************************************************************
 *  Connection rows for the table. ONLY connections: the discovered
 *  services of each one are their own table, nested in the row (see
 *  build_services_subtable) — as dataTree children they were rows of THIS
 *  table and therefore wore ITS columns, so a service showed its name under
 *  "Label", its gclass and its checkbox under two blank, unlabelled columns,
 *  and nothing said what any of it was.
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
        remote_yuno_service: c.remote_yuno_service || ""
    }));
}

/***************************************************************
 *  The services of a connection, as a table of their OWN inside its row:
 *  its own header (service, class, browse) and only its own fields.
 *
 *  Tabulator's rowFormatter runs on every render of the row, so the previous
 *  sub-table is destroyed first — otherwise each redraw would leave another
 *  one behind, alive and listening.
 ***************************************************************/
function build_services_subtable(gobj, row)
{
    let priv = gobj.priv;
    let conn_id = row.getData().id;
    let $row = row.getElement();

    drop_subtable(gobj, conn_id);
    let $old = $row.querySelector(".SETTINGS_SUBTABLE");
    if($old) {
        $old.remove();
    }

    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    let services = conn ? treedb_config_conn_services(conn) : [];
    if(!services.length) {
        return;     /*  never scanned, or an empty yuno: no sub-table at all  */
    }

    /*  Two elements, not one — the same shape Tabulator's own nested-table
     *  example uses, and both halves are load-bearing:
     *
     *  - $holder is a BLOCK div: the row's cells are inline-blocks, so only a
     *    block breaks the line and puts the sub-table UNDER its connection. The
     *    Tabulator element itself cannot do that job: `fitDataTable` styles it
     *    `display: inline-block` (that is how it shrinks to its data), so
     *    building the table straight into $row's child laid it out INLINE with
     *    the cells — off past their right edge, out of sight.
     *  - $table is what the sub-Tabulator owns, and it takes its NATURAL width:
     *    a services table stretched to the width of the connections table reads
     *    as a second header row of it. max-width is only the mobile guard.  */
    let $holder = createElement2(
        ["div", {class: "SETTINGS_SUBTABLE",
                 style: "margin: 0.25rem 0 0.5rem 2rem; max-width: calc(100% - 2.5rem);"},
            []]);
    let $table = createElement2(["div", {class: "SETTINGS_SUBTABLE_TABLE"}, []]);
    $holder.appendChild($table);
    $row.appendChild($holder);

    let sub = new Tabulator($table, {
        ...yui_tabulator_lang(t),
        layout:         "fitDataTable",
        index:          "key",
        data:           services.map((svc) => ({
            key:      svc.key,
            service:  svc.service,
            gclass:   svc.gclass,
            selected: !!svc.selected
        })),
        columnDefaults: {headerHozAlign: "left", headerSort: false, resizable: false},
        columns: [
            {title: t("service"), field: "service", minWidth: 160,
                formatter: (cell) => {
                    let $s = document.createElement("span");
                    $s.classList.add("SETTINGS_SERVICE", "has-text-weight-semibold");
                    $s.textContent = cell.getValue();
                    return $s;
                }},
            {title: t("class"), field: "gclass", minWidth: 120,
                formatter: (cell) => {
                    let $tag = document.createElement("span");
                    $tag.classList.add("tag", "is-size-7", "is-light",
                        "SETTINGS_SERVICE_GCLASS",
                        cell.getValue() === "C_TRANGER" ? "is-warning" : "is-info");
                    $tag.textContent = cell.getValue();
                    return $tag;
                }},
            {title: t("browse"), field: "selected", minWidth: 100, hozAlign: "center",
                formatter: (cell) => {
                    let on = !!cell.getValue();
                    return `<span class="icon SETTINGS_SERVICE_CHECK" role="checkbox" `
                         + `aria-checked="${on ? "true" : "false"}" `
                         + `title="${t("browse this service")}">`
                         + `<i class="${on ? "yi-square-check" : "yi-square"}"></i></span>`;
                },
                cellClick: (e, cell) => {
                    gobj_send_event(gobj, "EV_TOGGLE_SERVICE",
                        {conn_id: conn_id, svc_key: cell.getRow().getData().key}, gobj);
                }}
        ]
    });
    priv.subtables[conn_id] = sub;

    /*  A Tabulator builds ASYNCHRONOUSLY, so when this returns the row is still
     *  one line tall — and that is the height the parent measured itself with:
     *  with a maxHeight set it pins its tableholder to an inline `height` taken
     *  from the rows it knows about, and it counts only CELL heights (a
     *  rowFormatter's own DOM is invisible to Row.calcHeight()). The sub-table
     *  then lands BELOW that height and is clipped away — the parent only got it
     *  right once a window resize happened to re-run its measurement.
     *
     *  So re-measure the parent ourselves once the sub-table is really built:
     *  normalizeHeight() for the row's cells, and the tableholder re-measure the
     *  window resize was doing for us (resize_parent).  */
    sub.on("tableBuilt", () => {
        try {
            row.normalizeHeight();
            resize_parent(gobj);
        } catch(e) {
            log_warning(`${GCLASS_NAME}: row gone: ${e}`);
        }
    });
}

/***************************************************************
 *  Re-measure the connections table after its rows grew a sub-table.
 *
 *  ONLY the measurement (`adjustTableSize` clears the tableholder's inline
 *  height and takes it again from the real DOM) — NOT a `redraw()`: a redraw
 *  detaches every row element to re-render it, and a Tabulator that is
 *  detached mid-flight comes back blank, so the sub-tables would be the very
 *  thing it destroyed. This is exactly what the window resize was doing.
 *
 *  Coalesced: N connections finish building N sub-tables, and one measure at
 *  the end of the frame accounts for all of them.
 ***************************************************************/
function resize_parent(gobj)
{
    let priv = gobj.priv;
    if(priv.resize_pending) {
        return;
    }
    priv.resize_pending = true;
    requestAnimationFrame(() => {
        priv.resize_pending = false;
        let table = gobj_read_attr(gobj, "tabulator");
        if(!table || !table.rowManager) {
            return;
        }
        try {
            table.rowManager.adjustTableSize();
        } catch(e) {
            log_warning(`${GCLASS_NAME}: table gone on resize: ${e}`);
        }
    });
}

/***************************************************************
 *  Destroy one connection's sub-table (a redraw, a reload, a stop).
 ***************************************************************/
function drop_subtable(gobj, conn_id)
{
    let priv = gobj.priv;
    let sub = priv.subtables ? priv.subtables[conn_id] : null;
    if(!sub) {
        return;
    }
    delete priv.subtables[conn_id];
    try {
        /*  The parent re-renders a row by emptying its element, so by now the
         *  sub-table's own element is usually DETACHED — and Tabulator tears its
         *  ResizeObserver down with `unobserve(element.parentNode)`, which throws
         *  on a null parent ("Argument 1 is not an object") and leaves the rest
         *  of destroy() unrun: observers alive, listeners alive, table leaked.
         *  Give it a parent to be unobserved from — a scratch div nobody sees.  */
        let $el = sub.element;
        if($el && !$el.parentNode) {
            document.createElement("div").appendChild($el);
        }
        sub.destroy();
    } catch(e) {
        log_warning(`${GCLASS_NAME}: sub-table already gone: ${e}`);
    }
}

function drop_all_subtables(gobj)
{
    let priv = gobj.priv;
    for(let conn_id of Object.keys(priv.subtables || {})) {
        drop_subtable(gobj, conn_id);
    }
}

/***************************************************************
 *  Write the whole table back to C_TREEDB_CONFIG (persist +
 *  reconcile links). Only parent rows are connections; each keeps its
 *  persisted discovered `services` (the checkbox column edits those
 *  separately).
 ***************************************************************/
function persist(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    let config = gobj_find_service("treedb_config", false);
    let list = table.getData().map((r) => {
        let prev = config ? treedb_config_get_connection(config, r.id) : null;
        let url     = (r.url || "").trim();
        let role    = (r.remote_yuno_role || "").trim();
        let service = (r.remote_yuno_service || "").trim();
        /*
         *  Editing the entry coordinates NEVER auto-connects: the edited
         *  row comes back disabled and stays down until the user clicks
         *  its connect button.
         */
        let enabled = !!(prev && prev.enabled);
        if(prev && (url !== (prev.url || "")
                || role !== (prev.remote_yuno_role || "")
                || service !== (prev.remote_yuno_service || ""))) {
            enabled = false;
        }
        return {
            id:                  r.id || new_id(),
            label:               (r.label || "").trim() || url,
            url:                 url,
            remote_yuno_role:    role,
            remote_yuno_service: service,
            enabled:             enabled,
            services:            (prev && Array.isArray(prev.services)) ? prev.services : []
        };
    });
    if(config) {
        gobj_send_event(config, "EV_SET_CONNECTIONS", {connections: list}, gobj);
    }
}

/***************************************************************
 *  Repaint one row of the table (its formatters read the live
 *  connection/link state, so a state change is a reformat). Silent when
 *  the row is gone — the table may be mid-rebuild.
 ***************************************************************/
function reformat_row(gobj, row_id)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    try {
        let row = table.getRow(row_id);
        if(row) {
            row.reformat();
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${e}`);
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
    /*  Every row of THIS table is a connection now: the services live in the
     *  sub-table nested in each row (build_services_subtable), with their own
     *  header. So no more `_child` guard in every formatter.
     *
     *  A cellClick is an OS notification: its only job is to make an event, and
     *  the kw carries IDENTITIES (conn_id) — never the row or the cell: a kw
     *  must stay plain JSON (the machine trace serializes it).  */
    function refresh_formatter(cell)
    {
        let d = cell.getData();
        let links = gobj_find_service("treedb_links", false);
        let scanning = links ? treedb_links_is_scanning(links, d.id) : false;
        let connected = links ? treedb_links_is_connected(links, d.id) : false;
        let cls = (connected && !scanning) ? "" : " has-text-grey-light";
        let title = scanning ? t("refreshing services") : t("refresh services");
        return `<span class="icon SETTINGS_REFRESH${cls}" title="${title}" `
             + `aria-label="${title}"><i class="yi-arrows-rotate"></i></span>`;
    }

    function refresh_click(e, cell)
    {
        let d = cell.getData();
        gobj_send_event(gobj, "EV_REFRESH_SERVICES", {conn_id: d.id}, gobj);
    }

    function connect_formatter(cell)
    {
        let d = cell.getData();
        let config = gobj_find_service("treedb_config", false);
        let conn = config ? treedb_config_get_connection(config, d.id) : null;
        let enabled = !!(conn && conn.enabled);
        let icon = enabled ? "yi-plug-slash" : "yi-plug";
        let cls = enabled ? " has-text-danger" : " has-text-success";
        let title = enabled ? t("disconnect") : t("connect");
        return `<span class="icon SETTINGS_CONNECT${cls}" title="${title}" `
             + `aria-label="${title}"><i class="${icon}"></i></span>`;
    }

    function connect_click(e, cell)
    {
        let d = cell.getData();
        gobj_send_event(gobj, "EV_TOGGLE_CONN_ENABLED", {conn_id: d.id}, gobj);
    }

    function status_formatter(cell)
    {
        let d = cell.getData();
        let links = gobj_find_service("treedb_links", false);
        let connected = links ? treedb_links_is_connected(links, d.id) : false;
        let color = connected ? "#48c78e" : "#b5b5b5";
        return `<span title="${connected ? t("connected") : t("disconnected")}" `
             + `style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;`
             + `background:${color};"></span>`;
    }

    function clone_formatter(cell)
    {
        return `<span class="icon SETTINGS_CLONE" title="${t("clone this connection")}" `
             + `aria-label="${t("clone")}"><i class="yi-copy"></i></span>`;
    }

    function clone_click(e, cell)
    {
        let d = cell.getData();
        gobj_send_event(gobj, "EV_CLONE_CONN", {conn_id: d.id}, gobj);
    }

    function del_formatter(cell)
    {
        return `<span class="icon has-text-danger" aria-label="${t("remove")}">`
             + `<i class="yi-trash"></i></span>`;
    }

    function del_click(e, cell)
    {
        let d = cell.getData();
        gobj_send_event(gobj, "EV_REMOVE_CONN", {conn_id: d.id}, gobj);
    }

    /*
     *  minWidth per column so `fitColumns` never shrinks them below a
     *  legible size: on a narrow (mobile) viewport Tabulator then scrolls
     *  the table horizontally instead of squishing the columns unreadable;
     *  on desktop the widthGrow weights fill the extra width.
     */
    return [
        {title: t("label"),   field: "label",               editor: "input",
            minWidth: 220, widthGrow: 2},
        {title: t("url"),     field: "url",                 editor: "input",
            minWidth: 200, widthGrow: 2},
        {title: t("role"),    field: "remote_yuno_role",    editor: "input",
            minWidth: 120, widthGrow: 1},
        {title: t("service"), field: "remote_yuno_service", editor: "input",
            minWidth: 120, widthGrow: 1},
        {title: "", field: "_refresh", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: refresh_formatter, cellClick: refresh_click},
        {title: "", field: "_connect", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: connect_formatter, cellClick: connect_click},
        {title: "", field: "_status", width: 56, minWidth: 56, headerSort: false, hozAlign: "center",
            formatter: status_formatter},
        {title: "", field: "_clone", width: 48, minWidth: 48, headerSort: false, hozAlign: "center",
            formatter: clone_formatter, cellClick: clone_click},
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
        ...yui_tabulator_lang(t),
        index:          "id",
        layout:         "fitColumns",
        maxHeight:      "70vh",
        placeholder:    t("no connections - click add connection"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        columns:        make_columns(gobj),
        /*  Each connection carries its services as a table of their own,
         *  nested in its row — with its own header.  */
        rowFormatter:   (row) => build_services_subtable(gobj, row)
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
    /*  The sub-tables are Tabulators living INSIDE the parent's row elements:
     *  re-rendering the parent while they are alive tears the ground from under
     *  them mid-render ("e.getElement().classList is undefined"). Destroy them
     *  first; the rowFormatter builds them again for the new rows.  */
    drop_all_subtables(gobj);
    try {
        table.setData(rows_from_config(gobj));
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${e}`);
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
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${e}`);
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
 *  Discovery finished: the found list is already persisted in the
 *  connection (C_TREEDB_LINKS stores it), so just reload the tree.
 *  Failures are reported above the table — never swallowed.
 ***************************************************************/
function ac_scan_done(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    if(!conn_id) {
        return 0;
    }
    show_scan_errors(gobj, (kw && kw.errors) || []);
    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Discovery could not start (backend not connected).
 ***************************************************************/
function ac_scan_error(gobj, event, kw, src)
{
    show_scan_errors(gobj, [{yuno: "", error: (kw && kw.error) || "scan failed"}]);
    refresh_status(gobj);
    return 0;
}

/***************************************************************
 *  The language changed: re-translate what carries its key, and re-render
 *  what does not. The whole Tabulator is the second kind — its column
 *  headers, its placeholder and every string its formatters paint (connect /
 *  disconnect, refresh services, connected, browse this service, clone,
 *  remove) come from t() at RENDER time, so a fresh set of columns and a
 *  reformat is what puts them in the new language.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    try {
        /*  FIRST of all: the sub-tables live inside the parent's row elements, and
         *  everything below re-renders those rows (setLocale does too, not only
         *  setColumns). Re-rendering a row under a live Tabulator leaves it
         *  mid-render — "e.getElement().classList is undefined".  */
        drop_all_subtables(gobj);

        yui_tabulator_relocalize(table, t);
        table.options.placeholder = t("no connections - click add connection");

        /*  setColumns re-renders every row — and with them the rowFormatter, so
         *  the sub-tables are rebuilt in the new language. NOT followed by a
         *  reload: a second re-render would pull the rows out from under the
         *  sub-tables the first one had only just started building.  */
        table.setColumns(make_columns(gobj));
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table gone: ${e}`);
    }
    return 0;
}

/***************************************************************
 *  Add a blank connection row (the user fills it in place; every cell
 *  edit persists the whole table).
 ***************************************************************/
function ac_add_conn(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot add`);
        return -1;
    }
    let blank = {
        id:                  new_id(),
        label:               "",
        url:                 "",
        remote_yuno_role:    "",
        remote_yuno_service: "",
        enabled:             false,   /*  nothing this SPA creates auto-connects  */
        services:            []
    };
    gobj_send_event(config, "EV_SET_CONNECTIONS",
        {connections: treedb_config_get_connections(config).concat([blank])}, gobj);
    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Flip a service's `selected` flag (its sub-row checkbox): the
 *  connection's whole service list is rewritten with that one toggled.
 ***************************************************************/
function ac_toggle_service(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let svc_key = (kw && kw.svc_key) || "";
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    if(!conn || !svc_key) {
        log_error(`${gobj_short_name(gobj)}: no service '${svc_key}' of ` +
                  `connection '${conn_id}' to toggle`);
        return -1;
    }

    let now_checked = false;
    let list = treedb_config_conn_services(conn).map((s) => {
        let selected = s.selected;
        if(s.key === svc_key) {
            selected = !selected;
            now_checked = selected;
        }
        return {service: s.service, gclass: s.gclass, selected: selected};
    });
    gobj_send_event(config, "EV_SET_CONN_SERVICES",
        {conn_id: conn_id, services: list}, gobj);

    /*  The service lives in the connection's own sub-table now.  */
    let sub = gobj.priv.subtables[conn_id];
    if(sub) {
        try {
            let row = sub.getRow(svc_key);
            if(row) {
                row.update({selected: now_checked});
            }
        } catch(e) {
            log_warning(`${GCLASS_NAME}: sub-table mid-rebuild: ${e}`);
        }
    }
    return 0;
}

/***************************************************************
 *  Re-run the service discovery of a connection (the same scan the first
 *  connect does automatically).
 ***************************************************************/
function ac_refresh_services(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let links = gobj_find_service("treedb_links", false);
    if(!links) {
        log_error(`${gobj_short_name(gobj)}: no treedb_links service, cannot refresh`);
        return -1;
    }
    if(treedb_links_is_scanning(links, conn_id)) {
        return 0;   /*  its scan is already in flight: a second click is a no-op  */
    }
    show_scan_errors(gobj, []);
    gobj_send_event(links, "EV_SCAN_CONN", {conn_id: conn_id}, gobj);
    reformat_row(gobj, conn_id);    /*  paint the refresh icon as busy  */
    return 0;
}

/***************************************************************
 *  The connect / disconnect button: flip the connection's connect INTENT.
 *  The app root reconciles the transports on the change.
 ***************************************************************/
function ac_toggle_conn_enabled(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    if(!conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to connect`);
        return -1;
    }
    gobj_send_event(config, "EV_SET_CONN_ENABLED",
        {conn_id: conn_id, enabled: !conn.enabled}, gobj);
    reformat_row(gobj, conn_id);
    return 0;
}

/***************************************************************
 *  The ✕ of a connection row: ask first (removing a connection drops its
 *  open tabs and its saved Tranger views with it). The confirm's resolved
 *  promise is an OS notification like any other — it becomes an event, and
 *  the removal happens in ITS action, never in the `.then`.
 ***************************************************************/
function ac_remove_conn(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let shell = gobj_parent(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot confirm the removal`);
        return -1;
    }
    yui_shell_confirm_yesno(shell, "are you sure", {
        title:     "remove",
        type:      "danger",
        yes_label: "yes",
        no_label:  "no",
        t:         t
    }).then((yes) => {
        if(gobj_is_destroying(gobj)) {
            return;     /*  Settings left while the dialog was up  */
        }
        gobj_send_event(gobj, "EV_CONFIRM_REMOVE_CONN",
            {conn_id: conn_id, yes: !!yes}, gobj);
    });
    return 0;
}

/***************************************************************
 *  The answer to that confirmation.
 *
 *  Remove in config + reload via setData — NOT Tabulator's row.delete():
 *  a row carries a sub-table of its own, and reloading is what rebuilds
 *  (and destroys) them cleanly.
 ***************************************************************/
function ac_confirm_remove_conn(gobj, event, kw, src)
{
    if(!kw || !kw.yes) {
        return 0;   /*  the user said no  */
    }
    let conn_id = kw.conn_id || "";
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot remove`);
        return -1;
    }
    let list = treedb_config_get_connections(config).filter((c) => c && c.id !== conn_id);
    gobj_send_event(config, "EV_SET_CONNECTIONS", {connections: list}, gobj);
    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Clone a connection: same coordinates, a NEW id, and DISABLED.
 *
 *  Disabled because a clone is a starting point for an edit ("the same
 *  backend, its other treedb service"), and this SPA never auto-connects
 *  something the user has not pressed connect on. Its discovered services
 *  travel with it — they belong to the yuno, not to the row.
 ***************************************************************/
function ac_clone_conn(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot clone`);
        return -1;
    }
    let list = treedb_config_get_connections(config);
    let src_conn = list.find((c) => c && c.id === conn_id);
    if(!src_conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to clone`);
        return -1;
    }

    let clone = Object.assign({}, src_conn, {
        id:      new_id(),
        label:   `${src_conn.label || src_conn.url || ""} (${t("copy")})`,
        enabled: false
    });
    gobj_send_event(config, "EV_SET_CONNECTIONS",
        {connections: list.concat([clone])}, gobj);
    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Download the connection set as a JSON file.
 *
 *  Nothing secret travels: the access_token is never stored here (it is
 *  fetched from the BFF per session), so a connection is only its
 *  coordinates plus the services discovered behind them.
 ***************************************************************/
function ac_export_conns(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot export`);
        return -1;
    }
    let doc = {
        kind:        EXPORT_KIND,
        version:     EXPORT_VERSION,
        connections: treedb_config_get_connections(config)
    };

    let url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 4)], {type: "application/json"}));
    let $a = createElement2(
        ["a", {href: url, download: "treedb-connections.json"}, ""]);
    $a.click();
    URL.revokeObjectURL(url);
    return 0;
}

/***************************************************************
 *  Open the OS file picker (the input is ours, hidden).
 ***************************************************************/
function ac_pick_import_file(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.$import_file) {
        log_error(`${gobj_short_name(gobj)}: no file input`);
        return -1;
    }
    priv.$import_file.click();
    return 0;
}

/***************************************************************
 *  Import connections from a picked file: ADD them, never replace the set.
 *
 *  Every imported connection gets a FRESH id and lands DISABLED. Fresh
 *  because the id is what everything else in this browser is keyed by (the
 *  open tabs, the Tranger views): reusing an exported id would silently
 *  adopt whatever local state a previous connection of that id had left
 *  behind. Disabled because importing a file must not open sockets.
 ***************************************************************/
function ac_import_conns(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot import`);
        return -1;
    }
    if(kw && kw.error) {
        log_error(`${gobj_short_name(gobj)}: cannot read the file: ${kw.error}`);
        show_scan_errors(gobj, [{yuno: "", error: "the file could not be read"}]);
        return -1;
    }

    let doc = null;
    try {
        doc = JSON.parse((kw && kw.text) || "");
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: the file is not JSON: ${e}`);
        show_scan_errors(gobj, [{yuno: "", error: "the file is not a connections export"}]);
        return -1;
    }

    let rows = (doc && Array.isArray(doc.connections)) ? doc.connections
             : (Array.isArray(doc) ? doc : null);
    if(!rows) {
        log_error(`${gobj_short_name(gobj)}: the file carries no connections list`);
        show_scan_errors(gobj, [{yuno: "", error: "the file is not a connections export"}]);
        return -1;
    }

    let imported = rows
        .filter((c) => c && c.url)      /*  a connection with no url can never open  */
        .map((c) => ({
            id:                  new_id(),
            label:               String(c.label || ""),
            url:                 String(c.url),
            remote_yuno_role:    String(c.remote_yuno_role || ""),
            remote_yuno_service: String(c.remote_yuno_service || ""),
            enabled:             false,
            services:            Array.isArray(c.services) ? c.services : []
        }));

    if(!imported.length) {
        log_error(`${gobj_short_name(gobj)}: the file holds no usable connection`);
        show_scan_errors(gobj, [{yuno: "", error: "the file holds no usable connection"}]);
        return -1;
    }

    let list = treedb_config_get_connections(config).concat(imported);
    gobj_send_event(config, "EV_SET_CONNECTIONS", {connections: list}, gobj);
    show_scan_errors(gobj, []);
    reload_table(gobj);
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
            ["EV_ON_OPEN",              ac_conn_status,          null],
            ["EV_ON_CLOSE",             ac_conn_status,          null],
            ["EV_TREEDB_SCAN_DONE",     ac_scan_done,            null],
            ["EV_TREEDB_SCAN_ERROR",    ac_scan_error,           null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,     null],
            /*  user actions: every click of the table crosses the machine  */
            ["EV_ADD_CONN",             ac_add_conn,             null],
            ["EV_CLONE_CONN",           ac_clone_conn,           null],
            ["EV_TOGGLE_SERVICE",       ac_toggle_service,       null],
            ["EV_REFRESH_SERVICES",     ac_refresh_services,     null],
            ["EV_TOGGLE_CONN_ENABLED",  ac_toggle_conn_enabled,  null],
            ["EV_REMOVE_CONN",          ac_remove_conn,          null],
            ["EV_CONFIRM_REMOVE_CONN",  ac_confirm_remove_conn,  null],
            ["EV_EXPORT_CONNS",         ac_export_conns,         null],
            ["EV_PICK_IMPORT_FILE",     ac_pick_import_file,     null],
            ["EV_IMPORT_CONNS",         ac_import_conns,         null]
        ]]
    ];

    const event_types = [
        ["EV_ON_OPEN",              0],
        ["EV_ON_CLOSE",             0],
        ["EV_TREEDB_SCAN_DONE",     0],
        ["EV_TREEDB_SCAN_ERROR",    0],
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_ADD_CONN",             0],
        ["EV_CLONE_CONN",           0],
        ["EV_TOGGLE_SERVICE",       0],
        ["EV_REFRESH_SERVICES",     0],
        ["EV_TOGGLE_CONN_ENABLED",  0],
        ["EV_REMOVE_CONN",          0],
        ["EV_CONFIRM_REMOVE_CONN",  0],
        ["EV_EXPORT_CONNS",         0],
        ["EV_PICK_IMPORT_FILE",     0],
        ["EV_IMPORT_CONNS",         0]
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
