# gui_treedb — TreeDB GUI

A browser SPA to **browse and edit TreeDBs** (topic tables + node graphs over
timeranger2/treedb) on **multiple, user-configured Yuneta backends**, built on
the **gobj-ui V2 declarative shell** (`C_YUI_SHELL`/`C_YUI_NAV`).

## Architecture

- **Shell:** the declarative shell drives the nav; `src/app_config.json` declares
  the rail (Topics / Graphs / Settings). Views are mounted by gclass name.
- **Connections:** the user configures backends at runtime in **Settings** (an
  editable Tabulator table: `url`, `remote_yuno_role`, `remote_yuno_service`,
  `treedbs`), persisted in browser localStorage (`C_TREEDB_CONFIG`). The picker
  (tab 0 of Topics/Graphs) selects which treedbs to open per workspace.
- **Transport:** `C_TREEDB_LINKS` owns one `C_IEVENT_CLI` per connection.
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
