/***********************************************************************
 *          i18n_key_reads.test.js
 *
 *      A key that reaches t() -- or an i18n / data-i18n* value -- through
 *      a value validate-locales cannot follow (a parameter, a property of
 *      data, a `let` given anything but literals) is read by NOBODY at
 *      build time: if it is in no locale, i18next answers it with the key
 *      itself, and it renders raw, in every language.
 *      i18n_keys_seen.test.js cannot see it either: it starts from the
 *      keys the locales HAVE.
 *
 *      So each such READ is listed here, by file, the kind of place
 *      (key_places() of validate-locales: `t`, `property`, `attribute`,
 *      `assignment`, `array`) and the text of the value read. A read that
 *      is MARKED is not listed: `/* i18n: <NAME>_I18N_KEYS *\/` makes
 *      validate-locales ask the locales for every key of that list, and
 *      `/* i18n: data *\/` says what is read is no key. The list may only
 *      shrink:
 *
 *        - a new read that is not followed and not marked fails: mark it
 *          (with the list of its keys, published by its module), or hand
 *          a const the reader follows; never add it here;
 *        - a read of the list that is gone, followed or marked now fails
 *          too: take it out of the list.
 *
 *      What stays invisible: a NEW value reaching a read of the list
 *      below, or a value at run time that is not in the list its marker
 *      names -- the reader knows the places, not the values data brings.
 *      The keys of the gobj-ui modules the app mounts are the library's,
 *      held by its own test.
 *
 *      It asks the SAME reader the prebuild runs (the validate-locales of
 *      the gobj-ui this app builds with).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect} from "vitest";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

const APP = new URL("../", import.meta.url);
const GOBJ_UI = pathToFileURL(createRequire(import.meta.url).resolve("@yuneta/gobj-ui/src/c_yui_shell.js"));
const V = await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);

/*  The reads nobody follows yet: the file, the place, the value read  */
const NOT_FOLLOWED = [
    "c_app.js: property `key`",
    "c_tranger_view.js: attribute `label`",
    "c_tranger_view.js: property `label`",
    "c_tranger_view.js: property `label`",
    "c_tranger_view.js: property `label`",
    "c_tranger_view.js: property `mode`",
    "c_tranger_view.js: property `ph`",
    "c_tranger_view.js: property `subtitle`",
    "c_tranger_view.js: property `title`",
    "c_tranger_view.js: t `label`",
    "c_tranger_view.js: t `label`",
    "c_tranger_view.js: t `label`",
    "c_tranger_view.js: t `label`",
    "c_tranger_view.js: t `mode`",
    "c_tranger_view.js: t `ph`",
    "c_tranger_view.js: t `subtitle`",
    "c_tranger_view.js: t `title`",
    "c_treedb_connections.js: t `err.error`",
    "login.js: t `el.dataset.i18nAriaLabel`",
    "login.js: t `el.dataset.i18nTitle`",
    "login.js: t `key`"
];

/***************************************************************
 *  Is a leaf a `let` / `var` the reader follows to its literals
 *  (validate-locales' literal_let_keys(): every value it is given
 *  is a literal, a const that is one, or nothing)
 ***************************************************************/
function is_literal_let(leaf)
{
    if(leaf.kind !== "unknown" || !leaf.var_root || leaf.var_root.steps.length > 0) {
        return false;
    }
    let r = V.var_leaves(leaf.var_root);
    return r.complete && !r.written &&
        r.leaves.every((l) => l.kind === "key" || l.kind === "nothing");
}

/***************************************************************
 *  The reads of the app's source whose key the reader cannot
 *  follow and nobody marked
 ***************************************************************/
function not_followed()
{
    let pkg = JSON.parse(readFileSync(new URL("package.json", APP), "utf8"));
    let cfg = pkg["validate-locales"] || {};
    let ctx = {attr_keys: new Set(cfg.attr_keys || []), array_keys: new Set(cfg.array_keys || [])};
    let src = new URL("src/", APP);
    let out = [];
    for(let url of V.source_files(src, new URL("locales/", src))) {
        let code = readFileSync(url, "utf8");
        let ast = V.parse_source(code, url);
        let markers = V.markers_of(ast);
        let file = url.href.slice(src.href.length);
        for(let place of V.key_places(ast, ctx)) {
            if(place.what === "call" || place.what === "callback") {
                continue;   /*  held by the rule per call of validate-locales  */
            }
            for(let leaf of place.leaves) {
                if(["key", "nothing", "dom"].includes(leaf.kind) || V.marker_of(leaf, markers) ||
                        is_literal_let(leaf)) {
                    continue;
                }
                let n = leaf.node || place.node;
                out.push(`${file}: ${place.what} \`${code.slice(n.start, n.end).replace(/\s+/g, " ")}\``);
            }
        }
    }
    return out.sort();
}

/***************************************************************
 *  What `a` holds more times than `b` (a multiset difference)
 ***************************************************************/
function minus(a, b)
{
    let left = new Map();
    for(let x of b) {
        left.set(x, (left.get(x) || 0) + 1);
    }
    let out = [];
    for(let x of a) {
        if(left.get(x) > 0) {
            left.set(x, left.get(x) - 1);
        } else {
            out.push(x);
        }
    }
    return out;
}

describe("a key read nobody follows is marked, or one of the known ones", () => {
    let reads = not_followed();

    test("the scan reads the sources of the app", () => {
        expect(V.source_files(new URL("src/", APP), new URL("src/locales/", APP)).length)
            .toBeGreaterThan(10);
    });

    test("no read is unfollowed and unmarked but the ones listed", () => {
        expect(minus(reads, NOT_FOLLOWED)).toEqual([]);
    });

    test("the list holds no read that is gone, followed or marked now", () => {
        expect(minus(NOT_FOLLOWED, reads)).toEqual([]);
    });
});
