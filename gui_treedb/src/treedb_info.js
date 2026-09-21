/***********************************************************************
 *          treedb_info.js
 *
 *      The `treedb-info` question of the discovery, and how its answer
 *      says which service it is about.
 *
 *      C_IEVENT_CLI EXTRACTS `__md_command__` from a command's kw and
 *      that is ALL it puts back in the command stack of the answer: a
 *      parameter sent beside it goes to the backend and never returns.
 *      So the service travels twice -- as the parameter the yuno reads,
 *      and in `__md_command__`, where the answer finds it.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/***************************************************************
 *  The kw of `treedb-info` for one service.
 ***************************************************************/
function treedb_info_kw(service)
{
    return {
        service: service,
        __md_command__: {service: service}
    };
}

/***************************************************************
 *  The service an answer of `treedb-info` is about, read from the
 *  command stack's kw (what C_IEVENT_CLI echoed). "" when none.
 ***************************************************************/
function treedb_info_service(kw_command)
{
    return (kw_command && typeof kw_command.service === "string") ?
        kw_command.service : "";
}

export {treedb_info_kw, treedb_info_service};
