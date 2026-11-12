/**
 * RoundEdge — bezpieczne zaokrąglanie krawędzi (fillet toczny) i ścinanie (chamfer).
 *
 * ALGORYTM (analityczny — nie "smoothing")
 * =======================================================================
 * Fillet toczny o promieniu r jest lokalnie operacją morfologiczną na półprzestrzeniach
 * wyznaczonych przez płaszczyzny ścian przylegających do krawędzi:
 *
 *   krawędź WYPUKŁA (materiał = przecięcie półprzestrzeni) -> OTWARCIE (opening)
 *       solid' = { Σ_i max(d_i + r, 0)²  ≤  r² }
 *
 *   krawędź WKLĘSŁA (materiał = suma półprzestrzeni)       -> DOMKNIĘCIE (closing)
 *       solid' = { Σ_i max(r - d_i, 0)²  ≥  r² }
 *
 * gdzie d_i = znakowana odległość od i-tej płaszczyzny ściany (dodatnia po stronie
 * normalnej zewnętrznej). Powierzchnia wynikowa jest dokładnie łukiem okręgu o promieniu r
 * stycznym do obu płaszczyzn — dla dowolnego kąta dwuściennego.
 *
 * Weryfikacja dla krawędzi 90° (θ = π/2, wypukłej), sprawdzana testami:
 *   • punkt na krawędzi przesuwa się o (√2 − 1)·r ≈ 0.4142·r po dwusiecznej,
 *   • łuk jest styczny do obu ścian w odległości r od krawędzi (setback s = r),
 *   • ubytek objętości na jednostkę długości = r²(1 − π/4) ≈ 0.2146·r².
 *
 * DLACZEGO NIE LAPLACIAN/TAUBIN/HC
 * =======================================================================
 * Filtry smoothingowe nie mają jednostki długości: efektywny promień zależy od gęstości
 * siatki, więc nie da się zagwarantować "0.5 mm". Dodatkowo Laplacian kurczy model
 * (mean-curvature flow), a "naprawa" skurczu przez globalne skalowanie zmienia wszystkie
 * wymiary. Tutaj:
 *   • przemieszczenie każdego wierzchołka jest wyprowadzone analitycznie (dokładny łuk),
 *   • wierzchołki poza pasmem krawędzi pozostają BIT-IDENTYCZNE z wejściem,
 *   • |Δ| ≤ min(r, maxDisplacement) — ruch ograniczony promieniem, niezależny od
 *     gęstości siatki; przy ostrym kącie materiału promień jest dodatkowo przycięty
 *     do wartości, dla której narożnik mieści się w tym budżecie (patrz `rFeat`).
 *
 * ZAGĘSZCZANIE
 * =======================================================================
 * Aby łuk mógł być reprezentowany przez siatkę, pas wokół krawędzi jest adaptacyjnie
 * zagęszczany przez podział krawędzi (1→2, 1→3, 1→4 trójkąty). Podział liniowy (po
 * środkach) jest geometrycznie bezstratny: powierzchnia przed i po jest identyczna,
 * zmienia się wyłącznie topologia. Dzięki temu płaskie ściany zachowują swoje płaszczyzny
 * (a więc i wymiary gabarytowe), a łuk ma wystarczającą liczbę wierzchołków.
 */

import type { EdgeRecord, MeshData, RoundingKind, RoundingOptions, RoundingReport, RoundingResult } from './meshTypes.ts';
import { buildTopology, pointSegmentDistance, signedVolume } from './meshTopology.ts';

const DEG = Math.PI / 180;
/** cos(89°) — próg wykrycia odwrócenia normalnej trójkąta. */
const FLIP_COS = 0.0175;
const MAX_PLANES = 12;

/** Liczba z przecinkiem dziesiętnym — tak, jak komunikaty dla użytkownika. */
function plNum(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Polskie formy liczebnika "krawędź" zależnie od liczby. */
function edgeWords(count: number): { noun: string; verb: string; pronoun: string } {
  if (count === 1) return { noun: 'krawędź', verb: 'ma', pronoun: 'ją' };
  if (count === 3 || count === 4) return { noun: 'krawędzie', verb: 'mają', pronoun: 'je' };
  return { noun: 'krawędzi', verb: 'ma', pronoun: 'je' };
}

interface Feature {
  edgeIndex: number;
  convex: boolean;
  n0x: number; n0y: number; n0z: number; p0x: number; p0y: number; p0z: number;
  n1x: number; n1y: number; n1z: number; p1x: number; p1y: number; p1z: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  phi: number;
  /** Efektywny promień tej cechy — przy ostrym kącie mniejszy niż globalny `size`. */
  rFeat: number;
  reach: number;
  /** Odległość "wzdłuż łańcucha" od wolnego końca dla wierzchołka A (v0) i B (v1). */
  endA: number;
  endB: number;
}

/** Siatka przestrzenna odcinków wzorcowych — zapytania „co jest bliżej niż R". */
export class FeatureGrid {
  private cell: number;
  private buckets = new Map<number, number[]>();
  private entryFeature: number[] = [];
  private entryAABB: number[] = [];
  private stamp: Int32Array;
  private queryId = 0;

  constructor(cellSize: number, featureCount: number) {
    this.cell = Math.max(cellSize, 1e-9);
    this.stamp = new Int32Array(Math.max(1, featureCount)).fill(-1);
  }

  private hash(cx: number, cy: number, cz: number): number {
    let h = Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663) ^ Math.imul(cz | 0, 83492791);
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  insert(feature: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const chunks = Math.max(1, Math.min(4096, Math.ceil(len / this.cell)));
    const inv = 1 / this.cell;
    for (let c = 0; c < chunks; c++) {
      const t0 = c / chunks;
      const t1 = (c + 1) / chunks;
      const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1, z1 = az + (bz - az) * t1;
      const idx = this.entryFeature.length;
      this.entryFeature.push(feature);
      const lo0 = Math.min(x0, x1), lo1 = Math.min(y0, y1), lo2 = Math.min(z0, z1);
      const hi0 = Math.max(x0, x1), hi1 = Math.max(y0, y1), hi2 = Math.max(z0, z1);
      this.entryAABB.push(lo0, lo1, lo2, hi0, hi1, hi2);
      const cx0 = Math.floor(lo0 * inv), cx1 = Math.floor(hi0 * inv);
      const cy0 = Math.floor(lo1 * inv), cy1 = Math.floor(hi1 * inv);
      const cz0 = Math.floor(lo2 * inv), cz1 = Math.floor(hi2 * inv);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const key = this.hash(cx, cy, cz);
            const bucket = this.buckets.get(key);
            if (bucket) bucket.push(idx);
            else this.buckets.set(key, [idx]);
          }
        }
      }
    }
  }

  /** Zwraca unikalne indeksy cech, których AABB jest w zasięgu `radius` od punktu. */
  query(x: number, y: number, z: number, radius: number, out: number[]): number[] {
    out.length = 0;
    this.queryId++;
    const inv = 1 / this.cell;
    const cx0 = Math.floor((x - radius) * inv), cx1 = Math.floor((x + radius) * inv);
    const cy0 = Math.floor((y - radius) * inv), cy1 = Math.floor((y + radius) * inv);
    const cz0 = Math.floor((z - radius) * inv), cz1 = Math.floor((z + radius) * inv);
    const aabb = this.entryAABB;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = this.buckets.get(this.hash(cx, cy, cz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            const b = e * 6;
            if (x < aabb[b] - radius || x > aabb[b + 3] + radius) continue;
            if (y < aabb[b + 1] - radius || y > aabb[b + 4] + radius) continue;
            if (z < aabb[b + 2] - radius || z > aabb[b + 5] + radius) continue;
            const f = this.entryFeature[e];
            if (this.stamp[f] === this.queryId) continue;
            this.stamp[f] = this.queryId;
            out.push(f);
          }
        }
      }
    }
    return out;
  }
}

