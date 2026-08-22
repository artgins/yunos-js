/***********************************************************************
 *          c_treedb_picker.js
 *
 *      C_TREEDB_PICKER — the fixed tab-0 of each workspace (Topics /
 *      Graphs). It SELECTS which treedbs to open in this workspace:
 *
 *        - lists the configured backend connections (read-only here —
 *          connections are added / edited / removed in Settings);
 *        - shows each connection's live status and the services SELECTED
 *          in Settings (discovered on connect, `selected` flag);
 *        - a checkbox per treedb opens/closes it as a tab in THIS
 *          workspace (per-workspace selection in C_TREEDB_CONFIG); the app
 *          root rebuilds the workspace tabs on the change.
 *
 *      It is a TABLE, not a list of cards: one deploy centre reaches
 *      hundreds of nodes, and a card per connection with a line per
 *      service is a page you scroll for ever and cannot search. A
 *      Tabulator tree — connection on top, its treedbs underneath —
 *      sorts, filters and virtualizes, and it is the same object the rest
 *      of this app is made of.
 *
 *      The checkbox does NOT wait for the transport. A selection is a
 *      PREFERENCE ("open this treedb here"), not an action on a live
 *      socket: the tab it opens knows how to say "backend not connected"
 *      and fills in when the session comes up. Disabling it left the
 *      operator looking at the treedb they wanted, unable to say so, with
 *      the reason written nowhere.
 *
 *      A view: it builds its own `$container` for the shell to mount.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning, gobj_short_name, gobj_name,
    gobj_read_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_find_service,
    gobj_send_event,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {
    treedb_config_get_connections,
    treedb_config_conn_services,
    treedb_config_is_selected,
    sel_id,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_get_open_error,
} from "./c_treedb_links.js";

import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";

import {TabulatorFull as Tabulator} from "tabulator-tables";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_PICKER";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "",    "Owning workspace: topics | graphs"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Tab title"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTML element (mounted by the shell)"),
SDATA_END()
];

let PRIVATE_DATA = {
    $body:      null,   /*  the div Tabulator is attached to  */
    $count:     null,   /*  "N connections · M treedbs · K open"  */
    $fold:      null,   /*  expand / collapse the whole tree  */
    $search:    null,
    table:      null,
    table_id:   "",
    search:     "",     /*  survives a re-render (a connection opening)  */
    loaded:     false,  /*  past the first load: what is open is the operator's  */
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
    build_ui(gobj);
}

/***************************************************************
 *          Framework Method: Start
 *
 *  The subscriptions live HERE, not in mt_create, so they are symmetric
 *  with the unsubscribes in mt_stop (the same rule C_TREEDB_VIEW states).
 *  This view is destroyed and re-created by the shell — and on logout it
 *  dies while its publishers (services under the app root) live on: taken
 *  in mt_create and never undone, every visit left a subscription set
 *  behind, delivering into a destroyed gobj.
 ***************************************************************/
