/***********************************************************************
 *          c_stats_nodes.js
 *
 *      C_STATS_NODES — the Statistics workspace node picker, a TREE:
 *      top rows are the nodes (list-agents, agent >= min_version) and
 *      each node expands to its running yunos as sub-rows (list-yunos,
 *      fetched per node). A checkbox on a YUNO row selects it — each
 *      selected yuno opens its own Statistics tab (a card of its
 *      SDF_RSTATS counters). The C_NODES flat picker stays for the
 *      Commands / Terminal workspaces; this tree is Statistics-only.
 *
 *      Selection reuses the shared per-workspace machinery: a yuno is
 *      stored as a composite id "node<US>yuno_id" (stats_sel_id), so the
 *      C_APP workspaces controller builds one tab per selected yuno.
 *
 *      Like the other pickers it owns no transport: it drives the shared
 *      C_AGENT_LINK. Answers are re-published to every panel, so its
 *      list-yunos fetches are tagged console_purpose="statnodes" +
 *      console_node=<node> (both echoed in __md_iev__) — the Console
 *      (no purpose) and the Statistics card (purpose "stats") ignore them.
 *      No polling: the tree loads on open and on the Refresh button.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning,
    gobj_parent, gobj_name,
    gobj_read_attr, gobj_read_bool_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_send_event,
    gobj_post_event,
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
    msg_iev_write_key,
    msg_iev_read_key,
    kw_get_str,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {
    AGENT_YUNO_ID,
    cmd2agent_service,
    version_cmp,
    version_gte,
    node_id,
    parse_agent_line,
    esc,
} from "./agent_helpers.js";
import {
    agent_config_get_selected_nodes,
    agent_config_set_selected_nodes,
    agent_config_is_node_selected,
    agent_config_toggle_selected_node,
    stats_sel_id,
    stats_sel_parse,
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
const GCLASS_NAME = "C_STATS_NODES";

/*  Marker of the per-yuno treedb probe, kept apart from this picker's own
 *  list-yunos ("statnodes") and from the Schemas tab's discovery
 *  ("treedbs"): the link re-publishes every answer to every panel.  */
const CHECK_PURPOSE = "treedbcheck";

/*  Marker of the per-treedb `treedb-info` probe: it answers whether this yuno
 *  is the MASTER of that treedb's tranger, which is the difference between an
 *  editable schema and a read-only replica. One call per treedb, right after
 *  the `services` probe that discovered them, and only in this workspace.  */
const MASTER_PURPOSE = "treedbmaster";

/*  Marker of the per-yuno `view-config` probe that the ytreedb export makes:
 *  a yuno's PUBLIC endpoint is nowhere else. Its config carries
 *  `__top_url__` ("wss://0.0.0.0:1602") when — and only when — the yuno
 *  exposes a top gate at all, so the same answer says both "this can be a
 *  treedb backend" and "on this port".  */
const CONNS_PURPOSE = "ytreedbconns";

/*  A scan is one round trip per yuno; give up on the ones that never answer
 *  rather than leave the button spinning for ever.  */
const CONNS_TIMEOUT_MS = 15000;

/*  The document gui_treedb's Connections page imports.  */
const CONNS_KIND = "yuneta.treedb.connections";
const CONNS_VERSION = 1;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,       "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "nodes",    "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "statistics", "Owning workspace (selection bucket)"),
SDATA(data_type_t.DTP_STRING,   "min_version", 0,  "",         "Only list nodes with version >= this (empty = all)"),
SDATA(data_type_t.DTP_BOOLEAN,  "with_treedb_check", 0, false,  "On expanding a node, ask each of its yunos whether it exposes a treedb (Schemas picker)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,       "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,       "Tabulator instance"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,       "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,       "C_AGENT_CONFIG service"),
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
    priv.table_id = `statnodes_table_${gobj_name(gobj)}`;

    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);
    priv.nodes = [];              /*  parsed list-agents (node rows)  */
    priv.yunos = {};              /*  node id -> [yuno rows] (loaded)  */
    priv.treedbs = {};            /*  sel id -> true|false (undefined = not asked)  */
    priv.services = {};           /*  sel id -> the `services` answer, verbatim  */
    priv.conns_scan = null;       /*  the ytreedb export in flight (see ac_copy_conns)  */
    priv.masters = {};            /*  sel id -> {total, master, answered} of its treedbs  */
    priv.render_pending = false;  /*  one-shot setData debounce  */

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
        ["div", {class: `${GCLASS_NAME} STATNODES_CARD view-card`,
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
    render_state(gobj);
    request_agents(gobj);

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

    let priv = gobj.priv;

    /*  A ytreedb scan in flight would fire its give-up timer into a stopped
     *  gobj, and its answers would arrive for a scan nobody is waiting on. */
    if(priv.conns_scan) {
        if(priv.conns_scan.timer) {
            window.clearTimeout(priv.conns_scan.timer);
        }
        priv.conns_scan = null;
        conns_busy(gobj, false);
    }
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
 *  Is this yuno selected in the Statistics workspace (has a tab)?
 ***************************************************************/
function is_yuno_selected(gobj, node, yuno_id)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    return !!(config && agent_config_is_node_selected(config, ws, stats_sel_id(node, yuno_id)));
}

/***************************************************************
 *  The yunos of one node this picker would let you open: the ones
 *  it lists, minus the ones it has asked about and that hold no
 *  treedb (Schemas). Empty while the node's list has not arrived.
 ***************************************************************/
function selectable_yunos(gobj, node)
{
    let rows = gobj.priv.yunos[node] || [];
    return rows.filter((y) => y && !has_no_treedb(gobj, y));
}

/***************************************************************
 *  The yunos of one node that have a tab open, by their label.
 *
 *  Read from the SELECTION and not from the loaded children, because
 *  this is asked precisely when the children are NOT on screen: a
 *  collapsed node hides the rows that carry the checkbox, and a node
 *  whose list-yunos has not answered yet has no children at all.
 ***************************************************************/
function selected_yunos_of_node(gobj, node)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    if(!config) {
        return [];
    }
    let open = [];
    for(let sel of agent_config_get_selected_nodes(config, ws)) {
        if(!sel || !sel.id) {
            continue;
        }
        let parsed = stats_sel_parse(sel.id);
        if(parsed.node === node) {
            open.push(sel.host || parsed.yuno_id);
        }
    }
    return open;
}

/***************************************************************
 *  Build the tree rows from priv.nodes + priv.yunos.
 *  Node row  : {_key, _type:"node", host, role, version, uuid, _children}
 *  Yuno row  : {_key, _type:"yuno", node, yuno_id, label, running}
 ***************************************************************/
