# RoundEdge — Przebudowa pod druk 3D (plan wdrożenia)

> **Dla agentów wykonawczych:** wdrażaj zadania po kolei, każde z osobnym testem.
> Podejście TDD obowiązuje: RED → GREEN → REFACTOR. Każde zadanie kończy się
> zielonym `npm test`, `npm run lint`, `npx tsc -b`.

**Cel:** RoundEdge ma produkować modele, które drukują się dobrze — z prawdziwym
zaokrągleniem (łuk styczny do ścian, nie łamana), promieniem niezależnym od
zagęszczenia siatki, uczciwym raportem i interfejsem w stylu PrintFins.

**Architektura:** rdzeń geometryczny (`src/utils/edgeRounding.ts`) zostaje, ale
otrzymuje trzy poprawki strukturalne: (1) zbieranie płaszczyzn filletu bez
heurystyki normalnej wierzchołka, (2) geometryczny (a nie siatkowy) limit
promienia oparty o odległość do przeciwległej powierzchni, (3) test wykonalności
dla ostrych klinów. Do tego dochodzą: moduł oceny drukowalności
(`src/utils/printability.ts`), moduł odległości (`src/utils/meshClearance.ts`),
przebudowa GUI, Web Worker i porządki w repo.

**Stack:** React 19, TypeScript 6 (strict, `erasableSyntaxOnly`), Vite 8, three.js 0.185,
Tailwind 3, `node:test` jako runner (uruchamiany w procesie: `node tests/all.test.ts`).

**Źródła (przeczytaj przed implementacją):**
- `docs/audit/printability-audit.md` — 22 potwierdzone findingi + probe'y
- `docs/research/printability-algorithms.md` — 32 wymagania REQ-001…REQ-032
- `docs/design/printfins-reference.md` — zmierzone tokeny GUI
- `docs/design/ui-spec.md` — specyfikacja przebudowy GUI
- `docs/architecture/adr/` — decyzje (ADR 0001–0005)

---

## Globalne ograniczenia

- **Jednostki:** milimetry. Każda nowa wartość geometryczna ma jednostkę mm.
- **Float64 wszędzie** w geometrii; float32 tylko na eksport.
- **Zakaz wygładzania Laplacja/Taubina/HC** — brak jednostki długości, kurczy model.
- **Zakaz nowych zależności npm** bez uzasadnienia w PR.
- **`node --test` nie działa w tym środowisku** (spawn EPERM) — testy odpalamy
  w procesie przez `tests/all.test.ts`.
- **Node nie importuje `.tsx`** — testy UI robimy analizą statyczną źródła
  (tak jak dziś w `tests/ui.test.ts`) albo przez build SSR (`scripts/ssr-smoke.mjs`).
- **Komentarz wyjaśnia „dlaczego”, nie „co”**. Każda poprawka w rdzeniu musi
  zostawić komentarz z uzasadnieniem i numerem findingu (AUD-xxx / REQ-xxx).
- **Język UI i komentarzy w kodzie: polski** (jak dotąd w tym repo).

---

## Zadanie 1 — Odległość do przeciwległej powierzchni (`src/utils/meshClearance.ts`)

**Pliki:**
- Create: `src/utils/meshClearance.ts`
- Create: `tests/clearance.test.ts`
- Modify: `tests/all.test.ts` (dodaj `import './clearance.test.ts';`)

**Interfejs (produkowany):**

```ts
export interface ClearanceGrid {
  /** Odległość od punktu w kierunku `dir` do najbliższej powierzchni (bez własnych trójkątów). */
  rayDistance(x: number, y: number, z: number, dx: number, dy: number, dz: number,
              skipVertices: readonly number[], maxDistance: number): number;
  /** Wolny odstęp krawędzi: minimalna odległość do powierzchni wzdłuż normalnych obu ścian. */
  edgeClearance(edge: EdgeRecord): number;
}

export function buildClearanceGrid(mesh: MeshData): ClearanceGrid;
```

**Jak to działa (algorytm — implementuj dokładnie tak):**

