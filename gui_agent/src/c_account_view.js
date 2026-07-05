/***********************************************************************
 *          c_account_view.js
 *
 *      C_ACCOUNT_VIEW — the Settings pages, one gclass parameterised by
 *      the `view` attr and mounted as Settings sub-tabs (and reachable
 *      from the avatar menu):
 *
 *        - "preference" : appearance (theme + language + command-answer
 *                         display) and the shortkeys manager; all apply
 *                         immediately and persist in this browser.
 *        - "about"      : product card (mark, version, tenant/plane,
 *                         documentation link, copyright) plus read-only
 *                         Diagnostics (deployment identity, session,
 *                         control-center link, active node).
 *
 *      (The avatar's "developer" entry is NOT a page here — it toggles the
 *      dev window via EV_OPEN_DEVTOOLS in C_APP.)
 *
 *      Like every shell view it exposes a $container (required by
 *      C_YUI_SHELL). All user-visible strings go through i18next so the
 *      language toggle re-translates them.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event, gobj_find_service,
    createElement2,
    refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import pkg from "../package.json";

import {deploy_info} from "./conf/deploy.js";
import {current_theme} from "./theme.js";
import {current_locale, switch_locale} from "./locales/locales.js";
import {app_set_theme} from "./c_app.js";
import {agent_login_username, agent_login_is_logged_in} from "./c_agent_login.js";
import {agent_link_is_connected} from "./c_agent_link.js";
import {
    get_font_size as tty_get_font_size,
    set_font_size as tty_set_font_size,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
} from "./c_agent_tty.js";
import {
    agent_config_get_active_node,
    agent_config_get_display_mode,
    agent_config_set_display_mode,
    agent_config_get_stats_layout,
    agent_config_set_stats_layout,
    agent_config_get_shortkeys,
    agent_config_set_shortkey,
    agent_config_remove_shortkey,
} from "./c_agent_config.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_ACCOUNT_VIEW";

const ACCENT = "#2E7CD6";


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,          "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "view",        0,  "about",       "preference | developer | about"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,          "Root HTMLElement"),
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

    let $c = createElement2(["div", {class: "view-card account-view"}, []]);
    gobj_write_attr(gobj, "$container", $c);
    render(gobj);
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
 *  createElement2 bound to the i18next translator, so every node
 *  carrying an `i18n` attr is translated at build time AND can be
 *  re-translated in place by refresh_language() on a language switch.
 ***************************************************************/
function ce(desc)
{
    return createElement2(desc, t);
}

/***************************************************************
 *  (Re)render the page into our $container according to `view`.
 ***************************************************************/
function render(gobj)
{
    let $c = gobj_read_attr(gobj, "$container");
    if(!$c) {
        return;
    }
    $c.replaceChildren();

    let view = gobj_read_attr(gobj, "view");
    let body;
    if(view === "preference") {
        body = build_preference(gobj);
    } else {
        body = build_about(gobj);
    }
    $c.appendChild(body);
}

/***************************************************************
 *  Page header (title + optional subtitle). *_text is the English
 *  fallback; *_key the i18n key that overrides it per language.
 ***************************************************************/
function page_header(title_key, title_text, sub_key, sub_text)
{
    let children = [
        ["h1", {class: "title is-3", style: `color:${ACCENT}; margin-bottom:0.25rem;`, i18n: title_key},
            title_text]
    ];
    if(sub_key) {
        children.push(
            ["p", {class: "subtitle is-6", style: "color:#5B6B7E; margin-bottom:1rem;", i18n: sub_key},
                sub_text]
        );
    }
    return ["div", {style: "margin-bottom:0.5rem;"}, children];
}

/***************************************************************
 *  Preference — appearance (theme + language).
 ***************************************************************/
