/**
 * Testy odległości do przeciwległej powierzchni (`src/utils/meshClearance.ts`).
 *
 * `edgeClearance` to NAJWIĘKSZY promień filletu, który nie zderzy się
 * z przeciwległą ścianą: dla kostki o boku 20 mm daje 10 mm, dla żebra
 * o grubości 1 mm daje 0.5 mm. Wartość musi zależeć od GEOMETRII, a nie
 * od zagęszczenia siatki (AUD-003: limit promienia liczony z siatki zdradza
 * rozdzielczość modelu zamiast rozmiaru cechy).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshFromRaw } from '../src/utils/meshProcessing.ts';
import { buildClearanceGrid } from '../src/utils/meshClearance.ts';
import type { MeshData } from '../src/utils/meshTypes.ts';
import { extrudePolygon, makeBox } from './helpers.ts';

/** Kostka o zadanym podziale na krawędź. */
function boxMesh(sx: number, sy: number, sz: number, subdiv: number): MeshData {
  const raw = makeBox(sx, sy, sz, subdiv);
  return buildMeshFromRaw(raw.positions, raw.indices).mesh;
}

/**
 * Żebro: profil 1 mm (oś X) × 40 mm (oś Y), wyciągnięty o 20 mm w osi Z.
 * Cienka oś to X, żeby środek krawędzi pionowej leżał w |x| = 0.5.
 */
function ribMesh(): MeshData {
  const raw = extrudePolygon(
    [[-0.5, 0], [0.5, 0], [0.5, 40], [-0.5, 40]],
    20,
  );
  return buildMeshFromRaw(raw.positions, raw.indices).mesh;
}

/** Środek krawędzi w współrzędnych modelu. */
function midpointOf(mesh: MeshData, edge: { v0: number; v1: number }): [number, number, number] {
  return [
    (mesh.positions[3 * edge.v0] + mesh.positions[3 * edge.v1]) / 2,
    (mesh.positions[3 * edge.v0 + 1] + mesh.positions[3 * edge.v1 + 1]) / 2,
    (mesh.positions[3 * edge.v0 + 2] + mesh.positions[3 * edge.v1 + 2]) / 2,
  ];
}

// T1 -------------------------------------------------------------------------
test('clearance: kostka 20 mm — krawędź ma wolny odstęp 10 mm', () => {
  const mesh = boxMesh(20, 20, 20, 1);
  const grid = buildClearanceGrid(mesh);

  // 12 krawędzi kostki ma długość 20 mm (pozostałe 6 to przekątne ścian).
  const cubeEdges = mesh.edges.filter((e) => Math.abs(e.length - 20) < 1e-6);
  assert.equal(cubeEdges.length, 12, `kostka ma 12 krawędzi, znaleziono ${cubeEdges.length}`);

  for (const edge of cubeEdges) {
    const clearance = grid.edgeClearance(edge);
    assert.ok(
      Math.abs(clearance - 10) < 0.01,
      `krawędź ${edge.index}: clearance = ${clearance}, oczekiwane 10`,
    );
  }
});

// T2 -------------------------------------------------------------------------
test('clearance: żebro 1 mm — krawędź ma wolny odstęp 0.5 mm', () => {
  const mesh = ribMesh();
  const grid = buildClearanceGrid(mesh);

  // Krawędzie pionowe żebra: długość 20 mm (wysokość wyciągnięcia) i |x| = 0.5.
  const ribEdges = mesh.edges.filter((e) => {
    if (Math.abs(e.length - 20) > 1e-6) return false;
    return Math.abs(Math.abs(midpointOf(mesh, e)[0]) - 0.5) < 1e-6;
  });
  assert.ok(ribEdges.length >= 2, `znaleziono ${ribEdges.length} krawędzi żebra`);

  for (const edge of ribEdges) {
    const clearance = grid.edgeClearance(edge);
    assert.ok(
      Math.abs(clearance - 0.5) < 0.01,
      `krawędź ${edge.index}: clearance = ${clearance}, oczekiwane 0.5`,
    );
  }
});

// T3 -------------------------------------------------------------------------
test('clearance: niezależny od zagęszczenia', () => {
  const maxima: number[] = [];
  for (const subdiv of [1, 8, 16]) {
    const mesh = boxMesh(20, 20, 20, subdiv);
    const grid = buildClearanceGrid(mesh);

    let max = 0;
    for (const edge of mesh.edges) {
      const clearance = grid.edgeClearance(edge);
      assert.ok(Number.isFinite(clearance), `krawędź ${edge.index}: clearance = ${clearance}`);
      if (clearance > max) max = clearance;
    }
    assert.ok(mesh.edges.length > 0, 'mesh bez krawędzi');
    maxima.push(max);
  }

  for (const value of maxima) {
    assert.ok(
      Math.abs(value - 10) / 10 < 0.01,
      `maksymalny clearance = ${value}, oczekiwane 10 (zagęszczenia: ${maxima.join(', ')})`,
    );
  }
  const spread = Math.max(...maxima) - Math.min(...maxima);
  assert.ok(spread / 10 < 0.01, `rozrzut między zagęszczeniami: ${spread}`);
});

// T4 -------------------------------------------------------------------------
test('clearance: promień na zewnątrz nie trafia w nic', () => {
  const mesh = boxMesh(20, 20, 20, 1);
  const grid = buildClearanceGrid(mesh);
  const MAXD = 1000;

  // Promień wychodzący na zewnątrz bryły (wzdłuż +normalnej ściany) nie może
  // trafić w żadną ścianę — zwraca pełny limit.
  for (const edge of mesh.edges) {
    for (const face of edge.faces) {
      const [mx, my, mz] = midpointOf(mesh, edge);
      const distance = grid.rayDistance(
        mx, my, mz,
        mesh.faceNormals[3 * face], mesh.faceNormals[3 * face + 1], mesh.faceNormals[3 * face + 2],
        [], MAXD,
      );
      assert.equal(
        distance, MAXD,
        `promień na zewnątrz krawędzi ${edge.index} trafił w ${distance}`,
      );
    }
  }

  // Pusta bryła (0 trójkątów): żaden promień nie może nic znaleźć ani wywrócić.
  const empty = buildMeshFromRaw(new Float64Array(0), new Int32Array(0)).mesh;
  const emptyGrid = buildClearanceGrid(empty);
  assert.equal(emptyGrid.rayDistance(0, 0, 0, 1, 0, 0, [], MAXD), MAXD);
});

// T5 -------------------------------------------------------------------------
test('clearance: brak NaN', () => {
  const meshes = [boxMesh(20, 20, 20, 4), ribMesh()];
  const directions: Array<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0.3, 0.5, -0.8],
  ];

  for (const mesh of meshes) {
    const grid = buildClearanceGrid(mesh);
    for (const edge of mesh.edges) {
      const clearance = grid.edgeClearance(edge);
      assert.ok(Number.isFinite(clearance), `clearance = ${clearance}`);
      assert.ok(clearance >= 0, `clearance = ${clearance}`);
    }
    for (const [dx, dy, dz] of directions) {
      const distance = grid.rayDistance(0, 0, 0, dx, dy, dz, [], 100);
      assert.ok(Number.isFinite(distance), `rayDistance = ${distance}`);
      assert.ok(distance >= 0, `rayDistance = ${distance}`);
    }
  }
});
