/**
 * DEMO DATA ONLY.
 * Every organisation, manufacturer, part number, listing and price below is fictional and is flagged is_demo=true.
 * Names use the NATO phonetic alphabet + "Demo" so they cannot be mistaken for real companies.
 * E-mail addresses use the reserved .test TLD (RFC 2606).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as s from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { normalizePartNumber } from "../src/core/conversation/parser";

const url = process.env.DATABASE_URL ?? "postgres://deflink:deflink@127.0.0.1:5432/deflink";
const PASSWORD = process.env.SEED_PASSWORD ?? "DemoPass2026!";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to load DEMO data in production. Set ALLOW_DEMO_SEED=true to override.");
  process.exit(1);
}

import { CROSS_REFS, LISTINGS, MANUFACTURERS, OEM_RELATIONSHIPS, PRODUCTS, SUPPLIERS } from "./demo-data";

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.organizations);
  if (n > 0) {
    console.error("Database already has data. Run `npm run db:reset` first to load a clean DEMO dataset.");
    process.exit(1);
  }
  const hash = await hashPassword(PASSWORD);

  await db.transaction(async (tx) => {
    // Platform operator
    const [platform] = await tx.insert(s.organizations).values({ name: "DefLink Platform Operations (DEMO)", kind: "PLATFORM", country: "AE", isDemo: true }).returning();
    const [admin] = await tx
      .insert(s.users)
      .values({ organizationId: platform.id, name: "Platform Admin (Demo)", email: "admin@deflink.test", passwordHash: hash, role: "ORG_ADMIN", isPlatformAdmin: true, country: "AE" })
      .returning();

    // Buyers
    const [buyerOrg] = await tx.insert(s.organizations).values({ name: "Demo Buyer Organization", kind: "BUYER", country: "PK", city: "Islamabad", isDemo: true }).returning();
    await tx.insert(s.users).values([
      { organizationId: buyerOrg.id, name: "Ayesha Demo (Procurement)", email: "buyer@demo.test", passwordHash: hash, role: "PROCUREMENT_OFFICER", country: "PK" },
      { organizationId: buyerOrg.id, name: "Bilal Demo (Viewer)", email: "viewer@demo.test", passwordHash: hash, role: "VIEWER", country: "PK" },
    ]);
    const [buyer2] = await tx.insert(s.organizations).values({ name: "Second Demo Buyer", kind: "BUYER", country: "AE", city: "Dubai", isDemo: true }).returning();
    await tx.insert(s.users).values({ organizationId: buyer2.id, name: "Omar Demo", email: "buyer2@demo.test", passwordHash: hash, role: "PROCUREMENT_OFFICER", country: "AE" });

    // Manufacturers
    const mfrIds: Record<string, string> = {};
    for (const m of MANUFACTURERS) {
      const [row] = await tx.insert(s.manufacturers).values({ name: m.name, country: m.country, isDemo: true }).returning();
      mfrIds[m.key] = row.id;
    }

    // Products
    const productIds: Record<string, string> = {};
    for (const p of PRODUCTS) {
      const [row] = await tx
        .insert(s.products)
        .values({
          partNumber: p.pn,
          pnNormalized: normalizePartNumber(p.pn),
          manufacturerId: mfrIds[p.mfr],
          description: p.description,
          category: p.category,
          specs: { ...(p.specs ?? {}), Data: "DEMO — fictional" },
          exportControlStatus: p.controlled ? "CONTROLLED" : "NOT_CONTROLLED",
          controlClassification: p.controlled ? "DEMO-ONLY — not a real classification" : null,
          dataStatus: "VERIFIED",
          isDemo: true,
        })
        .returning();
      productIds[p.pn] = row.id;
    }

    // Documented cross-references (evidence is mandatory)
    await tx.insert(s.productCrossReferences).values(
      CROSS_REFS.map((x) => ({ productId: productIds[x.from], relatedProductId: productIds[x.to], type: x.type, evidence: x.evidence, dataStatus: x.status, isDemo: true })),
    );

    // Suppliers
    const supplierIds: Record<string, string> = {};
    for (const sp of SUPPLIERS) {
      const [org] = await tx.insert(s.organizations).values({ name: sp.name, kind: "SUPPLIER", country: sp.country, city: sp.city, isDemo: true }).returning();
      supplierIds[sp.key] = org.id;
      await tx.insert(s.users).values({
        organizationId: org.id,
        name: `${sp.name.split(" ")[0]} Demo Sales`,
        email: `${sp.key}@supplier.demo.test`,
        passwordHash: hash,
        role: "PROCUREMENT_OFFICER",
        country: sp.country,
      });
      await tx.insert(s.supplierProfiles).values({
        organizationId: org.id,
        supplierType: sp.type,
        region: sp.region,
        categories: sp.categories,
        marketsServed: ["Middle East", "South Asia", "Europe"],
        about: "DEMO supplier profile — fictional organisation for development and testing.",
      });
      for (const level of sp.levels) {
        await tx.insert(s.supplierVerifications).values({
          organizationId: org.id,
          level,
          state: "APPROVED",
          evidenceNote: "DEMO verification record — fictional",
          reviewedByUserId: admin.id,
          reviewedAt: new Date(),
          isDemo: true,
        });
      }
      if (sp.pendingLevel) {
        await tx.insert(s.supplierVerifications).values({ organizationId: org.id, level: sp.pendingLevel, state: "PENDING", evidenceNote: "Awaiting documents (DEMO)", isDemo: true });
      }
    }

    for (const r of OEM_RELATIONSHIPS) {
      await tx.insert(s.supplierOemRelationships).values({ supplierOrgId: supplierIds[r.supplier], manufacturerId: mfrIds[r.mfr], relationship: r.rel, dataStatus: r.status, isDemo: true });
    }

    for (const l of LISTINGS) {
      const sp = SUPPLIERS.find((x) => x.key === l.supplier)!;
      const price = l.price;
      await tx.insert(s.inventoryListings).values({
        supplierOrgId: supplierIds[l.supplier],
        productId: productIds[l.pn],
        condition: l.condition ?? "NEW",
        quantityAvailable: l.qty,
        city: sp.city,
        country: sp.country,
        priceType: price === undefined ? "ON_REQUEST" : Array.isArray(price) ? "RANGE" : "EXACT",
        priceMin: price === undefined ? null : String(Array.isArray(price) ? price[0] : price),
        priceMax: price === undefined ? null : String(Array.isArray(price) ? price[1] : price),
        currency: "USD",
        priceStatus: l.priceStatus ?? "PENDING_VERIFICATION",
        availabilityStatus: "SUPPLIER_PROVIDED",
        leadTimeDays: l.lead,
        certification: l.cert ?? null,
        certificationStatus: l.cert ? "SUPPLIER_PROVIDED" : "PENDING_VERIFICATION",
        isDemo: true,
      });
    }

    await tx.insert(s.commercialPlans).values([
      { code: "DEMO-SUPPLIER-STD", name: "Supplier subscription (DEMO)", audience: "SUPPLIER", components: [{ type: "SUBSCRIPTION", period: "MONTH", amount: null, note: "Price not set — configure before launch" }] },
      { code: "DEMO-BUYER-ENT", name: "Enterprise buyer (DEMO)", audience: "BUYER", components: [{ type: "SUBSCRIPTION", period: "YEAR", amount: null }, { type: "SERVICE_FEE", basis: "PERCENT_OF_ORDER", value: null }] },
    ]);
  });

  console.log("DEMO data loaded. All records are fictional and flagged is_demo.");
  console.log(`Demo accounts (password: ${PASSWORD}):`);
  console.log("  buyer@demo.test            — buyer (procurement officer)");
  console.log("  alpha@supplier.demo.test   — supplier (Dubai)");
  console.log("  bravo@supplier.demo.test   — supplier (London, authorized distributor)");
  console.log("  admin@deflink.test         — platform admin");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
