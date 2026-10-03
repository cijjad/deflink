import { execSync } from "node:child_process";

export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://deflink:deflink@127.0.0.1:5432/deflink_test";
  execSync("npx tsx scripts/reset-db.ts && npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
