# Changelog

`yunos-js` — Yuneta's JavaScript **yunos** (browser SPAs) built on the
GObject-JS runtime (`@yuneta/gobj-js`) and the UI library (`@yuneta/gobj-ui`).
Extracted from `yunetas/yunos/js` into its own repository and consumed back as a
git **submodule** at `yunos/js` (the same model as `gobj-js` and `gobj-ui`), so
the JS yunos — the most active-changing layer — evolve on their own line.

Contents:

- **gui_agent** — Agent Console: a control-plane CLI/GUI to operate yuneta
  agents through the controlcenter (multi-agent console, nodes list, stats).
- **gui_treedb** — TreeDB GUI: table + graph views over timeranger2/treedb, on
  the gobj-ui V2 declarative shell, browsing MULTIPLE user-configured backends
  (auth_bff login + access_token forwarded in each C_IEVENT_CLI identity_card).
- Keycloak login-form / BFF notes and `FUTURE-JS.md`.

Each yuno consumes `@yuneta/gobj-js` / `@yuneta/gobj-ui` via local `file:`
dependencies (`../../../kernel/js/…`) that resolve within the yunetas
superproject, where this repo is mounted at `yunos/js`. (A standalone clone of
this repo, outside yunetas, will not resolve those `file:` deps — by design.)

## Unreleased

- **feat(gui_treedb): per-yuno service discovery, explicit connection
  lifecycle + C_TRANGER records browser.** Each Settings connection is the
  `C_IEVENT_CLI` entry to ONE yuno — its public wss url + remote role +
  service (the wss API offers no cross-yuno listing, so there is no agent
  scan and no `TreeDBs` column). Lifecycle is explicit: transports open only
  from the row's connect/disconnect button (persisted `enabled` intent) —
  editing a row's coordinates DISABLES it until reconnected, so typing in
  the table never auto-connects — and deleting a row asks for confirmation
  (shell yes/no dialog). On the first connect of a never-scanned connection
  `C_TREEDB_LINKS` discovers the yuno's `C_NODE` / `C_TRANGER` services
  automatically (one `services` command to `__yuno__`) and persists the
  WHOLE found list in the connection (`services`, each with a `selected`
  flag); the row's refresh button re-runs the discovery preserving the
  selection, and failures are reported above the table, never swallowed.
  The services render as Tabulator dataTree sub-rows whose checkbox edits
  `selected`; only selected services are offered in the workspace pickers
  (Topics: `C_NODE` + `C_TRANGER`; Graphs: `C_NODE` only) and open as tabs:
    - `C_NODE` → the treedb editors, as before;
    - `C_TRANGER` → the new read-only `C_TRANGER_VIEW` (Topics workspace
      only): topic tabs + records table (one-shot `open-list return_data=1
      from_rowid=-N`, needs a backend ≥ the yunetas release restoring the
      c_tranger read commands), generic columns derived from the records,
      full record JSON in the shell dialog, Refresh / Load-more (no polling).
  The union of every connection's SELECTED services is advertised in the
  identity_card's `required_services` (a selection change reopens the
  connection to re-send the card); `C_IEVENT_SRV`/`C_AUTHZ` on the backend
  still govern each command — rejections surface in the Settings error
  panel / view banner, nothing fails silently. The manual `treedbs` field is
  gone (discovery replaces it) and `C_TREEDB_PROXY` — the cross-yuno
  `command-yuno` wrapper of the earlier agent-scan design — was removed with
  it (every discovered service lives in the connected yuno and is addressed
  directly). gobj-ui gains the `yi-plug` / `yi-plug-slash` mask icons for
  the connect button. Connections persisted by the earlier design come back
  disabled (no `enabled` flag) with their services re-discovered on the
  next connect. Deleting a connection removes it in `C_TREEDB_CONFIG` and
  reloads the Settings table via `setData` — NOT Tabulator's `row.delete()`,
  which crashes in `styleRow` ("classList undefined") when the deleted row
  is a dataTree PARENT (a connection with service sub-rows) and then
  re-fires on every resize/redraw observer tick.

- **feat(gui_treedb): row search in C_TRANGER_VIEW.** The toolbar gains a
  search box that live-filters the records ALREADY loaded in the table
  (client-side Tabulator `setFilter` over a per-row haystack — formatted
  time + rowid + the full record JSON, so hidden fields match too). It is a
  case-insensitive substring match, remembered per topic, that never hits
  the backend (grow the window with "Load more" first if a match is outside
  the loaded page); the ✕ clears it, and the record-count line shows the
  matching/total split while a filter is active.

