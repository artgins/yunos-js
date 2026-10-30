#!/usr/bin/env node
/***********************************************************************
 *          scripts/qa.mjs
 *
 *      QA driver for the Agent Console, against a deployed plane.
 *
 *      Logs in with the real form, waits for the declarative shell to
 *      mount, walks the routes it was asked for, and writes a full-page
 *      screenshot plus every console message and failed request.
 *
 *      It exists so a change can be self-verified without asking a human
 *      to open a browser. It answers one question — does this build load,
 *      sign in, and mount its shell against a live control center — which
 *      a `curl` of the static files cannot answer.
 *
 *      CREDENTIALS NEVER LIVE IN THE REPO. The user (not a secret) comes
 *      from the environment or `~/.yuneta/.qa-creds` (`QA_USER=`); the
 *      password comes from `QA_PASS` in the environment, for CI, or from
 *      the OS keyring (libsecret / `secret-tool`). Nothing in clear text
 *      on disk. The older key names are still read, after these.
 *
 *      Playwright is not a dependency of this yuno. It is borrowed from
 *      another checkout that already carries it (QA_PW), so a QA run adds
 *      nothing to what this SPA ships.
 *
 *      THE IDS OF THE INSTALLATION NEVER LIVE IN THE REPO EITHER: the
 *      node, yuno, treedb, scenario and role each check opens are the ones
 *      of the control center it runs against. They come from the
 *      environment or from `~/.yuneta/.qa-creds`, as KEY=value lines:
 *      QA_PW, QA_SCHEMA_NODE, QA_SCHEMA_YUNO, QA_SCHEMA_TREEDB,
 *      QA_SCHEMA_TOPICS (two topics of that treedb, comma separated),
 *      QA_HELD_SCENARIO, QA_ROLES_ROLE, QA_QUEUE_GATES (the gates of the
 *      held scenario, comma separated), QA_SWITCH_COUNT (its generators),
 *      QA_NODE_CODES (the 3-letter codes of its nodes, comma separated),
 *      QA_PERM_OFF and QA_PERM_ON (the shell commands of --check
 *      permlive, taken as written, quotes included), and QA_ROLES_NODE,
 *      QA_ROLES_YUNO, which have defaults. A list with no item that is not
 *      empty ("," or " , ") is not set. A check whose setting is not set
 *      fails before the browser is launched, naming it: nothing is opened
 *      and nobody signs in.
 *
 *      Usage:
 *
 *          node scripts/qa.mjs                         # the .com plane
 *          node scripts/qa.mjs --url https://artgins.yunetacontrol.ovh
 *          node scripts/qa.mjs --no-login              # login screen only
 *          node scripts/qa.mjs --check schemaback      # the schema editor's ← = browser Back
 *          node scripts/qa.mjs --check gobjtree        # a card's gobj tree opens and draws its canvas
 *          node scripts/qa.mjs --check chartsheld      # a stopped scenario's charts hold (QA_HELD_SCENARIO)
 *          node scripts/qa.mjs --check controlhelp     # each control of a scenario says what it does
 *          node scripts/qa.mjs --check queues          # the gates' queues: on their cards and charted
 *          node scripts/qa.mjs --check focus           # a clicked card lights up with its links
 *          node scripts/qa.mjs --check livelayout      # charts beside the graph (or under it), series folded
 *          node scripts/qa.mjs --check controlstate    # the action buttons fit the scenario's state (read only)
 *          node scripts/qa.mjs --check switches        # every generator's card has its switch, nodes in 3 letters everywhere (read only)
 *          node scripts/qa.mjs --check roles           # the roles of a store: what each grants, its sheet
 *          node scripts/qa.mjs --check roleswrite      # a role created, edited and deleted (leaves none)
 *          node scripts/qa.mjs --check permlive        # controls follow a role taken and given, no reload (QA_PERM_OFF, QA_PERM_ON)
 *
 *      A BUILD NOT DEPLOYED YET is checked against the same live plane with
 *      --dist: every GET of the plane's origin that names a file of that
 *      directory is answered from it (index.html for "/"), the rest goes
 *      to the plane -- the deploy is an rsync of dist/, so this is what
 *      the deploy would serve. --viewport sets the window (default
 *      1440x900):
 *
 *          node scripts/qa.mjs --dist dist --viewport 1920x1080 --check livelayout
 *          node scripts/qa.mjs --dist dist --viewport 390x844 --check livelayout
 *
 *      Routes are hash routes of the shell, given without the '#':
 *
 *          node scripts/qa.mjs --route /commands/nodes --route /preferences
 *          node scripts/qa.mjs --route /terminal/nodes --route /schemas/nodes
 *
 *      The workspaces are /commands, /terminal, /schemas, /users and
 *      /scenarios; each has a picker at /<ws>/nodes (scenarios: /list,
 *      /yunos, /live) and its per-node tabs at
 *      /<ws>/node/<id>. Preferences is /preferences.
 *
 *      Output (one directory per run):
 *
 *          /tmp/agent-qa-out/<host>-<stamp>/…
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join, normalize, resolve, sep} from "node:path";
import {execFileSync} from "node:child_process";

const DEFAULTS = {
    URL:     "https://artgins.yunetacontrol.com",
    TIMEOUT: 30000,
    OUT:     "/tmp/agent-qa-out",
};

/*
 *  The DOM contract of the login screen (src/login.js). A change there
 *  breaks this driver LOUDLY, which is the point: a silent pass against
 *  a screen that no longer exists is worse than a failure.
 */
const SEL = {
    form:     ".ylogin-fields",
    user:     "input[name=username]",
    password: "input[name=password]",
    submit:   ".ylogin-cta",
    error:    "[data-role=error]",
    /*  C_YUI_SHELL tags its root with its own gclass name.  */
    shell:    ".C_YUI_SHELL",
    loading:  "#loading-message",
};


                    /***************************
                     *      Arguments
                     ***************************/


function parse_args(argv) {
    const out = {url: process.env.QA_URL || DEFAULTS.URL, routes: [], login: true, checks: [],
                 dist: "", viewport: {width: 1440, height: 900}};
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === "--url") {
            out.url = argv[++i];
        } else if(a === "--route") {
            out.routes.push(argv[++i]);
        } else if(a === "--check") {
            out.checks.push(argv[++i]);
        } else if(a === "--dist") {
            out.dist = resolve(argv[++i] || "");
            if(!existsSync(join(out.dist, "index.html"))) {
                throw new Error(`--dist ${out.dist}: no index.html there (npm run build first)`);
            }
        } else if(a === "--viewport") {
            const m = /^(\d+)x(\d+)$/.exec(argv[++i] || "");
            if(!m) {
                throw new Error("--viewport is WIDTHxHEIGHT, e.g. 390x844");
            }
            out.viewport = {width: parseInt(m[1], 10), height: parseInt(m[2], 10)};
        } else if(a === "--no-login") {
            out.login = false;
        } else if(a === "--help" || a === "-h") {
            out.help = true;
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    out.url = out.url.replace(/\/+$/, "");
    return out;
}


                    /***************************
                     *      Credentials
                     ***************************/


function read_creds_file() {
    const f = join(homedir(), ".yuneta", ".qa-creds");
    const out = {};
    if(!existsSync(f)) {
        return out;
    }
    for(const line of readFileSync(f, "utf8").split("\n")) {
        const s = line.trim();
        if(!s || s.startsWith("#")) {
            continue;
        }
        const i = s.indexOf("=");
        if(i > 0) {
            out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
        }
    }
    return out;
}

