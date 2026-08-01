import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Rendered inside the input's trailing edge, e.g. a "mm" unit affix. */
  suffix?: ReactNode;
  hint?: string;
  error?: string;
}

export function Field({ label, suffix, hint, error, className, ...rest }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-lg border bg-surface-2 px-3 text-sm text-fg',
            'placeholder:text-muted/60 disabled:cursor-not-allowed disabled:opacity-50',
            Boolean(suffix) && 'pr-12',
            error ? 'border-danger' : 'border-border hover:border-border-strong',
          )}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
