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
                id: "claudia@artgins.com", roles: ["roles^controlcenter^users"],
                disabled: true, time: 1790000000, __sessions: {s1: {}}
            }
        ];
        expect(user_rows(data)).toEqual([
            {id: "yuneta", roles: ["root"], disabled: false, time: 1789920406,
             sessions: 0, immutable: true},
            {id: "claudia@artgins.com", roles: ["controlcenter"], disabled: true,
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
        expect(role_rows(data)).toEqual([
            {id: "controlcenter", description: "", disabled: true, service: "controlcenter", realm_id: ""},
            {id: "root", description: "Super-Owner of system", disabled: false, service: "*", realm_id: "*"}
        ]);
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
        expect(user_child_ref("claudia@artgins.com")).toBe("users^claudia@artgins.com");
    });
});


describe("username_problem", () => {
    it("accepts an e-mail address", () => {
        expect(username_problem("claudia@artgins.com")).toBe("");
        expect(username_problem("  yuneta  ")).toBe("");
    });

    it("refuses an empty name, a blank or a ref separator", () => {
        expect(username_problem("")).toBe("username required");
        expect(username_problem("   ")).toBe("username required");
        expect(username_problem(null)).toBe("username required");
        expect(username_problem("rosa martinez")).toBe("username bad chars");
        expect(username_problem("a^b")).toBe("username bad chars");
    });
});