function build_tree(gobj)
{
    let priv = gobj.priv;
    let tree = [];
    for(let n of priv.nodes) {
        let id = node_id(n);
        let children = [];
        let loaded = priv.yunos[id];
        if(Array.isArray(loaded)) {
            for(let y of loaded) {
                /*  Schemas: a yuno with no treedb leads NOWHERE in this
                 *  workspace, so it is not in the list at all — it used to be
                 *  listed with its checkbox off, which is a row that exists
                 *  only to be refused.
                 *
                 *  Only a KNOWN "none" is dropped. A probe still in flight or
                 *  one that failed (no permission, dropped link) keeps its
                 *  row, because "could not ask" is not "has none" — the same
                 *  rule the status column has always followed. And a yuno
                 *  that is already SELECTED stays visible whatever the probe
                 *  says: it has an open tab, and a tab whose row vanished
                 *  from the picker cannot be unchecked.  */
                if(has_no_treedb(gobj, y) && !is_yuno_selected(gobj, y.node, y.yuno_id)) {
                    continue;
                }
                children.push(y);
            }
            if(children.length === 0 && loaded.length > 0) {
                /*  Every yuno of this node was filtered out. An expander that
                 *  opens into nothing reads as a bug; one grey line reads as
                 *  an answer.  */
                children.push({
                    _key:  id + "\u001Fnone",
                    _type: "empty",
                    node:  id
                });
            }
        }
        tree.push({
            _key:     id,
            _type:    "node",
            host:     n.host || id,
            role:     n.role || "",
            version:  n.version || "",
            uuid:     n.uuid || "",
            _children: children
        });
    }
    return tree;
}

/***************************************************************
 *  Push the current tree into Tabulator (debounced to one setData per
 *  microtask burst, so the flurry of per-node list-yunos answers does
 *  not rebuild the table many times).
 ***************************************************************/
function schedule_render(gobj)
{
    let priv = gobj.priv;
    if(priv.render_pending) {
        return;
    }
    priv.render_pending = true;
    gobj_post_event(gobj, "EV_RENDER_TREE", {}, gobj);
}

/***************************************************************
 *  Static shell: search toolbar + Tabulator host + not-connected notice.
 ***************************************************************/
