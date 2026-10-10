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

## Demo
- **Status:** Phase 0 Completed (Awaiting Phase 1 Authorization).
- **URL & Instructions:** To be deployed on Railway during Phase 4/5.

## Known Limitations & Next Steps
- Full customer/order/entitlement business schema deferred to Phase 1 per acceptance gates.
- Paystack checkout, webhook handler, and autonomous recovery agent loop deferred to Phase 1 & 2.
- Local PostgreSQL instance not pre-installed on test host; Railway cloud connection tested via bounded client.

## Submission Requirements Checklist
- [x] neatlogs TypeScript SDK installed and instrumented.
- [x] Project API key designated for ingestion.
- [ ] Live neatlogs trace URL captured in dashboard (to be generated with live credentials).
- [ ] Entire checkpoint ID captured and linked to public repository.
- [ ] cfo.ai business plan model configured.
- [ ] 4 Acceptance scenarios demonstrated (Scenarios A, B, C, D).
