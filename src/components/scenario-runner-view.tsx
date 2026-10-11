'use client';

import React, { useState } from 'react';
import { type ScenarioRunResult } from '@/services/scenario-runner';
import { DoubleBezelCard } from './ui/card';
import { Button } from './ui/button';
import { StatusBadge } from './ui/badge';
import {
  PlayIcon,
  CheckCircleIcon,
  LockIcon,
  ArrowRightIcon,
} from './ui/icons';

interface ScenarioRunnerViewProps {
  isOperator: boolean;
  onUnlockClick: () => void;
  onInspectIncident: (incidentId: string) => void;
}

interface ScenarioCardMeta {
  key: 'A' | 'B' | 'C' | 'D';
  title: string;
  category: string;
  description: string;
  injectedFailure: string;
  expectedOutcome: string;
}

const SCENARIOS: ScenarioCardMeta[] = [
  {
    key: 'A',
    title: 'Missing Entitlement Autonomous Recovery',
    category: 'Core Happy Path',
    description:
      'Customer paid via Paystack, but entitlement provisioning crashed. Sweeper or webhook detects missing entitlement, autonomous agent investigates, deterministic gate authorizes, and access is provisioned and verified.',
    injectedFailure: 'SIMULATED FIXTURE: Paystack checkout succeeded, SaaS fulfillment initially dropped.',
    expectedOutcome: 'Incident RESOLVED • Entitlement ACTIVE • Fresh read verified',
  },
  {
    key: 'B',
    title: 'Transient Failure & Idempotent Reconciliation',
    category: 'Crash Recovery',
    description:
      'Worker encounters a transient upstream failure and schedules retry with backoff (accelerated for demonstration). Later, a worker discovers that entitlement was already provisioned during an interrupted cycle, reconciling it without duplicate provisioning.',
    injectedFailure: 'SIMULATED FIXTURE: Upstream 503 Gateway Timeout with subsequent active entitlement.',
    expectedOutcome: 'Incident RESOLVED • Exactly 1 Entitlement (Zero Duplicates)',
  },
  {
    key: 'C',
    title: 'Unsafe / Underpaid Payment Blocked by Gate',
    category: 'Security Gate',
    description:
      'Customer order expects 500,000 kobo (5,000 NGN). Simulated Paystack transaction reports only 250,000 kobo was paid. Deterministic gate rejects recovery, incident escalates, and no entitlement is ever granted.',
    injectedFailure: 'SIMULATED FIXTURE: Underpaid transaction (250,000 kobo vs 500,000 kobo).',
    expectedOutcome: 'Incident ESCALATED • 0 Entitlements created • Gate REJECTED',
  },
  {
    key: 'D',
    title: 'Duplicate Events & Concurrency Idempotency',
    category: 'Relational Safety',
    description:
      'Simultaneous webhook deliveries and reconciliation sweep trigger competing worker claims and concurrent fulfillment calls. Validates worker lock exclusion via FOR UPDATE SKIP LOCKED and relational uniqueness idempotency on entitlements.order_id.',
    injectedFailure: 'SIMULATED FIXTURE: Dual concurrent execution threads for identical order.',
    expectedOutcome: '1 Entitlement created • Lock exclusion holds • Zero duplicate access',
  },
];

