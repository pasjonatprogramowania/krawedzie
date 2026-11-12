/**
 * RoundEdge — wspólne typy danych dla przetwarzania siatek.
 *
 * Zasady projektowe (patrz README/SPEC):
 *  - Wszystkie obliczenia geometrii w float64 (Float64Array), konwersja do float32
 *    wyłącznie na etapie eksportu/zasilania GPU.
 *  - Jednostki: milimetry (STL ich nie przechowuje — zakładamy mm).
 *  - Każda funkcja przetwarzająca zwraca NOWĄ siatkę; wejście nie jest mutowane.
 */

/** Krawędź topologiczna (v0 < v1) wraz z klasyfikacją. */
export interface EdgeRecord {
  /** Indeks w tablicy MeshData.edges. */
  index: number;
  v0: number;
  v1: number;
  /** Indeksy ścian incydentnych: 1 = brzeg, 2 = rozmaitość, >2 = nie-rozmaitość. */
  faces: number[];
  /** Kąt między normalnymi ścian (radiany, [0, PI]). 0 dla brzegu / nie-rozmaitości. */
  normalAngle: number;
  /** Kąt dwuścienny materiału (radiany): PI - normalAngle. */
  dihedral: number;
  /** Krawędź brzegowa (tylko jedna ściana) — dziura w siatce. */
  isBoundary: boolean;
  /** Więcej niż dwie ściany — geometria nie do wydruku. */
  isNonManifold: boolean;
  /** Wypukła (materiał po ujemnej stronie obu płaszczyzn) vs wklęsła. */
  isConvex: boolean;
  /** Długość w jednostkach modelu. */
  length: number;
}

/** Wyniki walidacji siatki pod kątem druku 3D. */
export interface MeshDiagnostics {
  vertexCount: number;
  faceCount: number;
  edgeCount: number;
  /** E = 3F/2 dla domkniętej triangulacji. */
  expectedEdgeCountForClosed: number;
  isClosed: boolean;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  /** Liczba krawędzi, których dwie ściany biegną w tę samą stronę (niespójny winding). */
  inconsistentWindingCount: number;
  /** Liczba ścian zdegenerowanych (usuniętych przy budowie). */
  degenerateFacesRemoved: number;
  /** Liczba zduplikowanych ścian (usuniętych przy budowie). */
  duplicateFacesRemoved: number;
  /** Liczba surowych wierzchołków scalonych przez welding. */
  weldedVertexCount: number;
  /** V - E + F. Sfera = 2, torus = 0. */
  eulerCharacteristic: number;
  connectedComponents: number;
  /** Liczba "dziur" topologicznych (tylko dla domkniętej, spójnej siatki). */
  genus: number;
  /** Objętość (tw. o dywergencji), jednostki^3. */
  volume: number;
  surfaceArea: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  size: [number, number, number];
  /** Długości krawędzi — diagnostyka gęstości siatki. */
  minEdgeLength: number;
  averageEdgeLength: number;
  maxEdgeLength: number;
  /** Ostrzeżenia w języku naturalnym (PL) do pokazania użytkownikowi. */
  warnings: string[];
}

/** Siatka trójkątna z pełną topologią. */
export interface MeshData {
  /** 3 * vertexCount współrzędnych (x,y,z). */
  positions: Float64Array;
  /** 3 * faceCount indeksów wierzchołków (CCW, normalne na zewnątrz). */
  faces: Int32Array;
  vertexCount: number;
  faceCount: number;
  /** Znormalizowane normalne ścian (3 * faceCount). */
  faceNormals: Float64Array;
  /** Pola ścian (faceCount); |AB x AC| / 2. */
  faceAreas: Float64Array;
  /** Ważone polami normalne wierzchołków (3 * vertexCount). */
  vertexNormals: Float64Array;
  edges: EdgeRecord[];
  /** Klucz krawędzi (v0 * vertexCount + v1, v0 < v1) -> indeks w `edges`. */
  edgeKeyToIndex: Map<number, number>;
  /** CSR: sąsiedzi wierzchołka. */
  neighborOffset: Int32Array;
  neighborIndices: Int32Array;
  /** CSR: ściany incydentne do wierzchołka. */
  vertexFaceOffset: Int32Array;
  vertexFaceIndices: Int32Array;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  inconsistentWindingCount: number;
}

