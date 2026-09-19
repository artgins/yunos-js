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
import {
    epoch_to_local_input,
    local_input_to_epoch,
    fmt_epoch,
} from "@yuneta/gobj-ui/src/yui_time.js";

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

/*  The system_flag bits, by position: the mirror of sf_names[] in
 *  timeranger2.c (system_flag2_t in timeranger2.h), without the `sf_`
 *  prefix. An unnamed bit is "" and prints as its hex value.  */
const SF_NAMES = [
    "string_key",           // 0x0001
    "rowid_key",            // 0x0002
    "int_key",              // 0x0004
    "",                     // 0x0008
    "zip_record",           // 0x0010
    "cipher_record",        // 0x0020
    "",                     // 0x0040
    "",                     // 0x0080
    "t_ms",                 // 0x0100
    "tm_ms",                // 0x0200
    "deleted_instance",     // 0x0400
    "immutable_record",     // 0x0800
    "loading_from_disk",    // 0x1000
    "",                     // 0x2000
    "",                     // 0x4000
    "",                     // 0x8000
];

/*  What a records card shows, named after tr2list's levels:
 *
 *      record    the record's own fields, with key/t/tm/rowid (tr2list -l3)
 *      metadata  the record's metadata only: key, rowid (g, i), uflag,
 *                sflag, t, tm (tr2list -l1)
 *      all       both
 *
 *  A level only picks which columns are VISIBLE: every row carries every
 *  column, so a switch needs no new request and the Columns chooser still
 *  tunes the result by hand.  */
const LEVELS = ["record", "metadata", "all"];
const DEFAULT_LEVEL = "record";

/*  The metadata columns flatten_record() writes, in its order. The first
 *  four are shown at the record level too; the last three only exist to
 *  answer what tr2list -l1 answers.  */
const META_FIELDS = ["key", "t", "tm", "rowid", "i_rowid", "uflag", "sflag"];
const METADATA_ONLY_FIELDS = ["i_rowid", "uflag", "sflag"];


/***************************************************************
 *  Epoch (topic unit) <-> the LOCAL wall clock.
 *
 *  These three were written here, and they were the third copy of the
 *  same code in the tree. They now live in gobj-ui (`yui_time.js`),
 *  where C_YUI_PERIOD and any other project can reach them; what is
 *  left here are the names this view has always called them by.
 *
 *  What they do has NOT changed, and the reasons stand:
 *
 *    - the wall clock is LOCAL, like the time pickers and the span
 *      caption: rendering the columns in UTC put the same instant on two
 *      different clocks in one card (a range asked "from 18:55" local
 *      returned rows the table labelled 16:55);
 *    - a MILLISECOND topic keeps its milliseconds in a COLUMN (.SSS) and
 *      loses them in a PICKER (`datetime-local` tops out at seconds) —
 *      a topic that went to the trouble of setting sf_t_ms usually
 *      appends several records inside the same second;
 *    - empty / unparseable → 0 (unset), which is exactly how the
 *      iterator reads an absent condition.
 ***************************************************************/
const to_epoch = local_input_to_epoch;
const fmt_ts = fmt_epoch;

/***************************************************************
 *  A flag as tr2list prints it: `0x1001`. Absent is empty, not 0x0 — a
 *  record that did not carry the field must not look like one whose flags
 *  are all clear.
 ***************************************************************/
function hex_flag(v)
{
    if(v === undefined || v === null || v === "") {
        return "";
    }
    let n = Number(v);
    if(!Number.isFinite(n)) {
        return String(v);
    }
    return "0x" + (n >>> 0).toString(16);
}

/***************************************************************
 *  The names of the system_flag bits that are set, in bit order.
 ***************************************************************/
function sflag_names(v)
{
    let n = Number(v);
    if(v === "" || v === null || v === undefined || !Number.isFinite(n)) {
        return [];
    }
    let names = [];
    for(let bit = 0; bit < 16; bit++) {
        let mask = 1 << bit;
        if(n & mask) {
            names.push(SF_NAMES[bit] || hex_flag(mask));
        }
    }
    return names;
}

/***************************************************************
 *  A system_flag as a cell prints it: the hex tr2list prints, then the
 *  names of its bits (`0x1001 string_key loading_from_disk`).
 ***************************************************************/
function fmt_sflag(v)
{
    let hex = hex_flag(v);
    let names = sflag_names(v);
    return names.length ? `${hex} ${names.join(" ")}` : hex;
}

/***************************************************************
 *  A user_flag as a cell prints it. In a treedb's tranger the user_flag of
 *  a record is the id of the snap that tagged it (a row of __snaps__), so
 *  with the snaps at hand it says which one: `0x1 snap 18-sep`. A flag no
 *  snap explains — a plain tranger, or an id __snaps__ no longer has —
 *  stays hex, and 0 (untagged) is just 0x0.
 *
 *  `snaps` maps a snap id (as a string) to its name, or is null when the
 *  tranger holds no treedb.
 ***************************************************************/
function fmt_uflag(v, snaps)
{
    let hex = hex_flag(v);
    let n = Number(v);
    if(!snaps || !hex || !Number.isFinite(n) || n === 0) {
        return hex;
    }
    let name = snaps[String(n)];
    return name !== undefined ? `${hex} snap ${name}` : `${hex} snap ?`;
}

/***************************************************************
 *  The snaps of a treedb, id -> name, from the records of its __snaps__
 *  topic. A snap is a node: each save appends a record, so the LAST record
 *  of an id is its current state.
 ***************************************************************/
