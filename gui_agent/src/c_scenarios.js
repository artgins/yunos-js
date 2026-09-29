/***********************************************************************
 *          c_scenarios.js
 *
 *      C_SCENARIOS — the first tab of the Scenarios workspace: the
 *      scenarios the CONTROL CENTER keeps (`scenarios`, SDK 7.25.14+),
 *      one row each. A click on a row makes it the scenario watched:
 *      it is written to C_AGENT_CONFIG (`monitor_scenario`, source
 *      "saved") and the live view (C_AGENT_MONITOR), which follows that
 *      setting, shows it -- the tab moves there.
 *
 *      The list is asked of the control center this console is logged
 *      in to, on its own link (C_AGENT_LINK): no agent is involved, the
 *      scenarios are the control center's. A control center older than
 *      the command answers "command not available", and the tab says
 *      so: the live view still works with the scenario kept in this
 *      browser.
 *
 *      Saving, deleting and running are the live view's: it is where a
 *      scenario is edited and watched. This tab reads the list again
 *      whenever the scenario watched changes (EV_MONITOR_SCENARIO_CHANGED),
 *      which is what a save or a delete there does; whenever it is SHOWN,
 *      so the runs counted are the ones made since, here or by another
 *      operator (a visit is the operator asking -- not a poll); and on
 *      Refresh. A change that lands while a read is in flight is read
 *      again once that one is in, and a row clicked while the list is
 *      being read opens the scenario as the last list had it.
 *
 *      STATES:
 *          ST_IDLE         no session.
 *          ST_LOADING      `scenarios` in flight.
 *          ST_READY        the table.
 *          ST_UNSUPPORTED  the control center does not keep scenarios.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning,
    gobj_parent, gobj_name, gobj_short_name,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event, gobj_unsubscribe_event,
    gobj_send_event,
    gobj_change_state, gobj_current_state,
    gobj_find_service,
    createElement2,
    refresh_language,
    msg_iev_write_key,
    msg_iev_read_key,
} from "@yuneta/gobj-js";

import i18next, {t} from "i18next";

import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {esc} from "./agent_helpers.js";
import {agent_config_get_monitor, agent_config_set_monitor} from "./c_agent_config.js";
import {validate_scenario, cc_lacks_command} from "./monitor_helpers.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_SCENARIOS";

/*  Marker of this tab's requests on the shared link.  */
const PURPOSE = "scenarios_list";