function mt_start(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    if(config) {
        gobj_subscribe_event(config, "EV_CONNECTIONS_CHANGED", {}, gobj);
        gobj_subscribe_event(config, "EV_SELECTED_TREEDBS_CHANGED", {}, gobj);
    } else {
        log_error(`${gobj_short_name(gobj)}: no treedb_config service: ` +
                  `the picker will not see a connection change`);
    }
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_subscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(links, "EV_ON_OPEN_ERROR", {}, gobj);
    } else {
        log_error(`${gobj_short_name(gobj)}: no treedb_links service: ` +
                  `the picker will not see a connection open or fail`);
    }

    /*  This whole view is BUILT with t() (the status lines, the hints, the
     *  service labels), so a language switch is a re-render — nothing here
     *  carries an i18n key that refresh_language could reach on its own. The
     *  shell publishes it.  */
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    render(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    if(config) {
        gobj_unsubscribe_event(config, "EV_CONNECTIONS_CHANGED", {}, gobj);
        gobj_unsubscribe_event(config, "EV_SELECTED_TREEDBS_CHANGED", {}, gobj);
    }
    let links = gobj_find_service("treedb_links", false);
    if(links) {
        gobj_unsubscribe_event(links, "EV_ON_OPEN", {}, gobj);
        gobj_unsubscribe_event(links, "EV_ON_CLOSE", {}, gobj);
        gobj_unsubscribe_event(links, "EV_ON_OPEN_ERROR", {}, gobj);
    }
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;
    if(priv.table) {
        try {
            priv.table.destroy();
        } catch(e) {
            /*  already gone  */
        }
        priv.table = null;
    }
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Build the root container (the shell mounts it): a toolbar with
 *  the search box and the count, and the table under it.
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    priv.table_id = `picker-${gobj_name(gobj)}`.replace(/[^A-Za-z0-9_-]/g, "_");

    let $search = createElement2(["input", {
        class:        "PICKER_SEARCH input",
        type:         "text",
        placeholder:  t("search a node or a treedb"),
        "data-i18n-placeholder": "search a node or a treedb"
    }]);
    $search.addEventListener("input", () => {
        gobj_send_event(gobj, "EV_SEARCH", {text: $search.value || ""}, gobj);
    });
    priv.$search = $search;

    let $search_control = createElement2(
        ["div", {class: "PICKER_SEARCH_CONTROL control has-icons-left",
                 style: "flex:1 1 12rem; max-width:22rem; min-width:0;"}, [
            $search,
            ["span", {class: "icon is-left"}, [["span", {class: "yi-magnifying-glass"}, ""]]]
        ]]
    );
    attach_clear($search_control, $search);

    /*  One control for the whole tree: with a screen of connections, opening
     *  or closing them one expander at a time is the work this saves. The
     *  icon says what the CLICK will do.  */
    let $fold = createElement2(
        ["button", {class: "PICKER_FOLD button", type: "button",
                    title: t("expand all"), "aria-label": t("expand all"),
                    "data-i18n-title": "expand all", "data-i18n-aria-label": "expand all"},
            [["span", {class: "icon"}, [["span", {class: "yi-chevron-down"}, ""]]]],
            {click: () => gobj_send_event(gobj, "EV_TOGGLE_FOLD", {}, gobj)}
        ]);
    priv.$fold = $fold;

    priv.$count = createElement2(
        ["span", {class: "PICKER_COUNT is-size-7 has-text-grey ml-2"}, ""]);

    let $manage = createElement2(
        ["button", {class: "button PICKER_MANAGE",
                    i18n: "manage connections"}, "Manage connections"]);
    $manage.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_MANAGE_CONNECTIONS", {}, gobj);
    });

    let $body = createElement2(
        ["div", {class: "PICKER_TABLE ytreedb-picker-body", id: priv.table_id}, []]);
    priv.$body = $body;

    let $container = createElement2(
        ["div", {class: "ytreedb-picker p-4 C_TREEDB_PICKER",
                 style: "display:flex; flex-direction:column; height:100%;"},
            [
                ["div", {class: "PICKER_HEADER is-flex is-align-items-center mb-3",
                         style: "gap:.5rem; flex-wrap:wrap;"}, [
                    /*  The fold belongs with what you are LOOKING at, not
                     *  with what you do to it — and it hugs the LEFT EDGE, so
                     *  a phone that wraps this row keeps it where the eye
                     *  starts instead of leaving it floating at the end of a
                     *  line. Same place in the three tables of these apps.  */
                    ["h2", {class: "title is-5 mb-0", i18n: "treedbs"}, "TreeDBs"],
                    /*  The fold and the search are ONE wrapping unit (see
                     *  C_TREEDB_CONNECTIONS): they never end up on different
                     *  lines.  */
                    ["div", {class: "PICKER_FINDER is-flex is-align-items-center",
                             style: "gap:.5rem; flex:1 1 14rem; max-width:24rem; min-width:0;"},
                        [$fold, $search_control]],
                    priv.$count,
                    ["div", {class: "PICKER_ACTIONS is-flex is-align-items-center",
                             style: "gap:.5rem; margin-left:auto;"},
                        [$manage]]
                ]],
                ["div", {class: "PICKER_TABLEWRAP", style: "flex:1; min-height:0;"},
                    [$body]]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  A formatter returns HTML, so whatever comes from the data is
 *  escaped: a connection label is typed by the operator.
 ***************************************************************/
function esc(s)
{
    return String(s === undefined || s === null ? "" : s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/***************************************************************
 *  A small connection-status dot.
 ***************************************************************/
function status_dot(connected)
{
    return `<span class="PICKER_STATUS_DOT" style="display:inline-block; ` +
        `width:0.7em; height:0.7em; border-radius:50%; margin-right:0.5em; ` +
        `vertical-align:middle; background:${connected ? "#48c78e" : "#b5b5b5"};"></span>`;
}

/***************************************************************
 *  The services to browse for a connection: the ones SELECTED in
 *  Settings among the discovered list (treedb_config_conn_services).
 *
 *  This is the contract — like wattyzer's static route table. We do NOT
 *  fall back to enumerating every `services_roles` key: that offered
 *  NON-treedb services, and sending a treedb `descs` to a ranger fails
 *  with "command not available". When none are selected, the connection
 *  row says so.
 *
 *  C_TRANGER services (raw record stores) only make sense in the Topics
 *  workspace; Graphs keeps to C_NODE (a raw tranger has no hooks/fkeys
 *  to draw).
 ***************************************************************/
function connection_services(conn, workspace)
{
    let list = treedb_config_conn_services(conn).filter((s) => s.selected);
    if(workspace !== "topics") {
        list = list.filter((s) => s.gclass !== "C_TRANGER");
    }
    return list.sort((a, b) => a.key.localeCompare(b.key));
}

/***************************************************************
 *  Why a connection is not usable right now, in one line. Empty
 *  when it is connected and has treedbs to offer.
 ***************************************************************/
function connection_note(gobj, conn, connected, services)
{
    let links = gobj_find_service("treedb_links", false);
    let open_error = (links && !connected) ? treedb_links_get_open_error(links, conn.id) : null;

    if(open_error) {
        /*  Two very different failures:
         *
         *  - a connect failure (bad URL / cert / port / backend down): the
         *    transport keeps retrying and recovers on its own;
         *  - a REJECTED identity (the backend NAK'd a freshly refreshed token):
         *    nobody is retrying — the transport was closed and the connection
         *    disabled, because looping would only NAK again. It takes fixing
         *    the user's roles on that backend and reconnecting in Settings.  */
        let detail = (open_error.reason ||
            (open_error.code ? "code " + open_error.code : "")).toString().trim();
        let msg = open_error.rejected
            ? t("access rejected by the backend - fix the roles and reconnect")
            : t("cannot connect - retrying");
        return {text: msg + (detail ? ` (${detail})` : ""), danger: true};
    }
    if(!services.length) {
        return {text: t("no services selected"), danger: false};
    }
    if(!connected) {
        return {
            text: conn.enabled ? t("connecting") : t("disconnected - open connections"),
            danger: false
        };
    }
    return {text: "", danger: false};
}

/***************************************************************
 *  The rows: a connection on top, its treedbs underneath.
 ***************************************************************/
function build_rows(gobj)
{
    let workspace = gobj_read_attr(gobj, "workspace");
    let config = gobj_find_service("treedb_config", false);
    let links = gobj_find_service("treedb_links", false);
    let conns = config ? treedb_config_get_connections(config) : [];
    let rows = [];

    for(let conn of conns) {
        let connected = links ? treedb_links_is_connected(links, conn.id) : false;
        let services = connection_services(conn, workspace);
        let note = connection_note(gobj, conn, connected, services);
        let children = [];
        let open = 0;

        for(let svc of services) {
            let id = sel_id(conn.id, svc.key);
            let selected = !!treedb_config_is_selected(config, workspace, id);
            if(selected) {
                open++;
            }
            children.push({
                _key:      id,
                _type:     "svc",
                conn_id:   conn.id,
                svc_key:   svc.key,
                name:      svc.service,
                gclass:    svc.gclass,
                selected:  selected,
                connected: connected,
                note:      "",
                danger:    false,
                /*  the search matches both levels on one string  */
                _search:   `${conn.label || ""} ${conn.url || ""} ${svc.service}`.toLowerCase()
            });
        }

        rows.push({
            _key:      conn.id,
            _type:     "conn",
            conn_id:   conn.id,
            name:      conn.label || conn.url,
            gclass:    "",
            selected:  false,
            connected: connected,
            url:       conn.url,
            role:      `${conn.remote_yuno_role || "?"}/${conn.remote_yuno_service || "?"}`,
            open:      open,
            total:     services.length,
            note:      note.text,
            danger:    note.danger,
            _search:   `${conn.label || ""} ${conn.url || ""}`.toLowerCase(),
            _children: children
        });
    }
    return rows;
}

/***************************************************************
 *  Columns. The checkbox is a SERVICE thing: on a connection row the
 *  cell is empty, and the row is there to group and to say how it is.
 ***************************************************************/
function make_columns(gobj)
{
    /*  A DOM node and not an HTML string: the connection's box has THREE
     *  states and `indeterminate` is a property, not an attribute — it
     *  cannot be written in markup.  */
    function check_formatter(cell)
    {
        let r = cell.getData();
        let $cb = document.createElement("input");
        $cb.type = "checkbox";

        if(r._type === "svc") {
            $cb.className = "PICKER_SERVICE_CHECK";
            $cb.checked = !!r.selected;
            $cb.setAttribute("aria-label", t("open in this workspace"));
            return $cb;
        }

        /*  The connection's own box opens or closes ALL its treedbs at
         *  once, and says which of the three it is in: none, some, all.  */
        $cb.className = "PICKER_CONN_CHECK";
        $cb.disabled = !r.total;
        $cb.checked = r.total > 0 && r.open === r.total;
        $cb.indeterminate = r.open > 0 && r.open < r.total;
        $cb.setAttribute("aria-label", t("open all of this connection"));
        $cb.title = t("open all of this connection");
        return $cb;
    }

    function check_click(e, cell)
    {
        let r = cell.getData();
        if(r._type === "svc") {
            gobj_send_event(gobj, "EV_TOGGLE_SERVICE",
                {conn_id: r.conn_id, svc_key: r.svc_key}, gobj);
            return;
        }
        if(!r.total) {
            return;     /*  nothing to open: the box is disabled  */
        }
        gobj_send_event(gobj, "EV_TOGGLE_CONNECTION", {conn_id: r.conn_id}, gobj);
    }

    function name_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "svc") {
            return `<span class="PICKER_SERVICE">${esc(r.name)}</span>`;
        }
        return status_dot(r.connected) +
            `<span class="PICKER_CONN has-text-weight-semibold">${esc(r.name)}</span>`;
    }

    function info_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "svc") {
            return r.gclass
                ? `<span class="tag is-light is-size-7 PICKER_SERVICE_GCLASS ` +
                  `${r.gclass === "C_TRANGER" ? "is-warning" : "is-info"}">${esc(r.gclass)}</span>`
                : "";
        }
        let bits = [`<span class="PICKER_CONN_URL is-size-7 has-text-grey">` +
            `${esc(r.url)} · ${esc(r.role)}</span>`];
        if(r.note) {
            bits.push(`<span class="PICKER_CONN_NOTE is-size-7 ` +
                `${r.danger ? "has-text-danger" : "has-text-grey"}"> · ${esc(r.note)}</span>`);
        }
        if(r.open > 0) {
            bits.push(`<span class="PICKER_CONN_OPEN is-size-7 has-text-link"> · ` +
                `${r.open}/${r.total} ${esc(t("open"))}</span>`);
        }
        return bits.join("");
    }

    return [
        {title: "", field: "_check", width: 44, minWidth: 44, hozAlign: "center",
            headerSort: false, resizable: false,
            formatter: check_formatter, cellClick: check_click},
        {title: t("treedb"), field: "name", minWidth: 220, widthGrow: 2,
            formatter: name_formatter},
        {title: "", field: "_info", minWidth: 260, widthGrow: 3,
            headerSort: false, formatter: info_formatter}
    ];
}

/***************************************************************
 *  Create the table. Virtual rendering on purpose: this is the view
 *  that has to survive a deploy centre with hundreds of nodes.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;
    if(!priv.$body) {
        return;
    }

    let table = new Tabulator(priv.$body, {
        ...yui_tabulator_lang(t),
        index:                 "_key",
        layout:                "fitColumns",
        maxHeight:             "100%",
        placeholder:           t("no connections yet"),
        columnDefaults:        {headerHozAlign: "left", resizable: false},
        columns:               make_columns(gobj),
        dataTree:              true,
        dataTreeStartExpanded: false,
        dataTreeElementColumn: "name",
        dataTreeChildField:    "_children"
    });
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        reload_table(gobj);
    });
    /*  Folded by hand: the button has to say what it would do now.  */
    table.on("dataTreeRowExpanded", function() {
        render_fold(gobj);
    });
    table.on("dataTreeRowCollapsed", function() {
        render_fold(gobj);
    });
    priv.table = table;
}