1. Zrównaj siatkę: jednostki mm, `Float64Array` pozycji, `Int32Array` ścian.
2. Zbuduj **jednorodną siatkę przestrzenną (uniform grid)** nad trójkątami:
   - rozmiar komórki `cell = max(medianEdgeLength, diag/64)`, gdzie `diag` to przekątna bbox;
   - każdy trójkąt wpisujesz do wszystkich komórek jego AABB (nie do jednej);
   - trójkąty o zdegenerowanym polu pomijasz.
3. `rayDistance(...)`: poruszasz się po komórkach siatki (3D DDA albo krok po krokach
   po osi o największej składowej kierunku) i w każdej sprawdzanej komórce liczysz
   przecięcie promienia z każdym trójkątem (Möller–Trumbore). Zwraca najmniejsze
   `t > eps`, gdzie `eps = 1e-6 · diag`; jeśli nic nie trafiło w `maxDistance`,
   zwraca `maxDistance`.
4. `edgeClearance(edge)`: bierzesz **środek krawędzi** i rzucasz **dwa promienie**:
   po `-n0` i po `-n1` (w głąb materiału), gdzie `n0`, `n1` to znormalizowane normalne
   ścian sąsiadujących (`mesh.faceNormals` dla `edge.faces[0]` i `edge.faces[1]`).
   Pomijasz trójkąty zawierające wierzchołki krawędzi (`skipVertices`).
   `edgeClearance` = `min(rayDistance(-n0), rayDistance(-n1)) / 2`.
   **To jest maksymalny promień filletu, który nie zderzy się z przeciwległą ścianą:**
   dla żebra o grubości `w` daje `w/2`, dla krawędzi kostki o boku `a` daje `a/2`.

**Testy (RED najpierw, w `tests/clearance.test.ts`):**

| # | Nazwa | Asercja |
|---|---|---|
| T1 | `clearance: kostka 20 mm — krawędź ma wolny odstęp 10 mm` | `edgeClearance` ≈ 10 ± 0.01 dla każdej z 12 krawędzi kostki 20 mm |
| T2 | `clearance: żebro 1 mm — krawędź ma wolny odstęp 0.5 mm` | żebro 40×1×20, krawędź wzdłuż żebra: `edgeClearance` ≈ 0.5 ± 0.01 |
| T3 | `clearance: niezależny od zagęszczenia` | ta sama bryła podzielona 1×, 8×, 16× daje `edgeClearance` różniące się < 1 % |
| T4 | `clearance: promień na zewnątrz nie trafia w nic` | `rayDistance` w kierunku `-n` z brzegu pustej bryły = `maxDistance` |
| T5 | `clearance: brak NaN` | wszystkie wyniki skończone i ≥ 0 |

**Wzorce do naśladowania:** `src/utils/meshTopology.ts` (welding, `buildTopology`),
`src/utils/edgeRounding.ts` klasa `FeatureGrid` (haszowanie komórek) — **nie kopiuj
`FeatureGrid`**, bo on indeksuje odcinki, nie trójkąty.

---

## Zadanie 2 — Moduł oceny drukowalności (`src/utils/printability.ts`)

**Pliki:**
- Create: `src/utils/printability.ts`
- Create: `tests/printability.test.ts`
- Modify: `tests/all.test.ts`

**Interfejs (produkowany):**

```ts
export interface PrinterProfile {
  /** Średnica dyszy (mm). */
  nozzleMm: number;
  /** Wysokość warstwy (mm). */
  layerHeightMm: number;
  /** Liczba ścian (perimetrów) do wydruku. */
  walls: number;
}

export const NOZZLE_OPTIONS_MM: readonly number[];  // [0.2,0.25,0.4,0.6,0.8,1.0,1.2,1.4,1.6,1.8,2.0]

export interface PrintRules {
  /** Minimalny promień zaokrąglenia = 2 × dysza (REQ-001). */
  minRadiusMm: number;
  /** Minimalna grubość ściany = walls × szerokość ekstruzji. */
  minWallMm: number;
  /** Minimalna średnica otworu. */
  minHoleMm: number;
}

export function printRules(profile: PrinterProfile): PrintRules;
export function defaultProfile(): PrinterProfile;

export interface OverhangFace {
  faceIndex: number;
  /** Kąt powierzchni od pionu (deg); 0 = prosto w dół, 90 = poziomo. */
  angleFromVerticalDeg: number;
  areaMm2: number;
}

export function analyzeOverhangs(mesh: MeshData, maxAngleFromVerticalDeg: number): OverhangFace[];
export function overhangAreaMm2(mesh: MeshData, maxAngleFromVerticalDeg: number): number;

export interface PrintabilityReport {
  profile: PrinterProfile;
  rules: PrintRules;
  /** Promień, którego użyto. */
  requestedRadiusMm: number;
  /** Czy promień jest mniejszy niż minimalny drukowalny. */
  radiusBelowMinimum: boolean;
  /** Liczba nawisów wymagających podparcia. */
  overhangFaceCount: number;
  overhangAreaMm2: number;
  /** Ostrzeżenia po polsku, gotowe do pokazania w UI. */
  warnings: string[];
}

export function analyzePrintability(
  mesh: MeshData,
  profile: PrinterProfile,
  options: { radiusMm: number; maxAngleFromVerticalDeg?: number },
): PrintabilityReport;
```

