import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMeshFromRaw,
  subdivideAllEdges,
  subdivideSelectedEdges,
  signedVolume,
} from '../src/utils/meshProcessing.ts';
import { makeBox, areaOf, manifoldReport, volumeOf } from './helpers.ts';

function asTriples(mesh: { faces: Int32Array }): Int32Array {
  return Int32Array.from(mesh.faces);
}

test('podział liniowy nie zmienia powierzchni ani objętości (sześcian)', () => {
  const box = makeBox(20, 12, 30, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const a0 = areaOf(mesh.positions, asTriples(mesh));
  const v0 = Math.abs(signedVolume(mesh));

  const subdivided = subdivideAllEdges(mesh);
  const a1 = areaOf(subdivided.positions, asTriples(subdivided));
  const v1 = Math.abs(signedVolume(subdivided));

  assert.equal(subdivided.faceCount, mesh.faceCount * 4);
  assert.equal(subdivided.vertexCount, mesh.vertexCount + mesh.edges.length);
  assert.ok(Math.abs(a1 - a0) < 1e-9, `pole ${a0} -> ${a1}`);
  assert.ok(Math.abs(v1 - v0) < 1e-9, `objętość ${v0} -> ${v1}`);
});

test('podział liniowy zachowuje domkniętość i orientację', () => {
  const box = makeBox(20, 12, 30, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const subdivided = subdivideAllEdges(mesh);
  const rep = manifoldReport(subdivided.positions, asTriples(subdivided));
  assert.equal(rep.closed, true);
  assert.equal(rep.boundary, 0);
  assert.equal(rep.nonManifold, 0);
  assert.equal(rep.flippedWinding, 0);
  assert.ok(signedVolume(subdivided) > 0);
});

test('wszystkie 8 wzorów podziału trójkąta (0/1/2/3 krawędzie) są poprawne', () => {
  const box = makeBox(20, 12, 30, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const faceEdges: number[][] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faces[3 * f], b = mesh.faces[3 * f + 1], c = mesh.faces[3 * f + 2];
    const idx: number[] = [];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = u < v ? u * mesh.vertexCount + v : v * mesh.vertexCount + u;
      idx.push(mesh.edgeKeyToIndex.get(key)!);
    }
    faceEdges.push(idx);
  }

  const a0 = areaOf(mesh.positions, asTriples(mesh));
  const v0 = Math.abs(signedVolume(mesh));

  for (let mask = 0; mask < 8; mask++) {
    // Dla maski wybieramy krawędzie z każdej ściany zgodnie z bitami maski —
    // w ten sposób pokrywamy wzory 1→2, 1→3 i 1→4.
    const chosen = new Set<number>();
    for (const triple of faceEdges) {
      for (let k = 0; k < 3; k++) if (mask & (1 << k)) chosen.add(triple[k]);
    }
    const subdivided = subdivideSelectedEdges(mesh, chosen);
    const a1 = areaOf(subdivided.positions, asTriples(subdivided));
    const v1 = Math.abs(signedVolume(subdivided));
    assert.ok(Math.abs(a1 - a0) < 1e-9, `mask ${mask}: pole ${a0} -> ${a1}`);
    assert.ok(Math.abs(v1 - v0) < 1e-9, `mask ${mask}: objętość ${v0} -> ${v1}`);
    assert.ok(signedVolume(subdivided) > 0, `mask ${mask}: orientacja`);
    const rep = manifoldReport(subdivided.positions, asTriples(subdivided));
    assert.equal(rep.closed, true, `mask ${mask}: domknięcie`);
    assert.equal(rep.boundary, 0, `mask ${mask}: krawędzie brzegowe`);
    assert.equal(rep.nonManifold, 0, `mask ${mask}: nie-rozmaitość`);
  }
});

test('podział nie tworzy T-junctions (każda krawędź ma 2 ściany, także na granicy pasa)', () => {
  const box = makeBox(20, 20, 20, 2);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  // Podzielmy tylko krawędzie o indeksie parzystym — maksymalnie "poszarpany" przypadek.
  const chosen = mesh.edges.map((e) => e.index).filter((i) => i % 2 === 0);
  const subdivided = subdivideSelectedEdges(mesh, chosen);
  const rep = manifoldReport(subdivided.positions, asTriples(subdivided));
  assert.equal(rep.boundary, 0, 'brak krawędzi brzegowych = brak T-junctions');
  assert.equal(rep.nonManifold, 0);
  assert.ok(Math.abs(volumeOf(subdivided.positions, asTriples(subdivided)) - 8000) < 1e-9);
});
