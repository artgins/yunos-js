#!/usr/bin/env node
/***********************************************************************
 *          check-markup-strings.mjs
 *
 *      createElement2() reads a plain string that starts with '<' as
 *      html (gobj-js), so whether a string RUNS depends on its content,
 *      not on who wrote it. The way out is to say markup out loud --
 *      html_markup('<i class="yi-copy"></i>') -- and, once every
 *      deliberate markup does, to turn on set_strings_are_text(true),
 *      where a plain string is always text.
 *
 *      This check finds, in the CONTENT of a createElement2()
 *      description (`[tag, attrs, content]`) and in its list of
 *      children:
 *
 *        literal    a string literal that starts with '<': deliberate
 *                   markup, to be wrapped in html_markup().
 *        built      a template with ${...} or a '+' concatenation that
 *                   starts with '<': markup BUILT WITH VALUES. If a value
 *                   is data, that is the hole; build the element with
 *                   createElement2() and pass the value as text.
 *        in-list    a string that starts with '<' inside a LIST of
 *                   children: since gobj-js 7.26.2 a string there is
 *                   text, so it renders as the literal tags.
 *
 *      What it cannot see is a VARIABLE holding a string (its type is
 *      not known before running). set_strings_are_text(true) logs those
 *      once at run time: that is the other half of the check.
 *
 *      Usage (from the package root):
 *          node scripts/check-markup-strings.mjs [dir|file ...]   # default: src
 *      Exit 1 when anything is found.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {parse} from "acorn";

const TAG_RE = /^[a-z][a-z0-9-]*$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "build", "_build"]);

function list_files(path, out)
{
    let st = statSync(path);
    if(st.isDirectory()) {
        for(const name of readdirSync(path)) {
            if(SKIP_DIRS.has(name)) {
                continue;
            }
            list_files(join(path, name), out);
        }
    } else if(/\.(js|mjs)$/.test(path) && !/\.test\.(js|mjs)$/.test(path)) {
        out.push(path);
    }
    return out;
}

function is_string_literal(n)
{
    return n && n.type === "Literal" && typeof n.value === "string";
}

function static_string(n)
{
    if(is_string_literal(n)) {
        return n.value;
    }
    if(n && n.type === "TemplateLiteral" && n.expressions.length === 0) {
        return n.quasis[0].value.cooked;
    }
    return null;
}

function starts_with_markup(s)
{
    return typeof s === "string" && s.trim().startsWith("<");
}

/*  The leftmost string of a '+' chain, or the head of a template.  */
function built_markup(n)
{
    if(!n) {
        return false;
    }
    if(n.type === "TemplateLiteral" && n.expressions.length > 0) {
        return starts_with_markup(n.quasis[0].value.cooked);
    }
    if(n.type === "BinaryExpression" && n.operator === "+") {
        let left = n;
        while(left.type === "BinaryExpression" && left.operator === "+") {
            left = left.left;
        }
        let s = static_string(left);
        if(s !== null) {
            return starts_with_markup(s);
        }
        return left.type === "TemplateLiteral" && starts_with_markup(left.quasis[0].value.cooked);
    }
    return false;
}

/*  [tag, attrs, content, events?]: a string tag and an attrs slot.  */
function is_description(n)
{
    if(!n || n.type !== "ArrayExpression" || n.elements.length < 3 || n.elements.length > 4) {
        return false;
    }
    let tag = n.elements[0];
    if(!is_string_literal(tag) || !TAG_RE.test(tag.value)) {
        return false;
    }
    let attrs = n.elements[1];
    return !!attrs && (attrs.type === "ObjectExpression" || attrs.type === "Identifier" ||
        attrs.type === "MemberExpression" || attrs.type === "CallExpression" ||
        (attrs.type === "Literal" && attrs.value === null));
}

function walk(node, visit)
{
    if(!node || typeof node.type !== "string") {
        return;
    }
    visit(node);
    for(const key of Object.keys(node)) {
        if(key === "loc" || key === "start" || key === "end") {
            continue;
        }
        let v = node[key];
        if(Array.isArray(v)) {
            for(const c of v) {
                if(c && typeof c.type === "string") {
                    walk(c, visit);
                }
            }
        } else if(v && typeof v.type === "string") {
            walk(v, visit);
        }
    }
}

function check_content(n, findings, file, src, where)
{
    if(!n) {
        return;
    }
    let s = static_string(n);
    if(s !== null && starts_with_markup(s)) {
        findings.push({file, line: n.loc.start.line, rule: where === "list" ? "in-list" : "literal",
            text: src.slice(n.start, Math.min(n.end, n.start + 90))});
        return;
    }
    if(built_markup(n)) {
        findings.push({file, line: n.loc.start.line, rule: "built",
            text: src.slice(n.start, Math.min(n.end, n.start + 90))});
    }
}

function check_file(file, root)
{
    const src = readFileSync(file, "utf8");
    let ast;
    try {
        ast = parse(src, {ecmaVersion: "latest", sourceType: "module", locations: true,
            allowHashBang: true, allowAwaitOutsideFunction: true});
    } catch(e) {
        console.error(`${relative(root, file)}: cannot parse: ${e.message}`);
        return [{file, line: 0, rule: "parse", text: e.message}];
    }
    const findings = [];
    const rel = relative(root, file);
    walk(ast, (n) => {
        if(!is_description(n)) {
            return;
        }
        let content = n.elements[2];
        if(content && content.type === "ArrayExpression" &&
                content.elements.length > 0 && !is_string_literal(content.elements[0])) {
            for(const child of content.elements) {
                check_content(child, findings, rel, src, "list");
            }
        } else {
            check_content(content, findings, rel, src, "slot");
        }
    });
    return findings;
}

const root = process.cwd();
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
let files = [];
for(const t of targets) {
    list_files(join(root, t), files);
}

let all = [];
for(const f of files) {
    all = all.concat(check_file(f, root));
}

const by_rule = {};
for(const f of all) {
    by_rule[f.rule] = (by_rule[f.rule] || 0) + 1;
    console.log(`${f.file}:${f.line}: ${f.rule}: ${f.text.replace(/\s+/g, " ")}`);
}
if(all.length) {
    console.log(`\ncheck-markup-strings: ${all.length} found ` +
        `(${Object.entries(by_rule).map(([k, v]) => `${k} ${v}`).join(", ")}) in ${files.length} files`);
    process.exit(1);
}
console.log(`check-markup-strings: OK (${files.length} files)`);
