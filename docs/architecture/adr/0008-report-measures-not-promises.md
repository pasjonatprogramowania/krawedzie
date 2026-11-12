# ADR 0008: Raport mierzy rzeczywistość, nie obietnice

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Użytkownik musi wiedzieć, co naprawdę wyszło z operacji: czy geometria się zmieniła,
które krawędzie się udały, jaki jest realny błąd powierzchni i czy wynik wolno eksportować.
Audyt wykazał, że teoretyczne metryki i liczniki „w paście” wprowadzały w błąd:
`chordDeviation` nie jest błędem realnej siatki (AUD-008,
`docs/audit/printability-audit.md:221-239`), a wycofanie operacji mogło wyglądać jak sukces
(AUD-004/007, `:153-218`).

## Decision

1. **Kontrakt raportu opisuje stan faktyczny operacji.**
   `src/utils/meshTypes.ts:125-183` definiuje m.in. `chordDeviation` jako wartość
   teoretyczną (`:156-159`), `bandFacetSize` jako realną rozdzielczość pasa (`:161-167`),
   `edgesRounded`, `geometryChanged`, `failed`, `failedEdgeIndices` (`:170-177`),
   `measuredSurfaceError` (`:178-179`) i `radiusClampReason` (`:180-181`).
2. **Rdzeń liczy sukces po fakcie i mierzy błąd na trójkątach.**
   `measureSurfaceError` (`src/utils/edgeRounding.ts:686-738`) mierzy odległość środków
   trójkątów pasa od idealnej powierzchni filletu (przeniesione płaszczyzny na centroid,
   `:716-733`, `distanceToFilletSurface`, `:559-571`). Wynik końcowy wyznacza
   faktycznie przesunięte wierzchołki/cechy (`:1159-1183`), ustawia `edgesRounded`,
   `failedEdgeIndices`, `geometryChanged = movedFinalCount > 0` i `failed = !geometryChanged`
   (`:1173-1182,1289,1312-1316`), zapisuje `measuredSurfaceError` (`:1188-1191,1316`).
3. **UI i eksport traktują `failed` i błąd mierzony jako blokady/sygnały, nie ozdobniki.**
   `src/App.tsx:327-332` ostrzega, gdy `measuredSurfaceError > 0.05`; `:386-389` reaguje
   toastem na `report.failed`; `:419-420,498-499` wylicza i przekazuje
   `exportBlocked = Boolean(result?.report.failed)` z jawnym powodem.
   `src/components/TopBar.tsx:14,26,107-114` wyłącza „Pobierz STL” (`disabled={exportBlocked}`)
   z tytułem wyjaśniającym. `src/components/StatusCard.tsx:44-51,72,105-108,119-126`
   pokazuje alert porażki (wycofane krawędzie, 0 zmienionych wierzchołków), wiersz
   „Błąd powierzchni” z `measuredSurfaceError`, diagnozę „Geometria zmieniona” i listę
   ostrzeżeń z liczbami/powodami.

## Consequences

### Positive
- Brak cichego „sukcesu”: wycofana operacja jest widoczna jako `failed`, blokuje eksport
  i nie udaje zmiany geometrii.
- `measuredSurfaceError` i `bandFacetSize` pozwalają odróżnić limit teorii (`chordDeviation`)
  od jakości realnej siatki, co wspiera decyzje o segmentach/gęstości.
- Raport zawiera dane nadające się do automatycznych asercji (liczby, indeksy, flagi).

### Negative / Trade-offs
- Pomiar błędu (`measureSurfaceError`) dokłada koszt po przeliczeniu geometrii.
- Konserwatywna blokada eksportu przy `failed` może frustrować, gdy użytkownik chciałby
  „częściowy” wynik; stan częściowy musi być wtedy modelowany jawnie, nie ukrywany.

### Risks
- Jeśli nowe ścieżki obliczeń ominą aktualizację `failed/geometryChanged/edgesRounded`,
  UI znów pokaże fałszywy sukces (regresja AUD-004/007).
- Ostrzeżenia muszą pozostać liczbowe i konkretne (`edgeRounding.ts:856-859,923-928,1238-1270`,
  `StatusCard.tsx:119-126`), inaczej raport znów stanie się deklaratywny.
