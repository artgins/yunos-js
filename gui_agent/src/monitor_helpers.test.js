/***********************************************************************
 *          monitor_helpers.test.js
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, it, expect} from "vitest";

import {
    SCENARIO_TEMPLATE,
    scenario_controls,
    run_state_of_action,
    run_state_of_runs,
    control_refused_by,
    chart_x_window,
    resources_of,
    free_level,
    fmt_mem_kb,
    some_step_done,
    charts_follow,
    action_steps,
    scenario_document,
    selection_scenario,
    cc_lacks_command,
    lines,
    scenario_nodes,
    config_endpoints,
    derive_links,
    parse_scenario,
    validate_scenario,
    layout_graph,
    only_emitters,
    queue_elsewhere,
    queue_in_stats,
    pick_rate,
    prune_history,
    cpu_level,
    yuno_run_state,
    fmt_rate,
    switch_steps,
    switch_is_on,
    node_label,
    series_label,
} from "./monitor_helpers.js";


describe("parse_scenario", () => {
    it("accepts the template and fills the defaults", () => {
        let r = parse_scenario(JSON.stringify(SCENARIO_TEMPLATE));
        expect(r.ok).toBe(true);
        expect(r.scenario.id).toBe("stress-test");
        expect(r.scenario.place).toBe("control_center");
        expect(r.scenario.yunos.map((y) => y.id)).toEqual(["stress", "2120", "5120"]);
        expect(r.scenario.yunos[0].rate).toBe("tx");
        expect(r.scenario.yunos[1].rate).toBe("rx");
        expect(r.scenario.yunos[1].service).toBe("");
        expect(r.scenario.yunos.every((y) => y.node === "my-node")).toBe(true);
        expect(r.scenario.links).toEqual([["sim", "gate"], ["gate", "store"]]);
        expect(r.scenario.view).toEqual({mode: "graph"});
    });

    it("refuses an id that cannot go in a ref, and a bad view", () => {
        expect(parse_scenario('{"id":"a^b","node":"n","yunos":[{"id":"a"}]}').error.key)
            .toBe("scenario bad id");
        expect(parse_scenario('{"id":"a b","node":"n","yunos":[{"id":"a"}]}').error.key)
            .toBe("scenario bad id");
        expect(parse_scenario('{"id":".hidden","node":"n","yunos":[{"id":"a"}]}').error.key)
            .toBe("scenario bad id");
        expect(parse_scenario(`{"id":"${"x".repeat(201)}","node":"n","yunos":[{"id":"a"}]}`).error.key)
            .toBe("scenario bad id");
        expect(parse_scenario(`{"id":"${"x".repeat(200)}","node":"n","yunos":[{"id":"a"}]}`).ok)
            .toBe(true);
        expect(parse_scenario('{"node":"n","yunos":[{"id":"a"}],"view":{"mode":"pie"}}').error.key)
            .toBe("scenario bad view");
        expect(parse_scenario('{"node":"n","yunos":[{"id":"a"}],"view":{"mode":"cards"}}').scenario.view)
            .toEqual({mode: "cards"});
    });

    it("uses the id as the label when there is none", () => {
        let r = parse_scenario('{"agent_url":"wss://h:1993","yunos":[{"id":"7"}]}');
        expect(r.ok).toBe(true);
        expect(r.scenario.yunos[0].label).toBe("7");
        expect(r.scenario.links).toEqual([]);
    });

    it("names what is wrong", () => {
        expect(parse_scenario("{").error.key).toBe("scenario invalid json");
        expect(parse_scenario('{"yunos":[{"id":"a"}]}').error.key).toBe("scenario needs a place");
        expect(parse_scenario('{"agent_url":"https://h","yunos":[{"id":"a"}]}').error.key)
            .toBe("scenario needs agent url");
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[]}').error.key).toBe("scenario needs yunos");
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"label":"x"}]}').error.key)
            .toBe("scenario yuno needs id");
        let dup = parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a"},{"id":"a"}]}');
        expect(dup.error).toEqual({key: "scenario duplicate yuno", detail: "a"});
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a","rate":"in"}]}').error.key)
            .toBe("scenario bad rate");
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a","service":"x y"}]}').error.key)
            .toBe("scenario bad service");
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a","service":"gate_central"}]}').ok)
            .toBe(true);
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a"}],"links":[["a","b"]]}').error.key)
            .toBe("scenario bad link");
        expect(parse_scenario('{"agent_url":"wss://h","yunos":[{"id":"a"}],"links":[["a","a"]]}').error.key)
            .toBe("scenario bad link");
    });
});


describe("layout_graph", () => {
    const O = {card_w: 100, card_h: 50, gap_x: 20, gap_y: 10, pad: 0};

    it("puts a chain left to right, one column per hop", () => {
        let g = layout_graph(["a", "b", "c"], [["a", "b"], ["b", "c"]], O);
        expect([g.nodes.a.layer, g.nodes.b.layer, g.nodes.c.layer]).toEqual([0, 1, 2]);
        expect(g.nodes.b.x).toBe(120);
        expect(g.width).toBe(340);
        expect(g.edges.length).toBe(2);
        expect(g.edges[0].d.startsWith("M100,25")).toBe(true);
    });

    it("places a yuno after its FURTHEST feeder, and centres short columns", () => {
        let g = layout_graph(["s1", "s2", "gate", "db"],
            [["s1", "gate"], ["s2", "gate"], ["gate", "db"], ["s1", "db"]], O);
        expect(g.nodes.db.layer).toBe(2);
        expect(g.nodes.s1.y).toBe(0);
        expect(g.nodes.s2.y).toBe(60);
        expect(g.nodes.gate.y).toBe(30);
    });

    it("stacks independent chains as bands, not interleaved", () => {
        let g = layout_graph(["sim", "gate_co", "tracks_co", "gate_ce", "tracks_ce"],
            [["sim", "gate_co"], ["gate_co", "tracks_co"], ["gate_ce", "tracks_ce"]], O);
        expect([g.nodes.sim.layer, g.nodes.gate_co.layer, g.nodes.tracks_co.layer]).toEqual([0, 1, 2]);
        expect([g.nodes.gate_ce.layer, g.nodes.tracks_ce.layer]).toEqual([0, 1]);
        expect(g.nodes.sim.y).toBe(g.nodes.tracks_co.y);
        expect(g.nodes.gate_ce.y).toBeGreaterThan(g.nodes.sim.y + O.card_h);
        expect(g.nodes.gate_ce.y).toBe(g.nodes.tracks_ce.y);
        expect(g.width).toBe(340);
    });

    it("does not hang on a cycle", () => {
        let g = layout_graph(["a", "b"], [["a", "b"], ["b", "a"]], O);
        expect(Object.keys(g.nodes).sort()).toEqual(["a", "b"]);
        expect(g.edges.length).toBe(2);
    });

    it("stacks shorter cards with their own heights; an edge meets each at its middle", () => {
        let g = layout_graph(["s1", "s2", "gate"], [["s1", "gate"], ["s2", "gate"]],
            Object.assign({}, O, {heights: {s1: 30, s2: 30}}));
        expect([g.nodes.s1.h, g.nodes.s2.h, g.nodes.gate.h]).toEqual([30, 30, 50]);
        expect(g.nodes.s1.y).toBe(0);
        expect(g.nodes.s2.y).toBe(40);       /*  30 + the gap, not 50 + the gap  */
        expect(g.nodes.gate.y).toBe(10);     /*  centred on a column 70 high  */
        expect(g.edges[0].d.startsWith("M100,15")).toBe(true);
        expect(g.height).toBe(80);       /*  the column, and one gap below it  */
    });

    it("lays out yunos with no links as one column", () => {
        let g = layout_graph(["a", "b"], [], O);
        expect(g.nodes.a.x).toBe(g.nodes.b.x);
        expect(g.edges).toEqual([]);
    });
});


