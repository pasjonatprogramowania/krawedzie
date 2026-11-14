/**
 * Testy wybierania krawędzi w podglądzie 3D.
 *
 * Sprawdzają dwie rzeczy, których nie da się wykryć samym podglądem:
 *  - linie krawędzi leżą DOKŁADNIE na krawędziach bryły (także gdy bryła jest
 *    daleko od początku układu współrzędnych — skalowanie obiektu „naprawiało"
 *    to przez przypadkowe przesunięcie),
 *  - kliknięcie w środek dużej płaskiej ściany nie wybiera żadnej krawędzi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMeshFromRaw } from '../src/utils/meshProcessing.ts';
import { buildEdgeLines, pickEdgeIndex } from '../src/utils/viewerPicking.ts';
import { makeBox } from './helpers.ts';

function boxAt(offset: number) {
  const b = makeBox(20, 20, 20, 1);
  const positions = new Float64Array(b.positions.length);
  for (let i = 0; i < b.positions.length; i += 3) {
    positions[i] = b.positions[i] + offset;
    positions[i + 1] = b.positions[i + 1] + offset;
    positions[i + 2] = b.positions[i + 2] + offset;
  }
  return buildMeshFromRaw(positions, b.indices).mesh;
}

test('podgląd: linie krawędzi leżą dokładnie na krawędziach bryły', () => {
  for (const offset of [0, 100]) {
    const mesh = boxAt(offset);
    const lines = buildEdgeLines(mesh, new Set(), null, 30, true);
    assert.ok(lines, 'linie krawędzi muszą powstać');
    const pos = lines.geometry.getAttribute('position');
    // Każdy wierzchołek linii musi być wierzchołkiem siatki (a nie przesuniętym
    // punktem po skalowaniu obiektu).
    let maxOffset = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let best = Infinity;
      for (let v = 0; v < mesh.vertexCount; v++) {
        const d = Math.hypot(
          mesh.positions[3 * v] - x,
          mesh.positions[3 * v + 1] - y,
          mesh.positions[3 * v + 2] - z,
        );
        if (d < best) best = d;
      }
      maxOffset = Math.max(maxOffset, best);
    }
    assert.ok(maxOffset < 1e-4, `przesunięcie ${maxOffset} mm dla offsetu ${offset}`);
    // Skalowanie obiektu przesuwałoby linie względem ścian.
    assert.equal(lines.scale.x, 1);
    assert.equal(lines.scale.y, 1);
    assert.equal(lines.scale.z, 1);
  }
});

test('podgląd: przesunięcie bryły nie zmienia odchyłki linii od krawędzi', () => {
  const near = boxAt(0);
  const far = boxAt(100);
  const measure = (mesh: ReturnType<typeof boxAt>) => {
    const lines = buildEdgeLines(mesh, new Set(), null, 30, true)!;
    const pos = lines.geometry.getAttribute('position');
    let maxOffset = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let best = Infinity;
      for (let v = 0; v < mesh.vertexCount; v++) {
        const d = Math.hypot(
          mesh.positions[3 * v] - x,
          mesh.positions[3 * v + 1] - y,
          mesh.positions[3 * v + 2] - z,
        );
        if (d < best) best = d;
      }
      maxOffset = Math.max(maxOffset, best);
    }
    return maxOffset;
  };
  const a = measure(near);
  const b = measure(far);
  assert.ok(a < 1e-4 && b < 1e-4, `odchyłki: ${a} / ${b}`);
});

test('podgląd: kliknięcie przy krawędzi wybiera tę krawędź', () => {
  const mesh = boxAt(0);
  // Tworzymy trafienie 0,2 mm od środka krawędzi trójkąta (lekko do wnątrza).
  const faceIndex = 0;
  const a = mesh.faces[3 * faceIndex], b = mesh.faces[3 * faceIndex + 1], c = mesh.faces[3 * faceIndex + 2];
  const p = (v: number) => new THREE.Vector3(
    mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2],
  );
  const pa = p(a), pb = p(b), pc = p(c);
  const normal = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa)).normalize();
  const mid = pa.clone().add(pb).multiplyScalar(0.5);
  const point = mid.clone().addScaledVector(normal, -0.2);
  const hit = { point, faceIndex } as unknown as THREE.Intersection;

  const idx = pickEdgeIndex(mesh, hit);
  assert.ok(idx !== null, 'kliknięcie przy krawędzi musi coś wybrać');
  const picked = mesh.edges[idx!];
  const expected = [a, b].every((v) => v === picked.v0 || v === picked.v1)
    || [b, c].every((v) => v === picked.v0 || v === picked.v1)
    || [c, a].every((v) => v === picked.v0 || v === picked.v1);
  assert.ok(expected, `wybrano krawędź ${idx}, która nie należy do trafionej ściany`);
});

test('podgląd: kliknięcie w środek dużej ściany nie wybiera krawędzi', () => {
  const mesh = boxAt(0);
  const faceIndex = 0;
  const p = (v: number) => new THREE.Vector3(
    mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2],
  );
  const centroid = p(mesh.faces[3 * faceIndex])
    .add(p(mesh.faces[3 * faceIndex + 1]))
    .add(p(mesh.faces[3 * faceIndex + 2]))
    .multiplyScalar(1 / 3);
  const hit = { point: centroid, faceIndex } as unknown as THREE.Intersection;
  assert.equal(pickEdgeIndex(mesh, hit), null, 'środek ściany to nie krawędź');
});

test('podgląd: zaznaczona krawędź jest widoczna mimo wysokiego progu kąta', () => {
  const mesh = boxAt(0);
  const edge = mesh.edges.find((e) => e.faces.length === 2)!;
  // Próg 179° oznacza, że żadna krawędź nie jest ostra — ale zaznaczona musi zostać.
  const lines = buildEdgeLines(mesh, new Set([edge.index]), null, 179, false);
  assert.ok(lines, 'zaznaczona krawędź musi być narysowana');
  const pos = lines.geometry.getAttribute('position');
  assert.equal(pos.count, 2, 'narysowana tylko zaznaczona krawędź');
});

test('podgląd: trafienie bez faceIndex zwraca null', () => {
  const mesh = boxAt(0);
  const hit = { point: new THREE.Vector3(0, 0, 10), faceIndex: undefined } as unknown as THREE.Intersection;
  assert.equal(pickEdgeIndex(mesh, hit), null);
});
