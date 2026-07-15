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

- **feat(gui_treedb): topics open as a cards landing (list → detail).** The
  Topics workspace now opens on a grid of topic cards; clicking a card opens
  that topic's table (with the tabs bar for quick switching and a back-to-grid
  button). Enabled by passing gobj-ui's new `C_YUI_TREEDB_TOPICS`
  `with_cards_landing` when the hosted view is the topics view; the host
  (`C_TREEDB_VIEW`) drops the `<topic>` URL segment on back so a reload
  re-lands on the grid, while a deep-linked topic URL still opens straight into
  its table.

- **feat(gui_agent): clear (✕) on the shortkey add-form inputs.** The "key" and
  "command template" text inputs of the account view's shortkey editor now carry
  the standard `attach_clear` ✕ (the same norm as the nodes/stats search boxes),
  handy on mobile. Pairs with the gobj-ui rollout that makes the clear the norm
  on every editable text field.

- **fix(gui_treedb): keep the selected period granularity when switching the
  Rows time axis.** In the Rows-options dialog the `t`/`tm` axis toggle
  (`TRANGER_OPT_AXIS`) re-derived the picker mode from the *target* axis's own
  match conditions, so switching clocks on a fresh card snapped the
  `YUI_PERIOD_MODES` selection back to "All". The chosen granularity is now
  preserved and re-resolved against the new clock — pick "month" on `t`, switch
  to `tm`, and it stays "month" (the anchor is stored in milliseconds,
  independent of the axis unit); the two inputs follow the picker's re-resolved
  bounds rather than carrying the other clock's numbers. Same fix incidentally
  stops a language switch from resetting the selected period. Reopening a
  filtered card still restores the mode it was filtered by.

- **chore(gui_treedb): drop the unused "tree json" locale keys.** The treedb
  "Tree JSON" button was removed from gobj-ui before release; the en/es keys
  that fed it are gone.

- **fix(gui_treedb): disable the tranger view's "Raw JSON" button off-session.**
  `EV_OPEN_JSON` is declared only in `ST_TOPIC_SELECTED`, but the button was
  left out of `set_toolbar_enabled`, so it stayed clickable in
  `ST_DISCONNECTED` / `ST_LOADING_TOPICS` — a click there raised a loud
  *"Event NOT DEFINED in state"*. It now follows the same session/topic gating
  as the Keys and Live buttons.

- **feat(gui_treedb): forward transport edges to the hosted treedb view.**
  `C_TREEDB_VIEW` now also watches `treedb_links` `EV_ON_CLOSE` (not only
  `EV_ON_OPEN`) and forwards both edges to its hosted view as
  `EV_TRANSPORT_STATE {connected}` — but only if the view declares it
  (`gobj_has_event` guard), so the self-managing `C_TRANGER_VIEW` is skipped.
  This is what lets the library views (topics/graph) disable their JSON
  viewers the moment the backend session drops and re-enable on reconnect.

- **fix(gui_treedb): stop the C_YUI_JSON viewer before destroying it.**
  `C_TRANGER_VIEW` destroyed the still-running Raw-JSON viewer gobj on close,
  so `gobj_destroy()` raised the `destroying` flag before it could stop it —
  logging *"Destroying a RUNNING gobj"* + *"gobj NULL or DESTROYED"* every
  time. Now stops first (dismiss and teardown paths). Companion to the same
  fix in gobj-ui's treedb views.

