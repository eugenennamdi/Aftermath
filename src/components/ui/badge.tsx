import React from 'react';

export type StatusVariant =
  | 'RESOLVED'
  | 'INVESTIGATING'
  | 'PROVISIONED'
  | 'OPEN'
  | 'ESCALATED'
  | 'DISMISSED'
  | 'NEUTRAL'
  | 'FIXTURE'
  | 'ACTIVE'
  | 'STANDBY';

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  pulse?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function StatusBadge({
  status,
  variant,
  pulse = false,
  className = '',
  children,
}: StatusBadgeProps) {
  const norm = (variant || status).toUpperCase() as StatusVariant;

  let colorClasses = 'bg-zinc-100 text-zinc-700 border-zinc-200';
  let dotColor = 'bg-zinc-400';

  switch (norm) {
    case 'RESOLVED':
    case 'ACTIVE':
      colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
      dotColor = 'bg-emerald-500';
      break;
    case 'INVESTIGATING':
      colorClasses = 'bg-amber-50 text-amber-800 border-amber-200/80';
      dotColor = 'bg-amber-500';
      break;
    case 'PROVISIONED':
      colorClasses = 'bg-sky-50 text-sky-800 border-sky-200/80';
      dotColor = 'bg-sky-500';
      break;
    case 'OPEN':
      colorClasses = 'bg-blue-50 text-blue-800 border-blue-200/80';
      dotColor = 'bg-blue-500';
      break;
    case 'ESCALATED':
      colorClasses = 'bg-rose-50 text-rose-700 border-rose-200/80';
      dotColor = 'bg-rose-500';
      break;
    case 'FIXTURE':
      colorClasses = 'bg-purple-50 text-purple-800 border-purple-200/80';
      dotColor = 'bg-purple-500';
      break;
    case 'STANDBY':
    case 'NEUTRAL':
    default:
      colorClasses = 'bg-zinc-100 text-zinc-600 border-zinc-200';
      dotColor = 'bg-zinc-400';
  }

  const shouldPulse = pulse || norm === 'INVESTIGATING' || norm === 'PROVISIONED';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium tracking-tight border ${colorClasses} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${
          shouldPulse ? 'animate-pulse' : ''
        }`}
      />
      <span>{children || status}</span>
    </span>
  );
}
