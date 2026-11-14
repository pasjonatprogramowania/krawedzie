/**
 * RoundEdge — budowa topologii siatki trójkątnej, walidacja i naprawa.
 *
 * Wszystkie funkcje są odporne na "brudne" dane wejściowe z STL/OBJ/3MF:
 *  - welding wierzchołków oparty o siatkę przestrzenną (bez pułapki kwantyzacji
 *    `toFixed`/`Math.trunc`, która rozdziela punkty bliższe niż tolerancja),
 *  - usuwanie trójkątów zdegenerowanych i zduplikowanych,
 *  - naprawa niespójnego windingu (orientacji ścian),
 *  - pełna diagnostyka gotowości do druku (manifold, Euler, genus, objętość).
 */

import type { EdgeRecord, MeshData, MeshDiagnostics } from './meshTypes.ts';

/** Klucz krawędzi dla pary wierzchołków (v0 < v1). Bezpieczny dla V < ~9e7. */
export function edgeKey(a: number, b: number, vertexCount: number): number {
  return a < b ? a * vertexCount + b : b * vertexCount + a;
}

function hashCell(cx: number, cy: number, cz: number): number {
  let h = Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663) ^ Math.imul(cz | 0, 83492791);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface WeldResult {
  positions: Float64Array;
  faces: Int32Array;
  rawVertexCount: number;
  weldedVertexCount: number;
  degenerateFacesRemoved: number;
  duplicateFacesRemoved: number;
}

/**
 * Scala zduplikowane wierzchołki w "zupie trójkątów" (non-indexed STL) do
 * siatki z indeksowanymi wierzchołkami.
 *
 * Tolerancja `tolerance` jest bezwzględna (w jednostkach modelu). Dwa wierzchołki
 * trafiają do siebie, gdy ich odległość euklidesowa jest <= tolerance. Implementacja
 * używa siatki przestrzennej o boku = tolerance i przegląda 27 sąsiednich komórek,
 * dzięki czemu nie ma aliasingu kubełków znanego z `mergeVertices` three.js.
 */
export function weldTriangleSoup(
  raw: Float64Array,
  tolerance: number,
  facesIn?: Int32Array,
): WeldResult {
  const rawVertexCount = Math.floor(raw.length / 3);
  const tol = Math.max(tolerance, 1e-12);
  const tol2 = tol * tol;
  const inv = 1 / tol;

  const cellMap = new Map<number, number[]>();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const remap = new Int32Array(rawVertexCount);

  const cellOf = (v: number) => Math.floor(v * inv);

  const insert = (index: number) => {
    const cx = cellOf(xs[index]);
    const cy = cellOf(ys[index]);
    const cz = cellOf(zs[index]);
    const key = hashCell(cx, cy, cz);
    const bucket = cellMap.get(key);
    if (bucket) bucket.push(index);
    else cellMap.set(key, [index]);
  };

  const findNear = (x: number, y: number, z: number): number => {
    const cx = cellOf(x);
    const cy = cellOf(y);
    const cz = cellOf(z);
    let best = -1;
    let bestD2 = tol2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          // Komórki poza zakresem int32 nie mogą zawierać punktów: pomiń.
          const bucket = cellMap.get(hashCell(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            const ddx = xs[j] - x;
            const ddy = ys[j] - y;
            const ddz = zs[j] - z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 <= bestD2) {
              bestD2 = d2;
              best = j;
            }
          }
        }
      }
    }
    return best;
  };

  for (let i = 0; i < rawVertexCount; i++) {
    const x = raw[3 * i];
    const y = raw[3 * i + 1];
    const z = raw[3 * i + 2];
    const found = findNear(x, y, z);
    if (found >= 0) {
      remap[i] = found;
    } else {
      const idx = xs.length;
      xs.push(x);
      ys.push(y);
      zs.push(z);
      insert(idx);
      remap[i] = idx;
    }
  }

  const vertexCount = xs.length;
  const positions = new Float64Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[3 * i] = xs[i];
    positions[3 * i + 1] = ys[i];
    positions[3 * i + 2] = zs[i];
  }

  // --- Złożenie ścian (z usuwaniem degeneratów i duplikatów) ---
  const src = facesIn ?? null;
  const triangleCount = src ? Math.floor(src.length / 3) : Math.floor(rawVertexCount / 3);
  const outFaces: number[] = [];
  // Dwupoziomowa mapa unika przepełnienia Number.MAX_SAFE_INTEGER dla > 208k wierzchołków.
  const seen = new Map<number, Set<number>>();
  let degenerateFacesRemoved = 0;
  let duplicateFacesRemoved = 0;

  for (let t = 0; t < triangleCount; t++) {
    const r0 = src ? src[3 * t] : 3 * t;
    const r1 = src ? src[3 * t + 1] : 3 * t + 1;
    const r2 = src ? src[3 * t + 2] : 3 * t + 2;
    const a = remap[r0];
    const b = remap[r1];
    const c = remap[r2];
    if (a === b || b === c || c === a) {
      degenerateFacesRemoved++;
      continue;
    }
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const mid = a + b + c - lo - hi;
    const subKey = mid * vertexCount + hi;
    let bucket = seen.get(lo);
    if (bucket && bucket.has(subKey)) {
      duplicateFacesRemoved++;
      continue;
    }
    if (!bucket) {
      bucket = new Set<number>();
      seen.set(lo, bucket);
    }
    bucket.add(subKey);
    outFaces.push(a, b, c);
  }

  return {
    positions,
    faces: Int32Array.from(outFaces),
    rawVertexCount,
    weldedVertexCount: rawVertexCount - vertexCount,
    degenerateFacesRemoved,
    duplicateFacesRemoved,
  };
}

