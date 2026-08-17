# gui_agent — Yuneta Agent Console

A web SPA (single-page app) to operate yuneta **agents** from the browser,
built on the **v2 declarative shell** of `@yuneta/gobj-ui`
(`C_YUI_SHELL` + `C_YUI_NAV`).

It is the modern successor of the old webix "Yuneta CLI"
(`yuno_gui/v2/.../ui_yuneta_cli.js`). **Four workspaces** in the primary rail,
and all four are WORK: **Commands** (control-plane CLI to a node's yunos),
**Statistics** (live `SDF_RSTATS` counters as cards), **Terminal** (an
interactive xterm.js PTY console) and **Schemas** (edit the schemas a yuno
keeps in its `treedb_system_schema`). The preferences page is not a rail item:
it hangs off the toolbar avatar as the route **`/preferences`** (a route, not a
dialog — linkable, F5-proof, in the site map). **Commands** and **Terminal** share
one pattern — a flat node-picker tab (`C_NODES`) plus one closable tab per
selected node. **Statistics** and **Schemas** differ: their picker is a
**nodes→yunos tree** (`C_STATS_NODES`) where you select *yunos*. Statistics
renders their counters as **cards** (one tab for all cards by default, or a tab
per yuno — a Preferences toggle); Schemas opens one editor tab per yuno.
Commands/Statistics/Schemas list only agents **≥ 7.7.0**; Terminal works on any
version. Browsing the DATA of an application treedb lives in the separate
**`gui_treedb`** SPA; what is here is SCHEMA editing, because applying a schema
change means restarting the owning yuno and that is the agent's job.

**Where it is served:** one build serves every tenant and both agent planes,
because the deployment identity is **derived from the serving hostname**
(`src/conf/deploy.js`) — never baked in:

| Host | Plane | Control center | Auth BFF |
|---|---|---|---|
| `artgins.yunetacontrol.com` | `yuneta_agent`   | `wss://<host>:1996` | `https://<host>:1806` |
| `artgins.yunetacontrol.ovh` | `yuneta_agent22` | `wss://<host>:1997` | `https://<host>:1807` |

`deploy-com.sh` / `deploy-ovh.sh` rsync `dist/` to each vhost on `artgins.com`.
Everything is co-located on the SPA's own host, which is what makes the flow
work: the cookie the BFF sets (`Domain=<host>`) reaches both the BFF and the
control center, and one letsencrypt cert covers all of it. A new tenant is a
new DNS name + cert + a redirect URI in the IdP — no rebuild.

## Key design choice: no private data in the repo

The app ships **no endpoints and no credentials**. The control-center and BFF
URLs come from the hostname (above); *Preferences → Diagnostics* only
**displays** the resolved pair, read-only. What the browser persists is the
operator's own state — theme, language, answer display mode, navigation mode,
Statistics layout and refresh, selected nodes per workspace, the last-active
tab, the command history and the shortkeys — as **gobj persistent attrs** on
the `agent_config` service (`db_save/load_persistent_attrs`, wired in
`src/main.js`, backed by `localStorage`).

> **CSP note:** `config.json` → `csp_connect_src` is a **build-time** security
> boundary: the browser only allows WebSocket/HTTPS connections to what is
> listed there. Because the host decides the endpoints, the list is the
> `wss:` and `https:` **schemes** rather than an origin allowlist (plus
> `ws://localhost:1991` for dev). Narrowing it to explicit origins would mean
> one build per tenant.

## Library consumption (v2)

Both kernel JS packages come from the **npm registry**, the same way wattyzer
consumes them — not from the `kernel/js/*` submodule checkouts:

```
@yuneta/gobj-js ^7.10.0     (publishes only dist/ → resolved to its bundle)
@yuneta/gobj-ui ^5.14.1     (v2 / main line; imported as SOURCE by specifier,
                             @yuneta/gobj-ui/src/*.js via its exports map)
```

This is the v2 (`main`) line — **not** the published npm v1 used by
estadodelaire/hidraulia.

**A local edit under `yunetas/kernel/js/**` does not reach this app.** To pick
up library work: commit + bump + `npm publish` there, bump the submodule
pointer in yunetas, then raise the range in `package.json`. Every shared
third-party lib must also stay in `resolve.dedupe` (`vite.config.js`) — gobj-ui
declares them as peers and npm will otherwise nest a second copy.

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

## Schemas: the treedb views over the agent's control plane

The Schemas workspace mounts gobj-ui's treedb editor (`C_YUI_TREEDB_TOPICS`)
**unchanged**, pointed at one treedb of one yuno. It opens the yuno's
`treedb_system_schema` — the treedb where every schema of that yuno lives as
data (`treedbs` → `topics` → `cols`). Editing it there is how a schema changes
without touching the C literal; the change reaches the yuno on its next restart
(`kill-yuno` + `run-yuno`).

**Which treedbs a yuno has is discovered, not assumed.** A yuno exposes them as
services, so one round trip answers it —
`command-yuno id=<yuno> service=__yuno__ command=services` — and the `C_NODE`
rows are the treedbs this console can talk to. They fill a selector in the tab
toolbar, `treedb_system_schema` first and selected; picking another one tears
the mount down (view **and** adapter, so no answer of the old one lands in the
new table) and builds a fresh one. The others are offered because an operator
already on the node should not need a second SPA and a second session to look
at the data — `gui_treedb` remains the browser for someone whose job is the
data itself.

Discovery also answers what the tab could not ask before: a yuno with **no**
treedb (a gate, a yuno with only a timeranger) says so, instead of mounting a
view that answers with an error toast per topic. The **picker** says it too:
expanding a node in the Schemas tree probes each of its yunos with the same
`services` call and marks the ones that expose no treedb — status column and
checkbox off, so a dead end is visible before a tab is opened. It is one round
trip per yuno, which is why it runs on EXPAND and only in this workspace; a
probe that fails or has not answered leaves the row untouched, because
"could not ask" is not "has none". The tab's states say which
screen you are on: `ST_IDLE` (no yuno, or no session), `ST_DISCOVERING`,
`ST_EMPTY`, `ST_READY`.

The piece that makes it work is `C_AGENT_TREEDB_LINK`, a **routing adapter**.
The library view talks to a "remote yuno" with `gobj_command(...)` and expects
`EV_MT_COMMAND_ANSWER` back — one hop with a direct `C_IEVENT_CLI`. From this
console the treedb is two hops away, so the adapter implements
`mt_command_parser` (which `gobj_command()` dispatches to before anything else),
re-wraps each command as

```
command-agent agent_id=<node>
    cmd2agent="command-yuno id=<yuno> service=<treedb> command=<the command>"
```

and hands the answer back in the shape the view already understands.
`C_AGENT_TREEDB` is the tab: it creates the adapter, mounts the view with
`yui_mount_service_view()` (transport = the adapter), and waits for the session
before mounting, because the view fetches its schema in `mt_start` and a second
fetch would build a second set of topic services.

Three things the adapter is built around, all of them scars:

- **`command-yuno` uses its WHOLE kw as the filter that selects the yuno.** Keys
  that are columns of the agent's `yunos` topic filter it; the rest travel
  through untouched. So `treedb_name` / `topic_name` / `record` / `options` are
  safe, and a top-level `id` is not — it would name the yuno. The adapter
  refuses that request loudly instead of letting it come back "Yuno not found".
- **The controlcenter's `command-agent` deletes id/command/service from the kw**
  before forwarding, which is why they travel inline in the `cmd2agent` line.
- **Routing loses the live subscriptions.** `command-yuno` is
  request/response, so the treedb's `EV_TREEDB_NODE_*` never arrive. A schema
  does not change under you, so the cost is small; for its own writes the
  adapter echoes the matching node event locally, so the table reflects a save.

**Applying is restarting.** An edited schema reaches the yuno when it re-reads
it, so the tab's **Apply** button runs `kill-yuno` → `run-yuno play=0` →
`play-yuno` on the owning yuno, after a confirmation that names it and says
that every client connected to it is disconnected. Each of those commands
answers only when it is DONE — the agent waits for the killed yuno's channel to
close, and for the launched one to connect back — so the sequence is chained on
those answers, with no timer and no polling, and ends by re-discovering, which
re-mounts the view against the schema the yuno has just read. A write in this
tab marks the button until the next apply.

`play=0` is deliberate: with the implicit play, `run-yuno` answers twice and a
step that answers twice advances the sequence twice.

⚠️ **The node's agent must carry the `ac_final_count` fix** (SDK, this release).
Older agents drop the answer of those four commands for any client behind a
controlcenter — the work is done, the answer is lost. The tab gives up after
30 s and says so, but after a `kill` that means the yuno is DOWN and stays
down. Deploy the agent before using Apply on a node.

**Permissions are the yuno's, not the console's.** The commands run inside the
target yuno with the logged-in identity, so reading a topic needs the `read`
authz of its `C_NODE` (and `create`/`update`/`delete` to edit) in **that yuno's**
`C_AUTHZ`. A user without it gets `-403 No permission to 'read' in service
'…'` as a toast per topic, and empty tables.

**The URL carries the position.** Under a tab's route the subpath is
`<treedb>[/<topic>[/info]]` (or `<treedb>/schema`), so a reload, a browser Back
or a link shared with a colleague lands on the same treedb and topic. The first
segment is the tab's — changing it is a remount — and the rest is the hosted
view's, which routes its own topics because it is mounted with `base_route` =
`<tab route>/<treedb>`: the card icons and the landing toggle are real hash
anchors it builds itself.

Two conventions that bite when mixed up: `base_route` is a **route** (what the
shell matches and the site map lists), while the card/landing templates are
**hrefs** and must carry the `#` — without it the anchor leaves the SPA on
click. And the mount stamps its treedb into the URL with `push: false`: nobody
navigated there, so it must not become a Back entry.

## Every action crosses the FSM

A DOM handler in this app does exactly two things: whatever the browser needs
synchronously (`preventDefault`, `stopPropagation`, keeping the xterm focused),
and `gobj_send_event`. The work lives in the action. That is not style — the
`machine` trace is the execution log of a yuno, so an action that bypasses the
automaton is invisible when something breaks, and the only way left to chase it
is WebSocket traffic and screenshots.

Concretely, in every view: buttons, keys that mean something, `<select>`
changes, the outside-click that closes a popover, and the observers that tell a
tab it was revealed or hidden. Two supporting rules:

- **A `kw` is plain JSON.** The trace dumps it, and a gobj / widget / DOM node
  is circular — serializing one throws, so the first casualty is the trace the
  FSM exists to feed. Pass an identity (`{node, yuno_id}`, `{seq}`, `{kind}`)
  and resolve it inside the action.
- **A deferral is a posted event, not a `setTimeout(…, 0)`** — `gobj_post_event`
  arrives named in the trace. A `C_TIMER` is for a real time (a watchdog, an
  interval); `set_timeout_periodic` gives the auto-refresh tick its own
  `EV_TIMEOUT_PERIODIC`, which the `timer_periodic` trace level silences on its
  own.

Two deliberate exceptions, both commented where they live: xterm's `onData`
(a byte stream, not an action — one event per keystroke would bury the tab's
trace under the typing) and Tabulator's `ajaxRequestFunc` (a data source that
must return a Promise). Where the browser needs an answer the action cannot
give — Tab completion deciding `preventDefault` — the action reports through
`priv` and the handler reads it back.

