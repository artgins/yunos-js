# gui_agent — Yuneta Agent Console

A web SPA (single-page app) to operate yuneta **agents** from the browser,
built on the **v2 declarative shell** of `@yuneta/gobj-ui`
(`C_YUI_SHELL` + `C_YUI_NAV`).

It is the modern successor of the old webix "Yuneta CLI"
(`yuno_gui/v2/.../ui_yuneta_cli.js`). Three panels: the control-plane **CLI
to the agent** (multi-node tabs), the **Nodes** list, and **live Stats** of a
yuno. TreeDB browsing lives in the separate **`gui_treedb`** SPA, not here.

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

**Phases 1–3 shipped.** The multi-agent Console (`C_AGENT_CONSOLE`), the Nodes
list, and live Stats (`C_AGENT_STATS`) are live against the controlcenter over
`wss`+OAuth2. TreeDB is **not** part of this app — it is the separate
`gui_treedb` SPA. Time-series charts (`C_YUI_UPLOT`) over the live counters are
a possible follow-up. See **Changes** below.

## Changes

This yuno is JavaScript and deploys independently of the SDK (see
`deploy-com.sh`), so its changes live here rather than in the top-level
`CHANGELOG.md`.

### 7.6.8 cycle

- **Live Stats (`C_AGENT_STATS`).** A new primary panel (`/stats/live`): pick a
  node (all connected agents) and one of its running yunos, and see that yuno's
  `SDF_RSTATS` counters as a searchable/sortable table. All three steps ride the
  shared `agent_link` over `command-agent` — `list-agents` (nodes),
  `list-yunos` (yunos), `stats-yuno id=<yuno>` (counters, a flat `{stat: value}`
  object). The view's own fetches are tagged `console_purpose="stats"` (echoed
  back in `__md_iev__`, [[md_iev round-trip]]) so the Console ignores them and
  vice-versa. No polling — the table refreshes on selection change and the
  Refresh button. Number formatting stays Intl-free (the `navigator.language`
  crash landmine), so `C_YUI_UPLOT` charts are deferred.
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
