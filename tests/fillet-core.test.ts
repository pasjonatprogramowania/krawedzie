/**
 * Testy rdzenia filletu: geometria łuku, wykonalność dla ostrych klinów,
 * uczciwy raport i zmierzony błąd powierzchni.
 *
 * Każdy test odpowiada findingowi z audytu:
 *   AUD-001 — ostry klin (θ < 60°) nie da się zaokrąglić pełnym promieniem,
 *   AUD-002 — ściany pasa nie zjeżdżają na łuk (heurystyka normalnej wierzchołka),
 *   AUD-004/AUD-007 — raport obiecywał zaokrąglenie, a geometria była nietknięta,
 *   AUD-008 — `chordDeviation` to teoria, realny błąd powierzchni jest większy,
 *   AUD-010 — kąt łuku to kąt materiału (π − kąt normalnych), nie kąt normalnych.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshFromRaw, roundEdges } from '../src/utils/meshProcessing.ts';
import type { MeshData } from '../src/utils/meshProcessing.ts';
import { makeBox } from './helpers.ts';

const DEG = Math.PI / 180;

/**
 * Klin o kącie materiału `thetaDeg` — profil 2D wyciągnięty w Z (jak probe1c
 * z audytu). Ramiona są długie (60 mm), więc wierzchołki w paście pojawiają się
 * dopiero po zagęszczeniu pasa — dokładnie tak, jak w zmierzonym audycie.
 */
function buildWedge(thetaDeg: number, height = 20, arm = 60): MeshData {
  const theta = thetaDeg * DEG;
  const ux = Math.cos(theta / 2), uy = Math.sin(theta / 2);
  const lx = Math.cos(-theta / 2), ly = Math.sin(-theta / 2);
  const profile: Array<[number, number]> = [
    [0, 0],
    [ux * arm, uy * arm],
    [ux * (arm - 4), uy * (arm - 4)],
    [lx * 4, ly * 4],
    [lx * arm, ly * arm],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];
  for (const z of [0, height]) {
    const ring: number[] = [];
    for (const [x, y] of profile) {
      ring.push(positions.length / 3);
      positions.push(x, y, z);
    }
    rings.push(ring);
  }
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    const a = rings[0][i], b = rings[1][i], c = rings[1][j], d = rings[0][j];
    indices.push(a, b, c, a, c, d);
  }
  return buildMeshFromRaw(Float64Array.from(positions), Int32Array.from(indices)).mesh;
}

/** Indeks krawędzi klina — pionowej, przechodzącej przez początek układu. */
function wedgeEdge(mesh: MeshData): number {
  const found = mesh.edges
    .filter((e) => e.faces.length === 2)
    .map((e) => ({
      e,
      d: Math.hypot(
        (mesh.positions[3 * e.v0] + mesh.positions[3 * e.v1]) / 2,
        (mesh.positions[3 * e.v0 + 1] + mesh.positions[3 * e.v1 + 1]) / 2,
      ),
    }))
    .find((x) => x.d < 1e-6);
  assert.ok(found, 'nie znaleziono krawędzi klina');
  return found.e.index;
}

