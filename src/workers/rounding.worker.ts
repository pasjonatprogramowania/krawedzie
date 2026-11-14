/**
 * RoundEdge — worker obliczeniowy.
 *
 * Zaokrąglanie krawędzi potrafi trwać kilkanaście sekund na dużym modelu, więc
 * w przeglądarce musi działać poza wątkiem renderującym. Moduł zawiera czystą
 * funkcję `handleRoundRequest`, którą da się przetestować w Node (bez `self`),
 * oraz — tylko w przeglądarce — rejestrację `onmessage`.
 *
 * ADR 0009: twardy limit wejścia 300 000 trójkątów. Powyżej nie próbujemy budować
 * siatki ani liczyć zaokrąglenia (pamięć i czas), tylko zwracamy czytelny błąd.
 */
import type { MeshData, RoundingOptions, RoundingReport } from '../utils/meshTypes.ts';
import { buildMeshFromRaw, roundEdges } from '../utils/meshProcessing.ts';

/** Maksymalna liczba trójkątów wejściowych, którą jeszcze przetwarzamy. */
export const MAX_INPUT_TRIANGLES = 300_000;

export interface WorkerRequest {
  type: 'round';
  id: number;
  positions: Float64Array;
  indices: Int32Array | null;
  /** Opcje zaokrąglenia; `edgeIndices` to lista indeksów (structured clone nie przenosi `Set`). */
  options: Omit<RoundingOptions, 'edgeIndices'> & { edgeIndices: number[] | Iterable<number> };
}

export type WorkerResponse =
  | { type: 'result'; id: number; mesh: MeshData; report: RoundingReport }
  | { type: 'error'; id: number; message: string };

/** Liczba trójkątów w danych wejściowych (bez budowania pełnej topologii). */
export function countInputTriangles(positions: Float64Array, indices: Int32Array | null): number {
  if (indices) return Math.floor(indices.length / 3);
  return Math.floor(positions.length / 9);
}

/**
 * Obsługuje jedno żądanie zaokrąglenia. Funkcja czysta — nie dotyka `self`,
 * dzięki czemu działa w Node, w SSR i w samym workerze.
 */
export function handleRoundRequest(req: WorkerRequest): WorkerResponse {
  const triangles = countInputTriangles(req.positions, req.indices);
  if (triangles > MAX_INPUT_TRIANGLES) {
    return {
      type: 'error',
      id: req.id,
      message:
        `Model ma ${triangles.toLocaleString('pl-PL')} trójkątów, a limit to ` +
        `${MAX_INPUT_TRIANGLES.toLocaleString('pl-PL')} (300 tys.). Zbyt duży model — ` +
        'uprość siatkę przed zaokrąglaniem.',
    };
  }
  try {
    const { mesh } = buildMeshFromRaw(req.positions, req.indices);
    const edgeIndices = Array.from(req.options.edgeIndices as Iterable<number>);
    const res = roundEdges(mesh, { ...req.options, edgeIndices });
    return { type: 'result', id: req.id, mesh: res.mesh, report: res.report };
  } catch (err) {
    return {
      type: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Rejestracja tylko w środowisku przeglądarki — import modułu w Node (testy, SSR)
// nie może rzucić `ReferenceError: self is not defined`.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    if (!msg || msg.type !== 'round') return;
    const response = handleRoundRequest(msg);
    self.postMessage(response);
  };
}
