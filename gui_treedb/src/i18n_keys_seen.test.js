/***********************************************************************
 *          i18n_keys_seen.test.js
 *
 *      A key of the locales that validate-locales cannot see in the source
 *      is a key it cannot defend: deleted from a locale, the build still
 *      says OK, and the text renders as its raw key in every language
 *      (`english`/`spanish`, the history's sort buttons and
 *      the own scope of a role's permission reached t() through a
 *      parameter of a helper of the app, unmarked).
 *
 *      A key handed to t() through a variable is made visible the way the
 *      gobj-ui README ("Conventions", i18n) says: its module publishes it
 *      (`export const <NAME>_I18N_KEYS = [...]`) and the place that reads it
 *      is marked (`t(/* i18n: <NAME>_I18N_KEYS *\/ key)`).
 *
 *      This test asks the SAME reader the prebuild runs (the
 *      validate-locales of the gobj-ui this app builds with) which keys of
 *      the English locale it finds used, and compares the rest with
 *      UNSEEN below -- the keys nobody has made visible yet: some come as
 *      data from a backend (error codes), some are asked for by gobj-ui at
 *      run time, some reach t() through a helper nobody marked, and some
 *      may be dead. The list may only shrink:
 *
 *        - a key that is unseen and not in the list fails: publish and mark
 *          it, never add it here;
 *        - a key of the list that is seen now, or is gone from the locale,
 *          fails too: take it out of the list.
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
const {collect_used_keys} = await import(new URL("../scripts/validate-locales.mjs", GOBJ_UI).href);
const {en} = await import("./locales/en.js");

const PLURAL_RE = /_(zero|one|two|few|many|other)$/;

const UNSEEN = [
    "0 = last",
    "1-based; negative = from end",
    "__icons__",
    "_xxx",
    "account_disabled",
    "application",
    "auth bff",
    "auth_config_error",
    "auth_empty_response",
    "auth_rate_limited",
    "auth_service_unavailable",
    "auth_timeout",
    "auth_unexpected_error",
    "bad services answer",
    "browse every service",
    "browse this service",
    "cause",
    "class",
    "clear search",
    "confirm",
    "connection closed",
    "connection to backend refused",
    "discard",
    "filter keys",
    "filter the loaded keys",
    "from rowid",
    "gclass traces survive a restart, gobj traces end with the yuno",
    "global",
    "hide services",
    "hook column",
    "hook topic",
    "host",
    "invalid_credentials",
    "item",
    "keys (regex)",
    "leave blank for the full key",
    "legend",
    "load more",
    "logged in as",
    "network_error",
    "no methods declared",
    "no registered url for remote service",
    "no yuneta backend url available",
    "nodes",
    "none",
    "page",
    "previous page",
    "realtime coming soon",
    "refresh_denied",
    "regex over the keys",
    "remote service",
    "remove selected",
    "remove {{n}} connections",
    "reset sizes",
    "reset topic sizes",
    "reset zoom",
    "rows and flags",
    "scan timeout",
    "search in the loaded records",
    "search records",
    "select dates please",
    "server_busy",
    "services failed",
    "session_expired",
    "show services",
    "slide bar to choose option",
    "state",
    "tenant",
    "the file could not be read",
    "the file holds no usable connection",
    "the file is not a connections export",
    "time",
    "to rowid",
    "user",
    "user-flag mask clear",
    "user-flag mask set",
    "user_flag bits",
    "which clock, and which period",
    "{{n}} more"
];

/***************************************************************
 *  The keys of the English locale the reader finds no use of
 ***************************************************************/
function unseen_keys()
{
    let pkg = JSON.parse(readFileSync(new URL("package.json", APP), "utf8"));
    let cfg = pkg["validate-locales"] || {};
    let {keys} = collect_used_keys({
        src: [new URL("src/", APP)],
        locales: new URL("src/locales/", APP),
        config: new URL("src/app_config.json", APP),
        attr_keys: cfg.attr_keys || [],
        array_keys: cfg.array_keys || []
    });
    return Object.keys(en.translation)
        .filter((k) => !keys.has(k) && !keys.has(k.replace(PLURAL_RE, "")))
        .sort();
}

describe("validate-locales sees every key of the locales", () => {
    let unseen = unseen_keys();

    test("no key is unseen but the ones listed", () => {
        expect(unseen.filter((k) => !UNSEEN.includes(k))).toEqual([]);
    });

    test("the list holds no key that is seen now or gone", () => {
        expect(UNSEEN.filter((k) => !unseen.includes(k))).toEqual([]);
    });
});
