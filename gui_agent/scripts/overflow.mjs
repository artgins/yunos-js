#!/usr/bin/env node
/***********************************************************************
 *          scripts/overflow.mjs
 *
 *      Hunts ONE defect, in any of these SPAs: a box whose content is
 *      wider than the box, on a phone viewport.
 *
 *      It exists because that defect shipped. A stat value can be a PATH,
 *      and a path is one unbreakable word: it set the counters table's
 *      minimum width, the table grew past its 20rem card, the card's
 *      `overflow:auto` clipped what stuck out -- and since a value cell
 *      is `has-text-right`, every short NUMBER sat at the far right of
 *      that column, in the clipped part. On a phone that read as "the
 *      counters have no values", and the rows looked complete.
 *
 *      ⚠️  IT RUNS CHROMIUM BY DEFAULT, and that is the point.
 *      Firefox breaks a long slash-separated path at its slashes, so the
 *      same card measured 291/291 with 0 clipped cells there -- twice,
 *      at two widths -- while Chromium gave 499/291 with 8 of 8 clipped.
 *      A layout bug reproduced in one engine is not one you can rule out
 *      from the other. `PROBE_BROWSER=firefox` to compare.
 *
 *      What it reports per offender: how much it overflows, whether the
 *      box can SCROLL (an affordance) or only CLIPS (a defect), and how
 *      many children end up outside its right edge -- which is what
 *      turns an overflow into "the data is not there". Tabulator's own
 *      horizontal scroll shows up as `scrollable` and is by design.
 *
 *      Credentials as everywhere else: CLAUDIA_USER from
 *      ~/.yuneta/.qa-creds or the environment, the password from the OS
 *      keyring (or CLAUDIA_PASS).
 *
 *      Usage:
 *
 *          node scripts/overflow.mjs <url> [route,route,...]
 *          node scripts/overflow.mjs https://artgins.yunetacontrol.com
 *          node scripts/overflow.mjs https://artgins.ytreedb.com /topics/select
 *          PROBE_BROWSER=firefox node scripts/overflow.mjs <url>
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {readFileSync, existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

const req = createRequire(join(process.cwd(), "package.json"));
const pw = await import(pathToFileURL(req.resolve("playwright")).href);
const api = pw.chromium ? pw : (pw.default || {});
const engine = (process.env.PROBE_BROWSER === "firefox") ? api.firefox : api.chromium;

const CREDS = join(homedir(), ".yuneta", ".qa-creds");
let user = process.env.CLAUDIA_USER || "";
if(!user && existsSync(CREDS)) {
    const m = /CLAUDIA_USER=(.*)/.exec(readFileSync(CREDS, "utf8"));
    user = m ? m[1].trim().replace(/^"|"$/g, "") : "";
}
const pass = execFileSync("secret-tool",
    ["lookup", "service", "yunetacontrol", "user", user], {encoding: "utf8"}).replace(/\n$/, "");

const URL = process.argv[2];
const routes = (process.argv[3] || "").split(",").filter(Boolean);

const browser = await engine.launch({headless: true});
const ctx = await browser.newContext({viewport: {width: 412, height: 915},
                                      isMobile: true, hasTouch: true, locale: "es-ES"});
const page = await ctx.newPage();
await page.goto(URL, {waitUntil: "domcontentloaded"});
await page.waitForTimeout(5000);
await page.fill("input[name=username]", user);
await page.fill("input[name=password]", pass);
await page.click(".ylogin-cta");
await page.waitForTimeout(11000);

const scan = async (label) => {
    const found = await page.evaluate(() => {
        const out = [];
        for(const el of document.querySelectorAll("*")) {
            const over = el.scrollWidth - el.clientWidth;
            if(over <= 2 || el.clientWidth === 0) { continue; }
            const cs = getComputedStyle(el);
            /*  A box that cannot scroll is a box that CLIPS.  */
            const scrollable = /auto|scroll/.test(cs.overflowX);
            const b = el.getBoundingClientRect();
            let outside = 0, sample = "";
            for(const kid of el.querySelectorAll("td, .STATS_VALUE, span, div")) {
                const r = kid.getBoundingClientRect();
                if(r.width > 0 && r.right > b.right + 1) {
                    outside++;
                    if(!sample) { sample = (kid.textContent || "").trim().slice(0, 24); }
                }
            }
            out.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.className && el.className.toString ? el.className.toString() : "").slice(0, 60),
                over: over, w: el.clientWidth, scrollable: scrollable,
                children_outside: outside, sample: sample
            });
        }
        return out.sort((a, b) => b.over - a.over).slice(0, 8);
    });
    console.log(`--- ${label} ---`);
    if(!found.length) { console.log("   nothing overflows"); return; }
    for(const f of found) {
        console.log(`   ${f.tag}.${f.cls || "(no class)"}  over=${f.over}px w=${f.w} ` +
                    `${f.scrollable ? "scrollable" : "CLIPS"} outside=${f.children_outside}` +
                    (f.sample ? `  e.g. "${f.sample}"` : ""));
    }
};

await scan("landing " + (await page.evaluate(() => window.location.hash)));
for(const r of routes) {
    await page.evaluate((x) => { window.location.hash = x; }, r);
    await page.waitForTimeout(8000);
    await scan(r);
}
await page.screenshot({path: `/tmp/yv-qa-out/overflow-${process.argv[4] || "app"}.png`, fullPage: true});
await browser.close();
