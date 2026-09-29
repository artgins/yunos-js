/***********************************************************************
 *          monitor_helpers.js
 *
 *      Pure helpers of the Monitor workspace (C_AGENT_MONITOR): the
 *      scenario it watches, the command lines it sends, the links it can
 *      propose from the yunos' configs, the left-to-right layout of its
 *      graph, the message rates and the history window. No DOM, no gobj
 *      -- so each one is tested on its own (monitor_helpers.test.js).
 *
 *      A SCENARIO is the set of yunos one test involves and how the
 *      messages flow between them. It says WHERE the yunos are in one of
 *      two ways:
 *
 *        - `agent_url`: every yuno is on ONE agent, reached directly
 *          (wss://<node>:1993, C_MONITOR_LINK):
 *
 *              {
 *                  "name":      "stress test",
 *                  "agent_url": "wss://agent.example.com:1993",
 *                  "yunos": [
 *                      {"id": "stress", "label": "generator", "rate": "tx"},
 *                      {"id": "2120",   "label": "gate"},
 *                      {"id": "5120",   "label": "store", "service": "db"}
 *                  ],
 *                  "links": [["stress", "2120"], ["2120", "5120"]]
 *              }
 *
 *        - `node`: the yunos are reached through the CONTROL CENTER
 *          (`command-agent agent_id=<node>`), each on the node named by
 *          its own `node` or, by default, the scenario's -- so one
 *          scenario can span several nodes:
 *
 *              {
 *                  "node": "yunovatios-central",
 *                  "yunos": [
 *                      {"key": "sim", "id": "stress", "node": "yunovatios-controlador", "rate": "tx"},
 *                      {"key": "gate", "id": "2120"},
 *                      {"key": "tracks", "id": "5120"}
 *                  ],
 *                  "links": [["sim", "gate"], ["gate", "tracks"]]
 *              }
 *
 *      `id` is the agent's yuno id. `key` names the yuno in `links` and
 *      in `test` (default: its id); it is needed when two nodes carry the
 *      same id. `rate` says which direction is the yuno's throughput in
 *      the chart: "rx" (default, what it takes in) or "tx" (what it puts
 *      out -- a generator). `service` is the one whose counters are read
 *      (default: the yuno's role, which is what `stats-yuno` asks when no
 *      service is given).
 *
 *      An optional `test` block makes it a TEST, and gives the view its
 *      controls. Each control is a list of commands of ONE yuno (the
 *      generator, by its key), sent in order as `command-yuno id=<its id>
 *      service=<service> command=<command>`:
 *
 *              "test": {
 *                  "yuno": "stress", "service": "sim_controllers",
 *                  "start":  ["set-controllers controllers=10", "resume-generation"],
 *                  "pause":  ["pause-generation"],
 *                  "resume": ["resume-generation"],
 *                  "stop":   ["set-controllers controllers=0"]
 *              }
 *
 *      Restart is not written: it is stop, the counters of every yuno of
 *      the scenario asked to go to zero, and start. A scenario without
 *      `test` is a production one, and shows no control at all.
 *
 *      Every value that ends up in a command line (ids, services, nodes,
 *      the test's commands) is a NAME -- no spaces -- because every
 *      parameter travels inside the line: `C_IEVENT_CLI` takes a
 *      `kw.service` as the service a command is ADDRESSED to, so nothing
 *      can go in the kw.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/


/***************************************************************
 *              Constants
 ***************************************************************/
const SCENARIO_TEMPLATE = {
    name: "stress test",
    agent_url: "wss://agent.example.com:1993",
    yunos: [
        {id: "stress", label: "generator", rate: "tx"},
        {id: "2120", label: "gate"},
        {id: "5120", label: "store"}
    ],
    links: [["stress", "2120"], ["2120", "5120"]],
    test: {
        yuno: "stress",
        service: "generator",
        start: ["set-controllers controllers=10", "resume-generation"],
        pause: ["pause-generation"],
        resume: ["resume-generation"],
        stop: ["set-controllers controllers=0"]
    }
};

