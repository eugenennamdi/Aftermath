# neatHack Build Companion — Aftermath

## Project
- **Name:** Aftermath
- **Purpose:** Autonomous operational recovery for broken SaaS business operations.
- **Problem:** Customers complete payments via Paystack, but due to webhook drops, handler timeouts, or network partitions, their purchased entitlements are never provisioned. Aftermath investigates discrepancies using real tools, deterministically authorizes recovery, provisions entitlements idempotently, and independently confirms resolution.

## Team
- **Engineering:** Antigravity AI Coding Agent (Sole Principal Engineer)
- **Architecture / Tech Lead:** ChatGPT GPT-6 (CTO / Tech Lead Reviewer)

## Stack
- **Framework & Runtime:** Next.js 16 (App Router, TypeScript Strict Mode), Node.js v24
- **Persistence:** PostgreSQL with Drizzle ORM
- **Target Deployment:** Railway (Next.js Web Service + Persistent Node Background Worker + Managed PostgreSQL)
- **Agent Observability:** neatlogs TypeScript SDK (`neatlogs@latest`)
- **Development Provenance:** Entire CLI (`entire`)
- **Business Modeling:** cfo.ai financial projections
- **Testing:** Vitest
- **Design System:** Tailwind CSS + shadcn/ui

## Build Log

### Phase 0: Foundation & Environment Validation (October 10, 2026)
- **Repo Initialization:** Git repository initialized (`main`).
- **Tooling Setup:** Installed Next.js 16, TypeScript strict mode, Vitest, Drizzle ORM, postgres client, Tailwind CSS, Zod, and neatlogs SDK.
- **Conventions:** Established `AGENTS.md` outlining trust model, system boundaries, and engineering invariants.
- **neatlogs Integration:** Implemented isolated test workflow (`src/lib/neatlogs.ts`) with client-side PII/secret redaction, root workflow span, nested agent span, tool span with sanitized I/O, guardrail span, and correlated incident IDs.
- **Worker Feasibility:** Created minimal persistent background worker entrypoint (`src/worker/index.ts`) with lifecycle management and graceful `SIGTERM`/`SIGINT` shutdown.
- **Database Strategy:** Configured Drizzle client (`src/db/index.ts`) with bounded 5-second connection verification and health check table schema (`src/db/schema.ts`).
- **Baseline Testing:** Automated unit tests written and verified for neatlogs isolation, worker lifecycle, and bounded database connection.
- **Entire Provenance:** Installed Entire CLI v0.11.4, enabled Antigravity agent integration, and attached session transcript `7b352b18-79d6-4899-b004-b68f02996652`. Generated Checkpoint ID `01M4JBBBQGYQJ784KSHCGDZ2SW`.
- **Railway Configuration:** Created `Procfile` supporting dual web and worker processes.

### Phase 1: Trusted Orders, Paystack Integration & Fulfillment Boundary (October 10, 2026)
- **Database Schema & Migrations:** Implemented 8 production Drizzle tables (`subscription_plans`, `customers`, `orders`, `payment_events`, `entitlements`, `incidents`, `audit_logs`, `system_checks`). Generated migration `0000_absent_exodus.sql` and applied cleanly to local PostgreSQL 17 database.
- **Authoritative Plan Catalog:** Seeded default SaaS subscription tiers (`plan_starter_monthly`, `plan_pro_monthly`) with integer minor unit pricing (500,000 kobo / 5,000 NGN).
- **Trusted Order Creation:** Implemented `createTrustedOrder` in `src/services/order.ts`. Derives amount and currency strictly from catalog; client cannot override prices. Generates unguessable payment references.
- **Paystack Test-Mode Client & Adapter:** Built `PaystackClient` in `src/lib/paystack.ts` supporting `initializeTransaction`, typed `verifyTransaction` (categorizing SUCCESS, PENDING, FAILED, API_ERROR, MALFORMED), and constant-time HMAC-SHA512 webhook signature verification.
- **Secure Webhook Handler:** Built `POST /api/webhooks/paystack` with 1MB body bounds, signature verification, strict Zod schema validation, SHA-256 payload hashing, duplicate event idempotency, and transactional order status transitions.
- **Legitimate Entitlement Service:** Built `EntitlementService` in `src/services/entitlement.ts` with database-level uniqueness enforcement, active duration calculation, and failure injection seam for Phase 2.
- **Incident Ingestion Foundation:** Built `createOrGetIncident` and bounded pending-order reconciliation query (`getPendingOrdersForReconciliation`) in `src/services/incident.ts`.
- **Comprehensive Vitest Suite:** 9 test files, 30 passing tests (1 skipped for live key probe). Includes real PostgreSQL concurrency test confirming 10 parallel fulfillment attempts produce strictly 1 entitlement.

### Phase 1 Corrective Pass: Reference Formatting, Webhook Decoupling & Gated Fulfillment
- **Paystack Reference Compliance:** Replaced reference generator with strictly Paystack-compliant format `ref-<timestamp36>-<hex>` matching `^[a-zA-Z0-9.\-=]+$` with zero underscores. Echoed initialization reference strictly verified against trusted order.
- **Webhook Boundary Decoupling:** Refactored `POST /api/webhooks/paystack` to strictly ingest event, persist fulfillment signal, and acknowledge immediately with HTTP 200 without synchronous outbound calls or provisioning inside request cycle.
- **Independent Normal Fulfillment Engine:** Implemented `processNormalFulfillment` in `src/services/fulfillment.ts`. Performs independent Paystack verification API query, validates mathematical and customer equality against local immutable order, and provisions access idempotently.
- **Provider Fault Resilience:** Gated fulfillment treats transient provider errors (HTTP 503, network timeouts) as retryable without marking orders failed; definitive mismatches open durable incidents.
- **Open-Redirect & Demo Gating:** Added `resolveSafeCallbackUrl` in `src/services/order.ts` preventing open-redirect vulnerabilities. Restricted checkout initialization endpoint to authorized demo plan catalog.
- **Expanded Regression Test Suite:** 10 test files, 38 passing tests (1 skipped for live key). Validated reference compliance, fast webhook acknowledgment, independent verification gating, reconciliation detection, and separate execution boundaries.

## Demo
- **Status:** Phase 1 Completed (Awaiting CTO Phase 2 Authorization).
- **URL & Instructions:** To be deployed on Railway during Phase 4/5.

## Known Limitations & Next Steps
- Autonomous recovery agent loop deferred to Phase 2 per acceptance gates.
- Failure injection simulator and worker scheduler to be implemented in Phase 2 & 3.
- Live Paystack API probe skipped until live test key configured in environment.

## Submission Requirements Checklist
- [x] neatlogs TypeScript SDK installed and instrumented.
- [x] Project API key designated for ingestion.
- [ ] Live neatlogs trace URL captured in dashboard (to be generated with live credentials).
- [x] Entire checkpoint ID captured and linked to commit (`01M4JBBBQGYQJ784KSHCGDZ2SW`).
- [ ] cfo.ai business plan model configured (operator configuring separately).
- [ ] 4 Acceptance scenarios demonstrated (Scenarios A, B, C, D).
