/***********************************************************************
 *          c_treedb_preferences.js
 *
 *      C_TREEDB_PREFERENCES — the /preferences page, reached from the
 *      toolbar avatar menu.
 *
 *      What belongs here is what the OPERATOR chose for this browser,
 *      and nothing else. The backends themselves are not that: they are
 *      what the app browses, they are shared by every workspace and the
 *      pickers link to them, so they keep their own page
 *      (C_TREEDB_CONNECTIONS at /connections). The only choice today is
 *      the live buffer, which came from there.
 *
 *      A view: builds its own `$container` for the shell to mount, and
 *      every value it shows is read from C_TREEDB_CONFIG (the service
 *      that persists it) at render time, so a page reopened after a
 *      change shows the change.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event,
    gobj_find_service,
    gobj_send_event,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {
    treedb_config_get_live_max,
    LIVE_MAX_MIN,
    LIVE_MAX_MAX,
} from "./c_treedb_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_TREEDB_PREFERENCES";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Page title"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTML element (mounted by the shell)"),
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
    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    build_ui(gobj);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
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
 *  Live-buffer setting: how many rows a Live card keeps (newest on top;
 *  the oldest are dropped at the cap). It bounds the BROWSER's memory —
 *  the backend keeps no live data — so the value is clamped by
 *  C_TREEDB_CONFIG. Applied to cards opened from now on: an open card
 *  keeps the cap it was created with.
 ***************************************************************/
function build_live_max_field(gobj)
{
    let config = gobj_find_service("treedb_config", false);
    let cur = config ? treedb_config_get_live_max(config) : LIVE_MAX_MIN;

    let $input = createElement2(
        ["input", {class: "input is-small PREFERENCES_LIVE_MAX", type: "number",
                   min: String(LIVE_MAX_MIN), max: String(LIVE_MAX_MAX),
                   step: "50", value: String(cur),
                   style: "max-width:9rem;"}]);
    $input.addEventListener("change", () => {
        let cfg = gobj_find_service("treedb_config", false);
        if(!cfg) {
            log_error(`${GCLASS_NAME}: treedb_config service not found`);
            return;
        }
        gobj_send_event(cfg, "EV_SET_LIVE_MAX", {live_max: $input.value}, gobj);
        /*  Echo back what was STORED: the value is clamped, so a typed
         *  1000000 must not keep showing 1000000 in the field. The send is
         *  synchronous, so the clamped value is already persisted here.  */
        $input.value = String(treedb_config_get_live_max(cfg));
    });

    return ["div", {class: "PREFERENCES_LIVE"},
        [
            ["h2", {class: "title is-5 mb-2", i18n: "live buffer"}, "Live buffer"],
            ["p", {class: "is-size-7 has-text-grey mb-3 PREFERENCES_LIVE_HELP",
                   i18n: "live buffer help"},
                "Rows a Live card keeps in memory. The oldest are dropped when " +
                "the cap is reached; nothing is lost — the records stay in the " +
                "backend and can be read in a Rows card. Applies to cards opened " +
                "from now on."],
            ["div", {class: "field PREFERENCES_LIVE_FIELD"},
                [
                    ["label", {class: "label is-small mb-1", i18n: "rows per live card"},
                        "Rows per Live card"],
                    ["div", {class: "control"}, [$input]]
                ]
            ]
        ]];
}

/***************************************************************
 *  Build the page.
 ***************************************************************/
function build_ui(gobj)
{
    let $container = createElement2(
        ["div", {class: `${GCLASS_NAME} ytreedb-preferences p-4`},
            [
                ["div", {class: "PREFERENCES_HEADER mb-3"},
                    [["h1", {class: "title is-4 mb-0", i18n: "preferences"}, "Preferences"]]],
                ["div", {class: "PREFERENCES_BOX box", style: "max-width:540px;"},
                    [build_live_max_field(gobj)]]
            ]
        ]
    );

    gobj_write_attr(gobj, "$container", $container);
    refresh_language($container, t);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *              FSM
 ***************************************************************/
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
        ["ST_IDLE", []]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [];

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
function register_c_treedb_preferences()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_preferences};
