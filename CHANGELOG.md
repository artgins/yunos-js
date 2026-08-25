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

Each yuno consumes `@yuneta/gobj-js` / `@yuneta/gobj-ui` from the **npm
registry**, the same way wattyzer does. A standalone clone of this repo builds
on its own, outside the yunetas superproject.

## 0.22.20 — 2026-08-25

### Both yunos

- **`@yuneta/gobj-ui` `^7.23.21`.** Every container key of a JSON card now
    opens a G6 port and its line leaves from there, instead of fourteen lines
    coming out of one anchor point.

## 0.22.19 — 2026-08-25

### Both yunos

- **`@yuneta/gobj-ui` `^7.23.20`.** The JSON graph stops drawing a pure
    collection as a node of its own: `cols` is one key of the topic dict like
    `pkey` is, so it is a ROW in the card and its columns hang from the card.

## 0.22.18 — 2026-08-25

### Both yunos

- **`@yuneta/gobj-ui` `^7.23.19`.** Brings the camera ANCHOR to the three node
    viewers: pick one element from the toolbar's crosshairs and every zoom
    leaves it in the middle. The viewers also open at ACTUAL SIZE rather than
    fitted -- one topic's schema fits at 37%, where every card is grey texture
    -- and a JSON card stops listing the containers it already draws as cards.

    Three new i18n keys in both locale files: `anchor view`, `click the element
    to centre on`, `centred: click to release`.

    Also from 7.23.17-7.23.18: the JSON viewer remembers which of its three
    views you read in, a container row says WHICH record it is, and every value
    type now clears 4.5:1 on all five surfaces the viewer paints -- an orange
    boolean on the graph's match chip used to measure 1.80:1.

## 0.22.17 — 2026-08-25

### gui_treedb

- **A key of a tranger topic can be deleted from the Keys picker.** Each key
    row gains a third action next to Rows and Live, on the backend's new
    `delete-key` (`C_TRANGER`, yunetas). The picker could always SHOW a key
    born of a port scan or a typo, and nothing could remove it — so it stayed
    in the topic, and in every view derived from the topic's keys, for ever.

    It asks first, with the topic, the key and the record count in the
    question: the delete is irrecoverable on an append-only store, and the
    count is the only thing that says what the button costs. Both halves of
    that question carry their own i18n key, so a language switch while the
    dialog is up still re-translates it.

    The key's open cards are closed BEFORE the command goes out — a Rows card
    holds a server iterator on the key and a Live card a realtime feed, and
    both would be left pointing at something that no longer exists. The answer
    is what refreshes the picker's page and the toolbar's key count; nothing
    here polls.

    Note the backend's `delete-key` is **master-only**: against a tranger
    opened with `master: 0` (a read-only replica) it refuses with "Only master
    can delete", which the view surfaces as the error it is.

## 0.22.16 — 2026-08-25

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.15` -> `^7.23.16`: the graph's toolbar gets its
    scroll arrows back on a phone.** In the treedb graph the toolbar shares its
    row with the pinned `GRAPH_BACK_TOPICS` link, and that was enough to lose
    them: a flex item's `min-width: auto` is its CONTENT minimum, and the
    toolbar's sections are `flex-shrink: 0`, so the toolbar refused to shrink,
    kept the whole row width, and its right arrow ended up outside the ancestor
    that clips the view. Standalone — one toolbar alone in its row, as on the
    library's test page — nothing shrinks and nothing showed.

## 0.22.15 — 2026-08-25

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.14` -> `^7.23.15`: the graph's long press says so
    when it crosses the line.** Deciding the press at the release costs one
    thing — while the finger is down, nothing says that letting go would now
    give the menu rather than the node's own action. A 15ms haptic tick at the
    500ms mark says it. A NOTICE, not the decision: a finger that buzzes and
    then carries the node away still gets its drag.

## 0.22.14 — 2026-08-25

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.13` -> `^7.23.14`: on a phone, a finger moves a
    node.** Two defects in the graph, both in the way of the plainest thing
    there is to do in edition mode. The browser was taking the gesture: G6 puts
    `touch-action: none` on its canvas and nothing on its HTML nodes, so a drag
    that started on a CARD was a page scroll — two `pointermove`s, then
    `pointercancel`, and the node stopped about 20px in while the page slid.
    And the long press fired on a TIMER while `drag-element` was already
    carrying the node, so one press meant both things at once. The press is
    arbitrated at the RELEASE now: moved -> drag, still and quick -> the
    element's own action, still and held -> the context menu. No host change,
    no new keys.

## 0.22.13 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.12` -> `^7.23.13`: the graph's two selects speak
    the app's language.** The layout one and the operation-mode one rendered
    their raw names in every language, because neither went through `t()` at
    all — the Spanish console said *"Modo de operación: reading"*. Nine new
    keys in both locales: `reading`, `operation`, `writing`, `edition`,
    `manual`, `dagre`, `antv-dagre`, `d3-force`, `force-atlas2`.

## 0.22.12 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.11` -> `^7.23.12`: the graph's selection-mode
    toggle looks PRESSED.** It was painted with the palette's violet, which
    that palette assigns to undo/redo — so two neighbouring buttons in the same
    strip wore the same colour for two different reasons, and the state change
    rode in the hairline of an outline glyph. It is an inverted neutral chip
    now, hue-free.

## 0.22.11 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.10` -> `^7.23.11`: the treedb graph's
    multi-selection reaches a finger.** Both of its gestures hang off Shift —
    shift+click adds a card, shift+drag draws the rubber band — and a phone has
    no Shift. The graph's edit toolbar carries a **selection mode** toggle now:
    while it is on, a tap picks a card and a drag on the background draws the
    band, with panning standing aside (G6 binds panning and the band to the
    same plain drag, so one of the two has to). New host key `selection mode`,
    defined in both consoles' locales.

## 0.22.10 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.9` -> `^7.23.10`: a group move no longer moves
    the whole graph.** Dragging a selection in a treedb graph also panned the
    canvas, so everything moved and the selection appeared to run away — while
    the saved result was right, because a pan writes nothing. Undo never lit on
    a graph entered through the mode selector (the history plugin was tied to a
    moment of the load rather than to the mode), and a click on the background
    lit Save on a graph nobody had touched.

## 0.22.9 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.8` -> `^7.23.9`: the three G6 graphs are operable
    on a touch screen.** Pinch to zoom, a long press that opens the context
    menu, the camera restored to `operation` mode, touch-sized targets behind
    `(pointer: coarse)`, and the two floating toolbars folded behind one button
    on a narrow container.

## 0.22.8 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.7` -> `^7.23.8`: the global fold leads all three
    toolbars, and both graph find boxes clear.** Switching a JSON viewer from
    tree to graph used to move the same two buttons across the row; and neither
    graph's find box had a ✕, so a term could only be removed by selecting it
    and deleting — worst on a phone, where there is no keyboard shortcut to
    fall back on.

## 0.22.7 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.6` -> `^7.23.7`: the two folds are two things, in
    two places.** The GLOBAL expand/collapse leads the toolbar, ahead of the
    find box; the PER-NODE one sits on the right of each card's own header,
    where the gobj tree has always put its `+N` / `−`.

## 0.22.6 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.5` -> `^7.23.6`: the fold pair sits on the right in
    both graphs.** They had the same drawings since `7.23.4` but in different
    places — one past the layout picker, the other in the middle of the camera
    cluster. The middle is the camera; a fold changes the document, not the view
    of it.

## 0.22.5 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.4` -> `^7.23.5`: `C_YUI_TREEDB_GRAPH` auto-registers
    its engine.** It creates a `C_G6_NODES_TREE` child by name, and without that
    gclass the failure lands as *"GClass not registered"* from inside a
    component the host never named. Both apps register it explicitly today and
    keep working — the register is idempotent.

## 0.22.4 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.3` -> `^7.23.4`: every graph's camera is built in
    one place.** `7.23.3` unified the JSON graph and stopped there; the gobj
    tree still drew actual size as a bare magnifier, fit as `arrows-to-eye` and
    fold as an eye. Both consoles show the two graphs, so the mismatch was
    visible side by side. Neither owns a camera now — they ask
    `yui_graph_camera.js` for one, and the gobj tree gains the zoom readout.

## 0.22.3 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.2` -> `^7.23.3`: one action, one drawing.** The
    JSON graph's camera used a different picture from the treedb graph's for
    the same two buttons — a bare magnifier for actual size, `arrows-to-eye`
    for fit. Both consoles show the two graphs, so the mismatch was visible
    side by side. They speak the same vocabulary now, zoom readout included.

## 0.22.2 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.1` -> `^7.23.2`: the treedb JSON popups are WINDOWS
    on a laptop, and the JSON graph picks a layout.** A schema or a cell's JSON
    is read *while* looking at the table it came from, which a modal cannot
    allow — they are movable, resizable, maximisable windows now, and stay
    modal sheets on a phone. The graph gains `vertical tree`, `dagre top-down`
    and `dagre left-right`.

    It also stops two errors both consoles logged when a JSON popup was closed:
    `Destroying a RUNNING gobj` for the graph child and `gobj NULL or
    DESTROYED` for the window destroyed twice.

    New locale entries: `vertical tree`, `dagre top-down`, `dagre left-right`.

## 0.22.1 — 2026-08-24

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.23.0` -> `^7.23.1`: the per-node fold handle in the
    JSON graph was invisible on a phone.** It was a bare `▾`, and at the zoom
    that fits a document on screen a glyph is a couple of pixels of ink. It is
    now the same filled chip the gobj tree draws (`+N` folded, `−` open).

## 0.22.0 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.22.0` -> `^7.23.0`: every non-leaf card in the JSON
    graph folds on its own.** The toolbar pair is all-or-nothing, and a graph
    you can only open whole or close whole is not navigable. Each card with a
    branch now carries its own handle; a leaf gets none.

    It also repairs a defect `7.21.0` shipped into both consoles: clicking a
    card in the graph view answered *"Event NOT DEFINED in state"*, because the
    viewer had started republishing the graph child's `EV_JSON_ITEM_CLICKED` and
    neither `c_agent_console` nor `c_tranger_view` declares it — nor should
    they, having never asked for node clicks. The event stops at the viewer now.

## 0.21.0 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.21.1` -> `^7.22.0`: the JSON graph gets a find box and
    expand/collapse.** The graph view had five ways to move the camera and none
    to find anything or to make the picture smaller, which on a real command
    answer means reading every card. Find highlights the matching rows, outlines
    their cards and says how many matched, without moving the camera;
    expand/collapse folds every card but the root and marks each cut with a
    count.

    It also repairs the viewer's toolbar on a phone: `7.21.0` let the search box
    shrink until it was a magnifier and nothing else, and in doing so removed
    the overflow that `yui_toolbar` needs to offer its scroll arrows. Both are
    back.

## 0.20.1 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.21.0` -> `^7.21.1`: the view switch reads
    `text · tree · graph`.** The row goes from the flattest reading of the
    document to the most structured. Both consoles still OPEN on the tree —
    the order of the row is not the order of arrival.

## 0.20.0 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.20.1` -> `^7.21.0`: the JSON viewer shows the same
    document as a GRAPH.** Third view after the tree and the raw text, hosting
    the `C_YUI_JSON_GRAPH` child both apps already knew how to draw — what is
    new is that you no longer leave the viewer to get it. The switch is now one
    button per view with the current one marked.

    Where it lands: every raw-JSON panel in the agent console, and the treedb
    console's Raw JSON feed — including its `__collapsed__` sentinels, which
    the graph draws as the stubs they are rather than pretending the document
    ends there.

    New locale entry in both apps: `graph view`.

## 0.19.1 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.20.0` -> `^7.20.1`: `tree view` was a key no
    validator could demand.** The view switch set its label with `t(key)` where
    `key` was a ternary, so `"tree view"` never appeared inside a `t(…)` call
    and `validate-locales` — which scans for `t("literal")` — was blind to it.
    Both apps happened to carry the key already, so nothing here rendered
    wrong; what was broken is the guarantee that it would stay that way.

## 0.19.0 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.19.4` -> `^7.20.0`: the JSON viewer shows the same
    document as raw text.** `C_YUI_JSON` had one way to read a document — the
    lazy tree — and a tree is the wrong shape for some of what people do with
    JSON here: read a command answer as it is written, take a slab of it into a
    ticket, find a string with the browser's own Ctrl+F. A toolbar switch now
    turns it into a `JSON.stringify(…, 4)` dump of the working document.

    It reaches both consoles wherever the viewer already is: the agent
    console's raw-JSON panels, and the treedb console's Raw JSON feed — where
    the text is honest about laziness, printing the `__collapsed__` sentinels
    the backend sent rather than pretending the document ends there.

    Search and expand/collapse hide with the tree; copy stays. New locale
    entries in both apps: `text view`, `tree view`,
    `text truncated; collapse some branches`.