function smoothstep01(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Minimalna długość krawędzi incydentnej do wierzchołka, z pominięciem krawędzi wzorcowych. */
function computeMinIncidentEdge(mesh: MeshData, isFeatureEdge: Uint8Array): Float64Array {
  const out = new Float64Array(mesh.vertexCount).fill(Infinity);
  for (const e of mesh.edges) {
    if (isFeatureEdge[e.index] || e.length <= 0) continue;
    if (e.length < out[e.v0]) out[e.v0] = e.length;
    if (e.length < out[e.v1]) out[e.v1] = e.length;
  }
  for (const e of mesh.edges) {
    if (e.length <= 0) continue;
    if (!Number.isFinite(out[e.v0])) out[e.v0] = e.length;
    if (!Number.isFinite(out[e.v1])) out[e.v1] = e.length;
  }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
  return out;
}

function edgeIndexFromKey(mesh: MeshData, a: number, b: number): number {
  const key = a < b ? a * mesh.vertexCount + b : b * mesh.vertexCount + a;
  const idx = mesh.edgeKeyToIndex.get(key);
  return idx === undefined ? -1 : idx;
}

/** Dokładna odległość punktu od najbliższego odcinka wzorcowego (z parametrem rzutu). */
function nearestSegment(
  features: Feature[],
  found: number[],
  x: number, y: number, z: number,
  outDistances: Float64Array,
): { index: number; distance: number; t: number } {
  let best = -1;
  let bestD = Infinity;
  let bestT = 0;
  for (let i = 0; i < found.length; i++) {
    const f = features[found[i]];
    const seg = pointSegmentDistance(x, y, z, f.ax, f.ay, f.az, f.bx, f.by, f.bz);
    outDistances[found[i]] = seg.distance;
    if (seg.distance < bestD) {
      bestD = seg.distance;
      best = found[i];
      bestT = seg.t;
    }
  }
  return { index: best, distance: bestD, t: bestT };
}

/** Zagęszcza pas wokół krawędzi wzorcowych przez wielokrotny podział krawędzi. */
function refineBand(
  mesh: MeshData,
  grid: FeatureGrid,
  features: Feature[],
  targetLength: number,
  refineRadius: number,
  maxLevels: number,
  triangleBudget: number,
  origMinEdge: Float64Array,
): { mesh: MeshData; origMinEdge: Float64Array; levels: number; limitedByBudget: boolean } {
  let cur = mesh;
  let curMin = origMinEdge;
  let levels = 0;
  let limitedByBudget = false;
  const candidates: number[] = [];
  const distBuf = new Float64Array(Math.max(features.length, 1));

  for (let level = 0; level < maxLevels; level++) {
    const dist = new Float64Array(cur.vertexCount).fill(Infinity);
    for (let v = 0; v < cur.vertexCount; v++) {
      const x = cur.positions[3 * v];
      const y = cur.positions[3 * v + 1];
      const z = cur.positions[3 * v + 2];
      const found = grid.query(x, y, z, refineRadius, candidates);
      if (found.length === 0) continue;
      dist[v] = nearestSegment(features, found, x, y, z, distBuf).distance;
    }

    const split = new Uint8Array(cur.edges.length);
    let anySplit = false;
    let projectedFaces = 0;
    for (let f = 0; f < cur.faceCount; f++) {
      const a = cur.faces[3 * f];
      const b = cur.faces[3 * f + 1];
      const c = cur.faces[3 * f + 2];
      let n = 0;
      const pairs: Array<[number, number]> = [[a, b], [b, c], [c, a]];
      for (const [u, w] of pairs) {
        const ei = edgeIndexFromKey(cur, u, w);
        if (ei < 0) continue;
        if (split[ei]) { n++; continue; }
        const e = cur.edges[ei];
        if (e.length <= targetLength) continue;
        let mark = dist[e.v0] <= refineRadius || dist[e.v1] <= refineRadius;
        if (!mark) {
          const mx = (cur.positions[3 * e.v0] + cur.positions[3 * e.v1]) * 0.5;
          const my = (cur.positions[3 * e.v0 + 1] + cur.positions[3 * e.v1 + 1]) * 0.5;
          const mz = (cur.positions[3 * e.v0 + 2] + cur.positions[3 * e.v1 + 2]) * 0.5;
          const found = grid.query(mx, my, mz, refineRadius, candidates);
          const dm = found.length === 0 ? Infinity : nearestSegment(features, found, mx, my, mz, distBuf).distance;
          mark = dm <= refineRadius;
        }
        if (mark) { split[ei] = 1; anySplit = true; n++; }
      }
      projectedFaces += n === 0 ? 1 : n === 1 ? 2 : n === 2 ? 3 : 4;
    }

    if (!anySplit) break;
    if (projectedFaces > triangleBudget) {
      // Pas wymagałby więcej trójkątów, niż pozwala budżet: wynik będzie rzadszy,
      // niż wynika to z liczby segmentów. Raportujemy to jawnie (patrz `roundEdges`).
      limitedByBudget = true;
      break;
    }

    const next = splitMarkedEdges(cur, split, curMin);
    cur = next.mesh;
    curMin = next.minEdge;
    levels++;
  }

  return { mesh: cur, origMinEdge: curMin, levels, limitedByBudget };
}

/**
 * Podział zaznaczonych krawędzi z zachowaniem orientacji i bez T-junctions.
 * Wzory 1→2, 1→3, 1→4 zweryfikowane geometrycznie w tests/refinement.test.ts.
 */function splitMarkedEdges(
  mesh: MeshData,
  split: Uint8Array,
  minEdge: Float64Array,
): { mesh: MeshData; minEdge: Float64Array } {
  const newIndexOfEdge = new Int32Array(mesh.edges.length).fill(-1);
  const newPositions: number[] = [];
  const newMin: number[] = [];
  let added = 0;
  for (let e = 0; e < mesh.edges.length; e++) {
    if (!split[e]) continue;
    const rec = mesh.edges[e];
    const a = 3 * rec.v0;
    const b = 3 * rec.v1;
    newIndexOfEdge[e] = mesh.vertexCount + added;
    newPositions.push(
      (mesh.positions[a] + mesh.positions[b]) * 0.5,
      (mesh.positions[a + 1] + mesh.positions[b + 1]) * 0.5,
      (mesh.positions[a + 2] + mesh.positions[b + 2]) * 0.5,
    );
    newMin.push(Math.min(minEdge[rec.v0], minEdge[rec.v1]));
    added++;
  }

  const positions = new Float64Array((mesh.vertexCount + added) * 3);
  positions.set(mesh.positions, 0);
  positions.set(newPositions, mesh.positions.length);
  const outMin = new Float64Array(mesh.vertexCount + added);
  outMin.set(minEdge, 0);
  outMin.set(newMin, mesh.vertexCount);

  const outFaces: number[] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faces[3 * f];
    const b = mesh.faces[3 * f + 1];
    const c = mesh.faces[3 * f + 2];
    const mAB = newIndexOfEdge[edgeIndexFromKey(mesh, a, b)];
    const mBC = newIndexOfEdge[edgeIndexFromKey(mesh, b, c)];
    const mCA = newIndexOfEdge[edgeIndexFromKey(mesh, c, a)];
    const n = (mAB >= 0 ? 1 : 0) + (mBC >= 0 ? 1 : 0) + (mCA >= 0 ? 1 : 0);
    if (n === 0) {
      outFaces.push(a, b, c);
    } else if (n === 1) {
      if (mAB >= 0) outFaces.push(a, mAB, c, mAB, b, c);
      else if (mBC >= 0) outFaces.push(b, mBC, a, mBC, c, a);
      else outFaces.push(c, mCA, b, mCA, a, b);
    } else if (n === 2) {
      if (mAB < 0) {
        // podzielone BC i CA, wspólny wierzchołek c:  X=c, P=b, Q=a
        outFaces.push(b, mBC, mCA, mBC, c, mCA, b, mCA, a);
      } else if (mBC < 0) {
        // podzielone CA i AB, wspólny wierzchołek a:  X=a, P=c, Q=b
        outFaces.push(c, mCA, mAB, mCA, a, mAB, c, mAB, b);
      } else {
        // podzielone AB i BC, wspólny wierzchołek b:  X=b, P=a, Q=c
        outFaces.push(a, mAB, mBC, mAB, b, mBC, a, mBC, c);
      }
    } else {
      outFaces.push(a, mAB, mCA, mAB, b, mBC, mCA, mBC, c, mAB, mBC, mCA);
    }
  }

  const next = buildTopology(positions, Int32Array.from(outFaces));
  return { mesh: next, minEdge: outMin };
}

