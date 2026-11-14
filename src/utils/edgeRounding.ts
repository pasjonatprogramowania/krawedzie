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
import { buildClearanceGrid } from './meshClearance.ts';

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
  /** Powłoka 2-manifoldowa tej krawędzi (-1 gdy nieokreślona). */
  shellId: number;
  /** Długość odcinka wzorcowego (mm) — do liczenia odległości wzdłuż krawędzi. */
  length: number;
  /** Odległość "wzdłuż łańcucha" od wolnego końca dla wierzchołka A (v0) i B (v1). */
  endA: number;
  endB: number;
}

interface FeatureSpec extends Omit<Feature, 'endA' | 'endB'> {
  endKeyA: string;
  endKeyB: string;
  blockedA: boolean;
  blockedB: boolean;
}

/** Sprawdza, czy dwie cechy leżą na parach równoległych ścian o zgodnych normalnych. */
function featurePlanesMatch(a: Pick<Feature, 'n0x' | 'n0y' | 'n0z' | 'n1x' | 'n1y' | 'n1z'>, b: Pick<Feature, 'n0x' | 'n0y' | 'n0z' | 'n1x' | 'n1y' | 'n1z'>): boolean {
  const d00 = a.n0x * b.n0x + a.n0y * b.n0y + a.n0z * b.n0z;
  const d11 = a.n1x * b.n1x + a.n1y * b.n1y + a.n1z * b.n1z;
  if (d00 >= 0.95 && d11 >= 0.95) return true;
  const d01 = a.n0x * b.n1x + a.n0y * b.n1y + a.n0z * b.n1z;
  const d10 = a.n1x * b.n0x + a.n1y * b.n0y + a.n1z * b.n0z;
  return d01 >= 0.95 && d10 >= 0.95;
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

/**
 * Zagęszcza pas wokół krawędzi wzorcowych, dzieląc krawędzie od ogółu do detalu.
 * Na prostych odcinkach z dala od narożników i połączeń oszczędza podział podłużny
 * bez straty rozdzielczości łuku w przekroju poprzecznym, a na końcu domyka długie
 * trójkąty przejściowe bezpośrednio stykające się z przesuwanym pasmem.
 */
function refineBand(
  mesh: MeshData,
  grid: FeatureGrid,
  features: Feature[],
  size: number,
  targetLength: number,
  maxReach: number,
  refineRadius: number,
  maxLevels: number,
  triangleBudget: number,
  origMinEdge: Float64Array,
  allowNeedleCatchup: boolean,
  faceShells?: Int32Array,
  seamBridgeTol = 0,
): { mesh: MeshData; origMinEdge: Float64Array; levels: number; limitedByBudget: boolean; faceShells?: Int32Array } {
  let cur = mesh;
  let curMin = origMinEdge;
  let curFaceShells = faceShells;
  let curVertexShells = faceShells ? computeVertexShells(cur, faceShells) : undefined;
  let levels = 0;
  let limitedByBudget = false;
  const candidates: number[] = [];
  const distBuf = new Float64Array(Math.max(features.length, 1));

  const queryVisible = (x: number, y: number, z: number, radius: number, shells: readonly number[] | undefined): number[] => {
    grid.query(x, y, z, radius, candidates);
    if (!shells || shells.length === 0) return candidates;
    let n = 0;
    for (let i = 0; i < candidates.length; i++) {
      const fi = candidates[i];
      if (featureVisibleToVertex(features[fi], shells)) candidates[n++] = fi;
    }
    candidates.length = n;
    return candidates;
  };
  const shellsAt = (v: number): readonly number[] | undefined => curVertexShells ? curVertexShells[v] : undefined;
  /** Powłoki samej krawędzi (jej ścian), nie suma powłok końców — inaczej szew zaraża głębię powłoki. */
  const shellsAtEdge = (ei: number): readonly number[] | undefined => {
    if (!curFaceShells) return undefined;
    const rec = cur.edges[ei];
    const out: number[] = [];
    for (const f of rec.faces) {
      const sh = curFaceShells[f];
      if (sh >= 0 && !out.includes(sh)) out.push(sh);
    }
    out.sort((a, b) => a - b);
    return out;
  };

  let maxInputEdge = 0;
  for (let e = 0; e < mesh.edges.length; e++) {
    if (mesh.edges[e].length > maxInputEdge) maxInputEdge = mesh.edges[e].length;
  }

  const featDir = new Float64Array(features.length * 3);
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const dx = f.bx - f.ax;
    const dy = f.by - f.ay;
    const dz = f.bz - f.az;
    const len = Math.hypot(dx, dy, dz) || 1;
    featDir[3 * i] = dx / len;
    featDir[3 * i + 1] = dy / len;
    featDir[3 * i + 2] = dz / len;
  }

  const longTarget = Math.max(targetLength, Math.min(size * 2.0, refineRadius * 1.5));
  const cornerGuard = Math.min(refineRadius, maxReach + targetLength * 0.35);
  const epsEnd = Math.max(1e-5, cornerGuard * 1e-4);
  const guardA = new Uint8Array(features.length).fill(1);
  const guardB = new Uint8Array(features.length).fill(1);
  const joinTol = Math.max(epsEnd, seamBridgeTol);
  const isCollinearJoin = (fi: number, isEndB: boolean, px: number, py: number, pz: number): boolean => {
    const signF = isEndB ? -1 : 1;
    const ux = featDir[3 * fi], uy = featDir[3 * fi + 1], uz = featDir[3 * fi + 2];
    const f = features[fi];
    const near = grid.query(px, py, pz, joinTol, candidates);
    let collinear = false;
    for (let k = 0; k < near.length; k++) {
      const fj = near[k];
      if (fj === fi) continue;
      const g = features[fj];
      const sameShell = f.shellId < 0 || g.shellId < 0 || g.shellId === f.shellId;
      const tol = sameShell ? epsEnd : joinTol;
      const touchesA = Math.hypot(px - g.ax, py - g.ay, pz - g.az) <= tol;
      const touchesB = Math.hypot(px - g.bx, py - g.by, pz - g.bz) <= tol;
      if (!touchesA && !touchesB) continue;
      if (!sameShell && (g.convex !== f.convex || !featurePlanesMatch(f, g))) continue;
      const dot = Math.abs(ux * featDir[3 * fj] + uy * featDir[3 * fj + 1] + uz * featDir[3 * fj + 2]);
      if (dot < 0.985) return false;
      if (!sameShell) {
        // Dla obcej powłoki wymagamy kontynuacji wprost (przeciwne zwroty „od złącza”),
        // żeby pokrywające się krawędzie nie udawały przedłużenia prostej.
        const signG = touchesA ? 1 : -1;
        const outDot = (ux * signF) * (featDir[3 * fj] * signG)
          + (uy * signF) * (featDir[3 * fj + 1] * signG)
          + (uz * signF) * (featDir[3 * fj + 2] * signG);
        if (outDot > -0.985) continue;
      }
      collinear = true;
    }
    return collinear;
  };
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (isCollinearJoin(i, false, f.ax, f.ay, f.az)) guardA[i] = 0;
    if (isCollinearJoin(i, true, f.bx, f.by, f.bz)) guardB[i] = 0;
  }

  const effectiveTargetForEdge = (
    eLen: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    ei: number,
  ): number => {
    const diagCap = longTarget * 1.08;
    if (longTarget <= targetLength * 1.1) return targetLength;
    if (eLen > diagCap) return longTarget;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    const near = queryVisible(mx, my, mz, cornerGuard, shellsAtEdge(ei));
    if (near.length === 0) return longTarget;
    const best = nearestSegment(features, near, mx, my, mz, distBuf);
    if (best.index < 0 || best.distance > refineRadius) return longTarget;
    const f0 = features[best.index];
    if (guardA[best.index] && Math.hypot(mx - f0.ax, my - f0.ay, mz - f0.az) <= cornerGuard) return targetLength;
    if (guardB[best.index] && Math.hypot(mx - f0.bx, my - f0.by, mz - f0.bz) <= cornerGuard) return targetLength;
    const ux = featDir[3 * best.index];
    const uy = featDir[3 * best.index + 1];
    const uz = featDir[3 * best.index + 2];
    for (let i = 0; i < near.length; i++) {
      const fi = near[i];
      if (fi === best.index) continue;
      if (distBuf[fi] > cornerGuard) continue;
      const dot = Math.abs(ux * featDir[3 * fi] + uy * featDir[3 * fi + 1] + uz * featDir[3 * fi + 2]);
      if (dot < 0.985) return targetLength;
    }
    const ex = x1 - x0;
    const ey = y1 - y0;
    const ez = z1 - z0;
    const par = Math.abs(ex * ux + ey * uy + ez * uz);
    const perpSq = Math.max(0, eLen * eLen - par * par);
    const perp = Math.sqrt(perpSq);
    if (par > perp * 2 && eLen <= diagCap) return diagCap;
    if (perp <= targetLength * 1.05 && eLen <= longTarget) return longTarget;
    return targetLength;
  };

  const vertexDistAt = (v: number, queryRadius: number): number => {
    const x = cur.positions[3 * v];
    const y = cur.positions[3 * v + 1];
    const z = cur.positions[3 * v + 2];
    const found = queryVisible(x, y, z, queryRadius, shellsAt(v));
    if (found.length === 0) return Infinity;
    return nearestSegment(features, found, x, y, z, distBuf).distance;
  };

  const tryStep = (): 'ok' | 'done' | 'budget' => {
    const queryRadius = refineRadius;
    const dist = new Float64Array(cur.vertexCount).fill(Infinity);
    for (let v = 0; v < cur.vertexCount; v++) dist[v] = vertexDistAt(v, queryRadius);

    const split = new Uint8Array(cur.edges.length);
    let anySplit = false;
    const minLen = targetLength;
    {
      for (let ei = 0; ei < cur.edges.length; ei++) {
        const e = cur.edges[ei];
        if (e.length <= minLen) continue;
        const d0 = dist[e.v0];
        const d1 = dist[e.v1];
        let dmid = Infinity;
        let mark = d0 <= refineRadius || d1 <= refineRadius;
        if (!mark) {
          const mx = (cur.positions[3 * e.v0] + cur.positions[3 * e.v1]) * 0.5;
          const my = (cur.positions[3 * e.v0 + 1] + cur.positions[3 * e.v1 + 1]) * 0.5;
          const mz = (cur.positions[3 * e.v0 + 2] + cur.positions[3 * e.v1 + 2]) * 0.5;
          const found = queryVisible(mx, my, mz, refineRadius, shellsAtEdge(ei));
          dmid = found.length === 0 ? Infinity : nearestSegment(features, found, mx, my, mz, distBuf).distance;
          mark = dmid <= refineRadius;
        }
        if (mark) {
          const minVertDist = Math.min(d0, d1, dmid);
          if (minVertDist > maxReach) {
            if (e.length <= longTarget) mark = false;
          } else {
            const eTarget = effectiveTargetForEdge(
              e.length,
              cur.positions[3 * e.v0], cur.positions[3 * e.v0 + 1], cur.positions[3 * e.v0 + 2],
              cur.positions[3 * e.v1], cur.positions[3 * e.v1 + 1], cur.positions[3 * e.v1 + 2],
              ei,
            );
            if (e.length <= eTarget) mark = false;
          }
        }
        if (mark) {
          split[ei] = 1;
          anySplit = true;
        }
      }
    }

    if (!anySplit) return 'done';

    // Sparowany podział długich ramion wąskich trójkątów igłowych (np. f163 w pranie.stl):
    // gdy krótka podstawa ma < 25% długości obu długich ramion, a próg zasięgu/cornerGuard
    // przecina igłę wzdłużnie (oznaczając tylko jedno długie ramię), 1-krawędziowy podział
    // tworzy współliniową igłę T, której środek na łuku przecina niepodzieloną cięciwę bliźniaczego boku.
    for (let pass = 0; pass < 4; pass++) {
      let added = false;
      for (let f = 0; f < cur.faceCount; f++) {
        const v0 = cur.faces[3 * f];
        const v1 = cur.faces[3 * f + 1];
        const v2 = cur.faces[3 * f + 2];
        const e0 = edgeIndexFromKey(cur, v0, v1);
        const e1 = edgeIndexFromKey(cur, v1, v2);
        const e2 = edgeIndexFromKey(cur, v2, v0);
        if (e0 < 0 || e1 < 0 || e2 < 0) continue;
        const l0 = cur.edges[e0].length;
        const l1 = cur.edges[e1].length;
        const l2 = cur.edges[e2].length;
        let ls = l0, ea = e1, la = l1, eb = e2, lb = l2;
        if (l1 < ls) { ls = l1; ea = e0; la = l0; eb = e2; lb = l2; }
        if (l2 < ls) { ls = l2; ea = e0; la = l0; eb = e1; lb = l1; }
        const minLong = Math.min(la, lb);
        if (minLong <= minLen || ls >= 0.25 * minLong) continue;
        if (split[ea] !== split[eb]) {
          if (!split[ea] && la > minLen) { split[ea] = 1; added = true; }
          if (!split[eb] && lb > minLen) { split[eb] = 1; added = true; }
        }
      }
      if (!added) break;
    }

    const projectedFaces = projectedFaceCount(cur, split);
    if (projectedFaces > triangleBudget) {
      // Pas wymagałby więcej trójkątów, niż pozwala budżet: wynik będzie rzadszy,
      // niż wynika to z liczby segmentów. Raportujemy to jawnie (patrz `roundEdges`).
      limitedByBudget = true;
      return 'budget';
    }

    const next = splitMarkedEdges(cur, split, curMin, curFaceShells);
    cur = next.mesh;
    curMin = next.minEdge;
    curFaceShells = next.faceShells ?? (curFaceShells ? computeFaceShells(cur) : undefined);
    curVertexShells = curFaceShells ? computeVertexShells(cur, curFaceShells) : undefined;
    levels++;
    return 'ok';
  };

  for (let level = 0; level < maxLevels && !limitedByBudget; level++) {
    if (tryStep() !== 'ok') break;
  }

  // Druga faza zagęszczania: ŻADNA krawędź stykająca się z pasem nie może być dłuższa
  // niż `facetMax`. Bez tego długie „szprychy" sięgające od krawędzi w głąb ściany
  // zostawiają poszarpane fasety i fale na powierzchni obok łuku. Podział idzie
  // bisekcją najdłuższej krawędzi (Rivara), więc siatka zostaje domknięta.
  if (allowNeedleCatchup && !limitedByBudget) {
    const facetMax = Math.max(4.5, 2.5 * size);
    const touchBand = maxReach * 1.05;
    for (let pass = 0; pass < 48 && !limitedByBudget; pass++) {
      const split = new Uint8Array(cur.edges.length);
      let anySplit = false;
      for (let e = 0; e < cur.edges.length; e++) {
        const rec = cur.edges[e];
        if (rec.length <= facetMax) continue;
        const d0 = vertexDistAt(rec.v0, touchBand);
        const d1 = vertexDistAt(rec.v1, touchBand);
        let touch = d0 <= touchBand || d1 <= touchBand;
        if (!touch) {
          const mx = (cur.positions[3 * rec.v0] + cur.positions[3 * rec.v1]) * 0.5;
          const my = (cur.positions[3 * rec.v0 + 1] + cur.positions[3 * rec.v1 + 1]) * 0.5;
          const mz = (cur.positions[3 * rec.v0 + 2] + cur.positions[3 * rec.v1 + 2]) * 0.5;
          const found = queryVisible(mx, my, mz, touchBand, shellsAtEdge(e));
          touch = found.length > 0
            && nearestSegment(features, found, mx, my, mz, distBuf).distance <= touchBand;
        }
        if (!touch) continue;
        split[e] = 1;
        anySplit = true;
      }
      if (!anySplit) break;
      if (projectedFaceCount(cur, split) > triangleBudget) {
        limitedByBudget = true;
        break;
      }
      const next = splitMarkedEdges(cur, split, curMin, curFaceShells);
      cur = next.mesh;
      curMin = next.minEdge;
      curFaceShells = next.faceShells ?? (curFaceShells ? computeFaceShells(cur) : undefined);
      curVertexShells = curFaceShells ? computeVertexShells(cur, curFaceShells) : undefined;
    }
  }

  return { mesh: cur, origMinEdge: curMin, levels, limitedByBudget, faceShells: curFaceShells };
}

