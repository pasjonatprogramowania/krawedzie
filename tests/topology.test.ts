import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMeshFromRaw,
  buildTopology,
  computeDiagnostics,
  orientFacesConsistently,
  signedVolume,
  weldTriangleSoup,
} from '../src/utils/meshProcessing.ts';
import { makeBox, makeLShape, volumeOf, bboxOf, manifoldReport } from './helpers.ts';

test('welding scala wierzchołki na szwach (box 4x4 na ścianę)', () => {
  const raw = makeBox(20, 20, 20, 4);
  const welded = weldTriangleSoup(raw.positions, 1e-6, raw.indices);
  // 8 narożników + 12 krawędzi x 3 wewn. + 6 ścian x 9 wewn. = 98
  assert.equal(welded.positions.length / 3, 98);
  assert.equal(welded.rawVertexCount, 150);
  assert.equal(welded.weldedVertexCount, 52);
  assert.equal(welded.faces.length / 3, 6 * 16 * 2);
  assert.equal(welded.degenerateFacesRemoved, 0);
  assert.equal(welded.duplicateFacesRemoved, 0);
});

test('welding nie ma aliasingu kubełków (punkty bliższe niż tolerancja)', () => {
  // Dwa wierzchołki oddalone o 1e-9 leżą po przeciwnych stronach granicy kubełka
  // dla tolerancji 1e-6 — kwantyzacja "jednokomórkowa" by je rozdzieliła.
  const tol = 1e-6;
  const positions = Float64Array.from([
    0.9999999995 * tol, 0, 0,
    1.0000000005 * tol, 0, 0,
    0.5, 0.5, 0,
  ]);
  const indices = Int32Array.from([0, 1, 2]);
  const welded = weldTriangleSoup(positions, tol, indices);
  assert.equal(welded.positions.length / 3, 2, 'punkty bliższe niż tolerancja muszą się scalić');
});

test('wykrywa i scala zduplikowane oraz zdegenerowane trójkąty', () => {
  const positions = Float64Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, 1, 0, // duplikat
    0, 0, 0, 0, 0, 0, 0, 1, 0, // degenerat (powtórzony wierzchołek)
  ]);
  const indices = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const welded = weldTriangleSoup(positions, 1e-9, indices);
  assert.equal(welded.duplicateFacesRemoved, 1);
  assert.equal(welded.degenerateFacesRemoved, 1);
  assert.equal(welded.faces.length / 3, 1);
});

test('topologia sześcianu: 8 wierzchołków, 12 ścian, 18 krawędzi, chi = 2', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh, diagnostics } = buildMeshFromRaw(box.positions, box.indices);
  assert.equal(mesh.vertexCount, 8);
  assert.equal(mesh.faceCount, 12);
  assert.equal(mesh.edges.length, 18);
  assert.equal(diagnostics.eulerCharacteristic, 2);
  assert.equal(diagnostics.isClosed, true);
  assert.equal(diagnostics.boundaryEdgeCount, 0);
  assert.equal(diagnostics.nonManifoldEdgeCount, 0);
  assert.equal(diagnostics.connectedComponents, 1);
  assert.ok(Math.abs(diagnostics.volume - 8000) < 1e-6);
  assert.ok(Math.abs(diagnostics.surfaceArea - 6 * 400) < 1e-6);
  assert.deepEqual(diagnostics.size.map((v) => Math.round(v)), [20, 20, 20]);
});

test('klasyfikacja krawędzi: 12 krawędzi sześcianu jest wypukłych pod 90 stopni', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  // 12 krawędzi sześcianu (dł. 20) + 6 przekątnych ścian (dł. 20*sqrt(2), kąt 0).
  const cubeEdges = mesh.edges.filter((e) => Math.abs(e.length - 20) < 1e-9);
  const diagonals = mesh.edges.filter((e) => Math.abs(e.length - 20 * Math.SQRT2) < 1e-6);
  assert.equal(cubeEdges.length, 12);
  assert.equal(diagonals.length, 6);
  for (const e of cubeEdges) {
    assert.equal(e.faces.length, 2);
    assert.ok(Math.abs(e.normalAngle - Math.PI / 2) < 1e-9, `kąt ${e.normalAngle}`);
    assert.equal(e.isConvex, true, `krawędź ${e.v0}-${e.v1} powinna być wypukła`);
    assert.equal(e.isBoundary, false);
    assert.equal(e.isNonManifold, false);
  }
  // Przekątne leżą w płaszczyźnie ściany — kąt 0, więc nie są "ostre".
  for (const e of diagonals) {
    assert.ok(e.normalAngle < 1e-9, `przekątna ma kąt ${e.normalAngle}`);
  }
});

