# RoundEdge — audyt printowalności i poprawności algorytmu

**Data:** 2026-11-12 · **Zakres:** `src/utils/*.ts`, `src/App.tsx`, `src/components/ThreeViewer.tsx`, `tests/*.ts`, `app/main.py`, `.github/workflows/ci.yml`
**Tryb:** read-only. Nic nie zmieniono w repo. Wszystkie liczby poniżej pochodzą z uruchomionych probe'ów (ścieżki podano przy każdym findingu).

---

## 1. Podsumowanie

| Kategoria | Liczba |
|---|---|
| **Critical** | **5** |
| **High** | **3** |
| **Medium** | **7** |
| **Low** | **7** |
| Suspected (bez odtworzenia) | 5 |
| *Razem* | *22 potwierdzonych + 5 podejrzewanych* |

### Wniosek w jednym zdaniu

Rdzeń algorytmu **nie jest poprawnym filletem** poza jednym szczególnym przypadkiem (krawędź 90° w siatce, której granice pasa pokrywają się z krawędziami siatki). Wierzchołki leżą na powierzchni offsetowej tylko tam, gdzie przypadkowo zachodzi zgodność z podziałem siatki; w pozostałych przypadkach powierzchnia jest **łamaną, nie łukiem**, a dla kątów ostrych (< 60°) narożnik **w ogóle nie jest zaokrąglany**. Do tego narzędzie **nie potrafi wygenerować drukowalnego promienia** na realistycznej siatce STL (promień jest przycięty do połowy długości krawędzi siatki), a przy cienkich elementach **cicho zwraca model wejściowy**, raportując sukces.

### Co działa dobrze (potwierdzone)

- `npm run lint`, `npx tsc -b`, `npm test` — **0 błędów, 50/50 testów przechodzi**.
- Determinizm: dwa uruchomienia na `public/pranie.stl` (260 trójkątów, 150 krawędzi) → **0 różniących się współrzędnych** (probe D2).
- Topologia, spawanie wierzchołków, naprawa windingu, eksport STL/OBJ — poprawne i przetestowane.
- Dla krawędzi 90° (i 60°–150° **na dwusiecznej**) wierzchołki krawędzi leżą na łuku z błędem 1e-16 (probe E1).
- CI istnieje i jest sensowne: `.github/workflows/ci.yml` uruchamia lint, typecheck, testy, test SSR, build i krzyżowe sprawdzenie Pythona. **Twierdzenie z zadania „brak CI" jest nieprawdziwe.**
- `app/main.py` zwraca 501 dla `/api/process` **świadomie i z udokumentowanym powodem** (zaokrąglanie jest w przeglądarce) — to nie jest defekt.

---

## 2. Wyniki bramek (realne wyjście)

```
$ npm run lint
> oxlint
Found 0 warnings and 0 errors.
Finished in 64ms on 22 files with 103 rules using 16 threads.

$ npx tsc -b
(brak wyjścia, kod wyjścia 0)

$ npm test
> node tests/all.test.ts
i tests 50
i suites 0
i pass 50
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 12390.6566

[pranie.stl] 392 ms, trójkąty 260 -> 26508, poziomów 4, przesunięto 5554 wierzchołków,
             r_eff=0.800 mm, dV=-0.734%, maxD=0.5857 mm
```

**Kontekst obciążenia przyjęty w audycie:** jeden użytkownik w przeglądarce, model STL/OBJ/3MF typu skan lub parts CAD (10k–500k trójkątów), drukarka FDM z dyszą 0.4 mm.

### Metoda odtworzenia

Probe'y (throwaway, poza repo) w `C:\Users\pawel\AppData\Local\Temp\opencode\audit\`:
`probe1_wedge.ts`, `probe1b.ts`, `probe1c.ts`, `probe2.ts`, `probe3.ts`, `probe4.ts`, `probe5.ts`, `probe6.ts`, `probe7.ts`, `probe8.ts`, `probe9.ts`, `probe10.ts`.
Każdy importuje moduły repo przez absolutny URL, np.
`import { roundEdges } from 'file:///C:/Users/pawel/Desktop/krawedzi/src/utils/meshProcessing.ts';`
Uruchomienie: `node probeN.ts` (Node 24.11.1, type-stripping włączony).

---

## 3. Potwierdzone findingi

### AUD-001 — **CRITICAL** — Ostre narożniki (θ < 60°) nie są zaokrąglane albo mają zły promień; ostrzeżenie mówi odwrotność

**Plik:** `src/utils/edgeRounding.ts:554`, `:824-832`, `:983-988`
**Co psuje:** twardy limit `|Δ| ≤ r` jest sprzeczny z geometrią filletu. Dla klina o kącie materiału θ wierzchołek musi przesunąć się o `r/sin(θ/2) − r`; dla θ = 30° to **2.86·r**, dla θ = 45° **1.61·r**. Limit `|Δ| ≤ r` (edgeRounding.ts:825) jest więc osiągalny dopiero dla θ ≥ 60°. Poniżej tego progu algorytm albo nie rusza wierzchołka wcale (θ ≤ 30°), albo zatrzymuje go na `|Δ| = r` (θ = 30–60°) — czyli **promień łuku wychodzi większy niż zamówiony**, a nie mniejszy.

**Dowód (probe E1 — wierzchołek wypukłego klina, r = 1 mm, segments = 8):**

| θ (°) | wymagane | faktyczne przesunięcie | wierzchołki na prawdziwym łuku | dV% |
|---|---|---|---|---|
| 2  | 56.298688 | **0.000000** | **0** | −0.0004 |
| 5  | 21.925586 | **0.000000** | **0** | −0.0004 |
| 15 | 6.661298  | **0.000000** | **0** | −0.0004 |
| 30 | 2.863703  | **0.000000** | 4 | −0.0004 |
| 45 | 1.613126  | **1.000000** | 4 | −0.0285 |
| 55 | 1.165681  | **1.000000** | 6 | −0.0298 |
| 60 | 1.000000  | 1.000000 | 69 | −0.0304 |
| 70 | 0.743447  | 0.743447 | 195 | −0.0326 |

Dla θ ≤ 30° narożnik **nie zmienia się w ogóle** (dV% = −0.0004 %) — szpic pozostaje tak ostry, jak był. Dla θ = 45° powstały łuk ma promień **1.613 zamiast 1.000** (o 61 % za duży).

**Dodatkowo: ostrzeżenie kłamie.** `edgeRounding.ts:983-988` mówi *„wynikowy promień jest tam mniejszy niż zadany"*. Przy θ = 45° promień jest **większy** (1.613 > 1.0). Tekst jest odwrotny do rzeczywistości.