function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    clear_node($c);

    let $input = createElement2(["input", {
        class:        "STATNODES_SEARCH input",
        type:         "text",
        placeholder:  t("search nodes"),
        "aria-label": t("search nodes"),
        "data-i18n-aria-label": "search nodes"
    }, null, {
        input: () => apply_filter(gobj)
    }]);
    priv.$input = $input;

    let $count = createElement2(
        ["span", {class: "STATNODES_COUNT is-size-7 has-text-grey"}, ""]);
    priv.$count = $count;

    let $search_control = createElement2(
        ["div", {class: "STATNODES_SEARCH_CONTROL control has-icons-left",
                 style: "flex:1 1 12rem; max-width:22rem; min-width:0;"}, [
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
    /*  One control for the whole tree: with a screen of nodes, opening or
     *  closing them one expander at a time is the work the button exists to
     *  save. Its icon says what the CLICK will do — chevron-down while
     *  something is still folded, chevron-right once everything is open.  */
    let $fold = createElement2(
        ["button", {class: "STATNODES_FOLD button", type: "button",
                    title: t("expand all"), "aria-label": t("expand all"),
                    "data-i18n-title": "expand all", "data-i18n-aria-label": "expand all"},
            [["span", {class: "icon"}, [["span", {class: "yi-chevron-down"}, ""]]]],
            {click: () => gobj_send_event(gobj, "EV_TOGGLE_FOLD", {}, gobj)}
        ]);
    priv.$fold = $fold;

    let $copy = createElement2(
        ["button", {
            class:        "STATNODES_COPY button",
            type:         "button",
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


    /*  Only in the Schemas picker: it is the one that probes for treedbs, so
     *  it is the only one that knows which yunos gui_treedb could browse.
     *  Copying the coordinates beats retyping a dozen `wss://host:port` rows
     *  into the other app by hand. */
    let $copy_conns = null;
    if(gobj_read_bool_attr(gobj, "with_treedb_check")) {
        $copy_conns = createElement2(
            ["button", {
                class:        "STATNODES_COPY_CONNS button",
                type:         "button",
                title:        t("copy the yunos shown as treedb connections"),
                "aria-label": t("copy the yunos shown as treedb connections"),
                "data-i18n-title": "copy the yunos shown as treedb connections",
                "data-i18n-aria-label": "copy the yunos shown as treedb connections"
            }, [
                ["span", {class: "icon"}, [["span", {class: "yi-link"}, ""]]],
                ["span", {class: "is-hidden-mobile", i18n: "for treedb"}, "For TreeDB"]
            ], {
                click: () => gobj_send_event(gobj, "EV_COPY_CONNS", {}, gobj)
            }]
        );
    }
    priv.$copy_conns = $copy_conns;

    /*  The buttons travel TOGETHER. On one line they sit at the right of the
     *  search box; on a phone the whole group drops to a second line instead
     *  of each button pushing the search box a bit narrower until it reads
     *  "Buscar h" and the last button falls off the screen.  */
    let $actions = createElement2(
        ["div", {class: "STATNODES_ACTIONS is-flex is-align-items-center",
                 style: "gap:0.5rem; margin-left:auto;"}, [
            $fold,
            $copy,
            $copy_conns,
            ["button", {class: "STATNODES_REFRESH button", type: "button", i18n: "refresh"},
                "Refresh", {click: () => gobj_send_event(gobj, "EV_REFRESH", {}, gobj)}]
        ]]
    );

    priv.$toolbar = createElement2(
        ["div", {class: "STATNODES_TOOLBAR is-flex is-align-items-center is-flex-wrap-wrap mb-2",
                 style: "gap:0.5rem;"}, [
            $search_control,
            $count,
            $actions
        ]]
    );
    $c.appendChild(priv.$toolbar);

    priv.$tablewrap = createElement2(
        ["div", {class: "STATNODES_TABLEWRAP", style: "flex:1; min-height:0;"}, [
            ["div", {class: "STATNODES_TABLE", id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    priv.$notif = createElement2(
        ["div", {class: "STATNODES_NOTICE notification is-light", style: "display:none;",
                 i18n: "not connected to an agent"},
            "Not connected"]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

/***************************************************************
 *  True only when this picker ASKED and the yuno answered that it
 *  exposes no treedb. Not asked, in flight, or a failed probe are
 *  all "unknown", and unknown never marks a row.
 ***************************************************************/
function has_no_treedb(gobj, row)
{
    if(!gobj_read_bool_attr(gobj, "with_treedb_check")) {
        return false;
    }
    return gobj.priv.treedbs[stats_sel_id(row.node, row.yuno_id)] === false;
}

/***************************************************************
 *  Columns: a checkbox (yuno rows only), the tree name column
 *  (node host / yuno role^name), and an info column.
 ***************************************************************/
function make_columns(gobj)
{
    /*  Name: the tree column. Node -> host; yuno -> role^name label,
     *  bold when that yuno has an open Statistics tab.  */
    function name_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "yuno") {
            let sel = is_yuno_selected(gobj, r.node, r.yuno_id);
            let cls = sel ? " has-text-weight-bold" : "";
            return `<span class="STATNODES_YUNO${cls}">${esc(r.label)}</span>`;
        }
        if(r._type === "empty") {
            return `<span class="STATNODES_EMPTY has-text-grey is-size-7">` +
                `${esc(t("no yuno with a treedb"))}</span>`;
        }
        /*  Which of this node's yunos are open. The tab strip says it for
         *  the ACTIVE tab only, and the checkbox that says it here is on a
         *  child row — invisible while the node is collapsed, which is how
         *  a node is read most of the time. So the node row carries it: the
         *  labels of its open yunos, the same text the tabs are named
         *  after.  */
        let open = selected_yunos_of_node(gobj, r._key);
        let mark = "";
        if(open.length > 0) {
            let shown = open.slice(0, 2).join(", ");
            if(open.length > 2) {
                shown += ` +${open.length - 2}`;
            }
            mark = ` <span class="STATNODES_NODE_OPEN has-text-link is-size-7" ` +
                `title="${esc(t("open in this workspace"))}">${esc(shown)}</span>`;
        }
        return `<span class="STATNODES_NODE has-text-weight-semibold">` +
            `${esc(r.host)}</span>${mark}`;
    }

    /*  Info: node -> "v<version> · <role>"; yuno -> running badge.  */
    function info_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "yuno") {
            /*  Schemas picker: a yuno with no treedb leads nowhere, and
             *  that is what the operator needs to see BEFORE opening a
             *  tab for it. Unknown (not probed, or the probe failed)
             *  keeps the running badge — silence is not a "no".  */
            if(has_no_treedb(gobj, r)) {
                return `<span class="STATNODES_INFO has-text-grey is-size-7">` +
                    `${esc(t("no treedb in this yuno"))}</span>`;
            }
            /*  running/stopped, plus what the operator is really asking in
             *  this workspace: can I EDIT here? Only the master of a treedb
             *  can write (the yuno refuses otherwise), so a replica is a
             *  read-only visit. Nothing is said until every treedb of the
             *  yuno has answered, and nothing at all against a node too old
             *  to know the question.  */
            let run = r.running
                ? `<span class="STATNODES_INFO has-text-success is-size-7">` +
                    `${esc(t("running"))}</span>`
                : `<span class="STATNODES_INFO has-text-grey is-size-7">` +
                    `${esc(t("stopped"))}</span>`;
            let badge = "";
            switch(master_state(gobj, r)) {
                case "master":
                    badge = `<span class="STATNODES_MASTER has-text-link is-size-7 ` +
                        `has-text-weight-semibold">${esc(t("master"))}</span>`;
                    break;
                case "readonly":
                    badge = `<span class="STATNODES_READONLY has-text-grey is-size-7 ` +
                        `has-text-weight-semibold">${esc(t("read only"))}</span>`;
                    break;
                case "mixed":
                    badge = `<span class="STATNODES_MIXED has-text-warning-dark is-size-7 ` +
                        `has-text-weight-semibold">${esc(t("master mixed"))}</span>`;
                    break;
                default:
                    break;      /*  still asking, or nobody could answer  */
            }
            if(badge) {
                run += " " + badge;
            }
            return run;
        }
        if(r._type === "empty") {
            return "";
        }
        let v = r.version ? `v${esc(r.version)}` : "";
        let role = r.role ? ` · ${esc(r.role)}` : "";
        return `<span class="STATNODES_INFO is-size-7 has-text-grey">${v}${role}</span>`;
    }

    /*  Checkbox. A yuno row opens ITS tab; a node row opens or closes the
     *  tabs of all the yunos it holds — and says which of the three it is
     *  in: none, some, all. A DOM node and not an HTML string, because
     *  `indeterminate` is a property and cannot be written in markup.  */
    function sel_formatter(cell)
    {
        let r = cell.getData();
        if(r._type === "node") {
            let all = selectable_yunos(gobj, r._key);
            let open = all.filter((y) => is_yuno_selected(gobj, y.node, y.yuno_id)).length;
            let $cb = document.createElement("input");
            $cb.type = "checkbox";
            $cb.className = "STATNODES_SEL_ALL node-sel-all";
            $cb.disabled = !all.length;
            $cb.checked = all.length > 0 && open === all.length;
            $cb.indeterminate = open > 0 && open < all.length;
            $cb.setAttribute("aria-label", t("open all of this node"));
            $cb.title = t("open all of this node");
            return $cb;
        }
        if(r._type !== "yuno") {
            return "";
        }
        let checked = is_yuno_selected(gobj, r.node, r.yuno_id) ? " checked" : "";
        /*  Not selectable when it has nothing to open. Kept in the list
         *  (it IS a yuno of the node) but with the checkbox off.  */
        let disabled = (has_no_treedb(gobj, r) && !checked) ? " disabled" : "";
        return `<input type="checkbox" class="STATNODES_SEL node-sel"` +
            `${checked}${disabled} aria-label="open stats tab">`;
    }

    function sel_click(e, cell)
    {
        let r = cell.getData();
        if(r._type === "node") {
            gobj_send_event(gobj, "EV_TOGGLE_NODE_SELECTION", {node: r._key}, gobj);
            return;
        }
        if(r._type !== "yuno") {
            return;
        }
        if(has_no_treedb(gobj, r) && !is_yuno_selected(gobj, r.node, r.yuno_id)) {
            return;     /*  the cell is clickable even where the input is not  */
        }
        let config = gobj_read_attr(gobj, "config_svc");
        let ws = gobj_read_attr(gobj, "workspace");
        if(config) {
            agent_config_toggle_selected_node(config, ws,
                {id: stats_sel_id(r.node, r.yuno_id), host: r.label});
        }
    }

    /*  Both text columns WRAP instead of ending in an ellipsis. On a phone
     *  `fitColumns` leaves the status about half of what "Running Read only"
     *  needs, and half a status is worse than two lines of it — the same for
     *  a host name and the yunos it has open. `variableHeight` is what lets
     *  the row grow to fit; the wrapping itself is CSS (Tabulator's own cell
     *  rule is nowrap + ellipsis).  */
    /*  The header box covers the nodes the filter leaves ON SCREEN — the
     *  same decision the shared selection facility takes in gobj-ui, and for
     *  the same reason: "all" over rows nobody can see is not what the eye
     *  agreed to.  */
    function selall_formatter()
    {
        let counts = shown_selection_counts(gobj);
        let $cb = document.createElement("input");
        $cb.type = "checkbox";
        $cb.className = "STATNODES_SEL_HEADER";
        $cb.disabled = !counts.total;
        $cb.checked = counts.total > 0 && counts.open === counts.total;
        $cb.indeterminate = counts.open > 0 && counts.open < counts.total;
        $cb.setAttribute("aria-label", t("open all shown"));
        $cb.title = t("open all shown");
        return $cb;
    }

    function selall_click()
    {
        gobj_send_event(gobj, "EV_TOGGLE_ALL_SELECTION", {}, gobj);
    }

    return [
        {title: "", field: "_sel", width: 44, headerSort: false, hozAlign: "center",
            formatter: sel_formatter, cellClick: sel_click,
            titleFormatter: selall_formatter, headerClick: selall_click},
        {title: t("name"), field: "name", formatter: name_formatter, widthGrow: 2,
            variableHeight: true, cssClass: "STATNODES_CELL_WRAP"},
        {title: t("status"), field: "info", formatter: info_formatter, widthGrow: 1,
            minWidth: 96, variableHeight: true, cssClass: "STATNODES_CELL_WRAP"}
    ];
}

/***************************************************************
 *  Create the Tabulator tree.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;

    let settings = {
        ...yui_tabulator_lang(t),   /*  Tabulator's OWN chrome, in our language  */
        index:                 "_key",
        layout:                "fitColumns",
        maxHeight:             "100%",
        placeholder:           t("no nodes"),
        columnDefaults:        {headerHozAlign: "left", resizable: false},
        columns:               make_columns(gobj),
        dataTree:              true,
        dataTreeStartExpanded: false,
        dataTreeElementColumn: "name",
        dataTreeChildField:    "_children"
    };

    let table = new Tabulator(`#${priv.table_id}`, settings);
    /*  Expanding a node is the moment its yunos become worth asking
     *  about: the Schemas picker probes them for a treedb here, and
     *  nowhere else, so a tree that is never opened costs nothing.  */
    table.on("dataTreeRowExpanded", function(row) {
        let r = row.getData();
        if(r && r._type === "node") {
            probe_node_treedbs(gobj, node_id(r));
        }
        render_fold(gobj);
    });
    table.on("dataTreeRowCollapsed", function() {
        render_fold(gobj);
    });
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        if(table._pendingData !== undefined) {
            table.setData(table._pendingData);
            delete table._pendingData;
        }
        update_count(gobj);
    });
    gobj_write_attr(gobj, "tabulator", table);
}

/***************************************************************
 *  Re-run the formatters (selection changed elsewhere).
 ***************************************************************/
function refresh_active(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    render_header_check(gobj);
    if(table && table._ready) {
        table.getRows().forEach((row) => {
            row.reformat();
            let subs = row.getTreeChildren ? row.getTreeChildren() : [];
            subs.forEach((s) => s.reformat());
        });
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
}

/***************************************************************
 *  Count of nodes (top-level rows).
 ***************************************************************/
function update_count(gobj)
{
    let priv = gobj.priv;
    if(!priv.$count) {
        return;
    }
    priv.$count.textContent = `${priv.nodes.length}`;
}

/***************************************************************
 *  Live search across node host/role/version and yuno labels.
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
            if(data._type === "yuno") {
                return String(data.label || "").toLowerCase().includes(term);
            }
            return ["host", "role", "version"].some((k) => {
                return String(data[k] || "").toLowerCase().includes(term);
            });
        });
    } else {
        table.clearFilter();
    }
    /*  The header box is about what is SHOWN, so it moves with the filter.  */
    render_header_check(gobj);
}




                    /***************************
                     *      Requests
                     ***************************/




/***************************************************************
 *  Ask the control center for the connected nodes.
 ***************************************************************/
function request_agents(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        agent_link_command(link, "list-agents", {});
    }
}

/***************************************************************
 *  Ask ONE node for its yunos (on tree-row expand). Tagged so only
 *  this picker consumes the answer.
 ***************************************************************/
function request_yunos(gobj, node)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!node || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {agent_id: node, cmd2agent: "list-yunos"};
    msg_iev_write_key(kw_send, "console_purpose", "statnodes");
    msg_iev_write_key(kw_send, "console_node", node);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Ask ONE treedb of ONE yuno whether this yuno is its MASTER
 *  (`treedb-info`, C_NODE, SDK >= 7.13.0). An older node answers
 *  "command not available", which counts as an ANSWER carrying no
 *  master information — the row then says nothing rather than claiming
 *  read-only, because a question that cannot be asked is not a "no".
 ***************************************************************/
function probe_master(gobj, node, yuno_id, treedb_name)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!node || !yuno_id || !treedb_name || !link || !agent_link_is_connected(link)) {
        return;
    }
    let kw_send = {
        agent_id:  node,
        cmd2agent: cmd2agent_service(yuno_id, treedb_name, "treedb-info")
    };
    msg_iev_write_key(kw_send, "console_purpose", MASTER_PURPOSE);
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno_id);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  One `treedb-info` answer. Masters are counted against the total, so
 *  a yuno whose treedbs DISAGREE can say so: being master is per
 *  TREEDB, and one yuno is routinely the master of its
 *  treedb_system_schema and a replica of a data treedb it shares.
 ***************************************************************/
function set_treedb_master(gobj, node, yuno_id, data, result)
{
    let priv = gobj.priv;
    let acc = priv.masters[stats_sel_id(node, yuno_id)];

    if(!acc) {
        return;     /*  the yuno left the list while this was in flight  */
    }
    acc.answered++;
    if(typeof result === "number" && result < 0 || !data || typeof data.master !== "boolean") {
        /*  A node older than the command answers "command not available", and
         *  a failure answers nothing: that is UNKNOWN. Counting it as "not
         *  master" would label every pre-7.13.0 node read-only, which is a
         *  claim this app cannot make.  */
        acc.unknown++;
        refresh_active(gobj);
        return;
    }
    if(data.master === true) {
        acc.master++;
    }
    refresh_active(gobj);
}

/***************************************************************
 *  What the row says about writing: nothing until every treedb of the
 *  yuno has answered, then master / read-only / mixed.
 ***************************************************************/
function master_state(gobj, row)
{
    let acc = gobj.priv.masters[stats_sel_id(row.node, row.yuno_id)];

    if(!acc || acc.answered < acc.total) {
        return "";      /*  still asking  */
    }
    if(acc.unknown > 0) {
        return "";      /*  a treedb could not answer: say nothing  */
    }
    if(acc.master === 0) {
        return "readonly";
    }
    if(acc.master === acc.total) {
        return "master";
    }
    return "mixed";
}

/***************************************************************
 *  Ask ONE yuno which services it runs, to learn whether it exposes
 *  any treedb (a `C_NODE` service). Only the Schemas picker does
 *  this, and only for the node the operator EXPANDS: it is one round
 *  trip per yuno, and a node holds a dozen.
 ***************************************************************/
function probe_treedbs(gobj, node, yuno_id)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");
    let key = stats_sel_id(node, yuno_id);

    if(!gobj_read_bool_attr(gobj, "with_treedb_check")) {
        return;
    }
    if(key in priv.treedbs) {
        return;     /*  asked already; the answer does not change under us  */
    }
    if(!node || !yuno_id || !link || !agent_link_is_connected(link)) {
        return;
    }
    priv.treedbs[key] = undefined;      /*  in flight  */

    let kw_send = {
        agent_id:  node,
        cmd2agent: cmd2agent_service(yuno_id, "__yuno__", "services")
    };
    msg_iev_write_key(kw_send, "console_purpose", CHECK_PURPOSE);
    msg_iev_write_key(kw_send, "console_node", node);
    msg_iev_write_key(kw_send, "console_yuno", yuno_id);
    agent_link_command(link, "command-agent", kw_send);
}

