/***********************************************************************
 *          tty_touch_scroll.js
 *
 *          Touch scrolling for an xterm.js terminal.
 *
 *          xterm has no touch scrolling of its own: touches land on
 *          .xterm-screen (the canvas) whose scrollable .xterm-viewport
 *          is a SIBLING, not an ancestor, so native scrolling never
 *          engages and the gesture chains up to the page (Android
 *          Chrome turned a downward drag into pull-to-refresh). We
 *          drive term.scrollLines() from the drag and preventDefault
 *          it.
 *
 *          The native Android long-press menu (Translate/Cut/…, fired
 *          as a `contextmenu` aimed at xterm's hidden textarea) is
 *          suppressed while a touch is in flight — its actions make no
 *          sense on a terminal; clipboard access is the key bar's
 *          Paste key. Desktop right-click keeps its native menu and
 *          desktop is otherwise unaffected (touch events never fire).
 *
 *          `install_touch_scroll(term, host)` returns a teardown
 *          function; call it when the terminal is disposed.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/*  Movement that turns a touch into a scroll drag.  */
const MOVE_START_PX = 10;


/************************************************************
 *   Install the gesture. Returns a teardown().
 ************************************************************/
function install_touch_scroll(term, host)
{
    let $screen = host.querySelector(".xterm-screen");
    if(!$screen) {
        return () => {};
    }

    /*  Kill the native long-press callout / selection so the browser
     *  never starts a text-selection gesture over the terminal. */
    host.style.webkitTouchCallout = "none";
    host.style.webkitUserSelect = "none";
    host.style.userSelect = "none";

    let scrolling = false;
    let scroll_last_y = 0;
    let scroll_acc = 0;
    let start_pt = null;

    function on_touchstart(e)
    {
        if(e.touches.length !== 1) {
            return;
        }
        let touch = e.touches[0];
        start_pt = {x: touch.clientX, y: touch.clientY};
        scrolling = false;
        scroll_last_y = touch.clientY;
        scroll_acc = 0;
    }

    function on_touchmove(e)
    {
        if(!start_pt) {
            return;
        }
        let touch = e.touches[0];
        if(!scrolling) {
            let dx = touch.clientX - start_pt.x;
            let dy = touch.clientY - start_pt.y;
            if((dx * dx + dy * dy) > (MOVE_START_PX * MOVE_START_PX)) {
                scrolling = true;
                scroll_last_y = touch.clientY;
            }
        }
        if(scrolling) {
            /*  Own the gesture: preventDefault also stops the browser's
             *  pull-to-refresh (nothing under the finger scrolls
             *  natively, so the gesture used to chain up to the page). */
            e.preventDefault();
            /*  Natural scrolling: finger up -> buffer scrolls down.
             *  Accumulate sub-row deltas so slow drags still move.  */
            scroll_acc += scroll_last_y - touch.clientY;
            scroll_last_y = touch.clientY;
            let rect = $screen.getBoundingClientRect();
            let ch = rect.height / term.rows;
            if(ch > 0) {
                let lines = Math.trunc(scroll_acc / ch);
                if(lines !== 0) {
                    term.scrollLines(lines);
                    scroll_acc -= lines * ch;
                }
            }
        }
    }

    /*  Long-press on Android fires a native `contextmenu` (the
     *  Translate/Cut/Paste popup, aimed at xterm's hidden textarea).
     *  Suppress it while a touch gesture is in flight; desktop
     *  right-click (no active touch) keeps its normal menu.  */
    function on_contextmenu(e)
    {
        if(start_pt) {
            e.preventDefault();
        }
    }

    function on_touchend()
    {
        scrolling = false;
        start_pt = null;
    }

    host.addEventListener("touchstart", on_touchstart, {passive: true});
    host.addEventListener("touchmove", on_touchmove, {passive: false});
    host.addEventListener("touchend", on_touchend, {passive: true});
    host.addEventListener("touchcancel", on_touchend, {passive: true});
    host.addEventListener("contextmenu", on_contextmenu);

    return function teardown()
    {
        host.removeEventListener("touchstart", on_touchstart);
        host.removeEventListener("touchmove", on_touchmove);
        host.removeEventListener("touchend", on_touchend);
        host.removeEventListener("touchcancel", on_touchend);
        host.removeEventListener("contextmenu", on_contextmenu);
    };
}

export {install_touch_scroll};
