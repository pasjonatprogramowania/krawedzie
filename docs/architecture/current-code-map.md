# Mapa kodu (stan bieżący)

Stan na podstawie odczytu repozytorium (2026-11-12). Każde twierdzenie ma odniesienie `ścieżka:linia` lub nazwę skryptu/komendy. Plan przebudowy: `docs/superpowers/plans/2026-11-12-printability-rework.md:1-7`.

## 1. Mapa modułów

### 1.1 Konfiguracja i CI
- **`package.json`** (`package.json:1-35`): projekt `temp_vite` (`package.json:2`), ESM (`package.json:5`). Skrypty: `dev` → `vite`, `build` → `tsc -b && vite build`, `lint` → `oxlint`, `typecheck` → `tsc -b`, `test` → `node tests/all.test.ts`, `test:ssr` → `node scripts/ssr-smoke.mjs`, `check` → lint+typecheck+test+test:ssr+build (`package.json:6-14`). Zależności: React 19, three 0.185, lucide-react (`package.json:16-22`); dev: Vite 8, TypeScript ~6, oxlint, Tailwind 3 (`package.json:23-33`).
- **`.github/workflows/ci.yml`** (`.github/workflows/ci.yml:1-57`): workflow `CI`, triggery push/PR/dispatch (`.github/workflows/ci.yml:3-7`). Job `node` na macierzy Node `22.18.0` i `24` z `NODE_OPTIONS` dla 22 (`.github/workflows/ci.yml:17-29`), kroki: checkout, setup-node (cache npm), `npm ci`, lint, typecheck, `npm test`, `npm run test:ssr`, `npm run build` (`.github/workflows/ci.yml:30-45`). Job `python` na Python 3.11 uruchamia `python scripts/verify_backend.py` bez instalacji zależności (`.github/workflows/ci.yml:47-57`).

### 1.2 Publiczne API przetwarzania (barrel)
- **`src/utils/meshProcessing.ts`** (`src/utils/meshProcessing.ts:1-50`): moduł-zbiorczy, jedyny punkt importu dla aplikacji (`meshProcessing.ts:2-6`, użycie w `src/App.tsx:16-21`). Re-eksport typów `EdgeRecord/MeshData/MeshDiagnostics/RoundingKind/RoundingOptions/RoundingReport/RoundingResult` z `meshTypes.ts` (`meshProcessing.ts:8-16`), funkcji topologii i `WeldResult` z `meshTopology.ts` (`meshProcessing.ts:18-30`), `FeatureGrid/roundEdges/subdivideAllEdges/subdivideSelectedEdges` z `edgeRounding.ts` (`meshProcessing.ts:32`), I/O z `meshIO.ts` (`meshProcessing.ts:34-42`), eksportu z `meshExport.ts` (`meshProcessing.ts:44-50`).

### 1.3 Typy i kontrakty
- **`src/utils/meshTypes.ts`** (`src/utils/meshTypes.ts:1-188`): zasady – obliczenia float64, konwersja do float32 tylko przy eksporcie/GPU, jednostki mm (`meshTypes.ts:4-9`). `EdgeRecord` (indeks, para wierzchołków, ściany incydentne, `normalAngle`, `dihedral`, flagi boundary/non-manifold/convex, długość) (`meshTypes.ts:12-31`). `MeshDiagnostics` (liczności, domknięcie, błędy orientacji/degeneraty/duplikaty, Euler/genus/składowe, objętość/pole/bbox/rozmiar, długości krawędzi, ostrzeżenia PL) (`meshTypes.ts:34-68`). `MeshData` (pozycje Float64Array, indeksy Int32Array, normalne/pola, krawędzie, mapy i CSR sąsiedztwa/ścian, bbox, liczniki) (`meshTypes.ts:71-98`). `RoundingOptions` (`radius`, `segments`, `kind`, `edgeIndices`, `maxDisplacement?`, `flatAngleDeg?`, `triangleBudget?`, `maxLevels?`, `taperEnds?`) (`meshTypes.ts:102-123`). `RoundingReport` (promienie żądany/efektywny, liczniki selekcji/przetworzenia/pominięć, refine, trójkąty, przemieszczenia/clamp/relax/revert, bbox/objętość, flipy/degeneraty, `chordDeviation`, `bandFacetSize`, `refinementLimitedByBudget`, `edgesRounded`, `geometryChanged`, `failed`, `failedEdgeIndices`, `measuredSurfaceError`, `radiusClampReason`, ostrzeżenia) (`meshTypes.ts:126-183`). `RoundingResult { mesh, report }` (`meshTypes.ts:185-188`).

