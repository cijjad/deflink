/** Development only: drops and recreates the public schema, then applies migrations. */
import { Pool } from "pg";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset a production database.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? "postgres://deflink:deflink@127.0.0.1:5432/deflink";
  const pool = new Pool({ connectionString: url });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await pool.end();
  console.log("Schema dropped.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
