# ADR 0002: Analityczny fillet (rolling-ball) zamiast wygładzania siatki

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

RoundEdge ma zaokrąglać/ścinać krawędzie modeli STL/OBJ/3MF tak, aby wynik był przewidywalny dla druku 3D (jednostki mm, kontrola promienia). W rdzeniu zaimplementowano analityczną operację filletu/chamferu opartą o półprzestrzenie ścian i rzut na obszar środków kuli, z adaptacyjnym zagęszczeniem pasa (`src/utils/edgeRounding.ts:1-43`, `edgeRounding.ts:216-357`, `edgeRounding.ts:441-455`, `edgeRounding.ts:741-1321`). Kontrakty danych zakładają geometrię float64 i raport z metrykami jakości/błędu (`src/utils/meshTypes.ts:4-9`, `src/utils/meshTypes.ts:126-183`). Audyt i badania wskazały problemy do korekty (m.in. ostre kąty, limity promienia, wiarygodność raportu, kąt materiału, błąd powierzchni) i uzasadniły dalsze doprecyzowanie algorytmu (`docs/audit/printability-audit.md:19-21`, `docs/audit/printability-audit.md:74-101`, `docs/audit/printability-audit.md:224-239`, `docs/audit/printability-audit.md:263-271`, `docs/superpowers/plans/2026-11-12-printability-rework.md:224-379`, `docs/research/printability-algorithms.md:188-205`).

## Decision

1. Zachowujemy **analityczny fillet/chamfer** (rolling-ball / opening-closing na półprzestrzeniach) zamiast filtrów wygładzania (Laplacian/Taubin/HC), które nie mają jednostki długości i mogą zmieniać wymiary (`src/utils/edgeRounding.ts:24-33`, `docs/research/printability-algorithms.md:277-285`).
2. Fillet liczymy przez projekcję punktu na zbiór dopuszczalnych środków kuli i zejście na sferę o promieniu `r`; chamfer jako płaszczyznę ścinającą; tylko wierzchołki w pasie są przesuwane, a zagęszczenie pasa realizujemy podziałem krawędzi (`src/utils/edgeRounding.ts:5-43`, `edgeRounding.ts:441-455`, `edgeRounding.ts:579-613`, `edgeRounding.ts:216-357`).
3. Używamy kąta materiału `theta = π - normalAngle` dla geometrii łuku/limitu ostrego kąta (`rFeat` per cecha) oraz stosujemy zabezpieczenia ruchu (clamp/relaks/revert/wycofanie) i selekcję krawędzi nadających się do obróbki (`src/utils/edgeRounding.ts:866-928`, `edgeRounding.ts:741-826`, `edgeRounding.ts:992-1153`).
4. Raport rozdziela wielkości teoretyczne i zmierzone oraz stan faktyczny operacji: `chordDeviation` vs `measuredSurfaceError`/`bandFacetSize`, `edgesRounded`, `geometryChanged`, `failed`, `failedEdgeIndices`, `radiusClampReason` (`src/utils/meshTypes.ts:156-183`, `edgeRounding.ts:691-738`, `edgeRounding.ts:1154-1192`, `edgeRounding.ts:1281-1319`).
5. Limit promienia uwzględnia lokalną skalę/gabaryt i ograniczenia ostrych kątów (cap + clamp reason/ostrzeżenia) jako ochrona przed niefizycznym ruchem; dalsze uszczelnienie limitu o `edgeClearance` (geometria odstępu) jest kierunkiem planu (`src/utils/edgeRounding.ts:828-860`, `src/utils/edgeRounding.ts:910-928`, `src/utils/meshClearance.ts:21-38`, `docs/superpowers/plans/2026-11-12-printability-rework.md:47-101`, `docs/superpowers/plans/2026-11-12-printability-rework.md:255-283`).

## Consequences

### Positive
- Promień ma sens fizyczny w mm i jest powiązany z geometrią krawędzi, a nie z gęstością siatki czy iteracjami smoothingu (`edgeRounding.ts:24-33`, `edgeRounding.ts:441-455`).
- Raport dostarcza sygnały diagnostyczne (zmierzony błąd, faktycznie ruszone krawędzie, przyczyna clampu/wycofania) przydatne dla UI i walidacji (`meshTypes.ts:156-183`, `edgeRounding.ts:1154-1192`).
- Możliwość zachowania geometrii poza pasem i kontrola budżetu/poziomów refine ograniczają regresje wymiarowe i koszt (`edgeRounding.ts:31-42`, `edgeRounding.ts:216-229`, `edgeRounding.ts:1090-1098`).

### Negative / Trade-offs
- Większa złożoność obliczeniowa i implementacyjna niż proste wygładzanie; konieczne heurystyki bezpieczeństwa i pętle naprawcze (`edgeRounding.ts:456-553`, `edgeRounding.ts:1084-1153`).
- Dla bardzo rzadkiej siatki/ostrch klinów/budżetów realna jakość łuku może być ograniczona mimo poprawnego promienia teoretycznego (`edgeRounding.ts:1255-1270`, `docs/audit/printability-audit.md:224-239`).

### Risks
- Wskazane w audycie przypadki brzegowe (ostre kliny, zależność promienia od skali siatki, komunikaty/raportowanie w skrajnych sytuacjach) mogą nadal wymagać zmian zgodnych z planem (`docs/audit/printability-audit.md:74-192`, `docs/superpowers/plans/2026-11-12-printability-rework.md:224-379`).
- Niezgodność między `effectiveRadius` globalnym a per-cecha (`rFeat`) wymaga ostrożnej interpretacji raportu w UI (`edgeRounding.ts:852-860`, `edgeRounding.ts:1018-1019`, `edgeRounding.ts:1286`). Status pełnego domknięcia wszystkich findingów: **nie zweryfikowano**.