const RATE_DIRECTIONS = ["rx", "tx"];

/*  The controls a test block can declare, in the order they are shown.  */
const TEST_CONTROLS = ["start", "pause", "resume", "stop"];

/*  A command travels inside a `command-yuno` line: a name, then
 *  key=value parameters whose values carry no space.  */
const TEST_COMMAND_RE = /^[a-z][\w-]*( [\w.^-]+=\S*)*$/;
const NAME_RE = /^[\w.^-]+$/;


/***************************************************************
 *  Validate a scenario written as JSON text. Answers
 *      {ok: true,  scenario}                   or
 *      {ok: false, error: {key, detail}}
 *  where `key` is an i18n key and `detail` the part that names the
 *  culprit (not translated: it is data).
 *
 *  The scenario that comes out carries `place` ("direct" or
 *  "control_center") and every yuno its `key`, and its `node` when
 *  it is reached through the control center.
 ***************************************************************/
function parse_scenario(text)
{
    let raw;
    try {
        raw = JSON.parse(text);
    } catch(e) {
        return fail("scenario invalid json", e.message);
    }
    return validate_scenario(raw);
}

function is_name(v)
{
    return typeof v === "string" && NAME_RE.test(v.trim());
}

function validate_scenario(raw)
{
    if(!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return fail("scenario invalid json", "");
    }
    let url = raw.agent_url;
    let has_url = url !== undefined;
    let has_node = raw.node !== undefined;
    if(has_url && (typeof url !== "string" || !/^wss?:\/\/[^\s]+$/.test(url))) {
        return fail("scenario needs agent url", String(url));
    }
    if(has_node && !is_name(raw.node)) {
        return fail("scenario bad node", String(raw.node));
    }
    if(has_url && has_node) {
        return fail("scenario agent url or node", "");
    }
    if(!Array.isArray(raw.yunos) || raw.yunos.length === 0) {
        return fail("scenario needs yunos", "");
    }
    let place = has_url ? "direct" : "control_center";
    let default_node = has_node ? raw.node.trim() : "";

    let yunos = [];
    let seen = {};
    for(let y of raw.yunos) {
        if(!y || typeof y !== "object" || !is_name(y.id)) {
            return fail("scenario yuno needs id", JSON.stringify(y));
        }
        let id = y.id.trim();
        if(y.key !== undefined && !is_name(y.key)) {
            return fail("scenario yuno needs id", JSON.stringify(y));
        }
        let key = y.key !== undefined ? y.key.trim() : id;
        if(seen[key]) {
            return fail("scenario duplicate yuno", key);
        }
        seen[key] = true;
        let rate = y.rate === undefined ? "rx" : y.rate;
        if(RATE_DIRECTIONS.indexOf(rate) < 0) {
            return fail("scenario bad rate", key);
        }
        if(y.service !== undefined && !(y.service === "" || is_name(y.service))) {
            return fail("scenario bad service", key);
        }
        let node = "";
        if(y.node !== undefined) {
            if(place === "direct") {
                return fail("scenario agent url or node", key);
            }
            if(!is_name(y.node)) {
                return fail("scenario bad node", key);
            }
            node = y.node.trim();
        } else {
            node = default_node;
        }
        if(place === "control_center" && !node) {
            return fail("scenario needs a place", key);
        }
        let yuno = {
            key: key,
            id: id,
            label: (typeof y.label === "string" && y.label.trim()) ? y.label.trim() : key,
            rate: rate,
            service: (y.service || "").trim()
        };
        if(node) {
            yuno.node = node;
        }
        yunos.push(yuno);
    }

    let links = [];
    let raw_links = raw.links === undefined ? [] : raw.links;
    if(!Array.isArray(raw_links)) {
        return fail("scenario bad link", JSON.stringify(raw_links));
    }
    for(let l of raw_links) {
        if(!Array.isArray(l) || l.length !== 2 || !seen[l[0]] || !seen[l[1]] || l[0] === l[1]) {
            return fail("scenario bad link", JSON.stringify(l));
        }
        links.push([l[0], l[1]]);
    }

    let test = null;
    if(raw.test !== undefined) {
        let r = validate_test(raw.test, yunos, place, default_node);
        if(!r.ok) {
            return r;
        }
        test = r.test;
    }

    let scenario = {
        name: (typeof raw.name === "string" && raw.name.trim()) ? raw.name.trim() : "",
        place: place,
        yunos: yunos,
        links: links
    };
    if(place === "direct") {
        scenario.agent_url = url;
    } else if(default_node) {
        scenario.node = default_node;
    }
    if(test) {
        scenario.test = test;
    }
    return {ok: true, scenario: scenario};
}

