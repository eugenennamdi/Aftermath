import React from 'react';

export type StatusVariant =
  | 'RESOLVED'
  | 'INVESTIGATING'
  | 'PROVISIONED'
  | 'OPEN'
  | 'ESCALATED'
  | 'DISMISSED'
  | 'NEUTRAL'
  | 'FIXTURE';

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

  let colorClasses = 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60';
  let dotColor = 'bg-zinc-400';

  switch (norm) {
    case 'RESOLVED':
      colorClasses = 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30';
      dotColor = 'bg-emerald-400';
      break;
    case 'INVESTIGATING':
      colorClasses = 'bg-amber-950/40 text-amber-300 border-amber-500/30';
      dotColor = 'bg-amber-400';
      break;
    case 'PROVISIONED':
      colorClasses = 'bg-cyan-950/40 text-cyan-300 border-cyan-500/30';
      dotColor = 'bg-cyan-400';
      break;
    case 'OPEN':
      colorClasses = 'bg-sky-950/40 text-sky-300 border-sky-500/30';
      dotColor = 'bg-sky-400';
      break;
    case 'ESCALATED':
      colorClasses = 'bg-rose-950/40 text-rose-300 border-rose-500/30';
      dotColor = 'bg-rose-400';
      break;
    case 'FIXTURE':
      colorClasses = 'bg-purple-950/40 text-purple-300 border-purple-500/30';
      dotColor = 'bg-purple-400';
      break;
    default:
      colorClasses = 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60';
      dotColor = 'bg-zinc-400';
  }

  const shouldPulse = pulse || norm === 'INVESTIGATING' || norm === 'PROVISIONED';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium tracking-tight border ${colorClasses} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${dotColor} ${
          shouldPulse ? 'animate-pulse' : ''
        }`}
      />
      {children || status}
    </span>
  );
}
