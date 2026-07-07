# gui_agent — Yuneta Agent Console

A web SPA (single-page app) to operate yuneta **agents** from the browser,
built on the **v2 declarative shell** of `@yuneta/gobj-ui`
(`C_YUI_SHELL` + `C_YUI_NAV`).

It is the modern successor of the old webix "Yuneta CLI"
(`yuno_gui/v2/.../ui_yuneta_cli.js`). **Four workspaces** in the primary rail:
**Commands** (control-plane CLI to a node's yunos), **Statistics** (live
`SDF_RSTATS` counters as cards), **Terminal** (an interactive xterm.js PTY
console), and **Settings**. **Commands** and **Terminal** share one pattern — a
flat node-picker tab (`C_NODES`) plus one closable tab per selected node.
**Statistics** differs: its picker is a **nodes→yunos tree** (`C_STATS_NODES`)
where you select *yunos*, and their counters render as **cards** (one tab for
all cards by default, or a tab per yuno — a Settings toggle). Commands/Statistics
list only agents **≥ 7.7.0**; Terminal works on any version. TreeDB browsing
lives in the separate **`gui_treedb`** SPA, not here.

**Canonical URL:** the SPA is served at `https://agents.yunetacontrol.com`
(new apex — needs its own DNS zone + TLS cert at deploy time). This is the
app's own origin, **not** a backend endpoint: it does not go in
`csp_connect_src`. In Phase 2 it must be registered in the IdP as a Valid
Redirect URI (`https://agents.yunetacontrol.com/*`) and Web Origin, and the
agent must accept `wss` upgrades from this origin.

## Key design choice: config lives in the browser, not the repo

Unlike `gui_treedb` (which hardcodes endpoints in `src/conf/backend_config.js`),
this app ships **no private data**. The user enters the authentication URL and
the agent endpoints through **forms** in the *Settings* views, and those values
are persisted as **gobj persistent attrs** in the browser `localStorage`
(`db_save/load_persistent_attrs`, wired in `src/main.js`).

`src/conf/defaults.js` only carries empty templates and a non-secret example.

> **CSP note:** `config.json` → `csp_connect_src` is a **build-time** security
> boundary. The browser only allows WebSocket/HTTPS connections to the origins
> listed there. An agent URL the user adds in Settings **must** match one of
> those origins; adding a brand-new origin requires editing `config.json` and
> rebuilding.

## Library consumption (v2)

Both kernel JS packages are consumed as local `file:` deps on the submodules:

```
@yuneta/gobj-js -> ../../../kernel/js/gobj-js   (file:, v2 source via vite alias)
@yuneta/gobj-ui -> ../../../kernel/js/gobj-ui   (file:, v2 / main line)
```

This is the v2 (`main`) line — **not** the published npm v1 used by
estadodelaire/hidraulia.

## Transport to the agent

A single shared **`C_AGENT_LINK`** service (`"agent_link"`) owns the one
`C_IEVENT_CLI` to the **control center** co-located on the SPA's host
(`wss://<host>:1996`, derived in `src/conf/deploy.js`); the control center then
federates to the remote nodes' agents. Panels don't own a transport — they call
`agent_link_command(link, command, kw)` and receive answers via the link's
re-published `EV_MT_COMMAND_ANSWER` (`{result, comment, schema, data}`).

**Inter-yuno service contract.** A command's answer is addressed (across the
browser↔backend yuno boundary) to the *name* of its `src`, and cross-boundary
delivery only works between **named services with public events**. So commands
are sent with `src` = the `agent_link` service (which declares the answer events
`EVF_PUBLIC_EVENT`), never a routed view; `agent_link` re-publishes the answer to
the view panels intra-yuno. A panel that *is* a named service (e.g.
`C_TREEDB_GATE`) may pass itself as `src` and receive the reply directly.

