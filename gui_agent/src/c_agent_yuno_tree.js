/***********************************************************************
 *          c_agent_yuno_tree.js
 *
 *      C_AGENT_YUNO_TREE -- the gobj tree of ONE yuno of a scenario, in
 *      a window: what each gobj is doing (running, playing, its state)
 *      and what it traces, with a box per trace level to turn it on or
 *      off for that gobj or for every gobj of its gclass.
 *
 *      It hosts a C_YUI_GOBJ_TREE_JS with `source: "remote"` (gobj-ui's
 *      open_gobj_tree_view()) and answers what the tree asks for with
 *      commands to the yuno, `command-yuno id=<id> service=__yuno__
 *      command=...`:
 *
 *          the tree        view-gobj-tree options=[...]  (the fields the
 *                          view reads: its default leaves out gclass and
 *                          fullname, and an empty list means EVERY attr
 *                          of every gobj), with get-gclass-trace (all of
 *                          them) and get-global-trace, to tell a gobj's
 *                          own traces from the ones it inherits
 *          a gclass' trace levels, the four at once:
 *                          info-gclass-trace gclass=G   (what it can trace)
 *                          info-global-trace            (what anyone can)
 *                          get-gclass-trace gclass=G    (on for the gclass)
 *                          get-global-trace             (on for everybody)
 *          a trace set     set-gobj-trace gobj=<full name> level=L set=1|0
 *                          set-gclass-trace gclass=G level=L set=1|0
 *                          set-global-trace level=L set=1|0  (the yuno's
 *                          scope; G is then the root's gclass, whose
 *                          answer carries the yuno's levels)
 *                          one per level; when the last one is answered
 *                          the tree and the levels of G are read again,
 *                          and their answers carry the set's `set_id`
 *                          (gobj-ui 7.27.33): a read asked before the set
 *                          and answered after it says `set_id: null`, so
 *                          it does not unlock what the set locked
 *          the gclass      view-gclass gclass=G
 *
 *      It has no transport of its own: the scenario's transport is the
 *      monitor's (directly to the agent, or through the control center),
 *      so it PUBLISHES each command line (EV_YUNO_TREE_REQUEST) and the
 *      monitor -- its parent -- sends it and hands the answer back
 *      (EV_YUNO_TREE_ANSWER). Every request carries a sequence number,
 *      and an answer of a request overtaken by a newer one is dropped.
 *
 *      What the window tells, in its status line: an error, how many
 *      gobjs trace something of their own (not what their gclass or the
 *      global level makes them trace: a yuno's main() turns some gclass
 *      traces on by default, and a count of those is every connection
 *      of the yuno), and how many gclasses trace.
 *
 *      Nothing is read on a clock: the tree when the window opens, on
 *      Refresh, and after a set; the levels of a gclass when one of its
 *      cards is opened.
 *
 *      Traces: what `set-gclass-trace` and `set-global-trace` set is
 *      saved by the yuno and survives a restart; so does what
 *      `set-gobj-trace` sets on a named service (SDK 7.27.3+, saved under
 *      its service name). On any other gobj it lasts until the yuno ends.
 *      They go to the yuno's log on its node, not to the Developer
 *      window.
 *
 *      The window is closed by the reader (✕): the view is already gone
 *      then, and this gobj tells its parent (EV_YUNO_TREE_CLOSED), which
 *      destroys it on its next turn.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA,
    SDATA_END,
    data_type_t,
    event_flag_t,
    gclass_create,
    log_error,
    log_warning,
    gobj_parent,
    gobj_read_attr,
    gobj_read_pointer_attr,
    gobj_subscribe_event,
    gobj_unsubscribe_event,
    gobj_send_event,
    gobj_publish_event,
    gobj_short_name,
    gobj_is_destroying,
    createElement2,
    refresh_language,
} from "@yuneta/gobj-js";

import {t} from "i18next";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {
    open_gobj_tree_view,
    close_gobj_tree_view,
} from "@yuneta/gobj-ui/src/yui_gobj_tree_view.js";

/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_AGENT_YUNO_TREE";

/*  The four answers that make the trace levels of a gclass.  */
const TRACE_INFO_PARTS = ["gclass_levels", "global_levels", "gclass_on", "global_on"];