/**
 * Buduje pełną topologię z siatki o spójnych (zespawanych) wierzchołkach.
 * Usuwa trójkąty o polu poniżej progu względnego (psują normalne i slicery).
 */
export function buildTopology(
  positionsIn: Float64Array,
  facesIn: Int32Array,
  options: { dropDegenerateArea?: number; stats?: { degenerateFacesRemoved: number; duplicateFacesRemoved: number } } = {},
): MeshData {
  let positions = positionsIn;
  let degenerateRemoved = options.stats?.degenerateFacesRemoved ?? 0;
  const duplicateRemoved = options.stats?.duplicateFacesRemoved ?? 0;

  // --- Bbox wstępny do wyznaczenia progu degeneracji ---
  const preBbox = bboxOf(positions, Math.floor(positions.length / 3));
  const diag = Math.hypot(
    preBbox.max[0] - preBbox.min[0],
    preBbox.max[1] - preBbox.min[1],
    preBbox.max[2] - preBbox.min[2],
  );
  const areaEps = options.dropDegenerateArea ?? Math.max(1e-24, (diag * 1e-7) * (diag * 1e-7));

  // --- Normalne i pola ścian + filtr degeneratów ---
  const triCount = Math.floor(facesIn.length / 3);
  const keep = new Uint8Array(triCount);
  const faceNormalsTmp = new Float64Array(triCount * 3);
  const faceAreasTmp = new Float64Array(triCount);
  let faceCount = 0;

  for (let f = 0; f < triCount; f++) {
    const a = facesIn[3 * f];
    const b = facesIn[3 * f + 1];
    const c = facesIn[3 * f + 2];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx = positions[3 * b], by = positions[3 * b + 1], bz = positions[3 * b + 2];
    const cx = positions[3 * c], cy = positions[3 * c + 1], cz = positions[3 * c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = len * 0.5;
    if (!(area > areaEps) || !Number.isFinite(len)) {
      degenerateRemoved++;
      continue;
    }
    keep[f] = 1;
    nx /= len; ny /= len; nz /= len;
    faceNormalsTmp[3 * faceCount] = nx;
    faceNormalsTmp[3 * faceCount + 1] = ny;
    faceNormalsTmp[3 * faceCount + 2] = nz;
    faceAreasTmp[faceCount] = area;
    faceCount++;
  }

  let faces: Int32Array;
  let faceNormals: Float64Array;
  let faceAreas: Float64Array;
  if (faceCount === triCount) {
    faces = facesIn;
    faceNormals = faceNormalsTmp;
    faceAreas = faceAreasTmp;
  } else {
    faces = new Int32Array(faceCount * 3);
    faceNormals = new Float64Array(faceCount * 3);
    faceAreas = new Float64Array(faceCount);
    let w = 0;
    for (let f = 0; f < triCount; f++) {
      if (!keep[f]) continue;
      faces[3 * w] = facesIn[3 * f];
      faces[3 * w + 1] = facesIn[3 * f + 1];
      faces[3 * w + 2] = facesIn[3 * f + 2];
      faceNormals[3 * w] = faceNormalsTmp[3 * w];
      faceNormals[3 * w + 1] = faceNormalsTmp[3 * w + 1];
      faceNormals[3 * w + 2] = faceNormalsTmp[3 * w + 2];
      faceAreas[w] = faceAreasTmp[w];
      w++;
    }
    // Uwaga: faceNormalsTmp był zapisywany gęsto (indeks faceCount), więc powyższe
    // przepisanie "w locie" jest poprawne tylko dlatego, że w <= f zawsze.
  }

  const vertexCount = Math.floor(positions.length / 3);

  // --- Krawędzie ---
  const edgeKeyToIndex = new Map<number, number>();
  const edges: EdgeRecord[] = [];
  /** +1 gdy ściana biegnie v0->v1, -1 gdy v1->v0 (sumujemy po ścianach). */
  const edgeDirectionSum: number[] = [];

  const addHalfEdge = (u: number, v: number, f: number) => {
    const v0 = u < v ? u : v;
    const v1 = u < v ? v : u;
    const key = v0 * vertexCount + v1;
    let idx = edgeKeyToIndex.get(key);
    if (idx === undefined) {
      idx = edges.length;
      edgeKeyToIndex.set(key, idx);
      edges.push({
        index: idx,
        v0,
        v1,
        faces: [],
        normalAngle: 0,
        dihedral: Math.PI,
        isBoundary: false,
        isNonManifold: false,
        isConvex: true,
        length: 0,
      });
      edgeDirectionSum.push(0);
    }
    edges[idx].faces.push(f);
    edgeDirectionSum[idx] += u === v0 ? 1 : -1;
  };

  for (let f = 0; f < faceCount; f++) {
    const a = faces[3 * f];
    const b = faces[3 * f + 1];
    const c = faces[3 * f + 2];
    addHalfEdge(a, b, f);
    addHalfEdge(b, c, f);
    addHalfEdge(c, a, f);
  }

  // --- Klasyfikacja krawędzi ---
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingCount = 0;

  for (let e = 0; e < edges.length; e++) {
    const rec = edges[e];
    const p0 = rec.v0 * 3;
    const p1 = rec.v1 * 3;
    rec.length = Math.hypot(
      positions[p1] - positions[p0],
      positions[p1 + 1] - positions[p0 + 1],
      positions[p1 + 2] - positions[p0 + 2],
    );
    rec.isBoundary = rec.faces.length < 2;
    rec.isNonManifold = rec.faces.length > 2;
    if (rec.isBoundary) boundaryEdgeCount++;
    if (rec.isNonManifold) nonManifoldEdgeCount++;

    if (rec.faces.length === 2) {
      if (edgeDirectionSum[e] !== 0) inconsistentWindingCount++;
      const f0 = rec.faces[0];
      const f1 = rec.faces[1];
      const n0x = faceNormals[3 * f0], n0y = faceNormals[3 * f0 + 1], n0z = faceNormals[3 * f0 + 2];
      const n1x = faceNormals[3 * f1], n1y = faceNormals[3 * f1 + 1], n1z = faceNormals[3 * f1 + 2];
      const dot = Math.max(-1, Math.min(1, n0x * n1x + n0y * n1y + n0z * n1z));
      rec.normalAngle = Math.acos(dot);
      rec.dihedral = Math.PI - rec.normalAngle;
      rec.isConvex = edgeIsConvex(faces, positions, f0, f1, rec.v0);
    }
  }

  // --- CSR sąsiedztwa wierzchołków i ścian ---
  const neighborOffset = new Int32Array(vertexCount + 1);
  const vertexFaceOffset = new Int32Array(vertexCount + 1);
  for (let e = 0; e < edges.length; e++) {
    neighborOffset[edges[e].v0 + 1]++;
    neighborOffset[edges[e].v1 + 1]++;
  }
  for (let f = 0; f < faceCount; f++) {
    vertexFaceOffset[faces[3 * f] + 1]++;
    vertexFaceOffset[faces[3 * f + 1] + 1]++;
    vertexFaceOffset[faces[3 * f + 2] + 1]++;
  }
  for (let i = 0; i < vertexCount; i++) {
    neighborOffset[i + 1] += neighborOffset[i];
    vertexFaceOffset[i + 1] += vertexFaceOffset[i];
  }
  const neighborIndices = new Int32Array(neighborOffset[vertexCount]);
  const vertexFaceIndices = new Int32Array(vertexFaceOffset[vertexCount]);
  const nCursor = neighborOffset.slice(0, vertexCount);
  const fCursor = vertexFaceOffset.slice(0, vertexCount);
  for (let e = 0; e < edges.length; e++) {
    const { v0, v1 } = edges[e];
    neighborIndices[nCursor[v0]++] = v1;
    neighborIndices[nCursor[v1]++] = v0;
  }
  for (let f = 0; f < faceCount; f++) {
    vertexFaceIndices[fCursor[faces[3 * f]]++] = f;
    vertexFaceIndices[fCursor[faces[3 * f + 1]]++] = f;
    vertexFaceIndices[fCursor[faces[3 * f + 2]]++] = f;
  }

  // --- Normalne wierzchołków (ważone polami) ---
  const vertexNormals = new Float64Array(vertexCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const w = faceAreas[f];
    const nx = faceNormals[3 * f] * w;
    const ny = faceNormals[3 * f + 1] * w;
    const nz = faceNormals[3 * f + 2] * w;
    for (let k = 0; k < 3; k++) {
      const v = faces[3 * f + k];
      vertexNormals[3 * v] += nx;
      vertexNormals[3 * v + 1] += ny;
      vertexNormals[3 * v + 2] += nz;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const nx = vertexNormals[3 * v];
    const ny = vertexNormals[3 * v + 1];
    const nz = vertexNormals[3 * v + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      vertexNormals[3 * v] = nx / len;
      vertexNormals[3 * v + 1] = ny / len;
      vertexNormals[3 * v + 2] = nz / len;
    }
  }

  const bboxMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const bboxMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++) {
      const c = positions[3 * v + k];
      if (c < bboxMin[k]) bboxMin[k] = c;
      if (c > bboxMax[k]) bboxMax[k] = c;
    }
  }
  if (vertexCount === 0) {
    bboxMin[0] = bboxMin[1] = bboxMin[2] = 0;
    bboxMax[0] = bboxMax[1] = bboxMax[2] = 0;
  }

  void positions;
  positions = positionsIn;

  const mesh: MeshData & {
    _removed?: { degenerate: number; duplicate: number };
  } = {
    positions,
    faces,
    vertexCount,
    faceCount,
    faceNormals,
    faceAreas,
    vertexNormals,
    edges,
    edgeKeyToIndex,
    neighborOffset,
    neighborIndices,
    vertexFaceOffset,
    vertexFaceIndices,
    bboxMin,
    bboxMax,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    inconsistentWindingCount,
  };
  mesh._removed = { degenerate: degenerateRemoved, duplicate: duplicateRemoved };
  return mesh;
}

