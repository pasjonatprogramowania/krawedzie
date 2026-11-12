# ADR 0005: Przebudowa GUI na wzór PrintFins (canvas-first, szyny boczne)

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu (RoundEdge)

## Context

Aplikacja RoundEdge ma dwa równorzędne panele obok siebie: szeroki panel sterowania
(`md:w-[25rem]`, `src/App.tsx:461`) i podgląd 3D (`src/App.tsx:814`). Wszystkie
kontrolki — import, selekcja krawędzi, presety, parametry, tabela przed/po, eksport —
żyją w lewym panelu, więc podgląd modelu jest zawsze obcięty i użytkownik nie widzi
całej bryły podczas zaznaczania krawędzi. Dodatkowo interfejs używa własnej palety
(tło `#0a0a0f`, akcent teal `#00d4aa`, `tailwind.config.js:12-19`) i trybu jasnego
(`.light`, `src/index.css:73-89`), a warstwa `glass-panel` / `glass-card`
(`src/index.css:40-56`) powiela system kart, których w interfejsie jest sześć.

Właściciel wskazał jako wzorzec aplikację PrintFins (<https://printfins.com/>) oraz jej
repozytorium (<https://github.com/gittrahan/support-fins>) — narzędzie webowe do
przygotowywania modeli 3D do druku, o tym samym przeznaczeniu co RoundEdge: wszystko
liczone lokalnie w przeglądarce, plik nie opuszcza komputera.

Pomiar wzorca (tokeny, szkielet ekranu, zachowanie szyn) znajduje się w
`docs/design/printfins-reference.md`.

## Decision

Przebudowujemy warstwę prezentacji na układ **canvas-first** w stylu PrintFins:

1. **Pełnoekranowe płótno 3D** jest elementem pierwszorzędnym. Usuwamy stały panel
   boczny z szerokością 25 rem.
2. **Górny pasek 52 px**: marka po lewej, kontrolki po prawej (`flex-wrap: wrap`).
   Zawiera przycisk akcentowy **Import**, selektor **Dysza**, suwak **Promień**,
   przycisk **Zaokrąglij**, menu **Export** i **Presety**.
3. **Pływające szyny** zamiast stałego panelu: lewa = karta statystyk (`272px`),
   prawa = karta parametrów + karta statusu (`264px`). Szyny przewijają się
   niezależnie, a szkielet ma `pointer-events: none`, żeby kliknięcie w lukę
   obracało scenę.
4. **Pasek widoku** w lewym dolnym narożniku (efekt szkła), odczyt FPS w prawym dolnym.
5. **Karta środkowa** w stanie pustym (obramowanie przerywane) zamiast pełnoekranowego
   wizardu — jedna karta, jedna akcja.
6. **Paleta PrintFins** jako baza: tło `#14161a`, panel `#1c1f26`, linia `#2c313b`,
   tekst `#e7e9ee`, przygaszony `#8d95a5`, akcent `#4da3ff`, przycisk `#2a303a`,
   krawędź przycisku `#454d5c`. Semantyczne kolory krawędzi (pomarańczowa = zaznaczona,
   fioletowa = wykryta automatycznie) zostają, ale nie są akcentem marki.
7. **Tryb jasny usuwamy.** PrintFins jest wyłącznie ciemny, a `.light` w RoundEdge
   nie ma pokrycia testami ani designu; każdy kolejny komponent musiałby mieć dwie
   wersje stylów. Pozostaje jeden motyw.
8. **Nowa kontrola: selektor dyszy (0,2–2,0 mm)**. To parametr drukarki, a nie
   obudowy, i steruje minimalnym promieniem nadającym się do wydruku.

## Consequences

### Positive

- Podgląd zajmuje cały ekran — zaznaczanie krawędzi staje się czytelniejsze.
- Interfejs wygląda jak narzędzie, którego używa się w innym, konkurencyjnym produkcie
  o tym samym zadaniu; użytkownik nie musi szukać wzorca.
- Jedna paleta, jeden motyw, jeden zestaw kart zamiast sześciu sekcji w stałym panelu.
- Dysza w UI zamienia „promień 0,4 mm" ( arbitralne) na regułę drukarską.

### Negative / Trade-offs

- Płynące szyny na wąskich ekranach muszą się zwinąć do zwijanych paneli — więcej
  kodu responsywnego niż jeden stały panel.
- Zmiana identyfikacji wizualnej: użytkownicy znający jasny motyw tracą go.
- Karty muszą mieć `backdrop-filter`, co kosztuje wydajność na starszych GPU.

### Risks

- `backdrop-filter` + `position: fixed` na 8 elementach może powodować problemy
  z wydajnością w przeglądarce — mierzone, nie zgadywane.
- Przeniesienie 1000 linii `App.tsx` do osobnych komponentów to największy pojedynczy
  diff w tej przebudowie; ryzyko regresji w logice selekcji.
