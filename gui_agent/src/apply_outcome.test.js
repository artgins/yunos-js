import {describe, it, expect} from "vitest";
import {apply_outcome} from "./apply_outcome.js";

describe("apply_outcome", () => {

    it("every owner applied: restart, nothing to say", () => {
        expect(apply_outcome(2, [])).toEqual({restart: true, error: ""});
    });

    it("nobody applied: no restart, the refusal is the error", () => {
        const o = apply_outcome(0, ["treedb_a: cannot read the saved schema"]);
        expect(o.restart).toBe(false);
        expect(o.error).toBe("treedb_a: cannot read the saved schema");
    });

    it("one applied, one refused: restart anyway, and say who refused (N10)", () => {
        /*  The owner that applied has already replaced its file in use;
         *  ending the sequence here left the running yuno on the old
         *  schema with the new one on disk, applied by the next restart
         *  in silence.  */
        const o = apply_outcome(1, ["treedb_b: parse failed"]);
        expect(o.restart).toBe(true);
        expect(o.error).toBe("treedb_b: parse failed");
    });

    it("a refusal with no comment still counts", () => {
        expect(apply_outcome(0, [""]).restart).toBe(false);
        expect(apply_outcome(0, [""]).error).toBe("apply-schema failed");
    });
});
