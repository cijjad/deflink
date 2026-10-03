# DefLink — Architecture & Implementation Plan

> Conversational procurement: **ASK → UNDERSTAND → FIND → RESPOND → QUANTITY → GET QUOTES → COMPARE → PROCURE**

This document is the Phase 1 deliverable. It records the decisions taken, why, and what is deliberately *not* built yet.

---

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Application shape | **One Next.js 16 (App Router) TypeScript app** serving the web UI *and* a JSON REST API under `/api/*` | Simplest architecture that meets the MVP. One deployable, one auth model. The REST API is the contract the mobile app will consume. |
| Database | **PostgreSQL 16** via **Drizzle ORM** + `node-postgres` | Relational integrity for RFQ/quote/audit data; SQL-first ORM, no runtime engine, typed schema, plain SQL migrations. |
| Search | **Postgres exact match + `pg_trgm` fuzzy + full-text (`tsvector`)**. Vector search behind a capability flag | Part numbers need exact / normalised / fuzzy match, not embeddings. Full-text covers descriptions. `pgvector` is added only when semantic recall is proven necessary (it is not installed in every managed Postgres). |
| AI | **Provider-agnostic `RequirementExtractor` interface**. Default = deterministic rules engine. Optional LLM provider (Anthropic) when `ANTHROPIC_API_KEY` is set | The app works with no AI vendor. The LLM is only ever used to **extract structure from what the user said** — it is never a source of facts (part numbers, suppliers, prices, stock). Facts come only from the database or from suppliers. This is the core anti-fabrication control. |
| Auth | First-party: scrypt password hashing, opaque session tokens (SHA-256 hashed at rest), httpOnly + SameSite=Lax cookies, TOTP MFA (RFC 6238) | No third-party identity dependency for the MVP; SSO (OIDC/SAML) slots in as another login method on the same session model. |
| Files | `StorageProvider` interface. Default: local disk outside the web root. Production: S3-compatible object storage with SSE | Files are never served statically — only through an authorised route that checks organisation ownership. SHA-256 recorded for integrity. |
| Notifications | In-app notifications table + `NotificationChannel` interface (email/SMS/push adapters). Dev email adapter writes to an outbox table | Channels are pluggable; nothing is "sent" silently in dev. |
| Mobile | **Phase 6**: Expo (React Native) client against the same `/api` | The web app is mobile-first and installable (PWA manifest) now. A native build is not claimed as done until it exists and is tested. |

## 2. User journeys (MVP)

1. **Single part** — "I need 25 units of Part ABC123" → part identified from DB → system asks only for what is missing (condition, destination) → requirement card → **GET QUOTES** → (login if anonymous; draft is preserved) → RFQ created → routed to eligible suppliers.
2. **Multi-item** — "I need 50 bearings, 20 filters and 10 pumps" → three requirement lines with identification status → **CREATE RFQ**.
3. **File** — upload XLSX/CSV → line extraction → "Found 20 items: 17 exact, 2 need confirmation, 1 not identified" → fix lines inline → **CREATE RFQ**.
4. **Supplier** — sees anonymised RFQ → submits quote → revises quote (revision history kept) → answers buyer messages.
5. **Buyer** — notified → opens quote → asks supplier → compares side by side (no "recommended supplier") → shortlists.
6. **Compliance** — controlled product or review-listed destination → RFQ held in `COMPLIANCE_REVIEW` → compliance officer/admin approves or rejects → only then distributed.

## 3. Information architecture

```
/                     Home — "What do you need?" conversation (public)
/requests             Buyer: my RFQs (auth)
/requests/[id]        RFQ detail: lines, quotes, comparison, messages
/quotes               Buyer: all quotations received
/messages             Threads (buyer & supplier)
/supplier             Supplier: incoming RFQs
/supplier/rfq/[id]    Supplier: RFQ detail, submit / revise quote, messages
/account              Profile, organisation, MFA
/admin                Platform admin: orgs & verification, products, compliance queue, rules, audit log
/login /register      Short forms; `next` param returns user to their draft
```
Mobile bottom navigation: **Home · Requests · Quotes · Messages · Account**.