## i18n

Every text goes through i18n **and must be able to change language** (the full
contract is in gobj-ui's README, "Conventions → i18n"). Here: the Preferences page
switches i18next and calls `yui_shell_language_changed(shell)`, and the views
that build DOM imperatively — the three Tabulator tables above all — subscribe
to the shell's `EV_LANGUAGE_CHANGED` and re-render in their action. A `title`
needs `data-i18n-title`; a fresh nav submenu needs a `refresh_language()` after
`yui_shell_set_submenu` (without it the node tabs render the RAW KEY);
Tabulator's own chrome goes through `yui_tabulator_lang()`.
`npm run validate-locales` runs on every build and fails on a duplicate key or a
key used and not defined.


## Build & run

```bash
cd yunos/js/gui_agent
npm install
npm run dev        # vite dev server
npm run build      # production bundle into dist/
```

## Roadmap

The phased build-out is **done**: scaffold (shell + nav), the Commands console,
BFF/OIDC authentication, live Statistics, the PTY Terminal and the Schemas
editor all ship. What is open:

| Open item | Note |
|---|---|
| **Operating yunos from the GUI** | The agent's own job — `kill-yuno` / `run-yuno` / `play-yuno`, binaries, configs, snaps — is reachable only by TYPING into Commands. The one exception is the Schemas tab's *Apply*, which drives the restart itself. A workspace over the existing nodes→yunos tree is the natural home. |
| **Time-series charts** | `C_YUI_UPLOT` over the live `SDF_RSTATS` counters the Statistics cards already poll. |
| **Statistics *Reset* on app gclasses** | `stats-yuno stats="__reset__"` only lands where the gclass honours it; counters kept in private fields behind `mt_reading` need their own `mt_stats(__reset__)`. Backend work, not a GUI bug. |
| **Terminal key bar on iOS / old Android** | Browsers without `interactive-widget=resizes-content` still overlay the on-screen keyboard; the bar needs pinning to `visualViewport` there. |

## Status

**Live**, restructured into **four primary workspaces** — **Commands**
(`C_AGENT_CONSOLE`), **Statistics** (`C_STATS_NODES` tree picker +
`C_AGENT_STATS` cards), **Terminal** (`C_AGENT_TTY`, xterm.js over the agent
PTY), **Schemas** (`C_STATS_NODES` tree picker + `C_AGENT_TREEDB`, the gobj-ui
treedb editor over the routing adapter). Preferences left the rail for the
avatar menu (`/preferences`). **Commands** and **Terminal** share the flat pattern: a
node-picker tab (`C_NODES`) plus one closable tab per selected node.
**Statistics** picks **yunos** from a nodes→yunos tree and shows their
`SDF_RSTATS` counters as **cards** — a single tab holding all cards (default)
or a tab per yuno (Preferences toggle "Statistics cards"). The cards **auto-refresh**
(default 2 s, Preferences; a deliberate opt-in exception to Yuneta's no-polling
rule, visible-tab only) and **highlight** any counter that changed since the last
refresh. Commands/Statistics require agent **≥ 7.7.0**; Terminal works on any
version (needs the `open-console` authz — an admin role). **Schemas** picks
yunos the same way Statistics does and opens one treedb-editor tab per yuno,
routed through `C_AGENT_TREEDB_LINK` (see the section above); each tab
discovers that yuno's treedbs and declares them as a **tree of nodes**
(`C_YUI_NODE` rooted at the tab's route, one `link` child per treedb whose
viewer is `C_AGENT_TREEDB_VIEW`), `treedb_system_schema` first; how that depth
is drawn — stacked strips, a "← yuno", or a breadcrumb — is the operator's
choice in **Preferences → Navigation** and applies to the open tabs live.
Selecting a tab focuses
its input (Commands) / xterm (Terminal); node tabs carry a green/red connection
dot; the last-active tab is remembered per workspace. Commands and Terminal both
carry a per-tab **font-size** control (temporary) over a shared default set in
Preferences. Browsing the DATA of an application treedb is **not** part of this app
— that is the separate `gui_treedb` SPA; what lives here is schema editing. Time-series charts
(`C_YUI_UPLOT`) over the live counters are a possible follow-up. See the
`CHANGELOG.md` (repo root) for the per-cycle detail.

## Changes

This yuno is JavaScript and deploys independently of the SDK (see
`deploy-com.sh`). The per-release detail lives in this repo's own
`CHANGELOG.md` (repo root); this section keeps the durable, feature-level
summary.

### 0.6.0

- **Configurable console font size.** The Commands response pane
  (`CONSOLE_RESPONSE_TEXT`) gained the size control the Terminal already had:
  the `CONSOLE_STATUS_ROW` holds **A− / [N px] / A+** buttons that nudge **this
  console's** live size — TEMPORARY and per-console, never persisted, so
  reopening the tab returns to the default. The shared DEFAULT is a "Console
  font size" stepper in **Preferences**, persisted in
  `localStorage["console_font_size"]`, clamped to [8, 28] (default 12); each
  console seeds its live size from it on (re)open.
- **Command history is one shared list across all nodes.** The store was
  already global (`agent_config.cmd_history`), but each per-node console kept
  the snapshot taken at open and persisted *that* on every add — so a command
  run in one node clobbered history added from another (last-writer-wins) and
  already-open consoles never saw each other's commands. Every point of use now
  re-syncs from the shared store first (`sync_history_from_store`: add, remove,
  recall start, history-popover open), so adds merge onto the latest global
  list and Up/Down + the popover in any node reflect commands run in every
  other node.

### 7.7.0 cycle

- **Terminal mobile key bar.** A phone's on-screen keyboard has no Esc / Tab /
  Ctrl / arrow / Home-End keys, so on mobile the PTY console couldn't complete
  (Tab), walk history (↑ ↓), edit the line (← →) or interrupt (^C) — everything
  works on desktop, where physical keys already reach `onData`. `c_agent_tty.js`
  shows a two-row accessory bar (`is-hidden-tablet`, so desktop is unaffected)
  at the **top** of the card, under the toolbar: **^C | / - _ Home End Paste**
  over **Kbd Esc Tab Ctrl ← ↑ ↓ → ↵**, each key injecting the exact byte
  sequences through the same `send_keys` path (Enter ↵ is double-width with an
  enlarged glyph). **Ctrl** is a sticky modifier — arm it, then the next key
  (bar or soft keyboard) is sent as its control byte. **Kbd** toggles the
  browser soft keyboard, which is **opt-in** (`inputmode="none"` on xterm's
  hidden textarea): tapping the terminal focuses it without summoning the
  keyboard, so the whole screen stays for output until you ask to type; a
  tablet rotated past the Bulma breakpoint (bar hidden) restores normal input
  mode. **Paste** reads the clipboard (user gesture + permission; ✗ on denial)
  into the PTY via `term.paste()`. Buttons fire on `pointerdown` +
  `preventDefault`, so the xterm keeps focus. The viewport meta declares
  `interactive-widget=resizes-content`, so the on-screen keyboard shrinks the
  layout viewport and the terminal reflows above it. _Follow-up: browsers
  without `interactive-widget` support (older Android WebViews, current iOS
  Safari) still overlay — pin the bar to `visualViewport` there._
- **Terminal refit on resize (client-only).** The xterm was fit once at open
  and frozen: resizing the browser window or the devtools pane clipped the
  prompt out of view (xterm's scroll moves its buffer, not the DOM). A
  `ResizeObserver` on the host refits on every change — devtools/window
  resize, keyboard open/close, rotation — re-pinning the viewport to the
  prompt when it was following the bottom. The node PTY geometry stays
  **frozen** at `open-console`, the same contract as a native terminal running
  ycommand (a `resize-console`/SIGWINCH path was built and removed the same
  cycle in favour of this browser-only fix).
- **Terminal touch scrolling (mobile).** xterm has no touch scrolling: touches
  land on `.xterm-screen` (canvas) whose scrollable `.xterm-viewport` is a
  sibling, not an ancestor, so a finger drag scrolled nothing and Android
  turned it into pull-to-refresh. `tty_touch_scroll.js` owns the drag
  (`preventDefault` + `term.scrollLines()`, natural direction, sub-row deltas
  accumulated) and suppresses the native long-press menu (Translate/Cut/…)
  while a touch is in flight. An earlier long-press word-selection +
  Copy/Paste bubble fought that native UI and was removed; mobile paste is
  the key bar's Paste key, desktop selection/right-click stay native.
- **Commands input row on top + smart history.** `CONSOLE_INPUT_ROW` (+ its
  typing hint) moved to the top of the card (popovers open downward now). The
  history is **deduped** `{cmd, count, last}` (a re-run bumps the counter and
  moves the entry to the front, so ↑/↓ never repeats; the legacy plain-string
  format is normalized on load). The history popover sorts by **Recent** or
  **Frequent** (choice persisted in the browser) and each row shows ×N plus
  two actions: **+** preloads `add-shortkey key= command="<cmd>"` with the
  caret on `key=` (name it, Enter — the existing local command creates the
  shortkey), and **✕** deletes the entry from the persisted history.
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
- **Account menu + adaptive dialogs.** The account (avatar) menu holds
  **Preferences** first (the `/preferences` route — it went back to the menu
  when the rail was reserved for the four workspaces), then Developer,
  **Site map**, **About** and Sign out. **About** opens as the standardized gobj-ui
  **adaptive dialog** (2.1.12): a centered card with the close **X top-right** on
  desktop, a full-screen sheet with a **back arrow top-left** on mobile; the popup
  backdrop was lightened (2.1.13). App at **0.2.0**.

### 7.6.8 cycle

- **Statistics (tree picker + cards).** The Statistics workspace picker is a
  **nodes→yunos tree** (`C_STATS_NODES`): each node (`list-agents`, ≥ 7.7.0)
  expands to its running yunos (`list-yunos` per node), and a checkbox on a yuno
  row selects it. Selected yunos' `SDF_RSTATS` counters render as **cards**
  (`C_AGENT_STATS`, `stats-yuno id=<yuno>`) — a single tab holding a card per
  selected yuno (default), or a tab per yuno (Preferences toggle). Fetches are
  tagged `console_purpose` + `console_node` + `console_yuno` (echoed in
  `__md_iev__`, [[md_iev round-trip]]) so each answer updates exactly its own
  card and other panels ignore it. Integer counters get fixed "." grouping
  (Intl-free — the `navigator.language` crash landmine). The cards **auto-refresh**
  on a timer (default 2 s, Preferences "Auto-refresh stats", 0 = off; a deliberate
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
  instead of dropping to the login screen. A **transient** BFF outage during a
  token refresh (unreachable / 5xx, e.g. while a node reboots) is likewise
  ridden out: the session, shell, link and open views are kept and the refresh
  retries with backoff (5s→60s) — only a real denial (4xx / `success:false`)
  logs out. Mirrors the design gui_treedb already had.
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