**Reprodukcja:** `node probe5.ts` (sekcja E1) lub `node probe2.ts` (sekcja A).

**Propozycja naprawy:** zastąpić limit `|Δ| ≤ r` testem wykonalności geometrycznej: jeśli `r/sin(θ/2) − r > r`, to fillet o promieniu r **nie istnieje** przy tym kącie — albo pomniejsz promień do `r_max = r·sin(θ/2)/(1−sin(θ/2))` i zgłoś to jako efektywny promień tej krawędzi, albo odrzuć krawędź z jednoznacznym komunikatem. Nigdy nie wolno zgłaszać sukcesu przy braku geometrii.

---

### AUD-002 — **CRITICAL** — Heurystyka normalnej wierzchołka odrzuca drugą płaszczyznę filletu → ściany nie zwijają się na łuk

**Plik:** `src/utils/edgeRounding.ts:793-794`
```typescript
if (vnx * f.n0x + vny * f.n0y + vnz * f.n0z < -0.35) continue;
if (vnx * f.n1x + vny * f.n1y + vnz * f.n1z < -0.35) continue;
```

**Co psuje:** wierzchołek leżący **na jednej ze ścian** wypełnienia ma normalną wierzchołka równą normalnej tej ściany. Iloczyn z normalną drugiej ściany wynosi wtedy `cos(180° − θ) = −cos θ`. Warunek odrzucenia (−0.35) jest spełniony dla **θ < 69.5°**. Druga płaszczyzna zostaje odrzucona → zostaje **jedna** płaszczyzna → `|v| = r` → `computeDisplacement` zwraca `null` (edgeRounding.ts:554) → **wierzchołek nie jest przesuwany wcale**. Ściana w paście nie zwija się na łuk, a wierzchołki krawędzi (normalna = średnia dwóch ścian) przesuwają się — między nimi powstaje **łamana prosta, nie łuk**.

**Dowód (probe1c / probe2 sekcja A — klin 60°, r = 1):**
- 65 wierzchołków leży **dokładnie** na łuku (`|dAxis − 1| < 1e-6`) — to wierzchołki samej krawędzi;
- wierzchołek ściany w odległości t = 0.9375 od krawędzi pozostaje w **(0.81190, 0.46875)** — czyli **wciąż na ścianie**, z odległością 1.277228 od osi łuku zamiast 1.0. Powinien leżeć na łuku w punkcie (1.06980, 0.36710) — wyliczonym niezależnie (projekcja na `C ⊕ B(r)`).
- Błąd: **0.277 r**.

**Dlaczego testy tego nie łapią:** `tests/rounding.test.ts:430-441` mierzy **tylko wierzchołki leżące na dwusiecznej** (`|y|/t ≤ 1e-6`). Wierzchołki ścian, które właśnie nie zjeżdżają na łuk, nie są w ogóle mierzone.

**Reprodukcja:** `node probe1c.ts`.

**Propozycja naprawy:** zastąpić guard normalną wierzchołka **testem położenia** (czy wierzchołek leży w obrębie pasa, tj. `d_i ∈ [−reach, +guard]` dla każdej ściany) zamiast kątowym. Normalna wierzchołka jest wielkością średnią i nie mówi nic o tym, czy dana ściana ogranicza ten punkt.

---

### AUD-003 — **CRITICAL** — Efektywny promień zapada się wraz z gęstością siatki; narzędzie nie umie wygenerować drukowalnego promienia

**Plik:** `src/utils/edgeRounding.ts:666` (cap promienia) i `:825` (limit per-wierzchołek)
```typescript
const radiusCap = Math.min(0.5 * medianIncident, 0.5 * minBboxDim);   // :666
const localLimit = Math.min(size, 0.25 * minEdge, maxDisplacementCap); // :825
```

**Co psuje:** `0.5 · medianIncident` oznacza: **maksymalny osiągalny promień = połowa długości krawędzi siatki**. To myli *rozdzielczość siatki* z *rozmiarem cechy*. Rozdzielczość w pasa rozwiązuje zagęszczenie (`refineBand`), a nie powinno ograniczać promienia. Drugi limit (`0.25 · L_min_incident`) jest jeszcze silniejszy i psuje kształt przy każdej gęstszej siatce.

**Dowód (probe2 sekcja B / probe10 — sześcian 20 mm, r = 1 mm, wszystkie 12 krawędzi):**

| podział | dł. krawędzi | r_eff | maxDisp | błąd wierzchołków vs idealna powierzchnia filletu | błąd centroidów trójkątów |
|---|---|---|---|---|---|
| 1×1  | 20.000 | 1.0000 | 0.7321 | 0.00000 | 0.01035 |
| 8×8  | 2.500  | 1.0000 | 0.7321 | 0.02179 | 0.01282 |
| 16×16 | 1.250  | **0.6250** | 0.4419 | **0.34705** | **0.28386** |
| 32×32 | 0.625  | **0.3125** | 0.2210 | — | — |

Przy siatce 1.25 mm użytkownik prosi o r = 1 mm, a dostaje `effectiveRadius = 0.625`, narożnik przesunięty o **0.4419** zamiast 0.7321, i **błąd 0.347 mm względem idealnej powierzchni filletu** — wierzchołki nie leżą nawet na powierzchni odpowiadającej *własnemu* raportowanemu promieniowi. Kształt **nie jest filletem**.

Dla realistycznego STL-a (trójkąty 0.2–0.5 mm) **maksymalny promień to 0.1–0.25 mm** — poniżej widoczności w warstwie i poniżej progu 0.3 mm, który sama aplikacja podaje jako „minimalny sensowny promień" (README.md:186).

**Reprodukcja:** `node probe2.ts` (sekcja B), `node probe10.ts`.

**Propozycja naprawy:** usuń oba ograniczenia oparte na długości krawędzi. Promień ogranicz **geometrycznie**: odległością do przeciwległej ściany lub ściany sąsiedniej (jasny odstęp). Wspólny limit ruchu zastąp testem samoprzecięcia (odległość do powierzchni sąsiadującej), nie heurystyką długości krawędzi.

---

### AUD-004 — **CRITICAL** — Przy cienkich elementach operacja jest cicho wycofana, a raport i UI mówią, że się udało

