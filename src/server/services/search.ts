import "server-only";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { normalizePartNumber } from "@/core/conversation/parser";
import type { Candidate, DataLabel, ProductHit, SourceCard } from "@/core/conversation/types";
import { REGIONS } from "@/core/geo/countries";
import { db } from "@/server/db/client";
import {
  inventoryListings,
  manufacturers,
  organizations,
  productCrossReferences,
  products,
  supplierProfiles,
  supplierVerifications,
} from "@/server/db/schema";

const FUZZY_THRESHOLD = 0.35;

type ProductRow = {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  nsn: string | null;
  manufacturer: string | null;
  isDemo: boolean;
  exportControlStatus: "NOT_CONTROLLED" | "UNKNOWN" | "CONTROLLED";
};

const productColumns = {
  id: products.id,
  partNumber: products.partNumber,
  description: products.description,
  category: products.category,
  nsn: products.nsn,
  manufacturer: manufacturers.name,
  isDemo: products.isDemo,
  exportControlStatus: products.exportControlStatus,
};

/** Number of active, non-suspended supplier listings per product, and how many report stock. */
async function sourceStats(productIds: string[]) {
  if (!productIds.length) return new Map<string, { sources: number; available: number }>();
  const rows = await db
    .select({
      productId: inventoryListings.productId,
      sources: sql<number>`count(distinct ${inventoryListings.supplierOrgId})::int`,
      available: sql<number>`count(distinct ${inventoryListings.supplierOrgId}) filter (where coalesce(${inventoryListings.quantityAvailable},0) > 0)::int`,
    })
    .from(inventoryListings)
    .innerJoin(organizations, eq(organizations.id, inventoryListings.supplierOrgId))
    .where(and(inArray(inventoryListings.productId, productIds), eq(organizations.isSuspended, false)))
    .groupBy(inventoryListings.productId);
  return new Map(rows.map((r) => [r.productId, { sources: r.sources, available: r.available }]));
}

async function toHits(rows: ProductRow[], match: ProductHit["match"], evidence?: Map<string, string>): Promise<ProductHit[]> {
  const stats = await sourceStats(rows.map((r) => r.id));
  return rows.map((r) => ({
    productId: r.id,
    partNumber: r.partNumber,
    manufacturer: r.manufacturer,
    description: r.description,
    category: r.category,
    nsn: r.nsn,
    match,
    evidence: evidence?.get(r.id),
    sourceCount: stats.get(r.id)?.sources ?? 0,
    availableCount: stats.get(r.id)?.available ?? 0,
    isDemo: r.isDemo,
    exportControlled: r.exportControlStatus === "CONTROLLED",
  }));
}

export interface PartSearchResult {
  exact: ProductHit[];
  possible: ProductHit[];
  alternatives: ProductHit[];
}

/** Cross-references are only shown when documented (evidence is a required column). */
async function crossReferences(productIds: string[]): Promise<ProductHit[]> {
  if (!productIds.length) return [];
  const refs = await db
    .select({ related: productCrossReferences.relatedProductId, type: productCrossReferences.type, evidence: productCrossReferences.evidence, status: productCrossReferences.dataStatus })
    .from(productCrossReferences)
    .where(inArray(productCrossReferences.productId, productIds));
  if (!refs.length) return [];
  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(inArray(products.id, refs.map((r) => r.related)));
  const out: ProductHit[] = [];
  for (const ref of refs) {
    const row = rows.find((r) => r.id === ref.related);
    if (!row) continue;
    const label = ref.type === "SUPERSEDED_BY" ? "Superseded by (documented)" : ref.type === "DOCUMENTED_CROSS_REFERENCE" ? "Documented cross-reference" : "Alternative — technical equivalence not verified";
    const [hit] = await toHits([row], ref.type === "ALTERNATIVE" ? "ALTERNATIVE" : "CROSS_REFERENCE", new Map([[row.id, `${label}. Source: ${ref.evidence}. Status: ${ref.status.replace(/_/g, " ").toLowerCase()}.`]]));
    out.push(hit);
  }
  return out;
}

export async function searchPartNumber(pn: string): Promise<PartSearchResult> {
  const norm = normalizePartNumber(pn);
  if (!norm) return { exact: [], possible: [], alternatives: [] };
  const exactRows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(eq(products.pnNormalized, norm), eq(products.isActive, true)));
  const fuzzyRows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(sql`similarity(${products.pnNormalized}, ${norm}) >= ${FUZZY_THRESHOLD}`, sql`${products.pnNormalized} <> ${norm}`, eq(products.isActive, true)))
    .orderBy(sql`similarity(${products.pnNormalized}, ${norm}) desc`)
    .limit(5);
  const exact = await toHits(exactRows, "EXACT");
  const alternatives = await crossReferences(exactRows.map((r) => r.id));
  const altIds = new Set(alternatives.map((a) => a.productId));
  const possible = (await toHits(fuzzyRows, "POSSIBLE")).filter((p) => !altIds.has(p.productId));
  return { exact, possible, alternatives };
}

export async function searchNsn(nsn: string): Promise<PartSearchResult> {
  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(eq(products.nsn, nsn));
  const exact = await toHits(rows, "EXACT");
  return { exact, possible: [], alternatives: await crossReferences(rows.map((r) => r.id)) };
}

