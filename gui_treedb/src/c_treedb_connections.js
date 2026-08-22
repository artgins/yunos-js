/***********************************************************************
 *          c_treedb_connections.js
 *
 *      C_TREEDB_CONNECTIONS — the Settings page: an EDITABLE Tabulator table
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
 *      render as a TABLE OF THEIR OWN, nested in its row, FOLDED behind
 *      the row's chevron (the fold state is persisted per connection, and
 *      a fresh connection starts folded), with its own
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
 *      service checkbox, the chevron, the refresh, the connect/disconnect,
 *      the ✕ — sends EV_TOGGLE_SERVICE / EV_TOGGLE_CONN_EXPANDED /
 *      EV_REFRESH_SERVICES / EV_TOGGLE_CONN_ENABLED /
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
    gobj_is_destroying,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {TabulatorFull as Tabulator} from "tabulator-tables";

import {
    yui_shell_confirm_yesno,
    yui_shell_confirm_danger,
    yui_shell_show_modal,
} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";

import {
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_conn_services,
    treedb_config_is_conn_expanded,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_is_scanning,
} from "./c_treedb_links.js";

import {
    yui_selection_column,
    yui_selection_settings,
    yui_selection_bar,
    yui_wire_selection,
    yui_selected_rows,
    yui_clear_selection,
} from "@yuneta/gobj-ui/src/yui_table_select.js";

import {plan_conn_import} from "./conn_helpers.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_CONNECTIONS";

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
    $import_notice: null, /*  what the last import added / skipped  */
    $fold:        null,   /*  expand / collapse every services sub-table  */
    selection:    null,   /*  the shared selection bar (gobj-ui)  */
    import_notice: null,  /*  {added, skipped}: kept, so it survives a language change  */
    $help:        null,   /*  the how-to-use paragraph, folded by default  */
    $help_btn:    null,   /*  the (i) that folds/unfolds it  */
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
    gobj_write_attr(gobj, "table_id", "treedb_connections_table");
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
        ["button", {class: "button is-primary is-small CONNECTIONS_ADD", id: "treedb-connections-add",
                    title: t("add connection"),
                    "aria-label": t("add connection"),
                    "data-i18n-title": "add connection",
                    "data-i18n-aria-label": "add connection"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-plus"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "add connection"}, t("add connection")]
            ]
        ]);
    $add.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_ADD_CONN", {}, gobj);
    });

    /*  The connection set is browser-local: without these, moving it to another
     *  browser (or another operator's machine) means retyping every row.  */
    let $export = createElement2(
        ["button", {class: "button is-small ml-2 CONNECTIONS_EXPORT",
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
                   class: "is-hidden CONNECTIONS_IMPORT_FILE"}]);
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
        ["button", {class: "button is-small ml-2 CONNECTIONS_IMPORT",
                    title: t("add the connections of a json file"),
                    "aria-label": t("import"),
                    "data-i18n-title": "add the connections of a json file",
                    "data-i18n-aria-label": "import"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-upload"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "import"}, t("import")]
            ]
        ]);
    $import.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_PICK_IMPORT_FILE", {}, gobj);
    });

    /*  The same import, without the file. The agent console can put a set of
     *  connections on the clipboard (its Schemas picker knows every yuno's
     *  coordinates), and a file on disk between two tabs of one browser is a
     *  detour. Reads the same document as the file import — it is the same
     *  event.  */
    let $paste = createElement2(
        ["button", {class: "button is-small ml-2 CONNECTIONS_PASTE",
                    title: t("add the connections on the clipboard"),
                    "aria-label": t("paste"),
                    "data-i18n-title": "add the connections on the clipboard",
                    "data-i18n-aria-label": "paste"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-paste"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "paste"}, t("paste")]
            ]
        ]);
    $paste.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_PASTE_CONNS", {}, gobj);
    });

    /*  The how-to-use paragraph is long, and on a phone it pushed the table
     *  itself below the fold. It lives behind this toggle, folded away until
     *  asked for. Like every other control here, the click is an EVENT.  */
    let $help_btn = createElement2(
        ["button", {class: "button is-small ml-2 CONNECTIONS_HELP_TOGGLE",
                    "aria-expanded": "false",
                    title: t("show help"),
                    "aria-label": t("show help"),
                    "data-i18n-title": "show help",
                    "data-i18n-aria-label": "show help"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-circle-info"}]]]
            ]
        ]);
    $help_btn.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_TOGGLE_HELP", {}, gobj);
    });
    priv.$help_btn = $help_btn;
    priv.$paste_btn = $paste;

    let $help = createElement2(
        ["p", {class: "is-size-7 has-text-grey mb-3 is-hidden CONNECTIONS_HELP",
               i18n: "connections help"},
            "Edit cells inline. Each URL is a yuno's public wss endpoint " +
            "(plus its role and service). Connect with the plug button — " +
            "services are discovered on the first connect; check the ones " +
            "to browse."]);
    priv.$help = $help;

    let $scan_errors = createElement2(
        ["div", {class: "is-size-7 has-text-danger mb-2 is-hidden CONNECTIONS_SCAN_ERRORS"}, []]);
    priv.$scan_errors = $scan_errors;

    /*  An import that adds nothing because everything was already here is a
     *  correct outcome, not a failure: it says so in grey, beside the red
     *  box and not in it. */
    let $import_notice = createElement2(
        ["div", {class: "is-size-7 has-text-grey mb-2 is-hidden CONNECTIONS_IMPORT_NOTICE"}, []]);
    priv.$import_notice = $import_notice;

    /*  Selecting rows is a shared facility (gobj-ui): the checkbox column,
     *  the settings behind it, and this bar. Removing twenty connections one
     *  confirmation at a time is not a workflow — and after a scan there ARE
     *  twenty. Every button here does one thing: send an event.  */
    priv.selection = yui_selection_bar(t, {
        name:    "CONNECTIONS",
        actions: [{
            label:    "remove selected",
            icon:     "yi-trash",
            class:    "is-danger",
            on_click: () => gobj_send_event(gobj, "EV_REMOVE_SELECTED_CONNS", {}, gobj)
        }],
        on_clear: () => gobj_send_event(gobj, "EV_CLEAR_SELECTION", {}, gobj)
    });

    /*  One control for every row's services sub-table. Its icon says what
     *  the CLICK will do: chevron-down while any connection is folded,
     *  chevron-right once they are all open.  */
    let $fold = createElement2(
        ["button", {class: "CONNECTIONS_FOLD button mr-1", type: "button",
                    title: t("expand all"), "aria-label": t("expand all"),
                    "data-i18n-title": "expand all", "data-i18n-aria-label": "expand all"},
            [["span", {class: "icon"}, [["i", {class: "yi-chevron-down"}]]]]
        ]);
    $fold.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_TOGGLE_FOLD", {}, gobj);
    });
    priv.$fold = $fold;

    let $container = createElement2(
        ["div", {class: "C_TREEDB_CONNECTIONS ytreedb-connections p-4"},
            [
                /*  NOT Bulma's `.level`: below 769px it turns itself AND its
                 *  two halves into `flex-direction: column`, so the three
                 *  action buttons stacked one per line and ate the screen the
                 *  table needed (`.level.is-mobile` does not fix it either —
                 *  it only restores `display: flex`, leaving the halves in
                 *  column). A plain flex row that wraps only if it must.  */
                ["div", {class: "CONNECTIONS_HEADER is-flex is-align-items-center "
                              + "is-justify-content-space-between is-flex-wrap-wrap mb-3"}, [
                    /*  The fold belongs with what you are LOOKING at, not
                     *  with what you do to it: left with the title, where it
                     *  stays when the row wraps on a phone.  */
                    ["div", {class: "CONNECTIONS_TITLE is-flex is-align-items-center"}, [
                        $fold,
                        ["h2", {class: "title is-5 mb-0 ml-1", i18n: "connections"}, "Connections"],
                        $help_btn
                    ]],
                    ["div", {class: "CONNECTIONS_ACTIONS is-flex is-align-items-center"},
                        [$add, $export, $import, $paste, $file]]
                ]],
                $help,
                $scan_errors,
                $import_notice,
                priv.selection.$el,
                ["div", {id: table_id}, []]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
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
    let $old = $row.querySelector(".CONNECTIONS_SUBTABLE");
    if($old) {
        $old.remove();
    }

    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    let services = conn ? treedb_config_conn_services(conn) : [];
    if(!services.length) {
        return;     /*  never scanned, or an empty yuno: no sub-table at all  */
    }
    if(!config || !treedb_config_is_conn_expanded(config, conn_id)) {
        return;     /*  folded: the chevron of the row unfolds it  */
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
        ["div", {class: "CONNECTIONS_SUBTABLE",
                 style: "margin: 0.25rem 0 0.5rem 2rem; max-width: calc(100% - 2.5rem);"},
            []]);
    let $table = createElement2(["div", {class: "CONNECTIONS_SUBTABLE_TABLE"}, []]);
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
                    $s.classList.add("CONNECTIONS_SERVICE", "has-text-weight-semibold");
                    $s.textContent = cell.getValue();
                    return $s;
                }},
            {title: t("class"), field: "gclass", minWidth: 120,
                formatter: (cell) => {
                    let $tag = document.createElement("span");
                    $tag.classList.add("tag", "is-size-7", "is-light",
                        "CONNECTIONS_SERVICE_GCLASS",
                        cell.getValue() === "C_TRANGER" ? "is-warning" : "is-info");
                    $tag.textContent = cell.getValue();
                    return $tag;
                }},
            {title: t("browse"), field: "selected", minWidth: 100, hozAlign: "center",
                /*  The HEADER is the select-all. A yuno routinely exposes a
                 *  dozen services and the only way to take them all was to
                 *  click each one; the header carries the state of the whole
                 *  column (all / none / some) and flips it. All-on flips to
                 *  none; anything else flips to all — which is what "some are
                 *  ticked and I pressed it" means. */
                titleFormatter: (cell) => {
                    let $wrap = document.createElement("span");
                    $wrap.classList.add("CONNECTIONS_SERVICES_ALL");
                    let state = services_check_state(gobj, conn_id);
                    $wrap.setAttribute("role", "checkbox");
                    $wrap.setAttribute("aria-checked",
                        state === "all"? "true" : (state === "none"? "false" : "mixed"));
                    $wrap.setAttribute("title", t("browse every service"));
                    $wrap.setAttribute("aria-label", t("browse every service"));
                    let $icon = document.createElement("span");
                    $icon.classList.add("icon");
                    let $i = document.createElement("i");
                    $i.className = (state === "all")? "yi-square-check" : "yi-square";
                    $icon.appendChild($i);
                    let $txt = document.createElement("span");
                    $txt.classList.add("ml-1");
                    $txt.textContent = t("browse");
                    $wrap.appendChild($icon);
                    $wrap.appendChild($txt);
                    return $wrap;
                },
                headerClick: (e) => {
                    gobj_send_event(gobj, "EV_TOGGLE_ALL_SERVICES",
                        {conn_id: conn_id}, gobj);
                },
                formatter: (cell) => {
                    let on = !!cell.getValue();
                    return `<span class="icon CONNECTIONS_SERVICE_CHECK" role="checkbox" `
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
        let $line = createElement2(["div", {class: "CONNECTIONS_SCAN_ERROR"}, []]);
        $line.textContent = (err.yuno ? `${err.yuno}: ` : "") + t(err.error || "scan failed");
        $box.appendChild($line);
    }
    $box.classList.remove("is-hidden");
}

/***************************************************************
 *  Say what the last import did. Kept in priv, because a count
 *  composed at render time cannot re-translate itself: the language
 *  can change while the line is on screen.
 ***************************************************************/
function render_import_notice(gobj)
{
    let priv = gobj.priv;
    let $box = priv.$import_notice;
    if(!$box) {
        return;
    }
    let n = priv.import_notice;
    if(!n || (!n.added && !n.skipped)) {
        $box.textContent = "";
        $box.classList.add("is-hidden");
        return;
    }
    let parts = [];
    if(n.added) {
        parts.push(t("{{n}} connections added", {n: n.added}));
    }
    if(n.skipped) {
        parts.push(t("{{n}} connections already here", {n: n.skipped}));
    }
    $box.textContent = parts.join(" \u00b7 ");
    $box.classList.remove("is-hidden");
}

/***************************************************************
 *  Record what an import did and show it.
 ***************************************************************/
function set_import_notice(gobj, notice)
{
    gobj.priv.import_notice = notice;
    render_import_notice(gobj);
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
    function expand_formatter(cell)
    {
        let d = cell.getData();
        let config = gobj_find_service("treedb_config", false);
        let conn = config ? treedb_config_get_connection(config, d.id) : null;
        let services = conn ? treedb_config_conn_services(conn) : [];
        if(!services.length) {
            return "";      /*  nothing discovered: there is no sub-table to fold  */
        }
        let expanded = config ? treedb_config_is_conn_expanded(config, d.id) : false;
        let icon = expanded ? "yi-chevron-down" : "yi-chevron-right";
        let title = expanded ? t("hide services") : t("show services");
        return `<span class="icon CONNECTIONS_EXPAND" title="${title}" `
             + `role="button" aria-expanded="${expanded ? "true" : "false"}" `
             + `aria-label="${title}"><i class="${icon}"></i></span>`;
    }

    function expand_click(e, cell)
    {
        let d = cell.getData();
        gobj_send_event(gobj, "EV_TOGGLE_CONN_EXPANDED", {conn_id: d.id}, gobj);
    }

    function refresh_formatter(cell)
    {
        let d = cell.getData();
        let links = gobj_find_service("treedb_links", false);
        let scanning = links ? treedb_links_is_scanning(links, d.id) : false;
        let connected = links ? treedb_links_is_connected(links, d.id) : false;
        let cls = (connected && !scanning) ? "" : " has-text-grey-light";
        let title = scanning ? t("refreshing services") : t("refresh services");
        return `<span class="icon CONNECTIONS_REFRESH${cls}" title="${title}" `
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
        return `<span class="icon CONNECTIONS_CONNECT${cls}" title="${title}" `
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
        return `<span class="icon CONNECTIONS_CLONE" title="${t("clone this connection")}" `
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
        yui_selection_column(),
        {title: "", field: "_expand", width: 40, minWidth: 40, headerSort: false,
            hozAlign: "center", formatter: expand_formatter, cellClick: expand_click},
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
        ...yui_selection_settings(),
        index:          "id",
        layout:         "fitColumns",
        maxHeight:      "70vh",
        /*  A row of this table is TALLER than its cells — it carries the
         *  connection's services sub-table. The VIRTUAL renderer assumes the
         *  opposite: opening a cell editor it scrolls the row's BOTTOM into view
         *  (Edit.focusScrollAdjust), which with a sub-table below the cells means
         *  scrolling the cell you are editing off the top of the table — the
         *  caret stayed in a field nobody could see. The basic renderer renders
         *  every row in flow and does not do that; the connections of one browser
         *  are a handful of rows, so there is nothing to virtualize anyway.  */
        renderVertical: "basic",
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
    /*  A tick is an OS notification like any other: its only job is to make
     *  an event. What the bar shows is decided in the action.  */
    yui_wire_selection(table, function(count) {
        if(gobj_is_destroying(gobj)) {
            return;
        }
        gobj_send_event(gobj, "EV_SELECTION_CHANGED", {count: count}, gobj);
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
        /*  The rows the selection named are about to be replaced, and a
         *  count of rows that are no longer there is worse than no count. */
        yui_clear_selection(table);
        table.setData(rows_from_config(gobj));
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${e}`);
    }
    render_fold(gobj);
    if(gobj.priv.selection) {
        gobj.priv.selection.set_count(0);
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
    render_import_notice(gobj);
    if(gobj.priv.selection) {
        gobj.priv.selection.refresh();
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
 *  The (i) beside the title: fold / unfold the how-to-use paragraph.
 *
 *  It is long, and on a phone it pushed the connections table below the
 *  fold — so it starts folded and the icon asks for it. Transient on
 *  purpose: this view is `lazy_destroy`, so every visit to Settings opens
 *  on the table. Bulma's `is-hidden` carries `!important`, so the class is
 *  what toggles (an inline `style.display` would lose to it).
 ***************************************************************/
function ac_toggle_help(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.$help || !priv.$help_btn) {
        log_error(`${gobj_short_name(gobj)}: no help paragraph to fold`);
        return -1;
    }
    let shown = !priv.$help.classList.toggle("is-hidden");
    let key = shown ? "hide help" : "show help";
    priv.$help_btn.setAttribute("aria-expanded", shown ? "true" : "false");
    priv.$help_btn.setAttribute("title", t(key));
    priv.$help_btn.setAttribute("aria-label", t(key));
    priv.$help_btn.setAttribute("data-i18n-title", key);
    priv.$help_btn.setAttribute("data-i18n-aria-label", key);
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
/***************************************************************
 *  Is the whole "browse" column of a connection on, off, or mixed?
 *  Read from the CONFIG and not from the sub-table, so the header is
 *  right the moment it is drawn — before the table has any rows.
 ***************************************************************/
function services_check_state(gobj, conn_id)
{
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    let list = conn ? treedb_config_conn_services(conn) : [];
    if(!list.length) {
        return "none";
    }
    let on = list.filter((s) => s.selected).length;
    if(on === 0) {
        return "none";
    }
    if(on === list.length) {
        return "all";
    }
    return "some";
}

/***************************************************************
 *  Take every service of a connection, or drop every one.
 *
 *  All-on drops them; anything else takes them all — which is what
 *  "some are ticked and I pressed it" means. A yuno routinely exposes
 *  a dozen services, and one click each was the only way there was.
 ***************************************************************/
function ac_toggle_all_services(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    if(!conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' ` +
                  `whose services to take`);
        return -1;
    }

    let want = (services_check_state(gobj, conn_id) !== "all");
    let list = treedb_config_conn_services(conn).map((s) => ({
        service: s.service, gclass: s.gclass, selected: want
    }));
    if(!list.length) {
        return 0;       /*  nothing discovered yet: nothing to take  */
    }
    gobj_send_event(config, "EV_SET_CONN_SERVICES",
        {conn_id: conn_id, services: list}, gobj);

    let sub = gobj.priv.subtables[conn_id];
    if(sub) {
        try {
            sub.getRows().forEach((row) => row.update({selected: want}));
            /*  The header carries the column's state, so it has to be
             *  redrawn too — its own cell is not one of the rows. */
            sub.redraw(true);
        } catch(e) {
            log_warning(`${GCLASS_NAME}: sub-table mid-rebuild: ${e}`);
        }
    }
    return 0;
}

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
            /*  One service changing can flip the whole column between
             *  all / some / none, and that state lives in the header. */
            sub.redraw(true);
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
 *  The chevron of a connection row: fold / unfold its services
 *  sub-table. The flag is persisted (C_TREEDB_CONFIG), so the page comes
 *  back the way it was left.
 *
 *  Only THIS row is repainted: `reformat()` re-runs the rowFormatter,
 *  which builds the sub-table or drops it. Folding also needs an explicit
 *  normalizeHeight(): the row is still pinned to the inline height it was
 *  given when the sub-table was under its cells, so without it the row
 *  keeps a hole where the sub-table used to be. Unfolding does not — the
 *  sub-table's own `tableBuilt` re-measures once it is really built.
 ***************************************************************/
/***************************************************************
 *  Is any connection with services still folded? That is what the
 *  button offers to do, and what its icon has to say. A connection
 *  with nothing discovered has no sub-table and does not count.
 ***************************************************************/
function some_folded(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        return true;
    }
    return treedb_config_get_connections(config).some(function(conn) {
        return conn &&
            treedb_config_conn_services(conn).length > 0 &&
            !treedb_config_is_conn_expanded(config, conn.id);
    });
}

/***************************************************************
 *  The fold button says what the CLICK will do.
 ***************************************************************/
function render_fold(gobj)
{
    let $fold = gobj.priv.$fold;
    if(!$fold) {
        return;
    }
    let expand = some_folded(gobj);
    let key = expand ? "expand all" : "collapse all";
    let $icon = $fold.querySelector("span.icon > i");
    if($icon) {
        $icon.className = expand ? "yi-chevron-down" : "yi-chevron-right";
    }
    $fold.title = t(key);
    $fold.setAttribute("aria-label", t(key));
    $fold.setAttribute("data-i18n-title", key);
    $fold.setAttribute("data-i18n-aria-label", key);
}

/***************************************************************
 *  Unfold every connection's services, or fold them all.
 *
 *  ONE write (`EV_SET_CONNS_EXPANDED`): the expanded set is
 *  persisted, and saving it once per row would write the config as
 *  many times as there are connections.
 ***************************************************************/
function ac_toggle_fold(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot fold`);
        return -1;
    }
    let conns = treedb_config_get_connections(config)
        .filter((c) => c && treedb_config_conn_services(c).length > 0);
    if(!conns.length) {
        return 0;   /*  nothing discovered yet: no sub-table to open  */
    }
    let expanded = some_folded(gobj);

    gobj_send_event(config, "EV_SET_CONNS_EXPANDED",
        {conn_ids: conns.map((c) => c.id), expanded: expanded}, gobj);

    /*  The sub-tables live inside the row elements: a reload is what
     *  builds (and destroys) them cleanly.  */
    reload_table(gobj);
    return 0;
}

function ac_toggle_conn_expanded(gobj, event, kw, src)
{
    let conn_id = (kw && kw.conn_id) || "";
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    if(!conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${conn_id}' to fold`);
        return -1;
    }
    let expanded = !treedb_config_is_conn_expanded(config, conn_id);
    gobj_send_event(config, "EV_SET_CONN_EXPANDED",
        {conn_id: conn_id, expanded: expanded}, gobj);
    render_fold(gobj);

    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    try {
        let row = table.getRow(conn_id);
        if(row) {
            row.reformat();
            if(!expanded) {
                row.normalizeHeight();
                resize_parent(gobj);
            }
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${e}`);
    }
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
    let shell = yui_shell_of(gobj);
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
 *  The selection changed: that is all the bar shows.
 ***************************************************************/
function ac_selection_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.selection) {
        priv.selection.set_count((kw && kw.count) || 0);
    }
    return 0;
}

/***************************************************************
 *  The way out of a selection.
 ***************************************************************/
function ac_clear_selection(gobj, event, kw, src)
{
    yui_clear_selection(gobj_read_attr(gobj, "tabulator"));
    if(gobj.priv.selection) {
        gobj.priv.selection.set_count(0);
    }
    return 0;
}

/***************************************************************
 *  Remove every SELECTED connection: one question for the lot.
 *
 *  The question names the count and lists what is going, because this
 *  is the button that makes a mistake expensive — removing a connection
 *  drops its open tabs and its saved Tranger views with it, and here it
 *  does so to twenty at once. The red button is the one that deletes and
 *  the safe answer is the last one, so Escape and the backdrop cancel.
 ***************************************************************/
function ac_remove_selected_conns(gobj, event, kw, src)
{
    let rows = yui_selected_rows(gobj_read_attr(gobj, "tabulator"));
    if(!rows.length) {
        return 0;   /*  the bar is not even on screen  */
    }
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot confirm the removal`);
        return -1;
    }

    let ids = rows.map((r) => r && r.id).filter(Boolean);
    let shown = rows.slice(0, 10);
    let children = [
        ["p", {class: "CONNECTIONS_REMOVE_COUNT has-text-weight-bold mb-2"},
            t("remove {{n}} connections", {n: ids.length})],
        ["ul", {class: "CONNECTIONS_REMOVE_LIST is-size-7"},
            shown.map((r) => ["li", {}, String((r && (r.label || r.url)) || "")])]
    ];
    if(rows.length > shown.length) {
        children.push(
            ["p", {class: "CONNECTIONS_REMOVE_MORE is-size-7 has-text-grey"},
                t("{{n}} more", {n: rows.length - shown.length})]);
    }
    let $question = createElement2(["div", {class: "CONNECTIONS_REMOVE_MANY"}, children]);

    yui_shell_confirm_danger(shell, $question, {
        title:         "remove selected",
        confirm_label: "remove",
        cancel_label:  "cancel",
        t:             t
    }).then((yes) => {
        if(gobj_is_destroying(gobj)) {
            return;     /*  Settings left while the dialog was up  */
        }
        gobj_send_event(gobj, "EV_CONFIRM_REMOVE_SELECTED",
            {conn_ids: ids, yes: !!yes}, gobj);
    });
    return 0;
}