**Reguły (wartości pochodzą z `docs/research/printability-algorithms.md`, REQ-001…):**

- `minRadiusMm = 2 × nozzleMm` → dla dyszy 0.4 mm: **0.8 mm**.
  Przy mniejszym promieniu zaokrąglenie nie jest widoczne w warstwie i nie usuwa
  koncentracji naprężeń.
- `minWallMm = walls × nozzleMm × 1.125` (szerokość ekstruzji ≈ 1.125 × dysza).
  Dla dyszy 0.4 i 2 ścian: **0.9 mm**.
- `minHoleMm = 2 × nozzleMm` → 0.8 mm.
- Nawis: ściana wymaga podparcia, gdy **kąt od pionu > 45°** (domyślnie).
  Kąt liczymy z normalnej ściany: `angleFromVertical = acos(n · (0,0,1))` w stopniach,
  gdzie `(0,0,1)` to kierunek budowania (oś Z). Ściana skierowana w dół (`n_z < 0`)
  ma kąt > 90°. Raportujemy tylko ściany o kącie **większym** niż próg.
  (Uwaga: próg „45° od pionu" to 45° **od dołu**; implementacja: kąt od osi Z.)

**Testy (w `tests/printability.test.ts`):**

| # | Nazwa | Asercja |
|---|---|---|
| T1 | `profil drukarki: minimalny promień = 2 × dysza` | `printRules({nozzleMm:0.4,...}).minRadiusMm === 0.8` |
| T2 | `profil drukarki: minimalna ściana = ściany × ekstruzja` | `walls:2, nozzle 0.4 → minWallMm ≈ 0.9` |
| T3 | `dysze: dokładnie 11 wartości, 0.2…2.0` | `NOZZLE_OPTIONS_MM.length === 11` |
| T4 | `nawisy: dach kopyłkowy ma nawisy, dno nie` | mesh = ostrosłup skierowany do góry: `overhangFaceCount > 0`; odwrócony: `=== 0` |
| T5 | `nawisy: raportowane pole jest dodatnie i zgodne z sumą pól ścian` | `overhangAreaMm2` = suma `faceAreas` zaznaczonych ścian |
| T6 | `raport: promień poniżej minimum generuje ostrzeżenie po polsku` | `radiusBelowMinimum === true` i `warnings` zawiera „0.8" |
| T7 | `raport: brak NaN i pusty model nie wywala funkcji` | pusty model → `overhangFaceCount === 0`, brak NaN |

---

## Zadanie 3 — Rozdzielenie geometrii Pythona od FastAPI

**Pliki:**
- Create: `app/geometry.py`
- Modify: `app/main.py`
- Modify: `scripts/verify_backend.py`

**Co zrobić:**
1. Przenieś do `app/geometry.py` **wszystko bez zależności zewnętrznych**:
   `parse_binary_stl`, `parse_ascii_stl`, `parse_stl`, `weld`, `signed_volume`, `inspect`,
   typ `Vector`. **Zero importów spoza standardowej biblioteki.**
2. `app/main.py` importuje z `app.geometry` i zostaje warstwą HTTP (FastAPI).
   `app/main.py` nadal musi działać, gdy FastAPI jest zainstalowane.
3. `scripts/verify_backend.py` importuje z `app.geometry` — dzięki temu
   `python scripts/verify_backend.py` działa **bez instalowania fastapi**.
4. Usuń `app/__pycache__` z indeksu git (już zignorowane).

**Test:** `python scripts/verify_backend.py` → exit 0 i to samo wyjście co przed zmianą
(porównaj z „złotymi" wartościami w skrypcie). **To jest jednocześnie test i weryfikacja.**

---

## Zadanie 4 — Przebudowa rdzenia filletu (`src/utils/edgeRounding.ts`)

> **To jest najważniejsze zadanie.** Wykonaj je po zadaniach 1–3.
> Jeden wykonawca, jeden plik — żeby zmiany były spójne.

**Pliki:**
- Modify: `src/utils/edgeRounding.ts`
- Modify: `src/utils/meshTypes.ts`
- Create: `tests/fillet-core.test.ts`
- Modify: `tests/rounding.test.ts` (popraw rozbieżne twierdzenia)
- Modify: `tests/all.test.ts`

### 4.1 — Zbieranie płaszczyzn bez heurystyki normalnej (AUD-002, ~1 h)

**Co jest złe:** `edgeRounding.ts:793-794` odrzuca płaszczyznę, gdy
`v · n < -0.35`. Dla wierzchołka leżącego na jednej ze ścian wypełnienia
`v · n_other = cos(180° − θ)`, więc dla `θ < 69.5°` druga płaszczyzna jest odrzucana
→ ściana nie zjeżdża na łuk (błąd 0.277·r).

**Co zrobić:** **usuń oba warunki oparte na normalnej wierzchołka.**
Zachowaj test położenia (`d0`, `d1` wobec `guard`) — on poprawnie odrzuca
płaszczyzny „z drugiej strony" cienkiej ściany.

```ts
// PRZED (usunąć):
//   if (vnx * f.n0x + vny * f.n0y + vnz * f.n0z < -0.35) continue;
//   if (vnx * f.n1x + vny * f.n1y + vnz * f.n1z < -0.35) continue;
```

**Test (RED najpierw):** klin o kącie materiału 60°, `r = 1`, `segments = 8`
→ **każdy** wierzchołek ściany w paście musi leżeć na łuku
(odległość od osi łuku = `r` ± 1e-6). Dziś błąd wynosi 0.277·r.
Test ma zbudować klin tak samo jak `docs/audit/printability-audit.md` (probe1c):
profil 2D w skłajpionej płaszczyznie, wyciągnięty w Z, wybór krawędzi przez
`Math.hypot(mx,my) < 1e-6`.

### 4.2 — Limit promienia z geometrii, nie z siatki (AUD-003, ~4 h)

**Co jest złe:** `edgeRounding.ts:666`
`radiusCap = Math.min(0.5 * medianIncident, 0.5 * minBboxDim)` — maksymalny promień to
**połowa długości krawędzi siatki**. Im gęstsza siatka, tym mniejszy promień
(kostka 20 mm: podział 8× → r=1.0; 16× → r=0.625; 32× → r=0.3125).
To myli rozdzielczość siatki z rozmiarem cechy.

**Co zrobić:**
1. Usuń `medianIncident`, `incidentSamples`, `computeMinIncidentEdge` i limit
   `0.25 * minEdge` z `localLimit` (`:825`).
2. Promień ogranicz **geometrycznie**, per krawędź, przez `meshClearance`:
   `rMaxEdge = edgeClearance(edge)` (zadanie 1). Dla krawędzi: `r ≤ rMaxEdge`.
3. Globalny limit modelu: `rMaxModel = min(rMaxEdge)` po wszystkich **wybranych**
   krawędziach. `effectiveRadius = min(radiusRequested, rMaxModel)`.
4. Gdy `radiusRequested > rMaxModel` → **powiadom w raporcie i w ostrzeżeniach**,
   podając wartość obu promieni (żeby UI nie kłamało).
5. Ograniczenie `0.5 * minBboxDim` **zachowaj** jako zabezpieczenie (jest niezależne
   od siatki), ale ostateczny limit to minimum z `rMaxModel`.

**Testy:**

| # | Nazwa | Asercja |
|---|---|---|
| T1 | `promień nie zależy od zagęszczenia siatki` | kostka 20 mm, r=1, podziały 1, 4, 8, 16, 32 → `effectiveRadius === 1` we wszystkich; błąd wierzchołków vs ideał < 1e-6 |
| T2 | `żebro 1 mm ogranicza promień do 0.5 mm` | żebro 40×1×20, r=2 → `effectiveRadius ≤ 0.5 + 1e-9` i ostrzeżenie o przycięciu |
| T3 | `ostrzeganie o przycięciu zawiera obie wartości` | ostrzeżenie zawiera „2.00" (żądane) i „0.5" (efektywne) |

### 4.3 — Wykonalność geometryczna dla ostrych klinów (AUD-001, ~3 h)

**Co jest złe:** limit `|Δ| ≤ r` (`:825`) jest sprzeczny z geometrią: dla klina o kącie
materiału `θ` wierzchołek musi przesunąć się o `r/sin(θ/2) − r` (dla θ=30° to **2.86·r**).
Dziś dla `θ ≤ 30°` narożnik **nie zmienia się wcale**, a dla `θ = 45°` powstaje łuk
o promieniu **1.613 zamiast 1.0** (za duży) — a ostrzeżenie mówi, że promień jest
*mniejszy*.

**Co zrobić:**
1. Dla każdej wybranej krawędzi oblicz **maksymalny promień, jaki da się wykonać**
   przy jej kącie materiału `θ`:
   `rMaxAngle = r · sin(θ/2) / (1 − sin(θ/2))` (z `θ = π − normalAngle`).
   Dla `θ = 90°`: `rMaxAngle = r`. Dla `θ = 45°`: `r · 0.383 = 0.383·r`.
2. Promień efektywny krawędzi: `rEdge = min(radiusRequested, rMaxEdge, rMaxAngle)`.
   Gdy `rMaxAngle < radiusRequested` → krawędź **nie da się** zaokrąglić zgodnie
   z zamówieniem. Wariant do wyboru (wydaj **oba**):
   - zaokrąglij z `rEdge` i **zgłoś w raporcie**, że promień tej krawędzi jest mniejszy;
   - **pomiń** krawędź i zgłoś „nie da się zaokrąglić przy tym kącie".
   **Preferuj wariant 1** (zaokrągl z mniejszym promieniem), bo narożnik węższy
   niż 60° i tak wymaga zaokrąglenia. Krawędź z `rMaxAngle < 0.05·r` (klin ostrzejszy
   niż ~2°) pomiń — tam fillet nie istnieje.
3. **Per-krawędziowy promień** wymaga, żeby `computeDisplacement` dostał `size`
   właściwy dla tej krawędzi, a nie globalny. Zmiana w `roundEdges`: zamiast jednego
   `size` dla wszystkich, trzymaj `size` globalny (dla raportu i limitów), a dla
   obliczeń wierzchołka użyj `min(size, rMaxAngleEdge)`.
4. Popraw **tekst ostrzeżenia** o przycięciu: dziś mówi „wynikowy promień jest tam
   mniejszy niż zadany" — po poprawce to prawda, ale dodaj **które** krawędzie i **dlaczego**
   (za ostry kąt albo mały odstęp).

**Testy:**

| # | Nazwa | Asercja |
|---|---|---|
| T1 | `klin 30°: narożnik przesuwa się (nie zostaje w miejscu)` | apex displacement > 0.5·r (dziś 0.0) |
| T2 | `klin 45°: łuk ma promień ≤ zadanego` | wszystkie wierzchołki na łuku, promień ≤ r + 1e-9 (dziś 1.613) |
| T3 | `klin 90°: bez zmian (regresja)` | dokładnie jak dotąd: displacement = (√2−1)·r ± 1e-9 |
| T4 | `klin 120° i 150°: bez zmian` | displacement = r/sin(θ/2) − r ± 1e-9 |
| T5 | `ostrzeżenie o zbyt ostrym kącie pojawia się w raporcie` | `report.warnings` zawiera „kąt" |

### 4.4 — Uczciwy raport (AUD-003/004/007, P0.3, ~4 h)

**Nowe pola w `RoundingReport` (`src/utils/meshTypes.ts`):**

```ts
  /** Krawędzie, których wierzchołki FAKTYCZNIE się przesunęły (nie tylko „w paście"). */
  edgesRounded: number;
  /** Czy w ogóle zmieniono geometrię (false = operacja wycofana). */
  geometryChanged: boolean;
  /** Czy operacja została wycofana, bo powstały złe ściany. */
  failed: boolean;
  /** Krawędzie wycofane (numery indeksów w MeshData.edges). */
  failedEdgeIndices: number[];
  /** Zmierzony (nie teoretyczny) błąd powierzchni w paście (mm). */
  measuredSurfaceError: number;
  /** Promień, o który przycięto (żądany vs efektywny) — null gdy nie przycinano. */
  radiusClampReason: 'edge-length' | 'acute-angle' | 'clearance' | null;
```

**Co zrobić:**
1. `processedEdgeCount` ma znaczyć **krawędzie faktycznie zaokrąglone**.
   Licz je przez: krawędź należy do zaokrąglonych, jeśli **co najmniej jeden jej
   wierzchołek przesunął się o więcej niż 1e-9**. (Dziś liczy się krawędzie mające
   wierzchołek w paście → „Zaokrąglono 21 z 24", a nie przesunął się żaden.)
2. `geometryChanged = movedVertexCount > 0`.
3. `failed = true`, gdy pętla naprawcza wycofała wszystko (`:935-943`).
   Wtedy `edgesRounded = 0`, `geometryChanged = false`.
4. `failedEdgeIndices` — indeksy krawędzi, których wierzchołki zostały wycofane.
5. `measuredSurfaceError` — **zmierzony** błąd powierzchni (patrz 4.5).

### 4.5 — Zmierzony błąd powierzchni (AUD-008, ~3 h)

**Problem:** `chordDeviation` (`:973`) to teoria przy nieskończonie gęstej siatce.
Realny błąd na modelu 176 mm z `r = 0.5` wynosi **0.168 mm (34 % promienia)**,
a raport mówi 0.017 mm.

**Co zrobić:** zmierzyć, nie zgadywać.
1. Po zastosowaniu przemieszczeń, dla **każdego trójkąta w paście** (trójkąt, którego
   co najmniej jeden wierzchołek ma `inBand = 1`) oblicz **środek** trójkąta.
2. Dla środka oblicz **odległość do idealnej powierzchni filletu** przez ten sam
   mechanizm co `computeDisplacement`: odległość środka do powierzchni to długość
   wektora zwracanego przez `computeDisplacement` (towarzyszący punkt na powierzchni
   + promień `r`). **Nie wywołuj `computeDisplacement` ponownie** — wydziel z niego
   czystą funkcję `distanceToFilletSurface(planes, count, convex, size, ws): number | null`,
   której używa też `computeDisplacement`.
3. `measuredSurfaceError = max` tych odległości (0, gdy brak pasa).
4. `chordDeviation` zostaje w raporcie jako wartość teoretyczna, ale **UI pokazuje
   `measuredSurfaceError`** i ostrzeżenie buduje się na nim.

**Testy:**

| # | Nazwa | Asercja |
|---|---|---|
| T1 | `zmierzony błąd powierzchni jest niezerowy na grubym modelu` | kostka 176 mm, r=0.5 → `measuredSurfaceError > chordDeviation` |
| T2 | `zmierzony błąd maleje z zagęszczeniem` | ta sama bryła, więcej segmentów → `measuredSurfaceError` nie rośnie |
| T3 | `błąd jest zerowy, gdy brak pasa` | `edges = []` → `measuredSurfaceError === 0` |

### 4.6 — Kąt materiału zamiast kąta normalnych (AUD-010, P1.1, ~2 h)

`edgeRounding.ts:738` (`arcAngle`) używa `minPhi` — kąta między **normalnymi**.
Kąt łuku filletu to `π − normalAngle` (kąt materiału). Zamień `arcAngle` na
`min over features of (π − normalAngle)` i popraw `chordDeviation` na
`r · (1 − cos(arcAngle / (2 · segments)))`.

**Test:** dla klina 120° długość cięciwy raportowana ma odpowiadać kątowi 60°.

---

## Zadanie 5 — Przebudowa GUI (styl PrintFins)

> **Źródło:** `docs/design/printfins-reference.md` (zmierzone tokeny) +
> `docs/design/ui-spec.md` (komponenty, copy, kolejność). Wykonaj po zadaniach 1–4,
> bo UI ma pokazywać nowe pola raportu.

**Pliki:**
- Modify: `tailwind.config.js`, `src/index.css`
- Create: `src/utils/printParams.ts`
- Create: `src/components/{TopBar,StatsRail,OptionsRail,StatusCard,ViewBar,HeroCard,Toasts}.tsx`
- Create: `src/components/ui/{Card,Segmented,Slider,DiagRow,Tooltip}.tsx`
- Modify: `src/App.tsx`, `src/components/ThreeViewer.tsx`
- Delete: `src/App.css` (martwy — potwierdź brak importu przed usunięciem)
- Modify: `tests/ui.test.ts`, `scripts/ssr-smoke.mjs`

**Obowiązkowe elementy (z ADR 0005):**

1. **Tokeny** w `tailwind.config.js` i `:root` w `src/index.css`, dokładnie jak
   w `docs/design/printfins-reference.md` §1: bg `#14161a`, panel `#1c1f26`,
   line `#2c313b`, text `#e7e9ee`, dim `#8d95a5`, accent `#4da3ff`,
   btn `#2a303a`, btn-hi `#333a46`, btn-line `#454d5c`; semantycznie
   warn `#ffb454`, error `#ff6b6b`, ok `#6fcf8b`. Kolory krawędzi (pomarańczowa =
   zaznaczona, fioletowa = wykryta) zostają jako kolory semantyczne.
2. **Usuń tryb jasny**: usuń `theme` ze `useState`, przycisk przełączający motyw,
   wszystkie klasy `.light` i `theme-*` z `src/index.css` oraz gałęzie motywu
   w `ThreeViewer.tsx`. W `src/` nie może zostać ani jedno wystąpienie `setTheme`,
   `theme-` ani `.light`.
3. **Układ**: pełnoekranowy canvas, górny pasek 52 px, pływające szyny
   (lewa = statystyki 272 px, prawa = parametry + status 264 px), pasek widoku
   w lewym dolnym narożniku, fps w prawym dolnym. Szyny mają `pointer-events: none`
   na szkielecie i `auto` na kartach.
4. **Karta środkowa** w stanie pustym: obramowanie przerywane, 3 kroki po polsku,
   nota „Wszystkie obliczenia lokalnie w przeglądarce", 2 przyciski demo.
5. **Nowe kontrolki**: selektor **Dysza** (`NOZZLE_OPTIONS_MM`) i suwak **Promień**
   w górnym pasku. Minimalny promień = `2 × dysza`; przy mniejszym — ostrzeżenie
   z `printability.ts`.
6. **Sekcja nawisów** w prawej szynie: liczba nawisów i ich pole, z progu 45°.
7. **Blokada eksportu**, gdy `report.failed === true` — przycisk „Pobierz STL"
   nieaktywny + jawna informacja „nie udało się zaokrąglić — plik to oryginał".
8. **Pokaż `measuredSurfaceError`** (nie `chordDeviation`) w wierszu diagnostyki
   i zbuduj na nim ostrzeżenie.

**Testy (do `tests/ui.test.ts`, analiza statyczna źródła jak dziś):**

| # | Nazwa |
|---|---|
| T1 | `UI: brak trybu jasnego (setTheme / theme- / .light nie występują w src/)` |
| T2 | `UI: tokeny hex w tailwind.config.js są identyczne z tokenami w index.css` |
| T3 | `UI: każdy komponent w src/components ma ≤ 150 linii` |
| T4 | `UI: górny pasek zawiera selektor dyszy i suwak promienia` |
| T5 | `UI: eksport jest blokowany, gdy report.failed` |
| T6 | `UI: raport pokazuje zmierzony błąd powierzchni (measuredSurfaceError)` |
| T7 | `UI: dostępność — aria-label / aria-pressed / aria-live w TopBar, OptionsRail, ViewBar, HeroCard` |

Do `scripts/ssr-smoke.mjs` dodaj 5 sprawdzeń: nagłówek, karta środkowa, przycisk
Import, przycisk Pobierz STL, selektor dyszy.

---

## Zadanie 6 — Web Worker i limit wejścia (AUD-005, P0.6, ~8 h)

**Pliki:**
- Create: `src/workers/rounding.worker.ts`
- Modify: `src/App.tsx` (wywołanie przez worker)
- Create: `tests/worker.test.ts`

**Co zrobić:**
1. Worker ma typ komunikatu:
   `{ type: 'round', id: number, positions: Float64Array, indices: Int32Array, options: RoundingOptions }`
   → `{ type: 'result', id, mesh: MeshData, report: RoundingReport }` albo
   `{ type: 'error', id, message }`.
2. W `App.tsx` wywołuj worker przez `new Worker(new URL('./workers/rounding.worker.ts', import.meta.url), { type: 'module' })`.
   Vite to obsługuje w trybie dev i build.
3. Worker buduje siatkę przez `buildMeshFromRaw` i liczy `roundEdges`.
4. Twardy limit wejścia: **300 000 trójkątów**. Powyżej — komunikat po polsku
   i brak uruchomienia (zamiast zamrożenia przeglądarki).
5. Debounce suwaka promienia: 150 ms + anulowanie poprzedniego żądania
   (`id` w komunikacie; worker ignoruje żądania o starszym `id`).

**Uwaga:** `RoundingOptions.edgeIndices` jest `Iterable<number>` — przez
`postMessage` structured clone **nie przeniesie** `Set` jako `Iterable` poprawnie
(„Set" jest klonowalny, ale `Iterable` typing zostaje `Set` — to OK). Żeby być
bezpiecznym, serializuj indeksy jako `number[]` i w workerze zrób `new Set(...)`.

**Testy:** `tests/worker.test.ts` sprawdza, że moduł workera eksportuje
`handleRoundRequest` (czystą funkcję, bez `self`), którą da się przetestować
w procesie; oraz że `RoundingOptions` jest serializowalny przez `structuredClone`.

---

## Zadanie 7 — Dokumentacja

**Pliki:**
- Modify: `README.md`, `MEMORY.md`, `SPEC.md`
- Create: `docs/architecture/adr/0006-*.md` … `0009-*.md`
- Modify: `docs/architecture/adr/README.md` (indeks)

**ADR-y do napisania (poza istniejącymi 0001–0005):**

| # | Tytuł | Treść |
|---|---|---|
| 0006 | Limit promienia z geometrii, nie z siatki | dlaczego `0.5·medianIncident` usunięto; nowy model z `meshClearance` |
| 0007 | Kąt materiału zamiast kąta normalnych | `π − normalAngle` wszędzie |
| 0008 | Raport mierzy, nie obiecuje | `measuredSurfaceError` vs `chordDeviation`; `failed` blokuje eksport |
| 0009 | Web Worker dla obliczeń geometrycznych | koszt, anulowanie, limit 300 k trójkątów |

**README/MEMORY/SPEC** muszą zgadzać się z kodem po przebudowie:
- `MEMORY.md` — nowa tabela bramek, nowe pułapki, nowa mapa plików;
- `README.md` — opis nowego GUI, nowe parametry (dysza), nowe gwarancje;
- `SPEC.md` — zaktualizowana tabela „stan faktyczny" na górze (sekcja 5.1/5.2/5.3
  i §6.1 są dziś nieaktualne).

---

## kolejność wykonania

```
T1 (meshClearance) ─┐
T2 (printability) ──┼─► T4 (rdzeń filletu) ─► T5 (GUI) ─► T7 (dokumentacja)
T3 (python) ────────┘                                  ▲
                                        T6 (worker) ──┘
```

T1–T3 idą równolegle (różne pliki). T6 może iść równolegle z T5, ale oba
dotykają `src/App.tsx` — **T6 po T5**.

---

## Review Focus (wejścia, które najpewniej zepsują rzeczy)

1. **Ostry klin 30°** — narożnik musi się przesunąć; dziś nie rusza się wcale.
2. **Gęsta siatka (podział 16×+)** — promień musi zostać taki sam jak przy podziale 1×.
3. **Żebro 1 mm** — promień musi spaść do ≤ 0.5 mm, a eksport zablokować gdy się nie uda.
4. **Obrócony winding** — model o odwróconych normalnych nie może być raportowany jako spójny.
5. **Model z dziurą** — krawędzie brzegowe nadal muszą być pomijane, a wynik zamknięty.
6. **Pusty model (0 trójkątów)** — żadna funkcja nie może rzucić wyjątkiem.
7. **Pusty wybór krawędzi** — `roundEdges` musi zwrócić wejście bez zmian i bez błędu.
8. **Dwa przebiegi tego samego wejścia** — wynik identyczny bajt w bajt.
