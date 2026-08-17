/***********************************************************************
 *          lazy_modules.js
 *
 *      The two heavy things this console can be used without, loaded on
 *      demand instead of at boot. Measured with gzip sizes, which is the
 *      only figure that matters over the wire:
 *
 *        - the TREEDB EDITOR of the Schemas workspace — `@antv/g6` and its
 *          `@antv/*` stack (~404 kB) behind the schema graph, plus
 *          `vanilla-jsoneditor` and the CodeMirror it carries (~200 kB)
 *          behind C_YUI_FORM's raw-JSON field, and tom-select.
 *        - the TERMINAL — `@xterm/xterm` + its two addons and CSS (~89 kB).
 *        - the FRONTEND VIEW of the account menu (the gobj tree drawn with
 *          G6), which is what actually held `@antv/g6` in the initial
 *          bundle: the schema graph shares it, so splitting only the graph
 *          moved 2 kB and left the 404 kB where it was.
 *
 *      Together they were 60% of a 1.07 MB initial bundle, in an app whose
 *      first screen is a node list. Both belong to a workspace the operator
 *      has to click into, so both now arrive with that click.
 *
 *      Two rules this file exists to keep:
 *
 *        - **Load once.** Each loader keeps its promise, so a second
 *          Schemas tab (or a reopened terminal) reuses it. Registering a
 *          gclass twice logs "GClass ALREADY created", so every register_*
 *          is guarded by gclass_find_by_name().
 *        - **A resolved import is an OS notification.** These loaders never
 *          run application logic; the caller turns the resolution into an
 *          EVENT of its FSM (EV_EDITOR_READY / EV_TTY_LIBS_READY) and does
 *          the work in the action.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {gclass_find_by_name, log_error} from "@yuneta/gobj-js";


/***************************************************************
 *              TreeDB editor (Schemas workspace)
 ***************************************************************/
let editor_promise = null;
let editor_ready = false;

/***************************************************************
 *  Is the treedb editor already usable? Callers mount straight away
 *  when it is, so the common case (a second treedb of the same yuno)
 *  costs nothing.
 ***************************************************************/
function treedb_editor_ready()
{
    return editor_ready;
}

/***************************************************************
 *  Load + register C_YUI_TREEDB_TOPICS, the per-topic
 *  C_YUI_TREEDB_TOPIC_WITH_FORM (which registers C_YUI_FORM itself)
 *  and the C_YUI_TREEDB_SCHEMA of the graph landing.
 *
 *  Call it as early as the workspace is known — the Schemas tab starts
 *  it in mt_create, so the chunk downloads while the node answers the
 *  `services` discovery, and the mount finds it already there.
 ***************************************************************/
function load_treedb_editor()
{
    if(editor_promise) {
        return editor_promise;
    }
    editor_promise = Promise.all([
        import("@yuneta/gobj-ui/src/c_yui_treedb_topics.js"),
        import("@yuneta/gobj-ui/src/c_yui_treedb_topic_with_form.js"),
        import("@yuneta/gobj-ui/src/c_yui_treedb_schema.js")
    ]).then(function([topics, with_form, schema]) {
        if(gclass_find_by_name("C_YUI_TREEDB_TOPICS") === null) {
            topics.register_c_yui_treedb_topics();
        }
        if(gclass_find_by_name("C_YUI_TREEDB_TOPIC_WITH_FORM") === null) {
            with_form.register_c_yui_treedb_topic_with_form();
        }
        if(gclass_find_by_name("C_YUI_TREEDB_SCHEMA") === null) {
            schema.register_c_yui_treedb_schema();
        }
        editor_ready = true;
        return true;
    }).catch(function(err) {
        /*  A failed chunk is not a state to retry silently: the tab says
         *  so, and the next attempt (reopening the tab) tries again.  */
        log_error(`lazy_modules: the treedb editor failed to load: ${err && err.message}`);
        editor_promise = null;
        return false;
    });
    return editor_promise;
}


/***************************************************************
 *              Terminal (xterm)
 ***************************************************************/
let xterm_promise = null;
let xterm_mod = null;

/***************************************************************
 *  The three classes C_AGENT_TTY builds a terminal with, or null
 *  while they are still on the wire.
 ***************************************************************/
function xterm_classes()
{
    return xterm_mod;
}

/***************************************************************
 *  Load xterm, its fit + serialize addons and its CSS. The stylesheet
 *  travels in the same chunk on purpose: a terminal without it renders
 *  as unpositioned text.
 ***************************************************************/
function load_xterm()
{
    if(xterm_promise) {
        return xterm_promise;
    }
    xterm_promise = Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-serialize"),
        import("@xterm/xterm/css/xterm.css")
    ]).then(function([core, fit, serialize]) {
        xterm_mod = {
            Terminal:       core.Terminal,
            FitAddon:       fit.FitAddon,
            SerializeAddon: serialize.SerializeAddon
        };
        return xterm_mod;
    }).catch(function(err) {
        log_error(`lazy_modules: xterm failed to load: ${err && err.message}`);
        xterm_promise = null;
        return null;
    });
    return xterm_promise;
}


/***************************************************************
 *              Frontend view (developer window)
 ***************************************************************/
let tree_promise = null;
let tree_ready = false;

/***************************************************************
 *  Is C_YUI_GOBJ_TREE_JS registered?
 ***************************************************************/
function frontend_view_ready()
{
    return tree_ready;
}

/***************************************************************
 *  Load + register C_YUI_GOBJ_TREE_JS, the gobj tree of this yuno drawn
 *  as a graph in the account menu's "Frontend view" window. It draws with
 *  `@antv/g6`, the single heaviest package in the app (~404 kB gzipped
 *  with its @antv/* stack) — and it was in the INITIAL bundle for a
 *  developer window most sessions never open, which is why the schema
 *  graph looked like it had already been split out and G6 had not moved.
 ***************************************************************/
function load_frontend_view()
{
    if(tree_promise) {
        return tree_promise;
    }
    tree_promise = import("@yuneta/gobj-ui/src/c_yui_gobj_tree_js.js")
        .then(function(mod) {
            if(gclass_find_by_name("C_YUI_GOBJ_TREE_JS") === null) {
                mod.register_c_yui_gobj_tree_js();
            }
            tree_ready = true;
            return true;
        }).catch(function(err) {
            log_error(`lazy_modules: the frontend view failed to load: ${err && err.message}`);
            tree_promise = null;
            return false;
        });
    return tree_promise;
}


export {
    treedb_editor_ready,
    load_treedb_editor,
    xterm_classes,
    load_xterm,
    frontend_view_ready,
    load_frontend_view,
};