/***************************************************************
 *  The test's `yuno` is the KEY of a yuno of the scenario, which
 *  gives its id and its node. On a direct scenario it may also be a
 *  yuno of the agent that is not drawn (a generator left out of the
 *  graph); through the control center it then needs a `node`.
 ***************************************************************/
function validate_test(raw, yunos, place, default_node)
{
    if(!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return fail("scenario bad test", JSON.stringify(raw));
    }
    if(!is_name(raw.yuno)) {
        return fail("scenario bad test", "yuno");
    }
    let service = raw.service === undefined ? "" : raw.service;
    if(!(service === "" || is_name(service))) {
        return fail("scenario bad test", "service");
    }
    if(raw.node !== undefined && (place === "direct" || !is_name(raw.node))) {
        return fail("scenario bad test", "node");
    }
    let yuno_key = raw.yuno.trim();
    let drawn = yunos.find((y) => y.key === yuno_key);
    let id = drawn ? drawn.id : yuno_key;
    let node = raw.node !== undefined ? raw.node.trim() : (drawn ? (drawn.node || "") : default_node);
    if(place === "control_center" && !node) {
        return fail("scenario needs a place", `test ${yuno_key}`);
    }
    let test = {yuno: yuno_key, id: id, service: service.trim()};
    if(node) {
        test.node = node;
    }
    let any = false;
    for(let c of TEST_CONTROLS) {
        if(raw[c] === undefined) {
            continue;
        }
        if(!Array.isArray(raw[c]) || raw[c].length === 0) {
            return fail("scenario bad test", c);
        }
        let list = [];
        for(let cmd of raw[c]) {
            let line = typeof cmd === "string" ? cmd.trim().replace(/\s+/g, " ") : "";
            if(!TEST_COMMAND_RE.test(line)) {
                return fail("scenario bad test command", `${c}: ${JSON.stringify(cmd)}`);
            }
            list.push(line);
        }
        test[c] = list;
        any = true;
    }
    if(!any) {
        return fail("scenario bad test", TEST_CONTROLS.join("/"));
    }
    return {ok: true, test: test};
}

/***************************************************************
 *  The controls a test offers, in order: its declared lists, plus
 *  restart whenever it can start.
 ***************************************************************/
function test_controls(test)
{
    if(!test) {
        return [];
    }
    let out = TEST_CONTROLS.filter((c) => Array.isArray(test[c]));
    if(test.start) {
        out.push("restart");
    }
    return out;
}

/***************************************************************
 *  The agent command lines one control sends, in order. Restart's
 *  resets are not here: they go to every yuno of the scenario.
 ***************************************************************/
function test_command_lines(test, control)
{
    let lists = control === "restart" ? [test.stop || [], test.start || []] : [test[control] || []];
    let head = `command-yuno id=${test.id}` + (test.service ? ` service=${test.service}` : "");
    let out = [];
    for(let list of lists) {
        for(let cmd of list) {
            out.push(`${head} command=${cmd}`);
        }
    }
    return out;
}

/***************************************************************
 *  The agent command lines of the readings, whole: every parameter
 *  in the line (see the header).
 ***************************************************************/