const LIVE_ROUTE = "/scenarios/live";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,        "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "scenarios", "View title (i18n key)"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,        "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,        "Tabulator instance"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,        "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_POINTER,  "config_svc",  0,  null,        "C_AGENT_CONFIG service"),
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
    priv.table_id = `scenarios_table_${gobj_name(gobj)}`;
    priv.docs = {};         /*  scenario id -> the document the control center keeps  */
    priv.rows = [];
    priv.error = "";        /*  the comment of the last failed read  */
    priv.visible = true;    /*  the shell hides a keep_alive tab with is-hidden  */

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
        gobj_subscribe_event(config, "EV_MONITOR_SCENARIO_CHANGED", {}, gobj);
    }

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} SCENARIOS_CARD view-card`,
                 style: "display:flex; flex-direction:column; height:100%;"}, []]
    );
    gobj_write_attr(gobj, "$container", $c);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    build_dom(gobj);
    create_table(gobj);
    render(gobj);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
    watch_visibility(gobj);

    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        request_list(gobj);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    if(priv.vis_obs) {
        priv.vis_obs.disconnect();
        priv.vis_obs = null;
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
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        try {
            table.destroy();
        } catch(e) {
            log_warning(`${gobj_short_name(gobj)}: cannot destroy the table: ${e}`);
        }
        gobj_write_attr(gobj, "tabulator", null);
    }
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

function fmt_time(secs)
{
    if(!secs) {
        return "";
    }
    return new Date(secs * 1000).toLocaleString(i18next.language || undefined);
}

/***************************************************************
 *  The id of the scenario watched when it is one of the control
 *  center's, "" otherwise.
 ***************************************************************/
function watched_id(gobj)
{
    let config = gobj_read_attr(gobj, "config_svc");
    let s = config ? agent_config_get_monitor(config) : null;
    return (s && s.source === "saved" && s.scenario) ? s.scenario.id : "";
}

function build_dom(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    clear_node($c);

    let $input = createElement2(["input", {
        class:        "SCENARIOS_SEARCH input",
        type:         "text",
        placeholder:  t("search scenarios"),
        "data-i18n-placeholder": "search scenarios",
        title:        t("search scenarios"),
        "data-i18n-title": "search scenarios",
        "aria-label": t("search scenarios"),
        "data-i18n-aria-label": "search scenarios"
    }, null, {
        input: () => gobj_send_event(gobj, "EV_SEARCH", {}, gobj)
    }]);
    priv.$input = $input;
    let $search = createElement2(
        ["div", {class: "SCENARIOS_SEARCH_CONTROL control has-icons-left",
                 style: "flex:1 1 12rem; max-width:22rem; min-width:0;"}, [
            $input,
            ["span", {class: "icon is-left"}, [["span", {class: "yi-magnifying-glass"}, ""]]]
        ]]
    );
    attach_clear($search, $input);

    priv.$refresh = createElement2(
        ["button", {class: "SCENARIOS_REFRESH button", type: "button",
                    title: t("refresh"), "data-i18n-title": "refresh",
                    "aria-label": t("refresh"), "data-i18n-aria-label": "refresh"}, [
            ["span", {class: "icon"}, [["span", {class: "yi-arrows-rotate"}, ""]]],
            ["span", {class: "is-hidden-mobile", i18n: "refresh"}, t("refresh")]
        ]]
    );
    priv.$refresh.addEventListener("click", () => gobj_send_event(gobj, "EV_REFRESH", {}, gobj));

    $c.appendChild(createElement2(
        ["div", {class: "SCENARIOS_TOOLBAR is-flex is-align-items-center is-flex-wrap-wrap mb-2",
                 style: "gap:0.5rem;"}, [
            $search,
            ["div", {class: "SCENARIOS_ACTIONS", style: "margin-left:auto;"}, [priv.$refresh]]
        ]]
    ));

    priv.$help = createElement2(
        ["p", {class: "SCENARIOS_HELP is-size-7 has-text-grey mb-2", i18n: "scenarios list help"},
            t("scenarios list help")]
    );
    $c.appendChild(priv.$help);

    priv.$error = createElement2(["p", {class: "SCENARIOS_ERROR has-text-danger mb-2",
                                        style: "display:none; white-space:pre-wrap;"}, ""]);
    $c.appendChild(priv.$error);

    priv.$tablewrap = createElement2(
        ["div", {class: "SCENARIOS_TABLEWRAP", style: "flex:1; min-height:0;"}, [
            ["div", {class: "SCENARIOS_TABLE", id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    priv.$unsupported = createElement2(
        ["div", {class: "SCENARIOS_UNSUPPORTED notification is-warning is-light", style: "display:none;",
                 i18n: "scenarios not kept by this control center"},
            t("scenarios not kept by this control center")]
    );
    $c.appendChild(priv.$unsupported);

    priv.$notif = createElement2(
        ["div", {class: "SCENARIOS_NOTICE notification is-light", style: "display:none;",
                 i18n: "not connected to an agent"}, t("not connected to an agent")]
    );
    $c.appendChild(priv.$notif);

    refresh_language($c, t);
}

function make_columns(gobj)
{
    function id_formatter(cell)
    {
        let r = cell.getData();
        let cls = r.id === watched_id(gobj) ? " has-text-link" : "";
        return `<span class="SCENARIOS_NAME has-text-weight-semibold${cls}">${esc(r.id)}</span>`;
    }
    function time_formatter(cell)
    {
        let r = cell.getData();
        let when = fmt_time(r.updated_at);
        return `<span class="SCENARIOS_UPDATED">${esc(when)}` +
            (r.updated_by ? ` <span class="has-text-grey">${esc(r.updated_by)}</span>` : "") + `</span>`;
    }
    return [
        {title: t("scenario"), field: "id", widthGrow: 2, minWidth: 130, responsive: 0,
            sorter: "alphanum", variableHeight: true, cssClass: "SCENARIOS_CELL_WRAP",
            formatter: id_formatter},
        {title: t("description"), field: "description", widthGrow: 3, minWidth: 140, responsive: 2,
            variableHeight: true, cssClass: "SCENARIOS_CELL_WRAP",
            formatter: (cell) => esc(cell.getValue() || "")},
        {title: t("group"), field: "group", widthGrow: 1, minWidth: 90, responsive: 3,
            formatter: (cell) => esc(cell.getValue() || "")},
        {title: t("yunos"), field: "yunos", width: 90, hozAlign: "right", responsive: 1},
        {title: t("runs"), field: "runs", width: 90, hozAlign: "right", responsive: 4},
        {title: t("updated"), field: "updated_at", widthGrow: 2, minWidth: 150, responsive: 5,
            formatter: time_formatter}
    ];
}

function create_table(gobj)
{
    let priv = gobj.priv;
    let table = new Tabulator(`#${priv.table_id}`, {
        ...yui_tabulator_lang(t),
        index:            "id",
        layout:           "fitColumns",
        responsiveLayout: "hide",
        maxHeight:        "100%",
        placeholder:      t("no scenarios"),
        columnDefaults:   {headerHozAlign: "left", resizable: true},
        columns:          make_columns(gobj),
        initialSort:      [{column: "id", dir: "asc"}]
    });
    table._ready = false;
    table.on("tableBuilt", function() {
        table._ready = true;
        if(table._pendingData !== undefined) {
            table.setData(table._pendingData);
            delete table._pendingData;
        }
    });
    table.on("rowClick", function(e, row) {
        let r = row.getData();
        if(r && r.id) {
            gobj_send_event(gobj, "EV_OPEN_SCENARIO", {scenario_id: r.id}, gobj);
        }
    });
    gobj_write_attr(gobj, "tabulator", table);
}

