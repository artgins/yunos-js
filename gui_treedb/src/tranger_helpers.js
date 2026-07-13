/***********************************************************************
 *          tranger_helpers.js
 *
 *      The PURE part of C_TRANGER_VIEW: turning a tranger record into a
 *      table row, a timestamp into the local wall clock, a typed filter
 *      term into a comparison.
 *
 *      They live here, apart from the gclass, because they are where the
 *      view's real traps are — the two time axes, the two time units, a
 *      record free to carry a field named like a metadata column — and
 *      here they can be TESTED without a DOM, a Tabulator or a websocket.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/***************************************************************
 *              Constants
 ***************************************************************/
/*  A tranger record carries TWO timestamps, and they are two independent
 *  axes of the same record:
 *
 *      t   PERSISTENCE time — when the record was appended to the topic.
 *      tm  MESSAGE time     — when the event it carries actually happened
 *                             (set by the producer; it can lag t by hours
 *                             after a backfill, or by a device's buffered
 *                             upload).
 *
 *  Both are expressed in the TOPIC's own unit: seconds, unless the topic's
 *  system_flag sets these bits.  */
const SF_T_MS  = 0x0100;    /*  sf_t_ms:  t  is in milliseconds  */
const SF_TM_MS = 0x0200;    /*  sf_tm_ms: tm is in milliseconds  */


/***************************************************************
 *  Epoch (topic unit) <-> the LOCAL wall-clock string a `datetime-local`
 *  input takes ("YYYY-MM-DDTHH:MM:SS", step=1 so seconds survive).
 *  Empty / unparseable → 0 (unset), which is exactly how the iterator
 *  reads an absent condition.
 ***************************************************************/
function to_epoch(v, ms)
{
    if(!v) {
        return 0;
    }
    let parsed = Date.parse(v);
    if(Number.isNaN(parsed)) {
        return 0;
    }
    return ms ? parsed : Math.floor(parsed / 1000);
}