/*  The three answers that make the tree.  */
const TREE_PARTS = ["tree", "tree_gclass_on", "tree_global_on"];

/*  What the view reads of each gobj (gobj2json()'s names). A yuno
 *  built before `play_methods` existed ignores the name, and the view
 *  then keeps calling a running gobj that does not play paused.  */
const TREE_OPTIONS = JSON.stringify([
    "fullname", "shortname", "gclass", "name", "parent", "state", "running", "playing",
    "service", "disabled", "volatil", "gobj_flags", "gobj_trace_level", "bottom_gobj",
    "commands", "play_methods"
]);

/***************************************************************
 *              Data
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",   0,  null,   "Subscriber of output events"),
SDATA(data_type_t.DTP_DICT,     "yuno",         0,  "{}",   "The yuno of the scenario: {key, id, node, service, label}"),
SDATA_END()
];

let PRIVATE_DATA = {
    view:       null,   /*  open_gobj_tree_view() handle  */
    seq:        0,      /*  number of the last request batch  */
    tree_seq:   0,      /*  the tree request whose answers are wanted  */
    tree_parts: {},     /*  what = answer of the tree request in flight: {result, comment, data}  */
    tree_set_id: null,  /*  the set the tree read in flight follows (its answer says so), or null  */
    info:       {},     /*  gclass -> {seq, parts, error, set_id}  */
    sets:       null,   /*  the trace set in flight: {seq, gclass, pending, failed, set_id}  */
    error:      null,   /*  {key} or {text} shown in the status line  */
    own_traces: 0,      /*  gobjs with traces of their own, in the last tree  */
    gclass_traces: 0,   /*  gclasses that trace, when the tree was read  */
    $status:    null,
    $error:     null,
    $count:     null,
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
    let priv = gobj.priv;

    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    let y = gobj_read_attr(gobj, "yuno") || {};
    priv.$error = createElement2(["span", {class: "YUNO_TREE_ERROR has-text-danger"}, ""]);
    priv.$count = createElement2(["span", {class: "YUNO_TREE_COUNT"}, ""]);
    priv.$status = createElement2(
        ["div", {class: "YUNO_TREE_STATUS is-size-7"}, [
            ["span", {class: "YUNO_TREE_WHERE is-family-monospace has-text-grey"},
                y.node ? `${y.node} · ${y.id}` : String(y.id || "")],
            priv.$count,
            priv.$error
        ]]
    );
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    open_view(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_unsubscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
    }

    /*  In mt_stop and NOT in mt_destroy: the tree is a child, and
     *  gobj_destroy() destroys the children before mt_destroy.  */
    close_gobj_tree_view(priv.view);
    priv.view = null;
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
 *  The window's name: the card's node and key, each written so that
 *  no two cards share it. The window is a SERVICE (a second one of
 *  the same name is refused), and its name also keys the size and
 *  the arrangement the reader left. A node and a key may both hold
 *  a `-` (NAME_RE), so `a` + `b-c` and `a-b` + `c` read alike when
 *  joined by one; and clean_name() turns a `^` into the `_` another
 *  may hold. Each part is percent-encoded (a `^` is `%5E`, a `~`
 *  `%7E`), and a `~` joins them: an encoded part never holds one.
 *
 *  gobj-js registers and finds a service by its name LOWERCASED, so
 *  the keys `Gate` and `gate`, or the nodes `Central` and `central`,
 *  were one window (REV-CLOUD V40.3.2). An uppercase letter is
 *  written `!` + the letter in lowercase (`Gate` -> `!gate`), and a
 *  `!` of the part itself is percent-encoded (`%21`): `!` starts no
 *  other token, so two parts that differ only in case still differ
 *  once lowercased. The name is used as it is: gobj-ui 7.27.33 finds
 *  the tree's canvas whatever characters the name holds.
 ***************************************************************/
function window_name(y)
{
    let part = (s) => Array.from(String(s), (c) => {
        if(c >= "A" && c <= "Z") {
            return "!" + c.toLowerCase();
        }
        return encodeURIComponent(c).replace(/!/g, "%21").replace(/~/g, "%7E");
    }).join("");
    return `${part(y.node || "local")}~${part(y.key || y.id)}`;
}

