import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

export interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'right';
}

const SIDE_CLASS: Record<'top' | 'bottom' | 'right', string> = {
  top: 'left-1/2 -translate-x-1/2 bottom-full mb-1.5',
  bottom: 'left-1/2 -translate-x-1/2 top-full mt-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/** Podpowiedź dla dowolnego elementu (hover + fokus klawiatury). */
export function Tooltip({ text, children, side = 'top' }: TooltipProps) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${SIDE_CLASS[side]} hidden w-60 whitespace-normal rounded-panel border border-line bg-surface-raised px-2.5 py-2 text-[10px] font-normal leading-snug tracking-normal text-txt shadow-card group-hover:block group-focus-within:block z-50`}
      >
        {text}
      </span>
    </span>
  );
}

/** Ikona „?” z podpowiedzią po najechaniu. */
export function TipIcon({ text }: { text: string }): ReactNode {
  return (
    <span className="relative inline-flex group align-middle">
      <CircleHelp className="h-3 w-3 opacity-40 group-hover:opacity-90 cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden w-56 whitespace-normal rounded-panel border border-line bg-surface-raised px-2.5 py-2 text-[10px] font-normal leading-snug tracking-normal text-txt shadow-card group-hover:block z-50"
      >
        {text}
      </span>
    </span>
  );
}
