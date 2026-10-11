'use client';

import React, { useState } from 'react';
import { type OperationsOverview } from '@/services/query';
import { MetricCard, Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { StatusBadge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './ui/dialog';
import {
  ActivityIcon,
  DatabaseIcon,
  ServerIcon,
  ArrowRightIcon,
  SearchIcon,
  XIcon,
} from './ui/icons';

interface OperationsOverviewViewProps {
  overview: OperationsOverview | null;
  isLoading: boolean;
  onNavigateToIncidents: () => void;
  onNavigateToScenarios: () => void;
}

import { AuditLogEntryCard } from './ui/audit-formatters';


export function OperationsOverviewView({
  overview,
  isLoading,
  onNavigateToIncidents,
  onNavigateToScenarios,
}: OperationsOverviewViewProps) {
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  if (isLoading && !overview) {
    return (
      <div className="py-8 space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted/60 border border-border" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-muted/60 border border-border" />
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

  const query = searchQuery.trim().toLowerCase();
  const filteredActivity = query
    ? recentActivity.filter((log) => {
        const matchAction = log.action.toLowerCase().includes(query);
        const matchActor = log.actor.toLowerCase().includes(query);
        const matchDetails = (log.details || '').toLowerCase().includes(query);
        const matchOrder = (log.orderId || '').toLowerCase().includes(query);
        const matchIncident = (log.incidentId || '').toLowerCase().includes(query);
        return matchAction || matchActor || matchDetails || matchOrder || matchIncident;
      })
    : recentActivity;

  return (
    <div className="space-y-6 py-6">
      {/* Hero Operational Banner */}
      <div className="rounded-xl p-5 sm:p-6 bg-card border border-border shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {fleet.hasActiveWorker ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                Worker Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                Worker Standby
              </span>
            )}
          </div>

          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            Operations & Entitlement Health
          </h2>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            Continuous reconciliation across Paystack checkouts, local order bindings, and SaaS entitlements.
            Model-driven investigations gated by deterministic mathematical equality.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onNavigateToIncidents}
            className="px-3.5 py-2 rounded-lg text-xs font-medium bg-background hover:bg-muted text-foreground border border-border shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span>View Stream</span>
            <ArrowRightIcon size={13} />
          </button>
          <button
            onClick={onNavigateToScenarios}
            className="px-3.5 py-2 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
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
        />

        <MetricCard
          label="Resolved Recoveries"
          value={metrics.resolvedIncidents}
        />

        <MetricCard
          label="Active Investigations"
          value={metrics.activeInvestigations}
        />

        <MetricCard
          label="Security Escalations"
          value={metrics.escalatedIncidents}
        />
      </div>

      {/* Secondary Metrics / Relational Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Entitlement & Catalog State */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <DatabaseIcon size={15} className="text-muted-foreground" />
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Relational State
              </CardTitle>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">PostgreSQL</span>
          </CardHeader>

          <CardContent className="pt-4 space-y-3 flex-1 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Active SaaS Entitlements</span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {metrics.activeEntitlements}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Authoritative Orders</span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {metrics.totalOrders}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Idempotency Guarantee</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">DB-Enforced Unique</span>
              </div>
            </div>

            <div className="pt-3 text-[11px] text-muted-foreground border-t border-border leading-relaxed">
              Every provisioned entitlement maps strictly to an immutable local order and Paystack transaction reference.
            </div>
          </CardContent>
        </Card>

        {/* Worker Fleet & Fencing Status */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <ServerIcon size={15} className="text-muted-foreground" />
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Worker Fleet
              </CardTitle>
            </div>
            <StatusBadge
              status={fleet.hasActiveWorker ? 'ACTIVE' : 'STANDBY'}
              variant={fleet.hasActiveWorker ? 'ACTIVE' : 'STANDBY'}
              pulse={fleet.hasActiveWorker}
            />
          </CardHeader>

          <CardContent className="pt-4 space-y-3 flex-1 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Active Lease Owners</span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {fleet.activeWorkersCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Lease Heartbeat Window</span>
                <span className="font-mono text-foreground text-[11px]">30s (10s pulse)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Fencing Monotonicity</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">Enforced</span>
              </div>
            </div>

            <div className="pt-3 text-[11px] text-muted-foreground border-t border-border">
              {fleet.activeWorkerIds.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground font-mono">Current lease owners:</span>
                  <div className="flex flex-wrap gap-1">
                    {fleet.activeWorkerIds.map((id) => (
                      <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p>No active investigations currently held by worker leases.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Observability & Model Integration */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <ActivityIcon size={15} className="text-muted-foreground" />
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Observability & AI
              </CardTitle>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">Telemetry</span>
          </CardHeader>

          <CardContent className="pt-4 space-y-3 flex-1 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Investigator Model</span>
                <span className="font-mono font-medium text-foreground text-[11px]">Claude Sonnet 4.6 (LiteLLM)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Telemetry Ingestion</span>
                <span className="font-mono text-emerald-700 font-medium text-[11px]">neatlogs TS SDK</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Provenance Tracking</span>
                <span className="font-mono text-foreground text-[11px]">Entire Checkpoints</span>
              </div>
            </div>

            <div className="pt-3 text-[11px] text-muted-foreground border-t border-border leading-relaxed">
              Model operates strictly as an investigative tool caller. All state mutations remain blocked by the Deterministic Authorization Gate.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Audit Log Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Live Audit Log Trail
          </h3>
          <span className="text-xs text-muted-foreground font-mono">
            {recentActivity.length} recent transitions
          </span>
        </div>

        <Card className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border-border shadow-xs hover:border-border/80 transition-colors">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">
              Autonomous Recovery Audit Trail
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
              Immutable database ledger tracking worker claims, gate evaluations, Paystack payment verifications, and resolution events.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAuditModalOpen(true)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-background hover:bg-muted text-foreground border border-border shadow-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
          >
            <span>View Live Audit Log</span>
            <ArrowRightIcon size={13} />
          </button>
        </Card>
      </div>

      {/* Live Audit Log Modal */}
      <Dialog open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] p-0 overflow-hidden flex flex-col" showCloseButton={false}>
          <DialogHeader className="p-5 border-b border-border bg-card shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base font-bold tracking-tight text-foreground">
                    Live Audit Log Trail
                  </DialogTitle>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted text-foreground border border-border">
                    {recentActivity.length} Events
                  </span>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Immutable chronological ledger of worker leases, deterministic authorization gate decisions, and recovery events.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                  aria-label="Close dialog"
                >
                  <XIcon size={16} />
                </button>
              </DialogClose>
            </div>

            {recentActivity.length > 0 && (
              <div className="pt-3">
                <div className="relative">
                  <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Filter by action, actor, order ID, incident ID, or details..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="p-5 overflow-y-auto space-y-3 flex-1">
            {filteredActivity.length === 0 ? (
              <div className="py-12 text-center space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {recentActivity.length === 0 ? 'No audit entries recorded yet.' : 'No audit entries match your search.'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {recentActivity.length === 0
                    ? 'Audit records are created automatically during worker reconciliation and payment recovery.'
                    : 'Try adjusting your search query.'}
                </p>
              </div>
            ) : (
              filteredActivity.map((log) => (
                <AuditLogEntryCard key={log.id} log={log} />
              ))
            )}
          </div>

          <div className="p-4 border-t border-border bg-card/60 flex items-center justify-between text-xs text-muted-foreground shrink-0">
            <span className="font-mono text-[11px]">
              Showing {filteredActivity.length} of {recentActivity.length} transitions
            </span>
            <DialogClose asChild>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors cursor-pointer"
              >
                Close
              </button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
