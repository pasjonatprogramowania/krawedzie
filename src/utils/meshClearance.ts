/**
 * RoundEdge — odległość od krawędzi do przeciwległej powierzchni.
 *
 * Moduł odpowiada za geometryczny limit promienia filletu (plan
 * `docs/superpowers/plans/2026-11-12-printability-rework.md`, zadanie 1):
 * `edgeClearance(edge)` to NAJWIĘKSZY promień łuku, który nie zderzy się
 * z przeciwległą ścianą. Dla żebra o grubości `w` daje `w/2`, dla krawędzi
 * kostki o boku `a` daje `a/2`.
 *
 * Wartość liczymy z GEOMETRII (promień rzutu na przeciwległą powierzchnię),
 * a nie z długości krawędzi siatki — inaczej zagęszczenie siatki cicho
 * zmniejszałoby promień (AUD-003).
 *
 * Implementacja: jednorodna siatka przestrzenna nad trójkątami + przejście 3D DDA
 * po komórkach + test przecięcia promienia trójkątem (Möller–Trumbore).
 */

import type { EdgeRecord, MeshData } from './meshTypes.ts';

/** Publiczny interfejs modułu (wymagany przez plan, sekcja „Zadanie 1"). */
export interface ClearanceGrid {
  /**
   * Odległość od punktu w kierunku `dir` do najbliższej powierzchni.
   * Trójkąty zawierające którykolwiek z `skipVertices` są pomijane
   * (indeksy wierzchołków, nie pozycje).
   */
  rayDistance(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    skipVertices: readonly number[],
    maxDistance: number,
  ): number;
  /**
   * Wolny odstęp krawędzi: minimalna odległość do powierzchni wzdłuż normalnych
   * obu ścian, podzielona przez 2 (bo fillet wchodzi w materiał promieniem `r`).
   */
  edgeClearance(edge: EdgeRecord): number;
}

/** Tolerancja barycentryczna — łapie przecięcia dokładnie na krawędzi trójkąta. */
const TRI_EPS = 1e-9;
/** Próg „promień jest równoległy do płaszczyzny trójkąta" (skalowany długością krawędzi). */
const PARALLEL_EPS = 1e-12;

/**
 * Buduje siatkę przestrzenną nad trójkątami i udostępnia odpytywanie odległości.
 */