/** Liczba trójkątów po podzieleniu zaznaczonych krawędzi (1→2/1→3/1→4). */
function projectedFaceCount(mesh: MeshData, split: Uint8Array): number {
  let total = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faces[3 * f];
    const b = mesh.faces[3 * f + 1];
    const c = mesh.faces[3 * f + 2];
    const e0 = edgeIndexFromKey(mesh, a, b);
    const e1 = edgeIndexFromKey(mesh, b, c);
    const e2 = edgeIndexFromKey(mesh, c, a);
    const n = (e0 >= 0 && split[e0] ? 1 : 0) + (e1 >= 0 && split[e1] ? 1 : 0) + (e2 >= 0 && split[e2] ? 1 : 0);
    total += n === 0 ? 1 : n === 1 ? 2 : n === 2 ? 3 : 4;
  }
  return total;
}

/**
 * Spójne składowe ścian połączonych wyłącznie przez krawędzie 2-manifoldowe.
 * Izoluje osobne bryły/powłoki stykające się szwami non-manifold.
 */
function computeFaceShells(mesh: MeshData): Int32Array {
  const faceShell = new Int32Array(mesh.faceCount).fill(-1);
  let shell = 0;
  const stack: number[] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    if (faceShell[f] >= 0) continue;
    faceShell[f] = shell;
    stack.length = 0;
    stack.push(f);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = mesh.faces[3 * cur + k];
        const b = mesh.faces[3 * cur + ((k + 1) % 3)];
        const ei = edgeIndexFromKey(mesh, a, b);
        if (ei < 0) continue;
        const e = mesh.edges[ei];
        if (e.faces.length !== 2) continue;
        for (const nb of e.faces) {
          if (faceShell[nb] >= 0) continue;
          faceShell[nb] = shell;
          stack.push(nb);
        }
      }
    }
    shell++;
  }
  return faceShell;
}

/** Zbiór powłok incydentnych trójkątów dla każdego wierzchołka (posortowany). */
function computeVertexShells(mesh: MeshData, faceShells: Int32Array): number[][] {
  const out: number[][] = Array.from({ length: mesh.vertexCount }, () => []);
  for (let f = 0; f < mesh.faceCount; f++) {
    const sh = faceShells[f];
    if (sh < 0) continue;
    for (let k = 0; k < 3; k++) {
      const arr = out[mesh.faces[3 * f + k]];
      if (!arr.includes(sh)) arr.push(sh);
    }
  }
  for (const arr of out) arr.sort((a, b) => a - b);
  return out;
}

function featureVisibleToVertex(feature: Feature, vertexShells: readonly number[] | undefined): boolean {
  if (!vertexShells || vertexShells.length === 0 || feature.shellId < 0) return true;
  let lo = 0, hi = vertexShells.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = vertexShells[mid];
    if (v === feature.shellId) return true;
    if (v < feature.shellId) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

/**
 * Podział zaznaczonych krawędzi z zachowaniem orientacji i bez T-junctions.
 * Wzory 1→2, 1→3, 1→4 zweryfikowane geometrycznie w tests/refinement.test.ts.
 */
function splitMarkedEdges(
  mesh: MeshData,
  split: Uint8Array,
  minEdge: Float64Array,
  faceShells?: Int32Array,
): { mesh: MeshData; minEdge: Float64Array; faceShells?: Int32Array } {
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
    // Nowe wierzchołki z podziału nie przejmują śmieciowego sliver-a sąsiada.
    newMin.push(Infinity);
    added++;
  }

  const positions = new Float64Array((mesh.vertexCount + added) * 3);
  positions.set(mesh.positions, 0);
  positions.set(newPositions, mesh.positions.length);
  const outMin = new Float64Array(mesh.vertexCount + added);
  outMin.set(minEdge, 0);
  outMin.set(newMin, mesh.vertexCount);

  const outFaces: number[] = [];
  const outShells: number[] = [];
  const pushFace = (sh: number, a: number, b: number, c: number) => {
    outFaces.push(a, b, c);
    outShells.push(sh);
  };
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faces[3 * f];
    const b = mesh.faces[3 * f + 1];
    const c = mesh.faces[3 * f + 2];
    const mAB = newIndexOfEdge[edgeIndexFromKey(mesh, a, b)];
    const mBC = newIndexOfEdge[edgeIndexFromKey(mesh, b, c)];
    const mCA = newIndexOfEdge[edgeIndexFromKey(mesh, c, a)];
    const n = (mAB >= 0 ? 1 : 0) + (mBC >= 0 ? 1 : 0) + (mCA >= 0 ? 1 : 0);
    // Każdy trójkąt potomny dziedziczy powłokę trójkąta-rodzica — szew
    // non-manifold nie rozlewa się przez podział na sąsiednią powłokę.
    const sh = faceShells ? faceShells[f] : -1;
    if (n === 0) {
      pushFace(sh, a, b, c);
    } else if (n === 1) {
      if (mAB >= 0) { pushFace(sh, a, mAB, c); pushFace(sh, mAB, b, c); }
      else if (mBC >= 0) { pushFace(sh, b, mBC, a); pushFace(sh, mBC, c, a); }
      else { pushFace(sh, c, mCA, b); pushFace(sh, mCA, a, b); }
    } else if (n === 2) {
      if (mAB < 0) {
        // podzielone BC i CA, wspólny wierzchołek c:  X=c, P=b, Q=a
        pushFace(sh, b, mBC, mCA); pushFace(sh, mBC, c, mCA); pushFace(sh, b, mCA, a);
      } else if (mBC < 0) {
        // podzielone CA i AB, wspólny wierzchołek a:  X=a, P=c, Q=b
        pushFace(sh, c, mCA, mAB); pushFace(sh, mCA, a, mAB); pushFace(sh, c, mAB, b);
      } else {
        // podzielone AB i BC, wspólny wierzchołek b:  X=b, P=a, Q=c
        pushFace(sh, a, mAB, mBC); pushFace(sh, mAB, b, mBC); pushFace(sh, a, mBC, c);
      }
    } else {
      pushFace(sh, a, mAB, mCA); pushFace(sh, mAB, b, mBC); pushFace(sh, mCA, mBC, c); pushFace(sh, mAB, mBC, mCA);
    }
  }

  const next = buildTopology(positions, Int32Array.from(outFaces));
  if (!faceShells) return { mesh: next, minEdge: outMin };
  // buildTopology usuwa zdegenerowane trójkąty; wtedy mapowanie powłok
  // przestaje się zgadzać i trzeba je przeliczyć na nowej siatce.
  const outFaceShells = next.faceCount === outShells.length
    ? Int32Array.from(outShells)
    : computeFaceShells(next);
  return { mesh: next, minEdge: outMin, faceShells: outFaceShells };
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
  dykstraQ: Float64Array;
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
    dykstraQ: new Float64Array(MAX_PLANES * 3),
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

  const { u, lambda, rhs, gram, aug, active, flag, dykstraQ } = ws;
  let best = -1;
  let bestU = 0;
  for (let i = 0; i < m; i++) {
    const d = planes[4 * i + 3];
    const ui = convex ? d + size : size - d;
    u[i] = ui;
    if (ui > bestU) { bestU = ui; best = i; }
  }
  if (best < 0) return null; // punkt już należy do C (nic nie trzeba ruszać)

  // Start z 1 najbardziej naruszonej płaszczyzny (nie wszystkich naraz!), bo ≥4 płaszczyzn
  // w R³ jest zawsze liniowo zależnych — wcześniejszy start z k≥4 psuł G na iteracji 0
  // i zamrażał wierzchołki w narożnikach z 4+ ścianami (w tym na pranie.stl).
  let k = 1;
  flag.fill(0, 0, m);
  active[0] = best;
  flag[best] = 1;

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
    if (k >= 3) break;
    active[k++] = violated;
    flag[violated] = 1;
  }

  if (!solved && m > 2) {
    // Cykliczny rzut Dykstry rozwiązuje dokładnie układy ≥4 półprzestrzeni (lub równoległe).
    dykstraQ.fill(0, 0, 3 * m);
    let dx = 0, dy = 0, dz = 0;
    const tol = 1e-4 * Math.max(1, size);
    const cap = 25 * Math.max(size, 1);
    for (let it = 0; it < 128; it++) {
      for (let i = 0; i < m; i++) {
        const qi = 3 * i;
        const tx = dx + dykstraQ[qi];
        const ty = dy + dykstraQ[qi + 1];
        const tz = dz + dykstraQ[qi + 2];
        const nx = planes[4 * i], ny = planes[4 * i + 1], nz = planes[4 * i + 2];
        const excess = nx * tx + ny * ty + nz * tz + u[i];
        if (excess > 0) {
          dx = tx - excess * nx;
          dy = ty - excess * ny;
          dz = tz - excess * nz;
        } else {
          dx = tx; dy = ty; dz = tz;
        }
        dykstraQ[qi] = tx - dx;
        dykstraQ[qi + 1] = ty - dy;
        dykstraQ[qi + 2] = tz - dz;
      }
      if (!Number.isFinite(dx) || Math.hypot(dx, dy, dz) > cap) break;
      let maxV = 0;
      for (let i = 0; i < m; i++) {
        const sl = planes[4 * i] * dx + planes[4 * i + 1] * dy + planes[4 * i + 2] * dz + u[i];
        if (sl > maxV) maxV = sl;
      }
      if (maxV <= tol) {
        vx = dx; vy = dy; vz = dz;
        solved = true;
        break;
      }
    }
  }

  if (!solved) {
    // Awaryjnie przy sprzecznych ograniczeniach (cienki slot < 2r): dwie pierwsze płaszczyzny
    // należą do najbliższej krawędzi, a gdy nadal brak rozwiązania — najbardziej naruszona.
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
    // Dwie najbliższe ściany mają pełną wagę 1; trzecia i dalsze ściany w narożniku
    // wygasają gładko do zera przed |d_i| = size (zapobiega zapadaniu krawędzi w z = c).
    let dMin1 = Infinity;
    let dMin2 = Infinity;
    for (let i = 0; i < m; i++) {
      const ad = Math.max(0, convex ? -planes[4 * i + 3] : planes[4 * i + 3]);
      if (ad < dMin1) { dMin2 = dMin1; dMin1 = ad; }
      else if (ad < dMin2) { dMin2 = ad; }
    }
    const span = Math.max(size - dMin2, 1e-9);
    let sum = 0;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < m; i++) {
      const di = planes[4 * i + 3];
      const ad = Math.max(0, convex ? -di : di);
      let w = 1;
      if (m > 2 && ad > dMin2) {
        w = Math.max(0, Math.min(1, 1 - (ad - dMin2) / span));
      }
      sum += w * di;
      sx += w * planes[4 * i];
      sy += w * planes[4 * i + 1];
      sz += w * planes[4 * i + 2];
    }
    const nlen = Math.hypot(sx, sy, sz);
    if (nlen < 1e-12) return null;
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

