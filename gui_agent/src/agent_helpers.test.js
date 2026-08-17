/***********************************************************************
 *          agent_helpers.test.js
 *
 *      Unit tests of the data-in/data-out half of this console
 *      (src/agent_helpers.js). What is worth pinning here is the EDGE
 *      cases, because the happy path is exercised every time anyone
 *      opens the app — and because most of these functions exist to
 *      survive input this app does not control: free text from an
 *      agent, a history written by an older build, whatever the
 *      operator types.
 *
 *      What is NOT here: views, FSMs, transports. Those need a running
 *      yuno, a shell and a backend, which is `scripts/qa.mjs`'s job.
 ***********************************************************************/
import { describe, test, expect } from "vitest";
import {
    version_tuple,
    version_gte,
    version_cmp,
    node_id,
    parse_agent_line,
    esc,
    fmt_value,
    split_args,
    apply_shortkey,
    normalize_history,
} from "./agent_helpers.js";


describe("versions", () => {
    test("a dotted version becomes numbers", () => {
        expect(version_tuple("7.12.0")).toEqual([7, 12, 0]);
    });

    test("junk and missing components count as 0 instead of NaN", () => {
        expect(version_tuple("7.x.1")).toEqual([7, 0, 1]);
        expect(version_tuple("")).toEqual([0]);
        expect(version_tuple(null)).toEqual([0]);
        expect(version_tuple(undefined)).toEqual([0]);
    });

    test("7.10.0 is NEWER than 7.9.0 — the whole reason this is not a string sort", () => {
        expect(version_cmp("7.10.0", "7.9.0")).toBeGreaterThan(0);
        expect(version_gte("7.10.0", "7.9.0")).toBe(true);
        /*  What a plain string comparison would have said:  */
        expect("7.10.0" > "7.9.0").toBe(false);
    });

    test("equal versions compare equal, with or without the trailing zero", () => {
        expect(version_cmp("7.7.0", "7.7.0")).toBe(0);
        expect(version_cmp("7.7", "7.7.0")).toBe(0);
        expect(version_gte("7.7", "7.7.0")).toBe(true);
    });

    test("the 7.7.0 gate of Commands / Statistics / Schemas", () => {
        expect(version_gte("7.7.0", "7.7.0")).toBe(true);
        expect(version_gte("7.12.0", "7.7.0")).toBe(true);
        expect(version_gte("7.6.9", "7.7.0")).toBe(false);
        expect(version_gte("", "7.7.0")).toBe(false);
    });

    test("an empty minimum accepts every version — that is Terminal's list", () => {
        expect(version_gte("1.0.0", "")).toBe(true);
        expect(version_gte("", "")).toBe(true);
        expect(version_gte(undefined, "")).toBe(true);
    });

    test("cmp sorts a real list the way the column should", () => {
        const sorted = ["7.9.0", "7.12.0", "7.10.0", "7.9.11"].sort(version_cmp);
        expect(sorted).toEqual(["7.9.0", "7.9.11", "7.10.0", "7.12.0"]);
    });
});


describe("parse_agent_line", () => {
    const LINE = "UUID:8f3c-1 (yuneta_agent, 7.12.0),  HOSTNAME:'gines-nitroan51753'";

    test("pulls uuid, role, version and host out of the agent's free text", () => {
        expect(parse_agent_line(LINE)).toEqual({
            uuid:    "8f3c-1",
            role:    "yuneta_agent",
            version: "7.12.0",
            host:    "gines-nitroan51753",
        });
    });

    test("a field that is not there comes back EMPTY, never undefined", () => {
        /*  These values land in Tabulator cells, where `undefined` renders
         *  as the word "undefined".  */
        const r = parse_agent_line("UUID:only-this");
        expect(r).toEqual({uuid: "only-this", role: "", version: "", host: ""});
        for(const v of Object.values(r)) {
            expect(typeof v).toBe("string");
        }
    });

    test("garbage in, empty strings out — no throw", () => {
        expect(parse_agent_line("")).toEqual({uuid: "", role: "", version: "", host: ""});
        expect(parse_agent_line(null).uuid).toBe("");
        expect(parse_agent_line(undefined).host).toBe("");
    });

    test("an empty HOSTNAME:'' is an empty host, and node_id falls back to the uuid", () => {
        const r = parse_agent_line("UUID:u-1 (agent, 7.12.0) HOSTNAME:''");
        expect(r.host).toBe("");
        expect(node_id(r)).toBe("u-1");
    });
});