/***************************************************************
 *  Push the rows in, apply the search, say the count.
 *
 *  A handful of connections opens expanded — that is the whole screen
 *  and hiding it would be ceremony. Past that it starts collapsed:
 *  the search box is how you get to a treedb among hundreds.
 ***************************************************************/
function reload_table(gobj)
{
    let priv = gobj.priv;
    let table = priv.table;
    if(!table || !table._ready) {
        return;
    }

    let rows = build_rows(gobj);

    /*  `setData()` RESETS the tree, and this table reloads on every tick:
     *  ticking a treedb would fold the connection you are ticking inside,
     *  which is the one place the answer has to stay on screen. Remember
     *  what is open and put it back.
     *
     *  Only the FIRST load decides on its own — a handful of connections
     *  opens expanded because that is the whole screen; past that it starts
     *  folded and the search box is how you get to a treedb among hundreds.  */
    let first = !priv.loaded;
    let open = {};
    if(!first) {
        table.getRows().forEach(function(row) {
            let d = row.getData();
            if(d && d._key && row.isTreeExpanded && row.isTreeExpanded()) {
                open[d._key] = true;
            }
        });
    } else if(rows.length <= 5) {
        for(let r of rows) {
            open[r._key] = true;
        }
    }

    Promise.resolve(table.setData(rows)).then(function() {
        apply_search(gobj);
        table.getRows().forEach(function(row) {
            let d = row.getData();
            if(!row.treeExpand || !d) {
                return;
            }
            /*  With a search on, what matches is worth seeing without a
             *  second click.  */
            if(open[d._key] || priv.search) {
                row.treeExpand();
            }
        });
        /*  "Loaded" means loaded WITH something: this view is mounted before
         *  the connections arrive, and a first reload of an empty table would
         *  otherwise count as the first load and leave the real one folded.  */
        if(rows.length) {
            priv.loaded = true;
        }
        render_fold(gobj);
        update_count(gobj, rows);
    }).catch(function(err) {
        log_warning(`${gobj_short_name(gobj)}: table mid-rebuild: ${err && err.message}`);
    });
}

