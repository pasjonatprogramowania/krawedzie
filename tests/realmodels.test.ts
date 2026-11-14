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

test('REAL: pranie.stl r=1.6 — pas dobrze zagęszczony i bez zamarzania długich sąsiednich ścian', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const sharp = mesh.edges.filter((e) => e.normalAngle > (30 * Math.PI) / 180 && e.faces.length === 2);

  const { report } = roundEdges(mesh, {
    radius: 1.6,
    segments: 5,
    kind: 'fillet',
    edgeIndices: sharp.map((e) => e.index),
  });

  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);
  assert.equal(report.radiusClampReason, null, `nieoczekiwane przycięcie promienia: ${report.radiusClampReason}`);
  assert.equal(report.refinementLimitedByBudget, false, 'pas nie powinien wyczerpać budżetu 60k trójkątów');
  assert.ok(report.bandFacetSize < 5, `za duże fasety w pasie: ${report.bandFacetSize.toFixed(2)} mm`);
  assert.ok(report.measuredSurfaceError < 0.5, `za duży błąd powierzchni: ${report.measuredSurfaceError.toFixed(3)} mm`);
  assert.ok(
    !report.warnings.some((w) => /ograniczone do 1[,.]600 mm.*z 1[,.]/.test(w)),
    `niespójne ostrzeżenie o limicie przemieszczenia: ${report.warnings.join(' | ')}`,
  );
});

test('REAL: pranie.stl r=1.75 seg=3 — brak zaokrąglania szwów i ukrytych krawędzi między powłokami', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const sharp = mesh.edges.filter((e) => e.normalAngle >= (30 * Math.PI) / 180 && e.faces.length === 2);

  const { mesh: result, report } = roundEdges(mesh, {
    radius: 1.75,
    segments: 3,
    kind: 'fillet',
    edgeIndices: sharp.map((e) => e.index),
  });

  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);

  const dispOfOrig = (v: number) => Math.hypot(
    result.positions[3 * v] - mesh.positions[3 * v],
    result.positions[3 * v + 1] - mesh.positions[3 * v + 1],
    result.positions[3 * v + 2] - mesh.positions[3 * v + 2],
  );

  // Wierzchołki 106 i 107 na końcu powłoki 4 schowanym wewnątrz powłoki 3 nie mogą się ruszyć.
  for (const v of [106, 107]) {
    assert.ok(dispOfOrig(v) < 1e-4, `ukryty wierzchołek v${v} nie powinien się ruszyć (disp=${dispOfOrig(v).toFixed(4)})`);
  }

  // Wierzchołki 86 i 95 leżą na ciągłych szynach prostoliniowych przez styk powłok 1–2–3:
  // zamiast dołka 3D narożnika (~1.281 mm) mają przesuwać się po walcu r*(√2−1) ≈ 0.725 mm.
  const cylDisp = 1.75 * (Math.SQRT2 - 1);
  for (const v of [86, 95]) {
    const d = dispOfOrig(v);
    assert.ok(Math.abs(d - cylDisp) < 0.08, `v${v}: oczekiwano ~${cylDisp.toFixed(3)} mm na ciągłej szynie, było ${d.toFixed(4)} mm`);
  }
});

