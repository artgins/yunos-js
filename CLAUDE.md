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

## This repo in the yunetas ecosystem

- The JS **yunos** (browser SPAs): `gui_agent`, `gui_treedb`. The most
  active-changing JS layer; it evolves on `main` with its own `CHANGELOG.md`.
- Depends on `@yuneta/gobj-js` / `@yuneta/gobj-ui` (v2) from the **npm
  registry**, like wattyzer — not on the `kernel/js/*` checkouts. So a local
  edit to those libraries does NOT reach these SPAs: publish the library, then
  raise the range in the yuno's `package.json`.
- To ship: commit on `main` here, **tag the release**, then **bump the
  `yunos/js` submodule pointer in yunetas**.
- **Releases are tagged, no `v` prefix** — `0.7.0`, the same convention as
  gobj-js and gobj-ui. Every versioned release the CHANGELOG names has its tag:
  `0.3.0` … `0.7.0`, the four older ones backfilled on 2026-08-17 onto their own
  `release(...)` commit (the one that bumped both `package.json` AND closed the
  heading — verified per tag, not guessed). The one heading without a version,
  `## 2026-07-08 — shipped with SDK 7.7.2`, predates versioning and has no tag.
  **Both yunos carry the SAME version**: one `## <version> — <date>` heading in
  the shared CHANGELOG, and both `package.json` bumped together even when a
  cycle only touched one of them. It held from 0.3.0 to 0.7.0, **drifted**
  between 0.7.0 and 0.14.0 (each yuno bumped its own patch as it changed:
  `gui_agent` reached 0.9.12 and `gui_treedb` 0.13.15, and the entries of that
  cycle keep the number they were written with), and was restored at **0.14.0**
  — a number above both. If you bump one yuno mid-cycle, bump the other with
  it, or the next release has to pick a number above two lines again. Before creating a tag, `git tag -l | grep <version>`:
  two tags of one version pointing at different commits is a serious error.
- gui_agent deploys are a build + rsync via its `deploy-com.sh` — a commit
  alone does not update the live site.
