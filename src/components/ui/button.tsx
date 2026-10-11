import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'default';
  size?: 'sm' | 'md' | 'lg' | 'default';
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  isLoading = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses =
    'group inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  let sizeClasses = 'text-xs px-3.5 py-1.5 rounded-lg gap-2 min-h-[32px]';
  if (size === 'sm') sizeClasses = 'text-[11px] px-2.5 py-1 rounded-md gap-1.5 min-h-[28px]';
  if (size === 'lg') sizeClasses = 'text-sm px-5 py-2.5 rounded-xl gap-2.5 min-h-[40px]';

  let variantClasses = '';
  switch (variant) {
    case 'primary':
    case 'default':
      variantClasses =
        'bg-primary text-primary-foreground hover:bg-primary/90 border border-primary shadow-xs';
      break;
    case 'secondary':
      variantClasses =
        'bg-card text-card-foreground hover:bg-muted border border-border shadow-xs hover:border-border/80';
      break;
    case 'outline':
      variantClasses =
        'bg-transparent text-foreground hover:bg-muted border border-border';
      break;
    case 'ghost':
      variantClasses =
        'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted';
      break;
    case 'danger':
      variantClasses =
        'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200';
      break;
  }

  return (
    <button
      className={cn(baseClasses, sizeClasses, variantClasses, className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        icon && <span data-icon="inline-start" className="shrink-0">{icon}</span>
      )}
      {children && <span>{children}</span>}
    </button>
  );
}