/***************************************************************
 *  The window, and the tree read into it. Named by the CARD (the
 *  scenario's key), not by the yuno: two cards of one yuno (two
 *  services) have a tree each, and the window is a service.
 ***************************************************************/
function open_view(gobj)
{
    let priv = gobj.priv;
    let y = gobj_read_attr(gobj, "yuno") || {};

    priv.view = open_gobj_tree_view(gobj, {
        name:           window_name(y),
        source:         "remote",
        yuno_name:      y.label || String(y.id || ""),
        title_prefix:   y.label || String(y.id || ""),
        title:          "gobj tree",
        $header:        priv.$status,
        on_close:       () => {
            if(gobj_is_destroying(gobj)) {
                return;
            }
            gobj_send_event(gobj, "EV_VIEW_CLOSED", {}, gobj);
        },
    });
    if(!priv.view) {
        log_error(`${gobj_short_name(gobj)}: cannot open the gobj tree of ${y.label || y.id}`);
        return -1;
    }
    request_tree(gobj);
    return 0;
}

/***************************************************************
 *  A parameter of a command line: a value with a blank goes
 *  quoted (the agent's parser reads key='a b'), and one that
 *  holds both quotes cannot be written at all.
 ***************************************************************/
function cmd_value(v)
{
    v = String(v);
    if(!/\s/.test(v)) {
        return v;
    }
    if(v.indexOf("'") < 0) {
        return `'${v}'`;
    }
    if(v.indexOf('"') < 0) {
        return `"${v}"`;
    }
    return null;
}

/***************************************************************
 *  A command of the yuno's __yuno__, through its agent.
 ***************************************************************/
function yuno_command(gobj, command, params)
{
    let y = gobj_read_attr(gobj, "yuno") || {};
    let line = `command-yuno id=${y.id} service=__yuno__ command=${command}`;
    for(let k of Object.keys(params || {})) {
        let v = cmd_value(params[k]);
        if(v === null) {
            log_error(`${gobj_short_name(gobj)}: ${k} cannot go in a command line: ${params[k]}`);
            return null;
        }
        line += ` ${k}=${v}`;
    }
    return line;
}

function request(gobj, what, line, gclass, seq)
{
    let y = gobj_read_attr(gobj, "yuno") || {};
    gobj_publish_event(gobj, "EV_YUNO_TREE_REQUEST", {
        key:    y.key,
        what:   what,
        gclass: gclass || "",
        seq:    seq,
        line:   line
    });
}

/*  `set_id`: the set this read follows (the tree's number of it), echoed
 *  in the answer. A read that overtakes one owed to a set is after that
 *  set too, so it inherits the number.  */
function request_tree(gobj, set_id)
{
    let priv = gobj.priv;
    if(set_id !== undefined && set_id !== null) {
        priv.tree_set_id = set_id;
    }
    priv.tree_seq = ++priv.seq;
    priv.tree_parts = {};
    request(gobj, "tree", yuno_command(gobj, "view-gobj-tree", {options: TREE_OPTIONS}),
        "", priv.tree_seq);
    request(gobj, "tree_gclass_on", yuno_command(gobj, "get-gclass-trace", {}), "", priv.tree_seq);
    request(gobj, "tree_global_on", yuno_command(gobj, "get-global-trace", {}), "", priv.tree_seq);
}

function request_trace_info(gobj, gclass, set_id)
{
    let priv = gobj.priv;
    let seq = ++priv.seq;
    let owed = priv.info[gclass] ? priv.info[gclass].set_id : null;
    if(set_id !== undefined && set_id !== null) {
        owed = set_id;
    }
    priv.info[gclass] = {seq: seq, parts: {}, error: "", set_id: owed};
    request(gobj, "gclass_levels", yuno_command(gobj, "info-gclass-trace", {gclass: gclass}), gclass, seq);
    request(gobj, "global_levels", yuno_command(gobj, "info-global-trace", {}), gclass, seq);
    request(gobj, "gclass_on", yuno_command(gobj, "get-gclass-trace", {gclass: gclass}), gclass, seq);
    request(gobj, "global_on", yuno_command(gobj, "get-global-trace", {}), gclass, seq);
}

/***************************************************************
 *  The status line: what failed last, and how many gobjs trace.
 ***************************************************************/
function set_error(gobj, error)
{
    gobj.priv.error = error;
    paint_status(gobj);
}

