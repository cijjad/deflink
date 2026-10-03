import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/server/env";

declare global {
  var __deflinkPool: Pool | undefined;
}

// Reuse the pool across hot reloads in development.
const pool =
  globalThis.__deflinkPool ??
  new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined });
if (process.env.NODE_ENV !== "production") globalThis.__deflinkPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { pool };
