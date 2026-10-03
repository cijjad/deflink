import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
