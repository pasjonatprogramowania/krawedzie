import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMeshFromRaw, roundEdges, signedVolume } from '../src/utils/meshProcessing.ts';
import type { MeshData } from '../src/utils/meshProcessing.ts';
import { bboxOf, manifoldReport, readSTL, volumeOf } from './helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadPublicStl(name: string) {
  const buf = readFileSync(join(root, 'public', name));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return readSTL(ab);
}

function distanceToBox(x: number, y: number, z: number, h: number): number {
  const dx = Math.max(Math.abs(x) - h, 0);
  const dy = Math.max(Math.abs(y) - h, 0);
  const dz = Math.max(Math.abs(z) - h, 0);
  return Math.hypot(dx, dy, dz);
}

test('REAL: public/cube.stl (12 trójkątów) — pełny fillet z zachowaniem wymiarów', () => {
  const raw = loadPublicStl('cube.stl');
  const { mesh, diagnostics } = buildMeshFromRaw(raw.positions, null);
  assert.equal(mesh.vertexCount, 8);
  assert.equal(mesh.faceCount, 12);
  assert.equal(diagnostics.isClosed, true);
  assert.ok(Math.abs(diagnostics.size[0] - 20) < 1e-5);

  for (const r of [1, 2]) {
    const edges = mesh.edges.filter((e) => e.normalAngle > Math.PI / 4);
    assert.equal(edges.length, 12);
    const { mesh: result, report } = roundEdges(mesh, {
      radius: r, segments: 4, kind: 'fillet', edgeIndices: edges.map((e) => e.index),
    });
    assert.equal(report.flippedFaceCount, 0);
    assert.equal(report.degenerateFaceCount, 0);
    assert.equal(report.revertedVertexCount, 0);

    const rep = manifoldReport(result.positions, Int32Array.from(result.faces));
    assert.equal(rep.closed, true, `r=${r}: wynik domknięty`);

    const bbox = bboxOf(result.positions);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(bbox.size[k] - 20) < 1e-6, `r=${r}: wymiar ${k} = ${bbox.size[k]}`);
    }

    // Każdy wierzchołek powierzchni leży dokładnie na granicy sumy Minkowskiego.
    let maxErr = 0;
    for (let v = 0; v < result.vertexCount; v++) {
      const d = distanceToBox(
        result.positions[3 * v], result.positions[3 * v + 1], result.positions[3 * v + 2], 10 - r,
      );
      maxErr = Math.max(maxErr, Math.abs(d - r));
    }
    assert.ok(maxErr < 1e-5, `r=${r}: maxErr=${maxErr}`);

    const a = 20 - 2 * r;
    const expected = a ** 3 + 6 * a * a * r + 3 * Math.PI * a * r * r + (4 / 3) * Math.PI * r ** 3;
    const actual = Math.abs(signedVolume(result));
    assert.ok(Math.abs(actual - expected) / expected < 0.005, `r=${r}: V=${actual} vs ${expected}`);
  }
});