test('REAL: pranie.stl r=1.38 seg=3 — symetryczne zmiękczenie takich samych krawędzi i brak załamań we wcięciach', () => {
  const raw = loadPublicStl('pranie.stl');
  const { mesh } = buildMeshFromRaw(raw.positions, null);
  const sharp = mesh.edges.filter((e) => e.normalAngle >= (30 * Math.PI) / 180 && e.faces.length === 2);

  const { mesh: result, report } = roundEdges(mesh, {
    radius: 1.38,
    segments: 3,
    kind: 'fillet',
    edgeIndices: sharp.map((e) => e.index),
  });

  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);

  const dispOfOrig = (v: number) => Math.hypot(
    result.positions[3 * v] - mesh.positions[3 * v],
    result.positions[3 * v + 1] - mesh.positions[3 * v + 1],
    result.positions[3 * v + 2] - mesh.positions[3 * v + 2],
  );

  // 1. Symetryczne wierzchołki fazowania na ukośnym uchwycie: v61, v63, v67, v68 (~0.5715 mm).
  // Przed poprawką v61 zapadał się do 0.0372 mm przez niesparowany podział trójkąta igłowego f163.
  const bevelMidDisps = [61, 63, 67, 68].map(dispOfOrig);
  for (let i = 0; i < bevelMidDisps.length; i++) {
    assert.ok(
      bevelMidDisps[i] >= 0.52,
      `wierzchołek fazowania v${[61, 63, 67, 68][i]} zapadł się: disp=${bevelMidDisps[i].toFixed(4)} mm`,
    );
  }
  assert.ok(
    Math.max(...bevelMidDisps) - Math.min(...bevelMidDisps) < 0.04,
    `asymetryczne zmiękczenie fazowania [61,63,67,68]: ${bevelMidDisps.map((d) => d.toFixed(4)).join(', ')}`,
  );

  // 2. Symetryczne narożniki fazowania: v59, v64, v66, v69 (~1.010 mm).
  // Przed poprawką v66 spadał do 0.8869 mm przez łańcuchowe sklejanie wierzchołków w coalesceNearDuplicates.
  const bevelCornerDisps = [59, 64, 66, 69].map(dispOfOrig);
  assert.ok(
    Math.max(...bevelCornerDisps) - Math.min(...bevelCornerDisps) < 0.04,
    `asymetryczne narożniki fazowania [59,64,66,69]: ${bevelCornerDisps.map((d) => d.toFixed(4)).join(', ')}`,
  );

  // 3. Bliźniacze długie krawędzie ramienia e79 (v37-v41) i e81 (v43-v44) muszą być zmiękczone jednakowo
  // na całym odcinku wewnętrznym t in [0.1, 0.85] (przed poprawką e79 zapadała się do 0.125 mm przy t=0.05..0.19).
  assert.equal(report.relaxedVertexCount, 0, `nie powinno być zrelaksowanych wierzchołków przy r=1.38 (było ${report.relaxedVertexCount})`);
  const edgeMinDisps: number[] = [];
  for (const [va, vb, label] of [[37, 41, 'e79'], [43, 44, 'e81']] as const) {
    const ax = mesh.positions[3 * va], ay = mesh.positions[3 * va + 1], az = mesh.positions[3 * va + 2];
    const bx = mesh.positions[3 * vb] - ax, by = mesh.positions[3 * vb + 1] - ay, bz = mesh.positions[3 * vb + 2] - az;
    const len2 = bx * bx + by * by + bz * bz;
    let minInteriorDisp = Infinity;
    for (let v = 0; v < result.vertexCount; v++) {
      const px = result.positions[3 * v] - ax;
      const py = result.positions[3 * v + 1] - ay;
      const pz = result.positions[3 * v + 2] - az;
      const t = (px * bx + py * by + pz * bz) / len2;
      if (t < 0.1 || t > 0.85) continue;
      const cx = px - t * bx, cy = py - t * by, cz = pz - t * bz;
      const distToLine = Math.hypot(cx, cy, cz);
      if (distToLine < minInteriorDisp) minInteriorDisp = distToLine;
    }
    assert.ok(
      minInteriorDisp >= 0.52,
      `krawędź ${label} zapadła się w środku do ${minInteriorDisp.toFixed(4)} mm (oczekiwano >= 0.52 mm)`,
    );
    edgeMinDisps.push(minInteriorDisp);
  }
  assert.ok(
    Math.abs(edgeMinDisps[0] - edgeMinDisps[1]) < 0.02,
    `bliźniacze krawędzie e79 i e81 mają różne zmiękczenie: ${edgeMinDisps.map((d) => d.toFixed(4)).join(' vs ')}`,
  );
});



