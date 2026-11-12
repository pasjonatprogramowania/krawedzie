import { RefreshCw } from 'lucide-react';
import { PRINT_PRESETS, fmtMm, minRadiusMm } from '../utils/printParams.ts';
import type { PrintPresetId, RoundingKind } from '../utils/printParams.ts';
import { Card } from './ui/Card.tsx';
import { Segmented } from './ui/Segmented.tsx';
import { Slider } from './ui/Slider.tsx';

export interface ParamsCardProps {
  kind: RoundingKind;
  onKindChange: (kind: RoundingKind) => void;
  segments: number;
  onSegmentsChange: (segments: number) => void;
  presetId: PrintPresetId;
  onPresetChange: (id: PrintPresetId) => void;
  nozzleMm: number;
  busy: boolean;
}

/** Karta parametrów: preset, typ zaokrąglenia i gładkość łuku. */
export function ParamsCard({
  kind,
  onKindChange,
  segments,
  onSegmentsChange,
  presetId,
  onPresetChange,
  nozzleMm,
  busy,
}: ParamsCardProps) {
  const minRadius = minRadiusMm(nozzleMm);

  return (
    <Card title="Parametry">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          {PRINT_PRESETS.map((preset) => {
            const tooSmall = preset.radiusMm !== null && preset.radiusMm < minRadius;
            const active = presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                disabled={tooSmall}
                title={
                  tooSmall
                    ? `Preset „${preset.label}” (${fmtMm(preset.radiusMm as number)} mm) jest poniżej minimum dla dyszy ${fmtMm(nozzleMm)} mm (${fmtMm(minRadius)} mm).`
                    : preset.tip
                }
                onClick={() => onPresetChange(preset.id)}
                className={`flex flex-col items-start gap-0.5 rounded border px-2 py-1.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? 'border-accent/40 bg-accent/10 text-txt'
                    : 'border-line-strong bg-btn text-txt-dim hover:bg-btn-hover hover:text-txt'
                }`}
              >
                <span className="text-[12px] font-medium">{preset.label}</span>
                <span className="font-mono text-[10px] text-txt-faint">
                  {preset.radiusMm === null ? 'własne wartości' : `${fmtMm(preset.radiusMm)} mm`}
                </span>
              </button>
            );
          })}
        </div>

        <Segmented
          ariaLabel="Typ zaokrąglenia"
          value={kind}
          onChange={onKindChange}
          options={[
            { value: 'fillet', label: 'Zaokrąglenie', title: 'Łuk okręgu styczny do obu ścian.' },
            { value: 'chamfer', label: 'Ścięcie', title: 'Płaskie ścięcie (fazka).' },
          ]}
          className="w-full"
        />

        {kind === 'fillet' && (
          <Slider
            label="Gładkość (segmenty łuku)"
            ariaLabel="Liczba segmentów łuku"
            value={segments}
            min={1}
            max={12}
            step={1}
            onChange={onSegmentsChange}
            readout={`${segments}`}
            hint="Nie zmienia promienia — tylko gładkość łuku i liczbę trójkątów."
          />
        )}

        {busy && (
          <div className="flex items-center gap-2 rounded border border-accent/20 bg-accent/10 px-2 py-1.5 text-[11px] text-accent">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Przeliczanie zaokrąglenia…
          </div>
        )}
      </div>
    </Card>
  );
}
