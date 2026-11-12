# MEMORY.md — zwarta pamięć projektu RoundEdge

> Artefakt stanu wiedzy o projekcie. Ma zastąpić historię sesji: zawiera tylko to,
> co jest potrzebne, by dalej pracować nad kodem bez ponownego odkrywania faktów.
> Dokumentacja dla użytkownika końcowego jest w [README.md](README.md).

Ostatnia weryfikacja: wszystkie bramki zielone.

| Bramka | Komenda | Wynik |
|---|---|---|
| Lint | `npm run lint` | 0 ostrzeżeń, 0 błędów (22 pliki, 103 reguły) |
| Typy | `npx tsc -b` | czysto |
| Testy | `npm test` | 50 / 50 pass, ~9 s |
| Render UI | `npm run test:ssr` | 5 / 5 sprawdzeń |
| Build | `npm run build` | 842,36 kB (230,20 kB gzip) |
| Backend | `python scripts/verify_backend.py` | zgodność 1:1 z TypeScript |

---

## 1. Co to jest

**RoundEdge** — w 100% klientowa aplikacja webowa (React 19 + TypeScript + Vite 8 +
three.js 0.185 + Tailwind) do zaokrąglania krawędzi siatek 3D pod druk. Wgrywasz STL,
klikasz krawędzie (lub auto-detekcja ostrych), wybierasz promień, pobierasz STL/OBJ.
Zero backendu, zero wysyłania modelu na serwer.

## 2. Rdzeń algorytmiczny (`src/utils/edgeRounding.ts`)

Dokładny fillet metodą **toczącej się kuli** wyrażony jako operacja morfologiczna:
środek kuli stycznej do wszystkich ścian leży w zbiorze `C = { c : d_i(c) ≤ −r }`
(wypukła, *opening*) albo `{ c : d_i(c) ≥ +r }` (wklęsła, *closing*), a powierzchnia
filletu to `{ p : dist(p, C) = r }`. Przemieszczenie `Δ = v·(1 − r/|v|)`, gdzie
`v = c* − p`, a `c*` to **dokładny rzut na przecięcie półprzestrzeni** (metoda aktywnych
ograniczeń w `computeDisplacement`, bufor `FilletWorkspace`).

> **Pułapka, która kosztowała nas błąd merytoryczny:** kusząca wersja
> `Σ max(d_i ± r, 0)² = r²` jest okręgiem **tylko dla ścian prostopadłych** (90°);
> dla innych kątów to elipsa (błąd promienia do 0,27·r przy 150°, 0,18·r przy 120°).
> Zastąpiona 2026-10-07; pilnuje tego test `FILLET: dowolny kąt dwuścienny`.

- `d_i` — znakowana odległość od płaszczyzny i-tej przyległej ściany (dodatnia po
  stronie normalnej zewnętrznej),
- **chamfer** → przecięcie płaszczyzną o zadanym odsunięciu (`Σ d_i = ∓c`).

Daje to **dokładny łuk okrągły styczny do obu ścian dla dowolnego kąta dwuściennego ≥ 60°**
(zmierzone max |ρ − r| ≈ 1e-16 dla 75°…150°; poniżej 60° ogranicza twardy limit `|Δ| ≤ r`,
bo idealny wierzchołek klina wymaga `r/sin(θ/2) − r`). Pas przy krawędzi jest najpierw
subdzielony adaptacyjnie (podział liniowy — geometrycznie bezstratny), potem wierzchołki
są przesuwane, na końcu 16 przebiegów naprawy (flipy / degeneracje) z pełnym wycofaniem,
jeśli naprawa się nie uda.

Stałe kontrolne dla kąta 90° (używane w testach jako złote wartości):

| Wielkość | Wzór | Wartość |
|---|---|---|
| przesunięcie na dwusiecznej | `(√2 − 1)·r` | `0,414214·r` |
| przesunięcie w narożniku (3 ściany) | `(√3 − 1)·r` | `0,732051·r` |
| ubytek objętości na jednostkę długości | `r²(1 − π/4)` | `0,214602·r²` |
| objętość kostki po zaokrągleniu (Steiner) | `a³ + 6a²r + 3πar² + (4/3)πr³`, `a = bok − 2r` | — |

