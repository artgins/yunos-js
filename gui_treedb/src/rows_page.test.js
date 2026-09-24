/***********************************************************************
 *          rows_page.test.js
 *
 *      "Newest first" of a Rows card sent `backward=1` in `open-iterator`
 *      only, and the direction belongs to `get-page`: page 1 was the
 *      OLDEST rows. Every page
 *      asks for the direction now -- which also works against a backend
 *      that ignores it at the open.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {get_page_kw, iterator_is_gone} from "./rows_page.js";

describe("the kw of get-page", () => {
    test("a card read newest first asks every page backward", () => {
        const kw = get_page_kw({service: "tr", iterator_id: "it1", page: 3, size: 10,
            req_id: "q7", match_cond: {backward: 1}});
        expect(kw).toEqual({
            service: "tr", iterator_id: "it1", from_rowid: 21, limit: 10,
            backward: 1, __md_command__: {req_id: "q7"}
        });
    });

    test("a card read oldest first asks forward", () => {
        const kw = get_page_kw({service: "tr", iterator_id: "it1", page: 1, size: 50,
            req_id: "q1", match_cond: {}});
        expect(kw.backward).toBe(0);
        expect(kw.from_rowid).toBe(1);
    });
});

/*
 *  A Rows card whose iterator the backend no longer holds -- the backend
 *  restarted, the topic was closed, the key was deleted -- rejected its page
 *  and stayed on the error. These are
 *  the answers that mean "open it again".
 */
describe("an answer that says the iterator is gone", () => {
    test("is recognised in each of its wordings", () => {
        expect(iterator_is_gone("Iterator not found: 'spa-1-2'")).toBe(true);
        expect(iterator_is_gone(
            "tr^x: iterator 'it' closed, its key 'D' was deleted: open it again")).toBe(true);
        expect(iterator_is_gone(
            "tr^x: iterator was already closed with its topic: 'it'")).toBe(true);
    });

    test("any other failure is not a reason to re-open", () => {
        expect(iterator_is_gone("No permission to 'read' in service 'tr'")).toBe(false);
        expect(iterator_is_gone("")).toBe(false);
        expect(iterator_is_gone(null)).toBe(false);
    });
});
