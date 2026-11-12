import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeViewer } from './components/ThreeViewer.tsx';
import { TopBar } from './components/TopBar.tsx';
import { StatsRail } from './components/StatsRail.tsx';
import { OptionsRail } from './components/OptionsRail.tsx';
import { StatusCard } from './components/StatusCard.tsx';
import { ViewBar } from './components/ViewBar.tsx';
import { HeroCard } from './components/HeroCard.tsx';
import { Toasts } from './components/Toasts.tsx';
import type { ToastItem } from './components/Toasts.tsx';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import {
  buildMeshFromRaw,
  exportToOBJ,
  exportToSTL,
  objectToTriangleSoup,
  roundEdges,
} from './utils/meshProcessing.ts';
import type { MeshData, MeshDiagnostics, RoundingResult } from './utils/meshProcessing.ts';
import { analyzeOverhangs, overhangAreaMm2 } from './utils/printability.ts';
import {
  DEFAULT_NOZZLE_MM,
  DEFAULT_RADIUS_MM,
  OVERHANG_ANGLE_DEG,
  PRINT_PRESETS,
  RADIUS_MAX_MM,
  fmtMm,
  minRadiusMm,
} from './utils/printParams.ts';
import type { PrintPresetId, RoundingKind } from './utils/printParams.ts';

