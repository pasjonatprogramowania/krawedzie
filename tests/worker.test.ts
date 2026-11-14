/**
 * Testy workera obliczeniowego.
 *
 * Moduł workera musi dać się zaimportować w Node (bez `self`), a jego czysta
 * funkcja `handleRoundRequest` musi zwracać wynik albo czytelny błąd — nigdy
 * nie może zawiesić przeglądarki na zbyt dużym modelu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countInputTriangles,
  handleRoundRequest,
  MAX_INPUT_TRIANGLES,
  type WorkerRequest,
} from '../src/workers/rounding.worker.ts';
import { buildMeshFromRaw } from '../src/utils/meshProcessing.ts';
import { makeBox } from './helpers.ts';

/** Indeksy ostrych krawędzi kostki 20 mm (po zbudowaniu topologii). */
function cubeSharpEdges(): number[] {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  return mesh.edges
    .filter((e) => e.faces.length === 2 && e.normalAngle > Math.PI / 4)
    .map((e) => e.index);
}

function boxRequest(id: number, options?: Partial<WorkerRequest['options']>): WorkerRequest {
  const box = makeBox(20, 20, 20, 1);
  return {
    type: 'round',
    id,
    positions: box.positions,
    indices: box.indices,
    options: {
      radius: 1,
      segments: 3,
      kind: 'fillet',
      edgeIndices: cubeSharpEdges(),
      ...options,
    },
  };
}

test('worker: moduł importuje się w Node i eksponuje handleRoundRequest', () => {
  assert.equal(typeof handleRoundRequest, 'function');
  assert.equal(typeof countInputTriangles, 'function');
  assert.ok(MAX_INPUT_TRIANGLES === 300_000);
});

test('worker: poprawna kostka daje wynik z raportem', () => {
  const req = boxRequest(7);
  // Żądanie musi przejść przez structuredClone (jak w prawdziwym workerze).
  const cloned = structuredClone(req);
  assert.equal(cloned.id, 7);

  const res = handleRoundRequest(cloned);
  assert.equal(res.type, 'result');
  if (res.type !== 'result') return;
  assert.equal(res.id, 7);
  assert.equal(res.report.geometryChanged, true);
  assert.equal(res.report.failed, false);
  assert.equal(res.report.flippedFaceCount, 0);
  assert.equal(res.report.degenerateFaceCount, 0);
  // Wynik też musi być przeklonalny (siatka to typy strukturalne).
  const clonedRes = structuredClone(res);
  assert.equal(clonedRes.type, 'result');
});

test('worker: zaokrąglenie zaznaczonej krawędzi zmienia geometrię', () => {
  const req = boxRequest(3, { edgeIndices: [0] });
  const res = handleRoundRequest(structuredClone(req));
  assert.equal(res.type, 'result');
  if (res.type !== 'result') return;
  assert.ok(res.report.movedVertexCount > 0, 'krawędź musi zostać zaokrąglona');
});

test('worker: model powyżej limitu zwraca błąd bez budowania siatki', () => {
  const triangles = MAX_INPUT_TRIANGLES + 1;
  const req: WorkerRequest = {
    type: 'round',
    id: 9,
    positions: new Float64Array(triangles * 9),
    indices: null,
    options: { radius: 1, segments: 3, kind: 'fillet', edgeIndices: [] },
  };
  const res = handleRoundRequest(req);
  assert.equal(res.type, 'error');
  if (res.type !== 'error') return;
  assert.equal(res.id, 9);
  assert.match(res.message, /300\s*000|300 tys/);
  assert.match(res.message, /trójkąt/);
});

test('worker: indeksy podane jako lista są akceptowane', () => {
  const box = makeBox(20, 20, 20, 1);
  const req: WorkerRequest = {
    type: 'round',
    id: 11,
    positions: box.positions,
    indices: box.indices,
    options: { radius: 1, segments: 3, kind: 'fillet', edgeIndices: [0, 1, 2] },
  };
  const res = handleRoundRequest(structuredClone(req));
  assert.equal(res.type, 'result');
});

test('worker: błąd w danych nie wywraca procesu', () => {
  const req: WorkerRequest = {
    type: 'round',
    id: 13,
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Int32Array([0, 1, 2, 5, 6, 7]),
    options: { radius: 1, segments: 3, kind: 'fillet', edgeIndices: [0] },
  };
  const res = handleRoundRequest(req);
  assert.ok(res.type === 'result' || res.type === 'error');
  if (res.type === 'error') assert.equal(res.id, 13);
});
