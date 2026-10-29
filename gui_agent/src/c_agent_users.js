/***********************************************************************
 *          c_agent_users.js
 *
 *      C_AGENT_USERS — the Users workspace tab: the users of ONE yuno of
 *      ONE node, as its C_AUTHZ service keeps them, reached through the
 *      agent over the one control-center session this app already has:
 *          command-agent agent_id=<node>
 *              cmd2agent="command-yuno id=<yuno> service=authz command=users"
 *      (or the agent's own `command-agent service=authz ...` when the
 *      yuno is the agent itself, see cmd2agent_service()).
 *
 *      WHY PER YUNO. Every yuno that authenticates keeps its OWN users:
 *      each node's agent, and each control center -- the two planes of
 *      the company server are two yunos, `controlcenter` 1996 and 1997,
 *      with a store each. So the picker is the tree of nodes and their
 *      yunos, marked by whether a yuno keeps users, and one tab is one
 *      store. Nothing here is specific to the control center.
 *
 *      WHAT IT DOES, and through which command. Everything is a command
 *      of C_AUTHZ, never a raw write of its treedb, because C_AUTHZ does
 *      more than write: `disable-user` and `delete-user` drop the live
 *      sessions of the user, `delete-user` refuses an immutable one.
 *          list            users, roles (+ treedb-info: master or replica)
 *          create          create-user username= [disabled=]
 *          enable/disable  enable-user / disable-user username=
 *          delete          delete-user username= [force=1 when it holds roles]
 *      The one exception is a ROLE: `update-user role=` writes the user
 *      with autolink, which REPLACES every role it holds by that one, so
 *      a role is given or taken one link at a time, on the treedb
 *      (`link-nodes` / `unlink-nodes` of `treedb_authzs`). A user is
 *      created without roles and then linked, for the same reason.
 *
 *      WHO CAN WRITE. Only the MASTER of the store. A yuno whose C_AUTHZ
 *      opened someone else's store is a read-only replica: it refuses
 *      every write, and the tab says so up front (`treedb-info`) and
 *      turns its write controls off. An agent too old to answer the
 *      question leaves the controls on; the yuno refuses if it must.
 *
 *      ROLES. The same tab has a second view, `<base>/roles` (a link, and
 *      what an F5 restores): the roles of the store, what each grants or
 *      denies and for what (its `parameters`, the scope: `scenario_id=x`
 *      lets a permission be used on scenario x only), and its users. A
 *      role is opened in a sheet and edited there: description, realm,
 *      service, its permission, more permissions each with its own scope
 *      if it needs one, disabled. The permissions of the service and the
 *      keys each may be scoped on are read with `authzs` of that service
 *      (C_AUTHZ grants nothing on a key the permission does not declare),
 *      and a role that names one it does not declare is refused before it
 *      is sent. Written on the treedb, as the links are:
 *          create-node / update-node topic_name=roles record={...}
 *          delete-node topic_name=roles record={id}
 *      with every column the sheet edits and nothing else -- the hooks
 *      and the fkey are links. A seed role (immutable) is read-only, and
 *      a role that has users or child roles is not deleted: they are
 *      taken from it first.
 *
 *      Authentication is not here: the identities live in the IdP. What
 *      is written here is who, of those identities, this yuno lets in,
 *      and with which roles.
 *
 *      STATES, each a different screen and a different set of legal
 *      actions:
 *          ST_IDLE      no session.
 *          ST_LOADING   services / users / roles / treedb-info in flight.
 *          ST_READY     the table; the only state that takes an action.
 *          ST_WRITING   a write (one or more commands) in flight; when it
 *                       ends the store is read again.
 *          ST_NO_USERS  the yuno keeps no users store.
 *      Requests go in BATCHES of stages (a stage's commands go together,
 *      the next stage only after every one of them answered), each batch
 *      under one deadline on a C_TIMER child. An answer of a batch that
 *      is over is logged and dropped. A dialog answered when the tab is
 *      no longer READY sends nothing, and says so.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning,
    gobj_parent, gobj_name, gobj_short_name,
    gobj_read_attr, gobj_read_str_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event, gobj_unsubscribe_event,
    gobj_send_event,
    gobj_change_state, gobj_current_state,
    gobj_create_pure_child,
    gobj_find_service,
    set_timeout, clear_timeout,
    createElement2,
    refresh_language,
    escapeHtml,
    msg_iev_write_key,
    msg_iev_read_key,
    msg_iev_get_stack,
    kw_get_str,
} from "@yuneta/gobj-js";

import i18next, {t} from "i18next";

import {fmt_date_time} from "@yuneta/gobj-ui/src/yui_date_text.js";
import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {
    yui_shell_show_modal,
    yui_shell_confirm_yesno,
    yui_shell_confirm_danger,
} from "@yuneta/gobj-ui/src/shell_modals.js";
import {yui_tabulator_lang, yui_tabulator_relocalize} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";
import {attach_clear} from "@yuneta/gobj-ui/src/yui_inputs.js";
import {TabulatorFull as Tabulator} from "tabulator-tables";

import {agent_link_command, agent_link_is_connected} from "./c_agent_link.js";
import {cmd2agent_service, esc} from "./agent_helpers.js";
import {
    AUTHZ_TREEDB,
    authz_service_of,
    user_rows,
    role_rows,
    role_grants,
    format_scope,
    role_problem,
    role_record,
    ROLE_PROBLEM_I18N_KEYS,
    roles_change,
    role_parent_ref,
    user_child_ref,
    username_problem,
} from "./users_helpers.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_USERS";

/*  The names of the fields of a role's sheet: role_input() and
 *  role_check() hand each to t() as a variable, so they are published for
 *  validate-locales.  */
export const USERS_ROLE_FIELD_I18N_KEYS = [
    "role id", "description", "realm", "service", "permission", "deny",
    "role scope", "role disabled", "give own scope", "own scope of the permission"
];

/*  Marker of this tab's requests in __md_iev__: the link re-publishes
 *  every answer to every panel.  */
const PURPOSE = "users";

/*  A batch that is not over in this time is settled as failed: two hops
 *  (control center, node's agent) can lose an answer.  */
const BATCH_TIMEOUT_MS = 30000;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,     "Subscriber of output events"),

