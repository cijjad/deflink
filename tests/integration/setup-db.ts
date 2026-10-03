import { execSync } from "node:child_process";

export const TEST_DB = "postgres://deflink:deflink@127.0.0.1:5432/deflink_test";

/** Rebuilds the test database with migrations + DEMO data once per test run. */
export default function setup() {
  process.env.DATABASE_URL = TEST_DB;
  const env = { ...process.env, DATABASE_URL: TEST_DB };
  execSync("npx tsx scripts/reset-db.ts && npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts", { env, stdio: "pipe" });
}
