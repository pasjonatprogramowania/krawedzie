# ADR 0006: Limit promienia z geometrii, nie z siatki

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Promień filletu/chamferu musi opisywać fizyczną cechę modelu, a nie gęstość teselacji.
Audyt wykazał, że stare ograniczenie oparte na długości krawędzi siatki było błędne
(AUD-003, `docs/audit/printability-audit.md:125-151`): `0.5 * medianIncident` i limit
per-wierzchołek oparty o lokalną długość krawędzi myliły rozdzielczość siatki z rozmiarem
cechy, przez co zagęszczenie siatki zmniejszało osiągalny promień (np. kostka 20 mm,
`r=1`, podział 16× → `effectiveRadius` spadał do 0,625 mm, błąd powierzchni rosł).

Rdzeń potrzebuje dwóch geometrycznych ograniczeń: (1) czy łuk mieści się w materiale
(odstęp do przeciwległej ściany), (2) czy narożnik mieści się w budżecie przemieszczenia
dla danego kąta materiału. Oba są niezależne od tego, jak drobno pocięto siatkę.

## Decision

1. **Odstęp materiałowy liczony z geometrii, nie z krawędzi siatki.**
   `src/utils/meshClearance.ts:26-37,308-333` definiuje i implementuje
   `ClearanceGrid.edgeClearance(edge)` jako minimalny dystans promienia z połowy krawędzi
   w głąb materiału (`-faceNormals` obu ścian, `:318-328`), pomniejszony o połowę
   (`return best * 0.5`, `:332`), bo fillet wchodzi promieniem `r`. Odpytywanie opiera się
   na siatce przestrzennej trójkątów i teście Möller–Trumbore (`:160-301`), czyli na
   rzeczywistej odległości do powierzchni, nie na `edge.length`.
2. **Ostry kąt materiału ogranicza promień cechy analitycznie.**
   W `src/utils/edgeRounding.ts:884-899,916-928` kąt materiału
   `theta = Math.PI - phi` (`:874`) daje limit wykonalności
   `rMaxAngle = (size * sinHalf) / (1 - sinHalf)` (`:887`) i per-cechowy promień
   `rFeat = Math.min(size, rMaxAngle)` (`:898`), używany jako promień filletu tej cechy
   (`:1018`). Gdy pełny promień jest niemożliwy, raport ustawia
   `radiusClampReason = 'acute-angle'` i emituje ostrzeżenie z liczbą krawędzi i
   rzeczywistym promieniem (`:921-928`).
3. **Raport niesie powód i wartości, nie tylko liczbę.**
   `src/utils/meshTypes.ts:129-131,180-181` przechowuje `effectiveRadius` oraz
   `radiusClampReason: 'edge-length' | 'acute-angle' | 'clearance' | null`; rdzeń
   propaguje to w `RoundingReport` (`src/utils/edgeRounding.ts:795,796,1286,1317`).

## Consequences

### Positive
- Wynik nie zależy od teselacji: ten sam kształt daje ten sam limit promienia.
- Użytkownik dostaje jawny powód przycięcia (`radiusClampReason`, ostrzeżenia
  `edgeRounding.ts:921-928`) zamiast cichego spadku jakości.
- `meshClearance.ts` daje testowalny, wielokrotnego użytku prymityw geometryczny
  (ray/edge clearance) dla przyszłej integracji z rdzeniem.

### Negative / Trade-offs
- Liczenie clearance (DDA + ray-triangle) jest droższe niż odczyt długości krawędzi;
  wymaga dobrej struktury przestrzennej i budżetu czasu.
- Limit per-cecha (`rFeat`) komplikuje raport globalny: `effectiveRadius` w raporcie
  pozostaje promieniem operacji, a lokalne przycięcia są sygnalizowane osobno.

### Risks
- `computeMinIncidentEdge` nadal istnieje w `src/utils/edgeRounding.ts:170-184` (pozostałość
  historyczna obok mediany incydentnej `:829-843`); trzeba pilnować, by nie wrócił jako
  globalny limit promienia (regresja AUD-003).
- Integracja `edgeClearance` jako twardego cap w `roundEdges` musi pozostać spójna z
  kontraktem `radiusClampReason: 'clearance'` (`meshTypes.ts:181`) i komunikatami UI.