describe("where an edge leaves its card", () => {
    it("a forward edge starts at the right side of its card, a backward one at its bottom", () => {
        let g = layout_graph(["a", "b"], [["a", "b"]], {card_w: 200, card_h: 100});
        let fwd = g.edges[0];
        expect(fwd.sx).toBe(g.nodes.a.x + 200);
        expect(fwd.sy).toBe(g.nodes.a.y + 50);
        expect(fwd.back).toBe(false);
        /*  A cycle stacks its cards in one column: its edges go backward  */
        let c = layout_graph(["a", "b"], [["a", "b"], ["b", "a"]], {card_w: 200, card_h: 100});
        let back = c.edges.find((e) => e.from === "b");
        expect(back.back).toBe(true);
        expect(back.sx).toBe(c.nodes.b.x + 100);
        expect(back.sy).toBe(c.nodes.b.y + c.nodes.b.h);
    });
});

describe("pick_rate", () => {
    it("prefers the rate the yuno computes itself", () => {
        let r = pick_rate({rxMsgs: 10, rxMsgsec: 500}, "rx", null, 1000);
        expect(r.rate).toBe(500);
        expect(r.prev).toEqual({v: 10, t: 1000});
    });

    it("derives it from the counter otherwise", () => {
        let r1 = pick_rate({txMsgs: 100}, "tx", null, 1000);
        expect(r1.rate).toBe(null);
        let r2 = pick_rate({txMsgs: 1100}, "tx", r1.prev, 3000);
        expect(r2.rate).toBe(500);
    });

    it("gives no rate across a reset of the counter", () => {
        let r = pick_rate({txMsgs: 5}, "tx", {v: 900, t: 0}, 2000);
        expect(r.rate).toBe(null);
        expect(r.prev).toEqual({v: 5, t: 2000});
    });

    it("gives no rate when there is nothing to read", () => {
        expect(pick_rate({cpu: 3}, "rx", null, 1).rate).toBe(null);
        expect(pick_rate(null, "rx", null, 1).rate).toBe(null);
    });
});


