/***********************************************************************
 *          c_agent_yuno_tree.window.wiring.test.js
 *
 *      The gobj tree window of a card, through the REAL gobj-ui:
 *      C_AGENT_YUNO_TREE -> open_gobj_tree_view() -> C_YUI_WINDOW +
 *      C_YUI_GOBJ_TREE_JS. c_scenarios.wiring.test.js replaces
 *      open_gobj_tree_view() with a double, and that is how a window
 *      name gobj-ui could not handle shipped: the
 *      name `<node>~<key>` made the tree's canvas lookup answer null
 *      (`~` is a CSS combinator) or throw (`%5E`, a `^` encoded), so the
 *      canvas never resized and a `^` left an orphan window behind.
 *
 *      Only the G6 Graph is a double. Needs gobj-ui 7.27.33 or later
 *      (the canvas found by id, with no selector): against 7.27.32 every
 *      test below logs "no canvas mount".
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, beforeEach, vi} from "vitest";
import {install_dom_double} from "../test/dom_double.js";

install_dom_double();

/*  What the tree watches to follow its window: the element it observes.  */
const observed = vi.hoisted(() => []);
globalThis.ResizeObserver = class {
    observe($el) {
        observed.push($el);
    }
    unobserve() {
    }
    disconnect() {
    }
};

vi.mock("@antv/g6", async (importOriginal) => {
    const real = await importOriginal();
    class FakeGraph {
        constructor(options) {
            this.options = options;
            return new Proxy(this, {
                get: (t, k) => (k in t) ? t[k] : (() => undefined),
            });
        }
        render() {
            return Promise.resolve();
        }
        draw() {
            return Promise.resolve();
        }
        on() {
        }
        getZoom() {
            return 1;
        }
        getPosition() {
            return [0, 0];
        }
        zoomTo() {
            return Promise.resolve();
        }
        translateTo() {
            return Promise.resolve();
        }
        getData() {
            return {nodes: [], edges: [], combos: []};
        }
        getNodeData() {
            return [];
        }
        getEdgeData() {
            return [];
        }
        getPlugins() {
            return [];
        }
        getBehaviors() {
            return [];
        }
        getOptions() {
            return {behaviors: []};
        }
        getCanvas() {
            return {getLayers: () => ({}), getContainer: () => null};
        }
        fitView() {
            return Promise.resolve();
        }
        destroy() {
        }
    }
    return {...real, Graph: FakeGraph};
});

const {
    SDATA_END, event_flag_t, gclass_create, gobj_start_up, gobj_create_yuno, gobj_create,
    gobj_start, gobj_stop, gobj_destroy, gobj_name, gobj_read_str_attr, gobj_find_service,
    set_log_callback, register_c_timer,
} = await import("@yuneta/gobj-js");
const {register_c_yui_gobj_tree_js} = await import("@yuneta/gobj-ui/src/c_yui_gobj_tree_js.js");
const {register_c_yui_window} = await import("@yuneta/gobj-ui/src/c_yui_window.js");
const {register_c_agent_yuno_tree} = await import("./c_agent_yuno_tree.js");

const logged = [];
let host = null;
let seq = 0;

beforeAll(async () => {
    const i18next = (await import("i18next")).default;
    await i18next.init({lng: "en", resources: {en: {translation: {}}}});
    gobj_start_up(null, null, null, null, null, null, null);
    set_log_callback((level, msg) => {
        logged.push({level: String(level), msg: String(msg)});
    });
    register_c_timer();
    register_c_yui_gobj_tree_js();
    register_c_yui_window();
    register_c_agent_yuno_tree();
    gclass_create("C_TEST_YTREE_YUNO", [], [["ST_IDLE", []]], {}, 0,
        [SDATA_END()], {}, 0, 0, 0, 0);
    /*  The monitor's part: it declares what the tree host publishes.  */
    gclass_create("C_TEST_YTREE_HOST",
        [["EV_YUNO_TREE_REQUEST", event_flag_t.EVF_OUTPUT_EVENT],
         ["EV_YUNO_TREE_CLOSED", event_flag_t.EVF_OUTPUT_EVENT]],
        [["ST_IDLE", [
            ["EV_YUNO_TREE_REQUEST", null, null],
            ["EV_YUNO_TREE_CLOSED",  null, null],
        ]]],
        {}, 0, [SDATA_END()], {}, 0, 0, 0, 0);
    const yuno = gobj_create_yuno("ytree_yuno", "C_TEST_YTREE_YUNO", {});
    host = gobj_create("monitor", "C_TEST_YTREE_HOST", {}, yuno);
});

beforeEach(() => {
    logged.length = 0;
    observed.length = 0;
});

function problems()
{
    return logged.filter((l) => l.level === "error" || l.level === "warning").map((l) => l.msg);
}

function open_card(yuno)
{
    const child = gobj_create(`ytree-${++seq}`, "C_AGENT_YUNO_TREE", {yuno: yuno}, host);
    gobj_start(child);
    return child;
}

function close_card(child)
{
    gobj_stop(child);
    gobj_destroy(child);
}

describe("the gobj tree window of a card, on the real gobj-ui", () => {
    for(const yuno of [
        {key: "gate", id: "2120", node: ""},           /*  local~gate  */
        {key: "x^y", id: "2120", node: "n"},           /*  a `^`: %5E  */
        {key: "a.b", id: "2120", node: "n.o"},         /*  dots  */
        {key: "Gate", id: "2120", node: "Central"},    /*  uppercase  */
    ]) {
        test(`node ${JSON.stringify(yuno.node)}, key ${JSON.stringify(yuno.key)}: ` +
                `the window opens and its tree finds its canvas`, async () => {
            const child = open_card(yuno);
            await new Promise((resolve) => setTimeout(resolve, 0));
            const view = child.priv.view;
            expect(view && view.win, "a window").toBeTruthy();
            const canvas_id = gobj_read_str_attr(view.tree, "canvas_id");
            expect(observed.some(($el) => $el.id === canvas_id), "the canvas is watched").toBe(true);
            expect(problems()).toEqual([]);

            /*  closed and opened again: nothing was left registered  */
            const win_name = gobj_name(view.win);
            close_card(child);
            expect(gobj_find_service(win_name, false)).toBeFalsy();
            const again = open_card(yuno);
            expect(again.priv.view && again.priv.view.win).toBeTruthy();
            expect(problems()).toEqual([]);
            close_card(again);
        });
    }

    test("two cards whose keys differ only in case: two windows", async () => {
        const one = open_card({key: "Gate", id: "2120", node: "n"});
        const two = open_card({key: "gate", id: "2121", node: "n"});
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(one.priv.view && one.priv.view.win).toBeTruthy();
        expect(two.priv.view && two.priv.view.win).toBeTruthy();
        expect(gobj_name(one.priv.view.win).toLowerCase())
            .not.toBe(gobj_name(two.priv.view.win).toLowerCase());
        expect(problems()).toEqual([]);
        close_card(one);
        close_card(two);
    });
});
