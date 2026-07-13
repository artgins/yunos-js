/***********************************************************************
 *          tranger_helpers.test.js
 *
 *      The traps of the tranger browser, pinned:
 *      the two time axes, the two time units, a record whose own fields
 *      collide with the metadata columns, and the filter grammar.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, it, expect} from "vitest";

import {
    SF_T_MS,
    SF_TM_MS,
    to_epoch,
    epoch_to_local_input,
    fmt_ts,
    flatten_record,
    op_filter,
    encode_seg,
    decode_seg,
} from "./tranger_helpers.js";


describe("time conversion", () => {
    it("round-trips a local wall clock through seconds", () => {
        let s = "2026-07-13T18:55:07";
        let epoch = to_epoch(s, false);
        expect(epoch_to_local_input(epoch, false)).toBe(s);
    });

    it("round-trips a local wall clock through milliseconds", () => {
        let s = "2026-07-13T18:55:07";
        let epoch = to_epoch(s, true);
        expect(epoch % 1000).toBe(0);
        expect(epoch_to_local_input(epoch, true)).toBe(s);
    });

    it("reads an unset / unparseable bound as 0, the iterator's 'no condition'", () => {
        expect(to_epoch("", false)).toBe(0);
        expect(to_epoch(null, false)).toBe(0);
        expect(to_epoch("not a date", false)).toBe(0);
    });

    it("renders the columns on the SAME clock as the pickers (local, not UTC)", () => {
        /*  The bug this pins: the columns rendered toISOString() (UTC) while
         *  the pickers are datetime-local, so asking for 18:55 returned a card
         *  whose first row was labelled 16:55 — one instant, two clocks.  */
        let epoch = to_epoch("2026-07-13T18:55:07", false);
        expect(fmt_ts(epoch, false)).toBe("2026-07-13 18:55:07");
    });

    it("keeps the milliseconds of a millisecond topic", () => {
        let epoch = to_epoch("2026-07-13T18:55:07", true) + 42;
        expect(fmt_ts(epoch, true)).toBe("2026-07-13 18:55:07.042");
    });

    it("shows nothing for an absent timestamp", () => {
        expect(fmt_ts(0, false)).toBe("");
    });
});


describe("flatten_record", () => {
    const rec = (md, fields) => Object.assign({__md_tranger__: md}, fields);

    it("reads each timestamp in the unit its own system_flag declares", () => {
        let t_epoch = to_epoch("2026-07-13T10:00:00", false);
        let tm_epoch = to_epoch("2026-07-13T09:00:00", true);
        let row = flatten_record(rec(
            {t: t_epoch, tm: tm_epoch, system_flag: SF_TM_MS, g_rowid: 7},
            {value: 3}));

        expect(row.t).toBe("2026-07-13 10:00:00");      /*  seconds  */
        expect(row.tm).toBe("2026-07-13 09:00:00.000"); /*  milliseconds  */
        expect(row.rowid).toBe(7);
        expect(row.value).toBe(3);
    });

    it("does NOT drop a record field that collides with a metadata column", () => {
        /*  A record is free to carry its own `t` / `tm` / `rowid`. They used to
         *  be skipped: the table lost them while the row dialog still showed
         *  them, so the two disagreed about the same record.  */
        let row = flatten_record(rec(
            {t: 1, tm: 2, system_flag: 0, g_rowid: 1},
            {t: "mine", rowid: "also mine"}));

        expect(row.t_).toBe("mine");
        expect(row.rowid_).toBe("also mine");
        expect(row.t).not.toBe("mine");     /*  the metadata column survives  */
    });

    it("names the key only when asked (a whole-topic Live card)", () => {
        let md = {t: 1, tm: 1, system_flag: 0, g_rowid: 1};
        expect(flatten_record(rec(md, {}), "dev-42").key).toBe("dev-42");
        expect(flatten_record(rec(md, {})).key).toBeUndefined();
        expect(flatten_record(rec(md, {}), "").key).toBeUndefined();
    });

    it("serializes a nested value into its cell and keeps the whole record", () => {
        let r = rec({t: 1, tm: 1, system_flag: 0, g_rowid: 1}, {payload: {a: 1}});
        let row = flatten_record(r);
        expect(row.payload).toBe('{"a":1}');
        expect(row.__rec).toBe(r);
    });

    it("survives a record with no metadata at all", () => {
        let row = flatten_record({value: 1});
        expect(row.t).toBe("");
        expect(row.rowid).toBe("");
        expect(row.value).toBe(1);
    });
});