function epoch_to_local_input(value, ms)
{
    if(!value) {
        return "";
    }
    let d = new Date(ms ? value : value * 1000);
    let pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/***************************************************************
 *  Format a tranger timestamp for the t / tm columns. `ms` says the value
 *  is in milliseconds (the topic set sf_t_ms / sf_tm_ms); otherwise it is
 *  in seconds.
 *
 *  LOCAL wall-clock, like the time pickers and the span caption of the
 *  Rows options: those are `datetime-local`, so rendering the columns in
 *  UTC put the same instant on two different clocks in one card — asking
 *  for "from 18:55" (local) returned rows the table labelled 16:55.
 *
 *  A MILLISECOND topic keeps its milliseconds here (.SSS). The pickers do
 *  not — `datetime-local` tops out at seconds — but the columns are what
 *  you READ, and a topic that went to the trouble of setting sf_t_ms
 *  usually appends several records inside the same second.
 ***************************************************************/
function fmt_ts(value, ms)
{
    if(!value) {
        return "";
    }
    try {
        let s = epoch_to_local_input(value, ms).replace("T", " ");
        if(ms) {
            s += `.${String(value % 1000).padStart(3, "0")}`;
        }
        return s;
    } catch(e) {
        return String(value);
    }
}

/***************************************************************
 *  Flatten a tranger record for the records table: metadata columns
 *  (t and tm formatted, rowid) first, then the record's own fields; the
 *  full record is kept in __rec (no column) for the row dialog.
 *
 *  BOTH timestamps get a column: they are the two axes the Rows options
 *  filter on, and a card filtered by tm while showing only t would be
 *  unreadable. The unit comes from the record's OWN system_flag (each
 *  record carries it in its metadata), so this needs no topic context.
 *
 *  `key` names the key a record came from — a whole-topic Live card mixes
 *  them, and without the column it is a stream of anonymous rows. A
 *  per-key card passes none: its header already says the key.
 ***************************************************************/
function flatten_record(r, key)
{
    let md = (r && r.__md_tranger__) || {};
    let flags = md.system_flag || 0;
    let row = {};

    if(key !== undefined && key !== null && key !== "") {
        row.key = key;
    }
    row.t = fmt_ts(md.t,  (flags & SF_T_MS)  !== 0);
    row.tm = fmt_ts(md.tm, (flags & SF_TM_MS) !== 0);
    row.rowid = md.g_rowid !== undefined ? md.g_rowid : (md.rowid || "");

    if(r && typeof r === "object") {
        for(let k in r) {
            if(k === "__md_tranger__") {
                continue;
            }
            let v = r[k];
            /*  A record is free to carry its OWN field named t / tm / rowid /
             *  key, and it collides with the metadata columns above. Skipping
             *  it DELETED it from the table while the row dialog still showed
             *  it — the two disagreed about the same record. Suffix the column
             *  instead: nothing is lost and the header says which one is the
             *  record's.  */
            let name = k;
            while(row[name] !== undefined) {
                name += "_";
            }
            row[name] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
        }
    }
    row.__rec = r;
    return row;
}

/***************************************************************
 *  Custom Tabulator header-filter: parse a leading comparison operator
 *  from the typed term (`>=`, `<=`, `!=`, `>`, `<`, `=`) and compare —
 *  numeric when both sides parse as numbers (so `Voltage  >200` works),
 *  else string. No operator ⇒ case-insensitive substring match. Empty
 *  term ⇒ no filtering. Runs client-side over the LOADED page.
 ***************************************************************/
function op_filter(headerValue, rowValue)
{
    let term = String(headerValue === null || headerValue === undefined ? "" : headerValue).trim();
    if(!term) {
        return true;
    }
    let cell = (rowValue === null || rowValue === undefined) ? "" : rowValue;
    let m = term.match(/^(>=|<=|!=|>|<|=)\s*(.*)$/);
    if(m) {
        let op = m[1];
        let rhs = m[2].trim();
        let a = Number(cell);
        let b = Number(rhs);
        if(rhs !== "" && !Number.isNaN(a) && !Number.isNaN(b)) {
            switch(op) {
                case ">":  return a > b;
                case "<":  return a < b;
                case ">=": return a >= b;
                case "<=": return a <= b;
                case "=":  return a === b;
                case "!=": return a !== b;
                default:   return true;
            }
        }
        let s = String(cell).toLowerCase();
        let r = rhs.toLowerCase();
        switch(op) {
            case ">":  return s > r;
            case "<":  return s < r;
            case ">=": return s >= r;
            case "<=": return s <= r;
            case "=":  return s === r;
            case "!=": return s !== r;
            default:   return true;
        }
    }
    return String(cell).toLowerCase().indexOf(term.toLowerCase()) !== -1;
}

/***************************************************************
 *  The URL segment of a Tranger view: the selected topic, and OPTIONALLY
 *  the card to open on arrival — its key, its mode and its match
 *  conditions.
 *
 *  Only the topic used to travel. A card's conditions (the time windows,
 *  the rowid range, the user_flag masks, backward) lived ONLY in the
 *  browser's local config, so the one thing worth showing someone else —
 *  "look at key X between A and B" — was the one thing you could not send
 *  them. A link is now that whole state.
 *
 *  Wire shape: `<topic>~<base64url of {k, m, c}>`. A bare `<topic>` (every
 *  link ever shared before this) still parses, and so does a payload this
 *  version cannot read — a link is never worth failing a navigation for, so
 *  a broken one degrades to "just the topic".
 *
 *  `~` separates because it is legal in a URL path and cannot appear in a
 *  topic name (tranger topics are identifiers), and base64url carries no
 *  `/` (it uses `-` and `_`), so the whole thing stays ONE path segment.
 ***************************************************************/
const SEG_SEP = "~";

function b64url_encode(s)
{
    let bytes = new TextEncoder().encode(s);
    let bin = "";
    for(let b of bytes) {
        bin += String.fromCharCode(b);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64url_decode(s)
{
    let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while(b.length % 4) {
        b += "=";
    }
    let bin = atob(b);
    let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encode_seg(topic, card)
{
    if(!card || !card.mode) {
        return String(topic || "");
    }
    let payload = {
        k: String(card.key === undefined || card.key === null ? "" : card.key),
        m: card.mode,
        c: card.match_cond || {}
    };
    return String(topic || "") + SEG_SEP + b64url_encode(JSON.stringify(payload));
}

function decode_seg(seg)
{
    let s = String(seg || "");
    let i = s.indexOf(SEG_SEP);
    if(i < 0) {
        return {topic: s, card: null};
    }
    let topic = s.slice(0, i);
    try {
        let p = JSON.parse(b64url_decode(s.slice(i + 1)));
        if(!p || (p.m !== "rows" && p.m !== "live")) {
            return {topic: topic, card: null};
        }
        return {
            topic: topic,
            card: {
                key:        String(p.k === undefined || p.k === null ? "" : p.k),
                mode:       p.m,
                match_cond: (p.c && typeof p.c === "object") ? p.c : {}
            }
        };
    } catch(e) {
        /*  A link is never worth failing a navigation for: show the topic.  */
        return {topic: topic, card: null};
    }
}

export {
    SF_T_MS,
    SF_TM_MS,
    to_epoch,
    epoch_to_local_input,
    fmt_ts,
    flatten_record,
    op_filter,
    encode_seg,
    decode_seg,
};
