# gui_treedb — TreeDB GUI

A browser SPA to **browse and edit TreeDBs** (topic tables + node graphs over
timeranger2/treedb) on **multiple, user-configured Yuneta backends**, built on
the **gobj-ui V2 declarative shell** (`C_YUI_SHELL`/`C_YUI_NAV`).

## Architecture

- **Shell:** the declarative shell drives the nav; `src/app_config.json` declares
  the rail (Topics / Graphs / Settings). Views are mounted by gclass name.
- **Connections:** the user configures backends at runtime in **Settings** (an
  editable Tabulator table: `url`, `remote_yuno_role`, `remote_yuno_service`,
  `treedbs`), persisted in browser localStorage (`C_TREEDB_CONFIG`). Each URL
  points at a node's **agent**. The picker (tab 0 of Topics/Graphs) selects
  which services to open per workspace.
- **Node scan:** the scan button of a Settings row discovers, via that agent
  (`list-yunos` + `command-yuno command=services service=__yuno__` per running
  yuno, plus the agent's own `services`), every **`C_NODE` / `C_TRANGER`**
  service of the node; they render as dataTree sub-rows with a checkbox and
  the checked ones persist in the connection (`services`) and show up in the
  picker next to the manual `treedbs` list. Scan failures are reported above
  the table.
- **Transport:** `C_TREEDB_LINKS` owns one `C_IEVENT_CLI` per connection (and
  runs the scans — it is a named service, so command answers route back to
  it). Services of the **connected yuno** are addressed directly
  (`kw.service`); services of **another yuno of the node** go through
  `C_TREEDB_PROXY`, which wraps each command in the agent's `command-yuno`
  and re-injects the answer with the inner command's `command_stack`, so the
  hosted views keep their normal `gobj_command(gobj_remote_yuno, …)` contract
  (no realtime `EV_TREEDB_NODE_*` cross-yuno — those views refresh on
  demand).
- **Tranger browser:** selected `C_TRANGER` services (Topics workspace only)
  open the read-only `C_TRANGER_VIEW`: topic tabs + a records table fed by
  one-shot `open-list return_data=1 from_rowid=-N` reads (requires a backend
  with the restored c_tranger read commands), full record JSON in the shell
  dialog, Refresh / Load-more buttons (no polling).
- **Authorization note:** the scan and every wrapped (cross-yuno) command
  address `dst_service`s beyond the connected agent service (`__yuno__`, the
  scanned service names), and `C_IEVENT_SRV` only routes them for channels
  whose user is a **superuser** (a role with `service="*"`) or has roles in
  those services — the same model as the gui_agent control plane. A
  non-authorized user sees the rejection in the scan error panel / view
  banner; nothing fails silently.
- **Auth (multi-backend):** the SPA logs in once at the co-located **auth_bff**
  (BFF httpOnly cookie, same origin). Because that cookie cannot travel to a
  backend on another host, the SPA fetches the access_token from the BFF
  (`POST /auth/token`, opt-in — see yunetas `c_auth_bff.c` + `YUNO_AUTH.md §2.2`)
  and **forwards it in each `C_IEVENT_CLI` identity_card**. The connection's
  `treedbs` are advertised in the identity_card's `required_services`, which the
  backend's `C_AUTHZ` needs to authorize the treedb commands (else the `descs` is
  silently dropped). Each remote backend must have the issuer JWKS provisioned.
- **View adapter:** `C_TREEDB_VIEW` hosts the gobj-ui `C_YUI_TREEDB_TOPICS` /
  `C_YUI_TREEDB_GRAPH` as a **named service** (so `C_IEVENT_CLI` can route their
  command answers back) and resolves the live transport by `conn_id`.

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