### 1.4 Topologia, walidacja i naprawa
- **`src/utils/meshTopology.ts`** (`src/utils/meshTopology.ts:1-817`): odporność na „brudne” STL/OBJ/3MF (welding siatką przestrzenną 27 komórek, usuwanie degeneratów/duplikatów, naprawa windingu, diagnostyka druku) (`meshTopology.ts:1-10`). Kluczowe eksporty: `edgeKey` (`meshTopology.ts:15-17`), `weldTriangleSoup` + `WeldResult` (spatial hash, tolerancja euklidesowa, remap, filtr degeneratów/duplikatów) (`meshTopology.ts:26-166`), `buildTopology` (normalne/pola, filtr degeneratów, budowa krawędzi i klasyfikacja, CSR, normalne wierzchołków, bbox) (`meshTopology.ts:172-424`), `edgeIsConvex` niezależny od windingu (`meshTopology.ts:431-450`), `bboxOf`/`boundingBoxDiagonal` (`meshTopology.ts:481-504`), `signedVolume` liczona względem środka bbox (`meshTopology.ts:515-531`), `surfaceArea` (`meshTopology.ts:533-537`), `orientFacesConsistently` (BFS po sąsiedztwie, korekta znaku objętości) (`meshTopology.ts:544-625`), `computeDiagnostics` (długości, składowe, Euler/genus, ostrzeżenia PL, wykrywanie wierzchołka non-manifold „bowtie”) (`meshTopology.ts:642-803`), `pointSegmentDistance` (`meshTopology.ts:805-817`).

### 1.5 I/O i budowa siatki
- **`src/utils/meshIO.ts`** (`src/utils/meshIO.ts:1-224`): pipeline – spłaszczenie do „zupy trójkątów”, tolerancyjny welding, budowa topologii, naprawa windingu, diagnostyka (`meshIO.ts:1-11`). `extractGeometryData` (pozycje/indeksy bez normal/UV) (`meshIO.ts:42-64`), `objectToTriangleSoup` z transformacją świata (`meshIO.ts:70-106`), `buildMeshFromRaw` z eskalacją tolerancji weldu `[1e-6,1e-5,1e-4]` i wyborem siatki domkniętej/najmniej brzegów oraz naprawą orientacji przy niespójnym windingu (`meshIO.ts:108-184`, `DEFAULT_TOLERANCES` `meshIO.ts:40`), `buildMeshFromGeometry` (`meshIO.ts:187-193`), `meshToGeometry` (indeksowana, float32, computeVertexNormals) (`meshIO.ts:196-206`), `meshToFlatGeometry` (nieindeksowana) (`meshIO.ts:209-224`).

