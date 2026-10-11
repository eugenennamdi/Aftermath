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
      className={`rounded-xl bg-white border border-[#E5E7EB] shadow-[0_1px_3px_0_rgba(0,0,0,0.03)] transition-all ${className}`}
      {...props}
    >
      <div className={`p-5 ${innerClassName}`}>
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
        <div className="space-y-1 min-w-0">
          <span className="text-[11px] font-mono tracking-wider uppercase text-[#69717C] font-medium block truncate">
            {label}
          </span>
          <div className="text-2xl font-semibold tracking-tight text-[#171B23] font-mono tabular-nums">
            {value}
          </div>
          {subvalue && (
            <p className="text-xs text-[#69717C] font-sans mt-0.5 truncate">{subvalue}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 ml-3">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-[#F4F4F5] border border-[#E5E7EB] flex items-center justify-center text-[#69717C]">
              {icon}
            </div>
          )}
          {badge}
        </div>
      </div>
    </DoubleBezelCard>
  );
}
