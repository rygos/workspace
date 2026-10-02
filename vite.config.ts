import { defineConfig } from "vite"

const localModelProxy = {
  "/__workshop_lmstudio": {
    target: "http://127.0.0.1:1234",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/__workshop_lmstudio/, ""),
  },
}

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: localModelProxy,
  },
  preview: {
    proxy: localModelProxy,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env["TAURI_ENV_PLATFORM"] === "windows" ? "chrome105" : "safari13",
    minify: !process.env["TAURI_ENV_DEBUG"] ? "esbuild" : false,
    sourcemap: Boolean(process.env["TAURI_ENV_DEBUG"]),
  },
})