### 1.6 Zaokrąglanie/ścięcie krawędzi (rdzeń)
- **`src/utils/edgeRounding.ts`** (`src/utils/edgeRounding.ts:1-1452`): analityczny fillet (opening/closing na półprzestrzeniach) i chamfer, bez Laplaciana/Taubina/HC; wierzchołki poza pasem bit-identyczne, ruch ograniczony promieniem; zagęszczanie pasa podziałem krawędzi (`edgeRounding.ts:1-43`). `FeatureGrid` (siatka przestrzenna odcinków, zapytania AABB) (`edgeRounding.ts:82-162`). Selekcja cech i pomijanie płaskich/brzegowych/non-manifold (`edgeRounding.ts:800-826`). Limit promienia z lokalnej skali i gabarytu (`medianIncident`, `0.5*minBboxDim`, clamp z ostrzeżeniem) (`edgeRounding.ts:828-860`). Kąt materiału `theta = π - normalAngle` do łuku/refine i limit ostry `rFeat` (`edgeRounding.ts:866-928`). Wygaszanie końców łańcuchów (Dijkstra po wybranych krawędziach) (`edgeRounding.ts:930-940`, `computeChainEndDistance` `edgeRounding.ts:1385-1452`). Zagęszczanie pasa `refineBand`/`splitMarkedEdges` z budżetem trójkątów (`edgeRounding.ts:216-357`). Rzut na fillet: `projectToCenters`/`distanceToFilletSurface`/`computeDisplacement` (QP aktywny zbiór, awaryjnie jedno ograniczenie) (`edgeRounding.ts:456-613`), zbieranie płaszczyzn `collectPlanes` z testem położenia/guardem (komentarz o odrzuceniu „drugiej strony” cienkiej ściany) (`edgeRounding.ts:629-682`). Pomiar błędu powierzchni w paście `measureSurfaceError` (`edgeRounding.ts:691-738`). Aplikacja przemieszczeń z relaksacją/revert/wycofaniem i ostateczną gwarancją, wyznaczenie faktycznie zaokrąglonych krawędzi, raport (`edgeRounding.ts:741-1321`, zwrot `edgeRounding.ts:1281-1320`).

### 1.7 Odstęp (clearance), drukowalność, parametry UI
- **`src/utils/meshClearance.ts`** (`src/utils/meshClearance.ts:1-342`): `buildClearanceGrid` nad trójkątami (uniform grid + DDA + Möller–Trumbore), `rayDistance` z pomijaniem wierzchołków po indeksach, `edgeClearance` = min odległości w głąb materiału po `-n0,-n1` ze środka krawędzi podzielone przez 2 (`meshClearance.ts:21-38`, `meshClearance.ts:48-336`).
- **`src/utils/printability.ts`** (`src/utils/printability.ts:1-170`): reguły FDM: `minRadiusMm = 2*nozzle`, `minWallMm = walls*nozzle*1.125`, `minHoleMm = 2*nozzle` (`printability.ts:44-60`), `NOZZLE_OPTIONS_MM` (`printability.ts:30-32`), analiza nawisów po kącie normalnej od osi budowania +Z (`printability.ts:85-99`), `analyzePrintability` z ostrzeżeniami PL (`printability.ts:130-169`).
- **`src/utils/printParams.ts`** (`src/utils/printParams.ts:1-88`): warstwa UI nad regułami druku – profil domyślny, stałe promienia/suwaka, presety `safe/strong/chamfer/custom`, `minRadiusMm(nozzle)`, formatowanie `fmtMm` (`printParams.ts:8-88`).

### 1.8 Eksport i picking/viewer
- **`src/utils/meshExport.ts`** (`src/utils/meshExport.ts:1-97`): binarny STL (nagłówek ≠ `solid`, 84 + 50*F, float32, normalne zapisane) `meshToBinarySTL`/`exportToSTL` (`meshExport.ts:16-64`), OBJ tekstowy `meshToOBJ`/`exportToOBJ` (`meshExport.ts:67-90`), formatowanie 6 miejsc (`meshExport.ts:92-96`).
- **`src/utils/viewerPicking.ts`** (`src/utils/viewerPicking.ts:1-100`): `pickEdgeIndex` (najbliższa krawędź trafionej ściany, próg względem wymiaru modelu) (`viewerPicking.ts:19-54`), `buildEdgeLines` z kolorami sharp/selected/hover i limitem rysowanych krawędzi (`viewerPicking.ts:56-100`).
- **`src/components/ThreeViewer.tsx`** (`src/components/ThreeViewer.tsx:1-140`): scena WebGL (renderer, OrbitControls, światła), przebudowa geometrii/overlay/linii krawędzi i siatki pomocniczej, ray-picking, obsługa myszy (`ThreeViewer.tsx:39-140`).