export function ScenarioRunnerView({
  isOperator,
  onUnlockClick,
  onInspectIncident,
}: ScenarioRunnerViewProps) {
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioRunResult>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleRunScenario(key: 'A' | 'B' | 'C' | 'D') {
    if (!isOperator) {
      onUnlockClick();
      return;
    }

    setRunningScenario(key);
    setError(null);

    try {
      const res = await fetch('/api/scenarios/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: key }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Scenario execution failed');
      }

      setResults((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningScenario(null);
    }
  }

  return (
    <div className="space-y-8 py-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-medium">
              OPERATOR CONTROL ROOM
            </span>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#F4F4F5] text-[#69717C] border border-[#E5E7EB]">
              SIMULATED TEST FIXTURES
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#171B23] mt-1">
            Controlled Scenario Lab
          </h2>
          <p className="text-xs text-[#69717C] max-w-2xl mt-0.5">
            Demonstrates Aftermath&apos;s recovery state machine under real database constraints. All scenarios execute live backend transactions with clearly labeled test fixtures.
          </p>
        </div>

        {!isOperator && (
          <div className="p-3 px-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3">
            <LockIcon size={14} className="text-amber-600 shrink-0" />
            <span className="text-xs text-amber-800">
              Operator authentication required to run live demonstration scenarios.
            </span>
            <Button variant="primary" size="sm" onClick={onUnlockClick}>
              Unlock
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          {error}
        </div>
      )}

      {/* Scenarios Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SCENARIOS.map((s) => {
          const isRunning = runningScenario === s.key;
          const result = results[s.key];

          return (
            <DoubleBezelCard key={s.key} className="flex flex-col h-full">
              <div className="space-y-4 flex flex-col h-full">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-[#F4F4F5] border border-[#E5E7EB] text-xs font-mono font-bold text-[#171B23] flex items-center justify-center">
                        {s.key}
                      </span>
                      <span className="text-[11px] font-mono text-[#69717C]">{s.category}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-[#171B23]">{s.title}</h3>
                  </div>

                  <StatusBadge status="FIXTURE" variant="FIXTURE" />
                </div>

                {/* Description */}
                <p className="text-xs text-[#4B5563] leading-relaxed">{s.description}</p>

                {/* Injected Behavior Card */}
                <div className="p-3 rounded-xl bg-[#FAFBFD] border border-[#E5E7EB] space-y-1.5 text-xs font-mono">
                  <div className="text-[10px] text-[#69717C] uppercase tracking-wider">Injected Fixture</div>
                  <div className="text-[#374151] text-[11px]">{s.injectedFailure}</div>
                  <div className="pt-1.5 border-t border-[#E5E7EB] text-[10px] text-[#69717C] uppercase tracking-wider">Expected State</div>
                  <div className="text-emerald-700 font-medium text-[11px]">{s.expectedOutcome}</div>
                </div>

                {/* Live Execution Stepper (if result available) */}
                {result && (
                  <div className="p-3.5 rounded-xl bg-white border border-[#E5E7EB] space-y-3 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
                      <span className="text-[11px] font-mono text-[#171B23] font-semibold">
                        Durable Outcome:
                      </span>
                      <StatusBadge status={result.finalIncidentStatus} />
                    </div>

                    <div className="space-y-2">
                      {result.steps.map((st, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <CheckCircleIcon size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                          <div className="space-y-0.5 min-w-0">
                            <span className="text-[#171B23] font-medium block truncate">{st.title}</span>
                            <p className="text-[11px] text-[#69717C]">{st.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-[#E5E7EB] flex items-center justify-between text-[11px] font-mono">
                      <span className="text-[#69717C]">Incident: {result.incidentId.slice(0, 14)}...</span>
                      <button
                        onClick={() => onInspectIncident(result.incidentId)}
                        className="text-[#44647B] hover:text-[#171B23] flex items-center gap-1 transition-colors font-medium cursor-pointer"
                      >
                        <span>Inspect in Stream</span>
                        <ArrowRightIcon size={11} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <div className="pt-2 mt-auto">
                  <Button
                    variant={result ? 'outline' : 'primary'}
                    size="sm"
                    className="w-full"
                    onClick={() => handleRunScenario(s.key)}
                    isLoading={isRunning}
                    icon={<PlayIcon size={13} />}
                  >
                    {isRunning
                      ? `Running Scenario ${s.key}...`
                      : result
                      ? `Re-run Scenario ${s.key}`
                      : `Execute Scenario ${s.key}`}
                  </Button>
                </div>
              </div>
            </DoubleBezelCard>
          );
        })}
      </div>
    </div>
  );
}
