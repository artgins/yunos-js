/***********************************************************************
 *          c_nodes.js
 *
 *      C_NODES — node picker. Lists the nodes connected to the control
 *      center (`list-agents`) and lets the operator choose the ACTIVE
 *      node; the Console then routes commands to it via command-agent.
 *
 *      The list is a Tabulator table (the repo's official table
 *      manager): header-click sorting, a live search box, and a
 *      strongly highlighted active row. Tabulator's dark palette is
 *      supplied by src/app.css (the v2 shell does not ship gobj-ui v1's
 *      c_yui_main.css override).
 *
 *      WHICH KEY ADDRESSES A NODE IS THE OPERATOR'S CHOICE, and it has
 *      to be: on a control center with old nodes on it neither key is
 *      unique.  A fleet cloned from one image shares a single uuid
 *      across every machine, and four raspberries all answer to the
 *      hostname `raspz-slave`.  So clicking the HOST cell opens the node
 *      as `agent_id=<hostname>` and clicking the UUID cell opens it as
 *      `agent_id=<uuid>` -- whichever of the two tells this node from
 *      its twins.  The checkbox keeps the default (hostname, else uuid).
 *      The ROW's own identity is a third thing (`node_row_key`): the
 *      three fields together, so a table indexed by one of the repeated
 *      keys stops merging rows that are different nodes.
 *
 *      The control-center link re-publishes EV_MT_COMMAND_ANSWER to all
 *      panels, so this view filters by the command in the command_stack
 *      and only handles `list-agents` answers (the Console handles
 *      `command-agent`).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    escapeHtml,
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent, gobj_name,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_send_event,
    gobj_create_pure_child,
    set_timeout,
    clear_timeout,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_short_name,
    gobj_find_service,
    createElement2,
    refresh_language,
    msg_iev_get_stack,
    kw_get_str,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    version_cmp,
    version_gte,
    node_id,
    node_row_key,
    parse_agent_line,
    esc,
} from "./agent_helpers.js";
import {
    agent_config_get_selected_nodes,
    agent_config_set_selected_nodes,
    agent_config_is_node_selected,
    agent_config_toggle_selected_node,
} from "./c_agent_config.js";
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";
import {
    yui_copy_table_json,
    yui_button_mark_done,
    yui_button_unmark,
} from "@yuneta/gobj-ui/src/yui_clipboard.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_NODES";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,     "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "nodes",  "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "commands", "Owning workspace: selection bucket + tab routing"),
SDATA(data_type_t.DTP_STRING,   "min_version", 0,  "",       "Only list nodes with version >= this (empty = all)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,     "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,     "Tabulator instance"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,     "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,     "C_AGENT_CONFIG service"),
SDATA(data_type_t.DTP_JSON,     "nodes",       0,  "[]",     "Parsed list-agents result"),
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
    let priv = gobj.priv;
    priv.table_id = `nodes_table_${gobj_name(gobj)}`;

    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);

    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    let link = gobj_find_service("agent_link", true);
    gobj_write_attr(gobj, "link_svc", link);
    if(link) {
        gobj_subscribe_event(link, "EV_ON_OPEN", {}, gobj);
        gobj_subscribe_event(link, "EV_ON_CLOSE", {}, gobj);
        gobj_subscribe_event(link, "EV_MT_COMMAND_ANSWER", {}, gobj);
    }
    let config = gobj_find_service("agent_config", true);
    gobj_write_attr(gobj, "config_svc", config);
    if(config) {
        gobj_subscribe_event(config, "EV_SELECTED_NODES_CHANGED", {}, gobj);
    }

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} NODES_CARD view-card`,
                 style: "display:flex; flex-direction:column; height:100%;"}, []]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;


    build_dom(gobj);
    create_table(gobj);
    update_table(gobj);
    request_agents(gobj);

    /*  Tabulator headers + cell text are rendered by formatters, not
     *  data-i18n DOM, so refresh_language() can't touch them. Rebuild
     *  the columns on a language switch so titles + the Select button
     *  re-translate live (no browser refresh).  */
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    clear_timeout(gobj.priv.gobj_timer);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        table.destroy();
        gobj_write_attr(gobj, "tabulator", null);
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