function paint_status(gobj)
{
    let priv = gobj.priv;
    let e = priv.error;
    if(e && e.key) {
        priv.$error.setAttribute("data-i18n", e.key);
        priv.$error.textContent = t(e.key);
    } else {
        priv.$error.removeAttribute("data-i18n");
        priv.$error.textContent = (e && e.text) || "";
    }
    /*  COUNTED words: no data-i18n (refresh_language() would put the
     *  plural back over the singular), repainted here instead.  */
    let parts = [];
    if(priv.own_traces > 0) {
        parts.push(t("gobjs with traces of their own", {count: priv.own_traces}));
    }
    if(priv.gclass_traces > 0) {
        parts.push(t("gclasses that trace", {count: priv.gclass_traces}));
    }
    priv.$count.textContent = parts.join(" · ");
}

/*  How many gobjs of a `view-gobj-tree` answer trace a level that
 *  neither their gclass nor the global level holds.  */
function count_own_traces(node, gclass_on, global_on)
{
    let n = 0;
    if(!node || typeof node !== "object") {
        return 0;
    }
    let held = (gclass_on[node.gclass] || []).concat(global_on);
    let levels = Array.isArray(node.gobj_trace_level) ? node.gobj_trace_level : [];
    if(levels.some((l) => held.indexOf(l) < 0)) {
        n++;
    }
    let kids = node.children;
    if(kids && typeof kids === "object") {
        for(let k of Object.keys(kids)) {
            n += count_own_traces(kids[k], gclass_on, global_on);
        }
    }
    return n;
}

/*  One of the three answers of a tree read; with the three in, the
 *  tree goes to the view. Without the two trace answers the tree is
 *  still shown, with no count.  */
function tree_answer(gobj, kw, failed)
{
    let priv = gobj.priv;
    if(kw.seq !== priv.tree_seq) {
        return;     /*  a Refresh asked for a newer one  */
    }
    priv.tree_parts[kw.what] = {
        failed:  failed,
        error:   kw.error_key ? {key: kw.error_key} : {text: kw.comment || ""},
        data:    kw.data
    };
    if(TREE_PARTS.some((p) => !priv.tree_parts[p])) {
        return;
    }
    let tree = priv.tree_parts.tree;
    let gon = priv.tree_parts.tree_gclass_on;
    let glon = priv.tree_parts.tree_global_on;
    let set_id = priv.tree_set_id;
    priv.tree_parts = {};
    priv.tree_set_id = null;
    if(tree.failed || !tree.data || typeof tree.data !== "object") {
        set_error(gobj, tree.failed ? tree.error : {key: "monitor no answer"});
        return;
    }

    let gclass_on = {};
    if(!gon.failed && Array.isArray(gon.data)) {
        for(let g of gon.data) {
            if(g && g.gclass && Array.isArray(g.trace_levels)) {
                gclass_on[g.gclass] = g.trace_levels;
            }
        }
    }
    let global_on = (!glon.failed && Array.isArray(glon.data)) ? glon.data : [];
    let root = tree.data[Object.keys(tree.data)[0]];
    priv.own_traces = (gon.failed || glon.failed) ? 0 : count_own_traces(root, gclass_on, global_on);
    priv.gclass_traces = Object.keys(gclass_on).length;
    set_error(gobj, (gon.failed || glon.failed) ? (gon.failed ? gon.error : glon.error) : null);

    if(priv.view && priv.view.tree) {
        gobj_send_event(priv.view.tree, "EV_LOAD_TREE", {tree: tree.data, set_id: set_id}, gobj);
    }
}

/*  The first value of a `[{..., trace_levels}]` answer, or `def`.  */
function first_trace_levels(data, def)
{
    if(Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object" &&
            data[0].trace_levels !== undefined) {
        return data[0].trace_levels;
    }
    return def;
}

/*  One answer of the four that make a gclass' trace levels. When the
 *  fourth is in -- or one failed -- the tree gets them.  */
