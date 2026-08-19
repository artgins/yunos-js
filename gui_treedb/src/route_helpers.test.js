/***********************************************************************
 *          route_helpers.test.js
 *
 *      The one decision behind "a tab keeps what it had open", pinned.
 *
 *      The case that makes it non-trivial is the last group: the root
 *      of the tab you are already in is not the same event as the root
 *      of a tab you are coming back to, and reading them as one breaks
 *      the view's own way out of a topic.
 ***********************************************************************/
import { describe, test, expect } from "vitest";
import { tab_position_plan } from "./route_helpers.js";

const A = "/topics/db/conn1%1Fdb1";
const B = "/topics/db/conn1%1Fdb2";


describe("inside a tab", () => {
    test("a position is recorded, and nothing is replayed", () => {
        expect(tab_position_plan(A, A, "users", "")).toEqual(
            {record: `${A}/users`, replay: null});
    });

    test("a deeper position is recorded whole", () => {
        expect(tab_position_plan(A, A, "users/info", `${A}/users`)).toEqual(
            {record: `${A}/users/info`, replay: null});
    });

    test("arriving deep from ANOTHER tab records too — the url won", () => {
        expect(tab_position_plan(B, A, "users", `${A}/roles`)).toEqual(
            {record: `${A}/users`, replay: null});
    });
});

describe("the root of the tab you were already in", () => {
    test("is the way OUT of a topic, so it records and never replays", () => {
        /*  The view's own "back to Topics" button lands here. Replaying
            the position would make that button do nothing at all.  */
        expect(tab_position_plan(A, A, "", `${A}/users`)).toEqual(
            {record: A, replay: null});
    });
});

describe("the root of a tab you are coming back to", () => {
    test("replays what was left open", () => {
        expect(tab_position_plan(B, A, "", `${A}/users`)).toEqual(
            {record: null, replay: `${A}/users`});
    });

    test("...and does nothing when the tab was left at its own root", () => {
        expect(tab_position_plan(B, A, "", A)).toEqual({record: null, replay: null});
    });

    test("...or when it has never been visited", () => {
        expect(tab_position_plan(B, A, "", "")).toEqual({record: null, replay: null});
        expect(tab_position_plan("", A, "", undefined)).toEqual({record: null, replay: null});
    });
});

describe("edges", () => {
    test("no base is no decision", () => {
        expect(tab_position_plan(A, "", "users", A)).toEqual({record: null, replay: null});
    });

    test("record and replay are never both set", () => {
        for(const args of [[A, A, "users", A], [A, A, "", A], [B, A, "", `${A}/x`],
                           [B, A, "", ""], ["", A, "", ""]]) {
            const plan = tab_position_plan(...args);
            expect(!!(plan.record && plan.replay)).toBe(false);
        }
    });
});
