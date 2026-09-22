/***********************************************************************
 *          apply_outcome.js
 *
 *          What the Schemas tab does once every owner of a yuno has
 *          answered `apply-schema`. The saved schema goes in place on
 *          every owner BEFORE the restart, each owner replacing its own
 *          file in use; so an owner that refuses after another already
 *          applied does not undo anything: the yuno on disk already
 *          carries the schema of the ones that applied, and the restart
 *          is what reads it. Ending the sequence there (N10 of the
 *          2026-09-22 review) left those files in place and the running
 *          yuno on the old schema, `saved-schema` then said saved == in
 *          use, Apply went dark, and the next unrelated restart applied
 *          it silently.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/************************************************************
 *  {done, failed: [comment]} -> {restart, error}
 *
 *  - nobody applied: no restart, the refusals are the error;
 *  - some applied, some refused: restart, and say who refused;
 *  - everybody applied: restart, no error.
 ************************************************************/
function apply_outcome(done, failed)
{
    const refused = Array.isArray(failed)? failed.filter((c) => !!c) : [];
    if(!done) {
        return {restart: false, error: refused.join("\n") || "apply-schema failed"};
    }
    if(refused.length > 0) {
        return {restart: true, error: refused.join("\n")};
    }
    return {restart: true, error: ""};
}

export {
    apply_outcome,
};
