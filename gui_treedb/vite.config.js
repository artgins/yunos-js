import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { yunetaHtmlPlugin } from "@yuneta/gobj-ui/vite-plugin-yuneta-html.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        preserveSymlinks: true,
        /*
         *  Force a SINGLE copy of i18next across the bundle. gobj-ui ships its
         *  own node_modules/i18next (declared dependency), so without dedupe
         *  Vite bundles two copies: gui_treedb initializes copy A (locales.js)
         *  while the vendored treedb view (`import {t} from "i18next"`) binds
         *  copy B, which is never initialized — every column header then
         *  renders blank (Tabulator's `&nbsp;` placeholder for an empty title).
         *  Deduping makes both share the one initialized instance.
         */
        dedupe: ["i18next"],
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