describe("small helpers", () => {
    it("prunes the history to the window", () => {
        let rows = [{tm: 1}, {tm: 5}, {tm: 9}];
        expect(prune_history(rows, 10, 6).map((r) => r.tm)).toEqual([5, 9]);
    });

    it("bands the cpu", () => {
        expect(cpu_level(undefined)).toBe("unknown");
        expect(cpu_level(10)).toBe("low");
        expect(cpu_level(60)).toBe("mid");
        expect(cpu_level(99)).toBe("high");
    });

    it("reads the agent's row of a yuno", () => {
        expect(yuno_run_state(null)).toBe("missing");
        expect(yuno_run_state({yuno_disabled: true})).toBe("disabled");
        expect(yuno_run_state({yuno_running: false})).toBe("stopped");
        expect(yuno_run_state({yuno_running: true, yuno_playing: false})).toBe("paused");
        expect(yuno_run_state({yuno_running: true, yuno_playing: true})).toBe("playing");
    });

    it("formats a rate", () => {
        expect(fmt_rate(499.6)).toBe("500");
        expect(fmt_rate(null)).toBe("–");
    });
});


describe("actions", () => {
    const base = {node: "n", yunos: [{key: "g", id: "7"}, {key: "s", id: "8", node: "m"}]};
    const with_actions = (actions) => parse_scenario(JSON.stringify(Object.assign({}, base, {actions})));

    it("are optional, and a scenario without them has no control", () => {
        let r = parse_scenario(JSON.stringify(base));
        expect(r.ok).toBe(true);
        expect(r.scenario.actions).toEqual({});
        expect(scenario_controls(r.scenario)).toEqual([]);
    });

    it("keep their steps, in the order of the actions, and offer restart when it can start", () => {
        let r = with_actions({
            stop:   [{yuno: "g", command: "set-controllers   controllers=0"}],
            report: [{yuno: "s", service: "__yuno__", command: "view-config"}],
            start:  [{yuno: "g", service: "sim", command: "a x=1"}, {yuno: "s", command: "b"}]
        });
        expect(r.ok).toBe(true);
        expect(r.scenario.actions.stop).toEqual([{yuno: "g", command: "set-controllers controllers=0"}]);
        expect(scenario_controls(r.scenario)).toEqual(["start", "stop", "report", "restart"]);
    });

    it("resolve each step to its node and its line, restart being stop then start", () => {
        let sc = with_actions({
            start: [{yuno: "g", service: "sim", command: "a x=1"}, {yuno: "s", command: "b"}],
            stop:  [{yuno: "g", command: "c"}]
        }).scenario;
        expect(action_steps(sc, "start")).toEqual([
            {key: "g", node: "n", line: "command-yuno id=7 service=sim command=a x=1"},
            {key: "s", node: "m", line: "command-yuno id=8 command=b"}
        ]);
        expect(action_steps(sc, "restart").map((st) => st.line.split("command=")[1]))
            .toEqual(["c", "a x=1", "b"]);
    });

    it("name what is wrong", () => {
        expect(with_actions([]).error.key).toBe("scenario bad action");
        expect(with_actions({boom: [{yuno: "g", command: "a"}]}).error.key).toBe("scenario bad action");
        expect(with_actions({stop: []}).error.key).toBe("scenario bad action");
        expect(with_actions({stop: [{yuno: "x", command: "a"}]}).error.key).toBe("scenario bad step");
        expect(with_actions({stop: [{yuno: "g", service: "a b", command: "a"}]}).error.key)
            .toBe("scenario bad step");
        expect(with_actions({stop: [{yuno: "g", command: "a b"}]}).error.key).toBe("scenario bad test command");
        expect(with_actions({stop: [{yuno: "g", command: "a x=1 y=two words"}]}).error.key)
            .toBe("scenario bad test command");
    });

    it("refuse a parameter that command-yuno would take as the yuno's selector", () => {
        for(let k of ["id", "service", "command", "yuno_name", "date", "global"]) {
            let r = with_actions({stop: [{yuno: "g", command: `set-x ${k}=1`}]});
            expect(r.ok).toBe(false);
            expect(r.error.key).toBe("scenario reserved step parameter");
            expect(r.error.detail).toBe(`stop: ${k}`);
        }
        expect(with_actions({stop: [{yuno: "g", command: "set-x period=1 target_url=a"}]}).ok).toBe(true);
    });

    it("refuse a framework key, as the control center does", () => {
        for(let k of ["__md_iev__", "__username__", "__md_command__", "__x"]) {
            let r = with_actions({start: [{yuno: "g", command: `resume-generation ${k}=x`}]});
            expect(r.ok).toBe(false);
            expect(r.error.key).toBe("scenario framework step parameter");
            expect(r.error.detail).toBe(`start: ${k}`);
        }
        expect(with_actions({stop: [{yuno: "g", command: "set-x _one=1 a__b=2"}]}).ok).toBe(true);
    });

    it("name the first refused parameter of the line, as the control center does", () => {
        /*  check_step_command() refuses word by word: a reserved word
         *  before a framework key is the one it names, and the other way
         *  round  */
        let r = with_actions({stop: [{yuno: "g", command: "cmd id=1 __x=2"}]});
        expect(r.error.key).toBe("scenario reserved step parameter");
        expect(r.error.detail).toBe("stop: id");
        r = with_actions({stop: [{yuno: "g", command: "cmd __x=2 id=1"}]});
        expect(r.error.key).toBe("scenario framework step parameter");
        expect(r.error.detail).toBe("stop: __x");
    });

    it("offer restart only when there is a stop to run before the start", () => {
        let r = with_actions({start: [{yuno: "g", command: "a"}]});
        expect(scenario_controls(r.scenario)).toEqual(["start"]);
    });
});


