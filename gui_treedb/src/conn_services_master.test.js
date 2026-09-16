/***********************************************************************
 *          conn_services_master.test.js
 *
 *      A discovered service carries WHETHER THIS YUNO CAN WRITE IT.
 *
 *      Only the master of a treedb's tranger can write; on a replica the
 *      yuno answers "READ-ONLY" to every write (SDK 7.13.0). The SPA used
 *      to mount the editor with its write buttons anyway and let the
 *      backend refuse them one by one, so the discovery now asks
 *      `treedb-info` and stores the answer beside the service.
 *
 *      What is pinned here is the THREE-VALUED part, which is where a
 *      boolean would have been wrong: true, false, and UNKNOWN -- a node
 *      older than the command cannot answer, and a connection stored
 *      before any of this carries nothing. Unknown is WRITABLE: locking
 *      an editing session that works today, on a guess, is worse than a
 *      button the backend refuses.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {treedb_config_conn_services} from "./c_treedb_config.js";


describe("the master flag of a discovered service", () => {
    test("survives the trip through the stored connection", () => {
        const conn = {services: [
            {service: "treedb_a", gclass: "C_NODE", master: true},
            {service: "treedb_b", gclass: "C_NODE", master: false}
        ]};
        const out = treedb_config_conn_services(conn);
        expect(out.map((s) => [s.service, s.master])).toEqual([
            ["treedb_a", true],
            ["treedb_b", false]
        ]);
    });

    test("a service the discovery never asked about is UNKNOWN, not false", () => {
        /*  A connection stored before the discovery asked, or a node that
         *  could not answer. `false` here would lock an editor that
         *  works.  */
        const conn = {services: [{service: "treedb_a", gclass: "C_NODE"}]};
        expect(treedb_config_conn_services(conn)[0].master).toBe(null);
    });

    test("anything that is not a boolean is UNKNOWN too", () => {
        const conn = {services: [
            {service: "a", gclass: "C_NODE", master: "true"},
            {service: "b", gclass: "C_NODE", master: 1},
            {service: "c", gclass: "C_NODE", master: null}
        ]};
        expect(treedb_config_conn_services(conn).map((s) => s.master))
            .toEqual([null, null, null]);
    });

    test("the rest of the record is untouched", () => {
        const conn = {services: [
            {service: "tranger_a", gclass: "C_TRANGER", selected: true, master: false}
        ]};
        expect(treedb_config_conn_services(conn)[0]).toEqual({
            key:      "tranger_a",
            service:  "tranger_a",
            gclass:   "C_TRANGER",
            selected: true,
            master:   false
        });
    });
});