### 1.9 Aplikacja (UI/orkiestracja)
- **`src/App.tsx`** (`src/App.tsx:1-593`): stan pliku/siatki/diagnostyki, selekcji, parametrów (preset/kind/radius/segments/nozzle/compare), wyniku i busy (`App.tsx:39-63`). Wczytywanie STL/3MF/OBJ (loadery three), budowa przez `buildMeshFromRaw`, auto-selekcja ostrych krawędzi (`App.tsx:89-161`). Selekcja krawędzi (toggle/ostre/wszystkie/czyść) (`App.tsx:202-230`). Odroczone `roundEdges` w `setTimeout` (bez workera) z kluczem selekcji (`App.tsx:262-289`). Pobieranie STL/OBJ z `result?.mesh ?? meshData` (`App.tsx:292-305`). Ostrzeżenia UI (promień min, `measuredSurfaceError`, `bandFacetSize`, diagnostyka rozmiaru/domknięcia/non-manifold) (`App.tsx:308-360`), analiza nawisów (`App.tsx:363-370`), toasty, widok porównania, blokada eksportu gdy `report.failed` (`App.tsx:373-420`, `App.tsx:498-499`). Layout canvas-first + szyny/sheet, TopBar/StatsRail/OptionsRail/StatusCard/ViewBar/HeroCard/Toasts (`App.tsx:448-592`).

### 1.10 Opcjonalny backend Python (referencja/diagnostyka)
- **`app/geometry.py`** (`app/geometry.py:1-228`): czysta geometria/diagnostyka STL, tylko stdlib (`app/geometry.py:1-7`). Parsery STL bin/ASCII (`app/geometry.py:21-67`), welding siatką 27 komórek (`app/geometry.py:73-105`), `signed_volume` względem środka bbox (`app/geometry.py:108-123`), `inspect` (topologia, winding, składowe, Euler, bbox, ostrzeżenia) (`app/geometry.py:126-228`).
- **`app/main.py`** (`app/main.py:1-139`): FastAPI, zaokrąglanie świadomie niezaimplementowane (`/api/process` → 501), prawdziwa diagnostyka `/api/inspect` z eskalacją weldu, `/api/health` (`app/main.py:1-17`, `app/main.py:43-56`, `app/main.py:59-133`).
- **`scripts/verify_backend.py`** (`scripts/verify_backend.py:1-108`): krzyżowa weryfikacja Python vs „złote” wartości z implementacji TS dla `public/cube.stl` i `public/pranie.stl`; importuje wyłącznie `app.geometry` (`scripts/verify_backend.py:1-9`, `scripts/verify_backend.py:20-21`, `scripts/verify_backend.py:23-49`, `scripts/verify_backend.py:52-79`, `scripts/verify_backend.py:83-104`).

## 2. Przepływ danych end-to-end

1. **Import**: użytkownik wybiera/upuści plik (`App.tsx:163-199`). STL → `STLLoader().parse`, 3MF → `ThreeMFLoader().parse` + `objectToTriangleSoup`, OBJ → tekst + `OBJLoader().parse` + `objectToTriangleSoup` (`App.tsx:100-137`, `meshIO.ts:70-106`).
2. **Weld + topologia + diagnostyka**: `buildMeshFromRaw` scala wierzchołki tolerancyjnie (`meshIO.ts:108-159`, `meshTopology.ts:45-166`), buduje topologię i klasyfikuje krawędzie/ścieżki (`meshTopology.ts:172-424`), naprawia niespójny winding gdy potrzeba (`meshIO.ts:165-169`, `meshTopology.ts:544-625`), liczy diagnostykę druku (`meshTopology.ts:642-755`).
3. **Selekcja krawędzi**: auto-selekcja ostrych po kącie (domyślnie 30° w UI) lub ręczna przez picking (`App.tsx:147-154`, `App.tsx:202-229`, `ThreeViewer.tsx:129-137`, `viewerPicking.ts:19-54`).
4. **Zaokrąglanie/ścięcie**: `roundEdges(mesh, { radius, segments, kind, edgeIndices })` odrzuca płaskie/brzegowe/non-manifold, liczy promień efektywny i limity kątowe, zagęszcza pas, rzutuje wierzchołki na fillet/chamfer, naprawia flipy/degeneraty, mierzy błąd i buduje raport (`App.tsx:268-289`, `edgeRounding.ts:741-1321`).
5. **Wynik i porównanie**: stan `result`/`compareMode`, widok przed/po/overlay (`App.tsx:402-411`, `ThreeViewer.tsx:78-91`).
6. **Eksport**: `exportToSTL`/`exportToOBJ` z `result?.mesh ?? meshData` (przy `result.report.failed` UI blokuje eksport z komunikatem) (`App.tsx:292-305`, `App.tsx:419-420`, `App.tsx:494-499`, `meshExport.ts:62-90`).