/***************************************************************
 *  The answer to that one question.
 ***************************************************************/
function ac_confirm_remove_selected(gobj, event, kw, src)
{
    if(!kw || !kw.yes) {
        return 0;   /*  the user said no  */
    }
    let ids = Array.isArray(kw.conn_ids) ? kw.conn_ids : [];
    if(!ids.length) {
        return 0;
    }
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot remove`);
        return -1;
    }
    let going = new Set(ids);
    let list = treedb_config_get_connections(config).filter((c) => c && !going.has(c.id));
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
 *  Import connections from a picked file or from the clipboard: ADD
 *  WHAT IS NEW, never replace the set and never repeat what is here.
 *
 *  Every connection that IS added gets a FRESH id and lands DISABLED.
 *  Fresh because the id is what everything else in this browser is keyed
 *  by (the open tabs, the Tranger views): reusing an exported id would
 *  silently adopt whatever local state a previous connection of that id
 *  had left behind. Disabled because importing must not open sockets.
 ***************************************************************/
/***************************************************************
 *  Import what is on the clipboard.
 *
 *  `navigator.clipboard.readText()` is the short path and it is not
 *  always allowed to take it: Firefox refuses a silent read outright,
 *  and Chrome may put a permission prompt in the way. So a refusal is
 *  not an error — it opens a box to paste into, which works in every
 *  browser and needs nobody's permission. Both roads end in the same
 *  EV_IMPORT_CONNS as the file import, which is where the document is
 *  understood.
 ***************************************************************/
function ac_paste_conns(gobj, event, kw, src)
{
    let read = null;
    try {
        read = navigator.clipboard && navigator.clipboard.readText
             ? navigator.clipboard.readText() : null;
    } catch(e) {
        read = null;
    }

    if(!read) {
        open_paste_dialog(gobj, "");
        return 0;
    }

    read.then((text) => {
        if(!text || !text.trim()) {
            open_paste_dialog(gobj, "");
            return;
        }
        gobj_send_event(gobj, "EV_IMPORT_CONNS", {text: text}, gobj);
    }).catch(() => {
        open_paste_dialog(gobj, "");
    });

    return 0;
}

/***************************************************************
 *  The box to paste into, for when the clipboard cannot be read.
 ***************************************************************/
function open_paste_dialog(gobj, text)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot open the paste box`);
        return;
    }

    let $area = createElement2(
        ["textarea", {class: "textarea CONNECTIONS_PASTE_AREA", rows: "10",
                      spellcheck: "false",
                      placeholder: t("paste the connections here"),
                      "data-i18n-placeholder": "paste the connections here"}]);
    $area.value = text || "";

    let $ok = createElement2(
        ["button", {class: "button is-primary mt-3 CONNECTIONS_PASTE_OK",
                    i18n: "import"}, t("import")]);

    let $box = createElement2(
        ["div", {class: "CONNECTIONS_PASTE_BOX"}, [$area, $ok]]);

    let modal = yui_shell_show_modal(shell, $box, {
        dialog:        true,
        logical_class: "CONNECTIONS_PASTE_DIALOG",
        title:         "paste",
        t:             t
    });

    $ok.addEventListener("click", () => {
        let value = $area.value;
        if(modal && typeof modal.close === "function") {
            modal.close();
        }
        gobj_send_event(gobj, "EV_IMPORT_CONNS", {text: value}, gobj);
    });

    /*  A paste box the caret is not in is a box you have to click first. */
    setTimeout(() => {
        try {
            $area.focus();
        } catch(e) {
            /*  the dialog was closed before the focus landed  */
        }
    }, 0);
}

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

    /*  An import ADDS WHAT IS NEW. The same document is pasted again and
     *  again — the agent console rebuilds it whole every time it scans, and
     *  a node gained one yuno — and every re-paste used to duplicate the
     *  whole set, because every imported row was given a fresh id and a
     *  fresh id is a new row by construction. So the set already here is
     *  matched first, by what identifies a connection (url + service), and
     *  a row that is already here is left ALONE: it may have been edited
     *  since (a host fixed by hand, services unticked) and the document
     *  arriving is not more authoritative than that.  */
    let list = treedb_config_get_connections(config);
    let plan = plan_conn_import(list, rows);
    let skipped = plan.skipped;
    let imported = plan.fresh.map((c) => ({
        id:                  new_id(),
        label:               String(c.label || ""),
        url:                 String(c.url),
        remote_yuno_role:    String(c.remote_yuno_role || ""),
        remote_yuno_service: String(c.remote_yuno_service || ""),
        enabled:             false,
        services:            Array.isArray(c.services) ? c.services : []
    }));

    if(!imported.length) {
        if(skipped) {
            /*  Nothing new is not a failure: the operator pasted a document
             *  they already have. */
            show_scan_errors(gobj, []);
            set_import_notice(gobj, {added: 0, skipped: skipped});
            return 0;
        }
        log_error(`${gobj_short_name(gobj)}: the file holds no usable connection`);
        show_scan_errors(gobj, [{yuno: "", error: "the file holds no usable connection"}]);
        return -1;
    }

    gobj_send_event(config, "EV_SET_CONNECTIONS",
        {connections: list.concat(imported)}, gobj);
    show_scan_errors(gobj, []);
    set_import_notice(gobj, {added: imported.length, skipped: skipped});
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
            ["EV_TOGGLE_HELP",          ac_toggle_help,          null],
            ["EV_ADD_CONN",             ac_add_conn,             null],
            ["EV_CLONE_CONN",           ac_clone_conn,           null],
            ["EV_TOGGLE_SERVICE",       ac_toggle_service,       null],
            ["EV_TOGGLE_ALL_SERVICES",  ac_toggle_all_services,  null],
            ["EV_REFRESH_SERVICES",     ac_refresh_services,     null],
            ["EV_TOGGLE_CONN_ENABLED",  ac_toggle_conn_enabled,  null],
            ["EV_TOGGLE_FOLD",          ac_toggle_fold,          null],
            ["EV_TOGGLE_CONN_EXPANDED", ac_toggle_conn_expanded, null],
            ["EV_REMOVE_CONN",          ac_remove_conn,          null],
            ["EV_CONFIRM_REMOVE_CONN",  ac_confirm_remove_conn,  null],
            ["EV_EXPORT_CONNS",         ac_export_conns,         null],
            ["EV_PICK_IMPORT_FILE",     ac_pick_import_file,     null],
            ["EV_IMPORT_CONNS",         ac_import_conns,         null],
            ["EV_PASTE_CONNS",          ac_paste_conns,          null],
            ["EV_SELECTION_CHANGED",    ac_selection_changed,    null],
            ["EV_CLEAR_SELECTION",      ac_clear_selection,      null],
            ["EV_REMOVE_SELECTED_CONNS", ac_remove_selected_conns, null],
            ["EV_CONFIRM_REMOVE_SELECTED", ac_confirm_remove_selected, null]
        ]]
    ];

    const event_types = [
        ["EV_ON_OPEN",              0],
        ["EV_ON_CLOSE",             0],
        ["EV_TREEDB_SCAN_DONE",     0],
        ["EV_TREEDB_SCAN_ERROR",    0],
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_TOGGLE_HELP",          0],
        ["EV_ADD_CONN",             0],
        ["EV_CLONE_CONN",           0],
        ["EV_TOGGLE_SERVICE",       0],
        ["EV_TOGGLE_ALL_SERVICES",  0],
        ["EV_REFRESH_SERVICES",     0],
        ["EV_TOGGLE_CONN_ENABLED",  0],
        ["EV_TOGGLE_FOLD",          0],
        ["EV_TOGGLE_CONN_EXPANDED", 0],
        ["EV_REMOVE_CONN",          0],
        ["EV_CONFIRM_REMOVE_CONN",  0],
        ["EV_EXPORT_CONNS",         0],
        ["EV_PICK_IMPORT_FILE",     0],
        ["EV_IMPORT_CONNS",         0],
        ["EV_PASTE_CONNS",          0],
        ["EV_SELECTION_CHANGED",    0],
        ["EV_CLEAR_SELECTION",      0],
        ["EV_REMOVE_SELECTED_CONNS", 0],
        ["EV_CONFIRM_REMOVE_SELECTED", 0]
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

function register_c_treedb_connections()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_connections};
