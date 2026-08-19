/***********************************************************************
 *          route_helpers.js
 *
 *      WHERE A TAB WAS LEFT, decided apart from the gclass.
 *
 *      A tab's nav item is a FIXED route: `yui_shell_set_submenu()`
 *      registers it in the shell's item index, and that route is where
 *      the tab's view is MOUNTED and what a deep link resolves to. So
 *      the position inside a tab cannot travel in the item — moving it
 *      would move the mount — and has to be replayed when the tab is
 *      entered again.
 *
 *      "Entered again" is the whole subtlety, and it is why this is a
 *      function with tests rather than three lines inside an action:
 *      arriving at the root of the tab you were ALREADY in is the way
 *      OUT of a topic (the view's own "← Topics" button), and replaying
 *      the position there would make that button do nothing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/***************************************************************
 *  tab_position_plan(prev_base, base, subpath, remembered)
 *
 *      prev_base   the tab base the previous route resolved to
 *      base        the tab base this route resolves to
 *      subpath     what is left of the url below `base`
 *      remembered  the position last recorded for THIS tab
 *
 *      -> {record, replay}
 *
 *      `record` is the position to remember (null = leave it), and
 *      `replay` the route to normalize to (null = stay). Never both:
 *      a position is either being made or being restored.
 ***************************************************************/
function tab_position_plan(prev_base, base, subpath, remembered)
{
    let inner = String(subpath || "");
    let here = String(base || "");

    if(!here) {
        return {record: null, replay: null};
    }

    /*  Somewhere inside the tab: that IS the position.  */
    if(inner) {
        return {record: `${here}/${inner}`, replay: null};
    }

    /*  At the root of the tab we were already in: the operator walked
     *  UP, on purpose, and that is a position too.  */
    if(prev_base === here) {
        return {record: here, replay: null};
    }

    /*  Entering the tab again: go back to where it was left, if that is
     *  anywhere other than the root it would land on anyway.  */
    let back = String(remembered || "");
    if(back && back !== here) {
        return {record: null, replay: back};
    }
    return {record: null, replay: null};
}


export {tab_position_plan};