/**
 * Scala przemieszczenia wierzchołków stojących praktycznie w tym samym punkcie.
 *
 * Brudny STL (np. `pranie.stl`) zawiera wierzchołki różniące się o ułamek mikrona.
 * Powstają między nimi igłowe trójkąty: gdy jeden zostanie przesunięty (jest na
 * krawędzi), a drugi nie, igła obraca się i zostaje odwrócona — a pętla naprawcza
 * zamraża wtedy cały narożnik (`scale -> 0`), zostawiając go ostrym.
 * Bliskie wierzchołki dostają więc wspólne przemieszczenie.
 */
function coalesceNearDuplicates(
  mesh: MeshData,
  displacement: Float64Array,
  moved: Uint8Array,
  inBand: Uint8Array,
  tol: number,
  inputVertexCount = mesh.vertexCount,
): Int32Array {
  const group = new Int32Array(mesh.vertexCount).fill(-1);
  const limit = Math.min(mesh.vertexCount, inputVertexCount);
  if (!(tol > 0) || limit <= 0) return group;
  const inv = 1 / tol;
  const parent = new Int32Array(limit);
  const groupSize = new Int32Array(limit).fill(1);
  for (let i = 0; i < limit; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
      groupSize[ra] += groupSize[rb];
    }
  };

  const buckets = new Map<number, number[]>();
  const hash = (cx: number, cy: number, cz: number) => {
    let h = Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663) ^ Math.imul(cz | 0, 83492791);
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const cellOf = (v: number, axis: number) => Math.floor(mesh.positions[3 * v + axis] * inv);
  const tol2 = tol * tol;

  // Sklejamy wyłącznie oryginalne mikro-duplikaty wejściowe (v < limit), bez przechodniego
  // łańcuchowania wierzchołków podziału pasa (które przy ostrych narożnikach leżą < tol od siebie).
  for (let v = 0; v < limit; v++) {
    const cx = cellOf(v, 0), cy = cellOf(v, 1), cz = cellOf(v, 2);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = buckets.get(hash(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const u of bucket) {
            const ddx = mesh.positions[3 * v] - mesh.positions[3 * u];
            const ddy = mesh.positions[3 * v + 1] - mesh.positions[3 * u + 1];
            const ddz = mesh.positions[3 * v + 2] - mesh.positions[3 * u + 2];
            if (ddx * ddx + ddy * ddy + ddz * ddz > tol2) continue;
            const ru = find(u);
            const rdx = mesh.positions[3 * v] - mesh.positions[3 * ru];
            const rdy = mesh.positions[3 * v + 1] - mesh.positions[3 * ru + 1];
            const rdz = mesh.positions[3 * v + 2] - mesh.positions[3 * ru + 2];
            if (rdx * rdx + rdy * rdy + rdz * rdz <= tol2) union(ru, v);
          }
        }
      }
    }
    const key = hash(cx, cy, cz);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(v);
    else buckets.set(key, [v]);
  }

  // Wspólne przemieszczenie grupy: to o największym module (żaden wierzchołek
  // grupy nie może się ruszyć więcej niż ten, który naprawdę leży na krawędzi).
  const best = new Map<number, { len: number; v: number }>();
  for (let v = 0; v < limit; v++) {
    if (!moved[v]) continue;
    const r = find(v);
    if (groupSize[r] < 2) continue;
    const len = Math.hypot(displacement[3 * v], displacement[3 * v + 1], displacement[3 * v + 2]);
    const cur = best.get(r);
    if (cur === undefined || len > cur.len) best.set(r, { len, v });
  }
  let groupCount = 0;
  const groupOf = new Map<number, number>();
  for (let v = 0; v < limit; v++) {
    const r = find(v);
    if (groupSize[r] < 2) continue;
    const src = best.get(r);
    if (!src) continue;
    if (!inBand[v]) continue; // poza pasem wierzchołek musi zostać bit-identyczny
    displacement[3 * v] = displacement[3 * src.v];
    displacement[3 * v + 1] = displacement[3 * src.v + 1];
    displacement[3 * v + 2] = displacement[3 * src.v + 2];
    moved[v] = 1;
    let gid = groupOf.get(r);
    if (gid === undefined) { gid = groupCount++; groupOf.set(r, gid); }
    group[v] = gid;
  }
  return group;
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
  /** Zasięg (reach) cechy. */
  reach: number;
  /** Czy w zasięgu występują też cechy przeciwnego znaku (styk wypukłe/wklęsłe). */
  hasOpposite: boolean;
}

function fillPlanesForSign(
  found: number[],
  features: Feature[],
  x: number, y: number, z: number,
  distBuf: Float64Array,
  convex: boolean,
  planes: Float64Array,
): number {
  let count = 0;
  let primary: Feature | null = null;
  let pmx = 0, pmy = 0, pmz = 0;
  const order = found.slice(0, found.length).sort((a, b) => distBuf[a] - distBuf[b]);
  for (let i = 0; i < order.length && count < MAX_PLANES; i++) {
    const fi = order[i];
    const f = features[fi];
    if (f.convex !== convex) continue;
    if (distBuf[fi] > f.reach) continue;
    const guard = 0.02 * f.reach;
    // Odrzucenie płaszczyzn "drugiej strony" cienkiej ściany — test POŁOŻENIA, nie
    // normalnej wierzchołka (AUD-002). Tolerancja 0.02·reach pokrywa szum float32,
    // ale nie przepuszcza przeciwległej strony cienkiego żebra (np. 0.3 mm przy r=1.6).
    const d0 = (x - f.p0x) * f.n0x + (y - f.p0y) * f.n0y + (z - f.p0z) * f.n0z;
    const d1 = (x - f.p1x) * f.n1x + (y - f.p1y) * f.n1y + (z - f.p1z) * f.n1z;
    if (convex) {
      if (d0 > guard || d1 > guard) continue;
    } else {
      if (d0 < -guard || d1 < -guard) continue;
    }
    // W narożnikach siodłowych (wypukło-wklęsłych) dwie cechy tego samego znaku
    // mogą schodzić się przez krawędź przeciwnego znaku: wówczas środek jednej cechy
    // leży po zewnętrznej stronie półprzestrzeni drugiej i nie wolno łączyć ich płaszczyzn.
    if (primary !== null) {
      const pGuard = 0.02 * Math.min(primary.reach, f.reach);
      const mx = (f.ax + f.bx) * 0.5, my = (f.ay + f.by) * 0.5, mz = (f.az + f.bz) * 0.5;
      const pd0 = (mx - primary.p0x) * primary.n0x + (my - primary.p0y) * primary.n0y + (mz - primary.p0z) * primary.n0z;
      const pd1 = (mx - primary.p1x) * primary.n1x + (my - primary.p1y) * primary.n1y + (mz - primary.p1z) * primary.n1z;
      const fd0 = (pmx - f.p0x) * f.n0x + (pmy - f.p0y) * f.n0y + (pmz - f.p0z) * f.n0z;
      const fd1 = (pmx - f.p1x) * f.n1x + (pmy - f.p1y) * f.n1y + (pmz - f.p1z) * f.n1z;
      if (convex) {
        if (pd0 > pGuard || pd1 > pGuard || fd0 > pGuard || fd1 > pGuard) continue;
      } else {
        if (pd0 < -pGuard || pd1 < -pGuard || fd0 < -pGuard || fd1 < -pGuard) continue;
      }
    } else {
      primary = f;
      pmx = (f.ax + f.bx) * 0.5;
      pmy = (f.ay + f.by) * 0.5;
      pmz = (f.az + f.bz) * 0.5;
    }
    if (pushPlane(planes, count, f.n0x, f.n0y, f.n0z, d0, convex)) count++;
    if (count < MAX_PLANES && pushPlane(planes, count, f.n1x, f.n1y, f.n1z, d1, convex)) count++;
  }
  return count;
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
  vertexShells?: readonly number[],
): number {
  out.index = -1;
  out.hasOpposite = false;
  grid.query(x, y, z, maxReach, candidates);
  if (candidates.length === 0) return 0;
  let foundCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const fi = candidates[i];
    if (featureVisibleToVertex(features[fi], vertexShells)) {
      candidates[foundCount++] = fi;
    }
  }
  candidates.length = foundCount;
  if (foundCount === 0) return 0;
  const near = nearestSegment(features, candidates, x, y, z, distBuf);
  if (near.index < 0) return 0;
  const nearest = features[near.index];
  if (near.distance > nearest.reach) return 0;

  // Wierzchołek na szwie non-manifold należy do obu powłok; bez zawężenia do
  // powłoki najbliższej cechy do jednego układu trafiłyby płaszczyzny z obu brył.
  if (nearest.shellId >= 0) {
    let keep = 0;
    for (let i = 0; i < candidates.length; i++) {
      const fi = candidates[i];
      if (features[fi].shellId === nearest.shellId) candidates[keep++] = fi;
    }
    candidates.length = keep;
  }

  out.index = near.index;
  out.distance = near.distance;
  out.t = near.t;
  out.convex = nearest.convex;
  out.radius = nearest.rFeat;
  out.reach = nearest.reach;
  for (let i = 0; i < candidates.length; i++) {
    const f = features[candidates[i]];
    if (f.convex !== nearest.convex && distBuf[candidates[i]] <= f.reach) {
      out.hasOpposite = true;
      break;
    }
  }
  return fillPlanesForSign(candidates, features, x, y, z, distBuf, nearest.convex, planes);
}