describe("the old form", () => {
    it("a name becomes the id, and the test block the steps of the actions", () => {
        let r = parse_scenario(JSON.stringify({
            name: "Stress test (central)",
            node: "c",
            yunos: [{id: "stress", rate: "tx"}, {id: "2120"}],
            test: {yuno: "stress", service: "sim_controllers",
                   start: ["set-controllers controllers=10", "resume-generation"],
                   stop: ["set-controllers controllers=0"]}
        }));
        expect(r.ok).toBe(true);
        expect(r.scenario.id).toBe("stress-test-central");
        expect(r.scenario.description).toBe("Stress test (central)");
        expect(r.scenario.actions.start).toEqual([
            {yuno: "stress", service: "sim_controllers", command: "set-controllers controllers=10"},
            {yuno: "stress", service: "sim_controllers", command: "resume-generation"}
        ]);
        expect(scenario_controls(r.scenario)).toEqual(["start", "stop", "restart"]);
    });

    it("a test yuno that was not drawn is added to the yunos", () => {
        let r = parse_scenario('{"agent_url":"wss://h:1993","yunos":[{"id":"a"}],' +
            '"test":{"yuno":"gen","stop":["s"]}}');
        expect(r.ok).toBe(true);
        expect(r.scenario.yunos.map((y) => y.key)).toEqual(["a", "gen"]);
        expect(action_steps(r.scenario, "stop")).toEqual(
            [{key: "gen", node: "", line: "command-yuno id=gen command=s"}]);
    });

    it("refuses a test block that says nothing, or both forms at once", () => {
        const base = {node: "n", yunos: [{id: "g"}]};
        const with_test = (test) => parse_scenario(JSON.stringify(Object.assign({}, base, {test})));
        expect(with_test([]).error.key).toBe("scenario bad test");
        expect(with_test({start: ["a"]}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g"}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g", stop: []}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g", service: "a b", stop: ["a"]}).error.key).toBe("scenario bad test");
        expect(parse_scenario(JSON.stringify(Object.assign({}, base, {
            test: {yuno: "g", stop: ["a"]}, actions: {stop: [{yuno: "g", command: "a"}]}
        }))).error.key).toBe("scenario bad test");
    });
});


describe("the document the control center keeps", () => {
    it("is what was written, without what the validation derived", () => {
        let sc = parse_scenario(JSON.stringify(SCENARIO_TEMPLATE)).scenario;
        let doc = scenario_document(sc);
        expect(doc.place).toBe(undefined);
        expect(doc.node).toBe("my-node");
        expect(doc.yunos[0]).toEqual({key: "sim", id: "stress", label: "generator", rate: "tx",
                                      service: "generator"});
        expect(doc.yunos[1].node).toBe(undefined);
        /*  and it validates back to the same scenario  */
        expect(parse_scenario(JSON.stringify(doc)).scenario).toEqual(sc);
    });

    it("keeps the url of a direct one, and the node of a yuno that is elsewhere", () => {
        let sc = parse_scenario('{"id":"d","agent_url":"wss://h:1993","yunos":[{"id":"a"}]}').scenario;
        expect(scenario_document(sc).agent_url).toBe("wss://h:1993");
        let sc2 = parse_scenario('{"node":"n","yunos":[{"id":"a"},{"id":"b","node":"m"}]}').scenario;
        expect(scenario_document(sc2).yunos.map((y) => y.node)).toEqual([undefined, "m"]);
    });
});


describe("a control center that keeps no scenario", () => {
    it("is told by the parser's words, not by any failure", () => {
        expect(cc_lacks_command("controlcenter^artgins.com: command not available: 'scenarios'. Try 'help' command.")).toBe(true);
        expect(cc_lacks_command("controlcenter^test: scenario not found: 'x'")).toBe(false);
        expect(cc_lacks_command(undefined)).toBe(false);
    });
});


describe("the yunos ticked in the tree", () => {
    it("make a scenario of cards, each yuno on its node", () => {
        let sc = selection_scenario([
            {node: "node3", yuno_id: "1620", label: "db_history^1620"},
            {node: "local", yuno_id: "1620"},
            {node: "local", yuno_id: "1620"}
        ]);
        expect(sc.id).toBe("selection");
        expect(sc.view.mode).toBe("cards");
        expect(sc.yunos.map((y) => [y.key, y.id, y.node, y.label])).toEqual([
            ["node3.1620", "1620", "node3", "db_history^1620"],
            ["local.1620", "1620", "local", "1620"]
        ]);
    });

    it("make none of nothing", () => {
        expect(selection_scenario([])).toBe(null);
        expect(selection_scenario([{node: "", yuno_id: "1"}])).toBe(null);
    });
});


describe("where the yunos are", () => {
    it("a direct scenario keeps its url and no node", () => {
        let r = parse_scenario('{"agent_url":"wss://h:1993","yunos":[{"id":"stress"}]}');
        expect(r.scenario.place).toBe("direct");
        expect(r.scenario.yunos[0].node).toBe(undefined);
        expect(r.scenario.yunos[0].key).toBe("stress");
        expect(scenario_nodes(r.scenario)).toEqual([""]);
    });

    it("a control-center scenario gives every yuno a node and a key", () => {
        let r = parse_scenario(JSON.stringify({
            node: "central",
            yunos: [
                {key: "sim", id: "stress", node: "controlador", rate: "tx"},
                {key: "gate", id: "2120"},
                {key: "gate_co", id: "2120", node: "controlador"}
            ],
            links: [["sim", "gate"]],
            test: {yuno: "sim", service: "sim_controllers", stop: ["set-controllers controllers=0"]}
        }));
        expect(r.ok).toBe(true);
        expect(r.scenario.place).toBe("control_center");
        expect(r.scenario.yunos.map((y) => `${y.key}@${y.node}`)).toEqual(
            ["sim@controlador", "gate@central", "gate_co@controlador"]);
        expect(scenario_nodes(r.scenario)).toEqual(["controlador", "central"]);
        expect(action_steps(r.scenario, "stop")).toEqual([{key: "sim", node: "controlador",
            line: "command-yuno id=stress service=sim_controllers command=set-controllers controllers=0"}]);
    });

    it("refuses a scenario that says both, or neither", () => {
        expect(parse_scenario('{"agent_url":"wss://h:1993","node":"n","yunos":[{"id":"a"}]}').error.key)
            .toBe("scenario agent url or node");
        expect(parse_scenario('{"agent_url":"wss://h:1993","yunos":[{"id":"a","node":"n"}]}').error.key)
            .toBe("scenario agent url or node");
        expect(parse_scenario('{"yunos":[{"id":"a","node":"n"},{"id":"b"}]}').error)
            .toEqual({key: "scenario needs a place", detail: "b"});
        expect(parse_scenario('{"node":"a b","yunos":[{"id":"a"}]}').error.key).toBe("scenario bad node");
        expect(parse_scenario('{"node":"n","yunos":[{"id":"a"},{"id":"a"}]}').error.key)
            .toBe("scenario duplicate yuno");
        expect(parse_scenario('{"node":"n","yunos":[{"id":"a b"}]}').error.key).toBe("scenario yuno needs id");
        expect(parse_scenario('{"node":"n","yunos":[{"id":"a"}],"test":{"yuno":"x","stop":["s"],"node":"m"}}').ok)
            .toBe(true);
    });

    it("writes every parameter in the line", () => {
        let y = {id: "2120", service: ""};
        expect(lines.cpu(y)).toBe("stats-yuno id=2120 service=__yuno__");
        expect(lines.app(y)).toBe("stats-yuno id=2120");
        expect(lines.app({id: "5", service: "db"})).toBe("stats-yuno id=5 service=db");
        expect(lines.reset({id: "5", service: "db"})).toBe("stats-yuno id=5 service=db stats=__reset__");
        expect(lines.config(y)).toBe("command-yuno id=2120 service=__yuno__ command=view-config");
        expect(lines.watch([{id: "stress"}, {id: "2120", service: ""}, {id: "5", service: "db"},
                            {id: "stress"}], 2000))
            .toBe("watch-yuno-stats ids=stress,2120,5:db period=2000");
        expect(lines.unwatch()).toBe("watch-yuno-stats stop=1");
    });
});


describe("links from the configs", () => {
    /*  The shapes of the real view-config of the yunos of a stress test.  */
    const gate = {
        environment: {daemon_log_handlers: {to_udp: {url: "udp://127.0.0.1:1992"}}},
        global: {
            "__top_side__.__json_config_variables__": {"__url__": "ws://127.0.0.1:11102"},
            "__input_side__.__json_config_variables__": {
                "__input_mqtt_url__": "tcp://0.0.0.0:2120",
                "__input_mqtts_url__": "tcps://0.0.0.0:2122"
            },
            "__output_side__.__json_config_variables__": {"__output_url__": "tcp://127.0.0.1:5120"}
        },
        services: [{children: [{kw: {url: "(^^__output_url__^^)"}}]}, {kw: {url: "ws://127.0.0.1:1991"}}]
    };
    const tracks = {
        global: {"__input_side__.__json_config_variables__": {"__input_url__": "tcp://127.0.0.1:5120"}},
        services: [{kw: {url: "ws://127.0.0.1:11100"}}]
    };
    const sim_local = {global: {"sim_controllers.target_url": "tcps://127.0.0.1:2122"},
                       services: [{target_url: "tcps://127.0.0.1:2122"}]};
    const sim_remote = {global: {"sim_controllers.target_url": "tcps://central.example.com:2122"}};

    it("reads what a yuno listens on and what it connects to", () => {
        let e = config_endpoints(gate);
        expect(e.listen.map((x) => x.port).sort()).toEqual([2120, 2122]);
        expect(e.connect).toEqual([{host: "127.0.0.1", port: 5120}]);
    });

    it("proposes the chain of one node", () => {
        expect(derive_links([
            {key: "stress", config: sim_local},
            {key: "2120", config: gate},
            {key: "5120", config: tracks}
        ])).toEqual([["stress", "2120"], ["2120", "5120"]]);
    });

    it("looks for a local address on the same node only, and for a host on any node", () => {
        let entries = [
            {key: "sim_local", node: "ctl", config: sim_local},
            {key: "sim_remote", node: "ctl", config: sim_remote},
            {key: "gate_ce", node: "central", config: gate},
            {key: "tracks_ce", node: "central", config: tracks}
        ];
        expect(derive_links(entries)).toEqual([
            ["sim_remote", "gate_ce"],
            ["gate_ce", "tracks_ce"]
        ]);
    });
});


describe("run state and charts", () => {
    const can = {actions: {start: [{yuno: "a", command: "x"}], stop: [{yuno: "a", command: "y"}]}};

    it("an action leaves the scenario running, paused or stopped; report says nothing", () => {
        expect(run_state_of_action("start")).toBe("running");
        expect(run_state_of_action("resume")).toBe("running");
        expect(run_state_of_action("restart")).toBe("running");
        expect(run_state_of_action("pause")).toBe("paused");
        expect(run_state_of_action("stop")).toBe("stopped");
        expect(run_state_of_action("report")).toBe(null);
    });

    it("the newest run that is not a report decides; a failed one is not known", () => {
        expect(run_state_of_runs([{action: "report", result: 0}, {action: "stop", result: 0},
            {action: "start", result: 0}])).toBe("stopped");
        expect(run_state_of_runs([{action: "start", result: 0}, {action: "stop", result: 0}]))
            .toBe("running");
        expect(run_state_of_runs([{action: "stop", result: -1,
            steps: [{result: 0}, {result: -1}, {}]}])).toBe(null);
        expect(run_state_of_runs([{action: "start", result: -1, steps: [{result: -1}, {}]},
            {action: "stop", result: 0}])).toBe("stopped");
        expect(run_state_of_runs([])).toBe("stopped");
        expect(run_state_of_runs(null)).toBe("stopped");
    });

    it("the charts span the window chosen, ending at the last row, with one point or many", () => {
        expect(chart_x_window([{tm: 1792932000}], 900, 1792932005)).toEqual([1792931100, 1792932000]);
        expect(chart_x_window([{tm: 1792931000}, {tm: 1792932000}], 300, 1792932005))
            .toEqual([1792931700, 1792932000]);
        expect(chart_x_window([], 900, 1792932005)).toEqual([1792931105, 1792932005]);
        expect(chart_x_window(null, 60, 100)).toEqual([40, 100]);
    });

    it("the memory and the disk of a yuno: null when it does not send them, never 0", () => {
        expect(resources_of({cpu: 3, disk_free_percent: 73, disk_size_in_gigas: 1832})).toEqual({
            mem_rss_kb: null, node_mem_pct: null, node_mem_total_mb: null,
            disk_pct: null, disk_path: "", disk_gb: null
        });
        expect(resources_of({mem_rss_kb: 5324, mem_node_total_mb: 31885, mem_node_available_percent: 35,
            disk_min_free_percent: 4, disk_min_free_path: "/mnt/simram/queues", disk_min_free_size_gigas: 26}))
            .toEqual({mem_rss_kb: 5324, node_mem_pct: 35, node_mem_total_mb: 31885,
                disk_pct: 4, disk_path: "/mnt/simram/queues", disk_gb: 26});
        expect(resources_of(null).disk_pct).toBe(null);
        expect(resources_of({disk_min_free_percent: "4"}).disk_pct).toBe(null);
        expect([null, 0, 9, 10, 19, 20, 100].map(free_level))
            .toEqual(["unknown", "critical", "critical", "low", "low", "ok", "ok"]);
        expect(fmt_mem_kb(null)).toBe("–");
        expect(fmt_mem_kb(5324)).toBe("5.2 MB");
        expect(fmt_mem_kb(204800)).toBe("200 MB");
    });

    it("a control fits the scenario's state, or is refused by it", () => {
        let fits = (st) => ["start", "pause", "resume", "stop", "report", "restart"]
            .filter((c) => control_refused_by(c, st) === null);
        expect(fits("stopped")).toEqual(["start", "report", "restart"]);
        expect(fits("running")).toEqual(["pause", "stop", "report", "restart"]);
        expect(fits("paused")).toEqual(["resume", "stop", "report", "restart"]);
        expect(fits(null)).toEqual(["start", "pause", "resume", "stop", "report", "restart"]);
        expect(control_refused_by("start", "running")).toBe("running");
        expect(control_refused_by("start", "paused")).toBe("paused");
        expect(control_refused_by("pause", "paused")).toBe("paused");
        expect(control_refused_by("resume", "stopped")).toBe("stopped");
        expect(control_refused_by("stop", "stopped")).toBe("stopped");
    });

    it("the charts follow a scenario that cannot start or stop, or whose state is not known", () => {
        expect(charts_follow({actions: {}}, "stopped")).toBe(true);
        expect(charts_follow({actions: {report: [{yuno: "a", command: "r"}]}}, "stopped")).toBe(true);
        expect(charts_follow(can, null)).toBe(true);
        expect(charts_follow(can, "running")).toBe(true);
        expect(charts_follow(can, "stopped")).toBe(false);
        expect(charts_follow(can, "paused")).toBe(false);
    });

    it("a step is done when it answered without error; one not sent is not", () => {
        expect(some_step_done([{result: -1}, {}])).toBe(false);
        expect(some_step_done([{result: -1}, {result: 0}])).toBe(true);
        expect(some_step_done(undefined)).toBe(false);
    });
});

describe("max_run", () => {
    const base = () => JSON.parse(JSON.stringify(SCENARIO_TEMPLATE));
    it("is the seconds a start may run, 0 to a week; the document keeps it", () => {
        let raw = Object.assign(base(), {max_run: 2100});
        let r = validate_scenario(raw);
        expect(r.ok).toBe(true);
        expect(r.scenario.max_run).toBe(2100);
        expect(scenario_document(r.scenario).max_run).toBe(2100);
        let none = validate_scenario(base());
        expect(none.scenario.max_run).toBe(0);
        expect(scenario_document(none.scenario).max_run).toBe(undefined);
    });
    it("refuses what is not one", () => {
        for(let bad of [-1, 1.5, "60", 7 * 24 * 3600 + 1]) {
            expect(validate_scenario(Object.assign(base(), {max_run: bad})).error.key).toBe("scenario bad max_run");
        }
    });
});

describe("only_emitters", () => {
    it("the yunos that send along a link and receive none", () => {
        expect(only_emitters(["s1", "s2", "gate", "db"],
            [["s1", "gate"], ["s2", "gate"], ["gate", "db"]])).toEqual(["s1", "s2"]);
    });
    it("none in a scenario with no links: the flow is not known", () => {
        expect(only_emitters(["a", "b"], [])).toEqual([]);
    });
});

describe("queue_service", () => {
    const base = () => JSON.parse(JSON.stringify(SCENARIO_TEMPLATE));
    it("a yuno's queue may be another service's: validated, kept, and watched too", () => {
        let raw = base();
        raw.yunos[1].queue_service = "__output_side__";
        let r = validate_scenario(raw);
        expect(r.ok).toBe(true);
        let gate = r.scenario.yunos[1];
        expect(queue_elsewhere(gate)).toBe(true);
        expect(scenario_document(r.scenario).yunos[1].queue_service).toBe("__output_side__");
        expect(lines.watch([gate], 2000)).toBe("watch-yuno-stats ids=2120,2120:__output_side__ period=2000");
        expect(lines.queue(gate)).toBe("stats-yuno id=2120 service=__output_side__");
        expect(queue_elsewhere(r.scenario.yunos[0])).toBe(false);
    });
    it("refuses one that is no service name", () => {
        let raw = base();
        raw.yunos[1].queue_service = "a b";
        expect(validate_scenario(raw).error.key).toBe("scenario bad queue service");
    });
    it("reads the queue of a service, or the sum of its output gates'", () => {
        expect(queue_in_stats({msgs_in_queue: 7, txMsgs: 1})).toBe(7);
        /*  What a gate's __output_side__ answers  */
        expect(queue_in_stats({
            "output-qiogate-0": {msgs_in_queue: 3, pending_acks: 0},
            "output-qiogate-1": {msgs_in_queue: 4, pending_acks: 1}
        })).toBe(7);
        expect(queue_in_stats({"output-qiogate-0": {msgs_in_queue: 0}})).toBe(0);
        expect(queue_in_stats({txMsgs: 5, child: {rxMsgs: 1}})).toBe(null);
        expect(queue_in_stats(null)).toBe(null);
    });
});

describe("switch", () => {
    const base = () => ({
        id: "sw",
        node: "node2",
        yunos: [
            {key: "pp12", id: "pp12", service: "sim_controllers", rate: "tx", node: "node1",
             switch: {
                 on: [{command: "set-controllers controllers=125"}, {command: "resume-generation"}],
                 off: [{command: "pause-generation"}, {command: "set-controllers controllers=0"}]
             }},
            {key: "g", id: "2120"}
        ],
        links: [["pp12", "g"]],
        actions: {start: [{yuno: "g", command: "play-yuno"}], stop: [{yuno: "g", command: "pause-yuno"}]},
        view: {mode: "graph", node_labels: {node1: "n1", node2: "n2"}}
    });

    it("a switch's steps go to its own yuno when they name none", () => {
        let r = validate_scenario(base());
        expect(r.ok).toBe(true);
        expect(r.scenario.yunos[0].switch.on[0]).toEqual({yuno: "pp12", command: "set-controllers controllers=125"});
        expect(switch_steps(r.scenario, "pp12", "off").map((s) => s.line)).toEqual([
            "command-yuno id=pp12 service=sim_controllers command=pause-generation",
            "command-yuno id=pp12 service=sim_controllers command=set-controllers controllers=0"
        ]);
        expect(switch_steps(r.scenario, "g", "on")).toEqual([]);
    });

    it("a switch without its off, or with a step of no yuno, is refused", () => {
        let raw = base();
        delete raw.yunos[0].switch.off;
        expect(validate_scenario(raw).error.key).toBe("scenario bad switch");
        raw = base();
        raw.yunos[0].switch.on[0].yuno = "nobody";
        expect(validate_scenario(raw).error.key).toBe("scenario bad step");
    });

    it("node labels name the nodes, and survive the document", () => {
        let r = validate_scenario(base());
        expect(node_label(r.scenario, "node1")).toBe("n1");
        expect(node_label(r.scenario, "node3")).toBe("node3");
        let doc = scenario_document(r.scenario);
        expect(doc.view.node_labels).toEqual({node1: "n1", node2: "n2"});
        expect(doc.yunos[0].switch.off.length).toBe(2);
        expect(validate_scenario(doc).ok).toBe(true);
        let raw = base();
        raw.view.node_labels = {node1: "a-name-far-too-long"};
        expect(validate_scenario(raw).error.key).toBe("scenario bad node labels");
    });

    it("on only while running, off always; a switch run changes no state", () => {
        expect(control_refused_by("on", "running")).toBe(null);
        expect(control_refused_by("on", "paused")).toBe("paused");
        expect(control_refused_by("on", "stopped")).toBe("stopped");
        expect(control_refused_by("off", "stopped")).toBe(null);
        expect(run_state_of_runs([{action: "off", result: 0}, {action: "on", result: 0},
            {action: "start", result: 0}])).toBe("running");
    });

    it("a series is named by label, id when the label lacks it, and short node", () => {
        let r = validate_scenario(base());
        expect(series_label(r.scenario, r.scenario.yunos[0])).toBe("pp12 (n1)");
        expect(series_label(r.scenario, {label: "sim_controllers", id: "pp1", node: "node3"}))
            .toBe("sim_controllers pp1 (node3)");
        expect(series_label(r.scenario, {label: "gate_central 2120", id: "2120", node: "node2"}))
            .toBe("gate_central 2120 (n2)");
    });

    it("a switch is on while its yuno moves messages", () => {
        let y = {rate: "tx"};
        expect(switch_is_on(y, {tx: 2500})).toBe(true);
        expect(switch_is_on(y, {tx: 0})).toBe(false);
        expect(switch_is_on(y, null)).toBe(false);
    });
});