## 0.18.3 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.19.3` -> `^7.19.4`: an action route came back to the
    MOUNT, not to where you were.** With `redirect: "back"` or `"none"` the
    shell restored `stages.main.active_route` — the route the view is DECLARED
    at — so under a node tree everything below it, which is subpath the node
    owns, was thrown away. Reported on the yunovatios console, where switching
    the theme from a deep graph landed on the workspace root; here the same
    held for `/preferences`, `/sitemap` and the dev-tools routes. The agent
    console's own theme button never showed it because it is a plain event and
    touches no route.

## 0.18.2 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.19.1` -> `^7.19.3`: a shift+click on a card no longer
    smears a text selection across the graph.** Shift+click is the browser's
    own extend-the-text-selection gesture, so the moment it came to mean
    something in the graph, marking three nodes also painted their labels blue.
    The canvas is a canvas. The popovers keep their selectable text — they
    carry record data an operator copies out.

## 0.18.1 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.19.0` -> `^7.19.1`: `1:1` was a dead button, and the
    minimap floated into the middle of the graph in full screen.** The first
    fired no event at all — the click landed on the text glyph, and G6's
    toolbar only reacts to the item itself. The second was placed in pixels
    computed once, so growing the container left it halfway up the left edge,
    on top of the graph it is there to explain; it is anchored in CSS now and
    follows the theme, instead of being a white box over a near-black canvas.

    Both reported from the deployed treedb GUI.

## 0.18.0 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.18.3` -> `^7.19.0`: the two consoles stop deciding
    their tab routes twice.** Both have a workspace whose tabs the operator
    opens, and both answered the same two questions in their own `c_app.js` —
    which is why one of them could have the first one wrong while the other
    had it right, and nothing said so. The deciding moves to
    `yui_tab_routes.js` (`yui_tab_split_subpath`, `yui_tab_position_plan`,
    `yui_tab_decode_id`), tests and all.

    `gui_treedb` loses `route_helpers.js` — `tab_position_plan` is the library
    function now, with its tests carried over — and its four subpath parses,
    plus its local `decode_tail`, go through the shared split. `gui_agent`
    loses `split_node_subpath` and the copy of the position logic it had
    inline.

    **The wiring stays where it was.** gui_treedb restores on its transport's
    `EV_ON_OPEN`, gui_agent normalizes the route as it arrives, and both are
    right about when their own tabs become real. Nothing about behaviour
    changes here: it is the same decisions, read from one place.

    Re-verified on both deployed consoles after the move: navigate deep,
    reload, url identical — `.../treedb_authzs/__graphs__`,
    `.../treedb_authzs/graph/roles`, `.../users/info`.

## 0.17.6 — 2026-08-23

### gui_agent

- **fix: F5 on a deep Schemas route landed on somebody else's default.**
    Standing on
    `#/schemas/node/<node>%1F<yuno>/treedb_authzs/__graphs__` and reloading
    answered with `.../treedb_system_schema/edit` — a different treedb, in a
    different view.

    A node tab's route is registered when the node is OPENED, so on a cold
    load it does not exist yet: the shell resolves as far as the workspace
    home (`/schemas/node`) and hands the whole rest over as the subpath —
    `<id>/treedb_authzs/__graphs__`, not `<id>`. The restore read all of it as
    the node id, matched no node, gave up and went to the first tab, which
    then stamped its own default treedb and that treedb its own default view.
    Every segment past the id was thrown away, which is why a BARE node tab
    survived a reload and nothing deeper did.

    The id is the FIRST segment now and the rest travels with it
    (`split_node_subpath`, pure and tested). Only that segment is decoded: the
    id carries a `0x1F` and reaches the url percent-encoded, but decoding the
    whole tail first would turn an encoded slash inside an id into a
    separator.

    Verified on the deployed console, both routes from the report: navigate,
    reload, and the url comes back identical.

## 0.17.5 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.17.0` -> `^7.18.3`: zoom to the selection, and the
    keys work after clicking a node.** The graph toolbar gains a
    fit-to-selection button next to `fit` — edition only, disabled while
    nothing is selected. And the keyboard reaches the graph after a card is
    clicked, which it did not: a card is a DOM element, so pressing one sent
    the focus to `<body>` and Escape, ctrl+A and Delete went nowhere. New i18n
    key: `zoom to selection`.

## 0.17.4 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.16.0` -> `^7.17.0`: the graph selection gets its
    keys.** **Esc** clears it, **ctrl/cmd+A** takes every node, and **Delete**
    deletes it behind the same confirmation the per-node icon shows — the
    record's key for one, the count for more, and the children about to be
    UNLINKED and the parents about to be detached, summed over the set. The
    keys only reach a graph that has focus, so ctrl+A typed in the find box
    still selects the text. No new i18n keys.

## 0.17.3 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.15.0` -> `^7.16.0`: the treedb graph can be
    rearranged more than one node at a time.** In edition mode, shift+click
    adds a node to the selection or takes it out, shift+drag on the canvas is a
    rubber band, and dragging any selected node moves the whole set as one
    undo. The ring is painted into the card's own html, because an html node
    draws no state style — the same trap that kept the amber highlight
    invisible until `7.3.0`. No new i18n keys: a selection has no words.

## 0.17.2 — 2026-08-23

### gui_agent, gui_treedb

- **`@yuneta/gobj-ui` `^7.14.3` -> `^7.15.0`: the graph's toolbar stops
    promising what it does not do.** The house that both consoles show over
    the treedb graph was the button people reached for to get the graph back,
    and it never gave it to them: the action is `zoomTo(1)`, which sets the
    scale and leaves the camera where it was. It is **`1:1`** now, the zoom
    level is shown next to it, the groups are separated by gaps, and both
    floating toolbars follow the theme instead of being two light islands over
    a dark canvas.

- **two i18n keys, `actual size` and `zoom level`**, in `es` and `en`. Both
    are tooltips of the toolbar above; without them the key shows on hover.

## 0.17.1 — 2026-08-23

### gui_agent

- **fix: the url For TreeDB proposes now reads the certificate the gate
    actually serves.** The scan looked for the FQDN in one place only — the
    `__ssl_certificate__` config VARIABLE — and fell through to the realm id
    when it was absent. For a backend whose realm is named
    `demo.hidrauliaconnect.es` and whose certificate says
    `hidrauliaconnect.es`, the proposal was a host that resolves nowhere,
    and the connection pasted into gui_treedb could not open.

    The evidence was in the same config all along, written the other way:
    a plain `ssl_certificate` inside the `crypto` of the gate, which is how
    the yunos that carry no such variable say it. It is now read there too
    (`cert_host_of_config`), after the variable and before the realm id. A
    yuno holds several gates and they may serve different certificates, so
    the one whose url wears the TOP port wins; with no url to match, any
    certificate beats the realm id. A wildcard certificate names no host and
    is skipped.

    The url stays a PROPOSAL — the row is editable and the connection still
    arrives disconnected — but it is now a proposal built on the name a
    client must actually use.

## 0.17.0 — 2026-08-23

### gui_treedb

- **feat: connect several connections, or disconnect them.** After pasting a
    scanned deploy centre there were two hundred rows and one plug icon each:
    removing many had its dialog, browsing many had the header box, and
    connecting many had nothing. The browse checkbox could not be borrowed for
    it — it already means "browse this treedb", and one checkbox cannot mean
    two things.

    Its own dialog then (`CONNECTIONS_CONNECT_MANY`), and not a *Connect all*
    button: what is wanted after a paste is usually *these* backends, not all
    of them. It opens showing the connect INTENT of every connection — ticked
    is connected — with a three-state select-all, so ticking everything is one
    click and disconnecting a handful is the same box. That is why it is one
    button and not two.

    The count says what Apply will CHANGE, not what is ticked (`2 to connect ·
    1 to disconnect`), and Apply stays dead while it would change nothing: a
    box opened on a half-connected set must not announce work it is not going
    to do. It applies in ONE write (`EV_SET_CONNS_ENABLED`, per-connection
    values) and therefore one reconciliation of the transports — publishing
    per connection would have the app root reconcile the whole set once per
    connection.

## 0.16.1 — 2026-08-23

### gui_treedb

- **fix: the header box of the browse column did nothing at all.** Two
    defects stacked on the same click, both found by driving the deployed
    app rather than by reading the source:

    It was born **disabled**. Tabulator draws the header before the rows
    exist, so the formatter asked "is there anything on screen to browse?",
    was told no, and painted a dead box — and the first load goes through
    `tableBuilt`, which was the one data path that did not repaint the
    header afterwards. A disabled checkbox does not even emit a click, so
    the whole feature was unreachable after an F5.

    And the click **cancelled itself**. The handler called
    `preventDefault()` so the box would never show a state the config did
    not have; cancelling a checkbox click makes the browser revert the tick
    when the dispatch ends, and the repaint the event triggers runs in a
    microtask BEFORE that. The state was written, the table repainted, the
    count updated — and then the revert landed last and put the box back.
    The lesson is in the code: a header box is repainted by what the config
    ends up holding, and the browser's own tick is left alone.

## 0.16.0 — 2026-08-23

What a paste of two hundred backends asks for: a header that takes the
column, and a document that does not decide for you.

### gui_treedb

- **feat: the browse column has a header box.** Connections had a checkbox
    per service and a tri-state one per connection, and none in the column
    header — the third level the gui_agent picker gained in 0.14.4. It has
    it now, with the same three states, covering **what the filter leaves on
    screen** (`CONNECTIONS_ALL_CHECK`): "all" over rows nobody can see is not
    what the eye agreed to. The state is counted over SERVICES, so a header
    reading "all" cannot be hiding half a connection unticked.

    One gesture is ONE write: the toggle sends a single `EV_SET_CONNS_BROWSE`
    to `C_TREEDB_CONFIG` instead of one `EV_SET_CONN_SERVICES` per
    connection, which for a pasted deploy centre was two hundred trips to
    localStorage and two hundred rebuilt pickers.

### gui_agent

- **change: the copy For TreeDB arrives with nothing ticked.** It marked
    every browsable service `selected: true`, on the grounds that the
    operator asked for the yuno and not for a subset of it. That reads
    differently at scale: pasting a scanned deploy centre into Connections
    opened every treedb of every node at once, and untick-what-I-do-not-want
    is the wrong way round when there are hundreds. The document now says
    what each yuno EXPOSES; which of it to open is decided where it is
    pasted — in one click, on the header box above.

## 0.15.1 — 2026-08-23

Two details of the 0.15.0 convergence: what was lost in adopting the picker's
shape, and what the header did differently on a phone.

### gui_treedb

- **fix: removing several connections is back, and the checkbox keeps its
    meaning.** In 0.15.0 the checkbox came to mean BROWSE in both tables —
    which was the point — and with it went the only way to remove several
    connections at once: what was left was one at a time. The *Remove several*
    button (`CONNECTIONS_DELETE_MANY`) opens a dialog with **its own** list of
    checkboxes, a three-state *select all*, and the remove button dead until
    something is ticked. The table's own checkboxes are not touched: going on
    ticking "browse" never risks a deletion.

- **fix: the fold sits beside the search box on a phone too.** The Connections
    header laid out `[title][fold]` and let the search box drop to the next
    line, so the same control appeared next to the search box in Schemas and
    next to the title in Connections. Fold and search are now **one unit that
    wraps together** (`CONNECTIONS_FINDER` / `PICKER_FINDER` /
    `STATNODES_FINDER`): in all three tables the fold is immediately left of
    the search box, at 390px as at 1440px. Measured, not assumed.

### gui_agent

- **fix: the same fold + search unit** in the Schemas node picker
    (`STATNODES_FINDER`), for the reason above: the three places the user sees
    the same table put the control in the same spot.

## 0.15.0 — 2026-08-23

### gui_treedb

- **feat: Connections and gui_agent's Schemas picker read the same.** The two
    tables show the same thing — a backend and the treedbs it exposes — and
    one is pasted **literally** into the other (the *For TreeDB* button), yet
    they were presented differently in small, expensive ways: one was a tree
    and the other a flat table with a **nested sub-table**; the checkbox meant
    "open" in one and "select for deletion" in the other; the status was a dot
    and a word against three columns of icons.

    Connections adopts the picker's shape:

    - **services are child rows**, not a table inside the row;
    - the **checkbox means BROWSE** in both, with the three states on the
      connection row (none / some / all);
    - the **status** is a dot and a word in one cell;
    - **search box and count** as in the picker (`N connections · M services ·
      K to browse`), and the general fold hugging the left edge;
    - what only exists here — edit the url, connect, clone, remove — stays
      here, as icons **at the end of the row**, in a single cell.

    With the sub-table goes what was holding it up: the `basic` renderer (it
    was there because a row was taller than its cells and the editor scrolled
    off screen), destroying the sub-tables before every reload, and recomputing
    heights. The **virtual** renderer is back, which is what hundreds of
    backends need.

    ⚠️ **Removing many by selection goes** (0.13.5): that checkbox now means
    browse. Removal stays row by row with its bin. If it is wanted back, its
    natural place is an action over the ticked connections, not the checkbox.

## 0.14.5 — 2026-08-23

### gui_agent and gui_treedb