/** Indeks wierzchołka wierzchołkowego klina (najbliżej początku układu). */
function apexIndex(mesh: MeshData): number {
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const d = Math.hypot(mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

/** Zaokrąglenie klina — bez wygaszania na końcach (czysta matematyka łuku). */
function filletWedge(mesh: MeshData, radius: number, segments = 8) {
  return roundEdges(mesh, {
    radius,
    segments,
    kind: 'fillet',
    edgeIndices: [wedgeEdge(mesh)],
    taperEnds: false,
  });
}

test('fillet: ściany w paście zjeżdżają na łuk (kąt 60°)', () => {
  const r = 1;
  const theta = 60 * DEG;
  const mesh = buildWedge(60);
  const { mesh: out } = filletWedge(mesh, r);

  // Oś łuku: środek kuli w odległości r/sin(θ/2) od krawędzi, po dwusiecznej materiału.
  const axisX = r / Math.sin(theta / 2);
  let checked = 0;
  for (let v = 0; v < out.vertexCount; v++) {
    const x = out.positions[3 * v];
    const y = out.positions[3 * v + 1];
    if (Math.hypot(x, y) > 1.5 * r) continue; // poza pasem — ściana prosta, nie łuk
    const rho = Math.hypot(x - axisX, y);
    assert.ok(
      Math.abs(rho - r) < 1e-6,
      `wierzchołek ${v} leży w odległości ${rho.toFixed(6)} od osi łuku (r=${r})`,
    );
    checked++;
  }
  assert.ok(checked >= 4, `sprawdzono tylko ${checked} wierzchołków pasa`);
});

test('fillet: klin 30° — narożnik przesuwa się (dziś nie rusza się wcale)', () => {
  const r = 1;
  const mesh = buildWedge(30);
  const apex = apexIndex(mesh);
  const { mesh: out, report } = filletWedge(mesh, r);

  const disp = Math.hypot(
    out.positions[3 * apex], out.positions[3 * apex + 1], out.positions[3 * apex + 2],
  );
  assert.ok(disp > 0.5 * r, `narożnik przesunął się tylko o ${disp.toFixed(6)} mm`);
  // Pełny promień przy 30° jest geometrycznie niemożliwy: narożnik musi się
  // przesunąć o r/sin(θ/2) − r, więc zostaje przycięty do budżetu przemieszczenia.
  assert.ok(
    Math.abs(disp - report.effectiveRadius) < 1e-9,
    `przemieszczenie ${disp.toFixed(9)} vs budżet ${report.effectiveRadius}`,
  );
});

test('fillet: klin 45° — łuk ma promień ≤ zadanego', () => {
  const r = 1;
  const theta = 45 * DEG;
  const sinHalf = Math.sin(theta / 2);
  // Największy promień, przy którym narożnik mieści się w budżecie przemieszczenia:
  // r/sin(θ/2) − r ≤ r  ⇒  r ≤ r·sin(θ/2)/(1 − sin(θ/2)) = 0,62·r.
  const rFeat = Math.min(r, (r * sinHalf) / (1 - sinHalf));
  const axisX = rFeat / sinHalf;

  const mesh = buildWedge(45);
  const { mesh: out } = filletWedge(mesh, r);

  let checked = 0;
  for (let v = 0; v < out.vertexCount; v++) {
    const x = out.positions[3 * v];
    const y = out.positions[3 * v + 1];
    if (Math.hypot(x, y) > 1.5 * r) continue;
    const rho = Math.hypot(x - axisX, y);
    assert.ok(
      Math.abs(rho - rFeat) < 1e-6,
      `wierzchołek ${v} leży w odległości ${rho.toFixed(6)} od osi łuku (oczekiwano ${rFeat.toFixed(6)})`,
    );
    assert.ok(rho <= r + 1e-9, `promień łuku ${rho} jest większy niż zadany ${r}`);
    checked++;
  }
  assert.ok(checked >= 4, `sprawdzono tylko ${checked} wierzchołków pasa`);
});

test('fillet: klin 90° — zachowanie bez zmian', () => {
  const r = 1;
  const mesh = buildWedge(90);
  const apex = apexIndex(mesh);
  const { mesh: out } = filletWedge(mesh, r);
  const disp = Math.hypot(
    out.positions[3 * apex], out.positions[3 * apex + 1], out.positions[3 * apex + 2],
  );
  assert.ok(
    Math.abs(disp - (Math.SQRT2 - 1) * r) < 1e-9,
    `przemieszczenie narożnika ${disp.toFixed(9)}, oczekiwano ${((Math.SQRT2 - 1) * r).toFixed(9)}`,
  );
});

test('fillet: klin 120° i 150° — zachowanie bez zmian', () => {
  const r = 1;
  for (const deg of [120, 150]) {
    const mesh = buildWedge(deg);
    const apex = apexIndex(mesh);
    const { mesh: out } = filletWedge(mesh, r);
    const disp = Math.hypot(
      out.positions[3 * apex], out.positions[3 * apex + 1], out.positions[3 * apex + 2],
    );
    const expected = r / Math.sin((deg * DEG) / 2) - r;
    assert.ok(
      Math.abs(disp - expected) < 1e-9,
      `klin ${deg}°: przemieszczenie ${disp.toFixed(9)}, oczekiwano ${expected.toFixed(9)}`,
    );
  }
});

test('fillet: ostrzeżenie o zbyt ostrym kącie pojawia się w raporcie', () => {
  const mesh = buildWedge(45);
  const { report } = filletWedge(mesh, 1);
  assert.ok(
    report.warnings.join(' ').includes('kąt'),
    `brak ostrzeżenia o kącie: ${report.warnings.join(' | ')}`,
  );
  assert.equal(report.radiusClampReason, 'acute-angle');
});

test('raport: krawędzie faktycznie zaokrąglone (nie "w paście")', () => {
  // Płyta 40×40×4 mm z żebrem 40×1×20 mm wtopionym 2 mm w płytę. Promień 2 mm jest
  // większy niż połowa grubości żebra, więc fillet musiałby przeciąć przeciwległą
  // ścianę żebra — operacja nie może się powieść i musi zostać wycofana.
  //
  // Wcześniej raport głosił "zaokrąglono 21 z 24" (licząc krawędzie mające wierzchołek
  // w paście), a geometria pozostała nietknięta — użytkownik dostawał plik bez
  // zaokrąglenia i komunikat o sukcesie (AUD-004/AUD-007).
  const plate = makeBox(40, 40, 4, 1);
  const rib = makeBox(40, 1, 20, 1);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < plate.positions.length; i += 3) {
    positions.push(plate.positions[i], plate.positions[i + 1], plate.positions[i + 2]);
  }
  for (let i = 0; i < plate.indices.length; i++) indices.push(plate.indices[i]);
  const base = positions.length / 3;
  for (let i = 0; i < rib.positions.length; i += 3) {
    positions.push(rib.positions[i], rib.positions[i + 1], rib.positions[i + 2] + 10);
  }
  for (let i = 0; i < rib.indices.length; i++) indices.push(base + rib.indices[i]);

  const { mesh } = buildMeshFromRaw(Float64Array.from(positions), Int32Array.from(indices));
  const sharp = mesh.edges.filter((e) => e.faces.length === 2 && e.normalAngle > (12 * Math.PI) / 180);
  assert.equal(sharp.length, 24, 'oczekiwano 24 krawędzi płyty i żebra');

  const { report } = roundEdges(mesh, {
    radius: 2,
    segments: 3,
    kind: 'fillet',
    edgeIndices: sharp.map((e) => e.index),
  });

  assert.equal(report.failed, true, 'operacja na żebrze 1 mm musi być oznaczona jako nieudana');
  assert.equal(report.geometryChanged, false, 'geometria nie mogła się zmienić');
  assert.equal(report.edgesRounded, 0, 'żadna krawędź nie została zaokrąglona');
  assert.equal(report.processedEdgeCount, 0, 'licznik musi opisywać stan końcowy, nie pas');
  assert.ok(report.failedEdgeIndices.length > 0, 'muszą być wymienione krawędzie wycofane');
});

test('błąd powierzchni: zmierzony, nie teoretyczny', () => {
  // Model 176 mm z promieniem 0,5 mm: siatka jest za rzadka, żeby odtworzyć łuk,
  // ale raport nie może twierdzić, że błąd wynosi 0,017 mm.
  const box = makeBox(176, 176, 176, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = mesh.edges.filter((e) => e.faces.length === 2 && e.normalAngle > Math.PI / 4);
  const { report } = roundEdges(mesh, {
    radius: 0.5,
    segments: 3,
    kind: 'fillet',
    edgeIndices: edges.map((e) => e.index),
  });
  assert.ok(
    report.measuredSurfaceError > report.chordDeviation,
    `zmierzony błąd ${report.measuredSurfaceError} powinien być większy niż teoretyczny ${report.chordDeviation}`,
  );
});

test('błąd powierzchni: brak pasa daje zero', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const { report } = roundEdges(mesh, {
    radius: 1,
    segments: 3,
    kind: 'fillet',
    edgeIndices: [],
  });
  assert.equal(report.measuredSurfaceError, 0);
});

test('kąt łuku: kąt materiału, nie kąt normalnych', () => {
  const segments = 8;
  // Klin o kącie NORMALNYM 120° (kąt materiału 60°): łuk rozciąga się na 60°,
  // a nie na 120° — inaczej pas jest 2× rzadszy niż trzeba.
  {
    const mesh = buildWedge(60);
    const { report } = filletWedge(mesh, 1, segments);
    const expected = report.effectiveRadius * (1 - Math.cos((60 * DEG) / (2 * segments)));
    assert.ok(
      Math.abs(report.chordDeviation - expected) < 1e-12,
      `chordDeviation ${report.chordDeviation} vs oczekiwane ${expected}`,
    );
  }
  // Klin o kącie MATERIAŁU 120°: łuk ma 120°, ale raport ogranicza kąt do 90°.
  {
    const mesh = buildWedge(120);
    const { report } = filletWedge(mesh, 1, segments);
    const expected = report.effectiveRadius * (1 - Math.cos((90 * DEG) / (2 * segments)));
    assert.ok(
      Math.abs(report.chordDeviation - expected) < 1e-12,
      `chordDeviation ${report.chordDeviation} vs oczekiwane ${expected}`,
    );
  }
});
