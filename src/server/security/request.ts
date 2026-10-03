import { AppError } from "@/server/errors";

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** CSRF defence for cookie-authenticated JSON APIs: mutating requests must come from our own origin. */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AppError(403, "BAD_ORIGIN", "Request origin could not be verified.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, "BAD_ORIGIN", "Request origin could not be verified.");
  }
  if (originHost !== host) throw new AppError(403, "BAD_ORIGIN", "Cross-site request blocked.");
}