function snaps_from_records(records)
{
    let map = {};
    for(let r of (Array.isArray(records) ? records : [])) {
        if(r && r.id !== undefined && r.id !== null) {
            map[String(r.id)] = String(r.name === undefined ? "" : r.name);
        }
    }
    return map;
}

/***************************************************************
 *  A level the view knows, or the default one: a saved view or a shared
 *  link from before levels existed, or from a newer version, still opens.
 ***************************************************************/
function normalize_level(level)
{
    return LEVELS.indexOf(level) >= 0 ? level : DEFAULT_LEVEL;
}

/***************************************************************
 *  Is a column shown at a level? `field` is a column of a flattened row:
 *  one of META_FIELDS, or a field of the record itself.
 ***************************************************************/
function column_visible_at(field, level)
{
    switch(normalize_level(level)) {
        case "metadata":
            return META_FIELDS.indexOf(field) >= 0;
        case "all":
            return true;
        default:
            return METADATA_ONLY_FIELDS.indexOf(field) < 0;
    }
}

/***************************************************************
 *  Flatten a tranger record for the records table: metadata columns
 *  (t and tm formatted, rowid, and the i_rowid / uflag / sflag of
 *  tr2list -l1, the flags as raw numbers) first, then the record's own fields; the
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
    row.i_rowid = md.i_rowid !== undefined ? md.i_rowid : "";
    /*  The RAW numbers: a header filter `>0` then finds every record a snap
     *  tagged. The cells PRINT them decoded (fmt_uflag / fmt_sflag).  */
    row.uflag = md.user_flag !== undefined ? md.user_flag : "";
    row.sflag = md.system_flag !== undefined ? md.system_flag : "";

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
 *  Wire shape: `<topic>~<base64url of {k, m, c, l?}>` (`l` = the card's
 *  level, only when it is not the default). A bare `<topic>` (every
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
    /*  Only when it is not the default: a link to a plain card stays the
     *  link it has always been.  */
    if(card.level && normalize_level(card.level) !== DEFAULT_LEVEL) {
        payload.l = card.level;
    }
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
                match_cond: (p.c && typeof p.c === "object") ? p.c : {},
                level:      normalize_level(p.l)
            }
        };
    } catch(e) {
        /*  A link is never worth failing a navigation for: show the topic.  */
        return {topic: topic, card: null};
    }
}

/***************************************************************
 *  What a `list-keys` answer carries, whatever the backend's age.
 *
 *  A backend with the paged list-keys answers an ENVELOPE
 *  ({total_rows, pages, data}); one older than it ignores from/limit and
 *  answers the plain ARRAY of every key, as it always did. Both are
 *  legitimate, and the view must not go blank for the second — it shows
 *  the lot as a single page (and warns that the server-side search and
 *  paging are not there). `whole_list` is what says which one it was.
 ***************************************************************/
function parse_keys_answer(data)
{
    if(Array.isArray(data)) {
        return {
            rows:       data,
            total_rows: data.length,
            pages:      1,
            whole_list: true
        };
    }
    let page = data || {};
    let rows = Array.isArray(page.data) ? page.data : [];
    return {
        rows:       rows,
        total_rows: Math.max(0, page.total_rows || 0),
        pages:      Math.max(1, page.pages || 1),
        whole_list: false
    };
}

/***************************************************************
 *  The time span of every key a `list-keys` answer names, as a map keyed
 *  by the STRINGIFIED key: a topic with numeric keys answers with numbers
 *  while every caller (a Tabulator cell, a persisted view, a shared link)
 *  hands a string. The miss is what used to drop the Rows options' bounds.
 *
 *  Every row of every list-keys answer carries them (fr_t/to_t, fr_tm/to_tm)
 *  — a page of the picker, the key count, the saved-view check — and a key
 *  the browser only ever sees in ONE of the three (a restored card's) needs
 *  its span just as much.
 ***************************************************************/
function spans_from_rows(rows)
{
    let spans = {};
    for(let row of (Array.isArray(rows) ? rows : [])) {
        if(!row || row.key === undefined || row.key === null) {
            continue;
        }
        spans[String(row.key)] = {
            fr_t:  row.fr_t  || 0,
            to_t:  row.to_t  || 0,
            fr_tm: row.fr_tm || 0,
            to_tm: row.to_tm || 0
        };
    }
    return spans;
}

/***************************************************************
 *  A `get-page` answer, in the shape Tabulator's remote pagination wants.
 *
 *  `last_row` is the exact row count and it MATTERS: without it Tabulator
 *  ESTIMATES the total as last_page * page_size (its remoteRowCountEstimate)
 *  and the counter lies — "Showing 390001-100 of 100 rows".
 ***************************************************************/
function parse_records_page(data)
{
    let page = data || {};
    return {
        records:   Array.isArray(page.data) ? page.data : [],
        last_page: Math.max(1, page.pages || 1),
        last_row:  Math.max(0, page.total_rows || 0)
    };
}

export {
    SF_T_MS,
    SF_TM_MS,
    LEVELS,
    DEFAULT_LEVEL,
    META_FIELDS,
    hex_flag,
    sflag_names,
    fmt_sflag,
    fmt_uflag,
    snaps_from_records,
    normalize_level,
    column_visible_at,
    to_epoch,
    epoch_to_local_input,
    fmt_ts,
    flatten_record,
    op_filter,
    encode_seg,
    decode_seg,
    parse_keys_answer,
    spans_from_rows,
    parse_records_page,
};
