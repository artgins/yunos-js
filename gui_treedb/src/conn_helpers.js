/***********************************************************************
 *          conn_helpers.js
 *
 *      WHAT AN IMPORT ADDS, decided apart from the gclass.
 *
 *      The connections view imports the same document again and again:
 *      the agent console rebuilds it WHOLE on every scan, so the paste
 *      that brings the one yuno a node has gained brings the twenty it
 *      already had with it. Adding the lot is what the view did, and it
 *      could not do anything else -- every imported row was given a
 *      fresh id, and a fresh id is a new row by construction.
 *
 *      So the identity of a connection has to be said out loud, and it
 *      is not the id: it is the url and the service reached through it.
 *      Cloning a row is how the operator says "the same backend, its
 *      OTHER treedb service", and the label is not part of it -- it is
 *      edited in place here, and an edited label must not turn the next
 *      re-paste into a second row of the same thing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/***************************************************************
 *  conn_identity(conn)
 *
 *      -> the key two connections are the SAME one by: their url
 *      (case-folded, a wss host is not case-sensitive) and the remote
 *      service reached through it.
 ***************************************************************/
function conn_identity(conn)
{
    let url = String((conn && conn.url) || "").trim().toLowerCase();
    let service = String((conn && conn.remote_yuno_service) || "").trim();
    return `${url}\u001F${service}`;
}

/***************************************************************
 *  plan_conn_import(existing, rows)
 *
 *      existing    the connections already configured
 *      rows        the connections the document carries
 *
 *      -> {fresh, skipped}
 *
 *      `fresh` are the rows to add, in the order the document gives
 *      them, each identity once -- a document repeats itself too.
 *
 *      The key of a record is its `id` (the rule of every data record:
 *      the key is `id`, the rest is value), and gui_agent's export
 *      carries one -- the endpoint, `host:port`. A row whose `id` is
 *      already here IS that connection, whatever its url says now. A
 *      row with no `id` (an older export, a hand-written list) falls
 *      back to url + service, which is also checked for every row: two
 *      records that reach the same backend are one connection.
 *      `skipped` counts what was already here. A row already here is
 *      NOT updated: it may have been edited since (a host fixed by
 *      hand, services unticked), and the document arriving is not more
 *      authoritative than that.
 *
 *      A row with no url is dropped and counted nowhere: it can never
 *      open a socket, so it is not a connection at all.
 ***************************************************************/
function plan_conn_import(existing, rows)
{
    let list = Array.isArray(existing) ? existing : [];
    let seen = new Set(list.map(conn_identity));
    let seen_ids = new Set(list.map(conn_id_of).filter(Boolean));
    let fresh = [];
    let skipped = 0;

    for(let conn of (Array.isArray(rows) ? rows : [])) {
        if(!conn || !conn.url) {
            continue;
        }
        let identity = conn_identity(conn);
        let id = conn_id_of(conn);
        if(seen.has(identity) || (id && seen_ids.has(id))) {
            skipped++;
            continue;
        }
        seen.add(identity);
        if(id) {
            seen_ids.add(id);
        }
        fresh.push(conn);
    }

    return {fresh: fresh, skipped: skipped};
}

/*  The key a record carries, "" when it carries none.  */
function conn_id_of(conn)
{
    return String((conn && conn.id) || "").trim();
}

/***************************************************************
 *  conn_is_marked(conn)
 *
 *      -> is the connection MARKED to browse: listed in the pickers of
 *      Topics / Graphs even while it is not connected.
 *
 *      `browse` says it. A connection saved before `browse` existed has
 *      none, and counts as marked when any of its services carries the
 *      old per-service `selected` flag -- what it was browsed by then.
 ***************************************************************/
function conn_is_marked(conn)
{
    if(!conn) {
        return false;
    }
    if(typeof conn.browse === "boolean") {
        return conn.browse;
    }
    let services = Array.isArray(conn.services) ? conn.services : [];
    return services.some((svc) => svc && svc.selected);
}

/***************************************************************
 *  conns_browse_state(conns)
 *
 *      conns   the connections the header checkbox covers -- the ones
 *              the filter leaves ON SCREEN
 *
 *      -> "none" | "some" | "all"
 *
 *      What the header box of the browse column has to say: how many
 *      of them are marked (conn_is_marked). A connection with nothing
 *      discovered counts like any other -- marking it is what lists it
 *      in the pickers before it ever connects.
 ***************************************************************/
function conns_browse_state(conns)
{
    let total = 0;
    let on = 0;

    for(let conn of (Array.isArray(conns) ? conns : [])) {
        if(!conn) {
            continue;
        }
        total++;
        if(conn_is_marked(conn)) {
            on++;
        }
    }

    if(!total || !on) {
        return "none";
    }
    return (on === total) ? "all" : "some";
}


export {conn_identity, plan_conn_import, conn_is_marked, conns_browse_state};