test('kształt L: krawędź wklęsła rozpoznana jako wklęsła', () => {
  const l = makeLShape(40, 20, 20);
  const { mesh, diagnostics } = buildMeshFromRaw(l.positions, l.indices);
  assert.equal(diagnostics.isClosed, true);
  const concave = mesh.edges.filter((e) => !e.isConvex && e.faces.length === 2);
  assert.ok(concave.length >= 1, 'musi istnieć co najmniej jedna krawędź wklęsła');
  // Wysokość 20 -> wklęsła krawędź pionowa ma długość 20.
  assert.ok(concave.some((e) => Math.abs(e.length - 20) < 1e-6));
  // Objętość: (40*20 + 20*20) * 20 = 24000
  assert.ok(Math.abs(diagnostics.volume - 24000) < 1e-6, `objętość ${diagnostics.volume}`);
});

test('naprawa orientacji: odwrócone ściany są wykrywane i prostowane', () => {
  const raw = makeBox(20, 20, 20, 1);
  const flippedFaces = Int32Array.from(raw.indices);
  for (let f = 0; f < flippedFaces.length; f += 3) {
    const t = flippedFaces[f + 1];
    flippedFaces[f + 1] = flippedFaces[f + 2];
    flippedFaces[f + 2] = t;
  }
  const welded = weldTriangleSoup(raw.positions, 1e-6, flippedFaces);
  const broken = buildTopology(welded.positions, welded.faces);
  assert.ok(signedVolume(broken) < 0, 'odwrócona siatka musi mieć ujemną objętość');
  // Wszystkie ściany odwrócone spójnie -> winding jest spójny, ale orientacja globalna zła.
  const fixed = orientFacesConsistently(broken);
  assert.ok(signedVolume(fixed) > 0, 'po naprawie objętość musi być dodatnia');

  // Teraz przypadek niespójny: odwracamy tylko połowę ścian.
  const halfFlipped = Int32Array.from(raw.indices);
  for (let f = 0; f < halfFlipped.length / 2; f += 3) {
    const t = halfFlipped[f + 1];
    halfFlipped[f + 1] = halfFlipped[f + 2];
    halfFlipped[f + 2] = t;
  }
  const welded2 = weldTriangleSoup(raw.positions, 1e-6, halfFlipped);
  const broken2 = buildTopology(welded2.positions, welded2.faces);
  assert.ok(broken2.inconsistentWindingCount > 0);
  const fixed2 = orientFacesConsistently(broken2);
  assert.equal(fixed2.inconsistentWindingCount, 0);
  assert.ok(signedVolume(fixed2) > 0);
  assert.ok(Math.abs(Math.abs(signedVolume(fixed2)) - 8000) < 1e-6);
});

test('diagnostyka wykrywa dziurę (brak jednej ściany)', () => {
  const raw = makeBox(20, 20, 20, 1);
  const indices = Int32Array.from(raw.indices.slice(0, raw.indices.length - 3));
  const { diagnostics } = buildMeshFromRaw(raw.positions, indices);
  assert.equal(diagnostics.isClosed, false);
  assert.equal(diagnostics.boundaryEdgeCount, 3);
  assert.ok(diagnostics.warnings.some((w) => w.includes('domknięta')));
});

