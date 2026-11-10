import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { staticAssetHeaders } from "./build/headers.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), staticAssetHeaders(env)],
    server: { port: 5173, strictPort: true },
    build: { sourcemap: false, target: "es2022" },
  };
});
