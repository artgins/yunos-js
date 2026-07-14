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
  A row can be **cloned** (same backend, new id, disabled), and the whole set
  **exported / imported** as a JSON file — nothing secret travels (the
  access_token is never stored here). An import ADDS: every connection arrives
  with a fresh id (the id is what the open tabs and Tranger views are keyed by)
  and disabled (importing a file must not open sockets).
  The picker (tab 0 of Topics/Graphs) selects which services to open per
  workspace. A connection whose backend is down is retried with a **backoff**
  (5s → 60s, jittered), not every 5s for ever.
- **Service discovery:** on the first connect of a never-scanned connection,
  `C_TREEDB_LINKS` discovers the yuno's **`C_NODE` / `C_TRANGER`** services
  automatically (one `services` command to `__yuno__`) and persists the WHOLE
  found list in the connection (`services`); the row's refresh button re-runs
  it, preserving the selection. The services of a connection are a table of
  their OWN, nested in its row, with its own header (service / class / browse)
  and only its own fields — as Tabulator dataTree children they were rows of the
  CONNECTIONS table and wore ITS columns, so a service's name landed under
  "Label" and its class and checkbox under two blank, unlabelled ones. Its
  checkbox edits each service's `selected` flag — only selected services are
  offered in the pickers (Topics: `C_NODE` + `C_TRANGER`; Graphs: `C_NODE`
  only). Discovery failures are reported above the table.
- **Transport:** `C_TREEDB_LINKS` owns one `C_IEVENT_CLI` per connection (and
  runs the discovery — it is a named service, so command answers route back
  to it). Every discovered service lives in the connected yuno and is
  addressed directly (`kw.service`).
- **Tranger browser:** selected `C_TRANGER` services (Topics workspace only)
  open the read-only `C_TRANGER_VIEW`: topic tabs and a per-topic Keys picker
  (responsive — a moveable, non-modal window on desktop, an adaptive modal sheet
  on mobile; each key's Rows/Live button is colored only while that view is open
  and toggles it; the open/closed set is persisted per connection and cleared
  when the connection is removed). The picker **searches, sorts and pages in the
  BACKEND** (`list-keys` with `rkey` / `order` / `desc` / `from` / `limit`): a
  topic with a hundred thousand keys is never transferred whole to show 15 rows.
  The search term is a plain substring, escaped into the regex the backend
  matches. Against a backend older than the paged `list-keys`, the picker falls
  back to the whole list as one page and warns that its search and paging are not
  there. A key opens a **Rows** card — a records
  table with native remote pagination
  (`open-iterator` + `get-page`), optionally pre-filtered at open time by
  server-side **match conditions** (time / rowid range, user_flag masks, and
  **newest first** — `open-iterator`'s `backward`, which indexes the key from
  its end) chosen in an options form — or a **Live** card that streams new
  appends (`open-rt` + `EV_TRANGER_RECORD_ADDED`, newest on top, no history).
  The toolbar's **Live topic** button opens a Live card on the WHOLE topic
  (`open-rt` takes an empty key as "every key"); it names the key of each
  record, which a per-key card does not need. A Live card can be **paused**
  without closing its feed — the records that arrive meanwhile are held (capped
  like the table) and flushed on resume, so pausing to read a row does not cost
  you the rows that land while you read it. Per-column header
  filters accept a comparison operator (`>200`, `<=5`, `=ok`) or a plain
  substring and filter the loaded rows client-side (no polling). A row opens the
  full record JSON in the shell dialog, with a **Copy** button; a card's
  **Export** downloads what its table HOLDS as CSV (the loaded page / the live
  buffer — not the key: a server-side dump of millions of records is not
  something this SPA can stream). A card's **Share** copies a link that
  **rebuilds it** — the URL segment carries the topic AND the card
  (`<topic>~<base64url of {key, mode, match_cond}>`, one path segment), so
  "look at key X between A and B" is a link instead of a paragraph of
  instructions; a bare `<topic>` still works and an unreadable payload degrades
  to its topic. A **column chooser** decides what the table shows — on a phone
  only the first few columns are painted, and this is the way back.
  Requires a backend whose `c_tranger`
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
  SELECTED services are advertised in **that transport's own**
  `required_services` (a per-link `C_IEVENT_CLI` attr), which the backend's
  `C_AUTHZ` needs to authorize the treedb commands (else the `descs` is silently
  dropped); a selection change recreates the connection to re-send the card.
  It is per link, not the yuno-wide attr, because that one can only be the
  UNION of every configured backend's selection — each backend would be told the
  service names of all the others. Each remote backend must have the issuer JWKS
  provisioned.

