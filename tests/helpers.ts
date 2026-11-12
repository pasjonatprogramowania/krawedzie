/**
 * Pomocnicze konstruktory siatek i miary geometryczne używane w testach.
 * Wszystko liczone niezależnie od kodu produkcyjnego (własne implementacje),
 * aby testy były realną weryfikacją, a nie tautologią.
 */

export interface RawMesh {
  positions: Float64Array;
  indices: Int32Array;
}

/** Siatka prostopadłościanu z `subdiv` podziałów na krawędź (wierzchołki na szwach się dublują). */
export function makeBox(sx: number, sy: number, sz: number, subdiv = 1): RawMesh {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const positions: number[] = [];
  const indices: number[] = [];

  const addFace = (
    ox: number, oy: number, oz: number,
    dux: number, duy: number, duz: number,
    dvx: number, dvy: number, dvz: number,
  ) => {
    const base = positions.length / 3;
    const n = subdiv;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const u = i / n, v = j / n;
        positions.push(ox + dux * u + dvx * v, oy + duy * u + dvy * v, oz + duz * u + dvz * v);
      }
    }
    const at = (i: number, j: number) => base + i * (n + 1) + j;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1));
        indices.push(at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  };

  // +X, -X, +Y, -Y, +Z, -Z (kolejność du/dv dobrana tak, by cross(du,dv) = normalna zewnętrzna)
  addFace(hx, -hy, -hz, 0, 2 * hy, 0, 0, 0, 2 * hz);
  addFace(-hx, -hy, -hz, 0, 0, 2 * hz, 0, 2 * hy, 0);
  addFace(-hx, hy, -hz, 0, 0, 2 * hz, 2 * hx, 0, 0);
  addFace(-hx, -hy, -hz, 2 * hx, 0, 0, 0, 0, 2 * hz);
  addFace(-hx, -hy, hz, 2 * hx, 0, 0, 0, 2 * hy, 0);
  addFace(-hx, -hy, -hz, 0, 2 * hy, 0, 2 * hx, 0, 0);

  return { positions: Float64Array.from(positions), indices: Int32Array.from(indices) };
}

/** Prosta triangulacja wielokąta (ear clipping) — dla wypukłych i wklęsłych konturów. */
function triangulatePolygon(points: Array<[number, number]>): number[] {
  const n = points.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const area2 = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = points[i0], b = points[i1], c = points[i2];
      if (area2(a, b, c) <= 1e-12) continue; // wypukły wierzchołek (CCW)
      let contains = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = points[j];
        const d1 = area2(a, b, p);
        const d2 = area2(b, c, p);
        const d3 = area2(c, a, p);
        if (d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12) { contains = true; break; }
      }
      if (contains) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** Wyciągnięcie wielokąta (CCW w XY) wzdłuż +Z. Domyka bryłę. */
export function extrudePolygon(points: Array<[number, number]>, height: number): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = points.length;

  // Dolna podstawa (normalna -Z) i górna (normalna +Z).
  const bottomBase = 0;
  for (const p of points) positions.push(p[0], p[1], 0);
  const topBase = positions.length / 3;
  for (const p of points) positions.push(p[0], p[1], height);

  const tris = triangulatePolygon(points);
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(bottomBase + tris[i + 2], bottomBase + tris[i + 1], bottomBase + tris[i]);
    indices.push(topBase + tris[i], topBase + tris[i + 1], topBase + tris[i + 2]);
  }

  // Ściany boczne.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const b = positions.length / 3;
    positions.push(points[i][0], points[i][1], 0);
    positions.push(points[j][0], points[j][1], 0);
    positions.push(points[j][0], points[j][1], height);
    positions.push(points[i][0], points[i][1], height);
    // CCW patrząc z zewnątrz
    indices.push(b, b + 1, b + 2);
    indices.push(b, b + 2, b + 3);
  }

  return { positions: Float64Array.from(positions), indices: Int32Array.from(indices) };
}

/** Kształt L z jedną krawędzią wklęsłą (pionową). */
export function makeLShape(armA = 40, armB = 20, height = 20): RawMesh {
  const poly: Array<[number, number]> = [
    [0, 0], [armA, 0], [armA, armB], [armB, armB], [armB, armA], [0, armA],
  ];
  return extrudePolygon(poly, height);
}

// --- Miary geometryczne (niezależne od kodu produkcyjnego) -------------------

export function volumeOf(positions: Float64Array, indices: Int32Array): number {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = 3 * indices[i], b = 3 * indices[i + 1], c = 3 * indices[i + 2];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(vol / 6);
}

export function bboxOf(positions: Float64Array): { min: number[]; max: number[]; size: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function areaOf(positions: Float64Array, indices: Int32Array): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = 3 * indices[i], b = 3 * indices[i + 1], c = 3 * indices[i + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) * 0.5;
  }
  return area;
}

/** Sprawdza, że każda krawędź ma dokładnie 2 ściany (domknięta rozmaitość). */
export function manifoldReport(
  positions: Float64Array,
  indices: Int32Array,
): { closed: boolean; nonManifold: number; boundary: number; flippedWinding: number } {
  const count = new Map<string, number>();
  const dir = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const kk = key(a, b);
      count.set(kk, (count.get(kk) ?? 0) + 1);
      dir.set(kk, (dir.get(kk) ?? 0) + (a < b ? 1 : -1));
    }
  }
  let boundary = 0, nonManifold = 0, flippedWinding = 0;
  for (const [k, v] of count) {
    if (v === 1) boundary++;
    else if (v > 2) nonManifold++;
    else if (dir.get(k) !== 0) flippedWinding++;
  }
  void positions;
  return { closed: boundary === 0 && nonManifold === 0, nonManifold, boundary, flippedWinding };
}

/** Zapisuje siatkę do binarnego STL (niezależna implementacja do testów eksportu). */
export function writeSTL(positions: Float64Array, indices: Int32Array): ArrayBuffer {
  const faceCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + faceCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, faceCount, true);
  let off = 84;
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const v = 3 * indices[3 * f + k];
      view.setFloat32(off + 12 + k * 12, positions[v], true);
      view.setFloat32(off + 16 + k * 12, positions[v + 1], true);
      view.setFloat32(off + 20 + k * 12, positions[v + 2], true);
    }
    off += 50;
  }
  return buffer;
}

/** Odczytuje binarny STL do zupy trójkątów (do testów round-trip eksportu). */
export function readSTL(buffer: ArrayBuffer): RawMesh {
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const positions = new Float64Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    const off = 84 + f * 50 + 12;
    for (let k = 0; k < 3; k++) {
      positions[9 * f + 3 * k] = view.getFloat32(off + k * 12, true);
      positions[9 * f + 3 * k + 1] = view.getFloat32(off + k * 12 + 4, true);
      positions[9 * f + 3 * k + 2] = view.getFloat32(off + k * 12 + 8, true);
    }
  }
  const indices = new Int32Array(faceCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}
