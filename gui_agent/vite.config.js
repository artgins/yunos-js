/***********************************************************************
 *          vite.config.js
 *
 *          Build config for the Yuneta Agent Console SPA.
 *
 *          @yuneta/gobj-js and @yuneta/gobj-ui come from the npm
 *          REGISTRY, not from the kernel/js checkouts — same model as
 *          wattyzer/gui. gobj-ui is still imported as source by package
 *          specifier (@yuneta/gobj-ui/src/*.js, exports map "./src/*");
 *          gobj-js publishes only dist/, so it resolves to its bundle.
 *
 *          Consequence: a local edit under yunetas/kernel/js does NOT
 *          reach this app. To pick up library work: commit + bump +
 *          npm publish there, bump the submodule pointer in yunetas,
 *          then raise the range in package.json.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import { defineConfig } from "vite";
import { yunetaHtmlPlugin } from "@yuneta/gobj-ui/vite-plugin-yuneta-html.js";

export default defineConfig({
    resolve: {
        /*
         *  WARNING: gobj-ui declares this whole list as peerDependencies and
         *  npm installs its own copies, so a range that drifts from ours gets
         *  a NESTED copy. Every dependency shared between this app and those
         *  packages — and any shared singleton gobj-ui relies on — MUST be
         *  listed here, otherwise each gets its own internal state (__yuno__,
         *  i18next store, etc.) causing hard-to-debug failures: a component
         *  that imports a module-level singleton (i18next's `t`) binds an
         *  uninitialized second copy and renders blank. Seen: i18next split →
         *  col_label's `t()` ran on an UNINITIALIZED instance → every treedb
         *  column header rendered blank (Tabulator's `&nbsp;` placeholder);
         *  @antv/g6 split → "extension drag-canvas has been registered
         *  before" and a broken Graphs view.
         *  Mirror wattyzer/gui/vite.config.js when adding a shared lib.
         */
        dedupe: [
            "@yuneta/gobj-js",
            "i18next",
            "@antv/g6",
            "maplibre-gl",
            "tabulator-tables",
            "tom-select",
            "uplot",
            "vanilla-jsoneditor",
        ],
    },
    build: {
        sourcemap: true,
        /*
         *  Rollup splits on the dynamic import()s of src/lazy_modules.js, so
         *  the entry chunk carries the login screen, the shell and the two
         *  table workspaces, and nothing else: ~227 kB gzipped where it used
         *  to be 1.07 MB. What is left out arrives with the feature that
         *  needs it — @antv/g6 (~403 kB gz, the Frontend-view window and the
         *  schema graph), vanilla-jsoneditor + CodeMirror (~333 kB gz, the
         *  Schemas editor) and @xterm (~89 kB gz, the Terminal).
         *
         *  The limit is 1500 and not the 6000 that used to sit here silencing
         *  everything: @antv/g6 is a 1.4 MB third-party mass we do not
         *  control, and this leaves the warning able to fire when OUR chunks
         *  grow. Raising it is not the fix — splitting is.
         */
        chunkSizeWarningLimit: 1500
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