/**
 * Zmierzony błąd powierzchni w paście (AUD-008). `chordDeviation` to teoria dla
 * nieskończenie gęstej siatki; realna powierzchnia to cięciwy, więc błąd mierzymy:
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
  inBand: Uint8Array,
  scaleOf: (v: number) => number,
): number {
  if (kind !== 'fillet') return 0; // pomiar dotyczy powierzchni filletu
  const scratch = new Float64Array(MAX_PLANES * 4);
  let maxInteriorErr = 0;
  let interiorCount = 0;
  let maxBoundaryErr = 0;
  for (let f = 0; f < work.faceCount; f++) {
    const a = work.faces[3 * f], b = work.faces[3 * f + 1], c = work.faces[3 * f + 2];
    let v = -1;
    let bestCount = Infinity;
    let hasSaddleOrPocket = false;
    let allInBand = true;
    for (const u of [a, b, c]) {
      const cnt = bandPlaneCount[u];
      if (inBand[u]) {
        const dxu = positions[3 * u] - work.positions[3 * u];
        const dyu = positions[3 * u + 1] - work.positions[3 * u + 1];
        const dzu = positions[3 * u + 2] - work.positions[3 * u + 2];
        if (cnt === 0 || dxu * dxu + dyu * dyu + dzu * dzu <= 1e-6) {
          hasSaddleOrPocket = true;
          break;
        }
      } else {
        allInBand = false;
      }
      if (cnt > 0 && cnt < bestCount) {
        bestCount = cnt;
        v = u;
      }
    }
    if (hasSaddleOrPocket || v < 0) continue;
    if (scaleOf(v) < 0.5) continue;
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
    const guardPlane = 0.02 * feat.reach;
    let outOfDomain = false;
    for (let i = 0; i < count; i++) {
      const nx = bandPlanes[off + 4 * i], ny = bandPlanes[off + 4 * i + 1], nz = bandPlanes[off + 4 * i + 2];
      const dv = bandPlanes[off + 4 * i + 3];
      for (const u of [a, b, c]) {
        const du = dv + nx * (positions[3 * u] - vx) + ny * (positions[3 * u + 1] - vy) + nz * (positions[3 * u + 2] - vz);
        if (feat.convex ? du > guardPlane : du < -guardPlane) {
          outOfDomain = true;
          break;
        }
      }
      if (outOfDomain) break;
      // d_c = n·(x_c - p0) = d_v + n·(x_c - x_v)
      const dc = dv + nx * (cx - vx) + ny * (cy - vy) + nz * (cz - vz);
      scratch[4 * i] = nx;
      scratch[4 * i + 1] = ny;
      scratch[4 * i + 2] = nz;
      scratch[4 * i + 3] = dc;
    }
    if (outOfDomain) continue;
    const dist = distanceToFilletSurface(scratch, count, feat.convex, feat.rFeat, ws);
    if (dist === null) continue;
    if (allInBand) {
      interiorCount++;
      if (dist > maxInteriorErr) maxInteriorErr = dist;
    } else if (dist > maxBoundaryErr) {
      maxBoundaryErr = dist;
    }
  }
  return interiorCount > 0 ? maxInteriorErr : maxBoundaryErr;
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
  let skippedFlat = 0;
  let skippedBoundary = 0;
  const chosen: EdgeRecord[] = [];

  for (const ei of requested) {
    const e = mesh.edges[ei];
    if (!e) continue;
    if (e.isBoundary || e.isNonManifold || e.faces.length !== 2) { skippedBoundary++; continue; }
    if (e.normalAngle < flatAngleRad) { skippedFlat++; continue; }
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

  // --- 2. Promień efektywny (globalne limity: gabaryt; clearance per krawędź) -
  const minBboxDim = Math.min(bboxBefore[0], bboxBefore[1], bboxBefore[2]) || Infinity;
  const radiusRequested = Math.max(1e-4, options.radius);
  let effectiveRadius = radiusRequested;
  let radiusClampReason: RoundingReport['radiusClampReason'] = null;

  // Wolny odstęp do przeciwległej powierzchni liczony osobno dla każdej krawędzi (AUD-003),
  // żeby cienka cecha nie ograniczała całego modelu.
  const clearanceByEdge = new Map<number, number>();
  if (chosen.length > 0) {
    const cgrid = buildClearanceGrid(mesh);
    for (const e of chosen) {
      const c = cgrid.edgeClearance(e);
      if (Number.isFinite(c) && c > 0) clearanceByEdge.set(e.index, c);
    }
  }
  const bboxCap = 0.5 * minBboxDim;
  if (bboxCap < effectiveRadius) {
    effectiveRadius = Math.max(1e-4, bboxCap);
    radiusClampReason = 'edge-length';
    warnings.push(
      `Promień ograniczony do ${effectiveRadius.toFixed(3)} mm (żądano ${radiusRequested.toFixed(2)} mm) - ` +
      'większy promień przekroczyłby geometrię modelu.',
    );
  }
  const size = effectiveRadius;

  // --- 3. Cechy + siatka przestrzenna ---------------------------------------
  // Izolacja powłok: osobne bryły stykające się szwem non-manifold (faces.length > 2)
  // nie mogą pobierać płaszczyzn od siebie. Powłoki liczymy na ścianach i propagujemy
  // przez podziały; zbiór powłok wierzchołka wynika wyłącznie z jego trójkątów.
  const faceShells = computeFaceShells(mesh);
  const planeTol = Math.min(0.01, Math.max(1e-3, diag * 1e-4));
  const seamBridgeTol = Math.min(0.02, Math.max(1e-3, diag * 2e-4));
  const occlusionQuery = buildShellOcclusionQuery(mesh, faceShells, planeTol);

  let maxReach = size;
  // Kąt łuku filletu to kąt MATERIAŁU θ = π − φ, a nie kąt między normalnymi ścian
  // (AUD-010): dla klina 30° (φ = 150°) pas ma być dzielony na 30°, nie na 150°.
  let minTheta = Math.PI;
  const featureSpecs: FeatureSpec[] = [];
  let blockedCutSeq = 0;
  for (const e of chosen) {
    const f0 = e.faces[0];
    const f1 = e.faces[1];
    const sSelf = faceShells[f0] ?? -1;
    const ax0 = mesh.positions[3 * e.v0], ay0 = mesh.positions[3 * e.v0 + 1], az0 = mesh.positions[3 * e.v0 + 2];
    const bx0 = mesh.positions[3 * e.v1], by0 = mesh.positions[3 * e.v1 + 1], bz0 = mesh.positions[3 * e.v1 + 2];
    const intervals = occlusionQuery && sSelf >= 0 && occlusionQuery.shellOverlaps(sSelf)
      ? clipExposedEdgeSegments(mesh, occlusionQuery, e, f0, f1, sSelf, size, planeTol)
      : [[0, 1] as const];
    if (intervals.length === 0) continue;

    const phi = Math.max(1e-3, e.normalAngle);
    const theta = Math.PI - phi;
    minTheta = Math.min(minTheta, theta);
    // Największy promień, przy którym narożnik przesunie się o nie więcej niż `size`:
    //   r/sin(θ/2) - r ≤ size  ⇒  r ≤ size·sin(θ/2)/(1 - sin(θ/2))
    // Dla θ ≥ 60° ograniczenie jest bezskuteczne (rMax ≥ size), dla θ = 45° wynosi
    // 0.62·size, dla θ = 30° - 0.35·size (AUD-001).
    const sinHalf = Math.sin(theta / 2);
    const denom = 1 - sinHalf;
    const rMaxAngle = denom > 1e-9 ? (size * sinHalf) / denom : size;
    const clearance = clearanceByEdge.get(e.index) ?? Infinity;
    const rFeat = Math.min(size, rMaxAngle, clearance);
    // reach/setback muszą odpowiadać faktycznemu promieniowi i przemieszczeniu cechy.
    const setbackFeat = kind === 'chamfer' ? rFeat : rFeat / Math.tan(phi / 2);
    const apexDisp = sinHalf > 1e-9 ? (rFeat / sinHalf - rFeat) : rFeat;
    const reach = Math.min(Math.max(rFeat, setbackFeat, apexDisp), Math.max(rFeat, apexDisp) * 4);
    maxReach = Math.max(maxReach, reach);

    const n0x = mesh.faceNormals[3 * f0], n0y = mesh.faceNormals[3 * f0 + 1], n0z = mesh.faceNormals[3 * f0 + 2];
    const n1x = mesh.faceNormals[3 * f1], n1y = mesh.faceNormals[3 * f1 + 1], n1z = mesh.faceNormals[3 * f1 + 2];
    const dx = bx0 - ax0, dy = by0 - ay0, dz = bz0 - az0;
    for (const [t0, t1] of intervals) {
      const blockedA = t0 > 1e-4;
      const blockedB = t1 < 1 - 1e-4;
      const ax = ax0 + t0 * dx, ay = ay0 + t0 * dy, az = az0 + t0 * dz;
      const bx = ax0 + t1 * dx, by = ay0 + t1 * dy, bz = az0 + t1 * dz;
      featureSpecs.push({
        edgeIndex: e.index,
        convex: e.isConvex,
        n0x, n0y, n0z, p0x: ax0, p0y: ay0, p0z: az0,
        n1x, n1y, n1z, p1x: ax0, p1y: ay0, p1z: az0,
        ax, ay, az,
        bx, by, bz,
        phi,
        rFeat,
        reach,
        shellId: sSelf,
        length: e.length * (t1 - t0),
        endKeyA: blockedA ? `cut:${blockedCutSeq}:A` : `${sSelf}:${e.v0}`,
        endKeyB: blockedB ? `cut:${blockedCutSeq}:B` : `${sSelf}:${e.v1}`,
        blockedA,
        blockedB,
      });
      if (blockedA || blockedB) blockedCutSeq++;
    }
  }

  if (featureSpecs.length === 0) {
    warnings.push(
      'Wszystkie zaznaczone krawędzie stykają się z sąsiednią ścianą lub są schowane wewnątrz innej bryły — model pozostaje bez zmian.',
    );
    return {
      mesh,
      report: baseReport({
        selectedEdgeCount: requested.length,
        skippedFlatEdgeCount: skippedFlat,
        skippedBoundaryEdgeCount: skippedBoundary,
      }),
    };
  }

  const chainDistance = taperEnds ? computeChainEndDistance(featureSpecs, seamBridgeTol) : null;
  const features: Feature[] = featureSpecs.map((spec, i) => ({
    edgeIndex: spec.edgeIndex,
    convex: spec.convex,
    n0x: spec.n0x, n0y: spec.n0y, n0z: spec.n0z, p0x: spec.p0x, p0y: spec.p0y, p0z: spec.p0z,
    n1x: spec.n1x, n1y: spec.n1y, n1z: spec.n1z, p1x: spec.p1x, p1y: spec.p1y, p1z: spec.p1z,
    ax: spec.ax, ay: spec.ay, az: spec.az,
    bx: spec.bx, by: spec.by, bz: spec.bz,
    phi: spec.phi,
    rFeat: spec.rFeat,
    reach: spec.reach,
    shellId: spec.shellId,
    length: spec.length,
    endA: chainDistance ? chainDistance[i * 2] : Infinity,
    endB: chainDistance ? chainDistance[i * 2 + 1] : Infinity,
  }));

  // Limity per krawędź: clearance geometryczny i/lub kąt ostry (AUD-001/AUD-003).
  let clearanceLimitedCount = 0;
  let clearanceLimitedMin = Infinity;
  let acuteCount = 0;
  let acuteRadius = Infinity;
  for (const f of features) {
    const thetaF = Math.PI - f.phi;
    const sinHalfF = Math.sin(thetaF / 2);
    const denomF = 1 - sinHalfF;
    const rMaxAngleF = denomF > 1e-9 ? (size * sinHalfF) / denomF : size;
    const clearanceF = clearanceByEdge.get(f.edgeIndex) ?? Infinity;
    if (f.rFeat < size - 1e-12) {
      if (rMaxAngleF < size - 1e-12 && f.rFeat <= rMaxAngleF + 1e-12) {
        acuteCount++;
        acuteRadius = Math.min(acuteRadius, f.rFeat);
      } else if (clearanceF < size - 1e-12 && f.rFeat <= clearanceF + 1e-12) {
        clearanceLimitedCount++;
        clearanceLimitedMin = Math.min(clearanceLimitedMin, f.rFeat);
      } else {
        // inny limit (np. oba naraz) — traktuj jako najściślejszy
        if (clearanceF <= rMaxAngleF) {
          clearanceLimitedCount++;
          clearanceLimitedMin = Math.min(clearanceLimitedMin, f.rFeat);
        } else {
          acuteCount++;
          acuteRadius = Math.min(acuteRadius, f.rFeat);
        }
      }
    }
  }
  if (clearanceLimitedCount > 0) {
    if (radiusClampReason === null) radiusClampReason = 'clearance';
    warnings.push(
      `${clearanceLimitedCount} krawędzi ograniczono promień do ${plNum(clearanceLimitedMin)} mm z powodu geometrii (wolny odstęp).`,
    );
  }
  if (acuteCount > 0) {
    radiusClampReason = 'acute-angle';
    const w = edgeWords(acuteCount);
    warnings.push(
      `${acuteCount} ${w.noun} ${w.verb} kąt zbyt ostry na pełny promień ${plNum(size)} mm - ` +
      `zaokrąglono ${w.pronoun} promieniem ${plNum(acuteRadius)} mm (kąt materiału poniżej 60°).`,
    );
  }
  // `size` to globalny limit promienia; `effectiveRadius` w raporcie = ten limit.
  // Poszczególne krawędzie mogą mieć mniejszy rFeat (clearance/kąt ostry) — opisane w ostrzeżeniach.

  let taperLength = 0;
  if (chainDistance) {
    let maxEnd = 0;
    let hasBlockedEnd = false;
    for (let i = 0; i < featureSpecs.length; i++) {
      const a = chainDistance[2 * i];
      const b = chainDistance[2 * i + 1];
      if (Number.isFinite(a)) maxEnd = Math.max(maxEnd, a);
      if (Number.isFinite(b)) maxEnd = Math.max(maxEnd, b);
      if (featureSpecs[i].blockedA || featureSpecs[i].blockedB) {
        hasBlockedEnd = true;
        maxEnd = Math.max(maxEnd, featureSpecs[i].length);
      }
    }
    taperLength = maxEnd > 0 || hasBlockedEnd ? Math.min(size, maxEnd * 0.5) : 0;
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
  // Budżet trójkątów: przy wielu segmentach pas wymaga więcej trójkątów, niż budżet
  // pozwala. Zamiast przerywać zagęszczanie w połowie (co zostawia poszarpane fasety
  // i „zamrożone" narożniki), podnosimy docelową długość łuku do równoważnika
  // min(segments, 3). Przy `segments <= 3` nic nie zmieniamy.
  if (segments >= 4) {
    const bandWidth = 2 * maxReach;
    const demand = (4 * totalFeatureLength * bandWidth) / (targetLength * targetLength);
    if (demand > triangleBudget) {
      const coarse = Math.max(targetLength, (size * arcAngle) / 3);
      if (coarse > targetLength) {
        targetLength = coarse;
        warnings.push(
          `Budżet ${triangleBudget.toLocaleString('pl-PL')} trójkątów nie wystarcza na rozdzielczość ` +
          `${segments} segmentów — docelowa długość pasa została zwiększona do ${coarse.toFixed(3)} mm.`,
        );
      }
    }
  }
  const refineRadius = maxReach * 1.08 + targetLength;

  // --- 5. Zagęszczenie pasa -------------------------------------------------
  const origMinEdge = new Float64Array(mesh.vertexCount).fill(Infinity);
  for (let e = 0; e < mesh.edges.length; e++) {
    const er = mesh.edges[e];
    const len = Math.hypot(
      mesh.positions[3 * er.v1] - mesh.positions[3 * er.v0],
      mesh.positions[3 * er.v1 + 1] - mesh.positions[3 * er.v0 + 1],
      mesh.positions[3 * er.v1 + 2] - mesh.positions[3 * er.v0 + 2],
    );
    if (len < origMinEdge[er.v0]) origMinEdge[er.v0] = len;
    if (len < origMinEdge[er.v1]) origMinEdge[er.v1] = len;
  }
  const refined = refineBand(
    mesh, grid, features, size, targetLength, maxReach, refineRadius, maxLevels, triangleBudget, origMinEdge,
    options.maxLevels === undefined,
    faceShells,
    seamBridgeTol,
  );
  const work = refined.mesh;
  const workVertexShells = refined.faceShells ? computeVertexShells(work, refined.faceShells) : undefined;

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
  const oppPlanes = new Float64Array(MAX_PLANES * 4);
  const filletWork = createFilletWorkspace();
  const maxDisplacementCap = options.maxDisplacement ?? Infinity;
  const nearInfo: NearestInfo = { index: -1, distance: 0, t: 0, convex: true, radius: size, reach: 0, hasOpposite: false };

  let movedCount = 0;
  let clampedCount = 0;
  let minClampLimit = Infinity;
  let maxDisp = 0;
  let maxRawDisp = 0;
  let sumSq = 0;
  // Twarde ograniczenie przemieszczenia: |Δ| ≤ min(r, cap). Limit oparty na długości
  // krawędzi siatki (0.25·L_min_incident) mylił rozdzielczość siatki z rozmiarem cechy
  // i gwarantował zbyt mały łuk (AUD-003).
  const baseLimit = Math.min(size, maxDisplacementCap);

  for (let v = 0; v < work.vertexCount; v++) {
    const px = work.positions[3 * v];
    const py = work.positions[3 * v + 1];
    const pz = work.positions[3 * v + 2];

    const planeCount = collectPlanes(
      grid, features, px, py, pz, maxReach, planes, candidates, distBuf, nearInfo,
      workVertexShells ? workVertexShells[v] : undefined,
    );
    if (nearInfo.index < 0) continue;
    inBand[v] = 1;
    featureOfVertex[v] = nearInfo.index;
    if (planeCount === 0 && !nearInfo.hasOpposite) continue;

    const convex = nearInfo.convex;
    // Promień efektywny TEJ cechy: przy ostrym kącie materiału pełny promień jest
    // geometrycznie niemożliwy (narożnik musiałby się przesunąć o r/sin(θ/2) − r),
    // więc używamy mniejszego promienia zgodnego z budżetem przemieszczenia.
    const rFeat = kind === 'fillet' ? nearInfo.radius : size;
    // Dopuszczalne przemieszczenie: narożnik filletu o promieniu rFeat cofa się o rFeat/sin(θ/2)-rFeat.
    const feat = features[nearInfo.index];
    const thetaF = Math.PI - feat.phi;
    const sinHalfF = Math.sin(Math.max(thetaF * 0.5, 1e-6));
    const apexDispF = sinHalfF > 1e-9 ? (rFeat / sinHalfF - rFeat) : rFeat;
    const localLimit = Math.min(Math.max(rFeat, apexDispF), baseLimit);
    const taperFactor = (fi: number, t: number): number => {
      if (!(taperLength > 0) || fi < 0) return 1;
      const f = features[fi];
      const distFromA = Number.isFinite(f.endA) ? f.endA + t * f.length : Infinity;
      const distFromB = Number.isFinite(f.endB) ? f.endB + (1 - t) * f.length : Infinity;
      const along = Math.min(distFromA, distFromB);
      return Number.isFinite(along) ? smoothstep01(along / taperLength) : 1;
    };

    const rawDelta = planeCount > 0 ? computeDisplacement(planes, planeCount, convex, kind, rFeat, filletWork) : null;
    const wTaperMain = rawDelta ? taperFactor(nearInfo.index, nearInfo.t) : 0;
    const delta: [number, number, number] | null = rawDelta && wTaperMain > 0
      ? [rawDelta[0] * wTaperMain, rawDelta[1] * wTaperMain, rawDelta[2] * wTaperMain]
      : null;

    let dx = 0, dy = 0, dz = 0;
    let hasDelta = false;
    if (nearInfo.hasOpposite) {
      let oppFi = -1;
      let oppDist = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const fi = candidates[i];
        const f = features[fi];
        if (f.convex !== convex && distBuf[fi] <= f.reach && distBuf[fi] < oppDist) {
          oppDist = distBuf[fi];
          oppFi = fi;
        }
      }
      const oppCount = oppFi >= 0 ? fillPlanesForSign(candidates, features, px, py, pz, distBuf, !convex, oppPlanes) : 0;
      const oppRadius = oppFi >= 0 && kind === 'fillet' ? features[oppFi].rFeat : size;
      const rawDeltaOpp = oppCount > 0 ? computeDisplacement(oppPlanes, oppCount, !convex, kind, oppRadius, filletWork) : null;
      let wTaperOpp = 0;
      if (rawDeltaOpp && oppFi >= 0) {
        const of = features[oppFi];
        const obx = of.bx - of.ax, oby = of.by - of.ay, obz = of.bz - of.az;
        const olen2 = obx * obx + oby * oby + obz * obz;
        const oppT = olen2 > 0
          ? Math.max(0, Math.min(1, ((px - of.ax) * obx + (py - of.ay) * oby + (pz - of.az) * obz) / olen2))
          : 0;
        wTaperOpp = taperFactor(oppFi, oppT);
      }
      const deltaOpp: [number, number, number] | null = rawDeltaOpp && wTaperOpp > 0
        ? [rawDeltaOpp[0] * wTaperOpp, rawDeltaOpp[1] * wTaperOpp, rawDeltaOpp[2] * wTaperOpp]
        : null;
      if (delta && deltaOpp && oppFi >= 0) {
        const mainReach = Math.max(nearInfo.reach, 1e-9);
        const oppReach = Math.max(features[oppFi].reach, 1e-9);
        // Wagi symetryczne względem zamiany (main <-> opp): na dwusiecznej uMain === uOpp
        // dają dokładnie w1 = w2 = 0.5 (brak skoku normalnych na styku wypukło-wklęsłym),
        // a przy uOpp -> 1 (granica zasięgu) aOpp -> 0 wygasza w2 -> 0 bez tłumienia delta.
        const uMain = Math.min(1, nearInfo.distance / mainReach);
        const uOpp = Math.min(1, oppDist / oppReach);
        const aMain = 1 - smoothstep01(uMain);
        const aOpp = 1 - smoothstep01(uOpp);
        const sMain = uMain / Math.max(aMain, 1e-9);
        const sOpp = uOpp / Math.max(aOpp, 1e-9);
        const ratio = sMain / Math.max(sMain + sOpp, 1e-9);
        const w2 = ratio <= 0.5
          ? smoothstep01(ratio * 2) * 0.5
          : 1 - smoothstep01((1 - ratio) * 2) * 0.5;
        const w1 = 1 - w2;
        dx = delta[0] * w1 + deltaOpp[0] * w2;
        dy = delta[1] * w1 + deltaOpp[1] * w2;
        dz = delta[2] * w1 + deltaOpp[2] * w2;
        // Gdy udział przeciwnej cechy jest znikomy, zapisujemy płaszczyzny głównej,
        // żeby pomiar błędu powierzchni nie gubił trójkątów na obrzeżach pasa.
        if (w2 < 0.05 && planeCount > 0) {
          bandPlaneOffset[v] = bandPlanes.length;
          bandPlaneCount[v] = planeCount;
          for (let i = 0; i < planeCount * 4; i++) bandPlanes.push(planes[i]);
        }
        hasDelta = true;
      } else if (delta) {
        // Zapamiętujemy płaszczyzny wierzchołka — tymi samymi liczymy potem błąd
        // powierzchni trójkątów pasa (AUD-008).
        bandPlaneOffset[v] = bandPlanes.length;
        bandPlaneCount[v] = planeCount;
        for (let i = 0; i < planeCount * 4; i++) bandPlanes.push(planes[i]);
        dx = delta[0]; dy = delta[1]; dz = delta[2];
        hasDelta = true;
      } else if (deltaOpp && oppFi >= 0) {
        const oppReach = Math.max(features[oppFi].reach, 1e-9);
        const oppFade = 1 - smoothstep01(Math.min(1, oppDist / oppReach));
        dx = deltaOpp[0] * oppFade;
        dy = deltaOpp[1] * oppFade;
        dz = deltaOpp[2] * oppFade;
        hasDelta = true;
      }
    } else if (delta) {
      // Zapamiętujemy płaszczyzny wierzchołka — tymi samymi liczymy potem błąd
      // powierzchni trójkątów pasa (AUD-008).
      bandPlaneOffset[v] = bandPlanes.length;
      bandPlaneCount[v] = planeCount;
      for (let i = 0; i < planeCount * 4; i++) bandPlanes.push(planes[i]);
      dx = delta[0]; dy = delta[1]; dz = delta[2];
      hasDelta = true;
    }
    if (!hasDelta) continue;

    let len = Math.hypot(dx, dy, dz);
    if (len > maxRawDisp) maxRawDisp = len;
    if (len > localLimit && len > 0) {
      const k = localLimit / len;
      dx *= k; dy *= k; dz *= k;
      len = localLimit;
      minClampLimit = Math.min(minClampLimit, localLimit);
      clampedCount++;
    }
    if (!(len > 0) || !Number.isFinite(len)) continue;

    displacement[3 * v] = dx;
    displacement[3 * v + 1] = dy;
    displacement[3 * v + 2] = dz;
    moved[v] = 1;
    movedCount++;
  }

  // Brudny STL bywa z plikami STL: wierzchołki niemal coincidentne (różniące się
  // o ułamek mikrona) tworzą igłowe trójkąty. Gdy takie wierzchołki przesuną się
  // różnie, igła się odwraca i cały narożnik zostaje „zamrożony" (scale → 0).
  // Wierzchołki bliskie siebie muszą więc dostać to samo przemieszczenie i przesuwać
  // się razem — jako grupa sztywna.
  const rigidGroup = coalesceNearDuplicates(
    work, displacement, moved, inBand,
    Math.max(1e-4, Math.min(size * 0.05, targetLength * 0.1)),
    mesh.vertexCount,
  );
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
      'lokalna rozdzielczość siatki. Zwiększ promień lub liczbę segmentów.',
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
  // Wierzchołki o tym samym przemieszczeniu (brudny STL: duplikaty punktów) tworzą
  // grupę sztywną — muszą się przesuwać razem, bo inaczej igłowy trójkąt między nimi
  // obraca się, a pętla naprawcza zamraża cały narożnik.
  const groupScale = new Float64Array(Math.max(1, work.vertexCount)).fill(1);
  const scaleOf = (v: number): number => (rigidGroup[v] >= 0 ? groupScale[rigidGroup[v]] : scale[v]);
  const newPositions = work.positions.slice();
  const areaLimit = Math.max(1e-24, (diag * 1e-7) * (diag * 1e-7));

  const applyDisplacements = () => {
    for (let v = 0; v < work.vertexCount; v++) {
      if (!moved[v]) continue;
      const k = scaleOf(v);
      newPositions[3 * v] = work.positions[3 * v] + displacement[3 * v] * k;
      newPositions[3 * v + 1] = work.positions[3 * v + 1] + displacement[3 * v + 1] * k;
      newPositions[3 * v + 2] = work.positions[3 * v + 2] + displacement[3 * v + 2] * k;
    }
  };

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

  // Pętla naprawcza. Dla każdej złej ściany szukamy NAJWIĘKSZEGO wspólnego współczynnika
  // skalowania przemieszczeń jej trzech wierzchołków, przy którym ściana przestaje być
  // odwrócona. Skalowanie jest wspólne dla całej ściany, więc trójkąt nie deformuje się
  // „same" — dzięki temu pojedyncza igła nie zamraża całego narożnika (scale → 0).
  const dispLen = new Float64Array(work.vertexCount);
  for (let v = 0; v < work.vertexCount; v++) {
    if (!moved[v]) continue;
    dispLen[v] = Math.hypot(displacement[3 * v], displacement[3 * v + 1], displacement[3 * v + 2]);
  }
  const trialPos = new Float64Array(9);
  const faceOkAt = (f: number, lam: number): boolean => {
    for (let k = 0; k < 3; k++) {
      const v = work.faces[3 * f + k];
      const s = scaleOf(v) * lam;
      trialPos[3 * k] = work.positions[3 * v] + displacement[3 * v] * s;
      trialPos[3 * k + 1] = work.positions[3 * v + 1] + displacement[3 * v + 1] * s;
      trialPos[3 * k + 2] = work.positions[3 * v + 2] + displacement[3 * v + 2] * s;
    }
    const ux = trialPos[3] - trialPos[0], uy = trialPos[4] - trialPos[1], uz = trialPos[5] - trialPos[2];
    const vx = trialPos[6] - trialPos[0], vy = trialPos[7] - trialPos[1], vz = trialPos[8] - trialPos[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len * 0.5 > areaLimit)) return false;
    const dot =
      (nx / len) * beforeNormals[3 * f] +
      (ny / len) * beforeNormals[3 * f + 1] +
      (nz / len) * beforeNormals[3 * f + 2];
    return dot > FLIP_COS;
  };
  for (let pass = 0; pass < 48; pass++) {
    applyDisplacements();
    computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
    const bad = collectBadFaces();
    if (bad.length === 0) break;
    let anyLowered = false;
    for (const f of bad) {
      // Bisection: lam = 0 to skala wejściowa (ściana jest poprawna), lam = 1 to obecna.
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 16; it++) {
        const mid = (lo + hi) * 0.5;
        if (faceOkAt(f, mid)) lo = mid; else hi = mid;
      }
      if (lo >= 1) continue;
      for (let k = 0; k < 3; k++) {
        const v = work.faces[3 * f + k];
        if (!moved[v]) continue;
        const gid = rigidGroup[v];
        if (gid >= 0) {
          const s = groupScale[gid] * lo;
          if (s < groupScale[gid]) { groupScale[gid] = s; anyLowered = true; }
        } else {
          const s = scale[v] * lo;
          if (s < scale[v]) { scale[v] = s; anyLowered = true; }
        }
      }    }
    if (!anyLowered) break;
  }

  // Ostateczna gwarancja bezpieczeństwa: jeśli mimo wszystko zostały złe ściany,
  // wycofujemy wszystkie przemieszczenia (wynik = wejście, tylko zagęszczone).
  applyDisplacements();
  computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
  if (collectBadFaces().length > 0) {
    scale.fill(0);
    groupScale.fill(0);
    applyDisplacements();
    computeFaceGeometry(newPositions, work.faces, work.faceCount, normalBuf, areaBuf);
    warnings.push(
      'Nie udało się wygenerować poprawnego zaokrąglenia dla tych krawędzi — ' +
      'przywrócono pierwotną geometrię. Zmniejsz promień albo liczbę segmentów.',
    );
  }
  // --- Stan końcowy: co NAPRAWDĘ zostało zaokrąglone -------------------------
  let movedFinalCount = 0;
  let relaxedCount = 0;
  let revertedCount = 0;
  const featureMoved = new Uint8Array(features.length);
  const featureAssigned = new Int32Array(features.length);
  const featureReverted = new Int32Array(features.length);
  for (let v = 0; v < work.vertexCount; v++) {
    if (!moved[v]) continue;
    const fi = featureOfVertex[v];
    const s = scaleOf(v);
    if (s <= 0) {
      revertedCount++;
      if (fi >= 0) { featureAssigned[fi]++; featureReverted[fi]++; }
      continue;
    }
    if (s < 1) relaxedCount++;
    const vx = displacement[3 * v] * s;
    const vy = displacement[3 * v + 1] * s;
    const vz = displacement[3 * v + 2] * s;
    const dSq = vx * vx + vy * vy + vz * vz;
    sumSq += dSq;
    const d = Math.sqrt(dSq);
    if (d > maxDisp) maxDisp = d;
    movedFinalCount++;
    if (fi >= 0) { featureAssigned[fi]++; featureMoved[fi] = 1; }
  }
  const movedEdges = new Set<number>();
  for (let i = 0; i < features.length; i++) if (featureMoved[i]) movedEdges.add(features[i].edgeIndex);
  const edgesRounded = movedEdges.size;
  const failedEdges = new Set<number>();
  for (let i = 0; i < features.length; i++) {
    if (featureAssigned[i] > 0 && featureAssigned[i] === featureReverted[i] && !movedEdges.has(features[i].edgeIndex)) {
      failedEdges.add(features[i].edgeIndex);
    }
  }
  const failedEdgeIndices = Array.from(failedEdges);
  const geometryChanged = movedFinalCount > 0;
  // Wycofanie wszystkiego = brak przesuniętych wierzchołków = operacja nieskuteczna.
  const failed = !geometryChanged;

  const resultMesh = buildTopology(newPositions, work.faces);

  // Zmierzony (nie teoretyczny) błąd powierzchni w paście: `chordDeviation` to
  // teoria dla nieskończonie gęstej siatki, a realna powierzchnia to cięciwy (AUD-008).
  const measuredSurfaceError = measureSurfaceError(
    work, newPositions, bandPlaneOffset, bandPlaneCount, bandPlanes, featureOfVertex,
    features, kind, filletWork, inBand, scaleOf,
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
    const capShown = Number.isFinite(minClampLimit) ? minClampLimit : baseLimit;
    warnings.push(
      `${clampedCount} wierzchołków miało przemieszczenie ograniczone do ${plNum(capShown, 3)} mm ` +
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
  if (kind === 'fillet' && chordDeviation > 0.05) {
    warnings.push(
      `Teoretyczna odchyłka łuku ≈ ${chordDeviation.toFixed(3)} mm — zwiększ liczbę segmentów dla gładszej powierzchni.`,
    );
  }
  // Rozdzielczość pasa jest równie ważna jak liczba segmentów: dopóki ściany w pasie są
  // większe od promienia, siatka nie jest w stanie wiernie odtworzyć łuku i o odchyłce
  // decyduje gęstość siatki, a nie ustawienie segmentów.
  if (bandFacetSize > 2 * size && movedFinalCount > 0) {
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
      rmsDisplacement: Math.sqrt(sumSq / Math.max(1, movedFinalCount)),
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

/** Dodaje płaszczyznę, deduplikując szum float32 STL przy tej samej ścianie. */
function pushPlane(
  planes: Float64Array, count: number,
  nx: number, ny: number, nz: number, d: number,
  convex = true,
): boolean {
  for (let i = 0; i < count; i++) {
    // Dwie równoległe ściany cienkiej ścianki różnią się znacznie w `d`,
    // natomiast ściany z binary STL (float32) miewają szum ~1e-4 w normalnej i d.
    if (
      Math.abs(planes[4 * i] - nx) < 2e-3 &&
      Math.abs(planes[4 * i + 1] - ny) < 2e-3 &&
      Math.abs(planes[4 * i + 2] - nz) < 2e-3 &&
      Math.abs(planes[4 * i + 3] - d) < 2e-4
    ) {
      if (convex ? d > planes[4 * i + 3] : d < planes[4 * i + 3]) {
        planes[4 * i] = nx;
        planes[4 * i + 1] = ny;
        planes[4 * i + 2] = nz;
        planes[4 * i + 3] = d;
      }
      return false;
    }
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



interface ShellOcclusionQuery {
  shellOverlaps: (shellId: number) => boolean;
  isFaceOccluded: (
    px: number, py: number, pz: number,
    inX: number, inY: number, inZ: number, deltaIn: number,
    nx: number, ny: number, nz: number, epsOut: number,
    selfShell: number,
  ) => boolean;
}

/** Sprawdza, czy punkt na płaszczyźnie trójkąta `f` leży w jego wnętrzu powiększonym o `tol`. */
function pointInFace3D(
  px: number, py: number, pz: number,
  mesh: MeshData, f: number,
  nx: number, ny: number, nz: number,
  tol: number,
): boolean {
  const ia = mesh.faces[3 * f];
  const ib = mesh.faces[3 * f + 1];
  const ic = mesh.faces[3 * f + 2];
  for (let k = 0; k < 3; k++) {
    const i0 = k === 0 ? ia : k === 1 ? ib : ic;
    const i1 = k === 0 ? ib : k === 1 ? ic : ia;
    const ax = mesh.positions[3 * i0], ay = mesh.positions[3 * i0 + 1], az = mesh.positions[3 * i0 + 2];
    const ex = mesh.positions[3 * i1] - ax;
    const ey = mesh.positions[3 * i1 + 1] - ay;
    const ez = mesh.positions[3 * i1 + 2] - az;
    const len = Math.hypot(ex, ey, ez);
    if (!(len > 1e-12)) return false;
    // cross(n, e) / len wskazuje do wnętrza CCW trójkąta w jego płaszczyźnie.
    const ix = (ny * ez - nz * ey) / len;
    const iy = (nz * ex - nx * ez) / len;
    const iz = (nx * ey - ny * ex) / len;
    if ((px - ax) * ix + (py - ay) * iy + (pz - az) * iz < -tol) return false;
  }
  return true;
}

/**
 * Buduje indeks zasłaniania między odrębnymi powłokami: wykrywa styk przeciwległych ścian
 * oraz zanurzenie wewnątrz innej domkniętej bryły. Gdy powłoki są rozłączne, zwraca `null`.
 */
function buildShellOcclusionQuery(
  mesh: MeshData,
  faceShells: Int32Array,
  planeTol: number,
): ShellOcclusionQuery | null {
  let maxShell = -1;
  for (let f = 0; f < mesh.faceCount; f++) {
    if (faceShells[f] > maxShell) maxShell = faceShells[f];
  }
  const shellCount = maxShell + 1;
  if (shellCount <= 1) return null;

  const minX = new Float64Array(shellCount).fill(Infinity);
  const minY = new Float64Array(shellCount).fill(Infinity);
  const minZ = new Float64Array(shellCount).fill(Infinity);
  const maxX = new Float64Array(shellCount).fill(-Infinity);
  const maxY = new Float64Array(shellCount).fill(-Infinity);
  const maxZ = new Float64Array(shellCount).fill(-Infinity);
  for (let f = 0; f < mesh.faceCount; f++) {
    const s = faceShells[f];
    if (s < 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = mesh.faces[3 * f + k];
      const x = mesh.positions[3 * v], y = mesh.positions[3 * v + 1], z = mesh.positions[3 * v + 2];
      if (x < minX[s]) minX[s] = x; if (x > maxX[s]) maxX[s] = x;
      if (y < minY[s]) minY[s] = y; if (y > maxY[s]) maxY[s] = y;
      if (z < minZ[s]) minZ[s] = z; if (z > maxZ[s]) maxZ[s] = z;
    }
  }

  const overlapPad = planeTol * 2 + 0.02;
  const order = Array.from({ length: shellCount }, (_, i) => i).sort((a, b) => minX[a] - minX[b]);
  const overlaps = new Uint8Array(shellCount);
  let anyOverlap = false;
  for (let i = 0; i < shellCount; i++) {
    const a = order[i];
    if (!(maxX[a] >= minX[a])) continue;
    for (let j = i + 1; j < shellCount; j++) {
      const b = order[j];
      if (!(maxX[b] >= minX[b])) continue;
      if (minX[b] > maxX[a] + overlapPad) break;
      if (
        minY[b] <= maxY[a] + overlapPad && maxY[b] + overlapPad >= minY[a] &&
        minZ[b] <= maxZ[a] + overlapPad && maxZ[b] + overlapPad >= minZ[a]
      ) {
        overlaps[a] = 1;
        overlaps[b] = 1;
        anyOverlap = true;
      }
    }
  }
  if (!anyOverlap) return null;

  const overlapFaces: number[] = [];
  const facesByShell = new Map<number, number[]>();
  let uMinY = Infinity, uMinZ = Infinity, uMaxY = -Infinity, uMaxZ = -Infinity;
  for (let f = 0; f < mesh.faceCount; f++) {
    const s = faceShells[f];
    if (s < 0 || !overlaps[s]) continue;
    overlapFaces.push(f);
    let arr = facesByShell.get(s);
    if (!arr) { arr = []; facesByShell.set(s, arr); }
    arr.push(f);
    for (let k = 0; k < 3; k++) {
      const v = mesh.faces[3 * f + k];
      const y = mesh.positions[3 * v + 1], z = mesh.positions[3 * v + 2];
      if (y < uMinY) uMinY = y; if (y > uMaxY) uMaxY = y;
      if (z < uMinZ) uMinZ = z; if (z > uMaxZ) uMaxZ = z;
    }
  }

  // Domkniętość sprawdzamy per powłoka (własne krawędzie brzegowe szwu non-manifold domykają powłokę).
  const shellClosed = new Uint8Array(shellCount);
  const eCount = new Map<number, number>();
  const eDir = new Map<number, number>();
  const V = mesh.vertexCount;
  for (const [s, flist] of facesByShell) {
    if (flist.length < 4) continue;
    eCount.clear();
    eDir.clear();
    for (const f of flist) {
      for (let k = 0; k < 3; k++) {
        const va = mesh.faces[3 * f + k];
        const vb = mesh.faces[3 * f + ((k + 1) % 3)];
        const key = va < vb ? va * V + vb : vb * V + va;
        eCount.set(key, (eCount.get(key) ?? 0) + 1);
        eDir.set(key, (eDir.get(key) ?? 0) + (va < vb ? 1 : -1));
      }
    }
    let closed = true;
    for (const [key, cnt] of eCount) {
      if (cnt !== 2 || eDir.get(key) !== 0) { closed = false; break; }
    }
    if (closed) shellClosed[s] = 1;
  }

  const yzRes = Math.min(48, Math.max(8, Math.ceil(Math.sqrt(overlapFaces.length))));
  const cellY = Math.max((uMaxY - uMinY) / yzRes, 1e-3);
  const cellZ = Math.max((uMaxZ - uMinZ) / yzRes, 1e-3);
  const gridPad = planeTol + 1e-3;
  const buckets: Array<number[] | undefined> = new Array(yzRes * yzRes);
  const largeFaces: number[] = [];

  const clampCell = (v: number) => (v < 0 ? 0 : v >= yzRes ? yzRes - 1 : v);
  for (const f of overlapFaces) {
    let fy0 = Infinity, fy1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = mesh.faces[3 * f + k];
      const y = mesh.positions[3 * v + 1], z = mesh.positions[3 * v + 2];
      if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
      if (z < fz0) fz0 = z; if (z > fz1) fz1 = z;
    }
    const iy0 = clampCell(Math.floor((fy0 - gridPad - uMinY) / cellY));
    const iy1 = clampCell(Math.floor((fy1 + gridPad - uMinY) / cellY));
    const iz0 = clampCell(Math.floor((fz0 - gridPad - uMinZ) / cellZ));
    const iz1 = clampCell(Math.floor((fz1 + gridPad - uMinZ) / cellZ));
    if ((iy1 - iy0 + 1) * (iz1 - iz0 + 1) > 64) {
      largeFaces.push(f);
      continue;
    }
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const idx = iz * yzRes + iy;
        let b = buckets[idx];
        if (!b) { b = []; buckets[idx] = b; }
        b.push(f);
      }
    }
  }

  const triTol = Math.max(planeTol * 0.5, 1e-4);
  const parity = new Uint8Array(shellCount);
  const touchedFlag = new Uint8Array(shellCount);
  const touched: number[] = [];

  const scanOpposite = (
    facesList: readonly number[] | undefined,
    qx: number, qy: number, qz: number,
    nx: number, ny: number, nz: number,
    selfShell: number,
  ): boolean => {
    if (!facesList) return false;
    for (let idx = 0; idx < facesList.length; idx++) {
      const g = facesList[idx];
      const sOther = faceShells[g];
      if (sOther === selfShell || sOther < 0) continue;
      const gnx = mesh.faceNormals[3 * g];
      const gny = mesh.faceNormals[3 * g + 1];
      const gnz = mesh.faceNormals[3 * g + 2];
      if (nx * gnx + ny * gny + nz * gnz > -0.98) continue;
      const ia = mesh.faces[3 * g];
      const ax = mesh.positions[3 * ia], ay = mesh.positions[3 * ia + 1], az = mesh.positions[3 * ia + 2];
      const pd = (qx - ax) * gnx + (qy - ay) * gny + (qz - az) * gnz;
      if (Math.abs(pd) > planeTol) continue;
      if (pointInFace3D(qx - pd * gnx, qy - pd * gny, qz - pd * gnz, mesh, g, gnx, gny, gnz, triTol)) {
        return true;
      }
    }
    return false;
  };

  const raycastList = (
    facesList: readonly number[] | undefined,
    rx: number, ry: number, rz: number,
    selfShell: number,
  ) => {
    if (!facesList) return;
    for (let idx = 0; idx < facesList.length; idx++) {
      const g = facesList[idx];
      const sOther = faceShells[g];
      if (sOther === selfShell || sOther < 0 || !shellClosed[sOther]) continue;
      const gnx = mesh.faceNormals[3 * g];
      if (Math.abs(gnx) <= 1e-12) continue;
      const ia = mesh.faces[3 * g], ib = mesh.faces[3 * g + 1], ic = mesh.faces[3 * g + 2];
      let cross = 0;
      for (let k = 0; k < 3; k++) {
        const va = k === 0 ? ia : k === 1 ? ib : ic;
        const vb = k === 0 ? ib : k === 1 ? ic : ia;
        // Kanoniczna kolejność wierzchołków zapewnia bit-identyczny test współdzielonych krawędzi.
        const lo = va < vb ? va : vb;
        const hi = va < vb ? vb : va;
        const z0 = mesh.positions[3 * lo + 2], z1 = mesh.positions[3 * hi + 2];
        if ((z0 > rz) === (z1 > rz)) continue;
        const y0 = mesh.positions[3 * lo + 1], y1 = mesh.positions[3 * hi + 1];
        const yInt = y0 + ((rz - z0) * (y1 - y0)) / (z1 - z0);
        if (ry < yInt) cross ^= 1;
      }
      if (cross === 0) continue;
      const gny = mesh.faceNormals[3 * g + 1], gnz = mesh.faceNormals[3 * g + 2];
      const ax = mesh.positions[3 * ia], ay = mesh.positions[3 * ia + 1], az = mesh.positions[3 * ia + 2];
      const xHit = ax - ((ry - ay) * gny + (rz - az) * gnz) / gnx;
      if (xHit > rx) {
        parity[sOther] ^= 1;
        if (!touchedFlag[sOther]) {
          touchedFlag[sOther] = 1;
          touched.push(sOther);
        }
      }
    }
  };

  return {
    shellOverlaps: (s) => s >= 0 && s < shellCount && overlaps[s] === 1,
    isFaceOccluded: (px, py, pz, inX, inY, inZ, deltaIn, nx, ny, nz, epsOut, selfShell) => {
      const qx = px + deltaIn * inX;
      const qy = py + deltaIn * inY;
      const qz = pz + deltaIn * inZ;
      if (qy >= uMinY - gridPad && qy <= uMaxY + gridPad && qz >= uMinZ - gridPad && qz <= uMaxZ + gridPad) {
        const qiy = clampCell(Math.floor((qy - uMinY) / cellY));
        const qiz = clampCell(Math.floor((qz - uMinZ) / cellZ));
        if (
          scanOpposite(buckets[qiz * yzRes + qiy], qx, qy, qz, nx, ny, nz, selfShell) ||
          scanOpposite(largeFaces, qx, qy, qz, nx, ny, nz, selfShell)
        ) {
          return true;
        }
      }

      const rx = qx + epsOut * nx;
      const ry = qy + epsOut * ny;
      const rz = qz + epsOut * nz;
      if (ry < uMinY || ry > uMaxY || rz < uMinZ || rz > uMaxZ) return false;
      const riy = clampCell(Math.floor((ry - uMinY) / cellY));
      const riz = clampCell(Math.floor((rz - uMinZ) / cellZ));
      raycastList(buckets[riz * yzRes + riy], rx, ry, rz, selfShell);
      raycastList(largeFaces, rx, ry, rz, selfShell);

      let inside = false;
      for (let i = 0; i < touched.length; i++) {
        const s = touched[i];
        if (parity[s] === 1) inside = true;
        parity[s] = 0;
        touchedFlag[s] = 0;
      }
      touched.length = 0;
      return inside;
    },
  };
}

