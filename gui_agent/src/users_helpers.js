/***********************************************************************
 *          users_helpers.js
 *
 *      Pure helpers of the Users workspace (C_AGENT_USERS): what a
 *      yuno's `services` answer says about its users store, the shape of
 *      the `users` and `roles` answers of C_AUTHZ, and the refs a role
 *      link is written with. No gobj, no DOM: tested on their own
 *      (users_helpers.test.js).
 *
 *      WHERE THE USERS OF A YUNO ARE. A yuno keeps its users in its
 *      C_AUTHZ service, and that service keeps them in a treedb it opens
 *      as the service `treedb_authzs`. The C_AUTHZ runs WITHOUT that
 *      treedb when the store directory does not exist ("No authz db,
 *      authz only to local access"), and then it has no users to list:
 *      both services are needed before a yuno is worth a tab.
 *
 *      HOW A ROLE IS GIVEN. `update-user role=<id>` writes the user with
 *      autolink, and autolink REPLACES the links of the columns the
 *      record names: the user ends with that one role and loses the rest.
 *      So a role is added or removed one link at a time, on the treedb:
 *          link-nodes   parent_ref=roles^<role>^users child_ref=users^<user>
 *          unlink-nodes parent_ref=roles^<role>^users child_ref=users^<user>
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/*  The gclass of the service that owns the users of a yuno.  */
const AUTHZ_GCLASS = "C_AUTHZ";

/*  The treedb C_AUTHZ opens for them (a name fixed in c_authz.c).  */
const AUTHZ_TREEDB = "treedb_authzs";


/***************************************************************
 *  authz_service_of(services)
 *
 *      -> the name of the C_AUTHZ service of a yuno whose users store
 *      is open, "" when there is none.
 *
 *      `services` is the answer of `services` to the yuno's __yuno__:
 *      [{service, gclass, ...}].
 ***************************************************************/
function authz_service_of(services)
{
    if(!Array.isArray(services)) {
        return "";
    }
    let authz = "";
    let store = false;
    for(let sv of services) {
        if(!sv || typeof sv.service !== "string") {
            continue;
        }
        if(sv.gclass === AUTHZ_GCLASS && !authz) {
            authz = sv.service;
        }
        if(sv.service === AUTHZ_TREEDB) {
            store = true;
        }
    }
    return (authz && store) ? authz : "";
}

/***************************************************************
 *  role_id_of(ref)
 *
 *      -> the role id a fkey value names, "" when it names none.
 *
 *      A fkey travels as a ref string ("roles^root^users"), as a bare
 *      id, or as a ref object ({id, topic_name, hook_name}) depending
 *      on the options of the read; all three are accepted.
 ***************************************************************/
function role_id_of(ref)
{
    if(typeof ref === "string") {
        let parts = ref.split("^");
        if(parts.length === 3) {
            return parts[1];
        }
        return parts.length === 1 ? ref : "";
    }
    if(ref && typeof ref === "object" && typeof ref.id === "string") {
        return ref.id;
    }
    return "";
}

/***************************************************************
 *  role_ids_of(user) -> the ids of the roles a user holds, sorted,
 *  without repeats.
 ***************************************************************/
function role_ids_of(user)
{
    let refs = user ? user.roles : null;
    if(!Array.isArray(refs)) {
        refs = refs ? [refs] : [];
    }
    let ids = {};
    for(let ref of refs) {
        let id = role_id_of(ref);
        if(id) {
            ids[id] = true;
        }
    }
    return Object.keys(ids).sort();
}

/***************************************************************
 *  session_count(user) -> how many live sessions the user has.
 *  `__sessions` is a dict keyed by session id.
 ***************************************************************/
function session_count(user)
{
    let s = user ? user.__sessions : null;
    if(Array.isArray(s)) {
        return s.length;
    }
    if(s && typeof s === "object") {
        return Object.keys(s).length;
    }
    return 0;
}

/***************************************************************
 *  user_rows(data) -> the rows of the users table, from the `users`
 *  answer (a list of user nodes, with metadata).
 *
 *      {id, roles: [role id], disabled, time, sessions, immutable}
 ***************************************************************/
function user_rows(data)
{
    let rows = [];
    if(!Array.isArray(data)) {
        return rows;
    }
    for(let u of data) {
        if(!u || typeof u.id !== "string" || !u.id) {
            continue;
        }
        let md = (u.__md_treedb__ && typeof u.__md_treedb__ === "object") ? u.__md_treedb__ : {};
        rows.push({
            id:        u.id,
            roles:     role_ids_of(u),
            disabled:  u.disabled === true,
            time:      (typeof u.time === "number") ? u.time : 0,
            sessions:  session_count(u),
            immutable: md.immutable === true
        });
    }
    return rows;
}

/***************************************************************
 *  role_rows(data) -> the roles a user can be given, from the `roles`
 *  answer, sorted by id.
 *
 *      {id, description, disabled, service, realm_id}
 ***************************************************************/
function role_rows(data)
{
    let rows = [];
    if(!Array.isArray(data)) {
        return rows;
    }
    for(let r of data) {
        if(!r || typeof r.id !== "string" || !r.id) {
            continue;
        }
        rows.push({
            id:          r.id,
            description: (typeof r.description === "string") ? r.description : "",
            disabled:    r.disabled === true,
            service:     (typeof r.service === "string") ? r.service : "",
            realm_id:    (typeof r.realm_id === "string") ? r.realm_id : ""
        });
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
}

/***************************************************************
 *  roles_change(current, wanted) -> {add, remove}: the role links to
 *  write so that a user holding `current` ends holding `wanted`.
 ***************************************************************/
function roles_change(current, wanted)
{
    let have = new Set(current || []);
    let want = new Set(wanted || []);
    let add = [...want].filter((id) => !have.has(id)).sort();
    let remove = [...have].filter((id) => !want.has(id)).sort();
    return {add: add, remove: remove};
}

/***************************************************************
 *  The two refs of a role link: the role is the parent (its hook
 *  `users`), the user the child (its fkey `roles`).
 ***************************************************************/
function role_parent_ref(role_id)
{
    return `roles^${role_id}^users`;
}

function user_child_ref(username)
{
    return `users^${username}`;
}

/***************************************************************
 *  username_problem(name) -> "" when `name` can be a username, else
 *  the i18n key that says why not.
 *
 *  A username is the id of a treedb node and goes inside a ref, where
 *  `^` separates the parts; a blank in it is always a typing mistake
 *  (the identities are e-mail addresses of the IdP).
 ***************************************************************/
function username_problem(name)
{
    let s = (typeof name === "string") ? name.trim() : "";
    if(!s) {
        return "username required";
    }
    if(/[\s^`]/.test(s)) {
        return "username bad chars";
    }
    return "";
}


export {
    AUTHZ_GCLASS,
    AUTHZ_TREEDB,
    authz_service_of,
    role_id_of,
    role_ids_of,
    session_count,
    user_rows,
    role_rows,
    roles_change,
    role_parent_ref,
    user_child_ref,
    username_problem,
};