const lines = {
    cpu:    (y) => `stats-yuno id=${y.id} service=__yuno__`,
    app:    (y) => `stats-yuno id=${y.id}` + (y.service ? ` service=${y.service}` : ""),
    reset:  (y) => `stats-yuno id=${y.id}` + (y.service ? ` service=${y.service}` : "") + " stats=__reset__",
    config: (y) => `command-yuno id=${y.id} service=__yuno__ command=view-config`,
    yunos:  () => "list-yunos",
    /*  The agent pushes the readings (EV_YUNO_STATS) instead of being
     *  asked every period: one watch per requester, replaced by the next.  */
    watch:  (yunos, period_ms) => "watch-yuno-stats ids=" +
        unique(yunos.map((y) => y.service ? `${y.id}:${y.service}` : y.id)).join(",") +
        ` period=${period_ms}`,
    unwatch: () => "watch-yuno-stats stop=1"
};

function unique(list)
{
    return list.filter((v, i) => list.indexOf(v) === i);
}

/***************************************************************
 *  The distinct nodes of a scenario ("" for a direct one).
 ***************************************************************/
function scenario_nodes(scenario)
{
    let out = [];
    for(let y of scenario.yunos) {
        let n = y.node || "";
        if(out.indexOf(n) < 0) {
            out.push(n);
        }
    }
    return out;
}

/***************************************************************
 *  Links PROPOSED from the effective configs of the yunos
 *  (`view-config`): A -> B when A connects to a port B listens on.
 *
 *  What is read is the convention of the yuno configs, not a proof:
 *      listen   `__input*_url__`, `__top*_url__`
 *      connect  `__output*_url__`, `target_url`
 *  anywhere in the config (the `__json_config_variables__` of a gate,
 *  a global attr). An unresolved template `(^^...^^)` is skipped. A
 *  connection to a local address (127.0.0.1, localhost, 0.0.0.0) is
 *  looked for on the SAME node; any other host, on any node -- the
 *  host name is not matched, the port is. What the config says is not
 *  always what runs (a persisted attr can override it), which is why
 *  the result is a proposal the operator saves or not.
 *
 *  `entries` = [{key, node, config}]. Answers [[from_key, to_key]].
 ***************************************************************/
const LISTEN_KEY_RE = /^__(input|top)\w*_url__$/;
const CONNECT_KEY_RE = /^(__output\w*_url__|target_url)$/;
const URL_RE = /^[a-z][\w+.-]*:\/\/\[?([^\]\/:\s]+)\]?:(\d+)/i;
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0", "::1", "::"];

function config_endpoints(config)
{
    let listen = [];
    let connect = [];
    let walk = (v, k) => {
        if(typeof v === "string") {
            if(v.indexOf("(^^") >= 0) {
                return;
            }
            let leaf = String(k || "").split(".").pop();
            let m = v.match(URL_RE);
            if(!m) {
                return;
            }
            let ep = {host: m[1].toLowerCase(), port: parseInt(m[2], 10)};
            if(LISTEN_KEY_RE.test(leaf)) {
                listen.push(ep);
            } else if(CONNECT_KEY_RE.test(leaf)) {
                connect.push(ep);
            }
            return;
        }
        if(Array.isArray(v)) {
            v.forEach((x) => walk(x, k));
            return;
        }
        if(v && typeof v === "object") {
            for(let kk of Object.keys(v)) {
                walk(v[kk], kk);
            }
        }
    };
    walk(config, "");
    return {listen, connect};
}

function derive_links(entries)
{
    let eps = entries.map((e) => Object.assign({key: e.key, node: e.node || ""},
        config_endpoints(e.config)));
    let links = [];
    let has = (a, b) => links.some((l) => l[0] === a && l[1] === b);
    for(let a of eps) {
        for(let c of a.connect) {
            let local = LOCAL_HOSTS.indexOf(c.host) >= 0;
            for(let b of eps) {
                if(b.key === a.key || (local && b.node !== a.node)) {
                    continue;
                }
                if(b.listen.some((l) => l.port === c.port) && !has(a.key, b.key)) {
                    links.push([a.key, b.key]);
                }
            }
        }
    }
    return links;
}

function fail(key, detail)
{
    return {ok: false, error: {key: key, detail: detail || ""}};
}