- **feat(gui_treedb): "Raw JSON" viewer in the tranger view.** `C_TRANGER_VIEW`
  gains a toolbar button that opens the connected C_TRANGER service's whole
  tranger in the new `C_YUI_JSON` lazy tree viewer (moveable window on desktop,
  adaptive modal sheet on mobile): the first `print-tranger` is collapsed, then
  the viewer drills in on demand (`EV_EXPAND_PATH` -> `print-tranger path=...`).
  main.js registers C_YUI_JSON; en/es locales gain the new keys. (The treedb
  Raw JSON buttons live in gobj-ui's C_YUI_TREEDB_GRAPH / _TOPICS.)

- **fix(gui_treedb): the custom range was unreadable on a phone.** Its two
  columns carried `is-mobile`, the class that keeps columns side by side below
  769px — half of a 360px screen leaves a `datetime-local` 176px wide, and the
  native control silently CLIPS: the field read `07/15/2026, 06…`, with the
  time (the whole point of a custom range) cut off, in both `from` and `to`.
  They now stack on a phone (352px each, `06:03:42 PM` fully visible) and stay
  side by side from tablet up. The rowid/mask inputs keep their two-up grid —
  a number does fit in half a phone.

- **fix(gui_treedb): the Rows options headers take one line, not two.** Each
  of the three cards stacked its title over its subtitle (`is-block` on a
  `.card-header-title`, which is a flex row to begin with) — three wasted lines
  above a dialog that scrolls on a phone. They now sit side by side, wrapping
  only if the screen is too narrow for both.

- **feat(gui_treedb): the Rows time picker gains "Month".** The granularity
  strip was hour/day/week/year — for a key holding a month and a half of
  data, the natural unit between week and year was the one missing. The
  rolling windows ("Last 24h" / "Last 7 days") that shipped alongside it in
  the same unreleased range were dropped again before release: in THIS use
  case they are redundant (day and week already answer the question) and a
  rolling window is not a bucket — it leaves the upper bound open, so a card
  re-filtered from one restores as "custom". C_YUI_PERIOD still offers them
  to any app that declares them. Rides the gobj-ui period polish
  (overflow-menu dismiss, app-language calendar, week-number gutter, bucket
  hover-preview, strip edge fades, and the phone-scroll fix that the longer
  strip exposed).

- **fix(gui_treedb, gui_agent): review follow-ups on the tranger/i18n series.**
  Findings of a full review of the range, each verified in code:
  - **gui_agent: the toolbar language toggle reaches the tables again.**
    91bf3e2 moved Nodes/Stats/Console off their raw `i18next.on` listeners
    and onto the shell's `EV_LANGUAGE_CHANGED`, but only the account view
    called `yui_shell_language_changed()` — the toolbar item did a bare
    `refresh_language()`, so the Tabulator chrome (headers, paginator,
    placeholders) stayed in the old language. The toolbar action now fans
    out through the shell too, and `c_agent_stats` — the one view still on
    a raw `i18next.on` listener — was migrated to the shell event + FSM
    action, closing out what 91bf3e2 started.
  - **gui_treedb: the "old backend" fallback of the Live cards was dead
    code.** The subscription filters by `{rt_id}`, and `kw_match_simple`
    answers no-match when the filter's key is absent from the kw — so a
    publish without `rt_id` never reached the action and the topic+key
    fallback branch was unreachable. It is REMOVED (with the misleading
    comment): no released backend can send one anyway — `open-rt` and the
    `rt_id` field shipped together, and a backend without them refuses
    `open-rt` itself, which the card surfaces as the command error.
  - **gui_treedb: a dead session sweeps the transient dialogs.** The Rows
    options (and the record/columns dialogs) survived `EV_ON_CLOSE` as
    zombies: every control kept sending events into `ST_DISCONNECTED`,
    where they are (rightly) not declared. They now close with the session
    — and their composed titles (`key · rows`), which no `data-i18n` can
    re-translate, re-compose on `EV_LANGUAGE_CHANGED` (the mobile Keys
    sheet's too), as does the long-lived error banner.
  - **gui_treedb: the Keys picker count no longer inflates.** A physical
    append is DELIVERED once per feed alive on its key (a per-key card +
    a whole-topic card = two deliveries), and `bump_key_count` counted
    every delivery: dedupe by the record's `rowid` watermark, per key.
  - **gui_treedb: a reopen during `ST_LOADING_TOPICS` re-asks `topics`.**
    It fell through to the re-arm path: toolbar enabled with no topic
    selected, and a `topics` answer lost to the flap wedged the view.
  - **both logins: `ST_WAIT_TOKEN` drops the leftovers of a session logged
    out an instant ago** (a refresh / `/auth/token` fetch in flight when
    the user logs out and re-submits within its latency), exactly as
    `ST_LOGOUT` does — they used to raise *"Event NOT DEFINED in state"*.
  - **gui_treedb: a stale discovery cannot land after logout** — the
    deferred `EV_STORE_SCANNED_SERVICES` of `finish_scan` now checks its
    connection is still open (a logout's close-all fits in the deferral's
    one-macrotask window), so `EV_CONNECTIONS_CHANGED` cannot reach
    `ST_LOGGED_OUT`.
  - **gui_treedb: applying match conditions on a dead link no longer
    desyncs memory from persistence** — the card's `match_cond` is only
    replaced once the new iterator actually armed.
  - Copy feedback: two copies inside the 1.5 s window left the first
    button stuck on "Copied" forever; the pending feedback is restored
    before the new one paints, and `EV_COPY_DONE`/`EV_COPY_RESET` are
    declared in every state (they are async: a session can drop inside
    the window). The gui_agent pre-shell "reconnecting" notice is now a
    composer the login language toggle re-runs. The Settings
    "Add connection" button carries its icon + mobile-hidden label like
    its row siblings. `npm test` runs `vitest run` (no watch mode).

- **feat(gui_treedb, gui_agent): every popup instance carries a logical
  name.** (Backfilled entry: shipped earlier in this range as b46bc59 +
  eefd348 without a changelog line.) The shell modals/windows accept a
  `logical_class`, and both SPAs name every popup they open
  (`TRANGER_ROWS_OPTIONS`, `TRANGER_KEYS_SHEET`, `SETTINGS_*`, …), so the
  Inspector says WHICH dialog a node belongs to.

- **feat(gui_treedb): the Rows options pick a PERIOD, not two timestamps.** The
  time range of a Rows card was two `datetime-local` inputs per axis plus a row
  of preset buttons — the user had to type two instants that agreed with each
  other, and "the week before last" meant doing calendar arithmetic by hand.
  The dialog is now TWO cards — **Time** and **Rows and flags**. There is ONE
  date gadget, not one per axis: a record carries two timestamps but nobody asks
  "stored last week AND reported in march", so the axis is CHOSEN (`t` · stored /
  `tm` · happened) and the single navigator is re-aimed at it — its unit (a topic
  may keep `t` in seconds and `tm` in milliseconds), the extent the key covers on
  that clock, and the conditions of the card being edited. Only the chosen axis
  reaches the iterator; a leftover range on the abandoned clock would quietly cut
  the answer down.

  Pick a granularity (All · Hour · Day · Week · Year), then walk it with a big
  `|< < LABEL > >|` row (which STAYS, greyed out, in the modes with nothing to
  walk — vanishing, it re-flowed the card under the cursor on every click).
  Reopening a card's options brings back exactly what it was opened with: the
  axis, the granularity and the range. The label says where you are in words ("Yesterday",
  "This week", "Week 27", "July", "2025") and opens a calendar; under it, the
  two timestamps it resolves to. `|<` / `>|` jump to the oldest / newest records
  the key holds — its real extent bounds the navigator, so an arrow that could
  only paint empty buckets is greyed out, and a period that falls outside the
  key says so ("the key has no records in this period") BEFORE you open an empty
  card.

  Nothing was lost, and there is no "Custom" mode: the **from/to inputs are
  always on screen, and they ARE the answer**. A granularity FILLS them ("Week"
  → `2026-07-13 00:00:00 → 2026-07-19 23:59:59`), "All" empties them (the full
  key), and the user is free to nudge them from there ("that week, but from
  wednesday") — what leaves the dialog is what they say, so a hand-typed range
  is honoured instead of being overwritten by the bucket it came from. One place
  shows the range and it is the editable one.

  A range that already exists — a card being re-filtered, a shared link, a
  restored view — comes back as the period it WAS: a range whose ends land
  exactly on a bucket's boundaries is recognized as that bucket
  (`infer_period`), and anything else opens in Custom, where the user left it.
  The pickers are pure children of the view, created with the dialog and
  destroyed with it, and every move crosses the FSM (`EV_PERIOD_CHANGED`).

  `tranger_helpers.js` no longer carries its own date arithmetic: `to_epoch`,
  `epoch_to_local_input` and `fmt_ts` now delegate to gobj-ui's `yui_time.js`,
  where the other projects can reach them. Behaviour is unchanged — the 29
  existing tests pass against the library implementation.

- **fix(gui_treedb): a Live card subscribed to the KEY, not to its own feed, so
  two cards doubled each other's rows.** With a per-key Live card and a
  whole-topic Live card open on the same key, every record appeared TWICE in
  both. The backend publishes a record once per open FEED, each publish carrying
  the `rt_id` of the feed that produced it — but the card subscribed with a
  `{topic_name, key}` filter, which matches EVERY publish of that key, so each
  publish landed in BOTH subscriptions and each card painted it twice (a record
  of a key with only one card open arrived once — which is what gave the bug
  away). A card now filters on its OWN feed (`{rt_id}`), exactly as c_tranger
  prescribes: one publish, one frame, one row. Re-arming a card after a
  reconnect mints a NEW rt_id, so it now re-subscribes on it — with the old
  filter that did not matter, with this one the card would have gone silent.
  (The backend was ALSO duplicating: see timeranger2 in the SDK's CHANGELOG —
  both fixes are needed.)

- **fix(gui_treedb): a dropped session was not a state, so the Tranger view kept
  offering what it could no longer do.** With the link down, the Keys button
  still looked alive; pressing it built the picker's Tabulator against a dead
  session, whose `ajaxRequestFunc` rejected at once — *"no session, cannot list
  keys"* in the log and a *"Data Load Error"* painted over the picker.
  `C_TRANGER_VIEW` subscribed to `EV_ON_OPEN` **only**: it learnt that the link
  came up, never that it went down, and sat in ST_TOPIC_SELECTED with a dead
  transport. It now watches BOTH edges (`EV_ON_CLOSE` too, published by
  `C_TREEDB_LINKS`): on close it rejects what is in flight, tears the cards down
  (they stay PERSISTED, as a topic switch does), closes the picker, disables the
  toolbar, says *"Disconnected — connect it in Settings"* and returns to
  ST_DISCONNECTED — where the user actions are not declared at all, by design.
  `pending_seg` carries the topic the user was on, so the reconnect
  (`EV_ON_OPEN`) comes back to it and the saved cards reopen themselves instead
  of falling back to the first topic. Verified by KILLING the backend yuno
  (`kill-yuno`) with a card open and restarting it (`run-yuno` + `play-yuno`):
  the view goes disconnected with the buttons dead, the Keys click does nothing,
  and on restart the topic, the toolbar and the card come back on their own.

- **fix(gui_treedb): a treedb tab was created with an attr its gclass does not
  have.** Opening a `C_NODE` service raised *"GClass Attribute NOT FOUND:
  C_YUI_TREEDB_TOPICS, attr conn_id"* + *"json2data() FAILED"*: `C_TREEDB_VIEW`
  passed `conn_id` in the create kw of EVERY hosted view, and an unknown attr
  fails the whole kw load. `conn_id` belongs to `C_TRANGER_VIEW` (it scopes the
  key-views it persists per connection); gobj-ui's `C_YUI_TREEDB_TOPICS` neither
  declares nor needs it — it reaches its backend through `gobj_remote_yuno`, like
  every other consumer of the library. It is now passed only to the view that has
  it, rather than adding an unused attr to the shared library.

- **fix(gui_treedb): the topic was selected before the state said so, and the
  restored cards never opened.** Entering a Tranger tab (or refreshing on one)
  raised *"Event NOT DEFINED in state: C_TRANGER_VIEW, ST_LOADING_TOPICS,
  EV_OPEN_CARD"* and the saved cards stayed shut. `ac_select_topic()` did the
  work of selecting the topic BEFORE `gobj_change_state("ST_TOPIC_SELECTED")`,
  and that work — `do_select_topic()` → `ask_saved_views()` — can answer
  SYNCHRONOUSLY, so `restore_views()` sent EV_OPEN_CARD from inside the same
  call, while the view was still in ST_LOADING_TOPICS, which does not declare it
  (only ST_TOPIC_SELECTED does — by design: no topic, no cards). The state change
  now comes first: the topic IS selected the moment the view commits to it, and
  the work of selecting it follows. The loud FSM error was right — the fix is the
  ordering, not a new action in ST_LOADING_TOPICS.

- **fix(gui_treedb): clicking a cell to edit it scrolled the cell out of view.**
  The caret stayed in a field nobody could see; scrolling back up showed it,
  still in edit. A row of the connections table is TALLER than its cells — it
  carries the connection's services sub-table — and Tabulator's VIRTUAL renderer
  assumes the opposite: opening a cell editor, `Edit.focusScrollAdjust()` scrolls
  the row's BOTTOM into view, which with a sub-table under the cells scrolls the
  cell being edited off the TOP of the table (measured: the tableholder jumped
  100px, taking the input from y=183 to y=83, above the table's own top edge —
  and it only bites when the table is shorter than the row, i.e. a short viewport
  or devtools open, which is why it was not seen at once). The table now renders
  with `renderVertical: "basic"`, which renders every row in flow and never does
  that; the connections of one browser are a handful of rows, so there was
  nothing to virtualize anyway.

- **fix(gui_treedb): the services sub-table was built, then clipped away.** It
  only appeared if you happened to resize the window. A Tabulator builds
  ASYNCHRONOUSLY, so when the rowFormatter returns, the row is still one line
  tall — and that is the height the connections table measured itself with: with
  a `maxHeight` set it pins its tableholder to an inline `height`, and it counts
  only CELL heights (`Row.calcHeight()` never sees a rowFormatter's own DOM). The
  sub-table landed below that height and was clipped; a window resize was the
  only thing that re-ran the measurement. The parent is now re-measured when the
  sub-table is really built (`tableBuilt`), coalesced to one measure per frame —
  a *measure*, not a `redraw()`: a redraw detaches every row to re-render it, and
  a Tabulator detached mid-flight comes back blank, so it would destroy the very
  sub-tables it was meant to reveal. The sub-table also takes its NATURAL width
  now (`fitDataTable`), not the connections table's — stretched to full width it
  read as a second header row of its parent. It lives in a BLOCK holder with the
  Tabulator in a child div (Tabulator's own nested-table shape): `fitDataTable`
  styles the table element `display: inline-block`, so built straight into the
  row it laid out INLINE with the cells, off past their right edge. Destroying a
  sub-table no longer throws either (*"ResizeObserver.unobserve: Argument 1 is
  not an object"*): the parent empties the row element first, so Tabulator's
  `unobserve(element.parentNode)` hit a null parent and aborted the rest of
  `destroy()`, leaking observers and listeners on every redraw.

- **fix(gui_treedb): the services of a connection are a table of their OWN.** As
  Tabulator dataTree children they were rows of the CONNECTIONS table and
  therefore wore ITS columns: a service's name landed under "Label", its gclass
  and its checkbox under two blank, unlabelled columns, and nothing on screen
  said what any of it was. Each connection row now nests a table of its services
  with its own header — **service / class / browse** — and only its own fields.
  (The dark-mode cell editor, unreadable while focused, is fixed in gobj-ui.)

- **fix(gui_agent): the same i18n audit, and a raw key that was on screen all
  along.** The node tabs of every workspace rendered as the RAW KEY (`nodes`, not
  `Nodos`): `yui_shell_set_submenu` builds fresh nav DOM, after the app's
  one-time `refresh_language`, and nobody translated it — the bug only hid
  because switching language re-translates the document. Beyond that, the same
  three shapes as gui_treedb: 20 tooltips built with `t()` and no
  `data-i18n-title` (measured: "Limpiar" stayed on an English UI), three
  Tabulator tables whose chrome (paginator, placeholder) never went through i18n
  at all and whose formatters are drawn once, and a `add` key DUPLICATED in both
  locale files. The language switch now goes through the library contract
  (`yui_shell_language_changed` → `EV_LANGUAGE_CHANGED`), which also replaces the
  raw `i18next.on("languageChanged")` listeners two views had wired outside their
  FSM. `validate-locales` is the hardened one (no duplicates; every key used —
  including the gobj-ui modules it mounts — must be defined).

- **fix(gui_treedb): the language switch is the shell's now, and 46 strings were
  never translated at all.** The whole gobj-ui treedb + graph editor asked for
  keys this app defines nowhere — `edit`, `new`, `delete`, `paste`, `unlink`,
  `zoom in`, … — and i18next answers an unknown key with the key ITSELF, so they
  rendered as raw lower-case English, in both languages. 46 keys added (+13 for
  Tabulator's paginator, which never went through i18n at all: "Page Size",
  "First", "Prev"…). Two keys were DUPLICATED in the locale files (`last`,
  `loading`) — an object literal keeps the last one and says nothing, so a stale
  entry silently overrode the new one. The app now switches its i18next and calls
  `yui_shell_language_changed(shell)`: the SHELL fans the fact out to every view
  it mounts, this app's and the library's alike (see gobj-ui's changelog).
  `validate-locales` grew two rules — no duplicate keys, and every key used in
  the source (this app's AND the gobj-ui views it mounts, both quote styles)
  must be defined.
- **fix(gui_treedb): a language switch reaches EVERY view, and a missing key can
  no longer hide.** Same audit applied to the rest of the SPA: the **picker** is
  built entirely with `t()` and nobody told it the language had changed (it
  re-renders on EV_LANGUAGE_CHANGED now); **Settings** had its export/import
  tooltips set with `t()` (they carry `data-i18n-title` now) and its whole
  Tabulator — column headers, placeholder, and every string its formatters paint
  (connect/disconnect, refresh services, connected, browse this service, clone,
  remove) — rendered ONCE, so the table is re-rendered in the action. And its
  `label` column header used a key **no locale defined**: i18next answers an
  unknown key with the key itself, so it read "label" in both languages and
  looked translated. `validate-locales` now fails on any key used in the source
  and defined in no locale — the check that would have caught it.
- **fix(gui_treedb): a language switch reaches the open cards.** `refresh_language()`
  re-translates every node that CARRIES its key, and a card was full of strings
  that did not: its title was one string composed with `t()` at create time
  (`"DVES_40C768 · Filas"` stayed Spanish in an English session for the rest of
  its life), its tooltips were `title` attributes set with `t()`, and its footer
  counter, placeholders and the Keys picker's headers were rendered ONCE by
  Tabulator. The switch is an **event** now (`EV_LANGUAGE_CHANGED`, published by
  the app root after switching): the translatable halves of a title carry their
  own key, every tooltip carries `data-i18n-title`, and the view re-renders in
  its action what no attribute can reach — the toolbar meta, the state-dependent
  buttons (pause, Live topic) and the tables.
- **fix(gui_treedb): a card's header no longer runs off the card on a phone.** A
  Rows card carries six buttons in its head (options, columns, export, share,
  refresh, close), each `is-flex-shrink-0` on a row that could not wrap: at 390px
  the card is 332px wide and the head was 400px — the ✕ ended 60px OUTSIDE the
  box. The actions are one block now (so they wrap as a group, not one button at
  a time), right-aligned by `margin-left:auto`, and on a phone they take a second
  line of the head with tighter gutters so all six fit on it — the buttons keep
  their height, so the touch target does not shrink. Desktop is unchanged: one
  line, as before.
- **fix(gui_treedb): the topic tabs no longer shrink under an open card.** With
  cards in the dashboard the tab strip rose ~10px and the top border of the
  active tab disappeared: the tabs are a flex item, a flex item shrinks by
  default, and the browser took 20 of their 42px (Bulma's `.tabs` is
  `overflow:hidden`, so what it took it clipped). The view's chrome — tabs,
  toolbar, error banner — is `flex: 0 0 auto` now: the only thing that gives is
  the dashboard, which has its own scroll.
- **feat(gui_treedb): the "Live topic" button says what it does, and undoes it.**
  Its label was hidden on a phone (`is-hidden-mobile`), leaving a bare dot that
  tells a mobile user nothing — and it is exactly the button a mobile user wants.
  The label is shown at every width now. It also TOGGLES, like the per-key Live
  buttons of the Keys picker: a click opens the whole-topic card, another closes
  it, and the dot is **green while it is open and colourless while it is not**,
  so the toolbar says whether you are following the topic right now (the title
  follows: "Follow every key of the topic" / "Stop following the topic").
- **refactor(gui_treedb): the machine sees the whole SPA now.** Three places kept
  outside the FSM what the FSM exists to make visible.
    - **Settings**: Add / Clone / Export / Import were events, but the four
      clicks INSIDE the table — the service checkbox, the refresh, the
      connect/disconnect, the ✕ — called their work straight from Tabulator's
      `cellClick`, and the removal mutated the config inside the confirm's
      `.then`. They are `EV_TOGGLE_SERVICE` / `EV_REFRESH_SERVICES` /
      `EV_TOGGLE_CONN_ENABLED` / `EV_REMOVE_CONN` (+ `EV_CONFIRM_REMOVE_CONN`)
      now, carrying identities, never the row.
    - **C_TREEDB_APP** kept the session in `priv.shell` — `if(priv.shell)` was
      what told "the password is wrong" from "your session died while you were
      working". Two states now: `ST_LOGGED_OUT` / `ST_SESSION`, so the shell
      chrome, the routing and the connection events cannot even be delivered
      with no session.
    - **C_TREEDB_LINKS** mutated by exported function (set_token, sync, reopen,
      reject, scan, close_all), so the part of this SPA that actually fails —
      the opens, the NAKs, the token refreshes — happened outside the machine.
      They are events; the reads stay plain functions, the split
      `C_TREEDB_CONFIG` already makes.
- **refactor(gui_treedb): one way to arm an iterator, one Rows-options dialog.**
  The `open-iterator` kw was built in three places (first mount, re-arm, edit of
  the match conditions) and the options dialog existed twice (open a card / edit
  an open one). 94 lines out, no behaviour changed. The backend-shape parsing of
  `list-keys` / `get-page` (the paged envelope vs the plain array of an older
  backend) and the key-span map moved to `tranger_helpers.js`, where the tests
  can reach them: the suite is 29 now.
- **fix(gui_treedb): a card restored from a link had no time span.** Since the
  Keys picker started paging in the backend, the browser only holds ONE PAGE of
  the topic's keys — and that page was what `key_span()` read the key's extent
  from. So every card that opens WITHOUT the picker (one restored from the saved
  set, one arriving in a shared link) opened its Rows options with no `min`/`max`
  on the time pickers, the caption on "span unknown" and the **"full span" preset
  dead**; so did any key living on another page of the picker. The span of every
  key a `list-keys` answer names is now remembered per topic — from ALL THREE of
  them: a page of the picker, the key count, and the saved-view check (which is
  precisely the answer that names the keys a restored card is about to open on).
  Verified in a browser against a live backend: the same restored card that
  opened blank now offers the key's real extent and fills it from the preset.
  A page of a topic the user has since LEFT is also discarded now — its rows used
  to land in the keys and the spans of the topic showing.
- **fix(gui_treedb): the bugs that survive a reconnect.** Seven failures found
  auditing the SPA against the backend it talks to; they share a shape —
  something that only bites when the link, the answer or the data is not what
  the happy path assumed.
    - A **Live card closed during a flap kept its subscription**: the
      unsubscribe was guarded by `live_transport()`, which requires
      `ST_SESSION`, but a subscription is LOCAL state of the iev and
      `C_IEVENT_CLI` **resends it on reopen**. Records kept arriving for a card
      that no longer existed, and `bump_key_count` inflated the picker's key
      counts for a view nobody had open. Unsubscribe on an ALIVE transport, in
      session or not.
    - A **malformed `services` answer WIPED the connection's stored services**:
      `result >= 0` with a non-array `data` was read as an empty yuno and
      persisted `[]` — the one thing `finish_scan`'s success branch exists to
      prevent. It is a failure now, logged and reported.
    - The **NAK give-up undid itself**: closing the transport left `enabled`
      true, so the next `EV_CONNECTIONS_CHANGED` (any unrelated edit) re-synced
      it back up and re-armed the refresh→reopen→NAK loop. And it closed in
      silence: no log, no error, the picker on "Connecting…" forever for a
      connection nobody was retrying. It now logs, records a **sticky
      rejection** the picker shows for what it is (fix the roles on that
      backend, then reconnect), and clears the connect intent.
    - **`get-page` had no deadline**: an answer that never landed (link UP,
      iterator reaped) left its entry in `priv.pending` for the life of the tab
      and its table spinning forever. A watchdog turns it into `EV_PAGE_TIMEOUT`
      (the timer only makes the event; the rejection happens in the action); a
      card close settles its own in-flight requests; an answer for an unknown
      `req_id` is logged, not dropped.
    - An **iterator armed against a link that died mid-mount** kept its id, so
      the re-arm asked the backend to close an iterator it had never opened and
      painted the error answer as a banner.
    - **`key_span()`** was the only key lookup comparing unstringified: with
      numeric keys the find missed and the Rows options silently lost their
      min/max bounds and the "full span" preset.
    - **`flatten_record()` DELETED a record's own field named `t` / `tm` /
      `rowid`** (collision with the metadata columns) — the table and the row
      dialog disagreed about the same record. The column is suffixed instead.
      And a **millisecond topic keeps its milliseconds** in the t/tm columns.

- **feat(gui_treedb): follow a whole topic, and read a key from its end.** Two
  things `c_tranger` has offered all along and the browser never asked for.
  `open-rt` takes an **empty key** as "every key of the topic" → a **Live topic**
  button beside Keys (its card names the key each record came from; the
  subscription filter drops the key, since the events carry the record's real
  one). `open-iterator` takes **`backward`** → a **"newest first"** checkbox in
  the Rows options, which travels with the rest of the match conditions
  (persisted with the card, re-applied on every re-arm). In a log that is what
  you almost always want, and it was previously unreachable without paging by
  hand to the end of 400k rows.

- **feat(gui_treedb): the Keys picker searches, sorts and pages IN THE BACKEND.**
  It was handed every key of the topic and did all three in the browser: a topic
  with a hundred thousand keys meant transferring the whole index, holding it in
  memory and sorting it on the main thread — to show 15 rows. The picker is a
  remote-paginated table now (`list-keys` with `rkey` / `order` / `desc` /
  `from` / `limit` — see the SDK changelog), like the records table, through the
  same Promise bridge. What the user types in the key search is a plain
  SUBSTRING, escaped into the regex the backend matches (`rkey` is unanchored, so
  an escaped term IS a substring search).

  Two things stopped being derivable from a list the browser no longer holds, and
  each became its own bounded question: the toolbar's key COUNT (`limit=1` — the
  count must not cost a transfer of every key) and whether a saved key-view still
  points at a key that EXISTS (one query whose `rkey` is the alternation of the
  saved keys). **Requires the SDK's paged `list-keys`**; against an older backend
  the picker shows the whole list as a single page and warns, loudly, that its
  search and paging are not there — it does not silently pretend the filter did
  something.

- **feat(gui_treedb): the connection set can leave the browser, and a card can
  choose its columns.** Connections live in this browser's localStorage, so
  moving them to another browser (or to another operator's machine) meant
  retyping every row: Settings gains **Export** (a JSON file — nothing secret
  travels, the access_token is never stored there) and **Import** (it ADDS the
  file's connections, never replaces the set; each arrives with a **fresh id**,
  because the id is what the open tabs and Tranger views are keyed by, and
  **disabled**, because importing a file must not open sockets). A row can also
  be **cloned** — same backend, new id, disabled: the starting point for "the
  same yuno, its other treedb service".

  And a card gains a **column chooser**. On a phone only the first four columns
  are shown — a record with a dozen fields is 1000+px wide and the table just
  scrolls sideways — but that was a one-way door: nothing could bring a hidden
  column back, and the choice of which four to keep was the SPA's, not the
  reader's.

- **fix(gui_treedb): reconnects back off instead of hammering.** Inherited from
  gobj-js (see its changelog): a dead backend was retried every 5s for the life
  of the tab by every link pointed at it, in lockstep. Now 5s → 60s with jitter,
  reset on a real session. Requires gobj-js ≥ unreleased.

- **feat(gui_treedb): a card is a link you can send.** Only the topic used to
  travel in the URL. A card's match conditions — the two time windows, the rowid
  range, the user_flag masks, backward — lived ONLY in the browser's local
  config, so the one thing worth showing a colleague ("look at key X between A
  and B") was the one thing you could not send them. A card's **Share** button
  now puts a link on the clipboard that rebuilds it: the URL segment becomes
  `<topic>~<base64url of {key, mode, match_cond}>` (one path segment; `~` is
  legal in a path and cannot appear in a topic name). It navigates first, so
  what you send is what you are looking at. A bare `<topic>` — every link shared
  before this — still works, and a corrupt or unknown payload degrades to its
  topic: a link is never worth failing a navigation for. Arriving by link opens
  the card like any other (deduped against an already-open one, and persisted:
  arriving by link is a deliberate open).

- **feat(gui_treedb): pause a Live card, export what a card holds, copy a
  record.** **Pause** stops the table without closing the feed: records that
  arrive while paused are **held** (capped like the table) and flushed on
  resume — pausing to read a row must not cost you the rows that land while you
  read it; the counter shows `n / max (+held)`. **Export** downloads what the
  table HOLDS as CSV (the loaded page of a Rows card, the buffer of a Live one
  — deliberately not the key: that is a server-side dump this SPA cannot
  stream). **Copy** puts the record dialog's JSON on the clipboard.

- **fix(gui_treedb): a blink of the network is not a logout.** `/auth/refresh`
  called `resp.json()` unguarded, so a 502 answering an HTML gateway page threw
  in the parse and landed in the same catch as a real rejection:
  `EV_LOGIN_DENIED` → shell destroyed, links closed, **every open card lost**,
  back to the login form — because the network blinked. Failures are classified
  now: the BFF *answering* "no" is a denial; a rejected fetch, a timeout, a 5xx
  or a non-JSON body is transport noise → `EV_REFRESH_FAILED`, which retries
  with backoff (5s…60s) and keeps the session, the shell and the cards.
  Every BFF call has a **15s deadline** (a stalled `/auth/refresh` used to kill
  the refresh loop outright: the promise never resolved, so the timer was never
  re-armed). And a **sleeping laptop woke up logged out** — background tabs get
  their timers throttled, so the refresh fired after the token was already dead;
  `visibilitychange` / `online` now enter the FSM as `EV_WAKEUP` and the action
  refreshes on the spot if the deadline has passed.

- **fix(gui_treedb): each backend is told only ITS OWN required services.**
  `required_services` was the yuno-wide attr, which for a multi-backend SPA can
  only be the union of every connection's selection — so each backend was
  handed the service names of all the others. Each transport now carries its own
  list (new `C_IEVENT_CLI` per-link attr; requires gobj-js ≥ unreleased).

- **fix(gui_treedb): stop swallowing errors, and start testing what is
  testable.** 22 bare `catch(e) {}` each claimed "the table is gone" — and
  caught every other exception with it, so a real Tabulator/data bug inside a
  redraw was invisible. They log now. Same shape elsewhere:
  `gobj_save_persistent_attrs`' result was ignored at all eight call sites (a
  rejected localStorage write now says so), a config mutation on an unknown
  `conn_id` returned mute, and the picker and Settings said nothing when the
  services they depend on were missing. Two subscription **leaks** closed:
  `C_TREEDB_PICKER` and `C_TREEDB_SETTINGS` subscribed in `mt_create` and never
  undid it, while both are destroyed and re-created by the shell (Settings is
  `lazy_destroy`: a fresh set per visit) — subscriptions move to `mt_start`,
  paired with unsubscribes in `mt_stop`. The picker's "Manage connections" wrote
  `window.location.hash` straight from its click handler (a route change from
  outside the shell that owns it, invisible to the machine); it crosses the FSM
  now. And `npm test` was wired to vitest with **not one test file**: the view's
  pure helpers move to `tranger_helpers.js`, where **15 tests** pin the two time
  axes, the two time units, the metadata-column collision and the filter
  grammar.

- **feat(gui_treedb): the Rows options offer BOTH time axes of a tranger
  record, bounded to what the key really holds.** A record carries two
  timestamps — `t` (PERSISTENCE: when it was stored) and `tm` (MESSAGE ORIGIN:
  when the event it carries happened) — and they diverge whenever data is
  backfilled or a device uploads a buffer late. The modal offered a single
  range, silently `t`. It now has a block per axis (they are independent
  conditions and the iterator ANDs them), each with from/to pickers at SECONDS
  precision, quick presets (last hour / 24h / 7 days / today / full span /
  clear), and the key's real extent shown as a caption and set as the pickers'
  `min`/`max` — the backend reports it per key in `list-keys`
  (`fr_t`/`to_t`, `fr_tm`/`to_tm`). The records table gained a `tm` column
  beside `t`, so the axis being filtered is visible. Times are converted in the
  topic's own unit: the view asks `topics expanded=1` and reads each topic's
  `system_flag` (`sf_t_ms` / `sf_tm_ms` = milliseconds); a backend too old to
  answer that shape still works, and its topics read as seconds, exactly as
  before. Requires SDK ≥ (unreleased) for the span and for the conditions to be
  applied per record — against an older backend they are honored only at file
  granularity.

- **fix(gui_treedb): the `t`/`tm` columns were on a different clock than the
  time pickers.** The columns rendered UTC (`toISOString`) while the pickers,
  the presets and the key's span caption are LOCAL (`datetime-local`): asking
  for "tm from 18:55" returned a card whose first row was labelled 16:55 — the
  same instant on two clocks. Found in live QA against a staging backend.
  `fmt_ts()` now renders the local wall-clock through the same helper that feeds
  the pickers, so caption, picked range and column values all read alike.

- **refactor(gui_treedb): the config service and the login service cross their
  own FSMs.** `C_TREEDB_CONFIG` had a literally EMPTY automaton
  (`[["ST_IDLE", []]]`) and twelve exported mutators that four other gclasses
  called directly, each ending in a `gobj_publish_event` fired from inside a
  FOREIGN gobj's DOM callback: nothing about the config's life reached the
  `machine` trace, and the notification came out of a stack that had no
  business owning it. Every mutation is an event now (`EV_SET_CONNECTIONS`,
  `EV_SET_CONN_SERVICES`, `EV_STORE_SCANNED_SERVICES`, `EV_SET_CONN_ENABLED`,
  `EV_TOGGLE_SELECTED`, `EV_REMOVE_SELECTED`, `EV_SET_ACTIVE_TAB`,
  `EV_SET_LIVE_MAX`, `EV_ADD_TRANGER_VIEW`, `EV_REMOVE_TRANGER_VIEW`) and the
  work — write, persist, publish — happens in its own action. READS stay plain
  functions: reading an attr changes no state and there is nothing to audit.

  `C_TREEDB_LOGIN` kept two paths outside its automaton.
  `try_restore_session` changed state and published by hand from a promise,
  with `EV_RESTORE_FAILED` declared in `event_types` but handled in **no
  state** — a transition that existed only in hand-written code; and
  `fetch_and_publish` published the output event from its promise. Both send
  events now (`EV_RESTORE_FAILED`, `EV_TOKEN_FETCHED`). That also covers a race
  that would have raised "event not defined": logging out while `/auth/token`
  is in flight lands the token in `ST_LOGOUT`, where it is dropped as stale —
  the same shape as the already-handled late `EV_LOGIN_REFRESHED`.

- **fix(gui_treedb): deleting a connection leaked its saved Tranger views.**
  The pruning of a connection's persisted key-views lived in
  `treedb_config_remove_connection`, which **nothing ever called**; the live
  delete path (`set_connections`, from the Settings table) pruned the open tabs
  but not the views, so every deleted connection left its Tranger views in
  localStorage forever. The pruning now runs where the deletion actually
  happens.

- **refactor(gui_treedb): every action in the Tranger browser crosses the
  FSM.** `C_TRANGER_VIEW` lived entirely in `ST_IDLE`: button clicks called
  functions directly, and so did everything the view did on its own (arm an
  iterator, refresh, close, re-arm on reconnect). Nothing reached the `machine`
  trace, so its bugs had to be chased through WebSocket traffic and
  screenshots. It now has the states its life actually has —
  `ST_DISCONNECTED` → `ST_LOADING_TOPICS` → `ST_TOPIC_SELECTED` — and every
  click, window/modal `on_close` and dialog confirm is an event
  (`EV_SELECT_TOPIC`, `EV_OPEN_KEYS`, `EV_PICKER_CLOSED`, `EV_OPEN_OPTIONS`,
  `EV_OPEN_CARD`, `EV_CLOSE_CARD`, `EV_REFRESH_CARD`, `EV_CLEAR_CARD`,
  `EV_APPLY_MATCH_COND`, `EV_SHOW_RECORD`); a DOM handler now does nothing but
  translate the browser's notification into one. "No topic yet" is a STATE, so
  the Keys button with no topic fails loudly naming its sender instead of
  silently no-opping on an `if(!priv.cur_topic) return`.

  Two things fell out of the redesign. **A view mounted with no session stayed
  empty forever**: `mt_start` asked for the topics, failed, logged "no session"
  and nothing ever retried — that is `ST_DISCONNECTED` now, and the `EV_ON_OPEN`
  that arrives when the link comes up asks for them. And the card events carry
  **`{key, mode}`, never the card object**: a `kw` must be plain JSON because
  the machine trace dumps it, and a card holds its Tabulator and its DOM nodes
  — circular structures that throw on serialization, which would have broken
  the very trace this redesign exists to feed. Cards stay inside the gclass
  (they are not child gobjs); Tabulator's `ajaxRequestFunc` stays a plain call
  (it must RETURN a Promise — a data source, not an action).

- **fix(gui_treedb): every connection event reached the app TWICE, and that
  re-armed the NAK loop.** `C_TREEDB_APP` created `treedb_links` with a
  `subscriber` attr — which makes its SERVICE `mt_create` subscribe the app to
  ALL its events (a `null` subscription) — and then subscribed EXPLICITLY to
  three of them on top. A null subscription does not dedupe against a named
  one, so both fired. The damage was in `ac_on_id_nak`: the second NAK of a
  connection entered twice, the first delivery consumed the `nak_recovered`
  mark and gave up on the connection, and the second, no longer finding it,
  took the first-NAK branch and asked for a token refresh that reopened the
  connection just abandoned — the exact refresh -> reopen -> NAK loop the guard
  exists to break. Every `EV_ON_OPEN` also rebuilt the workspaces twice. The
  app now opts in per event, and the two no-op actions that only existed to
  swallow the events the null subscription dragged in are gone with it.

- **fix(gui_treedb): a command on a dead link left Tabulator loading forever.**
  `gobj_command()` returns `null` BOTH on success and after logging *"Not in
  session"*, so every `if(ret) { log_error(ret); }` guard in `C_TRANGER_VIEW`
  was unreachable: with the websocket down the command evaporated, and
  `get-page` kept a pending entry whose answer never landed — the card spun on
  its loading state and `priv.pending` grew one entry per request. All commands
  now go through a `live_transport()` check (transport alive, not destroyed, in
  `ST_SESSION`); `get-page` rejects its Promise immediately when there is no
  session, and in-flight requests are settled when the session reopens or the
  view stops. `C_TRANGER_VIEW` also no longer re-arms its cards against a
  DESTROYED transport: on a token-refresh reopen the iev is recreated and the
  host (`C_TREEDB_VIEW`) rebuilds the view — the old code fired `list-keys` plus
  one re-arm per card at the dead pointer, logging *"gobj NULL or DESTROYED"*
  for each.

- **fix(gui_treedb): deselecting a treedb kicked you off the tab you were on.**
  `ac_selected_treedbs_changed` keyed the current tab on the whole route tail,
  so with a topic deep-linked (`/topics/db/<sel>/<topic>`) the id was
  `<sel>/<topic>`, never matched a selection, and the app navigated away. It
  keys on the first segment now, as `restore_tab_from_url` already did.

- **chore(gui_treedb): drop dead code (-890 lines).** `ui_lib_devices.js` and
  `ui_lib_time.js` (imported by nothing), the persisted `display_mode` attr and
  its accessors (never read), `treedb_config_upsert_connection` /
  `connection_id` / `sel_parse` (exported, never called), the `services_roles`
  capture + getter in `C_TREEDB_LINKS` (never consumed), `__app_gobj__`,
  `refresh_expires_in`, unused imports, and the DOM `id` duplicated across the
  two Keys-picker instances (now the `PICKER_MANAGE` logical class).

- **fix(gui_treedb): Tranger cards survive a reconnect, and Refresh really
  refreshes.** The server-side state of a card (its iterator, its realtime feed)
  belongs to the SESSION that opened it, and the backend now reaps both when
  that session dies (yunetas `c_tranger`, same release): a dropped websocket
  left every open card holding a dead `iterator_id` / `rt_id` — a Rows card
  paged against nothing ("No records", pager collapsed) and a Live card went
  quiet. `C_IEVENT_CLI` resends event SUBSCRIPTIONS on reopen, but nothing
  re-opens what a COMMAND created, so the view now watches the link — on the
  **local** `treedb_links` service, as its host does — and re-arms every card.
  **Never subscribe to `EV_ON_OPEN` on the `C_IEVENT_CLI` itself:** every
  explicit subscription there is forwarded to the REMOTE service as
  `__subscribing__`, and `c_ievent_srv` logs an error and rejects it (only the
  destination service's `EVF_PUBLIC_EVENT` events are accepted) — that mistake
  is what showed up as "SUBSCRIBING event ignored" in the backend's Global
  Errors.
  **Refresh** on a Rows card re-opens the iterator too: an iterator is a
  SNAPSHOT (its row index is built when it is opened), so re-asking for the page
  returned the same rows and the same total, and **Last** never reached the new
  records. The pager also gets the exact `total_rows` as Tabulator's `last_row`
  — without it Tabulator estimates the total as `last_page * page_size`, and the
  counter lied ("Showing 390001-100 of 100 rows").

- **fix(gui_treedb): the Keys picker's record counts go stale.** They came from
  the `list-keys` snapshot taken when the topic was selected, and nothing ever
  refreshed them. Now the picker re-asks `list-keys` **every time it opens**
  (and an answer landing while it is up repaints it — before, the answer only
  updated the internal list), and a live append **bumps its key's count** in
  place (`index: "key"` on the picker table, so `updateData()` finds the row).
  No polling: on-demand refresh + the producer's event. Keys without an open
  Live card produce no events, so they refresh when the picker is reopened.

- **feat(gui_treedb): the Live buffer cap is a setting (default 500 -> 1000).**
  New persisted `live_max` attr on `C_TREEDB_CONFIG`, editable in **Settings ->
  Live buffer**. It bounds the BROWSER's memory (the backend keeps no live
  data), so `C_TREEDB_CONFIG` clamps it (50 … 100000) and the field echoes back
  what was actually stored. A card freezes the cap it was created with —
  changing the setting applies to cards opened from then on, it never re-trims
  a buffer that is already filling — and its header counter reads
  `N / <its cap>`. New i18n keys: `live buffer`, `live buffer help`,
  `rows per live card`.

- **fix(gui_treedb): live records are routed by `rt_id`, not by topic+key.** The
  backend runs its publish callback once per OPEN realtime feed, so a record
  arrives once per feed alive on that key — including feeds leaked by sessions
  that died without `close-rt`. Matching on topic+key accepted all of them: the
  same `rowid` was pushed into a Live card 20+ times, which read as "the feed is
  loading history". Now a record is routed to the card whose `rt_id` produced it
  (new field in the payload — yunetas `c_tranger`, same release, which also
  stops the leak). Backends older than the field send none: fall back to
  topic+key (and to their duplicates).

- **feat(gui_treedb): Tranger cards on a phone — row counter, fewer columns,
  reachable hint.** A **Live** card now shows a `N / <cap>` counter
  (`TRANGER_CARD_COUNT`) next to its dot: it has no pager, so without it the
  rolling buffer was a black box (12 rows, or the cap?). On mobile a card shows
  only its first 3 columns (`MOBILE_COLS`) — a dozen fields at 90px each is
  1000+px and the card just scrolled sideways; the FULL record is one row-click
  away as JSON. The desktop-only *"filters loaded rows"* hint becomes an info
  icon on mobile (same message in `title`/`aria-label`), so column filters are
  no longer offered there without stating their scope.

- **style(gui_treedb): Tranger dashboard spacing and card corners.** Dashboard
  padding `pt-3 pl-2 pr-5` (the first card is no longer flush against the
  toolbar; the wider gutter is on the right, where the scrollbar and the thumb
  are). Card corners softened via Bulma's own `--bulma-box-radius` knob
  (0.9rem), with the header band and the Tabulator rounded along with the box —
  both have their own background and square corners, and were flattening the
  curve.

- **feat(gui_treedb): a Rows card can edit its match conditions.** New
  **Options** button (`TRANGER_CARD_OPTIONS`) in the card header reopens the
  `TRANGER_ROWS_OPTIONS` dialog **preloaded with that card's current
  conditions** (the confirm button reads *Apply* instead of *Open Rows*). The
  conditions live in the SERVER-side iterator (they pre-filter its row index),
  so applying them closes the old iterator, opens a new one and re-fetches from
  page 1 — the card, its Tabulator and its columns stay, only the data behind
  them changes. The saved view is upserted, so a reload restores the card with
  the NEW conditions. New i18n keys: `options`, `apply`.

- **fix(gui_treedb): the Keys picker fits a phone.** Its columns asked for
  150+110+160px, and `fitColumns` cannot shrink a column below its
  `minWidth`/`width` — so inside the ~300px mobile sheet Tabulator added a
  horizontal scrollbar (two-axis scrolling in a modal). On mobile the columns go
  compact (100 / 70 / 96) and the per-key **Rows** / **Live** buttons go
  icon-only (`is-hidden-mobile` labels, `title` + `aria-label` kept), per the
  repo's mobile button convention. Desktop is unchanged.

- **fix(gui_treedb): the Live card's Clear button gets its own icon**
  (`yi-broom`). Clear and Close both used `yi-xmark`, and on mobile the text
  label is hidden — so the two buttons were indistinguishable, one emptying the
  rolling buffer and the other closing the card.

- **fix(gui_treedb): the Tranger view's scoped CSS was dead.** Its root element
  carried the gclass name as an inert HTML **attribute** (`gclass="…"`, read by
  nobody) instead of a **class**, so every `.C_TRANGER_VIEW …` rule of the
  injected stylesheet never matched. Visible symptom: on mobile the Tabulator
  footer stayed a single nowrap row and clipped the page-size select and the
  First/Prev/Next/Last buttons off the right edge (the mobile rule stacks the
  counter over the full pager). Also restores the card chrome (scrollable
  dashboard column, card border/title ellipsis).

- **fix(gui_treedb): Tranger footers, counter and card breathing room.** The
  mobile footer rule reached the Rows cards but never the **Keys picker**: it
  was scoped to `TRANGER_KEYS_TABLE`, the div handed to Tabulator — which
  Tabulator turns INTO the `.tabulator` element (it adds the class), so
  `.TRANGER_KEYS_TABLE .tabulator` asked for a descendant of itself and matched
  nothing. Scoped to the wrapper (`TRANGER_KEYS_PICKER`) instead. The picker now
  also shows the **"Showing x-y of N rows"** counter, and that counter goes
  through the app's i18n in every paginated tranger table (new `showing rows`
  key, en/es) — Tabulator's built-in `paginationCounter: "rows"` is hardcoded
  English. Card content gets `p-2` of padding (the `.box` stays `p-0` so the
  header band runs edge to edge) and the table grows from a fixed 320px to
  `min(60vh, 560px)` — it follows the viewport but never lets one card eat a
  short screen. (The Live table devotes that height almost entirely to rows; a
  Rows table spends part of it on the header filters and the pager footer.
  Tabulator's `height` is the height of the WHOLE table, not of the rows area.)

- **fix(gui_treedb): Tranger cards read as separate objects.** In a view that is
  a *stack of tables* (grid lines and scrollbars everywhere) consecutive cards
  looked like one continuous table. Now: `mb-6` gutter (3rem, the top of Bulma's
  spacing scale), a much darker shadow **around** the card — via Bulma's own
  `--bulma-box-shadow` knob on the `.box`, all-round (offset 0 + positive
  spread) instead of a downward "elevation" one, with a hairline ring so it
  stays legible in dark mode — and a titled header band. The dashboard column
  gets `px-3`: it scrolls (`overflow-y:auto`, which forces `overflow-x` to
  `auto`), so a full-width card had no room for its lateral shadow and got it
  clipped at the edge.

- **feat(gui_treedb): Rows request options + per-column operator filters +
  responsive Keys picker in the Tranger browser.** The Keys picker is presented
  responsively — a **moveable, non-modal `C_YUI_WINDOW`** (drag / resize, no
  window manager: it is a helper of the view, not a dockable app window; mounted
  in the shell's popup layer so modals opened from it still stack on top) on
  desktop, and the shell's **adaptive modal sheet** on mobile (a window
  is awkward on a phone) — and persists while views are opened/closed. Each key
  row's
  **Rows** / **Live** button is colored (active) **only** while that view is
  open for the key, and clicking an active button **closes** that view (toggle).
  A key's **Rows** opens an options form with server-side match conditions
  forwarded to `open-iterator`: time range (`from_t`/`to_t`), rowid range
  (`from_rowid`/`to_rowid`) and user_flag masks (`user_flag_mask_set` /
  `user_flag_mask_notset`) — all optional, blank = the full key. The backend
  pre-filters the index, so the card's pagination reflects the filtered set.
  **Live** cards open directly (the realtime feed filters only by key). The
  free-text search box is replaced by **per-column header filters** that accept
  a leading comparison operator (`>200`, `<=5`, `=ok`, `!=err`) or a plain
  substring; they filter the **loaded page** client-side (labeled as such on the
  card). The open/closed set of key-views is **persisted per connection** (new
  `tranger_views` attr on `C_TREEDB_CONFIG`, localStorage): views are restored
  when the user returns to a topic (a deliberate close forgets a view; a topic
  switch / teardown keeps it), and the whole set is dropped when that connection
  is removed. Requires a backend with the `open-iterator` match-condition params
  (yunetas c_tranger, same release). New i18n keys for the options-form labels.
  (Backend counterpart: `feat(c_tranger): open-iterator accepts metadata match
  conditions`.)

- **feat(gui_agent): control-center link status in the shell + "reconnecting"
  feedback.** `c_app` now handles `EV_ON_OPEN_ERROR` (backend down / TLS / port,
  or a failed reconnect) — orthogonal to the session, so **no logout**; the link
  keeps retrying. A global connection dot (`type:"connection"` toolbar item)
  reflects the control-center link (green up / red down) — a different layer
  from per-node reachability, which keeps its per-tab glyph. Driven from
  `ac_on_open` (up) / `ac_on_close` / `ac_on_open_error` (down). In the pre-shell
  window (the first open after login has not landed, which left a blank page),
  the login screen returns with a non-destructive *"Cannot connect …
  Reconnecting…"* notice; `EV_ON_OPEN` then builds the shell. New i18n keys
  `reconnecting`, `backend connection` (en/es).

- **fix(gui_agent, gui_treedb): close the EV_LOGIN_REFRESHED gap in ST_LOGOUT.**
  A token refresh is only ever initiated from ST_LOGIN (NAK recovery), but its
  async result can resolve after a concurrent logout has moved the login FSM to
  ST_LOGOUT — a stale `EV_LOGIN_REFRESHED` success then raised *"Event NOT
  DEFINED in state"*. Both logins now handle it in ST_LOGOUT by discarding it
  (`ac_clear_session`, we are logged out on purpose). gui_agent also drops the
  dead `EV_DO_REFRESH` entry from ST_LOGOUT (its only sender, the NAK path,
  operates in ST_LOGIN); gui_treedb never had it. Mirrors the same fix in
  wattyzer. gui_agent is the most exposed (single-link: it logs out on the 2nd
  NAK while the 1st refresh may still be in flight).

- **fix(gui_treedb): clear the refresh timer on session end.**
  `ac_login_denied` / `ac_logout_done` now `clear_timeout(gobj_timer)` so the
  refresh timer armed at login does not survive into ST_LOGOUT and fire a
  stray `EV_TIMEOUT` there (*"Event NOT DEFINED in state"*). gui_agent already
  did this; gui_treedb was the odd one out. Mirrors the wattyzer fix.

- **feat(gui_treedb): Live records card in C_TRANGER_VIEW (realtime).** The
  keys picker's **Live** action (previously disabled) now opens a streaming
  card: it arms a backend realtime feed (`open-rt {rt_id, topic_name, key}`)
  and subscribes to `EV_TRANGER_RECORD_ADDED` filtered by `{topic_name, key}`
  over the ievent gate. New appends **prepend** (newest on top) into a rolling
  Tabulator capped at 500 rows; columns are seeded from the first record (the
  feed loads no history — pair a Rows card for history). The head search
  filters the buffer, Clear empties it, and closing the card unsubscribes and
  `close-rt`s the feed. `EV_TRANGER_RECORD_ADDED` is declared `EVF_PUBLIC_EVENT`
  in the gclass and routed to matching cards by `ac_tranger_record_added`. A
  green dot marks live cards; one card per (key, mode). Needs a backend with
  the c_tranger `open-rt`/`close-rt` commands and `EV_TRANGER_RECORD_ADDED`
  made public (SDK Phase C). Adds the `clear` / `waiting for records` locale
  keys (en + es).

- **fix(gui_treedb): the Developer window docks on minimize.** gui_treedb
  registered `C_YUI_WINDOW` but never `C_YUI_WINDOW_MANAGER` nor created the
  `__window_manager__` service, so `yui_dev.js` opened the monitor with
  `manager: null` and minimizing shaded it in place (an empty floating
  rectangle) instead of rolling it to a dock. Mirror gui_agent: register the
  manager and create the `__window_manager__` service (`dock_mode:
  "responsive"`, floating bottom-left on desktop, an inline taskbar in the
  shell's `bottom-sub` zone on mobile). Also import `gobj_create_service`
  (was missing — a latent `ReferenceError` esbuild does not flag).

- **feat(gui_treedb): C_TRANGER_VIEW becomes a card-dashboard control panel
  with Tabulator-native cursor pagination.** Replaces the earlier flat table
  (one-shot `open-list return_data=1 from_rowid=-N` + "Load more ×4" that
  re-read a growing snapshot) with a dashboard over the c_tranger command
  surface (needs a backend with `list-keys` / `open-iterator` / `get-page` /
  `close-iterator`):
    - selecting a topic issues `list-keys` (kept for the picker); the toolbar
      **Keys** button opens a modal sheet with a Tabulator of the topic's
      keys — sortable (default by record count desc), header-filtered — each
      row offering **Rows** (and a disabled **Live**, backend Phase C);
    - picking Rows adds a **card** to a vertical dashboard. Each card is a
      records Tabulator driven by Tabulator's **native remote pagination**:
      `open-iterator` builds the per-key row index and Tabulator's
      `ajaxRequestFunc` pulls each page via `get-page`, bridged to the async
      `gobj_command` answer by a per-request Promise. First/Prev/Next/Last,
      the page-size selector and the row counter are Tabulator's own;
    - columns are auto-generated from the records (metadata `t`/`rowid`
      first; the full record kept hidden for the row-click JSON dialog).
      Each card has a head **search** that filters the loaded page and
      **persists across page changes** (re-applied on Tabulator's
      `dataLoaded`), plus Refresh and Close (icon+label on desktop,
      icon-only on mobile);
    - the iterator is closed (`close-iterator`) on card/topic change and on
      stop. `iterator_id` carries a per-view random token so it never
      collides with an iterator a previous session leaked on the backend
      (which returned the wrong key's data — "already open" reuse).
  Correlation rides `__md_command__` (a command's params are NOT echoed —
  only `__md_command__` round-trips as `command_stack[].kw`), so `get-page`
  answers resolve the right Promise and `list-keys` the right topic. The keys
  picker redraws on `tableBuilt` (measure against the modal box, not the
  full-width layer). Adds the `keys` / `rows` / `live` / `actions` / `views`
  / `close` / `open a key view` / `realtime coming soon` (+ earlier `no keys`
  etc.) locale keys (en + es).
  Known limitations (backend follow-ups): (1) a SPA iterator is not tied to
  the ievent session, so an unclean disconnect (tab closed, network drop)
  leaks it until the C_TRANGER yuno's own destroy — the view closes
  diligently on every transition and the per-view token neutralises the
  collision; (2) the head search is client-side over the loaded page —
  whole-key content search would need a server scan (the C_TRANGER yuno is
  single-threaded), deferred; metadata filters (time range) are the cheap
  path when needed. Live realtime awaits `EVF_PUBLIC_EVENT` on
  `EV_TRANGER_RECORD_ADDED` (backend Phase C).

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
