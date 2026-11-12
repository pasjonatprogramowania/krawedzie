/**
 * Testy modułu oceny drukowalności (`src/utils/printability.ts`).
 *
 * Wartości sprawdzamy na konkretnych liczbach z researchu (REQ-001), a nie
 * na zgodności z implementacją. Siatki budujemy helperami z `tests/helpers.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOZZLE_OPTIONS_MM,
  analyzeOverhangs,
  analyzePrintability,
  defaultProfile,
  overhangAreaMm2,
  printRules,
} from '../src/utils/printability.ts';
import { buildTopology, weldTriangleSoup } from '../src/utils/meshTopology.ts';
import { extrudePolygon } from './helpers.ts';
import type { MeshData } from '../src/utils/meshTypes.ts';

/** Kwadrat 20 × 20 mm — profil bryły do wyciągnięcia. */
const SQUARE: Array<[number, number]> = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
];

/** Surowa siatka z helperów testowych. */
interface RawMesh {
  positions: Float64Array;
  indices: Int32Array;
}

/** Siatka z pełną topologią (normalne i pola ścian) z surowych trójkątów. */
function meshOf(raw: RawMesh): MeshData {
  const welded = weldTriangleSoup(raw.positions, 1e-6, raw.indices);
  return buildTopology(welded.positions, welded.faces);
}

/**
 * Zostawia tylko trójkąty, których normalna spełnia warunek `keep(nz)`.
 * Normalną liczymy tu niezależnie (iloczyn wektorów), żeby test nie korzystał
 * z kodu produkcyjnego.
 */
function shellWithNormalZ(raw: RawMesh, keep: (nz: number) => boolean): MeshData {
  const kept: number[] = [];
  for (let f = 0; f < raw.indices.length; f += 3) {
    const a = raw.indices[f];
    const b = raw.indices[f + 1];
    const c = raw.indices[f + 2];
    // Składowa Z normalnej zależy tylko od współrzędnych X/Y.
    const ax = raw.positions[3 * a];
    const ay = raw.positions[3 * a + 1];
    const bx = raw.positions[3 * b];
    const by = raw.positions[3 * b + 1];
    const cx = raw.positions[3 * c];
    const cy = raw.positions[3 * c + 1];
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (keep(nz)) kept.push(a, b, c);
  }
  return buildTopology(raw.positions, Int32Array.from(kept));
}

test('profil drukarki: minimalny promień = 2 × dysza', () => {
  assert.deepEqual(defaultProfile(), { nozzleMm: 0.4, layerHeightMm: 0.2, walls: 2 });

  const rules = printRules({ nozzleMm: 0.4, layerHeightMm: 0.2, walls: 2 });
  assert.equal(rules.minRadiusMm, 0.8, 'próg promienia to 2 × dysza');
  assert.equal(printRules(defaultProfile()).minRadiusMm, 0.8);
  // Próg skaluje się liniowo z dyszą (REQ-001).
  assert.equal(printRules({ nozzleMm: 0.6, layerHeightMm: 0.2, walls: 2 }).minRadiusMm, 1.2);
  assert.equal(printRules({ nozzleMm: 0.25, layerHeightMm: 0.1, walls: 3 }).minRadiusMm, 0.5);
});

test('profil drukarki: minimalna ściana = ściany × ekstruzja', () => {
  const rules = printRules({ nozzleMm: 0.4, layerHeightMm: 0.2, walls: 2 });
  // Szerokość ekstruzji ≈ 1.125 × dysza = 0.45 mm (Prusa), więc 2 ściany = 0.90 mm.
  assert.ok(Math.abs(rules.minWallMm - 0.9) < 1e-12, `minWallMm = ${rules.minWallMm}`);
  // Minimalna średnica otworu to 2 × dysza.
  assert.equal(rules.minHoleMm, 0.8);
  // Jedna ściana = jedna linia ekstruzji.
  const single = printRules({ nozzleMm: 0.4, layerHeightMm: 0.2, walls: 1 });
  assert.ok(Math.abs(single.minWallMm - 0.45) < 1e-12, `minWallMm = ${single.minWallMm}`);
});

test('dysze: dokładnie 11 wartości, 0.2…2.0', () => {
  assert.equal(NOZZLE_OPTIONS_MM.length, 11);
  assert.equal(NOZZLE_OPTIONS_MM[0], 0.2);
  assert.equal(NOZZLE_OPTIONS_MM[NOZZLE_OPTIONS_MM.length - 1], 2.0);
  assert.ok(NOZZLE_OPTIONS_MM.includes(0.4), 'dysza 0.4 mm musi być na liście');
  for (let i = 1; i < NOZZLE_OPTIONS_MM.length; i++) {
    assert.ok(NOZZLE_OPTIONS_MM[i] > NOZZLE_OPTIONS_MM[i - 1], 'dysze muszą być rosnące');
  }
});