## 3. Gwarancje (wszystkie pokryte testami)

1. **Nie rusza nic poza pasmem** — wierzchołki dalej niż `r` od każdej zaznaczonej
   krawędzi są **bit-identyczne** z wejściem (test przechodzi dla 20 mm kostki).
2. **Leży na idealnej powierzchni** — każdy przesunięty wierzchołek spełnia równanie
   filletu; błąd numeryczny rzędu `1,3e-15` (podwójna precyzja).
3. **Twardy limit ruchu** — `|Δ| ≤ min(r, 0,25·L_min_incident, maxDisplacement)`;
   dzięki temu żaden wierzchołek nie przeskoczy sąsiada i nie złoży siatki.
4. **Wymiary** — `|Δ bbox| ≤ 2·maxDisplacement`; aplikacja ostrzega, gdy
   `maxBboxDelta > 0,05 mm`.
5. **Topologia** — wynik pozostaje zamknięty i rozmaitościowy, 0 odwróconych i
   0 zdegenerowanych trójkątów dla wszystkich presetów UI na obu modelach demo.
6. **Determinizm** — dwa uruchomienia dają identyczny wynik bajt w bajt.
7. **Brak NaN/Infinity** — sprawdzane jawnie po każdej operacji.

Świadome zachowania (nie błędy): krawędzie płaskie (poniżej progu) są pomijane;
krawędzie brzegowe i nie-rozmaitościowe są pomijane i raportowane; bbox może się
zmniejszyć na prawdziwych ostrych narożnikach (stąd ostrzeżenie); w mieszanym
sąsiedztwie wypukło-wklęsłym decyduje najbliższa krawędź; bardzo ostre „noże"
(`|W| ≈ 0`) mogą zostać zaokrąglone zbyt słabo.

## 4. Mapa plików

| Plik | Rola |
|---|---|
| `src/utils/meshTypes.ts` | kontrakty typów (`MeshData`, `EdgeRecord`, `RoundingOptions`, `RoundingReport`) |
| `src/utils/meshTopology.ts` | spawanie (własny spatial hash), topologia krawędzi, orientacja ścian, diagnostyka, objętość/pole, wykrywanie dziur/nie-rozmaitości/bowtie |
| `src/utils/edgeRounding.ts` | rdzeń: `FeatureGrid`, `roundEdges`, subdzielenie adaptacyjne, naprawa |
| `src/utils/meshIO.ts` | STL/OBJ → zupa trójkątów, `BufferGeometry` ↔ `MeshData` |
| `src/utils/meshExport.ts` | binarny STL + OBJ (nagłówek nigdy nie zaczyna się od `solid`) |
| `src/utils/meshProcessing.ts` | barrel — re-eksport publicznego API |
| `src/components/ThreeViewer.tsx` | viewer, raycast `faceIndex` → najbliższa z 3 krawędzi ściany |
| `src/App.tsx` | selekcja krawędzi, presety, debounce 90 ms, tabela przed/po, eksport |
| `src/ssrEntry.tsx` + `scripts/ssr-smoke.mjs` | render UI bez przeglądarki (build Vite SSR) |
| `app/main.py` | uczciwy serwer referencyjny (stdlib, bez MeshLib); `/api/process` zwraca **501** |
| `scripts/verify_backend.py` | niezależna implementacja w Pythonie vs TypeScript |
| `tests/*.test.ts` | 50 testów; `tests/all.test.ts` to agregator |

## 5. Pułapki, które już nas ugryzły (nie powtarzać)

- **`node --test` nie działa w tym środowisku** (`spawn EPERM` przy piped stdio) —
  testy odpalamy w procesie: `node tests/all.test.ts`.
- **Node nie zaimportuje `.tsx`** (JSX nie przechodzi type-strippingu) — render UI
  weryfikujemy buildem SSR, nie importem `App.tsx` w teście.