function trace_info_answer(gobj, kw, failed)
{
    let priv = gobj.priv;
    let info = priv.info[kw.gclass];
    if(!info || info.seq !== kw.seq) {
        return;     /*  overtaken: the card was opened again since  */
    }
    if(failed) {
        info.error = info.error || kw.comment || t("monitor no answer");
    } else {
        let v = null;
        switch(kw.what) {
            case "gclass_levels":
            case "global_levels":
                v = first_trace_levels(kw.data, {});
                break;
            case "gclass_on":
                v = first_trace_levels(kw.data, []);
                break;
            case "global_on":
                v = Array.isArray(kw.data) ? kw.data : null;
                break;
            default:
                log_error(`${gobj_short_name(gobj)}: trace info answer of no part: ${kw.what}`);
                return;
        }
        if(v === null || typeof v !== "object") {
            log_warning(`${gobj_short_name(gobj)}: ${kw.what} of ${kw.gclass} is not what the ` +
                `command answers`);
            info.error = info.error || `${kw.what}: ?`;
        } else {
            info.parts[kw.what] = v;
        }
    }

    let have = TRACE_INFO_PARTS.filter((p) => info.parts[p] !== undefined).length;
    if(!info.error && have < TRACE_INFO_PARTS.length) {
        return;
    }
    let out = {gclass: kw.gclass, error: info.error, set_id: info.set_id};
    for(let p of TRACE_INFO_PARTS) {
        out[p] = info.parts[p];
    }
    delete priv.info[kw.gclass];
    if(priv.view && priv.view.tree) {
        gobj_send_event(priv.view.tree, "EV_TRACE_INFO", out, gobj);
    }
}




                    /***************************
                     *      Actions
                     ***************************/




/************************************************************
 *  The tree: Refresh was pressed.
 ************************************************************/
function ac_tree_wanted(gobj, event, kw, src)
{
    request_tree(gobj);
    return 0;
}

/************************************************************
 *  The tree: a card was opened, its gclass' levels are wanted.
 ************************************************************/
function ac_trace_info_wanted(gobj, event, kw, src)
{
    if(!kw || !kw.gclass) {
        log_error(`${gobj_short_name(gobj)}: trace levels wanted of no gclass`);
        return -1;
    }
    request_trace_info(gobj, kw.gclass, kw.set_id);
    return 0;
}

/************************************************************
 *  The tree: a trace set, one command per level.
 ************************************************************/
function ac_set_trace_level(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let levels = Array.isArray(kw.levels) ? kw.levels : [];
    if(!levels.length || ["gobj", "gclass", "global"].indexOf(kw.scope) < 0) {
        log_error(`${gobj_short_name(gobj)}: a trace set of no level or scope: '${kw.scope}'`);
        return -1;
    }
    let lines = [];
    for(let level of levels) {
        let set = kw.set ? 1 : 0;
        let line = null;
        switch(kw.scope) {
            case "gobj":
                line = yuno_command(gobj, "set-gobj-trace", {gobj: kw.gobj, level: level, set: set});
                break;
            case "gclass":
                line = yuno_command(gobj, "set-gclass-trace", {gclass: kw.gclass, level: level, set: set});
                break;
            default:
                line = yuno_command(gobj, "set-global-trace", {level: level, set: set});
                break;
        }
        if(!line) {
            set_error(gobj, {text: `${kw.gobj || kw.gclass}: ?`});
            return -1;  // Error already logged
        }
        lines.push(line);
    }
    let seq = ++priv.seq;
    priv.sets = {seq: seq, gclass: kw.gclass, pending: lines.length, failed: [],
                 set_id: (kw.set_id !== undefined)? kw.set_id: null};
    for(let line of lines) {
        request(gobj, "set", line, kw.gclass, seq);
    }
    return 0;
}

/************************************************************
 *  The tree: its gclass button, on a backend gclass.
 ************************************************************/
function ac_gclass_wanted(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!kw || !kw.gclass) {
        log_error(`${gobj_short_name(gobj)}: gclass wanted of no name`);
        return -1;
    }
    request(gobj, "gclass", yuno_command(gobj, "view-gclass", {gclass: kw.gclass}), kw.gclass, ++priv.seq);
    return 0;
}

/************************************************************
 *  The monitor: the answer of one request.
 *  {what, gclass, seq, result, comment, data, error_key}
 ************************************************************/
