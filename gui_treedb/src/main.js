/***********************************************************************
 *          main.js
 *
 *          TreeDB GUI — entry point.
 *
 *          Built on the declarative shell + nav stack (C_YUI_SHELL +
 *          C_YUI_NAV) from the v2 line of @yuneta/gobj-ui, consumed as a
 *          local file: dependency on the kernel/js/gobj-ui submodule. Menu
 *          structure lives in src/app_config.json; this file wires the
 *          GClasses and starts the yuno.
 *
 *          Multi-backend: the user configures backend connections at
 *          runtime (Settings/picker), stored in browser localStorage; the
 *          SPA authenticates once at the co-located auth_bff and forwards
 *          the access_token in each C_IEVENT_CLI identity_card to the
 *          (possibly remote) treedb backends. See
 *          [[project_gui_treedb_v2_migration]] and YUNO_AUTH.md §2.2.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    gobj_start_up,
    db_load_persistent_attrs,
    db_save_persistent_attrs,
    db_remove_persistent_attrs,
    db_list_persistent_attrs,
    gobj_create_yuno,
    gobj_create_default_service,
    gobj_create_service,
    gobj_start,
    gobj_play,
    register_c_yuno,
    register_c_timer,
    register_c_ievent_cli,
} from "@yuneta/gobj-js";

/*
 *  Import the specific gobj-ui modules (NOT the @yuneta/gobj-ui/index.js
 *  barrel): the barrel transitively loads c_yui_uplot.js -> uplot, whose
 *  module-top-level Intl.NumberFormat(navigator.language) can throw on a
 *  browser reporting a non-standard navigator.language. Same pattern as
 *  gui_agent / wattyzer.
 */
import {register_c_yui_shell}  from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {register_c_yui_nav}    from "@yuneta/gobj-ui/src/c_yui_nav.js";
import {register_c_yui_window} from "@yuneta/gobj-ui/src/c_yui_window.js";
import {register_c_yui_window_manager} from "@yuneta/gobj-ui/src/c_yui_window_manager.js";

import {register_c_yui_treedb_topics}          from "@yuneta/gobj-ui/src/c_yui_treedb_topics.js";
import {register_c_yui_treedb_topic_with_form} from "@yuneta/gobj-ui/src/c_yui_treedb_topic_with_form.js";
import {register_c_yui_treedb_graph}           from "@yuneta/gobj-ui/src/c_yui_treedb_graph.js";
import {register_c_g6_nodes_tree}              from "@yuneta/gobj-ui/src/c_g6_nodes_tree.js";
import {register_c_yui_json_graph}             from "@yuneta/gobj-ui/src/c_yui_json_graph.js";
import {register_c_yui_json}                   from "@yuneta/gobj-ui/src/c_yui_json.js";
import {register_c_yui_period}                 from "@yuneta/gobj-ui/src/c_yui_period.js";

import {register_c_treedb_config}   from "./c_treedb_config.js";
import {register_c_treedb_links}    from "./c_treedb_links.js";
import {register_c_login}           from "./c_login.js";
import {register_c_treedb_picker}   from "./c_treedb_picker.js";
import {register_c_treedb_settings} from "./c_treedb_settings.js";
import {register_c_treedb_view}     from "./c_treedb_view.js";
import {register_c_tranger_view}    from "./c_tranger_view.js";
import {register_c_app}             from "./c_app.js";

import {setup_locale} from "./locales/locales.js";
import {apply_theme, current_theme} from "./theme.js";

import "bulma/css/bulma.css";
import "@yuneta/gobj-ui/src/c_yui_shell.css";
import "@yuneta/gobj-ui/src/yui_icons.css";

import "tabulator-tables/dist/css/tabulator.min.css";
import "tabulator-tables/dist/css/tabulator_bulma.css";
import "@yuneta/gobj-ui/src/tabulator.css";
import "uplot/dist/uPlot.min.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import "tom-select/dist/css/tom-select.css";
import "bulma-switch-control/css/main.css";

import "@yuneta/gobj-ui/src/c_yui_map.css";
import "@yuneta/gobj-ui/src/yui_toolbar.css";
import "@yuneta/gobj-ui/src/lib_graph.css";
import "./login.css";

