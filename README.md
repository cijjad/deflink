# DefLink — Conversational Procurement

**Tell us what you need. We help you source it.**

A buyer types *"I need 25 units of Part ABC123"*; DefLink identifies the part, shows verified sources, asks only for what's missing (condition, destination), and turns the conversation into an RFQ sent to matched, verified suppliers. Suppliers quote and revise; buyers ask questions and compare quotes side by side.

> All organisations, part numbers, stock and prices in the seed data are **fictional DEMO data** and are labelled as such in the UI.

## Stack
Next.js 16 (App Router, TypeScript) · PostgreSQL 16 + Drizzle ORM · `pg_trgm` + full-text search · Tailwind CSS 4 · Vitest · Playwright. Optional Claude-based extraction behind a provider interface (rules engine by default).

## Run locally
```bash
cp .env.example .env.local              # adjust DATABASE_URL
npm install
npm run db:reset                        # drop schema, migrate, load DEMO data
npm run dev                             # http://localhost:3000
```
Demo accounts (password `DemoPass2026!`): `buyer@demo.test`, `alpha@supplier.demo.test`, `bravo@supplier.demo.test`, `admin@deflink.test`.

## Tests
```bash
npm test          # parser unit tests + service integration tests (uses deflink_test DB)
npm run test:e2e  # the three success tests in Chromium, desktop and mobile viewports
```

## Docs
- [Architecture & implementation plan](docs/ARCHITECTURE.md)
- [Deployment, operations and known gaps](docs/DEPLOYMENT.md)

## Layout
```
src/core/        pure TS: NL parser, dialogue engine, geo data (portable to mobile)
src/server/      db schema & migrations, auth, services, AI provider, storage, security
src/app/         pages and /api route handlers
src/components/  UI (chat, RFQ, admin, layout)
tests/           unit, integration, e2e
```
