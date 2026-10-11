'use client';

import React, { useState } from 'react';
import { type IncidentListItem } from '@/services/query';
import { Card } from './ui/card';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from './ui/table';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import {
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ArrowRightIcon,
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
          <h2 className="text-xl font-bold tracking-tight text-foreground">Incident Stream</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discrepancies identified across webhook ingestion and periodic reconciliation sweeps.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <SearchIcon
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search incident, order, or email..."
            className="w-full pl-9 pr-3.5 py-2 text-xs font-mono bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors shadow-xs"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            className={`px-3 py-1.5 rounded-lg font-mono font-medium transition-all cursor-pointer ${
              selectedStatus === s
                ? 'bg-card text-foreground border border-border shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Incident Data Table Card */}
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center space-y-3">
            <span className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin inline-block" />
            <p className="text-xs text-muted-foreground font-mono">Loading authoritative records...</p>
          </div>
        ) : error === 'AUTH_REQUIRED' || !isOperator ? (
          <div className="p-16 text-center space-y-4 max-w-md mx-auto">
            <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center mx-auto text-muted-foreground">
              <LockIcon size={18} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">Operator Authentication Required</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
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
            <p className="text-xs text-rose-600 font-medium">Failed to load incident stream</p>
            <p className="text-[11px] text-muted-foreground">{error}</p>
          </div>
        ) : incidents.length === 0 ? (
          <div className="p-16 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">No matching incidents found</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No incidents match status &quot;{selectedStatus}&quot; or query &quot;{searchQuery}&quot;. Use the Scenario Lab to trigger a demonstration incident.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Incident ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Failure Reason</TableHead>
                <TableHead>Order / Customer</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((inc) => (
                <TableRow
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="group cursor-pointer"
                >
                  {/* Incident ID */}
                  <TableCell className="font-mono text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground">
                        {inc.id.slice(0, 14)}...
                      </span>
                      <button
                        onClick={(e) => copyToClipboard(e, inc.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity cursor-pointer"
                        title="Copy Incident ID"
                        aria-label="Copy Incident ID"
                      >
                        <CopyIcon size={12} />
                      </button>
                      {copiedId === inc.id && (
                        <span className="text-[10px] text-emerald-600 font-medium">Copied</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Status Badge */}
                  <TableCell>
                    <StatusBadge status={inc.status} pulse={inc.isLeaseActive} />
                  </TableCell>

                  {/* Failure Category */}
                  <TableCell className="text-foreground/90 font-sans text-xs">
                    {inc.reason}
                  </TableCell>

                  {/* Order / Customer */}
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="font-mono text-[11px] text-foreground">
                        {inc.orderId.slice(0, 12)}...
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                        {inc.customerEmailRedacted}
                      </div>
                    </div>
                  </TableCell>

                  {/* Expected Amount */}
                  <TableCell className="font-mono text-foreground tabular-nums font-medium">
                    {(inc.expectedAmount / 100).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    <span className="text-muted-foreground text-[10px] font-normal">{inc.currency}</span>
                  </TableCell>

                  {/* Retry Budget */}
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {inc.retryCount}/5
                  </TableCell>

                  {/* Detected At */}
                  <TableCell className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {new Date(inc.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>

                  {/* Action Arrow */}
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary group-hover:text-foreground transition-colors">
                      <span>Inspect</span>
                      <ArrowRightIcon size={12} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Pagination Footer */}
        {!isLoading && total > 0 && (
          <div className="p-3.5 px-4 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground font-mono">
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
      </Card>
    </div>
  );
}
