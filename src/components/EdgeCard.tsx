import { Check, Sparkles, Trash2 } from 'lucide-react';
import { Card } from './ui/Card.tsx';
import { Slider } from './ui/Slider.tsx';

export interface EdgeCardProps {
  sharpThresholdDeg: number;
  onSharpThresholdChange: (deg: number) => void;
  sharpEdgeCount: number;
  selectedCount: number;
  onSelectSharp: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  showAllEdges: boolean;
  onShowAllEdgesChange: (value: boolean) => void;
}

/** Karta selekcji krawędzi: próg ostrości, zaznaczanie, rysowanie siatki. */
export function EdgeCard({
  sharpThresholdDeg,
  onSharpThresholdChange,
  sharpEdgeCount,
  selectedCount,
  onSelectSharp,
  onSelectAll,
  onClear,
  showAllEdges,
  onShowAllEdgesChange,
}: EdgeCardProps) {
  return (
    <Card title="Krawędzie">
      <div className="space-y-2.5">
        <Slider
          label="Próg kąta ostrego"
          ariaLabel="Próg kąta ostrego"
          value={sharpThresholdDeg}
          min={5}
          max={90}
          step={5}
          onChange={onSharpThresholdChange}
          readout={`${sharpThresholdDeg}° (${sharpEdgeCount} kraw.)`}
          hint="Krawędzie ostrzejsze niż próg są kandydatami do zaokrąglenia."
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSelectSharp}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-edge-auto/30 bg-edge-auto/10 px-2 text-[12px] font-medium text-edge-auto transition-colors duration-150 hover:bg-edge-auto/20"
          >
            <Sparkles className="h-3.5 w-3.5" /> Ostre krawędzie
          </button>
          <button
            type="button"
            onClick={onSelectAll}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-line-strong bg-btn px-2 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover"
          >
            <Check className="h-3.5 w-3.5" /> Wszystkie
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={selectedCount === 0}
            className="col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded border border-line-strong bg-btn px-2 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 className="h-3.5 w-3.5 text-edge-selected" /> Wyczyść zaznaczenie ({selectedCount})
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-txt-dim">
          <input
            type="checkbox"
            checked={showAllEdges}
            onChange={(event) => onShowAllEdgesChange(event.target.checked)}
            className="h-3.5 w-3.5 rounded accent-accent"
          />
          Pokaż wszystkie krawędzie siatki
        </label>
      </div>
    </Card>
  );
}
