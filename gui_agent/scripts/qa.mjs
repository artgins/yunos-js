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
 *      from `~/.yuneta/.qa-creds` (`CLAUDIA_USER=`) or the environment;
 *      the password comes from the OS keyring (libsecret / `secret-tool`)
 *      or from `CLAUDIA_PASS` for CI. Nothing in clear text on disk.
 *
 *      Playwright is not a dependency of this yuno. It is borrowed from
 *      wattyzer's gui, which already carries it, so a QA run adds nothing
 *      to what this SPA ships. Point QA_PW elsewhere to override.
 *
 *      Usage:
 *
 *          node scripts/qa.mjs                         # the .com plane
 *          node scripts/qa.mjs --url https://artgins.yunetacontrol.ovh
 *          node scripts/qa.mjs --no-login              # login screen only
 *          node scripts/qa.mjs --check schemaback      # the schema editor's ← = browser Back
 *          node scripts/qa.mjs --check gobjtree        # a card's gobj tree opens and draws its canvas
 *          node scripts/qa.mjs --check chartsheld      # a stopped scenario's charts hold (renfe-20k-hidraulia)
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
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const DEFAULTS = {
    URL:     "https://artgins.yunetacontrol.com",
    TIMEOUT: 30000,
    OUT:     "/tmp/agent-qa-out",
    PW:      "/yuneta/development/projects/wattyzer/gui/node_modules/playwright",
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
    const out = {url: process.env.QA_URL || DEFAULTS.URL, routes: [], login: true, checks: []};
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === "--url") {
            out.url = argv[++i];
        } else if(a === "--route") {
            out.routes.push(argv[++i]);
        } else if(a === "--check") {
            out.checks.push(argv[++i]);
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

function get_credentials() {
    const file = read_creds_file();
    const user = process.env.CLAUDIA_USER || file.CLAUDIA_USER;
    if(!user) {
        throw new Error(
            "no user: set CLAUDIA_USER, or CLAUDIA_USER= in ~/.yuneta/.qa-creds"
        );
    }
    let pass = process.env.CLAUDIA_PASS;
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
                `no password for ${user}: not in CLAUDIA_PASS, and the keyring ` +
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
const SCHEMA_NODE = process.env.QA_SCHEMA_NODE || "yunovatios-central";
const SCHEMA_YUNO = process.env.QA_SCHEMA_YUNO || "db_history_ce";
const SCHEMA_TREEDB = process.env.QA_SCHEMA_TREEDB || "treedb_yunovatioscedb";
const SCHEMA_TOPICS = ["devices", "places"];

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
 *  whose last run is a stop: the yunos of renfe-20k-hidraulia are left up
 *  and idle between runs), waits for the held note, and checks that the
 *  messages chart holds the same number of points over a few periods.
 *  Read only: it runs no action.
 */
const HELD_SCENARIO = process.env.QA_HELD_SCENARIO || "renfe-20k-hidraulia";

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

const CHECKS = {
    schemaback: check_schemaback,
    gobjtree: check_gobjtree,
    chartsheld: check_chartsheld,
};


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

    const pw_path = process.env.QA_PW || DEFAULTS.PW;
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
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
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
        console.log(`\nQA: ${args.url}  (${want})\n`);

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
                    const fn = CHECKS[name];
                    if(!fn) {
                        step(`check ${name}`, false, "no such check");
                        failed = true;
                        continue;
                    }
                    const ok = await fn(page, args, step, out_dir);
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
         *  without failing let one through (REV-CLOUD V41.1).  */
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
