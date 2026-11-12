import { Check, Info, TriangleAlert } from 'lucide-react';

export interface ToastItem {
  id: number;
  kind: 'info' | 'warn' | 'ok';
  text: string;
}

export interface ToastsProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  className?: string;
}

const TONE = {
  warn: 'border-warn/30 bg-warn/10 text-warn',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  info: 'border-line bg-surface-panel/95 text-txt-dim',
} as const;

/** Powiadomienia — krótkie komunikaty o zdarzeniach (wczytanie, wynik, błąd). */
export function Toasts({ toasts, onDismiss, className = '' }: ToastsProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute bottom-[46px] right-[14px] z-50 flex w-[320px] max-w-[calc(100vw-28px)] flex-col gap-2 ${className}`.trim()}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-panel border px-3 py-2 text-[11px] shadow-card backdrop-blur-md ${TONE[toast.kind]}`}
        >
          {toast.kind === 'warn' ? (
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : toast.kind === 'ok' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <p className="flex-1 leading-snug">{toast.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Zamknij powiadomienie"
            className="opacity-50 transition-opacity hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