const TOAST_TTL_MS = 9000;
const SHEET_TABS = { stats: 'Statystyki', params: 'Parametry', result: 'Wynik' } as const;
type SheetTab = keyof typeof SHEET_TABS;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [meshData, setMeshData] = useState<MeshData | null>(null);
  const [diagnostics, setDiagnostics] = useState<MeshDiagnostics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [sharpThreshold, setSharpThreshold] = useState(30);
  const [showAllEdges, setShowAllEdges] = useState(false);

  const [presetId, setPresetId] = useState<PrintPresetId>('safe');
  const [kind, setKind] = useState<RoundingKind>('fillet');
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MM);
  const [segments, setSegments] = useState(3);
  const [nozzleMm, setNozzleMm] = useState(DEFAULT_NOZZLE_MM);
  const [compareMode, setCompareMode] = useState<'before' | 'after' | 'overlay'>('after');

  const [result, setResult] = useState<RoundingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isWide = useMediaQuery('(min-width: 900px)');
  const [sheetTab, setSheetTab] = useState<SheetTab>('params');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Na szerokim ekranie panel boczny jest widoczny; na wąskim domyślnie zwinięty.
  useEffect(() => {
    setSheetOpen(isWide);
  }, [isWide]);

  // --- Powiadomienia -----------------------------------------------------------
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const toastSeen = useRef(new Set<string>());
  const loadSeq = useRef(0);

  const pushToast = useCallback((kind: 'info' | 'warn' | 'ok', text: string, force = false) => {
    if (!force && toastSeen.current.has(text)) return;
    toastSeen.current.add(text);
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastSeen.current.delete(text);
    }, TOAST_TTL_MS);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- Reguły druku ------------------------------------------------------------
  const minRadius = useMemo(() => minRadiusMm(nozzleMm), [nozzleMm]);

  // --- Wczytywanie pliku -------------------------------------------------------
  const loadMeshFromFile = useCallback((fileToLoad: File) => {
    const seq = ++loadSeq.current;
    setFile(fileToLoad);
    setMeshData(null);
    setDiagnostics(null);
    setResult(null);
    setSelectedEdges(new Set());
    setLoadError(null);

    const ext = fileToLoad.name.slice(fileToLoad.name.lastIndexOf('.')).toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => {
      if (seq !== loadSeq.current) return;
      setLoadError('Nie udało się odczytać pliku.');
    };
    reader.onload = (e) => {
      if (seq !== loadSeq.current) return;
      const buffer = e.target?.result as ArrayBuffer | undefined;
      if (!buffer) return;
      try {
        let positions: Float64Array | null = null;
        let indices: Int32Array | null = null;

        if (ext === '.stl') {
          const geometry = new STLLoader().parse(buffer);
          const posAttr = geometry.getAttribute('position');
          positions = new Float64Array(posAttr.count * 3);
          for (let i = 0; i < posAttr.count; i++) {
            positions[3 * i] = posAttr.getX(i);
            positions[3 * i + 1] = posAttr.getY(i);
            positions[3 * i + 2] = posAttr.getZ(i);
          }
          const index = geometry.getIndex();
          if (index) {
            indices = new Int32Array(index.count);
            for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
          }
        } else if (ext === '.3mf') {
          const soup = objectToTriangleSoup(new ThreeMFLoader().parse(buffer));
          if (!soup) throw new Error('Plik 3MF nie zawiera geometrii siatkowej.');
          positions = soup.positions;
          indices = soup.indices;
        } else if (ext === '.obj') {
          const text = new TextDecoder().decode(buffer);
          const soup = objectToTriangleSoup(new OBJLoader().parse(text));
          if (!soup) throw new Error('Plik OBJ nie zawiera geometrii siatkowej.');
          positions = soup.positions;
          indices = soup.indices;
        } else {
          throw new Error('Nieobsługiwany format pliku.');
        }

        if (!positions || positions.length < 9) {
          throw new Error('Plik nie zawiera poprawnej geometrii (mniej niż 3 wierzchołki).');
        }

        const built = buildMeshFromRaw(positions, indices);
        if (seq !== loadSeq.current) return;
        if (built.mesh.faceCount === 0) {
          throw new Error('Po walidacji nie pozostał żaden poprawny trójkąt.');
        }
        setMeshData(built.mesh);
        setDiagnostics(built.diagnostics);

        // Domyślnie zaznaczamy wszystkie ostre krawędzie — auto-detekcja > praca ręczna.
        const thresholdRad = (30 * Math.PI) / 180;
        const auto = new Set<number>();
        for (const edge of built.mesh.edges) {
          if (edge.faces.length === 2 && edge.normalAngle >= thresholdRad) auto.add(edge.index);
        }
        setSelectedEdges(auto);
        setSharpThreshold(30);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setLoadError((err as Error).message);
        setFile(null);
      }
    };
    reader.readAsArrayBuffer(fileToLoad);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Pozwala wczytać ten sam plik ponownie (Reset → Import tego samego pliku).
    e.target.value = '';
    if (f) loadMeshFromFile(f);
  };

  const handleImportClick = () => {
    document.getElementById('model-file-input')?.click();
  };

  const handleLoadDemo = async (path: string, name: string) => {
    const seq = ++loadSeq.current;
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Nie udało się pobrać modelu demonstracyjnego.');
      const blob = await response.blob();
      if (seq !== loadSeq.current) return;
      // loadMeshFromFile ustawi własny seq; cofamy, by nie przeskoczyć licznika.
      loadSeq.current = seq - 1;
      loadMeshFromFile(new File([blob], name, { type: 'application/octet-stream' }));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadError((err as Error).message);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    const f = dropped[0];
    const name = f.name.toLowerCase();
    if (name.endsWith('.stl') || name.endsWith('.3mf') || name.endsWith('.obj')) {
      loadMeshFromFile(f);
    } else {
      setLoadError('Obsługiwane są wyłącznie pliki STL, 3MF oraz OBJ.');
    }
  };

  // --- Selekcja krawędzi --------------------------------------------------------
  const handleToggleEdge = useCallback((edgeIndex: number) => {
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      if (next.has(edgeIndex)) next.delete(edgeIndex);
      else next.add(edgeIndex);
      return next;
    });
  }, []);

  const handleSelectSharp = useCallback(() => {
    if (!meshData) return;
    const thresholdRad = (sharpThreshold * Math.PI) / 180;
    const next = new Set<number>();
    for (const edge of meshData.edges) {
      if (edge.faces.length === 2 && edge.normalAngle >= thresholdRad) next.add(edge.index);
    }
    setSelectedEdges(next);
  }, [meshData, sharpThreshold]);

  const handleSelectAll = useCallback(() => {
    if (!meshData) return;
    const next = new Set<number>();
    for (const edge of meshData.edges) {
      if (edge.faces.length === 2 && edge.normalAngle > (5 * Math.PI) / 180) next.add(edge.index);
    }
    setSelectedEdges(next);
  }, [meshData]);

  const handleClearSelection = () => setSelectedEdges(new Set());

  const handleReset = () => {
    setFile(null);
    setMeshData(null);
    setDiagnostics(null);
    setResult(null);
    setSelectedEdges(new Set());
    setLoadError(null);
  };

  const handlePresetChange = (id: PrintPresetId) => {
    setPresetId(id);
    const preset = PRINT_PRESETS.find((p) => p.id === id);
    if (!preset || preset.radiusMm === null) return;
    setKind(preset.kind);
    setRadius(preset.radiusMm);
    setSegments(preset.segments);
  };

  const handleKindChange = (next: RoundingKind) => {
    setKind(next);
    setPresetId('custom');
  };

  const handleRadiusChange = (next: number) => {
    setRadius(next);
    setPresetId('custom');
  };

  // --- Obliczenia (odroczone, żeby UI nie blokowało się na obliczeniach) ---------
  const selectionKey = useMemo(() => {
    const arr = Array.from(selectedEdges);
    arr.sort((a, b) => a - b);
    return arr.join(',');
  }, [selectedEdges]);

  useEffect(() => {
    if (!meshData || selectedEdges.size === 0) {
      setResult(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      try {
        const edgeIndices = selectionKey.length > 0 ? selectionKey.split(',').map(Number) : [];
        const res = roundEdges(meshData, { radius, segments, kind, edgeIndices });
        setResult(res);
      } catch (err) {
        pushToast('warn', `Błąd przetwarzania: ${(err as Error).message}`, true);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 90);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshData, selectionKey, radius, segments, kind]);

  // --- Eksport -----------------------------------------------------------------
  const download = (format: 'stl' | 'obj') => {
    const mesh = result?.mesh ?? meshData;
    if (!mesh || !file) return;
    const rounded = Boolean(result && result.report.geometryChanged && !result.report.failed);
    const blob = format === 'stl' ? exportToSTL(mesh) : exportToOBJ(mesh);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const lastDot = file.name.lastIndexOf('.');
    const base = lastDot !== -1 ? file.name.slice(0, lastDot) : file.name;
    link.href = url;
    link.download = `${base}${rounded ? '_rounded' : ''}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Odroczone zwolnienie: natychmiastowe revoke potrafi przerwać pobieranie.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- Ostrzeżenia -------------------------------------------------------------
  const radiusWarning = useMemo(() => {
    if (radius >= minRadius - 1e-9) return null;
    return (
      `Promień ${fmtMm(radius)} mm jest poniżej minimum ${fmtMm(minRadius)} mm dla dyszy ` +
      `${fmtMm(nozzleMm)} mm — zwiększ promień albo zmień dyszę.`
    );
  }, [radius, minRadius, nozzleMm]);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (result) {
      list.push(...result.report.warnings);
      const effective = result.report.effectiveRadius;
      if (effective < minRadius - 1e-9) {
        list.push(
          `Promień efektywny ${fmtMm(effective, 3)} mm jest poniżej minimum ${fmtMm(minRadius)} mm dla dyszy ` +
          `${fmtMm(nozzleMm)} mm — siatka w tym miejscu jest zbyt rzadka, żeby odtworzyć łuk.`,
        );
      }
      if (result.report.measuredSurfaceError > 0.05) {
        list.push(
          `Zmierzony błąd powierzchni ${fmtMm(result.report.measuredSurfaceError, 3)} mm — ` +
          'zwiększ liczbę segmentów albo zagęść siatkę modelu.',
        );
      }
      if (result.report.bandFacetSize > 2 * result.report.effectiveRadius) {
        list.push(
          `Rozdzielczość pasa ${fmtMm(result.report.bandFacetSize)} mm jest większa niż 2 × promień — ` +
          'o gładkości łuku decyduje siatka modelu, a nie liczba segmentów.',
        );
      }
    }
    if (radiusWarning) list.push(radiusWarning);
    if (diagnostics) {
      if (!diagnostics.isClosed) {
        list.push(
          `Model nie jest domknięty (${diagnostics.boundaryEdgeCount} krawędzi brzegowych) — ` +
          'slicer może dodać niechciane ściany.',
        );
      }
      if (diagnostics.nonManifoldEdgeCount > 0) {
        list.push(`${diagnostics.nonManifoldEdgeCount} krawędzi non-manifold — zalecana naprawa przed drukiem.`);
      }
      const maxDim = Math.max(...diagnostics.size);
      if (maxDim > 0 && maxDim < 5) {
        list.push(`Największy wymiar to ${fmtMm(maxDim)} mm — sprawdź jednostki (STL ich nie przechowuje; zakładamy mm).`);
      }
      if (maxDim > 1000) {
        list.push(`Największy wymiar to ${fmtMm(maxDim, 0)} mm — to bardzo duży model; upewnij się, że jednostką są milimetry.`);
      }
    }
    return list;
  }, [result, radiusWarning, minRadius, nozzleMm, diagnostics]);

  // --- Nawisy ------------------------------------------------------------------
  // Nawisy po zaokrągleniu mogą się zmienić — liczymy na aktualnej siatce.
  const overhangSource = result?.mesh ?? meshData;
  const overhangs = useMemo(
    () => (overhangSource ? analyzeOverhangs(overhangSource, OVERHANG_ANGLE_DEG) : []),
    [overhangSource],
  );
  const overhangArea = useMemo(
    () => (overhangSource ? overhangAreaMm2(overhangSource, OVERHANG_ANGLE_DEG) : 0),
    [overhangSource],
  );

  // --- Komunikaty --------------------------------------------------------------
  useEffect(() => {
    if (file && diagnostics) {
      pushToast(
        'ok',
        `Wczytano ${file.name}: ${diagnostics.faceCount.toLocaleString()} trójkątów, ` +
          `${diagnostics.size.map((v) => v.toFixed(1)).join(' × ')} mm.`,
      );
    }
  }, [file, diagnostics, pushToast]);

  useEffect(() => {
    if (!result) return;
    const report = result.report;
    if (report.failed) {
      pushToast('warn', 'Zaokrąglanie nie powiodło się — model pozostał bez zmian.');
      return;
    }
    pushToast(
      'ok',
      `Zaokrąglono ${report.edgesRounded} z ${report.selectedEdgeCount} krawędzi — ` +
        `${report.trianglesBefore.toLocaleString()} → ${report.trianglesAfter.toLocaleString()} trójkątów.`,
    );
  }, [result, pushToast]);

  useEffect(() => {
    if (loadError) pushToast('warn', loadError);
  }, [loadError, pushToast]);

  // --- Widok -------------------------------------------------------------------
  const shownMesh: MeshData | null = useMemo(() => {
    if (!meshData) return null;
    if (!result) return meshData;
    return compareMode === 'before' ? meshData : result.mesh;
  }, [meshData, result, compareMode]);

  const overlayMesh: MeshData | null = useMemo(() => {
    if (!meshData || !result) return null;
    return compareMode === 'overlay' ? meshData : null;
  }, [meshData, result, compareMode]);

  const sharpEdgeCount = useMemo(() => {
    if (!meshData) return 0;
    const rad = (sharpThreshold * Math.PI) / 180;
    return meshData.edges.filter((e) => e.faces.length === 2 && e.normalAngle >= rad).length;
  }, [meshData, sharpThreshold]);

  const exportBlocked = Boolean(result?.report.failed);
  const exportBlockedReason = 'Nie udało się zaokrąglić krawędzi — plik do pobrania to niezmieniony oryginał.';

  const edgeProps = {
    sharpThresholdDeg: sharpThreshold,
    onSharpThresholdChange: setSharpThreshold,
    sharpEdgeCount,
    selectedCount: selectedEdges.size,
    onSelectSharp: handleSelectSharp,
    onSelectAll: handleSelectAll,
    onClear: handleClearSelection,
    showAllEdges,
    onShowAllEdgesChange: setShowAllEdges,
  };

  const paramsProps = {
    kind,
    onKindChange: handleKindChange,
    segments,
    onSegmentsChange: (value: number) => {
      setSegments(value);
      setPresetId('custom');
    },
    presetId,
    onPresetChange: handlePresetChange,
    nozzleMm,
    busy,
  };

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-surface-base text-txt"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="model-file-input"
        accept=".stl,.3mf,.obj"
        className="hidden"
        onChange={handleFileChange}
      />

      <div id="viewport" className="absolute inset-0 z-0 bg-surface-viewport">
        {meshData && (
          <ThreeViewer
            baseMesh={meshData}
            shownMesh={shownMesh}
            overlayMesh={overlayMesh}
            selectedEdges={selectedEdges}
            hoveredEdge={hoveredEdge}
            onToggleEdge={handleToggleEdge}
            onHoverEdge={setHoveredEdge}
            sharpThreshold={sharpThreshold}
            showAllEdges={showAllEdges}
          />
        )}
        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-10 rounded-panel border-2 border-dashed border-accent/60" />
        )}
      </div>

      <TopBar
        fileName={file?.name ?? null}
        nozzleMm={nozzleMm}
        onNozzleChange={setNozzleMm}
        radiusMm={radius}
        radiusKind={kind}
        radiusMinMm={minRadius}
        radiusMaxMm={RADIUS_MAX_MM}
        onRadiusChange={handleRadiusChange}
        radiusWarning={radiusWarning}
        onImportClick={handleImportClick}
        onExportStl={() => download('stl')}
        onExportObj={() => download('obj')}
        onReset={handleReset}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        exportBlocked={exportBlocked}
        exportBlockedReason={exportBlockedReason}
      />

      {isWide ? (
        <>
          <div
            id="left-rail"
            className="pointer-events-none absolute bottom-[14px] left-[14px] top-[52px] z-30 flex w-[272px] flex-col gap-3 overflow-y-auto"
          >
            <StatsRail file={file} diagnostics={diagnostics} />
          </div>
          <div
            id="right-rail"
            className="pointer-events-none absolute bottom-[40px] right-[14px] top-[52px] z-30 flex w-[264px] flex-col gap-3 overflow-y-auto"
          >
            <OptionsRail
              edge={edgeProps}
              params={paramsProps}
              overhangCount={overhangs.length}
              overhangAreaMm2={overhangArea}
            />
            <StatusCard
              diagnostics={diagnostics}
              result={result}
              warnings={warnings}
              className="mt-auto"
            />
          </div>
        </>
      ) : (
        <div
          id="sheet"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-panel border-t border-line bg-surface-panel/95 backdrop-blur-md"
        >
          <div className="pointer-events-auto flex items-center gap-1 border-b border-line px-2 py-1.5">
            {(Object.keys(SHEET_TABS) as SheetTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={sheetTab === tab}
                onClick={() => {
                  setSheetTab(tab);
                  setSheetOpen(true);
                }}
                className={`rounded-md px-2 py-1 text-[12px] transition-colors duration-150 ${
                  sheetTab === tab ? 'bg-surface-raised text-txt' : 'text-txt-dim'
                }`}
              >
                {SHEET_TABS[tab]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSheetOpen((open) => !open)}
              aria-label={sheetOpen ? 'Zamknij panel' : 'Otwórz panel'}
              className="ml-auto rounded px-2 py-1 text-[12px] text-txt-dim hover:text-txt"
            >
              {sheetOpen ? 'Zamknij' : 'Otwórz'}
            </button>
          </div>
          {sheetOpen && (
            <div className="pointer-events-auto overflow-y-auto p-2">
              {sheetTab === 'stats' && <StatsRail file={file} diagnostics={diagnostics} />}
              {sheetTab === 'params' && (
                <OptionsRail
                  edge={edgeProps}
                  params={paramsProps}
                  overhangCount={overhangs.length}
                  overhangAreaMm2={overhangArea}
                />
              )}
              {sheetTab === 'result' && (
                <StatusCard diagnostics={diagnostics} result={result} warnings={warnings} />
              )}
            </div>
          )}
        </div>
      )}

      <ViewBar
        selectedCount={selectedEdges.size}
        hoveredEdge={hoveredEdge}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        hasResult={Boolean(result)}
        showHint={isWide}
        className={isWide ? undefined : 'bottom-[72px]'}
      />

      {!file && <HeroCard onLoadDemo={handleLoadDemo} />}

      <Toasts toasts={toasts} onDismiss={dismissToast} className={isWide ? undefined : 'bottom-[104px]'} />
    </div>
  );
}
