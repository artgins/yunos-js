// @vitest-environment jsdom
/***********************************************************************
 *          login.test.js
 *
 *      The login form says its messages in the language of the app, and
 *      the toggle of its own card changes them: refresh_language() cannot
 *      reach a composed message, which has no single key, so the form keeps
 *      how to compose it and composes it again.
 *
 *      Driven through the real form, in jsdom, with the real locales; the
 *      language changes by a click on its toggle.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll, afterEach} from "vitest";
import {t} from "i18next";

const {setup_locale, switch_locale} = await import("./locales/locales.js");
const {en} = await import("./locales/en.js");
const {es} = await import("./locales/es.js");
const {mount_login} = await import("./login.js");

let ui = null;

function alert_text()
{
    return document.querySelector("[data-role=error]").textContent;
}

function toggle_language()
{
    document.querySelector("[data-quick=lang]").click();
}

beforeAll(async () => {
    setup_locale();
});

afterEach(() => {
    if(ui) {
        ui.unmount();
        ui = null;
    }
    switch_locale("es");
});

describe("the login form and the language", () => {

    test("a composed message is composed again by the toggle of the card", () => {
        switch_locale("es");
        ui = mount_login({on_submit: () => {}});
        ui.set_error(() => `${t("login failed")}: ${t("server_busy")}`);
        expect(alert_text()).toBe(
            `${es.translation["login failed"]}: ${es.translation["server_busy"]}`);

        toggle_language();
        expect(alert_text()).toBe(
            `${en.translation["login failed"]}: ${en.translation["server_busy"]}`);

        toggle_language();
        expect(alert_text()).toBe(
            `${es.translation["login failed"]}: ${es.translation["server_busy"]}`);
    });

    test("a message cleared does not come back with the toggle", () => {
        switch_locale("es");
        ui = mount_login({on_submit: () => {}});
        ui.set_error(() => t("login failed"));
        ui.clear_error();
        toggle_language();
        expect(alert_text()).toBe("");
        expect(document.querySelector("[data-role=error]").hidden).toBe(true);
    });

    test("what the form says of an empty field changes language too", () => {
        switch_locale("es");
        ui = mount_login({on_submit: () => {}});
        document.querySelector(".ylogin-fields").dispatchEvent(
            new Event("submit", {bubbles: true, cancelable: true}));
        expect(alert_text()).toBe(es.translation["username and password are required"]);

        toggle_language();
        expect(alert_text()).toBe(en.translation["username and password are required"]);
    });
});