- **fix: the general fold hugs the left edge.** It sat inside the action group
    (right) or just behind the search box, and on a phone it ended up floating
    at the end of a line: where it cannot be seen. It is now the **first
    element** of the toolbar, before the title and the search box, in all three
    tables — the Statistics/Schemas picker, the TreeDBs one and the Connections
    table. It folds what you are looking at, so it lives where the eye starts,
    and a row that wraps leaves it where it was.

    Measured at 390px: the button lands at the same x as the toolbar in all
    three.

## 0.14.4 — 2026-08-23

### gui_agent

- **feat: the picker header opens or closes EVERYTHING shown.** The third level
    was missing: there was a checkbox per yuno and one per node, and none in
    the column header. It has one now, with the same three states, and it
    covers **what the filter leaves on screen** — the same decision the shared
    facility of gobj-ui takes, and for the same reason: an "all" over rows
    nobody can see is not what the eye agreed to.

    It is written on the live element, not by rebuilding the columns: a
    `titleFormatter` runs again only on `setColumns()`, which re-renders every
    row — a whole table redrawn to move one checkbox between its three states.

### gui_treedb

- **feat: a general fold in the Connections table.** Every row opens its
    services sub-table with its chevron and there was no way to open them all.
    The same button as in the pickers, with the same icon rule, and **one
    single write** (`EV_SET_CONNS_EXPANDED`): the folded set is persisted, and
    saving it row by row would write the configuration once per connection.

## 0.14.3 — 2026-08-22

### gui_agent and gui_treedb

- **fix: on a phone the toolbar left the fold out of reach.** The buttons rode
    loose in an `is-flex` row **with no wrap** (gui_agent) or wrapping one at a
    time (gui_treedb): on a phone each button stole a little from the search
    box until it read "Search h", and the last one fell off the edge. The
    buttons now travel **together** in their own group — on one line they stay
    to the right of the search box; on a phone the whole group drops to the
    next line — and the search box grows to 22rem but never below 12.

    Measured on a phone viewport (390px), which is the only way to see it:
    jsdom does not load Bulma and a width rule is not checked by reading the
    source.

## 0.14.2 — 2026-08-22

### gui_agent

- **feat: the NODE checkbox opens or closes all its yunos, and the toolbar
    folds the whole tree.** The Statistics and Schemas picker had a checkbox
    per yuno and none on the node: opening the twelve yunos of one machine was
    twelve clicks. The node now carries its **three-state** checkbox — none,
    some (half mark), all —, a half mark opens the rest, and it only closes
    when they were all open. It is **one single write**
    (`agent_config_set_selected_nodes()` takes the whole list), not one per
    yuno.

    And the toolbar has a **general fold**: a button whose icon says what the
    click will do — chevron down while anything is still folded, chevron right
    once everything is open. It keeps up when you fold by hand too. Mind what
    it costs in Schemas: expanding a node is what arms the treedb probe of its
    yunos, so "expand everything" asks them all — which is exactly what the
    operator was about to do click by click.

### gui_treedb

- **feat: a general fold in the picker toolbar.** The same button, with the
    same icon rule, over the connections table.

## 0.14.1 — 2026-08-22

### gui_treedb

- **feat: the connection's checkbox opens or closes ALL its treedbs, app
    `0.14.1`.** Three states, which is what there is to say: none, some (half
    mark) and all. Half ticked opens the rest — that is what a click on "not
    all of it yet" invites — and it only closes when they were all open. It
    travels in **one single event** (`EV_SET_SERVICES_SELECTED`): sending a
    dozen `EV_TOGGLE_SELECTED` would save the configuration a dozen times and
    rebuild the tabs a dozen times, with the same list reaching the shell over
    and over.

- **fix: ticking no longer folds the tree.** `setData()` resets the tree and
    this table reloads on every tick, so ticking a treedb folded the very
    connection you were looking inside. What is open is now remembered and put
    back — what the operator folded by hand stays folded. Only the FIRST load
    decides on its own, and "first" means the first one **with rows**: this
    view is mounted before the connections arrive, and an empty reload counted
    as the first and left the real one folded.

## 0.14.0 — 2026-08-22

Both yunos are back on **the same version**, which is this repo's rule since
`0.3.0` and had been lost along the way (`gui_agent` was on `0.9.x` and
`gui_treedb` on `0.13.x`; the entries below keep the number each one carried
when it was written). `0.14.0` sits above both.


### gui_agent

- **chore: the framework methods answer the contract, app `0.9.12`**
    (`@yuneta/gobj-ui` `^7.14.2` -> `^7.14.3`). `C_AGENT_CONSOLE.mt_start`
    answered a bare `return;` on the empty-state panel, where the contract says
    a number. Nobody was reading it — which is the point of fixing it before
    somebody does, as the runtime's own `=== 0` guards just showed.

- **chore: `@yuneta/gobj-js` `^7.13.3` -> `^7.13.5`, app `0.9.11`** — the audit
    of that same trap across the runtime: `mt_publication_pre_filter`, `mt_play`
    and `mt_subscription_added` also read a boolean as if it were the C int.

- **fix: one delete no longer arrives five times, app `0.9.9`**
    (`@yuneta/gobj-js` `^7.13.2` -> `^7.13.3`). A treedb view subscribes to
    `EV_TREEDB_NODE_DELETED` once per topic, each with a
    `{treedb_name, topic_name}` filter — and that filter never filtered
    anything: `gobj_publish_event()` compared a BOOLEAN with `=== 0`, so a
    subscription that did not match was published to anyway. Deleting one row
    reached the table five times (once per topic of the treedb) and the four
    strays logged *"record not found"*. Measured on the wire first — one frame
    out, one answer in — which is what said the copies were being made in the
    browser.

- **fix: after deleting the selected rows, the table still described the
    selection, app `0.9.8`** (`@yuneta/gobj-ui` `^7.14.1` -> `^7.14.2`).
    Tabulator deselects a row it deletes, but SILENTLY — so no
    `EV_UNSELECT_ROWS` arrived and the bar kept counting rows that were gone,
    with Delete and Copy still enabled. Verified on the local node: tick one
    user, delete it, and the bar and both buttons go with it.

- **feat: a column drag can be undone, app `0.9.7`** (`@yuneta/gobj-ui`
    `^7.13.6` -> `^7.14.1`). Dragging a column by its handle is a WRITE —
    `order` is a field, so the drop lands in the store the moment you let go —
    and the only way back was dragging every row to where you thought it had
    been. The editor's toolbar now grows an *Undo the order* button that puts
    the columns back where they were before the dragging STARTED: the order is
    remembered once per topic, before the first drag and not before each one.
    It shows only while there is somewhere to go back to, and a refresh drops
    it. The key `"undo the order"` is defined here.

- **fix: the Schemas workspace's controls are the size of controls, app
    `0.9.6`** (`@yuneta/gobj-ui` `^7.13.3` -> `^7.13.6`). Every button and icon
    of the schema editor was `is-small`: its toolbar (Diagrama, Comprobar,
    Exportar, Importar, Nueva columna, Recargar), the back arrow, the per-row
    edit/duplicate/delete icons — `is-small` twice, the button and the icon
    inside it, so a 12px target — the version-bump button, the drag handle and
    every dialog button. They sat directly under this app's own Diferencias /
    Aplicar, which are default-sized, and read as a lesser control set. Nothing
    in `C_AGENT_TREEDB` itself needed changing: its buttons were already
    default.

    The dialogs you TYPE into followed (`7.13.5`): the labels, inputs, selects,
    textareas and flag checkboxes of the column and topic forms were the one
    size the rest of the editor had just stopped using. And a treedb card is
    wide enough for a treedb name now (`7.13.6`): the grid started at `9rem`,
    where `treedb_yuneta_agent` broke into three lines inside its own card.

    What stays small is what is data in bulk — the report tables, the crumbs
    and the export/import textareas holding a C literal or a JSON dump.

- **feat: the topic tables of the Schemas workspace say how many rows are
    ticked, app `0.9.4`** (`with_selection_bar`, `@yuneta/gobj-ui`
    `^7.12.0` -> `^7.13.3`). With 200 rows to a page, the checkboxes that
    answer that question are not all on screen, and the toolbar only went
    enabled or disabled. The bar shows in edition mode, carries no action of
    its own (Delete and Copy are right above it) and takes its two words from
    this app's i18n, which is why the flag is opt-in.

    The same gobj-ui range brings the header filter box back to a quiet
    hairline: it had been wearing the cell editor's border — one hard box per
    column across the top of every table, link-blue in dark theme.

- **chore: `@yuneta/gobj-ui` `^7.11.1` -> `^7.12.0`, app `0.9.3`.** The Schemas
    workspace's topic tables take the shared selection with it — and with it the
    fix that stops their header checkbox reaching past the header filters.
    Verified on the deployed console against wattyzer's agent treedb: filter
    `yunos` by role to 2 of 17, tick the header, and the toolbar acts on 2.

