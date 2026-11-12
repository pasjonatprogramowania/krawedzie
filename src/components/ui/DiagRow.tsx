import { Check, TriangleAlert } from 'lucide-react';
import { TipIcon } from './Tooltip.tsx';

export interface DiagRowProps {
  label: string;
  ok: boolean;
  detail: string;
  tip?: string;
}

/** Jeden wiersz diagnostyki: etykieta, stan (ikona + kolor) i podpowiedź. */
export function DiagRow({ label, ok, detail, tip }: DiagRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="flex items-center gap-1 text-txt-dim">
        {label}
        {tip && <TipIcon text={tip} />}
      </span>
      <span className={`flex items-center gap-1 font-mono ${ok ? 'text-ok' : 'text-warn'}`}>
        {ok ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
        {detail}
      </span>
    </div>
  );
}