test('sześcian z STL (zupa trójkątów, bez indeksów) daje te same wyniki', () => {
  const box = makeBox(20, 20, 20, 1);
  // Zupa trójkątów: 12 trójkątów x 3 wierzchołki.
  const soup = new Float64Array(12 * 9);
  for (let f = 0; f < 12; f++) {
    for (let k = 0; k < 3; k++) {
      const v = box.indices[3 * f + k];
      soup[9 * f + 3 * k] = box.positions[3 * v];
      soup[9 * f + 3 * k + 1] = box.positions[3 * v + 1];
      soup[9 * f + 3 * k + 2] = box.positions[3 * v + 2];
    }
  }
  const { mesh, diagnostics } = buildMeshFromRaw(soup, null);
  assert.equal(mesh.vertexCount, 8);
  assert.equal(mesh.faceCount, 12);
  assert.equal(mesh.edges.length, 18);
  assert.equal(diagnostics.isClosed, true);
  assert.ok(Math.abs(diagnostics.volume - 8000) < 1e-6);
});

test('diagnostyka wykrywa krawędź nie-rozmaitości (3 ściany na krawędzi)', () => {
  // Dwa trójkąty po jednej stronie + jeden po drugiej, dzielące tę samą krawędź.
  const positions = Float64Array.from([
    0, 0, 0, 2, 0, 0,
    1, 1, 0,
    1, -1, 0,
    1, 0, 1,
  ]);
  const indices = Int32Array.from([0, 1, 2, 1, 0, 3, 0, 1, 4]);
  const { diagnostics } = buildMeshFromRaw(positions, indices);
  assert.equal(diagnostics.nonManifoldEdgeCount, 1);
  assert.ok(diagnostics.warnings.some((w) => w.includes('nie-rozmaitości')));
});

test('diagnostyka wykrywa wierzchołek "bowtie" i ostrzega', () => {
  // Dwa czworościany sklejone jednym wierzchołkiem.
  const t1 = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const positions = Float64Array.from([
    ...t1,
    -1, 0, 0, 0, -1, 0, 0, 0, -1,
  ]);
  const indices = Int32Array.from([
    0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3,
    4, 5, 6, 4, 7, 5, 4, 6, 7, 5, 7, 6,
  ]);
  const { diagnostics } = buildMeshFromRaw(positions, indices);
  assert.ok(diagnostics.connectedComponents >= 1);
  assert.ok(diagnostics.warnings.some((w) => w.includes('bowtie')));
});

test('spłaszczanie obiektu 3D (objectToTriangleSoup) zachowuje geometrię', async () => {
  const THREE = await import('three');
  const { objectToTriangleSoup } = await import('../src/utils/meshProcessing.ts');
  const group = new THREE.Group();
  const g1 = new THREE.BoxGeometry(2, 2, 2);
  const m1 = new THREE.Mesh(g1);
  m1.position.set(5, 0, 0);
  group.add(m1);
  const g2 = new THREE.BoxGeometry(2, 2, 2);
  const m2 = new THREE.Mesh(g2);
  m2.position.set(-5, 0, 0);
  group.add(m2);
  const soup = objectToTriangleSoup(group);
  assert.ok(soup);
  const box = bboxOf(soup!.positions);
  assert.ok(Math.abs(box.min[0] - -6) < 1e-5, `min.x=${box.min[0]}`);
  assert.ok(Math.abs(box.max[0] - 6) < 1e-5, `max.x=${box.max[0]}`);
});

test('manifoldReport z helperów zgadza się z diagnostyką produkcyjną', () => {
  const raw = makeBox(10, 14, 18, 3);
  const { mesh } = buildMeshFromRaw(raw.positions, raw.indices);
  const positions = new Float64Array(mesh.vertexCount * 3);
  positions.set(mesh.positions);
  const indices = Int32Array.from(mesh.faces);
  const report = manifoldReport(positions, indices);
  assert.equal(report.closed, true);
  assert.equal(report.boundary, 0);
  assert.equal(report.nonManifold, 0);
  assert.equal(report.flippedWinding, 0);
  const diag = computeDiagnostics(mesh);
  assert.equal(diag.isClosed, true);
  const vol = volumeOf(positions, indices);
  assert.ok(Math.abs(vol - 10 * 14 * 18) < 1e-6, `objętość ${vol}`);
});
