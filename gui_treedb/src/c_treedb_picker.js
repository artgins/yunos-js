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
 *      A view: it builds its own `$container` for the shell to mount.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, gobj_short_name,
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
    $body: null,   /*  where connection cards render  */
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

    let $manage = createElement2(
        ["button", {class: "button is-small PICKER_MANAGE",
                    i18n: "manage connections"}, "Manage connections"]);
    $manage.addEventListener("click", () => {
        gobj_send_event(gobj, "EV_MANAGE_CONNECTIONS", {}, gobj);
    });

    let $container = createElement2(
        ["div", {class: "ytreedb-picker p-4", gclass: "C_TREEDB_PICKER"},
            [
                ["div", {class: "level mb-3"}, [
                    ["div", {class: "level-left"}, [
                        ["h2", {class: "title is-5", i18n: "treedbs"}, "TreeDBs"]
                    ]],
                    ["div", {class: "level-right"}, [$manage]]
                ]],
                $body
            ]
        ]
    );

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
        class: "PICKER_STATUS_DOT",
        style: "display:inline-block; width:0.7em; height:0.7em; border-radius:50%; "
             + "margin-right:0.5em; vertical-align:middle; background:"
             + (connected ? "#48c78e" : "#b5b5b5") + ";"
    }, []];
}

/***************************************************************
 *  The services to browse for a connection: the ones SELECTED in
 *  Settings among the discovered list (treedb_config_conn_services).
 *
 *  This is the contract — like wattyzer's static route table. We do NOT
 *  fall back to enumerating every `services_roles` key: that offered
 *  NON-treedb services, and sending a treedb `descs` to a ranger fails
 *  with "command not available". When none are selected, the card
 *  shows the "select them in Settings" hint (render_connection).
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
 *  Render one connection card with its treedb checkboxes.
 ***************************************************************/
function render_connection(gobj, conn)
{
    let workspace = gobj_read_attr(gobj, "workspace");
    let links = gobj_find_service("treedb_links", false);
    let config = gobj_find_service("treedb_config", false);
    let connected = links ? treedb_links_is_connected(links, conn.id) : false;
    let open_error = (links && !connected) ? treedb_links_get_open_error(links, conn.id) : null;
    let services = connection_services(conn, workspace);

    let $treedb_list = createElement2(["div", {class: "ytreedb-treedbs mt-2 PICKER_SERVICES"}, []]);
    if(services.length) {
        for(let svc of services) {
            let id = sel_id(conn.id, svc.key);
            let checked = treedb_config_is_selected(config, workspace, id);
            let $cb = createElement2(["input", {type: "checkbox"}]);
            $cb.checked = !!checked;
            $cb.disabled = !connected;
            $cb.addEventListener("change", () => {
                gobj_send_event(config, "EV_TOGGLE_SELECTED",
                    {
                        workspace: workspace,
                        sel: {
                            conn_id: conn.id,
                            svc:     svc,
                            label:   `${svc.service} · ${conn.label}`
                        }
                    }, gobj);
            });
            /*  Tag EVERY service with its gclass, same colours as the
             *  Settings table: tagging only C_TRANGER left C_NODE bare, so
             *  an untagged row read as "no class" instead of "a treedb". */
            let $svc_label = [["span", {class: "ml-2"}, svc.service]];
            $svc_label.push(["span",
                {class: "tag is-light is-size-7 ml-2 PICKER_SERVICE_GCLASS " +
                        (svc.gclass === "C_TRANGER" ? "is-warning" : "is-info")},
                svc.gclass]);
            $treedb_list.appendChild(createElement2(
                ["label", {class: "checkbox is-block mb-1 PICKER_SERVICE"},
                    [$cb, ...$svc_label]]
            ));
        }
    } else if(connected) {
        $treedb_list.appendChild(createElement2(
            ["p", {class: "is-size-7 has-text-grey", i18n: "no services selected"},
                "No services selected — pick them in Settings."]));
    } else if(!conn.enabled) {
        /*  Configured but not enabled: transports only open from the
         *  Settings connect button.  */
        $treedb_list.appendChild(createElement2(
            ["p", {class: "is-size-7 has-text-grey", i18n: "disconnected - connect in settings"},
                "Disconnected — connect it in Settings."]));
    } else if(!open_error) {
        /*  Only "connecting" while there is no connect failure; a failure is
         *  shown at card level below (independent of the treedbs branch). */
        $treedb_list.appendChild(createElement2(
            ["p", {class: "is-size-7 has-text-grey", i18n: "connecting"}, "Connecting…"]));
    }

    let $card_body = [
        ["div", {class: "mb-1 has-text-weight-semibold"},
            [status_dot(connected), ["span", {}, conn.label || conn.url]]],
        ["p", {class: "is-size-7 has-text-grey"},
            `${conn.url}  ·  ${conn.remote_yuno_role || "?"}/${conn.remote_yuno_service || "?"}`]
    ];
    if(open_error) {
        /*  Surface the failure instead of a permanent "Connecting…". Two very
         *  different ones:
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
        $card_body.push(["p", {class: "is-size-7 has-text-danger PICKER_CONN_ERROR"},
            msg + (detail ? ` (${detail})` : "")]);
    }
    $card_body.push($treedb_list);

    return createElement2(
        ["div", {class: "box p-3 mb-2", gclass: "TREEDB_CONNECTION_CARD"}, $card_body]
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

    let config = gobj_find_service("treedb_config", false);
    let conns = config ? treedb_config_get_connections(config) : [];
    if(!conns.length) {
        priv.$body.appendChild(createElement2(
            ["p", {class: "has-text-grey", i18n: "no connections yet"},
                "No connections yet. Add one in Settings to browse its treedbs."]));
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
        log_error(`${gobj_short_name(gobj)}: no shell, cannot open Settings`);
        return -1;
    }
    yui_shell_navigate(shell, "/settings", {push: true});   /*  user move  */
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
            ["EV_MANAGE_CONNECTIONS",       ac_manage_connections, null]
        ]]
    ];

    const event_types = [
        ["EV_CONNECTIONS_CHANGED",      0],
        ["EV_SELECTED_TREEDBS_CHANGED", 0],
        ["EV_ON_OPEN",                  0],
        ["EV_ON_CLOSE",                 0],
        ["EV_ON_OPEN_ERROR",            0],
        ["EV_LANGUAGE_CHANGED",         0],
        ["EV_MANAGE_CONNECTIONS",       0]
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
