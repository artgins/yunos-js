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
            "vanilla-jsoneditor",
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