/*
 *  The list settings, and how many items each must hold to be set.
 */
const LIST_SETTINGS = {
    QA_SCHEMA_TOPICS: 2,
    QA_QUEUE_GATES: 1,
    QA_NODE_CODES: 1,
};

/*
 *  A setting as given: from the environment, else from
 *  ~/.yuneta/.qa-creds; "" when it is in neither.
 */
function qa_setting_raw(name) {
    return process.env[name] || read_creds_file()[name] || "";
}

/*
 *  A list setting ("a,b,c"), its items trimmed, empty ones dropped.
 */
function qa_setting_list(name) {
    return qa_setting_raw(name).split(",").map((x) => x.trim()).filter((x) => x);
}

/*
 *  Is it set? A list is set when it holds as many items that are not
 *  empty as LIST_SETTINGS asks: "," is no list.
 */
function qa_setting_is_set(name) {
    if(name in LIST_SETTINGS) {
        return qa_setting_list(name).length >= LIST_SETTINGS[name];
    }
    return !!qa_setting_raw(name);
}

/*
 *  An id of the installation: as given, else the default given. With
 *  none, a text that matches nothing on the page and names the setting,
 *  so the check that needs it fails saying what to set.
 */
function qa_setting(name, default_value) {
    const v = qa_setting_raw(name) || default_value;
    if(v) {
        return v;
    }
    return `<${name} not set: set it in the environment or in ~/.yuneta/.qa-creds>`;
}

/*
 *  The key names of the user and of the password, and the older names
 *  read after them.
 */
const USER_KEYS = ["QA_USER", "CLAUDIA_USER"];
const PASS_KEYS = ["QA_PASS", "CLAUDIA_PASS"];

function get_credentials() {
    const file = read_creds_file();
    let user = "";
    for(const k of USER_KEYS) {
        user = user || process.env[k] || file[k] || "";
    }
    if(!user) {
        throw new Error(
            "no user: set QA_USER, or QA_USER= in ~/.yuneta/.qa-creds"
        );
    }
    let pass = "";
    for(const k of PASS_KEYS) {
        pass = pass || process.env[k] || "";
    }
    if(!pass) {
        /*  The keyring is the only place the password is allowed to live.  */
        try {
            pass = execFileSync(
                "secret-tool",
                ["lookup", "service", "yunetacontrol", "user", user],
                {encoding: "utf8"}
            ).replace(/\n$/, "");
        } catch(e) {
            throw new Error(
                `no password for ${user}: not in QA_PASS, and the keyring ` +
                `lookup failed (secret-tool lookup service yunetacontrol user ${user})`
            );
        }
    }
    if(!pass) {
        throw new Error(`the keyring holds an empty password for ${user}`);
    }
    return {user, pass};
}


                    /***************************
                     *      Checks
                     ***************************/


/*
 *  --check schemaback: the schema editor's «←» lands where browser Back
 *  lands (gobj-ui 7.26.5).  It used to go UP a level -- columns, topics,
 *  treedbs -- whatever came before, so after two topics Back returned to
 *  the first and the arrow to the treedb.
 *
 *  Only navigation: nothing is written.  The yuno is SELECTED in the
 *  picker to get its tab, and unselected again at the end when it was not
 *  selected before -- a check leaves the app as it found it.
 */
const SCHEMA_NODE = qa_setting("QA_SCHEMA_NODE");
const SCHEMA_YUNO = qa_setting("QA_SCHEMA_YUNO");
const SCHEMA_TREEDB = qa_setting("QA_SCHEMA_TREEDB");
const SCHEMA_TOPICS = qa_setting_list("QA_SCHEMA_TOPICS");

async function check_schemaback(page, args, step, out_dir)
{
    const hash = () => page.evaluate(() => decodeURIComponent(window.location.hash));
    const yuno_box = () => page.locator(".tabulator-row", {hasText: SCHEMA_YUNO})
        .locator("input.STATNODES_SEL").first();

    await page.evaluate(() => { window.location.hash = "#/schemas/nodes"; });
    await page.waitForSelector(".tabulator-row", {timeout: DEFAULTS.TIMEOUT});
    const $node = page.locator(".tabulator-row", {hasText: SCHEMA_NODE}).first();
    await $node.locator(".tabulator-data-tree-control").first().click().catch(() => {});
    await page.waitForTimeout(800);
    if(!await yuno_box().count()) {
        step("check schemaback", false, `no '${SCHEMA_YUNO}' under '${SCHEMA_NODE}' in the picker`);
        return false;
    }
    const was_selected = await yuno_box().isChecked();
    if(!was_selected) {
        await yuno_box().click();
        await page.waitForTimeout(1500);
    }

    let ok = false;
    try {
        /*  The yuno's tab: the nav link whose route is under /schemas/node/.  */
        const tab = await page.evaluate((yuno) => {
            const as = [...document.querySelectorAll("a[href^='#/schemas/node/']")];
            const a = as.find((x) => (x.textContent || "").includes(yuno));
            return a? a.getAttribute("href"): null;
        }, SCHEMA_YUNO);
        if(!tab) {
            step("check schemaback", false, `no tab for '${SCHEMA_YUNO}' after selecting it`);
            return false;
        }
        const base = `${tab.slice(1)}/treedb_system_schema/edit`;
        const at = async (topic) => {
            await page.evaluate((h) => { window.location.hash = h; },
                `#${base}/${SCHEMA_TREEDB}/${topic}`);
            await page.waitForTimeout(2500);
            console.log(`    after ${topic}: ${await hash()}`);
        };
        /*  The first visit mounts the editor; the moves are made on a
         *  mounted one.  */
        await at(SCHEMA_TOPICS[0]);
        await at(SCHEMA_TOPICS[0]);
        await at(SCHEMA_TOPICS[1]);
        await page.waitForSelector(".SCHEMA_BACK", {timeout: DEFAULTS.TIMEOUT});
        await page.screenshot({path: join(out_dir, "schemaback-before.png"), fullPage: true});
        await page.click(".SCHEMA_BACK");
        await page.waitForTimeout(2000);
        const by_arrow = await hash();
        const want = decodeURIComponent(`#${base}/${SCHEMA_TREEDB}/${SCHEMA_TOPICS[0]}`);
        ok = by_arrow === want;
        step("check schemaback: the arrow lands where Back would", ok,
            ok? by_arrow: `${by_arrow}, expected ${want}`);

        /*  And a reload ON that position keeps it: the url is the
         *  position, and F5 or a shared link must land there.  */
        await page.goto(`${args.url}/${want}`, {waitUntil: "load"});
        await page.waitForSelector(".C_YUI_SHELL", {timeout: DEFAULTS.TIMEOUT});
        await page.waitForTimeout(5000);
        const by_reload = await hash();
        const kept = by_reload === want;
        step("check schemaback: a reload keeps the position", kept,
            kept? by_reload: `${by_reload}, expected ${want}`);
        ok = ok && kept;
    } finally {
        if(!was_selected) {
            await page.evaluate(() => { window.location.hash = "#/schemas/nodes"; });
            await page.waitForTimeout(1500);
            const $n = page.locator(".tabulator-row", {hasText: SCHEMA_NODE}).first();
            if(!await yuno_box().count()) {
                await $n.locator(".tabulator-data-tree-control").first().click().catch(() => {});
                await page.waitForTimeout(800);
            }
            if(await yuno_box().count() && await yuno_box().isChecked()) {
                await yuno_box().click();
                await page.waitForTimeout(800);
            }
            const left = await yuno_box().isChecked().catch(() => null);
            step("check schemaback: the picker is left as it was", left === false,
                left === false? "": `still selected (${left})`);
            ok = ok && left === false;
        }
    }
    return ok;
}