- **`BufferGeometryUtils.mergeVertices` jest niebezpieczne** — haszuje wszystkie
  atrybuty i aliasuje kubełki przez `Math.trunc` (three.js #24621). Mamy własny spawacz.
- **`computeVertexNormals()`** na geometrii nieindeksowanej daje normalne płaskie.
- **Laplacian / Taubin / HC smoothing są odrzucone** — nie mają jednostki (mm),
  kurczą model; nie spełniają wymogu „tylko wygładza rogi".
- **Konwencja nawijania bywa różna** — wypukłość wykrywamy testem strony płaszczyzny
  względem przeciwnego wierzchołka (`d0 + d1 < 0` ⇒ wypukła), niezależnym od orientacji.
- **Objętość znakowana** liczymy po przesunięciu do środka bbox (stabilność numeryczna).
- **Propagacja orientacji ścian**: `adjSame[i] ? 1 - flip[f] : flip[f]`
  (odwrotna reguła dawała mieszane nawijanie i objętość 0).
- **Rozmiar komórki `FeatureGrid`** musi być `max(maxReach, totalFeatureLength/20000,
  diag*1e-6)` — przy `maxReach` samym w sobie liczba chunków eksplodowała
  (5186 ms → 359 ms na `pranie.stl`).
- **Limit promienia** ustawiamy z robustnych statystyk (mediana długości krawędzi,
  `0,5·minBboxDim`), nie z minimum/percentyla — `pranie.stl` ma krawędź 0,01373 mm.
- **Nie ufać teoretycznej odchyłce łuku** — `chordDeviation` mówi, jaka byłaby odchyłka
  przy dowolnie gęstej siatce. Realną granicą jest `bandFacetSize` (zmierzona najdłuższa
  ściana w pasie): dopóki `bandFacetSize > 2r`, o odchyłce decyduje siatka, nie segmenty.
  Zmierzone: siatka 12 trójkątów → błąd max 0,34·r; po 4 poziomach → 0,25·r.
- **Budżet trójkątów realnie przerywa zagęszczanie** na modelach, gdzie pas obejmuje
  większość siatki (np. `pranie.stl`: domyślne 60 000 → koniec na 22 254 trójkątach).
  Dlatego `refinementLimitedByBudget` i ostrzeżenie są częścią raportu, a nie cichym
  ograniczeniem. Zagęszczanie rośnie 4× na poziom — bez budżetu 12,8 mln trójkątów
  kończy się OOM (sprawdzone: Node wywala się przy 4 GB sterty).
- **Pomiar odchyłki „przez `computeDisplacement`” nie działa** — funkcja zwraca `null`
  dla punktów już wewnątrz bryły (`g ≤ r²`), więc mierzyłaby 0 dla zapadniętych ścian.
  Stąd decyzja o raportowaniu zmierzonej rozdzielczości, a nie „zmierzonej odchyłki".

## 6. Parametry pod druk (w UI i w researchu)

- `NOZZLE_MM = 0.4`, `MIN_VISIBLE_RADIUS_MM = 0.3`, `PRINT_TOLERANCE_MM = 0.1`.
- Domyślny próg ostrości **30°**, domyślny promień **0,4 mm**, segmenty **3**.
- Ostrzeżenie o teoretycznej odchyłce łuku powyżej **0,05 mm**.
- Osobne ostrzeżenie, gdy `bandFacetSize > 2·r` (siatka nie rozdziela łuku).
- Presety: Bezpieczne 0,4 mm · Wytrzymałe 1,0 mm · Ścięcie 45° 0,6 mm · Własne.

## 7. Modele demo (złote dane)

| Model | Trójkąty | Wierzchołki | Uwagi |
|---|---|---|---|
| `public/cube.stl` | 12 | 8 | χ = 2, objętość 8000, bbox 20×20×20 |
| `public/pranie.stl` | 260 | 138 | zamknięty, **2 krawędzie nie-rozmaitościowe**, χ = 10, 4 składowe, objętość 115707,34282500522, bbox 176,2233×174,3419×37,9005, minEdge 0,01373, maxEdge 204,622 |

## 8. Skróty

```bash
npm run dev        # http://localhost:5173
npm run lint       # oxlint
npx tsc -b         # typy
npm test           # 50 testów w procesie
npm run test:ssr   # render UI bez przeglądarki
npm run build      # tsc -b && vite build
python scripts/verify_backend.py   # Python vs TS, zgodność diagnostyki
```