/** Full-text search across descriptions/categories, plus manufacturer name matches. */
export async function searchText(text: string, category?: string, limit = 6): Promise<ProductHit[]> {
  const q = text.trim();
  if (!q) return [];
  const tsq = sql`plainto_tsquery('simple', ${q})`;
  const singularWords = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/(ies)$/, "y").replace(/(ses|xes|ches|shes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, "$1"))
    .join(" ");
  const tsq2 = sql`plainto_tsquery('simple', ${singularWords})`;
  const rank = sql<number>`greatest(ts_rank(${products.searchVector}, ${tsq}), ts_rank(${products.searchVector}, ${tsq2}))`;
  const rows = await db
    .select({ ...productColumns, rank })
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(
      and(
        eq(products.isActive, true),
        or(
          sql`${products.searchVector} @@ ${tsq}`,
          sql`${products.searchVector} @@ ${tsq2}`,
          sql`lower(${manufacturers.name}) like ${"%" + q.toLowerCase().replace(/[%_]/g, "") + "%"}`,
          category ? sql`lower(${products.category}) = ${category.toLowerCase()}` : sql`false`,
        ),
      ),
    )
    .orderBy(sql`${rank} desc`)
    .limit(limit);
  return toHits(rows, "POSSIBLE");
}

export async function findManufacturer(text: string) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return null;
  const rows = await db
    .select()
    .from(manufacturers)
    .where(or(sql`lower(${manufacturers.name}) = ${q}`, sql`similarity(lower(${manufacturers.name}), ${q}) > 0.45`))
    .orderBy(sql`similarity(lower(${manufacturers.name}), ${q}) desc`)
    .limit(1);
  return rows[0] ?? null;
}

export async function getProduct(productId: string) {
  const rows = await db
    .select({ ...productColumns, specs: products.specs, controlClassification: products.controlClassification, dataStatus: products.dataStatus, modelNumber: products.modelNumber, unitOfMeasure: products.unitOfMeasure })
    .from(products)
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(eq(products.id, productId))
    .limit(1);
  return rows[0] ?? null;
}

export function toCandidate(h: ProductHit): Candidate {
  return { productId: h.productId, partNumber: h.partNumber, manufacturer: h.manufacturer, description: h.description, match: h.match };
}

/** Verification badges a supplier has actually earned (approved, not expired). */
export async function supplierBadges(orgIds: string[]): Promise<Map<string, string[]>> {
  if (!orgIds.length) return new Map();
  const rows = await db
    .select({ orgId: supplierVerifications.organizationId, level: supplierVerifications.level })
    .from(supplierVerifications)
    .where(
      and(
        inArray(supplierVerifications.organizationId, orgIds),
        eq(supplierVerifications.state, "APPROVED"),
        or(isNull(supplierVerifications.expiresAt), gt(supplierVerifications.expiresAt, new Date())),
      ),
    );
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.orgId, [...(map.get(r.orgId) ?? []), r.level]);
  return map;
}

/** Supplier listings for a product. Location is city/country only — never warehouse addresses. */
export async function productSources(productId: string, region?: string): Promise<SourceCard[]> {
  const rows = await db
    .select({
      listing: inventoryListings,
      supplierName: organizations.name,
      supplierCountry: organizations.country,
      supplierType: supplierProfiles.supplierType,
      partNumber: products.partNumber,
      description: products.description,
      manufacturer: manufacturers.name,
    })
    .from(inventoryListings)
    .innerJoin(organizations, eq(organizations.id, inventoryListings.supplierOrgId))
    .leftJoin(supplierProfiles, eq(supplierProfiles.organizationId, organizations.id))
    .innerJoin(products, eq(products.id, inventoryListings.productId))
    .leftJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(eq(inventoryListings.productId, productId), eq(organizations.isSuspended, false)));
  let filtered = rows;
  if (region) {
    const countries = REGIONS[region] ?? [region.toUpperCase()];
    filtered = rows.filter((r) => countries.includes(r.listing.country));
  }
  const badges = await supplierBadges([...new Set(filtered.map((r) => r.listing.supplierOrgId))]);
  return filtered
    .map((r) => ({
      listingId: r.listing.id,
      supplierName: r.supplierName,
      supplierType: r.supplierType ?? "SUPPLIER",
      supplierCountry: r.supplierCountry,
      city: r.listing.city,
      country: r.listing.country,
      partNumber: r.partNumber,
      description: r.description,
      manufacturer: r.manufacturer,
      condition: r.listing.condition,
      quantityAvailable: r.listing.quantityAvailable,
      availabilityStatus: r.listing.availabilityStatus as DataLabel,
      priceType: r.listing.priceType,
      priceMin: r.listing.priceMin === null ? null : Number(r.listing.priceMin),
      priceMax: r.listing.priceMax === null ? null : Number(r.listing.priceMax),
      currency: r.listing.currency,
      priceStatus: r.listing.priceStatus as DataLabel,
      leadTimeDays: r.listing.leadTimeDays,
      certification: r.listing.certification,
      certificationStatus: r.listing.certificationStatus as DataLabel,
      verifications: badges.get(r.listing.supplierOrgId) ?? [],
      reportedAt: r.listing.reportedAt.toISOString(),
      isDemo: r.listing.isDemo,
    }))
    .sort((a, b) => Number((b.quantityAvailable ?? 0) > 0) - Number((a.quantityAvailable ?? 0) > 0));
}