**Plik:** `src/utils/edgeRounding.ts:935-943` (wycofanie), `:1038` (`processedEdgeCount`), `src/App.tsx:355-359` (toast)
**Co psuje:** gdy po 16 przebiegach poprawki nadal są złe ściany, `scale.fill(0)` zeruje **wszystkie** przemieszczenia → wynik = wejście (tylko zagęszczone). Tymczasem `processedEdgeCount` to liczba cech, dla których **choć jeden wierzchołek znalazł się w paście**, a nie liczba faktycznie zaokrąglonych krawędzi. UI wypisuje wtedy „**Zaokrąglono 21 z 24 krawędzi**".

**Dowód (probe6 sekcja F2 — płyta 40×40×4 mm z żebrem 40×**1**×20 mm, r = 2 mm):**
```
selected=24  processedEdgeCount=21   <-- UI mówi "Zaokrąglono 21 z 24"
movedVertexCount=11012   oryginalne wierzchołki przesunięte: 0
dV% = 0.000000    (nic nie zmieniono)
ostrzężenie: "Nie udało się wygenerować poprawnego zaokrąglenia dla tych krawędzi —
               przywrócono pierwotną geometrię."
```
**Model wychodzi z aplikacji identyczny z wejściowym.** Użytkownik dostaje plik STL bez zaokrąglenia, a komunikat sugeruje sukces. Żeber 1 mm jest w druku FDM standardowym elementem (wzmocnienia, żebra usztywniające).

**Reprodukcja:** `node probe6.ts` (sekcja F2), `node probe7.ts` (sekcja G2).

**Propozycja naprawy:** (a) liczyć `roundedEdgeCount` = krawędzie, których **co najmniej jeden wierzchołek faktycznie się przesunął**; (b) dodać do raportu `geometryChanged: boolean` i `failed: boolean`; (c) w UI zablokować eksport „zaokrąglonego" STL-a (lub wyraźnie oznaczyć go „oryginał — nie udało się zaokrąglić") gdy flaga `failed` jest ustawiona; (d) wykryć cienkie elementy **przed** operacją i odmówić z konkretną informacją, zamiast po fakcie.

---

### AUD-005 — **CRITICAL** — Brak workera: operacja blokuje główny wątek; 77 tys. trójkątów = 22 s i ~1 GB RAM

**Plik:** `src/App.tsx:253-269` (synchroniczne `roundEdges` w `setTimeout`), `src/utils/edgeRounding.ts:565-568` (budżet)
**Co psuje:** obliczenie jest synchroniczne w głównym wątku przeglądarki. Spinner „Przeliczanie zaokrąglenia…" nie animuje się, karta przeglądarki jest „nie odpowiada", a każdy ruch suwaka promienia uruchamia całe obliczenie od nowa. Na dużym modelu przeglądarka może zostać ubita albo zgłosić „Awaria strony".

**Dowód (probe4 sekcja D3, probe6 sekcja F3 — sześcian 60 mm):**

| trójkąty wejściowe | build | **roundEdges** | trójkąty wyjściowe | heap |
|---|---|---|---|---|
| 19 200 | 82 ms | 1 360–2 357 ms | 117 984 | 195 MB |
| **76 800** | 777 ms | **21 838 ms** | **650 064** | **968 MB** |

Koszt jest w praktyce kwadratowy w liczbie wierzchołków pasa (`refineBand` przebudowuje pełną topologię `buildTopology` na każdym poziomie, edgeRounding.ts:265/339), a `triangleBudget` domyślnie = `12 × liczba ścian`, więc wyjście eksploduje proporcjonalnie.

**Reprodukcja:** `node probe6.ts` (sekcja F3).

**Propozycja naprawy:** przenieść `roundEdges` do **Web Workera** z komunikacją postępu i anulowaniem; dodać twardy limit wejścia (np. 300 k trójkątów) z jasnym komunikatem i opcją „kontynuuj mimo to"; nie przeliczać całej operacji przy każdym zdarzeniu suwaka (debounce + cache wyniku).

---

### AUD-006 — **HIGH** — Wiersz „Hausdorff ≤ promień" w UI jest tautologią i zawsze zielony

**Plik:** `src/App.tsx:766-771`
```typescript
ok={result.report.maxDisplacement <= result.report.effectiveRadius + 1e-9}
tip="Twarda gwarancja: żaden wierzchołek nie przesunął się bardziej niż zadany promień, więc model nie może się zapaść."
```
**Co psuje:** `maxDisplacement` jest z definicji ograniczone przez `localLimit ≤ size = effectiveRadius` (edgeRounding.ts:825). Warunek jest więc **tautologicznie prawdziwy** i nie weryfikuje niczego. Użytkownik widzi zielony „dowód", który niczego nie dowodzi. To samo dotyczy deklaracji w `src/utils/meshTypes.ts:112` („Twarda gwarancja: Hausdorff(wynik, wejście) <= maxDisplacement") — to nie jest twierdzenie o Hausdorffie, tylko o przesunięciu wierzchołków.

**Dowód (kod + pomiary):** edgeRounding.ts:825 `localLimit = Math.min(size, 0.25·minEdge, maxDisplacementCap)` oraz `size = effectiveRadius` → `maxDisp ≤ effR` zawsze. Potwierdzone we wszystkich probe'ach (0.732 ≤ 1.0; 0.4419 ≤ 0.625; 0.3660 ≤ 0.5).

**Reprodukcja:** `node probe2.ts`, `node probe10.ts` (kolumny `maxDisp(rep)` vs `r_eff`).

