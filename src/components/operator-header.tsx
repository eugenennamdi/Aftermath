'use client';

import React from 'react';
import {
  ShieldIcon,
  ActivityIcon,
  LockIcon,
  UnlockIcon,
  RefreshCwIcon,
  TerminalIcon,
  LayersIcon,
} from './ui/icons';
import { Button } from './ui/button';

export type ActiveTab = 'overview' | 'incidents' | 'scenarios';

interface OperatorHeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  isOperator: boolean;
  onUnlockClick: () => void;
  onLogoutClick: () => void;
  hasActiveWorker: boolean;
  activeWorkerCount: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function OperatorHeader({
  activeTab,
  onTabChange,
  isOperator,
  onUnlockClick,
  onLogoutClick,
  hasActiveWorker,
  activeWorkerCount,
  onRefresh,
  isRefreshing,
}: OperatorHeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & System Status */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-100 shadow-inner">
                <ShieldIcon size={16} />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-zinc-100">
                  Aftermath
                </span>
                <span className="hidden sm:inline-block text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  Console
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center p-1 rounded-xl bg-zinc-900/60 border border-zinc-800/60 text-xs font-medium">
              <button
                onClick={() => onTabChange('overview')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'overview'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => onTabChange('incidents')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'incidents'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Incidents
              </button>
              <button
                onClick={() => onTabChange('scenarios')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'scenarios'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Scenarios
              </button>
            </nav>
          </div>

          {/* Right Action Island */}
          <div className="flex items-center gap-3">
            {/* Worker Lease Indicator */}
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  hasActiveWorker
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-zinc-500'
                }`}
              />
              <span className="text-zinc-400">
                {hasActiveWorker
                  ? `Worker Active (${activeWorkerCount})`
                  : 'Worker Standby'}
              </span>
            </div>

            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              isLoading={isRefreshing}
              title="Refresh console data"
              icon={<RefreshCwIcon size={13} className={isRefreshing ? 'animate-spin' : ''} />}
            >
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            {/* Operator Auth Button */}
            {isOperator ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onLogoutClick}
                className="border-emerald-500/30 text-emerald-400 bg-emerald-950/20"
                icon={<UnlockIcon size={13} />}
              >
                Operator Active
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onUnlockClick}
                icon={<LockIcon size={13} />}
              >
                Unlock
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
