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
  const baseClasses =
    'group inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer';

  let sizeClasses = 'text-xs px-3.5 py-1.5 rounded-lg gap-2';
  if (size === 'sm') sizeClasses = 'text-[11px] px-2.5 py-1 rounded-md gap-1.5';
  if (size === 'lg') sizeClasses = 'text-sm px-5 py-2.5 rounded-xl gap-2.5';

  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses =
        'bg-[#171B23] text-white hover:bg-[#282F3D] border border-[#171B23] shadow-xs';
      break;
    case 'secondary':
      variantClasses =
        'bg-white text-[#171B23] hover:bg-[#F9FAFB] border border-[#E5E7EB] shadow-xs hover:border-[#D1D5DB]';
      break;
    case 'outline':
      variantClasses =
        'bg-transparent text-[#374151] hover:bg-[#F3F4F6] border border-[#E5E7EB] hover:border-[#D1D5DB]';
      break;
    case 'ghost':
      variantClasses =
        'bg-transparent text-[#4B5563] hover:text-[#111827] hover:bg-[#F3F4F6]';
      break;
    case 'danger':
      variantClasses =
        'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200';
      break;
  }

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children && <span>{children}</span>}
    </button>
  );
}
