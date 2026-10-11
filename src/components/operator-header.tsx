'use client';

import React from 'react';
import {
  ShieldIcon,
  LockIcon,
  UnlockIcon,
  RefreshCwIcon,
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
    <header className="sticky top-0 z-40 w-full border-b border-[#E5E7EB] bg-white/85 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & System Status */}
          <div className="flex items-center gap-2 sm:gap-6 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[#44647B]/10 border border-[#44647B]/20 flex items-center justify-center text-[#44647B]">
                <ShieldIcon size={16} />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="font-semibold text-sm tracking-tight text-[#171B23] hidden sm:inline">
                  Aftermath
                </span>
                <span className="hidden md:inline-block text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#F4F4F5] text-[#69717C] border border-[#E5E7EB]">
                  Console
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center p-0.5 sm:p-1 rounded-xl bg-[#F4F4F5] border border-[#E5E7EB] text-[11px] sm:text-xs font-medium shrink-0">
              <button
                onClick={() => onTabChange('overview')}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-white text-[#171B23] shadow-xs border border-[#E5E7EB]/50 font-semibold'
                    : 'text-[#69717C] hover:text-[#171B23]'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => onTabChange('incidents')}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'incidents'
                    ? 'bg-white text-[#171B23] shadow-xs border border-[#E5E7EB]/50 font-semibold'
                    : 'text-[#69717C] hover:text-[#171B23]'
                }`}
              >
                Incidents
              </button>
              <button
                onClick={() => onTabChange('scenarios')}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'scenarios'
                    ? 'bg-white text-[#171B23] shadow-xs border border-[#E5E7EB]/50 font-semibold'
                    : 'text-[#69717C] hover:text-[#171B23]'
                }`}
              >
                Scenarios
              </button>
            </nav>
          </div>

          {/* Right Action Island */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Worker Lease Indicator */}
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#F4F4F5] border border-[#E5E7EB] text-[11px] font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  hasActiveWorker
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-zinc-400'
                }`}
              />
              <span className="text-[#69717C]">
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
                className="border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100/60 text-[11px] px-2 sm:px-2.5"
                icon={<UnlockIcon size={13} />}
              >
                <span className="hidden sm:inline">Operator Active</span>
                <span className="sm:hidden">Active</span>
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
