/***********************************************************************
 *          c_treedb_picker.js
 *
 *      C_TREEDB_PICKER — the fixed tab-0 of each workspace (Topics /
 *      Graphs). It is the connection + treedb manager:
 *
 *        - lists the configured backend connections (add / edit / remove),
 *          persisted in C_TREEDB_CONFIG;
 *        - shows each connection's live status and, when connected, the
 *          treedbs it exposes (from the identity ack's services_roles,
 *          cached in C_TREEDB_LINKS);
 *        - a checkbox per treedb opens/closes it as a tab in THIS workspace
 *          (per-workspace selection in C_TREEDB_CONFIG); the app root
 *          rebuilds the workspace tabs on the change.
 *
 *      A view: it builds its own `$container` in mt_create and the shell
 *      mounts it (reads $container, appends, starts).
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

import {
    treedb_config_get_connections,
    treedb_config_upsert_connection,
    treedb_config_remove_connection,
    treedb_config_get_selected,
    treedb_config_is_selected,
    treedb_config_toggle_selected,
    sel_id,
} from "./c_treedb_config.js";

import {
    treedb_links_is_connected,
    treedb_links_get_services_roles,
} from "./c_treedb_links.js";


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
    $body:      null,   /*  where connection cards render          */
    adding:     false,  /*  the add-connection form is visible     */
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

    /*
     *  Re-render on connection-list changes, per-workspace selection
     *  changes, and connection up/down (to refresh status + treedb list).
     */
    let config = gobj_find_service("treedb_config", false);
    if(config) {
        gobj_subscribe_event(config, "EV_CONNECTIONS_CHANGED", {}, gobj);
        gobj_subscribe_event(config, "EV_SELECTED_TREEDBS_CHANGED", {}, gobj);
    }
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
    render(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
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
 *  Build the root container (the shell mounts it).
 ***************************************************************/
function build_ui(gobj)
{
    let priv = gobj.priv;

    let $body = createElement2(["div", {class: "ytreedb-picker-body"}, []]);
    priv.$body = $body;

    let $container = createElement2(
        ["div", {class: "ytreedb-picker p-4", gclass: "C_TREEDB_PICKER"},
            [
                ["div", {class: "level mb-3"}, [
                    ["div", {class: "level-left"}, [
                        ["h2", {class: "title is-5", i18n: "connections"}, "Connections"]
                    ]],
                    ["div", {class: "level-right"}, [
                        ["button", {class: "button is-primary is-small",
                                    id: "ytreedb-add-btn", i18n: "add connection"},
                            "Add connection"]
                    ]]
                ]],
                $body
            ]
        ]
    );

    let $add = $container.querySelector("#ytreedb-add-btn");
    $add.addEventListener("click", () => {
        priv.adding = !priv.adding;
        render(gobj);
    });

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}

/***************************************************************
 *  Empty a DOM node.
 ***************************************************************/
function clear_node($el)
{
    while($el && $el.firstChild) {
        $el.removeChild($el.firstChild);
    }
}

/***************************************************************
 *  A small connection-status dot.
 ***************************************************************/
function status_dot(connected)
{
    return ["span", {
        class: connected ? "ytreedb-dot is-connected" : "ytreedb-dot is-disconnected",
        style: "display:inline-block; width:0.7em; height:0.7em; border-radius:50%; "
             + "margin-right:0.5em; vertical-align:middle; background:"
             + (connected ? "#48c78e" : "#b5b5b5") + ";"
    }, []];
}

/***************************************************************
 *  The treedbs a connection exposes (from services_roles), excluding
 *  the internal treedb_system_schema unless a system view is wanted.
 ***************************************************************/
function connection_treedbs(services_roles)
{
    let names = [];
    for(let name in (services_roles || {})) {
        if(name === "treedb_system_schema") {
            continue;
        }
        names.push(name);
    }
    names.sort();
    return names;
}

/***************************************************************
 *  Render one connection card.
 ***************************************************************/
function render_connection(gobj, conn)
{
    let workspace = gobj_read_attr(gobj, "workspace");
    let links = gobj_find_service("treedb_links", false);
    let connected = links ? treedb_links_is_connected(links, conn.id) : false;
    let services_roles = links ? treedb_links_get_services_roles(links, conn.id) : {};
    let treedbs = connection_treedbs(services_roles);

    let $treedb_list = createElement2(["div", {class: "ytreedb-treedbs mt-2"}, []]);
    if(connected && treedbs.length) {
        for(let name of treedbs) {
            let id = sel_id(conn.id, name);
            let checked = treedb_config_is_selected(
                gobj_find_service("treedb_config", false), workspace, id);
            let $cb = createElement2(["input", {type: "checkbox"}]);
            $cb.checked = !!checked;
            $cb.addEventListener("change", () => {
                let config = gobj_find_service("treedb_config", false);
                treedb_config_toggle_selected(config, workspace,
                    {conn_id: conn.id, treedb_name: name, label: `${name} · ${conn.label}`});
            });
            $treedb_list.appendChild(createElement2(
                ["label", {class: "checkbox is-block mb-1"},
                    [$cb, ["span", {class: "ml-2"}, name]]]
            ));
        }
    } else if(connected) {
        $treedb_list.appendChild(createElement2(
            ["p", {class: "is-size-7 has-text-grey", i18n: "no treedbs exposed"}, "No treedbs exposed"]));
    } else {
        $treedb_list.appendChild(createElement2(
            ["p", {class: "is-size-7 has-text-grey", i18n: "connecting"}, "Connecting…"]));
    }

    let $remove = createElement2(
        ["button", {class: "button is-small is-danger is-light", "aria-label": "remove",
                    title: t("remove")}, [["span", {class: "icon"}, [["i", {class: "yi-trash"}]]]]]);
    $remove.addEventListener("click", () => {
        let config = gobj_find_service("treedb_config", false);
        treedb_config_remove_connection(config, conn.id);
    });

    return createElement2(
        ["div", {class: "box p-3 mb-2", gclass: "TREEDB_CONNECTION_CARD"},
            [
                ["div", {class: "level is-mobile mb-1"}, [
                    ["div", {class: "level-left"}, [
                        ["span", {class: "has-text-weight-semibold"},
                            [status_dot(connected), ["span", {}, conn.label || conn.url]]]
                    ]],
                    ["div", {class: "level-right"}, [$remove]]
                ]],
                ["p", {class: "is-size-7 has-text-grey"},
                    `${conn.url}  ·  ${conn.remote_yuno_role || "?"}/${conn.remote_yuno_service || "?"}`],
                $treedb_list
            ]
        ]
    );
}

/***************************************************************
 *  The inline add-connection form.
 ***************************************************************/
function render_add_form(gobj)
{
    let $url  = createElement2(["input", {class: "input is-small", type: "text",
        placeholder: "wss://host:1602"}]);
    let $role = createElement2(["input", {class: "input is-small", type: "text",
        placeholder: "remote_yuno_role"}]);
    let $svc  = createElement2(["input", {class: "input is-small", type: "text",
        placeholder: "remote_yuno_service (treedb host yuno)"}]);
    let $label = createElement2(["input", {class: "input is-small", type: "text",
        placeholder: "label (optional)"}]);

    let $save = createElement2(["button", {class: "button is-small is-primary", i18n: "save"}, "Save"]);
    $save.addEventListener("click", () => {
        let url = $url.value.trim();
        if(!url) {
            return;
        }
        let config = gobj_find_service("treedb_config", false);
        treedb_config_upsert_connection(config, {
            url:                 url,
            remote_yuno_role:    $role.value.trim(),
            remote_yuno_service: $svc.value.trim(),
            label:               $label.value.trim() || url
        });
        gobj.priv.adding = false;
        render(gobj);
    });

    let $cancel = createElement2(["button", {class: "button is-small", i18n: "cancel"}, "Cancel"]);
    $cancel.addEventListener("click", () => {
        gobj.priv.adding = false;
        render(gobj);
    });

    let field = (label_key, label_txt, $input) => [
        "div", {class: "field"},
        [
            ["label", {class: "label is-small", i18n: label_key}, label_txt],
            ["div", {class: "control"}, [$input]]
        ]
    ];

    return createElement2(
        ["div", {class: "box p-3 mb-3", gclass: "TREEDB_ADD_FORM"},
            [
                field("backend url", "Backend URL", $url),
                field("remote_yuno_role", "Remote yuno role", $role),
                field("remote_yuno_service", "Remote yuno service", $svc),
                field("label", "Label", $label),
                ["div", {class: "field is-grouped mt-3"}, [
                    ["div", {class: "control"}, [$save]],
                    ["div", {class: "control"}, [$cancel]]
                ]]
            ]
        ]
    );
}

/***************************************************************
 *  (Re)render the body.
 ***************************************************************/
function render(gobj)
{
    let priv = gobj.priv;
    if(!priv.$body) {
        return;
    }
    clear_node(priv.$body);

    if(priv.adding) {
        priv.$body.appendChild(render_add_form(gobj));
    }

    let config = gobj_find_service("treedb_config", false);
    let conns = config ? treedb_config_get_connections(config) : [];
    if(!conns.length && !priv.adding) {
        priv.$body.appendChild(createElement2(
            ["p", {class: "has-text-grey", i18n: "no connections yet"},
                "No connections yet. Add one to browse its treedbs."]));
    }
    for(let conn of conns) {
        priv.$body.appendChild(render_connection(gobj, conn));
    }

    refresh_language(priv.$body, t);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_refresh(gobj, event, kw, src)
{
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

    const states = [
        ["ST_IDLE", [
            ["EV_CONNECTIONS_CHANGED",      ac_refresh, null],
            ["EV_SELECTED_TREEDBS_CHANGED", ac_refresh, null],
            ["EV_ON_OPEN",                  ac_refresh, null],
            ["EV_ON_CLOSE",                 ac_refresh, null]
        ]]
    ];

    const event_types = [
        ["EV_CONNECTIONS_CHANGED",      0],
        ["EV_SELECTED_TREEDBS_CHANGED", 0],
        ["EV_ON_OPEN",                  0],
        ["EV_ON_CLOSE",                 0]
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
