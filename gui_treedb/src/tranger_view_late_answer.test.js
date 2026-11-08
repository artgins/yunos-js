// @vitest-environment jsdom
/***********************************************************************
 *          tranger_view_late_answer.test.js
 *
 *      A page of a Rows card or of the Keys picker that a slow backend
 *      answers after its request was settled (timed out, the card
 *      closed, the session reopened) has nobody waiting for it.  That is
 *      the PEER's slowness, not a broken contract of the view: it is
 *      said with a WARNING, never an ERROR.  The command answer of
 *      C_TRANGER_VIEW is taken from the gclass and called with a gobj
 *      made here; the log is the test's.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, vi, beforeEach} from "vitest";

const logged = {error: [], warning: []};

vi.mock("@yuneta/gobj-js", async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        gobj_short_name: () => "C_TRANGER_VIEW^test",
        msg_iev_get_stack: (gobj, kw) => kw.__command__,
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

beforeEach(() => {
    logged.error.length = 0;
    logged.warning.length = 0;
});

describe("a late answer of a slow backend", () => {
    const cases = [
        ["get-page", {req_id: "q7"}],
        ["list-keys", {req_id: "q8", purpose: "page", topic_name: "t"}],
    ];
    for(const [command, kw_command] of cases) {
        test(`${command} for a request already settled is a WARNING`, () => {
            const gobj = {priv: {pending: {}, cur_topic: "t"}};
            answer_action()(gobj, "EV_MT_COMMAND_ANSWER", {
                result: 0, comment: "", data: [],
                __command__: {command: command, kw: kw_command},
            }, gobj);
            expect(logged.error).toEqual([]);
            expect(logged.warning.length).toBe(1);
            expect(logged.warning[0]).toContain(kw_command.req_id);
        });
    }
});