describe("op_filter", () => {
    it("compares numerically when both sides are numbers", () => {
        expect(op_filter(">200", 201)).toBe(true);
        expect(op_filter(">200", 200)).toBe(false);
        expect(op_filter("<=5", 5)).toBe(true);
        expect(op_filter("!=5", 6)).toBe(true);
        expect(op_filter(">= 200", "201")).toBe(true);   /*  spaces allowed  */
    });

    it("falls back to a string comparison when they are not", () => {
        expect(op_filter("=ok", "OK")).toBe(true);
        expect(op_filter("!=ok", "ko")).toBe(true);
    });

    it("takes a bare term as a case-insensitive substring", () => {
        expect(op_filter("err", "an ERROR happened")).toBe(true);
        expect(op_filter("err", "fine")).toBe(false);
    });

    it("filters nothing on an empty term, and does not choke on empty cells", () => {
        expect(op_filter("", "anything")).toBe(true);
        expect(op_filter(null, "anything")).toBe(true);
        expect(op_filter("x", null)).toBe(false);
        expect(op_filter("x", undefined)).toBe(false);
    });
});


describe("the URL segment of a view", () => {
    it("carries the whole card: key, mode and match conditions", () => {
        let card = {
            key: "dev-42",
            mode: "rows",
            match_cond: {from_t: 1000, to_t: 2000, backward: 1}
        };
        let seg = encode_seg("readings", card);
        let back = decode_seg(seg);

        expect(back.topic).toBe("readings");
        expect(back.card.key).toBe("dev-42");
        expect(back.card.mode).toBe("rows");
        expect(back.card.match_cond).toEqual({from_t: 1000, to_t: 2000, backward: 1});
    });

    it("stays ONE url path segment (no slash, no ?, no #)", () => {
        let seg = encode_seg("readings", {
            key: "a/b?c#d e",       /*  a key is user data: it can hold anything  */
            mode: "live",
            match_cond: {}
        });
        expect(seg).not.toMatch(/[/?#]/);
        expect(decode_seg(seg).card.key).toBe("a/b?c#d e");
    });

    it("survives a whole-topic card (the empty key)", () => {
        let seg = encode_seg("readings", {key: "", mode: "live", match_cond: {}});
        let back = decode_seg(seg);
        expect(back.card.key).toBe("");
        expect(back.card.mode).toBe("live");
    });

    it("is a bare topic when there is no card", () => {
        expect(encode_seg("readings", null)).toBe("readings");
        expect(decode_seg("readings")).toEqual({topic: "readings", card: null});
    });

    it("degrades to the topic on a corrupt or unknown payload", () => {
        /*  A link is never worth failing a navigation for: a truncated link, or
         *  one written by a version that knows more than we do, still opens its
         *  topic.  */
        expect(decode_seg("readings~not-base64!!").card).toBe(null);
        expect(decode_seg("readings~").card).toBe(null);
        expect(decode_seg("readings~" + btoa('{"m":"telepathy"}')).card).toBe(null);
        expect(decode_seg("readings~not-base64!!").topic).toBe("readings");
    });

    it("round-trips a non-ASCII key", () => {
        let seg = encode_seg("lecturas", {key: "año-ñ-日本", mode: "rows", match_cond: {}});
        expect(decode_seg(seg).card.key).toBe("año-ñ-日本");
    });
});
