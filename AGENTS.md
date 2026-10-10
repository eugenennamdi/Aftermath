# Aftermath — Engineering Conventions & Agent Guide

## 1. Product Purpose & MVP Scope
Aftermath is an autonomous recovery system for broken business operations in SaaS. It detects cases where customers complete payment via Paystack but fail to receive their purchased SaaS entitlements, investigates root causes using real read-only tools, deterministically authorizes recovery, provisions entitlements idempotently, and independently confirms resolution.

### Scope Boundaries:
- **In-Scope (MVP):** Single-order entitlement provisioning recovery, Paystack test mode, dual-path incident detection (webhooks + reconciliation sweep), deterministic authorization gate, neatlogs tracing, Entire provenance, and cfo.ai financial impact modeling.
- **Out of Scope (YAGNI):** Multi-tenant RBAC, recurring subscription renewals, complex broker queues (Redis/Kafka), unrequested abstractions.

## 2. System Boundaries & Trust Model
- **The LLM is an investigative reasoning engine, NEVER the mutating executioner.**
- The agent loop selects read-only tools to gather evidence and outputs structured intent (`PROPOSE_RECOVERY` or `ESCALATE`).
- All state mutations are strictly gated by the **Deterministic Authorization Service**.
- Entitlement identity and pricing parameters are derived strictly from authoritative database records (`orders`, `subscriptions_catalog`) and verified live Paystack API calls. The model cannot pass arbitrary customer IDs, plan codes, or amounts.

## 3. Engineering Invariants
1. **Trusted Order Binding:** Every entitlement must trace to an immutable local `order` created prior to checkout.
2. **Deterministic Mathematical Equality:** Paid amount (in subunits/kobo), currency code, and payer email must exactly match the trusted order before access is granted.
3. **Database-Level Idempotency:** Uniqueness constraint on `entitlements.order_id` and `entitlements.source_reference` prevents duplicate access at the relational engine level.
4. **No Held Locks Over Network Calls:** Never hold database transactions or row-level locks across external HTTP requests (Paystack, neatlogs) or LLM completions.
5. **Independently Verified Resolution:** Incidents transition to `RESOLVED` only after a fresh, independent query confirms active entitlement state. Successful database insert alone is insufficient.

## 4. Mandatory Integrations
- **neatlogs:** Continuous tracing across root workflows (`WORKFLOW`), agent decisions (`AGENT`), tool executions (`TOOL`), and guardrails (`GUARDRAIL`). Sanitizes inputs/outputs to prevent PII/secret leakage. Flush explicitly before worker/serverless completion.
- **Entire:** Checkpoint tracking linking Git commits to coding-agent transcripts. Validated via `entire checkpoint list`.
- **cfo.ai:** Real financial modeling distinguishing revenue at risk, customer value protected, and operational recovery costs.

## 5. Security & Operational Rules
- **No Credentials in Source Control:** Never hardcode or commit API keys (`PAYSTACK_SECRET_KEY`, `NEATLOGS_API_KEY`, `OPENAI_API_KEY`, etc.).
- **Truth in Reporting:** Always report actual execution outputs, error codes, and tool results. Never fabricate success or claim a pass without running the check.
- **Phase-Based Authorization:** No implementation work beyond the currently authorized phase. Each phase requires explicit CTO/Tech Lead review before proceeding.
