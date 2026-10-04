# Changelog

## 1.0.0 — 2026-10-04 (MVP release)

### Product
- Conversational procurement: part number, NSN, OEM and plain-language requests; quantities in natural language ("two dozen", "around 50", "3 sets"); multi-item sentences; Excel/CSV upload with exact / needs-confirmation / not-identified classification and in-place correction.
- Minimum follow-up questions (quantity → condition → destination), context-aware action buttons, editable requirement card, one-click RFQ.
- No registration wall: search and build requirements anonymously; the draft survives sign-in and is sent automatically.
- Supplier portal: anonymised RFQ inbox, quotations with revision history (revision note required), RFQ-bound messaging.
- Buyer: requests dashboard, quotation cards, objective side-by-side comparison (no supplier recommendation), shortlist.
- Admin: supplier verification with mandatory evidence notes, suspension, compliance queue, destination country rules, audit log with integrity check.
- Interactive preview (`npm run preview:build`) running the real engine on DEMO data.

### Integrity & compliance
- Provenance labels on price, availability, certification and cross-references; DEMO labels on all seed data.
- Only suppliers with an approved business verification are shown as sources or receive RFQs; controlled items go only to compliance-verified suppliers after human review.
- The optional AI extractor can only restate identifiers present in the user's own text.

### Security
- scrypt passwords, hashed session tokens, TOTP MFA (secrets AES-256-GCM encrypted), RBAC (8 roles), organisation isolation, origin checks, rate limiting, CSP/HSTS/frame denial, append-only hash-chained audit log.

### Known gaps
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-known-gaps-before-a-real-launch-not-faked-in-the-code): e-mail/SMS/push delivery, S3 storage adapter, shared rate limiter, sanctions data, PDF/Word/image extraction, SSO, native mobile apps, penetration test.