/**
 * Test wypukłości krawędzi niezależny od konwencji nawijania:
 * dla obu ścian sprawdzamy, czy wierzchołek przeciwległy do krawędzi leży po
 * ujemnej stronie płaszczyzny drugiej ściany (czyli wewnątrz materiału).
 */
function edgeIsConvex(
  faces: Int32Array,
  positions: Float64Array,
  f0: number,
  f1: number,
  v0: number,
): boolean {
  const o0 = oppositeVertex(faces, f0, v0);
  const o1 = oppositeVertex(faces, f1, v0);
  if (o0 < 0 || o1 < 0) return true;
  const p = 3 * v0;
  const px = positions[p], py = positions[p + 1], pz = positions[p + 2];
  const f0n = faceNormalOf(positions, faces, f0);
  const f1n = faceNormalOf(positions, faces, f1);
  const o0p = 3 * o0;
  const o1p = 3 * o1;
  const d0 = f0n[0] * (positions[o1p] - px) + f0n[1] * (positions[o1p + 1] - py) + f0n[2] * (positions[o1p + 2] - pz);
  const d1 = f1n[0] * (positions[o0p] - px) + f1n[1] * (positions[o0p + 1] - py) + f1n[2] * (positions[o0p + 2] - pz);
  return d0 + d1 < 0;
}

