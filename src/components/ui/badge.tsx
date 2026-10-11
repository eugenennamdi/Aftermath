import React from 'react';
import { cn } from '@/lib/utils';

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

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | StatusVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  let variantClasses = 'bg-primary text-primary-foreground';
  if (variant === 'secondary') variantClasses = 'bg-secondary text-secondary-foreground';
  if (variant === 'outline') variantClasses = 'border border-border text-foreground';
  if (variant === 'destructive') variantClasses = 'bg-destructive text-destructive-foreground';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variantClasses,
        className
      )}
      {...props}
    />
  );
}

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

  let colorClasses = 'bg-muted text-muted-foreground border-border';
  let dotColor = 'bg-muted-foreground/60';

  switch (norm) {
    case 'RESOLVED':
    case 'ACTIVE':
      colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
      dotColor = 'bg-emerald-600';
      break;
    case 'INVESTIGATING':
      colorClasses = 'bg-amber-50 text-amber-800 border-amber-200/80';
      dotColor = 'bg-amber-600';
      break;
    case 'PROVISIONED':
      colorClasses = 'bg-sky-50 text-sky-800 border-sky-200/80';
      dotColor = 'bg-sky-600';
      break;
    case 'OPEN':
      colorClasses = 'bg-blue-50 text-blue-800 border-blue-200/80';
      dotColor = 'bg-blue-600';
      break;
    case 'ESCALATED':
      colorClasses = 'bg-rose-50 text-rose-700 border-rose-200/80';
      dotColor = 'bg-rose-600';
      break;
    case 'FIXTURE':
      colorClasses = 'bg-purple-50 text-purple-800 border-purple-200/80';
      dotColor = 'bg-purple-600';
      break;
    case 'STANDBY':
    case 'NEUTRAL':
    default:
      colorClasses = 'bg-muted text-muted-foreground border-border';
      dotColor = 'bg-muted-foreground/60';
  }

  // Only pulse if explicitly instructed AND actively investigating/running
  const shouldPulse = pulse && (norm === 'INVESTIGATING' || norm === 'ACTIVE');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-tight border',
        colorClasses,
        className
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full shrink-0',
          dotColor,
          shouldPulse ? 'animate-pulse' : ''
        )}
      />
      <span>{children || status}</span>
    </span>
  );
}