## 4. Application architecture

```
src/
  app/                    Next.js routes (UI + /api route handlers)
  components/             Reusable UI (design system + feature components)
  core/                   Pure TypeScript, no I/O — portable to mobile
    conversation/         Parser (quantities, conditions, destinations, part numbers, multi-item),
                          dialogue engine (state machine → next question + smart actions)
    geo/                  Country & city gazetteer
  server/
    db/                   Drizzle schema, client, migrations, seed
    auth/                 Password hashing, sessions, TOTP, RBAC guards
    services/             Business logic — the ONLY layer that touches the DB
                          (search, conversation, rfq, quotation, messaging, documents,
                           notifications, compliance, audit, admin)
    ai/                   RequirementExtractor interface + rules / Anthropic providers
    storage/              StorageProvider (local, S3-compatible)
    security/             Rate limiting, origin checks, request validation
```
Rule: route handlers are thin — validate input (zod), resolve the session, call a service, return JSON. Services enforce organisation isolation on every query.

## 5. Data model (core tables)

| Domain | Tables |
|---|---|
| Identity | `organizations`, `users`, `sessions` |
| Catalogue | `manufacturers`, `products`, `product_cross_references` |
| Supply | `supplier_profiles`, `supplier_verifications`, `supplier_oem_relationships`, `inventory_listings` |
| Conversation | `conversations` (state = structured requirement draft), `conversation_messages` |
| Procurement | `rfqs`, `rfq_lines`, `rfq_recipients`, `quotations` (revisioned), `quotation_lines`, `message_threads`, `messages` |
| Files | `documents` |
| Control | `compliance_reviews`, `compliance_country_rules`, `audit_logs` (hash-chained), `notifications`, `email_outbox` |
| Commercial | `commercial_plans`, `organization_subscriptions` (schema only — no model hard-coded) |

**Data provenance** is a first-class column wherever a fact can be uncertain: `data_status ∈ {VERIFIED, SUPPLIER_PROVIDED, ESTIMATED, HISTORICAL, PENDING_VERIFICATION}` on prices, availability, lead time, certification, cross-references and OEM relationships. `is_demo` marks every seeded record; the UI shows a **DEMO** label on all of them.

## 6. Search architecture

Query classification is automatic (no "search type" selector):
1. **Exact**: normalised part number (upper-case, strip spaces/hyphens/dots/slashes) equality on `products.pn_normalized`; NSN pattern `NNNN-NN-NNN-NNNN`; model number.
2. **Fuzzy**: `pg_trgm` similarity on normalised part number → `POSSIBLE MATCH` (never "exact").
3. **Full-text**: `tsvector` over description, category, manufacturer, specs.
4. **Cross-references**: only from `product_cross_references` with evidence; classified `DOCUMENTED CROSS-REFERENCE` or `ALTERNATIVE`. Interchangeability is never inferred.
5. **Semantic (later)**: `pgvector` embedding column populated by the AI layer when enabled.

## 7. API architecture (REST, JSON)

```
POST /api/chat                         conversation turn (public, rate-limited)
POST /api/chat/upload                  extract lines from a file (public, size/type limited)
PATCH /api/chat/:id/requirement        edit any requirement field without restarting
POST /api/rfqs                         create RFQ from conversation (auth)
GET  /api/rfqs, /api/rfqs/:id
POST /api/rfqs/:id/shortlist
GET  /api/supplier/rfqs, /api/supplier/rfqs/:id
POST /api/supplier/rfqs/:id/quotes     submit / revise quotation
POST /api/threads/:id/messages         buyer↔supplier messages (bound to an RFQ)
GET  /api/notifications, POST /api/notifications/read
POST /api/auth/register|login|logout|mfa/*
GET  /api/documents/:id                authorised download
/api/admin/*                           platform admin
```

## 8. Security model