function oppositeVertex(faces: Int32Array, f: number, edgeVertex: number): number {
  const a = faces[3 * f];
  const b = faces[3 * f + 1];
  const c = faces[3 * f + 2];
  if (a !== edgeVertex && b !== edgeVertex) return a;
  if (b !== edgeVertex && c !== edgeVertex) return b;
  if (c !== edgeVertex && a !== edgeVertex) return c;
  // edgeVertex występuje dwa razy — nie powinno się zdarzyć w poprawnej siatce.
  return a === edgeVertex ? b : a;
}

function faceNormalOf(positions: Float64Array, faces: Int32Array, f: number): [number, number, number] {
  const a = 3 * faces[3 * f];
  const b = 3 * faces[3 * f + 1];
  const c = 3 * faces[3 * f + 2];
  const ux = positions[b] - positions[a];
  const uy = positions[b + 1] - positions[a + 1];
  const uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a];
  const vy = positions[c + 1] - positions[a + 1];
  const vz = positions[c + 2] - positions[a + 2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  return [nx, ny, nz];
}

export function bboxOf(positions: Float64Array, vertexCount: number) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++) {
      const c = positions[3 * v + k];
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  if (!Number.isFinite(min[0])) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }
  return { min, max };
}

export function boundingBoxDiagonal(mesh: { bboxMin: [number, number, number]; bboxMax: [number, number, number] }): number {
  return Math.hypot(
    mesh.bboxMax[0] - mesh.bboxMin[0],
    mesh.bboxMax[1] - mesh.bboxMin[1],
    mesh.bboxMax[2] - mesh.bboxMin[2],
  );
}

