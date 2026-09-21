/***********************************************************************
 *          rows_page.js
 *
 *      The kw of one `get-page` of a Rows card.
 *
 *      The DIRECTION belongs to `get-page`, not to `open-iterator`: a
 *      card read newest first carries `backward` on every page. Sending
 *      it only at the open did nothing, and page 1 came back oldest
 *      first.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/***************************************************************
 *  {service, iterator_id, page (1-based), size, req_id, match_cond}
 ***************************************************************/
function get_page_kw(o)
{
    return {
        service:     o.service,
        iterator_id: o.iterator_id,
        from_rowid:  (o.page - 1) * o.size + 1,
        limit:       o.size,
        backward:    (o.match_cond && o.match_cond.backward) ? 1 : 0,
        __md_command__: {req_id: o.req_id}   /*  echoed back for correlation  */
    };
}

/***************************************************************
 *  Does a failed get-page say the iterator is GONE (so the card
 *  must open a new one) rather than that the page was refused?
 *  The three wordings C_TRANGER answers with: an id it does not
 *  hold, an iterator closed with its topic, and one closed because
 *  its key was deleted.
 ***************************************************************/
const GONE = [
    /iterator not found/i,
    /was already closed with its topic/i,
    /was deleted: open it again/i,
];

function iterator_is_gone(comment)
{
    if(typeof comment !== "string" || !comment) {
        return false;
    }
    return GONE.some((re) => re.test(comment));
}

export {get_page_kw, iterator_is_gone};