test('nawisy: dach kopyłkowy ma nawisy, dno nie', () => {
  // Każda bryła zamknięta ma co najmniej jedną ścianę skierowaną w dół
  // (suma ważonych normalnych zamkniętej siatki jest zerowa), więc porównujemy
  // same powierzchnie: dach = ściana w dół, dno = ściana ku górze.
  const raw = extrudePolygon(SQUARE, 20);
  const inverted = extrudePolygon(SQUARE, -20);

  // Dach: ściana skierowana w dół (normalna -Z) — wymaga podparcia.
  const roof = shellWithNormalZ(raw, (nz) => nz < 0);
  const roofOverhangs = analyzeOverhangs(roof, 45);
  assert.ok(roofOverhangs.length > 0, 'dach skierowany w dół musi być wykryty jako nawis');
  for (const face of roofOverhangs) {
    assert.ok(face.angleFromVerticalDeg > 90, `kąt dachu = ${face.angleFromVerticalDeg}`);
  }

  // Dno: ściana skierowana ku górze (normalna +Z) — drukuje się bez podparcia.
  // W odwróconym odpowiedniku to jest jego dno (na dole bryły).
  const floor = shellWithNormalZ(inverted, (nz) => nz > 0);
  const floorOverhangs = analyzeOverhangs(floor, 45);
  assert.equal(floorOverhangs.length, 0, 'dno skierowane ku górze nie jest nawisem');
});

test('nawisy: raportowane pole jest dodatnie i zgodne z sumą pól ścian', () => {
  const mesh = meshOf(extrudePolygon(SQUARE, 20));
  const overhangs = analyzeOverhangs(mesh, 45);
  assert.ok(overhangs.length > 0, 'pryzma ma ściany wymagające podparcia');

  let expected = 0;
  let total = 0;
  for (let f = 0; f < mesh.faceCount; f++) total += mesh.faceAreas[f];
  for (const face of overhangs) {
    assert.ok(
      Math.abs(face.areaMm2 - mesh.faceAreas[face.faceIndex]) < 1e-12,
      `pole ściany ${face.faceIndex} musi pochodzić z faceAreas`,
    );
    expected += mesh.faceAreas[face.faceIndex];
  }
  assert.ok(expected > 0, 'pole nawisów musi być dodatnie');
  assert.ok(
    Math.abs(overhangAreaMm2(mesh, 45) - expected) < 1e-9,
    `overhangAreaMm2 = ${overhangAreaMm2(mesh, 45)}, suma pól = ${expected}`,
  );
  assert.ok(overhangAreaMm2(mesh, 45) <= total + 1e-12, 'pole nawisów nie przekracza pola bryły');
});

test('raport: promień poniżej minimum generuje ostrzeżenie po polsku', () => {
  const mesh = meshOf(extrudePolygon(SQUARE, 20));
  const profile = defaultProfile();

  const report = analyzePrintability(mesh, profile, { radiusMm: 0.4 });
  assert.equal(report.radiusBelowMinimum, true);
  assert.equal(report.requestedRadiusMm, 0.4);
  assert.equal(report.rules.minRadiusMm, 0.8);

  const warning = report.warnings.find((w) => w.includes('0.8'));
  assert.ok(warning, `brak ostrzeżenia o promieniu: ${JSON.stringify(report.warnings)}`);
  assert.ok(warning.includes('0.40'), 'ostrzeżenie musi podawać aktualny promień');
  assert.ok(warning.includes('Promień'), 'ostrzeżenie musi być po polsku');
  assert.ok(warning.includes('mm'), 'ostrzeżenie musi podawać jednostkę');

  // Powyżej progu nie ma ostrzeżenia o promieniu.
  const ok = analyzePrintability(mesh, profile, { radiusMm: 1.0 });
  assert.equal(ok.radiusBelowMinimum, false);
  assert.equal(ok.warnings.filter((w) => w.includes('Promień')).length, 0);
});

test('raport: brak NaN i pusty model nie wywala funkcji', () => {
  const empty = buildTopology(new Float64Array(0), new Int32Array(0));
  assert.equal(empty.faceCount, 0);

  const report = analyzePrintability(empty, defaultProfile(), { radiusMm: 1 });
  assert.equal(report.overhangFaceCount, 0);
  assert.equal(report.overhangAreaMm2, 0);
  assert.equal(report.radiusBelowMinimum, false);
  assert.ok(Array.isArray(report.warnings));

  const values = [
    report.requestedRadiusMm,
    report.rules.minRadiusMm,
    report.rules.minWallMm,
    report.rules.minHoleMm,
    report.overhangFaceCount,
    report.overhangAreaMm2,
  ];
  for (const value of values) {
    assert.ok(Number.isFinite(value), `wartość ${value} nie jest skończona`);
  }

  assert.equal(analyzeOverhangs(empty, 45).length, 0);
  assert.equal(overhangAreaMm2(empty, 45), 0);
});