- **Organisation isolation**: every service query is scoped by the caller's `organization_id`; suppliers only see RFQs they are recipients of; buyers only their own org's RFQs. Tested explicitly.
- **RBAC**: org roles `ORG_ADMIN, PROCUREMENT_OFFICER, PROCUREMENT_MANAGER, FINANCE, COMPLIANCE_OFFICER, LOGISTICS, APPROVER, VIEWER`, plus platform flag `is_platform_admin`. Permissions are a code map (`can(user, action)`).
- **Sessions**: 256-bit random tokens; only SHA-256 stored; 12 h idle / 7 day absolute expiry; revoke on logout; MFA step-up flag on session.
- **Passwords**: scrypt (N=2^15, r=8, p=1), 16-byte salt, constant-time compare; min length 10.
- **CSRF**: SameSite=Lax cookies + `Origin` check on every mutating API request.
- **Rate limiting**: token bucket per IP+route (in-memory for single instance; Redis adapter required for multi-instance).
- **Headers**: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- **Buyer anonymity**: suppliers see country/region and verification status of the buyer, not its name, until the buyer chooses to proceed.
- **Uploads**: allow-listed MIME/extension, 10 MB cap, stored outside web root, served only via authorised route with `Content-Disposition: attachment`.
- **Audit**: append-only `audit_logs` with SHA-256 hash chain (`prev_hash`, `hash`) — tampering with any row breaks verification (`/admin/audit` verifies the chain).
- **Secrets**: only from environment variables; `.env*` is git-ignored; nothing secret is logged.

## 9. Compliance model

- Product attribute `export_control_status ∈ {NOT_CONTROLLED, UNKNOWN, CONTROLLED}` plus free-text `control_classification` (e.g. an ECCN/ML entry **entered by a qualified person** — never inferred by AI).
- `compliance_country_rules` (admin-managed): `BLOCK` or `REVIEW` per ISO country. **No sanctions list ships with the code** — lists must be loaded and maintained from official sources (e.g. UN Security Council Consolidated List, OFAC SDN, EU Consolidated Financial Sanctions List, UK OFSI) by the operator. Shipping a stale hard-coded list would be worse than none.
- RFQ is routed to `COMPLIANCE_REVIEW` when any line is `CONTROLLED`, destination country has a `REVIEW` rule, or the buyer org is not yet verified for controlled items; `BLOCK` prevents RFQ creation and tells the user plainly.
- Human decision is recorded (reviewer, timestamp, notes) and audited. Only after approval are suppliers notified.

## 10. AI architecture

```
user text ──► RequirementExtractor (rules | LLM) ──► ExtractedIntent (zod-validated)
                                                         │
                         DB lookup (search service) ◄────┘
                                   │
                         DialogueEngine (pure) ──► reply text + smart actions + requirement state
```
- LLM output is schema-validated; anything not matching is discarded and the rules result is used.
- The reply text is composed from templates over DB facts — the LLM does not write claims about stock, price or suppliers.
- When no verified information exists the system says so: *"I don't have verified information for this. I can request supplier confirmation."*

## 11. Delivery phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture (this document) | Done |
| 2 | Design system, landing, conversation UI, results, RFQ flow, buyer & supplier dashboards, mobile nav | MVP |
| 3 | Auth, DB, search, extraction, RFQ, supplier response, quotations, messaging, notifications, admin, audit | MVP |
| 4 | Tests: unit (parser/engine), integration (services, isolation), E2E (the three success tests) | MVP |
| 5 | Production: Docker image, migrations, backups, monitoring hooks, deployment guide | MVP (docs + Dockerfile) |
| 6 | Expo mobile app, push notifications, SSO, S3 storage adapter in prod, pgvector semantic search, approval workflows, PO/logistics | Next |

## 12. Explicitly out of MVP scope (and not faked)

Purchase orders, logistics tracking, inspection/acceptance, configurable approval chains, SMS/push delivery, SSO, image recognition without an AI provider, live external parts databases. Schema hooks exist where cheap; UI does not pretend these work.
