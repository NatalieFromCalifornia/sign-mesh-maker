import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '../../lib/cn';

interface NumberFieldProps {
  label: string;
  /** Shown in the label row rather than inside the input, to leave room for the steppers. */
  unit?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  className?: string;
}

/** Decimal places implied by the step, so 0.1 + 0.2 doesn't surface as 0.30000000000000004. */
function precisionOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Numeric input that keeps its own text while being edited.
 *
 * Binding a number straight to a controlled input makes the field impossible to
 * clear: the empty string parses to nothing, the parent falls back to the
 * previous number, and the re-render undoes the deletion — so typing can only
 * ever append digits. Holding the raw text locally lets the field pass through
 * "", "-" and "0." on the way to a valid number, and only commits when one
 * exists.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  className,
}: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => String(value));

  // Follow the value when it changes from outside (reset, preset), but never
  // fight the user mid-edit — "12." must survive long enough to become "12.5".
  useEffect(() => {
    if (Number.parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clamp = useCallback(
    (n: number) => {
      let next = n;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      return Number(next.toFixed(precisionOf(step)));
    },
    [min, max, step],
  );

  const commit = (raw: string) => {
    setText(raw);
    const parsed = Number.parseFloat(raw);
    // Don't clamp while typing: with min=1, "0.4" would jump to 1 mid-keystroke.
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  const settle = () => {
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const next = clamp(parsed);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  const nudge = (direction: 1 | -1) => {
    const base = Number.isFinite(Number.parseFloat(text)) ? Number.parseFloat(text) : value;
    const next = clamp(base + direction * step);
    setText(String(next));
    onChange(next);
  };

  const stepperClass =
    'flex h-1/2 w-7 items-center justify-center text-graphite transition-colors ' +
    'hover:bg-bench-2 hover:text-chalk disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite"
        >
          {label}
        </label>
        {unit && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite/70">
            {unit}
          </span>
        )}
      </div>

      <div className="flex h-10 items-stretch rounded-[3px] border border-rule bg-mat focus-within:border-rule-strong">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => commit(e.target.value)}
          onBlur={settle}
          /*
           * Native number inputs change value on scroll while focused, so
           * scrolling the page past a focused field silently rewrites a
           * dimension. Blur instead and let the page scroll; the steppers and
           * arrow keys cover deliberate nudging.
           */
          onWheel={(e) => e.currentTarget.blur()}
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm tabular-nums text-chalk outline-none"
        />
        <div className="flex w-7 flex-col border-l border-rule">
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={() => nudge(1)}
            disabled={max !== undefined && value >= max}
            className={cn(stepperClass, 'border-b border-rule')}
          >
            <svg viewBox="0 0 10 6" className="w-2.5" aria-hidden="true">
              <path d="M1 5L5 1l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={() => nudge(-1)}
            disabled={min !== undefined && value <= min}
            className={stepperClass}
          >
            <svg viewBox="0 0 10 6" className="w-2.5" aria-hidden="true">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {hint && (
        <p id={`${id}-hint`} className="text-sm leading-relaxed text-graphite">
          {hint}
        </p>
      )}
    </div>
  );
}
