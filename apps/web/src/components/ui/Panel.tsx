import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PanelProps {
  /** Rendered as a drafting-style tracked mono label, not a prose heading. */
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Panel({ title, description, actions, className, children }: PanelProps) {
  return (
    <section className={cn('rounded-panel border border-rule bg-bench', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            {title && (
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-graphite">
                {description}
              </p>
            )}
          </div>
          {actions}
        </header>
      )}
      {children && <div className="px-5 py-4">{children}</div>}
    </section>
  );
}
