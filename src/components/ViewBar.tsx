import { Segmented } from './ui/Segmented.tsx';

export interface ViewBarProps {
  selectedCount: number;
  hoveredEdge: number | null;
  compareMode: 'before' | 'after' | 'overlay';
  onCompareModeChange: (mode: 'before' | 'after' | 'overlay') => void;
  hasResult: boolean;
  /** Wąski ekran — podpowiedź sterowania mieści się tylko na desktopie. */
  showHint: boolean;
  className?: string;
}

/** Szklany pasek widoku: licznik krawędzi, tryb porównania, podpowiedź sterowania. */
export function ViewBar({
  selectedCount,
  hoveredEdge,
  compareMode,
  onCompareModeChange,
  hasResult,
  showHint,
  className = '',
}: ViewBarProps) {
  return (
    <div
      aria-label="Pasek widoku"
      className={`absolute bottom-[14px] left-[14px] z-30 flex items-center gap-2 rounded-bar border border-white/10 bg-surface-panel/70 px-2 py-1.5 shadow-glass backdrop-blur-md ${className}`.trim()}
    >
      <span className="text-[11px] text-txt-dim">
        Zaznaczone: <strong className="font-mono text-edge-selected">{selectedCount}</strong>
      </span>
      {hoveredEdge !== null && (
        <span className="font-mono text-[11px] text-edge-hover">#{hoveredEdge}</span>
      )}
      {hasResult && (
        <Segmented
          ariaLabel="Tryb porównania modelu"
          value={compareMode}
          onChange={onCompareModeChange}
          options={[
            { value: 'before', label: 'Przed', title: 'Model oryginalny — bez żadnych zmian.' },
            { value: 'after', label: 'Po', title: 'Model po zaokrągleniu zaznaczonych krawędzi.' },
            { value: 'overlay', label: 'Porównanie', title: 'Oryginał nałożony na wynik.' },
          ]}
        />
      )}
      {showHint && (
        <span className="hidden text-[11px] text-txt-faint lg:inline">
          LPM zaznacz · przeciągnij obrót · scroll zoom
        </span>
      )}
    </div>
  );
}

