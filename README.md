# Aftermath

> **Autonomous operational recovery for broken SaaS business operations.**

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20Mode-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.4.0-black.svg)](https://nextjs.org/)
[![neatlogs](https://img.shields.io/badge/neatlogs-Verified%20Telemetry-emerald.svg)](https://neatlogs.com)
[![Entire](https://img.shields.io/badge/Entire-Checkpoint%20Tracked-indigo.svg)](https://entire.dev)
[![cfo.ai](https://img.shields.io/badge/cfo.ai-Business%20Model%20Included-amber.svg)](docs/business-plan/Aftermath-Business-Plan.pdf)

---

## 1. Product Identity

### The Problem
In subscription and usage-based SaaS platforms, the payment boundary is prone to operational dropouts. Customers complete payment successfully on their payment provider (e.g. Paystack), but network partitions, webhook dropped deliveries, handler timeouts, or unhandled exceptions prevent the SaaS backend from provisioning access. 

The consequences are painful and expensive:
1. **Immediate Customer Frustration:** Payer is debited, expects immediate access, but is locked out.
2. **Support Ticket Burden:** High-priority "I paid but can't access" tickets flood human operations desks.
3. **Revenue at Risk & Churn:** Trust is broken at the point of conversion; customers dispute charges or churn before activation.

### The Aftermath Solution
**Aftermath** is an autonomous recovery system designed to close the gap between payment completion and entitlement provisioning. Operating as an operational safety mesh, Aftermath:
- **Detects Discrepancies:** Ingests webhook events asynchronously and runs a periodic background sweeper to discover unfulfilled paid orders without relying on webhook reliability.
- **Investigates Authentically:** An autonomous AI agent investigates incidents using read-only database and live payment gateway tools to establish ground truth.
- **Deterministically Authorizes Recovery:** The LLM proposes recovery intent, but **never mutates state directly**. An immutable deterministic authorization gate strictly validates mathematical equality (kobo amount, currency, customer email, order binding) before permitting any state mutation.
- **Provisions Idempotently:** A resilient background worker executes the recovery with database-level uniqueness constraints and atomic fencing tokens.
- **Independently Verifies Resolution:** An incident only transitions to `RESOLVED` after an authoritative, independent database read confirms active entitlement state.

---

## 2. Demonstration & Project Links

| Resource | Link / Identifier | Access Notes |
| :--- | :--- | :--- |
| **Live Application** | [https://aftermath-production-c18d.up.railway.app](https://aftermath-production-c18d.up.railway.app) | Public read-only Operations Overview. Full incident dossier requires operator secret. |
| **GitHub Repository** | [https://github.com/eugenennamdi/Aftermath](https://github.com/eugenennamdi/Aftermath) | Public repository for neatHack 2026. |
| **Business Plan (cfo.ai)** | [docs/business-plan/Aftermath-Business-Plan.pdf](docs/business-plan/Aftermath-Business-Plan.pdf) | Ari's financial model, unit economics, and operational recovery business plan (60 KB PDF). |
| **neatlogs Trace Evidence** | `trace_id: cdefe7e1bc59d6ae43a524640c6d09e7` | Captured workflow `aftermath-recovery` on `https://eu.ingest.neatlogs.com`. Project dashboard accessible to team operators. |
| **Entire Development Checkpoint** | `Entire-Checkpoint: 01M4JBBBQGYQJ784KSHCGDZ2SW` | Commit provenance recorded in Git trailers and tracked via `.entire/settings.json`. |

---

## 3. How the Product Works

Aftermath separates reasoning from mutation, guaranteeing that autonomous actions remain within strict deterministic business rules.

```
+-----------------------------------------------------------------------------------+
| 1. DETECTION & ORDER BINDING                                                      |
|   - Immutable local Order created prior to checkout (plan, price in kobo)         |
|   - Paystack payment completed by customer                                        |
|   - Dual-path detection: Ingest Webhook or Background Sweeper finds gap            |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 2. AI INVESTIGATION (Read-Only)                                                   |
|   - Investigator agent queries read-only tools:                                   |
|       * inspect_order                                                             |
|       * inspect_payment_evidence                                                  |
|       * verify_paystack_transaction (live gateway check)                          |
|       * inspect_entitlement                                                       |
|       * inspect_prior_recovery_attempts                                           |
|   - Emits structured intent: PROPOSE_RECOVERY | RECONCILE_EXISTING | ESCALATE    |
|   - Instrumented via neatlogs AGENT and TOOL spans with PII redaction             |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 3. DETERMINISTIC AUTHORIZATION GATE                                               |
|   - Strictly verifies:                                                            |
|       [x] Order existence and non-cancelled status                                |
|       [x] Paid amount == Order amount (strict subunit / kobo match)               |
|       [x] Currency code equality (e.g. NGN == NGN)                                |
|       [x] Payer customer email == Order customer email                            |
|       [x] Worker lease ownership & atomic fencing token validity                  |
|   - Rejects & Escalates on any mismatch; authorizes execution only on 100% match  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 4. IDEMPOTENT PROVISIONING & INDEPENDENT VERIFICATION                             |
|   - Relational unique constraint on (order_id, source_reference)                  |
|   - Independent read query verifies active entitlement in database                |
|   - Incident marks RESOLVED with immutable audit trail & neatlogs trace ID        |
+-----------------------------------------------------------------------------------+
```

### End-to-End Workflow Stages:
1. **Trusted Order Creation (`src/services/order.ts`):** Orders are created locally with authoritative catalog pricing before checkout. Clients cannot alter prices or payment references.
2. **Payment Ingestion & Webhook Boundary (`src/app/api/webhooks/paystack/route.ts`):** Ingests Paystack events with HMAC-SHA512 signature verification. Acknowledges webhooks immediately with HTTP 200 without synchronous network delays or inline provisioning locks.
3. **Discrepancy Ingestion (`src/services/incident.ts`):** Opens durable incidents for unfulfilled orders or webhook anomalies.
4. **Autonomous Investigation (`src/agent/investigator.ts`):** Agent uses read-only tools (`src/agent/tools.ts`) to inspect local orders, live Paystack transaction status, and existing entitlements. Outputs structured intent:
   - `PROPOSE_RECOVERY`: Verified payment matches trusted order; entitlement missing.
   - `RECONCILE_EXISTING`: Entitlement already exists; links access to order.
   - `RETRY_LATER`: Transient gateway timeout (HTTP 503); schedules exponential backoff.
   - `ESCALATE`: Amount mismatch, currency mismatch, or customer spoofing detected.
5. **Deterministic Policy Gate (`src/services/recovery.ts`):** Hardcoded business logic gates state mutation. Validates exact kobo amounts, currency equality, customer identity, and worker fencing tokens.
6. **Idempotent Background Worker (`src/worker/recovery-worker.ts`):** Persistent background worker claims incidents using PostgreSQL `FOR UPDATE SKIP LOCKED` with 30-second bounded leases.
7. **Independent Resolution Verification:** Incidents transition to `RESOLVED` only after a fresh, independent query (`getAuthoritativeEntitlement`) confirms active entitlement in the database.

---

## 4. Architecture

Aftermath is built on a streamlined, production-hardened stack adhering to the principle of boring, reliable technology without unnecessary message brokers or complex queues.

```mermaid
flowchart TD
    subgraph Client ["Client & Gateway"]
        Customer["Customer Browser / Paystack Checkout"]
        Paystack["Paystack Gateway (Test Mode)"]
        OperatorUI["Operator Console (Next.js 16)"]
    end

    subgraph AppService ["Aftermath Service (Railway Container)"]
        WebRoutes["API Routes & Webhook Handler"]
        Supervisor["Process Supervisor"]
        Worker["Recovery Worker Loop"]
        Investigator["Investigator Agent (LiteLLM)"]
        Gate["Deterministic Authorization Gate"]
        EntitlementSvc["Entitlement Provisioning"]
    end

    subgraph Storage ["Managed Persistence"]
        NeonDB[("PostgreSQL 18 (Neon / Drizzle ORM)")]
    end

    subgraph Observability ["Telemetry & Provenance"]
        NeatLogs["neatlogs Service (Traces & Spans)"]
        EntireGit["Entire CLI (Git Provenance)"]
    end

    Customer -->|Checkout| Paystack
    Paystack -->|Webhook HMAC-SHA512| WebRoutes
    WebRoutes -->|Persist Order & Incident| NeonDB
    OperatorUI -->|Read Overview & Dossier| WebRoutes

    Supervisor --> Worker
    Worker -->|FOR UPDATE SKIP LOCKED| NeonDB
    Worker -->|Trigger Investigation| Investigator
    Investigator -->|Read Order & Gateway| NeonDB
    Investigator -->|Verify Paystack Status| Paystack
    Investigator -->|Export Telemetry| NeatLogs
    Investigator -->|Propose Intent| Gate

    Gate -->|Authorize Mutation| EntitlementSvc
    EntitlementSvc -->|Idempotent Insert| NeonDB
    Worker -->|Independent Verification Read| NeonDB
```

### Component Responsibilities:
- **Web Application (`src/app/`):** Next.js 16 with App Router, Tailwind CSS, and Radix UI. Provides public health overview, authenticated operator console, and secure webhook receiver.
- **Database Layer (`src/db/`):** PostgreSQL schema managed with Drizzle ORM (`orders`, `subscription_plans`, `customers`, `payment_events`, `entitlements`, `incidents`, `audit_logs`, `system_checks`).
- **Investigative Agent (`src/agent/`):** Multi-step tool-calling agent using sponsored Claude Sonnet 4.6 via LiteLLM gateway, wrapped in neatlogs tracing.
- **Recovery Worker (`src/worker/`):** Continuous worker process with transactional claiming, heartbeat renewal, and periodic sweepers for unfulfilled orders.
- **Supervisor (`scripts/supervisor.ts`):** Single-service container supervisor managing both web server and worker processes on Railway.

---

## 5. Safety & Reliability Invariants

The Aftermath design enforces non-negotiable engineering invariants:

1. **Trusted Order Binding:** Every entitlement must trace back to an immutable local `order` created prior to checkout with verified catalog pricing.
2. **Deterministic Mathematical Equality:** Side-effect recovery is granted only when the paid amount (in integer subunits/kobo), currency code, and customer email identically match the trusted order.
3. **Database-Level Idempotency:** Unique composite constraints on `entitlements.order_id` and `entitlements.source_reference` guarantee that duplicate webhook events or concurrent workers cannot provision duplicate access.
4. **No Held Locks Over Network Calls:** Database transactions are never held open across external HTTP requests (Paystack API, neatlogs telemetry, or LLM completions).
5. **Worker Lease Fencing:** Workers acquire 30-second leases with monotonic fencing tokens. If a worker stalls or experiences a garbage-collection pause, its lease expires and subsequent mutations are rejected.
6. **Independently Verified Resolution:** An incident is marked `RESOLVED` only after a fresh, independent query confirms active entitlement records in the database.
7. **Fail-Closed Security & CSRF Protection:** Mutation endpoints require origin validation, strict rate limiting, and constant-time operator secret verification.

---

## 6. Quick Start

### Prerequisites
- Node.js `v20.x` or `v24.x`
- PostgreSQL `16+` (Local PostgreSQL or remote Neon instance)
- npm

### 1. Clone & Install
```bash
git clone https://github.com/eugenennamdi/Aftermath.git
cd Aftermath
npm install
```

### 2. Configure Environment
Copy the example environment template and provide your database and API credentials:
```bash
cp .env.example .env.local
```
*(See [Configuration Reference](#7-configuration-and-environment-variables) below for details.)*

### 3. Run Database Migrations
Apply the Drizzle ORM schema to your PostgreSQL database:
```bash
npm run db:migrate
```

### 4. Start the Application
For local development, run the web console and recovery worker in separate terminals:

**Terminal 1 (Web Application):**
```bash
npm run dev
# Open http://localhost:3000
```

**Terminal 2 (Recovery Worker):**
```bash
npm run worker
```

*Alternatively, run the production supervisor running both processes in a single terminal:*
```bash
npm run build
npm start
```

---

## 7. Configuration & Environment Variables

All configuration is managed through environment variables. **Never commit real secrets or `.env.local` to Git.**

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `production`). |
| `PORT` | No | `3000` | Port for Next.js HTTP server. |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host:5432/db` | Connection string for application runtime traffic. |
| `MIGRATION_DATABASE_URL` | No | Direct connection string | Unpooled direct connection for DDL migrations (falls back to `DATABASE_URL`). |
| `DB_MAX_CONNECTIONS` | No | `4` | Connection pool ceiling per container. |
| `APP_URL` | **Yes** | `http://localhost:3000` | Canonical origin for CSRF and webhook callback resolution. |
| `OPERATOR_SECRET` | **Yes** | *(Min 16 chars)* | Passphrase for authenticating into the Operator Console. |
| `CRON_SECRET` | **Yes** | *(Min 16 chars)* | Secret for server-to-server worker tick invocation. |
| `PAYSTACK_SECRET_KEY` | **Yes** | `sk_test_...` | Paystack secret key for transaction verification. |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | No | `pk_test_...` | Public key for client-side Paystack operations. |
| `LITELLM_API_KEY` | **Yes** | `sk-...` | API key for neatHack sponsored LiteLLM gateway. |
| `LITELLM_BASE_URL` | **Yes** | `https://litellm.vision.aivar.app/v1` | Endpoint for model gateway. |
| `LITELLM_MODEL` | No | `claude-sonnet-4.6` | Reasoning model for investigative agent. |
| `NEATLOGS_API_KEY` | **Yes** | `nl_live_...` | neatlogs API key for distributed observability. |
| `NEATLOGS_ENDPOINT` | No | `https://eu.ingest.neatlogs.com` | neatlogs ingestion gateway endpoint. |
| `NEATLOGS_WORKFLOW_NAME` | No | `aftermath-recovery` | Telemetry workflow identifier. |
| `DISABLE_WORKER` | No | `false` | Optional toggle to disable background worker in container. |

---

## 8. Testing & Verification

The repository includes comprehensive automated unit tests, scenario tests, and compilation checks.

### 1. Operator Console UI Unit Tests
Verifies truthful incident timelines, evidence gating, accessibility primitives, and absence of fake metrics:
```bash
npx vitest run tests/unit/operator-console-ui.test.ts
```
**Observed Result:** 8/8 tests passed (100%).

### 2. Isolated Observability & Worker Tests
Verifies neatlogs PII sanitization and worker graceful lifecycle:
```bash
npx vitest run tests/unit/neatlogs-isolated.test.ts tests/unit/worker-lifecycle.test.ts
```
**Observed Result:** 3/3 tests passed (100%).

### 3. TypeScript Strict Type-Check
Verifies complete type safety across all services, API routes, and components:
```bash
npx tsc --noEmit
```
**Observed Result:** Clean exit (0 errors).

### 4. Production Next.js Build
Verifies static page compilation, route tree generation, and dynamic route declarations:
```bash
npx next build --webpack
```
**Observed Result:** Compiled successfully in 7.2s; 13/13 routes generated cleanly.

### 5. Automated Scenario Acceptance Suite (`tests/scenarios/`)
- **Scenario A (`scenario-a-autonomous-recovery.test.ts`):** Validates end-to-end autonomous discovery, agent investigation, gate authorization, and verified resolution.
- **Scenario B (`scenario-b-failure-and-recovery.test.ts`):** Validates transient Paystack HTTP 503 backoff and ambiguous post-commit drop reconciliation without duplicate provisioning.
- **Scenario C (`scenario-c-unsafe-payment-rejected.test.ts`):** Validates deterministic security gate rejection and escalation for underpaid amounts, currency mismatches, and payer spoofing.
- **Scenario D (`scenario-d-duplicate-events-concurrency.test.ts`):** Validates duplicate webhook idempotency and concurrent worker fencing token invalidation.

---

## 9. Hackathon Integration Evidence

### neatlogs — Real-Time Agent & Workflow Observability
- **Role:** Observability pipeline tracking end-to-end execution across root workflows, LLM agent reasoning, tool invocations, and deterministic guardrails.
- **Live Ingest Status:** Verified against `https://eu.ingest.neatlogs.com`.
- **Trace Identifier:** `trace_id: cdefe7e1bc59d6ae43a524640c6d09e7` (`root_span_id: 1bedc44126f64062`).
- **Telemetry Structure:**
  - `WORKFLOW` span: Encompasses the incident lifecycle.
  - `AGENT` span: Captures model reasoning, token budget utilization, and proposed intent.
  - `TOOL` spans: Records tool inputs and outputs with strict client-side PII and secret sanitization (`sanitizeTelemetryPayload`).
  - `GUARDRAIL` span: Records deterministic authorization gate evaluation (pass/reject criteria).
- **Privacy Assurance:** Customer emails, authorization bearer tokens, and payment secrets are automatically redacted before egress.

### Entire — Development Provenance & Session Checkpoints
- **Role:** Immutable tracking of coding session transcripts linked to Git commits.
- **Checkpoint Identifier:** `01M4JBBBQGYQJ784KSHCGDZ2SW`.
- **Integration Evidence:**
  - Trailed on all milestone release commits: `Entire-Checkpoint: 01M4JBBBQGYQJ784KSHCGDZ2SW`.
  - Configured in `.entire/settings.json` with absolute Git hook support.
  - Captures full agent trajectory for prompt-to-commit auditability.

### cfo.ai — Business Plan & Financial Modeling
- **Role:** Rigorous unit economics, market sizing, and financial projections for Aftermath's operational recovery platform.
- **Repository Artifact:** Committed directly at [docs/business-plan/Aftermath-Business-Plan.pdf](docs/business-plan/Aftermath-Business-Plan.pdf) (60 KB PDF).
- **Summary:**
  - **Beachhead Market:** High-growth African and emerging-market SaaS businesses using Paystack where payment dropouts directly erode monthly recurring revenue (MRR).
  - **Value Proposition:** Recovers 3–5% of otherwise lost revenue caused by dropouts, eliminates manual Tier-2 billing support tickets, and preserves customer lifetime value (LTV).
  - **Unit Economics:** SaaS tiered subscription pricing with usage-based recovery volume allowances, modeled with conservative, base, and upside cash runways.

---

## 10. Demo Walkthrough (60–90 Second Guide for Judges)

Visiting the live deployment at [https://aftermath-production-c18d.up.railway.app](https://aftermath-production-c18d.up.railway.app):

1. **Operations Overview:** 
   - View high-level operational health: Total Incidents, Active Investigations, Recoveries Executed, Escalations, and Worker Fleet Status.
   - Note the real-time polling indicator reflecting background worker heartbeat.
2. **Accessing Incident Stream:**
   - Click **Operator Login** in the navigation bar.
   - Enter the operator passphrase configured in the environment (or inspect public summary mode if viewing unauthenticated).
3. **Inspecting an Incident Dossier:**
   - Navigate to the **Incidents** tab and select any resolved or investigating incident.
   - **Investigation Timeline:** Observe the sequential execution from Detection -> Evidence Gathering -> AI Evaluation -> Deterministic Policy Gate -> Resolution Verification.
   - **Evidence Dossier:** Inspect the side-by-side comparison between the trusted local order and live Paystack transaction verification.
   - **Live Audit Log Trail:** Click **View Live Audit Log** to open the modal detailing immutable audit entries, structured findings, and associated neatlogs trace references.
4. **Verifying Safety Invariants:**
   - Observe that escalated incidents (e.g. underpaid amounts or email spoofing) show explicit deterministic gate rejections with clear safety rationale, demonstrating that the LLM is never allowed to bypass mathematical checks.

---

## 11. Known Limitations & Hackathon Scope

In adherence to the project's engineering conventions and YAGNI principle:
- **Payment Provider Scope:** Implemented for Paystack (Test Mode). Real-world production rollout requires production Paystack webhooks, live merchant credentials, and banking rail compliance.
- **Single-Tenant Console:** The operator console is designed for single-tenant internal SaaS operations with session cookie authentication. Multi-tenant team RBAC is out of MVP scope.
- **In-Memory Worker Polling:** The background worker runs as an autonomous transactional poller (`FOR UPDATE SKIP LOCKED`) rather than an external distributed queue (Kafka/RabbitMQ), keeping infrastructure footprint lean and zero-maintenance on small containers.
- **Zero Hallucinated State:** The UI displays strictly what is returned by authoritative database queries and verified live gateway probes. Absent or unreturned data is marked explicitly as `NOT RETURNED` rather than fabricated.

---

## License

MIT License. Developed for **neatHack 2026** (October 10–12, 2026).