The Console targets remote role `controlcenter` / service `controlcenter` and
wraps each typed line in a `command-agent` (which returns a synchronous dispatch
ack plus the agent's asynchronous real answer).

## Build & run

```bash
cd yunos/js/gui_agent
npm install
npm run dev        # vite dev server
npm run build      # production bundle into dist/
```

## Roadmap (phases)

| Phase | Content |
|-------|---------|
| **0** | Scaffold: shell + nav, placeholder views, green build *(this commit)* |
| **1** | `C_AGENT_CONSOLE` (CLI panel) + `C_SETTINGS` (agents form, persistent attrs); MVP target `app.wattyzer.com` over `wss`+OAuth2 |
| **2** | Authentication: configurable OIDC/Keycloak `auth_url` → JWT → `wss:1993` |
| **3** | Live **Stats** (`C_AGENT_STATS`): a yuno's `SDF_RSTATS` counters as a table. TreeDB moved out to the `gui_treedb` SPA. |

## Status

**Live**, restructured into **four primary workspaces** — **Commands**
(`C_AGENT_CONSOLE`), **Statistics** (`C_STATS_NODES` tree picker +
`C_AGENT_STATS` cards), **Terminal** (`C_AGENT_TTY`, xterm.js over the agent
PTY), **Settings**. **Commands** and **Terminal** share the flat pattern: a
node-picker tab (`C_NODES`) plus one closable tab per selected node.
**Statistics** picks **yunos** from a nodes→yunos tree and shows their
`SDF_RSTATS` counters as **cards** — a single tab holding all cards (default)
or a tab per yuno (Settings toggle "Statistics cards"). The cards **auto-refresh**
(default 2 s, Settings; a deliberate opt-in exception to Yuneta's no-polling
rule, visible-tab only) and **highlight** any counter that changed since the last
refresh. Commands/Statistics require agent **≥ 7.7.0**; Terminal works on any
version (needs the `open-console` authz — an admin role). Selecting a tab focuses
its input (Commands) / xterm (Terminal); node tabs carry a green/red connection
dot; the last-active tab is remembered per workspace. TreeDB is **not** part of
this app — it is the separate `gui_treedb` SPA. Time-series charts
(`C_YUI_UPLOT`) over the live counters are a possible follow-up. See the
`CHANGELOG.md` (repo root) for the per-cycle detail.

## Changes

This yuno is JavaScript and deploys independently of the SDK (see
`deploy-com.sh`), so its changes live here rather than in the top-level
`CHANGELOG.md`.

### 7.7.0 cycle

- **Terminal mobile key bar.** A phone's on-screen keyboard has no Esc / Tab /
  Ctrl / arrow / Home-End keys, so on mobile the PTY console couldn't complete
  (Tab), walk history (↑ ↓), edit the line (← →) or interrupt (^C) — everything
  works on desktop, where physical keys already reach `onData`. `c_agent_tty.js`
  now appends a two-row accessory bar (`is-hidden-tablet`, so desktop is
  unaffected) that injects the exact byte sequences: **Esc Tab Ctrl ← ↑ ↓ →** /
  **^C ^D ^Z | / - Home End**. **Ctrl** is a sticky modifier — arm it, then the
  next key (bar or soft keyboard) is sent as its control byte. Buttons fire on
  `pointerdown` + `preventDefault`, so the xterm keeps focus and the keyboard
  stays open. To keep the bar **above** the keyboard the viewport meta declares
  `interactive-widget=resizes-content`, so the on-screen keyboard shrinks the
  layout viewport and the app's `height:100%` chain reflows above it (Android
  Chrome overlaid the keyboard otherwise, hiding the bar). _Follow-up: browsers
  without `interactive-widget` support (older Android WebViews, current iOS
  Safari) still overlay; pin the bar to `visualViewport` there if a real device
  needs it._
- **Terminal touch selection (mobile).** xterm.js selection is mouse-only, so on
  a phone a long-press selected nothing. New `tty_touch_select.js` adds a touch
  gesture driving xterm's public selection API: **long-press** selects the word
  under the finger (haptic tick), **drag** extends it (char-level within a row,
  line-level across rows — xterm has no public multi-row char API), **release**
  shows a floating **Copy** bubble that writes `getSelection()` to the clipboard,
  and a tap elsewhere dismisses. A quick drag (no long-press) is left to xterm's
  own viewport scroll. Desktop is unaffected (touch events never fire). Root-caused
  with headless-browser reproductions of the shipped xterm v6 build. _Follow-up:
  tune long-press timing / native-callout suppression against real iOS/Android._
- **Responsive window-manager dock.** `__window_manager__` is created in
  `responsive` mode (gobj-ui 2.1.9): floating bottom-left on desktop, an inline
  taskbar row in the shell's free `bottom-sub` zone on mobile so it sits above the
  primary menu instead of covering it.
- **Global Tabulator CSS.** Tabulator theme fixes moved to the library
  (`@yuneta/gobj-ui/src/tabulator.css`); the Nodes active-row uses the shared
  `.yui-row-active` class.
- **Statistics per-card Reset.** Each Statistics card gained a broom-icon **Reset**
  button that sends `stats-yuno id="<yuno>" stats="__reset__"` for that yuno; the
  zeroed values return on the same stats-answer path and refill the card. Effective
  only where the gclass honours `__reset__` (kernel iogate/channel/gates); app
  gclasses that keep counters in private fields surfaced via `mt_reading` need their
  own `mt_stats(__reset__)` — a pending backend review, not a gui bug.
- **Dev monitor Copy + Expanded (inherited).** From gobj-ui: a **Copy** button
  (copies the visible traffic) and an **Expanded** JSON view with Schema/Data/
  Metadata section toggles in the Developer window.
- **Account menu + adaptive dialogs.** The account (avatar) menu now holds **About**
  (+ Developer + Sign out); **Settings** is a tab-less **rail** view (Preferences),
  no longer duplicated in the menu. **About** opens as the standardized gobj-ui
  **adaptive dialog** (2.1.12): a centered card with the close **X top-right** on
  desktop, a full-screen sheet with a **back arrow top-left** on mobile; the popup
  backdrop was lightened (2.1.13). App at **0.2.0**.

### 7.6.8 cycle

