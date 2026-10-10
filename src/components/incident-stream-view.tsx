'use client';

import React, { useState } from 'react';
import { type IncidentListItem } from '@/services/query';
import { DoubleBezelCard } from './ui/card';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import {
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ArrowRightIcon,
  ClockIcon,
  LockIcon,
} from './ui/icons';

interface IncidentStreamViewProps {
  incidents: IncidentListItem[];
  total: number;
  limit: number;
  offset: number;
  isLoading: boolean;
  error: string | null;
  onPageChange: (newOffset: number) => void;
  onSelectIncident: (id: string) => void;
  selectedStatus: string;
  onStatusChange: (status: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isOperator?: boolean;
  onUnlockClick?: () => void;
}

const STATUS_FILTERS = [
  'ALL',
  'OPEN',
  'INVESTIGATING',
  'PROVISIONED',
  'RESOLVED',
  'ESCALATED',
];

export function IncidentStreamView({
  incidents,
  total,
  limit,
  offset,
  isLoading,
  error,
  onPageChange,
  onSelectIncident,
  selectedStatus,
  onStatusChange,
  searchQuery,
  onSearchChange,
  isOperator = false,
  onUnlockClick,
}: IncidentStreamViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function copyToClipboard(e: React.MouseEvent, text: string) {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6 py-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-100">Incident Stream</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Discrepancies identified across webhook ingestion and periodic reconciliation sweeps.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <SearchIcon
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search incident, order, or email..."
            className="w-full pl-9 pr-3.5 py-2 text-xs font-mono bg-zinc-900/90 border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-colors"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-all ${
              selectedStatus === s
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Incident Data Table */}
      <DoubleBezelCard innerClassName="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center space-y-3">
            <span className="w-5 h-5 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin inline-block" />
            <p className="text-xs text-zinc-500 font-mono">Loading authoritative records...</p>
          </div>
        ) : error === 'AUTH_REQUIRED' || !isOperator ? (
          <div className="p-16 text-center space-y-4 max-w-md mx-auto">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
              <LockIcon size={18} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-zinc-200">Operator Authentication Required</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Live incident streams expose tenant order bindings and Paystack transaction references. Authenticate with your operator passphrase to inspect and manage recovery incidents.
              </p>
            </div>
            {onUnlockClick && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onUnlockClick}
                icon={<LockIcon size={13} />}
              >
                Unlock Operator Console
              </Button>
            )}
          </div>
        ) : error ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-xs text-rose-400 font-medium">Failed to load incident stream</p>
            <p className="text-[11px] text-zinc-500">{error}</p>
          </div>
        ) : incidents.length === 0 ? (
          <div className="p-16 text-center space-y-2">
            <p className="text-sm font-medium text-zinc-300">No matching incidents found</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              No incidents match status &quot;{selectedStatus}&quot; or query &quot;{searchQuery}&quot;. Use the Scenario Lab to trigger a demonstration incident.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                  <th className="py-3 px-4 font-medium">Incident ID</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Failure Reason</th>
                  <th className="py-3 px-4 font-medium">Order / Customer</th>
                  <th className="py-3 px-4 font-medium">Expected</th>
                  <th className="py-3 px-4 font-medium">Retries</th>
                  <th className="py-3 px-4 font-medium">Detected</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => onSelectIncident(inc.id)}
                    className="group hover:bg-zinc-900/60 cursor-pointer transition-colors"
                  >
                    {/* Incident ID */}
                    <td className="py-3.5 px-4 font-mono text-zinc-200">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-100">
                          {inc.id.slice(0, 14)}...
                        </span>
                        <button
                          onClick={(e) => copyToClipboard(e, inc.id)}
                          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-opacity"
                          title="Copy Incident ID"
                        >
                          <CopyIcon size={12} />
                        </button>
                        {copiedId === inc.id && (
                          <span className="text-[10px] text-emerald-400">Copied</span>
                        )}
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <StatusBadge status={inc.status} pulse={inc.isLeaseActive} />
                    </td>

                    {/* Failure Category */}
                    <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-300">
                      {inc.reason}
                    </td>

                    {/* Order / Customer */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-0.5">
                        <div className="font-mono text-[11px] text-zinc-300">
                          {inc.orderId.slice(0, 12)}...
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                          {inc.customerEmailRedacted}
                        </div>
                      </div>
                    </td>

                    {/* Expected Amount */}
                    <td className="py-3.5 px-4 font-mono text-zinc-200">
                      {(inc.expectedAmount / 100).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      <span className="text-zinc-500 text-[10px]">{inc.currency}</span>
                    </td>

                    {/* Retry Budget */}
                    <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400">
                      {inc.retryCount}/5
                    </td>

                    {/* Detected At */}
                    <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-500">
                      {new Date(inc.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Action Arrow */}
                    <td className="py-3.5 px-4 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 group-hover:text-zinc-100 transition-colors">
                        <span>Inspect</span>
                        <ArrowRightIcon size={12} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!isLoading && total > 0 && (
          <div className="p-3.5 px-4 border-t border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between text-xs text-zinc-400 font-mono">
            <div>
              Showing {Math.min(offset + 1, total)} - {Math.min(offset + incidents.length, total)} of {total} incidents
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.max(0, offset - limit))}
                disabled={offset === 0}
                icon={<ChevronLeftIcon size={13} />}
              >
                Previous
              </Button>
              <span className="px-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(offset + limit)}
                disabled={offset + limit >= total}
                icon={<ChevronRightIcon size={13} />}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DoubleBezelCard>
    </div>
  );
}