/**
 * Eksportowane dla testów: jednokrotny podział wybranych krawędzi.
 * Podział liniowy (po środkach) NIE zmienia powierzchni — służy tylko do zagęszczenia
 * siatki w pasie, dzięki czemu łuk filletu ma wystarczającą rozdzielczość.
 */
export function subdivideSelectedEdges(mesh: MeshData, edgeIndices: Iterable<number>): MeshData {
  const split = new Uint8Array(mesh.edges.length);
  for (const ei of edgeIndices) if (mesh.edges[ei]) split[ei] = 1;
  const minEdge = new Float64Array(mesh.vertexCount).fill(1);
  return splitMarkedEdges(mesh, split, minEdge).mesh;
}

/** Eksportowane dla testów: podział wszystkich krawędzi siatki (1→4 na każdej ścianie). */
export function subdivideAllEdges(mesh: MeshData): MeshData {
  return subdivideSelectedEdges(mesh, mesh.edges.map((e) => e.index));
}

/**
 * Bufor roboczy dla rzutu na obszar środków kuli (bez alokacji w pętli po wierzchołkach).
 */
interface FilletWorkspace {
  u: Float64Array;
  lambda: Float64Array;
  rhs: Float64Array;
  gram: Float64Array;
  aug: Float64Array;
  active: Int32Array;
  flag: Uint8Array;
}

function createFilletWorkspace(): FilletWorkspace {
  return {
    u: new Float64Array(MAX_PLANES),
    lambda: new Float64Array(MAX_PLANES),
    rhs: new Float64Array(MAX_PLANES),
    gram: new Float64Array(MAX_PLANES * MAX_PLANES),
    aug: new Float64Array(MAX_PLANES * (MAX_PLANES + 1)),
    active: new Int32Array(MAX_PLANES),
    flag: new Uint8Array(MAX_PLANES),
  };
}

/** Rozwiązuje symetryczny układ G·x = rhs (Gauss z częściowym wyborem). */
function solveSymmetric(G: Float64Array, n: number, rhs: Float64Array, out: Float64Array, aug: Float64Array): boolean {
  const w = n + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug[i * w + j] = G[i * n + j];
    aug[i * w + n] = rhs[i];
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(aug[col * w + col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row * w + col]);
      if (v > best) { best = v; piv = row; }
    }
    if (!(best > 1e-12)) return false;
    if (piv !== col) {
      for (let j = col; j <= n; j++) {
        const t = aug[col * w + j];
        aug[col * w + j] = aug[piv * w + j];
        aug[piv * w + j] = t;
      }
    }
    const d = aug[col * w + col];
    for (let row = col + 1; row < n; row++) {
      const f = aug[row * w + col] / d;
      if (f === 0) continue;
      for (let j = col; j <= n; j++) aug[row * w + j] -= f * aug[col * w + j];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = aug[i * w + n];
    for (let j = i + 1; j < n; j++) s -= aug[i * w + j] * out[j];
    out[i] = s / aug[i * w + i];
    if (!Number.isFinite(out[i])) return false;
  }
  return true;
}

/**
 * FILLET — środek kuli stycznej do wszystkich ścian leży w zbiorze
 *   C = { c : d_i(c) ≤ −r }  (krawędź wypukła, *opening*)
 *   C = { c : d_i(c) ≥ +r }  (krawędź wklęsła,  *closing*)
 * a powierzchnia filletu to zbiór punktów odległych od C o dokładnie r. Dlatego
 * przemieszczenie = rzut punktu na C, a potem zejście na sferę o promieniu r:
 *   Δ = v·(1 − r/|v|),  gdzie v = c* − p.
 * To jest ŚCISŁE dla dowolnego kąta dwuściennego. Wcześniejsza wersja rozwiązywała
 * Σ max(d_i ± r, 0)² = r², co jest okręgiem tylko wtedy, gdy normalne ścian są
 * prostopadłe (dla innych kątów dawało elipsę — patrz tests/rounding.test.ts,
 * „FILLET: dowolny kąt dwuścienny”).
 */

/**
 * Rzut punktu na obszar środków kuli C. Zwraca wektor od punktu do środka
 * (dla krawędzi wklęsłej odwrócony) albo null, gdy punkt już należy do C.
 */
function projectToCenters(
  planes: Float64Array,
  planeCount: number,
  convex: boolean,
  size: number,
  ws: FilletWorkspace,
): Float64Array | null {
  const m = planeCount;
  if (m === 0) return null;

  const { u, lambda, rhs, gram, aug, active, flag } = ws;
  for (let i = 0; i < m; i++) {
    const d = planes[4 * i + 3];
    u[i] = convex ? d + size : size - d;
  }

  // Ograniczenia sprowadzone do postaci n_i·v ≤ −u_i (v = c − p).
  let k = 0;
  flag.fill(0, 0, m);
  for (let i = 0; i < m; i++) {
    if (u[i] > 0) { active[k++] = i; flag[i] = 1; }
  }
  if (k === 0) return null; // punkt już należy do C (nic nie trzeba ruszać)

  let vx = 0, vy = 0, vz = 0;
  let solved = false;
  for (let iter = 0; iter < 4 * m + 8 && k > 0; iter++) {
    for (let a = 0; a < k; a++) {
      const ia = active[a];
      rhs[a] = u[ia];
      for (let b = 0; b < k; b++) {
        const ib = active[b];
        gram[a * k + b] =
          planes[4 * ia] * planes[4 * ib] +
          planes[4 * ia + 1] * planes[4 * ib + 1] +
          planes[4 * ia + 2] * planes[4 * ib + 2];
      }
      lambda[a] = 0;
    }
    if (!solveSymmetric(gram, k, rhs, lambda, aug)) break;
    // Ujemny mnożnik → to ograniczenie nie jest aktywne, usuń najbardziej ujemne.
    let worst = -1;
    let worstVal = -1e-12;
    for (let a = 0; a < k; a++) {
      if (lambda[a] < worstVal) { worstVal = lambda[a]; worst = a; }
    }
    if (worst >= 0) {
      flag[active[worst]] = 0;
      active[worst] = active[k - 1];
      k--;
      continue;
    }
    vx = 0; vy = 0; vz = 0;
    for (let a = 0; a < k; a++) {
      const lam = lambda[a];
      if (lam === 0) continue;
      const ia = active[a];
      vx -= lam * planes[4 * ia];
      vy -= lam * planes[4 * ia + 1];
      vz -= lam * planes[4 * ia + 2];
    }
    // Czy rzut spełnia pozostałe ograniczenia?
    let violated = -1;
    let worstViol = 1e-9 * Math.max(1, size);
    for (let i = 0; i < m; i++) {
      if (flag[i]) continue;
      const slack = planes[4 * i] * vx + planes[4 * i + 1] * vy + planes[4 * i + 2] * vz + u[i];
      if (slack > worstViol) { worstViol = slack; violated = i; }
    }
    if (violated < 0) { solved = true; break; }
    active[k++] = violated;
    flag[violated] = 1;
  }

  if (!solved) {
    // Awaryjnie: pojedyncze najbardziej naruszone ograniczenie (zawsze bezpieczne —
    // daje mniejszy ruch niż pełny rzut, więc nie może złożyć siatki).
    let best = 0;
    for (let i = 1; i < m; i++) if (u[i] > u[best]) best = i;
    if (!(u[best] > 0)) return null;
    const lam = u[best];
    vx = -lam * planes[4 * best];
    vy = -lam * planes[4 * best + 1];
    vz = -lam * planes[4 * best + 2];
  }

  // Wklęsła: ograniczenie było n_i·v ≥ u_i, czyli rozwiązywaliśmy dla v' = −v.
  // Wracamy do wektora „od punktu do środka kuli”.
  if (!convex) { vx = -vx; vy = -vy; vz = -vz; }

  const dist = Math.hypot(vx, vy, vz);
  if (!(dist > 0) || !Number.isFinite(dist)) return null;

  const out = new Float64Array(3);
  out[0] = vx; out[1] = vy; out[2] = vz;
  return out;
}

/**
 * Odległość punktu od idealnej powierzchni filletu (0, gdy punkt już na niej leży).
 * Wydzielone z `computeDisplacement`, żeby zmierzyć błąd powierzchni bez liczenia
 * przemieszczenia po raz drugi.
 */
