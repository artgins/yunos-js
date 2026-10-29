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
 *      WHAT A ROLE GRANTS. Its `permission` (with `deny`), and each entry
 *      of its `permissions` ({permission, deny, parameters}); its
 *      `parameters` SCOPE them -- an entry with its own replaces the role's
 *      (C_AUTHZ). A scope may name only the keys the permission declares
 *      (`authzs` of the service: the `parameters` of each permission),
 *      and here it is written as text: `key=v1,v2; key2=v3`.
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

/*  The ids of a hook or fkey value: refs, bare ids or ref objects.  */
function ids_of(value)
{
    let list = Array.isArray(value) ? value : (value ? [value] : []);
    let ids = {};
    for(let ref of list) {
        let id = role_id_of(ref);
        if(!id && typeof ref === "string") {
            id = ref.split("^")[1] || "";
        }
        if(id) {
            ids[id] = true;
        }
    }
    return Object.keys(ids).sort();
}

function is_dict(v)
{
    return !!v && typeof v === "object" && !Array.isArray(v);
}

/***************************************************************
 *  role_rows(data) -> the roles of the store, from the `roles`
 *  answer, sorted by id.
 *
 *      {id, description, disabled, service, realm_id, permission,
 *       deny, permissions: [{permission, deny, parameters?}],
 *       parameters, users: [user id], children: [role id], immutable}
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
        let md = is_dict(r.__md_treedb__) ? r.__md_treedb__ : {};
        let entries = [];
        for(let e of (Array.isArray(r.permissions) ? r.permissions : [])) {
            if(!is_dict(e)) {
                continue;
            }
            let entry = {
                permission: (typeof e.permission === "string") ? e.permission : "",
                deny:       e.deny === true
            };
            if(e.parameters !== undefined && e.parameters !== null) {
                entry.parameters = e.parameters;
            }
            entries.push(entry);
        }
        rows.push({
            id:          r.id,
            description: (typeof r.description === "string") ? r.description : "",
            disabled:    r.disabled === true,
            service:     (typeof r.service === "string") ? r.service : "",
            realm_id:    (typeof r.realm_id === "string") ? r.realm_id : "",
            permission:  (typeof r.permission === "string") ? r.permission : "",
            deny:        r.deny === true,
            permissions: entries,
            parameters:  is_dict(r.parameters) ? r.parameters : {},
            users:       ids_of(r.users),
            children:    ids_of(r.roles),
            immutable:   md.immutable === true
        });
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
}

/***************************************************************
 *  role_grants(role) -> what a role grants or denies, one line per
 *  permission: [{permission, deny, scope, own_scope}]. An entry
 *  without its own scope takes the role's (own_scope false).
 ***************************************************************/
function role_grants(role)
{
    let out = [];
    if(!role) {
        return out;
    }
    let scope = is_dict(role.parameters) ? role.parameters : {};
    if(role.permission) {
        out.push({permission: role.permission, deny: !!role.deny, scope: scope, own_scope: false});
    }
    for(let e of (role.permissions || [])) {
        if(!e.permission) {
            continue;
        }
        let own = e.parameters !== undefined && e.parameters !== null;
        out.push({permission: e.permission, deny: !!e.deny,
                  scope: own ? e.parameters : scope, own_scope: own});
    }
    return out;
}

/***************************************************************
 *  format_scope(scope) -> its text, `key=v1,v2; key2=v3`, "" for none.
 *  A scope that is not a dict is shown as json, as it is.
 ***************************************************************/
function format_scope(scope)
{
    if(scope === undefined || scope === null) {
        return "";
    }
    if(!is_dict(scope)) {
        return JSON.stringify(scope);
    }
    return Object.keys(scope).map((k) => {
        let v = scope[k];
        let values = Array.isArray(v) ? v : [v];
        return `${k}=${values.map((x) => String(x)).join(",")}`;
    }).join("; ");
}

/***************************************************************
 *  parse_scope(text) -> {ok: true, scope} or {ok: false, key, detail}.
 *  `key=v1,v2; key2=v3`: a key is a name, each value text (C_AUTHZ
 *  compares it as json: "1" is not the number 1). Empty text is no
 *  scope ({}).
 ***************************************************************/
const SCOPE_KEY_RE = /^[A-Za-z_][\w.-]*$/;