- **feat: the answer table can be narrowed to the rows you mean, app `0.9.2`.**
    `yui_copy_table_json()` has always copied the SELECTION when there is one
    and the whole screen otherwise — and this table had no way to make one, so
    half of that sentence was unreachable and Copy could only ever take
    everything. `list-yunos` on a busy node answers forty rows. The answer table
    now carries the shared checkbox column (gobj-ui `yui_table_select.js`,
    `^7.0.0` -> `^7.11.1`) and a bar that says how many are ticked.

    The bar carries **no action**, deliberately: the tables of this app are
    projections of what the control center answered — nodes, yunos, an agent's
    reply — not data this app owns, so there is nothing here to delete in bulk.
    The doing is the Copy button that was already there. For the same reason
    the two pickers get nothing: the Statistics/Schemas picker's checkbox is
    taken (it opens and closes that yuno's tab), and two checkboxes per row
    meaning two different things is worse than none.

- **fix: "For TreeDB" probes what it needs, app `0.9.1`.** The button copies the
    yunos shown as gui_treedb connections, and only a yuno KNOWN to hold a
    treedb can be one — but that knowledge arrives from a `services` probe armed
    by EXPANDING a node, and nowhere else. So over a full tree of treedb
    backends, with nothing expanded, the button answered *"no yuno with a treedb
    is shown"*; and with one node open it copied that node and said nothing
    about the rest, which is the worse half — a partial document that looks
    complete. The scan now runs in two phases: probe every shown yuno whose
    treedb state is still unknown, then ask the ones that hold a treedb where
    they listen. The round trips are bounded by what is in the table and are
    spent on one deliberate click, and the button carries `is-loading` while
    they travel.

- **fix: a collapsed node says which of its yunos are open, app `0.8.2`.** In
    Statistics and Schemas what is open is a YUNO, and the checkbox that says
    so is on a child row — invisible while the node is collapsed, which is how
    a node is read most of the time. The node row now carries the labels of its
    open yunos, the same text its tabs are named after (`+N` past the second).
    It is read from the SELECTION, not from the loaded children: it is asked
    exactly when the children are not on screen, and a node whose list-yunos
    has not answered yet has none at all.

- **fix: the status is not cut in half on a phone.** `fitColumns` leaves that
    column about half of what "Running Read only" needs, and Tabulator ends a
    cell that does not fit with an ellipsis. Name and status now WRAP instead
    (`variableHeight` grows the row), so a narrow screen shows two lines rather
    than half a sentence.

- **fix: a yuno tab names its NODE too** (`yuneta_agent · wattyzer`). Every node
    runs a `yuneta_agent`, so two tabs of two nodes read the same and there was
    no way to know which one you were typing into. The yuno stays first: it is
    what was picked and what the eye scans for, and a tab strip truncates at the
    end. Both halves are DATA — a yuno role and a hostname — never i18n keys.

- **fix: the strip of treedbs remembers what each one had open**
    (`remember_position`, gobj-ui 6.2.1). Open a topic inside a treedb, move to
    a sibling, come back — and it was at its cards, with browser Back the only
    way to the table that was there. That strip is a row of tabs and a treedb
    has a position inside it, so its item points at that position. Reported from
    `treedb_authzs/users`.

- **chore: `@yuneta/gobj-ui` `^6.0.0` -> `^6.2.1`**, which is where the schema
    editor lives.

- **feat: the Schemas workspace edits a schema AS A SCHEMA.** Every schema a
    yuno holds lives in its `treedb_system_schema`, stored as data in three flat
    topics linked by fkeys — `treedbs` -> `topics` -> `cols`. That is the right
    storage and it was the whole screen: adding one column to one topic meant
    finding it in a table holding every column of every topic of every treedb
    the yuno has, composing the parent fkey by hand, and remembering to raise a
    `topic_version` that nothing asks about.

    The new landing of that treedb is gobj-ui's **`C_YUI_SCHEMA_EDITOR`**:
    treedb -> topics -> columns in declared order, with the storage composed
    underneath. The columns **reorder by dragging** (`order` is a field, so a
    drop writes the rows whose place actually changed); the **flags** are
    checkboxes that say what they do; **check** reports what the treedb would
    refuse before the restart that finds out; **export** gives the schema as its
    C literal, because an edit made here works and lives nowhere the next build
    knows about; **import** shows a plan before it runs; and the **diagram**
    finally draws the schema being edited rather than the meta schema —
    treedbs/topics/cols, the same three cards on every yuno.

    **The versions travel with every write** and the operator is never asked to
    remember either: `topic_version`, without which the persisted
    `topic_cols.json` masks the whole edit and the restart succeeds having
    changed nothing, and `schema_version`, which is what publishes the schema as
    a whole. The Apply confirmation — the one that restarts the yuno — now says
    how many errors the check found, because that restart is what makes a broken
    schema expensive.

    The raw meta tables keep their address (`raw`, and each topic by name); a
    bare route on that treedb lands on the editor.

- **fix: the routing adapter echoes CREATED for a create.** `update-node` with
    `options.create` is an upsert and is how every view here creates a node —
    the fkey in the record only becomes a link through the `autolink` that
    travels with it. Echoed as "updated", a subscriber answered that its table
    is missing a row, which is true and is not the news.

- **fix: the FIRST route of a mount is no longer swallowed.** `null` ("nothing
    applied yet") and `""` ("the bare route") were read as one, so the route
    that decides which landing a treedb gets never arrived.

### gui_treedb

- **fix/feat: Select is a TABLE, and its checkbox is no longer forbidden, app
    `0.13.15`.** Two things crossing on the same screen:

    The checkbox arrived `disabled` when the backend was not connected, and the
    reason was written only in the branch that was NOT painted when there were
    services: the operator saw the treedb they wanted to open, could not tick
    it, and nothing said why. A selection is a PREFERENCE ("open this treedb
    here"), not an action on a live socket — so the checkbox no longer waits
    for the transport, and **the tab is created all the same**, in red while
    there is no session, with the view saying "backend not connected" right
    where the question is asked. That second half needed `C_APP`, which emitted
    the tab only if the connection had ever reached a session: between the two
    halves, ticking did nothing visible.

    And the presentation moves from card-per-connection to a **table**
    (Tabulator as a tree: the connection on top, its treedbs underneath), with
    a search box over both levels, a count (`N connections · M treedbs · K
    open`) and the virtual renderer. A deploy centre reaches hundreds of nodes:
    one card per connection with a line per service is a page of infinite
    scroll that cannot be searched either. It opens expanded with five
    connections or fewer; from there on it starts folded and the search box is
    the way.

- **chore: the framework methods answer the contract, app `0.13.14`**
    (`@yuneta/gobj-ui` `^7.14.2` -> `^7.14.3`). Two bare `return;` in
    `C_TRANGER_VIEW.mt_start` and `C_TREEDB_VIEW.mt_create`.

- **chore: `@yuneta/gobj-js` `^7.13.3` -> `^7.13.5`, app `0.13.13`** (the audit
    of the same trap across the runtime).

- **fix: one delete no longer arrives once per topic, app `0.13.11`**
    (`@yuneta/gobj-js` `^7.13.2` -> `^7.13.3`, the `__filter__` fix).

- **fix: after deleting the selected rows, the table still described the
    selection, app `0.13.10`** (`@yuneta/gobj-ui` `^7.13.6` -> `^7.14.2`).

- **chore: `@yuneta/gobj-ui` `^7.13.3` -> `^7.13.6`, app `0.13.9`** (the schema
    editor's controls stop being `is-small` and its cards fit a treedb name;
    this app does not mount that editor, so it only travels with the range).

- **feat: the topic tables say how many rows are ticked, app `0.13.7`**
    (`with_selection_bar`, `@yuneta/gobj-ui` `^7.12.0` -> `^7.13.3`). This app
    pulls each topic a PAGE at a time, 200 rows to a page — which is exactly
    why the count is worth the two i18n keys it asks for: the checkboxes that
    answer it are not all on screen. The bar shows in edition mode and carries
    no action of its own; the table's toolbar already has Delete and Copy.

    The same range brings the quiet header filter box (it had been wearing the
    cell editor's border, one hard box per column, link-blue in dark).

- **chore: `@yuneta/gobj-ui` `^7.11.1` -> `^7.12.0`, app `0.13.6`.** The topic
    tables take the shared selection with it, and with it the fix that stops
    their header checkbox reaching past the header filters — the button beside
    that checkbox deletes.

- **feat: the connections table selects rows, and removes the lot, app
    `0.13.5`.** After a scan there are twenty connections in that table, and
    removing the ones that do not belong there meant twenty trips through the
    ✕ and its confirmation. Every row now carries a checkbox (the header ticks
    what the filters leave ON SCREEN), a bar appears while something is ticked
    — "3 selected", *Remove selected*, and a way out — and the removal asks
    ONCE, naming the count and listing what is going. Selection is driven only
    by the checkbox, never by clicking the row: that row holds four editors, an
    expander and a nested table.

    The facility is **gobj-ui's**, not this app's (`yui_table_select.js`,
    `@yuneta/gobj-ui` `^7.10.3` -> `^7.11.1`): every table that can remove a row
    is eventually asked to remove twenty, and this is the second table to want
    it after the treedb topic table — which is where both of its decisions were
    learned.

- **fix: an import ADDS WHAT IS NEW, app `0.13.4`.** Every imported connection
    was given a fresh id, and a fresh id is a new row by construction — so
    pasting the document again duplicated the whole set. And it IS pasted
    again: the agent console rebuilds it whole on every scan, so the paste that
    brings the one yuno a node has gained brings the twenty it already had with
    it. The set already configured is now matched first, by what identifies a
    connection — its url and the service reached through it, not its id and not
    its label, which is edited here and must not turn a re-paste into a second
    row of the same thing. A connection already present is left ALONE: it may
    have been edited since (a host fixed by hand, services unticked), and the
    document arriving is not more authoritative than that. The view says what
    happened ("3 added · 20 already here"), because an import that adds nothing
    is a correct outcome and used to look like a button that did nothing. The
    decision is a pure function with its own tests (`conn_helpers.js`).

- **fix: coming back from Select lands where the tab was left, app `0.7.5`.**
    A tab replays its position when it is ENTERED AGAIN, and "again" is
    decided by whether the previous route was another tab. The picker returned
    from that decision early, so the tab it left behind stayed on record as
    the one we were in: going to Select and back read exactly like the view's
    own "← Topics" (walking UP out of a topic), which does not replay — and
    RECORDS the root, so the position was not only skipped, it was erased.

    The tab we were in is now consumed at the one point every route passes
    through and written again only by the tab branch, so a route that forgets
    to clear it cannot exist.

- **feat: a Topics tab says which node it browses, app `0.7.4`.** A tab is
    labelled with the treedb name, and a treedb name is not unique across
    backends: two tabs reading `treedb_yuneta_agent` are two different machines.
    The connection url now prints in the view's toolbar (gobj-ui `source_url`),
    not in the tab label — a tab wide enough for
    `wss://artgins.yunetacontrol.com:1996` is a tab bar with room for one tab.

- **change: Connections is the third rail entry, not the first.** The rail opens
    on the work — Topics, Graphs — and the backends are where you go when one
    has to be added or fixed, which is not what a session is spent doing. The
    landing route is unchanged (`/topics/select`), and `/connections` is the
    same route, linkable and in the site map as before.

- **chore: `@yuneta/gobj-ui` `^6.2.1` -> `^6.3.0`**, which is where `source_url`
    lives.

- **fix: a tab keeps what it had open, app `0.7.3`.** Which tab was active was
    already remembered; the topic open inside it was not, so clicking back onto
    a tab landed on its cards and browser Back was the only way to the table
    that was there.

    A tab's nav item is a FIXED route — `yui_shell_set_submenu()` registers it
    in the shell's item index, and that route is where the tab's view is
    MOUNTED and what a deep link resolves to — so the position cannot travel in
    the item the way it does in a `C_YUI_NODE` tree. It is replayed when the tab
    is ENTERED AGAIN, which is the whole subtlety: arriving at the root of the
    tab you were already in is the way OUT of a topic (the view's own
    "← Topics" button), and replaying there would make that button do nothing.
    The decision is a tested function, `tab_position_plan()`.

- **chore: `@yuneta/gobj-ui` `^6.0.0` -> `^6.2.1`, app `0.7.2`.** A
    dependency-only bump, so the two consumers of the v2 line stay on one
    version. Nothing in 6.2.x changes what this app does either: the nav item
    that points at a remembered position is opt-in (`remember_position`) and
    this app does not set it — worth knowing that the option exists, because
    its own workspaces have the same shape. Nothing in 6.1.x changes what this app draws: the schema landing
    it mounts is handed a `node_route` (`card_action_routes` in `c_app.js`), so
    a node click is a hash navigation here exactly as before — and since 6.1.2
    publishing that click instead is opt-in (`with_node_click`), which this app
    does not set.

### gui_agent and gui_treedb

- **chore: `@yuneta/gobj-js` `^7.12.0` -> `^7.13.2`, `@yuneta/gobj-ui`
    `^5.17.0` -> `^6.0.0`**, which is where a `qualified` pkey becomes a key
    the store hands out instead of one the operator is asked to type.

    The SDK re-keyed the `topics` and `cols` topics of
    `treedb_system_schema`: they carried a rowid, they now carry the qualified
    name — the id of the parent, a dot, and the record's own name
    (`treedb_yunovatioscodb.yunos.yuno_role`). For the Schemas workspace that
    changes three things: a card is labelled by the leaf and not by the whole
    path, the create form stops asking for the id, and **editing a column is an
    update**. It used to be a create — a rowid pkey has no update — so every
    save appended a second column under the same name.

    gobj-ui 6.0.0 is a dependency-only major: no API moved, it raises its own
    peer floor to gobj-js `^7.13.2`, which is why both ranges travel together.
    Against a node whose SDK still keys those topics by rowid nothing changes;
    the flag is absent and every path takes its previous branch.

- **chore: `@yuneta/gobj-ui` `^5.16.0` -> `^5.17.0`**, which is where both
    treedb views learned to be readable on a schema.

    `C_YUI_TREEDB_SCHEMA` (the `/schema` landing of a treedb) now draws what a
    schema `.c` literal draws in ASCII — one card per topic with its fields, one
    edge per hook leaving the row that declares it — instead of one labelled dot
    per topic. On `treedb_system_schema` that is the difference between three
    boxes and a fan of 163 numbered nodes.

    `C_G6_NODES_TREE` (the record graph) now labels a card by the topic's
    SECONDARY key when the primary one is a rowid or a uuid, keeping the pkey as
    the tooltip. That is what the Schemas workspace was showing as `181`, `225`,
    `193`: `treedb_system_schema` keys `topics` and `cols` by rowid and holds
    the name in `value`. It needs a node built from SDK > 7.13.0, whose
    `tranger2_topic_desc()` carries `pkey2s`; against an older node the label
    falls back to the id as before.

### gui_agent

- **feat(schemas): a `Differences` button says what the stored schema holds
    that the schema in C does not.** The workspace edits a schema that lives in
    `__system__` as data, the projector never deletes, and a re-projection
    publishes under a version of its own — so `schema_version` 24 over
    `c_schema_version` 23 is the shape of an operator edit AND the shape of a
    plain re-projection, and nothing here told them apart.

    The button asks each `C_TREEDB` service the yuno exposes (discovery already
    listed them; it kept only the `C_NODE` ones) for `diff-schema` (SDK >
    7.13.0), and reports one row per difference: `kind`, treedb, topic, column,
    attribute, stored value, value from C. A service that refuses or does not
    know the command says so in the same dialog, next to the ones that
    answered.

    Read-only, so it opens a report and confirms nothing. It is an FSM action
    (`EV_DIFF_SCHEMA` in `ST_READY`) whose answer arrives as
    `EV_MT_COMMAND_ANSWER` under its own `console_purpose`, like the discovery
    and the per-treedb `treedb-info` beside it. An `Apply` started while a
    comparison is in flight drops it: during the restart sequence every answer
    is routed to the apply steps.

- **feat: the node's own AGENT is offered in the Schemas picker.** It never
    appears in `list-yunos` — it is the daemon that answers that command, not
    one of the yunos it manages — and yet it runs the same kind of services,
    its treedbs included (`treedb_yuneta_agent`, `treedb_system_schema`,
    `treedb_authzs`), which were unreachable from this console.

    The picker prepends a row for it under the sentinel yuno id `__agent__`,
    and everything downstream is unchanged except ONE line: the inner command
    is the agent's own `command-agent service=<treedb>` instead of
    `command-yuno id=<yuno> service=<treedb>`. That line is
    `cmd2agent_service()` in `agent_helpers.js` (3 unit tests), used by the
    four places that address a service behind an agent — the picker's treedb
    and master probes, the tab's discovery, and the routing adapter.

    On the `.ovh` plane the same row reaches **`yuneta_agent22`**: `deploy.js`
    maps the serving host to its control center, so the two planes need no
    separate code.

    **Apply is disabled on that tab.** Applying is restarting the owning yuno
    and the agent is not one of them — `kill-yuno` does nothing to it, it is
    restarted on the node with `--stop` / `--start`. The button says so, and
    the event is refused as well: hiding a button is not refusing an action.

- **fix: a tab forgot where you were inside it.** Open a topic in a Schemas
    tab, look at another tab, come back — and you landed on the treedb cards
    with the topic gone. A tab's nav item carries a FIXED route (its base), so
    clicking it always navigated to the root and the position was thrown away.

    The route cannot simply be made deeper: `yui_shell_set_submenu()` registers
    `item.route` in the shell's item index, so it is where that tab's view is
    MOUNTED and what a deep link resolves to — moving it would move the mount
    and prune the base. `C_APP` remembers the last position of each tab
    instead, and replays it when the tab is entered again.

    "Entered again" is the whole subtlety: arriving at the root of the tab you
    were already in is the way OUT of a topic — the view's own *Topics* button
    — and replaying the position there would make that button do nothing. So
    the restore only fires when the previous route belonged to a DIFFERENT tab,
    and walking up inside a tab is itself recorded as the new position. The
    memory is dropped when a tab is closed.

- **feat: the record GRAPH is a position of the Schemas url.** Under a treedb
    the subpath is now `<topic>[/info]`, `schema` or **`graph[/<topic>]`**, and
    the third icon of every topic card goes to the last one:
    `C_AGENT_TREEDB_VIEW` hosts gobj-ui's `C_YUI_TREEDB_GRAPH` beside the topic
    editor, on the SAME routing adapter, and swaps the two bodies by url. The
    graph's *Topics* button comes back to the cards. Not a sibling tab as in
    `gui_treedb`: here a tab is a YUNO.

    It is mounted **lazily**, on the first navigation to `graph` — G6 is the
    heaviest thing this workspace can draw, most visits never ask for it, and it
    measures its canvas when first shown, so a graph created hidden would size
    itself to a zero rect. It opens with the **`dagre`** layout rather than the
    library's `manual`, which places nodes where the records say they are: a
    schema treedb carries no geometry, so it opened as one diagonal pile of 265
    `cols`. Only the first value — `layout` is `SDF_PERSIST` and loaded after
    the mount kw, so the operator's choice wins from the second visit on.

    A replica hands the graph the same `readonly` the editor gets, and it loses
    its `edition` mode. A write made in the graph marks *Apply* like one made in
    the table; a save of the graph LAYOUT does not, because it lands in the
    treedb's `__graphs__` topic and is the view's own bookkeeping.

- **fix: the adapter did not declare the treedb LINK events.** The graph
    subscribes to `EV_TREEDB_NODE_LINKED` / `EV_TREEDB_NODE_UNLINKED` on its
    transport the moment it loads a topic, and `gobj_subscribe_event` refuses an
    event that is not in the publisher's output list — so leaving them out of
    `C_AGENT_TREEDB_LINK` did not cost an edge that fails to redraw, it cost the
    SUBSCRIPTION, refused with an error before any write happened. They are
    declared and echoed now, rebuilt from the two refs of the REQUEST
    (`<topic>^<id>[^<hook>]`), which is the only place a link is described: the
    answer of `link-nodes` does not carry them.

- **fix: every Schemas tab was eating the other tabs' `treedb-info` answers.**
    Introduced by the read-only wiring the same day and caught in the browser
    console: *"C_AGENT_TREEDB^view_schemas_node: no route for this tab: no tree
    can be rooted"*, repeating once per answer.

    Two mistakes, and the second is why the first could not be caught by the
    existing guard: the new `treedb-info` branch went in **above** the filter
    that checks the answer belongs to THIS tab, and the probe never tagged
    `console_node` / `console_yuno`, so the filter had nothing to match on
    anyway. Every open tab — and the empty-state view of the workspace, which
    has no node and therefore no route — counted every other tab's answers as
    its own and went on to build a tree from them.

    The filter now runs FIRST and covers both purposes, the probe tags its node
    and yuno like the discovery request does, a probe without them refuses to
    ask instead of asking for `id=""`, and the accounting ignores an answer
    when nothing is owed, so a late or duplicated one cannot walk into a build.

- **A replica opens READ-ONLY in the editor.** Knowing a treedb cannot be
    written was half the job; the other half is not offering to write it. The
    Schemas tab asks each discovered treedb `treedb-info` before it builds its
    tree — the library reads `readonly` once, when it draws a topic's toolbar —
    and mounts the editor with gobj-ui `^5.15.0`'s new `readonly`: no edition
    mode, no *new* / *delete* / *paste*, no in-row edit icons, and the record
    form opens with its cells locked and only *copy* on the toolbar. The form
    still opens: reading a record is the point of a replica.

    Unknown mounts WRITABLE. A node older than the command answers "command not
    available", and locking its editor would take away an editing session that
    works today — its writes are the pre-7.13.0 behaviour, which is a reason to
    upgrade the node, not to guess in the browser.

    Verified on the deployed plane against one node holding both cases:
    `gate_central^2020`'s replica of `treedb_authzs` mounted with **0** new /
    delete / edit buttons and **0** in-row trash icons, `db_history_ce^1620`'s
    own `treedb_system_schema` with all of them, no console errors.

- **The Schemas picker says whether a yuno can be EDITED: master, read only or
    mixed.** Only the master of a treedb's tranger can write — the yuno refuses
    otherwise (SDK 7.13.0) — so a replica is a read-only visit, and that is the
    first thing an operator opening a schema editor needs to know.

    It cost a kernel command to get: `master` is an `SDF_RD` attr of the
    tranger, absent from `services`, from `treedbs` and from the stats, so the
    only place it surfaced was the whole `print-tranger` dump. `C_NODE`
    answers `treedb-info` now, and the picker asks it once per treedb right
    after the `services` probe that discovered them.

    The label is per YUNO but the flag is per TREEDB, and they can disagree: a
    yuno is routinely the master of its `treedb_system_schema` and a replica of
    a data treedb it shares with another yuno. So the row counts masters
    against the total — all of them *Master*, none *Read only*, some
    *Master (some)*.

    Two silences are deliberate. Nothing is shown until **every** treedb of the
    yuno has answered, and nothing at all when one of them **could not** answer
    — a node older than the command replies "command not available", and
    counting that as "not master" would label every pre-7.13.0 node read-only,
    which is a claim this app cannot make. Verified live against a node whose
    yunos were in all three states at once: `db_history_ce^1620` *Master*,
    `gate_central^2020` *Read only* (1620 holds the shared store), and the two
    yunos still on an older binary showing nothing.

- **The Schemas picker lists only yunos that HAVE a treedb.** They used to be
    listed with the checkbox off and *"this yuno exposes no treedb"* in the
    status column — a row whose only purpose was to be refused. In this
    workspace such a yuno leads nowhere, so it is not in the list.

    Two rules survive the change. A **known** "none" is what gets dropped: a
    probe in flight or one that failed (no permission, dropped link) keeps its
    row, because "could not ask" is not "has none". And a yuno that is already
    **selected** stays visible whatever the probe says — it has an open tab, and
    a tab whose row vanished from the picker could not be unchecked. The status
    text stays for that case. A node whose every yuno was filtered out shows one
    grey line, *"no yuno with a treedb"*, instead of an expander that opens into
    nothing.

    It took two bugs to actually work, both worth knowing:

    - `set_yuno_treedbs()` answered a probe with `refresh_active()`, which only
      re-runs the FORMATTERS of the rows already on screen. Dropping a row is a
      data change, so the row stayed, greyed, saying it had no treedb. It now
      rebuilds (the posted `EV_RENDER_TREE`, which collapses the flurry of
      per-yuno answers into one `setData`).
    - and that rebuild **closed the node the operator had open**: Tabulator's
      `setData` resets the tree and `dataTreeStartExpanded` is false. Since this
      workspace now rebuilds precisely while someone is looking at an expanded
      node, `ac_render_tree` remembers which nodes are open and re-expands them
      after the data lands.

### gui_treedb

- **Connections moved from the account menu to the rail.** The backends are
    where a session starts and both work entries depend on them, so they are
    the first rail item now — **Connections / Topics / Graphs** — instead of an
    entry under the toolbar avatar, which keeps `/preferences` and the
    developer / informative entries.

    The rail item declares a `route` and **no** `target`: `/connections` is
    already in `shell.routes`, and `build_item_index()` fills a menu entry that
    has a route but no target from there, so only one place says which gclass
    the backends page is. It has no submenu either, so the tab strip collapses
    while it is on stage.

    And the workspace picker — tab 0 of Topics/Graphs — is **Select**
    (`yi-square-check`) instead of *Connections*, **path included**:
    `/<ws>/connections` → **`/<ws>/select`**. Two different pages had carried
    that one name: the backends manager and the tab where you tick which
    treedbs of a backend to open. It went unnoticed while one of them hid under
    the avatar; with both on screen at once it had to give — and a name has to
    say what the thing is, in the URL as much as on the tab.

    Two consequences worth knowing. A bookmark of `/<ws>/connections` no longer
    resolves — this is a browser-local dev tool, so there is no redirect from
    the old path. And the persisted active-tab sentinel `"__connections__"`
    became `"__picker__"`; a value stored under the old name simply falls
    through to the first open treedb tab, once.

- **fix: `EV_RECORD_WRITTEN` was an FSM error on every write.** Both hosted
    views publish it to their parent (CHILD subscription model) and
    `C_TREEDB_VIEW` did not declare it, so each write logged *"Event NOT DEFINED
    in state"*. This app is a data browser and has nothing to finish after a
    write — the views redraw from the treedb's own `EV_TREEDB_NODE_*` — so the
    action is empty and says why.

## 0.7.0 — 2026-08-17

### gui_agent

- **The first unit tests of this SPA, and nine functions that were copied
    around.** `vitest` sat in devDependencies with no `test` script and no test
    file. What is testable without a yuno, a shell and a backend is the
    data-in/data-out half, so it now lives in `src/agent_helpers.js` with
    `src/agent_helpers.test.js` over it — the same split gui_treedb made with
    `tranger_helpers.js`. **43 tests**, `npm test`.

    The extraction paid for itself twice: **five** of those functions were
    duplicated verbatim between the two node pickers (`version_tuple` /
    `version_gte` / `version_cmp` / `node_id` / `parse_agent_line`), `esc` sat
    in three files and `clear_node` in four. Identical copies today, which is
    what a pair of files looks like right before one of them gets fixed alone.

    What the tests pin is the edge cases, because that is where these
    functions earn their keep — they exist to survive input the app does not
    control: `7.10.0 > 7.9.0` (the reason the version column is not a string
    sort, asserted next to what a string sort would have said), a
    `list-agents` line missing half its fields answering `""` and never
    `undefined` (which Tabulator renders as the word), `error ""` passing an
    empty argument through the quote-aware splitter, a legacy plain-string
    command history collapsing into `{cmd, count, last}` without losing its
    order, and `$1` not eating the `1` of `$10`.

    That last one is worth the paragraph: the suite passed on the first run,
    which is never a good sign, so I mutated the three functions the tests
    claim to protect. Two mutations were caught. The `$1`/`$10` one was NOT —
    the test used `a1…a11` as values, and replacing `$1` first turns `$10`
    into `a10`, which is accidentally the right answer. The test now uses
    values that do not look like their own index, and fails against the
    broken order.

    Deliberately NOT extracted: anything that reads a gobj attr or touches
    the DOM. `expand_shortkey` stays in the console because it reads the
    shortkey dict off the config service; what moved is its pure half,
    `apply_shortkey(shortkeys, cmd)`.

- **The login screen stops moving, and a dead view is gone.** `login.css` was
    the last place in the app with animation: two ambient orbs drifting on a 22 s
    loop, a conic-gradient spark rotating on a 24 s one, and the card fading up
    380 ms on every load — plus transitions on the quick buttons, the inputs, the
    password toggle and the CTA. All removed, including the CTA's 1px hover lift
    (a lift only makes sense animated; jumping it instantly is a glitch, not an
    affordance — the shadow change carries the hover). The
    `prefers-reduced-motion` block went with them: it had nothing left to reduce.
    The header now says the screen is static, so nobody re-adds it. Nothing in JS
    hooked any of it, and the card's fade used `both` fill rather than a separate
    `opacity: 0`, so removing the declaration leaves it fully visible.

- **`src/c_gui_agent_view.js` deleted** — 248 lines of "placeholder view" from
    the Phase-0 scaffold, still registered in `main.js` and referenced by no
    route and no other gclass since the four workspaces landed. It was the one
    file left with zero logical DOM names, and decorating code that never
    renders would only have hidden it.

- **The DOM says what it is: logical names on every block, and two views stop
    answering to the same prefix.** A bare `<pre class="is-size-7 mb-2">` is
    unidentifiable in the Inspector, which is why the convention exists — and
    most of this app was ignoring it: the Preferences page carried **2** logical
    names in 745 lines, the counter cards 2, the terminal 2, both node pickers 2
    each. They now carry 52, 20, 12, 14 and 17.

    The collision was the part that actually cost something. The nodes→yunos
    **picker** (`C_STATS_NODES`) wrote `STATS_TOOLBAR` / `STATS_REFRESH` /
    `STATS_COPY` while the **cards** view (`C_AGENT_STATS`) wrote `STATS_CARD` /
    `STATS_TABLE` / `STATS_RESET` — so `.STATS_REFRESH` matched a control in a
    view that does not own it, and since the picker stays mounted (hidden) next
    to the open tab, aiming at the Statistics Refresh hit the invisible one.
    That is exactly what a per-view prefix prevents: the picker is `STATNODES_*`
    now, and each view's prefix is listed in the README.

    Tabulator draws its cells from HTML strings, so the names had to go in the
    formatters too (`NODES_HOST`, `NODES_SEL`, `STATNODES_YUNO`, `STATS_VALUE`,
    …) — the only way to identify a cell in devtools.

- **`is-small` is gone from every button except the mobile key bar.** A small
    control is hard to hit and makes the action read as chrome; the user's rule
    is default size or bigger. Promoted: the Statistics *Refresh* and per-card
    *Reset*, the console's *Copy* and font steppers (whose comment claimed
    `is-small` was needed "to match the adjacent copy button" — it was matching
    itself), the three history-row buttons and the Recent/Frequent sort, the
    Terminal's *Reconnect* and font buttons, and the whole shortkeys manager
    (both inputs, *Add*, and the per-row delete). Each icon dropped its
    `icon is-small` in the same edit so the glyph keeps its proportion.

    `TTY_KEY` keeps it, with the reason written next to it: nine keys have to
    fit across a 360px phone, the dense-grid exception.

- **The FSM sweep reaches the rest of the app: every action crosses the
    automaton now.** An earlier pass did the node tables and parts of the
    console, and its changelog line claimed more than it delivered — the four
    places that were left are the ones an operator uses most:

    - **Executing a command** (Enter and the Execute button) went straight from
      the DOM handler to `send_command()`, so the central action of the
      Commands workspace appeared NOWHERE in the `machine` trace. It is
      `EV_EXEC_COMMAND` now, and so are Clear, Copy, the A− / A+ font nudge,
      the two popover triggers, the outside-click that closes them, Tab
      completion, Up/Down history recall, typing (`EV_INPUT_CHANGED`), the
      Recent/Frequent sort and the three per-row history buttons.
    - **The whole Preferences page** ran outside the FSM: an empty
      `event_types`, one `ST_IDLE` with no actions, and every control's work in
      a closure. Theme, language, navigation shape, answer display, Statistics
      layout and refresh, the two font-size defaults and the shortkeys manager
      are ten events with ten actions.
    - **The Terminal's key bar, Reconnect and font buttons** — `EV_KEY` carries
      the key's literal sequence, so the sticky-Ctrl / soft-keyboard / Paste
      pseudo-keys are decided in the action, not in a `pointerdown` closure.
    - **The Statistics Refresh and per-card Reset buttons**, plus the
      show/hide of the tab (`EV_VISIBILITY`), which used to arm and disarm the
      poll from inside a `MutationObserver` callback.

    Two rules held throughout: a `kw` is plain JSON — a card's Reset sends
    `{node, yuno_id}`, a bar key sends `{seq}`, a popover sends `{kind}`, never
    the element — and where the browser demands a synchronous answer (Tab, to
    decide `preventDefault`) the action reports back through `priv`, because a
    DOM event must never travel in a kw.

    One carve-out, deliberate and commented: xterm's `onData` stays a plain
    call. It is a BYTE STREAM, not an action — one event per character would
    bury the trace of the tab under the typing, the same reason Tabulator's
    `ajaxRequestFunc` is not an event either.

- **The Statistics auto-refresh is a `C_TIMER`, not a `setInterval`.** The
    polling is a sanctioned exception to the no-polling rule; the invisible
    tick was not. It is a PERIODIC timer now, so each tick arrives as
    `EV_TIMEOUT_PERIODIC` — and the framework silences exactly that event
    through its own `timer_periodic` trace level (already set in `main.js`), so
    the FSM gains the tick without the trace drowning in it.

- **Five `setTimeout(…, 0)` deferrals became posted events**
    (`gobj_post_event`, which is what a deferral IS): route normalization after
    an F5 or a Statistics layout change (`EV_NORMALIZE_ROUTE`, `c_app`), the
    one-`setData` debounce of the nodes→yunos tree (`EV_RENDER_TREE`), the
    Terminal's deferred xterm boot (`EV_TTY_BOOT`) and its self-close on
    `exit` (`EV_CLOSE_TAB`). The Paste key's ✗ flash now returns on
    `EV_TIMEOUT` from a `C_TIMER` like every other flash in the app. The only
    surviving `window.setTimeout` is the Schemas Apply watchdog — a real time,
    which is what a timer is for.

- **The Preferences page follows a language switch made from the toolbar.**
    Which option is ACTIVE in the theme and language segments is markup, not a
    translatable string, so `refresh_language()` could not move it: the page
    subscribes to the shell's `EV_LANGUAGE_CHANGED` and re-renders.

- **Documentation caught up with the app** (`README.md`, `main.js`,
    `scripts/qa.mjs`): the libraries come from the **npm registry**, not from
    `file:` deps on the `kernel/js/*` checkouts; the app is served at
    `artgins.yunetacontrol.com` / `.ovh` with its endpoints DERIVED from the
    hostname (`src/conf/deploy.js`), not typed by the user into a form and not
    at an `agents.yunetacontrol.com` that was never deployed — so the "config
    lives in the browser" section now says what actually lives there (the
    operator's own preferences) and points at Diagnostics for the read-only
    endpoint pair; `src/conf/defaults.js` was cited and does not exist; the
    delivered phase table became a table of what is still OPEN, led by
    operating yunos from the GUI (`kill-yuno` / `run-yuno` / binaries / configs
    / snaps are reachable only by typing them into Commands today); and the QA
    driver's usage examples name routes that exist (`/commands/nodes`, not
    `/nodes`).

- **Preferences left the primary rail for the account menu.** The rail is the
    WORK of the console and every option on it now opens a workspace: Commands,
    Statistics, Terminal, Schemas. The settings page moved to `/preferences`,
    reached from the toolbar avatar — where a user looks for their own
    settings, and where the yunovatios SPAs already put it. It stays a ROUTE
    and not a dialog, so it is linkable, survives an F5 and appears in the site
    map. `/settings` is gone: the page is the same one, at the new address.

- **The treedbs of a Schemas tab are a tree of nodes, and the operator chooses
    how depth is drawn.** What discovery answers is a level of navigation —
    yuno → treedb → topic — so it is declared as one: the tab roots a
    `C_YUI_NODE` at its own route with one child per discovered treedb, each a
    `link` node whose viewer (the new `C_AGENT_TREEDB_VIEW`) owns everything
    below it in the url. The `<select>` that used to switch treedb is gone; the
    tree draws the way in, the shape of the workspace reaches the site map by
    itself, and the url is unchanged (`<treedb>[/<topic>[/info]]`).

    On top of it, **Preferences → Navigation**: *stacked strips* (the default,
    a strip of treedbs above the open one), *back to parent* (a single
    `← treedbs`) or *breadcrumb* (the trail as one line). It is one choice for
    the app, persisted in the browser, and it applies to the OPEN tabs on the
    spot — a mode filters what each node draws, so nothing is re-mounted and
    the open treedb stays open.

    Two consequences worth knowing: landing on a tab with no treedb in the url
    now shows the treedbs as CARDS (the tree's index) instead of jumping into
    the last one — which is what makes "back to parent" and the breadcrumb able
    to reach that level at all; and a fresh tab still opens
    `treedb_system_schema` directly, because that is what the workspace is for.

- **Applying a schema, from the tab that edited it.** An edited schema reaches
    its yuno when the yuno re-reads it, which means a restart — so the Schemas
    tab now does it: `kill-yuno` → `run-yuno play=0` → `play-yuno`, behind a
    confirmation that names the yuno and says every client of it is
    disconnected. A write marks the button until the next apply.

    The sequence is chained on the ANSWERS, with no timer and no polling: each
    of those commands answers only when it is done (the agent waits for the
    killed yuno's channel to close, and for the launched one to connect back).
    `play=0` is deliberate — with the implicit play, `run-yuno` answers twice,
    and a step that answers twice advances the sequence twice. It ends by
    re-discovering, which re-mounts the view against the schema the yuno has
    just read. One state per step (`ST_KILLING`, `ST_STARTING`, `ST_PLAYING`)
    so the trace says which answer is being waited for.

    Two things came out of building it, and both were silent:

    - **The agent dropped those answers for any client behind a
      controlcenter** — the yuno was killed and nothing came back. Fixed in the
      SDK (`ac_final_count`, see its CHANGELOG); the tab additionally gives up
      after 30 s and says so, because after a `kill` a silent wait means a
      yuno that is DOWN and nobody told.
    - **`set_timeout` imported from gobj-js is not the browser's.** It drives a
      C_TIMER gobj; called browser-style it logs *"not GObj TYPE"* and arms
      nothing — and importing it SHADOWS the global, so the deferred mount of
      the previous change had never actually deferred either. The deferral is
      now a posted event (`gobj_post_event`, which is what a deferral is), and
      the deadline — a real time — a plain `setTimeout`.

- **The URL of a Schemas tab carries the position.** Under the tab's route the
    subpath is now `<treedb>[/<topic>[/info]]` (or `<treedb>/schema`), so a
    reload, a browser Back or a link sent to a colleague lands on the same
    treedb and the same topic instead of on the default grid.

    The first segment is the tab's — changing it is a remount, and it goes
    through the same event the selector sends — and the rest is the hosted
    view's: it is mounted with `base_route` = `<tab route>/<treedb>`, so the
    card icons and the landing toggle are hash anchors the LIBRARY builds and
    navigates, with no bridging code here. The tab only mirrors the topic
    selection it receives (`EV_TOPIC_SELECTED`) and applies what arrives in
    `EV_ROUTE_CHANGED`, with the usual `seg` dedup breaking the
    child → navigate → route_changed → child loop.

    Two conventions, learned the hard way in the same hour: `base_route` is a
    ROUTE (what the shell matches, what the site map lists) while the
    card/landing templates are HREFS and must carry the `#` — without it the
    anchor is a path, and clicking it LEAVES the SPA. And the mount stamps its
    treedb with `push: false`: nobody navigated there, so it must not become a
    Back entry.

- **The Schemas picker marks the yunos with no treedb.** Expanding a node in
    the tree probes each of its yunos with the same `services` call the tab
    makes, and a yuno whose answer carries no `C_NODE` service is shown as such
    — status column and checkbox off — so a dead end is visible BEFORE a tab is
    opened for it. On this node that is 6 of the 11 running yunos.

    On EXPAND and only in this workspace, because it is one round trip per
    yuno and a node holds a dozen: the tree the operator does not open costs
    nothing. A probe that failed or has not answered leaves the row alone —
    "could not ask" is not "has none", and marking on a permission error would
    send the operator looking for a treedb that is there.

    The flag reaches the picker as a kw key, and only when true: an attr the
    gclass does not declare fails the WHOLE load ("GClass Attribute NOT FOUND"
    + "json2data() FAILED"), so the flat C_NODES picker of Commands/Terminal
    must not be handed it, not even as `false`.

- **Schemas discovers the yuno's treedbs instead of assuming one.** A yuno
    exposes its treedbs as services, so one round trip answers which ones there
    are — `command-yuno id=<yuno> service=__yuno__ command=services`, whose
    `C_NODE` rows are the treedbs this console can talk to. They fill a selector
    in the tab toolbar with `treedb_system_schema` first and selected: it is
    what the workspace is for. Picking another tears the mount down — view AND
    adapter, because the adapter holds the requests in flight for THAT view and
    an answer of the old one landing in the new table is the bug this avoids —
    and builds a fresh pair.

    The other treedbs are offered, not hidden: an operator already on the node
    should not need a second SPA and a second session to look at the data.
    `gui_treedb` stays the browser for someone whose job IS the data.

    Discovery also answers the question the tab could not ask: a yuno with NO
    treedb — a gate, a yuno carrying only a timeranger — now says so, instead of
    mounting a view that answers with an error toast per topic. The tab models
    it as states rather than flags: `ST_IDLE` (no yuno, or no session),
    `ST_DISCOVERING`, `ST_EMPTY`, `ST_READY`.

    One CSS scar on the way: the toolbar carried Bulma's `is-flex`, which is
    `!important` and beat the `is-hidden` toggling it — an empty selector stayed
    on screen for a yuno with no treedb. Inline `display:flex` + `is-hidden`
    behaves, because an `!important` rule does beat a non-important inline
    style.

- **A fifth workspace: Schemas — the treedb editor over the agent's control
    plane.** gobj-ui's `C_YUI_TREEDB_TOPICS` is mounted **unchanged** against
    one yuno's `treedb_system_schema` (the treedb that holds that yuno's schemas
    as data: `treedbs` → `topics` → `cols`), so a schema can be edited from the
    browser instead of from the C literal. It lands here and not in `gui_treedb`
    for a structural reason: applying a schema change means restarting the
    owning yuno, and the lifecycle commands are the agent's.

    The piece that made it possible without touching the library is
    `C_AGENT_TREEDB_LINK`, a **routing adapter**. The views issue
    `gobj_command(remote, …)` and expect `EV_MT_COMMAND_ANSWER` — one hop with a
    direct `C_IEVENT_CLI`, but two from this console. `gobj_command()` dispatches
    to `gclass.gmt.mt_command_parser` before anything else, so the adapter takes
    the command verbatim, re-wraps it as `command-agent` +
    `cmd2agent="command-yuno id=… service=… command=…"`, and hands the answer
    back in the shape the view already reads — its own command back on top of the
    `command_stack`, which is what the view keys everything on. Handed to
    `yui_mount_service_view()` as the `transport`, the library works as if it
    were talking to a treedb directly, through ONE session and ONE login.

    Three traps it is born knowing, each of them a way this silently does not
    work: `command-yuno` uses its **whole kw as the yuno filter** (so a
    top-level `id` names the yuno — refused loudly here — while `treedb_name` /
    `topic_name` / `record` / `options` travel safely, being no columns of the
    agent's `yunos` topic); the controlcenter's `command-agent` **deletes**
    id/command/service from the kw, so they travel inline in the `cmd2agent`
    line; and routing **loses the live subscriptions**, so the adapter echoes
    the `EV_TREEDB_NODE_*` of its own writes locally — otherwise a saved record
    leaves a stale table, which reads as a failed write.

    The adapter is a real transport façade, states included: `ST_DISCONNECTED` /
    `ST_SESSION` driven by the link, because the library asks its transport for
    `gobj_current_state() === "ST_SESSION"` to decide whether its remote-only
    actions are usable. And it subscribes by the **SERVICE** model, not the
    CHILD one: a transport's audience is whoever asks for it — the hosted view —
    and with the CHILD model the parent tab received the echoed
    `EV_TREEDB_NODE_*` it has no reason to declare, answering *"Event NOT DEFINED
    in state"* on every save.

    Permissions stay the yuno's: the commands run there with the logged-in
    identity, so a user without the `read` authz of that `C_NODE` gets `-403`
    and empty tables, as it should.

- **`topics` is no longer translated in Spanish.** It is a Yuneta term AND the
    name of a real topic of `treedb_system_schema`, whose card is rendered
    through `t()` — so the editor showed a topic called "Temas". (`gui_treedb`
    still carries the old translation and has the same effect on any treedb with
    a `topics` topic.)

- **A QA driver of its own (`scripts/qa.mjs`, `npm run qa`).** A `curl` of the
    deployed files answers "the bytes are served". It cannot answer the question
    that matters — does this build boot, sign in, and mount its shell against a
    live control center. Now one command does, and writes a full-page
    screenshot, every console message and every failed request to
    `/tmp/agent-qa-out/<host>-<stamp>/`.

    It is not wattyzer's driver moved over: that one drives wattyzer's own login
    and BFF. This one speaks the Agent Console's login form (`src/login.js`) and
    waits on `.C_YUI_SHELL`, so a change to either breaks the driver LOUDLY —
    which is the point, because a silent pass against a screen that no longer
    exists is worse than a failure.

    Credentials never touch the repo: the user comes from `~/.yuneta/.qa-creds`
    or the environment, the password from the OS keyring (or `CLAUDIA_PASS` for
    CI). Playwright is borrowed from wattyzer's `node_modules` rather than added
    as a dependency, so the SPA ships nothing extra. It defaults to **firefox**,
    the engine this machine has downloaded — and firefox reports
    `navigator.language` as the literal string `"undefined"` under Playwright,
    which every `Intl` call has to be guarded against.

    The first run proved what a `curl` had left open: both planes serve the same
    bundle, and each derives its own control center from its hostname.
    `artgins.yunetacontrol.com` reports `artgins · agents`;
    `artgins.yunetacontrol.ovh` reports `artgins · agent22` and opens
    `wss://…:1997`. Five steps green on each, zero console errors.

- **A structured answer is a tree, not a wall of text.** Object and array
    payloads in the console now render in the lazy JSON viewer (`C_YUI_JSON`,
    already in gobj-ui and already used by gui_treedb) instead of a `<pre>` of
    `JSON.stringify`. That brings the search box, per-node collapse/expand and
    the viewer's own copy to every answer that is not a table — which is what
    made reading a `view-config` or a `stats` answer a matter of exporting the
    text to an external JSON editor to be able to search it.

    Table answers are untouched: an array with a schema still goes to
    Tabulator.

    The display mode gained a third value instead of losing one, because there
    has to be a way to see the original:

    | mode | shows |
    |---|---|
    | `table` (default) | a table when the answer carries a schema, the JSON tree otherwise |
    | `form` | always the JSON tree, schema or not |
    | `raw` | the answer exactly as it arrived |

    So `form` — which used to mean the literal text — is the tree now, and
    `raw` is what `form` used to be. Reading JSON is the common case and
    reading the bytes is the exception, so they swapped places. A leading `*`
    still forces `form` for a single command, which is how you look at a table
    answer as the JSON it really is; strings and comment-only answers (`help`)
    are text in every mode.

    The console's A− / A+ and its copy button follow the viewer: the font size
    is set on the viewer root and cascades, and copy hands over the WHOLE
    answer, not just the part left expanded (the viewer's own copy button does
    the expanded part). Mounting the viewer also made its two i18n keys
    required in this app — `validate-locales` caught them missing, which is the
    check working exactly as intended.

### Both yunos

- **Nobody starts or stops a `C_TIMER` any more.** `@yuneta/gobj-js` 7.9.10/7.9.11
  makes `set_timeout()`/`clear_timeout()` the whole contract, as it always was
  in C: the helper arms and starts, the clear disarms and stops, and a spent
  one-shot stops itself. The `gobj_start()` in `mt_start` and the `gobj_stop()`
  in `mt_stop` that every timer-holding view carried are gone — the second one
  would now log *"GObj NOT RUNNING"*, because `clear_timeout()` got there
  first. Touched `c_agent_login`, `c_agent_console`, `c_nodes`,
  `c_stats_nodes` (gui_agent) and `c_login` (gui_treedb). Range at `^7.9.11`,
  which is where the runtime stopped doing it to its own two timers.

- **The timers stay out of a `machine` trace.** Both `main.js` now carry the
  block every C `main()` has, which the JS side had never had:

  ```js
  gobj_set_gclass_no_trace("C_TIMER", "machine", true);
  gobj_set_global_no_trace("timer_periodic", true);
  ```

  `machine` traces every event by design — timers included, exactly as
  `gobj.c` does it — so turning it on to follow a click drowned in the yuno's
  one-second periodic tick. Needs `@yuneta/gobj-js ^7.9.9`, which adds the
  missing `gobj_set_gclass_no_trace()`.

### gui_agent

- **Every action in the node tables and the console crosses the FSM.** The
  *Refresh* buttons called `request_agents()` straight from their `onclick`,
  and the console's copy flash ran on a bare `setTimeout`. Both are now
  `EV_REFRESH` and `EV_TIMEOUT` with actions, so a click and its consequences
  show up in the `machine` trace — which is the whole reason the trace exists.
  The console gained the `C_TIMER` child it needed for that; the flash keeps
  its own look (green + `yi-square-check`), only the timing moved.


- **The console's copy button works for TABLE answers.** It was created
  disabled and only re-enabled by the branch that renders a `<pre>`, so every
  command that answers with a table — `top`, `list-yunos`, most of them — left
  the button dead. Table answers now copy their rows as JSON, and the whole
  view drops its private clipboard code (a fifth copy of it) for the shared
  helpers.

- **Each history row runs its command in one gesture.** Picking a line from
  Recent/Frequent only dropped it in the input; running it meant aiming at
  Execute afterwards. A ▶ button on the row does both, as `EV_RUN_HISTORY`
  through the FSM. The rows also carry logical class names now
  (`HISTORY_RUN` / `HISTORY_ADD` / `HISTORY_DEL`).

- **Nodes and Statistics say "Copied"** for a moment after copying — a check
  glyph and the word, restored by `EV_TIMEOUT` from each view's own `C_TIMER`,
  not a loose `setTimeout`. A clipboard that works silently reads exactly like
  one that failed.

- **Nodes and Statistics hand their table over as JSON** (`@yuneta/gobj-ui`
  `^5.9.0`). A *Copy JSON* button in each toolbar puts on the clipboard what
  the user is looking at: the checked rows if any are checked, otherwise every
  row the current search leaves on screen. Until now the only way to pass that
  list to anyone was a screenshot, which is how this came up.

  The work is `yui_copy_table_json()` from the library, so the next table gets
  it in three lines. The click is an event (`EV_COPY_JSON`) handled in the FSM,
  not a function call from the DOM handler.

  The label hides on a phone (`is-hidden-mobile`), decided against Spanish —
  the longest locale — because "Copiar JSON" and "Recargar" do not both fit
  beside the search box at 360px. `title` and `aria-label` carry the meaning in
  the icon-only case.

### Both yunos

- **`@yuneta/gobj-js` and `@yuneta/gobj-ui` come from the npm registry.** They
  were `file:` dependencies on the `kernel/js/*` submodule checkouts, which
  tied a build of these SPAs to the yunetas superproject and to whatever was
  in those working trees. They are now ranges (`^7.9.6` / `^5.8.2`) resolved
  from the registry, so a build is reproducible from this repo alone and both
  yunos consume exactly what wattyzer consumes.

  The `file:` deps were symlinks, which forced `resolve.preserveSymlinks` in
  `vite.config.js` — and that made Vite load duplicate module instances, which
  is why the config carried the `dedupe` list and the `src/` aliases. Both the
  flag and the aliases are gone; `dedupe` stays and now also lists
  `@yuneta/gobj-js`, because the app and gobj-ui both pull it and a split
  instance means two `__yuno__` trees.

  **Consequence:** a local edit under `yunetas/kernel/js/**` no longer reaches
  these SPAs. To pick up library work: commit + bump + `npm publish` in the
  library repo, bump the submodule pointer in yunetas, then raise the range in
  `package.json` here.

- **Installable as a WebAPK.** Both yunos now ship a complete web app manifest
  (`display: standalone`, `start_url`, `scope`, 192/512 PNG icons and a
  **maskable** 512 variant) plus a raster `apple-touch-icon`, so Android
  offers to install them and the launcher does not letterbox the icon inside a
  white circle. Icons are rendered from each yuno's existing SVG mark. No
  service worker is involved: Chrome no longer requires one to consider a page
  installable, and these consoles are useless offline anyway.

  `gui_treedb` already had a `site.webmanifest`, but it was never installable:
  it declared no `display` (so it defaulted to `browser`) and its only icon was
  an SVG, which Chrome does not accept for the install icon. That file is now
  named `manifest.webmanifest`, the name every SPA in the family uses, so the
  nginx `location` that declares its MIME type is identical everywhere.

  The manifests carry **no `orientation`**. Declaring `orientation: "any"`
  tells the system the app accepts any orientation, which overrides the
  device's own rotation lock — the app rotates even when the user has locked
  it. Leaving the member out lets the platform decide, which is what a console
  wants.

### gui_treedb

- **The rail is Topics and Graphs, and the settings page became two.** What
    `/settings` held was two different things under one name: the BACKENDS —
    the editable table of connections, their discovered services and the
    connect/disconnect intent, which is what the whole app browses and what
    each workspace picker sends you to — and one operator choice, the live
    buffer. They are now two pages, each with its own name, and neither takes
    a rail slot: **`/connections`** (`C_TREEDB_CONNECTIONS`, the old page
    renamed for what it is) and **`/preferences`**
    (`C_TREEDB_PREFERENCES`, new). Both hang off the toolbar avatar menu, both
    stay ROUTES — linkable, F5-proof, in the site map — and the picker's
    "manage connections" button now lands on `/connections`.

- **The schema of a topic is one click away** (gobj-ui `^5.12.0`). The topic
  table's toolbar gets a *Schema* button: it opens that topic's `desc` — pkey,
  cols, types, flags, fkey targets — in the adaptive dialog, on the lazy JSON
  viewer. The table shows the data; this shows the contract the data answers
  to, which is what you want in front of you when a value is refused or a link
  does not appear. It arrives from the library, so the only change here is the
  dependency floor.

- **Talk to the shell through `yui_shell_of()`, never through
  `gobj_parent()`.** `ac_child_selected` (mirror the selected topic into the
  URL) and `ac_remove_conn` (the confirm dialog) took the parent to be the
  shell. That holds only while a view hangs off a route the shell itself
  declares: under a `C_YUI_NODE` tree the parent is the NODE, which has no
  `use_hash` and no `item_index` and does not declare `EV_ROUTE_REQUESTED`, so
  the first topic-tab click logs three errors and dies in `navigate_to()` with
  `item_index is undefined`. gui_treedb mounts on declared routes today, so
  this was latent here — it is what actually broke yunovatios, whose treedb
  views did move under a node tree. `yui_shell_of()` walks up to the
  `C_YUI_SHELL` and holds for both hosts. The EV_ROUTE_CHANGED subscription in
  `mt_start`/`mt_stop` keeps using the parent on purpose (a subscription goes
  to whoever PUBLISHES) and its variable is now named `host` to keep the two
  apart.
- **The services sub-table of a connection folds and unfolds** (Settings). A
  chevron on the left of each connection row opens or closes its nested
  services table; rows with nothing discovered yet show no chevron, since
  there is no sub-table to fold. The click is an event
  (`EV_TOGGLE_CONN_EXPANDED`) like every other action of that table, and the
  action repaints ONLY the toggled row (`row.reformat()`), never a
  `redraw()` — a redraw detaches every row element and takes the live
  sub-Tabulators with it. Folding also calls `normalizeHeight()`: the row is
  still pinned to the inline height it got while the sub-table hung under
  its cells, so without it the row keeps a hole.
- **The Settings header is a flex row again on mobile, and the help text
  folds behind an (i).** The header used Bulma's `.level`, which below 769px
  turns itself AND both halves into `flex-direction: column`: the three
  action buttons stacked one per line and ate the vertical space the table
  needed (`.level.is-mobile` does not fix it — it restores `display: flex`
  and leaves the halves in column). It is a plain flex row now, wrapping
  only if it must. The how-to-use paragraph, five lines tall on a phone,
  starts folded behind an (i) beside the title (`EV_TOGGLE_HELP`, transient:
  this view is `lazy_destroy`, so every visit opens on the table).
- **"Import" no longer wears the same icon as "Add connection".** Both were
  `yi-plus`, which on mobile — where the labels drop — made them the same
  picture. Import takes gobj-ui's new `yi-upload`, the pair of Export's
  `yi-download`.
- **A fresh connection starts folded, and the fold state is persisted** in
  its own `expanded_conns` attr of `C_TREEDB_CONFIG` (`{conn_id: true}`,
  absent = folded), pruned with the connection like its Tranger views. It is
  deliberately NOT a field of `connections`: every change of that list makes
  the app root reconcile transports and the pickers refresh, and a fold is
  view state that must wake none of it — so this attr publishes nothing.
  Collapsed by default is also the cheaper start: each sub-table is a
  Tabulator with its own ResizeObserver and an async re-measure of the
  parent.

## 0.6.0 — 2026-07-25

- **feat(gui_agent): the console response font size is configurable**, mirroring
  the Terminal's TTY_HOST control. The `CONSOLE_STATUS_ROW` gains A− / [N px] /
  A+ buttons that nudge THIS console's live `CONSOLE_RESPONSE_TEXT` size — a
  TEMPORARY, per-console change, never persisted, so reopening returns to the
  default. The shared DEFAULT is set in Settings → a new "Console font size"
  stepper (persisted in `localStorage["console_font_size"]`, clamped to [8, 28],
  default 12); each console seeds its live size from that default on (re)open.

- **fix(gui_agent): the console command history is a SINGLE shared list across
  all nodes.** The store was already global (`agent_config.cmd_history`), but
  each per-node console kept a snapshot taken at open and `add_history` persisted
  that snapshot — so a command run in one node clobbered history added from
  another (last-writer-wins), and already-open consoles never saw each other's
  commands. History is now re-synced from the shared store at every point of use
  (add, remove, recall start, history-popover open): adds merge onto the latest
  global list instead of overwriting it, and Up/Down + the popover in any node
  reflect commands run in every other node.

- **chore(gui_treedb): bump `maplibre-gl` dev range to `^6.0.0`** to match
  gobj-ui's peerDependency (v6, ESM-only). gui_treedb does not instantiate a map
  (`C_YUI_MAP` is unused here — it only imports the map CSS and dedupes the lib),
  so this is dedupe hygiene against a second maplibre copy, with no runtime
  change.

- **fix(gui_agent): a transient BFF outage during token refresh no longer logs
  the user out.** `C_AGENT_LOGIN.do_bff_refresh` treated ANY refresh failure —
  including the BFF being briefly unreachable (fetch rejected / HTTP ≥500, e.g.
  while the node reboots) — as `EV_LOGIN_DENIED`, which tore the shell down to
  the login form (the "login flashes then vanishes" seen during a node bounce).
  It now classifies transient failures and emits `EV_REFRESH_FAILED` instead:
  the session, the shell, the control-center link and the open views are kept,
  and the refresh retries with exponential backoff (5s→60s). Only a real denial
  (4xx / `success:false`) still logs out. This ports the design `gui_treedb`
  already had (`c_login.js`: `EV_REFRESH_FAILED` + `retry_ms` backoff, plus the
  stale-drop of an in-flight refresh that resolves after logout). `C_APP` grows
  a matching `ac_refresh_failed` (keep everything, log a warning) so the
  now-published `EV_REFRESH_FAILED` is handled in `ST_IDLE`.

## 0.5.0 — 2026-07-17 — shipped with SDK 7.8.0

Rides gobj-ui **4.0.0** and gobj-js **7.8.0**. Both SPAs are migrated to the
five gobj-ui BREAKINGs (navigate pushes by default, `__yui_main__` theme
retirement, window/modal `title` as an i18n key + `title_prefix`, the legacy
`EV_RESIZE` path, minimize needing a window manager) — the routing/site-map,
window-title and theme work in this section IS that migration. Verified green:
vitest + both builds + the Playwright QA drivers.

- **fix(gui_treedb): the Keys picker and Raw JSON windows are STOPPED before
  destroy in the programmatic close paths** (`close_picker` /
  `close_json_viewer`: topic switch, view teardown) — destroying a running
  gobj logs two errors ("Destroying a RUNNING gobj" + "gobj NULL or
  DESTROYED") and skips `mt_stop`; the ✕ path already stopped it, so the stop
  is guarded with `gobj_is_running`.
- **fix(gui_agent): the site map's `toolbar` group label was missing from
  both locales** (gui_treedb had it) — it rendered as the raw lowercase key
  and never changed language.
- **chore(validate-locales): both apps' validators also scan
  `data-i18n-placeholder`** (new gobj-js refresh_language support), so keys
  used only in a placeholder are no longer invisible to the check.
- **docs(changelog): backfill** — gui_treedb's site-map `matches` counter key
  (both locales), `C_TREEDB_APP` declaring its action-event handlers for the
  site map (the gui_agent half was listed, the gui_treedb half was not), and
  the site-map account-menu icon switch to `yi-bars` + the `toolbar` locale
  key that rode it.
- **fix(gui_treedb): the Keys and Raw JSON windows were untitled, and their
  titles could not change language.** Both passed a `title` to `C_YUI_WINDOW`,
  but `title` only ever reached the dock chip, so the title bar painted
  nothing: the Keys picker was anonymous and Raw JSON looked titled only
  because `C_YUI_JSON` re-titled itself INSIDE the window body — which on
  mobile, where the host dialog draws its own header, showed the title twice.
  The viewers no longer pass `title` (the host titles them), and the composed
  titles (`` `${topic} · ${t("keys")}` ``) are split into gobj-ui's new
  `title_prefix` (the data half) + `title` (the key), so a language switch
  re-translates the kind while the window is open. Needs gobj-ui with
  `title_prefix`.
- **refactor(gui_treedb): `title_fn`/`retitle_modal` retired.** The transient
  dialogs (Rows options, Record, Columns) composed their titles and worked
  around the consequence — `title_fn` re-composed on `EV_LANGUAGE_CHANGED`,
  `retitle_modal` brute-forced it back with `$title.textContent`. That wiped
  the prefix/kind spans the modal now builds, i.e. it fought the new mechanism.
  All three use `title_prefix` + a key now (Columns never even composed: it was
  `() => t("columns")`, a pure key). Gone with it: `priv.picker_box` and
  `entry.$content`, write-only once nothing re-titled. `show_view_modal` stays
  for its other job — sweeping open dialogs when the session dies.
- **fix(gui_treedb): the Keys and Raw JSON windows are STARTED.** Created with
  `gobj_create_service` and never started, they showed in every trace line as
  `!!C_YUI_WINDOW^<name>` — the framework saying the gobj is not running.
  Follows gobj-ui retiring the legacy `__yui_main__`/`EV_RESIZE` path, which
  was the reason windows were left unstarted.
- **feat(gui_agent, gui_treedb): "Frontend view" in the account menu.** Both
  consoles gained an entry below "developer" that toggles the live gobj tree of
  the SPA itself (`C_YUI_GOBJ_TREE_JS`) in a floating window, peer of the
  developer window — gobj-ui's new `setup_frontend_view()`, same toggle shape as
  `setup_dev()` (`EV_OPEN_FRONTEND_VIEW` → `ac_open_frontend_view`, keeping the
  account menu's `type:"event"` idiom). Neither app registered the tree gclass
  before, so `main.js` now calls `register_c_yui_gobj_tree_js()`. Both locales
  define `frontend view` plus the tree's own keys (`layout`, `gclass`,
  `full name`, `name`, `status`, `state`, `parent`, `children`, `(collapsed)`) —
  the library translates through the app's i18next, so mounting a gobj-ui
  component makes its keys part of the app's locale contract.

- **i18n(gui_treedb, gui_agent): site-map keys.** gobj-ui's site map gained
  the "you are here" current-route marker and the "other routes" group; both
  locales define the new keys (`you are here`, `other routes`) so they render
  translated instead of falling back to the raw English key.

- **feat(gui_agent): Site map in the account menu, before About.** Same entry
  gui_treedb already had (`EV_OPEN_SITEMAP` → `yui_shell_show_route_map`), so
  every v2 app documents its own navigation surface. gui_agent now also
  declares its toolbar/account action handlers, so the map stamps `C_APP` on
  them instead of leaving the handler column blank.

- **fix(gui_treedb): the connections picker tags every service's gclass.** It
  only tagged `C_TRANGER`, leaving `C_NODE` rows bare — an untagged row read as
  "no class" rather than "a treedb". Every row now carries its gclass tag in the
  same colours as the Settings table (`C_TRANGER` warning, the rest info).

- **chore(gui_treedb, gui_agent): adopt gobj-ui's push-by-default navigation.**
  gobj-ui flipped `yui_shell_navigate()` to push by default, so every
  code-decided navigation here is now explicit: gui_treedb's four `c_app.js`
  fix-ups (deselected tab, F5 re-land, deep-link auto-open, workspace → first
  tab) and gui_agent's three redirects (deselected node, Statistics layout
  change, deep-link normalization) pass `{replace:true}`. No user-visible change
  in either SPA — without it each of those would have left a spurious Back entry.

- **feat(gui_treedb): the site map shows each treedb's topics/info/schema.** The
  treedb views now declare their view-owned sub-routes (per-topic table + info,
  the schema landing; per-topic graph focus) to gobj-ui's sub-route registry, so
  the Account → Site map tree is complete down to the leaves.

- **feat(gui_treedb): routing fixes + a site-map viewer (ROUTING.md).** Browser
  Back now traverses topic/mode selections and "← topics" (user-move navigations
  push a history entry via `yui_shell_navigate(…, {push:true})`). The
  **Connections** tab is remembered as a resting position, so switching
  workspaces and back returns to it instead of a treedb tab. The Topics **Schema**
  landing is now a real route (`/topics/db/<sel>/schema`) — deep-linkable,
  F5-safe, Back-friendly. New **Account → Site map** entry opens a printable,
  clickable tree of the app's route map.

- **feat(gui_treedb): schema-graph landing (prototype).** The Topics workspace's
  landing gains a toolbar toggle between the topic **cards** and a **schema
  graph** — the treedb drawn as topics (nodes) + `hook`/`fkey` relationships
  (edges), from the schema alone. Clicking a node opens that topic's table
  (same hash route as the card). Registers gobj-ui's new `C_YUI_TREEDB_SCHEMA`.

- **fix(gui_treedb): browser Back from a topic table / info panel returns to
  the cards grid.** `C_TREEDB_VIEW.ac_route_changed` ignored an empty subpath,
  so Back to the bare `/topics/db/<sel>` left the view on the previous topic
  (the "← Topics" button worked because it drives the view directly). It now
  resets the view to its home — the topics grid, or a cleared graph focus.
  Also adds a **"← topics" button to the graph view** (via the graph's new
  `back_route`), so a graph reached from a topic card's graph icon has an
  in-UI way back to the grid.

- **feat(gui_treedb): the graph icon focuses the topic; info panel shows
  metadata.** A topic card's graph icon now deep-links to
  `#/graphs/db/<sel>/<topic>`; `C_TREEDB_VIEW` routes that segment to the graph
  as a focus topic (`EV_SET_FOCUS_TOPIC`) — the graph centres on and highlights
  that topic's nodes. The graph's operation mode is no longer in the URL (it
  persists via its own attr). The routed info panel now leads with topic
  metadata (version, system, pkey, tkey). If the treedb isn't open in the
  Graphs workspace yet, the graph icon **auto-opens** it there (reconstructing
  its selection from the workspace it's already open in) and then lands on the
  focused graph — no manual pick needed. (Generic: any deep link to a treedb
  not open in its workspace now auto-opens it.)

- **feat(gui_treedb): topic cards get info / table / graph hash actions.** Each
  topic card now carries three real hash links: **table** (`…/<topic>`), **info**
  (`…/<topic>/info` — a routed, deep-linkable schema panel: pkey + columns with
  type and key relationship) and **graph** (`#/graphs/db/<sel>` — the treedb's
  graph workspace). `C_TREEDB_VIEW` builds the route templates and parses the
  `/info` sub-segment. (Per-topic graph *focus* — `#/graphs/db/<sel>/<topic>` —
  is the next step.)

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