## 3. Publiczna powierzchnia API (przetwarzanie)

Źródło: `src/utils/meshProcessing.ts:8-50`.

- Typy: `EdgeRecord, MeshData, MeshDiagnostics, RoundingKind, RoundingOptions, RoundingReport, RoundingResult` (`meshTypes.ts:12-188`).
- Topologia: `bboxOf, boundingBoxDiagonal, buildTopology, computeDiagnostics, edgeKey, orientFacesConsistently, pointSegmentDistance, signedVolume, surfaceArea, weldTriangleSoup`, typ `WeldResult` (`meshTopology.ts:15-817`).
- Rdzeń: `FeatureGrid, roundEdges, subdivideAllEdges, subdivideSelectedEdges` (`edgeRounding.ts:82-162`, `edgeRounding.ts:364-374`, `edgeRounding.ts:741-1321`).
- I/O: `buildMeshFromGeometry, buildMeshFromRaw, extractGeometryData, meshToFlatGeometry, meshToGeometry, objectToTriangleSoup`, typy `MeshBuildOptions, MeshBuildResult` (`meshIO.ts:22-224`).
- Eksport: `exportToOBJ, exportToSTL, meshToBinarySTL, meshToOBJ, STL_HEADER_BYTES` (`meshExport.ts:16-90`).

## 4. Niezmienniki (key invariants)

1. **Geometria w float64, float32 tylko na wyjściu GPU/eksportu.** Pozycje siatki jako `Float64Array` (`meshTypes.ts:7-8`, `meshTypes.ts:73`, `meshTopology.ts:119`), konwersja do `Float32Array` w `meshToGeometry/meshToFlatGeometry` i przy zapisie STL (`meshIO.ts:196-223`, `meshExport.ts:38-53`).
2. **Brak Laplaciana/smoothingu – fillet analityczny (rolling-ball/opening-closing) mm.** Opis algorytmu i odrzucenie Laplaciana/Taubina/HC w nagłówku rdzenia (`edgeRounding.ts:1-43`), projekcja na obszar środków kuli i zejście na sferę r (`edgeRounding.ts:441-455`, `edgeRounding.ts:604-613`).
3. **Wierzchołki poza pasem bandy nie są modyfikowane przez sam ruch filletu (bit-identyczne źródło ruchu), a podział pasa jest liniowy.** Założenie „wierzchołki poza pasmem bit-identyczne” i bezstratny podział liniowy (`edgeRounding.ts:31-42`); przemieszczenia stosowane tylko dla `moved[v]` (`edgeRounding.ts:1090-1098`, `edgeRounding.ts:968`).
4. **`measuredSurfaceError` (pomiar) i `chordDeviation` (teoria) są rozdzielone w raporcie.** `chordDeviation` jako strzałka teoretyczna i `bandFacetSize` jako realna rozdzielczość (`meshTypes.ts:156-167`), pomiar odległości środków trójkątów pasa od idealnej powierzchni `measureSurfaceError` (`edgeRounding.ts:691-738`), oba pola w raporcie (`edgeRounding.ts:1309-1316`, `meshTypes.ts:160-179`).
5. **Stan końcowy raportuje faktycznie zmienione krawędzie/wierzchołki i rozróżnia wycofanie.** `edgesRounded`/`geometryChanged`/`failed`/`failedEdgeIndices` liczone po zastosowaniu `scale` i ostatecznej gwarancji (`edgeRounding.ts:1154-1183`, `meshTypes.ts:170-177`), `failed` zwracany też przy braku ruchu (`edgeRounding.ts:1064-1082`).
6. **Limit promienia geometryczny/bezpieczeństwa: clamp do skali lokalnej i gabarytu oraz per-cecha dla ostrych kątów; blokady eksportu przy niepowodzeniu w UI.** Cap `min(0.5*medianIncident, 0.5*minBboxDim)` + ostrzeżenie (`edgeRounding.ts:846-860`), `rFeat` ograniczony przez kąt materiału i użyty dla filletu (`edgeRounding.ts:884-888`, `edgeRounding.ts:1018-1019`), `exportBlocked` gdy `result.report.failed` i komunikat o oryginale (`App.tsx:419-420`, `App.tsx:494-499`).
7. **Reguła minimalnego promienia drukowalnego = 2×dysza (FDM).** `printRules` ustawia `minRadiusMm = 2*nozzleMm` (`printability.ts:54-59`), UI liczy minimum jako `minRadiusMm(nozzleMm)` i ostrzega (`printParams.ts:81-83`, `App.tsx:86`, `App.tsx:308-327`).
8. **Naprawa orientacji i diagnostyka manifoldu są częścią budowy siatki.** Naprawa przy `inconsistentWindingCount > 0` i korekta znaku objętości (`meshIO.ts:165-169`, `meshTopology.ts:544-625`), diagnostyka boundary/non-manifold/winding/Euler/genus/ostrzeżenia (`meshTopology.ts:642-755`).

