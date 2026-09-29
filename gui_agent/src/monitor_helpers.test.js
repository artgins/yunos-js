/***********************************************************************
 *          monitor_helpers.test.js
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, it, expect} from "vitest";

import {
    SCENARIO_TEMPLATE,
    test_controls,
    test_command_lines,
    lines,
    scenario_nodes,
    config_endpoints,
    derive_links,
    parse_scenario,
    layout_graph,
    pick_rate,
    prune_history,
    cpu_level,
    yuno_run_state,
    fmt_rate,
} from "./monitor_helpers.js";


describe("parse_scenario", () => {
    it("accepts the template and fills the defaults", () => {
        let r = parse_scenario(JSON.stringify(SCENARIO_TEMPLATE));
        expect(r.ok).toBe(true);
        expect(r.scenario.yunos.map((y) => y.id)).toEqual(["stress", "2120", "5120"]);
        expect(r.scenario.yunos[0].rate).toBe("tx");
        expect(r.scenario.yunos[1].rate).toBe("rx");
        expect(r.scenario.yunos[1].service).toBe("");
        expect(r.scenario.links).toEqual([["stress", "2120"], ["2120", "5120"]]);
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

    it("lays out yunos with no links as one column", () => {
        let g = layout_graph(["a", "b"], [], O);
        expect(g.nodes.a.x).toBe(g.nodes.b.x);
        expect(g.edges).toEqual([]);
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


describe("test block", () => {
    const base = {agent_url: "wss://h:1993", yunos: [{id: "g"}, {id: "s"}]};
    const with_test = (test) => parse_scenario(JSON.stringify(Object.assign({}, base, {test})));

    it("is optional, and a scenario without it has no control", () => {
        let r = parse_scenario(JSON.stringify(base));
        expect(r.ok).toBe(true);
        expect(r.scenario.test).toBe(undefined);
        expect(test_controls(r.scenario.test)).toEqual([]);
    });

    it("keeps the declared lists and offers restart when it can start", () => {
        let r = with_test({yuno: "g", service: "sim", start: ["set-controllers controllers=10"],
                           stop: ["set-controllers   controllers=0"]});
        expect(r.ok).toBe(true);
        expect(r.scenario.test.stop).toEqual(["set-controllers controllers=0"]);
        expect(test_controls(r.scenario.test)).toEqual(["start", "stop", "restart"]);
    });

    it("builds the command-yuno lines, restart being stop then start", () => {
        let t = with_test({yuno: "g", service: "sim", start: ["a x=1", "b"], stop: ["c"]}).scenario.test;
        expect(test_command_lines(t, "start")).toEqual([
            "command-yuno id=g service=sim command=a x=1",
            "command-yuno id=g service=sim command=b"
        ]);
        expect(test_command_lines(t, "restart").map((l) => l.split("command=")[1])).toEqual(["c", "a x=1", "b"]);
        let t2 = with_test({yuno: "g", pause: ["p"]}).scenario.test;
        expect(test_command_lines(t2, "pause")).toEqual(["command-yuno id=g command=p"]);
    });

    it("names what is wrong", () => {
        expect(with_test([]).error.key).toBe("scenario bad test");
        expect(with_test({start: ["a"]}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g"}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g", stop: []}).error.key).toBe("scenario bad test");
        expect(with_test({yuno: "g", stop: ["a b"]}).error.key).toBe("scenario bad test command");
        expect(with_test({yuno: "g", stop: ["a x=1 y=two words"]}).error.key).toBe("scenario bad test command");
        expect(with_test({yuno: "g", service: "a b", stop: ["a"]}).error.key).toBe("scenario bad test");
    });
});


describe("where the yunos are", () => {
    it("a direct scenario keeps its url and no node", () => {
        let r = parse_scenario(JSON.stringify(SCENARIO_TEMPLATE));
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
        expect(r.scenario.test).toMatchObject({yuno: "sim", id: "stress", node: "controlador"});
        expect(test_command_lines(r.scenario.test, "stop")).toEqual(
            ["command-yuno id=stress service=sim_controllers command=set-controllers controllers=0"]);
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
    });
});


describe("links from the configs", () => {
    /*  The shapes of the real view-config of yunovatios' stress yunos.  */
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
