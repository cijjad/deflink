# Deployment & Operations

This covers what the MVP needs to run in production and what is **not yet provided**.

## 1. Required infrastructure

| Component | Requirement |
|---|---|
| App | Node.js 22 (Docker image in `Dockerfile`, Next.js standalone output). Stateless — run ≥2 instances behind a TLS load balancer. |
| Database | PostgreSQL 16+, `pg_trgm` extension available (trusted extension; the DB owner can create it). Managed service with encryption at rest, automated backups and point-in-time recovery. |
| Object storage | Currently local disk (`STORAGE_DIR`). **Before multi-instance production, implement the S3-compatible `StorageProvider`** (`src/server/storage/index.ts`) with server-side encryption and private buckets. |
| TLS | Terminate HTTPS at the load balancer. HSTS is sent by the app in production. |

## 2. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Use a least-privilege role that owns the schema. |
| `DATABASE_SSL` | prod: `true` | Verifies the server certificate. |
| `APP_URL` | yes | Public `https://` URL (used in e-mail links, secure cookies). |
| `APP_ENCRYPTION_KEY` | **yes in production** | `openssl rand -base64 32`. Encrypts MFA secrets (AES-256-GCM). The app refuses to start without it. Store in a secrets manager; rotating it invalidates enrolled MFA. |
| `STORAGE_DIR` | dev only | Until the S3 adapter exists. |
| `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic`, `AI_MODEL`, `AI_EFFORT` | optional | Enables LLM extraction. Only the user's message text is sent — no user, organisation or RFQ data. Leave unset to use the deterministic rules engine. |

Never commit `.env*` files (already git-ignored).

## 3. Release procedure

```bash
npm ci
npm run typecheck && npm run lint && npm test     # unit + integration (needs a test DB)
npm run test:e2e                                 # browser E2E (desktop + mobile)
npm run build
DATABASE_URL=... npm run db:migrate              # run once per release, before switching traffic
```

`npm run db:seed` loads **DEMO data only** and refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`. Do not seed production.

### First platform administrator
There is deliberately no public way to become a platform admin. Create the first one with a one-off SQL statement after that user registers:
```sql
UPDATE users SET is_platform_admin = true WHERE lower(email) = 'ops@yourcompany.com';
```
Audit this action in your change log.

## 4. Backups & recovery
- Daily full backups + WAL archiving (PITR) on the database; test a restore monthly.
- `audit_logs` is append-only (DB trigger) and hash-chained; verify integrity from **Admin → Audit log → Verify integrity** or `GET /api/admin/audit/verify`.
- Back up object storage with versioning enabled.

## 5. Monitoring
- Liveness/readiness: `GET /api/health` (checks DB connectivity).
- Ship stdout/stderr to your log platform; unhandled API errors are logged with `Unhandled API error`.
- Alert on: 5xx rate, p95 latency of `/api/chat`, failed logins spike (`auth.login_failed` in audit log), compliance queue age, `email_outbox` rows stuck in `QUEUED`.

## 6. Known gaps before a real launch (not faked in the code)

| Gap | Why it matters | What to do |
|---|---|---|
| Rate limiter is in-process | Ineffective across multiple instances | Swap `src/server/security/rate-limit.ts` for Redis. |
| E-mail/SMS/push delivery | Outbox is written, nothing is sent | Add a worker that drains `email_outbox` via your provider (SES, SendGrid…). |
| S3 storage adapter | Local disk is not durable or shared | Implement `StorageProvider` for S3/GCS/Azure Blob. |
| Sanctions & export-control data | No list ships with the code | Load country rules from official sources (UN, OFAC, EU, UK OFSI…) and have compliance counsel own them. Party screening (KYC/KYS against denied-party lists) needs a licensed screening provider. |
| PDF/Word/image extraction | Files are stored; only Excel/CSV are parsed | Extend `extractRequirementRows` via the AI provider (Claude reads PDFs/images natively). |
| SSO, approval workflows, purchase orders, logistics | Out of MVP scope | Schema hooks exist for roles; build next. |
| Native mobile apps | Web is mobile-first + installable (PWA manifest) | Build an Expo client on the same `/api`. |
| CSP uses `'unsafe-inline'` for scripts | Required by Next.js inline bootstrap without nonces | Move to nonce-based CSP via `proxy.ts`. |
| Penetration test | Not done | Commission an independent test before handling real buyer data. |