/**
 * Objętość z twierdzenia o dywergencji (suma czworościanów z początkiem układu).
 * Ma sens tylko dla siatki domkniętej o spójnej orientacji; znak mówi o orientacji.
 *
 * Liczymy względem środka bbox, nie początku układu: dla modeli odsuniętych od
 * origin (typowe dla eksportów z CAD) wyrazy (v0 x v1)·v2 są ogromne i znoszą się
 * nawzajem, co daje katastrofalną utratę precyzji. Objętość jest niezmiennicza
 * względem translacji, więc wynik pozostaje poprawny.
 */
export function signedVolume(mesh: MeshData): number {
  let vol = 0;
  const { positions, faces, faceCount } = mesh;
  const cxm = (mesh.bboxMin[0] + mesh.bboxMax[0]) / 2;
  const cym = (mesh.bboxMin[1] + mesh.bboxMax[1]) / 2;
  const czm = (mesh.bboxMin[2] + mesh.bboxMax[2]) / 2;
  for (let f = 0; f < faceCount; f++) {
    const a = 3 * faces[3 * f];
    const b = 3 * faces[3 * f + 1];
    const c = 3 * faces[3 * f + 2];
    const ax = positions[a] - cxm, ay = positions[a + 1] - cym, az = positions[a + 2] - czm;
    const bx = positions[b] - cxm, by = positions[b + 1] - cym, bz = positions[b + 2] - czm;
    const cx = positions[c] - cxm, cy = positions[c + 1] - cym, cz = positions[c + 2] - czm;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

export function surfaceArea(mesh: MeshData): number {
  let area = 0;
  for (let f = 0; f < mesh.faceCount; f++) area += mesh.faceAreas[f];
  return area;
}

/**
 * Naprawia niespójny winding ścian (BFS po sąsiedztwie przez krawędzie),
 * a następnie odwraca całość, jeśli objętość jest ujemna (normalne do wnętrza).
 * Zwraca nową siatkę (przebudowaną topologię) albo wejściową, gdy nie trzeba nic zmieniać.
 */
export function orientFacesConsistently(mesh: MeshData): MeshData {
  const { faceCount, edges } = mesh;
  if (faceCount === 0) return mesh;

  // Sąsiedztwo ścian przez krawędzie + informacja o spójności.
  // `inconsistent === true` oznacza, że obie ściany biegną krawędzią w TĘ SAMĄ stronę
  // (to jest błąd orientacji), więc sąsiada trzeba odwrócić względem bieżącej ściany.
  const pairs: Array<[number, number, boolean]> = [];
  for (const e of edges) {
    if (e.faces.length !== 2) continue;
    const f0 = e.faces[0];
    const f1 = e.faces[1];
    pairs.push([f0, f1, sameDirection(mesh, e.v0, e.v1, f0, f1)]);
  }
  if (pairs.length === 0) return mesh;

  const head: number[] = new Array(faceCount + 1).fill(0);
  for (const [f0, f1] of pairs) {
    head[f0 + 1]++;
    head[f1 + 1]++;
  }
  for (let i = 0; i < faceCount; i++) head[i + 1] += head[i];
  const cursor = head.slice(0, faceCount);
  const adjFace = new Int32Array(pairs.length * 2);
  const adjSame = new Uint8Array(pairs.length * 2);
  for (const [f0, f1, same] of pairs) {
    adjFace[cursor[f0]] = f1;
    adjSame[cursor[f0]] = same ? 1 : 0;
    cursor[f0]++;
    adjFace[cursor[f1]] = f0;
    adjSame[cursor[f1]] = same ? 1 : 0;
    cursor[f1]++;
  }

  const faces = mesh.faces.slice();
  const flip = new Int8Array(faceCount).fill(-1);
  const queue = new Int32Array(faceCount);
  let needFlip = false;
  for (let seed = 0; seed < faceCount; seed++) {
    if (flip[seed] !== -1) continue;
    flip[seed] = 0;
    let qh = 0;
    let qt = 0;
    queue[qt++] = seed;
    while (qh < qt) {
      const f = queue[qh++];
      for (let i = head[f]; i < head[f + 1]; i++) {
        const g = adjFace[i];
        // adjSame=1 -> ściany niezgodne, więc sąsiad wymaga odwrócenia.
        const want = adjSame[i] ? 1 - flip[f] : flip[f];
        if (flip[g] === -1) {
          flip[g] = want;
          queue[qt++] = g;
        }
      }
    }

    // Sprawdź orientację tej konkretnej składowej spójnej niezależnie od pozostałych.
    let compVol6 = 0;
    for (let q = 0; q < qt; q++) {
      const f = queue[q];
      const a = faces[3 * f];
      const b = flip[f] === 1 ? faces[3 * f + 2] : faces[3 * f + 1];
      const c = flip[f] === 1 ? faces[3 * f + 1] : faces[3 * f + 2];
      const ax = mesh.positions[3 * a], ay = mesh.positions[3 * a + 1], az = mesh.positions[3 * a + 2];
      const bx = mesh.positions[3 * b], by = mesh.positions[3 * b + 1], bz = mesh.positions[3 * b + 2];
      const cx = mesh.positions[3 * c], cy = mesh.positions[3 * c + 1], cz = mesh.positions[3 * c + 2];
      compVol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    const invertComp = compVol6 < 0;
    for (let q = 0; q < qt; q++) {
      const f = queue[q];
      const wantFlip = invertComp ? flip[f] === 0 : flip[f] === 1;
      if (!wantFlip) continue;
      needFlip = true;
      const t = faces[3 * f + 1];
      faces[3 * f + 1] = faces[3 * f + 2];
      faces[3 * f + 2] = t;
    }
  }

  return needFlip ? buildTopology(mesh.positions, faces) : mesh;
}

function sameDirection(mesh: MeshData, v0: number, v1: number, f0: number, f1: number): boolean {
  return faceTraversal(mesh, f0, v0, v1) === faceTraversal(mesh, f1, v0, v1);
}

/** +1 gdy ściana biegnie v0->v1, -1 gdy v1->v0, 0 gdy krawędź nie należy do ściany. */
function faceTraversal(mesh: MeshData, f: number, v0: number, v1: number): number {
  const a = mesh.faces[3 * f];
  const b = mesh.faces[3 * f + 1];
  const c = mesh.faces[3 * f + 2];
  if ((a === v0 && b === v1) || (b === v0 && c === v1) || (c === v0 && a === v1)) return 1;
  if ((b === v0 && a === v1) || (c === v0 && b === v1) || (a === v0 && c === v1)) return -1;
  return 0;
}

/** Pełna diagnostyka gotowości do druku 3D. */
export function computeDiagnostics(
  mesh: MeshData,
  extra: {
    rawVertexCount?: number;
    degenerateFacesRemoved?: number;
    duplicateFacesRemoved?: number;
  } = {},
): MeshDiagnostics {
  const { vertexCount, faceCount, edges } = mesh;
  const edgeCount = edges.length;

  let minEdgeLength = Infinity;
  let maxEdgeLength = 0;
  let totalEdgeLength = 0;
  for (const e of edges) {
    if (e.length < minEdgeLength) minEdgeLength = e.length;
    if (e.length > maxEdgeLength) maxEdgeLength = e.length;
    totalEdgeLength += e.length;
  }
  if (!Number.isFinite(minEdgeLength)) minEdgeLength = 0;

  // Spójne składowe po wierzchołkach.
  const visited = new Uint8Array(vertexCount);
  const stack = new Int32Array(vertexCount);
  let components = 0;
  for (let s = 0; s < vertexCount; s++) {
    if (visited[s]) continue;
    components++;
    let sp = 0;
    stack[sp++] = s;
    visited[s] = 1;
    while (sp > 0) {
      const v = stack[--sp];
      for (let i = mesh.neighborOffset[v]; i < mesh.neighborOffset[v + 1]; i++) {
        const n = mesh.neighborIndices[i];
        if (!visited[n]) {
          visited[n] = 1;
          stack[sp++] = n;
        }
      }
    }
  }

  const euler = vertexCount - edgeCount + faceCount;
  const isClosed = mesh.boundaryEdgeCount === 0 && faceCount > 0;
  const genus = isClosed && components > 0 ? (2 * components - euler) / 2 : 0;

  const size: [number, number, number] = [
    mesh.bboxMax[0] - mesh.bboxMin[0],
    mesh.bboxMax[1] - mesh.bboxMin[1],
    mesh.bboxMax[2] - mesh.bboxMin[2],
  ];

  const warnings: string[] = [];
  if (faceCount === 0) warnings.push('Siatka nie zawiera żadnych poprawnych trójkątów.');
  if (mesh.boundaryEdgeCount > 0) {
    warnings.push(
      `Siatka nie jest domknięta: ${mesh.boundaryEdgeCount} krawędzi brzegowych (dziury). ` +
        'Niektóre slicery mogą dodać niechciane ściany — rozważ naprawę w Narzędziu do druku 3D.',
    );
  }
  if (mesh.nonManifoldEdgeCount > 0) {
    warnings.push(
      `Wykryto ${mesh.nonManifoldEdgeCount} krawędzi nie-rozmaitości (więcej niż 2 ściany). ` +
        'Taki model może się nie ciąć poprawnie.',
    );
  }
  if (mesh.inconsistentWindingCount > 0) {
    warnings.push(
      `Niespójna orientacja ${mesh.inconsistentWindingCount} krawędzi — normalne mogą być miejscami odwrócone. ` +
        'RoundEdge naprawia to automatycznie przed zaokrąglaniem.',
    );
  }
  if ((extra.degenerateFacesRemoved ?? 0) > 0) {
    warnings.push(`Usunięto ${extra.degenerateFacesRemoved} zdegenerowanych trójkątów (zerowe pole).`);
  }
  if ((extra.duplicateFacesRemoved ?? 0) > 0) {
    warnings.push(`Usunięto ${extra.duplicateFacesRemoved} zduplikowanych trójkątów.`);
  }
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) {
    warnings.push('Model jest płaski (jeden z wymiarów = 0) — to nie jest bryła do druku 3D.');
  }
  if (hasNonManifoldVertex(mesh)) {
    warnings.push(
      'Wykryto wierzchołek nie-rozmaitości ("bowtie") — powierzchnia nie jest lokalnie dyskiem.',
    );
  }

  return {
    vertexCount,
    faceCount,
    edgeCount,
    expectedEdgeCountForClosed: (3 * faceCount) / 2,
    isClosed,
    boundaryEdgeCount: mesh.boundaryEdgeCount,
    nonManifoldEdgeCount: mesh.nonManifoldEdgeCount,
    inconsistentWindingCount: mesh.inconsistentWindingCount,
    degenerateFacesRemoved: extra.degenerateFacesRemoved ?? 0,
    duplicateFacesRemoved: extra.duplicateFacesRemoved ?? 0,
    weldedVertexCount: extra.rawVertexCount !== undefined ? Math.max(0, extra.rawVertexCount - vertexCount) : 0,
    eulerCharacteristic: euler,
    connectedComponents: components,
    genus,
    volume: Math.abs(signedVolume(mesh)),
    surfaceArea: surfaceArea(mesh),
    bboxMin: mesh.bboxMin,
    bboxMax: mesh.bboxMax,
    size,
    minEdgeLength,
    averageEdgeLength: edgeCount > 0 ? totalEdgeLength / edgeCount : 0,
    maxEdgeLength,
    warnings,
  };
}

/**
 * Wykrywa wierzchołki, których sąsiedztwo nie jest pojedynczym dyskiem
 * (dwa stożki spotykające się w jednym punkcie = "bowtie").
 */
function hasNonManifoldVertex(mesh: MeshData): boolean {
  const { vertexCount, vertexFaceOffset, vertexFaceIndices, faces } = mesh;
  const stack: number[] = [];
  const seen = new Set<number>();
  for (let v = 0; v < vertexCount; v++) {
    const start = vertexFaceOffset[v];
    const end = vertexFaceOffset[v + 1];
    const deg = end - start;
    if (deg <= 1) continue;
    seen.clear();
    let groups = 0;
    for (let i = start; i < end; i++) {
      const f = vertexFaceIndices[i];
      if (seen.has(f)) continue;
      groups++;
      seen.add(f);
      stack.length = 0;
      stack.push(f);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (let k = 0; k < 3; k++) {
          const nv = faces[3 * cur + k];
          if (nv === v) continue;
          // Ściany współdzielące krawędź (v, nv) należą do tego samego dysku.
          for (let j = vertexFaceOffset[nv]; j < vertexFaceOffset[nv + 1]; j++) {
            const nf = vertexFaceIndices[j];
            if (seen.has(nf)) continue;
            if (!faceContains(faces, nf, v)) continue;
            seen.add(nf);
            stack.push(nf);
          }
        }
      }
    }
    if (groups > 1) return true;
  }
  return false;
}

function faceContains(faces: Int32Array, f: number, v: number): boolean {
  return faces[3 * f] === v || faces[3 * f + 1] === v || faces[3 * f + 2] === v;
}

/** Odległość punktu od odcinka (a, b) wraz z parametrem rzutu. */
export function pointSegmentDistance(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): { distance: number; t: number; x: number; y: number; z: number } {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 0 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
  return { distance: Math.hypot(px - cx, py - cy, pz - cz), t, x: cx, y: cy, z: cz };
}
