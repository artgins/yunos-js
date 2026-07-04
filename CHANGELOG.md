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

- **Four-workspace refactor.** The primary rail is now **Commands ·
  Statistics · Terminal · Settings**, and the three per-node workspaces share
  one pattern: a fixed node-picker tab (`C_NODES`) plus one closable, dynamic
  tab per selected node (red when the node drops). Node selection is kept
  **per workspace** in `C_AGENT_CONFIG` (a legacy flat `selected_nodes` list is
  migrated under `commands`). The `C_APP` tabs controller is generalized over a
  `WORKSPACES` table (routes `/​<ws>/nodes` and `/​<ws>/node/<id>`, F5 restore
  per workspace).
  - **Commands** and **Statistics** list only agents **≥ 7.7.0** (the
    controlcenter command/stats capability marker); `C_NODES` filters the
    `list-agents` result by version. `C_AGENT_STATS` is now pinned to one node
    (its internal node selector removed) and disambiguates answers by
    `console_purpose="stats"` + `console_node`, so several stats tabs and the
    Console coexist on the one link.
  - **Terminal** (new, `C_AGENT_TTY`): an interactive **xterm.js** console to a
    node over the shared `agent_link` — `open-console`/`close-console` AND
    keystrokes all via `command-agent` (`cmd2agent="write-tty"`), which matches
    the node by UUID *or* hostname; `EV_TTY_DATA` (re-published by
    `C_AGENT_LINK`) for output. The control center's direct `write-tty` matches
    only the UUID and drops the socket on a miss, so it is avoided. Each tab owns a globally-unique console name and
    filters `EV_TTY_*` by it. Served by both `yuno_agent` and `yuno_agent22`, so
    every agent version is listed (no version gate). PTY geometry is fixed at
    open (no runtime resize on the agent side); **Reconnect** opens a fresh
    console at the current size. A failed `open-console` (e.g. the user lacks
    the privileged `open-console` authz) is shown in the terminal instead of
    hanging on "Connecting…", and a shell `exit` closes the tab (deselects the
    node). (Terminal access is role-gated: it needs an admin role; a plain
    "User" role gets "No permission".)
  - **Settings** promoted to a primary item (Preferences + About); the avatar
    menu trimmed to Settings / Developer / Sign out.
- Multi-agent Console: one top-sub tab per selected node; F5 restores the exact
  open node from the route subpath.
- Command helper: per-node `help` cache → Tab completion (name + parameters),
  live signature/description hint, and a "?" popover of available commands.
- Up/Down recall shell-style **command history**, global to all nodes
  (persisted in the browser); a history popover lists recent commands. No
  polling.
- **Command shortkeys** (ycli parity): the first token of a console command is
  looked up in a persistent `{key: template}` dict; a match expands to the
  template with `$1 $2 …` replaced by the following positional args (quote-
  aware). Seeded with ycli's default set (`s`, `ss`, `r`, `tt`, `error`);
  global to all nodes. History recalls what was typed (the shortkey).
  Managed from **Preferences** (a list with per-row remove + an add form) and,
  for power users, the local `shortkeys` / `add-shortkey` / `remove-shortkey`
  commands typed in the console (handled client-side, never sent to the agent).
  Kept off the console input row so the command input stays full-width on
  mobile.
- Answers sent via the shared `agent_link` service (inter-yuno contract) so the
  agent's real asynchronous answer routes back; table answers on Tabulator, a
  `display_mode` toggle (table vs raw JSON), error-only comment line. A copy
  button on the status line copies the raw-text response (`CONSOLE_RESPONSE_TEXT`)
  to the clipboard — disabled for table/empty answers, flashes a check on success.
- Mobile & theme: clear (✕) as its own button, icon-only Execute, full-width
  popovers, a terminal (`>_`) icon for the Console nav + Execute, dark-mode
  panes. Silent session recovery after a sleep/reconnect NAK.

_(Full per-yuno detail lives in `gui_agent/README.md`.)_

### gui_treedb

- TreeDB table + graph GUI over timeranger2/treedb, on the legacy GClass GUI
  stack; OAuth2-PKCE + BFF login (`README-KEYCLOAK*.md`). See
  `gui_treedb/README`.