/***************************************************************
 *  The search matches a node or a treedb; a connection whose name
 *  matches keeps all of its treedbs.
 ***************************************************************/
function apply_search(gobj)
{
    let priv = gobj.priv;
    let term = (priv.search || "").trim().toLowerCase();

    if(!priv.table || !priv.table._ready) {
        return;
    }
    try {
        if(!term) {
            priv.table.clearFilter();
            return;
        }
        priv.table.setFilter((data) => (data._search || "").includes(term));
    } catch(e) {
        log_warning(`${gobj_short_name(gobj)}: cannot filter: ${e}`);
    }
}

/***************************************************************
 *  "N connections · M treedbs · K open"
 ***************************************************************/
function update_count(gobj, rows)
{
    let priv = gobj.priv;
    if(!priv.$count) {
        return;
    }
    let treedbs = 0;
    let open = 0;
    for(let r of rows) {
        treedbs += (r._children || []).length;
        open += r.open || 0;
    }
    priv.$count.textContent =
        `${rows.length} ${t("connections")} · ${treedbs} ${t("treedbs")} · ${open} ${t("open")}`;
}

/***************************************************************
 *  (Re)render: the table is built once and reloaded from here.
 ***************************************************************/
function render(gobj)
{
    let priv = gobj.priv;
    if(!priv.table) {
        create_table(gobj);
        return;     /*  tableBuilt reloads it  */
    }
    reload_table(gobj);
}


                    /***************************
                     *      Actions
                     ***************************/




