/***********************************************************************
 *          monitor_helpers.test.js
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, it, expect} from "vitest";

import {
    SCENARIO_TEMPLATE,
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
        expect(parse_scenario('{"yunos":[{"id":"a"}]}').error.key).toBe("scenario needs agent url");
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
