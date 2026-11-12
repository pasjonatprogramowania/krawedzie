import { useEffect, useRef, useState } from 'react';
import { Download, Ellipsis, TriangleAlert, Upload } from 'lucide-react';
import { NOZZLE_OPTIONS_MM, fmtMm } from '../utils/printParams.ts';
import type { RoundingKind } from '../utils/printParams.ts';

export interface TopBarProps {
  fileName: string | null;
  nozzleMm: number; onNozzleChange: (mm: number) => void;
  radiusMm: number; radiusKind: RoundingKind; radiusMinMm: number; radiusMaxMm: number;
  onRadiusChange: (mm: number) => void; radiusWarning: string | null;
  onImportClick: () => void; onExportStl: () => void; onExportObj: () => void;
  onReset: () => void; onSelectAll: () => void; onClearSelection: () => void;
  /** Eksport zablokowany — zaokrąglanie nie powiodło się. */
  exportBlocked: boolean; exportBlockedReason: string;
}

const BTN =
  'inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-btn px-3 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover';
const BTN_ACCENT =
  'inline-flex h-8 items-center gap-1.5 rounded border border-transparent bg-accent px-3 text-[12px] font-semibold text-surface-base transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45';

export function TopBar(props: TopBarProps) {
  const {
    fileName, nozzleMm, onNozzleChange, radiusMm, radiusKind, radiusMinMm, radiusMaxMm,
    onRadiusChange, radiusWarning, onImportClick, onExportStl, onExportObj, onReset, onSelectAll,
    onClearSelection, exportBlocked, exportBlockedReason,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menuOpen]);

  const menuItems = [
    { label: 'Pobierz OBJ', action: onExportObj },
    { label: 'Wczytaj inny plik', action: onReset },
    { label: 'Zaznacz wszystkie krawędzie', action: onSelectAll },
    { label: 'Wyczyść zaznaczenie', action: onClearSelection },
  ];
  // Podłoga suwaka to minimum drukowe (2 × dysza). Gdy promień jest już poniżej
  // minimum, podłoga schodzi do jego wartości — inaczej suwak pokazywałby inną
  // liczbę niż stan, a użytkownik nie mógłby podnieść promienia.
  const sliderMin = Math.min(radiusMinMm, radiusMm);
  const radiusLabel = radiusKind === 'fillet' ? 'Promień' : 'Ramię ścięcia';

  return (
    <header className="absolute inset-x-0 top-0 z-40 flex h-[52px] flex-wrap items-center gap-3 border-b border-line bg-surface-base/85 px-3 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-surface-base">R</div>
        <span className="text-[13px] font-semibold text-txt">RoundEdge</span>
        <span className="font-mono text-[11px] text-txt-dim">v2.0</span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <button type="button" onClick={onImportClick} className={BTN} title={fileName ?? 'Wczytaj model 3D'}>
          <Upload className="h-3.5 w-3.5" /> Import
        </button>

        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-txt-dim">Dysza</span>
          <select
            aria-label="Średnica dyszy"
            value={nozzleMm}
            onChange={(event) => onNozzleChange(Number(event.target.value))}
            className="h-8 rounded border border-line-strong bg-btn px-2 text-[12px] text-txt"
          >
            {NOZZLE_OPTIONS_MM.map((mm) => <option key={mm} value={mm}>{fmtMm(mm)} mm</option>)}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <label htmlFor="radius-range" className="text-[11px] text-txt-dim">{radiusLabel}</label>
          <input
            id="radius-range"
            type="range"
            className="re-range w-24"
            min={sliderMin}
            max={radiusMaxMm}
            step={0.05}
            value={radiusMm}
            onChange={(event) => onRadiusChange(Number(event.target.value))}
            aria-label="Promień zaokrąglenia"
            aria-valuetext={`${fmtMm(radiusMm)} mm`}
            title={radiusWarning ?? `Minimum dla dyszy ${fmtMm(nozzleMm)} mm: ${fmtMm(radiusMinMm)} mm`}
          />
          <span className={`w-16 text-right font-mono text-[12px] tabular-nums ${radiusWarning ? 'text-warn' : 'text-txt'}`}>
            {fmtMm(radiusMm)} mm
          </span>
          {radiusWarning && (
            <TriangleAlert className="h-3.5 w-3.5 text-warn" role="img" aria-label={radiusWarning} />
          )}
        </div>

        <button
          type="button"
          onClick={onExportStl}
          disabled={exportBlocked}
          title={exportBlocked ? exportBlockedReason : 'Pobierze model zaokrąglony'}
          className={BTN_ACCENT}
        >
          <Download className="h-3.5 w-3.5" /> Pobierz STL
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Więcej opcji"
            className="grid h-8 w-8 place-items-center rounded border border-line-strong bg-btn text-txt-dim transition-colors duration-150 hover:bg-btn-hover hover:text-txt"
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-[36px] z-50 w-56 rounded-panel border border-line bg-surface-panel p-1 shadow-card">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => { item.action(); setMenuOpen(false); }}
                  className="w-full rounded px-2.5 py-1.5 text-left text-[12px] text-txt-dim transition-colors duration-150 hover:bg-surface-raised hover:text-txt"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
