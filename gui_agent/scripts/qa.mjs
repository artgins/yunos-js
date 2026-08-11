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
 *          node scripts/qa.mjs --route /nodes --route /console
 *          node scripts/qa.mjs --no-login              # login screen only
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
    const out = {url: process.env.QA_URL || DEFAULTS.URL, routes: [], login: true};
    for(let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if(a === "--url") {
            out.url = argv[++i];
        } else if(a === "--route") {
            out.routes.push(argv[++i]);
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
