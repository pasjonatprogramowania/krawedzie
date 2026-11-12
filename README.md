# RoundEdge

**Zaokrąglanie krawędzi siatek 3D pod druk 3D — w całości w przeglądarce.**

Wgrywasz STL/OBJ, klikasz krawędzie (albo każesz je wykryć automatycznie), ustawiasz
promień i pobierasz gotowy plik. Model nigdy nie opuszcza komputera: nie ma backendu,
nie ma uploadu, nie ma kolejki.

```
npm install
npm run dev      # http://localhost:5173
```

---

## 1. Co robi — i czego nie robi

**Robi:** zamienia wybrane ostre krawędzie w **dokładny łuk okrągły** (fillet) albo
w **ścięcie** (chamfer), nie ruszając niczego poza wąskim pasem wokół tych krawędzi.

**Nie robi:** nie wygładza siatki, nie remeshuje, nie decymuje, nie skaluje, nie
centruje, nie „naprawia" geometrii po cichu. To nie jest Laplacian/Taubin smoothing —
te operacje nie mają jednostki (mm) i kurczą model, więc nie spełniają wymagania
„zmień tylko rogi".

Konsekwencja praktyczna: **wymiary i struktura zostają**. Wierzchołek odległy od
wszystkich zaznaczonych krawędzi o więcej niż promień jest w wyniku **bit w bit**
taki sam jak na wejściu (test: [tests/rounding.test.ts](tests/rounding.test.ts)).

## 2. Jak się tego używa

1. **Wgraj model** — przeciągnij plik albo wczytaj demo (`public/cube.stl`,
   `public/pranie.stl`).
2. **Zaznacz krawędzie** — klik w bryłę trafia w najbliższą z trzech krawędzi
   klikniętej ściany; `Shift`/klik wielokrotny dodaje do zaznaczenia; przycisk
   auto-detekcji zaznacza wszystkie krawędzie ostrzejsze niż próg (domyślnie 30°).
3. **Wybierz preset** albo ustaw promień ręcznie:

   | Preset | Typ | Wartość | Kiedy |
   |---|---|---|---|
   | Bezpieczne | fillet | 0,4 mm | domyślny; jedna średnica dyszy |
   | Wytrzymałe | fillet | 1,0 mm | redukcja koncentracji naprężeń |
   | Ścięcie 45° | chamfer | 0,6 mm | gdy fillet nie wchodzi w detal |
   | Własne | — | dowolne | pełna kontrola |

4. **Popatrz na tabelę „przed / po"** — liczba trójkątów, objętość, zmiana wymiarów
   gabarytowych, maksymalne przesunięcie wierzchołka, diagnostyka topologii.
5. **Pobierz STL albo OBJ.**

Przetwarzanie jest odporne na szybkie klikanie: przeliczenie jest odpytywane z
opóźnieniem 90 ms i pokazuje stan „liczę".

## 3. Algorytm

### 3.1. Idea: fillet to operacja morfologiczna, nie wygładzanie

Dla krawędzi, przy której stykają się ściany o płaszczyznach o normalnych
zewnętrznych `n_i`, niech

```
d_i(x) = (x − p_i) · n_i        // znakowana odległość od i-tej płaszczyzny,
                                // dodatnia po stronie normalnej zewnętrznej
```

Fillet o promieniu `r` to ślad toczącej się kuli o promieniu `r`, czyli:

| Przypadek | Operacja | Obszar środków kuli `C` | Powierzchnia |
|---|---|---|---|
| krawędź **wypukła** | *opening* | `d_i(c) ≤ −r` | `dist(p, C) = r` |
| krawędź **wklęsła** | *closing* | `d_i(c) ≥ +r` | `dist(p, C) = r` |
| **chamfer** | przecięcie płaszczyzną | — | `Σ d_i = ∓c` |

gdzie `dist(p, C)` to **dokładna odległość punktu od przecięcia półprzestrzeni**
(rozwiązujemy rzut metodą aktywnych ograniczeń). Przemieszczenie to
`Δ = v·(1 − r/|v|)`, gdzie `v = c* − p` jest wektorem do rzutu na `C`.