function distanceToFilletSurface(
  planes: Float64Array,
  planeCount: number,
  convex: boolean,
  size: number,
  ws: FilletWorkspace,
): number | null {
  const v = projectToCenters(planes, planeCount, convex, size, ws);
  if (!v) return null;
  const dist = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(dist)) return null;
  return Math.abs(dist - size);
}

function computeDisplacement(
  planes: Float64Array,
  planeCount: number,
  convex: boolean,
  kind: 'fillet' | 'chamfer',
  size: number,
  ws: FilletWorkspace,
): [number, number, number] | null {
  const m = planeCount;
  if (m === 0) return null;

  if (kind === 'chamfer') {
    let sum = 0;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < m; i++) {
      sum += planes[4 * i + 3];
      sx += planes[4 * i];
      sy += planes[4 * i + 1];
      sz += planes[4 * i + 2];
    }
    const nlen = Math.hypot(sx, sy, sz);
    if (nlen < 1e-12) return null;
    // Płaszczyzna ścinająca: Σ d_i = -size (wypukła) albo +size (wklęsła).
    // Ruch po normalnej Σn: zmiana Σd o s·|Σn|. Znak s mówi, czy wchodzimy w materiał.
    const target = convex ? -size : size;
    if (convex ? sum <= target : sum >= target) return null;
    const s = (target - sum) / nlen;
    return [(sx / nlen) * s, (sy / nlen) * s, (sz / nlen) * s];
  }

  // --- Fillet: rzut na obszar środków kuli --------------------------------
  const v = projectToCenters(planes, planeCount, convex, size, ws);
  if (!v) return null;
  const dist = Math.hypot(v[0], v[1], v[2]);
  // Oba przypadki: punkt leży już na powierzchni (|v| ≤ r) albo jest poza pasmem.
  // Wypukła: |v| ≤ r → punkt wewnątrz bryły idealnej. Wklęsła: |v| ≤ r → punkt poza
  // obszarem dokładanego materiału. Różnica jest tylko w znaku kierunku (wyżej).
  if (dist <= size * (1 + 1e-12)) return null;
  const s = 1 - size / dist;
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** Dane o najbliższej cechy — wypełniane przez `collectPlanes` (bez alokacji w pętli). */
interface NearestInfo {
  /** Indeks najbliższej cechy (-1 gdy punkt jest poza pasem). */
  index: number;
  /** Odległość punktu od odcinka cechy. */
  distance: number;
  /** Parametr rzutu punktu na odcinek cechy. */
  t: number;
  /** Czy cecha jest wypukła. */
  convex: boolean;
  /** Efektywny promień tej cechy. */
  radius: number;
}

/**
 * Zbiera płaszczyzny ograniczające punkt i zapamiętuje najbliższą cechę.
 * Zwraca liczbę zebranych płaszczyzn.
 */
function collectPlanes(
  grid: FeatureGrid,
  features: Feature[],
  x: number, y: number, z: number,
  maxReach: number,
  planes: Float64Array,
  candidates: number[],
  distBuf: Float64Array,
  out: NearestInfo,
): number {
  out.index = -1;
  const found = grid.query(x, y, z, maxReach, candidates);
  if (found.length === 0) return 0;
  const near = nearestSegment(features, found, x, y, z, distBuf);
  if (near.index < 0) return 0;
  const nearest = features[near.index];
  if (near.distance > nearest.reach) return 0;

  out.index = near.index;
  out.distance = near.distance;
  out.t = near.t;
  out.convex = nearest.convex;
  out.radius = nearest.rFeat;

  const convex = nearest.convex;
  let count = 0;
  for (let i = 0; i < found.length && count < MAX_PLANES; i++) {
    const fi = found[i];
    const f = features[fi];
    if (f.convex !== convex) continue;
    if (distBuf[fi] > f.reach) continue;
    const guard = 0.25 * f.reach;
    // Odrzucenie płaszczyzn "drugiej strony" cienkiej ściany — test POŁOŻENIA, nie
    // normalnej wierzchołka: wierzchołek leżący na jednej ze ścian filletu ma
    // normalną tej ściany, więc iloczyn z normalną drugiej ściany wynosi
    // cos(180° − θ) < −0.35 dla każdego θ < 69.5° — druga ściana była odrzucana,
    // ściana nie zjeżdżała na łuk, a powierzchnia była łamaną zamiast łukiem
    // (AUD-002).
    const d0 = (x - f.p0x) * f.n0x + (y - f.p0y) * f.n0y + (z - f.p0z) * f.n0z;
    const d1 = (x - f.p1x) * f.n1x + (y - f.p1y) * f.n1y + (z - f.p1z) * f.n1z;
    if (convex) {
      if (d0 > guard || d1 > guard) continue;
    } else {
      if (d0 < -guard || d1 < -guard) continue;
    }
    if (pushPlane(planes, count, f.n0x, f.n0y, f.n0z, d0)) count++;
    if (count < MAX_PLANES && pushPlane(planes, count, f.n1x, f.n1y, f.n1z, d1)) count++;
  }
  return count;
}

/**
 * Zmierzony błąd powierzchni w paście (AUD-008). `chordDeviation` to teoria dla
 * nieskończonie gęstej siatki; realna powierzchnia to cięciwy, więc błąd mierzymy:
 * dla każdego trójkąta mającego wierzchołek w paście bierzemy środek i liczymy jego
 * odległość od idealnej powierzchni filletu (tymi samymi płaszczyznami, których
 * użył ten wierzchołek).
 */
function measureSurfaceError(
  work: MeshData,
  positions: Float64Array,
  bandPlaneOffset: Int32Array,
  bandPlaneCount: Int32Array,
  bandPlanes: number[],
  featureOfVertex: Int32Array,
  features: Feature[],
  kind: RoundingKind,
  ws: FilletWorkspace,
): number {
  if (kind !== 'fillet') return 0; // pomiar dotyczy powierzchni filletu
  const scratch = new Float64Array(MAX_PLANES * 4);
  let maxErr = 0;
  for (let f = 0; f < work.faceCount; f++) {
    const a = work.faces[3 * f], b = work.faces[3 * f + 1], c = work.faces[3 * f + 2];
    let v = -1;
    if (bandPlaneCount[a] > 0) v = a;
    else if (bandPlaneCount[b] > 0) v = b;
    else if (bandPlaneCount[c] > 0) v = c;
    if (v < 0) continue;
    const fi = featureOfVertex[v];
    if (fi < 0) continue;
    const feat = features[fi];

    // Środek trójkąta w pozycjach końcowych.
    const cx = (positions[3 * a] + positions[3 * b] + positions[3 * c]) / 3;
    const cy = (positions[3 * a + 1] + positions[3 * b + 1] + positions[3 * c + 1]) / 3;
    const cz = (positions[3 * a + 2] + positions[3 * b + 2] + positions[3 * c + 2]) / 3;

    // Płaszczyzny zapisano dla pierwotnej pozycji wierzchołka — przenosimy ich
    // odsunięcie (d) na środek trójkąta.
    const off = bandPlaneOffset[v];
    const count = bandPlaneCount[v];
    const vx = work.positions[3 * v], vy = work.positions[3 * v + 1], vz = work.positions[3 * v + 2];
    for (let i = 0; i < count; i++) {
      const nx = bandPlanes[off + 4 * i], ny = bandPlanes[off + 4 * i + 1], nz = bandPlanes[off + 4 * i + 2];
      scratch[4 * i] = nx;
      scratch[4 * i + 1] = ny;
      scratch[4 * i + 2] = nz;
      scratch[4 * i + 3] = bandPlanes[off + 4 * i + 3] + (cx - vx) * nx + (cy - vy) * ny + (cz - vz) * nz;
    }
    const dist = distanceToFilletSurface(scratch, count, feat.convex, feat.rFeat, ws);
    if (dist === null) continue;
    if (dist > maxErr) maxErr = dist;
  }
  return maxErr;
}