describe("node_id", () => {
    test("prefers the host", () => {
        expect(node_id({host: "nitro", uuid: "u-1"})).toBe("nitro");
    });

    test("falls back to the uuid, and to an empty string", () => {
        expect(node_id({host: "", uuid: "u-1"})).toBe("u-1");
        expect(node_id({})).toBe("");
        expect(node_id(null)).toBe("");
        expect(node_id(undefined)).toBe("");
    });
});


describe("esc", () => {
    test("escapes what a formatter would otherwise inject as markup", () => {
        expect(esc('<img src=x onerror="alert(1)">'))
            .toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });

    test("& first, so an escape is not double-escaped into &amp;lt;", () => {
        expect(esc("a & b")).toBe("a &amp; b");
        expect(esc("&lt;")).toBe("&amp;lt;");
    });

    test("null and undefined render as nothing, not as their names", () => {
        expect(esc(null)).toBe("");
        expect(esc(undefined)).toBe("");
        expect(esc(0)).toBe("0");
        expect(esc(false)).toBe("false");
    });
});


describe("fmt_value", () => {
    test("integers get '.' thousands grouping", () => {
        expect(fmt_value(1)).toBe("1");
        expect(fmt_value(999)).toBe("999");
        expect(fmt_value(1000)).toBe("1.000");
        expect(fmt_value(1234567)).toBe("1.234.567");
    });

    test("the sign stays outside the grouping", () => {
        expect(fmt_value(-1234567)).toBe("-1.234.567");
        expect(fmt_value(-999)).toBe("-999");
        expect(fmt_value(0)).toBe("0");
    });

    test("non-integers pass through as they came — no rounding surprises", () => {
        expect(fmt_value(1234.5)).toBe("1234.5");
        expect(fmt_value("/yuneta/store/devices")).toBe("/yuneta/store/devices");
        expect(fmt_value(true)).toBe("true");
    });

    test("an absent counter is blank, not '0' and not 'null'", () => {
        expect(fmt_value(null)).toBe("");
        expect(fmt_value(undefined)).toBe("");
    });
});


describe("split_args", () => {
    test("splits on whitespace", () => {
        expect(split_args("list-yunos id=3")).toEqual(["list-yunos", "id=3"]);
        expect(split_args("  spaced   out\ttabbed ")).toEqual(["spaced", "out", "tabbed"]);
    });

    test("quotes hold a value together, and are removed", () => {
        expect(split_args('add-shortkey key=e command="search text"'))
            .toEqual(["add-shortkey", "key=e", "command=search text"]);
        expect(split_args("error 'two words'")).toEqual(["error", "two words"]);
    });

    test("EMPTY quotes are a token — `error \"\"` passes an empty argument", () => {
        expect(split_args('error ""')).toEqual(["error", ""]);
        expect(split_args("''")).toEqual([""]);
    });

    test("a quote can open mid-token, which is how command=\"a b\" works", () => {
        expect(split_args('cmd2agent="stats-yuno id=1"'))
            .toEqual(["cmd2agent=stats-yuno id=1"]);
    });

    test("the other quote character survives inside a quoted run", () => {
        expect(split_args(`say "it's fine"`)).toEqual(["say", "it's fine"]);
    });

    test("nothing in, nothing out", () => {
        expect(split_args("")).toEqual([]);
        expect(split_args("   ")).toEqual([]);
        expect(split_args(null)).toEqual([]);
    });
});


