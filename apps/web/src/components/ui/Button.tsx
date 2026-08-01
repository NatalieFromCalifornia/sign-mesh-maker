import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-signal text-mat hover:bg-signal-soft',
  secondary: 'bg-bench-2 text-chalk border border-rule hover:border-rule-strong',
  ghost: 'text-graphite hover:text-chalk hover:bg-bench-2',
  danger: 'text-danger border border-danger/40 hover:bg-danger/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-xs',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Controls speak in the drafting register: mono, uppercase, tracked.
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[3px] font-mono uppercase tracking-[0.1em]',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