function clear_node($n)
{
    while($n && $n.firstChild) {
        $n.removeChild($n.firstChild);
    }
}

/***************************************************************
 *  Ask the control center for the connected nodes.
 ***************************************************************/
function request_agents(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        /*  src defaults to the link service; the answer routes back
         *  there and is re-published to this panel (a routed view is
         *  not a service and cannot receive the inter-yuno reply).  */
        agent_link_command(link, "list-agents", {});
    }
}

/***************************************************************
 *  Does this node meet the workspace's minimum version? Commands
 *  and Statistics need agent >= 7.7.0 (the capability marker that
 *  gates controlcenter command/stats forwarding); Terminal (PTY
 *  backdoor) accepts every version (empty min_version).
 ***************************************************************/
function node_meets_min_version(gobj, n)
{
    let min = gobj_read_attr(gobj, "min_version") || "";
    return version_gte(n && n.version, min);
}

/***************************************************************
 *  By WHICH key is this node open in this workspace, "" when it is
 *  not open at all.
 *
 *  Two answers and not one, because there are two ways in: the row was
 *  opened by its hostname or by its uuid, and the checkbox has to show
 *  the tab that exists rather than the tab the default would have made.
 ***************************************************************/
function selected_key(gobj, n)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    if(!config || !n) {
        return "";
    }
    for(let key of [n.host, n.uuid]) {
        if(key && agent_config_is_node_selected(config, ws, key)) {
            return key;
        }
    }
    return "";
}

/***************************************************************
 *  Is this node currently selected in THIS workspace (has an open
 *  tab here)?
 ***************************************************************/
function is_selected_node(gobj, n)
{
    return !!selected_key(gobj, n);
}

/***************************************************************
 *  Open (or close) a node ADDRESSED BY `key` -- its hostname or its
 *  uuid, whichever cell was clicked.  The label is the key itself:
 *  the whole point of choosing is that the other one does not tell
 *  this node from its twins, so a tab labelled with it would not
 *  either.
 ***************************************************************/
function toggle_node_by(gobj, n, key)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    if(!config || !key) {
        return;
    }
    agent_config_toggle_selected_node(config, ws, {id: key, host: key});
}

