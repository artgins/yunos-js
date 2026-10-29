/***********************************************************************
 *          i18n_keys_seen.test.js
 *
 *      A key of the locales that validate-locales cannot see in the source
 *      is a key it cannot defend: deleted from a locale, the build still
 *      says OK, and the text renders as its raw key in every language
 *      (REV-CLOUD V46.3: `english`/`spanish`, the history's sort buttons and
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
    "__icons__",
    "_xxx",
    "a reverted draft is still saved",
    "active",
    "add agent",
    "add permission",
    "agent cli",
    "agents",
    "agents subtitle",
    "an agent with this label already exists",
    "appearance",
    "application",
    "apply needs a node restart",
    "apply waits for the save",
    "auth bff",
    "auth config saved",
    "auth subtitle",
    "auth url",
    "authentication",
    "bff help",
    "bff url",
    "client id",
    "closed",
    "command history",
    "comparing",
    "connecting",
    "control center",
    "control key",
    "create role",
    "create user",
    "discard",
    "discovery unanswered",
    "display mode",
    "down arrow",
    "edit agent",
    "email",
    "enable user",
    "end key",
    "endpoint url",
    "enter key",
    "escape key",
    "failed",
    "gclass traces survive a restart, gobj traces end with the yuno",
    "global",
    "help",
    "home key",
    "hyphen",
    "interrupt (ctrl+c)",
    "label",
    "label and url are required",
    "language",
    "left arrow",
    "legend",
    "live stats from a node's yunos",
    "logged in as",
    "login",
    "monitor",
    "monitor cannot reach the agent",
    "monitor clear history",
    "monitor connect",
    "monitor disconnect",
    "monitor identity refused",
    "monitor no scenario",
    "monitor pause readings",
    "monitor propose links",
    "monitor read once",
    "monitor refresh",
    "monitor resume readings",
    "monitor scenario",
    "monitor test",
    "monitor token not exposed",
    "monitor token refused",
    "monitor token unreachable",
    "monitor window",
    "no active agent",
    "no agents configured",
    "no matching nodes",
    "no methods declared",
    "no schema owner in this yuno",
    "nodes subtitle",
    "nothing saved to apply",
    "off",
    "only in c",
    "only in stored",
    "pending changes",
    "pick a treedb",
    "pick yunos hint",
    "pipe",
    "plane",
    "provider",
    "raise",
    "raise the version",
    "remote name",
    "remote role",
    "remote service",
    "remove from selection",
    "remove permission",
    "reset sizes",
    "reset stats",
    "reset topic sizes",
    "reset zoom",
    "response",
    "right arrow",
    "role realm help",
    "role scope help",
    "role service help",
    "save role",
    "save roles",
    "scenario action answers",
    "scenario agent url or node",
    "scenario bad action",
    "scenario bad id",
    "scenario bad link",
    "scenario bad max_run",
    "scenario bad node",
    "scenario bad node labels",
    "scenario bad queue service",
    "scenario bad rate",
    "scenario bad service",
    "scenario bad step",
    "scenario bad switch",
    "scenario bad test",
    "scenario bad test command",
    "scenario bad view",
    "scenario changed since read",
    "scenario duplicate yuno",
    "scenario framework step parameter",
    "scenario invalid json",
    "scenario kept in this browser",
    "scenario needs a place",
    "scenario needs agent url",
    "scenario needs yunos",
    "scenario new",
    "scenario not deleted",
    "scenario not opened",
    "scenario not saved",
    "scenario reserved step parameter",
    "scenario run interrupted",
    "scenario run timed out",
    "scenario runs not read",
    "scenario yuno needs id",
    "schema editor",
    "select",
    "select language",
    "select theme",
    "session",
    "set active",
    "settings",
    "show the keyboard",
    "signing in",
    "slash",
    "slide bar to choose option",
    "state",
    "statistic",
    "statistics",
    "statistics layout",
    "stats one tab",
    "stats refresh",
    "stats tab per yuno",
    "storage tables",
    "system theme",
    "tab key",
    "tenant",
    "the node did not answer",
    "theme",
    "topic version not bumped",
    "underscore",
    "unit minutes short",
    "unit seconds short",
    "up arrow",
    "url must start with ws or wss",
    "user already exists",
    "username bad chars",
    "username required",
    "users not read",
    "users write failed",
    "users write not sent",
    "version mismatch",
    "version not raised",
    "watch the yunos of a test live"
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
