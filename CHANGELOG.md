# Changelog

`yunos-js` — Yuneta's JavaScript **yunos** (browser SPAs) built on the
GObject-JS runtime (`@yuneta/gobj-js`) and the UI library (`@yuneta/gobj-ui`).
Extracted from `yunetas/yunos/js` into its own repository and consumed back as a
git **submodule** at `yunos/js` (the same model as `gobj-js` and `gobj-ui`), so
the JS yunos — the most active-changing layer — evolve on their own line.

Contents:

- **gui_agent** — Agent Console: a control-plane CLI/GUI to operate yuneta
  agents through the controlcenter (multi-agent console, nodes list, stats).
- **gui_treedb** — TreeDB GUI: table + graph views over timeranger2/treedb,
  with the Keycloak/OAuth2-PKCE + BFF login.
- Keycloak login-form / BFF notes and `FUTURE-JS.md`.

Each yuno consumes `@yuneta/gobj-js` / `@yuneta/gobj-ui` via local `file:`
dependencies (`../../../kernel/js/…`) that resolve within the yunetas
superproject, where this repo is mounted at `yunos/js`. (A standalone clone of
this repo, outside yunetas, will not resolve those `file:` deps — by design.)

## Unreleased

- **chore: initial snapshot.** Extracted from `yunetas/yunos/js` at yunetas
  **7.6.8**. History was not carried over (it remains in the yunetas repo); the
  layout, `package.json` files and `file:` dependencies are unchanged, so the
  yunetas superproject keeps building the JS yunos exactly as before with this
  directory now a submodule.

### gui_agent (7.6.8 cycle)

- Multi-agent Console: one top-sub tab per selected node; F5 restores the exact
  open node from the route subpath.
- Command helper: per-node `help` cache → Tab completion (name + parameters),
  live signature/description hint, and a "?" popover of available commands.
- Up/Down recall shell-style **command history**, global to all nodes
  (persisted in the browser); a history popover lists recent commands. No
  polling.
- Answers sent via the shared `agent_link` service (inter-yuno contract) so the
  agent's real asynchronous answer routes back; table answers on Tabulator, a
  `display_mode` toggle (table vs raw JSON), error-only comment line.
- Mobile & theme: clear (✕) as its own button, icon-only Execute, full-width
  popovers, a terminal (`>_`) icon for the Console nav + Execute, dark-mode
  panes. Silent session recovery after a sleep/reconnect NAK.

_(Full per-yuno detail lives in `gui_agent/README.md`.)_

### gui_treedb

- TreeDB table + graph GUI over timeranger2/treedb, on the legacy GClass GUI
  stack; OAuth2-PKCE + BFF login (`README-KEYCLOAK*.md`). See
  `gui_treedb/README`.
