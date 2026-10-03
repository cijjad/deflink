import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"), "next/headers": path.resolve(__dirname, "tests/stubs/next-headers.ts") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20000,
    globalSetup: ["tests/integration/setup-db.ts"],
    env: { DATABASE_URL: "postgres://deflink:deflink@127.0.0.1:5432/deflink_test", AI_PROVIDER: "rules" },
  },
});