/*
 *  --check gobjtree: the gobj tree of a card opens and draws its canvas.
 *  0.29.106 named the tree window `<node>~<key>`; gobj-ui looked the
 *  canvas up with a selector built from that name, so every tree window
 *  logged "no canvas mount" and a `^` (`%5E`) made it fail to open --
 *  deployed twice, because nothing opened a tree on the deployed plane.
 *  It marks a running yuno in the Yunos tab (the SCHEMA_NODE /
 *  SCHEMA_YUNO of --check schemaback: what is marked lives in this run's
 *  own browser context, which ends with it), shows the live view as cards,
 *  opens the tree of the first card, and closes the window.
 */
async function check_gobjtree(page, args, step, out_dir)
{
    const yuno_box = () => page.locator(".tabulator-row", {hasText: SCHEMA_YUNO})
        .locator("input.STATNODES_SEL").first();
    await page.evaluate(() => { window.location.hash = "#/scenarios/yunos"; });
    await page.waitForSelector(".tabulator-row", {timeout: DEFAULTS.TIMEOUT});
    const $node = page.locator(".tabulator-row", {hasText: SCHEMA_NODE}).first();
    await $node.locator(".tabulator-data-tree-control").first().click().catch(() => {});
    await page.waitForTimeout(800);
    if(!await yuno_box().count()) {
        step("check gobjtree", false, `no '${SCHEMA_YUNO}' under '${SCHEMA_NODE}' in the Yunos tab`);
        return false;
    }
    if(!await yuno_box().isChecked()) {
        await yuno_box().click();
        await page.waitForTimeout(1500);
    }
    await page.evaluate(() => { window.location.hash = "#/scenarios/live"; });
    await page.locator("select.MONITOR_MODE").waitFor({timeout: DEFAULTS.TIMEOUT});
    await page.locator("select.MONITOR_MODE").selectOption("cards");
    const $btn = page.locator(".MONITOR_CARD_TREE").first();
    try {
        await $btn.waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check gobjtree", false, "no card with a gobj tree button in the scenario watched");
        return false;
    }
    const before = args.problems.length;
    await $btn.click();

    let ok = true;
    let detail = "";
    try {
        await page.waitForFunction(() => [...document.querySelectorAll(
            '.C_YUI_GOBJ_TREE_JS [id^="gobj-tree-canvas-"]')].some(
            ($c) => $c.querySelector("canvas") && $c.clientWidth > 0 && $c.clientHeight > 0),
            null, {timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        ok = false;
        detail = "no tree window with a drawn canvas";
    }
    /*  Drawn is not enough: with a canvas looked up by a broken selector
     *  G6 still draws (it finds its container by id), and the only sign
     *  was the ERROR "no canvas mount" -- no resize, no observer.  */
    const said = args.problems.slice(before);
    if(ok && said.length) {
        ok = false;
        detail = `the console said ${said.length} thing(s) on open: ${said[0]}`;
    }
    await page.screenshot({path: join(out_dir, "check_gobjtree.png"), fullPage: true});
    step("check gobjtree: the tree window draws its canvas", ok, detail);

    const $close = page.locator(".C_YUI_WINDOW", {has: page.locator(".C_YUI_GOBJ_TREE_JS")})
        .locator(".WINDOW_CLOSE").first();
    if(await $close.count()) {
        await $close.click();
        await page.waitForTimeout(800);
    }
    const left = await page.locator(".C_YUI_GOBJ_TREE_JS").count();
    step("check gobjtree: the window is closed again", left === 0, left? `${left} still open`: "");
    return ok && left === 0;
}

/*
 *  --check chartsheld: the charts of a STOPPED scenario take no rows.
 *  Opens HELD_SCENARIO from the list (a scenario of the control center
 *  whose last run is a stop: the yunos of a load scenario are left up
 *  and idle between runs), waits for the held note, and checks that the
 *  messages chart holds the same number of points over a few periods.
 *  Read only: it runs no action.
 */
const HELD_SCENARIO = qa_setting("QA_HELD_SCENARIO");

async function check_chartsheld(page, args, step, out_dir)
{
    await page.evaluate(() => { window.location.hash = "#/scenarios/list"; });
    const $row = page.locator(".tabulator-row", {hasText: HELD_SCENARIO}).first();
    try {
        await $row.waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check chartsheld", false, `no scenario '${HELD_SCENARIO}' in the list`);
        return false;
    }
    await $row.click();
    await page.evaluate(() => { window.location.hash = "#/scenarios/live"; });
    let ok = true;
    let detail = "";
    try {
        await page.locator(".MONITOR_CHARTS_HELD").waitFor({state: "visible", timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        ok = false;
        detail = "no held note: the scenario is not stopped, or its runs were not read";
        /*  What decided it: the runs, in a screenshot.  */
        await page.locator(".MONITOR_RUNS").click().catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({path: join(out_dir, "check_chartsheld_runs.png"), fullPage: false});
    }
    const points = () => page.evaluate(() => {
        const $c = document.querySelector(".MONITOR_CHART_RATE canvas");
        return $c ? $c.toDataURL().length : -1;
    });
    if(ok) {
        await page.waitForTimeout(3000);
        const a = await points();
        await page.waitForTimeout(6000);
        const b = await points();
        if(a !== b) {
            ok = false;
            detail = "the messages chart was redrawn while held";
        } else {
            detail = await page.locator(".MONITOR_CHARTS_HELD_TEXT").innerText();
        }
    }
    await page.screenshot({path: join(out_dir, "check_chartsheld.png"), fullPage: true});
    step("check chartsheld: a stopped scenario's charts hold", ok, detail);
    return ok;
}

/*
 *  --check controlhelp: every control of the scenario shown says what it
 *  does: a title and an aria-label, equal, with a key, and longer than the
 *  name on the button (0.29.114 repeated the name). Read only.
 */
async function check_controlhelp(page, args, step, out_dir)
{
    await page.evaluate((id) => { window.location.hash = `#/scenarios/live/${id}`; }, HELD_SCENARIO);
    try {
        await page.locator(".MONITOR_TEST_BUTTONS button").first().waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check controlhelp", false, "no control of the scenario on the page");
        return false;
    }
    const bad = await page.evaluate(() => [...document.querySelectorAll(".MONITOR_TEST_BUTTONS button")]
        .map(($b) => ({
            name: $b.innerText.trim(),
            title: $b.getAttribute("title") || "",
            aria: $b.getAttribute("aria-label") || "",
            key: $b.getAttribute("data-i18n-title") || ""
        }))
        .filter((b) => !b.title || b.title !== b.aria || !/ help$/.test(b.key) ||
            b.title.length <= b.name.length + 5)
        .map((b) => `${b.name}: '${b.title}'`));
    const n = await page.locator(".MONITOR_TEST_BUTTONS button").count();
    step(`check controlhelp: ${n} controls say what they do`, bad.length === 0, bad.join("; "));
    return bad.length === 0;
}

/*
 *  --check roles: the Roles view of a users store (ROLES_NODE /
 *  ROLES_YUNO, the control center of artgins): a route of its own
 *  (`<tab>/roles`, kept by a reload), every role with what it grants and
 *  for what, and a role's sheet saying what its service declares. Read
 *  only: nothing is saved.
 */
const ROLES_NODE = qa_setting("QA_ROLES_NODE", "artgins");
const ROLES_YUNO = qa_setting("QA_ROLES_YUNO", "controlcenter");
const ROLES_ROLE = qa_setting("QA_ROLES_ROLE");

async function check_roles(page, args, step, out_dir)
{
    const yuno_box = () => page.locator(".tabulator-row", {hasText: ROLES_YUNO})
        .locator("input.STATNODES_SEL").first();
    await page.evaluate(() => { window.location.hash = "#/users/nodes"; });
    await page.waitForSelector(".tabulator-row", {timeout: DEFAULTS.TIMEOUT});
    const $node = page.locator(".tabulator-row", {hasText: ROLES_NODE}).first();
    await $node.locator(".tabulator-data-tree-control").first().click().catch(() => {});
    await page.waitForTimeout(800);
    if(!await yuno_box().count()) {
        step("check roles", false, `no '${ROLES_YUNO}' under '${ROLES_NODE}' in the picker`);
        return false;
    }
    if(!await yuno_box().isChecked()) {
        await yuno_box().click();
        await page.waitForTimeout(1500);
    }
    const tab = await page.evaluate((yuno) => {
        const as = [...document.querySelectorAll("a[href^='#/users/node/']")];
        const a = as.find((x) => (x.textContent || "").includes(yuno));
        return a? a.getAttribute("href"): null;
    }, ROLES_YUNO);
    if(!tab) {
        step("check roles", false, `no tab for '${ROLES_YUNO}' after selecting it`);
        return false;
    }
    await page.evaluate((h) => { window.location.hash = h; }, `${tab}/roles`);
    const $row = page.locator(".USERS_ROLES_TABLE .tabulator-row", {hasText: ROLES_ROLE}).first();
    try {
        await $row.waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check roles", false, `no role '${ROLES_ROLE}' in the roles view`);
        return false;
    }
    const grants = await $row.locator(".USERS_ROLE_GRANT").allInnerTexts();
    const scoped = grants.length > 0 && grants.every((g) => /scenario_id=/.test(g));
    step(`check roles: '${ROLES_ROLE}' says what it grants and for what`, scoped, grants.join(" | "));

    await $row.click();
    let sheet_ok = false;
    try {
        await page.locator(".USERS_ROLE_SHEET").waitFor({timeout: DEFAULTS.TIMEOUT});
        const declared = await page.locator(".USERS_ROLE_DECLARED").textContent();
        sheet_ok = /scenario_id/.test(declared) &&
            await page.locator(".USERS_ROLE_SHEET input.USERS_ROLE_SCOPE").inputValue() !== "";
    } catch(e) {
        sheet_ok = false;
    }
    await page.screenshot({path: join(out_dir, "check_roles_sheet.png"), fullPage: true});
    step("check roles: its sheet says what the service declares", sheet_ok, "");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForTimeout(4000);
    const kept = await page.locator(".USERS_ROLES_TABLE .tabulator-row", {hasText: ROLES_ROLE}).count();
    await page.screenshot({path: join(out_dir, "check_roles_reload.png"), fullPage: true});
    step("check roles: a reload keeps the roles view", kept > 0,
        await page.evaluate(() => decodeURIComponent(window.location.hash)));
    return scoped && sheet_ok && kept > 0;
}

/*
 *  --check roleswrite: a role written from its sheet reaches the store.
 *  Creates `qa-tmp-<time>` (read-scenarios on a scenario that does not
 *  exist: it lets nobody see anything, and nobody holds it), edits its
 *  description, then deletes it -- the store is left as it was found.
 */
async function open_roles_tab(page)
{
    const yuno_box = () => page.locator(".tabulator-row", {hasText: ROLES_YUNO})
        .locator("input.STATNODES_SEL").first();
    await page.evaluate(() => { window.location.hash = "#/users/nodes"; });
    await page.waitForSelector(".tabulator-row", {timeout: DEFAULTS.TIMEOUT});
    const $node = page.locator(".tabulator-row", {hasText: ROLES_NODE}).first();
    await $node.locator(".tabulator-data-tree-control").first().click().catch(() => {});
    await page.waitForTimeout(800);
    if(!await yuno_box().isChecked()) {
        await yuno_box().click();
        await page.waitForTimeout(1500);
    }
    const tab = await page.evaluate((yuno) => {
        const as = [...document.querySelectorAll("a[href^='#/users/node/']")];
        const a = as.find((x) => (x.textContent || "").includes(yuno));
        return a? a.getAttribute("href"): null;
    }, ROLES_YUNO);
    await page.evaluate((h) => { window.location.hash = h; }, `${tab}/roles`);
    await page.locator(".USERS_ROLES_TABLE .tabulator-row").first().waitFor({timeout: DEFAULTS.TIMEOUT});
}

async function check_roleswrite(page, args, step, out_dir)
{
    const id = `qa-tmp-${Date.now()}`;
    const row = () => page.locator(".USERS_ROLES_TABLE .tabulator-row", {hasText: id});
    await open_roles_tab(page);

    await page.locator(".USERS_NEW").click();
    await page.locator(".USERS_ROLE_SHEET").waitFor({timeout: DEFAULTS.TIMEOUT});
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_ID_INPUT", id);
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_DESCRIPTION", "QA temporary role");
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_SERVICE", "controlcenter");
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_PERMISSION", "read-scenarios");
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_SCOPE", "scenario_id=qa-no-such-scenario");
    await page.locator(".USERS_ROLE_SHEET .USERS_ROLE_SAVE").click();
    let created = false;
    try {
        await row().first().waitFor({timeout: DEFAULTS.TIMEOUT});
        created = /scenario_id=qa-no-such-scenario/.test(await row().first().innerText());
    } catch(e) {
        created = false;
    }
    step("check roleswrite: a new role reaches the store", created, id);
    if(!created) {
        await page.screenshot({path: join(out_dir, "check_roleswrite.png"), fullPage: true});
        return false;
    }

    await row().first().click();
    await page.locator(".USERS_ROLE_SHEET").waitFor({timeout: DEFAULTS.TIMEOUT});
    await page.fill(".USERS_ROLE_SHEET .USERS_ROLE_DESCRIPTION", "QA temporary role, edited");
    await page.locator(".USERS_ROLE_SHEET .USERS_ROLE_SAVE").click();
    let edited = false;
    try {
        await page.locator(".USERS_ROLES_TABLE .tabulator-row", {hasText: "edited"}).first()
            .waitFor({timeout: DEFAULTS.TIMEOUT});
        edited = true;
    } catch(e) {
        edited = false;
    }
    step("check roleswrite: an edited role is saved", edited, "");

    await row().first().click();
    await page.locator(".USERS_ROLE_SHEET").waitFor({timeout: DEFAULTS.TIMEOUT});
    await page.locator(".USERS_ROLE_SHEET .USERS_ROLE_DELETE").click();
    await page.locator(".USERS_CONFIRM_DELETE_ROLE_DIALOG button.is-danger").click()
        .catch(async () => {
            await page.getByRole("button", {name: /delete role|borrar rol/i}).last().click();
        });
    let gone = false;
    for(let i = 0; i < 20 && !gone; i++) {
        await page.waitForTimeout(500);
        gone = (await row().count()) === 0;
    }
    await page.screenshot({path: join(out_dir, "check_roleswrite.png"), fullPage: true});
    step("check roleswrite: the role is deleted again", gone, gone? "" : `${id} is still there: delete it`);
    return created && edited && gone;
}

/*
 *  --check permlive: the controls of a scenario follow the user's
 *  permissions while the page is open (SDK 7.27.16, gui_agent 1.0.0).
 *  Signed in as a user who may run HELD_SCENARIO, the page shows its
 *  controls; QA_PERM_OFF (a shell command, e.g. an unlink-nodes of the
 *  role) takes the permission and the controls must go, with no reload;
 *  QA_PERM_ON gives it back and they must come back. QA_PERM_ON runs at
 *  the end whatever happened, so the user is left as found.
 */
async function check_permlive(page, args, step, out_dir)
{
    const off = qa_setting_raw("QA_PERM_OFF");
    const on = qa_setting_raw("QA_PERM_ON");
    if(!off || !on) {
        step("check permlive", false, "set QA_PERM_OFF and QA_PERM_ON");
        return false;
    }
    const {execSync} = await import("node:child_process");
    const controls = () => page.locator(".MONITOR_TEST_BUTTONS button").count();
    const wait_for = async (want) => {
        for(let i = 0; i < 40; i++) {
            if((await controls() > 0) === want) {
                return true;
            }
            await page.waitForTimeout(250);
        }
        return false;
    };
    await page.evaluate((id) => { window.location.hash = `#/scenarios/live/${id}`; }, HELD_SCENARIO);
    let ok = await wait_for(true);
    step("check permlive: the user may run it, the controls are there", ok, "");
    let gone = false;
    let back = false;
    try {
        if(ok) {
            execSync(off, {stdio: "ignore"});
            gone = await wait_for(false);
            step("check permlive: the permission taken, the controls go (no reload)", gone, "");
        }
    } finally {
        execSync(on, {stdio: "ignore"});
    }
    if(ok) {
        back = await wait_for(true);
        step("check permlive: the permission given back, the controls come back", back, "");
    }
    await page.screenshot({path: join(out_dir, "check_permlive.png"), fullPage: true});
    return ok && gone && back;
}

/*
 *  --check queues: the gates of the held scenario name a queue_service
 *  (__output_side__), so their cards show a queue with a number and the
 *  "messages in queue" chart is there. Read only.
 */
const QUEUE_GATES = qa_setting_list("QA_QUEUE_GATES");

async function check_queues(page, args, step, out_dir)
{
    await page.evaluate((id) => {
        window.location.hash = `#/scenarios/live/${id}`;
    }, HELD_SCENARIO);
    let ok = true;
    let detail = "";
    try {
        await page.locator(".MONITOR_CHART_QUEUE").waitFor({state: "visible", timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        ok = false;
        detail = "no queue chart";
    }
    /*  A reading or two, so every card had its chance  */
    await page.waitForTimeout(6000);
    const cards = await page.evaluate((ids) => {
        const out = {};
        for(const $id of document.querySelectorAll(".MONITOR_NODE .MONITOR_NODE_ID")) {
            const id = $id.textContent.trim();
            if(ids.indexOf(id) < 0) {
                continue;
            }
            const $card = $id.closest(".MONITOR_NODE");
            const $row = $card.querySelector(".MONITOR_NODE_QUEUE");
            out[id] = {
                shown: !!$row && !$row.classList.contains("is-hidden") && $row.offsetParent !== null,
                value: $row ? $row.querySelector(".MONITOR_NODE_QUEUE_VALUE").textContent.trim() : "",
                height: $card.style.height
            };
        }
        return out;
    }, QUEUE_GATES);
    for(const id of QUEUE_GATES) {
        const c = cards[id];
        if(!c || !c.shown || !/\d/.test(c.value)) {
            ok = false;
            detail += ` gate ${id}: ${c ? `shown=${c.shown} value='${c.value}'` : "no card"};`;
        }
    }
    if(ok) {
        detail = QUEUE_GATES.map((id) => `${id}=${cards[id].value} (${cards[id].height})`).join(", ");
    }
    await page.screenshot({path: join(out_dir, "check_queues.png"), fullPage: true});
    step("check queues: the gates' queues on their cards and charted", ok, detail.trim());
    return ok;
}

/*
 *  --check focus: a click on a gate's card highlights it, the cards
 *  linked to it and their links, with the real stylesheet; a second
 *  click clears it. Read only.
 */
async function check_focus(page, args, step, out_dir)
{
    await page.evaluate((id) => {
        window.location.hash = `#/scenarios/live/${id}`;
    }, HELD_SCENARIO);
    const gate = QUEUE_GATES[0];
    const $card = page.locator(".MONITOR_NODE", {has: page.locator(".MONITOR_NODE_ID", {hasText: gate})}).first();
    let ok = true;
    let detail = "";
    try {
        await $card.waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check focus", false, `no card of ${gate}`);
        return false;
    }
    await $card.click();
    const lit = await page.evaluate(() => ({
        focus: document.querySelectorAll(".MONITOR_NODE--focus").length,
        linked: document.querySelectorAll(".MONITOR_NODE--linked").length,
        edges: document.querySelectorAll(".MONITOR_EDGE--linked").length,
        shadow: getComputedStyle(document.querySelector(".MONITOR_NODE--focus") || document.body).boxShadow,
        stroke: (() => {
            const $e = document.querySelector(".MONITOR_EDGE--linked");
            return $e ? getComputedStyle($e).stroke : "";
        })()
    }));
    await page.screenshot({path: join(out_dir, "check_focus.png"), fullPage: true});
    if(lit.focus !== 1 || lit.linked < 1 || lit.edges < 1 || !/\d+px/.test(lit.shadow)) {
        ok = false;
    }
    detail = `focus=${lit.focus} linked=${lit.linked} edges=${lit.edges} shadow='${lit.shadow}' stroke='${lit.stroke}'`;
    await $card.click();
    const left = await page.evaluate(() => document.querySelectorAll(
        ".MONITOR_NODE--focus, .MONITOR_NODE--linked, .MONITOR_EDGE--linked").length);
    if(left !== 0) {
        ok = false;
        detail += `; ${left} still lit after the second click`;
    }
    step("check focus: a clicked card lights up with its links", ok, detail);
    return ok;
}

/*
 *  --check switches: every generator of HELD_SCENARIO has an on/off
 *  switch on its card (role=switch, a name, a title, aria-checked), drawn
 *  inside its card; the cards name their node by its 3 letters (the
 *  first three of its name) with the full name in the title. Read only: the scenario is not
 *  run, so with it stopped every switch is off and disabled, its title
 *  saying why. How many generators (QA_SWITCH_COUNT) and which node
 *  codes (QA_NODE_CODES) are the scenario's, so they come from outside.
 */
const SWITCH_COUNT = parseInt(qa_setting("QA_SWITCH_COUNT"), 10);
const NODE_CODES = qa_setting_list("QA_NODE_CODES");

function escape_regexp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function check_switches(page, args, step, out_dir)
{
    await page.evaluate((id) => {
        window.location.hash = `#/scenarios/live/${id}`;
    }, HELD_SCENARIO);
    try {
        await page.locator(".MONITOR_NODE_SWITCH").first().waitFor({timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check switches", false, "no switch on the page");
        return false;
    }
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
        const out = {switches: [], wheres: []};
        for(const $c of document.querySelectorAll(".MONITOR_NODE")) {
            const id = ($c.querySelector(".MONITOR_NODE_ID") || {}).textContent || "";
            const $w = $c.querySelector(".MONITOR_NODE_WHERE_NAME");
            out.wheres.push({id: id, text: $w ? $w.textContent : "", title: $w ? $w.getAttribute("title") : ""});
            const $s = $c.querySelector(".MONITOR_NODE_SWITCH");
            if(!$s) {
                continue;
            }
            const sb = $s.getBoundingClientRect();
            const cb = $c.getBoundingClientRect();
            out.switches.push({
                id: id,
                role: $s.getAttribute("role"),
                label: $s.getAttribute("aria-label"),
                title: $s.getAttribute("title"),
                checked: $s.getAttribute("aria-checked"),
                disabled: $s.disabled,
                inside: sb.left >= cb.left && sb.right <= cb.right && sb.top >= cb.top && sb.bottom <= cb.bottom
            });
        }
        out.via = (document.querySelector(".MONITOR_URL_WHERE") || {}).textContent || "";
        out.mems = [...document.querySelectorAll(".MONITOR_NODE_MEM_NAME")].map((e) => e.textContent);
        out.series = [...document.querySelectorAll(".MONITOR_CHART_RATE .u-legend .u-series .u-label")]
            .map((e) => e.textContent).filter((t) => t && t !== "Time");
        return out;
    });
    await page.screenshot({path: join(out_dir, "check_switches.png"), fullPage: true});
    const codes = NODE_CODES.map(escape_regexp).join("|");
    const node_re = new RegExp(`^(${codes})$`);
    const series_re = new RegExp(`\\((${codes})\\)$`);
    let bad = [];
    if(r.switches.length !== SWITCH_COUNT) {
        bad.push(`${r.switches.length} switches, ${SWITCH_COUNT} expected`);
    }
    for(const s of r.switches) {
        if(s.role !== "switch" || !s.label || !s.title || (s.checked !== "true" && s.checked !== "false") || !s.inside) {
            bad.push(`${s.id}: ${JSON.stringify(s)}`);
        }
    }
    for(const w of r.wheres) {
        if(!node_re.test(w.text) || !w.title) {
            bad.push(`node of ${w.id}: '${w.text}' (${w.title})`);
        }
    }
    if(!r.via.split(", ").every((n) => node_re.test(n))) {
        bad.push(`status line: '${r.via}'`);
    }
    if(!r.mems.length || !r.mems.every((n) => node_re.test(n))) {
        bad.push(`memory tags: ${JSON.stringify(r.mems)}`);
    }
    if(new Set(r.series).size !== r.series.length || !r.series.every((n) => series_re.test(n))) {
        bad.push(`series: ${JSON.stringify(r.series)}`);
    }
    const first = r.switches[0] || {};
    step("check switches: a switch on every generator, nodes in 3 letters", bad.length === 0,
        bad.length ? bad.join("; ") :
        `${r.switches.length} switches; ${first.id}: checked=${first.checked} disabled=${first.disabled} ` +
        `title='${first.title}' label='${first.label}'; nodes ${[...new Set(r.wheres.map((w) => w.text))].join(",")}; ` +
        `status '${r.via}'; memory ${r.mems.join(",")}; series ${r.series.length} (${r.series.slice(0, 2).join(", ")}...)`);
    return bad.length === 0;
}

/*
 *  --check livelayout: the charts of the live view are BESIDE the graph
 *  when the graph's own width plus 24rem fits in the view, and UNDER it
 *  when it does not; the series of every chart (uPlot's legend) are
 *  folded, and the toggle of the rate chart opens them and folds them
 *  again. Read only. Run it at two widths (--viewport).
 */
async function check_livelayout(page, args, step, out_dir)
{
    await page.evaluate((id) => {
        window.location.hash = `#/scenarios/live/${id}`;
    }, HELD_SCENARIO);
    try {
        await page.locator(".MONITOR_CHART_RATE canvas").first().waitFor({state: "visible", timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check livelayout", false, "no rate chart on the page");
        return false;
    }
    await page.waitForTimeout(3000);
    const geo = await page.evaluate(() => {
        const box = (sel) => {
            const $e = document.querySelector(sel);
            if(!$e) {
                return null;
            }
            const b = $e.getBoundingClientRect();
            return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)};
        };
        const $view = document.querySelector(".MONITOR_VIEW");
        const pad = parseFloat(getComputedStyle($view).paddingLeft) + parseFloat(getComputedStyle($view).paddingRight);
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return {
            room: $view.clientWidth - pad,
            rem: rem,
            graph: box(".MONITOR_GRAPH"),
            canvas: box(".MONITOR_GRAPH_CANVAS"),
            side: box(".MONITOR_SIDE"),
            charts: [...document.querySelectorAll(".MONITOR_CHART:not(.is-hidden)")].map((e) => {
                const b = e.getBoundingClientRect();
                return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)};
            }),
            legends: [...document.querySelectorAll(".MONITOR_CHART .u-legend")].map((e) => getComputedStyle(e).display),
            counts: [...document.querySelectorAll(".MONITOR_SERIES_COUNT")].map((e) => e.textContent)
        };
    });
    const vw = page.viewportSize().width;
    const need = geo.canvas.w + 0.75 * geo.rem + 24 * geo.rem;
    const beside = geo.side.x >= geo.graph.x + geo.graph.w;
    const below = geo.side.y >= geo.graph.y + geo.graph.h;
    const fits = need <= geo.room;
    let ok = fits ? beside : below;
    const folded = geo.legends.every((d) => d === "none");
    ok = ok && folded && geo.legends.length > 0;
    step(`check livelayout: ${vw}px, charts ${beside ? "beside" : (below ? "under" : "OVER")} the graph`, ok,
        `room ${geo.room}px, graph ${geo.canvas.w}px + 24rem = ${Math.round(need)}px (${fits ? "fits" : "does not fit"}), ` +
        `charts column ${geo.side.w}px, charts ${geo.charts.map((c) => `${c.w}x${c.h}`).join(" ")}, ` +
        `series ${geo.counts.join("/")}, legends ${folded ? "folded" : geo.legends.join(",")}`);
    await page.screenshot({path: join(out_dir, `check_livelayout_${vw}.png`), fullPage: true});
    await page.evaluate(() => document.querySelector(".MONITOR_SIDE").scrollIntoView());
    await page.waitForTimeout(300);
    await page.screenshot({path: join(out_dir, `check_livelayout_${vw}_charts.png`), fullPage: true});

    const $toggle = page.locator(".MONITOR_CHART_RATE .MONITOR_SERIES_TOGGLE");
    const read = () => page.evaluate(() => {
        const $c = document.querySelector(".MONITOR_CHART_RATE");
        const $l = $c.querySelector(".u-legend");
        return {
            display: getComputedStyle($l).display,
            height: Math.round($l.getBoundingClientRect().height),
            expanded: $c.querySelector(".MONITOR_SERIES_TOGGLE").getAttribute("aria-expanded"),
            canvas: Math.round($c.querySelector("canvas").getBoundingClientRect().height)
        };
    });
    const before = await read();
    await $toggle.click();
    await page.waitForTimeout(300);
    const open = await read();
    await page.locator(".MONITOR_CHART_RATE").scrollIntoViewIfNeeded();
    await page.screenshot({path: join(out_dir, `check_livelayout_${vw}_series.png`), fullPage: true});
    await $toggle.click();
    await page.waitForTimeout(300);
    const closed = await read();
    const ok2 = open.display !== "none" && open.expanded === "true" && open.height <= 12 * geo.rem + 1 &&
        open.canvas === before.canvas && closed.display === "none" && closed.expanded === "false";
    step("check livelayout: the series of a chart open and fold again", ok2,
        `open: legend ${open.height}px, plot ${open.canvas}px (was ${before.canvas}px); folded again: ${closed.display}`);
    return ok && ok2;
}

/*
 *  --check controlstate: the action buttons of the held scenario fit
 *  its state, as the control center reports it: once the runs are read
 *  no button says "being read", start and stop are never both enabled
 *  nor both disabled, a stopped scenario (its held note) has start on and
 *  stop off, and every disabled button's title says why. READ ONLY: it
 *  clicks no control (the scenario may be running a real test).
 */
async function check_controlstate(page, args, step, out_dir)
{
    await page.evaluate((id) => {
        window.location.hash = `#/scenarios/live/${id}`;
    }, HELD_SCENARIO);
    try {
        await page.locator(".MONITOR_TEST_BUTTONS button").first().waitFor({timeout: DEFAULTS.TIMEOUT});
        await page.waitForFunction(() => {
            const b = [...document.querySelectorAll(".MONITOR_TEST_BUTTONS button")];
            return b.length && b.every((e) => e.getAttribute("data-i18n-title") !== "monitor control refused reading" &&
                e.getAttribute("data-i18n-title") !== "monitor control refused offline");
        }, null, {timeout: DEFAULTS.TIMEOUT});
    } catch(e) {
        step("check controlstate", false, "no control of the scenario, or its state never read");
        await page.screenshot({path: join(out_dir, "check_controlstate.png"), fullPage: false});
        return false;
    }
    const got = await page.evaluate(() => {
        const out = {};
        for(const $b of document.querySelectorAll(".MONITOR_TEST_BUTTONS button")) {
            const m = /MONITOR_TEST_([A-Z]+)/.exec($b.className);
            out[m ? m[1].toLowerCase() : "?"] = {
                disabled: $b.disabled,
                title: $b.getAttribute("title"),
                key: $b.getAttribute("data-i18n-title"),
                aria: $b.getAttribute("data-i18n-aria-label")
            };
        }
        const $held = document.querySelector(".MONITOR_CHARTS_HELD:not(.is-hidden) .MONITOR_CHARTS_HELD_TEXT");
        const $stop_at = document.querySelector(".MONITOR_STOP_AT:not(.is-hidden)");
        return {
            buttons: out,
            held: $held ? $held.getAttribute("data-i18n") : "",
            stop_at: $stop_at ? $stop_at.textContent.trim() : ""
        };
    });
    const b = got.buttons;
    let ok = true;
    const bad = [];
    if(b.start && b.stop && b.start.disabled === b.stop.disabled) {
        bad.push("start and stop alike");
    }
    if(got.held === "monitor charts held stopped" && b.start && (b.start.disabled || !b.stop.disabled)) {
        bad.push("stopped, but start off or stop on");
    }
    for(const [c, v] of Object.entries(b)) {
        if(v.aria !== `monitor ${c} help`) {
            bad.push(`${c}: aria-label ${v.aria}`);
        }
        if(v.disabled && !/^monitor control refused /.test(v.key || "")) {
            bad.push(`${c}: disabled with no reason`);
        }
        if(!v.disabled && v.key !== `monitor ${c} help`) {
            bad.push(`${c}: enabled, title ${v.key}`);
        }
    }
    ok = bad.length === 0;
    const state = got.held ? got.held.replace("monitor charts held ", "") : (got.stop_at ? "running, " + got.stop_at : "running");
    step(`check controlstate: the buttons fit the state (${state})`, ok,
        Object.entries(b).map(([c, v]) => `${c}=${v.disabled ? "off (" + v.title + ")" : "on"}`).join("; ") +
        (bad.length ? ` -- ${bad.join(", ")}` : ""));
    await page.locator(".MONITOR_TEST").screenshot({path: join(out_dir, "check_controlstate_row.png")});
    await page.screenshot({path: join(out_dir, "check_controlstate.png"), fullPage: false});
    return ok;
}

const CHECKS = {
    schemaback: check_schemaback,
    gobjtree: check_gobjtree,
    chartsheld: check_chartsheld,
    controlhelp: check_controlhelp,
    queues: check_queues,
    focus: check_focus,
    switches: check_switches,
    livelayout: check_livelayout,
    controlstate: check_controlstate,
    roles: check_roles,
    roleswrite: check_roleswrite,
    permlive: check_permlive,
};

/*
 *  The settings each check cannot run without (those with a default are
 *  not listed). A check missing one fails before the browser is launched,
 *  with a message that names it -- not with "no row" or "no card" for an
 *  id that was never given.
 */
const CHECK_SETTINGS = {
    schemaback: ["QA_SCHEMA_NODE", "QA_SCHEMA_YUNO", "QA_SCHEMA_TREEDB", "QA_SCHEMA_TOPICS"],
    gobjtree: ["QA_SCHEMA_NODE", "QA_SCHEMA_YUNO"],
    chartsheld: ["QA_HELD_SCENARIO"],
    controlhelp: ["QA_HELD_SCENARIO"],
    queues: ["QA_HELD_SCENARIO", "QA_QUEUE_GATES"],
    focus: ["QA_HELD_SCENARIO", "QA_QUEUE_GATES"],
    switches: ["QA_HELD_SCENARIO", "QA_SWITCH_COUNT", "QA_NODE_CODES"],
    livelayout: ["QA_HELD_SCENARIO"],
    controlstate: ["QA_HELD_SCENARIO"],
    roles: ["QA_ROLES_ROLE"],
    roleswrite: [],
    permlive: ["QA_HELD_SCENARIO", "QA_PERM_OFF", "QA_PERM_ON"],
};

/*
 *  The checks asked for that cannot run: a name that is no check, or a
 *  setting that is not set. Asked before the browser is launched, so a
 *  run that cannot do what it was asked opens nothing and signs nobody
 *  in.
 */
function checks_not_runnable(names) {
    const out = [];
    for(const name of names) {
        if(!CHECKS[name]) {
            out.push(`check ${name} — no such check`);
            continue;
        }
        const unset = (CHECK_SETTINGS[name] || []).filter((n) => !qa_setting_is_set(n));
        if(unset.length) {
            const said = unset.map((n) => (LIST_SETTINGS[n] > 1)? `${n} (${LIST_SETTINGS[n]} items)` : n);
            out.push(`check ${name} — ${said.join(", ")} not set: ` +
                "set it in the environment or in ~/.yuneta/.qa-creds");
        }
    }
    return out;
}


                    /***************************
                     *      Run
                     ***************************/


async function main() {
    const args = parse_args(process.argv.slice(2));
    if(args.help) {
        console.log(readFileSync(new URL(import.meta.url)).toString()
            .split("Usage:")[1].split("*/")[0].replace(/^\s*\*/gm, ""));
        return 0;
    }

    const not_runnable = checks_not_runnable(args.checks);
    if(not_runnable.length) {
        console.log(`\nQA: ${args.url}  (nothing opened)\n`);
        for(const line of not_runnable) {
            console.log(`  FAIL  ${line}`);
        }
        console.log("");
        return 1;
    }

    const pw_path = qa_setting("QA_PW");
    if(!existsSync(pw_path)) {
        throw new Error(
            `playwright not found at ${pw_path}. Set QA_PW to a checkout that has it.`
        );
    }
    /*  playwright is CommonJS, so an ESM import hands it over on `default`
     *  in some node versions and flattened in others. Accept both.  */
    const pw_mod = await import(pw_path + "/index.js");
    const pw = pw_mod.default?.chromium ? pw_mod.default : pw_mod;

    /*  firefox by default because it is the engine this machine has
     *  downloaded, and QA_BROWSER=chromium needs `npx playwright install`
     *  first. Note firefox reports navigator.language as the literal
     *  string "undefined" under Playwright, so anything reading it must
     *  go through a guard — gobj-ui's safe_locale() does.  */
    const want = process.env.QA_BROWSER || "firefox";
    const engine = pw[want];
    if(!engine) {
        throw new Error(`playwright at ${pw_path} exports no ${want}`);
    }

    const host = new URL(args.url).host;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out_dir = join(process.env.QA_OUT || DEFAULTS.OUT, `${host}-${stamp}`);
    mkdirSync(out_dir, {recursive: true});

    const browser = await engine.launch();
    const context = await browser.newContext({viewport: args.viewport});
    if(args.dist) {
        /*  The plane's files from the local build: what a deploy (an
         *  rsync of dist/) would serve. Anything else -- the BFF, the
         *  websockets -- is the plane's.  */
        const origin = new URL(args.url).origin;
        await context.route((u) => u.origin === origin, async (route) => {
            const req = route.request();
            let rel = decodeURIComponent(new URL(req.url()).pathname);
            if(rel === "/") {
                rel = "/index.html";
            }
            const f = join(args.dist, normalize(rel));
            if(req.method() === "GET" && f.startsWith(args.dist + sep) &&
                    existsSync(f) && statSync(f).isFile()) {
                await route.fulfill({path: f});
            } else {
                await route.fallback();
            }
        });
    }
    const page = await context.newPage();

    /*
     *  Everything the page says, kept whole. A QA run that only reports
     *  "it loaded" hides the errors that a user would meet later.
     */
    const console_lines = [];
    const problems = [];
    page.on("console", (m) => {
        const line = `[${m.type()}] ${m.text()}`;
        console_lines.push(line);
        if(m.type() === "error" || m.type() === "warning") {
            problems.push(line);
        }
    });
    page.on("pageerror", (e) => {
        const line = `[pageerror] ${e.message}`;
        console_lines.push(line);
        problems.push(line);
    });
    page.on("requestfailed", (r) => {
        const line = `[requestfailed] ${r.url()} — ${r.failure()?.errorText}`;
        console_lines.push(line);
        problems.push(line);
    });

    const steps = [];
    const step = (name, ok, detail) => {
        steps.push({name, ok, detail: detail || ""});
        console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
    };

    let failed = false;
    try {
        console.log(`\nQA: ${args.url}  (${want}, ${args.viewport.width}x${args.viewport.height}` +
            `${args.dist ? `, files from ${args.dist}` : ""})\n`);

        const resp = await page.goto(args.url, {
            waitUntil: "domcontentloaded", timeout: DEFAULTS.TIMEOUT,
        });
        step("page loads", resp.ok(), `HTTP ${resp.status()}`);
        failed ||= !resp.ok();

        /*  The bundle replaces the static loading card. If it is still
         *  there, the module graph never ran.  */
        await page.waitForSelector(SEL.form, {timeout: DEFAULTS.TIMEOUT});
        step("bundle boots and paints the login form", true);

        const subtitle = await page.locator(".ylogin-subtitle").first().textContent();
        step("plane identified by hostname", !!subtitle, subtitle?.trim());

        if(args.login) {
            const {user, pass} = get_credentials();
            await page.fill(SEL.user, user);
            await page.fill(SEL.password, pass);
            await page.click(SEL.submit);

            /*  Either the shell mounts, or the form shows why it did not.  */
            const shell = page.waitForSelector(SEL.shell, {timeout: DEFAULTS.TIMEOUT})
                .then(() => "shell");
            const denied = page.waitForSelector(`${SEL.error}:not([hidden])`,
                {timeout: DEFAULTS.TIMEOUT}).then(() => "denied");
            const who = await Promise.race([shell, denied]).catch(() => "timeout");

            if(who === "shell") {
                step(`sign in as ${user}`, true);
            } else if(who === "denied") {
                const msg = await page.locator(SEL.error).first().textContent();
                step(`sign in as ${user}`, false, msg?.trim());
                failed = true;
            } else {
                step(`sign in as ${user}`, false, "neither shell nor error appeared");
                failed = true;
            }

            if(who === "shell") {
                /*  A mounted shell is not a connected one.  */
                await page.waitForTimeout(2500);
                const connected = await page.evaluate(() =>
                    !!document.querySelector(".C_YUI_SHELL")?.textContent);
                step("shell renders content", connected);
                failed ||= !connected;

                args.problems = problems;
                for(const name of args.checks) {
                    const ok = await CHECKS[name](page, args, step, out_dir);
                    failed ||= !ok;
                }

                for(const route of args.routes) {
                    await page.goto(`${args.url}/#${route}`, {waitUntil: "load"});
                    await page.waitForTimeout(1500);
                    const has = await page.evaluate(() =>
                        !!document.querySelector(".C_YUI_SHELL"));
                    step(`route ${route}`, has);
                    failed ||= !has;
                    await page.screenshot({
                        path: join(out_dir, `route${route.replace(/\W+/g, "_")}.png`),
                        fullPage: true,
                    });
                }
            }
        }

        await page.screenshot({path: join(out_dir, "final.png"), fullPage: true});

        /*  A message of concern fails the run: a page that loads and
         *  logs an ERROR is not a clean deploy, and printing the count
         *  without failing let one through.  */
        step("console has nothing of concern", problems.length === 0,
            problems.length ? `${problems.length}, the first: ${problems[0]}` : "");
        failed ||= problems.length > 0;
    } catch(e) {
        step("run", false, e.message);
        failed = true;
        await page.screenshot({path: join(out_dir, "failure.png"), fullPage: true})
            .catch(() => {});
    } finally {
        writeFileSync(join(out_dir, "console.log"), console_lines.join("\n") + "\n");
        writeFileSync(join(out_dir, "result.json"),
            JSON.stringify({url: args.url, steps, problems}, null, 4) + "\n");
        await browser.close();
    }

    console.log(`\n  console messages: ${console_lines.length}, of concern: ${problems.length}`);
    for(const p of problems.slice(0, 15)) {
        console.log(`    ${p}`);
    }
    if(problems.length > 15) {
        console.log(`    … ${problems.length - 15} more, see console.log`);
    }
    console.log(`\n  output: ${out_dir}\n`);

    return failed ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => {
    console.error(`\nQA driver error: ${e.message}\n`);
    process.exit(2);
});
