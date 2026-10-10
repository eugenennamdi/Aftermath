import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function DoubleBezelCard({
  children,
  className = '',
  innerClassName = '',
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-2xl p-1 bg-gradient-to-b from-zinc-800/60 to-zinc-900/40 border border-zinc-800/70 shadow-sm ${className}`}
      {...props}
    >
      <div
        className={`rounded-[calc(1rem-0.125rem)] bg-zinc-950/90 border border-white/[0.03] p-5 ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  subvalue,
  icon,
  badge,
  trend,
}: {
  label: string;
  value: string | number;
  subvalue?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  trend?: string;
}) {
  return (
    <DoubleBezelCard>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-mono tracking-wider uppercase text-zinc-400 font-medium">
            {label}
          </span>
          <div className="text-2xl font-semibold tracking-tight text-zinc-100 font-mono">
            {value}
          </div>
          {subvalue && (
            <p className="text-xs text-zinc-500 font-sans mt-0.5">{subvalue}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-center text-zinc-400">
              {icon}
            </div>
          )}
          {badge}
        </div>
      </div>
    </DoubleBezelCard>
  );
}