/** Główna operacja: zaokrąglenie lub ścięcie zaznaczonych krawędzi. */
export function roundEdges(mesh: MeshData, options: RoundingOptions): RoundingResult {
  const warnings: string[] = [];
  const kind = options.kind;
  const segments = Math.max(1, Math.min(16, Math.round(options.segments)));
  const flatAngleRad = (options.flatAngleDeg ?? 12) * DEG;
  const triangleBudget = Math.max(
    10_000,
    options.triangleBudget ?? Math.min(2_000_000, Math.max(60_000, mesh.faceCount * 12)),
  );
  const maxLevels = Math.max(0, Math.min(8, options.maxLevels ?? 6));
  const taperEnds = options.taperEnds !== false;

  const volumeBefore = Math.abs(signedVolume(mesh));
  const bboxBefore: [number, number, number] = [
    mesh.bboxMax[0] - mesh.bboxMin[0],
    mesh.bboxMax[1] - mesh.bboxMin[1],
    mesh.bboxMax[2] - mesh.bboxMin[2],
  ];
  const diag = Math.hypot(bboxBefore[0], bboxBefore[1], bboxBefore[2]) || 1;

  const baseReport = (extra: Partial<RoundingReport>): RoundingReport => ({
    kind,
    requestedRadius: options.radius,
    effectiveRadius: 0,
    segments,
    selectedEdgeCount: 0,
    processedEdgeCount: 0,
    skippedFlatEdgeCount: 0,
    skippedBoundaryEdgeCount: 0,
    skippedShortEdgeCount: 0,
    refinementLevels: 0,
    trianglesBefore: mesh.faceCount,
    trianglesAfter: mesh.faceCount,
    movedVertexCount: 0,
    clampedVertexCount: 0,
    relaxedVertexCount: 0,
    revertedVertexCount: 0,
    maxDisplacement: 0,
    rmsDisplacement: 0,
    bboxDelta: [0, 0, 0],
    volumeBefore,
    volumeAfter: volumeBefore,
    volumeChangePercent: 0,
    maxFaceNormalRotationDeg: 0,
    flippedFaceCount: 0,
    degenerateFaceCount: 0,
    chordDeviation: 0,
    bandFacetSize: 0,
    refinementLimitedByBudget: false,
    edgesRounded: 0,
    geometryChanged: false,
    failed: false,
    failedEdgeIndices: [],
    measuredSurfaceError: 0,
    radiusClampReason: null,
    warnings,
    ...extra,
  });

  // --- 1. Wybór krawędzi wzorcowych -----------------------------------------
  const requested = Array.from(options.edgeIndices ?? []);
  const isFeatureEdge = new Uint8Array(mesh.edges.length);
  let skippedFlat = 0;
  let skippedBoundary = 0;
  const chosen: EdgeRecord[] = [];

  for (const ei of requested) {
    const e = mesh.edges[ei];
    if (!e) continue;
    if (e.isBoundary || e.isNonManifold || e.faces.length !== 2) { skippedBoundary++; continue; }
    if (e.normalAngle < flatAngleRad) { skippedFlat++; continue; }
    isFeatureEdge[ei] = 1;
    chosen.push(e);
  }

  if (chosen.length === 0) {
    if (requested.length === 0) {
      warnings.push('Nie zaznaczono żadnej krawędzi — model pozostaje bez zmian.');
    } else {
      warnings.push(
        `Brak krawędzi nadających się do zaokrąglenia: pominięto ${skippedBoundary} krawędzi ` +
        `brzegowych lub nie-rozmaitych oraz ${skippedFlat} krawędzi płaskich.`,
      );
    }
    return { mesh, report: baseReport({ selectedEdgeCount: requested.length, skippedFlatEdgeCount: skippedFlat, skippedBoundaryEdgeCount: skippedBoundary }) };
  }

  // --- 2. Promień efektywny (clamp do lokalnej skali siatki) -----------------
  const minIncident = computeMinIncidentEdge(mesh, isFeatureEdge);
  // Używamy 5. percentyla, nie absolutnego minimum: w realnych plikach STL zdarzają się
  // pojedyncze "słiverowe" krawędzie (0.01 mm), które nie opisują żadnej realnej cechy,
  // a zablokowałyby całą operację.
  const incidentSamples: number[] = [];
  for (const e of chosen) {
    for (const v of [e.v0, e.v1]) {
      const len = minIncident[v];
      if (Number.isFinite(len) && len > 0) incidentSamples.push(len);
    }
  }
  incidentSamples.sort((a, b) => a - b);
  const medianIncident = incidentSamples.length > 0
    ? incidentSamples[Math.floor(0.5 * (incidentSamples.length - 1))]
    : Infinity;
  const minBboxDim = Math.min(bboxBefore[0], bboxBefore[1], bboxBefore[2]) || Infinity;

  const radiusRequested = Math.max(1e-4, options.radius);
  let effectiveRadius = radiusRequested;
  // Górne ograniczenie promienia: mediana lokalnej skali (odporna na pojedyncze
  // "słiverowe" krawędzie, które zablokowałyby całą operację) oraz połowa najmniejszego
  // gabarytu (fillet nie może przekroczyć rozmiaru części).
  const radiusCap = Math.min(0.5 * medianIncident, 0.5 * minBboxDim);
  let radiusClampReason: RoundingReport['radiusClampReason'] = null;
  if (radiusCap < effectiveRadius) {
    effectiveRadius = Math.max(1e-4, radiusCap);
    radiusClampReason = 'edge-length';
    warnings.push(
      `Promień ograniczony do ${effectiveRadius.toFixed(3)} mm (żądano ${radiusRequested.toFixed(2)} mm) — ` +
      'większy promień przekroczyłby lokalną skalę modelu i zniszczył sąsiednie cechy.',
    );
  }
  const size = effectiveRadius;

  // --- 3. Cechy + siatka przestrzenna ---------------------------------------
  let maxReach = size;
  // Kąt łuku filletu to kąt MATERIAŁU θ = π − φ, a nie kąt między normalnymi ścian
  // (AUD-010): dla klina 30° (φ = 150°) pas ma być dzielony na 30°, nie na 150°.
  let minTheta = Math.PI;
  const featureSpecs: Array<Omit<Feature, 'endA' | 'endB'>> = [];
  for (const e of chosen) {
    const f0 = e.faces[0];
    const f1 = e.faces[1];
    const p0x = mesh.positions[3 * e.v0], p0y = mesh.positions[3 * e.v0 + 1], p0z = mesh.positions[3 * e.v0 + 2];
    const phi = Math.max(1e-3, e.normalAngle);
    const theta = Math.PI - phi;
    minTheta = Math.min(minTheta, theta);
    const halfTan = Math.tan(Math.max(theta, 1e-3) * 0.5);
    const setback = halfTan > 1e-6 ? size / halfTan : size * 4;
    const reach = Math.min(Math.max(size, setback), size * 4);
    maxReach = Math.max(maxReach, reach);
    // Największy promień, przy którym narożnik przesunie się o nie więcej niż `size`:
    //   r/sin(θ/2) − r ≤ size  ⇒  r ≤ size·sin(θ/2)/(1 − sin(θ/2))
    // Dla θ ≥ 60° ograniczenie jest bezskuteczne (rMax ≥ size), dla θ = 45° wynosi
    // 0.62·size, dla θ = 30° — 0.35·size (AUD-001).
    const sinHalf = Math.sin(theta / 2);
    const denom = 1 - sinHalf;
    const rMaxAngle = denom > 1e-9 ? (size * sinHalf) / denom : size;
    featureSpecs.push({
      edgeIndex: e.index,
      convex: e.isConvex,
      n0x: mesh.faceNormals[3 * f0], n0y: mesh.faceNormals[3 * f0 + 1], n0z: mesh.faceNormals[3 * f0 + 2],
      p0x, p0y, p0z,
      n1x: mesh.faceNormals[3 * f1], n1y: mesh.faceNormals[3 * f1 + 1], n1z: mesh.faceNormals[3 * f1 + 2],
      p1x: p0x, p1y: p0y, p1z: p0z,
      ax: p0x, ay: p0y, az: p0z,
      bx: mesh.positions[3 * e.v1], by: mesh.positions[3 * e.v1 + 1], bz: mesh.positions[3 * e.v1 + 2],
      phi,
      rFeat: Math.min(size, rMaxAngle),
      reach,
    });
  }

  const chainDistance = taperEnds ? computeChainEndDistance(chosen) : null;
  const features: Feature[] = featureSpecs.map((spec, i) => ({
    ...spec,
    endA: chainDistance ? chainDistance[i * 2] : Infinity,
    endB: chainDistance ? chainDistance[i * 2 + 1] : Infinity,
  }));

  // Kąt materiału poniżej 60° — pełny promień jest geometrycznie niemożliwy:
  // narożnik musiałby się przesunąć o r/sin(θ/2) − r, czyli więcej niż `size`.
  // Zaokrąglamy wtedy mniejszym promieniem i mówimy o tym wprost (AUD-001) — dawniej
  // ostrzeżenie twierdziło, że promień jest mniejszy, a był większy.
  let acuteCount = 0;
  let acuteRadius = Infinity;
  for (const f of features) {
    if (f.rFeat < size - 1e-12) {
      acuteCount++;
      acuteRadius = Math.min(acuteRadius, f.rFeat);
    }
  }
  if (acuteCount > 0) {
    radiusClampReason = 'acute-angle';
    const w = edgeWords(acuteCount);
    warnings.push(
      `${acuteCount} ${w.noun} ${w.verb} kąt zbyt ostry na pełny promień ${plNum(size)} mm — ` +
      `zaokrąglono ${w.pronoun} promieniem ${plNum(acuteRadius)} mm (kąt materiału poniżej 60°).`,
    );
  }

  let taperLength = 0;
  if (chainDistance) {
    let maxEnd = 0;
    for (let i = 0; i < chosen.length; i++) {
      const a = chainDistance[2 * i];
      const b = chainDistance[2 * i + 1];
      if (Number.isFinite(a)) maxEnd = Math.max(maxEnd, a);
      if (Number.isFinite(b)) maxEnd = Math.max(maxEnd, b);
    }
    taperLength = maxEnd > 0 ? Math.min(size, maxEnd * 0.5) : 0;
  }

  // Komórka siatki nie może być mniejsza niż ~1/20000 łącznej długości krawędzi
  // wzorcowych: inaczej długie odcinki rozpadają się na setki tysięcy kawałków
  // i indeksowanie staje się wąskim gardłem. Poprawność zapytań nie zależy od
  // rozmiaru komórki (AABB odcinka trafia do wszystkich przecinanych komórek).
  let totalFeatureLength = 0;
  for (const e of chosen) totalFeatureLength += e.length;
  const gridCell = Math.max(maxReach, totalFeatureLength / 20000, diag * 1e-6);
  const grid = new FeatureGrid(gridCell, features.length);
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    grid.insert(i, f.ax, f.ay, f.az, f.bx, f.by, f.bz);
  }

  // --- 4. Rozdzielczość łuku ------------------------------------------------
  const arcAngle = Math.max(15 * DEG, Math.min(minTheta, Math.PI));
  let targetLength = (size * arcAngle) / segments;
  targetLength = Math.max(targetLength, size * 0.02, diag * 1e-5);
  const refineRadius = maxReach * 1.15 + targetLength * 2;

  // --- 5. Zagęszczenie pasa -------------------------------------------------
  const refined = refineBand(
    mesh, grid, features, targetLength, refineRadius, maxLevels, triangleBudget, minIncident,
  );
  const work = refined.mesh;

  // --- 6. Rzutowanie na powierzchnię filletu --------------------------------
  const displacement = new Float64Array(work.vertexCount * 3);
  const moved = new Uint8Array(work.vertexCount);
  /** Wierzchołki w zasięgu zaokrąglania — do pomiaru realnej rozdzielczości pasa. */
  const inBand = new Uint8Array(work.vertexCount);
  /** Cechy, do której należy wierzchołek — do zliczenia faktycznie zaokrąglonych krawędzi. */
  const featureOfVertex = new Int32Array(work.vertexCount).fill(-1);
  /** Płaszczyzny użyte dla wierzchołków pasa — do pomiaru błędu powierzchni. */
  const bandPlanes: number[] = [];
  const bandPlaneOffset = new Int32Array(work.vertexCount).fill(-1);
  const bandPlaneCount = new Int32Array(work.vertexCount);
  const candidates: number[] = [];
  const distBuf = new Float64Array(Math.max(features.length, 1));
  const planes = new Float64Array(MAX_PLANES * 4);
  const filletWork = createFilletWorkspace();
  const maxDisplacementCap = options.maxDisplacement ?? Infinity;
  const nearInfo: NearestInfo = { index: -1, distance: 0, t: 0, convex: true, radius: size };

  let movedCount = 0;
  let clampedCount = 0;
  let maxDisp = 0;
  let maxRawDisp = 0;
  let sumSq = 0;
  // Twarde ograniczenie przemieszczenia: |Δ| ≤ min(r, cap). Limit oparty na długości
  // krawędzi siatki (0.25·L_min_incident) mylił rozdzielczość siatki z rozmiarem cechy
  // i gwarantował zbyt mały łuk (AUD-003).
  const localLimit = Math.min(size, maxDisplacementCap);

  for (let v = 0; v < work.vertexCount; v++) {
    const px = work.positions[3 * v];
    const py = work.positions[3 * v + 1];
    const pz = work.positions[3 * v + 2];

    const planeCount = collectPlanes(
      grid, features, px, py, pz, maxReach, planes, candidates, distBuf, nearInfo,
    );
    if (nearInfo.index < 0) continue;
    inBand[v] = 1;
    featureOfVertex[v] = nearInfo.index;
    if (planeCount === 0) continue;

    // Zapamiętujemy płaszczyzny wierzchołka — tymi samymi liczymy potem błąd
    // powierzchni trójkątów pasa (AUD-008).
    bandPlaneOffset[v] = bandPlanes.length;
    bandPlaneCount[v] = planeCount;
    for (let i = 0; i < planeCount * 4; i++) bandPlanes.push(planes[i]);

    const convex = nearInfo.convex;
    // Promień efektywny TEJ cechy: przy ostrym kącie materiału pełny promień jest
    // geometrycznie niemożliwy (narożnik musiałby się przesunąć o r/sin(θ/2) − r),
    // więc używamy mniejszego promienia zgodnego z budżetem przemieszczenia.
    const rFeat = kind === 'fillet' ? nearInfo.radius : size;
    const delta = computeDisplacement(planes, planeCount, convex, kind, rFeat, filletWork);
    if (!delta) continue;

    let dx = delta[0], dy = delta[1], dz = delta[2];

    // Wygaszanie na końcach łańcuchów krawędzi (fillet "run-out").
    if (taperLength > 0) {
      const f = features[nearInfo.index];
      const along = f.endA + (f.endB - f.endA) * nearInfo.t;
      if (Number.isFinite(along)) {
        const w = smoothstep01(along / taperLength);
        if (w <= 0) continue;
        dx *= w; dy *= w; dz *= w;
      }
    }

    let len = Math.hypot(dx, dy, dz);
    if (len > maxRawDisp) maxRawDisp = len;
    if (len > localLimit && len > 0) {
      const k = localLimit / len;
      dx *= k; dy *= k; dz *= k;
      len = localLimit;
      clampedCount++;
    }
    if (!(len > 0) || !Number.isFinite(len)) continue;

    displacement[3 * v] = dx;
    displacement[3 * v + 1] = dy;
    displacement[3 * v + 2] = dz;
    moved[v] = 1;
    movedCount++;
    sumSq += len * len;
    if (len > maxDisp) maxDisp = len;
  }

  // Realna rozdzielczość pasa: najdłuższa krawędź, której choć jeden koniec leży
  // w zasięgu zaokrąglania. To ona — a nie liczba segmentów — decyduje o tym, jak
  // wiernie siatka odtwarza łuk.
  let bandFacetSize = 0;
  for (const e of work.edges) {
    if (!inBand[e.v0] && !inBand[e.v1]) continue;
    if (e.length > bandFacetSize) bandFacetSize = e.length;
  }

  if (movedCount === 0) {
    warnings.push(
      'Nie znaleziono wierzchołków wymagających przesunięcia — promień jest mniejszy niż ' +
      'lokalna rozdielczość siatki. Zwiększ promień lub liczbę segmentów.',
    );
    return {
      mesh,
      report: baseReport({
        effectiveRadius: size,
        selectedEdgeCount: requested.length,
        skippedFlatEdgeCount: skippedFlat,
        skippedBoundaryEdgeCount: skippedBoundary,
        refinementLevels: refined.levels,
        refinementLimitedByBudget: refined.limitedByBudget,
        bandFacetSize,
        trianglesAfter: work.faceCount,
        failed: true,
      }),
    };
  }

  // --- 7. Zastosowanie przemieszczeń z ochroną przed flipami ----------------
  const beforeNormals = work.faceNormals.slice();
  const scale = new Float64Array(work.vertexCount).fill(1);
  const newPositions = work.positions.slice();
  const areaLimit = Math.max(1e-24, (diag * 1e-7) * (diag * 1e-7));

  const applyDisplacements = () => {
    for (let v = 0; v < work.vertexCount; v++) {
      if (!moved[v]) continue;
      const k = scale[v];
      newPositions[3 * v] = work.positions[3 * v] + displacement[3 * v] * k;
      newPositions[3 * v + 1] = work.positions[3 * v + 1] + displacement[3 * v + 1] * k;
      newPositions[3 * v + 2] = work.positions[3 * v + 2] + displacement[3 * v + 2] * k;
    }
  };

  let relaxedCount = 0;
  let revertedCount = 0;
  const normalBuf = new Float64Array(work.faceCount * 3);
  const areaBuf = new Float64Array(work.faceCount);

  const collectBadFaces = (): number[] => {
    const bad: number[] = [];
    for (let f = 0; f < work.faceCount; f++) {
      if (areaBuf[f] <= areaLimit) { bad.push(f); continue; }
      const dot =
        normalBuf[3 * f] * beforeNormals[3 * f] +
        normalBuf[3 * f + 1] * beforeNormals[3 * f + 1] +
        normalBuf[3 * f + 2] * beforeNormals[3 * f + 2];
      if (!(dot > FLIP_COS)) bad.push(f);
    }
    return bad;
  };

  // Pętla naprawcza: najpierw łagodzimy przemieszczenia (×0.5), a od 7. przebiegu
  // wycofujemy wierzchołki do pozycji pierwotnej. Stan wyjściowy nie ma flipów,
  // więc proces zawsze zbiega.
  for (let pass = 0; pass < 16; pass++) {
    applyDisplacements();
    computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
    const bad = collectBadFaces();
    if (bad.length === 0) break;
    const revert = pass >= 6;
    for (const f of bad) {
      for (let k = 0; k < 3; k++) {
        const v = work.faces[3 * f + k];
        if (!moved[v]) continue;
        if (revert) {
          if (scale[v] !== 0) { scale[v] = 0; revertedCount++; }
        } else if (scale[v] > 0) {
          scale[v] *= 0.5;
          relaxedCount++;
        }
      }
    }
  }

  // Ostateczna gwarancja bezpieczeństwa: jeśli mimo wszystko zostały złe ściany,
  // wycofujemy wszystkie przemieszczenia (wynik = wejście, tylko zagęszczone).
  applyDisplacements();
  computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
  if (collectBadFaces().length > 0) {
    scale.fill(0);
    applyDisplacements();
    computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
    warnings.push(
      'Nie udało się wygenerować poprawnego zaokrąglenia dla tych krawędzi — ' +
      'przywrócono pierwotną geometrię. Zmniejsz promień albo liczbę segmentów.',
    );
  }
  // --- Stan końcowy: co NAPRAWDĘ zostało zaokrąglone -------------------------
  // Liczymy po fakcie: "przesunięty" to wierzchołek, który w wyniku końcowym ma
  // scale > 0. Wcześniejszy licznik liczył krawędzie mające wierzchołek w paście
  // (AUD-004/AUD-007): raportował "zaokrąglono 21 z 24", a nie ruszył się żaden
  // wierzchołek.
  let movedFinalCount = 0;
  const featureMoved = new Uint8Array(features.length);
  const featureAssigned = new Int32Array(features.length);
  const featureReverted = new Int32Array(features.length);
  for (let v = 0; v < work.vertexCount; v++) {
    if (!moved[v]) continue;
    const fi = featureOfVertex[v];
    if (fi < 0) continue;
    featureAssigned[fi]++;
    if (scale[v] <= 0) { featureReverted[fi]++; continue; }
    movedFinalCount++;
    featureMoved[fi] = 1;
  }
  let edgesRounded = 0;
  for (let i = 0; i < features.length; i++) if (featureMoved[i]) edgesRounded++;
  const failedEdgeIndices: number[] = [];
  for (let i = 0; i < features.length; i++) {
    if (featureAssigned[i] > 0 && featureAssigned[i] === featureReverted[i]) {
      failedEdgeIndices.push(features[i].edgeIndex);
    }
  }
  const geometryChanged = movedFinalCount > 0;
  // Wycofanie wszystkiego = brak przesuniętych wierzchołków = operacja nieskuteczna.
  const failed = !geometryChanged;

  const resultMesh = buildTopology(newPositions, work.faces);

  // Zmierzony (nie teoretyczny) błąd powierzchni w paście: `chordDeviation` to
  // teoria dla nieskończonie gęstej siatki, a realna powierzchnia to cięciwy (AUD-008).
  const measuredSurfaceError = measureSurfaceError(
    work, newPositions, bandPlaneOffset, bandPlaneCount, bandPlanes, featureOfVertex,
    features, kind, filletWork,
  );

  // --- 8. Weryfikacja i raport ---------------------------------------------
  let flipped = 0;
  let degenerate = 0;
  let maxRot = 0;
  for (let f = 0; f < resultMesh.faceCount; f++) {
    if (resultMesh.faceAreas[f] <= areaLimit) { degenerate++; continue; }
    const dot = Math.max(-1, Math.min(1,
      resultMesh.faceNormals[3 * f] * beforeNormals[3 * f] +
      resultMesh.faceNormals[3 * f + 1] * beforeNormals[3 * f + 1] +
      resultMesh.faceNormals[3 * f + 2] * beforeNormals[3 * f + 2]));
    const rot = Math.acos(dot) / DEG;
    if (rot > maxRot) maxRot = rot;
    if (dot <= 0) flipped++;
  }

  const volumeAfter = Math.abs(signedVolume(resultMesh));
  const bboxAfter: [number, number, number] = [
    resultMesh.bboxMax[0] - resultMesh.bboxMin[0],
    resultMesh.bboxMax[1] - resultMesh.bboxMin[1],
    resultMesh.bboxMax[2] - resultMesh.bboxMin[2],
  ];
  const bboxDelta: [number, number, number] = [
    bboxAfter[0] - bboxBefore[0],
    bboxAfter[1] - bboxBefore[1],
    bboxAfter[2] - bboxBefore[2],
  ];

  const chordDeviation = size * (1 - Math.cos(Math.min(Math.PI / 2, arcAngle) / (2 * segments)));

  if (degenerate > 0) warnings.push(`Powstało ${degenerate} zdegenerowanych trójkątów — zmniejsz promień.`);
  if (flipped > 0) warnings.push(`Wykryto ${flipped} odwróconych trójkątów — zmniejsz promień.`);
  if (revertedCount > 0) {
    warnings.push(
      `${revertedCount} wierzchołków wycofano do pozycji pierwotnej, aby uniknąć samoprzecięć ` +
      '(lokalnie promień był zbyt duży).',
    );
  }
  if (clampedCount > 0) {
    // Podajemy konkretne liczby: limit przemieszczenia i zadany promień. Dawniej
    // ostrzeżenie twierdziło bezwarunkowo, że promień jest "mniejszy niż zadany",
    // a przy ostrym kącie był większy (AUD-001).
    warnings.push(
      `${clampedCount} wierzchołków miało przemieszczenie ograniczone do ${plNum(localLimit, 3)} mm ` +
      `(największe z ${plNum(maxRawDisp, 3)} mm) — łuk jest tam płytszy niż zadany ` +
      `${plNum(radiusRequested)} mm.`,
    );
  }
  if (relaxedCount > 0 && revertedCount === 0) {
    warnings.push(
      `${relaxedCount} wierzchołków wymagało dodatkowego zmniejszenia przemieszczenia, aby nie złożyć ` +
      'siatki (bardzo ostry kąt albo ciasne sąsiedztwo krawędzi) — łuk jest tam płytszy niż zadany promień.',
    );
  }
  if (skippedBoundary > 0) warnings.push(`Pominięto ${skippedBoundary} krawędzi brzegowych lub nie-rozmaitych.`);
  if (skippedFlat > 0) warnings.push(`Pominięto ${skippedFlat} krawędzi płaskich (poniżej progu kąta).`);
  if (chordDeviation > 0.05) {
    warnings.push(
      `Teoretyczna odchyłka łuku ≈ ${chordDeviation.toFixed(3)} mm — zwiększ liczbę segmentów dla gładszej powierzchni.`,
    );
  }
  // Rozdzielczość pasa jest równie ważna jak liczba segmentów: dopóki ściany w pasie są
  // większe od promienia, siatka nie jest w stanie wiernie odtworzyć łuku i o odchyłce
  // decyduje gęstość siatki, a nie ustawienie segmentów.
  if (bandFacetSize > 2 * size && movedCount > 0) {
    warnings.push(
      `Siatka wokół krawędzi ma ściany do ${bandFacetSize.toFixed(2)} mm, a promień łuku to ` +
      `${size.toFixed(3)} mm. O rzeczywistej odchyłce powierzchni decyduje więc gęstość siatki, a nie ` +
      `liczba segmentów: jest ona ograniczona przez maksymalne przesunięcie wierzchołka ` +
      `(${maxDisp.toFixed(3)} mm), a nie przez teoretyczne ${chordDeviation.toFixed(4)} mm.` +
      (refined.limitedByBudget ? ` Zagęszczanie dodatkowo przerwał limit trójkątów (${triangleBudget.toLocaleString('pl-PL')}).` : '') +
      ' Pomóc może gęstszy model, mniejszy promień albo mniej zaznaczonych krawędzi.',
    );
  } else if (refined.limitedByBudget) {
    warnings.push(
      `Zagęszczanie pasa przerwał limit trójkątów (${triangleBudget.toLocaleString('pl-PL')}) — ` +
      'łuk jest odtworzony rzadziej, niż wynika to z liczby segmentów. Zaznacz mniej krawędzi ' +
      'albo użyj mniejszego promienia.',
    );
  }
  const maxBboxDelta = Math.max(Math.abs(bboxDelta[0]), Math.abs(bboxDelta[1]), Math.abs(bboxDelta[2]));
  if (maxBboxDelta > 0.05) {
    warnings.push(
      `Gabaryt modelu zmienił się o maks. ${maxBboxDelta.toFixed(3)} mm — to normalne, gdy najdalszy punkt ` +
      'leży dokładnie na zaokrąglanej krawędzi (materiał narożnika został usunięty). ' +
      'Pozostałe powierzchnie zachowują swoje wymiary.',
    );
  }

  return {
    mesh: resultMesh,
    report: {
      kind,
      requestedRadius: radiusRequested,
      effectiveRadius: size,
      segments,
      selectedEdgeCount: requested.length,
      processedEdgeCount: edgesRounded,
      skippedFlatEdgeCount: skippedFlat,
      skippedBoundaryEdgeCount: skippedBoundary,
      skippedShortEdgeCount: 0,
      refinementLevels: refined.levels,
      trianglesBefore: mesh.faceCount,
      trianglesAfter: resultMesh.faceCount,
      movedVertexCount: movedFinalCount,
      clampedVertexCount: clampedCount,
      relaxedVertexCount: relaxedCount,
      revertedVertexCount: revertedCount,
      maxDisplacement: maxDisp,
      rmsDisplacement: Math.sqrt(sumSq / Math.max(1, movedCount)),
      bboxDelta,
      volumeBefore,
      volumeAfter,
      volumeChangePercent: volumeBefore > 0 ? ((volumeAfter - volumeBefore) / volumeBefore) * 100 : 0,
      maxFaceNormalRotationDeg: maxRot,
      flippedFaceCount: flipped,
      degenerateFaceCount: degenerate,
      chordDeviation,
      bandFacetSize,
      refinementLimitedByBudget: refined.limitedByBudget,
      edgesRounded,
      geometryChanged,
      failed,
      failedEdgeIndices,
      measuredSurfaceError,
      radiusClampReason,
      warnings,
    },
  };
}

