/***********************************************************************
 *          validate-locales.mjs
 *
 *          Enforce the i18n key conventions on every bundled locale:
 *
 *            1. Keys are ASCII (no em-dash, accents, etc.).
 *            2. Keys are lower-case.
 *            3. All locales carry the same key set (symmetric).
 *            4. No duplicate key in a locale file (an object literal keeps the
 *               LAST one and says nothing — a stale entry silently overrides a
 *               new one; it happened to "last" and "loading").
 *            5. Every key the SOURCE uses is defined (i18next answers an
 *               unknown key with the key ITSELF, so a missing entry renders
 *               fine and simply never changes language — invisible by
 *               construction, and it shipped: the Settings `label` column).
 *
 *          Run via `npm run validate-locales` or as a vite prebuild
 *          step.  Exits 1 on any violation so CI fails loudly.
 *
 *          Imports the per-locale modules directly (en.js, es.js)
 *          rather than going through locales.js — the wrapper drags in
 *          @yuneta/gobj-js + i18next which expect a browser global.
 *          Add new locales to the LOCALES list below as they land.
 *
 *          Copyright (c) 2025, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {readdirSync, readFileSync} from "fs";

import {en} from "../src/locales/en.js";
import {es} from "../src/locales/es.js";

const LOCALES = {en, es};

const ASCII_RE = /^[\x20-\x7e]+$/;

function fail(msg) {
    process.stderr.write(`validate-locales: ${msg}\n`);
}

function main() {
    const codes = Object.keys(LOCALES);
    let errors = 0;

    /*  Per-locale key checks (ASCII + lower-case). */
    const key_sets = {};
    for(const code of codes) {
        const t = (LOCALES[code] && LOCALES[code].translation) || {};
        const keys = Object.keys(t);
        key_sets[code] = new Set(keys);
        for(const k of keys) {
            if(!ASCII_RE.test(k)) {
                fail(`[${code}] non-ASCII key: ${JSON.stringify(k)}`);
                errors++;
            }
            if(k !== k.toLowerCase()) {
                fail(`[${code}] non-lower-case key: ${JSON.stringify(k)}`);
                errors++;
            }
        }
    }

    /*  Symmetry: every locale must carry the same keys as the first. */
    const ref = codes[0];
    const ref_keys = key_sets[ref];
    for(const code of codes.slice(1)) {
        const cur = key_sets[code];
        for(const k of ref_keys) {
            if(!cur.has(k)) {
                fail(`[${code}] missing key present in [${ref}]: ${JSON.stringify(k)}`);
                errors++;
            }
        }
        for(const k of cur) {
            if(!ref_keys.has(k)) {
                fail(`[${code}] extra key not in [${ref}]: ${JSON.stringify(k)}`);
                errors++;
            }
        }
    }

    /*  No DUPLICATE key in a locale file.
     *
     *  A JS object literal keeps the LAST of two identical keys and says
     *  nothing, so the imported dict looks fine while the file lies: a stale
     *  `"last": "ultimos"` further down quietly overrode the `"last":
     *  "Ultima"` added for the paginator. Only the raw text can see it.  */
    for(const code of codes) {
        const src = readFileSync(new URL(`../src/locales/${code}.js`, import.meta.url), "utf8");
        const seen = new Set();
        const re = /^\s*"([^"]+)":/gm;
        let m;
        while((m = re.exec(strip_comments(src))) !== null) {
            if(seen.has(m[1])) {
                fail(`[${code}] DUPLICATE key (the later one silently wins): ${JSON.stringify(m[1])}`);
                errors++;
            }
            seen.add(m[1]);
        }
    }

    /*  Every key the SOURCE asks for must exist.
     *
     *  i18next answers an unknown key with the key itself, so a missing entry
     *  is invisible: the text renders (in English-ish), it just never changes
     *  language. That is exactly how the Settings table shipped a `label`
     *  column header that no locale defined — it read "label" in both
     *  languages and looked like a translation. A key used and not defined is
     *  a violation, not a fallback.  */
    const used = collect_used_keys();
    for(const k of used) {
        if(!ref_keys.has(k)) {
            fail(`key used in the source but defined in NO locale: ${JSON.stringify(k)}`);
            errors++;
        }
    }

    if(errors > 0) {
        fail(`${errors} violation(s) — see above`);
        process.exit(1);
    }

    process.stdout.write(
        `validate-locales: OK (${codes.length} locales × ${ref_keys.size} keys, ` +
        `${used.size} used in the source)\n`);
}

/***************************************************************
 *  The i18n keys the source actually asks for: t("…") and the attributes
 *  refresh_language() re-translates (i18n / data-i18n / data-i18n-title /
 *  data-i18n-aria-label). The `login *` keys of the pre-shell screen carry
 *  their own data-default and are checked by the same rule.
 ***************************************************************/
function collect_used_keys() {
    const keys = new Set();

    /*  Both quote styles: this app quotes with ", the library with '.  */
    const patterns = [
        /\bt\(\s*['"]([^'"]+)['"]/g,
        /\bi18n:\s*['"]([^'"]+)['"]/g,
        /["']data-i18n(?:-title|-aria-label|-placeholder)?["']:\s*['"]([^'"]+)['"]/g,
        /data-i18n(?:-title|-aria-label|-placeholder)?=["']([^"']+)["']/g
    ];
    const scan = (url) => {
        const src = readFileSync(url, "utf8");
        /*  Comments are not code: the library documents the contract with
         *  examples like `data-i18n="<key>"`, and a scan that reads them asks
         *  the locales for a key nobody uses.  */
        const code = strip_comments(src);
        for(const re of patterns) {
            let m;
            while((m = re.exec(code)) !== null) {
                keys.add(m[1]);
            }
        }
        return code;
    };

    /*  This app's own views.  */
    const dir = new URL("../src/", import.meta.url);
    const own = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    const pending = [];
    for(const f of own) {
        const src = scan(new URL(f, dir));
        pending.push(...lib_imports(src));
    }

    /*  ...and the gobj-ui views it MOUNTS. The library translates through the
     *  APP's i18next instance: a key it asks for and this app does not define
     *  renders as the raw key, in every language (that is how the whole treedb
     *  + graph editor shipped reading "edit", "new", "delete", "paste"). Only
     *  the modules actually imported are scanned, transitively — the library
     *  carries views this app never mounts.  */
    const lib = new URL("../../../../kernel/js/gobj-ui/src/", import.meta.url);
    const seen = new Set();
    while(pending.length > 0) {
        const name = pending.pop();
        if(seen.has(name)) {
            continue;
        }
        seen.add(name);
        let src;
        try {
            src = scan(new URL(name, lib));
        } catch(e) {
            continue;   /*  not a source module of the library (css, asset)  */
        }
        pending.push(...lib_imports(src));
    }
    return keys;
}

/***************************************************************
 *  Drop /* … *\/ and // … comments (good enough for a key scan: a "//" or
 *  "/*" inside a string would only ever cost us a key we then report).
 ***************************************************************/
function strip_comments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/***************************************************************
 *  The gobj-ui source modules a file imports ("@yuneta/gobj-ui/src/x.js"
 *  from the app, "./x.js" from inside the library).
 ***************************************************************/
function lib_imports(src) {
    const out = [];
    let m;
    const from_app = /from\s+["']@yuneta\/gobj-ui\/src\/([\w.-]+\.js)["']/g;
    while((m = from_app.exec(src)) !== null) {
        out.push(m[1]);
    }
    const inside = /from\s+["']\.\/([\w.-]+\.js)["']/g;
    while((m = inside.exec(src)) !== null) {
        out.push(m[1]);
    }
    return out;
}

main();