/***************************************************************
 *  Probe every yuno of a node (on expand).
 ***************************************************************/
function probe_node_treedbs(gobj, node)
{
    let priv = gobj.priv;
    let rows = priv.yunos[node] || [];
    for(let r of rows) {
        probe_treedbs(gobj, node, r.yuno_id);
    }
}

/***************************************************************
 *  Build a node's yuno child rows from a list-yunos answer (running
 *  yunos only; those are the ones with live counters).
 ***************************************************************/
function set_node_yunos(gobj, node, data)
{
    let priv = gobj.priv;
    let rows = [];
    if(Array.isArray(data)) {
        for(let y of data) {
            if(!y || y.yuno_running === false) {
                continue;
            }
            let id = y.id;
            if(!id) {
                continue;
            }
            let role = y.yuno_role || "";
            let name = y.yuno_name || "";
            let label = (role && name) ? `${role}^${name}` : (role || name || id);
            rows.push({
                _key:     stats_sel_id(node, id),
                _type:    "yuno",
                node:     node,
                yuno_id:  id,
                label:    label,
                /*  Not shown in any column: these two are what a treedb
                 *  connection is addressed with (see build_ytreedb_doc). */
                role:     role,
                realm:    Array.isArray(y.realm_id)? (y.realm_id[0] || "")
                                                   : (y.realm_id || ""),
                running:  y.yuno_running !== false
            });
        }
    }
    /*
     *  The node's own AGENT, first. It never appears in `list-yunos` --
     *  it is the daemon that ANSWERS it, not one of the yunos it manages
     *  -- and yet it runs the same kind of services, its treedbs
     *  included. Only the Schemas picker offers it: this is the one
     *  workspace that has something to do with a treedb, and the row is
     *  addressed with the agent's own `command-agent` from here on.
     *
     *  On the .ovh plane the agent this reaches IS yuneta_agent22, so
     *  the same row shows that one with no extra code (deploy.js maps
     *  the host to its control center).
     */
    if(gobj_read_bool_attr(gobj, "with_treedb_check")) {
        rows.unshift({
            _key:     stats_sel_id(node, AGENT_YUNO_ID),
            _type:    "yuno",
            node:     node,
            yuno_id:  AGENT_YUNO_ID,
            label:    "yuneta_agent",
            running:  true
        });
    }

    priv.yunos[node] = rows;
    schedule_render(gobj);
}

