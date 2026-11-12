import type { MeshDiagnostics } from '../utils/meshProcessing.ts';
import { Card } from './ui/Card.tsx';
import { DiagRow } from './ui/DiagRow.tsx';

export interface StatsRailProps {
  file: File | null;
  diagnostics: MeshDiagnostics | null;
}

/** Lewa szyna: dane wczytanego pliku i diagnostyka druku. */
export function StatsRail({ file, diagnostics }: StatsRailProps) {
  return (
    <div className="flex flex-col gap-3">
      <Card title="Plik" badge={diagnostics ? (diagnostics.isClosed ? 'zamknięty' : 'otwarty') : undefined}>
        {file && diagnostics ? (
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] text-txt-dim">
            <dt>Trójkąty</dt>
            <dd className="text-right text-txt">{diagnostics.faceCount.toLocaleString()}</dd>
            <dt>Wierzchołki</dt>
            <dd className="text-right text-txt">{diagnostics.vertexCount.toLocaleString()}</dd>
            <dt>Objętość</dt>
            <dd className="text-right text-txt">{(diagnostics.volume / 1000).toFixed(2)} cm³</dd>
            <dt>Pole</dt>
            <dd className="text-right text-txt">{(diagnostics.surfaceArea / 100).toFixed(1)} cm²</dd>
            <dt className="col-span-2">Wymiary</dt>
            <dd className="col-span-2 text-right text-txt">{diagnostics.size.map((v) => v.toFixed(1)).join(' × ')} mm</dd>
            {diagnostics.weldedVertexCount > 0 && (
              <>
                <dt className="col-span-2">Scalone duplikaty</dt>
                <dd className="col-span-2 text-right text-txt">{diagnostics.weldedVertexCount.toLocaleString()}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-[11px] text-txt-dim">Brak wczytanego pliku.</p>
        )}
      </Card>

      <Card title="Diagnostyka druku">
        {diagnostics ? (
          <div className="space-y-1.5">
            <DiagRow
              label="Bryła zamknięta"
              ok={diagnostics.isClosed}
              detail={diagnostics.isClosed ? 'tak' : `${diagnostics.boundaryEdgeCount} kraw. brzegowych`}
              tip="Watertight: każda krawędź ma dokładnie 2 ściany. Taki model tnie się bez niespodzianek."
            />
            <DiagRow
              label="Krawędzie non-manifold"
              ok={diagnostics.nonManifoldEdgeCount === 0}
              detail={diagnostics.nonManifoldEdgeCount === 0 ? 'brak' : `${diagnostics.nonManifoldEdgeCount} szt.`}
              tip="Krawędź, przy której schodzą się więcej niż 2 ściany. Slicer może zgadywać — zalecana naprawa."
            />
            <DiagRow
              label="Orientacja ścian"
              ok={diagnostics.inconsistentWindingCount === 0}
              detail={diagnostics.inconsistentWindingCount === 0 ? 'spójna' : `${diagnostics.inconsistentWindingCount} kraw.`}
              tip="Wszystkie normalne skierowane na zewnątrz. Niespójność odwraca wnętrze/zewnętrze modelu."
            />
            <DiagRow
              label="Liczba części"
              ok
              detail={`${diagnostics.connectedComponents}`}
              tip="Ile osobnych, niepołączonych brył zawiera plik. To nie jest błąd — wiele modeli ma kilka części."
            />
          </div>
        ) : (
          <p className="text-[11px] text-txt-dim">Diagnostyka pojawi się po wczytaniu pliku.</p>
        )}
      </Card>
    </div>
  );
}
