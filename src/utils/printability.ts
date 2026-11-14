/**
 * RoundEdge — ocena drukowalności modelu dla drukarki FDM.
 *
 * Moduł odpowiada na dwa pytania: czy zaokrąglenie o zadanym promieniu ma w ogóle
 * sens dla tej drukarki oraz czy model ma nawisy wymagające podparcia.
 *
 * Źródła wartości: `docs/research/printability-algorithms.md` (REQ-001, REQ-019):
 *  - próg promienia zaokrąglenia = 2 × dysza (0.4 mm → 0.8 mm). Poniżej tego
 *    promienia łuk nie jest widoczny w warstwie i nie usuwa koncentracji naprężeń,
 *  - szerokość ekstruzji ≈ 1.125 × dysza (Prusa: 0.45 mm dla dyszy 0.4 mm),
 *    stąd minimalna ściana = liczba ścian × szerokość ekstruzji,
 *  - minimalna średnica otworu = 2 × dysza,
 *  - nawis: ściana, której normalna odchodzi od osi budowania (+Z) o więcej
 *    niż 45°, jest skierowana zbyt mocno w dół, aby utrzymać się bez podparcia.
 */

import type { MeshData } from './meshTypes.ts';

/** Profil drukarki: dysza, wysokość warstwy i liczba ścian. */
export interface PrinterProfile {
  /** Średnica dyszy (mm). */
  nozzleMm: number;
  /** Wysokość warstwy (mm). */
  layerHeightMm: number;
  /** Liczba ścian (perimetrów) do wydruku. */
  walls: number;
}

/** Typowe średnice dysz (mm) — lista wyboru w UI. */
export const NOZZLE_OPTIONS_MM: readonly number[] = [
  0.2, 0.25, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0,
];

/**
 * Linia ekstruzji jest szersza od średnicy dyszy: PrusaSlicer używa 0.45 mm
 * dla dyszy 0.4 mm, czyli 1.125 × dysza.
 */
const EXTRUSION_WIDTH_FACTOR = 1.125;

/** Domyślny próg nawisu: ściana odchylona od osi budowania o więcej niż 45°. */
const DEFAULT_MAX_OVERHANG_ANGLE_DEG = 45;

/** Reguły drukowalności wyprowadzone z profilu drukarki. */
export interface PrintRules {
  /** Minimalny promień zaokrąglenia = 2 × dysza (REQ-001). */
  minRadiusMm: number;
  /** Minimalna grubość ściany = walls × szerokość ekstruzji. */
  minWallMm: number;
  /** Minimalna średnica otworu = 2 × dysza. */
  minHoleMm: number;
}

/** Wylicza reguły drukowalności dla zadanego profilu drukarki. */
export function printRules(profile: PrinterProfile): PrintRules {
  return {
    minRadiusMm: 2 * profile.nozzleMm,
    minWallMm: profile.walls * profile.nozzleMm * EXTRUSION_WIDTH_FACTOR,
    minHoleMm: 2 * profile.nozzleMm,
  };
}

/** Domyślny profil: drukarka klasy desktop z dyszą 0.4 mm. */
export function defaultProfile(): PrinterProfile {
  return { nozzleMm: 0.4, layerHeightMm: 0.2, walls: 2 };
}

/** Ściana wymagająca podparcia. */
export interface OverhangFace {
  /** Indeks ściany w `MeshData.faces`. */
  faceIndex: number;
  /**
   * Kąt normalnej ściany od osi budowania (+Z) w stopniach:
   * 0° = ściana pozioma skierowana w górę, 90° = ściana pionowa,
   * 180° = ściana skierowana w dół.
   */
  angleFromVerticalDeg: number;
  /** Pole ściany (mm²). */
  areaMm2: number;
}

/**
 * Zwraca ściany wymagające podparcia: skierowane w dół, odchylone od pionu
 * bardziej niż `maxAngleFromVerticalDeg` (oś budowania +Z).
 */