/***************************************************************
 *  Left-to-right layered layout, following the data flow: a yuno
 *  sits one column right of the furthest yuno that feeds it (longest
 *  path from the sources). Inside a column the yunos keep the order
 *  they were declared in, and every column is centred on the tallest.
 *  A cycle does not hang it: whatever is left once the sources are
 *  exhausted goes one column past the last.
 *
 *  Yunos that exchange no message are not interleaved: each connected
 *  group is laid out on its own and the groups are stacked as
 *  horizontal BANDS, in the order their first yuno was declared -- two
 *  chains of two nodes read as two rows, not as one knot.
 *
 *  Answers {nodes: {id: {x, y, layer}}, edges: [{from, to, d, mx, my}],
 *  width, height}, in pixels; `d` is an SVG path.
 ***************************************************************/
function layout_graph(ids, links, opts)
{
    let o = Object.assign({card_w: 200, card_h: 120, gap_x: 72, gap_y: 24, pad: 12}, opts || {});

    let incoming = {};
    let outgoing = {};
    ids.forEach((id) => {
        incoming[id] = [];
        outgoing[id] = [];
    });
    (links || []).forEach(([a, b]) => {
        if(incoming[b] && outgoing[a]) {
            incoming[b].push(a);
            outgoing[a].push(b);
        }
    });

    /*  Connected groups, ignoring the direction.  */
    let group_of = {};
    let groups = [];
    for(let id of ids) {
        if(group_of[id] !== undefined) {
            continue;
        }
        let g = [];
        let stack = [id];
        group_of[id] = groups.length;
        while(stack.length) {
            let cur = stack.pop();
            g.push(cur);
            for(let nb of incoming[cur].concat(outgoing[cur])) {
                if(group_of[nb] === undefined) {
                    group_of[nb] = groups.length;
                    stack.push(nb);
                }
            }
        }
        groups.push(ids.filter((x) => g.indexOf(x) >= 0));
    }

    let col_height = (n) => n * o.card_h + Math.max(0, n - 1) * o.gap_y;
    let nodes = {};
    let top = o.pad;
    let max_cols = 0;
    for(let group of groups) {
        let layer = {};
        let pending = {};
        group.forEach((id) => {
            pending[id] = incoming[id].length;
        });
        let queue = group.filter((id) => pending[id] === 0);
        queue.forEach((id) => {
            layer[id] = 0;
        });
        while(queue.length) {
            let id = queue.shift();
            for(let next of outgoing[id]) {
                layer[next] = Math.max(layer[next] || 0, layer[id] + 1);
                pending[next]--;
                if(pending[next] === 0) {
                    queue.push(next);
                }
            }
        }
        let max_layer = -1;
        group.forEach((id) => {
            if(layer[id] !== undefined && pending[id] <= 0) {
                max_layer = Math.max(max_layer, layer[id]);
            }
        });
        group.forEach((id) => {
            if(layer[id] === undefined || pending[id] > 0) {
                layer[id] = max_layer + 1;
            }
        });

        let columns = [];
        group.forEach((id) => {
            let l = layer[id];
            if(!columns[l]) {
                columns[l] = [];
            }
            columns[l].push(id);
        });
        columns = columns.filter(Boolean);
        max_cols = Math.max(max_cols, columns.length);

        let tallest = Math.max(0, ...columns.map((c) => col_height(c.length)));
        columns.forEach((col, ci) => {
            let col_top = top + (tallest - col_height(col.length)) / 2;
            col.forEach((id, ri) => {
                nodes[id] = {
                    x: o.pad + ci * (o.card_w + o.gap_x),
                    y: col_top + ri * (o.card_h + o.gap_y),
                    layer: ci
                };
            });
        });
        top += tallest + o.gap_y * 2;
    }

    let edges = [];
    (links || []).forEach(([a, b]) => {
        let na = nodes[a];
        let nb = nodes[b];
        if(!na || !nb) {
            return;
        }
        let x1 = na.x + o.card_w;
        let y1 = na.y + o.card_h / 2;
        let x2 = nb.x;
        let y2 = nb.y + o.card_h / 2;
        if(x2 <= x1) {
            /*  A backward edge (cycle): leave by the bottom, come back below.  */
            let yb = Math.max(na.y, nb.y) + o.card_h + o.gap_y / 2;
            x1 = na.x + o.card_w / 2;
            y1 = na.y + o.card_h;
            x2 = nb.x + o.card_w / 2;
            y2 = nb.y + o.card_h;
            edges.push({
                from: a, to: b,
                d: `M${x1},${y1} C${x1},${yb} ${x2},${yb} ${x2},${y2}`,
                mx: (x1 + x2) / 2, my: yb
            });
            return;
        }
        let cx = (x1 + x2) / 2;
        edges.push({
            from: a, to: b,
            d: `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`,
            mx: cx, my: (y1 + y2) / 2
        });
    });

    return {
        nodes: nodes,
        edges: edges,
        width: o.pad * 2 + max_cols * o.card_w + Math.max(0, max_cols - 1) * o.gap_x,
        height: groups.length ? top - o.gap_y + o.pad : o.pad * 2
    };
}

