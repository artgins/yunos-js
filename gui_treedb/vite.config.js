/*
 *  @yuneta/gobj-js and @yuneta/gobj-ui come from the npm REGISTRY, not from
 *  the kernel/js checkouts — same model as wattyzer/gui. gobj-ui is still
 *  imported as source by package specifier (@yuneta/gobj-ui/src/*.js, exports
 *  map "./src/*"); gobj-js publishes only dist/, so it resolves to its bundle.
 *
 *  Consequence: a local edit under yunetas/kernel/js does NOT reach this app.
 *  To pick up library work: commit + bump + npm publish there, bump the
 *  submodule pointer in yunetas, then raise the range in package.json.
 */
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
        chunkSizeWarningLimit: 6000
    },
    server: {
        watch: {
            usePolling: true,
            interval: 300
        },
        proxy: {
            "/auth": {
                target: "https://localhost:1808",
                changeOrigin: true,
                secure: false      // accept self-signed certs in dev
            }
        }
    },
    test: {
        globals: true,  // Use global `describe` and `test` like Jest
        environment: "node",  // Use Node.js or browser as test environment
        coverage: {
            reporter: ["text", "json", "html"],  // Test coverage output
        },
    },
    plugins: [
        yunetaHtmlPlugin({ defaultTitle: "TreeDB GUI" })
    ]
});