function set_table_data(gobj)
{
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table) {
        return;
    }
    if(!table._ready) {
        table._pendingData = gobj.priv.rows;
        return;
    }
    table.setData(gobj.priv.rows);
    apply_filter(gobj);
}

function apply_filter(gobj)
{
    let priv = gobj.priv;
    let table = gobj_read_attr(gobj, "tabulator");
    if(!table || !table._ready) {
        return;
    }
    let term = String(priv.$input.value || "").trim().toLowerCase();
    if(term) {
        table.setFilter((d) => [d.id, d.description, d.group]
            .some((v) => String(v || "").toLowerCase().includes(term)));
    } else {
        table.clearFilter();
    }
}

/***************************************************************
 *  A row of the table, from a document of the control center: the
 *  `runs` hook comes counted (`hook_size`).
 ***************************************************************/
function row_of(doc)
{
    let runs = Array.isArray(doc.runs) && doc.runs.length && typeof doc.runs[0].size === "number"
        ? doc.runs[0].size : 0;
    return {
        id:          doc.id,
        description: doc.description || "",
        group:       doc.group || "",
        yunos:       Array.isArray(doc.yunos) ? doc.yunos.length : 0,
        runs:        runs,
        updated_at:  doc.updated_at || doc.created_at || 0,
        updated_by:  doc.updated_by || doc.created_by || ""
    };
}