function ac_refresh(gobj, event, kw, src)
{
    render(gobj);
    return 0;
}

/***************************************************************
 *  A tick is an OS notification: its only job is to make an event,
 *  and the toggle happens HERE.
 ***************************************************************/
function ac_toggle_service(gobj, event, kw, src)
{
    let workspace = gobj_read_attr(gobj, "workspace");
    let config = gobj_find_service("treedb_config", false);
    let conn = config
        ? treedb_config_get_connections(config).find((c) => c && c.id === kw.conn_id)
        : null;

    if(!config || !conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${kw && kw.conn_id}' to open`);
        return -1;
    }
    let svc = treedb_config_conn_services(conn).find((x) => x && x.key === kw.svc_key);
    if(!svc) {
        log_error(`${gobj_short_name(gobj)}: connection '${conn.id}' has no service ` +
                  `'${kw.svc_key}'`);
        return -1;
    }

    gobj_send_event(config, "EV_TOGGLE_SELECTED",
        {
            workspace: workspace,
            sel: {
                conn_id: conn.id,
                svc:     svc,
                label:   `${svc.service} · ${conn.label}`
            }
        }, gobj);
    return 0;
}

/***************************************************************
 *  Is anything still folded? That is what the button offers to do,
 *  and what its icon has to say.
 ***************************************************************/
