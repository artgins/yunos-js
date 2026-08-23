/***********************************************************************
 *          agent_helpers.js
 *
 *      The logic of this console that is DATA IN, DATA OUT: no gobj, no
 *      DOM, no i18next, no imports at all. Two reasons it lives here
 *      instead of inside the views.
 *
 *      1. It is the part that can be TESTED. Everything else in this app
 *         needs a running yuno, a shell and a backend answering over a
 *         websocket, which is what `scripts/qa.mjs` is for; these are
 *         plain functions with edge cases, and edge cases are what a unit
 *         test is good at (see agent_helpers.test.js). Same split
 *         gui_treedb made with `tranger_helpers.js`.
 *
 *      2. Five of them were DUPLICATED verbatim between the two node
 *         pickers (`version_tuple` / `version_gte` / `version_cmp` /
 *         `node_id` / `parse_agent_line`) and `esc` sat in three files.
 *         Identical copies today, and the kind of thing that quietly
 *         diverges the first time one of them is fixed.
 *
 *      What deliberately did NOT move here: anything reading a gobj attr
 *      or touching the DOM. `expand_shortkey` stays in the console
 *      because it reads the shortkey dict off the config service; what
 *      moved is its pure half, `apply_shortkey(shortkeys, cmd)`.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/


                    /***************************
                     *      Versions
                     ***************************/


/***************************************************************
 *  A dotted version as numbers. Missing or non-numeric components
 *  count as 0, so "7.7" and "7.7.0" compare equal and a stray
 *  "7.x.1" does not throw.
 ***************************************************************/
function version_tuple(v)
{
    return String(v || "").split(".").map((x) => parseInt(x, 10) || 0);
}

/***************************************************************
 *  Is a >= b? ("7.7.0" >= "7.7.0" -> true). An empty `b` accepts
 *  everything, which is how the Terminal workspace lists nodes of
 *  every agent version while Commands/Statistics/Schemas ask for
 *  7.7.0 (the marker of controlcenter command/stats forwarding).
 ***************************************************************/
function version_gte(a, b)
{
    if(!b) {
        return true;
    }
    let A = version_tuple(a);
    let B = version_tuple(b);
    let n = Math.max(A.length, B.length);
    for(let i = 0; i < n; i++) {
        let d = (A[i] || 0) - (B[i] || 0);
        if(d !== 0) {
            return d > 0;
        }
    }
    return true;
}

/***************************************************************
 *  Tabulator column sorter: compare two dotted versions NUMERICALLY,
 *  so 7.10.0 sorts above 7.9.0 — which a plain string sort gets
 *  backwards. Returns the ascending delta; Tabulator flips it for a
 *  "desc" sort.
 ***************************************************************/
function version_cmp(a, b)
{
    let A = version_tuple(a);
    let B = version_tuple(b);
    let n = Math.max(A.length, B.length);
    for(let i = 0; i < n; i++) {
        let d = (A[i] || 0) - (B[i] || 0);
        if(d !== 0) {
            return d;
        }
    }
    return 0;
}


                    /***************************
                     *      Nodes
                     ***************************/


/***************************************************************
 *  A node's id for selection and routing: the hostname when the
 *  agent reports one, else its uuid.
 ***************************************************************/
function node_id(n)
{
    return (n && (n.host || n.uuid)) || "";
}

/***************************************************************
 *  One `list-agents` line into a node record. The agent answers
 *  free text, e.g.
 *
 *      Yuneta agent (yuneta_agent, 7.12.0) UUID:abc-123 HOSTNAME:'nitro'
 *
 *  so this is four regexes and no assumptions: a field that is not
 *  there comes back as "" rather than undefined, because these values
 *  reach Tabulator cells and a `undefined` renders as the word.
 ***************************************************************/
function parse_agent_line(s)
{
    s = String(s || "");
    let uuid = (/UUID:(\S+)/.exec(s) || [])[1] || "";
    let rv   = /\(([^,]+),\s*([^)]+)\)/.exec(s);
    let host = (/HOSTNAME:'([^']*)'/.exec(s) || [])[1] || "";
    return {
        uuid:    uuid,
        role:    rv ? rv[1].trim() : "",
        version: rv ? rv[2].trim() : "",
        host:    host
    };
}


                    /***************************
                     *      Rendering
                     ***************************/


/***************************************************************
 *  HTML-escape a value that goes into a formatter's markup string.
 *  Tabulator formatters and the stats cards build HTML by hand, and
 *  every string in them comes from an agent — a role, a hostname, a
 *  counter name — so it gets escaped.
 ***************************************************************/
function esc(s)
{
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => {
        return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c];
    });
}

/***************************************************************
 *  Format a counter. Integers get "." thousands grouping with a
 *  FIXED separator, never `Intl` + `navigator.language`: a browser
 *  reporting a non-standard language throws `RangeError: invalid
 *  language tag` there, and Playwright's firefox reports the literal
 *  string "undefined" (which is how this app learned).
 ***************************************************************/
