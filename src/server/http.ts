import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "@/server/errors";
import { assertSameOrigin } from "@/server/security/request";

type Handler<C> = (req: Request, ctx: C) => Promise<Response | object | null | void>;

/** Wraps a route handler: CSRF origin check, JSON responses, and uniform error handling. */
export function route<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      assertSameOrigin(req);
      const result = await handler(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof AppError) {
        const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
        if (err.status === 429) {
          const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
          if (retry) res.headers.set("Retry-After", String(retry));
        }
        return res;
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "VALIDATION", message: "Some information is missing or invalid.", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
          { status: 400 },
        );
      }
      console.error("Unhandled API error", err);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new AppError(415, "UNSUPPORTED_MEDIA", "Expected JSON.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "BAD_JSON", "Invalid JSON body.");
  }
  return schema.parse(body);
}
