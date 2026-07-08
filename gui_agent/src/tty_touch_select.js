/***********************************************************************
 *          tty_touch_select.js
 *
 *          Touch text-selection for an xterm.js terminal.
 *
 *          xterm's selection engine is mouse-only: on a phone a
 *          long-press does nothing (the row text is `user-select:none`
 *          and there is no touch handler), so terminal output cannot be
 *          selected or copied. This adds a touch gesture that drives
 *          xterm's own PUBLIC selection API (`select` / `selectLines`):
 *
 *            - long-press          -> select the word under the finger
 *                                     (haptic tick, if supported)
 *            - drag after press    -> extend the selection (char-level
 *                                     within a row, line-level across
 *                                     rows — xterm has no public
 *                                     multi-row char API)
 *            - release             -> a floating Copy/Paste bubble
 *                                     appears over the selection: Copy
 *                                     copies `term.getSelection()`,
 *                                     Paste reads the clipboard into
 *                                     the PTY via `term.paste()`
 *            - tap elsewhere       -> dismiss bubble + clear selection
 *
 *          The native Android long-press menu (Translate/Cut/…, fired
 *          as a `contextmenu` aimed at xterm's hidden textarea) is
 *          suppressed while a touch gesture is in flight — it stole
 *          the drag (selection couldn't extend) and offered actions
 *          that make no sense on a terminal. Our bubble is the ONLY
 *          touch clipboard UI; desktop right-click stays native.
 *
 *          A quick drag (no long-press) SCROLLS the buffer: xterm has no
 *          touch scrolling of its own — touches land on .xterm-screen
 *          (the canvas) whose scrollable .xterm-viewport is a SIBLING,
 *          not an ancestor, so native scrolling never engages and the
 *          gesture chained up to the page (pull-to-refresh). We drive
 *          term.scrollLines() from the drag and preventDefault it.
 *
 *          `install_touch_selection(term, host, {t})` returns a
 *          teardown function; call it when the terminal is disposed.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/*  Long-press threshold and the movement that cancels it (a scroll).  */
const LONGPRESS_MS = 380;
const MOVE_CANCEL_PX = 10;


/************************************************************
 *   Map a viewport pixel point to a buffer cell {col, row}.
 *   Cell size is derived from the .xterm-screen box (no xterm
 *   internal API), and the row is made absolute by adding the
 *   scrollback offset so `select`/`selectLines` land right.
 ************************************************************/
function point_to_cell(term, $screen, clientX, clientY)
{
    let rect = $screen.getBoundingClientRect();
    let cw = rect.width / term.cols;
    let ch = rect.height / term.rows;
    if(!(cw > 0) || !(ch > 0)) {
        return null;
    }
    let col = Math.floor((clientX - rect.left) / cw);
    let row = Math.floor((clientY - rect.top) / ch);
    col = Math.max(0, Math.min(term.cols - 1, col));
    row = Math.max(0, Math.min(term.rows - 1, row));
    return {col: col, row: term.buffer.active.viewportY + row};
}

/************************************************************
 *   Word bounds around a column on an absolute buffer row.
 *   Returns {col, length}; a single cell when on whitespace.
 ************************************************************/
function word_at(term, cell)
{
    let line = term.buffer.active.getLine(cell.row);
    if(!line) {
        return {col: cell.col, length: 1};
    }
    let text = line.translateToString(false);
    let is_word = (ch) => ch && /\S/.test(ch);
    if(!is_word(text.charAt(cell.col))) {
        return {col: cell.col, length: 1};
    }
    let start = cell.col;
    while(start > 0 && is_word(text.charAt(start - 1))) {
        start--;
    }
    let end = cell.col;
    while(end < text.length - 1 && is_word(text.charAt(end + 1))) {
        end++;
    }
    return {col: start, length: end - start + 1};
}

/************************************************************
 *   Select from an anchor cell to a focus cell. Same row ->
 *   character range; different rows -> whole lines (the only
 *   public multi-row primitive xterm exposes).
 ************************************************************/
function select_range(term, anchor, focus)
{
    let a = anchor;
    let b = focus;
    if(b.row < a.row || (b.row === a.row && b.col < a.col)) {
        a = focus;
        b = anchor;
    }
    if(a.row === b.row) {
        term.select(a.col, a.row, Math.max(1, b.col - a.col + 1));
    } else {
        term.selectLines(a.row, b.row);
    }
}

/************************************************************
 *   Copy the current selection to the clipboard, with a
 *   fallback for insecure contexts (no navigator.clipboard).
 ************************************************************/
function copy_text(text)
{
    if(navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => fallback_copy(text));
    }
    fallback_copy(text);
    return Promise.resolve();
}

function fallback_copy(text)
{
    let ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
    } catch(e) {
        /*  nothing else to try  */
    }
    document.body.removeChild(ta);
}


/************************************************************
 *   Install the gesture. Returns a teardown().
 ************************************************************/