function ac_answer(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let failed = (typeof kw.result === "number" && kw.result < 0);

    switch(kw.what) {
        case "tree":
        case "tree_gclass_on":
        case "tree_global_on":
            tree_answer(gobj, kw, failed);
            return 0;

        case "gclass_levels":
        case "global_levels":
        case "gclass_on":
        case "global_on":
            if(failed && kw.error_key) {
                kw.comment = t(kw.error_key);
            }
            trace_info_answer(gobj, kw, failed);
            return 0;

        case "set": {
            let s = priv.sets;
            if(!s || s.seq !== kw.seq) {
                return 0;   /*  a newer set is in flight  */
            }
            if(failed) {
                s.failed.push(kw.error_key ? t(kw.error_key) : (kw.comment || ""));
            }
            s.pending--;
            if(s.pending > 0) {
                return 0;
            }
            priv.sets = null;
            set_error(gobj, s.failed.length ? {text: s.failed.join("; ")} : null);
            /*  Whatever was answered, what is on screen is read again:
             *  the boxes show the backend, never the click.  */
            request_tree(gobj, s.set_id);
            request_trace_info(gobj, s.gclass, s.set_id);
            return 0;
        }

        case "gclass":
            if(failed) {
                set_error(gobj, kw.error_key ? {key: kw.error_key} : {text: kw.comment || ""});
                return 0;
            }
            if(priv.view && priv.view.tree) {
                gobj_send_event(priv.view.tree, "EV_GCLASS_DESCRIPTION",
                    {gclass: kw.gclass, description: kw.data}, gobj);
            }
            return 0;

        default:
            log_error(`${gobj_short_name(gobj)}: answer of no request: '${kw.what}'`);
            return -1;
    }
}

/************************************************************
 *  The reader closed the window (✕): the view took itself
 *  down; the parent destroys this gobj.
 ************************************************************/
function ac_view_closed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let y = gobj_read_attr(gobj, "yuno") || {};
    priv.view = null;
    gobj_publish_event(gobj, "EV_YUNO_TREE_CLOSED", {key: y.key});
    return 0;
}

/************************************************************
 *  Asked to open again: bring the window to the front. With
 *  none (it could not be opened), say so and open it now.
 ************************************************************/
function ac_show_view(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.view) {
        log_error(`${gobj_short_name(gobj)}: the gobj tree has no window, opening it again`);
        return open_view(gobj);
    }
    if(priv.view.win) {
        gobj_send_event(priv.view.win, "EV_SHOW", {}, gobj);
    }
    return 0;
}

/************************************************************
 *  The app switched language.
 ************************************************************/
function ac_language_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    refresh_language(priv.$status, t);
    paint_status(gobj);
    return 0;
}




                    /***************************
                     *          FSM
                     ***************************/




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
            ["EV_TREE_WANTED",          ac_tree_wanted,         null],
            ["EV_TRACE_INFO_WANTED",    ac_trace_info_wanted,   null],
            ["EV_SET_TRACE_LEVEL",      ac_set_trace_level,     null],
            ["EV_GCLASS_WANTED",        ac_gclass_wanted,       null],
            ["EV_YUNO_TREE_ANSWER",     ac_answer,              null],
            ["EV_VIEW_CLOSED",          ac_view_closed,         null],
            ["EV_SHOW_VIEW",            ac_show_view,           null],
            ["EV_LANGUAGE_CHANGED",     ac_language_changed,    null]
        ]]
    ];

    /*---------------------------------------------*
     *          Events
     *---------------------------------------------*/
    const event_types = [
        ["EV_TREE_WANTED",          0],
        ["EV_TRACE_INFO_WANTED",    0],
        ["EV_SET_TRACE_LEVEL",      0],
        ["EV_GCLASS_WANTED",        0],
        ["EV_YUNO_TREE_ANSWER",     0],
        ["EV_VIEW_CLOSED",          0],
        ["EV_SHOW_VIEW",            0],
        ["EV_LANGUAGE_CHANGED",     0],
        ["EV_YUNO_TREE_REQUEST",    event_flag_t.EVF_OUTPUT_EVENT],
        ["EV_YUNO_TREE_CLOSED",     event_flag_t.EVF_OUTPUT_EVENT]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,  // lmt,
        attrs_table,
        PRIVATE_DATA,
        0,  // authz_table,
        0,  // command_table,
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
function register_c_agent_yuno_tree()
{
    return create_gclass(GCLASS_NAME);
}

export { register_c_agent_yuno_tree };
