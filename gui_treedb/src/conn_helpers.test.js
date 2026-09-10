/***********************************************************************
 *          conn_helpers.test.js
 *
 *      The one decision behind "a paste adds only what is new", pinned.
 *
 *      The case that made it a bug is the first group: the agent console
 *      rebuilds the connections document WHOLE on every scan, so the
 *      paste that carries one new yuno carries every old one with it.
 ***********************************************************************/
import { describe, test, expect } from "vitest";
import { conn_identity, plan_conn_import, conn_is_marked, conns_browse_state } from "./conn_helpers.js";

const A = {url: "wss://a.example.com:1996", remote_yuno_service: "treedb"};
const B = {url: "wss://b.example.com:1996", remote_yuno_service: "treedb"};
const C = {url: "wss://c.example.com:1996", remote_yuno_service: "treedb"};


describe("re-pasting the same document", () => {
    test("adds nothing and says how many were already here", () => {
        expect(plan_conn_import([A, B], [A, B])).toEqual({fresh: [], skipped: 2});
    });

    test("adds only the one the document gained", () => {
        let plan = plan_conn_import([A, B], [A, B, C]);
        expect(plan.fresh).toEqual([C]);
        expect(plan.skipped).toBe(2);
    });

    test("an empty set takes the whole document", () => {
        expect(plan_conn_import([], [A, B])).toEqual({fresh: [A, B], skipped: 0});
    });
});

describe("what makes two connections the same one", () => {
    test("the label is not part of it: an edited row is still that row", () => {
        let renamed = {...A, label: "the one I fixed by hand"};
        expect(plan_conn_import([renamed], [A])).toEqual({fresh: [], skipped: 1});
    });

    test("the id is not part of it either", () => {
        expect(plan_conn_import([{...A, id: "local"}], [{...A, id: "exported"}]))
            .toEqual({fresh: [], skipped: 1});
    });

    test("the SERVICE is: a clone is another connection to the same yuno", () => {
        let other = {...A, remote_yuno_service: "treedb_other"};
        expect(plan_conn_import([A], [other])).toEqual({fresh: [other], skipped: 0});
    });

    test("the host is case-folded, the way a wss host is", () => {
        expect(conn_identity({url: "WSS://A.Example.com:1996", remote_yuno_service: "treedb"}))
            .toBe(conn_identity(A));
    });

    test("surrounding blanks do not make a second row", () => {
        expect(plan_conn_import([A], [{url: `  ${A.url} `, remote_yuno_service: " treedb "}]))
            .toEqual({fresh: [], skipped: 1});
    });
});

describe("the id is the key of a record", () => {
    test("the same id is the same connection, even if its url changed", () => {
        let here = {...A, id: "artgins.yunetacontrol.com:1996"};
        let moved = {...A, id: "artgins.yunetacontrol.com:1996", url: "wss://elsewhere:1996"};
        expect(plan_conn_import([here], [moved])).toEqual({fresh: [], skipped: 1});
    });

    test("an id the document repeats lands once", () => {
        let one = {...A, id: "k"};
        let two = {...B, id: "k"};
        expect(plan_conn_import([], [one, two])).toEqual({fresh: [one], skipped: 1});
    });

    test("two ids are two connections when their endpoints differ", () => {
        let com = {...A, id: "artgins.yunetacontrol.com:1996"};
        let ovh = {...B, id: "artgins.yunetacontrol.ovh:1997"};
        expect(plan_conn_import([], [com, ovh])).toEqual({fresh: [com, ovh], skipped: 0});
    });
});

describe("what the document may carry", () => {
    test("a document that repeats itself lands once", () => {
        expect(plan_conn_import([], [A, A, B])).toEqual({fresh: [A, B], skipped: 1});
    });

    test("a row with no url is no connection: dropped, counted nowhere", () => {
        expect(plan_conn_import([], [{label: "half typed"}, A]))
            .toEqual({fresh: [A], skipped: 0});
    });

    test("nothing at all is not a crash", () => {
        expect(plan_conn_import(null, null)).toEqual({fresh: [], skipped: 0});
    });
});


describe("a connection marked to browse", () => {
    const legacy = (...flags) => ({
        services: flags.map((on, i) => ({service: `t${i}`, gclass: "C_NODE", selected: on}))
    });

    test("`browse` says it", () => {
        expect(conn_is_marked({browse: true})).toBe(true);
        expect(conn_is_marked({browse: false})).toBe(false);
    });

    test("with no `browse`, an old per-service selection marks it", () => {
        expect(conn_is_marked(legacy(false, true))).toBe(true);
        expect(conn_is_marked(legacy(false, false))).toBe(false);
    });

    test("`browse` wins over the old flags", () => {
        expect(conn_is_marked({...legacy(true), browse: false})).toBe(false);
    });

    test("nothing is not marked", () => {
        expect(conn_is_marked(null)).toBe(false);
        expect(conn_is_marked({})).toBe(false);
    });
});

describe("what the header box of the browse column says", () => {
    test("every connection marked reads 'all'", () => {
        expect(conns_browse_state([{browse: true}, {browse: true}])).toBe("all");
    });

    test("one connection short of it reads 'some', not 'all'", () => {
        expect(conns_browse_state([{browse: true}, {browse: false}])).toBe("some");
    });

    test("nothing marked reads 'none'", () => {
        expect(conns_browse_state([{browse: false}, {}])).toBe("none");
    });

    test("a connection with nothing discovered counts like any other", () => {
        expect(conns_browse_state([{browse: true, services: []}])).toBe("all");
    });

    test("nothing at all is not a crash", () => {
        expect(conns_browse_state(null)).toBe("none");
        expect(conns_browse_state([null, {}])).toBe("none");
    });
});