test('REAL: public/pranie.stl (260 trójkątów) — odporność na brudną siatkę', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh, diagnostics } = buildMeshFromRaw(raw.positions, null);
  assert.ok(mesh.faceCount > 200);
  assert.ok(diagnostics.nonManifoldEdgeCount >= 1, 'ten model celowo ma nie-rozmaitość');

  const sharp = mesh.edges.filter((e) => e.normalAngle > (30 * Math.PI) / 180 && e.faces.length === 2);
  assert.ok(sharp.length > 50, `oczekiwano wielu ostrych krawędzi, jest ${sharp.length}`);

  const bboxBefore = bboxOf(mesh.positions);
  const volumeBefore = Math.abs(signedVolume(mesh));

  const t0 = Date.now();
  const { mesh: result, report } = roundEdges(mesh, {
    radius: 0.8,
    segments: 4,
    kind: 'fillet',
    edgeIndices: sharp.map((e) => e.index),
  });
  const elapsed = Date.now() - t0;
  console.log(
    `[pranie.stl] ${elapsed} ms, trójkąty ${report.trianglesBefore} -> ${report.trianglesAfter}, ` +
    `poziomów ${report.refinementLevels}, przesunięto ${report.movedVertexCount} wierzchołków, ` +
    `r_eff=${report.effectiveRadius.toFixed(3)} mm, dV=${report.volumeChangePercent.toFixed(3)}%, ` +
    `maxD=${report.maxDisplacement.toFixed(4)} mm`,
  );

  // Twarde gwarancje bezpieczeństwa.
  assert.equal(report.flippedFaceCount, 0, 'brak odwróconych trójkątów');
  assert.equal(report.degenerateFaceCount, 0, 'brak zdegenerowanych trójkątów');
  assert.ok(report.maxDisplacement <= report.effectiveRadius + 1e-9, 'Hausdorff <= r');

  for (let i = 0; i < result.positions.length; i++) {
    assert.ok(Number.isFinite(result.positions[i]));
  }

  // Wymiary gabarytowe: niezmienione z dokładnością do dwukrotności maksymalnego
  // przemieszczenia wierzchołka (materiał narożnika usunięty przez fillet).
  // To twarda, matematyczna gwarancja: |Δgabaryt| <= 2·maxDisplacement.
  const bboxAfter = bboxOf(result.positions);
  for (let k = 0; k < 3; k++) {
    const delta = Math.abs(bboxAfter.size[k] - bboxBefore.size[k]);
    assert.ok(
      delta <= 2 * report.maxDisplacement + 1e-6,
      `wymiar ${k}: zmiana ${delta} > 2·maxD = ${2 * report.maxDisplacement}`,
    );
  }
  // Dodatkowo: płaszczyzny i cechy poza pasmem są zachowane co do bitu (patrz test
  // "wierzchołki poza pasmem są BIT-IDENTYCZNE").
  assert.ok(report.bboxDelta.every((v) => Math.abs(v) <= 2 * report.effectiveRadius + 1e-9));

  // Objętość zmienia się tylko lokalnie (zaokrąglenie krawędzi wypukłych usuwa materiał).
  const volumeAfter = Math.abs(signedVolume(result));
  assert.ok(volumeAfter < volumeBefore, 'zaokrąglenie wypukłych krawędzi zmniejsza objętość');
  assert.ok(
    (volumeBefore - volumeAfter) / volumeBefore < 0.02,
    `zmiana objętości ${((volumeBefore - volumeAfter) / volumeBefore * 100).toFixed(3)}% jest zbyt duża`,
  );

  // Spójność dwóch niezależnych metod liczenia objętości.
  const v2 = volumeOf(result.positions, Int32Array.from(result.faces));
  assert.ok(Math.abs(volumeAfter - v2) / volumeAfter < 1e-9);

  // Nadal domknięta rozmaitość (poza pierwotnymi nie-rozmaitościami).
  const rep = manifoldReport(result.positions, Int32Array.from(result.faces));
  assert.equal(rep.boundary, 0, 'nie powstały dziury');
  assert.equal(rep.flippedWinding, 0);
});

test('REAL: pranie.stl — chamfer 45 stopni również jest bezpieczny', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const sharp = mesh.edges.filter((e) => e.normalAngle > (45 * Math.PI) / 180 && e.faces.length === 2);
  const { report } = roundEdges(mesh, {
    radius: 0.6,
    segments: 1,
    kind: 'chamfer',
    edgeIndices: sharp.map((e) => e.index),
  });
  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);
  assert.ok(report.movedVertexCount > 0);
});

test('REAL: model z dziurą (otwarty) nie jest zaokrąglany na krawędziach brzegowych', () => {
  const raw = loadPublicStl('cube.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  // Usuwamy 2 trójkąty -> powstaje dziura.
  const indices = Int32Array.from(mesh.faces.slice(0, mesh.faces.length - 6));
  const { mesh: open, diagnostics } = buildMeshFromRaw(mesh.positions, indices);
  assert.equal(diagnostics.isClosed, false);
  const boundaryEdges = open.edges.filter((e) => e.isBoundary);
  assert.ok(boundaryEdges.length > 0);
  const { report } = roundEdges(open, {
    radius: 1,
    segments: 3,
    kind: 'fillet',
    edgeIndices: boundaryEdges.map((e) => e.index),
  });
  assert.ok(report.skippedBoundaryEdgeCount > 0, 'krawędzie brzegowe muszą być pominięte');
  assert.equal(report.processedEdgeCount, 0);
  assert.ok(report.warnings.some((w) => w.includes('brzegowych')));
});

function asMesh(m: MeshData): Int32Array {
  return Int32Array.from(m.faces);
}
void asMesh;
