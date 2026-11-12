import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildMeshFromRaw,
  exportToOBJ,
  meshToBinarySTL,
  roundEdges,
  signedVolume,
} from '../src/utils/meshProcessing.ts';
import { bboxOf, manifoldReport, readSTL, volumeOf } from './helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadPublicStl(name: string) {
  const buf = readFileSync(join(root, 'public', name));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return readSTL(ab);
}

test('EKSPORT STL: nagłówek, liczba trójkątów i rozmiar bufora są poprawne', () => {
  const raw = loadPublicStl('cube.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const buffer = meshToBinarySTL(mesh);
  assert.equal(buffer.byteLength, 84 + mesh.faceCount * 50);
  const view = new DataView(buffer);
  assert.equal(view.getUint32(80, true), mesh.faceCount);
  // Nagłówek nie może zaczynać się od "solid" (część czytników uznałaby plik za ASCII).
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
  assert.notEqual(head, 'solid');
});

test('EKSPORT STL: round-trip zachowuje geometrię co do float32', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const buffer = meshToBinarySTL(mesh);
  const parsed = readSTL(buffer);
  const reparsed = buildMeshFromRaw(parsed.positions, null);

  assert.equal(reparsed.mesh.faceCount, mesh.faceCount);
  assert.equal(reparsed.mesh.vertexCount, mesh.vertexCount);
  assert.equal(reparsed.diagnostics.isClosed, diagnosticsClosed(mesh));

  const v1 = Math.abs(signedVolume(mesh));
  const v2 = Math.abs(signedVolume(reparsed.mesh));
  assert.ok(Math.abs(v1 - v2) / v1 < 1e-6, `objętość ${v1} -> ${v2}`);

  const b1 = bboxOf(mesh.positions);
  const b2 = bboxOf(reparsed.mesh.positions);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(b1.size[k] - b2.size[k]) < 1e-4, `wymiar ${k}`);
  }
});

test('EKSPORT OBJ: poprawna liczba wierzchołków, normalnych i ścian', async () => {
  const raw = loadPublicStl('cube.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const text = await exportToOBJ(mesh).text();
  const vertexLines = text.split('\n').filter((l) => l.startsWith('v '));
  const normalLines = text.split('\n').filter((l) => l.startsWith('vn '));
  const faceLines = text.split('\n').filter((l) => l.startsWith('f '));
  assert.equal(vertexLines.length, mesh.vertexCount);
  assert.equal(normalLines.length, mesh.faceCount);
  assert.equal(faceLines.length, mesh.faceCount);
  for (const line of faceLines) {
    const parts = line.split(/\s+/).slice(1);
    assert.equal(parts.length, 3);
    for (const p of parts) {
      const [vi, ni] = p.split('//').map(Number);
      assert.ok(vi >= 1 && vi <= mesh.vertexCount, `indeks wierzchołka ${vi} poza zakresem`);
      assert.ok(ni >= 1 && ni <= mesh.faceCount, `indeks normalnej ${ni} poza zakresem`);
    }
  }
});

test('PIPELINE: pełny przebieg użytkownika na cube.stl (wczytaj -> auto -> zaokrąglij -> eksport)', async () => {
  const raw = loadPublicStl('cube.stl');
  const built = buildMeshFromRaw(raw.positions, null);
  const mesh = built.mesh;

  // 1. Auto-detekcja ostrych krawędzi (próg 30 stopni, jak w UI).
  const threshold = (30 * Math.PI) / 180;
  const selected = mesh.edges.filter((e) => e.faces.length === 2 && e.normalAngle >= threshold);
  assert.equal(selected.length, 12);

  // 2. Zaokrąglenie presetem "Bezpieczne" (fillet 0.4 mm, 3 segmenty).
  const { mesh: rounded, report } = roundEdges(mesh, {
    radius: 0.4,
    segments: 3,
    kind: 'fillet',
    edgeIndices: selected.map((e) => e.index),
  });
  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);
  assert.equal(report.clampedVertexCount, 0);
  assert.equal(report.revertedVertexCount, 0);

  // 3. Eksport i ponowny odczyt.
  const stl = meshToBinarySTL(rounded);
  const reparsed = buildMeshFromRaw(readSTL(stl).positions, null);
  const rep = manifoldReport(reparsed.mesh.positions, Int32Array.from(reparsed.mesh.faces));
  assert.equal(rep.closed, true);
  assert.equal(rep.nonManifold, 0);
  assert.equal(rep.flippedWinding, 0);

  // 4. Wymiary i objętość.
  const before = bboxOf(mesh.positions);
  const after = bboxOf(reparsed.mesh.positions);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(before.size[k] - after.size[k]) < 1e-5, `gabaryt ${k}`);
  }
  const vBefore = Math.abs(signedVolume(mesh));
  const vAfter = volumeOf(reparsed.mesh.positions, Int32Array.from(reparsed.mesh.faces));
  assert.ok(vAfter < vBefore, 'zaokrąglenie wypukłych krawędzi usuwa materiał');
  // Objętość musi zgadzać się ze wzorem Steinera dla bryły "sześcian + kula r"
  // (z dokładnością aproksymacji łuku przez 3 segmenty).
  const r = 0.4;
  const inner = 20 - 2 * r;
  const expected = inner ** 3 + 6 * inner * inner * r + 3 * Math.PI * inner * r * r + (4 / 3) * Math.PI * r ** 3;
  assert.ok(
    Math.abs(vAfter - expected) / expected < 0.005,
    `objętość ${vAfter} vs analityczna ${expected}`,
  );
  assert.ok((vBefore - vAfter) / vBefore < 0.002, 'ubytek objętości musi być marginalny');
});