/***************************************************************
 *  Record whether a yuno exposes any treedb, from its `services`
 *  answer: the `C_NODE` services ARE its treedbs.
 *
 *  A FAILED answer is left unknown on purpose — "we could not ask"
 *  is not "it has none", and marking a row on a permission error or
 *  a dropped link would send the operator looking for a treedb that
 *  is there.
 ***************************************************************/
function set_yuno_treedbs(gobj, node, yuno_id, data, result)
{
    let priv = gobj.priv;
    let key = stats_sel_id(node, yuno_id);

    if(typeof result === "number" && result < 0) {
        delete priv.treedbs[key];   /*  unknown again: a later expand retries  */
        conns_probe_answered(gobj);
        return;
    }
    let names = [];
    if(Array.isArray(data)) {
        names = data.filter((sv) => sv && sv.gclass === "C_NODE")
            .map((sv) => sv.service)
            .filter((x) => typeof x === "string" && x.length > 0);
        /*  The whole answer, not just the count. This probe already asks
         *  every yuno what services it runs, which is exactly the list a
         *  treedb connection needs — it used to be thrown away one line
         *  after it arrived. */
        priv.services[key] = data;
    }
    let count = names.length;
    let had = priv.treedbs[key];
    priv.treedbs[key] = (count > 0);

    /*  A yuno the probe just answered "no treedb" for LEAVES the list in this
     *  workspace (build_tree drops it), and dropping a row is a data change:
     *  refresh_active() only re-runs the formatters of rows that are already
     *  there, which is why the row used to stay, greyed, saying so. Rebuild
     *  instead — the posted EV_RENDER_TREE collapses the flurry of per-yuno
     *  answers into ONE setData.  */
    if(count === 0 && gobj_read_bool_attr(gobj, "with_treedb_check")) {
        schedule_render(gobj);
        conns_probe_answered(gobj);
        return;
    }

    /*  It HAS treedbs: ask each one whether this yuno is its master. Only the
     *  master can modify, so this is what tells the operator whether the tab
     *  they are about to open can edit anything.  */
    priv.masters[key] = {total: count, master: 0, answered: 0, unknown: 0};
    for(let name of names) {
        probe_master(gobj, node, yuno_id, name);
    }
    if(had !== priv.treedbs[key]) {
        refresh_active(gobj);
    }
    conns_probe_answered(gobj);
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
 *  Push the tree into Tabulator. Posted by schedule_render(), so a
 *  flurry of per-node list-yunos answers collapses into ONE setData:
 *  the first one posts, the rest see render_pending and skip, and this
 *  action clears the flag. The coalescing is the same a `setTimeout`
 *  gave us; what it gains is a name in the `machine` trace.
 ***************************************************************/
function ac_render_tree(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.render_pending = false;

    let table = gobj_read_attr(gobj, "tabulator");
    let tree = build_tree(gobj);
    if(table) {
        if(table._ready) {
            /*  setData RESETS the tree: `dataTreeStartExpanded: false` means
             *  every node comes back collapsed, so a rebuild would close the
             *  node the operator has open — and this workspace rebuilds
             *  precisely while they are looking at it (a yuno leaves the list
             *  when its probe answers "no treedb"). Remember what was open
             *  and re-open it.
             *
             *  Re-expanding fires `dataTreeRowExpanded` again, which is
             *  harmless: probe_node_treedbs() is idempotent per yuno.  */
            let open = {};
            table.getRows().forEach(function(row) {
                let d = row.getData();
                if(d && d._key && row.isTreeExpanded && row.isTreeExpanded()) {
                    open[d._key] = true;
                }
            });
            Promise.resolve(table.setData(tree)).then(function() {
                table.getRows().forEach(function(row) {
                    let d = row.getData();
                    if(d && open[d._key] && row.treeExpand) {
                        row.treeExpand();
                    }
                });
                render_fold(gobj);
                render_header_check(gobj);
            }).catch(function(err) {
                log_error(`${gobj_short_name(gobj)}: setData failed: ${err && err.message}`);
            });
        } else {
            table._pendingData = tree;
        }
    }
    update_count(gobj);
    return 0;
}

/***************************************************************
 *  Hand the list over as JSON: the checked rows if any are
 *  checked, otherwise everything the current search leaves on
 *  screen. What you see is what you get.
 ***************************************************************/
/***************************************************************
 *  Where a yuno LISTENS, out of its config.
 *
 *  `view-config` carries it under
 *      global["<gate>.__json_config_variables__"].__top_url__
 *  as "wss://0.0.0.0:<port>" — the BIND address, so the port is
 *  authoritative and the host is not in there and cannot be. The gate is
 *  `__top_side__` in every yuno seen so far; the key is matched by its
 *  suffix rather than by that name, so a yuno that calls its gate
 *  something else still answers.
 *
 *  A yuno with no `__top_url__` exposes no top gate and can never be a
 *  treedb backend: its absence is an answer, not a failure.
 *
 *  The HOST, best evidence first:
 *    1. `__ssl_certificate__` — its filename is the FQDN the certificate
 *       is issued for, which is the name a client MUST use. Present on
 *       some yunos and not others.
 *    2. the realm id from this same config (`environment.realm_id`),
 *       which is the public FQDN for realms that publish
 *       (`app.wattyzer.com`) and is not for the ones that do not
 *       (`artgins.utilities.all`).
 *    3. nothing — and the operator fills it in.
 ***************************************************************/
function endpoint_of_config(config)
{
    let out = {port: "", host: ""};
    if(!config || typeof config !== "object") {
        return out;
    }

    let vars = null;
    let global_cfg = config.global;
    if(global_cfg && typeof global_cfg === "object") {
        for(let key of Object.keys(global_cfg)) {
            if(!key.endsWith("__json_config_variables__")) {
                continue;
            }
            let candidate = global_cfg[key];
            if(candidate && typeof candidate === "object" && candidate.__top_url__) {
                vars = candidate;
                break;
            }
        }
    }
    if(!vars) {
        return out;
    }

    let m = String(vars.__top_url__).match(/:(\d+)\s*$/);
    out.port = m ? m[1] : "";

    let cert = vars.__ssl_certificate__;
    if(typeof cert === "string" && cert) {
        let base = cert.split("/").pop() || "";
        out.host = base.replace(/\.(crt|pem|cer)$/i, "");
    }
    if(!out.host) {
        let env = config.environment;
        if(env && typeof env === "object" && typeof env.realm_id === "string") {
            out.host = env.realm_id;
        }
    }

    return out;
}

/***************************************************************
 *  Turn one scanned yuno into a gui_treedb connection.
 *
 *  The URL is a PROPOSAL and is marked as one: the port is authoritative
 *  (it comes from the yuno's own config) but the public host is not. A
 *  yuno binds 0.0.0.0 and its realm binds 127.0.0.1, so the only name
 *  anywhere near a public one is the realm's id — which IS the public
 *  FQDN for the realms that publish (`app.wattyzer.com`) and is not for
 *  the ones that do not (`artgins.utilities.all`). The operator sees the
 *  url in the table and fixes it there; the connection arrives disabled
 *  either way, so a wrong guess opens no socket.
 ***************************************************************/
function conn_of_scanned(row, endpoint, services)
{
    let host = endpoint.host || row.realm || "";
    let port = endpoint.port;
    let browsable = [];
    let role_service = "";

    if(Array.isArray(services)) {
        for(let sv of services) {
            if(!sv || typeof sv.service !== "string" || !sv.service) {
                continue;
            }
            /*  The yuno's own service is the one NAMED like its role.
             *
             *  Not "the first top-service": a yuno flags several of them
             *  (`authz`, `idp`, `emailsender`, its gates…) and the first is
             *  alphabetical luck — it came out `authz` for all nine backends
             *  of a real scan, which is a connection the backend refuses.  */
            if(sv.service === row.role) {
                role_service = sv.service;
            }
            if(sv.gclass === "C_NODE" || sv.gclass === "C_TRANGER") {
                browsable.push({
                    service:  sv.service,
                    gclass:   sv.gclass,
                    /*  Everything the yuno browses, ticked: the operator asked
                     *  for this yuno, not for a subset of it, and Connections
                     *  now unticks the lot with one click on the header. */
                    selected: true
                });
            }
        }
    }

    return {
        label:               `${row.node} · ${row.role || row.label}`,
        url:                 `wss://${host}:${port}`,
        remote_yuno_role:    row.role || "",
        /*  The yuno's own top service, from the same answer that listed
         *  them — not the role. They match by convention and the identity
         *  card is refused when they do not. */
        remote_yuno_service: role_service || row.role || "",
        services:            browsable
    };
}

/***************************************************************
 *  Finish the scan: build the document, put it on the clipboard.
 ***************************************************************/
function finish_conns_scan(gobj)
{
    let priv = gobj.priv;
    let scan = priv.conns_scan;
    if(!scan) {
        return;
    }
    priv.conns_scan = null;
    conns_busy(gobj, false);
    if(scan.timer) {
        /*  A raw handle, cleared with the raw call: this is the browser's
         *  timer, not the gobj's C_TIMER (which is already carrying the
         *  button-reset EV_TIMEOUT and cannot carry two). */
        window.clearTimeout(scan.timer);
    }

    let connections = [];
    /*  Two rows can resolve to ONE endpoint: the same yuno reached through
     *  two nodes, or a local copy carrying the production realm in its
     *  config. Same url, same backend — one connection. */
    let seen = new Set();
    for(let key of Object.keys(scan.rows)) {
        let entry = scan.rows[key];
        if(!entry.endpoint || !entry.endpoint.port) {
            continue;       /*  no top gate, or never answered  */
        }
        let conn = conn_of_scanned(entry.row, entry.endpoint, priv.services[key]);
        if(seen.has(conn.url)) {
            continue;
        }
        seen.add(conn.url);
        connections.push(conn);
    }

    if(!connections.length) {
        log_error(`${gobj_short_name(gobj)}: none of the ${scan.asked} yunos ` +
                  `scanned exposes a public gate (no __top_url__)`);
        yui_button_mark_done(priv.$copy_conns, t("nothing to copy"));
        set_timeout(priv.gobj_timer, 1800);
        return;
    }

    let doc = {
        kind:        CONNS_KIND,
        version:     CONNS_VERSION,
        connections: connections
    };

    let text = JSON.stringify(doc, null, 4);
    let done = () => {
        yui_button_mark_done(priv.$copy_conns, `${connections.length} ${t("copied")}`);
        set_timeout(priv.gobj_timer, 1800);
    };

    try {
        navigator.clipboard.writeText(text).then(done).catch((e) => {
            log_error(`${gobj_short_name(gobj)}: cannot write the clipboard: ${e}`);
        });
    } catch(e) {
        log_error(`${gobj_short_name(gobj)}: cannot write the clipboard: ${e}`);
    }
}

/***************************************************************
 *  One yuno's config came back.
 ***************************************************************/
function set_conns_config(gobj, node, yuno_id, data, result)
{
    let priv = gobj.priv;
    let scan = priv.conns_scan;
    if(!scan) {
        return;     /*  timed out, or a stale answer of a previous scan  */
    }
    let key = stats_sel_id(node, yuno_id);
    let entry = scan.rows[key];
    if(!entry || entry.answered) {
        return;
    }
    entry.answered = true;
    if(typeof result !== "number" || result >= 0) {
        entry.endpoint = endpoint_of_config(data);
    }

    scan.pending--;
    if(scan.pending <= 0) {
        finish_conns_scan(gobj);
    }
}

/***************************************************************
 *  The yuno rows the table is showing, flattened.
 *
 *  The yunos are `_children` of their node row: this is a dataTree, and
 *  getData() returns the TOP rows with their children nested. Flatten,
 *  or a scan walks six node rows and finds no yuno at all.
 ***************************************************************/
function shown_yuno_rows(gobj)
{
    let tabulator = gobj_read_attr(gobj, "tabulator");
    let top = [];
    try {
        top = tabulator ? tabulator.getData("active") : [];
    } catch(e) {
        top = [];
    }

    let rows = [];
    for(let parent of top) {
        if(!parent || !Array.isArray(parent._children)) {
            continue;
        }
        for(let child of parent._children) {
            if(!child || child._type !== "yuno" || !child.node || !child.yuno_id) {
                continue;
            }
            rows.push(child);
        }
    }
    return rows;
}

/***************************************************************
 *  A scan travels: say so on the button. It now spends a round trip
 *  per shown yuno, and a button that does nothing visible for a few
 *  seconds reads as broken.
 ***************************************************************/
function conns_busy(gobj, busy)
{
    let $b = gobj.priv.$copy_conns;
    if(!$b) {
        return;
    }
    $b.classList.toggle("is-loading", !!busy);
}

/***************************************************************
 *  True while any candidate of the running scan is still waiting for
 *  its `services` answer.
 *
 *  In flight is the key PRESENT and undefined, the mark probe_treedbs()
 *  leaves. A probe that FAILED deletes its key, and a deleted key is not
 *  waiting: nothing else is going to arrive for it.
 ***************************************************************/
function conns_probes_in_flight(gobj)
{
    let priv = gobj.priv;
    let scan = priv.conns_scan;
    if(!scan) {
        return false;
    }
    for(let key of Object.keys(scan.candidates)) {
        if(key in priv.treedbs && priv.treedbs[key] === undefined) {
            return true;
        }
    }
    return false;
}

/***************************************************************
 *  A treedb probe answered while a scan is in its probe phase: move
 *  on when it was the last one owed.
 ***************************************************************/
function conns_probe_answered(gobj)
{
    let scan = gobj.priv.conns_scan;
    if(!scan || scan.phase !== "probe") {
        return;
    }
    if(conns_probes_in_flight(gobj)) {
        return;
    }
    start_conns_config_phase(gobj);
}

/***************************************************************
 *  Phase two: ask every candidate that DOES hold a treedb where it
 *  listens (`view-config`).
 ***************************************************************/
function start_conns_config_phase(gobj)
{
    let priv = gobj.priv;
    let scan = priv.conns_scan;
    let link = gobj_read_attr(gobj, "link_svc");

    if(!scan || scan.phase !== "probe") {
        return;
    }
    if(scan.timer) {
        window.clearTimeout(scan.timer);
        scan.timer = null;
    }
    scan.phase = "config";

    for(let key of Object.keys(scan.candidates)) {
        if(priv.treedbs[key] !== true) {
            continue;   /*  no treedb: nothing for gui_treedb to browse  */
        }
        scan.rows[key] = {row: scan.candidates[key], endpoint: null, answered: false};
        scan.pending++;
        scan.asked++;
    }

    if(!scan.asked) {
        log_error(`${gobj_short_name(gobj)}: no yuno with a treedb is shown`);
        priv.conns_scan = null;
        conns_busy(gobj, false);
        yui_button_mark_done(priv.$copy_conns, t("nothing to copy"));
        set_timeout(priv.gobj_timer, 1800);
        return;
    }
    if(!link || !agent_link_is_connected(link)) {
        log_error(`${gobj_short_name(gobj)}: no control-center session, cannot scan`);
        priv.conns_scan = null;
        conns_busy(gobj, false);
        return;
    }

    for(let key of Object.keys(scan.rows)) {
        let row = scan.rows[key].row;
        let kw_send = {
            agent_id:  row.node,
            cmd2agent: cmd2agent_service(row.yuno_id, "__yuno__", "view-config")
        };
        msg_iev_write_key(kw_send, "console_purpose", CONNS_PURPOSE);
        msg_iev_write_key(kw_send, "console_node", row.node);
        msg_iev_write_key(kw_send, "console_yuno", row.yuno_id);
        agent_link_command(link, "command-agent", kw_send);
    }

    /*  A yuno that never answers must not hold the scan for ever: build the
     *  document with what did arrive. */
    scan.timer = window.setTimeout(() => {
        scan.timer = null;
        finish_conns_scan(gobj);
    }, CONNS_TIMEOUT_MS);
}

/***************************************************************
 *  Copy the yunos SHOWN as gui_treedb connections.
 *
 *  "Shown" and not "selected", like the Copy JSON button beside it: the
 *  operator filters the tree to what they want and copies that.
 *
 *  The button PROBES what it needs, in two phases. A yuno is only KNOWN
 *  to hold a treedb once its `services` answer has arrived, and that
 *  probe is armed by EXPANDING its node — nowhere else. So the button
 *  answered "no yuno with a treedb is shown" over a full tree of them
 *  whenever nobody had opened a node, and with one node open it copied
 *  that node and said nothing about the rest, which is the worse half:
 *  a partial document that looks complete. Probe every shown yuno whose
 *  treedb state is still unknown, then ask the ones that hold a treedb
 *  where they listen. The round trips are bounded by what is in the
 *  table and they are spent on one deliberate click.
 ***************************************************************/
function ac_copy_conns(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let link = gobj_read_attr(gobj, "link_svc");

    if(priv.conns_scan) {
        return 0;       /*  one scan at a time  */
    }
    if(!link || !agent_link_is_connected(link)) {
        log_error(`${gobj_short_name(gobj)}: no control-center session, cannot scan`);
        return -1;
    }

    let scan = {
        phase:      "probe",
        candidates: {},     /*  key -> row: shown yunos that may hold a treedb  */
        rows:       {},     /*  key -> {row, endpoint, answered}: config phase  */
        pending:    0,
        asked:      0,
        timer:      null
    };
    for(let row of shown_yuno_rows(gobj)) {
        let key = stats_sel_id(row.node, row.yuno_id);
        if(priv.treedbs[key] === false) {
            continue;   /*  asked already: no treedb, nothing for gui_treedb  */
        }
        scan.candidates[key] = row;
    }

    if(!Object.keys(scan.candidates).length) {
        log_error(`${gobj_short_name(gobj)}: no yuno with a treedb is shown`);
        yui_button_mark_done(priv.$copy_conns, t("nothing to copy"));
        set_timeout(priv.gobj_timer, 1800);
        return 0;
    }

    priv.conns_scan = scan;
    conns_busy(gobj, true);

    /*  probe_treedbs() is idempotent per yuno and marks the key in flight,
     *  so a probe already travelling is simply waited for.  */
    for(let key of Object.keys(scan.candidates)) {
        let row = scan.candidates[key];
        probe_treedbs(gobj, row.node, row.yuno_id);
    }

    if(!conns_probes_in_flight(gobj)) {
        start_conns_config_phase(gobj);
        return 0;
    }

    /*  A probe that never answers must not hold the scan for ever either:
     *  go on with the yunos that did answer. */
    scan.timer = window.setTimeout(() => {
        scan.timer = null;
        start_conns_config_phase(gobj);
    }, CONNS_TIMEOUT_MS);

    return 0;
}

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
    /*  Both copy buttons mark themselves done through this one timer; only
     *  one of them can be marked at a time, and unmarking the other is a
     *  no-op. */
    yui_button_unmark(gobj.priv.$copy);
    if(gobj.priv.$copy_conns) {
        yui_button_unmark(gobj.priv.$copy_conns);
    }
    return 0;
}

