import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  Upload, Info, Settings, Shield, Sparkles, Zap,
  ChevronRight, Download, RefreshCw,
  AlertTriangle, Trash2, HelpCircle, Sliders, Check,
  Sun, Moon,
} from 'lucide-react';
import { ThreeViewer } from './components/ThreeViewer.tsx';
import {
  buildMeshFromRaw,
  exportToOBJ,
  exportToSTL,
  objectToTriangleSoup,
  roundEdges,
} from './utils/meshProcessing.ts';
import type { MeshData, MeshDiagnostics, RoundingResult } from './utils/meshProcessing.ts';

type PresetType = 'safe' | 'strong' | 'chamfer' | 'custom';

interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'ok';
  text: string;
}

const TOAST_TTL_MS = 9000;

/** Zalecenia z researchu (FDM, dysza 0.4 mm). */
const NOZZLE_MM = 0.4;
const MIN_VISIBLE_RADIUS_MM = 0.3;
const PRINT_TOLERANCE_MM = 0.1;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [meshData, setMeshData] = useState<MeshData | null>(null);
  const [diagnostics, setDiagnostics] = useState<MeshDiagnostics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [sharpThreshold, setSharpThreshold] = useState(30);
  const [showAllEdges, setShowAllEdges] = useState(false);

  const [preset, setPreset] = useState<PresetType>('safe');
  const [roundingType, setRoundingType] = useState<'fillet' | 'chamfer'>('fillet');
  const [radius, setRadius] = useState(0.4);
  const [segments, setSegments] = useState(3);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [compareMode, setCompareMode] = useState<'before' | 'after' | 'overlay'>('after');

  const [result, setResult] = useState<RoundingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // --- Powiadomienia (toasty) --------------------------------------------------
  // Cała "logistyka" (ostrzeżenia diagnostyki, ostrzeżenia zaokrąglania, wskazówki
  // druku, błędy wczytywania) ląduje tutaj, a nie w panelu po lewej stronie.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const toastSeen = useRef(new Set<string>());

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    if (toastSeen.current.has(text)) return;
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

  // --- Presety -----------------------------------------------------------------
  useEffect(() => {
    if (preset === 'safe') { setRoundingType('fillet'); setRadius(0.4); setSegments(3); }
    else if (preset === 'strong') { setRoundingType('fillet'); setRadius(1.0); setSegments(5); }
    else if (preset === 'chamfer') { setRoundingType('chamfer'); setRadius(0.6); setSegments(1); }
  }, [preset]);

  // --- Wczytywanie pliku -------------------------------------------------------
  const loadMeshFromFile = useCallback((fileToLoad: File) => {
    setFile(fileToLoad);
    setMeshData(null);
    setDiagnostics(null);
    setResult(null);
    setSelectedEdges(new Set());
    setLoadError(null);

    const ext = fileToLoad.name.slice(fileToLoad.name.lastIndexOf('.')).toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => setLoadError('Nie udało się odczytać pliku.');
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer | undefined;
      if (!buffer) return;
      try {
        let positions: Float64Array | null = null;
        let indices: Int32Array | null = null;

        if (ext === '.stl') {
          const geometry = new STLLoader().parse(buffer);
          indices = null;
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
          const group = new ThreeMFLoader().parse(buffer);
          const soup = objectToTriangleSoup(group);
          if (!soup) throw new Error('Plik 3MF nie zawiera geometrii siatkowej.');
          positions = soup.positions;
          indices = soup.indices;
        } else if (ext === '.obj') {
          const text = new TextDecoder().decode(buffer);
          const group = new OBJLoader().parse(text);
          const soup = objectToTriangleSoup(group);
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
        if (built.mesh.faceCount === 0) {
          throw new Error('Po walidacji nie pozostał żaden poprawny trójkąt.');
        }
        setMeshData(built.mesh);
        setDiagnostics(built.diagnostics);

        // Domyślnie zaznaczamy wszystkie ostre krawędzie — zgodnie z zasadą
        // "auto-detekcja > praca ręczna".
        const thresholdRad = (30 * Math.PI) / 180;
        const auto = new Set<number>();
        for (const edge of built.mesh.edges) {
          if (edge.faces.length === 2 && edge.normalAngle >= thresholdRad) auto.add(edge.index);
        }
        setSelectedEdges(auto);
        setSharpThreshold(30);
      } catch (err) {
        setLoadError((err as Error).message);
        setFile(null);
      }
    };
    reader.readAsArrayBuffer(fileToLoad);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) loadMeshFromFile(e.target.files[0]);
  };

  const handleLoadDemo = async (path: string, name: string) => {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Nie udało się pobrać modelu demonstracyjnego.');
      const blob = await response.blob();
      loadMeshFromFile(new File([blob], name, { type: 'application/octet-stream' }));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
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

  // --- Selekcja ----------------------------------------------------------------
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

  // --- Obliczenia (z odroczeniem, aby nie blokować UI) ------------------------
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
    // Dwa etapy: najpierw pozwalamy przeglądarce odmalować stan "przetwarzanie",
    // potem uruchamiamy synchroniczne obliczenia.
    const timer = setTimeout(() => {
      try {
        const edgeIndices = selectionKey.length > 0 ? selectionKey.split(',').map(Number) : [];
        const res = roundEdges(meshData, {
          radius,
          segments,
          kind: roundingType,
          edgeIndices,
        });
        setResult(res);
      } catch (err) {
        setLoadError(`Błąd przetwarzania: ${(err as Error).message}`);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 90);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshData, selectionKey, radius, segments, roundingType]);

  // --- Eksport -----------------------------------------------------------------
  const download = (kind: 'stl' | 'obj') => {
    const mesh = result?.mesh ?? meshData;
    if (!mesh || !file) return;
    const blob = kind === 'stl' ? exportToSTL(mesh) : exportToOBJ(mesh);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const lastDot = file.name.lastIndexOf('.');
    const base = lastDot !== -1 ? file.name.slice(0, lastDot) : file.name;
    link.href = url;
    link.download = `${base}_rounded.${kind}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- Wskazówki druku (na podstawie parametrów druku FDM) ---------------------
  const printHints = useMemo(() => {
    const hints: Array<{ level: 'info' | 'warn'; text: string }> = [];
    const r = result?.report.effectiveRadius ?? radius;
    if (roundingType === 'fillet' && r < MIN_VISIBLE_RADIUS_MM) {
      hints.push({
        level: 'warn',
        text: `Promień ${r.toFixed(2)} mm jest mniejszy niż ${MIN_VISIBLE_RADIUS_MM} mm — w druku FDM z dyszą ${NOZZLE_MM} mm będzie praktycznie niewidoczny.`,
      });
    } else if (roundingType === 'fillet' && r < NOZZLE_MM) {
      hints.push({
        level: 'info',
        text: `Promień ${r.toFixed(2)} mm jest mniejszy niż średnica dyszy (${NOZZLE_MM} mm) — efekt będzie subtelny.`,
      });
    }
    // Gdy siatka nie rozdziela łuku, rada "zwiększ segmenty" byłaby myląca —
    // ten przypadek opisuje ostrzeżenie w raporcie (bandFacetSize > 2r).
    if (
      result &&
      result.report.chordDeviation > 0.05 &&
      result.report.bandFacetSize <= 2 * result.report.effectiveRadius
    ) {
      hints.push({
        level: 'warn',
        text: `Teoretyczna odchyłka łuku ${result.report.chordDeviation.toFixed(3)} mm — zwiększ liczbę segmentów.`,
      });
    }
    if (diagnostics) {
      if (!diagnostics.isClosed) {
        hints.push({ level: 'warn', text: `Model nie jest domknięty (${diagnostics.boundaryEdgeCount} krawędzi brzegowych) — slicer może dodać niechciane ściany.` });
      }
      if (diagnostics.nonManifoldEdgeCount > 0) {
        hints.push({ level: 'warn', text: `${diagnostics.nonManifoldEdgeCount} krawędzi nie-rozmaitości — zalecana naprawa przed drukiem.` });
      }
      const maxDim = Math.max(...diagnostics.size);
      if (maxDim > 0 && maxDim < 5) {
        hints.push({ level: 'warn', text: `Największy wymiar to ${maxDim.toFixed(2)} mm — sprawdź jednostki (STL ich nie przechowuje; zakładamy mm).` });
      }
      if (maxDim > 1000) {
        hints.push({ level: 'warn', text: `Największy wymiar to ${maxDim.toFixed(0)} mm — to bardzo duży model; upewnij się, że jednostką są milimetry.` });
      }
    }
    return hints;
  }, [result, radius, roundingType, diagnostics]);

  // Ostrzeżenia i wskazówki trafiają do powiadomień, nie do panelu.
  useEffect(() => {
    if (!diagnostics) return;
    for (const w of diagnostics.warnings) pushToast('warn', w);
  }, [diagnostics, pushToast]);

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
    for (const w of result.report.warnings) pushToast('warn', w);
    pushToast(
      'ok',
      `Zaokrąglono ${result.report.processedEdgeCount} z ${result.report.selectedEdgeCount} krawędzi — ` +
      `${result.report.trianglesBefore.toLocaleString()} → ${result.report.trianglesAfter.toLocaleString()} trójkątów.`,
    );
  }, [result, pushToast]);

  useEffect(() => {
    for (const h of printHints) pushToast(h.level === 'warn' ? 'warn' : 'info', h.text);
  }, [printHints, pushToast]);

  useEffect(() => {
    if (loadError) pushToast('warn', loadError);
  }, [loadError, pushToast]);

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

  const afterSize = result
    ? [
        result.mesh.bboxMax[0] - result.mesh.bboxMin[0],
        result.mesh.bboxMax[1] - result.mesh.bboxMin[1],
        result.mesh.bboxMax[2] - result.mesh.bboxMin[2],
      ]
    : null;

  return (
    <div className={`h-screen overflow-hidden flex flex-col font-sans relative transition-colors duration-300 ${
      theme === 'dark' ? 'bg-[#0a0a0f] text-[#e8e8ed]' : 'bg-[#f8fafc] text-slate-800'
    }`}>
      {theme === 'dark' && (
        <>
          <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-accent-teal/5 blur-[150px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-accent-purple/5 blur-[150px] pointer-events-none" />
        </>
      )}

      {/* Nagłówek */}
      <header className={`border-b px-6 py-4 flex items-center justify-between z-10 transition-colors duration-300 ${
        theme === 'dark'
          ? 'border-white/5 bg-[#12121e]/50 backdrop-blur-md'
          : 'border-slate-200 bg-white/70 backdrop-blur-md shadow-sm'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-teal to-accent-purple flex items-center justify-center font-bold text-bg-dark shadow-glow-teal text-lg">
            R
          </div>
          <div>
            <h1 className={`font-extrabold tracking-tight text-xl ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-accent-teal to-white bg-clip-text text-transparent'
                : 'text-slate-800'
            }`}>
              RoundEdge
            </h1>
            <p className={`text-[10px] tracking-wider uppercase font-mono ${
              theme === 'dark' ? 'text-white/40' : 'text-slate-400'
            }`}>
              Bezpieczne zaokrąglanie krawędzi 3D v2.0
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 text-xs font-mono">
            <div className={`px-2 py-1 rounded ${!file ? 'text-accent-teal font-semibold bg-white/5' : theme === 'dark' ? 'text-white/40' : 'text-slate-400'}`}>
              1. Wczytanie modelu
            </div>
            <ChevronRight className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-white/20' : 'text-slate-300'}`} />
            <div className={`px-2 py-1 rounded ${file ? 'text-accent-teal font-semibold bg-white/5' : theme === 'dark' ? 'text-white/40' : 'text-slate-400'}`}>
              2. Krawędzie i podgląd
            </div>
          </div>
          <button
            onClick={() => setTheme((p) => (p === 'dark' ? 'light' : 'dark'))}
            className={`p-2 rounded-lg border transition-all duration-200 hover:scale-105 ${
              theme === 'dark'
                ? 'border-white/10 text-white/70 hover:text-white hover:bg-white/5'
                : 'border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-sm'
            }`}
            title={theme === 'dark' ? 'Przełącz na tryb jasny' : 'Przełącz na tryb ciemny'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-accent-teal" /> : <Moon className="w-4 h-4 text-[#7c5cff]" />}
          </button>
        </div>
      </header>

      <main className={`flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative transition-colors duration-300 ${
        theme === 'dark' ? 'bg-[#06060a]' : 'bg-[#f1f5f9]'
      }`}>
        {/* Panel sterowania — przewija się TYLKO on; strona nigdy, więc kółko myszy
            nad podglądem zawsze zoomuje model, a nie przesuwa widok. */}
        <section className={`w-full md:w-[25rem] min-h-0 flex flex-col overflow-hidden z-10 transition-colors duration-300 border-r ${
          theme === 'dark'
            ? 'bg-[#12121e]/60 backdrop-blur-lg border-white/5'
            : 'bg-white/85 backdrop-blur-lg border-slate-200 shadow-sm'
        }`}>
          {!file && (
            <div className="p-6 flex-1 flex flex-col justify-center overflow-y-auto">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Rozpocznij tutaj</h2>
                <p className="text-sm theme-text-muted">
                  Wgraj model 3D (STL / OBJ / 3MF), zaznacz krawędzie i pobierz wersję gotową do druku.
                </p>
              </div>

              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                  isDragging
                    ? 'border-accent-teal bg-accent-teal/5 shadow-glow-teal'
                    : theme === 'dark'
                      ? 'border-white/10 hover:border-white/20'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-100/30'
                }`}
              >
                <input type="file" id="stl-upload" accept=".stl,.3mf,.obj" className="hidden" onChange={handleFileChange} />
                <label htmlFor="stl-upload" className="flex flex-col items-center cursor-pointer">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 hover:scale-105 transition-transform duration-200">
                    <Upload className="w-8 h-8 text-accent-teal" />
                  </div>
                  <span className="font-semibold text-sm mb-1 theme-text-primary">Przeciągnij plik 3D</span>
                  <span className="text-xs theme-text-muted mb-3">obsługiwane: STL, 3MF, OBJ</span>
                  <div className={`px-3 py-1 border rounded-full text-[10px] font-mono ${
                    theme === 'dark' ? 'bg-white/5 border-white/10 text-white/60' : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}>
                    Wszystkie obliczenia lokalnie w przeglądarce
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-col items-center w-full">
                <span className="text-xs theme-text-muted mb-2">lub wczytaj model demo</span>
                <div className="flex gap-2">
                  <Tip text="Kostka 20 mm — model kontrolny: po zaokrągleniu r = 0.4 mm wymiary muszą zostać dokładnie 20 × 20 × 20 mm." side="bottom">
                    <button
                      onClick={() => handleLoadDemo('/cube.stl', 'cube.stl')}
                      className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-accent-teal hover:bg-white/10 transition-all flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Kostka 20 mm
                    </button>
                  </Tip>
                  <Tip text="Skan prania (260 trójkątów) — brudna, rzadka siatka z 2 krawędziami non-manifold. Służy do sprawdzenia, że aplikacja nie psuje trudnych modeli." side="bottom">
                    <button
                      onClick={() => handleLoadDemo('/pranie.stl', 'pranie.stl')}
                      className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-accent-teal hover:bg-white/10 transition-all flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Pranie (trudny)
                    </button>
                  </Tip>
                </div>
              </div>
            </div>
          )}

          {file && diagnostics && (
            <div className="p-5 space-y-5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {/* Podsumowanie pliku */}
              <div className="theme-bg-panel rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-xs truncate" title={file.name}>{file.name}</span>
                  <span className="text-[10px] theme-text-muted font-mono flex-shrink-0">
                    {diagnostics.isClosed ? 'watertight' : 'otwarty'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono theme-text-muted">
                  <div>Trójkąty: <strong className="theme-text-primary">{diagnostics.faceCount.toLocaleString()}</strong></div>
                  <div>Wierzchołki: <strong className="theme-text-primary">{diagnostics.vertexCount.toLocaleString()}</strong></div>
                  <div>Objętość: <strong className="theme-text-primary">{(diagnostics.volume / 1000).toFixed(2)} cm³</strong></div>
                  <div>Pole: <strong className="theme-text-primary">{(diagnostics.surfaceArea / 100).toFixed(1)} cm²</strong></div>
                  <div className="col-span-2">
                    Wymiary: <strong className="theme-text-primary">
                      {diagnostics.size.map((v) => v.toFixed(1)).join(' × ')} mm
                    </strong>
                  </div>
                  {diagnostics.weldedVertexCount > 0 && (
                    <div className="col-span-2">
                      Scalono: <strong className="theme-text-primary">{diagnostics.weldedVertexCount.toLocaleString()}</strong> duplikatów wierzchołków
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostyka druku — tylko to, co wpływa na decyzję o druku */}
              <div className="space-y-2">
                <h3 className="text-xs font-mono theme-text-muted uppercase tracking-wider">Diagnostyka druku 3D</h3>
                <div className="theme-bg-panel rounded-xl p-3 space-y-1.5 text-[11px]">
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
                    tip="Krawędź, przy której schodzą się więcej niż 2 ściany. Slicer może w tym miejscu zgadywać — zalecana naprawa."
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
                    tip="Ile osobnych, niepołączonych brył zawiera plik. To nie jest błąd — wiele modeli składa się z kilku części."
                  />
                </div>
              </div>

              {/* Selekcja krawędzi */}
              <div className="space-y-3 pt-2 border-t theme-border">
                <h3 className="text-xs font-mono theme-text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <span>1. Selekcja krawędzi</span>
                  <TipIcon text="Klikaj krawędzie bezpośrednio na modelu (Shift = dodaj do zaznaczenia). Zaznaczone krawędzie zostaną zaokrąglone, reszta modelu pozostaje nietknięta." />
                </h3>

                <div className="space-y-2">
                  <label className="flex items-center justify-between text-xs theme-text-secondary">
                    <span className="flex items-center gap-1">
                      Próg kąta ostrego
                      <TipIcon text="Krawędzie o kącie dwuściennym większym niż ten próg są uznawane za ostre. 30° to dobry kompromis dla druku FDM — łagodniejsze krawędzie i tak wyglądają na gładkie." />
                    </span>
                    <span className="font-mono text-accent-purple">{sharpThreshold}° ({sharpEdgeCount} kraw.)</span>
                  </label>
                  <input
                    type="range" min="5" max="90" step="5"
                    value={sharpThreshold}
                    onChange={(e) => setSharpThreshold(parseInt(e.target.value))}
                    className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}
                    aria-label="Próg kąta ostrego"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Tip text="Zaznacza wszystkie krawędzie ostrzejsze niż próg ustawiony powyżej.">
                    <button
                      onClick={handleSelectSharp}
                      className="py-2 px-3 bg-accent-purple/10 border border-accent-purple/30 rounded-lg text-xs font-semibold text-accent-purple hover:bg-accent-purple/20 transition-all flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Ostre krawędzie
                    </button>
                  </Tip>
                  <Tip text="Zaznacza wszystkie krawędzie siatki (oprócz płaskich i brzegowych). Uwaga: na rzadkiej siatce to setki krawędzi i dużo trójkątów w wyniku.">
                    <button
                      onClick={handleSelectAll}
                      className="py-2 px-3 bg-accent-teal/10 border border-accent-teal/30 rounded-lg text-xs font-semibold text-accent-teal hover:bg-accent-teal/20 transition-all flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Wszystkie
                    </button>
                  </Tip>
                  <div className="col-span-2">
                    <Tip text="Usuwa całe zaznaczenie. Model w podglądzie wraca do stanu oryginalnego.">
                      <button
                        onClick={handleClearSelection}
                        disabled={selectedEdges.size === 0}
                        className="w-full py-2 px-3 theme-preset-btn border rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-accent-orange" />
                        Wyczyść zaznaczenie ({selectedEdges.size})
                      </button>
                    </Tip>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs theme-text-secondary pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllEdges}
                    onChange={(e) => setShowAllEdges(e.target.checked)}
                    className="rounded text-accent-teal focus:ring-0 w-3.5 h-3.5"
                  />
                  Pokaż wszystkie krawędzie siatki
                  <TipIcon text="Rysuje siatkę krawędzi całego modelu — pomaga zorientować się w topologii. Przy bardzo gęstych modelach rysowanie jest ograniczane do 60 000 linii." />
                </label>
              </div>

              {/* Parametry */}
              <div className="space-y-4 pt-2 border-t theme-border">
                <h3 className="text-xs font-mono theme-text-muted uppercase tracking-wider flex items-center justify-between">
                  <span>2. Parametry zaokrąglenia</span>
                  <Sliders className="w-3.5 h-3.5 theme-text-muted opacity-50" />
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  <PresetButton active={preset === 'safe'} onClick={() => setPreset('safe')} icon={<Shield className="w-3.5 h-3.5" />} title="Bezpieczne" subtitle="Fillet 0.4 mm" tip="Jedna średnica dyszy (0.4 mm). Zalecany start: subtelne, wyraźnie widoczne złagodzenie krawędzi bez ryzyka dla detalu." />
                  <PresetButton active={preset === 'strong'} onClick={() => setPreset('strong')} icon={<Sparkles className="w-3.5 h-3.5" />} title="Wytrzymałe" subtitle="Fillet 1.0 mm" tip="Większy promień = mniejsza koncentracja naprężeń w narożnikach. Najlepszy stosunek wytrzymałości do zużycia materiału." />
                  <PresetButton active={preset === 'chamfer'} onClick={() => setPreset('chamfer')} icon={<Zap className="w-3.5 h-3.5" />} title="Ścięcie 45°" subtitle="Chamfer 0.6 mm" tip="Płaskie ścięcie zamiast łuku. Wybierz, gdy potrzebujesz przewidywalnego rowka (np. pod podpory albo przy krawędzi opierającej się o stół)." />
                  <PresetButton active={preset === 'custom'} onClick={() => setPreset('custom')} icon={<Settings className="w-3.5 h-3.5" />} title="Własne" subtitle="Dowolne wartości" tip="Pełna kontrola: promień 0.1–5 mm, typ (fillet/chamfer) i liczba segmentów łuku." />
                </div>

                <div className="space-y-3 p-3 theme-bg-panel rounded-xl">
                  <div className="flex gap-2">
                    <Tip text="Fillet: wypukły łuk okręgu styczny do obu ścian. Materiał jest zdejmowany z narożnika.">
                      <button
                        onClick={() => { setRoundingType('fillet'); setPreset('custom'); }}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all ${
                          roundingType === 'fillet'
                            ? theme === 'dark' ? 'bg-white/10 border-white/20 text-white' : 'bg-slate-200 border-slate-300 text-slate-800'
                            : 'bg-transparent border-transparent theme-text-muted'
                        }`}
                      >
                        ○ Zaokrąglenie (fillet)
                      </button>
                    </Tip>
                    <Tip text="Chamfer: płaska ściana pod 45°. Efekt jest ostrzejszy wizualnie, ale łatwiejszy do wydrukowania przy krawędziach stykających się z podporami.">
                      <button
                        onClick={() => { setRoundingType('chamfer'); setPreset('custom'); }}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all ${
                          roundingType === 'chamfer'
                            ? theme === 'dark' ? 'bg-white/10 border-white/20 text-white' : 'bg-slate-200 border-slate-300 text-slate-800'
                            : 'bg-transparent border-transparent theme-text-muted'
                        }`}
                      >
                        ▱ Ścięcie (chamfer)
                      </button>
                    </Tip>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs theme-text-secondary">
                      <span className="flex items-center gap-1">
                        {roundingType === 'fillet' ? 'Promień zaokrąglenia' : 'Szerokość ścięcia'}
                        <TipIcon text={`Dla druku FDM zalecane 0.4–2 mm przy dyszy ${NOZZLE_MM} mm. Poniżej ${MIN_VISIBLE_RADIUS_MM} mm zaokrąglenie zniknie w wydruku, a powyżej 2 mm detal może stracić czytelność.`} />
                      </span>
                      <span className="font-mono text-accent-teal">{radius.toFixed(2)} mm</span>
                    </div>
                    <input
                      type="range" min="0.1" max="5" step="0.05"
                      value={radius}
                      onChange={(e) => { setRadius(parseFloat(e.target.value)); setPreset('custom'); }}
                      className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}
                      aria-label="Promień zaokrąglenia"
                    />
                  </div>

                  {roundingType === 'fillet' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs theme-text-secondary">
                        <span className="flex items-center gap-1">
                          Gładkość (segmenty łuku)
                          <TipIcon text="Ile prostych odcinków tworzy łuk. Nie zmienia promienia, tylko gładkość powierzchni i liczbę trójkątów. 3 segmenty wystarczają dla r ≤ 1 mm, 5–8 dla większych promieni." />
                        </span>
                        <span className="font-mono text-accent-teal">{segments}</span>
                      </div>
                      <input
                        type="range" min="1" max="12" step="1"
                        value={segments}
                        onChange={(e) => { setSegments(parseInt(e.target.value)); setPreset('custom'); }}
                        className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}
                        aria-label="Liczba segmentów łuku"
                      />
                    </div>
                  )}
                </div>

                {busy && (
                  <div className="bg-accent-teal/5 border border-accent-teal/20 rounded-xl p-3 text-xs text-accent-teal flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Przeliczanie zaokrąglenia…
                  </div>
                )}
              </div>

              {/* Wynik */}
              {result && (
                <div className="space-y-3 pt-2 border-t theme-border">
                  <h3 className="text-xs font-mono theme-text-muted uppercase tracking-wider">3. Wynik i weryfikacja</h3>
                  <div className="border theme-border rounded-lg overflow-hidden text-[11px] font-mono">
                    <div className="grid grid-cols-3 theme-table-header p-1.5 font-bold theme-text-muted uppercase tracking-wider">
                      <span>Metryka</span><span>Przed</span><span>Po</span>
                    </div>
                    <Row label="Trójkąty" before={diagnostics.faceCount.toLocaleString()} after={result.report.trianglesAfter.toLocaleString()} />
                    <Row label="Objętość [cm³]" before={(diagnostics.volume / 1000).toFixed(2)} after={(result.report.volumeAfter / 1000).toFixed(2)} />
                    <Row label="Pole [cm²]" before={(diagnostics.surfaceArea / 100).toFixed(1)} after={(surfaceAreaOf(result.mesh) / 100).toFixed(1)} />
                    {afterSize && (
                      <Row
                        label="Gabaryt [mm]"
                        before={diagnostics.size.map((v) => v.toFixed(1)).join('×')}
                        after={afterSize.map((v) => v.toFixed(1)).join('×')}
                      />
                    )}
                    <Row label="Zaokrąglone krawędzie" before="—" after={`${result.report.processedEdgeCount} / ${result.report.selectedEdgeCount}`} tip="Ile z zaznaczonych krawędzi faktycznie zaokrąglono. Pomijane są krawędzie płaskie (poniżej progu kąta) oraz brzegowe i nie-manifold." />
                    <Row label="Promień efektywny" before="—" after={`${result.report.effectiveRadius.toFixed(3)} mm`} tip="Promień po przycięciu do lokalnej skali siatki. Jeśli jest mniejszy od zadanego, w modelu są bardzo krótkie krawędzie, które nie pomieszczą większego łuku." />
                    <Row label="Maks. przesunięcie" before="—" after={`${result.report.maxDisplacement.toFixed(3)} mm`} tip="Największe przesunięcie pojedynczego wierzchołka. Twarda gwarancja: nigdy nie przekracza promienia." />
                    <Row label="Odchyłka łuku (teoret.)" before="—" after={`${result.report.chordDeviation.toFixed(4)} mm`} tip="Strzałka łuku wynikająca z liczby segmentów — obowiązuje tylko przy siatce gęstej względem promienia. Zobacz „Rozdzielczość pasa”." />
                    <Row label="Rozdzielczość pasa" before="—" after={`${result.report.bandFacetSize.toFixed(2)} mm`} tip="Najdłuższa ściana siatki wokół zaokrąglanej krawędzi po zagęszczeniu. Gdy jest większa niż 2 × promień, o rzeczywistej gładkości decyduje model, a nie liczba segmentów." />
                  </div>

                  <div className="theme-bg-panel rounded-xl p-3 space-y-1.5 text-[11px]">
                    <DiagRow label="Odwrócone trójkąty" ok={result.report.flippedFaceCount === 0} detail={result.report.flippedFaceCount === 0 ? 'brak' : `${result.report.flippedFaceCount} szt.`} tip="Po zaokrągleniu żaden trójkąt nie obrócił się na drugą stronę — inaczej slicer widziałby dziurę." />
                    <DiagRow label="Zdegenerowane trójkąty" ok={result.report.degenerateFaceCount === 0} detail={result.report.degenerateFaceCount === 0 ? 'brak' : `${result.report.degenerateFaceCount} szt.`} tip="Trójkąty o zerowym polu — nie dałyby się pociąć." />
                    <DiagRow
                      label="Hausdorff ≤ promień"
                      ok={result.report.maxDisplacement <= result.report.effectiveRadius + 1e-9}
                      detail={`${result.report.maxDisplacement.toFixed(3)} ≤ ${result.report.effectiveRadius.toFixed(3)} mm`}
                      tip="Twarda gwarancja: żaden wierzchołek nie przesunął się bardziej niż o zadany promień, więc model nie może się zapaść."
                    />
                    <DiagRow
                      label="Płaszczyzny zachowane"
                      ok={Math.abs(result.report.bboxDelta[0]) <= PRINT_TOLERANCE_MM && Math.abs(result.report.bboxDelta[1]) <= PRINT_TOLERANCE_MM && Math.abs(result.report.bboxDelta[2]) <= PRINT_TOLERANCE_MM}
                      detail={`Δ ${result.report.bboxDelta.map((v) => v.toFixed(3)).join(' / ')} mm`}
                      tip={`Zmiana wymiarów gabarytowych. Tolerancja druku FDM to ${PRINT_TOLERANCE_MM} mm. Zmiana jest normalna, gdy najdalszy punkt leży dokładnie na zaokrąglanej krawędzi.`}
                    />
                  </div>
                </div>
              )}

              {/* Akcje */}
              <div className="space-y-2 pt-2 border-t theme-border">
                <Tip text="Zapisuje wynikowy STL w oryginalnym położeniu i skali — bez centrowania i bez skalowania. Gotowy do wrzucenia do slicera.">
                  <button
                    onClick={() => download('stl')}
                    className="w-full py-3 px-4 bg-accent-teal text-bg-dark font-extrabold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-glow-teal flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" /> Pobierz STL {result ? '(zaokrąglony)' : '(oryginał)'}
                  </button>
                </Tip>
                <Tip text="Ten sam wynik w formacie OBJ (wierzchołki + normalne + ściany). Zachowuje indeksowanie, więc plik jest mniejszy od STL.">
                  <button
                    onClick={() => download('obj')}
                    className="w-full py-2.5 px-4 bg-accent-teal/10 border border-accent-teal/30 text-accent-teal font-extrabold rounded-xl hover:bg-accent-teal/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" /> Pobierz OBJ
                  </button>
                </Tip>
                <Tip text="Czyści wszystko i pozwala wczytać inny plik. Zaznaczenie, wynik i diagnostyka zostaną zresetowane.">
                  <button
                    onClick={handleReset}
                    className="w-full py-2 px-4 theme-preset-btn border rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Wczytaj inny plik
                  </button>
                </Tip>
              </div>
            </div>
          )}
        </section>

        {/* Widok 3D */}
        <section className={`flex-1 min-h-0 relative transition-colors duration-300 ${
          theme === 'dark'
            ? 'bg-gradient-to-b from-[#0a0a0f] to-[#12121e]'
            : 'bg-gradient-to-b from-[#f1f5f9] to-[#cbd5e1]'
        }`}>
          {file && meshData ? (
            <ThreeViewer
              theme={theme}
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
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center theme-text-muted select-none p-4 text-center">
              <Upload className="w-16 h-16 mb-4 stroke-[1]" />
              <p className="text-sm font-semibold">Oczekiwanie na model 3D…</p>
              <p className="text-xs opacity-60 mt-1 max-w-[240px]">
                Wgraj plik z lewego panelu, aby uruchomić podgląd interaktywny
              </p>
            </div>
          )}

          {file && (
            <div className="absolute top-4 left-4 flex flex-col gap-2 z-20">
              <div className="bg-bg-dark/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5 text-[10px] text-white/70 font-mono">
                Zaznaczone krawędzie: <strong className="text-accent-orange">{selectedEdges.size}</strong>
                {hoveredEdge !== null && <span className="ml-2 text-accent-yellow">najedziona: #{hoveredEdge}</span>}
              </div>
              {result && (
                <div className="bg-bg-dark/80 backdrop-blur-md p-1.5 rounded-xl border border-white/5 flex gap-1">
                  {(['before', 'after', 'overlay'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setCompareMode(mode)}
                      title={
                        mode === 'before'
                          ? 'Model oryginalny — bez żadnych zmian'
                          : mode === 'after'
                            ? 'Model po zaokrągleniu zaznaczonych krawędzi'
                            : 'Obie wersje jednocześnie: oryginał nałożony na wynik'
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        compareMode === mode ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                      }`}
                    >
                      {mode === 'before' ? 'Przed' : mode === 'after' ? 'Po' : 'Porównanie'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Powiadomienia — cała "logistyka" poza panelem */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[22rem] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] shadow-lg backdrop-blur-md border animate-[fadeIn_.15s_ease-out] ${
              t.kind === 'warn'
                ? 'bg-[#2a1a0e]/95 border-accent-orange/30 text-accent-orange'
                : t.kind === 'ok'
                  ? 'bg-[#0e2a22]/95 border-accent-teal/30 text-accent-teal'
                  : theme === 'dark'
                    ? 'bg-[#16161f]/95 border-white/10 text-white/80'
                    : 'bg-white/95 border-slate-200 text-slate-700'
            }`}
          >
            {t.kind === 'warn' ? (
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            ) : t.kind === 'ok' ? (
              <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            ) : (
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            )}
            <p className="flex-1 leading-snug">{t.text}</p>
            <button
              onClick={() => dismissToast(t.id)}
              className="opacity-50 hover:opacity-100 transition-opacity"
              title="Zamknij powiadomienie"
              aria-label="Zamknij powiadomienie"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagRow({ label, ok, detail, tip }: { label: string; ok: boolean; detail: string; tip?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="theme-text-secondary flex items-center gap-1">
        {label}
        {tip && <TipIcon text={tip} />}
      </span>
      <span className={`flex items-center gap-1 font-bold ${ok ? 'text-accent-green' : 'text-accent-orange'}`}>
        {ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {detail}
      </span>
    </div>
  );
}

/** Ikona „?” z podpowiedzią po najechaniu. */
function TipIcon({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <HelpCircle className="w-3 h-3 opacity-40 group-hover:opacity-90 cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block z-50 w-56 rounded-lg bg-[#12121c] border border-white/10 px-2.5 py-2 text-[10px] font-normal normal-case tracking-normal text-white/85 shadow-xl whitespace-normal"
      >
        {text}
      </span>
    </span>
  );
}

/** Podpowiedź dla dowolnego elementu interfejsu (hover + fokus klawiatury). */
function Tip({ text, children, side = 'top' }: { text: string; children: React.ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  const pos = side === 'right'
    ? 'left-full top-1/2 -translate-y-1/2 ml-2'
    : side === 'bottom'
      ? 'left-1/2 -translate-x-1/2 top-full mt-1.5'
      : 'left-1/2 -translate-x-1/2 bottom-full mb-1.5';
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${pos} hidden group-hover:block group-focus-within:block z-50 w-60 rounded-lg bg-[#12121c] border border-white/10 px-2.5 py-2 text-[10px] font-normal normal-case tracking-normal text-white/85 shadow-xl whitespace-normal text-left`}
      >
        {text}
      </span>
    </span>
  );
}

function Row({ label, before, after, tip }: { label: string; before: string; after: string; tip?: string }) {
  return (
    <div className="grid grid-cols-3 p-1.5 border-b theme-border">
      <span className="theme-text-secondary flex items-center gap-1">
        {label}
        {tip && <TipIcon text={tip} />}
      </span>
      <span className="theme-text-primary">{before}</span>
      <span className="text-accent-teal font-bold">{after}</span>
    </div>
  );
}

function PresetButton({
  active, onClick, icon, title, subtitle, tip,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string; tip?: string;
}) {
  return (
    <Tip text={tip ?? ''}>
      <button
        onClick={onClick}
        className={`p-2 border rounded-xl flex flex-col items-start gap-1 text-left transition-all w-full ${
          active ? 'border-accent-teal bg-accent-teal/5 text-accent-teal font-extrabold' : 'theme-preset-btn hover:border-accent-teal/30'
        }`}
      >
        <div className="flex items-center gap-1">{icon}<span className="text-xs font-bold">{title}</span></div>
        <span className="text-[10px] theme-text-muted">{subtitle}</span>
      </button>
    </Tip>
  );
}

function surfaceAreaOf(mesh: MeshData): number {
  let area = 0;
  for (let f = 0; f < mesh.faceCount; f++) area += mesh.faceAreas[f];
  return area;
}
