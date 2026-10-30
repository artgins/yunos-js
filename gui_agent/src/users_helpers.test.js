/***********************************************************************
 *          users_helpers.test.js
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, it, expect} from "vitest";

import {
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
} from "./users_helpers.js";


describe("authz_service_of", () => {
    it("names the C_AUTHZ service when its users store is open", () => {
        let services = [
            {service: "agent", gclass: "C_AGENT"},
            {service: "authz", gclass: "C_AUTHZ"},
            {service: "treedb_authzs", gclass: "C_NODE"}
        ];
        expect(authz_service_of(services)).toBe("authz");
    });

    it("says none when the C_AUTHZ runs without its store", () => {
        let services = [
            {service: "authz", gclass: "C_AUTHZ"},
            {service: "treedb_system_schema", gclass: "C_NODE"}
        ];
        expect(authz_service_of(services)).toBe("");
    });

    it("says none without a C_AUTHZ, or without an answer", () => {
        expect(authz_service_of([{service: "treedb_authzs", gclass: "C_NODE"}])).toBe("");
        expect(authz_service_of(null)).toBe("");
        expect(authz_service_of([null, {gclass: "C_AUTHZ"}])).toBe("");
    });
});


describe("role_id_of / role_ids_of", () => {
    it("reads the three shapes a fkey travels in", () => {
        expect(role_id_of("roles^root^users")).toBe("root");
        expect(role_id_of("root")).toBe("root");
        expect(role_id_of({id: "owner", topic_name: "roles", hook_name: "users"})).toBe("owner");
    });

    it("refuses what names no role", () => {
        expect(role_id_of("roles^root")).toBe("");
        expect(role_id_of(null)).toBe("");
        expect(role_id_of({topic_name: "roles"})).toBe("");
    });

    it("sorts and drops repeats", () => {
        let user = {roles: ["roles^owner^users", {id: "root"}, "roles^owner^users"]};
        expect(role_ids_of(user)).toEqual(["owner", "root"]);
        expect(role_ids_of({roles: "roles^root^users"})).toEqual(["root"]);
        expect(role_ids_of({})).toEqual([]);
    });
});


describe("session_count", () => {
    it("counts the sessions of the dict", () => {
        expect(session_count({__sessions: {a: {}, b: {}}})).toBe(2);
        expect(session_count({__sessions: {}})).toBe(0);
        expect(session_count({__sessions: null})).toBe(0);
        expect(session_count({})).toBe(0);
    });
});


describe("user_rows", () => {
    it("builds one row per user node", () => {
        let data = [
            {
                id: "yuneta", roles: [{id: "root", topic_name: "roles", hook_name: "users"}],
                disabled: false, time: 1789920406, __sessions: {},
                __md_treedb__: {immutable: true}
            },
            {
                id: "operator@example.com", roles: ["roles^controlcenter^users"],
                disabled: true, time: 1790000000, __sessions: {s1: {}}
            }
        ];
        expect(user_rows(data)).toEqual([
            {id: "yuneta", roles: ["root"], disabled: false, time: 1789920406,
             sessions: 0, immutable: true},
            {id: "operator@example.com", roles: ["controlcenter"], disabled: true,
             time: 1790000000, sessions: 1, immutable: false}
        ]);
    });

    it("skips what is not a user", () => {
        expect(user_rows([null, {}, {id: ""}, {id: 3}])).toEqual([]);
        expect(user_rows(null)).toEqual([]);
    });
});


describe("role_rows", () => {
    it("keeps the roles sorted by id", () => {
        let data = [
            {id: "root", description: "Super-Owner of system", service: "*", realm_id: "*"},
            {id: "controlcenter", disabled: true, service: "controlcenter"}
        ];
        expect(role_rows(data).map((r) => [r.id, r.description, r.disabled, r.service, r.realm_id])).toEqual([
            ["controlcenter", "", true, "controlcenter", ""],
            ["root", "Super-Owner of system", false, "*", "*"]
        ]);
    });

    it("carries what it grants, its users and whether it is a seed", () => {
        let [r] = role_rows([{
            id: "op", permission: "run-scenarios", deny: false,
            permissions: [{permission: "read-scenarios"}, "junk", {permission: "x", deny: true, parameters: {k: "v"}}],
            parameters: {scenario_id: ["s1"]},
            users: [{id: "ops@example.com", topic_name: "users"}], roles: [],
            __md_treedb__: {immutable: true}
        }]);
        expect(r.permissions).toEqual([
            {permission: "read-scenarios", deny: false},
            {permission: "x", deny: true, parameters: {k: "v"}}
        ]);
        expect(r.users).toEqual(["ops@example.com"]);
        expect(r.immutable).toBe(true);
        expect(r.parameters).toEqual({scenario_id: ["s1"]});
    });
});

describe("role_grants", () => {
    it("one line per permission; an entry without a scope takes the role's", () => {
        let role = {permission: "run-scenarios", deny: false, parameters: {scenario_id: ["s1"]},
            permissions: [{permission: "read-scenarios", deny: false},
                          {permission: "write-scenarios", deny: true, parameters: {scenario_id: ["s2"]}}]};
        expect(role_grants(role)).toEqual([
            {permission: "run-scenarios", deny: false, scope: {scenario_id: ["s1"]}, own_scope: false},
            {permission: "read-scenarios", deny: false, scope: {scenario_id: ["s1"]}, own_scope: false},
            {permission: "write-scenarios", deny: true, scope: {scenario_id: ["s2"]}, own_scope: true}
        ]);
    });
});

describe("scope as text", () => {
    it("reads and writes `key=v1,v2; key2=v3`", () => {
        expect(format_scope({scenario_id: ["a", "b"], k: "v"})).toBe("scenario_id=a,b; k=v");
        expect(format_scope({})).toBe("");
        expect(parse_scope(" scenario_id = a , b ; k=v ")).toEqual({ok: true, scope: {scenario_id: ["a", "b"], k: ["v"]}});
        expect(parse_scope("")).toEqual({ok: true, scope: {}});
    });
    it("refuses what is not a scope", () => {
        expect(parse_scope("a b=1").key).toBe("scope bad syntax");
        expect(parse_scope("=1").key).toBe("scope bad syntax");
        expect(parse_scope("k=, ,").key).toBe("scope without values");
    });
});

describe("role_problem / role_record", () => {
    const declared = [
        {id: "command-agent", parameters: []},
        {id: "read-scenarios", parameters: [{id: "scenario_id"}]},
        {id: "run-scenarios", parameters: [{id: "scenario_id"}]}
    ];
    const form = {id: "op", description: "Runs s1", realm_id: "*", service: "controlcenter",
        permission: "run-scenarios", deny: false, scope_text: "scenario_id=s1",
        entries: [{permission: "read-scenarios", deny: false, scope_text: ""}]};

    it("a good role passes, and its record is what the sheet edits", () => {
        expect(role_problem(form, declared)).toBe(null);
        expect(role_record(form)).toEqual({
            id: "op", description: "Runs s1", disabled: false, realm_id: "*", service: "controlcenter",
            permission: "run-scenarios", deny: false,
            permissions: [{permission: "read-scenarios", deny: false}],
            parameters: {scenario_id: ["s1"]}
        });
    });
    it("says why one cannot be written", () => {
        let p = (patch) => role_problem(Object.assign({}, form, patch), declared);
        expect(p({id: ""}).key).toBe("role id required");
        expect(p({id: "a b"}).key).toBe("role id bad chars");
        expect(p({description: " "}).key).toBe("role description required");
        expect(p({permission: "", entries: []}).key).toBe("role grants nothing");
        expect(p({permission: "drop-agent"})).toEqual({key: "permission not of the service", detail: "drop-agent"});
        /*  A scope on a key the permission does not declare: C_AUTHZ would
         *  grant nothing with it  */
        expect(p({permission: "command-agent"})).toEqual({key: "scope key not declared", detail: "command-agent: scenario_id"});
        expect(p({entries: [{permission: "read-scenarios", own: true, scope_text: "node=x"}]}))
            .toEqual({key: "scope key not declared", detail: "read-scenarios: node"});
        /*  Without a scope of its own, an entry takes the role's  */
        expect(p({entries: [{permission: "command-agent", own: false, scope_text: ""}]}))
            .toEqual({key: "scope key not declared", detail: "command-agent: scenario_id"});
        expect(p({scope_text: "scenario_id"}).key).toBe("scope bad syntax");
    });
    it("a scope of its own that is empty is kept: {}, unscoped, not the role's", () => {
        let f = Object.assign({}, form, {entries: [
            {permission: "command-agent", deny: false, own: true, scope_text: ""},
            {permission: "read-scenarios", deny: false, own: false, scope_text: "ignored=x"}
        ]});
        expect(role_problem(f, declared)).toBe(null);
        expect(role_record(f).permissions).toEqual([
            {permission: "command-agent", deny: false, parameters: {}},
            {permission: "read-scenarios", deny: false}
        ]);
    });
    it("with no declaration known, names and keys are left to the service", () => {
        expect(role_problem(Object.assign({}, form, {permission: "anything"}), null)).toBe(null);
        expect(role_problem(Object.assign({}, form, {permission: "*"}), declared)).toBe(null);
    });
});


describe("roles_change", () => {
    it("adds what is wanted and removes what is not", () => {
        expect(roles_change(["root", "owner"], ["owner", "controlcenter"])).toEqual({
            add: ["controlcenter"], remove: ["root"]
        });
    });

    it("writes nothing when nothing moved", () => {
        expect(roles_change(["a", "b"], ["b", "a"])).toEqual({add: [], remove: []});
        expect(roles_change(null, null)).toEqual({add: [], remove: []});
    });
});


describe("refs of a role link", () => {
    it("names the role as parent through its users hook", () => {
        expect(role_parent_ref("root")).toBe("roles^root^users");
        expect(user_child_ref("operator@example.com")).toBe("users^operator@example.com");
    });
});


describe("username_problem", () => {
    it("accepts an e-mail address", () => {
        expect(username_problem("operator@example.com")).toBe("");
        expect(username_problem("  yuneta  ")).toBe("");
    });

    it("refuses an empty name, a blank or a ref separator", () => {
        expect(username_problem("")).toBe("username required");
        expect(username_problem("   ")).toBe("username required");
        expect(username_problem(null)).toBe("username required");
        expect(username_problem("jane doe")).toBe("username bad chars");
        expect(username_problem("a^b")).toBe("username bad chars");
    });
});