test('PIPELINE: każdy preset UI daje bezpieczny wynik na obu modelach demo', () => {
  const presets = [
    { name: 'Bezpieczne', kind: 'fillet' as const, radius: 0.4, segments: 3 },
    { name: 'Wytrzymałe', kind: 'fillet' as const, radius: 1.0, segments: 5 },
    { name: 'Ścięcie 45°', kind: 'chamfer' as const, radius: 0.6, segments: 1 },
  ];
  for (const fileName of ['cube.stl', 'pranie.stl']) {
    const raw = loadPublicStl(fileName);
    const { mesh } = buildMeshFromRaw(raw.positions, null);
    const threshold = (30 * Math.PI) / 180;
    const selected = mesh.edges.filter((e) => e.faces.length === 2 && e.normalAngle >= threshold);
    for (const p of presets) {
      const { mesh: res, report } = roundEdges(mesh, {
        radius: p.radius, segments: p.segments, kind: p.kind, edgeIndices: selected.map((e) => e.index),
      });
      assert.equal(report.flippedFaceCount, 0, `${fileName}/${p.name}: flipy`);
      assert.equal(report.degenerateFaceCount, 0, `${fileName}/${p.name}: degeneraty`);
      assert.ok(report.maxDisplacement <= report.effectiveRadius + 1e-9, `${fileName}/${p.name}: Hausdorff`);
      for (let i = 0; i < res.positions.length; i++) {
        assert.ok(Number.isFinite(res.positions[i]), `${fileName}/${p.name}: NaN`);
      }
      const rep = manifoldReport(res.positions, Int32Array.from(res.faces));
      assert.equal(rep.boundary, 0, `${fileName}/${p.name}: dziury`);
      assert.equal(rep.flippedWinding, 0, `${fileName}/${p.name}: winding`);
    }
  }
});

test('PIPELINE: objętość po eksporcie zgadza się z siatką w pamięci', () => {
  const raw = loadPublicStl('cube.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const edges = mesh.edges.filter((e) => e.normalAngle > Math.PI / 4).map((e) => e.index);
  const { mesh: rounded } = roundEdges(mesh, { radius: 1.5, segments: 4, kind: 'fillet', edgeIndices: edges });
  const stl = meshToBinarySTL(rounded);
  const reparsed = buildMeshFromRaw(readSTL(stl).positions, null);
  const v1 = Math.abs(signedVolume(rounded));
  const v2 = Math.abs(signedVolume(reparsed.mesh));
  assert.ok(Math.abs(v1 - v2) / v1 < 1e-6, `${v1} vs ${v2}`);
});

function diagnosticsClosed(mesh: { boundaryEdgeCount: number }): boolean {
  return mesh.boundaryEdgeCount === 0;
}