To sformułowanie jest **ścisłe dla dowolnego kąta dwuściennego**. Warto wiedzieć, że
prostsza i kusząca alternatywa — rozwiązywanie `Σ max(d_i ± r, 0)² = r²` — daje okrąg
tylko wtedy, gdy normalne ścian są **prostopadłe**; dla innych kątów opisuje elipsę
(zmierzone błędy promienia: 0,18·r przy 120°, 0,27·r przy 150°). Zostało to wykryte
w niezależnej weryfikacji i naprawione; pilnuje tego test
`FILLET: dowolny kąt dwuścienny — powierzchnia to łuk o promieniu r`.

Kontrola dla kąta 90° (te liczby są zaszyte w testach jako złote wartości):

| Wielkość | Wzór | Wartość |
|---|---|---|
| przesunięcie wierzchołka na dwusiecznej | `(√2 − 1)·r` | `0,414214·r` |
| przesunięcie w narożniku (3 ściany) | `(√3 − 1)·r` | `0,732051·r` |
| ubytek objętości na jednostkę długości krawędzi | `r²(1 − π/4)` | `0,214602·r²` |
| objętość kostki `s` po zaokrągleniu (Steiner) | `a³ + 6a²r + 3πar² + (4/3)πr³`, `a = s − 2r` | — |

### 3.2. Pipeline

```
STL/OBJ ──► spawanie zupy trójkątów ──► topologia krawędzi ──► klasyfikacja
                                                                   │
                                                                   ▼
   ┌─────────────── subdzielenie adaptacyjne pasa (podział liniowy) ───────────┐
   │  geometria bez zmian: nowe wierzchołki leżą dokładnie na krawędziach      │
   └──────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
        przesunięcie wierzchołków na powierzchnię filletu (wzdłuż dwusiecznej)
                                      ▼
        16 przebiegów naprawy: korekta flipów, usuwanie degeneracji
                                      ▼
        pełne wycofanie, jeśli naprawa się nie uda  ──►  eksport STL/OBJ
```

Kluczowe decyzje:

- **Własny spawacz wierzchołków** zamiast `BufferGeometryUtils.mergeVertices`.
  Tamten haszuje *wszystkie* atrybuty i kwantyzuje pozycje przez `Math.trunc`,
  przez co potrafi rozdzielić punkty bliższe niż tolerancja
  ([three.js #24621](https://github.com/mrdoob/three.js/issues/24621)).
- **Subdzielenie liniowe (midpoint)** jest geometrycznie bezstratne — nowe
  wierzchołki leżą na istniejącej powierzchni, więc objętość i pole nie drgną.
  Dzięki temu pas ma dość gęstości, by łuk był gładki, a siatka nie rośnie globalnie.
- **Klasyfikacja wypukła/wklęsła niezależna od konwencji nawijania** — testujemy, po
  której stronie płaszczyzny ściany leży wierzchołek przeciwległy (`d₀ + d₁ < 0` ⇒
  wypukła), zamiast ufać kierunkowi normalnych.
- **Objętość znakowana** liczona po przesunięciu siatki do środka bryły (stabilność
  numeryczna; przy dużych współrzędnych bezwzględnych suma iloczynów mieszanych
  traci cyfry znaczące).

## 4. Gwarancje — i co je sprawdza

| # | Gwarancja | Test |
|---|---|---|
| G1 | Każdy przesunięty wierzchołek leży na idealnej powierzchni filletu (błąd ~`1,3e-15` dla kostki 20 mm, `r = 2`) | `FILLET: sześcian 20mm, r=2 — geometria dokładnego łuku` |
| G2 | Wierzchołki dalej niż `r` od każdej zaznaczonej krawędzi są **bit-identyczne** z wejściem | `FILLET: wierzchołki poza pasmem są BIT-IDENTYCZNE` |
| G3 | `\|Δ\| ≤ min(r, 0,25·L_min_incident, maxDisplacement)` — wierzchołek nie przeskoczy sąsiada | `SAFETY: promień większy niż połowa najkrótszej krawędzi…` |
| G4 | `\|Δ bbox\| ≤ 2·maxDisplacement`, a aplikacja ostrzega, gdy przekroczy 0,05 mm | `REAL: public/pranie.stl … z zachowaniem wymiarów` |
| G5 | Wynik pozostaje zamknięty i rozmaitościowy: 0 odwróconych, 0 zdegenerowanych trójkątów | `PIPELINE: każdy preset UI daje bezpieczny wynik na obu modelach` |
| G6 | Zero `NaN`/`Infinity` w wyniku | `SAFETY: brak NaN/Infinity w wyniku` |
| G7 | Determinizm: dwa uruchomienia dają identyczny wynik | `SAFETY: determinizm` |
| G8 | Zaznaczenie jednej krawędzi nie rusza pozostałych | `FILLET: zaznaczenie jednej krawędzi nie rusza pozostałych` |
| G9 | Więcej segmentów ⇒ mniejsza odchyłka chordalna i objętość zbieżna do analitycznej | `FILLET: objętość zbiega do wartości analitycznej` |
| G10 | Raport pokazuje **zmierzoną** rozdzielczość siatki w pasie, a nie tylko teoretyczną odchyłkę łuku | `RAPORT: rozdzielczość pasa jest mierzona, a nie zakładana` |
| G11 | Przerwanie zagęszczania limitem trójkątów jest raportowane; gwarancje bezpieczeństwa nadal obowiązują | `BUDŻET: przekroczenie limitu trójkątów…` |
| G12 | Dla **dowolnego** kąta dwuściennego ≥ 60° powierzchnia to okrąg o promieniu `r` (nie elipsa) | `FILLET: dowolny kąt dwuścienny — powierzchnia to łuk o promieniu r` |

**Świadome zachowania** (to nie są błędy, tylko wybory — aplikacja je raportuje):

- krawędzie płaskie, poniżej progu ostrości, są pomijane;
- krawędzie brzegowe (dziury) i nie-rozmaitościowe są pomijane i wypisane w ostrzeżeniach;
- gabaryt **może** zmaleć na prawdziwych ostrych narożnikach — i wtedy pojawia się
  ostrzeżenie; to nie jest „utrata wymiaru", tylko skutek zdjęcia materiału z rogu;
- w sąsiedztwie mieszanym wypukło-wklęsłym decyduje najbliższa krawędź;
- bardzo cienki „nóż" (`|W| ≈ 0`) może zostać zaokrąglony słabiej, żeby nie złożyć siatki;
- **krawędzie ostrzejsze niż ~60°** (kąt materiału) nie mogą dostać pełnego łuku:
  wierzchołek takiego klina musiałby się przesunąć o `r/sin(θ/2) − r`, czyli
  `2,86·r` przy 30° i `1,61·r` przy 45°, a twardy limit to `|Δ| ≤ r`. Taki klin jest
  więc zaokrąglany płycej, a raport pokazuje `clampedVertexCount` i ostrzeżenie.
  Dla 60° wymagane przesunięcie wynosi dokładnie `r` (granicznie), a dla 75° i więcej
  łuk jest odtwarzany dokładnie (błąd ~1e-16).

### 4.1. Granica, o której warto wiedzieć: rozdzielczość siatki

Wierzchołki są odkładane **dokładnie** na powierzchni filletu, ale trójkąty między nimi
są płaskie. Jeśli ściany wokół krawędzi są większe niż promień, siatka nie jest w stanie
tego łuku narysować — a wtedy o odchyłce decyduje **gęstość modelu, nie liczba
segmentów**. Dlatego raport zawiera dwie różne liczby:

| Pole | Znaczenie |
|---|---|
| `chordDeviation` | teoretyczna strzałka łuku dla danej liczby segmentów — obowiązuje **tylko** przy dowolnie gęstej siatce |
| `bandFacetSize` | **zmierzona** najdłuższa ściana w pasie po zagęszczeniu — realna rozdzielczość, z jaką łuk został odtworzony |

Gdy `bandFacetSize > 2·r`, aplikacja wypisuje ostrzeżenie i podaje prawdziwe ograniczenie:
odchyłka jest wtedy ograniczona przez `maxDisplacement` (wierzchołki leżą dokładnie na
powierzchni), a nie przez teoretyczną wartość łuku. Zmierzone na modelu 176 mm z 260
trójkątami i promieniem 0,4 mm: pas 25,7 mm, czyli łuk jest tam tylko zasygnalizowany —
i aplikacja mówi to wprost, zamiast pokazywać 0,0136 mm.

Drugi limit to `triangleBudget` (domyślnie `min(2 mln, max(60 tys., 12 × liczba ścian))`).
Gdy zagęszczanie pasa musiałoby go przekroczyć, raport ustawia
`refinementLimitedByBudget = true` i ostrzega — wynik pozostaje poprawny topologicznie,
ale łuk jest rzadszy, niż wynikałoby to z liczby segmentów.

## 5. Parametry pod druk — skąd te liczby

| Parametr | Wartość | Uzasadnienie |
|---|---|---|
| Średnica dyszy FDM | 0,4 mm | standard; promień mniejszy od średnicy dyszy jest ledwo widoczny |
| Minimalny sensowny promień | 0,3 mm | poniżej zanika w warstwie |
| Zalecany zakres filletu | 0,4 – 2 mm | kompromis: efekt widoczny, detal nie znika |
| Tolerancja wymiarowa | 0,1 mm | typowa dokładność FDM; próg ostrzeżenia o zmianie gabarytu |
| Odchyłka chordalna | ostrzeżenie > 0,05 mm | powyżej tego łuk widać jako wielokąt na wydruku |
| Próg auto-detekcji ostrości | 30° | krawędzie łagodniejsze są już „gładkie" dla oka i dla slicera |

Zaokrąglanie krawędzi ma sens inżynierski, nie tylko estetyczny: ostre narożniki
wewnętrzne działają jak koncentratory naprężeń, a zaokrąglenia zewnętrzne poprawiają
jakość powierzchni i układanie warstw (patrz [§7](#7-źródła)). Warto pamiętać o
drugiej stronie medalu: na powierzchni styku z podporami / stołem lepiej czasem użyć
chamferu 45°, bo daje przewidywalny, płaski rowek zamiast łuku.

## 6. Struktura projektu

| Ścieżka | Rola |
|---|---|
| [src/App.tsx](src/App.tsx) | cały interfejs: wczytywanie, selekcja, presety, raport przed/po, eksport |
| [src/components/ThreeViewer.tsx](src/components/ThreeViewer.tsx) | scena three.js, raycast po ścianach → krawędzie, rysowanie zaznaczenia |
| [src/utils/edgeRounding.ts](src/utils/edgeRounding.ts) | **rdzeń algorytmu**: `roundEdges`, subdzielenie pasa, naprawa |
| [src/utils/meshTopology.ts](src/utils/meshTopology.ts) | spawanie, graf krawędzi, orientacja ścian, diagnostyka, objętość/pole |
| [src/utils/meshIO.ts](src/utils/meshIO.ts) | STL/OBJ → zupa trójkątów, `BufferGeometry` ↔ `MeshData` |
| [src/utils/meshExport.ts](src/utils/meshExport.ts) | binarny STL i OBJ na wyjściu |
| [src/utils/meshTypes.ts](src/utils/meshTypes.ts) | kontrakty typów całego pipeline'u |
| [tests/](tests) | 50 testów: topologia, subdzielenie, fillet/chamfer, modele demo, pipeline, UI |
| [scripts/ssr-smoke.mjs](scripts/ssr-smoke.mjs) | render interfejsu bez przeglądarki (build SSR + `renderToStaticMarkup`) |
| [app/main.py](app/main.py) | opcjonalny serwer referencyjny (tylko diagnostyka — patrz niżej) |
| [scripts/verify_backend.py](scripts/verify_backend.py) | niezależna implementacja diagnostyki w Pythonie, porównywana z TypeScriptem |
| [MEMORY.md](MEMORY.md) | zwarta pamięć projektu: niezmienniki, pułapki, złote dane |

### Serwer referencyjny (`app/main.py`)

To **nie jest** część ścieżki użytkownika — aplikacja jest w 100% klientowa.
Serwer istnieje jako niezależna kontrola poprawności: parsuje STL (binarny i ASCII),
spawa wierzchołki i liczy diagnostykę. Endpoint `/api/process` **celowo zwraca 501**:
zaokrąglanie żyje w TypeScripcie, a udawanie drugiej implementacji algorytmu byłoby
gorsze niż jej brak.

```bash
python app/main.py                                  # serwer na :8000
python scripts/verify_backend.py                    # Python vs TypeScript, model po modelu
```

## 7. Testy

```bash
npm test           # 50 testów, ~9 s, w procesie Node (bez przeglądarki)
npm run test:ssr   # render UI + 5 sprawdzeń HTML
npm run lint       # oxlint
npx tsc -b         # typy
npm run build      # produkcja do dist/
```

Stan na ostatni przebieg: **50/50 testów, 0 ostrzeżeń lint, build 845 kB (231 kB gzip)**.

Dwie pułapki środowiskowe warte zapamiętania: `node --test` nie działa w tym
środowisku (`spawn EPERM` przy przechwytywaniu stdio), dlatego `tests/all.test.ts`
uruchamia wszystkie zestawy w jednym procesie; a Node nie zaimportuje `.tsx`
(JSX nie przechodzi type-strippingu), dlatego interfejs weryfikujemy buildem SSR.

## 8. Ograniczenia

- Zaokrąglanie jest **lokalne** — dwie równoległe krawędzie bliżej niż `2r` od siebie
  dostaną fillet przycięty do połowy odstępu, nie jeden wspólny „rowek".
- Modele o bardzo drobnej siatce (setki tysięcy trójkątów) działają, ale w przeglądarce
  odczuwalnie wolniej; pas jest subdzielony tylko lokalnie, więc narzut rośnie
  liniowo od długości zaznaczonych krawędzi.
- Eksport obsługuje STL i OBJ. 3MF jest w planach.
- Nie ma (jeszcze) zmiennego promienia na jednej krawędzi ani wykrywania kolizji
  filletów między sobą.

## 9. Źródła

Materiały, na których oparto wymagania algorytmiczne i parametry druku:

1. Protolabs — *Designing a CAD Model for 3D Printing* — <https://www.protolabs.com/resources/blog/turning-cad-models-into-3d-printed-parts/>
2. Protolabs — *Digital Manufacturing Guide* (minimalne cechy, promienie, ścianki) — <https://www.protolabs.com/media/1022699/pl_digital_mfg_guide_2021.pdf>
3. Prusa Research — *Fillet vs chamfer, thin walls and minimum feature size* — <https://www.manualslib.com/manual/2580053/Prusa-Research-Original-I3-Mk3sPlus-Kit.html?page=51>
4. Zortrax — *Wall thickness and minimum feature size* — <https://support.zortrax.com/pdf/create/steps.php?id=25544>
5. AON3D — *How to design & 3D print stronger parts* (koncentracja naprężeń) — <https://www.aon3d.com/material-science/how-to-design-3d-print-stronger-parts/>
6. *Fillet surface generation by rolling-ball trajectory* (opis konstrukcji powierzchni filletowej) — <https://patentimages.storage.googleapis.com/1f/0f/be/2e639b7f55acd2/US5345546.pdf>
7. *Defillet: rolling-ball sections as osculating circles* — <https://raw.githubusercontent.com/xiaowuga/xiaowuga.github.io/main/pub/static/pdf/Defillet_Sig_2025.pdf>
8. *Alpha hull — rolling a ball of radius α over a point set* (ta sama matematyka progowania po stronie kuli) — <http://eprints.hud.ac.uk/id/eprint/12177/1/EP12177Final_Manuscript.pdf>
9. three.js — *mergeVertices truncates coordinates which misses some neighbors* (#24621) — <https://github.com/mrdoob/three.js/issues/24621>
10. three.js — dokumentacja `BufferGeometry` — <https://threejs.org/docs/#api/en/core/BufferGeometry>
11. Manifold — biblioteka do operacji na rozmaitościach — <https://github.com/elalish/manifold>
12. Blender — *Bevel* (zachowanie narożników przy zbiegających się krawędziach) — <https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/bevel.html>

---

Specyfikacja produktowa, z której wyrósł ten projekt, jest w [SPEC.md](SPEC.md).