function build_preference(gobj)
{
    let theme = current_theme();
    let lang  = current_locale();

    /*  A segmented button group; the active option carries is-primary.
     *  Click handlers go in the 4th (events) slot of the createElement2
     *  description — an `onclick` attr would be silently dropped. */
    function segment(options, current, on_pick)
    {
        let btns = options.map(function(opt) {
            let active = (opt.value === current);
            let cls = "button" + (active ? " is-primary is-selected" : "");
            let kids = [];
            if(opt.icon) {
                kids.push(["span", {class: "icon"}, [["span", {class: opt.icon}, ""]]]);
            }
            kids.push(opt.i18n
                ? ["span", {i18n: opt.i18n}, opt.text]
                : ["span", {}, opt.text]);
            return ["button", {type: "button", class: cls}, kids,
                {click: function() { on_pick(opt.value); }}];
        });
        return ["div", {class: "buttons has-addons"}, btns];
    }

    let theme_seg = segment(
        [
            {value: "light", i18n: "light theme", text: "Light theme", icon: "yi-sun"},
            {value: "dark",  i18n: "dark theme",  text: "Dark theme",  icon: "yi-moon"}
        ],
        theme,
        function(v) {
            app_set_theme(v);
            render(gobj);
        }
    );

    let lang_seg = segment(
        [
            {value: "en", text: "English"},
            {value: "es", text: "Español"}
        ],
        lang,
        function(v) {
            switch_locale(v);
            refresh_language(document.body, t);
            render(gobj);
        }
    );

    /*  Command-answer display mode (Console), persisted on the shared
     *  C_AGENT_CONFIG service — "table" or "form" (raw JSON).  */
    let config = gobj_find_service("agent_config", false);
    let display_mode = config ? agent_config_get_display_mode(config) : "table";
    let display_seg = segment(
        [
            {value: "table", i18n: "table",    text: "Table",    icon: "yi-table"},
            {value: "form",  i18n: "raw json", text: "Raw JSON", icon: "yi-square-js"}
        ],
        display_mode,
        function(v) {
            if(config) {
                agent_config_set_display_mode(config, v);
            }
            render(gobj);
        }
    );

    /*  Statistics cards layout: one tab holding all cards (default) vs a
     *  tab per selected yuno. C_APP rebuilds the Statistics tabs on change.  */
    let stats_layout = config ? agent_config_get_stats_layout(config) : "single";
    let stats_layout_seg = segment(
        [
            {value: "single", i18n: "stats one tab",      text: "One tab",      icon: "yi-table"},
            {value: "tabs",   i18n: "stats tab per yuno", text: "Tab per yuno", icon: "yi-eye"}
        ],
        stats_layout,
        function(v) {
            if(config) {
                agent_config_set_stats_layout(config, v);
            }
            render(gobj);
        }
    );

    /*  Terminal font size — the shared DEFAULT for every Terminal tab
     *  (same persisted value the tab's A− / A+ buttons drive). A stepper so
     *  Settings matches the toolbar; open tabs pick a change up on their next
     *  (re)open.  */
    let font_size = tty_get_font_size();
    function font_button(icon, title_key, at_limit, on_click)
    {
        let attrs = {type: "button", class: "button",
                     title: t(title_key), "aria-label": t(title_key)};
        if(at_limit) {
            attrs.disabled = "disabled";
        }
        return ["button", attrs,
            [["span", {class: "icon"}, [["span", {class: icon}, ""]]]],
            {click: on_click}];
    }
    let font_seg = ["div", {class: "buttons has-addons"},
        [
            font_button("yi-magnifying-glass-minus", "font smaller", font_size <= FONT_SIZE_MIN,
                function() { tty_set_font_size(font_size - 1); render(gobj); }),
            ["button", {type: "button", class: "button is-static", style: "min-width:4.5rem;"},
                `${font_size} px`],
            font_button("yi-magnifying-glass-plus", "font larger", font_size >= FONT_SIZE_MAX,
                function() { tty_set_font_size(font_size + 1); render(gobj); })
        ]
    ];

    function field(label_key, label_text, control)
    {
        return ["div", {class: "field", style: "margin-bottom:1.25rem;"},
            [
                ["label", {class: "label", i18n: label_key}, label_text],
                ["div", {class: "control"}, [control]]
            ]
        ];
    }

    return ce(
        ["div", {},
            [
                page_header("preferences", "Preferences", "appearance", "Appearance"),
                ["div", {class: "box", style: "max-width:540px;"},
                    [
                        field("theme", "Theme", theme_seg),
                        field("language", "Language", lang_seg),
                        field("display mode", "Command answers", display_seg),
                        field("statistics layout", "Statistics cards", stats_layout_seg),
                        field("terminal font size", "Terminal font size", font_seg)
                    ]
                ],
                build_shortkeys(gobj)
            ]
        ]
    );
}

