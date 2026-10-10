'use client';

import React from 'react';
import { type OperationsOverview } from '@/services/query';
import { MetricCard, DoubleBezelCard } from './ui/card';
import { StatusBadge } from './ui/badge';
import {
  ShieldCheckIcon,
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  DatabaseIcon,
  ServerIcon,
  ClockIcon,
  LayersIcon,
  ArrowRightIcon,
} from './ui/icons';

interface OperationsOverviewViewProps {
  overview: OperationsOverview | null;
  isLoading: boolean;
  onNavigateToIncidents: () => void;
  onNavigateToScenarios: () => void;
}

export function OperationsOverviewView({
  overview,
  isLoading,
  onNavigateToIncidents,
  onNavigateToScenarios,
}: OperationsOverviewViewProps) {
  if (isLoading && !overview) {
    return (
      <div className="py-12 space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-zinc-900/60 border border-zinc-800" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-zinc-900/60 border border-zinc-800" />
      </div>
    );
  }

  const metrics = overview?.metrics ?? {
    totalIncidents: 0,
    resolvedIncidents: 0,
    activeInvestigations: 0,
    escalatedIncidents: 0,
    openIncidents: 0,
    activeEntitlements: 0,
    totalOrders: 0,
    resolutionRate: 100,
  };

  const fleet = overview?.workerFleet ?? {
    activeWorkersCount: 0,
    activeWorkerIds: [],
    hasActiveWorker: false,
  };

  const recentActivity = overview?.recentActivity ?? [];

  return (
    <div className="space-y-8 py-6">
      {/* Hero Operational Banner */}
      <div className="rounded-2xl p-6 bg-gradient-to-r from-zinc-900/80 via-zinc-900/50 to-zinc-950 border border-zinc-800/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-medium">
              Autonomous Recovery Operational
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-100">
            Operations & Entitlement Health
          </h2>
          <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
            Continuous reconciliation across Paystack checkouts, local order bindings, and SaaS entitlements.
            Model-driven investigations gated by deterministic mathematical equality.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateToIncidents}
            className="px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 transition-colors flex items-center gap-2"
          >
            <span>View Stream</span>
            <ArrowRightIcon size={13} />
          </button>
          <button
            onClick={onNavigateToScenarios}
            className="px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 font-semibold shadow-sm transition-colors flex items-center gap-2"
          >
            <span>Scenario Lab</span>
            <ArrowRightIcon size={13} />
          </button>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Incidents"
          value={metrics.totalIncidents}
          subvalue={`${metrics.openIncidents} open awaiting action`}
          icon={<AlertTriangleIcon size={16} />}
        />

        <MetricCard
          label="Resolved Recoveries"
          value={metrics.resolvedIncidents}
          subvalue={`${metrics.resolutionRate}% resolution efficiency`}
          icon={<ShieldCheckIcon size={16} />}
          badge={<StatusBadge status="RESOLVED" />}
        />

        <MetricCard
          label="Active Investigations"
          value={metrics.activeInvestigations}
          subvalue="Held by active worker leases"
          icon={<ActivityIcon size={16} />}
          badge={metrics.activeInvestigations > 0 ? <StatusBadge status="INVESTIGATING" pulse /> : undefined}
        />

        <MetricCard
          label="Security Escalations"
          value={metrics.escalatedIncidents}
          subvalue="Underpaid or identity mismatches"
          icon={<AlertTriangleIcon size={16} className="text-rose-400" />}
          badge={metrics.escalatedIncidents > 0 ? <StatusBadge status="ESCALATED" /> : undefined}
        />
      </div>

      {/* Secondary Metrics / Relational Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entitlement & Catalog State */}
        <DoubleBezelCard className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <DatabaseIcon size={15} className="text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                  Relational State
                </h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">PostgreSQL</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Active SaaS Entitlements</span>
                <span className="font-mono font-semibold text-zinc-200">
                  {metrics.activeEntitlements}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Authoritative Orders</span>
                <span className="font-mono font-semibold text-zinc-200">
                  {metrics.totalOrders}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Idempotency Guarantee</span>
                <span className="font-mono text-emerald-400 text-[11px]">DB-Enforced Unique</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/60 leading-relaxed">
              Every provisioned entitlement maps to an immutable local order and Paystack transaction reference.
            </div>
          </div>
        </DoubleBezelCard>

        {/* Worker Fleet & Fencing Status */}
        <DoubleBezelCard className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <ServerIcon size={15} className="text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                  Worker Fleet
                </h3>
              </div>
              <StatusBadge
                status={fleet.hasActiveWorker ? 'ACTIVE' : 'STANDBY'}
                variant={fleet.hasActiveWorker ? 'RESOLVED' : 'NEUTRAL'}
                pulse={fleet.hasActiveWorker}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Active Lease Owners</span>
                <span className="font-mono font-semibold text-zinc-200">
                  {fleet.activeWorkersCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Lease Heartbeat Window</span>
                <span className="font-mono text-zinc-300">30s (10s pulse)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Fencing Monotonicity</span>
                <span className="font-mono text-emerald-400 text-[11px]">Enforced</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/60">
              {fleet.activeWorkerIds.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 font-mono">Current lease owners:</span>
                  <div className="flex flex-wrap gap-1">
                    {fleet.activeWorkerIds.map((id) => (
                      <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p>No active workers currently holding exclusive incident leases.</p>
              )}
            </div>
          </div>
        </DoubleBezelCard>

        {/* Observability & Model Integration */}
        <DoubleBezelCard className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <ActivityIcon size={15} className="text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                  Observability & AI
                </h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Live Traces</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Investigator Model</span>
                <span className="font-mono font-medium text-zinc-200">Gemini 3.8 Flash</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Telemetry Ingestion</span>
                <span className="font-mono text-emerald-400 text-[11px]">neatlogs TS SDK</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Provenance Tracking</span>
                <span className="font-mono text-zinc-300 text-[11px]">Entire Checkpoints</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/60 leading-relaxed">
              Model operates strictly as an investigative tool caller. All state mutations remain blocked by the Deterministic Authorization Gate.
            </div>
          </div>
        </DoubleBezelCard>
      </div>

      {/* Recent Recovery Activity Stream */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClockIcon size={15} className="text-zinc-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Live Audit Log Trail
            </h3>
          </div>
          <span className="text-xs text-zinc-500 font-mono">Latest 10 transitions</span>
        </div>

        <DoubleBezelCard innerClassName="p-0 overflow-hidden">
          {recentActivity.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-xs">
              No audit log entries recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {recentActivity.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                      {log.action}
                    </span>
                    <span className="text-xs text-zinc-300 truncate max-w-md">
                      {log.details || 'No details recorded'}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
                    <span>{log.actor}</span>
                    <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DoubleBezelCard>
      </div>
    </div>
  );
}