/***************************************************************
 *  Build the static shell once: header, search toolbar, the
 *  Tabulator host div, and the not-connected notice slot.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    /*  Single-line toolbar: search (grows) · copy · refresh.  The count
     *  is not here any more — it is the status line under the table.
     *  No title/subtitle block — the nav already labels the view, and
     *  on mobile every extra header line steals the table's space.  */
    let $input = createElement2(["input", {
        class:        "NODES_SEARCH input",
        type:         "text",
        placeholder:  t("search nodes"),
        "data-i18n-placeholder": "search nodes",
        "aria-label": t("search nodes"),
        "data-i18n-aria-label": "search nodes"
    }, null, {
        input: () => apply_filter(gobj)
    }]);
    priv.$input = $input;

    let $search_control = createElement2(
        ["div", {class: "NODES_SEARCH_CONTROL control has-icons-left",
                 style: "flex:0 1 22rem; min-width:0;"}, [
            $input,
            ["span", {class: "icon is-left"}, [
                ["span", {class: "yi-magnifying-glass"}, ""]
            ]]
        ]]
    );
    attach_clear($search_control, $input);

    /*  Copy is icon + label, but the label hides on a phone: the row
     *  already carries a search box and Refresh, and "Copiar JSON" +
     *  "Actualizar" do not both fit at 360px in Spanish.  */
    let $copy = createElement2(
        ["button", {
            class:        "NODES_COPY button",
            type:         "button",
            style:        "margin-left:auto;",
            title:        t("copy the rows shown as json"),
            "aria-label": t("copy the rows shown as json"),
            "data-i18n-title": "copy the rows shown as json",
            "data-i18n-aria-label": "copy the rows shown as json"
        }, [
            ["span", {class: "icon"}, [["span", {class: "yi-copy"}, ""]]],
            ["span", {class: "is-hidden-mobile", i18n: "copy json"}, "Copy JSON"]
        ], {
            click: () => gobj_send_event(gobj, "EV_COPY_JSON", {}, gobj)
        }]
    );

    priv.$copy = $copy;

    priv.$toolbar = createElement2(
        ["div", {class: "NODES_TOOLBAR is-flex is-align-items-center mb-2", style: "gap:0.5rem;"}, [
            $search_control,
            $copy,
            ["button", {class: "NODES_REFRESH button", type: "button", i18n: "refresh"},
                "Refresh", {click: () => gobj_send_event(gobj, "EV_REFRESH", {}, gobj)}]
        ]]
    );
    $c.appendChild(priv.$toolbar);

    /*  Tabulator host  */
    priv.$tablewrap = createElement2(
        ["div", {class: "NODES_TABLEWRAP", style: "flex:1; min-height:0;"}, [
            ["div", {class: "NODES_TABLE", id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    /*
     *  La linea de estado: cuantos registros hay.
     *
     *  Va DEBAJO de la tabla y no como un numero suelto en la toolbar,
     *  que es donde estaba: un `31` junto a un buscador no dice de que
     *  habla, y con el filtro puesto la pregunta es justo cual de los dos
     *  numeros se esta mirando.  La cifra y la palabra van en nodos
     *  distintos porque solo la palabra se traduce -- `refresh_language()`
     *  alcanza al que LLEVA su clave.
     */
    priv.$count = createElement2(
        ["span", {class: "NODES_STATUS_COUNT has-text-weight-medium"}, ""]);
    priv.$status = createElement2(
        ["div", {class: "NODES_STATUS is-size-7 has-text-grey"}, [
            priv.$count,
            ["span", {class: "NODES_STATUS_LABEL", i18n: "nodes"}, "Nodes"]
        ]]
    );
    $c.appendChild(priv.$status);

    /*  Not-connected notice (Tabulator's own placeholder covers no-nodes)  */
    priv.$notif = createElement2(
        ["div", {class: "NODES_NOTICE notification is-light", style: "display:none;",
                 i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  Column definitions. Built fresh (so titles + cell text pick up
 *  the current language) on create and on every languageChanged.
 *  Select is its own first column, wide enough for the longest
 *  label ("Seleccionar"); the active row shows a ✓ there instead.
 ***************************************************************/
function make_columns(gobj)
{

    /*  host: bold when the node is open, and it OPENS -- by hostname.  */
    function host_formatter(cell)
    {
        let n = cell.getData();
        let host = n.host || "";
        if(!host) {
            return "";      /*  nothing to address it by: no link to offer  */
        }
        let bold = (selected_key(gobj, n) === host)? " has-text-weight-bold": "";
        return `<span class="NODES_HOST NODES_OPENER${bold}" ` +
               `title="${esc(t("open by host"))}">${esc(host)}</span>`;
    }

    /*  uuid: muted monospace, and it OPENS too -- by uuid.  */
    function uuid_formatter(cell)
    {
        let n = cell.getData();
        let uuid = n.uuid || "";
        if(!uuid) {
            return "";
        }
        let bold = (selected_key(gobj, n) === uuid)? " has-text-weight-bold": "";
        return `<span class="NODES_UUID NODES_OPENER is-family-monospace is-size-7${bold}" ` +
               `title="${esc(t("open by uuid"))}">${esc(uuid)}</span>`;
    }

    function host_click(e, cell)
    {
        let n = cell.getData();
        toggle_node_by(gobj, n, n.host || "");
    }

    function uuid_click(e, cell)
    {
        let n = cell.getData();
        toggle_node_by(gobj, n, n.uuid || "");
    }

    /*  Per-row checkbox: checked when the node has an open Console tab.
     *  State is config-driven — the formatter always reflects
     *  selected_nodes, so no separate selection bookkeeping. */
    /*  A Tabulator formatter returns an HTML STRING, so there is no
     *  attribute to hang `data-i18n-aria-label` on -- and none is needed:
     *  the language action re-runs `setColumns(make_columns(gobj))`, which
     *  re-runs this formatter. `escapeHtml` because a translation is text
     *  going into an attribute.  */
    function sel_formatter(cell)
    {
        let checked = is_selected_node(gobj, cell.getData()) ? " checked" : "";
        return `<input type="checkbox" class="NODES_SEL node-sel"${checked} ` +
            `aria-label="${escapeHtml(t("open console tab"))}">`;
    }

    function sel_click(e, cell)
    {
        let n = cell.getData();
        /*
         *  Unchecking closes the tab that IS open, whichever key opened
         *  it; checking opens the default one (hostname, else uuid).
         *  Toggling by the default alone would answer a uuid-opened tab
         *  by opening a SECOND one next to it.
         */
        toggle_node_by(gobj, n, selected_key(gobj, n) || node_id(n));
    }

    /*  Header "select all": checked when every node is selected;
     *  clicking selects all (or clears when already all).  */
    function selall_formatter()
    {
        let config = gobj_read_attr(gobj, "config_svc");
        let ws = gobj_read_attr(gobj, "workspace");
        let nodes = gobj_read_attr(gobj, "nodes") || [];
        let sel = config ? agent_config_get_selected_nodes(config, ws).length : 0;
        let checked = (nodes.length > 0 && sel >= nodes.length) ? " checked" : "";
        return `<input type="checkbox" class="NODES_SEL_ALL node-sel-all"${checked} ` +
            `aria-label="${escapeHtml(t("select all nodes"))}">`;
    }

    function selall_click(e, column)
    {
        let config = gobj_read_attr(gobj, "config_svc");
        let ws = gobj_read_attr(gobj, "workspace");
        if(!config) {
            return;
        }
        let nodes = gobj_read_attr(gobj, "nodes") || [];
        let cur = agent_config_get_selected_nodes(config, ws).length;
        if(nodes.length > 0 && cur >= nodes.length) {
            agent_config_set_selected_nodes(config, ws, []);
        } else {
            agent_config_set_selected_nodes(config, ws, nodes.map((n) => {
                let id = node_id(n);
                return {id: id, host: n.host || id};
            }));
        }
    }

    /*  Checkbox first: on mobile the toggle is visible without scrolling
     *  right; the node detail columns follow.  */
    return [
        {title: "", field: "_sel", width: 44, headerSort: false, hozAlign: "center",
            formatter: sel_formatter, cellClick: sel_click,
            titleFormatter: selall_formatter, headerClick: selall_click},
        {title: t("host"),    field: "host",    formatter: host_formatter,
            cellClick: host_click},
        {title: t("role"),    field: "role"},
        {title: t("version"), field: "version", sorter: version_cmp},
        {title: t("uuid"),    field: "uuid",    formatter: uuid_formatter,
            cellClick: uuid_click}
    ];
}

/***************************************************************
 *  Create the Tabulator instance with sortable columns, the
 *  active-row formatter, and the Select action column.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;

    /*  green wash + accent on rows with an open Console tab (the shared
     *  .yui-row-active class from @yuneta/gobj-ui/src/tabulator.css)  */
    function row_formatter(row)
    {
        let n = row.getData();
        row.getElement().classList.toggle("yui-row-active", is_selected_node(gobj, n));
    }

    let settings = {
        ...yui_tabulator_lang(t),   /*  Tabulator's OWN chrome, in our language  */
        /*
         *  The row's own identity, not one of the two addressing keys:
         *  `uuid` was the index and six machines of one cloned fleet
         *  share theirs, so the table was told they were the same row.
         */
        index:       "id",
        layout:      "fitDataFill",
        maxHeight:   "100%",
        placeholder: t("no nodes"),
        /*  Column widths are the operator's: a uuid column and a host
         *  column want very different room, and which of the two is
         *  being read changes with the fleet in front of them.  */
        columnDefaults: {headerHozAlign: "left", resizable: true},
        columns:     make_columns(gobj),
        /*  Default order: by host, alphabetically -- a list of nodes is
         *  looked through by NAME. The version still sorts from its
         *  header, numerically (version_cmp).  */
        initialSort: [{column: "host", dir: "asc"}],
        rowFormatter: row_formatter
    };

    let table = new Tabulator(`#${priv.table_id}`, settings);
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        if(table._pendingData !== undefined) {
            table.setData(table._pendingData);
            delete table._pendingData;
        }
        update_count(gobj);
    });
    table.on("dataProcessed", () => update_count(gobj));
    gobj_write_attr(gobj, "tabulator", table);
}

/***************************************************************
 *  Push the current node list into the table and refresh the
 *  connected / disconnected state.
 ***************************************************************/
function update_table(gobj)
{
    let nodes = gobj_read_attr(gobj, "nodes");
    if(!Array.isArray(nodes)) {
        nodes = [];
    }

    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        if(table._ready) {
            table.replaceData(nodes);
        } else {
            table._pendingData = nodes;
        }
    }
    render_state(gobj);
    update_count(gobj);
}

/***************************************************************
 *  Re-run the row/cell formatters so the active highlight moves
 *  without reloading data (selection changed, not the list).
 ***************************************************************/
function refresh_active(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(table && table._ready) {
        table.getRows().forEach((row) => row.reformat());
    }
}

/***************************************************************
 *  Toggle table/toolbar vs the not-connected notice.
 ***************************************************************/
function render_state(gobj)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));

    priv.$toolbar.style.display = connected ? "" : "none";
    priv.$tablewrap.style.display = connected ? "" : "none";
    priv.$notif.style.display = connected ? "none" : "";
    if(priv.$status) {
        priv.$status.style.display = connected ? "" : "none";
    }
}

/***************************************************************
 *  Update the "<shown> / <total>" match count.
 ***************************************************************/
function update_count(gobj)
{
    let priv = gobj.priv;
    let table = gobj_read_attr(gobj, "tabulator");
    if(!priv.$count || !table) {
        return;
    }
    let shown = 0;
    let total = 0;
    try {
        shown = table.getDataCount("active");
        total = table.getDataCount();
    } catch(e) {
        shown = total = 0;
    }
    priv.$count.textContent = (shown === total) ? `${total}` : `${shown} / ${total}`;
}

/***************************************************************
 *  Apply the live search across host / role / version / uuid.
 ***************************************************************/
function apply_filter(gobj)
{
    let priv = gobj.priv;
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    let term = String(priv.$input.value || "").trim().toLowerCase();
    if(term) {
        table.setFilter((data) => {
            return ["host", "role", "version", "uuid"].some((k) => {
                return String(data[k] || "").toLowerCase().includes(term);
            });
        });
    } else {
        table.clearFilter();
    }
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  Ask the control center for the list again.
 ***************************************************************/
function ac_refresh(gobj, event, kw, src)
{
    request_agents(gobj);
    return 0;
}

/***************************************************************
 *  Hand the list over as JSON: the checked rows if any are
 *  checked, otherwise everything the current search leaves on
 *  screen. What you see is what you get.
 ***************************************************************/
function ac_copy_json(gobj, event, kw, src)
{
    let tabulator = gobj_read_attr(gobj, "tabulator");

    let priv = gobj.priv;

    yui_copy_table_json(tabulator).then(function(copied) {
        if(!copied) {
            log_error(`${gobj_short_name(gobj)}: nothing copied to the clipboard`);
            return;
        }
        /*  Say it happened: the clipboard gives no sign of its own.
         *  Going back is EV_TIMEOUT, an FSM transition, not a hidden
         *  setTimeout.  */
        yui_button_mark_done(priv.$copy, t("copied"));
        set_timeout(priv.gobj_timer, 1200);
    });

    return 0;
}

/***************************************************************
 *  The "copied" mark has had its moment.
 ***************************************************************/
function ac_timeout(gobj, event, kw, src)
{
    yui_button_unmark(gobj.priv.$copy);
    return 0;
}

/***************************************************************
 *  Selection changed (here or from a closed Console tab) — move
 *  the row highlight + checkboxes without reloading the list.
 ***************************************************************/
function ac_selected_nodes_changed(gobj, event, kw, src)
{
    /*  Only react to our own workspace's selection (the config service
     *  is shared by every workspace's picker).  */
    let ws = gobj_read_attr(gobj, "workspace");
    if(kw && kw.workspace && kw.workspace !== ws) {
        return 0;
    }
    refresh_active(gobj);
    return 0;
}

/***************************************************************
 *  Link in session — fetch the node list.
 ***************************************************************/
function ac_on_open(gobj, event, kw, src)
{
    request_agents(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    render_state(gobj);
    return 0;
}

/***************************************************************
 *  Command answer — only handle our own list-agents result.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let command = kw_get_str(gobj, stk, "command", "", 0);
    if(command !== "list-agents") {
        return 0;   /*  belongs to another panel  */
    }

    let data = kw.data;
    let nodes = [];
    if(Array.isArray(data)) {
        for(let line of data) {
            let n = parse_agent_line(line);
            /*  Drop nodes that can't serve this workspace (e.g. agents
             *  below 7.7.0 for Commands/Statistics): they wouldn't answer,
             *  so they must not appear as selectable here.  */
            if(node_meets_min_version(gobj, n)) {
                n.id = node_row_key(n);
                nodes.push(n);
            }
        }
    }
    gobj_write_attr(gobj, "nodes", nodes);
    update_table(gobj);
    return 0;
}





/***************************************************************
 *  The language changed (the shell publishes it).
 *
 *  refresh_language() reaches every node that CARRIES its key; a Tabulator
 *  does not: its column headers, its paginator, its placeholder and whatever
 *  its formatters paint come from t() at RENDER time and are drawn ONCE. Hand
 *  the table the new language and rebuild its columns.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return 0;
    }
    yui_tabulator_relocalize(table, t);
    try {
        table.options.placeholder = t("no nodes");
        table.setColumns(make_columns(gobj));
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: cannot re-render the table: ${e}`);
        return -1;
    }
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    return 0;
}



                    /***************************
                     *              FSM
                     ***************************/




/*---------------------------------------------*
 *          Global methods table
 *---------------------------------------------*/
const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy
};

/***************************************************************
 *          Create the GClass
 ***************************************************************/
function create_gclass(gclass_name)
{
    if(__gclass__) {
        log_error(`GClass ALREADY created: ${gclass_name}`);
        return -1;
    }

    /*---------------------------------------------*
     *          States
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null],
            ["EV_ON_OPEN",              ac_on_open,               null],
            ["EV_ON_CLOSE",             ac_on_close,              null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,     null],
            ["EV_SELECTED_NODES_CHANGED", ac_selected_nodes_changed, null],
            ["EV_REFRESH",              ac_refresh,               null],
            ["EV_COPY_JSON",            ac_copy_json,             null],
            ["EV_TIMEOUT",              ac_timeout,               null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_ON_OPEN",              0],
        ["EV_ON_CLOSE",             0],
        ["EV_MT_COMMAND_ANSWER",    0],
        ["EV_SELECTED_NODES_CHANGED", 0],
        ["EV_REFRESH",              0],
        ["EV_COPY_JSON",            0],
        ["EV_TIMEOUT",              0]
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

/***************************************************************
 *          Register GClass
 ***************************************************************/
function register_c_nodes()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_nodes};