function some_folded(gobj)
{
    let table = gobj.priv.table;
    if(!table || !table._ready) {
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
    let $icon = $fold.querySelector("span.icon > span");
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
    let table = gobj.priv.table;
    if(!table || !table._ready) {
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
        log_warning(`${gobj_short_name(gobj)}: cannot fold the tree: ${e}`);
        return -1;
    }
    render_fold(gobj);
    return 0;
}

/***************************************************************
 *  The connection's own box: open ALL its treedbs, or close them all.
 *
 *  "All" when some are open too — the half-ticked box reads as "not
 *  everything yet", and one click finishing the job is what it invites.
 *  Only when every one is already open does it close them.
 *
 *  One event carries the lot: a dozen EV_TOGGLE_SELECTED would persist
 *  the config a dozen times and rebuild the tabs a dozen times.
 ***************************************************************/
function ac_toggle_connection(gobj, event, kw, src)
{
    let workspace = gobj_read_attr(gobj, "workspace");
    let config = gobj_find_service("treedb_config", false);
    let conn = config
        ? treedb_config_get_connections(config).find((c) => c && c.id === kw.conn_id)
        : null;

    if(!config || !conn) {
        log_error(`${gobj_short_name(gobj)}: no connection '${kw && kw.conn_id}' to open`);
        return -1;
    }

    let services = connection_services(conn, workspace);
    if(!services.length) {
        log_warning(`${gobj_short_name(gobj)}: connection '${conn.id}' offers no treedb`);
        return 0;
    }
    let open = services.filter(
        (svc) => treedb_config_is_selected(config, workspace, sel_id(conn.id, svc.key))
    ).length;

    gobj_send_event(config, "EV_SET_SERVICES_SELECTED",
        {
            workspace: workspace,
            on:        open < services.length,
            sels:      services.map((svc) => ({
                conn_id: conn.id,
                svc:     svc,
                label:   `${svc.service} · ${conn.label}`
            }))
        }, gobj);
    return 0;
}

/***************************************************************
 *  The search box typed into.
 ***************************************************************/
function ac_search(gobj, event, kw, src)
{
    gobj.priv.search = (kw && kw.text) || "";
    apply_search(gobj);
    return 0;
}

/***************************************************************
 *  "Manage connections" → the Settings page.
 *
 *  Through the shell's navigate, not by assigning window.location.hash in
 *  the click handler: that wrote the route from OUTSIDE the shell (which
 *  owns it) and left no trace in the machine — the one place a route change
 *  should be visible.
 ***************************************************************/
function ac_manage_connections(gobj, event, kw, src)
{
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell, cannot open Connections`);
        return -1;
    }
    yui_shell_navigate(shell, "/connections", {push: true});   /*  user move  */
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
            ["EV_CONNECTIONS_CHANGED",      ac_refresh, null],
            ["EV_SELECTED_TREEDBS_CHANGED", ac_refresh, null],
            ["EV_ON_OPEN",                  ac_refresh, null],
            ["EV_ON_CLOSE",                 ac_refresh, null],
            ["EV_ON_OPEN_ERROR",            ac_refresh, null],
            /*  a language switch is a re-render: this view is built with t()  */
            ["EV_LANGUAGE_CHANGED",         ac_refresh, null],
            ["EV_MANAGE_CONNECTIONS",       ac_manage_connections, null],
            ["EV_TOGGLE_SERVICE",           ac_toggle_service, null],
            ["EV_TOGGLE_CONNECTION",        ac_toggle_connection, null],
            ["EV_TOGGLE_FOLD",              ac_toggle_fold,    null],
            ["EV_SEARCH",                   ac_search,         null]
        ]]
    ];

    const event_types = [
        ["EV_CONNECTIONS_CHANGED",      0],
        ["EV_SELECTED_TREEDBS_CHANGED", 0],
        ["EV_ON_OPEN",                  0],
        ["EV_ON_CLOSE",                 0],
        ["EV_ON_OPEN_ERROR",            0],
        ["EV_LANGUAGE_CHANGED",         0],
        ["EV_MANAGE_CONNECTIONS",       0],
        ["EV_TOGGLE_SERVICE",           0],
        ["EV_TOGGLE_CONNECTION",        0],
        ["EV_TOGGLE_FOLD",              0],
        ["EV_SEARCH",                   0]
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

function register_c_treedb_picker()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_picker};
