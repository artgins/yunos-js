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
 *      (C_TREEDB_CONNECTIONS at /connections).
 *
 *      First the three rows every app shows -- theme, language,
 *      navigation: the parts of gobj-ui's Preferences page, applied
 *      through what c_app.js registered (yui_preferences_setup) -- then
 *      the live buffer, this app's own. The page is drawn again on a
 *      change, and when the language changes from the toolbar: which
 *      option is marked is markup.
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
    gobj_unsubscribe_event,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {
    yui_pref_header,
    yui_pref_box,
    yui_pref_appearance_fields,
    yui_pref_apply,
} from "@yuneta/gobj-ui/src/yui_preferences.js";

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

let PRIVATE_DATA = {
    shell: null,
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
    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    gobj_write_attr(gobj, "$container", createElement2(
        ["div", {class: `${GCLASS_NAME} PREF_PAGE ytreedb-preferences p-4`}, []]
    ));
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    priv.shell = yui_shell_of(gobj);
    if(priv.shell) {
        gobj_subscribe_event(priv.shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }
    render(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    if(priv.shell) {
        gobj_unsubscribe_event(priv.shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        priv.shell = null;
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

    /*  Its `<label>` below is a SIBLING -- no `for`, no wrapping -- so it
     *  names the box for the eye and for nothing else.  */
    let $input = createElement2(
        ["input", {class: "input is-small PREFERENCES_LIVE_MAX", type: "number",
                   min: String(LIVE_MAX_MIN), max: String(LIVE_MAX_MAX),
                   step: "50", value: String(cur),
                   title: t("rows per live card"),
                   "data-i18n-title": "rows per live card",
                   "aria-label": t("rows per live card"),
                   "data-i18n-aria-label": "rows per live card",
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

    return ["div", {class: "PREF_BOX PREFERENCES_LIVE box", style: "max-width:540px;"},
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
 *  Draw the page: the three rows every app shows, then the live
 *  buffer.
 ***************************************************************/
function render(gobj)
{
    let $container = gobj_read_attr(gobj, "$container");
    if(!$container) {
        return;
    }
    $container.replaceChildren(createElement2(
        ["div", {}, [
            yui_pref_header(),
            yui_pref_box(yui_pref_appearance_fields(gobj), "PREF_APPEARANCE"),
            build_live_max_field(gobj)
        ]]
    ));
    refresh_language($container, t);
}




                    /***************************
                     *      Actions
                     ***************************/




/***************************************************************
 *  EV_SET_THEME / EV_SET_LANGUAGE / EV_SET_NAV_MODE {value}: a
 *  press on one of the three rows.
 ***************************************************************/
function ac_set_preference(gobj, event, kw, src)
{
    let ret = yui_pref_apply(gobj, event, kw);
    render(gobj);
    return ret;
}

/***************************************************************
 *  The language changed from the toolbar while the page is open.
 ***************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    render(gobj);
    return 0;
}

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
        ["ST_IDLE", [
            ["EV_SET_THEME",            ac_set_preference,      null],
            ["EV_SET_LANGUAGE",         ac_set_preference,      null],
            ["EV_SET_NAV_MODE",         ac_set_preference,      null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_SET_THEME",            0],
        ["EV_SET_LANGUAGE",         0],
        ["EV_SET_NAV_MODE",         0],
        ["EV_LANGUAGE_CHANGED",     0]
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
function register_c_treedb_preferences()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_treedb_preferences};