/** Zwraca odsłonięte podprzedziały `[t0, t1]` krawędzi `e`, odcinając strefy styczne lub ukryte w innych bryłach. */
function clipExposedEdgeSegments(
  mesh: MeshData,
  occ: ShellOcclusionQuery,
  e: EdgeRecord,
  f0: number,
  f1: number,
  selfShell: number,
  size: number,
  planeTol: number,
): Array<readonly [number, number]> {
  const ax = mesh.positions[3 * e.v0], ay = mesh.positions[3 * e.v0 + 1], az = mesh.positions[3 * e.v0 + 2];
  const bx = mesh.positions[3 * e.v1], by = mesh.positions[3 * e.v1 + 1], bz = mesh.positions[3 * e.v1 + 2];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-12)) return [];
  const ux = dx / len, uy = dy / len, uz = dz / len;

  const faceProbe = (f: number) => {
    const a = mesh.faces[3 * f], b = mesh.faces[3 * f + 1], c = mesh.faces[3 * f + 2];
    const opp = a !== e.v0 && a !== e.v1 ? a : b !== e.v0 && b !== e.v1 ? b : c;
    const nx = mesh.faceNormals[3 * f], ny = mesh.faceNormals[3 * f + 1], nz = mesh.faceNormals[3 * f + 2];
    const wx = mesh.positions[3 * opp] - ax, wy = mesh.positions[3 * opp + 1] - ay, wz = mesh.positions[3 * opp + 2] - az;
    const proj = wx * ux + wy * uy + wz * uz;
    let px = wx - proj * ux, py = wy - proj * uy, pz = wz - proj * uz;
    const alt = Math.hypot(px, py, pz);
    if (alt > 1e-12) {
      px /= alt; py /= alt; pz /= alt;
    } else {
      px = ny * uz - nz * uy; py = nz * ux - nx * uz; pz = nx * uy - ny * ux;
      const cl = Math.hypot(px, py, pz) || 1;
      px /= cl; py /= cl; pz /= cl;
    }
    const deltaIn = alt > 1e-12 ? Math.min(planeTol * 2, alt * 0.25, 0.02) : Math.min(planeTol * 0.5, 1e-3);
    return { ix: px, iy: py, iz: pz, deltaIn, nx, ny, nz };
  };

  const p0 = faceProbe(f0);
  const p1 = faceProbe(f1);
  const epsOut = Math.min(planeTol * 0.5, 0.005);
  const isOccludedAt = (t: number): boolean => {
    const px = ax + t * dx, py = ay + t * dy, pz = az + t * dz;
    return (
      occ.isFaceOccluded(px, py, pz, p0.ix, p0.iy, p0.iz, p0.deltaIn, p0.nx, p0.ny, p0.nz, epsOut, selfShell) ||
      occ.isFaceOccluded(px, py, pz, p1.ix, p1.iy, p1.iz, p1.deltaIn, p1.nx, p1.ny, p1.nz, epsOut, selfShell)
    );
  };

  const step = Math.min(Math.max(size * 0.25, 0.05), 0.3);
  const M = Math.min(512, Math.max(12, Math.ceil(len / step)));
  const blocked = new Uint8Array(M);
  let anyBlocked = false;
  let anyExposed = false;
  for (let k = 0; k < M; k++) {
    if (isOccludedAt((k + 0.5) / M)) {
      blocked[k] = 1;
      anyBlocked = true;
    } else {
      anyExposed = true;
    }
  }
  if (!anyBlocked) return [[0, 1]];
  if (!anyExposed) return [];

  const bisectEdge = (tBlocked: number, tExposed: number): number => {
    let b = tBlocked, ex = tExposed;
    for (let it = 0; it < 8; it++) {
      const mid = (b + ex) * 0.5;
      if (isOccludedAt(mid)) b = mid; else ex = mid;
    }
    return ex;
  };

  const minSegLen = Math.max(1e-4, planeTol * 2);
  const out: Array<readonly [number, number]> = [];
  let k = 0;
  while (k < M) {
    if (blocked[k]) { k++; continue; }
    const k0 = k;
    while (k + 1 < M && !blocked[k + 1]) k++;
    const k1 = k;
    const t0 = k0 === 0 ? 0 : bisectEdge((k0 - 0.5) / M, (k0 + 0.5) / M);
    const t1 = k1 === M - 1 ? 1 : bisectEdge((k1 + 1.5) / M, (k1 + 0.5) / M);
    if ((t1 - t0) * len > minSegLen) out.push([t0, t1]);
    k++;
  }
  return out;
}