function parse_scope(text)
{
    let scope = {};
    let src = (typeof text === "string") ? text.trim() : "";
    if(!src) {
        return {ok: true, scope: scope};
    }
    for(let part of src.split(";")) {
        let seg = part.trim();
        if(!seg) {
            continue;
        }
        let eq = seg.indexOf("=");
        let key = eq > 0 ? seg.slice(0, eq).trim() : "";
        if(!SCOPE_KEY_RE.test(key)) {
            return {ok: false, key: "scope bad syntax", detail: seg};
        }
        let values = seg.slice(eq + 1).split(",").map((v) => v.trim()).filter((v) => v);
        if(!values.length) {
            return {ok: false, key: "scope without values", detail: key};
        }
        scope[key] = values;
    }
    return {ok: true, scope: scope};
}

/*  Every key role_problem() and parse_scope() answer: data, so they
 *  are published for validate-locales.  */
export const ROLE_PROBLEM_I18N_KEYS = [
    "role id required", "role id bad chars", "role description required",
    "role realm required", "role service required", "role grants nothing",
    "scope bad syntax", "scope without values", "permission not of the service",
    "scope key not declared", "role already exists"
];

/***************************************************************
 *  role_problem(form, declared) -> null, or {key, detail}: why the
 *  role of the sheet cannot be written.
 *
 *  form: {id, description, realm_id, service, permission, deny,
 *         scope_text, entries: [{permission, deny, own, scope_text}]}
 *  An entry with `own` has a scope of its own, `scope_text` ("" is {},
 *  unscoped); without it, the role's scope applies to it.
 *  declared: the `authzs` answer of the role's service
 *  ([{id, parameters: [{id}]}]), or null when not known -- then the
 *  permission names and the scope keys are not checked here, and the
 *  service refuses what it does not declare.
 ***************************************************************/
function role_problem(form, declared)
{
    let id = (form.id || "").trim();
    if(!id) {
        return {key: "role id required", detail: ""};
    }
    if(/[\s^`]/.test(id)) {
        return {key: "role id bad chars", detail: id};
    }
    const required = [
        ["description", "role description required"],
        ["realm_id",    "role realm required"],
        ["service",     "role service required"]
    ];
    for(let [k, key] of required) {
        if(!(form[k] || "").trim()) {
            return {key: key, detail: ""};
        }
    }
    let lines = [{permission: (form.permission || "").trim(), scope_text: form.scope_text}];
    for(let e of (form.entries || [])) {
        lines.push({permission: (e.permission || "").trim(), scope_text: e.scope_text, own: !!e.own});
    }
    if(!lines.some((l) => l.permission)) {
        return {key: "role grants nothing", detail: ""};
    }
    let role_scope = parse_scope(form.scope_text);
    if(!role_scope.ok) {
        return {key: role_scope.key, detail: role_scope.detail};
    }
    for(let l of lines) {
        if(!l.permission) {
            continue;
        }
        let sc = l.own ? parse_scope(l.scope_text) : role_scope;
        if(!sc.ok) {
            return {key: sc.key, detail: `${l.permission}: ${sc.detail}`};
        }
        if(!Array.isArray(declared) || l.permission === "*") {
            continue;
        }
        let desc = declared.find((d) => d && d.id === l.permission);
        if(!desc) {
            return {key: "permission not of the service", detail: l.permission};
        }
        let keys = (Array.isArray(desc.parameters) ? desc.parameters : []).map((p) => p && p.id);
        for(let k of Object.keys(sc.scope)) {
            if(keys.indexOf(k) < 0) {
                return {key: "scope key not declared", detail: `${l.permission}: ${k}`};
            }
        }
    }
    return null;
}

/***************************************************************
 *  role_record(form) -> the record `create-node` / `update-node` of
 *  `roles` write: every column the sheet edits, nothing else (the
 *  hooks and the fkey are links, written by link-nodes). Call it on a
 *  form role_problem() passed.
 ***************************************************************/
function role_record(form)
{
    let entries = [];
    for(let e of (form.entries || [])) {
        let permission = (e.permission || "").trim();
        if(!permission) {
            continue;
        }
        let entry = {permission: permission, deny: !!e.deny};
        if(e.own) {
            entry.parameters = parse_scope(e.scope_text).scope;     /*  "" is {}, unscoped  */
        }
        entries.push(entry);
    }
    return {
        id:          form.id.trim(),
        description: form.description.trim(),
        disabled:    !!form.disabled,
        realm_id:    form.realm_id.trim(),
        service:     form.service.trim(),
        permission:  (form.permission || "").trim(),
        deny:        !!form.deny,
        permissions: entries,
        parameters:  parse_scope(form.scope_text).scope
    };
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
    role_grants,
    format_scope,
    parse_scope,
    role_problem,
    role_record,
    roles_change,
    role_parent_ref,
    user_child_ref,
    username_problem,
};