export type RoundingKind = 'fillet' | 'chamfer';

export interface RoundingOptions {
  /** Promień zaokrąglenia (fillet) albo długość ramienia ścięcia (chamfer), w mm. */
  radius: number;
  /** Liczba segmentów łuku (1..16). Wpływa na gęstość siatki w pasie, nie na promień. */
  segments: number;
  kind: RoundingKind;
  /** Krawędzie do zaokrąglenia (indeksy w MeshData.edges). */
  edgeIndices: Iterable<number>;
  /**
   * Maksymalne przemieszczenie pojedynczego wierzchołka (mm).
   * Domyślnie = radius. Twarda gwarancja: Hausdorff(wynik, wejście) <= maxDisplacement.
   */
  maxDisplacement?: number;
  /** Kąt (deg) poniżej którego krawędź jest uznawana za płaską i pomijana. */
  flatAngleDeg?: number;
  /** Budżet trójkątów wyniku; po przekroczeniu refine przestaje dzielić. */
  triangleBudget?: number;
  /** Maksymalna liczba poziomów zagęszczania. */
  maxLevels?: number;
  /** Wygaszanie (run-out) na końcach łańcuchów krawędzi. */
  taperEnds?: boolean;
}

/** Raport z operacji zaokrąglania — dowód, że model nie został zniszczony. */
export interface RoundingReport {
  kind: RoundingKind;
  requestedRadius: number;
  /** Rzeczywisty promień po przycięciu do lokalnej skali siatki. */
  effectiveRadius: number;
  segments: number;
  selectedEdgeCount: number;
  /** Liczba krawędzi faktycznie zaokrąglonych (pominięto płaskie/brzegowe). */
  processedEdgeCount: number;
  skippedFlatEdgeCount: number;
  skippedBoundaryEdgeCount: number;
  skippedShortEdgeCount: number;
  refinementLevels: number;
  trianglesBefore: number;
  trianglesAfter: number;
  movedVertexCount: number;
  clampedVertexCount: number;
  relaxedVertexCount: number;
  revertedVertexCount: number;
  maxDisplacement: number;
  rmsDisplacement: number;
  /** Największa zmiana współrzędnej bbox (mm) — miara "czy nie zmieniono wymiarów". */
  bboxDelta: [number, number, number];
  volumeBefore: number;
  volumeAfter: number;
  volumeChangePercent: number;
  /** Największy kąt obrotu normalnej ściany (deg) — wykrywanie flipów. */
  maxFaceNormalRotationDeg: number;
  flippedFaceCount: number;
  degenerateFaceCount: number;
  /**
   * Teoretyczna strzałka łuku (mm) wynikająca z liczby segmentów — mówi, jaka byłaby
   * odchyłka, GDYBY siatka w pasie była dowolnie gęsta. Zob. `bandFacetSize`.
   */
  chordDeviation: number;
  /**
   * Najdłuższa krawędź siatki w pasie po zagęszczeniu (mm). To REALNA rozdzielczość,
   * z jaką łuk jest odtworzony: dopóki jest większa od promienia, o rzeczywistej
   * odchyłce decyduje siatka, a nie liczba segmentów. Górne ograniczenie odchyłki
   * to zawsze `maxDisplacement` (wierzchołki leżą dokładnie na powierzchni).
   */
  bandFacetSize: number;
  /** Czy zagęszczanie pasa przerwał limit trójkątów (wynik rzadszy niż żądany). */
  refinementLimitedByBudget: boolean;
  /** Krawędzie, których wierzchołki FAKTYCZNIE się przesunęły w wyniku końcowym. */
  edgesRounded: number;
  /** Czy zmieniono geometrię (false = operacja została wycofana). */
  geometryChanged: boolean;
  /** Czy operację wycofano, bo powstały złe ściany. */
  failed: boolean;
  /** Krawędzie wycofane (indeksy w MeshData.edges). */
  failedEdgeIndices: number[];
  /** Zmierzony (nie teoretyczny) błąd powierzchni w paście (mm). */
  measuredSurfaceError: number;
  /** Dlaczego promień został przycięty. */
  radiusClampReason: 'edge-length' | 'acute-angle' | 'clearance' | null;
  warnings: string[];
}

export interface RoundingResult {
  mesh: MeshData;
  report: RoundingReport;
}
