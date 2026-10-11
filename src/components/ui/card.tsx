import React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-all',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-semibold leading-none tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-5 pt-0', className)} {...props} />;
}

// Backward-compatible wrappers
interface DoubleBezelCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function DoubleBezelCard({
  children,
  className = '',
  innerClassName = '',
  ...props
}: DoubleBezelCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-xs',
        className
      )}
      {...props}
    >
      <div className={cn('p-5', innerClassName)}>
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
    <div className="rounded-xl border border-border bg-card text-card-foreground p-5 shadow-xs">
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <span className="text-xs font-medium text-muted-foreground block truncate">
            {label}
          </span>
          <div className="text-2xl font-semibold tracking-tight text-foreground font-mono tabular-nums">
            {value}
          </div>
          {subvalue && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{subvalue}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 ml-3">
          {icon && (
            <div className="size-8 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
              {icon}
            </div>
          )}
          {badge}
        </div>
      </div>
    </div>
  );
}
