import react from "@vitejs/plugin-react";
import { i18nCatalogs } from "@gms/i18n/vite";
import { defineConfig, loadEnv } from "vite";
import { staticAssetHeaders } from "./build/headers.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    // i18nCatalogs: messages are parsed at build time, so the browser never loads the message parser (docs/i18n.md).
    plugins: [i18nCatalogs(), react(), staticAssetHeaders(env)],
    server: { port: 5173, strictPort: true },
    build: { sourcemap: false, target: "es2022" },
  };
});