**Propozycja naprawy:** policzyć **rzeczywisty** skierowany dystans Hausdorfa (próbki z powierzchni wyniku → najbliższy punkt na powierzchni wejścia) i pokazać go; albo zmienić etykietę na coś prawdziwego („maks. przesunięcie wierzchołka ≤ promień") i dodać osobny wiersz z pomiarem błędu powierzchni (AUD-008).

---

### AUD-007 — **HIGH** — Liczniki w raporcie nie opisują tego, co zostało zaokrąglone

**Plik:** `src/utils/edgeRounding.ts:1038` (`processedEdgeCount`), `:1045` (`movedVertexCount`)
**Co psuje:** patrz AUD-004 — `processedEdgeCount` liczy cechy mające wierzchołek w paście, a nie faktycznie zmienione; `movedVertexCount` liczy wierzchołki, którym *przypisano* przemieszczenie, w tym te, które później skalowano do zera (`scale[v]=0`). W probe F2: `movedVertexCount = 11012`, a przesuniętych oryginalnych wierzchołków **0**.

**Propozycja naprawy:** liczyć po fakcie (po zastosowaniu `scale`) i raportować: `edgesRounded`, `verticesActuallyMoved`, `edgesFailed`, `failedRegion` (bbox obszaru wycofanego).

---

### AUD-008 — **HIGH** — Błąd powierzchni (fazowanie cięciwami) nie jest mierzony; `chordDeviation` zaniża go ~10×

**Plik:** `src/utils/edgeRounding.ts:973` (obliczanie `chordDeviation`), `:1005-1020` (ostrzeżenie), `src/utils/meshTypes.ts:156-167`
**Co psuje:** podejście „przemieszczenie wierzchołków" **nie może** dać powierzchni ciągłej stycznej: trójkąty między wierzchołkami są cięciwami. Realny błąd to strzałka cięciwy `r − sqrt(r² − (L/2)²)`, gdzie L = `bandFacetSize`. Raport pokazuje `chordDeviation` policzone z **teoretycznej** liczby segmentów (nie z faktycznej geometrii), a ostrzeżenie twierdzi, że „odchyłka jest ograniczona przez maxDisplacement" — to ograniczenie dotyczy **wierzchołków**, nie powierzchni.

**Dowód (probe10 — sześcian, porównanie z idealną powierzchnią = offset wewnętrznego sześcianu):**

| model | r_eff | bandFacet | chordDev (raport) | maxDisp (raport) | **błąd wierzchołków** | **błąd centroidów (powierzchnia)** |
|---|---|---|---|---|---|---|
| 176 mm / 1× | 0.500 | 3.889 | 0.01704 | 0.3660 | 0.00000 | **0.16807** |
| 176 mm / 1× (segments=8) | 0.500 | 3.889 | 0.00241 | 0.3660 | 0.00000 | **0.16807** |
| 20 mm / 1× | 2.000 | 0.442 | 0.00963 | 1.4641 | 0.00000 | 0.01035 |
| 20 mm / 8× | 1.000 | 0.221 | 0.00482 | 0.7321 | 0.02179 | 0.01282 |
| 20 mm / 16× | 0.625 | 0.349 | 0.00301 | 0.4419 | **0.34705** | **0.28386** |

Dla sześcianu 176 mm z r = 0.5 mm realny błąd powierzchni to **0.168 mm = 34 % promienia** — ponad 1.6× tolerancji druku 0.1 mm, którą sama aplikacja przywołuje. Tymczasem raport pokazuje 0.017 mm (10× mniej) i twierdzi, że wszystko jest w granicach. Zwiększenie liczby segmentów z 3 na 8 **nie zmienia** realnego błędu (0.16807 → 0.16807), bo o rozdzielczości decyduje gęstość siatki — dokładnie tak, jak twierdzi README, ale raportowana liczba jest zła.

**Propozycja naprawy:** raportować zmierzoną strzałkę `r − sqrt(r² − (bandFacetSize/2)²)` oraz zmierzony dystans od idealnej powierzchni, a `chordDeviation` oznaczyć jawnie jako wartość teoretyczną albo usunąć.

---

### AUD-009 — **MEDIUM** — Rozmiar chamferu to nie długość ramienia; etykiety „Ścięcie 45°" i „Szerokość ścięcia" mylą

**Plik:** `src/utils/edgeRounding.ts:449-466`, UI: `src/App.tsx:662, 680-689, 697-698`
**Co psuje:** algorytm ustawia płaszczyznę ścinającą przez `Σ d_i = ∓size`, co daje płaszczyznę o normalnej równoległej **dwusiecznej**, a nie równoległej do ściany pod 45°. Ramię na ścianie wynosi `c / sin θ` (θ = kąt materiału), czyli **równe c tylko dla θ = 90°**.

**Dowód (probe6 sekcja F1 / probe7 sekcja G1 — klin, c = 2 mm):**

| θ (°) | ramię na ścianie | stosunek do c |
|---|---|---|
| 60  | 2.3094 | 1.155·c |
| 90  | 2.0000 | 1.000·c |
| 120 | 2.3094 | 1.155·c |
| 150 | 4.0000 | **2.000·c** |

Przy krawędzi 150° (płytka) chamfer „2 mm" zjada **4 mm** materiału na stronę. Preset „Ścięcie 45°" (App.tsx:662) jest prawdziwy tylko dla krawędzi 90°.

**Propozycja naprawy:** zdefiniować parametr chamferu jako **długość ramienia** i wyznaczać płaszczyznę ścinającą z dwóch punktów przesuniętych o c wzdłuż każdej ściany (dla krawędzi 90° daje to dokładnie obecny wynik); równolegle raportować faktyczne ramię.

---

### AUD-010 — **MEDIUM** — Kąt łuku do zagęszczania i raportowanej odchyłki to kąt między normalnymi, a nie kąt materiału

**Plik:** `src/utils/edgeRounding.ts:738` — `const arcAngle = Math.max(15 * DEG, Math.min(minPhi, Math.PI));`
**Co psuje:** `minPhi` to `e.normalAngle` (kąt między normalnymi ścian = 180° − θ). Łuk filletu rozciąga się na kąt **θ**, nie na φ. Dla klina θ = 30° (φ = 150°) algorytm dzieli pas na kącie 150°, podczas gdy łuk ma 30° → siatka w pasie 5× rzadsza niż zamierzona, a realna odchyłka wielokrotnie większa niż raportowane `chordDeviation`. Dla θ = 150° (φ = 30°) algorytm zagęszcza 5× mocniej niż trzeba — marnuje trójkąty i czas.

**Dowód:** kod + probe E1 (θ = 30°: tylko 4 wierzchołki na łuku przy `segments = 8`, czyli łuk o 30° pokryty ~4 odcinkami zamiast 8); probe10 (przy 176 mm realny błąd 0.168 mm wobec raportowanych 0.017 mm).

**Propozycja naprawy:** `arcAngle = min over features of (π − normalAngle)`, czyli kąt materiału; spójnie używać go w `targetLength`, `chordDeviation` i w refineBand.

---

### AUD-011 — **MEDIUM** — Pętla naprawcza „przed flipami" po cichu deformuje fillet/chamfer

**Plik:** `src/utils/edgeRounding.ts:911-929` (`scale[v] *= 0.5`), `:921-923` (`scale[v] = 0`)
**Co psuje:** kiedy trójkąt się odwraca, przemieszczenie wierzchołków jest **halwowane** — zamiast przeliczyć punkt. Efekt: powierzchnia przestaje być łukiem, a płaszczyzna chamferu przestaje być płaska.

**Dowód (probe8 — klin 90°, chamfer c = 2, taper wyłączony):**
```
apex v0 new pos = 0.707107   (przemieszczenie 0.707)
v11 (środek łańcucha)        = 1.414214   (przemieszczenie 1.414)
```
Prawidłowe przesunięcie dla krawędzi 90° to c/√2 = 1.414214 (potwierdzone testem `tests/rounding.test.ts:256`). Końce łańcucha mają połowę → **ściana ścięcia nie jest płaska**. W probe F2 na żebrze 1 mm: `relaxed = 2989` wierzchołków, `reverted = 43`.

**Propozycja naprawy:** zamiast skalować przemieszczenie, przeliczyć punkt z ograniczeniem (projekcja na łuk z dodatkowym warunkiem, żeby nie odwrócić sąsiedniej ściany) i oznaczyć region jako „nieukończony"; raportować `relaxedRegion` zamiast samej liczby.

---

### AUD-012 — **MEDIUM** — Limit `MAX_PLANES = 12` po cichu gubi ograniczenia, a gałąź awaryjna nie jest filletem

**Plik:** `src/utils/edgeRounding.ts:49`, `:786`, `:803`, `:533-543`
**Co psuje:** przy wierzchołku z więcej niż 6 sąsiednimi cechami (7+ płaszczyzn) reszta jest odrzucana. Gdy active-set QP nie zbiegnie, kod wybiera „najbardziej naruszone ograniczenie" i zwraca ruch wzdłuż **jednej** płaszczyzny (edgeRounding.ts:539-542) — to nie jest powierzchnia filletu, a błąd jest **cichy**: brak ostrzeżenia i brak wpisu w raporcie.

**Status: SUSPECTED** (nie udało się skonstruować wierzchołka z >6 cechami w ramach audytu) — ścieżka kodu jest jednak jednoznaczna.

**Propozycja naprawy:** podnieść limit do 32, przy przekroczeniu **wypisać ostrzeżenie** i oznaczyć wierzchołek jako „nieukończony"; w gałęzi awaryjnej zwracać `null` (brak ruchu) zamiast ruchu wzdłuż jednej osi.

---

### AUD-013 — **MEDIUM** — Jedna krótka cecha w modelu obcina promień dla całego modelu

**Plik:** `src/utils/edgeRounding.ts:647-673`
**Co psuje:** `medianIncident` to mediana **minimalnej długości krawędzi incydentnej** liczona osobno dla każdego końca każdej zaznaczonej krawędzi. Jedna krótka cecha (np. wypustka 2 mm na obudowie 200 mm) wchodzi do próbki i obcina `radiusCap` dla wszystkich pozostałych krawędzi.

**Dowód (probe9 sekcja H2):**
```
sześcian 200 mm + wypustka 2x2x2 mm, wszystkie ostre krawędzie, r = 5
-> effectiveRadius = 1.4142   (żądano 5.00)
```
Dla porównania: sama krawędź 200 mm bez wypustki → `effR = 5.0000`. Wypustka 2 mm obcięła promień 3.5×.

**Propozycja naprawy:** liczyć promień **per krawędź** (na podstawie lokalnego odstępu), a `effectiveRadius` raportować jako medianę/minimum, nie jako jedną globalną wartość.

---

### AUD-014 — **MEDIUM** — Komentarz mówi „5. percentyla", kod liczy medianę

**Plik:** `src/utils/edgeRounding.ts:643-646` (komentarz) vs `:655-656` (kod)
```typescript
// Używamy 5. percentyla, nie absolutnego minimum: ...
const medianIncident = incidentSamples.length > 0
  ? incidentSamples[Math.floor(0.5 * (incidentSamples.length - 1))]   // to jest MEDIANA
  : Infinity;
```
Niespójność dokumentacji i implementacji — przy okazji pokazuje, że limit promienia był projektowany heurystycznie (AUD-013).

**Propozycja naprawy:** poprawić komentarz (albo implementację) i usunąć tę heurystykę razem z AUD-003/AUD-013.

---

### AUD-015 — **MEDIUM** — Model o odwróconym windingzie jest raportowany jako „spójny" z dodatnią objętością

**Plik:** `src/utils/meshIO.ts:165` (`if (... && mesh.inconsistentWindingCount > 0)`), `src/utils/meshTopology.ts:515-531` (`signedVolume`), `:745` (`volume: Math.abs(signedVolume(mesh))`)
**Co psuje:** naprawa orientacji uruchamia się **tylko** gdy winding jest niespójny. Model o spójnym, ale **odwróconym** windingzie (dość częste w eksporcie STL) przechodzi bez naprawy: `signedVolume < 0`, ale diagnostyka raportuje `volume = |signedVolume|` (dodatnia) i „orientacja: spójna".

**Dowód (probe3 sekcja C1):**
```
invert=false | signedVolume= 8000.00 | CONVEX=12/12 | orientationRepaired=false
invert=true  | signedVolume=-8000.00 | CONVEX= 0/12 | orientationRepaired=false
```
**Uwaga (istotne):** sam algorytm zaokrąglania jest na to **odporny** — odwrócona siatka daje identyczny wynik (`dV% = −2.4876` w obu przypadkach), bo odwrócenie normalnych odwraca też flagę wypukłości, a obie konwencje dają ten sam wynik. **Defekt dotyczy wyłącznie diagnostyki i komunikatów, nie geometrii.**

**Propozycja naprawy:** po naprawie windingu zawsze sprawdzać znak `signedVolume` i odwrócić całość, jeśli jest ujemny (analogicznie do `orientFacesConsistently`, meshTopology.ts:615); dodać do diagnostyki pozycję „kierunek normalnych: na zewnątrz / do wewnątrz".

---

### AUD-016 — **LOW** — Środowisko Python dubluje diagnostykę TS

**Plik:** `app/main.py` (funkcja `inspect` — ~100 linii powielonej logiki), `scripts/verify_backend.py`
`/api/process` zwraca 501 **świadomie** (udokumentowane w docstringu) — to nie jest defekt. Powielona jest natomiast cała diagnostyka siatki (welding, objętość, komponenty, genus). CI krzyżowo to sprawdza (`python scripts/verify_backend.py`), więc rozjazd jest wykrywany — koszt to tylko utrzymanie dwóch implementacji.

**Propozycja naprawy:** albo usunąć serwis (nie jest używany w ścieżce klienta — potwierdzone testem „UI: nie ma już martwego kodu backendu"), albo wygenerować kod Pythona z jednego źródła.

---

### AUD-017 — **LOW** — API ma parametry bezpieczeństwa, UI ich nie udostępnia

**Plik:** `src/utils/meshTypes.ts:102-123` (`maxDisplacement`, `triangleBudget`, `maxLevels`, `flatAngleDeg`, `taperEnds`) vs `src/App.tsx:256-261` (wywołanie `roundEdges`)
UI przekazuje tylko `radius`, `segments`, `kind`, `edgeIndices`. Użytkownik nie może ustawić budżetu trójkątów ani zobaczyć, że jego suwak promienia został potajemnie przeskalowany.

**Propozycja naprawy:** dodać do panelu pozycję „Budżet trójkątów" i pokazywać obok suwaka promienia **realny** (efektywny) promień osiągnięty dla zaznaczenia.

---

### AUD-018 — **LOW** — Krytyczne ostrzeżenia trafiają wyłącznie do toastów (9 s, maks. 5, deduplikacja po tekście)

**Plik:** `src/App.tsx:29` (`TOAST_TTL_MS = 9000`), `:65-74` (`pushToast`), `:352-368`
Komunikat „przywrócono pierwotną geometrię" (AUD-004) znika po 9 sekundach i nie zostaje nigdzie w panelu. Sekcja „Wynik i weryfikacja" nie pokazuje ostrzeżeń w ogóle.

**Propozycja naprawy:** stała sekcja ostrzeżeń w panelu wyniku; toasty tylko dla komunikatów informacyjnych; błędy krytyczne blokują eksport.

---

### AUD-019 — **LOW** — Wygaszanie (run-out) zakłada łańcuchy proste

**Plik:** `src/utils/edgeRounding.ts:815` — `const along = f.endA + (f.endB - f.endA) * near.t;`
Waga `smoothstep01(along / taperLength)` jest liniową interpolacją między końcami krawędzi — poprawne dla łańcucha prostego, niedokładne dla łańcucha łamanego. Waga jest też skalowana wprost, więc wierzchołek **opuszcza** powierzchnię filletu — łuk przy końcu łańcucha nie jest styczny do ścian.

**Propozycja naprawy:** liczyć `along` z prawdziwej odległości wzdłuż łańcucha (Dijkstra jest już zaimplementowany) i wyznaczać punkt końcowy przez **przecięcie** z płaszczyzną ściany, a nie przez skalowanie wektora.

---

### AUD-020 — **LOW** — Reguła „najbliższa krawędź wygrywa" odrzuca płaszczyzny drugiej cechy całkowicie

**Plik:** `src/utils/edgeRounding.ts:789` — `if (f.convex !== convex) continue;`
W sąsiedztwie mieszanym (wypukła + wklęsła) cecha o przeciwnej wypukłości jest pomijana **w całości** — nie ma rozwiązania hybrydowego (prawdziwy rolling-ball na ostrej krawędzi wklęsłej nakłada się na wypukłą). Zachowanie jest udokumentowane w README.md:149, ale nieobecne w UI.

**Propozycja naprawy:** w UI pokazać ostrzeżenie „w sąsiedztwie mieszanym zastosowano najbliższą krawędź", a docelowo rozważyć rozwiązanie hybrydowe (odejmowanie i dodawanie materiału jednocześnie).

---

### AUD-021 — **LOW** — Eskalacja tolerancji spawania ma tylko 3 stopnie

**Plik:** `src/utils/meshIO.ts:40` — `const DEFAULT_TOLERANCES = [1e-6, 1e-5, 1e-4];`
Model wymagający tolerancji `1e-3` (typowe dla eksportów z CAD z zaokrąglonymi współrzędnymi) zostaje niedomknięty; `buildMeshFromRaw` wybiera wtedy wariant z najmniejszą liczbą krawędzi brzegowych (meshIO.ts:158), ale nie informuje użytkownika o zastosowanej tolerancji w panelu.

**Propozycja naprawy:** dodać krok `1e-3` i pokazać w UI użytą tolerancję oraz liczbę krawędzi brzegowych po spawaniu.

---

### AUD-022 — **LOW** — Koszt refineBand jest kwadratowy w liczbie wierzchołków pasa

**Plik:** `src/utils/edgeRounding.ts:200-272`, `:339` (`buildTopology` na każdym poziomie)
Każdy poziom zagęszczania przebudowuje **pełną** topologię całej siatki (wierzchołki, krawędzie, CSR, normalne) — `O(levels × faces)` z dużym stałym czynnikiem. Przy 76 800 trójkątów daje to 22 s (AUD-005).

**Propozycja naprawy:** przebudowywać tylko topologię pasa (lokalnie) albo zbudować raz dużą strukturę i aktualizować in-place; równolegle patrz AUD-005 (worker).

---

## 4. Podejrzewane findingi (bez odtworzenia)

| ID | Severity | Plik | Treść |
|---|---|---|---|
| SUS-001 | Medium | edgeRounding.ts:533-543 | Gałąź awaryjna QP zwraca ruch wzdłuż jednej osi zamiast `null` — „cichy fillet, który nie jest filletem". Nie wywołana w testach. |
| SUS-002 | Medium | edgeRounding.ts:49, 786 | `MAX_PLANES = 12` — przy 7+ cechach spotykających się w jednym wierzchołku ograniczenia są gubione bez ostrzeżenia. Nie skonstruowano przypadku. |
| SUS-003 | Low | edgeRounding.ts:730 | `gridCell = max(maxReach, totalFeatureLength/20000, diag*1e-6)` — przy bardzo długiej krawędzi komórka jest duża, a `FeatureGrid` trzyma do 4096 odcinków na krawędź; możliwy spadek wydajności, nie poprawności. |
| SUS-004 | Low | meshTopology.ts:72-100 | `weldTriangleSoup` skanuje 27 komórek; przy dużej tolerancji i gęstej siatce jedna komórka zawiera wiele wierzchołków → `O(n²)` na dużych modelach. Nie zmierzone. |
| SUS-005 | Low | edgeRounding.ts:953-959 | `flippedFaceCount` liczy `dot <= 0` (dokładnie 90°), a `FLIP_COS = 0.0175` (~89°) używany jest w pętli naprawczej → ściana obrócona o 89.5° przechodzi oba testy, a o 89.9° jest „flipem" w naprawie, lecz nie w raporcie. |

---

## 5. Brakujące funkcje drukowalności (według wpływu na użytkownika)

| # | Funkcja | Wpływ | Dlaczego jej brak boli |
|---|---|---|---|
| 1 | **Profil drukarki** (dysza, wysokość warstwy, liczba ścian, materiał) | **Krytyczny** | Dysza 0.4 mm jest **zaszyta na stałe** (App.tsx:32) i nie da się jej zmienić. Cała rada „promień 0.4–2 mm" (README.md:187) jest nieaktualna dla dysz 0.2/0.6/0.8 mm, a dla drukarek SLA/Bambu — nieaktualna w ogóle. |
| 2 | **Wykrywanie i raportowanie nawisów** (powierzchnie > ~45–50° od pionu) | **Krytyczny** | Najczęstsza przyczyna nieudanego wydruku poza ostrymi narożnikami. Narzędzie w ogóle tego nie analizuje — a to ono właśnie ma za zadanie „modele łatwiejsze do druku". |
| 3 | **Minimalna grubość ściany / wykrywanie cienkich elementów** | **Krytyczny** | Żeber 1 mm (AUD-004) jest niewidoczne dla użytkownika, a przy okazji powoduje **całkowite wycofanie** operacji. |
| 4 | **Skala i jednostki** | **Wysoki** | STL nie przechowuje jednostek; narzędzie zgaduje „mm" i pokazuje ostrzeżenie tylko dla skrajnych rozmiarów (App.tsx:325-331). Brak mnożnika skali — model w calach wychodzi 25× za duży. |
| 5 | **Ścięcie krawędzi spodnych (druk bez podpór)** | **Wysoki** | Klasyczny workflow „druk bez supportów" — narzędzie ma chamfer, ale nie ma pojęcia o krawędziach stykających się ze stołem. |
| 6 | **Wykrywanie otworów i gwintów** | **Średni** | Otwór mniejszy od dyszy nie wydrukuje się wcale; gwint bez fazy jest nie do druku. |
| 7 | **Analiza pierwszej warstwy / kontaktu ze stołem** | **Średni** | Mały obrys kontaktowy = brak przyczepności. |
| 8 | **Analiza mostkowania / konieczności podpór** | **Średni** | Część z mostkowaniem jest albo nie do druku, albo drukuje się źle. |
| 9 | **Promienie per cecha / per region** | **Średni** | Jedna globalna wartość nie obsłuży części z krawędzią 0.4 mm (kosmetyka) i 3 mm (odciążenie naprężeń). |
| 10 | **Wykrywanie cech** (otwory, bossy, żebra, występy) i rekomendacja promienia | **Średni** | Bez tego użytkownik sam zgaduje, które krawędzie zaokrąglić. |
| 11 | **Wykrywanie samoprzecięć na wejściu** | **Średni** | Samoprzecinający się STL po cichu daje geometrię śmieciową. |
| 12 | **Certyfikat „gotowe do druku" + eksport raportu** | **Niski/średni** | Raport jest w UI i ginie po zamknięciu; brak pliku do przekazania producentowi. |
| 13 | **Historia / cofnij** | **Niski** | Każda zmiana suwaka przelicza całość; brak cofnięcia. |
| 14 | **Podpowiedź o zgodności z typem drukarki** (FDM vs SLA vs SLS) | **Niski** | Rady są pisane wyłącznie pod FDM 0.4 mm. |

---

## 6. Luki w pokryciu testami

Testy (50) są dobre jako testy **bezpieczeństwa** (brak flipów, domknięcie, determinizm, brak NaN). Nie pokrywają **poprawności geometrycznej** poza jednym przypadkiem.

| # | Brakujący test | Dlaczego jest ważny | Obecny stan |
|---|---|---|---|
| T1 | **Fillet dla kątów materiału < 60°** | Klina są najostrzejszymi narożnikami — dokładnie te, które chce się zaokrąglić | Jawnie **wyłączone** komentarzem w tests/rounding.test.ts:366-368; test zaczyna się od 60° |
| T2 | **Pomiar łuku poza dwusieczną** (wierzchołki ścian) | Wykryłby AUD-002 | tests/rounding.test.ts:430-441 mierzy **tylko** wierzchołki na dwusiecznej (`|y|/t ≤ 1e-6`) |
| T3 | **Promień a gęstość siatki** (podział > 8) | Wykryłby AUD-003 (spadek do 0.31 mm) | Maksymalny podział w testach to 8×8 (realmodels.test.ts:26) |
| T4 | **Cienki element / samoprzecięcie** | Wykryłby AUD-004 | Brak; test „promień większy niż półowa krawędzi" (rounding.test.ts:268) sprawdza tylko *cap*, nie wynik |
| T5 | **Poprawność processedEdgeCount / movedVertexCount** | Wykryłby AUD-004/AUD-007 | Brak |
| T6 | **Chamfer dla kąta ≠ 90°** | Wykryłby AUD-009 | Brak (test tylko dla 90°) |
| T7 | **Rzeczywisty dystans Hausdorfa** | Wykryłby AUD-006 | Test „Hausdorff ≤ r" (realmodels.test.ts:99) sprawdza `maxDisplacement <= effectiveRadius` — tautologia |
| T8 | **Rzeczywity błąd powierzchni** (odchyłka, nie tylko wierzchołki) | Wykryłby AUD-008 | Brak |
| T9 | **Model o odwróconym windingzie** | Wykryłby AUD-015 | Brak |
| T10 | **Nóż (θ → 0°)** | Najostrzejszy przypadek | Brak |
| T11 | **Skala wydajności / limit wejścia** | Wykryłby AUD-005 | Brak; test pranie.stl to 260 trójkątów |
| T12 | **Kąt materiału vs kąt normalnych w refineBand** | Wykryłby AUD-010 | Brak |
| T13 | **Wygaszanie (run-out) — geometria** | Wykryłby AUD-019 | Brak (tylko porównanie objętości) |
| T14 | **Krawędź wklęsła obok wypukłej** (mieszane sąsiedztwo) | Wykryłby AUD-020 | Brak |
| T15 | **Jakość po zagęszczeniu przy maxLevels = 0** | Granica degeneracji | Brak |

---

## 7. Priorytetyzacja napraw

### P0 — fundament (bez tego narzędzie nie drukuje; ~64 h)

| # | Zadanie | Usuwa | Szacunek |
|---|---|---|---|
| P0.1 | **Przepisać rdzeń filletu.** Zastąpić „najbliższa cecha + guard normalnej wierzchołka" prawidłowym obliczeniem offsetu per wierzchołek: zebrać **wszystkie** płaszczyzny sąsiednich cech (bez filtra wypukłości), rozwiązać problem właściwej strony ściany, usunąć limit `|Δ| ≤ r` na rzecz testu wykonalności geometrycznej. Zrobić to **razem z AUD-001 i AUD-002**, nie osobno — inaczej drugi fix zepsuje pierwszy. | AUD-001, AUD-002, AUD-020 | 24 h |
| P0.2 | **Usunąć ograniczenia promienia oparte na długości krawędzi** (`radiusCap` z `medianIncident`, limit `0.25·L_min_incident`); zastąpić geometrycznym testem odstępu (do przeciwległej / sąsiedniej ściany). | AUD-003, AUD-013, AUD-014 | 10 h |
| P0.3 | **Uczciwy raport**: `edgesRounded`, `verticesMoved`, `geometryChanged`, `failed`, `failedRegion`; poprawić tekst ostrzeżenia o przycięciu (dziś mówi „mniejszy promień", a przy θ=45° promień jest **większy**). | AUD-001, AUD-004, AUD-007 | 6 h |
| P0.4 | **Blokada eksportu przy failed = true** + stała sekcja ostrzeżeń w panelu (nie tylko toasty). | AUD-004, AUD-018 | 4 h |
| P0.5 | **Realny pomiar błędu powierzchni** (strzałka cięciwy z bandFacetSize + zmierzony dystans od idealnej powierzchni) w raporcie; poprawić wiersz „Hausdorff". | AUD-006, AUD-008 | 8 h |
| P0.6 | **Web Worker** z postępem i anulowaniem + twardy limit wejścia z jasnym komunikatem; debounce suwaka. | AUD-005 | 12 h |

### P1 — jakość i zgodność z obietnicą (~58 h)

| # | Zadanie | Usuwa | Szacunek |
|---|---|---|---|
| P1.1 | Kąt łuku = kąt **materiału** (`π − normalAngle`) w refineBand, targetLength i chordDeviation. | AUD-010 | 3 h |
| P1.2 | Chamfer definiowany przez **długość ramienia** (przeliczyć płaszczyznę ścinającą), raportować faktyczne ramię; poprawić etykiety „45°" i „szerokość". | AUD-009 | 5 h |
| P1.3 | Lokalna naprawa flipów: przeliczyć punkt zamiast skalować przemieszczenie; oznaczać region jako nieukończony. | AUD-011 | 12 h |
| P1.4 | Pre-check cienkich elementów i samoprzecięć **przed** operacją; odmowa z konkretną informacją. | AUD-004 | 8 h |
| P1.5 | **Profil drukarki** (dysza/warstwa/ściany) jako dane wejściowe; wyliczanie z nich min. promienia i grubości ściany; podpowiedzi sterowane profilem. | Luka #1 | 6 h |
| P1.6 | **Wykrywanie nawisów** i raportowanie powierzchni > 45–50°. | Luka #2 | 12 h |
| P1.7 | Radii per krawędź / per region zamiast jednego globalnego suwaka. | Luka #9 | 8 h |
| P1.8 | Naprawa globalnego kierunku normalnych (odwrócony winding) + pole w diagnostyce. | AUD-015 | 4 h |

### P2 — rozbudowa i porządki (~52 h)

| # | Zadanie | Usuwa | Szacunek |
|---|---|---|---|
| P2.1 | Obsługa jednostek: wybór mm/cm/in + mnożnik skali. | Luka #4 | 4 h |
| P2.2 | Wykrywanie minimalnej grubości ściany, otworów i gwintów. | Luka #3, #6 | 12 h |
| P2.3 | Rozpoznawanie cech (otwory, bossy, żebra) + rekomendacja promienia. | Luka #10 | 12 h |
| P2.4 | Ścięcie krawędzi spodnych (druk bez podpór). | Luka #5 | 6 h |
| P2.5 | Analiza pierwszej warstwy i mostkowania. | Luka #7, #8 | 8 h |
| P2.6 | Eksport raportu pre-flight (JSON/MD) jako dowodu dla producenta. | Luka #12 | 4 h |
| P2.7 | Historia/undo + porównanie przed/po suwakiem. | Luka #13 | 5 h |
| P2.8 | Porządki: martwy serwis Pythona albo generowanie go z TS; komentarze; ostrzeżenie przy przekroczeniu MAX_PLANES; wykrywanie samoprzecięć na wejściu; wydajność refineBand. | AUD-012, AUD-014, AUD-016, AUD-017, AUD-021, AUD-022, SUS-001..005 | 16 h |

**Łącznie: ~174 h** (P0 64 h + P1 58 h + P2 52 h).

### Sugerowana kolejność

1. **P0.1 + P0.2 razem** — rdzeń. Bez tego każda poprawa raportowania będzie opisywać geometrię, która i tak jest zła.
2. **P0.3 + P0.4** — żeby użytkownik przestał dostawać „sukces" tam, gdzie nic się nie stało.
3. **P0.5 + P0.6** — żeby wynik był mierzalny, a aplikacja nie zamrażała przeglądarki.
4. **P1.1, P1.2** — tanie poprawki spójności promienia i chamferu.
5. **P1.4** — bo ratuje przed najgorszym scenariuszem (ciche wycofanie).
6. **P1.5, P1.6** — bo przenosi narzędzie z „poprawiacz krawędzi" na „narzędzie do druku".
7. Reszta P2.

### Czego **nie** zmieniać

- Strategię „przemieszczenie wierzchołków" — jest w porządku dla **wierzchołków krawędzi** (dokładność 1e-16 potwierdzona). Problemem nie jest sam mechanizm, tylko: (a) zestaw ograniczeń, (b) to, że ściany nie zjeżdżają na łuk, (c) brak pomiaru błędu powierzchni.
- Format STL/OBJ, pipeline wczytywania, spawanie, topologię, eksport — wszystkie przetestowane i poprawne.
- CI — działa; warto je rozszerzyć, nie przebudowywać.

---

## 8. Załącznik — komenda odtworzenia każdego findingu

```bash
cd C:\Users\pawel\AppData\Local\Temp\opencode\audit
node probe1c.ts    # AUD-002  (ściana nie zjeżdża na łuk dla θ < 69.5°)
node probe2.ts     # AUD-003  (spadek promienia wraz z gęstością), AUD-001 tabela A
node probe3.ts     # AUD-015  (odwrócony winding), C3 (narożnik kostki)
node probe4.ts     # determinizm, Hausdorff, wydajność
node probe5.ts     # AUD-001  (E1: ostre kliny), AUD-009 (E2), wydajność
node probe6.ts     # AUD-004  (F2: żebra 1 mm), AUD-009 (F1), wydajność
node probe7.ts     # AUD-004  (G2: „Zaokrąglono 21 z 24" przy 0 zmian)
node probe8.ts     # AUD-011  (chamfer niepłaski po relaksacji)
node probe9.ts     # AUD-013  (wypustka obcina promień), H1
node probe10.ts    # AUD-008  (prawdziwy błąd powierzchni vs raport)
```

Wszystkie probe'y importują moduły repo przez `file:///C:/Users/pawel/Desktop/krawedzi/src/utils/meshProcessing.ts` i niczego w repo nie modyfikują.