/** Dodaje płaszczyznę, jeśli nie ma już takiej samej (normalna ORAZ odsunięcie). */
function pushPlane(
  planes: Float64Array, count: number,
  nx: number, ny: number, nz: number, d: number,
): boolean {
  for (let i = 0; i < count; i++) {
    // Dwie równoległe ściany (np. dwie strony cienkiej ścianki) mają tę samą normalną,
    // ale różne d — muszą pozostać osobnymi ograniczeniami.
    if (
      Math.abs(planes[4 * i] - nx) < 1e-6 &&
      Math.abs(planes[4 * i + 1] - ny) < 1e-6 &&
      Math.abs(planes[4 * i + 2] - nz) < 1e-6 &&
      Math.abs(planes[4 * i + 3] - d) < 1e-9
    ) return false;
  }
  planes[4 * count] = nx;
  planes[4 * count + 1] = ny;
  planes[4 * count + 2] = nz;
  planes[4 * count + 3] = d;
  return true;
}

/** Lekkie przeliczenie normalnych i pól trójkątów (bez budowy pełnej topologii). */
function computeFaceGeometry(
  positions: Float64Array,
  faces: Int32Array,
  faceCount: number,
  outNormals: Float64Array,
  outAreas: Float64Array,
): void {
  for (let f = 0; f < faceCount; f++) {
    const a = 3 * faces[3 * f];
    const b = 3 * faces[3 * f + 1];
    const c = 3 * faces[3 * f + 2];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    outAreas[f] = len * 0.5;
    if (len > 0) {
      outNormals[3 * f] = nx / len;
      outNormals[3 * f + 1] = ny / len;
      outNormals[3 * f + 2] = nz / len;
    } else {
      outNormals[3 * f] = 0;
      outNormals[3 * f + 1] = 0;
      outNormals[3 * f + 2] = 0;
    }
  }
}