/**
 * Odległość (wzdłuż łańcucha zaznaczonych krawędzi) każdego końca cechy od
 * najbliższego wolnego końca łańcucha. Wynik: [endA_0, endB_0, endA_1, endB_1, ...].
 * Wartość Infinity oznacza łańcuch zamknięty (brak końca — brak wygaszania).
 *
 * Stopień liczymy per klucz końca, ale współliniowe odcinki między powłokami (zgodne
 * normalne ścian i wypukłość) są łączone mostkiem — ciągła prosta krawędź przez styk
 * dwóch brył nie zwęża się do zera na środku.
 */
function computeChainEndDistance(specs: readonly FeatureSpec[], seamBridgeTol: number): Float64Array | null {
  const adjacency = new Map<string, Array<{ to: string; len: number }>>();
  const degree = new Map<string, number>();
  const incidentSigns = new Map<string, { hasConvex: boolean; hasConcave: boolean }>();
  const endpointKeys: Array<[string, string]> = [];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const k0 = s.endKeyA;
    const k1 = s.endKeyB;
    endpointKeys.push([k0, k1]);
    if (!adjacency.has(k0)) adjacency.set(k0, []);
    if (!adjacency.has(k1)) adjacency.set(k1, []);
    adjacency.get(k0)!.push({ to: k1, len: s.length });
    adjacency.get(k1)!.push({ to: k0, len: s.length });
    degree.set(k0, (degree.get(k0) ?? 0) + 1);
    degree.set(k1, (degree.get(k1) ?? 0) + 1);
    for (const k of [k0, k1]) {
      let info = incidentSigns.get(k);
      if (!info) { info = { hasConvex: false, hasConcave: false }; incidentSigns.set(k, info); }
      if (s.convex) info.hasConvex = true; else info.hasConcave = true;
    }
  }

  // Mostkowanie współliniowych końców między powłokami (lub szczelinami <= seamBridgeTol).
  interface Ep {
    specIdx: number; key: string;
    x: number; y: number; z: number;
    outX: number; outY: number; outZ: number;
  }
  const eps: Ep[] = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const dx = s.bx - s.ax, dy = s.by - s.ay, dz = s.bz - s.az;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    eps.push({ specIdx: i, key: s.endKeyA, x: s.ax, y: s.ay, z: s.az, outX: ux, outY: uy, outZ: uz });
    eps.push({ specIdx: i, key: s.endKeyB, x: s.bx, y: s.by, z: s.bz, outX: -ux, outY: -uy, outZ: -uz });
  }
  const cell = Math.max(seamBridgeTol, 1e-3);
  const inv = 1 / cell;
  const buckets = new Map<number, number[]>();
  const hash = (cx: number, cy: number, cz: number) => {
    let h = Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663) ^ Math.imul(cz | 0, 83492791);
    h ^= h >>> 13; h = Math.imul(h, 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  for (let i = 0; i < eps.length; i++) {
    const e = eps[i];
    const h = hash(Math.floor(e.x * inv), Math.floor(e.y * inv), Math.floor(e.z * inv));
    let b = buckets.get(h);
    if (!b) { b = []; buckets.set(h, b); }
    b.push(i);
  }
  const tol2 = seamBridgeTol * seamBridgeTol;
  const bridgedKeys = new Set<string>();
  const bridgedPairs = new Set<string>();
  for (let i = 0; i < eps.length; i++) {
    const a = eps[i];
    const sa = specs[a.specIdx];
    const cx = Math.floor(a.x * inv), cy = Math.floor(a.y * inv), cz = Math.floor(a.z * inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const b = buckets.get(hash(cx + dx, cy + dy, cz + dz));
          if (!b) continue;
          for (let bi = 0; bi < b.length; bi++) {
            const j = b[bi];
            if (j <= i) continue;
            const e2 = eps[j];
            if (a.specIdx === e2.specIdx || a.key === e2.key) continue;
            const sb = specs[e2.specIdx];
            if (sa.convex !== sb.convex) continue;
            const ddx = e2.x - a.x, ddy = e2.y - a.y, ddz = e2.z - a.z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > tol2) continue;
            const outDot = a.outX * e2.outX + a.outY * e2.outY + a.outZ * e2.outZ;
            if (outDot > -0.985) continue;
            if (!featurePlanesMatch(sa, sb)) continue;
            const pairKey = a.key < e2.key ? `${a.key}|${e2.key}` : `${e2.key}|${a.key}`;
            if (bridgedPairs.has(pairKey)) continue;
            bridgedPairs.add(pairKey);
            const gapLen = Math.sqrt(d2);
            adjacency.get(a.key)!.push({ to: e2.key, len: gapLen });
            adjacency.get(e2.key)!.push({ to: a.key, len: gapLen });
            degree.set(a.key, (degree.get(a.key) ?? 0) + 1);
            degree.set(e2.key, (degree.get(e2.key) ?? 0) + 1);
            bridgedKeys.add(a.key);
            bridgedKeys.add(e2.key);
          }
        }
      }
    }
  }

  // Narożnik siodłowy + odcięte końce na stykach ze ścianą sąsiednią wymuszają wygaszenie do 0.
  const forcedEnds = new Set<string>();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (!s.convex) {
      for (const k of [s.endKeyA, s.endKeyB]) {
        if (incidentSigns.get(k)?.hasConvex) forcedEnds.add(k);
      }
    }
    if (s.blockedA && !bridgedKeys.has(s.endKeyA)) forcedEnds.add(s.endKeyA);
    if (s.blockedB && !bridgedKeys.has(s.endKeyB)) forcedEnds.add(s.endKeyB);
  }

  const ends: string[] = [];
  for (const [k, d] of degree) if (d === 1) ends.push(k);
  for (const k of forcedEnds) {
    if (degree.has(k) && !ends.includes(k)) ends.push(k);
  }
  if (ends.length === 0) return null;

  // Dijkstra (kolejka z priorytetem przez proste kopcowanie binarne).
  const dist = new Map<string, number>();
  const heap: Array<{ v: string; d: number }> = [];
  const push = (v: string, d: number) => {
    heap.push({ v, d });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
      i = p;
    }
  };
  const pop = (): { v: string; d: number } | undefined => {
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

  const out = new Float64Array(specs.length * 2);
  for (let i = 0; i < specs.length; i++) {
    out[2 * i] = dist.get(endpointKeys[i][0]) ?? Infinity;
    out[2 * i + 1] = dist.get(endpointKeys[i][1]) ?? Infinity;
  }
  return out;
}
