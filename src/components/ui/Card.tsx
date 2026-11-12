import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Wspólna powłoka karty: panel, obramowanie 1 px, przyciemnienie tła sceny. */
export function Card({ title, badge, children, className = '' }: CardProps) {
  return (
    <section
      className={`pointer-events-auto rounded-panel border border-line bg-surface-panel/85 p-3 shadow-card backdrop-blur-[6px] ${className}`}
    >
      {title && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-txt-dim">{title}</h2>
          {badge}
        </header>
      )}
      {children}
    </section>
  );
}