/**
 * Odległość (wzdłuż łańcucha zaznaczonych krawędzi) każdego końca krawędzi od
 * najbliższego wolnego końca łańcucha. Wynik: [endA_0, endB_0, endA_1, endB_1, ...].
 * Wartość Infinity oznacza łańcuch zamknięty (brak końca — brak wygaszania).
 */
function computeChainEndDistance(chosen: EdgeRecord[]): Float64Array | null {
  const adjacency = new Map<number, Array<{ to: number; len: number }>>();
  const degree = new Map<number, number>();
  for (const e of chosen) {
    if (!adjacency.has(e.v0)) adjacency.set(e.v0, []);
    if (!adjacency.has(e.v1)) adjacency.set(e.v1, []);
    adjacency.get(e.v0)!.push({ to: e.v1, len: e.length });
    adjacency.get(e.v1)!.push({ to: e.v0, len: e.length });
    degree.set(e.v0, (degree.get(e.v0) ?? 0) + 1);
    degree.set(e.v1, (degree.get(e.v1) ?? 0) + 1);
  }
  const ends: number[] = [];
  for (const [v, d] of degree) if (d === 1) ends.push(v);
  if (ends.length === 0) return null;

  // Dijkstra (kolejka z priorytetem przez proste kopcowanie binarne).
  const dist = new Map<number, number>();
  const heap: Array<{ v: number; d: number }> = [];
  const push = (v: number, d: number) => {
    heap.push({ v, d });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
      i = p;
    }
  };
  const pop = (): { v: number; d: number } | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l].d < heap[s].d) s = l;
        if (r < heap.length && heap[r].d < heap[s].d) s = r;
        if (s === i) break;
        const t = heap[s]; heap[s] = heap[i]; heap[i] = t;
        i = s;
      }
    }
    return top;
  };

  for (const e of ends) { dist.set(e, 0); push(e, 0); }
  while (heap.length > 0) {
    const { v, d } = pop()!;
    if (d > (dist.get(v) ?? Infinity)) continue;
    for (const nb of adjacency.get(v) ?? []) {
      const nd = d + nb.len;
      if (nd < (dist.get(nb.to) ?? Infinity) - 1e-12) {
        dist.set(nb.to, nd);
        push(nb.to, nd);
      }
    }
  }

  const out = new Float64Array(chosen.length * 2);
  for (let i = 0; i < chosen.length; i++) {
    out[2 * i] = dist.get(chosen[i].v0) ?? Infinity;
    out[2 * i + 1] = dist.get(chosen[i].v1) ?? Infinity;
  }
  return out;
}