/***************************************************************
 *  Shortkeys manager (moved here from the console input row so it
 *  doesn't shrink the command input on mobile). The {key: template}
 *  dict is global to all nodes — persisted on the shared
 *  C_AGENT_CONFIG service. In a command, the first token is looked
 *  up here; a match expands to the template with $1 $2 … replaced by
 *  the following args (ycli parity). Returns a DOM node.
 ***************************************************************/
function build_shortkeys(gobj)
{
    let config = gobj_find_service("agent_config", false);
    let shortkeys = config ? agent_config_get_shortkeys(config) : {};
    let keys = Object.keys(shortkeys).sort();

    /*  Existing shortkeys: one row each, key + template + a trash button
     *  that removes it (persisted) and re-renders the page.  */
    let list_children = [];
    if(keys.length === 0) {
        list_children.push(
            ["p", {class: "has-text-grey", i18n: "no shortkeys yet"}, "No shortkeys defined"]);
    }
    for(let key of keys) {
        let this_key = key;
        list_children.push(
            ["div", {class: "SK_ROW",
                     style: "display:flex; align-items:center; gap:0.5rem; padding:0.35rem 0; " +
                            "border-bottom:1px solid var(--bulma-border, #dbdbdb);"},
                [
                    ["span", {class: "has-text-weight-semibold is-family-monospace",
                              style: "min-width:3.5rem;"}, this_key],
                    ["span", {class: "has-text-grey is-family-monospace is-size-7",
                              style: "flex:1; min-width:0; word-break:break-all;"}, shortkeys[this_key]],
                    ["button", {class: "button is-small is-ghost", type: "button",
                                title: t("remove shortkey")},
                        [["span", {class: "icon is-small"}, [["span", {class: "yi-trash"}, ""]]]],
                        {click: function() {
                            if(config) {
                                agent_config_remove_shortkey(config, this_key);
                            }
                            render(gobj);
                        }}]
                ]
            ]
        );
    }

    /*  Add form: key + command inputs. Enter in either, or the Add button,
     *  saves and re-renders (which clears the inputs).  */
    let $key = ce(["input", {class: "input is-small is-family-monospace", type: "text",
                             placeholder: "key", "aria-label": "key",
                             style: "max-width:7rem;"}]);
    let $cmd = ce(["input", {class: "input is-small is-family-monospace", type: "text",
                             placeholder: t("command template"), "aria-label": "command"}]);

    function do_add()
    {
        let k = String($key.value || "").trim();
        let c = String($cmd.value || "").trim();
        if(config && k && c) {
            agent_config_set_shortkey(config, k, c);
            render(gobj);
        }
    }
    let on_enter = function(ev) {
        if(ev.key === "Enter") {
            ev.preventDefault();
            do_add();
        }
    };
    $key.addEventListener("keydown", on_enter);
    $cmd.addEventListener("keydown", on_enter);

    let add_row = ce(
        ["div", {class: "field has-addons", style: "margin-top:0.75rem;"},
            [
                ["div", {class: "control"}, [$key]],
                ["div", {class: "control is-expanded"}, [$cmd]],
                ["div", {class: "control"},
                    [["button", {class: "button is-small is-primary", type: "button"},
                        [
                            ["span", {class: "icon is-small"}, [["span", {class: "yi-plus"}, ""]]],
                            ["span", {i18n: "add"}, "Add"]
                        ],
                        {click: do_add}]]
                ]
            ]
        ]
    );

    return ce(
        ["div", {class: "box", style: "max-width:540px;"},
            [
                ["label", {class: "label", i18n: "shortkeys"}, "Shortkeys"],
                ["p", {class: "help", style: "margin-bottom:0.75rem;", i18n: "shortkeys hint"},
                    "First token of a command; expands to the template with $1 $2 … as args. Shared by all nodes."],
                ["div", {class: "SK_LIST"}, list_children],
                add_row
            ]
        ]
    );
}

/***************************************************************
 *  Diagnostics — read-only deployment / link / session table,
 *  shown on the About page (one flat definition table).
 ***************************************************************/