- **Statistics (tree picker + cards).** The Statistics workspace picker is a
  **nodes→yunos tree** (`C_STATS_NODES`): each node (`list-agents`, ≥ 7.7.0)
  expands to its running yunos (`list-yunos` per node), and a checkbox on a yuno
  row selects it. Selected yunos' `SDF_RSTATS` counters render as **cards**
  (`C_AGENT_STATS`, `stats-yuno id=<yuno>`) — a single tab holding a card per
  selected yuno (default), or a tab per yuno (Settings toggle). Fetches are
  tagged `console_purpose` + `console_node` + `console_yuno` (echoed in
  `__md_iev__`, [[md_iev round-trip]]) so each answer updates exactly its own
  card and other panels ignore it. Integer counters get fixed "." grouping
  (Intl-free — the `navigator.language` crash landmine). The cards **auto-refresh**
  on a timer (default 2 s, Settings "Auto-refresh stats", 0 = off; a deliberate
  opt-in exception to the no-polling rule — polls only the visible tab's current
  cards while the link is up) and a counter that **changed** since the last
  refresh is accented for that cycle. `C_YUI_UPLOT` time-series charts remain a
  possible follow-up.
- **TreeDB removed.** TreeDB browsing now lives in the dedicated `gui_treedb`
  SPA; the placeholder menu and the blocked `C_TREEDB_GATE`/`C_TREEDB_PANEL`
  adapters (plus the `C_YUI_TREEDB_*` registrations) were dropped from this app.
- **Multi-agent Console.** One top-sub tab per selected node (built on
  gobj-ui's runtime nav API); each tab is a `C_AGENT_CONSOLE` pinned to that
  node — red when disconnected, closable. On F5 (or landing on the console
  home) the exact open node is restored from the route subpath, falling back
  to the first open node.
- **Command helper.** A per-node `help` cache drives Tab completion (command
  name *and* parameters), a live signature/description hint, and a **“?”
  popover** of available commands. Up/Down recall shell-style **command
  history**, global to all nodes (persisted in the browser); a **history
  popover** lists recent commands. No polling — the node list refreshes on
  demand.
- **Shortkeys.** Like ycli, the first token of a command is looked up in a
  persistent `{key: template}` dict; a match expands to the template with
  `$1 $2 …` replaced by the following positional args (quote-aware). Seeded
  with ycli's defaults (`s` → `stats-yuno yuno_role=logcenter`, `ss`, `r`,
  `tt`, `error "text"` → a `logcenter` search). Global to all nodes; the
  history recalls the shortkey you typed, not the expansion. Manage them in
  **Preferences → Shortkeys**: a list with a per-row trash button and an add
  form (key + command). Power users can also type the local commands
  `shortkeys` (list), `add-shortkey key=<k> command="<template>"` and
  `remove-shortkey key=<k>` in the console — handled client-side, never sent to
  the agent. The manager was moved off the console input row so the command
  input stays full-width on mobile.
- **Answers.** Commands are sent from the shared `agent_link` service (honoring
  the inter-yuno contract), so the agent's real asynchronous answer routes back
  (not just the controlcenter dispatch ack). Table answers render on Tabulator;
  a `display_mode` toggle switches table vs raw JSON (like `ycommand`); the
  comment line under the input shows only on errors.
- **Mobile & theme.** Clear (✕) moved out of the input to its own button (no
  accidental taps); icon-only Execute on mobile; full-width help/history
  popovers; a terminal (`>_`) icon for the Console nav tab and Execute button;
  theme-aware response panes and active rows for dark mode.
- **Nodes.** Compact searchable/sortable nodes list on Tabulator with
  active-row highlight and a single search+refresh toolbar line.
- **Session.** Silent recovery after a sleep/reconnect NAK (refresh + reopen)
  instead of dropping to the login screen.
- **Developer monitor & window manager.** The avatar → **Developer** window was
  reworked (in gobj-ui) from a raw traffic dumper into a yuno-monitor console: a
  folding **bullet** traffic log, a persistent view selector (Detailed / Compact
  / Name only), direction + free-text + hide-periodic filters, per-event mute,
  and a live stats strip. Its host `C_YUI_WINDOW` got neutral theme-aware chrome
  (SVG minimize / maximize / close, mobile full-screen sheet) and now opts into a
  new **dock / taskbar** (`C_YUI_WINDOW_MANAGER`): this app creates the
  `__window_manager__` service at startup, so minimizing the Developer window
  sends it to a dock chip (`yi-terminal` icon) that restores or closes it. The
  dock is created in **responsive** mode: a floating bar pinned bottom-left on
  desktop (where the bottom is clear), and an inline taskbar row in the shell's
  free `bottom-sub` zone on mobile (the primary menu owns the `bottom` zone), so
  it never covers the menu. Detail in the gobj-ui CHANGELOG (2.1.1–2.1.9).

- **Tabulator styling is global.** Tabulator is a first-class element across the
  yunos, so its theme fixes live in the library (`@yuneta/gobj-ui/src/tabulator.css`:
  dark-theme tree control + the reusable `.yui-row-active` row highlight) rather
  than in this app's `app.css`. The Nodes active-row uses the shared
  `.yui-row-active` class.
