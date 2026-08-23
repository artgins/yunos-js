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
    let seen = new Set((Array.isArray(existing) ? existing : []).map(conn_identity));
    let fresh = [];
    let skipped = 0;

    for(let conn of (Array.isArray(rows) ? rows : [])) {
        if(!conn || !conn.url) {
            continue;
        }
        let identity = conn_identity(conn);
        if(seen.has(identity)) {
            skipped++;
            continue;
        }
        seen.add(identity);
        fresh.push(conn);
    }

    return {fresh: fresh, skipped: skipped};
}

/***************************************************************
 *  conns_browse_state(conns)
 *
 *      conns   the connections the header checkbox covers -- the ones
 *              the filter leaves ON SCREEN, each with its `services`
 *
 *      -> "none" | "some" | "all"
 *
 *      What the header box of the browse column has to say. Counted
 *      over SERVICES, not over connections: a header reading "all"
 *      while half the treedbs of one connection are unticked would
 *      drop them on the next click and call that a toggle.
 *
 *      A connection with nothing discovered yet counts nowhere --
 *      there is nothing of it to browse.
 ***************************************************************/
function conns_browse_state(conns)
{
    let total = 0;
    let on = 0;

    for(let conn of (Array.isArray(conns) ? conns : [])) {
        let services = (conn && Array.isArray(conn.services)) ? conn.services : [];
        for(let svc of services) {
            if(!svc || !svc.service) {
                continue;
            }
            total++;
            if(svc.selected) {
                on++;
            }
        }
    }

    if(!total || !on) {
        return "none";
    }
    return (on === total) ? "all" : "some";
}


export {conn_identity, plan_conn_import, conns_browse_state};