/***************************************************************
 *  Messages per second in one direction ("rx"/"tx") from a stats
 *  answer. The yuno's own `<dir>Msgsec` is preferred: an application
 *  service computes it on its own timer, whoever reads. Without it the
 *  rate is derived from the `<dir>Msgs` counter and the previous
 *  reading, taken with a MONOTONIC clock (`now_ms`); a counter that
 *  went down was reset, and gives no rate this time.
 *
 *  Answers {rate: number|null, prev: {v, t}|null} -- keep `prev` for
 *  the next call.
 ***************************************************************/
function pick_rate(data, dir, prev, now_ms)
{
    if(!data || typeof data !== "object") {
        return {rate: null, prev: prev || null};
    }
    let own = data[dir + "Msgsec"];
    let count = data[dir + "Msgs"];
    let next = (typeof count === "number") ? {v: count, t: now_ms} : null;
    if(typeof own === "number") {
        return {rate: own, prev: next};
    }
    if(!next) {
        return {rate: null, prev: null};
    }
    if(!prev || typeof prev.v !== "number" || next.v < prev.v || now_ms <= prev.t) {
        return {rate: null, prev: next};
    }
    return {rate: (next.v - prev.v) * 1000 / (now_ms - prev.t), prev: next};
}

/***************************************************************
 *  Keep only the rows of the last `window_s` seconds (`tm` in seconds).
 ***************************************************************/
function prune_history(rows, now_s, window_s)
{
    let from = now_s - window_s;
    let i = 0;
    while(i < rows.length && rows[i].tm < from) {
        i++;
    }
    if(i > 0) {
        rows.splice(0, i);
    }
    return rows;
}

/***************************************************************
 *  The band a cpu % belongs to, for the colour of its card.
 ***************************************************************/
function cpu_level(cpu)
{
    if(typeof cpu !== "number") {
        return "unknown";
    }
    if(cpu >= 85) {
        return "high";
    }
    if(cpu >= 60) {
        return "mid";
    }
    return "low";
}

/***************************************************************
 *  What the agent says of a yuno, as one word for its card.
 ***************************************************************/
function yuno_run_state(row)
{
    if(!row) {
        return "missing";
    }
    if(row.yuno_disabled) {
        return "disabled";
    }
    if(!row.yuno_running) {
        return "stopped";
    }
    if(!row.yuno_playing) {
        return "paused";
    }
    return "playing";
}

/***************************************************************
 *  A rate for a card: whole messages, or a dash when unknown.
 ***************************************************************/
function fmt_rate(v)
{
    if(typeof v !== "number" || !isFinite(v)) {
        return "–";
    }
    return String(Math.round(v));
}

export {
    SCENARIO_TEMPLATE,
    test_controls,
    test_command_lines,
    lines,
    scenario_nodes,
    config_endpoints,
    derive_links,
    parse_scenario,
    validate_scenario,
    layout_graph,
    pick_rate,
    prune_history,
    cpu_level,
    yuno_run_state,
    fmt_rate,
};
