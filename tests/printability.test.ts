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

test('nawisy: powierzchnia w dół w powietrzu to nawis; bryła na stole nie', () => {
  const inv = extrudePolygon(SQUARE, -20);
  for (let i = 2; i < inv.positions.length; i += 3) inv.positions[i] += 25;
  const mesh = meshOf(inv);
  const downs = analyzeOverhangs(mesh, 45);
  assert.ok(downs.length > 0, 'powierzchnia w dół w powietrzu musi być nawisem');
  const ups = analyzeOverhangs(meshOf(extrudePolygon(SQUARE, 20)), 45);
  assert.equal(ups.length, 0, 'bryła na stole bez nawisu w dół nie ma nawisów');
});

test('nawisy: prostopadłościan na stole bez nawisów; sufit w powietrzu jest nawisem', () => {
  const mesh = meshOf(extrudePolygon(SQUARE, 20));
  assert.equal(analyzeOverhangs(mesh, 45).length, 0, 'boki pionowe i dno na stole nie są nawisami');
  const inv = extrudePolygon(SQUARE, -20);
  for (let i = 2; i < inv.positions.length; i += 3) inv.positions[i] += 25;
  const invMesh = meshOf(inv);
  const invOverhangs = analyzeOverhangs(invMesh, 45);
  assert.ok(invOverhangs.length > 0, 'sufit w powietrzu wymaga podparcia');
  let expected = 0;
  for (const face of invOverhangs) expected += face.areaMm2;
  assert.ok(Math.abs(overhangAreaMm2(invMesh, 45) - expected) < 1e-9);
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