function build_diagnostics(gobj)
{
    let dep = deploy_info();

    /*  These helpers read attrs off their service gobj — fetch the
     *  services first (passing undefined would dereference jn_attrs on
     *  undefined and abort gobj_create of this view). */
    let link   = gobj_find_service("agent_link", false);
    let login  = gobj_find_service("agent_login", false);
    let config = gobj_find_service("agent_config", false);

    let connected = !!(link && agent_link_is_connected(link));
    let logged    = agent_login_is_logged_in(login);
    let username  = agent_login_username(login) || "—";
    let node      = config ? agent_config_get_active_node(config) : "";

    function row(label_key, label_text, value, value_attrs)
    {
        return ["tr", {},
            [
                ["th", {style: "white-space:nowrap; color:#5B6B7E; font-weight:600; width:14rem;",
                        i18n: label_key}, label_text],
                ["td", value_attrs || {}, String(value)]
            ]
        ];
    }

    let node_cell = node
        ? ["td", {style: "font-family:monospace;"}, node]
        : ["td", {i18n: "none"}, "None"];

    let conn_attrs = {
        i18n: connected ? "connected" : "disconnected",
        style: `font-weight:600; color:${connected ? "#1FAE6F" : "#D64545"};`
    };

    let rows = [
        row("application", "Application", "gui_agent"),
        row("version", "Version", pkg.version || "—"),
        row("tenant", "Tenant", dep.tenant),
        row("plane", "Plane", dep.plane),
        row("host", "Host", dep.host),
        row("control center", "Control center", dep.cc_url, {style: "font-family:monospace;"}),
        row("auth bff", "Auth BFF", dep.bff_url, {style: "font-family:monospace;"}),
        row("connected", connected ? "Connected" : "Disconnected", "", conn_attrs),
        ["tr", {}, [
            ["th", {style: "white-space:nowrap; color:#5B6B7E; font-weight:600; width:14rem;",
                    i18n: "active node"}, "Active node"],
            node_cell
        ]],
        row("logged in as", "Logged in as",
            logged ? username : "", logged ? {} : {i18n: "logged out"})
    ];

    return ["div", {class: "box"},
        [
            ["h2", {class: "title is-5", style: "margin-bottom:0.75rem;", i18n: "diagnostics"},
                "Diagnostics"],
            ["table", {class: "table is-fullwidth is-narrow", style: "margin-bottom:0;"},
                [["tbody", {}, rows]]
            ]
        ]
    ];
}

/***************************************************************
 *  About — product card + diagnostics.
 ***************************************************************/
function build_about(gobj)
{
    let dep = deploy_info();
    let plane_label = (dep.plane === "agent22") ? "agent22" : "agents";

    return ce(
        ["div", {class: "account-about", style: "max-width:640px;"},
            [
                page_header("about", "About", null, ""),

                /*  Product header — logo + identity as a left-aligned
                 *  media object, same box width as the diagnostics below
                 *  so the two sections read as one page.  */
                ["div", {class: "box"},
                    [
                        ["div", {style: "display:flex; gap:1rem; align-items:center;"},
                            [
                                ["img", {
                                    src: "/agent-mark.svg",
                                    alt: "Agent Console",
                                    width: "60",
                                    height: "60",
                                    style: "flex:0 0 auto;"
                                }, ""],
                                ["div", {style: "flex:1 1 auto; min-width:0;"},
                                    [
                                        ["h2", {class: "title is-4", style: "margin-bottom:0.15rem;",
                                                i18n: "agent console"}, "Agent Console"],
                                        ["p", {class: "subtitle is-6",
                                               style: "color:#5B6B7E; margin-bottom:0.6rem;"},
                                            `v${pkg.version || ""} · ${dep.tenant} · ${plane_label}`],
                                        ["p", {style: "color:#5B6B7E; margin-bottom:0.75rem;",
                                               i18n: "about description"},
                                            "Browser console to operate Yuneta agents through the control center."],
                                        ["a", {
                                            class: "button is-link is-light is-small",
                                            href: "https://doc.yuneta.io",
                                            target: "_blank",
                                            rel: "noopener noreferrer"
                                        },
                                            [
                                                ["span", {class: "icon"}, [["span", {class: "yi-question"}, ""]]],
                                                ["span", {i18n: "documentation"}, "Documentation"]
                                            ]
                                        ]
                                    ]
                                ]
                            ]
                        ]
                    ]
                ],

                build_diagnostics(gobj),

                ["p", {class: "is-size-7", style: "color:#9AA7B4; margin-top:0.5rem; text-align:right;"},
                    "© 2026 ArtGins"]
            ]
        ]
    );
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
function register_c_account_view()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_account_view};
