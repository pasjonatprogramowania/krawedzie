import { TriangleAlert } from 'lucide-react';
import { surfaceArea } from '../utils/meshProcessing.ts';
import type { MeshDiagnostics, RoundingResult } from '../utils/meshProcessing.ts';
import { PRINT_TOLERANCE_MM, fmtMm } from '../utils/printParams.ts';
import { Card } from './ui/Card.tsx';
import { DiagRow } from './ui/DiagRow.tsx';

export interface StatusCardProps {
  diagnostics: MeshDiagnostics | null;
  result: RoundingResult | null;
  /** Ostrzeżenia po polsku — z raportu, druku i geometrii. */
  warnings: string[];
  className?: string;
}

/** Dlaczego promień został przycięty — pokazujemy powód, nie samą liczbę. */
const CLAMP_REASON: Record<string, string> = {
  'edge-length': 'promień przycięty do długości krawędzi siatki',
  'acute-angle': 'promień przycięty do kąta materiału w narożniku',
  clearance: 'promień przycięty do odległości od przeciwległej powierzchni',
};

export function StatusCard({ diagnostics, result, warnings, className = '' }: StatusCardProps) {
  const report = result?.report;
  const afterSize = result
    ? [
        result.mesh.bboxMax[0] - result.mesh.bboxMin[0],
        result.mesh.bboxMax[1] - result.mesh.bboxMin[1],
        result.mesh.bboxMax[2] - result.mesh.bboxMin[2],
      ]
    : null;

  return (
    <Card title="Wynik" className={className}>
      <div className="space-y-2.5">
        {!result && (
          <p className="text-[11px] text-txt-dim">
            {diagnostics
              ? 'Zaznacz krawędzie w podglądzie — wynik pojawi się po przeliczeniu.'
              : 'Wynik pojawi się po wczytaniu modelu.'}
          </p>
        )}

        {report?.failed && (
          <div role="alert" className="rounded border border-error/30 bg-error/10 p-2 text-[11px] text-error">
            <p className="font-medium">Nie udało się zaokrąglić krawędzi — plik do pobrania to niezmieniony oryginał.</p>
            <p className="mt-1 font-mono text-[10px]">
              Wycofano krawędzi: {report.failedEdgeIndices.length} · zmienione wierzchołki: 0
            </p>
          </div>
        )}

        {report && result && diagnostics && (
          <div className="overflow-hidden rounded border border-line text-[11px]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 bg-surface-raised/60 px-2 py-1 font-semibold uppercase tracking-wider text-txt-faint">
              <span>Metryka</span>
              <span>Przed</span>
              <span>Po</span>
            </div>
            <Row label="Trójkąty" before={diagnostics.faceCount.toLocaleString()} after={report.trianglesAfter.toLocaleString()} />
            <Row label="Objętość [cm³]" before={(diagnostics.volume / 1000).toFixed(2)} after={(report.volumeAfter / 1000).toFixed(2)} />
            <Row label="Pole [cm²]" before={(diagnostics.surfaceArea / 100).toFixed(1)} after={(surfaceArea(result.mesh) / 100).toFixed(1)} />
            {afterSize && (
              <Row
                label="Gabaryt [mm]"
                before={diagnostics.size.map((v) => v.toFixed(1)).join('×')}
                after={afterSize.map((v) => v.toFixed(1)).join('×')}
              />
            )}
            <Row label="Zaokrąglone krawędzie" before="—" after={`${report.edgesRounded} / ${report.selectedEdgeCount}`} />
            <Row label="Promień efektywny" before="—" after={`${fmtMm(report.effectiveRadius, 3)} mm`} />
            <Row label="Błąd powierzchni" before="—" after={`${fmtMm(report.measuredSurfaceError, 3)} mm`} />
            <Row label="Rozdzielczość pasa" before="—" after={`${fmtMm(report.bandFacetSize, 2)} mm`} />
          </div>
        )}

        {report && (
          <div className="space-y-1.5">
            <DiagRow
              label="Odwrócone trójkąty"
              ok={report.flippedFaceCount === 0}
              detail={report.flippedFaceCount === 0 ? 'brak' : `${report.flippedFaceCount} szt.`}
              tip="Po zaokrągleniu żaden trójkąt nie obrócił się na drugą stronę — inaczej slicer widziałby dziurę."
            />
            <DiagRow
              label="Zdegenerowane trójkąty"
              ok={report.degenerateFaceCount === 0}
              detail={report.degenerateFaceCount === 0 ? 'brak' : `${report.degenerateFaceCount} szt.`}
              tip="Trójkąty o zerowym polu — nie dałyby się pociąć."
            />
            <DiagRow
              label="Hausdorff ≤ promień"
              ok={report.maxDisplacement <= report.effectiveRadius + 1e-9}
              detail={`${fmtMm(report.maxDisplacement, 3)} ≤ ${fmtMm(report.effectiveRadius, 3)} mm`}
              tip="Twarda gwarancja: żaden wierzchołek nie przesunął się bardziej niż o zadany promień."
            />
            <DiagRow
              label="Płaszczyzny zachowane"
              ok={report.bboxDelta.every((d) => Math.abs(d) <= PRINT_TOLERANCE_MM)}
              detail={`Δ ${report.bboxDelta.map((v) => v.toFixed(3)).join(' / ')} mm`}
              tip={`Zmiana wymiarów gabarytowych. Tolerancja druku FDM to ${fmtMm(PRINT_TOLERANCE_MM)} mm.`}
            />
            <DiagRow
              label="Geometria zmieniona"
              ok={report.geometryChanged}
              detail={report.geometryChanged ? 'tak' : 'nie'}
              tip="Fałsz oznacza, że operacja została wycofana i model jest identyczny z wejściem."
            />
          </div>
        )}

        {report?.radiusClampReason && (
          <p className="text-[11px] text-warn">
            {CLAMP_REASON[report.radiusClampReason] ?? 'Promień został przycięty do możliwości siatki.'}
          </p>
        )}

        {warnings.length > 0 && (
          <ul role="alert" className="space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-[11px] text-warn">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Row({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 border-t border-line px-2 py-1">
      <span className="text-txt-dim">{label}</span>
      <span className="font-mono text-txt">{before}</span>
      <span className="font-mono text-accent">{after}</span>
    </div>
  );
}