export function analyzeOverhangs(mesh: MeshData, maxAngleFromVerticalDeg: number): OverhangFace[] {
  const overhangs: OverhangFace[] = [];
  const { faceNormals, faceAreas, faceCount, positions, faces, bboxMin } = mesh;
  const bedZ = bboxMin[2];
  const epsBed = 1e-4 * Math.max(1, mesh.bboxMax[2] - bedZ);
  for (let f = 0; f < faceCount; f++) {
    const nz = faceNormals[3 * f + 2];
    // Ochrona przed NaN w siatkach z uszkodzonymi danymi (STL z zerowym polem).
    if (!Number.isFinite(nz)) continue;
    const clamped = Math.max(-1, Math.min(1, nz));
    const angleFromVerticalDeg = (Math.acos(clamped) * 180) / Math.PI;
    // Nawis FDM: normalna skierowana w dół (poza dnem na stole).
    if (angleFromVerticalDeg <= 90) continue;
    const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
    const za = positions[a + 2], zb = positions[b + 2], zc = positions[c + 2];
    if (Math.abs(za - bedZ) <= epsBed && Math.abs(zb - bedZ) <= epsBed && Math.abs(zc - bedZ) <= epsBed) {
      continue;
    }
    // downAngle = kąt normalnej od osi -Z (0° = sufit). Nawis gdy odchylenie od pionu > limit.
    const downAngle = 180 - angleFromVerticalDeg;
    if (downAngle < (90 - maxAngleFromVerticalDeg) - 1e-9) {
      overhangs.push({ faceIndex: f, angleFromVerticalDeg, areaMm2: faceAreas[f] });
    }
  }
  return overhangs;
}

/** Łączne pole ścian wymagających podparcia (mm²). */
export function overhangAreaMm2(mesh: MeshData, maxAngleFromVerticalDeg: number): number {
  let area = 0;
  for (const face of analyzeOverhangs(mesh, maxAngleFromVerticalDeg)) area += face.areaMm2;
  return area;
}

/** Raport drukowalności — wejście dla komunikatów w UI. */
export interface PrintabilityReport {
  /** Profil drukarki, dla którego policzono raport. */
  profile: PrinterProfile;
  /** Reguły wynikające z profilu. */
  rules: PrintRules;
  /** Promień, którego użyto. */
  requestedRadiusMm: number;
  /** Czy promień jest mniejszy niż minimalny drukowalny. */
  radiusBelowMinimum: boolean;
  /** Liczba nawisów wymagających podparcia. */
  overhangFaceCount: number;
  /** Łączne pole nawisów (mm²). */
  overhangAreaMm2: number;
  /** Ostrzeżenia po polsku, gotowe do pokazania w UI. */
  warnings: string[];
}

/**
 * Ocenia model dla zadanego profilu drukarki i zadanego promienia
 * zaokrąglenia. Wynik jest czysty raport — nie modyfikuje siatki.
 */
export function analyzePrintability(
  mesh: MeshData,
  profile: PrinterProfile,
  options: { radiusMm: number; maxAngleFromVerticalDeg?: number },
): PrintabilityReport {
  const rules = printRules(profile);
  const maxAngle = options.maxAngleFromVerticalDeg ?? DEFAULT_MAX_OVERHANG_ANGLE_DEG;
  const overhangs = analyzeOverhangs(mesh, maxAngle);
  let areaMm2 = 0;
  for (const face of overhangs) areaMm2 += face.areaMm2;

  const radiusBelowMinimum = options.radiusMm < rules.minRadiusMm;
  const warnings: string[] = [];

  if (radiusBelowMinimum) {
    warnings.push(
      `Promień ${options.radiusMm.toFixed(2)} mm jest mniejszy niż minimalny drukowalny ` +
        `${rules.minRadiusMm.toFixed(2)} mm (2 × dysza ${profile.nozzleMm.toFixed(2)} mm) — ` +
        'zaokrąglenie będzie niewidoczne w warstwie.',
    );
  }

  if (overhangs.length > 0) {
    const noun =
      overhangs.length === 1 ? 'nawis wymagający podparcia' : 'nawisów wymagających podparcia';
    warnings.push(
      `Model ma ${overhangs.length} ${noun} (${areaMm2.toFixed(2)} mm² powierzchni) — ` +
        'rozważ podpory albo inne położenie modelu na stole.',
    );
  }

  return {
    profile,
    rules,
    requestedRadiusMm: options.radiusMm,
    radiusBelowMinimum,
    overhangFaceCount: overhangs.length,
    overhangAreaMm2: areaMm2,
    warnings,
  };
}
