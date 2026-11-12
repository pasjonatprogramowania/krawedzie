# ADR 0007: Kąt materiału zamiast kąta normalnych

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Algorytm filletu musi dzielić pas i liczyć geometrię łuku według kąta, po którym faktycznie
biegnie materiał, nie według kąta między normalnymi ścian. Audyt (AUD-010,
`docs/audit/printability-audit.md:262-269`) pokazał, że użycie `minPhi = normalAngle`
dla `arcAngle` dawało błędny podział: dla klina 30° (`phi=150°`) pas był dzielony na 150°
zamiast 30° (za rzadka siatka), a dla kąta 150° nadmiernie zagęszczany; odchyłka łuku
i `chordDeviation` były liczone niespójnie z rzeczywistym łukiem.

Model danych rozróżnia te wielkości: `EdgeRecord.normalAngle` (kąt między normalnymi,
`[0, PI]`) i `EdgeRecord.dihedral` (kąt dwuścienny materiału, `PI - normalAngle`) w
`src/utils/meshTypes.ts:19-22`.

## Decision

1. **Geometria cechy używa kąta materiału `theta = PI - phi`.**
   W `src/utils/edgeRounding.ts:873-875` dla każdej wybranej krawędzi liczymy
   `phi = Math.max(1e-3, e.normalAngle)` i `theta = Math.PI - phi`; komentarz
   w `:866-867` wprost odwołuje się do AUD-010.
2. **Zagęszczanie pasa i długość docelowa elementu wynikają z `theta`.**
   `minTheta` jest minimum po cechach (`:868,875`), a `arcAngle = Math.max(15*DEG, Math.min(minTheta, Math.PI))`
   (`:954-955`) steruje `targetLength = (size * arcAngle) / segments` (`:956`).
   Dzięki temu klin 30° dostaje podział adekwatny do 30° łuku, nie 150°.
3. **Wykonalność i zasięg filletu wyprowadzone z półkąta materiału.**
   Setback/reach używają `halfTan = Math.tan(Math.max(theta, 1e-3) * 0.5)` (`:876-878`),
   a limit ostrego narożnika używa `sinHalf = Math.sin(theta / 2)` i progu 60° materiału
   (`:884-887,909-913`), co spina rozdzielczość, geometrię łuku i komunikat o przycięciu.
4. **Raportowana teoretyczna strzałka używa `arcAngle` materiału.**
   `chordDeviation = size * (1 - Math.cos(Math.min(Math.PI / 2, arcAngle) / (2 * segments)))`
   jest liczony w `src/utils/edgeRounding.ts:1220` na bazie tego samego `arcAngle`.

## Consequences

### Positive
- Rozdzielczość siatki w paście odpowiada faktycznemu łukowi filletu, więc mniej
  niepotrzebnych trójkątów na rozwartych klinach i lepsze pokrycie na ostrych.
- Jedno źródło prawdy (`theta`) spina zagęszczanie, reach, wykonalność i ostrzeżenia.
- Zgodność z semantyką danych: `EdgeRecord.dihedral` (`meshTypes.ts:22`) opisuje materiał.

### Negative / Trade-offs
- `chordDeviation` (`meshTypes.ts:156-159`, `edgeRounding.ts:1220`) pozostaje wartością
  teoretyczną (dla nieskończenie gęstej siatki) i nie zastępuje błędu mierzonego
  na realnych trójkątach (patrz ADR 0008).
- Ostrzejsze kliny wymagają więcej geometrii lokalnie; przy budżecie trójkątów rośnie
  ryzyko `refinementLimitedByBudget` (`edgeRounding.ts:274-279,1265-1270`).

### Risks
- Mieszanie `normalAngle` i `theta` w nowych miejscach może przywrócić AUD-010; zmiany
  w refine/chord muszą zawsze odwoływać się do kąta materiału i testów kątów ≠ 90°.
- Skrajnie małe `theta` wymaga stabilnych progów (obecnie clamp `1e-3`, próg ~60° dla
  pełnego promienia, `edgeRounding.ts:874,876,909-913`), inaczej pojawią się numeryczne
  artefakty lub mylące ostrzeżenia.