export function buildClearanceGrid(mesh: MeshData): ClearanceGrid {
  const positions = mesh.positions;
  const faces = mesh.faces;
  const vertexCount = mesh.vertexCount;
  const faceNormals = mesh.faceNormals;

  // --- Bbox liczymy z pozycji, nie z mesh.bbox* --- siatki składane ręcznie
  // (np. w testach) nie muszą mieć wypełnionego bbox.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  if (!Number.isFinite(minX)) {
    minX = maxX = minY = maxY = minZ = maxZ = 0;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);

  // --- Rozmiar komórki ---
  // Mediana długości krawędzi mierzy gęstość siatki; `diag/64` gwarantuje
  // maksymalnie 64 komórki na oś (limit pamięci i czasu). Komórka nie może
  // być mniejsza niż 1e-9 (dzielenie przez nią w DDA).
  const lengths: number[] = [];
  for (const edge of mesh.edges) {
    if (Number.isFinite(edge.length) && edge.length > 0) lengths.push(edge.length);
  }
  lengths.sort((a, b) => a - b);
  const medianEdge = lengths.length > 0 ? lengths[lengths.length >> 1] : 0;
  const cs = Math.max(medianEdge, diag / 64, 1e-9);
  const invCs = 1 / cs;

  const nx = Math.max(1, Math.ceil((maxX - minX) / cs));
  const ny = Math.max(1, Math.ceil((maxY - minY) / cs));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cs));

  const clampCell = (value: number, count: number): number =>
    value < 0 ? 0 : value >= count ? count - 1 : value;

  // --- Trójkąty (kompaktowany indeks, degeneraty pomijane) ---
  const total = Math.min(faceCountOf(mesh), Math.floor(faces.length / 3));
  const ta = new Int32Array(total);
  const tb = new Int32Array(total);
  const tc = new Int32Array(total);
  const tv0 = new Float64Array(total * 3);
  const te1 = new Float64Array(total * 3);
  const te2 = new Float64Array(total * 3);
  const tscale = new Float64Array(total);
  const cells = new Map<number, number[]>();
  let triCount = 0;

  for (let f = 0; f < total; f++) {
    const a = faces[3 * f], b = faces[3 * f + 1], c = faces[3 * f + 2];
    if (a < 0 || b < 0 || c < 0) continue;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;

    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx = positions[3 * b], by = positions[3 * b + 1], bz = positions[3 * b + 2];
    const cx = positions[3 * c], cy = positions[3 * c + 1], cz = positions[3 * c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Zerowe pole = trójkąt zdegenerowany — nie ma sensu go testować.
    const nlen = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const l1 = Math.hypot(ux, uy, uz);
    const l2 = Math.hypot(vx, vy, vz);
    if (!(nlen > 0) || !(l1 > 0) || !(l2 > 0)) continue;

    const t = triCount++;
    ta[t] = a; tb[t] = b; tc[t] = c;
    tv0[3 * t] = ax; tv0[3 * t + 1] = ay; tv0[3 * t + 2] = az;
    te1[3 * t] = ux; te1[3 * t + 1] = uy; te1[3 * t + 2] = uz;
    te2[3 * t] = vx; te2[3 * t + 1] = vy; te2[3 * t + 2] = vz;
    tscale[t] = l1 * l2;

    // Trójkąt trafia do KAŻDEJ komórki, którą obejmuje jego AABB — inaczej
    // promień przeciąłby trójkąt, nie odwiedzając jego komórki.
    const loX = Math.min(ax, bx, cx), hiX = Math.max(ax, bx, cx);
    const loY = Math.min(ay, by, cy), hiY = Math.max(ay, by, cy);
    const loZ = Math.min(az, bz, cz), hiZ = Math.max(az, bz, cz);
    const cx0 = clampCell(Math.floor((loX - minX) * invCs), nx);
    const cx1 = clampCell(Math.floor((hiX - minX) * invCs), nx);
    const cy0 = clampCell(Math.floor((loY - minY) * invCs), ny);
    const cy1 = clampCell(Math.floor((hiY - minY) * invCs), ny);
    const cz0 = clampCell(Math.floor((loZ - minZ) * invCs), nz);
    const cz1 = clampCell(Math.floor((hiZ - minZ) * invCs), nz);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = cx + nx * (cy + ny * cz);
          const bucket = cells.get(key);
          if (bucket) bucket.push(t);
          else cells.set(key, [t]);
        }
      }
    }
  }

  // Znaczniki: trójkąt już sprawdzony w bieżącym zapytaniu / wierzchołek do pominięcia.
  const triStamp = new Int32Array(Math.max(1, triCount));
  let triQuery = 0;
  const skipStamp = new Int32Array(Math.max(1, vertexCount));
  let skipQuery = 0;

  // Trafienia bliższe niż `eps` to trafienia we własne ściany (promień startuje
  // na powierzchni), więc je ignorujemy. Skala zależy od rozmiaru modelu.
  const eps = 1e-6 * diag;

  const rayDistance = (
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    skipVertices: readonly number[],
    maxDistance: number,
  ): number => {
    const limit = Number.isFinite(maxDistance) ? Math.max(0, maxDistance) : 0;
    if (limit <= 0) return limit;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return limit;
    const dlen = Math.hypot(dx, dy, dz);
    if (!(dlen > 0) || !Number.isFinite(dlen)) return limit;
    const ux = dx / dlen, uy = dy / dlen, uz = dz / dlen;

    // Wierzchołki do pominięcia oznaczamy po INDEKSACH (nie pozycjach) —
    // pozycje różnych wierzchołków mogą się powtarzać.
    skipQuery++;
    const sq = skipQuery;
    for (let i = 0; i < skipVertices.length; i++) {
      const v = skipVertices[i];
      if (v >= 0 && v < vertexCount) skipStamp[v] = sq;
    }

    // --- Ogranicz promień do skrzyni siatki ---
    let tmin = 0, tmax = limit;
    if (Math.abs(ux) < 1e-15) {
      if (x < minX || x > minX + nx * cs) return limit;
    } else {
      let t1 = (minX - x) / ux;
      let t2 = (minX + nx * cs - x) / ux;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(uy) < 1e-15) {
      if (y < minY || y > minY + ny * cs) return limit;
    } else {
      let t1 = (minY - y) / uy;
      let t2 = (minY + ny * cs - y) / uy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(uz) < 1e-15) {
      if (z < minZ || z > minZ + nz * cs) return limit;
    } else {
      let t1 = (minZ - z) / uz;
      let t2 = (minZ + nz * cs - z) / uz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (tmin > tmax) return limit;

    // --- Przejście 3D DDA po komórkach siatki ---
    const px = x + ux * tmin, py = y + uy * tmin, pz = z + uz * tmin;
    let cx = clampCell(Math.floor((px - minX) * invCs), nx);
    let cy = clampCell(Math.floor((py - minY) * invCs), ny);
    let cz = clampCell(Math.floor((pz - minZ) * invCs), nz);

    let tMaxX = Infinity, tMaxY = Infinity, tMaxZ = Infinity;
    let tDeltaX = Infinity, tDeltaY = Infinity, tDeltaZ = Infinity;
    if (ux > 0) {
      tMaxX = (minX + (cx + 1) * cs - px) / ux;
      tDeltaX = cs / ux;
    } else if (ux < 0) {
      tMaxX = (minX + cx * cs - px) / ux;
      tDeltaX = -cs / ux;
    }
    if (uy > 0) {
      tMaxY = (minY + (cy + 1) * cs - py) / uy;
      tDeltaY = cs / uy;
    } else if (uy < 0) {
      tMaxY = (minY + cy * cs - py) / uy;
      tDeltaY = -cs / uy;
    }
    if (uz > 0) {
      tMaxZ = (minZ + (cz + 1) * cs - pz) / uz;
      tDeltaZ = cs / uz;
    } else if (uz < 0) {
      tMaxZ = (minZ + cz * cs - pz) / uz;
      tDeltaZ = -cs / uz;
    }

    triQuery++;
    const tq = triQuery;
    let t = tmin;
    for (;;) {
      if (cx >= 0 && cx < nx && cy >= 0 && cy < ny && cz >= 0 && cz < nz) {
        const bucket = cells.get(cx + nx * (cy + ny * cz));
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const ti = bucket[i];
            if (triStamp[ti] === tq) continue;
            triStamp[ti] = tq;
            if (skipStamp[ta[ti]] === sq || skipStamp[tb[ti]] === sq || skipStamp[tc[ti]] === sq) {
              continue;
            }

            // --- Möller–Trumbore ---
            const o = 3 * ti;
            const e1x = te1[o], e1y = te1[o + 1], e1z = te1[o + 2];
            const e2x = te2[o], e2y = te2[o + 1], e2z = te2[o + 2];
            const pvx = uy * e2z - uz * e2y;
            const pvy = uz * e2x - ux * e2z;
            const pvz = ux * e2y - uy * e2x;
            const det = e1x * pvx + e1y * pvy + e1z * pvz;
            // Promień równoległy do płaszczyzny trójkąta — brak wiarygodnego przecięcia.
            if (Math.abs(det) <= PARALLEL_EPS * tscale[ti]) continue;
            const invDet = 1 / det;
            const tvx = x - tv0[o], tvy = y - tv0[o + 1], tvz = z - tv0[o + 2];
            const bu = (tvx * pvx + tvy * pvy + tvz * pvz) * invDet;
            if (bu < -TRI_EPS || bu > 1 + TRI_EPS) continue;
            const qvx = tvy * e1z - tvz * e1y;
            const qvy = tvz * e1x - tvx * e1z;
            const qvz = tvx * e1y - tvy * e1x;
            const bv = (ux * qvx + uy * qvy + uz * qvz) * invDet;
            if (bv < -TRI_EPS || bu + bv > 1 + TRI_EPS) continue;
            const hit = (e2x * qvx + e2y * qvy + e2z * qvz) * invDet;
            if (hit <= eps || hit > limit) continue;
            // Komórki odwiedzamy w kolejności rosnącego t, więc pierwsze
            // trafienie jest najbliższe.
            return hit;
          }
        }
      }

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        cx += ux > 0 ? 1 : -1;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else if (tMaxY <= tMaxZ) {
        cy += uy > 0 ? 1 : -1;
        t = tMaxY;
        tMaxY += tDeltaY;
      } else {
        cz += uz > 0 ? 1 : -1;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
      if (t > tmax) break;
    }
    return limit;
  };

  // Promień z krawędzi nie może być dłuższy niż przekątna bbox (obie jego
  // końce leżą w bryle).
  const rayLimit = Math.max(diag, 1e-9);

  const edgeClearance = (edge: EdgeRecord): number => {
    const incident = edge.faces;
    if (!incident || incident.length === 0) return 0;
    const p0 = 3 * edge.v0, p1 = 3 * edge.v1;
    const mx = (positions[p0] + positions[p1]) * 0.5;
    const my = (positions[p0 + 1] + positions[p1 + 1]) * 0.5;
    const mz = (positions[p0 + 2] + positions[p1 + 2]) * 0.5;
    const skip = [edge.v0, edge.v1];

    // Promienie w głąb materiału (wzdłuż -normalnych obu ścian).
    let best = Infinity;
    const count = Math.min(2, incident.length);
    for (let k = 0; k < count; k++) {
      const face = incident[k];
      const distance = rayDistance(
        mx, my, mz,
        -faceNormals[3 * face], -faceNormals[3 * face + 1], -faceNormals[3 * face + 2],
        skip, rayLimit,
      );
      if (distance < best) best = distance;
    }
    if (!Number.isFinite(best)) return 0;
    // Fillet wchodzi w materiał promieniem r, więc dopuszczalny promień
    // to połowa odległości do przeciwległej ściany.
    return best * 0.5;
  };

  return { rayDistance, edgeClearance };
}

/** Liczba ścian siatki (z uwzględnieniem ręcznie zbudowanych MeshData). */
function faceCountOf(mesh: MeshData): number {
  const declared = mesh.faceCount;
  return Number.isFinite(declared) && declared >= 0 ? Math.floor(declared) : mesh.faces.length / 3;
}