## 5. Mapa zestawu testów

Agregator uruchamia wszystkie zestawy w jednym procesie: `node tests/all.test.ts` (`tests/all.test.ts:1-18`, skrypt `npm test` `package.json:11`).

| Plik testu | Zakres (wg nazwy/importu) | Uwagi |
|---|---|---|
| `tests/topology.test.ts` | topologia/welding/diagnostyka/nnaprawa orientacji | import w `tests/all.test.ts:10`; liczba asercji: nie zweryfikowano |
| `tests/refinement.test.ts` | podziały/zagęszczanie krawędzi | `tests/all.test.ts:11`; nie zweryfikowano |
| `tests/rounding.test.ts` | zaokrąglanie/ścięcie, raport, zachowanie brzegowe | `tests/all.test.ts:12`; nie zweryfikowano |
| `tests/fillet-core.test.ts` | rdzeń filletu (przypadki geometryczne) | `tests/all.test.ts:13`; nie zweryfikowano |
| `tests/clearance.test.ts` | `meshClearance` (odległość do powierzchni) | `tests/all.test.ts:14`; nie zweryfikowano |
| `tests/printability.test.ts` | reguły drukowalności/nawisy | `tests/all.test.ts:15`; nie zweryfikowano |
| `tests/realmodels.test.ts` | modele rzeczywiste/regresje | `tests/all.test.ts:16`; nie zweryfikowano |
| `tests/pipeline.test.ts` | pipeline end-to-end/przetwarzanie | `tests/all.test.ts:17`; nie zweryfikowano |
| `tests/ui.test.ts` | UI (analiza statyczna/SSR smoke zależnie od treści) | `tests/all.test.ts:18`; nie zweryfikowano |

Łączna liczba testów w bieżącym środowisku: **nie zweryfikowano** (nie uruchamiano w tej sesji).

## 6. Uwagi o stanie i planie przebudowy

- Plan `docs/superpowers/plans/2026-11-12-printability-rework.md` definiuje cele i zadania (m.in. limit promienia z geometrii/clearance, raport mierzony, GUI, worker, blokada eksportu przy failed, aktualizacja docs/ADR) (`docs/superpowers/plans/2026-11-12-printability-rework.md:1-18`, `:47-101`, `:224-379`, `:395-476`).
- W kodzie widać elementy zgodne z kierunkiem planu/audytu (np. `rFeat` i clamp kątowy, `measuredSurfaceError`, rozróżnienie `edgesRounded/geometryChanged/failed`, `edgeClearance`, reguły 2×dysza), ale pełna zgodność z wszystkimi zadaniami planu (np. worker + twardy limit 300k w UI, pełna przebudowa wg `ui-spec`) **nie zweryfikowano** całościowo poza odczytanymi plikami.
- Znane obserwacje z audytu/badań (nieweryfikowane ponownie tutaj): ryzyka dot. limitów promienia zależnych od siatki, raportowania powodzeń przy wycofaniu, blokowania wątku, itp. opisane w `docs/audit/printability-audit.md:10-21` i `docs/research/printability-algorithms.md:188-205`.