- **style(gui_treedb): default-size C_TRANGER_VIEW topic tabs + toolbar
  buttons** — dropped Bulma `is-small` from the `TRANGER_TOPICS` tabs and
  the Refresh / Load-more buttons (too small to read/tap).

- **chore: untracked the `gui_agent` / `gui_treedb` `deploy-com.sh`
  scripts** — local operator tooling carrying deploy node names; the files
  stay on disk, git-ignored from now on.

- **chore(gui_treedb): dropped the dead `ytable.css` import** — a v1-era
  leftover; nothing in gui_treedb (or the gobj-ui gclasses it hosts) uses its
  classes, and gobj-ui 3.0.0 removed the file with the rest of the legacy
  GClass GUI stack (both SPAs verified building green against 3.0.0).

## 0.4.0 — 2026-07-11

Rides gobj-ui **2.6.0**: the treedb gclasses and `C_YUI_WINDOW` moved to the
shell confirm/notification helpers, so both SPAs stop bundling the legacy
`c_yui_main.js` stack (see gobj-ui's CHANGELOG).

- **fix(gui_agent, gui_treedb): `yuno_version` derives from `package.json`.**
  The 0.3.0 release bumped `package.json` but not the hand-written
  `yuno_version` const in each `main.js`, so the yuno identity still said
  0.2.0 (the About dialogs were unaffected — they already read
  `pkg.version`). Both `main.js` now import `pkg.version` — one source, the
  mismatch class is gone. `npm version x.y.z --no-git-tag-version` is the
  whole bump now (gui_treedb README updated).

- **feat(gui_treedb): the treedb confirm dialogs are translated.** gobj-ui
  2.6.0 migrated the treedb gclasses to the shell confirm helpers, which keep
  the historical i18n keys — added `yes` / `no` / `accept` / `are you sure` /
  `please select some row` to both locales (validate-locales green, 67 keys),
  so the delete-row and select-something dialogs render in Spanish too. The
  dirty-guard sentence ("All changes will be lost…") stays untranslated: its
  canonical key is a capitalized sentence, which the locale convention
  (ASCII lower-case keys) rejects — same behavior as before.

- **fix(gui_treedb): the connection picker tab is translated on initial
  render.** `refresh_language(document.body)` after `yui_shell_set_submenu`
  (the submenu is rebuilt after the startup translate pass), so the picker
  tab shows the localized label immediately instead of the raw key until
  the first language toggle.

- **chore(deps): `vanilla-jsoneditor` → `^3.12.0`** in gui_treedb (lockstep
  with gobj-ui 2.3.1, whose `C_YUI_FORM` moved to the `createJSONEditor`
  factory, absent from 0.23.x). **gui_agent dropped the dependency
  entirely** — the developer window no longer uses the JSON editor and no
  gobj-ui component gui_agent imports pulls it (build green without it).

- **fix(gui_treedb): the ES/EN toggle now translates the app chrome.** The
  language switch mechanism worked (it flips i18next + `refresh_language`),
  but `en.js`/`es.js` only carried login/auth keys — so the nav rail
  (`topics`/`graphs`/`settings`/`connections`), the connection picker and
  Settings showed the raw English keys in both languages. Added the
  app-chrome keys (nav, picker, settings, common toolbar labels) to both
  locales (`validate-locales` green, 62 keys). Treedb SCHEMA column headers
  stay in their schema language on purpose — gui_treedb browses arbitrary
  treedbs and must not bake any one backend's vocabulary; the `col_label`
  cascade falls back to the schema header. One `t()` key was lowercased to
  satisfy the ASCII/lower-case key convention (`c_treedb_settings.js`).

- **style(gui_agent): dropped the top-sub tab-strip margin override** — the
  `.yui-zone-top-sub .yui-nav-tabs.tabs` fix moved into the shared shell CSS
  (gobj-ui), so the redundant app-level copy is gone.


## 0.3.0 — 2026-07-08

- **gui_agent: account menu order now matches gui_treedb** — Developer
  (dev-window toggle) first, then About, then Sign out. Was About before
  Developer.

- **gui_agent + gui_treedb: mobile primary menu matches the desktop rail.**
  Via gobj-ui 2.2.6: the bottom icon-bar's active/selected item now uses a
  solid `--bulma-link` background with white text (was low-contrast blue text
  on a faint blue tint).

## 2026-07-08 — shipped with SDK 7.7.2

- **fix(gui_agent): Terminal screen survives the refresh too.** On re-attach
  the live PTY repaints nothing (the prompt was printed to the previous page),
  so the tab landed "Connected" on a blank xterm. The view now serializes its
  screen (`@xterm/addon-serialize`, last 200 scrollback lines) to
  `sessionStorage` on `pagehide` and writes it back (one-shot, after a
  `term.reset()` so a bfcache resume doesn't double-paint) on the re-attach's
  `EV_TTY_OPEN` — F5 restores prompt and recent output exactly as they were.

- **fix(gui_agent): stable Terminal console name — a page refresh no longer
  leaks a PTY per reload until the agent's `max_consoles`.** The console name
  was random per open (`tty_<node>_<rand>`), and a refresh never sends
  `close-console`; behind the controlcenter cascade the agent cannot see the
  browser disconnect either (the console's route is the controlcenter↔agent
  channel, which stays up), so every F5 forked a new bash on the node. The
  name is now STABLE per tab+node (`console_name_for`: per-tab id persisted in
  `sessionStorage`), so a refresh re-opens the SAME console and an upgraded
  agent (> 7.7.1) re-attaches to the live PTY — the shell session survives F5.
  `open_console` no longer closes-before-opening (same name = re-attach; it
  still closes a previous console under a *different* name). Against an older
  agent, whose answer is `-1 "Console already open"` and whose tty stream
  still routes to the dead requester channel, the tab falls back to per-open
  random names (the old behavior) after closing the stale console.

- **feat(gui_agent): mobile key bar for the Terminal.** A phone's soft keyboard
  has no Esc / Tab / Ctrl / arrow / Home-End keys, so on mobile the xterm PTY
  console couldn't complete (Tab), walk history (↑ ↓), edit the line (← →) or
  interrupt (^C) — desktop was fine (physical keys reach `onData`).
  `c_agent_tty.js` now shows a two-row accessory bar (mobile-only via
  `is-hidden-tablet`) at the TOP of the card, under the toolbar: symbols row
  **^C | / - _ Home End Paste** over keys row **Kbd Esc Tab Ctrl ← ↑ ↓ → ↵**,
  each key injecting the exact escape/control bytes through the same
  `send_keys` path (Enter ↵ is double-width with an enlarged glyph — scaled
  via transform so the row height stays uniform; arrows render at 1.15rem).
  **Ctrl** is a sticky modifier (arm → next key from bar or soft keyboard
  becomes its control byte). **Kbd** toggles the browser soft keyboard, which
  is OPT-IN: the xterm textarea gets `inputmode="none"`, so tapping the
  terminal focuses without summoning the keyboard and the whole screen stays
  for output; a tablet rotated across the Bulma breakpoint (bar hidden)
  restores normal input mode so the keyboard is never unreachable. **Paste**
  reads the clipboard (user gesture + permission; ✗ flash on denial) into the
  PTY via `term.paste()`. Buttons emit on `pointerdown` + `preventDefault` so
  the xterm keeps focus. The viewport meta declares
  `interactive-widget=resizes-content` so the on-screen keyboard shrinks the
  layout viewport and the terminal reflows above it.
- **fix(gui_agent): the Terminal refits on every host resize — CLIENT-ONLY.**
  The xterm was fit once at open and frozen: resizing the browser window or
  the devtools pane clipped the bottom rows (the prompt) out of view — xterm's
  scroll moves its buffer, not the DOM, so the input line was unreachable. A
  `ResizeObserver` on the host refits (debounced to one fit per frame, skipped
  while hidden) on every change: devtools/window resize, soft keyboard
  open/close, rotation. After the refit the viewport re-pins to the prompt if
  it was following the bottom. The node PTY geometry stays FROZEN at
  `open-console` — same contract as a native terminal running ycommand; an
  earlier `resize-console`/`EV_RESIZE_TTY`/SIGWINCH path (SDK + client) was
  built and then removed the same cycle ("remove resizing c_pty") in favour of
  this browser-only fix.
- **feat(gui_agent): touch scrolling for the Terminal (mobile).** xterm has no
  touch scrolling of its own — touches land on `.xterm-screen` (the canvas)
  whose scrollable `.xterm-viewport` is a SIBLING, not an ancestor, so a
  finger drag scrolled nothing and chained up to the page (Android Chrome
  turned it into pull-to-refresh). `tty_touch_scroll.js` owns the drag:
  `preventDefault` + `term.scrollLines()` with natural direction, accumulating
  sub-row deltas; `overscroll-behavior:contain` on the host stops chaining
  from the scrollbar path too. The native Android long-press menu
  (Translate/Cut/…, a `contextmenu` aimed at xterm's hidden textarea) is
  suppressed while a touch is in flight — an earlier long-press
  word-selection + Copy/Paste bubble (`tty_touch_select.js`) fought that
  native UI and was removed the same cycle; mobile paste is the key bar's
  Paste key, and desktop selection/right-click stay native.
- **fix(gui_agent): Commands console input row on top.** `CONSOLE_INPUT_ROW`
  (+ its typing hint) moved from the card bottom to the top, above the status
  row and the response; the help/history popovers dropped `is-up` and open
  downward.
- **feat(gui_agent): smart Commands history.** History entries are DEDUPED
  `{cmd, count, last}` (MRU first): a re-run bumps the counter and moves the
  entry to the front, so ↑/↓ recall never repeats; the legacy plain-string
  persisted format is normalized on load (duplicates collapse into counts).
  The history popover gains a **Recent/Frequent** sort header (persisted in
  the browser, `console_hist_sort`) and each row shows the command, its ×N
  use counter, a **+** button that preloads
  `add-shortkey key= command="<cmd>"` with the caret on `key=` (the existing
  local command creates the shortkey — no new dialog) and a **✕** button that
  deletes the entry from the persisted history in place.
- **feat(gui_treedb): "About" dialog in the account menu.** A new About entry
  (account dropdown, between Developer and Sign out) opens the standardized
  adaptive dialog (desktop X top-right / mobile back sheet) with a product
  card: the TreeDB mark, `TreeDB Console` + `version · deployment tenant`, a
  one-line description and a Documentation link to `doc.yuneta.io`.
  Self-contained in `C_TREEDB_APP` (`EV_OPEN_ABOUT` → `yui_shell_show_modal`,
  idempotent toggle) — no view gclass, mirroring gui_agent's About. The account
  menu's `developer` / `logout` labels are now translated too (they fell
  through to lower-case English before).
- **fix(gui_treedb): the transport rebind now really mounts the fresh view
  (editing `treedbs` left a blank/crashed tab).** The treedb views remove
  their own `$container` from the DOM in `mt_destroy`, so
  `rebind_hosted_view`'s `replaceChild` — which captured only the old node —
  found `parentNode === null` after destroying the old view and silently
  never inserted the new container; the fresh view then built its Tabulators
  against elements outside the document ("Tabulator Creation Error - no
  element found" + uncaught `externalEvents is null`). The rebind now
  remembers the parent and position BEFORE destroying and inserts the new
  container even when the old one already detached itself. (Root cause pair
  in the frameworks: gobj-js 7.7.2 stops the `send_iev` TypeError burst on
  the same reopen; gobj-ui 2.2.5 attaches topic Tabulators by element.)
- **fix(gui_agent): dedupe i18next in vite config.** gui_agent's
  `vite.config.js` had the `preserveSymlinks` aliases but no
  `resolve.dedupe`, so the vendored gobj-ui's own `node_modules/i18next`
  bundled as a SECOND instance — module-level `t()` in gobj-ui views ran on
  an uninitialized i18next and rendered blank (the recorded footgun).
  Replicated gui_treedb's dedupe list.
- **fix(gui_agent): a typed `list-agents` now renders in the Commands
  console.** The answer filter dropped EVERY `list-agents` answer (meant to
  hide the Nodes picker's fetch), so an operator typing `list-agents` never
  saw the result and the "running…" placeholder stuck. Only unmarked
  answers (no `console_seq`/`console_node` echoed in `__md_iev__`) are
  swallowed now; a typed one carries this panel's markers and renders.
- **fix(gui_agent): a transient `write-tty` failure no longer orphans the
  remote bash.** Any `result<0` answer tagged `tty` cleared `console_name`
  and marked the session Failed — so after a per-keystroke `write-tty`
  error, Reconnect's best-effort `close-console` (which needs the name) was
  skipped and the node-side PTY leaked. A failed `write-tty` now only
  prints a transient error line in the terminal; only a failed
  `open-console` stays fatal. A genuinely dead console is still cleaned via
  the agent's `EV_TTY_CLOSE`.
- **fix(gui_treedb): `C_TREEDB_VIEW` subscribes in `mt_start`, symmetric
  with `mt_stop`.** The `EV_ROUTE_CHANGED` (shell) and `EV_ON_OPEN`
  (`treedb_links`) subscriptions lived in `mt_create` while the
  unsubscribes were in `mt_stop`, so a stop+start cycle would lose both —
  hardening the just-landed transport-rebind wiring. The shell broadcasts
  `EV_ROUTE_CHANGED` only after `gobj_start`, so behavior is unchanged.
- **fix(gui_treedb): a mounted treedb tab no longer strands a destroyed
  transport after a connection reopen.** `C_TREEDB_LINKS` RECREATES a
  connection's `C_IEVENT_CLI` on a token-refresh reopen (NAK → silent refresh
  → `treedb_links_reopen`) and on a coords edit in Settings — but a mounted
  `C_TREEDB_VIEW` resolved the transport once in `mt_create` and baked it into
  the hosted view's `gobj_remote_yuno` (plus its `EV_TREEDB_NODE_*`
  subscriptions), so after a SUCCESSFUL recovery the tab looked connected but
  its `descs`/`nodes` went to a destroyed gobj forever (until close+reopen or
  F5). The wrapper now also subscribes to `treedb_links`' `EV_ON_OPEN`: when
  ITS connection reaches session on a DIFFERENT transport gobj than the hosted
  view holds, it rebuilds the hosted service in place against the new iev
  (deferred out of the publish; container swapped in the mounted DOM keeping
  the shell's show/hide state; URL-selected topic/mode re-applied). A plain WS
  reconnect (same gobj) is ignored, as before. This also heals a tab created
  before its transport existed ("Backend not connected" placeholder).
- **chore(gui_treedb): purge unused `public/` boilerplate (~1.2 MB → 8 KB).**
  Nothing in the app referenced the HTML5-boilerplate leftovers (`404.html`,
  `browserconfig.xml`, `robots.txt`, `humans.txt`, `publi_page/`), the old
  yuneta-Y brand set (`yuneta-y-*`, `logo*`, `tile*`, `icon.png`,
  `artgins-logo.png`, `yuneta-label.*`), the webix-era `images/` icons,
  `fonts/` (3 TTFs) or `icons/icons.js` — all removed. `public/` now matches
  gui_agent's baseline: `treedb-mark.svg` + `site.webmanifest` + a
  `favicon.ico` regenerated from `treedb-mark.svg` (real multi-size ICO
  16/32/48 — the old file was a yuneta-Y PNG renamed `.ico`). Also dropped
  `src/logos_svg.js` (inline old-brand SVGs, imported by nothing; bundle
  hash unchanged).
- **fix(gui_treedb): Settings table vanished after revisiting the page.**
  Settings is a `lazy_destroy` route, but `C_TREEDB_SETTINGS.mt_destroy`
  never removed its `$container` from the stage, so each visit leaked a
  hidden copy holding the fixed `#treedb_settings_table` div; the next
  visit's Tabulator, attached by `#id` selector, built its table inside
  the stale hidden container and the visible page showed no table.
  `mt_destroy` now removes the container (matching gui_agent's views) and
  Tabulator attaches to the element found inside OUR `$container`, immune
  to duplicate ids. (gobj-ui 2.2.2 also removes the container shell-side
  on `lazy_destroy` — cause-level fix.)
- **New TreeDB logo + branded loading splash (gui_treedb, gui_agent).** The
  gui_treedb login/favicon dropped the generic yuneta-Y mark for a purpose-made
  `treedb-mark.svg` — a node-link graph (four nodes, teal tile) that reads as a
  TreeDB. Both apps' pre-shell "loading" screen (was a plain — and for gui_treedb,
  garish red-on-lilac — text banner) is now a full-screen branded splash: the app
  mark, its name, and a spinner on the brand gradient (teal for TreeDB, blue for
  Agent Console), so the first paint already matches the login and the hand-off is
  seamless. Reduced-motion friendly; `main.js` still removes it on ready.
- **Redesigned login screen for gui_agent and gui_treedb (like wattyzer).**
  Both pre-shell logins were a plain centered Bulma box on a flat gradient. They
  now use the same polished split-card design as wattyzer's login: a brand-tinted
  welcome panel (mark + wordmark + a one-line pitch + three feature bullets) beside
  the sign-in form, animated ambient background orbs, a gradient CTA, a password
  reveal, theme + language quick toggles, and a version footer — collapsing to
  form-only below 900px, theme-aware (light/dark), and reduced-motion friendly.
  Each keeps its own palette and copy: gui_agent = Agent Console (indigo/blue),
  gui_treedb = TreeDB GUI (teal). New `login.js` + `login.css` per app (imported
  in `main.js`); new i18n keys added to both locales (EN + ES). The BFF login
  contract is unchanged (`on_submit({username, password})`; the controller still
  exposes `set_busy` / `set_error` / `unmount`).


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
- **Statistics refactor — tree picker + per-yuno cards.** The Statistics
  workspace no longer picks a node and drills into a yuno via a dropdown.
  Instead its picker is a **tree** (`C_STATS_NODES`): each node (agent ≥ 7.7.0,
  `list-agents`) expands to its running **yunos** as sub-rows (`list-yunos` per
  node), and a checkbox on a yuno row selects it. Each selected yuno opens its
  own tab (`C_AGENT_STATS`, refactored) rendering that yuno's `SDF_RSTATS`
  counters as **one card** (role^name header + node + a stat/value table).
  Selection is a yuno keyed by a composite id `node<US>yuno_id`, so the tab +
  reload machinery is reused. Integer counters get fixed "." grouping (no
  `Intl`/`navigator.language`). No polling — the tree loads on open / Refresh,
  a card on selection / Refresh.
  - **Cards layout setting.** A **Settings → Preferences** toggle ("Statistics
    cards", `stats_layout` persisted) chooses between **one tab holding all
    cards** (default) and **a tab per yuno**. In single mode `C_AGENT_STATS`
    (all-mode) renders a card per selected yuno and tracks the tree's selection
    live; `C_APP` swaps the Statistics tabs on the setting change.
  - **Auto-refresh (a sanctioned polling exception).** The stats cards now
    auto-refresh on a timer — default **2 s**, set in **Settings** ("Auto-refresh
    stats": Off / 1 / 2 / 5 / 10 / 30 s, `stats_refresh`). This is a deliberate,
    opt-in exception to Yuneta's no-polling rule (RSTATS has no push path). Kept
    tight: `C_AGENT_STATS` polls only the current card targets, only while the
    tab is **visible** (a MutationObserver disarms it when hidden and refreshes
    on show), and only while the link is up. A counter whose value **changed**
    since the previous refresh is accented (amber/bold, `.stats-changed`) for
    that one cycle and reverts when it settles — no animation.
- **Nodes table sorted by version by default.** The node picker now opens
  sorted by agent version descending (highest on top), with a numeric dotted
  sorter so `7.10.0` ranks above `7.9.0` (not a plain string sort).
- **Dark-theme tree toggle.** Tabulator hardcodes the tree expand/collapse
  control (the `+`/`-` box) to a `#333` border and `#333` strokes on a
  near-black wash — invisible on a dark background. A `[data-theme=dark]`
  override in `app.css` repaints the border, hover wash and `+`/`-` strokes to
  full contrast so the Stats/Nodes tree toggle reads clearly.
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

- **Rebuilt on the gobj-ui V2 declarative shell (C_YUI_SHELL/NAV), multi-backend
  (0.2.0).** Migrated off the legacy GClass GUI stack (C_YUI_MAIN/ROUTING) onto
  the V2 shell, and generalized from a single hardwired backend to browsing
  treedbs on MULTIPLE user-configured backends on other hosts. The SPA
  authenticates once at the co-located auth_bff (BFF cookie) and forwards the
  access_token in each C_IEVENT_CLI identity_card to the (possibly remote)
  treedb backends — see the opt-in `POST /auth/token` endpoint in yunetas
  `c_auth_bff.c` and `YUNO_AUTH.md §2.2`. New gclasses: C_TREEDB_APP (root),
  C_TREEDB_CONFIG (connections + selection in localStorage), C_TREEDB_LINKS
  (one C_IEVENT_CLI per connection, jwt forwarded), C_TREEDB_LOGIN, C_TREEDB_PICKER
  (treedb selection), C_TREEDB_SETTINGS (editable Tabulator connection editor),
  C_TREEDB_VIEW (hosts C_YUI_TREEDB_TOPICS/GRAPH as a named service so command
  answers route back). CSP broadened to `wss:`/`https:` for runtime-configured
  backends. Verified end-to-end against db_history_wz on app.wattyzer.com.
  KEY: the identity_card must advertise the treedbs in `required_services` or the
  backend authz gate silently drops the `descs`. See `gui_treedb/README`.
- **F5 / reconnect restores the open treedb tab.** The per-workspace treedb tabs
  are only built once their backend is CONNECTED, so on a reload (or a slow
  reconnect) the hash `/​<ws>/db/<sel>` first resolves to its ancestor and the
  shell shows the connection picker. `C_TREEDB_APP` now re-navigates to the tab
  named in the URL as soon as `EV_ON_OPEN` rebuilds it (`restore_tab_from_url`),
  so a refresh lands back on the treedb the operator was on instead of the
  connection manager.
- **Fixed blank treedb column headers + duplicated singletons (Vite dedupe).**
  Every table column rendered with an empty title (Tabulator's `&nbsp;`
  placeholder) and "0 undefined" in the footer. Root cause: with
  `preserveSymlinks:true`, `gobj-ui` (a symlinked `file:` dep) ships its own
  `node_modules` copy of every shared lib, so without a bundler dedupe Vite
  bundled TWO copies — gui_treedb initialized copy A of i18next (`locales.js`)
  while the vendored treedb view (`import {t} from "i18next"`) bound copy B,
  never initialized, so `col_label`'s `t(...)` returned "" for every header.
  Confirmed fixed live (headers render). The same duplication affected every
  other shared third-party lib (bundle shrank ~120 KB once deduped), so
  `resolve.dedupe` now lists them all — `i18next`, `@antv/g6`, `maplibre-gl`,
  `tabulator-tables`, `tom-select`, `uplot`, `vanilla-jsoneditor` — mirroring
  `wattyzer/gui/vite.config.js` as preventive hygiene against latent
  split-singleton bugs in the graph / map / editor views. (`@yuneta/gobj-js` /
  `@yuneta/gobj-ui` are already single instances here via the `src/` aliases;
  the app's own menus/toolbar were unaffected because the shell receives `t`
  injected via `yui_shell_set_translator`. NOTE: the console line "[G6]
  extension drag-canvas has been registered before" is an INTENTIONAL override
  in gobj-ui's `g6_drag_canvas_touch.js`, not a duplication symptom.) Diagnosed
  by driving the live app with Playwright: the backend `descs` answer was
  correct (proper `cols`/headers), the blank titles were purely client-side.
- **Fixed reconnect regressions vs the gui_agent/wattyzer references (audit).**
  A cross-app comparison surfaced transport/reconnect wiring the V2 rebuild
  dropped:
  - **`gobj NULL or DESTROYED` on WS close.** `C_TREEDB_VIEW.mt_destroy` called
    `gobj_destroy` on its hosted view, a SERVICE child the framework already
    cascade-destroys — a double-destroy logging one error per pruned tab.
    Mirrored wattyzer's `C_WZ_TREEDB.mt_destroy` (just drop the references).
  - **Unbounded refresh→reopen→NAK loop.** `ac_login_refreshed` cleared the
    recovery latch immediately and `ac_on_open` never re-armed it, so a backend
    that kept rejecting the forwarded token drove an endless `/auth/refresh` +
    reconnect loop. Added a per-connection `nak_recovered` latch: one silent
    refresh + reopen; a repeat NAK closes THAT connection's transport (breaking
    the loop) without logging the user out — the BFF session and other backends
    are unaffected (gui_agent logs out here because it is single-link;
    gui_treedb is multi-backend). Verified live with Playwright (tab open/close
    → no `gobj NULL or DESTROYED`).
- **Tabs survive a WS flap; picker only offers real treedbs (audit follow-ups).**
  - **Keep the treedb tab mounted across a transient disconnect** instead of
    removing it. `rebuild_workspace_tabs` dropped the tab whenever its backend
    was not `connected`, so the shell pruned + destroyed the mounted
    `C_TREEDB_VIEW` on every clean WS close, rebuilding it on reconnect (churn:
    lost scroll/selection, re-`descs`/`nodes`). Now a connection that reached
    session at least once (`ever_connected`) keeps its tab, coloured
    `yui-nav-disconnected` (red) while dropped — the C_IEVENT_CLI transport
    survives a clean close and reconnects underneath, so the view stays valid.
    Mirrors gui_agent (keep node tabs, recolour). Verified live with Playwright
    (force-close the socket → tab stays, goes red, view not destroyed,
    recovers). The tab is removed only when the transport is truly gone.
  - **Picker offers only real treedbs.** `connection_treedbs` fell back to
    enumerating every `services_roles` key when a connection had no curated
    `treedbs`, which offered NON-treedb services (e.g. the raw `tranger_authz`
    C_TRANGER that backs `treedb_authzs`); browsing one sent a treedb `descs` to
    a ranger → "command not available". Now the curated `treedbs` list (Settings)
    is the contract, like wattyzer's static route table; when empty the card
    shows the "add them in Settings" hint. (The browsable authz treedb is
    `treedb_authzs`, not `tranger_authz`.)
- **Surface a backend that can't be reached (audit C2).** A connection with a
  bad URL / cert / closed port / down backend showed "Connecting…" forever:
  `C_TREEDB_LINKS` swallowed `EV_ON_OPEN_ERROR` while `C_IEVENT_CLI` retried
  silently in the background. Now the transport records the failure per
  connection and re-publishes `EV_ON_OPEN_ERROR` (tagged with `conn_id`); the
  picker card shows "Cannot connect (…) — retrying…" in red instead. The
  transport keeps retrying, so a fixed/again-reachable backend recovers on its
  own (the error clears on `EV_ON_OPEN`). One unreachable backend never tears
  down the shell or affects other backends (multi-backend, unlike wattyzer's
  single-link `ac_on_open_error` which logs out). `C_TREEDB_APP` declares the
  event as a no-op (it is a null-subscriber to every links event). Verified live
  with Playwright (a wrong-port connection shows the error; a good one connects
  alongside; no FSM "event not defined" crash).
- **Deep-link the selected topic / operation mode (audit B4).** `C_TREEDB_VIEW`
  had the child selection ↔ URL bridge stubbed out as a no-op, so a reload always
  reset to the first topic (topics) / `reading` (graph). Ported wattyzer's
  `C_WZ_TREEDB` bridge, adapted to the multi-connection route scheme: the hosted
  view's `EV_TOPIC_SELECTED` / `EV_OPERATION_MODE_CHANGED` navigates the shell to
  `<tab-route>/<seg>`, and the shell's `EV_ROUTE_CHANGED` applies the subpath back
  to the view (`EV_SHOW` / `EV_SET_OPERATION_MODE`). Each mounted view filters on
  its own `base_route` (several are mounted at once), and a `seg` dedup breaks the
  child→navigate→route-changed→child loop. `restore_tab_from_url` now navigates to
  the full deep route so the topic/mode is restored along with the tab. The
  connection is already encoded in the tab route (via the sel id), so no extra
  routing was needed. Verified live with Playwright (select `users` →
  `…/treedb_wattyzer/users`; F5 → the `users` topic is restored, not the first).
- **Avatar initials after a reload.** The logged-in user's initials vanished
  after F5: `/auth/login` returns the username but `/auth/refresh` (session
  restore) does not, so the username was empty on restore and `compute_initials`
  produced nothing. `fetch_and_publish` now falls back to the identity claims
  (`name` / `preferred_username` / `email`) in the access_token (JWT) it already
  fetches, so the initials render on restore too. (gui_agent gets the name from
  the control-center's `EV_ON_OPEN`; gui_treedb has no single equivalent, so the
  JWT is its authoritative identity.) Verified live with Playwright (initials
  show on fresh login AND after F5).
- **Switching workspaces remembers the active tab.** Going topics ↔ graphs
  (clicking a primary nav item) always dropped onto that workspace's
  "connections" picker, losing the treedb tab you were on. The submenu default
  is now the workspace home route (`/<ws>/db`) instead of the picker, and
  `C_TREEDB_APP.ac_route_changed` redirects a primary-nav entry to
  `workspace_first_route` — the last-active tab if it still has a tab, else the
  first open tab, else the picker (mirrors gui_agent). The F5 fallback (base
  `/<ws>/db` WITH a subpath) is left for `restore_tab_from_url`, so a reload is
  unaffected. The picker stays reachable as its own "connections" tab. Verified
  live with Playwright (topics→graphs→topics returns to the treedb tab; F5 topic
  restore still works).
- **Inline error on a failed treedb load (via gobj-ui 2.1.14).** Opening a
  target that isn't a treedb (or one the user has no authz for) no longer pops a
  blocking app modal that wedged the SPA behind an empty tab — the treedb views
  (`C_YUI_TREEDB_TOPICS/GRAPH`, in gobj-ui) now show a non-blocking inline banner
  on a `descs` failure. Completes the migration-audit follow-up B3 (B1 already
  stops the picker from offering non-treedbs; this is the graceful fallback when
  one is opened anyway, e.g. a stale selection or a revoked role). Verified live
  with Playwright (opening `tranger_authz` shows the inline banner, no modal).
- (superseded) TreeDB table + graph GUI on the legacy GClass GUI stack;
  OAuth2-PKCE + BFF login (`README-KEYCLOAK*.md`).
