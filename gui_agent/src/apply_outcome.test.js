import {describe, it, expect} from "vitest";
import {owner_apply_outcome, apply_outcome} from "./apply_outcome.js";

describe("owner_apply_outcome: the unit is a treedb", () => {

    it("rows with data.applied (a node newer than 7.25.3)", () => {
        const o = owner_apply_outcome({result: -1, comment: "x: apply-schema, 2 treedb(s), FAILED for: tb", data: [
            {treedb_name: "ta", result: 0, comment: "ta in place", data: {applied: true}},
            {treedb_name: "tb", result: -1, comment: "x: the saved schema of 'tb' does not parse", data: {applied: false}},
        ]}, "owner");
        expect(o.applied).toEqual(["ta"]);
        expect(o.refused).toEqual(["x: the saved schema of 'tb' does not parse"]);
    });

    it("a 7.25.3 node: a row with result 0 is applied, one with -1 refused", () => {
        const o = owner_apply_outcome({result: -1, data: [
            {treedb_name: "ta", result: 0, comment: "in place", data: null},
            {treedb_name: "tb", result: -1, comment: "cannot write", data: null},
        ]}, "owner");
        expect(o.applied).toEqual(["ta"]);
        expect(o.refused).toEqual(["tb: cannot write"]);
    });

    it("\"0 treedb(s)\" and no rows: nothing applied, nothing refused", () => {
        expect(owner_apply_outcome({result: 0, comment: "x: apply-schema, 0 treedb(s)", data: []}, "o"))
            .toEqual({applied: [], refused: []});
    });

    it("applied false with result 0: neither news nor a refusal", () => {
        expect(owner_apply_outcome({result: 0, data: [
            {treedb_name: "ta", result: 0, data: {applied: false}},
        ]}, "o")).toEqual({applied: [], refused: []});
    });

    it("an owner that refused with no row names itself", () => {
        expect(owner_apply_outcome({result: -403, comment: "No permission"}, "treedb_owner"))
            .toEqual({applied: [], refused: ["treedb_owner: No permission"]});
    });

    it("a named apply answers at the top", () => {
        expect(owner_apply_outcome({result: 0, data: {treedb_name: "ta", applied: true}}, "o").applied)
            .toEqual(["ta"]);
    });

    it("no answer at all (the dispatch failed)", () => {
        expect(owner_apply_outcome(null, "o").refused).toEqual(["o: apply-schema failed"]);
    });
});

describe("apply_outcome", () => {

    it("every treedb applied: restart, nothing to say", () => {
        expect(apply_outcome(["ta", "tb"], [])).toEqual({restart: true, error: "", error_key: ""});
    });

    it("one owner applies A and refuses B: restart, and B is named (M2)", () => {
        /*  Counted by OWNER, that owner's -1 skipped the restart and A was
         *  applied in silence by the next unrelated one.  */
        const o = apply_outcome(["ta"], ["tb: does not parse"]);
        expect(o.restart).toBe(true);
        expect(o.error).toBe("tb: does not parse");
    });

    it("an owner with nothing to apply next to a refusal: NO restart (M2)", () => {
        const o = apply_outcome([], ["tb: does not parse"]);
        expect(o.restart).toBe(false);
        expect(o.error).toBe("tb: does not parse");
    });

    it("nothing applied and nothing refused: no restart, an i18n key", () => {
        expect(apply_outcome([], [])).toEqual({restart: false, error: "", error_key: "nothing saved to apply"});
    });
});