SDATA(data_type_t.DTP_STRING,   "title",       0,  "users",  "View title (i18n key)"),
SDATA(data_type_t.DTP_STRING,   "workspace",   0,  "users",  "Owning workspace (selection bucket)"),
SDATA(data_type_t.DTP_STRING,   "node",        0,  "",       "Node id (agent host or uuid)"),
SDATA(data_type_t.DTP_STRING,   "yuno_id",     0,  "",       "Yuno id, or the agent's sentinel"),
SDATA(data_type_t.DTP_STRING,   "yuno_label",  0,  "",       "Yuno label role^name"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,     "Root HTMLElement"),
SDATA(data_type_t.DTP_POINTER,  "tabulator",   0,  null,     "Tabulator instance"),
SDATA(data_type_t.DTP_POINTER,  "link_svc",    0,  null,     "C_AGENT_LINK service"),
SDATA(data_type_t.DTP_STRING,   "base_route",  0,  "",       "This tab's route: `<base>/roles` is its view of the roles"),
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

    priv.gobj_timer = gobj_create_pure_child(gobj_name(gobj), "C_TIMER", {}, gobj);
    priv.table_id = `users_table_${gobj_name(gobj)}`;

    priv.authz = "";        /*  name of the C_AUTHZ service, "" = not discovered  */
    priv.master = null;     /*  true / false / null (not known)  */
    priv.users = [];        /*  user_rows()  */
    priv.roles = [];        /*  role_rows()  */
    priv.loaded = false;    /*  a load has succeeded at least once  */
    priv.batch = null;      /*  the batch in flight, see start_batch()  */
    priv.batch_seq = 0;
    priv.req_seq = 0;
    priv.message = null;    /*  {kind: "ok"|"error"|"info", key?, text?}  */
    priv.sheet = null;      /*  the user sheet open: {username, modal, $roles}  */
    priv.new_dialog = null; /*  the new user dialog open  */
    priv.view = "users";    /*  users | roles: the route's subpath says which  */
    priv.services = [];     /*  the services of the yuno (`services`)  */
    priv.authzs = {};       /*  service -> its `authzs`: permissions and the keys each may be scoped on  */
    priv.role_sheet = null; /*  the role sheet open: {role_id ("" = new), modal, $error}  */
    priv.roles_table_id = `users_roles_table_${gobj_name(gobj)}`;

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

    let $c = createElement2(
        ["div", {class: `${GCLASS_NAME} USERS_CARD view-card`,
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
    create_roles_table(gobj);
    render(gobj);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }

    let link = gobj_read_attr(gobj, "link_svc");
    if(link && agent_link_is_connected(link)) {
        load(gobj);
    }
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    close_dialogs(gobj);
    clear_timeout(priv.gobj_timer);

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        gobj_unsubscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
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
    let roles_table = gobj.priv.roles_table;
    if(roles_table) {
        try {
            roles_table.destroy();
        } catch(e) {
            log_warning(`${gobj_short_name(gobj)}: cannot destroy the roles table: ${e}`);
        }
        gobj.priv.roles_table = null;
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




/*  A date in the language of the app, not of the browser, on a
 *  clock of 24 hours (gobj-ui's fmt_date_time()).  */
function fmt_time(secs)
{
    return fmt_date_time(new Date(secs * 1000), i18next.language);
}

function clear_node($n)
{
    while($n && $n.firstChild) {
        $n.removeChild($n.firstChild);
    }
}

/***************************************************************
 *  A button of this view: icon, a label that hides on a phone when
 *  `label_on_mobile` is false, and its name for the pointer and for a
 *  reader, all by key.
 ***************************************************************/
function button_spec(cls, icon, key, label_on_mobile, extra_cls)
{
    return ["button", {
        class: `${cls} button${extra_cls ? " " + extra_cls : ""}`,
        type: "button",
        title: t(key), "data-i18n-title": key,
        "aria-label": t(key), "data-i18n-aria-label": key
    }, [
        ["span", {class: "icon"}, [["span", {class: icon}, ""]]],
        ["span", {class: label_on_mobile ? "" : "is-hidden-mobile", i18n: key}, t(key)]
    ]];
}

/***************************************************************
 *  Static shell: toolbar, message line, replica banner, the table,
 *  and the two notices (not connected, no users store).
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
        class:        "USERS_SEARCH input",
        type:         "text",
        placeholder:  t("search users"),
        "data-i18n-placeholder": "search users",
        title:        t("search users"),
        "data-i18n-title": "search users",
        "aria-label": t("search users"),
        "data-i18n-aria-label": "search users"
    }, null, {
        input: () => apply_filter(gobj)
    }]);
    priv.$input = $input;

    let $search = createElement2(
        ["div", {class: "USERS_SEARCH_CONTROL control has-icons-left",
                 style: "flex:1 1 12rem; max-width:22rem; min-width:0;"}, [
            $input,
            ["span", {class: "icon is-left"}, [["span", {class: "yi-magnifying-glass"}, ""]]]
        ]]
    );
    attach_clear($search, $input);

    priv.$new = createElement2(button_spec("USERS_NEW", "yi-plus", "new user", true, "is-link"));
    priv.$new.addEventListener("click", () => gobj_send_event(gobj,
        priv.view === "roles" ? "EV_NEW_ROLE" : "EV_NEW_USER", {}, gobj));

    /*  The two views of the store: a pressed button says which is shown  */
    priv.$show_users = createElement2(button_spec("USERS_VIEW_USERS", "yi-user", "users", true));
    priv.$show_users.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_SHOW_VIEW", {view: "users"}, gobj));
    priv.$show_roles = createElement2(button_spec("USERS_VIEW_ROLES", "yi-user-shield", "roles", true));
    priv.$show_roles.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_SHOW_VIEW", {view: "roles"}, gobj));
    let $views = createElement2(["div", {class: "USERS_VIEWS buttons has-addons mb-0"},
        [priv.$show_users, priv.$show_roles]]);

    priv.$refresh = createElement2(button_spec("USERS_REFRESH", "yi-arrows-rotate", "refresh", false));
    priv.$refresh.addEventListener("click", () => gobj_send_event(gobj, "EV_REFRESH", {}, gobj));

    priv.$heading = createElement2(
        ["span", {class: "USERS_HEADING is-family-monospace has-text-weight-semibold"},
            gobj_read_str_attr(gobj, "yuno_label") || gobj_read_str_attr(gobj, "yuno_id")]
    );
    priv.$badge = createElement2(["span", {class: "USERS_MASTER_BADGE"}, ""]);

    priv.$toolbar = createElement2(
        ["div", {class: "USERS_TOOLBAR is-flex is-align-items-center is-flex-wrap-wrap mb-2",
                 style: "gap:0.5rem;"}, [
            ["div", {class: "USERS_TITLE is-flex is-align-items-center",
                     style: "gap:0.5rem; min-width:0;"}, [priv.$heading, priv.$badge]],
            $views,
            $search,
            ["div", {class: "USERS_ACTIONS is-flex is-align-items-center",
                     style: "gap:0.5rem; margin-left:auto;"}, [priv.$new, priv.$refresh]]
        ]]
    );
    $c.appendChild(priv.$toolbar);

    priv.$replica = createElement2(
        ["div", {class: "USERS_READONLY notification is-warning is-light mb-2",
                 style: "display:none;", i18n: "users read only replica"},
            t("users read only replica")]
    );
    $c.appendChild(priv.$replica);

    priv.$message = createElement2(
        ["div", {class: "USERS_MESSAGE mb-2", style: "display:none; white-space:pre-wrap;"}, ""]
    );
    $c.appendChild(priv.$message);

    priv.$tablewrap = createElement2(
        ["div", {class: "USERS_TABLEWRAP", style: "flex:1; min-height:0;"}, [
            ["div", {class: "USERS_TABLE", id: priv.table_id}, []]
        ]]
    );
    $c.appendChild(priv.$tablewrap);

    priv.$roleswrap = createElement2(
        ["div", {class: "USERS_ROLES_TABLEWRAP", style: "flex:1; min-height:0; display:none;"}, [
            ["div", {class: "USERS_ROLES_TABLE", id: priv.roles_table_id}, []]
        ]]
    );
    $c.appendChild(priv.$roleswrap);

    priv.$count = createElement2(["span", {class: "USERS_STATUS_COUNT has-text-weight-medium"}, ""]);
    priv.$state = createElement2(["span", {class: "USERS_STATUS_STATE"}, ""]);
    priv.$status = createElement2(
        ["div", {class: "USERS_STATUS is-size-7 has-text-grey is-flex", style: "gap:0.5rem;"}, [
            ["span", {}, [
                priv.$count,
                priv.$count_label = createElement2(
                    ["span", {class: "USERS_STATUS_LABEL ml-1", i18n: "users"}, t("users")])
            ]],
            priv.$state
        ]]
    );
    $c.appendChild(priv.$status);

    priv.$no_users = createElement2(
        ["div", {class: "USERS_NO_STORE notification", style: "display:none;",
                 i18n: "no users in this yuno"}, t("no users in this yuno")]
    );
    $c.appendChild(priv.$no_users);

    priv.$notif = createElement2(
        ["div", {class: "USERS_NOTICE notification", style: "display:none;",
                 i18n: "not connected to an agent"}, t("not connected to an agent")]
    );
    $c.appendChild(priv.$notif);

    priv.$pick = createElement2(
        ["div", {class: "USERS_PICK notification", style: "display:none;",
                 i18n: "users pick a yuno"}, t("users pick a yuno")]
    );
    $c.appendChild(priv.$pick);

    refresh_language($c, t);
}

/***************************************************************
 *  The table columns. A formatter composes its text at render time,
 *  so a language change re-runs setColumns(make_columns()).
 ***************************************************************/
function make_columns(gobj)
{
    function roles_formatter(cell)
    {
        let roles = cell.getValue() || [];
        if(!roles.length) {
            return `<span class="USERS_NO_ROLES has-text-grey">${esc(t("no roles"))}</span>`;
        }
        return `<span class="USERS_ROLES">${esc(roles.join(", "))}</span>`;
    }

    function status_formatter(cell)
    {
        let r = cell.getData();
        let s = r.disabled
            ? `<span class="USERS_DISABLED has-text-danger">${esc(t("disabled"))}</span>`
            : `<span class="USERS_ENABLED has-text-success">${esc(t("enabled"))}</span>`;
        if(r.immutable) {
            s += ` <span class="USERS_PROTECTED has-text-grey" title="${escapeHtml(t("protected user"))}">` +
                `${esc(t("protected"))}</span>`;
        }
        return s;
    }

    function time_formatter(cell)
    {
        let v = cell.getValue();
        if(!v) {
            return "";
        }
        return `<span class="USERS_TIME">${esc(fmt_time(v))}</span>`;
    }

    return [
        {title: t("user"), field: "id", widthGrow: 3, minWidth: 120, responsive: 0,
            sorter: "alphanum", variableHeight: true, cssClass: "USERS_CELL_WRAP",
            formatter: (cell) =>
                `<span class="USERS_NAME has-text-weight-semibold">${esc(cell.getValue())}</span>`},
        {title: t("status"), field: "disabled", widthGrow: 1, minWidth: 116, responsive: 1,
            variableHeight: true, cssClass: "USERS_CELL_WRAP", formatter: status_formatter},
        {title: t("roles"), field: "roles", widthGrow: 2, minWidth: 110, responsive: 2,
            headerSort: false, variableHeight: true, cssClass: "USERS_CELL_WRAP",
            formatter: roles_formatter},
        {title: t("sessions"), field: "sessions", width: 120, hozAlign: "right", responsive: 3},
        {title: t("created"), field: "time", widthGrow: 1, minWidth: 150, responsive: 4,
            formatter: time_formatter}
    ];
}

/***************************************************************
 *  The table: read-only rows; a click on one opens its sheet.
 ***************************************************************/
function create_table(gobj)
{
    let priv = gobj.priv;
    let table = new Tabulator(`#${priv.table_id}`, {
        ...yui_tabulator_lang(t),
        index:            "id",
        layout:           "fitColumns",
        responsiveLayout: "hide",
        maxHeight:        "100%",
        placeholder:      t("no users"),
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
            gobj_send_event(gobj, "EV_OPEN_USER", {username: r.id}, gobj);
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
    let data = gobj.priv.users;
    if(!table._ready) {
        table._pendingData = data;
        return;
    }
    table.setData(data);
    apply_filter(gobj);
}

function apply_filter(gobj)
{
    let priv = gobj.priv;
    let term = String(priv.$input.value || "").trim().toLowerCase();
    let table = gobj_read_attr(gobj, "tabulator");
    if(table && table._ready) {
        if(term) {
            table.setFilter((data) => {
                return String(data.id).toLowerCase().includes(term) ||
                    data.roles.some((r) => r.toLowerCase().includes(term));
            });
        } else {
            table.clearFilter();
        }
    }
    let roles_table = priv.roles_table;
    if(roles_table && roles_table._ready) {
        if(term) {
            roles_table.setFilter((r) => {
                return [r.id, r.description, r.service].concat(r.users)
                    .concat(role_grants(r).map((g) => g.permission))
                    .some((x) => String(x).toLowerCase().includes(term));
            });
        } else {
            roles_table.clearFilter();
        }
    }
}

/***************************************************************
 *  The roles table: what each role grants and for what, and who
 *  holds it. A click on a row opens its sheet.
 ***************************************************************/
function make_role_columns(gobj)
{
    function grants_formatter(cell)
    {
        let grants = role_grants(cell.getData());
        if(!grants.length) {
            return `<span class="USERS_ROLE_NO_GRANTS has-text-grey">${esc(t("role grants nothing"))}</span>`;
        }
        return grants.map((g) => {
            let scope = format_scope(g.scope);
            return `<div class="USERS_ROLE_GRANT">` +
                (g.deny ? `<span class="USERS_ROLE_GRANT_DENY tag is-danger is-light mr-1">` +
                          `${esc(t("deny"))}</span>` : "") +
                `<span class="USERS_ROLE_GRANT_PERMISSION is-family-monospace">${esc(g.permission)}</span>` +
                (scope ? ` <span class="USERS_ROLE_GRANT_SCOPE has-text-grey is-family-monospace">` +
                         `${esc(t("only"))} ${esc(scope)}</span>` : "") +
                `</div>`;
        }).join("");
    }

    function users_formatter(cell)
    {
        let users = cell.getValue() || [];
        if(!users.length) {
            return `<span class="USERS_ROLE_NO_USERS has-text-grey">${esc(t("nobody"))}</span>`;
        }
        return `<span class="USERS_ROLE_USERS">${esc(users.join(", "))}</span>`;
    }

    function status_formatter(cell)
    {
        let r = cell.getData();
        let s = r.disabled
            ? `<span class="USERS_DISABLED has-text-danger">${esc(t("disabled"))}</span>`
            : `<span class="USERS_ENABLED has-text-success">${esc(t("enabled"))}</span>`;
        if(r.immutable) {
            s += ` <span class="USERS_PROTECTED has-text-grey" title="${escapeHtml(t("protected role"))}">` +
                `${esc(t("protected"))}</span>`;
        }
        return s;
    }

    return [
        {title: t("role"), field: "id", widthGrow: 2, minWidth: 120, responsive: 0,
            sorter: "alphanum", variableHeight: true, cssClass: "USERS_CELL_WRAP",
            formatter: (cell) =>
                `<span class="USERS_ROLE_NAME has-text-weight-semibold">${esc(cell.getValue())}</span>`},
        {title: t("grants"), field: "permission", widthGrow: 4, minWidth: 180, responsive: 0,
            headerSort: false, variableHeight: true, cssClass: "USERS_CELL_WRAP",
            formatter: grants_formatter},
        {title: t("users"), field: "users", widthGrow: 2, minWidth: 110, responsive: 1,
            headerSort: false, variableHeight: true, cssClass: "USERS_CELL_WRAP",
            formatter: users_formatter},
        {title: t("description"), field: "description", widthGrow: 3, minWidth: 140, responsive: 2,
            variableHeight: true, cssClass: "USERS_CELL_WRAP"},
        {title: t("service"), field: "service", widthGrow: 1, minWidth: 100, responsive: 3},
        {title: t("status"), field: "disabled", widthGrow: 1, minWidth: 130, responsive: 4,
            variableHeight: true, cssClass: "USERS_CELL_WRAP", formatter: status_formatter}
    ];
}

function create_roles_table(gobj)
{
    let priv = gobj.priv;
    let table = new Tabulator(`#${priv.roles_table_id}`, {
        ...yui_tabulator_lang(t),
        index:            "id",
        layout:           "fitColumns",
        responsiveLayout: "hide",
        maxHeight:        "100%",
        placeholder:      t("no roles in this store"),
        columnDefaults:   {headerHozAlign: "left", resizable: true},
        columns:          make_role_columns(gobj),
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
            gobj_send_event(gobj, "EV_OPEN_ROLE", {role_id: r.id}, gobj);
        }
    });
    priv.roles_table = table;
}

function set_roles_data(gobj)
{
    let table = gobj.priv.roles_table;
    if(!table) {
        return;
    }
    let data = gobj.priv.roles;
    if(!table._ready) {
        table._pendingData = data;
        return;
    }
    table.setData(data);
    apply_filter(gobj);
}

/***************************************************************
 *  Can this tab write? Not on a replica; and not while it is not
 *  READY (a batch in flight, no session).
 ***************************************************************/
function can_write(gobj)
{
    return gobj.priv.master !== false && gobj_current_state(gobj) === "ST_READY";
}

/***************************************************************
 *  Paint what depends on the state: which blocks show, what the
 *  buttons allow, the badge, the message and the status line.
 ***************************************************************/
function render(gobj)
{
    let priv = gobj.priv;
    if(!priv.$toolbar) {
        return;
    }
    let state = gobj_current_state(gobj);
    let link = gobj_read_attr(gobj, "link_svc");
    let connected = !!(link && agent_link_is_connected(link));
    let no_store = state === "ST_NO_USERS";

    priv.$notif.style.display = connected ? "none" : "";
    let pinned = !!(gobj_read_str_attr(gobj, "node") && gobj_read_str_attr(gobj, "yuno_id"));
    priv.$pick.style.display = (connected && !pinned) ? "" : "none";
    if(!pinned) {
        connected = false;
        priv.$notif.style.display = "none";
    }
    priv.$toolbar.style.display = connected ? "" : "none";
    priv.$no_users.style.display = (connected && no_store) ? "" : "none";
    let roles_view = priv.view === "roles";
    priv.$tablewrap.style.display = (connected && !no_store && !roles_view) ? "" : "none";
    priv.$roleswrap.style.display = (connected && !no_store && roles_view) ? "" : "none";
    priv.$show_users.classList.toggle("is-selected", !roles_view);
    priv.$show_users.classList.toggle("is-link", !roles_view);
    priv.$show_users.setAttribute("aria-pressed", roles_view ? "false" : "true");
    priv.$show_roles.classList.toggle("is-selected", roles_view);
    priv.$show_roles.classList.toggle("is-link", roles_view);
    priv.$show_roles.setAttribute("aria-pressed", roles_view ? "true" : "false");
    let new_key = roles_view ? "new role" : "new user";
    priv.$new.setAttribute("title", t(new_key));
    priv.$new.setAttribute("data-i18n-title", new_key);
    priv.$new.setAttribute("aria-label", t(new_key));
    priv.$new.setAttribute("data-i18n-aria-label", new_key);
    let $new_label = priv.$new.querySelector("span[i18n], span[data-i18n]");
    if($new_label) {
        $new_label.setAttribute("data-i18n", new_key);
        $new_label.textContent = t(new_key);
    }
    let search_key = roles_view ? "search roles" : "search users";
    priv.$input.setAttribute("placeholder", t(search_key));
    priv.$input.setAttribute("data-i18n-placeholder", search_key);
    priv.$input.setAttribute("title", t(search_key));
    priv.$input.setAttribute("data-i18n-title", search_key);
    priv.$input.setAttribute("aria-label", t(search_key));
    priv.$input.setAttribute("data-i18n-aria-label", search_key);
    priv.$status.style.display = (connected && !no_store) ? "" : "none";
    priv.$replica.style.display = (connected && priv.master === false) ? "" : "none";

    priv.$new.disabled = !can_write(gobj);
    priv.$refresh.disabled = !(state === "ST_READY" || state === "ST_NO_USERS");

    clear_node(priv.$badge);
    if(priv.master === true || priv.master === false) {
        let key = priv.master ? "master" : "read only";
        priv.$badge.appendChild(createElement2(
            ["span", {class: `tag ${priv.master ? "is-link" : "is-warning"} is-light`, i18n: key}, t(key)]
        ));
    }

    priv.$count.textContent = `${roles_view ? priv.roles.length : priv.users.length}`;
    let count_key = roles_view ? "roles" : "users";
    priv.$count_label.setAttribute("data-i18n", count_key);
    priv.$count_label.textContent = t(count_key);
    let state_key = "";
    if(state === "ST_LOADING") {
        state_key = "loading";
    } else if(state === "ST_WRITING") {
        state_key = "users writing";
    }
    priv.$state.textContent = state_key ? t(state_key) : "";
    if(state_key) {
        priv.$state.setAttribute("data-i18n", state_key);
    } else {
        priv.$state.removeAttribute("data-i18n");
    }

    render_message(gobj);
}

/***************************************************************
 *  The message line: the answer of the last write, or why a load or
 *  a write failed. A backend comment is DATA (it names the yuno and
 *  the user, in the backend's words) and is shown as it came; only
 *  the view's own sentence carries a key.
 ***************************************************************/
function render_message(gobj)
{
    let priv = gobj.priv;
    let $m = priv.$message;
    clear_node($m);
    let msg = priv.message;
    if(!msg) {
        $m.style.display = "none";
        return;
    }
    let cls = msg.kind === "error" ? "has-text-danger" : (msg.kind === "ok" ? "has-text-success" : "");
    $m.className = `USERS_MESSAGE mb-2 ${cls}`;
    if(msg.key) {
        $m.appendChild(createElement2(["span", {class: "USERS_MESSAGE_KEY", i18n: msg.key}, t(msg.key)]));
    }
    if(msg.text) {
        $m.appendChild(createElement2(
            ["span", {class: "USERS_MESSAGE_TEXT", style: "display:block;"}, msg.text]
        ));
    }
    $m.style.display = "";
}

function close_dialogs(gobj)
{
    let priv = gobj.priv;
    if(priv.sheet && priv.sheet.modal) {
        priv.sheet.modal.close();
    }
    priv.sheet = null;
    if(priv.new_dialog && priv.new_dialog.modal) {
        priv.new_dialog.modal.close();
    }
    priv.new_dialog = null;
    if(priv.role_sheet && priv.role_sheet.modal) {
        priv.role_sheet.modal.close();
    }
    priv.role_sheet = null;
}

/***************************************************************
 *  The checkboxes of the roles a user can hold, one per role of the
 *  store, `held` checked. A <label> WRAPS each control, which names
 *  it; the title and aria-label say the same, as every control does.
 ***************************************************************/
function roles_fieldset(gobj, cls, held, locked)
{
    let priv = gobj.priv;
    let boxes = [];
    for(let r of priv.roles) {
        let $cb = createElement2(["input", {
            class: `${cls}_ROLE_CHECK`, type: "checkbox", value: r.id,
            title: r.id, "aria-label": r.id
        }]);
        $cb.checked = held.indexOf(r.id) >= 0;
        $cb.disabled = !!locked;
        let desc = r.description ? [["span", {class: `${cls}_ROLE_DESC has-text-grey ml-2`}, r.description]] : [];
        boxes.push(
            ["label", {class: `${cls}_ROLE checkbox is-block mb-2`}, [
                $cb,
                ["span", {class: `${cls}_ROLE_ID has-text-weight-semibold ml-2`}, r.id]
            ].concat(desc)]
        );
    }
    if(!boxes.length) {
        boxes.push(["p", {class: `${cls}_NO_ROLES has-text-grey`, i18n: "no roles in this store"},
            t("no roles in this store")]);
    }
    return createElement2(
        ["div", {class: `${cls}_ROLES mb-3`}, [
            ["p", {class: `${cls}_ROLES_TITLE has-text-weight-semibold mb-2`, i18n: "roles"}, t("roles")]
        ].concat(boxes)]
    );
}

function checked_roles($roles)
{
    let ids = [];
    $roles.querySelectorAll("input[type=checkbox]").forEach(($cb) => {
        if($cb.checked) {
            ids.push($cb.value);
        }
    });
    return ids;
}

function find_user(gobj, username)
{
    return gobj.priv.users.find((u) => u.id === username) || null;
}

/***************************************************************
 *  The command line that reaches `service` of the yuno of this tab.
 ***************************************************************/
function line_of(gobj, service, command)
{
    return cmd2agent_service(gobj_read_str_attr(gobj, "yuno_id"), service, command);
}




                    /***************************
                     *      Batches
                     ***************************/




/***************************************************************
 *  Start a batch: `stages` is a list of functions, each answering the
 *  requests of its stage ([{op, line, kw}]) when the stage begins --
 *  so a stage can depend on what the one before it answered. A stage
 *  with no request is skipped.
 ***************************************************************/
function start_batch(gobj, kind, stages, state)
{
    let priv = gobj.priv;
    priv.batch = {
        id:       ++priv.batch_seq,
        kind:     kind,
        stages:   stages,
        stage:    -1,
        pending:  {},
        failures: [],
        comments: []
    };
    gobj_change_state(gobj, state);
    set_timeout(priv.gobj_timer, BATCH_TIMEOUT_MS);
    next_stage(gobj);
}

function next_stage(gobj)
{
    let priv = gobj.priv;
    let b = priv.batch;
    let link = gobj_read_attr(gobj, "link_svc");

    while(++b.stage < b.stages.length) {
        let reqs = b.stages[b.stage](gobj) || [];
        if(!reqs.length) {
            continue;
        }
        if(!link || !agent_link_is_connected(link)) {
            b.failures.push({op: reqs[0].op, text: ""});
            end_batch(gobj);
            return;
        }
        for(let r of reqs) {
            let req = String(++priv.req_seq);
            b.pending[req] = r;
            let kw_send = Object.assign({}, r.kw || {}, {
                agent_id:  gobj_read_str_attr(gobj, "node"),
                cmd2agent: r.line
            });
            msg_iev_write_key(kw_send, "console_purpose", PURPOSE);
            msg_iev_write_key(kw_send, "console_node", gobj_read_str_attr(gobj, "node"));
            msg_iev_write_key(kw_send, "console_yuno", gobj_read_str_attr(gobj, "yuno_id"));
            msg_iev_write_key(kw_send, "users_batch", String(b.id));
            msg_iev_write_key(kw_send, "users_req", req);
            agent_link_command(link, "command-agent", kw_send);
        }
        return;
    }
    end_batch(gobj);
}

/***************************************************************
 *  One answer of the batch in flight. A write that failed ends the
 *  batch there: the stages after it assumed it was done.
 ***************************************************************/
function batch_answer(gobj, req, kw)
{
    let priv = gobj.priv;
    let b = priv.batch;
    let r = b.pending[req];
    if(!r) {
        log_warning(`${gobj_short_name(gobj)}: answer of an unknown request ${req}: ignored`);
        return;
    }
    delete b.pending[req];

    let failed = typeof kw.result === "number" && kw.result < 0;
    if(!failed) {
        take_answer(gobj, r, kw);
    } else if(r.op === "master") {
        /*  An agent older than `treedb-info` cannot say: not known is not
         *  a failure of the read, and leaves the write controls on.  */
        priv.master = null;
    } else if(r.op === "authzs") {
        /*  What the service declares is a help of the role sheet: not
         *  known, the sheet does not check it and the service refuses.  */
        log_warning(`${gobj_short_name(gobj)}: authzs of '${r.service}' not read: ` +
            `${kw.comment || "no comment"}`);
    } else {
        b.failures.push({op: r.op, text: kw.comment || ""});
    }
    if(Object.keys(b.pending).length > 0) {
        return;
    }
    if(b.failures.length && b.kind === "write") {
        end_batch(gobj);
        return;
    }
    next_stage(gobj);
}

/***************************************************************
 *  What a successful answer brings.
 ***************************************************************/
function take_answer(gobj, r, kw)
{
    let priv = gobj.priv;
    switch(r.op) {
        case "services":
            priv.authz = authz_service_of(kw.data);
            priv.services = (Array.isArray(kw.data) ? kw.data : [])
                .map((sv) => sv && sv.service).filter((x) => typeof x === "string" && x);
            break;
        case "authzs":
            priv.authzs[r.service] = Array.isArray(kw.data) ? kw.data : [];
            break;
        case "users":
            priv.users = user_rows(kw.data);
            break;
        case "roles":
            priv.roles = role_rows(kw.data);
            break;
        case "master":
            priv.master = (kw.data && typeof kw.data.master === "boolean") ? kw.data.master : null;
            break;
        default:
            if(kw.comment) {
                priv.batch.comments.push(kw.comment);
            }
            break;
    }
}

/***************************************************************
 *  The batch is over: a load shows what it read, a write says how it
 *  went and reads the store again.
 ***************************************************************/
function end_batch(gobj)
{
    let priv = gobj.priv;
    let b = priv.batch;
    priv.batch = null;
    clear_timeout(priv.gobj_timer);

    if(b.kind === "load") {
        if(b.failures.length) {
            priv.message = {
                kind: "error",
                key:  "users not read",
                text: b.failures.map((f) => f.text).filter((x) => x).join("\n")
            };
            gobj_change_state(gobj, priv.loaded ? "ST_READY" : "ST_NO_USERS");
            if(!priv.loaded) {
                /*  Nothing to show: the notice says the yuno keeps no users,
                 *  and the message says why it could not be read.  */
                priv.authz = "";
            }
            render(gobj);
            return;
        }
        if(!priv.authz) {
            gobj_change_state(gobj, "ST_NO_USERS");
            render(gobj);
            return;
        }
        priv.loaded = true;
        gobj_change_state(gobj, "ST_READY");
        set_table_data(gobj);
        set_roles_data(gobj);
        render(gobj);
        return;
    }

    if(b.failures.length) {
        priv.message = {
            kind: "error",
            key:  "users write failed",
            text: b.comments.concat(b.failures.map((f) => f.text).filter((x) => x)).join("\n")
        };
    } else {
        priv.message = {kind: "ok", text: b.comments.join("\n")};
    }
    load(gobj);
}

/***************************************************************
 *  Read the store: which service keeps the users (asked once), then
 *  the users, the roles and whether this yuno is the master.
 ***************************************************************/
function load(gobj)
{
    let priv = gobj.priv;
    /*  The workspace's home route mounts this view with no yuno: it asks
     *  nothing -- an empty agent_id would reach the FIRST agent of the
     *  control center, not "none".  */
    if(!gobj_read_str_attr(gobj, "node") || !gobj_read_str_attr(gobj, "yuno_id")) {
        render(gobj);
        return;
    }
    let stages = [];
    if(!priv.authz) {
        stages.push((g) => [{op: "services", line: line_of(g, "__yuno__", "services")}]);
    }
    stages.push((g) => {
        if(!g.priv.authz) {
            return [];
        }
        return [
            {op: "users",  line: line_of(g, g.priv.authz, "users")},
            {op: "roles",  line: line_of(g, g.priv.authz, "roles")},
            {op: "master", line: line_of(g, AUTHZ_TREEDB, "treedb-info")}
        ];
    });
    /*  What the services of the roles declare, once per service  */
    stages.push((g) => {
        let wanted = {};
        for(let r of g.priv.roles) {
            if(r.service && g.priv.services.indexOf(r.service) >= 0 && !g.priv.authzs[r.service]) {
                wanted[r.service] = true;
            }
        }
        return Object.keys(wanted).map((svc) => ({op: "authzs", service: svc, line: line_of(g, svc, "authzs")}));
    });
    start_batch(gobj, "load", stages, "ST_LOADING");
    render(gobj);
}

function find_role(gobj, role_id)
{
    return gobj.priv.roles.find((r) => r.id === role_id) || null;
}

/***************************************************************
 *  A role's sheet: its fields, its grants -- the permission, more
 *  permissions each with its own scope if it needs one -- and what
 *  the service declares. `role` null is a new one.
 ***************************************************************/
function role_input(cls, key, value, extra)
{
    let $i = createElement2(["input", Object.assign({
        class: `${cls} input`, type: "text", autocomplete: "off",
        title: t(/* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key),
        "data-i18n-title": /* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key,
        "aria-label": t(/* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key),
        "data-i18n-aria-label": /* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key
    }, extra || {})]);
    $i.value = value || "";
    return $i;
}

function role_check(cls, key, checked)
{
    let $cb = createElement2(["input", {
        class: cls, type: "checkbox",
        title: t(/* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key),
        "data-i18n-title": /* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key,
        "aria-label": t(/* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key),
        "data-i18n-aria-label": /* i18n: USERS_ROLE_FIELD_I18N_KEYS */ key
    }]);
    $cb.checked = !!checked;
    return $cb;
}

/*  A labelled field: the <label> wraps its control, which names it.  */
function role_field(cls, key, $control, help_key)
{
    let parts = [["span", {class: "is-block mb-1 has-text-weight-semibold", i18n: key}, t(key)], $control];
    if(help_key) {
        parts.push(["span", {class: "is-block is-size-7 has-text-grey mt-1", i18n: help_key}, t(help_key)]);
    }
    return createElement2(["label", {class: `${cls} is-block mb-3`}, parts]);
}

/*  One row of "more permissions": permission, deny, its own scope.
 *  "Own scope" ticked: the text is the entry's `parameters` -- empty is
 *  `{}`, unscoped, which is how a scoped role grants a permission that
 *  does not declare the role's key. Not ticked: no `parameters`, the
 *  role's scope applies (c_authz), and the text is off.  */
function role_entry_row(entry, datalist_id, locked)
{
    let own = entry.parameters !== undefined && entry.parameters !== null;
    let $perm = role_input("USERS_ROLE_ENTRY_PERMISSION", "permission", entry.permission,
        {list: datalist_id, placeholder: t("permission"), "data-i18n-placeholder": "permission"});
    let $deny = role_check("USERS_ROLE_ENTRY_DENY", "deny", entry.deny);
    let $own = role_check("USERS_ROLE_ENTRY_OWN", "give own scope", own);
    let $scope = role_input("USERS_ROLE_ENTRY_SCOPE", "own scope of the permission",
        own ? format_scope(entry.parameters) : "",
        {placeholder: t("own scope placeholder"), "data-i18n-placeholder": "own scope placeholder"});
    let $remove = createElement2(button_spec("USERS_ROLE_ENTRY_REMOVE", "yi-xmark", "remove permission", false));
    for(let $x of [$perm, $deny, $own, $remove]) {
        $x.disabled = !!locked;
    }
    $scope.disabled = !!locked || !own;
    let $row = createElement2(
        ["div", {class: "USERS_ROLE_ENTRY is-flex is-flex-wrap-wrap is-align-items-center mb-2",
                 style: "gap:0.5rem;"}, [
            ["div", {style: "flex:2 1 10rem; min-width:0;"}, [$perm]],
            ["label", {class: "USERS_ROLE_ENTRY_DENY_LABEL checkbox"}, [
                $deny, ["span", {class: "ml-1", i18n: "deny"}, t("deny")]
            ]],
            ["label", {class: "USERS_ROLE_ENTRY_OWN_LABEL checkbox"}, [
                $own, ["span", {class: "ml-1", i18n: "own scope"}, t("own scope")]
            ]],
            ["div", {style: "flex:3 1 12rem; min-width:0;"}, [$scope]],
            $remove
        ]]
    );
    /*  Widget plumbing: a row of the form, not an action  */
    $remove.addEventListener("click", () => $row.remove());
    $own.addEventListener("change", () => {
        $scope.disabled = !$own.checked;
    });
    return $row;
}

/*  What the service of the role declares: its permissions and the keys
 *  each may be scoped on -- the help of the grants.  */
function declared_help(gobj, service)
{
    let declared = gobj.priv.authzs[service];
    if(!Array.isArray(declared)) {
        return createElement2(["p", {class: "USERS_ROLE_DECLARED is-size-7 has-text-grey mb-3",
            i18n: "permissions of the service not known"}, t("permissions of the service not known")]);
    }
    let items = declared.map((d) => {
        let keys = (Array.isArray(d.parameters) ? d.parameters : []).map((p) => p && p.id).filter((x) => x);
        return ["li", {class: "USERS_ROLE_DECLARED_ITEM"}, [
            ["span", {class: "is-family-monospace has-text-weight-semibold"}, d.id],
            ["span", {class: "has-text-grey ml-2"}, d.description || ""],
            keys.length
                ? ["span", {class: "USERS_ROLE_DECLARED_KEYS ml-2"}, [
                    ["span", {class: "tag is-info is-light mr-1", i18n: "may be scoped on"}, t("may be scoped on")],
                    ["span", {class: "is-family-monospace"}, keys.join(", ")]
                  ]]
                : ["span", {class: "USERS_ROLE_DECLARED_NOKEYS tag is-light ml-2", i18n: "not scoped"}, t("not scoped")]
        ]];
    });
    return createElement2(["details", {class: "USERS_ROLE_DECLARED is-size-7 mb-3", open: "open"}, [
        ["summary", {class: "has-text-weight-semibold", i18n: "permissions of the service"},
            t("permissions of the service")],
        ["ul", {class: "mt-1"}, items]
    ]]);
}

/*  The form as it is now: what EV_SAVE_ROLE carries (plain data).  */
function read_role_form(sheet)
{
    let f = sheet.fields;
    let entries = [];
    sheet.$entries.querySelectorAll(".USERS_ROLE_ENTRY").forEach(($row) => {
        entries.push({
            permission: $row.querySelector(".USERS_ROLE_ENTRY_PERMISSION").value,
            deny:       $row.querySelector(".USERS_ROLE_ENTRY_DENY").checked,
            own:        $row.querySelector(".USERS_ROLE_ENTRY_OWN").checked,
            scope_text: $row.querySelector(".USERS_ROLE_ENTRY_SCOPE").value
        });
    });
    return {
        id:          f.$id.value,
        description: f.$description.value,
        realm_id:    f.$realm.value,
        service:     f.$service.value,
        permission:  f.$permission.value,
        deny:        f.$deny.checked,
        scope_text:  f.$scope.value,
        disabled:    f.$disabled.checked,
        entries:     entries
    };
}

function show_role_error(gobj, key, detail)
{
    let sheet = gobj.priv.role_sheet;
    if(!sheet) {
        return;
    }
    let $e = sheet.$error;
    clear_node($e);
    $e.appendChild(createElement2(["span", {i18n: /* i18n: ROLE_PROBLEM_I18N_KEYS */ key},
        t(/* i18n: ROLE_PROBLEM_I18N_KEYS */ key)]));
    if(detail) {
        $e.appendChild(createElement2(["span", {class: "is-family-monospace ml-2"}, detail]));
    }
    $e.style.display = "";
}

/***************************************************************
 *  The requests that link (or unlink) roles to a user.
 ***************************************************************/
function role_link_requests(gobj, username, ids, command)
{
    return ids.map((id) => ({
        op:   command,
        line: line_of(gobj, AUTHZ_TREEDB, command),
        kw:   {parent_ref: role_parent_ref(id), child_ref: user_child_ref(username)}
    }));
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_on_open(gobj, event, kw, src)
{
    load(gobj);
    return 0;
}

/***************************************************************
 *  The session dropped: whatever was in flight died with it, and an
 *  open dialog has nothing to write to any more.
 ***************************************************************/
function ac_on_close(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(priv.batch) {
        log_warning(`${gobj_short_name(gobj)}: the session dropped with a ` +
            `${priv.batch.kind} in flight`);
        if(priv.batch.kind === "write") {
            priv.message = {kind: "error", key: "users write not answered"};
        }
        priv.batch = null;
    }
    clear_timeout(priv.gobj_timer);
    close_dialogs(gobj);
    gobj_change_state(gobj, "ST_IDLE");
    render(gobj);
    return 0;
}

/***************************************************************
 *  The link re-publishes every answer of the session to every panel;
 *  ours carry our purpose, node, yuno and batch.
 *
 *  Each request has TWO answers: the control center's dispatch ack
 *  (its stack frame is `command-agent`) and the yuno's. The ack is
 *  dropped on success -- the real answer is coming -- and taken as
 *  the answer on failure, the only news there will be.
 ***************************************************************/
function ac_mt_command_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(msg_iev_read_key(kw, "console_purpose") !== PURPOSE ||
       msg_iev_read_key(kw, "console_node") !== gobj_read_str_attr(gobj, "node") ||
       msg_iev_read_key(kw, "console_yuno") !== gobj_read_str_attr(gobj, "yuno_id")) {
        return 0;
    }
    let stack = msg_iev_get_stack(gobj, kw, "command_stack", false);
    let outer = kw_get_str(gobj, stack, "command", "", 0);
    let failed = typeof kw.result === "number" && kw.result < 0;
    if(outer === "command-agent" && !failed) {
        return 0;
    }

    let batch_id = msg_iev_read_key(kw, "users_batch");
    if(!priv.batch || String(priv.batch.id) !== String(batch_id)) {
        log_warning(`${gobj_short_name(gobj)}: answer of a batch that is over ` +
            `(result ${kw.result}${kw.comment ? ", " + kw.comment : ""}): ignored`);
        return 0;
    }
    batch_answer(gobj, String(msg_iev_read_key(kw, "users_req")), kw);
    return 0;
}

/***************************************************************
 *  The deadline of the batch passed.
 ***************************************************************/
function ac_timeout(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let b = priv.batch;
    if(!b) {
        return 0;
    }
    log_error(`${gobj_short_name(gobj)}: ${b.kind} of the users of ` +
        `'${gobj_read_str_attr(gobj, "yuno_id")}' not answered by node ` +
        `'${gobj_read_str_attr(gobj, "node")}' in ${BATCH_TIMEOUT_MS / 1000} s`);
    for(let req of Object.keys(b.pending)) {
        b.failures.push({op: b.pending[req].op, text: ""});
    }
    b.pending = {};
    if(b.kind === "write") {
        b.failures.push({op: "", text: t("users write not answered")});
    }
    end_batch(gobj);
    return 0;
}

function ac_refresh(gobj, event, kw, src)
{
    gobj.priv.message = null;
    load(gobj);
    return 0;
}

/***************************************************************
 *  Open the sheet of one user: its roles, and what can be done to it.
 ***************************************************************/
function ac_open_user(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let user = find_user(gobj, kw.username);
    let shell = yui_shell_of(gobj);
    if(!user || !shell) {
        log_error(`${gobj_short_name(gobj)}: EV_OPEN_USER of no user shown: '${kw.username}'`);
        return -1;
    }
    close_dialogs(gobj);

    let writable = can_write(gobj);
    let $roles = roles_fieldset(gobj, "USERS_SHEET", user.roles, !writable || user.immutable);

    let facts = [
        ["p", {class: "USERS_SHEET_STATE mb-1"}, [
            ["span", {class: "has-text-weight-semibold mr-2", i18n: "status"}, t("status")],
            ["span", {class: user.disabled ? "has-text-danger" : "has-text-success",
                      i18n: user.disabled ? "disabled" : "enabled"},
                t(user.disabled ? "disabled" : "enabled")]
        ]],
        ["p", {class: "USERS_SHEET_SESSIONS mb-1"}, [
            ["span", {class: "has-text-weight-semibold mr-2", i18n: "sessions"}, t("sessions")],
            ["span", {}, `${user.sessions}`]
        ]]
    ];
    if(user.time) {
        facts.push(["p", {class: "USERS_SHEET_CREATED mb-1"}, [
            ["span", {class: "has-text-weight-semibold mr-2", i18n: "created"}, t("created")],
            ["span", {}, fmt_time(user.time)]
        ]]);
    }
    if(user.immutable) {
        facts.push(["p", {class: "USERS_SHEET_PROTECTED has-text-grey mt-2", i18n: "protected user"},
            t("protected user")]);
    }

    let $delete = createElement2(button_spec("USERS_SHEET_DELETE", "yi-trash", "delete user", true,
        "is-danger is-outlined"));
    $delete.disabled = !writable || user.immutable;
    $delete.style.marginRight = "auto";
    $delete.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_DELETE_USER", {username: user.id}, gobj));

    let toggle_key = user.disabled ? "enable user" : "disable user";
    let $toggle = createElement2(button_spec("USERS_SHEET_TOGGLE",
        user.disabled ? "yi-user-check" : "yi-user-slash", toggle_key, true));
    $toggle.disabled = !writable;
    $toggle.addEventListener("click", () =>
        gobj_send_event(gobj, user.disabled ? "EV_ENABLE_USER" : "EV_DISABLE_USER",
            {username: user.id}, gobj));

    let $save = createElement2(button_spec("USERS_SHEET_SAVE", "yi-floppy-disk", "save roles", true,
        "is-link"));
    $save.disabled = true;
    $save.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_SET_ROLES", {username: user.id, roles: checked_roles($roles)}, gobj));
    /*  Save lights up only when the checked roles differ from the held
     *  ones: widget plumbing, the write itself is an event.  */
    $roles.addEventListener("change", () => {
        let c = roles_change(user.roles, checked_roles($roles));
        $save.disabled = !writable || (c.add.length + c.remove.length) === 0;
    });

    let $content = createElement2(
        ["div", {class: "USERS_SHEET box"}, [
            ["div", {class: "USERS_SHEET_FACTS mb-3"}, facts],
            $roles,
            /*  Delete apart on the left, the principal action last on the
             *  right; on a phone the line wraps and the right pair stays
             *  right.  */
            ["div", {class: "USERS_SHEET_FOOT is-flex is-flex-wrap-wrap is-align-items-center " +
                            "is-justify-content-flex-end", style: "gap:0.5rem;"}, [
                $delete,
                $toggle,
                $save
            ]]
        ]]
    );

    let sheet = {username: user.id, modal: null};
    sheet.modal = yui_shell_show_modal(shell, $content, {
        dialog:        true,
        logical_class: "USERS_SHEET_DIALOG",
        title:         "user",
        title_prefix:  user.id,
        t:             t,
        on_close:      function() {
            if(priv.sheet === sheet) {
                priv.sheet = null;
            }
        }
    });
    priv.sheet = sheet;
    return 0;
}

/***************************************************************
 *  Open the new user dialog.
 ***************************************************************/
function ac_new_user(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let shell = yui_shell_of(gobj);
    if(!shell) {
        log_error(`${gobj_short_name(gobj)}: no shell to open the new user dialog`);
        return -1;
    }
    close_dialogs(gobj);

    let $name = createElement2(["input", {
        class: "USERS_NEW_USERNAME input", type: "text", autocomplete: "off",
        placeholder: "name@example.com",
        title: t("username"), "data-i18n-title": "username",
        "aria-label": t("username"), "data-i18n-aria-label": "username"
    }]);
    let $disabled = createElement2(["input", {
        class: "USERS_NEW_DISABLED_CHECK", type: "checkbox",
        title: t("create it disabled"), "data-i18n-title": "create it disabled",
        "aria-label": t("create it disabled"), "data-i18n-aria-label": "create it disabled"
    }]);
    let $roles = roles_fieldset(gobj, "USERS_NEW", [], false);
    let $error = createElement2(["p", {class: "USERS_NEW_ERROR has-text-danger mb-2",
                                       style: "display:none;"}, ""]);

    let $cancel = createElement2(button_spec("USERS_NEW_CANCEL", "yi-xmark", "cancel", true));
    $cancel.addEventListener("click", () => gobj_send_event(gobj, "EV_CANCEL_DIALOG", {}, gobj));
    let $create = createElement2(button_spec("USERS_NEW_CREATE", "yi-plus", "create user", true, "is-link"));
    $create.addEventListener("click", () => gobj_send_event(gobj, "EV_CREATE_USER", {
        username: $name.value,
        roles:    checked_roles($roles),
        disabled: $disabled.checked
    }, gobj));

    let $content = createElement2(
        ["div", {class: "USERS_NEW box"}, [
            ["label", {class: "USERS_NEW_NAME_FIELD label is-block mb-3"}, [
                ["span", {class: "is-block mb-1", i18n: "username"}, t("username")],
                $name
            ]],
            $roles,
            ["label", {class: "USERS_NEW_DISABLED checkbox is-block mb-3"}, [
                $disabled,
                ["span", {class: "ml-2", i18n: "create it disabled"}, t("create it disabled")]
            ]],
            $error,
            ["div", {class: "USERS_NEW_FOOT is-flex is-justify-content-flex-end",
                     style: "gap:0.5rem;"}, [$cancel, $create]]
        ]]
    );

    let dialog = {modal: null, $error: $error};
    dialog.modal = yui_shell_show_modal(shell, $content, {
        dialog:        true,
        logical_class: "USERS_NEW_DIALOG",
        title:         "new user",
        title_prefix:  gobj_read_str_attr(gobj, "yuno_label") || gobj_read_str_attr(gobj, "yuno_id"),
        t:             t,
        on_close:      function() {
            if(priv.new_dialog === dialog) {
                priv.new_dialog = null;
            }
        }
    });
    priv.new_dialog = dialog;
    $name.focus();
    return 0;
}

function ac_cancel_dialog(gobj, event, kw, src)
{
    close_dialogs(gobj);
    return 0;
}

/***************************************************************
 *  Create a user: without roles, then one link per role (see the
 *  header: a role given at creation would be the only one).
 ***************************************************************/
function ac_create_user(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let username = String(kw.username || "").trim();
    let problem = username_problem(username);
    if(!problem && find_user(gobj, username)) {
        problem = "user already exists";
    }
    if(problem) {
        if(priv.new_dialog) {
            priv.new_dialog.$error.textContent = t(problem);
            priv.new_dialog.$error.setAttribute("data-i18n", problem);
            priv.new_dialog.$error.style.display = "";
        }
        return 0;
    }
    close_dialogs(gobj);

    let roles = Array.isArray(kw.roles) ? kw.roles : [];
    let create = {
        op:   "create-user",
        line: line_of(gobj, priv.authz, "create-user"),
        kw:   {username: username, disabled: !!kw.disabled}
    };
    start_batch(gobj, "write", [
        () => [create],
        (g) => role_link_requests(g, username, roles, "link-nodes")
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  Give and take roles, one link each.
 ***************************************************************/
function ac_set_roles(gobj, event, kw, src)
{
    let user = find_user(gobj, kw.username);
    if(!user) {
        log_error(`${gobj_short_name(gobj)}: EV_SET_ROLES of no user shown: '${kw.username}'`);
        return -1;
    }
    close_dialogs(gobj);
    let c = roles_change(user.roles, kw.roles);
    start_batch(gobj, "write", [
        (g) => role_link_requests(g, user.id, c.remove, "unlink-nodes")
            .concat(role_link_requests(g, user.id, c.add, "link-nodes"))
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

function ac_enable_user(gobj, event, kw, src)
{
    let priv = gobj.priv;
    close_dialogs(gobj);
    start_batch(gobj, "write", [
        (g) => [{op: "enable-user", line: line_of(g, priv.authz, "enable-user"),
                 kw: {username: kw.username}}]
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  Disabling drops the user's sessions: asked first. The answer of
 *  the dialog is an OS notification and only becomes an event.
 ***************************************************************/
function ac_disable_user(gobj, event, kw, src)
{
    let user = find_user(gobj, kw.username);
    let shell = yui_shell_of(gobj);
    if(!user || !shell) {
        log_error(`${gobj_short_name(gobj)}: EV_DISABLE_USER of no user shown: '${kw.username}'`);
        return -1;
    }
    close_dialogs(gobj);
    let $msg = createElement2(
        ["div", {class: "USERS_CONFIRM_DISABLE"}, [
            ["p", {i18n: "confirm disable user"}, t("confirm disable user")],
            ["p", {class: "has-text-weight-semibold mt-2"}, user.id],
            ["p", {class: "is-size-7 mt-2", i18n: "its sessions are dropped"}, t("its sessions are dropped")]
        ]]
    );
    yui_shell_confirm_yesno(shell, $msg, {
        t: t, logical_class: "USERS_CONFIRM_DISABLE_DIALOG",
        yes_label: "disable user", no_label: "cancel"
    }).then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_DISABLE_CONFIRMED", {username: user.id}, gobj);
        }
    });
    return 0;
}

function ac_disable_confirmed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    start_batch(gobj, "write", [
        (g) => [{op: "disable-user", line: line_of(g, priv.authz, "disable-user"),
                 kw: {username: kw.username}}]
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  Deleting is final: asked in red, naming the roles it unlinks.
 ***************************************************************/
function ac_delete_user(gobj, event, kw, src)
{
    let user = find_user(gobj, kw.username);
    let shell = yui_shell_of(gobj);
    if(!user || !shell) {
        log_error(`${gobj_short_name(gobj)}: EV_DELETE_USER of no user shown: '${kw.username}'`);
        return -1;
    }
    close_dialogs(gobj);
    let parts = [
        ["p", {i18n: "confirm delete user"}, t("confirm delete user")],
        ["p", {class: "has-text-weight-semibold mt-2"}, user.id],
        ["p", {class: "is-size-7 mt-2", i18n: "its sessions are dropped"}, t("its sessions are dropped")]
    ];
    if(user.roles.length) {
        parts.push(["p", {class: "is-size-7 mt-2"}, [
            ["span", {class: "mr-1", i18n: "its roles are unlinked"}, t("its roles are unlinked")],
            ["span", {class: "has-text-weight-semibold"}, user.roles.join(", ")]
        ]]);
    }
    yui_shell_confirm_danger(shell, createElement2(["div", {class: "USERS_CONFIRM_DELETE"}, parts]), {
        t: t, logical_class: "USERS_CONFIRM_DELETE_DIALOG",
        confirm_label: "delete user", cancel_label: "cancel"
    }).then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_DELETE_CONFIRMED",
                {username: user.id, force: user.roles.length > 0}, gobj);
        }
    });
    return 0;
}

function ac_delete_confirmed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let args = {username: kw.username};
    if(kw.force) {
        args.force = true;
    }
    start_batch(gobj, "write", [
        (g) => [{op: "delete-user", line: line_of(g, priv.authz, "delete-user"), kw: args}]
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  Users or roles: a POSITION, so it is the route (`<base>/roles`).
 *  The buttons move the route; the route moves the view.
 ***************************************************************/
function ac_show_view(gobj, event, kw, src)
{
    let view = kw && kw.view === "roles" ? "roles" : "users";
    let base = gobj_read_str_attr(gobj, "base_route");
    let shell = yui_shell_of(gobj);
    if(base && shell) {
        yui_shell_navigate(shell, view === "roles" ? `${base}/roles` : base, {push: true});
        return 0;
    }
    /*  A tab with no route of its own: the view is all there is  */
    return apply_view(gobj, view);
}

function ac_route_changed(gobj, event, kw, src)
{
    let base = gobj_read_str_attr(gobj, "base_route");
    if(!base || !kw || kw.base !== base) {
        return 0;   /*  not this tab  */
    }
    let seg = String(kw.subpath || "").split("/")[0];
    return apply_view(gobj, seg === "roles" ? "roles" : "users");
}

function apply_view(gobj, view)
{
    let priv = gobj.priv;
    if(priv.view === view) {
        return 0;
    }
    priv.view = view;
    render(gobj);
    apply_filter(gobj);
    /*  A table drawn while hidden has no width: redraw the one shown  */
    let table = view === "roles" ? priv.roles_table : gobj_read_attr(gobj, "tabulator");
    if(table && table._ready) {
        table.redraw(true);
    }
    return 0;
}

/***************************************************************
 *  The sheet of a role, or of a new one (`role_id` absent).
 ***************************************************************/
function ac_open_role(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let is_new = event === "EV_NEW_ROLE";
    let role = is_new ? null : find_role(gobj, kw && kw.role_id);
    let shell = yui_shell_of(gobj);
    if((!is_new && !role) || !shell) {
        log_error(`${gobj_short_name(gobj)}: ${event} of no role shown: '${kw && kw.role_id}'`);
        return -1;
    }
    close_dialogs(gobj);

    let r = role || {id: "", description: "", realm_id: gobj_yuno_realm_guess(gobj), service: "",
                     permission: "", deny: false, permissions: [], parameters: {}, disabled: false,
                     users: [], children: [], immutable: false};
    let locked = !can_write(gobj) || r.immutable;
    let datalist_id = `users_role_perms_${gobj_name(gobj)}`;
    let declared = priv.authzs[r.service];
    let $datalist = createElement2(["datalist", {id: datalist_id},
        (Array.isArray(declared) ? declared : []).map((d) => ["option", {value: d.id}, ""])]);

    let fields = {
        $id:          role_input("USERS_ROLE_ID_INPUT", "role id", r.id),
        $description: role_input("USERS_ROLE_DESCRIPTION", "description", r.description),
        $realm:       role_input("USERS_ROLE_REALM", "realm", r.realm_id),
        $service:     role_input("USERS_ROLE_SERVICE", "service", r.service, {list: `${datalist_id}_svc`}),
        $permission:  role_input("USERS_ROLE_PERMISSION", "permission", r.permission, {list: datalist_id}),
        $deny:        role_check("USERS_ROLE_DENY", "deny", r.deny),
        $scope:       role_input("USERS_ROLE_SCOPE", "role scope", format_scope(r.parameters),
                                 {placeholder: t("role scope placeholder"),
                                  "data-i18n-placeholder": "role scope placeholder"}),
        $disabled:    role_check("USERS_ROLE_DISABLED", "role disabled", r.disabled)
    };
    fields.$id.disabled = !is_new;
    for(let k of Object.keys(fields)) {
        if(k !== "$id") {
            fields[k].disabled = locked;
        }
    }
    let $svc_list = createElement2(["datalist", {id: `${datalist_id}_svc`},
        priv.services.map((svc) => ["option", {value: svc}, ""])]);

    let $entries = createElement2(["div", {class: "USERS_ROLE_ENTRIES"}, []]);
    for(let e of r.permissions) {
        $entries.appendChild(role_entry_row(e, datalist_id, locked));
    }
    let $add = createElement2(button_spec("USERS_ROLE_ADD_ENTRY", "yi-plus", "add permission", true));
    $add.disabled = locked;
    /*  Widget plumbing: a row of the form, not an action  */
    $add.addEventListener("click", () =>
        $entries.appendChild(role_entry_row({permission: "", deny: false}, datalist_id, false)));

    let $error = createElement2(["p", {class: "USERS_ROLE_ERROR has-text-danger mb-2",
                                       style: "display:none;"}, ""]);

    let facts = [];
    if(!is_new) {
        facts.push(["p", {class: "USERS_ROLE_HOLDERS mb-2"}, [
            ["span", {class: "has-text-weight-semibold mr-2", i18n: "users"}, t("users")],
            r.users.length
                ? ["span", {}, r.users.join(", ")]
                : ["span", {class: "has-text-grey", i18n: "nobody"}, t("nobody")]
        ]]);
    }
    if(r.immutable) {
        facts.push(["p", {class: "USERS_ROLE_PROTECTED has-text-grey mb-2", i18n: "protected role"},
            t("protected role")]);
    }

    let $delete = createElement2(button_spec("USERS_ROLE_DELETE", "yi-trash", "delete role", true,
        "is-danger is-outlined"));
    let in_use = r.users.length > 0 || r.children.length > 0;
    $delete.disabled = is_new || locked || in_use;
    if(in_use && !is_new) {
        /*  Why it cannot be deleted, where the eye lands  */
        $delete.setAttribute("title", t("role in use"));
        $delete.setAttribute("data-i18n-title", "role in use");
    }
    $delete.style.marginRight = "auto";
    if(is_new) {
        $delete.style.display = "none";
    }
    $delete.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_DELETE_ROLE", {role_id: r.id}, gobj));

    let save_key = is_new ? "create role" : "save role";
    let $save = createElement2(button_spec("USERS_ROLE_SAVE", is_new ? "yi-plus" : "yi-floppy-disk",
        save_key, true, "is-link"));
    $save.disabled = locked;

    let $content = createElement2(
        ["div", {class: "USERS_ROLE_SHEET box"}, [
            ["div", {class: "USERS_ROLE_FACTS"}, facts],
            role_field("USERS_ROLE_ID_FIELD", "role id", fields.$id),
            role_field("USERS_ROLE_DESCRIPTION_FIELD", "description", fields.$description),
            ["div", {class: "USERS_ROLE_WHERE is-flex is-flex-wrap-wrap", style: "gap:0 1rem;"}, [
                ["div", {style: "flex:1 1 12rem; min-width:0;"},
                    [role_field("USERS_ROLE_SERVICE_FIELD", "service", fields.$service, "role service help")]],
                ["div", {style: "flex:1 1 12rem; min-width:0;"},
                    [role_field("USERS_ROLE_REALM_FIELD", "realm", fields.$realm, "role realm help")]]
            ]],
            declared_help(gobj, r.service),
            ["div", {class: "USERS_ROLE_MAIN is-flex is-flex-wrap-wrap is-align-items-flex-end mb-1",
                     style: "gap:0 1rem;"}, [
                ["div", {style: "flex:2 1 12rem; min-width:0;"},
                    [role_field("USERS_ROLE_PERMISSION_FIELD", "permission", fields.$permission)]],
                ["label", {class: "USERS_ROLE_DENY_LABEL checkbox mb-3"}, [
                    fields.$deny, ["span", {class: "ml-1", i18n: "deny"}, t("deny")]
                ]]
            ]],
            role_field("USERS_ROLE_SCOPE_FIELD", "role scope", fields.$scope, "role scope help"),
            ["p", {class: "USERS_ROLE_ENTRIES_TITLE has-text-weight-semibold mb-1", i18n: "more permissions"},
                t("more permissions")],
            ["p", {class: "is-size-7 has-text-grey mb-2", i18n: "more permissions help"},
                t("more permissions help")],
            $entries,
            ["div", {class: "mb-3"}, [$add]],
            ["label", {class: "USERS_ROLE_DISABLED_LABEL checkbox is-block mb-3"}, [
                fields.$disabled, ["span", {class: "ml-2", i18n: "role disabled"}, t("role disabled")]
            ]],
            $error,
            $datalist,
            $svc_list,
            ["div", {class: "USERS_ROLE_FOOT is-flex is-flex-wrap-wrap is-align-items-center " +
                            "is-justify-content-flex-end", style: "gap:0.5rem;"}, [$delete, $save]]
        ]]
    );

    let sheet = {role_id: r.id, is_new: is_new, modal: null, $error: $error,
                 fields: fields, $entries: $entries};
    $save.addEventListener("click", () =>
        gobj_send_event(gobj, "EV_SAVE_ROLE", {is_new: is_new, form: read_role_form(sheet)}, gobj));
    sheet.modal = yui_shell_show_modal(shell, $content, {
        dialog:        true,
        wide:          true,
        logical_class: "USERS_ROLE_DIALOG",
        title:         is_new ? "new role" : "role",
        title_prefix:  is_new ? (gobj_read_str_attr(gobj, "yuno_label") || "") : r.id,
        t:             t,
        on_close:      function() {
            if(priv.role_sheet === sheet) {
                priv.role_sheet = null;
            }
        }
    });
    priv.role_sheet = sheet;
    if(is_new) {
        fields.$id.focus();
    }
    return 0;
}

/*  A new role starts in the realm the other roles of the store use.  */
function gobj_yuno_realm_guess(gobj)
{
    let realms = gobj.priv.roles.map((r) => r.realm_id).filter((x) => x && x !== "*");
    return realms[0] || "*";
}

/***************************************************************
 *  Write the role of the sheet: checked here first against what the
 *  service declares (a scope on a key it does not declare grants
 *  nothing), then created or updated with every column it edits.
 ***************************************************************/
function ac_save_role(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let form = kw && kw.form;
    if(!form) {
        log_error(`${gobj_short_name(gobj)}: EV_SAVE_ROLE without a form`);
        return -1;
    }
    let problem = role_problem(form, priv.authzs[(form.service || "").trim()] || null);
    if(!problem && kw.is_new && find_role(gobj, (form.id || "").trim())) {
        problem = {key: "role already exists", detail: form.id};
    }
    if(problem) {
        show_role_error(gobj, problem.key, problem.detail);
        return 0;
    }
    close_dialogs(gobj);
    let record = role_record(form);
    let command = kw.is_new ? "create-node" : "update-node";
    start_batch(gobj, "write", [
        (g) => [{op: command, line: line_of(g, AUTHZ_TREEDB, command),
                 kw: {topic_name: "roles", record: record}}]
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  Deleting a role is final: asked in red. One with users or child
 *  roles is not offered (the sheet's button is off).
 ***************************************************************/
function ac_delete_role(gobj, event, kw, src)
{
    let role = find_role(gobj, kw && kw.role_id);
    let shell = yui_shell_of(gobj);
    if(!role || !shell) {
        log_error(`${gobj_short_name(gobj)}: EV_DELETE_ROLE of no role shown: '${kw && kw.role_id}'`);
        return -1;
    }
    if(role.users.length || role.children.length || role.immutable) {
        log_error(`${gobj_short_name(gobj)}: EV_DELETE_ROLE of a role in use or protected: '${role.id}'`);
        return -1;
    }
    close_dialogs(gobj);
    let $msg = createElement2(["div", {class: "USERS_CONFIRM_DELETE_ROLE"}, [
        ["p", {i18n: "confirm delete role"}, t("confirm delete role")],
        ["p", {class: "has-text-weight-semibold mt-2"}, role.id]
    ]]);
    yui_shell_confirm_danger(shell, $msg, {
        t: t, logical_class: "USERS_CONFIRM_DELETE_ROLE_DIALOG",
        confirm_label: "delete role", cancel_label: "cancel"
    }).then((yes) => {
        if(yes) {
            gobj_send_event(gobj, "EV_DELETE_ROLE_CONFIRMED", {role_id: role.id}, gobj);
        }
    });
    return 0;
}

function ac_delete_role_confirmed(gobj, event, kw, src)
{
    start_batch(gobj, "write", [
        (g) => [{op: "delete-node", line: line_of(g, AUTHZ_TREEDB, "delete-node"),
                 kw: {topic_name: "roles", record: {id: kw.role_id}}}]
    ], "ST_WRITING");
    render(gobj);
    return 0;
}

/***************************************************************
 *  A write asked for (a dialog answered, a sheet button) when the
 *  tab is no longer READY: the session dropped or another write is
 *  in flight. Nothing is sent, and the operator is told.
 ***************************************************************/
function ac_not_sent(gobj, event, kw, src)
{
    log_warning(`${gobj_short_name(gobj)}: ${event} in ${gobj_current_state(gobj)}: not sent`);
    close_dialogs(gobj);
    gobj.priv.message = {kind: "error", key: "users write not sent"};
    render(gobj);
    return 0;
}

/***************************************************************
 *  The shell switched language: what carries its key is re-read,
 *  the table's own chrome and formatters are rebuilt.
 ***************************************************************/
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
            table.options.placeholder = t("no users");
            table.setColumns(make_columns(gobj));
        } catch(e) {
            log_error(`${gobj_short_name(gobj)}: cannot re-render the table: ${e}`);
        }
    }
    let roles_table = gobj.priv.roles_table;
    if(roles_table) {
        yui_tabulator_relocalize(roles_table, t);
        try {
            roles_table.options.placeholder = t("no roles in this store");
            roles_table.setColumns(make_role_columns(gobj));
        } catch(e) {
            log_error(`${gobj_short_name(gobj)}: cannot re-render the roles table: ${e}`);
        }
    }
    render(gobj);
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

    /*  The writes asked for when they cannot be sent.  */
    const not_sent = [
        ["EV_CREATE_USER",       ac_not_sent,          null],
        ["EV_SET_ROLES",         ac_not_sent,          null],
        ["EV_ENABLE_USER",       ac_not_sent,          null],
        ["EV_DISABLE_USER",      ac_not_sent,          null],
        ["EV_DISABLE_CONFIRMED", ac_not_sent,          null],
        ["EV_DELETE_USER",       ac_not_sent,          null],
        ["EV_DELETE_CONFIRMED",  ac_not_sent,          null],
        ["EV_NEW_ROLE",          ac_not_sent,          null],
        ["EV_SAVE_ROLE",         ac_not_sent,          null],
        ["EV_DELETE_ROLE",       ac_not_sent,          null],
        ["EV_DELETE_ROLE_CONFIRMED", ac_not_sent,      null]
    ];
    const always = [
        ["EV_MT_COMMAND_ANSWER", ac_mt_command_answer, null],
        ["EV_LANGUAGE_CHANGED",  ac_language_changed,  null],
        ["EV_CANCEL_DIALOG",     ac_cancel_dialog,     null],
        ["EV_SHOW_VIEW",         ac_show_view,         null],
        ["EV_ROUTE_CHANGED",     ac_route_changed,     null]
    ];

    /*---------------------------------------------*
     *          States
     *---------------------------------------------*/
    const states = [
        ["ST_IDLE", [
            ["EV_ON_OPEN",           ac_on_open,           null],
            ["EV_ON_CLOSE",          ac_on_close,          null]
        ].concat(always, not_sent)],
        /*  A row can be opened while the store is read or written: the
         *  sheet then opens read-only (can_write() is false).  */
        ["ST_LOADING", [
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_TIMEOUT",           ac_timeout,           null],
            ["EV_OPEN_USER",         ac_open_user,         null],
            ["EV_OPEN_ROLE",         ac_open_role,         null]
        ].concat(always, not_sent)],
        ["ST_READY", [
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_REFRESH",           ac_refresh,           null],
            ["EV_OPEN_USER",         ac_open_user,         null],
            ["EV_NEW_USER",          ac_new_user,          null],
            ["EV_CREATE_USER",       ac_create_user,       null],
            ["EV_SET_ROLES",         ac_set_roles,         null],
            ["EV_ENABLE_USER",       ac_enable_user,       null],
            ["EV_DISABLE_USER",      ac_disable_user,      null],
            ["EV_DISABLE_CONFIRMED", ac_disable_confirmed, null],
            ["EV_DELETE_USER",       ac_delete_user,       null],
            ["EV_DELETE_CONFIRMED",  ac_delete_confirmed,  null],
            ["EV_OPEN_ROLE",         ac_open_role,         null],
            ["EV_NEW_ROLE",          ac_open_role,         null],
            ["EV_SAVE_ROLE",         ac_save_role,         null],
            ["EV_DELETE_ROLE",       ac_delete_role,       null],
            ["EV_DELETE_ROLE_CONFIRMED", ac_delete_role_confirmed, null]
        ].concat(always)],
        ["ST_WRITING", [
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_TIMEOUT",           ac_timeout,           null],
            ["EV_OPEN_USER",         ac_open_user,         null],
            ["EV_OPEN_ROLE",         ac_open_role,         null]
        ].concat(always, not_sent)],
        ["ST_NO_USERS", [
            ["EV_ON_CLOSE",          ac_on_close,          null],
            ["EV_REFRESH",           ac_refresh,           null]
        ].concat(always, not_sent)]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_ON_OPEN",           0],
        ["EV_ON_CLOSE",          0],
        ["EV_MT_COMMAND_ANSWER", 0],
        ["EV_LANGUAGE_CHANGED",  0],
        ["EV_TIMEOUT",           0],
        ["EV_REFRESH",           0],
        ["EV_OPEN_USER",         0],
        ["EV_NEW_USER",          0],
        ["EV_CANCEL_DIALOG",     0],
        ["EV_CREATE_USER",       0],
        ["EV_SET_ROLES",         0],
        ["EV_ENABLE_USER",       0],
        ["EV_DISABLE_USER",      0],
        ["EV_DISABLE_CONFIRMED", 0],
        ["EV_DELETE_USER",       0],
        ["EV_DELETE_CONFIRMED",  0],
        ["EV_SHOW_VIEW",         0],
        ["EV_ROUTE_CHANGED",     0],
        ["EV_OPEN_ROLE",         0],
        ["EV_NEW_ROLE",          0],
        ["EV_SAVE_ROLE",         0],
        ["EV_DELETE_ROLE",       0],
        ["EV_DELETE_ROLE_CONFIRMED", 0]
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

function register_c_agent_users()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_agent_users};
