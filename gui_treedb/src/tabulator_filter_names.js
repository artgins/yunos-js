/***********************************************************************
 *          tabulator_filter_names.js
 *
 *      Tabulator draws a header filter as a bare `<input>`: no title, no
 *      aria-label. gobj-ui's yui_tabulator_name_filters() names each one
 *      after its column ("Filter by key"). But the box is Tabulator's: it is
 *      built again with its column, and comes back with no name, every
 *      time the columns are built again -- `setColumns()` (a language
 *      change, a live card seeded by its first record) and the autoColumns
 *      of every page a remote table loads (page 2 of a Rows card).
 *
 *      So a table with header filters names them after EVERY build of its
 *      columns, not once (yunetas CLAUDE.md: what a widget draws "is named
 *      after the render, and again on every rebuild"; REV-CLOUD V46.3).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {t} from "i18next";
import {yui_tabulator_name_filters} from "@yuneta/gobj-ui/src/yui_tabulator_i18n.js";

/***************************************************************
 *  Name the header filters of `table` now that it is built, and
 *  again each time its columns are built. Widget plumbing, not an
 *  action: Tabulator's events are where the boxes appear.
 ***************************************************************/
function keep_header_filters_named(table)
{
    let name_them = function() {
        yui_tabulator_name_filters(table, t);
    };
    table.on("tableBuilt", name_them);
    table.on("columnsLoaded", name_them);
}

export {keep_header_filters_named};
