/***********************************************************************
 *          apply_outcome.js
 *
 *          What the Schemas tab does once every owner of a yuno has
 *          answered `apply-schema`.
 *
 *          THE UNIT IS A TREEDB, NOT AN OWNER. An owner (a C_TREEDB
 *          service) holds one or more treedbs and answers for all of them
 *          at once, one row per treedb it tried; each treedb replaces its
 *          own file in use, and the restart is what reads them. So an
 *          owner whose answer is -1 may already have applied some of its
 *          treedbs, and an owner that answers 0 may have applied none
 *          ("0 treedb(s)": nothing of it was applicable). Counting OWNERS
 *          got both wrong: one refusal next to a success skipped the
 *          restart and left the applied schema on disk for the next
 *          unrelated restart to pick up in silence; an owner with nothing
 *          to apply next to a refusal restarted the yuno for nothing.
 *
 *          The rows, as C_TREEDB answers them:
 *              {treedb_name, result, comment, data: {applied: bool}}
 *          `data.applied` is what a node newer than yunetas 7.25.3 says.
 *          A 7.25.3 node does not say it; there a row exists only for a
 *          treedb that was applicable, and its `result` 0 means it was
 *          written. A named apply (one treedb) answers `data.applied` at
 *          the top.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/************************************************************
 *  A refusal names its treedb: the comment of C_TREEDB does, but
 *  a row without one would be a line that says nothing.
 ************************************************************/
function refusal_text(treedb_name, comment)
{
    const text = comment? String(comment) : "apply-schema failed";
    if(treedb_name && !text.includes(treedb_name)) {
        return `${treedb_name}: ${text}`;
    }
    return text;
}

/************************************************************
 *  Was this treedb row applied? `data.applied` when the node says
 *  it, else the row's own result (a 7.25.3 node).
 ************************************************************/
function row_applied(row)
{
    if(row.data && typeof row.data === "object" && typeof row.data.applied === "boolean") {
        return row.data.applied;
    }
    return row.result === 0;
}

/************************************************************
 *  One owner's `apply-schema` answer -> {applied: [treedb names],
 *  refused: [text]}. `kw` null is an answer that never came (the
 *  dispatch failed): the comment goes in `refused` via `comment`.
 ************************************************************/
function owner_apply_outcome(kw, owner)
{
    const out = {applied: [], refused: []};
    const failed = !!kw && typeof kw.result === "number" && kw.result < 0;

    if(!kw) {
        out.refused.push(refusal_text(owner, ""));
        return out;
    }

    if(Array.isArray(kw.data)) {
        for(const row of kw.data) {
            if(!row || typeof row !== "object") {
                continue;
            }
            const name = row.treedb_name || "";
            if(row_applied(row)) {
                out.applied.push(name);
            } else if(typeof row.result === "number" && row.result < 0) {
                out.refused.push(refusal_text(name, row.comment));
            }
            /*  applied false and result >= 0: a treedb with nothing to
             *  apply, neither news nor a refusal.  */
        }
        if(failed && out.refused.length === 0) {
            /*  The owner said -1 and named no treedb: say what it said.  */
            out.refused.push(refusal_text(owner, kw.comment));
        }
        return out;
    }

    if(kw.data && typeof kw.data === "object" && typeof kw.data.applied === "boolean") {
        /*  A named apply: one treedb, answered at the top.  */
        const name = kw.data.treedb_name || owner || "";
        if(kw.data.applied) {
            out.applied.push(name);
        } else if(failed) {
            out.refused.push(refusal_text(name, kw.comment));
        }
        return out;
    }

    if(failed) {
        out.refused.push(refusal_text(owner, kw.comment));
    }
    /*  0 and no rows ("0 treedb(s)"): nothing of this owner applied.  */
    return out;
}

/************************************************************
 *  Every owner answered: {applied, refused} -> what to do.
 *
 *  - some treedb applied: restart (the files in use already carry
 *    the saved schemas), and name the refused ones, if any;
 *  - none applied: no restart -- a restart would read nothing new --
 *    and the refusals are the error, or "nothing saved to apply"
 *    (an i18n KEY, `error_key`) when nobody refused either.
 ************************************************************/
function apply_outcome(applied, refused)
{
    const a = Array.isArray(applied)? applied : [];
    const r = Array.isArray(refused)? refused.filter((c) => !!c) : [];

    if(a.length === 0) {
        if(r.length) {
            return {restart: false, error: r.join("\n"), error_key: ""};
        }
        return {restart: false, error: "", error_key: "nothing saved to apply"};
    }
    return {restart: true, error: r.join("\n"), error_key: ""};
}

export {
    owner_apply_outcome,
    apply_outcome,
};
