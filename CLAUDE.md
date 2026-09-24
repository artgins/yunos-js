# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo.

## ⚠️ First step: read the yunetas CLAUDE.md

**Before doing anything in this repo, read the yunetas SDK's `CLAUDE.md`.**
This repo is normally checked out as the `yunos/js` git submodule of yunetas,
so it lives at `/yuneta/development/yunetas/CLAUDE.md` (standalone clone:
`github.com/artgins/yunetas`, `CLAUDE.md` at the root). It carries the
framework-wide rules that also govern this codebase: always-braces, no silent
errors, gobj-js gotchas, JS GUI conventions (logical DOM class names, no
transitions, icon-only mobile buttons, Bulma `!important`, `yui_icons`), and
the submodule flow. This file only adds the yunos-js-specific layer on top.

## A control without a name is a bug: `title` + `aria-label`, always

Every `input`, `select`, `textarea`, `button` — or anything that behaves as
one — carries BOTH attributes, each through `t()` and each with its key
(`data-i18n-title`, `data-i18n-aria-label`), written where the control is
built. A floor, not a preference.

What does NOT name a control: a `<label>` **beside** it (Bulma's `field`
shape), a `<label for=x>` over a control carrying only `name=x`, a
`placeholder`, and the visible text when it hides on mobile or says the STATE.
A `<label>` that **wraps** its control does. A LITERAL `aria-label` next to a
visible `i18n` label OVERRIDES it for a reader — worse than none.

⚠️ Both these yunos mount gobj-ui's **Developer window**, whose 46 keys arrive
as VARIABLES and are therefore invisible to `validate-locales`: the list to
copy sits above `TRACE_DEFS` in `yui_dev.js`.

The check is not a grep: **dump `title`/`aria-label` from the DEPLOYED DOM and
switch language**. Full rule in yunetas' `CLAUDE.md` and in gobj-ui's README
("Conventions").

## This repo in the yunetas ecosystem

- The JS **yunos** (browser SPAs): `gui_agent`, `gui_treedb`. The most
  active-changing JS layer; it evolves on `main` with its own `CHANGELOG.md`.
- Depends on `@yuneta/gobj-js` / `@yuneta/gobj-ui` (v2) from the **npm
  registry**, like wattyzer — not on the `kernel/js/*` checkouts. So a local
  edit to those libraries does NOT reach these SPAs: publish the library, then
  raise the range in the yuno's `package.json`.
- To ship: commit on `main` here, **tag the release**, then **bump the
  `yunos/js` submodule pointer in yunetas**.
- **The two yunos are on SEPARATE version lines** (since 0.17.x /
  0.22.x): `gui_agent` and `gui_treedb` each bump their own `package.json`
  when they change, and only then. A CHANGELOG heading names the yuno(s) and
  version(s) it ships, and the libraries it moves to:
  `## gui_agent 0.22.90, gui_treedb 0.17.63 + gobj-ui ^7.25.16 (2026-09-24)`.
  A release that touches only one yuno names only that one.
- **Releases are tagged, one tag per yuno version, `<yuno>-<version>`**, no
  `v` prefix: `gui_agent-0.22.90`, `gui_treedb-0.17.63`, on the commit that
  bumps that `package.json` and writes its heading. A bare number cannot name
  two lines. The numeric tags are history: `0.3.0` … `0.7.0` (backfilled on
  2026-08-17) and `0.14.0` … `0.17.1` are releases of the SHARED line, where
  both yunos carried one number; `0.17.37` … `0.17.41` were tagged with
  gui_treedb's number after the lines split (gui_agent was then 0.22.64 …
  0.22.68). The releases after `0.17.41` and before `gui_agent-0.22.90` /
  `gui_treedb-0.17.63` were not tagged and are not backfilled: their commits
  are named by their CHANGELOG headings and by the `yunos/js` pointer of each
  yunetas commit that bumped it. Before creating a tag,
  `git tag -l | grep <version>`: two tags of one version pointing at different
  commits is a serious error.
- gui_agent deploys are a build + rsync via its `deploy-com.sh` — a commit
  alone does not update the live site.
