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
  gobj-js and gobj-ui (started at `0.7.0` on 2026-08-17; the earlier releases
  the CHANGELOG names are untagged). **Both yunos carry the SAME version**, as
  they have since 0.3.0: one `## <version> — <date>` heading in the shared
  CHANGELOG, and both `package.json` bumped together even when a cycle only
  touched one of them. Before creating a tag, `git tag -l | grep <version>`:
  two tags of one version pointing at different commits is a serious error.
- gui_agent deploys are a build + rsync via its `deploy-com.sh` — a commit
  alone does not update the live site.