import app_config from "./app_config.json";
import pkg from "../package.json";


/************************************************
 *          Yuno identity
 ************************************************/
const yuno_name    = "TreeDB GUI";
const yuno_role    = "gui_treedb";
const yuno_version = pkg.version;   // single source: package.json


/***************************************************************
 *          Startup checks
 ***************************************************************/
if(!("WebSocket" in window)) {
    window.alert("This app cannot run without WebSockets!");
}


/***************************************************************
 *          main()
 ***************************************************************/
function main()
{
    /*----------------------------*
     *      Register gclasses
     *----------------------------*/
    /*  Yunetas-js kernel  */
    register_c_yuno();
    register_c_timer();
    register_c_ievent_cli();

    /*  Shell + nav stack (v2)  */
    register_c_yui_shell();
    register_c_yui_nav();
    register_c_yui_window();     /*  host for the developer panel  */
    register_c_yui_window_manager(); /*  dock/taskbar for windows (Developer monitor)  */

    /*  TreeDB editor gclasses (from gobj-ui)  */
    register_c_yui_treedb_topics();
    register_c_yui_treedb_topic_with_form();
    register_c_yui_treedb_graph();
    register_c_g6_nodes_tree();
    register_c_yui_json_graph();
    register_c_yui_json();       /*  lazy JSON tree viewer (raw tranger dumps)  */
    register_c_yui_period();     /*  date navigator of the Rows options  */

    /*  App root + config + login + links + picker  */
    register_c_treedb_config();
    register_c_treedb_links();
    register_c_login();
    register_c_treedb_picker();
    register_c_treedb_settings();
    register_c_treedb_view();
    register_c_tranger_view();
    register_c_app();

    /*------------------------------------------------*
     *          Start yuneta (localStorage-backed persistence)
     *------------------------------------------------*/
    gobj_start_up(
        null,                       // jn_global_settings
        db_load_persistent_attrs,
        db_save_persistent_attrs,
        db_remove_persistent_attrs,
        db_list_persistent_attrs,
        null,                       // global_command_parser_fn
        null                        // global_stats_parser_fn
    );

    /*------------------------------------------------*
     *          Create the __yuno__
     *------------------------------------------------*/
    let yuno = gobj_create_yuno(
        "gui_treedb_yuno",
        "C_YUNO",
        {
            yuno_name:    yuno_name,
            yuno_role:    yuno_role,
            yuno_version: yuno_version
        }
    );

    /*  i18n + theme before anything renders.  */
    setup_locale();
    apply_theme(current_theme());

    /*------------------------------------------------*
     *      C_TREEDB_APP is the default service: owns login +
     *      config + links, gates the shell behind a session.
     *------------------------------------------------*/
    gobj_create_default_service(
        "app",
        "C_TREEDB_APP",
        {
            config:   app_config,
            use_hash: true
        },
        yuno
    );

    /*------------------------------------------------*
     *      Window manager (dock/taskbar). A named service so
     *      C_YUI_WINDOW hosts (the Developer monitor) can opt in via
     *      gobj_find_service("__window_manager__") — without it a
     *      minimized window shades in place instead of rolling to a dock.
     *
     *      Responsive placement: a floating bar pinned bottom-left on
     *      desktop, an inline taskbar row in the shell's free `bottom-sub`
     *      zone on mobile (above the primary menu, which owns `bottom`).
     *------------------------------------------------*/
    gobj_create_service(
        "__window_manager__",
        "C_YUI_WINDOW_MANAGER",
        {
            dock_mode:       "responsive",
            dock_corner:     "bottom-left",
            inline_selector: '[data-zone="bottom-sub"]'
        },
        yuno
    );

    /*------------------------------------------------*
     *          Play
     *------------------------------------------------*/
    gobj_start(yuno);
    gobj_play(yuno);
}


/***************************************************************
 *          Bootstrap on window load
 ***************************************************************/
window.addEventListener("load", function() {
    let loading = document.getElementById("loading-message");
    if(loading) {
        loading.remove();
    }
    if(!window.location.hash) {
        window.location.hash = "";
    }
    main();
});
