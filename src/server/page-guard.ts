import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

/** For server pages: returns the session or redirects to sign-in (preserving where the user was going). */
export async function pageSession(next: string, kind?: "BUYER" | "SUPPLIER") {
  const s = await getCurrentUser();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (kind === "BUYER" && s.org.kind === "SUPPLIER") redirect("/supplier");
  if (kind === "SUPPLIER" && s.org.kind !== "SUPPLIER") redirect("/requests");
  return s;
}