/***************************************************************
 *  Is anything still folded? That is what the fold button offers to
 *  do, and what its icon has to say.
 ***************************************************************/
function some_folded(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
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
 *
 *  Expanding a node is what arms its treedb probe (Schemas), so
 *  expanding everything asks every node at once — which is the
 *  point of the button, and the same round trips the operator
 *  would spend clicking one expander at a time.
 ***************************************************************/
function ac_toggle_fold(gobj, event, kw, src)
{
    let table = gobj_read_attr(gobj, "tabulator");
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
 *  The yunos the picker is SHOWING that can be opened, and how
 *  many of them already are. "Showing" is what the search left on
 *  screen: with a term typed, the header box is about those.
 ***************************************************************/
function render_header_check(gobj)
{
    let $c = gobj_read_attr(gobj, "$container");
    let $cb = $c ? $c.querySelector(".STATNODES_SEL_HEADER") : null;

    if(!$cb) {
        return;
    }
    /*  Written on the live element, not by rebuilding the columns: a
     *  `titleFormatter` is only run again by `setColumns()`, which
     *  re-renders every row with it — a whole table redrawn to move one
     *  checkbox between its three states.  */
    let counts = shown_selection_counts(gobj);
    $cb.disabled = !counts.total;
    $cb.checked = counts.total > 0 && counts.open === counts.total;
    $cb.indeterminate = counts.open > 0 && counts.open < counts.total;
}

function shown_selection_counts(gobj)
{
    let all = shown_selectable_yunos(gobj);
    return {
        total: all.length,
        open:  all.filter((y) => is_yuno_selected(gobj, y.node, y.yuno_id)).length
    };
}

/***************************************************************
 *  Those yunos, as rows.
 ***************************************************************/
function shown_selectable_yunos(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    let out = [];
    let top = [];

    try {
        top = (table && table._ready) ? (table.getData("active") || []) : [];
    } catch(e) {
        top = [];
    }
    for(let node of top) {
        if(!node || !Array.isArray(node._children)) {
            continue;
        }
        for(let y of node._children) {
            if(y && y._type === "yuno" && !has_no_treedb(gobj, y)) {
                out.push(y);
            }
        }
    }
    return out;
}

/***************************************************************
 *  The header box: open every yuno the picker is showing, or
 *  close them all. One write, like the node's own box.
 ***************************************************************/
function ac_toggle_all_selection(gobj, event, kw, src)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    let all = shown_selectable_yunos(gobj);

    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot open the tabs`);
        return -1;
    }
    if(!all.length) {
        return 0;   /*  the box is disabled in this case  */
    }

    let open = all.filter((y) => is_yuno_selected(gobj, y.node, y.yuno_id)).length;
    let on = open < all.length;
    let list = agent_config_get_selected_nodes(config, ws).slice();

    for(let y of all) {
        let id = stats_sel_id(y.node, y.yuno_id);
        let idx = list.findIndex((n) => n && n.id === id);
        if(on && idx < 0) {
            list.push({id: id, host: y.label});
        } else if(!on && idx >= 0) {
            list.splice(idx, 1);
        }
    }
    agent_config_set_selected_nodes(config, ws, list);
    return 0;
}

/***************************************************************
 *  The node's own checkbox: open the tabs of ALL its yunos, or
 *  close them all.
 *
 *  "All" when some are open too — a half-ticked box reads as "not
 *  everything yet", and one click finishing the job is what it
 *  invites. Only when every one is open does it close them.
 *
 *  ONE write: `agent_config_set_selected_nodes()` takes the whole
 *  list, so a node with a dozen yunos is one config save and one
 *  tab rebuild instead of twelve.
 ***************************************************************/
function ac_toggle_node_selection(gobj, event, kw, src)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let ws = gobj_read_attr(gobj, "workspace");
    let node = (kw && kw.node) || "";
    let all = selectable_yunos(gobj, node);

    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot open the tabs`);
        return -1;
    }
    if(!all.length) {
        /*  The box is disabled in this case; the event can still arrive
         *  from a keyboard path. */
        log_warning(`${gobj_short_name(gobj)}: node '${node}' has nothing to open`);
        return 0;
    }

    let open = all.filter((y) => is_yuno_selected(gobj, y.node, y.yuno_id)).length;
    let on = open < all.length;
    let list = agent_config_get_selected_nodes(config, ws).slice();

    for(let y of all) {
        let id = stats_sel_id(y.node, y.yuno_id);
        let idx = list.findIndex((n) => n && n.id === id);
        if(on && idx < 0) {
            list.push({id: id, host: y.label});
        } else if(!on && idx >= 0) {
            list.splice(idx, 1);
        }
    }
    agent_config_set_selected_nodes(config, ws, list);
    return 0;
}

