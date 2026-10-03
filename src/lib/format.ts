import { countryName } from "@/core/geo/countries";

export function money(value: number | string | null | undefined, currency = "USD") {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function num(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function date(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function place(city: string | null | undefined, country: string | null | undefined) {
  return [city, countryName(country)].filter(Boolean).join(", ") || "—";
}

export function humanize(code: string | null | undefined) {
  if (!code) return "—";
  return code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");
}

export const AVAILABILITY_LABEL: Record<string, string> = { IN_STOCK: "In stock", FACTORY_ORDER: "Factory order", PARTIAL: "Partial stock" };

/** ISO date (yyyy-mm-dd) n days from now — used for sensible form defaults. */
export function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}
