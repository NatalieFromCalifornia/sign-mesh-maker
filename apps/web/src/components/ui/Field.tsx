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
    <div className={cn('flex flex-col gap-2', className)}>
      <label
        htmlFor={id}
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite"
      >
        {label}
      </label>

      <div className="relative">
        {/* Numeric entry is dimensioning — mono with tabular figures so digits
            don't shift as the user types. */}
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-[3px] border bg-mat px-3 font-mono text-sm tabular-nums text-chalk',
            'placeholder:text-graphite/50 disabled:cursor-not-allowed disabled:opacity-40',
            Boolean(suffix) && 'pr-12',
            error ? 'border-danger' : 'border-rule hover:border-rule-strong',
          )}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-graphite">
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-graphite">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
