# gui_treedb — TreeDB GUI

A browser SPA to **browse and edit TreeDBs** (topic tables + node graphs over
timeranger2/treedb) on **multiple, user-configured Yuneta backends**, built on
the **gobj-ui V2 declarative shell** (`C_YUI_SHELL`/`C_YUI_NAV`).

## Architecture

- **Shell:** the declarative shell drives the nav; `src/app_config.json` declares
  the rail (Topics / Graphs / Settings). Views are mounted by gclass name.
- **Connections:** the user configures backends at runtime in **Settings** (an
  editable Tabulator table: `url`, `remote_yuno_role`, `remote_yuno_service`),
  persisted in browser localStorage (`C_TREEDB_CONFIG`). Each connection is
  the `C_IEVENT_CLI` entry to **one yuno** (its public wss endpoint — the wss
  API offers no cross-yuno listing). Lifecycle is explicit: transports open
  only from the row's **connect/disconnect button** (persisted `enabled`
  intent) — editing a row's coordinates disables it until reconnected, so
  typing never auto-connects — and deleting a row asks for confirmation.
  The picker (tab 0 of Topics/Graphs) selects which services to open per
  workspace.
- **Service discovery:** on the first connect of a never-scanned connection,
  `C_TREEDB_LINKS` discovers the yuno's **`C_NODE` / `C_TRANGER`** services
  automatically (one `services` command to `__yuno__`) and persists the WHOLE
  found list in the connection (`services`); the row's refresh button re-runs
  it, preserving the selection. The services render as dataTree sub-rows
  whose checkbox edits each service's `selected` flag — only selected
  services are offered in the pickers (Topics: `C_NODE` + `C_TRANGER`;
  Graphs: `C_NODE` only). Discovery failures are reported above the table.
- **Transport:** `C_TREEDB_LINKS` owns one `C_IEVENT_CLI` per connection (and
  runs the discovery — it is a named service, so command answers route back
  to it). Every discovered service lives in the connected yuno and is
  addressed directly (`kw.service`).
- **Tranger browser:** selected `C_TRANGER` services (Topics workspace only)
  open the read-only `C_TRANGER_VIEW`: topic tabs and a per-topic Keys picker
  (responsive — a moveable, non-modal window on desktop, an adaptive modal sheet
  on mobile; each key's Rows/Live button is colored only while that view is open
  and toggles it; the open/closed set is persisted per connection and cleared
  when the connection is removed). A key opens a **Rows** card — a records
  table with native remote pagination
  (`open-iterator` + `get-page`), optionally pre-filtered at open time by
  server-side **match conditions** (time / rowid range, user_flag masks) chosen
  in an options form — or a **Live** card that streams new appends (`open-rt` +
  `EV_TRANGER_RECORD_ADDED`, newest on top, no history). Per-column header
  filters accept a comparison operator (`>200`, `<=5`, `=ok`) or a plain
  substring and filter the loaded rows client-side (no polling). A row opens the
  full record JSON in the shell dialog. Requires a backend whose `c_tranger`
  exposes the iterator/rt read commands with `open-iterator` match conditions.
- **Authorization note:** the discovery addresses `__yuno__` (a `dst_service`
  beyond the connected service), and `C_IEVENT_SRV` only routes that for
  channels whose user is a **superuser** (a role with `service="*"`) or has
  roles in the target services — the same model as the gui_agent control
  plane. A non-authorized user sees the rejection in the Settings error
  panel / view banner; nothing fails silently.
- **Auth (multi-backend):** the SPA logs in once at the co-located **auth_bff**
  (BFF httpOnly cookie, same origin). Because that cookie cannot travel to a
  backend on another host, the SPA fetches the access_token from the BFF
  (`POST /auth/token`, opt-in — see yunetas `c_auth_bff.c` + `YUNO_AUTH.md §2.2`)
  and **forwards it in each `C_IEVENT_CLI` identity_card**. The connection's
  SELECTED services are advertised in the identity_card's `required_services`,
  which the backend's `C_AUTHZ` needs to authorize the treedb commands (else
  the `descs` is silently dropped); a selection change reopens the connection
  to re-send the card. Each remote backend must have the issuer JWKS
  provisioned.
- **View adapter:** `C_TREEDB_VIEW` hosts the gobj-ui `C_YUI_TREEDB_TOPICS` /
  `C_YUI_TREEDB_GRAPH` as a **named service** (so `C_IEVENT_CLI` can route their
  command answers back) and resolves the live transport by `conn_id`.
- **Graphs follow other operators' links** (`EV_TREEDB_NODE_LINKED` /
  `EV_TREEDB_NODE_UNLINKED`) — but **only if the backend publishes them**: its
  `C_NODE` service must be configured with `with_link_events` (default
  **false**). Careful, it is an either/or in the backend: with link events ON,
  a link/unlink stops publishing the parent's `EV_TREEDB_NODE_UPDATED`, so
  enabling it on a treedb that also serves a **v1** SPA changes what that SPA
  receives. With the flag off, an open Graph shows stale edges until reloaded.
- **The runtime is auditable — every action crosses an FSM.** This is a
  contract of this SPA, not an accident: a DOM click, a modal `on_close`, a
  resolved `fetch` do nothing but `gobj_send_event`; the work lives in the FSM
  action, so the `machine` trace IS the execution log. `C_TRANGER_VIEW` models
  its life as states (`ST_DISCONNECTED` → `ST_LOADING_TOPICS` →
  `ST_TOPIC_SELECTED`), so an action arriving with no topic fails LOUDLY naming
  its sender instead of no-opping a button; `C_TREEDB_CONFIG`'s **mutations are
  events** (its reads stay plain functions). Two consequences worth keeping in
  mind when extending it: a `kw` must be **plain JSON** (the trace serializes
  it — pass `{key, mode}`, never a widget or a DOM node), and widget plumbing
  that is not an action stays a plain call (Tabulator's `ajaxRequestFunc` must
  RETURN a Promise — it is a data source, not an event).

Reference implementation for the treedb-view adapter: wattyzer's `C_WZ_TREEDB`.

## Install

This project uses [`vite`](https://vite.dev/) as build tool.

Install the latest `node`:

    nvm install --lts

When writing this readme the LTS version was:

    node --version
        v22.17.0

    npm install -g vite

This project was created using:

    npm create vite@latest test -- --template vanilla
    cd test
    npm install
    npm run dev

To start Vite dev server:

    vite

To build for production:

    vite build



To preview the production build:

    vite preview

To test

    npm test
or

    npm run test:coverage

## Update js packages

ONLY one time: to update all js packages, install the module::

    npm install -g npm-check-updates

To download new releases::

    ncu -u

And to install the new versions::

    npm install

## Update app version

gui_treedb has its own version line (like gui_agent), not tied to
`YUNETA_VERSION`. `package.json` is the single source — `main.js`
(yuno identity) and the About dialog both import `pkg.version`:

    npm version 0.?.? --no-git-tag-version
