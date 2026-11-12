import { defineConfig } from "vitest/config";

export default defineConfig({ test: { name: "deploy-tool", include: ["test/**/*.test.ts"] } });
