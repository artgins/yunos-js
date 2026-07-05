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
- **Remember the active tab per workspace.** The node tab you are on is now
  persisted per workspace (`C_AGENT_CONFIG.active_tabs`), so switching away and
  back — or a fresh load / login — restores that tab instead of dropping you on
  the nodes picker. Each workspace's rail item now lands on its node home
  (`submenu.default = /<ws>/node`) and `workspace_first_route` prefers the
  saved tab (falling back to the first open node, then the picker). The picker
  stays one click away as tab 0.
- **Nodes table sorted by version by default.** The node picker now opens
  sorted by agent version descending (highest on top), with a numeric dotted
  sorter so `7.10.0` ranks above `7.9.0` (not a plain string sort).
- **Per-node connection status on the tabs.** The single global toolbar
  connection dot made no sense once the console went multi-node, so it is
  removed (`app_config` no longer declares a `connection` item). Instead each
  node tab carries a small status **circle** (the same look as the old global
  dot, one per tab) — green when the node is in the live `list-agents` set, red
  when it dropped — across all three per-node workspaces. The console panel
  keeps its own per-panel status line.
- **Terminal — font size + mobile-legible toolbar.** The default xterm font
  size (19 px, clamped 8–28) is a browser-persisted preference set in
  **Settings → Preferences** ("Terminal font size", a −/+ stepper); every
  Terminal tab seeds from it when it (re)opens. The toolbar A− / A+ buttons
  (`yi-magnifying-glass-minus`/`-plus`) nudge ONLY that tab's live size — a
  temporary, per-terminal change that is not persisted, so reopening the tab
  returns to the default. Reconnect now carries an icon (`yi-arrows-rotate`)
  with its label hidden on mobile so the toolbar stays legible when narrow —
  the new house rule: row buttons carry an icon and go icon-only on mobile.
  Selecting a Terminal tab now moves keyboard focus straight to the xterm (a
  `MutationObserver` on the view's `is-hidden` flip), so you can type without
  clicking first.
- **Fixes (review pass).**
  - **Commands — focus the input on tab select.** Selecting a Commands tab now
    moves keyboard focus straight to `CONSOLE_INPUT` (a `MutationObserver` on
    the view's `is-hidden` flip), so you can type without clicking first — same
    mechanism as the Terminal xterm focus.
  - **Commands — visible "running…" feedback.** Sending a command now paints
    a `running…` placeholder in the response pane until the answer arrives,
    instead of blanking it with no indication (the old `…` was written to the
    error-only comment line and immediately hidden). Cleared when the answer
    renders, and on a link drop / NAK so it can't hang after a disconnect; a
    valid last answer is left in place across an idle disconnect.
  - **Commands — no rapid-command race.** Each console command now carries a
    per-panel monotonic `console_seq` in `__md_iev__`; on answer, a reply whose
    seq is not the latest is dropped, so typing a slow command then a fast one
    no longer lets the slow one's late answer overwrite the fast one's result.
    A local command (`shortkeys`, …) bumps the seq too, so an in-flight remote
    answer can't clobber its output.
  - **Tab liveness on link drop.** `C_APP` now subscribes to the shared
    link's `EV_ON_CLOSE`: when the control-center socket drops (a plain close,
    not an identity NAK), the live-node set is blanked and the workspace tabs
    repaint red (disconnected) instead of showing a stale "connected" state
    until the link returns. `ac_on_open` re-seeds the set on reconnect, so
    tabs recover automatically (matches what `C_NODES` already showed).
  - **Terminal — no more orphaned PTYs.** Reconnect now closes the previous
    console before opening a fresh one, so a node no longer accumulates a live
    `bash` per reconnect. The best-effort `close-console` is tagged
    `console_purpose="tty_close"` so its (possibly failing) ack never disturbs
    the newly-opened tab.
  - **Terminal — no cross-tab false failures.** `write-tty` now carries
    `console_node`, so a failed keystroke on one node's tab no longer clears
    every open Terminal tab and flashes "Failed".
  - **Commands — a background `help`-cache fetch no longer leaks into the
    panel.** A failed dispatch ack for the completion-cache `help` (which the
    user never typed) is swallowed instead of rendered as an error.
  - **Statistics — no stale counters.** Stats answers are disambiguated by
    `console_yuno`, so a quick yuno-selector switch can't let a late answer for
    the previous yuno overwrite the current table.
  - **Login — no silent error paths.** The `/auth/refresh` and `/auth/logout`
    network-failure catches now `log_error` (matching `/auth/login`).
  - **i18n — `fallbackLng: "en"`.** A key missing in `es` now renders the
    English string instead of the raw key.

_(Full per-yuno detail lives in `gui_agent/README.md`.)_

### gui_treedb

- TreeDB table + graph GUI over timeranger2/treedb, on the legacy GClass GUI
  stack; OAuth2-PKCE + BFF login (`README-KEYCLOAK*.md`). See
  `gui_treedb/README`.
