/***********************************************************************
 *          vite.config.js
 *
 *          Build config for the Yuneta Agent Console SPA.
 *
 *          Resolution mirrors the in-repo gui_treedb setup:
 *            - @yuneta/gobj-js  -> the submodule SOURCE (src/index.js),
 *              not its built dist/, so the app always tracks the
 *              current kernel source.
 *            - @yuneta/gobj-ui  -> the submodule ROOT, so package
 *              sub-paths (/index.js, /src/*.css) resolve to source.
 *          Both are also declared as `file:` deps in package.json so
 *          npm installs the peer libraries (bulma, i18next).
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { yunetaHtmlPlugin } from "@yuneta/gobj-ui/vite-plugin-yuneta-html.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        preserveSymlinks: true,
        /*
         *  WARNING: preserveSymlinks:true makes Vite load DUPLICATE module
         *  instances for the symlinked `file:` deps (@yuneta/gobj-ui here).
         *  gobj-ui ships its own node_modules copy of every shared lib below,
         *  so each must be deduped or the app and the vendored gobj-ui views
         *  each get their own instance / internal state — hard-to-debug
         *  failures. Seen: i18next split → col_label's `t()` ran on an
         *  UNINITIALIZED instance → every treedb column header rendered blank
         *  (Tabulator's `&nbsp;` placeholder); @antv/g6 split → "extension
         *  drag-canvas has been registered before" and a broken Graphs view.
         *  (@yuneta/gobj-js and @yuneta/gobj-ui are already single instances
         *  via the `src/` aliases below, so they are NOT listed here — unlike
         *  wattyzer, which consumes them by specifier and must dedupe them.)
         *  Mirror wattyzer/gui/vite.config.js when adding a shared lib.
         */
        dedupe: [
            "i18next",
            "@antv/g6",
            "maplibre-gl",
            "tabulator-tables",
            "tom-select",
            "uplot",
        ],
        alias: [
            {
                find: "@yuneta/gobj-js",
                replacement: path.resolve(__dirname, "../../../kernel/js/gobj-js/src/index.js"),
            },
            {
                find: /^@yuneta\/gobj-ui($|\/)/,
                replacement: path.resolve(__dirname, "../../../kernel/js/gobj-ui") + "/",
            },
        ],
    },
    build: {
        sourcemap: true,
        chunkSizeWarningLimit: 6000
    },
    server: {
        watch: {
            usePolling: true,
            interval: 300
        }
    },
    plugins: [
        yunetaHtmlPlugin({ defaultTitle: "Yuneta Agent Console" })
    ]
});
