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
- Depends on `@yuneta/gobj-js` / `@yuneta/gobj-ui` (v2) by `file:`
  (`../../../kernel/js/…`) — it must be checked out at its submodule path for
  those deps to resolve.
- To ship: commit on `main` here, then **bump the `yunos/js` submodule pointer
  in yunetas**.
- gui_agent deploys are a build + rsync via its `deploy-com.sh` — a commit
  alone does not update the live site.