describe("apply_shortkey", () => {
    const KEYS = {
        s:     "stats-yuno yuno_role=logcenter",
        r:     "run-yuno id=$1",
        two:   "command-yuno id=$1 service=$2 command=$3",
        error: 'command-yuno yuno_role=logcenter service=logs command=search text="$1"',
    };

    test("a first-token hit expands to its template", () => {
        expect(apply_shortkey(KEYS, "s")).toBe("stats-yuno yuno_role=logcenter");
    });

    test("positional args land in $1 $2 $3", () => {
        expect(apply_shortkey(KEYS, "two 2046 __yuno__ services"))
            .toBe("command-yuno id=2046 service=__yuno__ command=services");
    });

    test("a quoted argument reaches $1 whole", () => {
        expect(apply_shortkey(KEYS, 'error "disk full"'))
            .toBe('command-yuno yuno_role=logcenter service=logs command=search text="disk full"');
    });

    test("$1 does NOT eat the 1 of $10 — the reason substitution runs high to low", () => {
        /*  The values must NOT look like "a" + N: with a1…a11, replacing $1
         *  first turns "$10" into "a10", which is accidentally the right
         *  answer, and the test passes against the broken order. A mutation
         *  run caught exactly that here.  */
        const keys = {t: "[$1][$2][$10][$11]"};
        const args = ["ONE", "TWO", "x3", "x4", "x5", "x6", "x7", "x8", "x9",
                      "TEN", "ELEVEN"];
        expect(apply_shortkey(keys, "t " + args.join(" ")))
            .toBe("[ONE][TWO][TEN][ELEVEN]");
    });

    test("a $N with no argument for it is left in place, not blanked", () => {
        /*  Better a visible "$2" the operator can see and fix than a
         *  silently truncated command.  */
        expect(apply_shortkey(KEYS, "two 2046")).toBe("command-yuno id=2046 service=$2 command=$3");
    });

    test("extra arguments beyond the template's $N are dropped", () => {
        expect(apply_shortkey(KEYS, "r 7 and more")).toBe("run-yuno id=7");
    });

    test("no match returns the command UNTOUCHED — never swallow what was typed", () => {
        expect(apply_shortkey(KEYS, "list-yunos")).toBe("list-yunos");
        expect(apply_shortkey(KEYS, "")).toBe("");
        expect(apply_shortkey({}, "s")).toBe("s");
        expect(apply_shortkey(null, "s")).toBe("s");
        expect(apply_shortkey(undefined, "s")).toBe("s");
    });

    test("only the FIRST token is a key: the same word later is just an argument", () => {
        expect(apply_shortkey(KEYS, "r s")).toBe("run-yuno id=s");
    });

    test("an inherited property is not a shortkey", () => {
        /*  hasOwnProperty, not `in`: "toString" must not expand.  */
        expect(apply_shortkey(KEYS, "toString")).toBe("toString");
        expect(apply_shortkey(KEYS, "constructor")).toBe("constructor");
    });
});


describe("normalize_history", () => {
    const NOW = 1_700_000_000_000;

    test("the deduped format passes through, keeping counts", () => {
        const out = normalize_history([
            {cmd: "top", count: 3, last: NOW},
            {cmd: "list-yunos", count: 1, last: NOW - 1},
        ], NOW);
        expect(out).toEqual([
            {cmd: "top", count: 3, last: NOW},
            {cmd: "list-yunos", count: 1, last: NOW - 1},
        ]);
    });

    test("the LEGACY plain-string format collapses, and counts the repetitions", () => {
        const out = normalize_history(["top", "stats", "top", "top"], NOW);
        expect(out.map((e) => e.cmd)).toEqual(["top", "stats"]);
        expect(out.find((e) => e.cmd === "top").count).toBe(3);
        expect(out.find((e) => e.cmd === "stats").count).toBe(1);
    });

    test("order is preserved, newest first, via a descending synthetic stamp", () => {
        const out = normalize_history(["a", "b", "c"], NOW);
        expect(out.map((e) => e.cmd)).toEqual(["a", "b", "c"]);
        expect(out[0].last).toBeGreaterThan(out[1].last);
        expect(out[1].last).toBeGreaterThan(out[2].last);
    });

    test("a mixed store (an older build's strings next to new entries) merges", () => {
        const out = normalize_history(["top", {cmd: "top", count: 2, last: NOW}], NOW);
        expect(out).toHaveLength(1);
        expect(out[0].count).toBe(3);
    });

    test("junk entries are dropped instead of becoming a row that cannot be run", () => {
        expect(normalize_history([null, undefined, "", 42, {}, {cmd: ""}, {cmd: 7}], NOW))
            .toEqual([]);
    });

    test("anything that is not a list is an empty history", () => {
        expect(normalize_history(null)).toEqual([]);
        expect(normalize_history(undefined)).toEqual([]);
        expect(normalize_history("top")).toEqual([]);
        expect(normalize_history({cmd: "top"})).toEqual([]);
    });

    test("a bad count or last falls back instead of poisoning the sort", () => {
        const out = normalize_history([{cmd: "top", count: 0, last: -1}], NOW);
        expect(out[0].count).toBe(1);
        expect(out[0].last).toBe(NOW);
    });

    test("the Frequent order the popover offers", () => {
        const out = normalize_history(["a", "b", "b", "c", "c", "c"], NOW);
        const by_freq = out.slice().sort((x, y) => (y.count - x.count) || (y.last - x.last));
        expect(by_freq.map((e) => e.cmd)).toEqual(["c", "b", "a"]);
    });
});