function install_touch_selection(term, host, opts)
{
    opts = opts || {};
    let t = opts.t || ((k) => k);

    let $screen = host.querySelector(".xterm-screen");
    if(!$screen) {
        return () => {};
    }

    /*  Kill the native long-press callout / selection so ours is the only
     *  gesture in play. */
    host.style.webkitTouchCallout = "none";
    host.style.webkitUserSelect = "none";
    host.style.userSelect = "none";

    let press_timer = null;
    let selecting = false;
    let scrolling = false;
    let scroll_last_y = 0;
    let scroll_acc = 0;
    let anchor = null;
    let start_pt = null;
    let $bubble = null;

    function remove_bubble()
    {
        if($bubble) {
            if($bubble.parentNode) {
                $bubble.parentNode.removeChild($bubble);
            }
            $bubble = null;
        }
    }

    function clear_selection()
    {
        remove_bubble();
        term.clearSelection();
    }

    /*  A bubble action button. Pointer-based so it fires before our
     *  document dismiss handler and doesn't steal terminal focus. */
    function bubble_btn(label, onpress)
    {
        let $b = document.createElement("button");
        $b.type = "button";
        $b.className = "button is-small is-dark";
        $b.textContent = label;
        $b.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onpress($b);
        });
        return $b;
    }

    function show_bubble(clientX, clientY)
    {
        remove_bubble();
        if(!term.hasSelection()) {
            return;
        }
        $bubble = document.createElement("div");
        $bubble.className = "tty-copy-bubble";
        /*  Fixed so the host's overflow:hidden can't clip it; clamped to
         *  the viewport. */
        $bubble.style.position = "fixed";
        $bubble.style.zIndex = "3000";
        $bubble.style.display = "flex";
        $bubble.style.gap = "0.3rem";
        let x = Math.max(8, Math.min(window.innerWidth - 150, clientX - 60));
        let y = Math.max(8, clientY - 44);
        $bubble.style.left = x + "px";
        $bubble.style.top = y + "px";

        $bubble.appendChild(bubble_btn(t("copy"), ($b) => {
            copy_text(term.getSelection()).then(() => {
                $b.textContent = t("copied");
                if(navigator.vibrate) {
                    navigator.vibrate(8);
                }
                setTimeout(clear_selection, 550);
            });
        }));
        $bubble.appendChild(bubble_btn(t("paste"), ($b) => {
            /*  Clipboard read needs a user gesture + permission; on denial
             *  or an unsupported browser flash ✗ and dismiss.  */
            let fail = () => {
                $b.textContent = "✗";
                setTimeout(clear_selection, 700);
            };
            if(navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then((text) => {
                    if(text) {
                        term.paste(text);   /*  -> onData -> PTY (bracketed-paste aware)  */
                    }
                    clear_selection();
                    term.focus();
                }).catch(fail);
            } else {
                fail();
            }
        }));
        document.body.appendChild($bubble);
    }

    function on_touchstart(e)
    {
        /*  A tap on the bubble is handled by its own buttons.  */
        if($bubble && $bubble.contains(e.target)) {
            return;
        }
        /*  Any fresh touch dismisses a pending bubble + selection.  */
        if($bubble) {
            clear_selection();
        }
        if(e.touches.length !== 1) {
            return;
        }
        let touch = e.touches[0];
        start_pt = {x: touch.clientX, y: touch.clientY};
        selecting = false;
        scrolling = false;
        scroll_last_y = touch.clientY;
        scroll_acc = 0;
        if(press_timer) {
            clearTimeout(press_timer);
        }
        press_timer = setTimeout(() => {
            press_timer = null;
            let cell = point_to_cell(term, $screen, start_pt.x, start_pt.y);
            if(!cell) {
                return;
            }
            selecting = true;
            let w = word_at(term, cell);
            anchor = {col: w.col, row: cell.row};
            term.select(w.col, cell.row, w.length);
            if(navigator.vibrate) {
                navigator.vibrate(12);
            }
        }, LONGPRESS_MS);
    }

    function on_touchmove(e)
    {
        if(!start_pt) {
            return;
        }
        let touch = e.touches[0];
        if(!selecting) {
            /*  Moved before the long-press fired -> it's a scroll: cancel
             *  the timer and OWN the gesture. preventDefault also stops
             *  the browser's pull-to-refresh (the gesture used to chain
             *  up to the page because nothing under the finger scrolls). */
            if(!scrolling) {
                let dx = touch.clientX - start_pt.x;
                let dy = touch.clientY - start_pt.y;
                if((dx * dx + dy * dy) > (MOVE_CANCEL_PX * MOVE_CANCEL_PX)) {
                    if(press_timer) {
                        clearTimeout(press_timer);
                        press_timer = null;
                    }
                    scrolling = true;
                    scroll_last_y = touch.clientY;
                }
            }
            if(scrolling) {
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
            return;
        }
        /*  Selecting: own the gesture (no scroll) and extend.  */
        e.preventDefault();
        let focus = point_to_cell(term, $screen, touch.clientX, touch.clientY);
        if(focus && anchor) {
            select_range(term, anchor, focus);
        }
    }

    /*  Android fires a native `contextmenu` on long-press (the
     *  Translate/Cut/Paste popup, aimed at xterm's hidden textarea) and
     *  its selection UI steals the rest of the gesture — our word
     *  selection appeared but could not be extended. Suppress it while a
     *  touch gesture is in flight; desktop right-click (no active touch)
     *  keeps its normal menu.  */
    function on_contextmenu(e)
    {
        if(start_pt) {
            e.preventDefault();
        }
    }

    function on_touchend(e)
    {
        if(press_timer) {
            clearTimeout(press_timer);
            press_timer = null;
        }
        if(selecting) {
            let pt = (e.changedTouches && e.changedTouches[0]) || start_pt;
            show_bubble(pt.clientX !== undefined ? pt.clientX : start_pt.x,
                        pt.clientY !== undefined ? pt.clientY : start_pt.y);
        }
        selecting = false;
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
        if(press_timer) {
            clearTimeout(press_timer);
        }
        remove_bubble();
        host.removeEventListener("touchstart", on_touchstart);
        host.removeEventListener("touchmove", on_touchmove);
        host.removeEventListener("touchend", on_touchend);
        host.removeEventListener("touchcancel", on_touchend);
        host.removeEventListener("contextmenu", on_contextmenu);
    };
}

export {install_touch_selection};
