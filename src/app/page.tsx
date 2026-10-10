'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { OperatorHeader, type ActiveTab } from '@/components/operator-header';
import { OperationsOverviewView } from '@/components/operations-overview-view';
import { IncidentStreamView } from '@/components/incident-stream-view';
import { ScenarioRunnerView } from '@/components/scenario-runner-view';
import { IncidentDetailModal } from '@/components/incident-detail-modal';
import { OperatorLoginModal } from '@/components/operator-login-modal';
import { type OperationsOverview, type IncidentListItem } from '@/services/query';

export default function OperatorConsolePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [isOperator, setIsOperator] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Overview Data
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);

  // Incidents Data
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  const [incidentsLimit] = useState(20);
  const [incidentsOffset, setIncidentsOffset] = useState(0);
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isIncidentsLoading, setIsIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  // Detail Modal
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check operator session
  const checkOperatorSession = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/session');
      const data = await res.json();
      setIsOperator(Boolean(data.authenticated));
    } catch {
      setIsOperator(false);
    }
  }, []);

  // Fetch Overview Data
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents/overview');
      if (!res.ok) throw new Error('Failed to fetch overview');
      const data = await res.json();
      setOverview(data);
    } catch (err) {
      console.error('[Console] Overview fetch error:', err);
    } finally {
      setIsOverviewLoading(false);
    }
  }, []);

  // Fetch Incidents Data
  const fetchIncidents = useCallback(async () => {
    setIsIncidentsLoading(true);
    setIncidentsError(null);

    const params = new URLSearchParams({
      limit: incidentsLimit.toString(),
      offset: incidentsOffset.toString(),
    });

    if (selectedStatus !== 'ALL') params.set('status', selectedStatus);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());

    try {
      const res = await fetch(`/api/incidents?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch incidents list');
      const data = await res.json();
      setIncidents(data.incidents || []);
      setIncidentsTotal(data.total || 0);
    } catch (err) {
      setIncidentsError((err as Error).message);
    } finally {
      setIsIncidentsLoading(false);
    }
  }, [incidentsLimit, incidentsOffset, selectedStatus, searchQuery]);

  // Initial load
  useEffect(() => {
    checkOperatorSession();
    fetchOverview();
    fetchIncidents();
  }, [checkOperatorSession, fetchOverview, fetchIncidents]);

  // Bounded Polling for Active Investigations & State Transitions
  useEffect(() => {
    const hasActiveWork =
      Boolean(overview?.metrics?.activeInvestigations) &&
      (overview?.metrics?.activeInvestigations ?? 0) > 0;

    const pollIntervalMs = hasActiveWork ? 4000 : 10000;

    const timer = setInterval(() => {
      // Avoid querying if tab is hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      fetchOverview();
      if (activeTab === 'incidents') {
        fetchIncidents();
      }
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [overview?.metrics?.activeInvestigations, activeTab, fetchOverview, fetchIncidents]);

  // Manual Refresh Handler
  async function handleRefresh() {
    setIsRefreshing(true);
    await Promise.all([fetchOverview(), fetchIncidents(), checkOperatorSession()]);
    setIsRefreshing(false);
  }

  // Logout Handler
  async function handleLogout() {
    try {
      await fetch('/api/operator/logout', { method: 'POST' });
      setIsOperator(false);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  // Handle Tab Switch
  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    if (tab === 'incidents') fetchIncidents();
    if (tab === 'overview') fetchOverview();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      {/* Top Application Bar */}
      <OperatorHeader
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isOperator={isOperator}
        onUnlockClick={() => setIsLoginModalOpen(true)}
        onLogoutClick={handleLogout}
        hasActiveWorker={overview?.workerFleet?.hasActiveWorker ?? false}
        activeWorkerCount={overview?.workerFleet?.activeWorkersCount ?? 0}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {activeTab === 'overview' && (
          <OperationsOverviewView
            overview={overview}
            isLoading={isOverviewLoading}
            onNavigateToIncidents={() => handleTabChange('incidents')}
            onNavigateToScenarios={() => handleTabChange('scenarios')}
          />
        )}

        {activeTab === 'incidents' && (
          <IncidentStreamView
            incidents={incidents}
            total={incidentsTotal}
            limit={incidentsLimit}
            offset={incidentsOffset}
            isLoading={isIncidentsLoading}
            error={incidentsError}
            onPageChange={(newOffset) => setIncidentsOffset(newOffset)}
            onSelectIncident={(id) => setSelectedIncidentId(id)}
            selectedStatus={selectedStatus}
            onStatusChange={(status) => {
              setSelectedStatus(status);
              setIncidentsOffset(0);
            }}
            searchQuery={searchQuery}
            onSearchChange={(query) => {
              setSearchQuery(query);
              setIncidentsOffset(0);
            }}
          />
        )}

        {activeTab === 'scenarios' && (
          <ScenarioRunnerView
            isOperator={isOperator}
            onUnlockClick={() => setIsLoginModalOpen(true)}
            onInspectIncident={(id) => {
              setSelectedIncidentId(id);
              handleTabChange('incidents');
            }}
          />
        )}
      </main>

      {/* Incident Detail Modal */}
      <IncidentDetailModal
        incidentId={selectedIncidentId}
        onClose={() => setSelectedIncidentId(null)}
      />

      {/* Operator Login Modal */}
      <OperatorLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={() => {
          setIsOperator(true);
          fetchOverview();
        }}
      />

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-6 text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span>Aftermath • neatHack 2026</span>
            <span>•</span>
            <span>Autonomous Recovery Engine</span>
          </div>
          <div className="flex items-center gap-4 text-zinc-600">
            <span>Gemini 3.8 Flash</span>
            <span>neatlogs SDK</span>
            <span>PostgreSQL 17</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
