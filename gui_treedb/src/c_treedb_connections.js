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
 *      button of a row re-runs the discovery.
 *
 *      THE SERVICES ARE CHILD ROWS of their connection — the same tree the
 *      Schemas picker of gui_agent draws. The two tables show the same
 *      thing (a backend and the treedbs it exposes) and one is literally
 *      pasted into the other ("For TreeDB"), so they are read the same way:
 *      connection on top, services underneath, a BROWSE checkbox with three
 *      states on the parent, the live state as a dot and a word in one
 *      cell. What only exists here — editing the url, connect, clone,
 *      delete — stays here, as icons at the end of the row.
 *
 *      They used to be a table of their own nested in the row, which is
 *      what forced the basic renderer, the destroy-before-reload dance and
 *      the row-height recalculations; all of that is gone with it. The
 *      service checkbox edits the service's `selected` flag — selected
 *      services are the ones offered in the workspace pickers
 *      ("connections" tab of Topics / Graphs).
 *      Deleting a row asks for confirmation (shell yes/no dialog).
 *
 *      A view: builds its own `$container` for the shell to mount.
 *
 *      Every click of the table is an EVENT (the SPA's contract: a DOM
 *      handler's only job is to make one). A Tabulator `cellClick` — the
 *      service checkbox, the chevron, the refresh, the connect/disconnect,
 *      the ✕ — sends EV_TOGGLE_SERVICE /
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
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";

import {
    treedb_config_get_connections,
    treedb_config_get_connection,
    treedb_config_conn_services,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_is_scanning,
} from "./c_treedb_links.js";

import {plan_conn_import, conns_browse_state} from "./conn_helpers.js";


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
    $fold:        null,   /*  expand / collapse the whole tree  */
    $count:       null,   /*  "N connections · M services · K to browse"  */
    delete_modal: null,   /*  the remove-several box, while it is up  */
    $search:      null,
    search:       "",     /*  survives a reload (a scan finishing)  */
    loaded:       false,  /*  past the first load WITH rows  */
    import_notice: null,  /*  {added, skipped}: kept, so it survives a language change  */
    $help:        null,   /*  the how-to-use paragraph, folded by default  */
    $help_btn:    null,   /*  the (i) that folds/unfolds it  */
    $import_file: null,   /*  hidden <input type=file> of the Import button  */
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

    /*  A search box and a count, the same two the pickers carry: this table
     *  holds one row per backend of a deploy centre.  */
    let $search = createElement2(["input", {
        class:        "CONNECTIONS_SEARCH input",
        type:         "text",
        placeholder:  t("search a node or a treedb"),
        "data-i18n-placeholder": "search a node or a treedb"
    }]);
    $search.addEventListener("input", () => {
        gobj_send_event(gobj, "EV_SEARCH", {text: $search.value || ""}, gobj);
    });
    priv.$search = $search;

    let $search_control = createElement2(
        ["div", {class: "CONNECTIONS_SEARCH_CONTROL control has-icons-left",
                 style: "flex:1 1 12rem; max-width:22rem; min-width:0;"}, [
            $search,
            ["span", {class: "icon is-left"}, [["span", {class: "yi-magnifying-glass"}, ""]]]
        ]]
    );
    attach_clear($search_control, $search);

    priv.$count = createElement2(
        ["span", {class: "CONNECTIONS_COUNT is-size-7 has-text-grey ml-2"}, ""]);

    /*  Deleting SEVERAL connections without touching the row checkbox — which
     *  means "browse this treedb" and cannot also mean "kill this backend".
     *  A deliberate, rare, destructive job gets its own dialog: tick what
     *  goes, read the list, press once.  */
    let $delete_many = createElement2(
        ["button", {class: "button CONNECTIONS_DELETE_MANY ml-1", type: "button",
                    title: t("remove several connections"),
                    "aria-label": t("remove several connections"),
                    "data-i18n-title": "remove several connections",
                    "data-i18n-aria-label": "remove several connections"},
            [
                ["span", {class: "icon"}, [["i", {class: "yi-trash"}]]],
                ["span", {class: "is-hidden-mobile", i18n: "remove"}, "Remove"]
            ]
        ]);
    $delete_many.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_DELETE_MANY", {}, gobj);
    });

    let $container = createElement2(
        ["div", {class: "C_TREEDB_CONNECTIONS ytreedb-connections p-4"},
            [
                /*  NOT Bulma's `.level`: below 769px it turns itself AND its
                 *  two halves into `flex-direction: column`, so the three
                 *  action buttons stacked one per line and ate the screen the
                 *  table needed (`.level.is-mobile` does not fix it either —
                 *  it only restores `display: flex`, leaving the halves in
                 *  column). A plain flex row that wraps only if it must.  */
                /*  NOT `space-between`: with the fold and the search as
                 *  children of this row it pushed them apart — the fold ended
                 *  up at the right of the title line and the search on the
                 *  next one. The actions take the right with `margin-left`,
                 *  the same way the two pickers do it.  */
                ["div", {class: "CONNECTIONS_HEADER is-flex is-align-items-center "
                              + "is-flex-wrap-wrap mb-3", style: "gap:.5rem;"}, [
                    /*  The fold belongs with what you are LOOKING at, not
                     *  with what you do to it: left with the title, where it
                     *  stays when the row wraps on a phone.  */
                    ["div", {class: "CONNECTIONS_TITLE is-flex is-align-items-center"}, [
                        ["h2", {class: "title is-5 mb-0", i18n: "connections"}, "Connections"],
                        $help_btn
                    ]],
                    /*  The fold and the search are ONE wrapping unit: the
                     *  fold sits immediately to the left of the box, and a
                     *  phone that pushes the pair to the next line takes them
                     *  together instead of leaving the fold behind, stuck to
                     *  the title. Same place in the three tables of these
                     *  apps — same thing, same spot.  */
                    ["div", {class: "CONNECTIONS_FINDER is-flex is-align-items-center",
                             style: "gap:.5rem; flex:1 1 14rem; max-width:24rem; min-width:0;"},
                        [$fold, $search_control]],
                    priv.$count,
                    ["div", {class: "CONNECTIONS_ACTIONS is-flex is-align-items-center",
                             style: "gap:.5rem; margin-left:auto;"},
                        [$add, $delete_many, $export, $import, $paste, $file]]
                ]],
                $help,
                $scan_errors,
                $import_notice,
                ["div", {id: table_id}, []]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  The rows of the table: a connection on top, its discovered services
 *  as its dataTree children — the same tree the picker of gui_agent
 *  draws. A child wears this table's columns, so the formatters of the
 *  three columns a service has anything to say in (browse, label,
 *  status) each answer for `_type === "svc"` on its own.
 ***************************************************************/
function rows_from_config(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    let conns = config ? treedb_config_get_connections(config) : [];

    return conns.map(function(c) {
        let services = treedb_config_conn_services(c);
        let connected = links ? treedb_links_is_connected(links, c.id) : false;
        return {
            id:                  c.id,
            _type:               "conn",
            conn_id:             c.id,
            label:               c.label || "",
            url:                 c.url || "",
            remote_yuno_role:    c.remote_yuno_role || "",
            remote_yuno_service: c.remote_yuno_service || "",
            connected:           connected,
            _children: services.map(function(svc) {
                return {
                    id:        `${c.id}\u001F${svc.service}`,
                    _type:     "svc",
                    conn_id:   c.id,
                    svc_key:   svc.service,
                    label:     svc.service,
                    gclass:    svc.gclass || "",
                    selected:  !!svc.selected,
                    connected: connected,
                    url:                 "",
                    remote_yuno_role:    "",
                    remote_yuno_service: ""
                };
            })
        };
    });
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
/***************************************************************
 *  A formatter returns HTML, so what comes from the data is escaped:
 *  a connection label is typed by the operator.
 ***************************************************************/
function esc(v)
{
    return String(v === undefined || v === null ? "" : v)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/***************************************************************
 *  The live dot of a connection — the same one the picker of
 *  gui_treedb and the one of gui_agent paint.
 ***************************************************************/
function status_dot(connected)
{
    return `<span class="CONNECTIONS_STATUS_DOT" style="display:inline-block; ` +
        `width:0.7em; height:0.7em; border-radius:50%; margin-right:0.5em; ` +
        `vertical-align:middle; background:${connected ? "#48c78e" : "#b5b5b5"};"></span>`;
}

function make_columns(gobj)
{
    /*  The SAME shape as the picker of gui_agent (`C_STATS_NODES`): the two
     *  tables show the same thing — a backend and the treedbs it exposes,
     *  and one is literally pasted into the other — so they are read the same
     *  way. A tree: the connection on top, its services underneath; the
     *  checkbox means BROWSE in both; the status is a dot and a word in one
     *  cell. What only lives here (edit the url, connect, clone, delete)
     *  stays here, at the end of the row.
     *
     *  A cellClick is an OS notification: its only job is to make an event,
     *  and the kw carries IDENTITIES (conn_id, svc_key) — never the row or
     *  the cell: a kw must stay plain JSON (the machine trace serializes it).  */
    function browse_formatter(cell)
    {
        let d = cell.getData();
        let $cb = document.createElement("input");
        $cb.type = "checkbox";

        if(d._type === "svc") {
            $cb.className = "CONNECTIONS_SERVICE_CHECK";
            $cb.checked = !!d.selected;
            $cb.setAttribute("aria-label", t("browse"));
            $cb.title = t("browse");
            return $cb;
        }
        /*  The connection's own box takes or drops ALL its services, and says
         *  which of the three it is in: none, some, all.  */
        let state = services_check_state(gobj, d.conn_id);
        $cb.className = "CONNECTIONS_CONN_CHECK";
        $cb.disabled = (state === "none") && !has_services(gobj, d.conn_id);
        $cb.checked = (state === "all");
        $cb.indeterminate = (state === "some");
        $cb.setAttribute("aria-label", t("browse all of this connection"));
        $cb.title = t("browse all of this connection");
        return $cb;
    }

    function browse_click(e, cell)
    {
        let d = cell.getData();
        if(d._type === "svc") {
            gobj_send_event(gobj, "EV_TOGGLE_SERVICE",
                {conn_id: d.conn_id, svc_key: d.svc_key}, gobj);
            return;
        }
        gobj_send_event(gobj, "EV_TOGGLE_ALL_SERVICES", {conn_id: d.conn_id}, gobj);
    }

    /*  The column's own box, in the header: it takes or drops every service
     *  of every connection the filter leaves ON SCREEN. A pasted deploy
     *  centre arrives with nothing ticked and two hundred backends in it,
     *  and one click per treedb is not a way to say "this node".
     *
     *  A `titleFormatter` runs again only on `setColumns()`, which redraws
     *  every row with it — a whole table repainted to move one checkbox
     *  between its three states. So the states are written on the LIVE
     *  element after every change (paint_browse_header), and this runs once.  */
    function browse_title_formatter(cell)
    {
        let $cb = document.createElement("input");
        $cb.type = "checkbox";
        $cb.className = "CONNECTIONS_ALL_CHECK";
        $cb.setAttribute("aria-label", t("browse everything on screen"));
        $cb.title = t("browse everything on screen");
        paint_browse_box($cb, browse_header_state(gobj));
        return $cb;
    }

    /*  The click is an OS notification: its whole job is to make an event.
     *
     *  Do NOT preventDefault() here to stop the browser ticking the box on
     *  its own. Cancelling a checkbox click makes the browser REVERT the
     *  tick when the dispatch ends — and the repaint that the event
     *  triggers runs in a microtask BEFORE that, so the revert lands last
     *  and the header answers a click by doing nothing at all.  */
    function browse_header_click(e, column)
    {
        gobj_send_event(gobj, "EV_TOGGLE_ALL_BROWSE", {}, gobj);
    }

    /*  Name: the tree column. A connection is its label with the live dot in
     *  front; a service is its name and the class it is.  */
    function name_formatter(cell)
    {
        let d = cell.getData();
        if(d._type === "svc") {
            let tag = d.gclass
                ? ` <span class="tag is-light is-size-7 CONNECTIONS_SERVICE_GCLASS ` +
                  `${d.gclass === "C_TRANGER" ? "is-warning" : "is-info"}">${esc(d.gclass)}</span>`
                : "";
            return `<span class="CONNECTIONS_SERVICE">${esc(d.label)}</span>${tag}`;
        }
        return status_dot(d.connected) +
            `<span class="CONNECTIONS_CONN has-text-weight-semibold">${esc(d.label)}</span>`;
    }

    /*  Status: a dot and the word, in ONE cell — the picker's shape. The
     *  three icon columns it used to take are back to being what they are:
     *  actions, at the end of the row.  */
    function status_formatter(cell)
    {
        let d = cell.getData();
        if(d._type !== "conn") {
            return "";
        }
        let links = gobj_find_service("treedb_links", false);
        let config = gobj_find_service("treedb_config", false);
        let conn = config ? treedb_config_get_connection(config, d.conn_id) : null;
        let connected = links ? treedb_links_is_connected(links, d.conn_id) : false;
        let scanning = links ? treedb_links_is_scanning(links, d.conn_id) : false;
        let key = connected
            ? (scanning ? "refreshing services" : "connected")
            : ((conn && conn.enabled) ? "connecting" : "disconnected");
        let cls = connected ? "has-text-success" : "has-text-grey";
        return `<span class="CONNECTIONS_STATUS is-size-7 ${cls}">${esc(t(key))}</span>`;
    }

    function action_formatter(cell)
    {
        let d = cell.getData();
        if(d._type !== "conn") {
            return "";
        }
        let config = gobj_find_service("treedb_config", false);
        let links = gobj_find_service("treedb_links", false);
        let conn = config ? treedb_config_get_connection(config, d.conn_id) : null;
        let enabled = !!(conn && conn.enabled);
        let connected = links ? treedb_links_is_connected(links, d.conn_id) : false;
        let scanning = links ? treedb_links_is_scanning(links, d.conn_id) : false;

        let refresh_cls = (connected && !scanning) ? "" : " has-text-grey-light";
        let refresh_title = scanning ? t("refreshing services") : t("refresh services");
        let plug_icon = enabled ? "yi-plug-slash" : "yi-plug";
        let plug_cls = enabled ? " has-text-danger" : " has-text-success";
        let plug_title = enabled ? t("disconnect") : t("connect");

        return `<span class="icon CONNECTIONS_REFRESH${refresh_cls}" ` +
               `title="${esc(refresh_title)}" aria-label="${esc(refresh_title)}">` +
               `<i class="yi-arrows-rotate"></i></span>` +
               `<span class="icon CONNECTIONS_CONNECT${plug_cls}" ` +
               `title="${esc(plug_title)}" aria-label="${esc(plug_title)}">` +
               `<i class="${plug_icon}"></i></span>` +
               `<span class="icon CONNECTIONS_CLONE" title="${esc(t("clone this connection"))}" ` +
               `aria-label="${esc(t("clone"))}"><i class="yi-copy"></i></span>` +
               `<span class="icon CONNECTIONS_DELETE has-text-danger" ` +
               `title="${esc(t("remove"))}" aria-label="${esc(t("remove"))}">` +
               `<i class="yi-trash"></i></span>`;
    }

    /*  One cell, four actions: which one was pressed is asked of the DOM,
     *  not of four columns of 48px that a phone cannot afford.  */
    function action_click(e, cell)
    {
        let d = cell.getData();
        if(d._type !== "conn") {
            return;
        }
        let $hit = e.target && e.target.closest ? e.target.closest("span.icon") : null;
        if(!$hit) {
            return;
        }
        let event = null;
        if($hit.classList.contains("CONNECTIONS_REFRESH")) {
            event = "EV_REFRESH_SERVICES";
        } else if($hit.classList.contains("CONNECTIONS_CONNECT")) {
            event = "EV_TOGGLE_CONN_ENABLED";
        } else if($hit.classList.contains("CONNECTIONS_CLONE")) {
            event = "EV_CLONE_CONN";
        } else if($hit.classList.contains("CONNECTIONS_DELETE")) {
            event = "EV_REMOVE_CONN";
        }
        if(!event) {
            return;
        }
        gobj_send_event(gobj, event, {conn_id: d.conn_id}, gobj);
    }

    /*  A service row has nothing to edit: those fields belong to its
     *  connection, and an editor on an empty cell invites typing into
     *  nothing.  */
    function editable_conn(cell)
    {
        return cell.getData()._type === "conn";
    }

    /*
     *  minWidth per column so `fitColumns` never shrinks them below a
     *  legible size: on a narrow (mobile) viewport Tabulator then scrolls
     *  the table horizontally instead of squishing the columns unreadable;
     *  on desktop the widthGrow weights fill the extra width.
     */
    return [
        {title: "", field: "_browse", width: 44, minWidth: 44, headerSort: false,
            hozAlign: "center", headerHozAlign: "center", resizable: false,
            formatter: browse_formatter, cellClick: browse_click,
            titleFormatter: browse_title_formatter, headerClick: browse_header_click},
        {title: t("label"),   field: "label", minWidth: 220, widthGrow: 2,
            formatter: name_formatter, editor: "input", editable: editable_conn},
        {title: t("url"),     field: "url",                 editor: "input",
            editable: editable_conn, minWidth: 200, widthGrow: 2},
        {title: t("role"),    field: "remote_yuno_role",    editor: "input",
            editable: editable_conn, minWidth: 120, widthGrow: 1},
        {title: t("service"), field: "remote_yuno_service", editor: "input",
            editable: editable_conn, minWidth: 120, widthGrow: 1},
        {title: t("status"), field: "_status", minWidth: 110, widthGrow: 1,
            headerSort: false, formatter: status_formatter},
        {title: "", field: "_actions", width: 152, minWidth: 152, headerSort: false,
            hozAlign: "right", formatter: action_formatter, cellClick: action_click}
    ];
}

/***************************************************************
 *  Has this connection anything discovered to browse?
 ***************************************************************/
function has_services(gobj, conn_id)
{
    let config = gobj_find_service("treedb_config", false);
    let conn = config ? treedb_config_get_connection(config, conn_id) : null;
    return !!(conn && treedb_config_conn_services(conn).length);
}

/***************************************************************
 *  The connections the header box covers: the ones the search leaves
 *  ON SCREEN. Ticking what a filter hides is how one click takes a
 *  hundred backends you were not looking at — the same rule the
 *  library's selection column follows.
 *
 *  Read from the CONFIG and narrowed to what the table shows: a header
 *  drawn before the rows land covers nothing and paints itself dead,
 *  and reload_table repaints it the moment they do. Only a table that
 *  cannot be asked at all (not created, or asked mid-build) falls back
 *  to the whole set.
 ***************************************************************/
function visible_conns(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let all = config ? treedb_config_get_connections(config) : [];
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return all;
    }

    let shown = [];
    try {
        shown = table.getData("active") || [];
    } catch(e) {
        return all;     /*  asked before the table was built  */
    }
    let on_screen = new Set(shown
        .filter((d) => d && d._type === "conn")
        .map((d) => d.conn_id));
    return all.filter((c) => c && on_screen.has(c.id));
}

/***************************************************************
 *  What the header box has to say: the three states, and whether
 *  anything on screen has been discovered at all (nothing to browse
 *  is a dead box, not an empty one).
 ***************************************************************/
function browse_header_state(gobj)
{
    let conns = visible_conns(gobj);
    return {
        state: conns_browse_state(conns),
        any:   conns.some((c) => treedb_config_conn_services(c).length)
    };
}

function paint_browse_box($cb, info)
{
    $cb.disabled = !info.any;
    $cb.checked = (info.state === "all");
    $cb.indeterminate = (info.state === "some");
}

/***************************************************************
 *  Repaint the live header box (the element the formatter left in the
 *  header, found where it is and not kept in a field that a redraw
 *  would leave pointing at a checkbox nobody can see).
 ***************************************************************/
function paint_browse_header(gobj)
{
    let $c = gobj_read_attr(gobj, "$container");
    let $cb = $c ? $c.querySelector(".CONNECTIONS_ALL_CHECK") : null;
    if(!$cb) {
        return;
    }
    paint_browse_box($cb, browse_header_state(gobj));
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
        /*  The VIRTUAL renderer is back: a row used to be taller than its
         *  cells (it carried a whole sub-table), which made Tabulator scroll
         *  the cell being edited off the top. With the services as child rows
         *  there is nothing taller than a row, and virtual is what a deploy
         *  centre with hundreds of backends needs.  */
        placeholder:    t("no connections - click add connection"),
        columnDefaults: {headerHozAlign: "left", resizable: true},
        columns:        make_columns(gobj),
        /*  The services are CHILD ROWS now, not a table inside the row: the
         *  same tree the picker of gui_agent draws.  */
        dataTree:              true,
        dataTreeStartExpanded: false,
        dataTreeElementColumn: "label",
        dataTreeChildField:    "_children"
    };

    let table = new Tabulator($div, settings);
    table.on("tableBuilt", function() {
        /*  The header is drawn BEFORE this, with no rows to cover, so the
         *  box it carries is born dead. Repaint it once the rows are in, or
         *  a fresh load leaves a checkbox that cannot even be clicked.  */
        Promise.resolve(table.setData(rows_from_config(gobj))).then(function() {
            paint_browse_header(gobj);
        }).catch(function(err) {
            log_warning(`${GCLASS_NAME}: first load failed: ${err && err.message}`);
        });
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
    /*  `setData()` RESETS the tree, and this table reloads on every tick and
     *  every scan: remember what is open and put it back, or ticking a
     *  service would fold the connection you are ticking inside. Only the
     *  FIRST load with rows decides on its own.  */
    let priv = gobj.priv;
    let rows = rows_from_config(gobj);
    let first = !priv.loaded;
    let open = {};

    if(!first) {
        try {
            table.getRows().forEach(function(row) {
                let d = row.getData();
                if(d && d.id && row.isTreeExpanded && row.isTreeExpanded()) {
                    open[d.id] = true;
                }
            });
        } catch(e) {
            /*  mid-build: nothing was open yet  */
        }
    } else if(rows.length <= 5) {
        for(let r of rows) {
            open[r.id] = true;
        }
    }

    Promise.resolve(table.setData(rows)).then(function() {
        table.getRows().forEach(function(row) {
            let d = row.getData();
            if(d && open[d.id] && row.treeExpand) {
                row.treeExpand();
            }
        });
        if(rows.length) {
            priv.loaded = true;
        }
        render_fold(gobj);
        update_count(gobj, rows);
        paint_browse_header(gobj);
    }).catch(function(err) {
        log_warning(`${GCLASS_NAME}: table mid-rebuild: ${err && err.message}`);
    });
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
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    try {
        yui_tabulator_relocalize(table, t);
        table.options.placeholder = t("no connections - click add connection");

        /*  setColumns re-renders every row in the new language.  */
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

    reload_table(gobj);
    return 0;
}

/***************************************************************
 *  Take every service of every connection ON SCREEN, or drop them all.
 *
 *  The same rule the connection's own box follows: all-on drops the
 *  lot, anything else takes it — which is what "some are ticked and I
 *  pressed it" means.
 *
 *  ONE gesture, ONE write: a hundred connections written one at a time
 *  is a hundred trips to localStorage and a hundred rebuilt pickers.
 ***************************************************************/
function ac_toggle_all_browse(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, ` +
                  `cannot take the browse column`);
        return -1;
    }

    let conns = visible_conns(gobj);
    let ids = conns
        .filter((c) => treedb_config_conn_services(c).length)
        .map((c) => c.id);
    if(!ids.length) {
        return 0;       /*  nothing discovered on screen: nothing to take  */
    }

    let want = (conns_browse_state(conns) !== "all");
    gobj_send_event(config, "EV_SET_CONNS_BROWSE",
        {conn_ids: ids, selected: want}, gobj);

    reload_table(gobj);
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
    reload_table(gobj);
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
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return true;
    }
    try {
        return table.getRows().some(function(row) {
            let kids = row.getTreeChildren ? row.getTreeChildren() : [];
            return kids.length > 0 && row.isTreeExpanded && !row.isTreeExpanded();
        });
    } catch(e) {
        return true;
    }
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
 *  Fold or unfold the WHOLE tree.
 ***************************************************************/
function ac_toggle_fold(gobj, event, kw, src)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    let expand = some_folded(gobj);
    try {
        table.getRows().forEach(function(row) {
            let kids = row.getTreeChildren ? row.getTreeChildren() : [];
            if(!kids.length || !row.treeExpand) {
                return;
            }
            if(expand) {
                row.treeExpand();
            } else {
                row.treeCollapse();
            }
        });
    } catch(e) {
        log_warning(`${GCLASS_NAME}: cannot fold the tree: ${e}`);
        return -1;
    }
    render_fold(gobj);
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
 *  "N connections · M services · K to browse"
 ***************************************************************/
function update_count(gobj, rows)
{
    let priv = gobj.priv;
    if(!priv.$count) {
        return;
    }
    let services = 0;
    let browse = 0;
    for(let r of rows) {
        let kids = r._children || [];
        services += kids.length;
        browse += kids.filter((k) => k && k.selected).length;
    }
    priv.$count.textContent =
        `${rows.length} ${t("connections")} · ${services} ${t("services")} · ` +
        `${browse} ${t("to browse")}`;
}

/***************************************************************
 *  The search box typed into: it matches a connection or one of
 *  its services, and a connection that matches keeps them all.
 ***************************************************************/
function ac_search(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let table = gobj_read_attr(gobj, "tabulator");

    priv.search = (kw && kw.text) || "";
    if(!table) {
        return 0;
    }
    let term = priv.search.trim().toLowerCase();
    try {
        if(!term) {
            table.clearFilter();
        } else {
            table.setFilter(function(data) {
                let hay = `${data.label || ""} ${data.url || ""} ` +
                    `${(data._children || []).map((k) => k.label).join(" ")}`;
                return hay.toLowerCase().includes(term);
            });
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: cannot filter: ${e}`);
    }
    render_fold(gobj);
    /*  The header covers what is on screen, and that is what just changed. */
    paint_browse_header(gobj);
    return 0;
}

/***************************************************************
 *  The dialog that removes SEVERAL connections.
 *
 *  Its own list with its own checkboxes: the table's checkbox says
 *  which treedbs to browse, and one checkbox cannot mean two things.
 *  Everything starts unticked — this dialog opens with nothing
 *  selected to delete, and the operator says what goes.
 ***************************************************************/
function ac_delete_many(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let config = gobj_find_service("treedb_config", false);
    let shell = yui_shell_of(gobj);
    let conns = config ? treedb_config_get_connections(config) : [];

    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot open the removal box`);
        return -1;
    }
    if(!conns.length) {
        return 0;   /*  nothing to remove  */
    }
    if(priv.delete_modal) {
        return 0;   /*  already asking  */
    }

    let $rows = [];
    for(let conn of conns) {
        let $cb = createElement2(["input", {type: "checkbox",
            class: "CONNECTIONS_DELETE_PICK", "data-conn": conn.id}]);
        $rows.push(createElement2(
            ["label", {class: "CONNECTIONS_DELETE_ROW checkbox is-block mb-1"}, [
                $cb,
                ["span", {class: "ml-2 has-text-weight-semibold"},
                    String(conn.label || conn.url || conn.id)],
                ["span", {class: "ml-2 is-size-7 has-text-grey"}, String(conn.url || "")]
            ]]
        ));
    }

    let $all = createElement2(["input", {type: "checkbox", class: "CONNECTIONS_DELETE_ALL"}]);
    let $count_line = createElement2(
        ["p", {class: "CONNECTIONS_DELETE_COUNT is-size-7 has-text-grey mt-2"}, ""]);
    let $go = createElement2(
        ["button", {class: "button is-danger CONNECTIONS_DELETE_GO", type: "button",
                    disabled: "disabled", i18n: "remove"}, "Remove"]);

    let $box = createElement2(
        ["div", {class: "CONNECTIONS_DELETE_BOX"}, [
            ["label", {class: "checkbox is-block mb-2 has-text-weight-semibold"}, [
                $all,
                ["span", {class: "ml-2", i18n: "select all"}, t("select all")]
            ]],
            ["div", {class: "CONNECTIONS_DELETE_LIST", style: "max-height:50vh; overflow:auto;"},
                $rows],
            $count_line,
            ["p", {class: "is-size-7 has-text-grey mb-3", i18n: "removing drops its tabs"},
                t("removing drops its tabs")],
            ["div", {class: "is-flex", style: "gap:.5rem; justify-content:flex-end;"}, [
                ["button", {class: "button CONNECTIONS_DELETE_CANCEL", type: "button",
                            i18n: "cancel"}, "Cancel"],
                $go
            ]]
        ]]
    );

    let picks = () => Array.from(
        $box.querySelectorAll(".CONNECTIONS_DELETE_PICK")).filter(($x) => $x.checked);
    let refresh = () => {
        let n = picks().length;
        $go.disabled = (n === 0);
        $count_line.textContent = n ? `${n} ${t("selected to remove")}` : "";
        $all.checked = n > 0 && n === $rows.length;
        $all.indeterminate = n > 0 && n < $rows.length;
    };

    $box.addEventListener("change", (e) => {
        if(e.target === $all) {
            let on = $all.checked;
            $box.querySelectorAll(".CONNECTIONS_DELETE_PICK").forEach(($x) => {
                $x.checked = on;
            });
        }
        refresh();
    });
    $box.querySelector(".CONNECTIONS_DELETE_CANCEL").addEventListener("click", () => {
        if(priv.delete_modal) {
            priv.delete_modal.close();
        }
    });
    $go.addEventListener("click", () => {
        /*  The click is an OS notification: the removal happens in the
         *  action, with the ids it names.  */
        let ids = picks().map(($x) => $x.getAttribute("data-conn"));
        if(priv.delete_modal) {
            priv.delete_modal.close();
        }
        gobj_send_event(gobj, "EV_CONFIRM_DELETE_MANY", {conn_ids: ids}, gobj);
    });
    refresh();

    priv.delete_modal = yui_shell_show_modal(shell, $box, {
        dialog: true,
        logical_class: "CONNECTIONS_DELETE_DIALOG",
        title: "remove several connections",
        t: t,
        on_close: function() {
            priv.delete_modal = null;
        }
    });
    return 0;
}

/***************************************************************
 *  What that dialog decided.
 ***************************************************************/
function ac_confirm_delete_many(gobj, event, kw, src)
{
    let config = gobj_find_service("treedb_config", false);
    let ids = (kw && Array.isArray(kw.conn_ids)) ? kw.conn_ids : [];

    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service, cannot remove`);
        return -1;
    }
    if(!ids.length) {
        return 0;
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
            ["EV_TOGGLE_ALL_BROWSE",    ac_toggle_all_browse,    null],
            ["EV_REFRESH_SERVICES",     ac_refresh_services,     null],
            ["EV_TOGGLE_CONN_ENABLED",  ac_toggle_conn_enabled,  null],
            ["EV_TOGGLE_FOLD",          ac_toggle_fold,          null],
            ["EV_SEARCH",               ac_search,               null],
            ["EV_DELETE_MANY",          ac_delete_many,          null],
            ["EV_CONFIRM_DELETE_MANY",  ac_confirm_delete_many,  null],
            ["EV_REMOVE_CONN",          ac_remove_conn,          null],
            ["EV_CONFIRM_REMOVE_CONN",  ac_confirm_remove_conn,  null],
            ["EV_EXPORT_CONNS",         ac_export_conns,         null],
            ["EV_PICK_IMPORT_FILE",     ac_pick_import_file,     null],
            ["EV_IMPORT_CONNS",         ac_import_conns,         null],
            ["EV_PASTE_CONNS",          ac_paste_conns,          null],
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
        ["EV_TOGGLE_ALL_BROWSE",    0],
        ["EV_REFRESH_SERVICES",     0],
        ["EV_TOGGLE_CONN_ENABLED",  0],
        ["EV_TOGGLE_FOLD",          0],
        ["EV_SEARCH",               0],
        ["EV_DELETE_MANY",          0],
        ["EV_CONFIRM_DELETE_MANY",  0],
        ["EV_REMOVE_CONN",          0],
        ["EV_CONFIRM_REMOVE_CONN",  0],
        ["EV_EXPORT_CONNS",         0],
        ["EV_PICK_IMPORT_FILE",     0],
        ["EV_IMPORT_CONNS",         0],
        ["EV_PASTE_CONNS",          0],
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
