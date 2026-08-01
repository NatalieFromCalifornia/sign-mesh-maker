import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PanelProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Panel({ title, description, actions, className, children }: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-panel border border-border bg-surface',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-medium text-fg">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children && <div className="px-5 py-4">{children}</div>}
    </section>
  );
}