function ac_selected_nodes_changed(gobj, event, kw, src)
{
    let ws = gobj_read_attr(gobj, "workspace");
    if(kw && kw.workspace && kw.workspace !== ws) {
        return 0;
    }
    refresh_active(gobj);
    return 0;
}

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
 *  Command answer — our list-agents (nodes) and our tagged
 *  list-yunos (a node's children).
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let purpose = msg_iev_read_key(kw, "console_purpose");
    let stk = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let command = kw_get_str(gobj, stk, "command", "", 0);

    /*  Our per-yuno treedb probe (Schemas picker only).  */
    if(purpose === CHECK_PURPOSE) {
        if(command !== "command-agent") {
            let node = msg_iev_read_key(kw, "console_node") || "";
            let yuno_id = msg_iev_read_key(kw, "console_yuno") || "";
            if(node && yuno_id) {
                set_yuno_treedbs(gobj, node, yuno_id, kw.data, kw.result);
            }
        }
        return 0;
    }
    if(purpose === CONNS_PURPOSE) {
        if(command !== "command-agent") {
            let node = msg_iev_read_key(kw, "console_node") || "";
            let yuno_id = msg_iev_read_key(kw, "console_yuno") || "";
            if(node && yuno_id) {
                set_conns_config(gobj, node, yuno_id, kw.data, kw.result);
            }
        }
        return 0;
    }
    if(purpose === MASTER_PURPOSE) {
        if(command !== "command-agent") {
            let node = msg_iev_read_key(kw, "console_node") || "";
            let yuno_id = msg_iev_read_key(kw, "console_yuno") || "";
            if(node && yuno_id) {
                set_treedb_master(gobj, node, yuno_id, kw.data, kw.result);
            }
        }
        return 0;
    }
    /*  Our per-node yunos (tagged "statnodes").  */
    if(purpose === "statnodes") {
        if(command !== "command-agent") {
            let node = msg_iev_read_key(kw, "console_node") || "";
            if(node) {
                set_node_yunos(gobj, node, kw.data);
            }
        }
        return 0;
    }
    /*  Anything else tagged (Console/Stats card) is not ours.  */
    if(purpose) {
        return 0;
    }
    /*  Untagged list-agents = the node list.  */
    if(command !== "list-agents") {
        return 0;
    }
    let nodes = [];
    if(Array.isArray(kw.data)) {
        let min = gobj_read_attr(gobj, "min_version") || "";
        for(let line of kw.data) {
            let n = parse_agent_line(line);
            if(version_gte(n.version, min)) {
                nodes.push(n);
            }
        }
    }
    nodes.sort((a, b) => version_cmp(b.version, a.version));   /*  highest version first  */
    priv.nodes = nodes;
    /*  Keep already-loaded yunos for nodes that are still present.  */
    let present = {};
    nodes.forEach((n) => { present[node_id(n)] = true; });
    Object.keys(priv.yunos).forEach((k) => {
        if(!present[k]) {
            delete priv.yunos[k];
        }
    });
    schedule_render(gobj);
    render_state(gobj);
    /*  Eagerly fetch each node's yunos so the tree shows expandable
     *  sub-rows (a collapsed node with no children has no toggle). One
     *  list-yunos per node — bounded, on-demand (open / Refresh), not
     *  polled. Each answer fills that node's children (schedule_render).  */
    for(let n of nodes) {
        request_yunos(gobj, node_id(n));
    }
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

    /*---------------------------------------------*
     *          States
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null],
            ["EV_ON_OPEN",              ac_on_open,                null],
            ["EV_ON_CLOSE",             ac_on_close,               null],
            ["EV_MT_COMMAND_ANSWER",    ac_mt_command_answer,      null],
            ["EV_SELECTED_NODES_CHANGED", ac_selected_nodes_changed, null],
            ["EV_REFRESH",              ac_refresh,               null],
            ["EV_RENDER_TREE",          ac_render_tree,            null],
            ["EV_COPY_JSON",            ac_copy_json,              null],
            ["EV_COPY_CONNS",           ac_copy_conns,             null],
            ["EV_TOGGLE_FOLD",          ac_toggle_fold,            null],
            ["EV_TOGGLE_NODE_SELECTION", ac_toggle_node_selection, null],
            ["EV_TOGGLE_ALL_SELECTION", ac_toggle_all_selection,   null],
            ["EV_TIMEOUT",              ac_timeout,                null]
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
        ["EV_RENDER_TREE",          0],
        ["EV_COPY_JSON",            0],
        ["EV_COPY_CONNS",           0],
        ["EV_TOGGLE_FOLD",          0],
        ["EV_TOGGLE_NODE_SELECTION", 0],
        ["EV_TOGGLE_ALL_SELECTION", 0],
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

function register_c_stats_nodes()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_stats_nodes};
