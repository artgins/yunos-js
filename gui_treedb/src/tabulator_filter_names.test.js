// @vitest-environment jsdom
/***********************************************************************
 *          tabulator_filter_names.test.js
 *
 *      A header filter keeps its name across every build of its columns,
 *      in a real Tabulator under jsdom:
 *
 *        - the Keys picker: built, then given its columns again by a
 *          language change (ac_language_changed);
 *        - a Rows card: autoColumns over a remote page, then page 2;
 *        - a Live card: no columns, then seeded by its first record with
 *          setColumns().
 *
 *      And every Tabulator of C_TRANGER_VIEW is handed to
 *      keep_header_filters_named(): the picker had no name on its filter at
 *      all, and the cards named theirs once, at tableBuilt.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {describe, test, expect, beforeAll} from "vitest";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import i18next from "i18next";
import {TabulatorFull as Tabulator} from "tabulator-tables";
import {keep_header_filters_named} from "./tabulator_filter_names.js";

beforeAll(async () => {
    await i18next.init({
        lng: "en",
        resources: {
            en: {translation: {"filter by column": "Filter by {{column}}"}},
            es: {translation: {"filter by column": "Filtrar por {{column}}"}}
        }
    });
});

function names_of(table)
{
    return [...table.element.querySelectorAll(".tabulator-header-filter input")].map(
        ($i) => [$i.getAttribute("title"), $i.getAttribute("aria-label")]);
}

function built(table)
{
    return new Promise((resolve) => {
        table.on("tableBuilt", () => {
            resolve();
        });
    });
}

function host()
{
    let $div = document.createElement("div");
    document.body.appendChild($div);
    return $div;
}

describe("a header filter is named after every build of its columns", () => {
    test("the Keys picker: built, then its columns again in another language", async () => {
        await i18next.changeLanguage("en");
        let table = new Tabulator(host(), {
            columns: [{title: "key", field: "key", headerFilter: "input"}],
            data: [{key: "a"}]
        });
        keep_header_filters_named(table);
        await built(table);
        expect(names_of(table)).toEqual([["Filter by key", "Filter by key"]]);

        await i18next.changeLanguage("es");
        table.setColumns([{title: "clave", field: "key", headerFilter: "input"}]);
        expect(names_of(table)).toEqual([["Filtrar por clave", "Filtrar por clave"]]);
        table.destroy();
    });

    test("a Rows card: autoColumns over a remote page, then page 2", async () => {
        await i18next.changeLanguage("en");
        let pages = {
            1: [{rowid: 1, a: "x"}],
            2: [{rowid: 2, a: "y", b: "z"}]
        };
        let table = new Tabulator(host(), {
            pagination: true,
            paginationMode: "remote",
            paginationSize: 1,
            ajaxURL: "get-page",
            ajaxRequestFunc: (url, config, params) => {
                return Promise.resolve({last_page: 2, data: pages[params.page || 1]});
            },
            autoColumns: true,
            autoColumnsDefinitions: (defs) => defs.map((d) => {
                d.headerFilter = "input";
                return d;
            })
        });
        keep_header_filters_named(table);
        await built(table);
        await table.setPage(1);
        expect(names_of(table)).toEqual([
            ["Filter by rowid", "Filter by rowid"], ["Filter by a", "Filter by a"]
        ]);
        await table.setPage(2);
        expect(names_of(table)).toEqual([
            ["Filter by rowid", "Filter by rowid"], ["Filter by a", "Filter by a"],
            ["Filter by b", "Filter by b"]
        ]);
        table.destroy();
    });

    test("a Live card: seeded by its first record", async () => {
        await i18next.changeLanguage("en");
        let table = new Tabulator(host(), {columns: [], data: []});
        keep_header_filters_named(table);
        await built(table);
        table.setColumns([{title: "rowid", field: "rowid", headerFilter: "input"}]);
        expect(names_of(table)).toEqual([["Filter by rowid", "Filter by rowid"]]);
        table.destroy();
    });

    test("every Tabulator of C_TRANGER_VIEW keeps its filters named", () => {
        /*  run from the app's directory (jsdom gives import.meta no file url)  */
        let src = readFileSync(
            new URL("src/c_tranger_view.js", pathToFileURL(`${process.cwd()}/`)), "utf8");
        let tables = [...src.matchAll(/let (\w+) = new Tabulator\(/g)].map((m) => m[1]);
        expect(tables.length).toBe(3);
        for(let name of tables) {
            expect(src).toContain(`keep_header_filters_named(${name});`);
        }
    });
});
