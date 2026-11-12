/**
 * RoundEdge — parametry druku dla warstwy UI.
 *
 * Liczby drukowe mieszkają tu; reguły (minimalny promień = 2 × dysza) pochodzą
 * z `printability.ts`, gdzie są przetestowane. Ten moduł dodaje tylko warstwę
 * prezentacji: domyślne wartości, tabelę presetów i formatowanie liczb.
 */

import { NOZZLE_OPTIONS_MM, printRules } from './printability.ts';
import type { PrinterProfile } from './printability.ts';
import type { RoundingKind } from './meshTypes.ts';

export { NOZZLE_OPTIONS_MM };
export type { PrinterProfile };
export type { RoundingKind } from './meshTypes.ts';

/** Domyślny profil: drukarka desktopowa, dysza 0,4 mm, warstwa 0,2 mm, 2 ściany. */
export const DEFAULT_PROFILE: PrinterProfile = { nozzleMm: 0.4, layerHeightMm: 0.2, walls: 2 };

export const DEFAULT_NOZZLE_MM = DEFAULT_PROFILE.nozzleMm;
/** Maksymalny promień w suwaku (mm). */
export const RADIUS_MAX_MM = 5;
/** Krok suwaka promienia (mm). */
export const RADIUS_STEP_MM = 0.05;
/** Domyślny promień = 2 × domyślna dysza. */
export const DEFAULT_RADIUS_MM = 0.8;
/** Próg nawisu: ściana odchylona od osi budowania o więcej niż 45° wymaga podparcia. */
export const OVERHANG_ANGLE_DEG = 45;
/** Tolerancja zmiany gabarytu przy druku FDM (mm). */
export const PRINT_TOLERANCE_MM = 0.1;

export type PrintPresetId = 'safe' | 'strong' | 'chamfer' | 'custom';

export interface PrintPreset {
  id: PrintPresetId;
  label: string;
  kind: RoundingKind;
  /** Promień w mm albo null dla presetu „Własne”. */
  radiusMm: number | null;
  segments: number;
  tip: string;
}

/** Presety są wartościami bezwzględnymi — nie mnożnikami dyszy. */
export const PRINT_PRESETS: readonly PrintPreset[] = [
  {
    id: 'safe',
    label: 'Bezpieczne',
    kind: 'fillet',
    radiusMm: 0.8,
    segments: 3,
    tip: 'Dwie szerokości dyszy — subtelne, ale widoczne złagodzenie krawędzi.',
  },
  {
    id: 'strong',
    label: 'Wytrzymałe',
    kind: 'fillet',
    radiusMm: 1.6,
    segments: 5,
    tip: 'Mniejsza koncentracja naprężeń w narożnikach; zużywa więcej materiału.',
  },
  {
    id: 'chamfer',
    label: 'Ścięcie 45°',
    kind: 'chamfer',
    radiusMm: 0.8,
    segments: 1,
    tip: 'Płaskie ścięcie zamiast łuku — przewidywalne przy krawędziach opierających się o stół.',
  },
  {
    id: 'custom',
    label: 'Własne',
    kind: 'fillet',
    radiusMm: null,
    segments: 3,
    tip: 'Pełna kontrola: typ, promień i liczba segmentów.',
  },
];

/** Minimalny drukowalny promień zaokrąglenia dla danej dyszy (2 × dysza). */
export function minRadiusMm(nozzleMm: number): number {
  return printRules({ ...DEFAULT_PROFILE, nozzleMm }).minRadiusMm;
}

/** Liczba z przecinkiem dziesiętnym: 0.8 → "0,80". */
export function fmtMm(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}