- **A session that survives the real world.** The access_token is refreshed
  before it expires, and a refresh that could not be MADE (network down, BFF
  502, request timed out) is not a denial: it retries with backoff and keeps the
  session, the shell and every open card. Only the BFF *answering* "no" logs you
  out. Because a background tab's timers are throttled — so the refresh of a
  sleeping laptop fires after the token is already dead — `visibilitychange` /
  `online` enter the FSM as `EV_WAKEUP` and refresh on the spot if the deadline
  has passed. A backend that NAKs the identity even after a fresh token is
  **rejected**: its transport is closed, its connect intent cleared, and the
  cause shown in the picker (retrying would only NAK again — it takes fixing the
  user's roles on that backend and reconnecting in Settings).
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
  its sender instead of no-opping a button. **The session is one of those
  states, and the link has two edges**: the view watches `EV_ON_OPEN` *and*
  `EV_ON_CLOSE` on `C_TREEDB_LINKS`, so a dropped backend sends it back to
  `ST_DISCONNECTED` — cards torn down but kept PERSISTED, picker closed, toolbar
  DISABLED (with no session the user actions are not declared at all, so the
  button must not be pressable in the first place) — and the reconnect returns to
  the same topic and reopens the saved cards by itself. `C_TREEDB_CONFIG`'s **mutations are
  events** (its reads stay plain functions). Two consequences worth keeping in
  mind when extending it: a `kw` must be **plain JSON** (the trace serializes
  it — pass `{key, mode}`, never a widget or a DOM node), and widget plumbing
  that is not an action stays a plain call (Tabulator's `ajaxRequestFunc` must
  RETURN a Promise — it is a data source, not an event).

Reference implementation for the treedb-view adapter: wattyzer's `C_WZ_TREEDB`.

## i18n

Every text goes through i18n **and must be able to change language**: see
gobj-ui's README ("Conventions → i18n") for the full contract. In this SPA:

- The switch is the shell's: `C_TREEDB_APP` switches i18next and calls
  `yui_shell_language_changed(shell)`, which re-translates the document and
  publishes `EV_LANGUAGE_CHANGED`. Every view that builds DOM imperatively (the
  picker, Settings, the Tranger cards, and gobj-ui's own treedb views)
  subscribes to the shell and re-renders **in its action** — a Tabulator header,
  a paginator or anything a formatter paints is drawn ONCE and no `data-i18n`
  attribute can reach it.
- `npm run validate-locales` (a `prebuild` step, so it breaks the build) enforces
  four rules: keys are ASCII + lower-case, the locales are symmetric, **no
  duplicate key** in a file (an object literal keeps the last one and says
  nothing), and **every key the source uses is defined** — including the ones the
  **gobj-ui views this app mounts** ask for, because the library translates
  through THIS app's i18next. A key it asks for and this app does not define
  renders as the raw key, in every language.


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

The suite covers `src/tranger_helpers.js` — the PURE part of the tranger
browser (record → table row, epoch ↔ local wall clock, the header-filter
grammar). It lives apart from the gclass precisely because that is where the
view's real traps are — the two time axes (`t` persistence vs `tm` message
origin), the two time units (seconds vs `sf_t_ms` milliseconds), a record free
to carry its own field named like a metadata column — and there a test can
reach them with no DOM, no Tabulator and no websocket.

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