function fmt_value(v)
{
    if(v === null || v === undefined) {
        return "";
    }
    if(typeof v === "number" && Number.isInteger(v)) {
        let neg = v < 0 ? "-" : "";
        let s = String(Math.abs(v));
        return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
    return String(v);
}


                    /***************************
                     *      Console commands
                     ***************************/


/***************************************************************
 *  Split a command line into tokens, quote-aware ('…' and "…"),
 *  the way ycli does it. Empty quotes ARE a token — `error ""`
 *  passes an empty argument on purpose — which is what `has`
 *  tracks: a token is emitted because something was seen, not
 *  because characters accumulated.
 ***************************************************************/
function split_args(s)
{
    let tokens = [];
    let cur = "";
    let has = false;      /*  saw a char (even in empty quotes) → emit a token  */
    let quote = null;
    for(let i = 0; i < String(s || "").length; i++) {
        let ch = s[i];
        if(quote) {
            if(ch === quote) {
                quote = null;
            } else {
                cur += ch;
            }
            has = true;
        } else if(ch === "\"" || ch === "'") {
            quote = ch;
            has = true;
        } else if(ch === " " || ch === "\t") {
            if(has) {
                tokens.push(cur);
                cur = "";
                has = false;
            }
        } else {
            cur += ch;
            has = true;
        }
    }
    if(has) {
        tokens.push(cur);
    }
    return tokens;
}

/***************************************************************
 *  ycli's shortkeys: the FIRST token of a command is looked up in a
 *  {key: template} dict, and a hit expands to the template with
 *  `$1 $2 …` replaced by the following positional args.
 *
 *  The substitution runs HIGH TO LOW on purpose: replacing $1 first
 *  would eat the "$1" inside "$10" and leave a stray "0".
 *
 *  No match (or no dict) returns the command untouched — a shortkey
 *  manager must never swallow what the operator typed.
 ***************************************************************/
function apply_shortkey(shortkeys, cmd)
{
    if(!shortkeys || typeof shortkeys !== "object") {
        return cmd;
    }
    let tokens = split_args(cmd);
    if(tokens.length === 0) {
        return cmd;
    }
    let key = tokens[0];
    if(!Object.prototype.hasOwnProperty.call(shortkeys, key)) {
        return cmd;
    }
    let out = shortkeys[key];
    let args = tokens.slice(1);
    for(let i = args.length; i >= 1; i--) {
        out = out.split("$" + i).join(args[i - 1]);
    }
    return out;
}

/***************************************************************
 *  Normalize a persisted command history into deduped entries
 *  `{cmd, count, last}`, most-recently-used first.
 *
 *  It accepts the LEGACY format too — a plain array of strings with
 *  repetitions — because a browser that used an older build still
 *  holds one: duplicates collapse into a single entry whose `count`
 *  is the number of occurrences, and the original order survives via
 *  a synthetic descending `last`.
 *
 *  `now` is a parameter so a test can pin it; callers omit it.
 ***************************************************************/
function normalize_history(list, now)
{
    let entries = [];
    let index = {};
    let stamp = (now === undefined) ? Date.now() : now;
    for(let it of (Array.isArray(list) ? list : [])) {
        let is_entry = it && typeof it === "object";
        let cmd = is_entry ? it.cmd : it;
        if(typeof cmd !== "string" || !cmd) {
            continue;
        }
        let count = (is_entry && it.count > 0) ? it.count : 1;
        if(Object.prototype.hasOwnProperty.call(index, cmd)) {
            entries[index[cmd]].count += count;
            continue;
        }
        index[cmd] = entries.length;
        entries.push({
            cmd:   cmd,
            count: count,
            last:  (is_entry && it.last > 0) ? it.last : stamp - entries.length
        });
    }
    return entries;
}


/***************************************************************
 *  Addressing a SERVICE behind a node's agent.
 *
 *  A managed yuno is reached with the agent's `command-yuno id=<yuno>`.
 *  The AGENT ITSELF is not a managed yuno -- it never appears in
 *  `list-yunos` -- but it runs the same kind of services, its own
 *  treedbs included (`treedb_yuneta_agent`, `treedb_system_schema`,
 *  `treedb_authzs`), and it reaches them with its own `command-agent
 *  service=<svc>`.
 *
 *  So the two differ in ONE line, and this is that line: everything
 *  else -- discovery, the treedb views, the routing adapter -- is the
 *  same. `AGENT_YUNO_ID` is the sentinel this app uses for the agent
 *  wherever a yuno id is expected; it cannot collide with a real one,
 *  which is a number.
 ***************************************************************/
const AGENT_YUNO_ID = "__agent__";

/*  The treedb every yuno with a C_TREEDB keeps its own schemas in, as
 *  data: treedbs -> topics -> cols. The Schemas workspace exists for
 *  it, and three files address it by name — the tab that opens it, the
 *  viewer that decides which landing it gets, and the picker that marks
 *  a yuno without one.  */
const SYSTEM_TREEDB = "treedb_system_schema";


function is_agent_yuno(yuno_id)
{
    return yuno_id === AGENT_YUNO_ID;
}

function cmd2agent_service(yuno_id, service, command)
{
    if(is_agent_yuno(yuno_id)) {
        return `command-agent service="${service}" command="${command}"`;
    }
    return `command-yuno id="${yuno_id}" service="${service}" command="${command}"`;
}


/***************************************************************
 *  cert_host_of_config(config, port)
 *
 *      -> the FQDN of the certificate the yuno's TOP gate serves, ""
 *      when the config names none.
 *
 *      A certificate's filename is the name a client MUST use, which
 *      makes it the best evidence a scan can find. Some yunos say it as
 *      the config VARIABLE `__ssl_certificate__`; the rest say it where
 *      it is actually used -- a plain `ssl_certificate` inside the
 *      `crypto` of the gate -- and reading only the first form is how a
 *      backend whose cert says `hidrauliaconnect.es` got proposed as
 *      `demo.hidrauliaconnect.es`, its realm id, which resolves nowhere.
 *
 *      A yuno holds several gates (an mqtt one, a raw one) and they may
 *      carry different certificates, so the gate whose url wears the TOP
 *      port wins; any certificate is better than none, so the first one
 *      found answers when no url matches.
 *
 *      A wildcard certificate (`*.example.com.crt`) names no host and is
 *      skipped: the guess has to be something a browser can dial.
 ***************************************************************/
/***************************************************************
 *  Split the tail of a workspace-home route into the node id and
 *  whatever comes after it.
 *
 *  On a cold load a deep node route cannot resolve: the tab's
 *  route is registered when the node is OPENED, so the shell falls
 *  back to the workspace home (`/<ws>/node`) and hands the whole
 *  rest as `subpath` -- `<id>/treedb_authzs/__graphs__`, not
 *  `<id>`. Reading all of it as the id matched no node, so the
 *  restore gave up and landed on the first tab: F5 on a topic
 *  answered with somebody else's default. The id is the FIRST
 *  segment; the rest belongs to the tab and travels with it.
 *
 *  The id is percent-encoded in the route (a qualified pkey
 *  carries a 0x1F), so only that segment is decoded -- decoding
 *  the whole tail first would turn an encoded slash inside the id
 *  into a separator.
 ***************************************************************/
function split_node_subpath(subpath)
{
    let sub = String(subpath || "");

    if(!sub) {
        return {id: "", tail: ""};
    }

    let slash = sub.indexOf("/");
    let raw_id = (slash < 0) ? sub : sub.slice(0, slash);
    let tail   = (slash < 0) ? ""  : sub.slice(slash + 1);

    let id;
    try {
        id = decodeURIComponent(raw_id);
    } catch(e) {
        id = raw_id;    /*  malformed % escape: use the raw segment  */
    }

    return {id: id, tail: tail};
}

function cert_host_of_config(config, port)
{
    let found = [];

    let walk = (node, depth) => {
        if(!node || typeof node !== "object" || depth > 12 || found.length > 32) {
            return;
        }
        if(Array.isArray(node)) {
            for(let item of node) {
                walk(item, depth + 1);
            }
            return;
        }
        let crypto = node.crypto;
        if(crypto && typeof crypto === "object" &&
                typeof crypto.ssl_certificate === "string" && crypto.ssl_certificate) {
            found.push({
                cert: crypto.ssl_certificate,
                url:  (typeof node.url === "string") ? node.url : ""
            });
        }
        for(let key of Object.keys(node)) {
            walk(node[key], depth + 1);
        }
    };
    walk(config, 0);

    let host_of = (path) => {
        let base = String(path).split("/").pop() || "";
        base = base.replace(/\.(crt|pem|cer)$/i, "");
        if(!base || base.startsWith("*.")) {
            return "";
        }
        return base;
    };

    if(port) {
        for(let f of found) {
            if(f.url && f.url.match(new RegExp(":" + port + "\\s*$"))) {
                let host = host_of(f.cert);
                if(host) {
                    return host;
                }
            }
        }
    }
    for(let f of found) {
        let host = host_of(f.cert);
        if(host) {
            return host;
        }
    }
    return "";
}


export {
    split_node_subpath,
    AGENT_YUNO_ID,
    SYSTEM_TREEDB,
    is_agent_yuno,
    cmd2agent_service,
    version_tuple,
    version_gte,
    version_cmp,
    node_id,
    parse_agent_line,
    esc,
    fmt_value,
    split_args,
    apply_shortkey,
    normalize_history,
    cert_host_of_config,
};
