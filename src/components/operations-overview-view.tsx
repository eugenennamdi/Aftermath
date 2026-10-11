'use client';

import React from 'react';
import { type OperationsOverview } from '@/services/query';
import { MetricCard, DoubleBezelCard } from './ui/card';
import { StatusBadge } from './ui/badge';
import {
  ShieldCheckIcon,
  ActivityIcon,
  AlertTriangleIcon,
  DatabaseIcon,
  ServerIcon,
  ClockIcon,
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
            <div key={i} className="h-28 rounded-xl bg-zinc-200/60 border border-[#E5E7EB]" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-zinc-200/60 border border-[#E5E7EB]" />
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
    resolutionRate: null,
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
      <div className="rounded-2xl p-6 bg-gradient-to-r from-white via-[#FAFBFD] to-[#F3F6F9] border border-[#E5E7EB] shadow-[0_1px_3px_0_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 font-semibold">
              Autonomous Recovery Operational
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#171B23]">
            Operations & Entitlement Health
          </h2>
          <p className="text-xs text-[#69717C] max-w-2xl leading-relaxed">
            Continuous reconciliation across Paystack checkouts, local order bindings, and SaaS entitlements.
            Model-driven investigations gated by deterministic mathematical equality.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateToIncidents}
            className="px-3.5 py-2 rounded-xl text-xs font-medium bg-white hover:bg-[#F9FAFB] text-[#171B23] border border-[#E5E7EB] shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span>View Stream</span>
            <ArrowRightIcon size={13} />
          </button>
          <button
            onClick={onNavigateToScenarios}
            className="px-3.5 py-2 rounded-xl text-xs font-medium bg-[#171B23] hover:bg-[#282F3D] text-white font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
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
          subvalue={
            metrics.resolutionRate !== null
              ? `${metrics.resolutionRate}% resolution efficiency`
              : 'No incidents recorded'
          }
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
          icon={<AlertTriangleIcon size={16} className="text-rose-500" />}
          badge={metrics.escalatedIncidents > 0 ? <StatusBadge status="ESCALATED" /> : undefined}
        />
      </div>

      {/* Secondary Metrics / Relational Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entitlement & Catalog State */}
        <DoubleBezelCard className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <DatabaseIcon size={15} className="text-[#69717C]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#171B23] font-mono">
                  Relational State
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#69717C]">PostgreSQL</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Active SaaS Entitlements</span>
                <span className="font-mono font-semibold text-[#171B23] tabular-nums">
                  {metrics.activeEntitlements}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Authoritative Orders</span>
                <span className="font-mono font-semibold text-[#171B23] tabular-nums">
                  {metrics.totalOrders}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Idempotency Guarantee</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">DB-Enforced Unique</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-[#69717C] border-t border-[#E5E7EB] leading-relaxed">
              Every provisioned entitlement maps to an immutable local order and Paystack transaction reference.
            </div>
          </div>
        </DoubleBezelCard>

        {/* Worker Fleet & Fencing Status */}
        <DoubleBezelCard className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <ServerIcon size={15} className="text-[#69717C]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#171B23] font-mono">
                  Worker Fleet
                </h3>
              </div>
              <StatusBadge
                status={fleet.hasActiveWorker ? 'ACTIVE' : 'STANDBY'}
                variant={fleet.hasActiveWorker ? 'ACTIVE' : 'STANDBY'}
                pulse={fleet.hasActiveWorker}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Active Lease Owners</span>
                <span className="font-mono font-semibold text-[#171B23] tabular-nums">
                  {fleet.activeWorkersCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Lease Heartbeat Window</span>
                <span className="font-mono text-[#171B23]">30s (10s pulse)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Fencing Monotonicity</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">Enforced</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-[#69717C] border-t border-[#E5E7EB]">
              {fleet.activeWorkerIds.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-[10px] text-[#69717C] font-mono">Current lease owners:</span>
                  <div className="flex flex-wrap gap-1">
                    {fleet.activeWorkerIds.map((id) => (
                      <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#171B23] border border-[#E5E7EB]">
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
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <ActivityIcon size={15} className="text-[#69717C]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#171B23] font-mono">
                  Observability & AI
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#69717C]">Live Traces</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Investigator Model</span>
                <span className="font-mono font-medium text-[#171B23]">Claude Sonnet 4.6 (LiteLLM)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Telemetry Ingestion</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">neatlogs TS SDK</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#69717C]">Provenance Tracking</span>
                <span className="font-mono text-[#171B23] text-[11px]">Entire Checkpoints</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-[#69717C] border-t border-[#E5E7EB] leading-relaxed">
              Model operates strictly as an investigative tool caller. All state mutations remain blocked by the Deterministic Authorization Gate.
            </div>
          </div>
        </DoubleBezelCard>
      </div>

      {/* Recent Recovery Activity Stream */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClockIcon size={15} className="text-[#69717C]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#171B23] font-mono">
              Live Audit Log Trail
            </h3>
          </div>
          <span className="text-xs text-[#69717C] font-mono">Latest 10 transitions</span>
        </div>

        <DoubleBezelCard innerClassName="p-0 overflow-hidden">
          {recentActivity.length === 0 ? (
            <div className="p-8 text-center text-[#69717C] text-xs">
              No audit log entries recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-[#F3F4F6]">
              {recentActivity.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-[#F4F4F5] text-[#171B23] border border-[#E5E7EB] shrink-0">
                      {log.action}
                    </span>
                    <span className="text-xs text-[#374151] truncate max-w-md">
                      {log.details || 'No details recorded'}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-[#69717C] font-mono shrink-0">
                    <span>{log.actor}</span>
                    <span className="tabular-nums">{new Date(log.createdAt).toLocaleTimeString()}</span>
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
