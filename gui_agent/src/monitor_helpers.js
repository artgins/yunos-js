/***********************************************************************
 *          monitor_helpers.js
 *
 *      Pure helpers of the Monitor workspace (C_AGENT_MONITOR): the
 *      scenario it watches, the left-to-right layout of its graph, the
 *      message rates and the history window. No DOM, no gobj -- so each
 *      one is tested on its own (monitor_helpers.test.js).
 *
 *      A SCENARIO is the set of yunos one test involves, on ONE agent,
 *      and how the messages flow between them:
 *
 *          {
 *              "name":      "stress test",
 *              "agent_url": "wss://agent.example.com:1993",
 *              "yunos": [
 *                  {"id": "stress", "label": "generator", "rate": "tx"},
 *                  {"id": "2120",   "label": "gate"},
 *                  {"id": "5120",   "label": "store", "service": "db"}
 *              ],
 *              "links": [["stress", "2120"], ["2120", "5120"]]
 *          }
 *
 *      `id` is the agent's yuno id. `rate` says which direction is the
 *      yuno's throughput in the chart: "rx" (default, what it takes in)
 *      or "tx" (what it puts out -- a generator). `service` is the one
 *      whose counters are read (default: the yuno's role, which is what
 *      `stats-yuno` asks when no service is given).
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
    links: [["stress", "2120"], ["2120", "5120"]]
};

const RATE_DIRECTIONS = ["rx", "tx"];


/***************************************************************
 *  Validate a scenario written as JSON text. Answers
 *      {ok: true,  scenario}                   or
 *      {ok: false, error: {key, detail}}
 *  where `key` is an i18n key and `detail` the part that names the
 *  culprit (not translated: it is data).
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

function validate_scenario(raw)
{
    if(!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return fail("scenario invalid json", "");
    }
    let url = raw.agent_url;
    if(typeof url !== "string" || !/^wss?:\/\/[^\s]+$/.test(url)) {
        return fail("scenario needs agent url", String(url === undefined ? "" : url));
    }
    if(!Array.isArray(raw.yunos) || raw.yunos.length === 0) {
        return fail("scenario needs yunos", "");
    }

    let yunos = [];
    let seen = {};
    for(let y of raw.yunos) {
        if(!y || typeof y !== "object" || typeof y.id !== "string" || !y.id.trim()) {
            return fail("scenario yuno needs id", JSON.stringify(y));
        }
        let id = y.id.trim();
        if(seen[id]) {
            return fail("scenario duplicate yuno", id);
        }
        seen[id] = true;
        let rate = y.rate === undefined ? "rx" : y.rate;
        if(RATE_DIRECTIONS.indexOf(rate) < 0) {
            return fail("scenario bad rate", id);
        }
        /*  It travels inside the command line (`stats-yuno service=<it>`),
         *  so a name, not free text.  */
        if(y.service !== undefined &&
                (typeof y.service !== "string" || !/^[\w.^-]*$/.test(y.service.trim()))) {
            return fail("scenario bad service", id);
        }
        yunos.push({
            id: id,
            label: (typeof y.label === "string" && y.label.trim()) ? y.label.trim() : id,
            rate: rate,
            service: (y.service || "").trim()
        });
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

    return {
        ok: true,
        scenario: {
            name: (typeof raw.name === "string" && raw.name.trim()) ? raw.name.trim() : "",
            agent_url: url,
            yunos: yunos,
            links: links
        }
    };
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

    let layer = {};
    let pending = {};
    ids.forEach((id) => {
        pending[id] = incoming[id].length;
    });
    let queue = ids.filter((id) => pending[id] === 0);
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
    ids.forEach((id) => {
        if(layer[id] !== undefined && pending[id] <= 0) {
            max_layer = Math.max(max_layer, layer[id]);
        }
    });
    ids.forEach((id) => {
        if(layer[id] === undefined || pending[id] > 0) {
            layer[id] = max_layer + 1;
        }
    });

    let columns = [];
    ids.forEach((id) => {
        let l = layer[id];
        if(!columns[l]) {
            columns[l] = [];
        }
        columns[l].push(id);
    });
    columns = columns.filter(Boolean);

    let col_height = (n) => n * o.card_h + Math.max(0, n - 1) * o.gap_y;
    let tallest = Math.max(0, ...columns.map((c) => col_height(c.length)));

    let nodes = {};
    columns.forEach((col, ci) => {
        let top = o.pad + (tallest - col_height(col.length)) / 2;
        col.forEach((id, ri) => {
            nodes[id] = {
                x: o.pad + ci * (o.card_w + o.gap_x),
                y: top + ri * (o.card_h + o.gap_y),
                layer: ci
            };
        });
    });

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
        width: o.pad * 2 + columns.length * o.card_w + Math.max(0, columns.length - 1) * o.gap_x,
        height: o.pad * 2 + tallest + o.gap_y
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
    parse_scenario,
    validate_scenario,
    layout_graph,
    pick_rate,
    prune_history,
    cpu_level,
    yuno_run_state,
    fmt_rate,
};
