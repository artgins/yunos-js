/***********************************************************************
 *          treedb_info.test.js
 *
 *      "A replica opens without its write buttons" (0.17.36) did
 *      NOTHING, for two reasons, both pinned here (M35 of the
 *      2026-09-21 treedb review):
 *
 *      - `treedb-info` went out with `{service}` alone. C_IEVENT_CLI
 *        EXTRACTS `__md_command__` from the kw and that is ALL it puts
 *        back in the command stack, so the answer named no service and
 *        its `master` was never stored anywhere.
 *      - Had it matched, storing the scanned services rebuilt each one
 *        with service / gclass / selected, and `master` was dropped.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {treedb_info_kw, treedb_info_service} from "./treedb_info.js";
import {treedb_config_merge_scanned} from "./c_treedb_config.js";

/*  What C_IEVENT_CLI keeps of a command's kw for the answer  */
function echoed_by_ievent_cli(kw)
{
    return kw.__md_command__ || {};
}

describe("the treedb-info question names its service in the answer", () => {
    test("the service rides in __md_command__, the one thing echoed", () => {
        const kw = treedb_info_kw("treedb_authzs");
        expect(kw.service).toBe("treedb_authzs");
        expect(treedb_info_service(echoed_by_ievent_cli(kw))).toBe("treedb_authzs");
    });

    test("an answer that echoes nothing names no service", () => {
        expect(treedb_info_service({})).toBe("");
        expect(treedb_info_service(null)).toBe("");
    });
});

describe("storing the scanned services keeps what the scan learned", () => {
    test("the master flag survives the store", () => {
        const prev = [{service: "a", gclass: "C_NODE", selected: true}];
        const found = [
            {service: "a", gclass: "C_NODE", master: false},
            {service: "b", gclass: "C_NODE", master: true},
            {service: "t", gclass: "C_TRANGER"}
        ];
        expect(treedb_config_merge_scanned(prev, found)).toEqual([
            {service: "a", gclass: "C_NODE", selected: true, master: false},
            {service: "b", gclass: "C_NODE", selected: false, master: true},
            {service: "t", gclass: "C_TRANGER", selected: false}
        ]);
    });
});
