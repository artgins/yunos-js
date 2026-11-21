// @vitest-environment jsdom
/***********************************************************************
 *          tranger_view_restore.test.js
 *
 *      The answer of the saved-view check (`list-keys key=[...]`,
 *      purpose "restore"): the views whose key the topic still has are
 *      reopened, through the FSM (EV_OPEN_CARD), with the span of their
 *      key remembered; a stale saved view is skipped quietly, and a
 *      shared link to a missing key is said. A FAILED check of a topic
 *      the view has left is dropped with no error shown; one of the topic
 *      shown says its error and drops the views it was asked for (up to
 *      gui_treedb 1.3.7 the error came first, whatever the topic, and the
 *      wanted views were kept). The command answer of
 *      C_TRANGER_VIEW is taken from the gclass and called with a gobj
 *      made here.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, vi, beforeEach} from "vitest";

const logged = {error: [], warning: []};
const sent = [];

vi.mock("@yuneta/gobj-js", async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        gobj_short_name: () => "C_TRANGER_VIEW^test",
        msg_iev_get_stack: (gobj, kw) => kw.__command__,
        gobj_send_event: (gobj, event, kw) => {
            sent.push({event: event, kw: kw});
            return 0;
        },
        log_error: (msg) => {
            logged.error.push(msg);
        },
        log_warning: (msg) => {
            logged.warning.push(msg);
        },
    };
});

import {gclass_find_by_name} from "@yuneta/gobj-js";
import {register_c_tranger_view} from "./c_tranger_view.js";

register_c_tranger_view();
const GCLASS = gclass_find_by_name("C_TRANGER_VIEW");

function answer_action()
{
    for(const st of GCLASS.dl_states) {
        const a = st.dl_actions.find((x) => x.event_name === "EV_MT_COMMAND_ANSWER");
        if(a) {
            return a.action;
        }
    }
    return null;
}

function view(wanted)
{
    return {priv: {pending: {}, cur_topic: "t", key_spans: {}, wanted_views: wanted}};
}

function restore_answer(gobj, data, topic, failed, purpose)
{
    answer_action()(gobj, "EV_MT_COMMAND_ANSWER", {
        result: failed ? -1 : 0,
        comment: failed ? "Bad rkey regex" : "",
        data: data,
        __command__: {
            command: "list-keys",
            kw: {topic_name: topic || "t", purpose: purpose || "restore"}
        },
    }, gobj);
}

beforeEach(() => {
    logged.error.length = 0;
    logged.warning.length = 0;
    sent.length = 0;
});

describe("the answer of the saved-view check", () => {
    test("reopens the views whose key exists, and remembers its span", () => {
        const gobj = view([
            {key: "k1", mode: "rows", match_cond: {}, restoring: true},
            {key: "gone", mode: "live", match_cond: {}, restoring: true},
            {key: "7", mode: "live", match_cond: {}, restoring: true},
        ]);
        /*  The backend answers the keys it has, in the order asked; a
         *  numeric key comes back as a number.  */
        restore_answer(gobj, [
            {key: "k1", records: 3, fr_t: 10, to_t: 20, fr_tm: 11, to_tm: 21},
            {key: 7, records: 1, fr_t: 5, to_t: 5, fr_tm: 5, to_tm: 5},
        ]);
        expect(sent.map((s) => [s.event, s.kw.key, s.kw.mode])).toEqual([
            ["EV_OPEN_CARD", "k1", "rows"],
            ["EV_OPEN_CARD", "7", "live"],
        ]);
        expect(gobj.priv.key_spans.k1).toEqual({fr_t: 10, to_t: 20, fr_tm: 11, to_tm: 21});
        expect(gobj.priv.key_spans["7"]).toEqual({fr_t: 5, to_t: 5, fr_tm: 5, to_tm: 5});
        expect(gobj.priv.wanted_views).toBe(null);
        expect(logged.error).toEqual([]);
        expect(logged.warning).toEqual([]);
    });

    test("an envelope answer (a page) is read the same", () => {
        const gobj = view([{key: "k1", mode: "rows", match_cond: {}, restoring: true}]);
        restore_answer(gobj, {total_rows: 1, pages: 1, data: [{key: "k1", records: 3}]});
        expect(sent.map((s) => s.kw.key)).toEqual(["k1"]);
    });

    test("a shared link to a key the topic does not have is said", () => {
        const gobj = view([{key: "nope", mode: "rows", match_cond: {}, restoring: false}]);
        restore_answer(gobj, []);
        expect(sent).toEqual([]);
        expect(logged.error.length).toBe(1);
        expect(logged.error[0]).toContain("'nope'");
    });

    test("an answer for a topic the view has left opens nothing", () => {
        const gobj = view([{key: "k1", mode: "rows", match_cond: {}, restoring: true}]);
        restore_answer(gobj, [{key: "k1", records: 3}], "other");
        expect(sent).toEqual([]);
        expect(gobj.priv.wanted_views.length).toBe(1);
    });

    test("a failed check of a topic the view has left shows no error", () => {
        const wanted = [{key: "k1", mode: "rows", match_cond: {}, restoring: true}];
        const gobj = view(wanted);
        gobj.priv.error_key = "";
        restore_answer(gobj, null, "other", true);
        expect(gobj.priv.error_key).toBe("");
        /*  the wanted views are the CURRENT topic's: not touched  */
        expect(gobj.priv.wanted_views).toBe(wanted);
        expect(sent).toEqual([]);
    });

    test("a failed key count of a topic the view has left shows no error", () => {
        const gobj = view(null);
        gobj.priv.error_key = "";
        restore_answer(gobj, null, "other", true, "count");
        expect(gobj.priv.error_key).toBe("");
    });

    test("a failed check of the topic shown says it and drops its wanted views", () => {
        const gobj = view([{key: "k1", mode: "rows", match_cond: {}, restoring: true}]);
        gobj.priv.error_key = "";
        restore_answer(gobj, null, "t", true);
        expect(gobj.priv.error_key).toBe("Bad rkey regex");
        expect(gobj.priv.wanted_views).toBe(null);
        expect(sent).toEqual([]);
    });
});
