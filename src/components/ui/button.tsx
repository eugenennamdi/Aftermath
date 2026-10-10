import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
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
  let baseClasses =
    'group inline-flex items-center justify-center font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none';

  let sizeClasses = 'text-xs px-3.5 py-1.5 rounded-lg gap-2';
  if (size === 'sm') sizeClasses = 'text-[11px] px-2.5 py-1 rounded-md gap-1.5';
  if (size === 'lg') sizeClasses = 'text-sm px-5 py-2.5 rounded-xl gap-2.5';

  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses =
        'bg-zinc-100 text-zinc-950 hover:bg-white border border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.1)]';
      break;
    case 'secondary':
      variantClasses =
        'bg-zinc-900 text-zinc-200 hover:bg-zinc-800/90 border border-zinc-800 hover:border-zinc-700/80';
      break;
    case 'outline':
      variantClasses =
        'bg-transparent text-zinc-300 hover:bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700';
      break;
    case 'ghost':
      variantClasses = 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40';
      break;
    case 'danger':
      variantClasses =
        'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-800/50 hover:border-rose-700';
      break;
  }

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
}