function render(gobj)
{
    let priv = gobj.priv;
    let st = gobj_current_state(gobj);
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));
    priv.$notif.style.display = connected ? "none" : "";
    priv.$unsupported.style.display = (connected && st === "ST_UNSUPPORTED") ? "" : "none";
    priv.$tablewrap.style.display = (connected && st !== "ST_UNSUPPORTED") ? "" : "none";
    priv.$refresh.disabled = !connected || st === "ST_LOADING";
    priv.$error.textContent = priv.error;
    priv.$error.style.display = priv.error ? "" : "none";
}

/***************************************************************
 *  The shell shows and hides a keep_alive tab by toggling `is-hidden`
 *  on its container. The observer only turns that flip into an event.
 ***************************************************************/
function watch_visibility(gobj)
{
    let priv = gobj.priv;
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c || typeof MutationObserver === "undefined") {
        return;
    }
    priv.vis_obs = new MutationObserver(function() {
        let vis = !$c.classList.contains("is-hidden");
        if(vis !== priv.visible) {
            gobj_send_event(gobj, "EV_VISIBILITY", {visible: vis}, gobj);
        }
    });
    priv.vis_obs.observe($c, {attributes: true, attributeFilter: ["class"]});
}

function request_list(gobj)
{
    let link = gobj_read_attr(gobj, "link_svc");
    if(!link || !agent_link_is_connected(link)) {
        return;
    }
    let kw = {};
    msg_iev_write_key(kw, "console_purpose", PURPOSE);
    gobj_change_state(gobj, "ST_LOADING");
    agent_link_command(link, "scenarios", kw);
    render(gobj);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_on_open(gobj, event, kw, src)
{
    request_list(gobj);
    return 0;
}

function ac_on_close(gobj, event, kw, src)
{
    gobj_change_state(gobj, "ST_IDLE");
    render(gobj);
    return 0;
}

function ac_refresh(gobj, event, kw, src)
{
    request_list(gobj);
    return 0;
}

/***************************************************************
 *  The tab is shown or hidden. Shown, the list is read again: what
 *  it counts may have moved while it was not looked at.
 ***************************************************************/
function ac_visibility(gobj, event, kw, src)
{
    let priv = gobj.priv;
    priv.visible = !!(kw && kw.visible);
    let st = gobj_current_state(gobj);
    if(priv.visible && (st === "ST_READY" || st === "ST_UNSUPPORTED")) {
        request_list(gobj);
    }
    return 0;
}

/***************************************************************
 *  The scenario watched changed: a save or a delete in the live
 *  view, or a scenario opened here. The list is read again.
 ***************************************************************/
function ac_scenario_changed(gobj, event, kw, src)
{
    let st = gobj_current_state(gobj);
    if(st === "ST_READY") {
        request_list(gobj);
    } else if(st === "ST_LOADING") {
        /*  The read in flight may have been answered before the change:
         *  read again once it is in.  */
        gobj.priv.stale = true;
    }
    return 0;
}

/***************************************************************
 *  Our answer of `scenarios`, on the shared link.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(msg_iev_read_key(kw, "console_purpose") !== PURPOSE) {
        return 0;
    }
    if(gobj_current_state(gobj) !== "ST_LOADING") {
        log_warning(`${gobj_short_name(gobj)}: 'scenarios' answered with no read in flight: ignored`);
        return 0;
    }
    if(typeof kw.result === "number" && kw.result < 0) {
        if(cc_lacks_command(kw.comment)) {
            gobj_change_state(gobj, "ST_UNSUPPORTED");
            priv.error = "";
        } else {
            gobj_change_state(gobj, "ST_READY");
            priv.error = kw.comment || t("monitor no answer");
        }
        render(gobj);
        return 0;
    }
    priv.error = "";
    priv.docs = {};
    priv.rows = [];
    for(let doc of (Array.isArray(kw.data) ? kw.data : [])) {
        if(doc && typeof doc.id === "string") {
            priv.docs[doc.id] = doc;
            priv.rows.push(row_of(doc));
        }
    }
    gobj_change_state(gobj, "ST_READY");
    set_table_data(gobj);
    render(gobj);
    if(priv.stale) {
        priv.stale = false;
        request_list(gobj);
    }
    return 0;
}

/***************************************************************
 *  A row: that scenario becomes the one watched, and the tab moves
 *  to the live view.
 ***************************************************************/
function ac_open_scenario(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let doc = priv.docs[kw.scenario_id];
    if(!doc) {
        log_error(`${gobj_short_name(gobj)}: EV_OPEN_SCENARIO of no scenario shown: '${kw.scenario_id}'`);
        return -1;
    }
    let r = validate_scenario(doc);
    if(!r.ok) {
        priv.error = `${doc.id}: ${t(r.error.key)} ${r.error.detail}`;
        render(gobj);
        log_warning(`${gobj_short_name(gobj)}: scenario '${doc.id}' is not valid here: ` +
            `${r.error.key} ${r.error.detail}`);
        return -1;
    }
    let config = gobj_read_attr(gobj, "config_svc");
    if(!config) {
        log_error(`${gobj_short_name(gobj)}: no config service, cannot open the scenario`);
        return -1;
    }
    agent_config_set_monitor(config, {scenario: r.scenario, source: "saved"});
    let shell = yui_shell_of(gobj);
    if(shell) {
        yui_shell_navigate(shell, LIVE_ROUTE);
    }
    return 0;
}

function ac_search(gobj, event, kw, src)
{
    apply_filter(gobj);
    return 0;
}

function ac_language_changed(gobj, event, kw, src)
{
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        refresh_language($c, t);
    }
    let table = gobj_read_attr(gobj, "tabulator");
    if(table) {
        yui_tabulator_relocalize(table, t);
        try {
            table.options.placeholder = t("no scenarios");
            table.setColumns(make_columns(gobj));
        } catch(e) {
            log_error(`${gobj_short_name(gobj)}: cannot re-render the table: ${e}`);
        }
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

    const always = [
        ["EV_MT_COMMAND_ANSWER",        ac_mt_command_answer,   null],
        ["EV_MONITOR_SCENARIO_CHANGED", ac_scenario_changed,    null],
        ["EV_VISIBILITY",               ac_visibility,          null],
        ["EV_SEARCH",                   ac_search,              null],
        ["EV_LANGUAGE_CHANGED",         ac_language_changed,    null]
    ];

    /*---------------------------------------------*
     *          States
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",          ac_on_open,         null],
            ["EV_ON_CLOSE",         ac_on_close,        null]
        ].concat(always)],
        /*  The table stays up while it is read again: a row clicked
         *  meanwhile opens the scenario as the last list had it.  */
        ["ST_LOADING", [
            ["EV_ON_CLOSE",         ac_on_close,        null],
            ["EV_OPEN_SCENARIO",    ac_open_scenario,   null]
        ].concat(always)],
        ["ST_READY", [
            ["EV_ON_CLOSE",         ac_on_close,        null],
            ["EV_REFRESH",          ac_refresh,         null],
            ["EV_OPEN_SCENARIO",    ac_open_scenario,   null]
        ].concat(always)],
        ["ST_UNSUPPORTED", [
            ["EV_ON_CLOSE",         ac_on_close,        null],
            ["EV_REFRESH",          ac_refresh,         null]
        ].concat(always)]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",                  0],
        ["EV_ON_CLOSE",                 0],
        ["EV_MT_COMMAND_ANSWER",        0],
        ["EV_MONITOR_SCENARIO_CHANGED", 0],
        ["EV_LANGUAGE_CHANGED",         0],
        ["EV_REFRESH",                  0],
        ["EV_OPEN_SCENARIO",            0],
        ["EV_SEARCH",                   0],
        ["EV_VISIBILITY",               0]
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

function register_c_scenarios()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_scenarios};
