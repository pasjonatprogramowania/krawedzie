# Wzorzec GUI: PrintFins → RoundEdge

Źródło: [printfins.com](https://printfins.com/) oraz repozytorium
[gittrahan/support-fins](https://github.com/gittrahan/support-fins) (`web/style.css`, `web/index.html`).

Status: pomiar wykonany 2026-11-12 (przeglądarka + pliki źródłowe repo).

---

## 1. Zmierzone tokeny (nie zgadywane — z `web/style.css`)

```css
:root {
  --topbar-h: 52px;      /* wysokość górnego paska */
  --bg:      #14161a;    /* tło aplikacji i sceny 3D */
  --panel:   #1c1f26;    /* karty, panele boczne */
  --line:    #2c313b;    /* obramowanie 1px */
  --text:    #e7e9ee;    /* tekst podstawowy */
  --dim:     #8d95a5;    /* tekst pomocniczy / wyłączony */
  --accent:  #4da3ff;    /* akcent: akcje główne, focus, linki */
  --btn:     #2a303a;    /* wypełnienie przycisku (jaśniejsze niż panel) */
  --btn-hi:  #333a46;    /* wypełnienie przycisku w hover */
  --btn-line:#454d5c;    /* krawędź przycisku */
}
```

Pozostałe kolory semantyczne z repozytorium:

| Rola | Wartość | Zastosowanie w RoundEdge |
|---|---|---|
| akcent | `#4da3ff` | akcja główna, focus, link, aktywna zakładka |
| ostrzeżenie | `#ffb454` | promień zbyt mały dla dyszy, model z cienkimi ściankami |
| nadzór / błąd | `#ff6b6b`, `#ff4d4d` | odwrócone trójkąty, brak zamknięcia, krawędzie nie-rozmaitościowe |
| sukces | `#6fcf8b` | poprawna geometria po zaokrągleniu |
| info | `#8fa3c8` | komunikaty pomocnicze |

### Typografia i skala

- `13px / 1.45`, `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
- Tekst pomocniczy i etykiety: `12px`
- Panel statystyk: szerokość stała `272px` (max `calc(100vw - 28px)`)
- Status / receipt: szerokość `264px`
- Numeracja z tablicami: `font-variant-numeric: tabular-nums`

### Kształt i głębia

| Element | Promień | Obramowanie | Cień |
|---|---|---|---|
| przycisk | `4px` | — | — |
| przycisk segmentowy (pierwszy/ostatni) | `6px` | — | — |
| karta / panel | `8px` | `1px solid var(--line)` | `backdrop-filter: blur(6px)` |
| szklany pasek (viewbar) | `9px` | `1px` (9% bieli) | `inset 0 1px 0` + `0 4px 18px rgb(0 0 0 / .28)` |
| pasek postępu | `3px` | — | — |
| koło postępu | `50%` | `2px solid var(--btn-line)` | — |

### Ruch

- przejścia `0.12s – 0.25s`, `ease`
- `prefers-reduced-motion: reduce` wyłącza animacje (jest to w oryginale)
- brak animacji wejścia przy pierwszym renderze

---

## 2. Szkielet ekranu (measured from `web/style.css` + zrzut)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▲ RoundEdge v2  [Import]  Dysza [0.4 ▾]  Promień [──●──] 0,8 mm    │  ← #topbar, 52 px
│                                          [Zaokrąglij] [Export ▾] [⋯] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌───────────────┐                              ┌──────────────────┐  │
│ │ #stats        │        #viewport (canvas)    │ #right-rail      │  │
│ │ plik 20×20    │                              │ parametry        │  │
│ │ trójkąty 12   │      ┌──────────────┐        │ ostrzeżenia      │  │
│ │ objętość 8000 │      │ karta środ.  │        └──────────────────┘  │
│ └───────────────┘      │ (dashed)     │                              │
│                        └──────────────┘        ┌──────────────────┐  │
│ ┌───────────────────┐                          │ #status / receipt│  │
│ │ #viewbar (glass)  │                          └──────────────────┘  │
│ └───────────────────┘                                    fps         │
└──────────────────────────────────────────────────────────────────────┘
```

- `#viewport` — `position: fixed; inset: 0`, canvas pełnoekranowy, scena 3D z siatką podłogową.
- `#topbar` — `position: fixed; top:0; left:0; right:0`, `flex-wrap: wrap`, `justify-content: flex-end`.
  Logo i nazwa przyklejone do lewej; wszystkie kontrolki w prawej.
- `#left-rail` — `top: var(--topbar-h); bottom: 14px; left: 14px`, jedna kolumna, przewijana,
  `pointer-events: none` na szkielecie i `auto` na kartach (kliknięcie w lukę orbituje scenę).
- `#right-rail` — `top: var(--topbar-h); bottom: 34px; right: 14px`, analogicznie; opcje u góry,
  status przypięty do dołu przez `flex: 1` spacer.
- `#viewbar` — `left: 14px; bottom: 14px`, szklany pasek z przyciskami widoku.
- `#plates` — wyśrodkowany pasek pod topbarem (`transform: translateX(-50%)`), `max-width: calc(100vw - 600px)`.
  W RoundEdge odpowiada mu **pasek zakładki modelu** („Model 1”, „Dodaj model”).
- `#fps` — `right: 14px; bottom: 12px`, kolor `--dim`.
- Karta środkowa (hero) — obramowanie `dashed`, `border-radius`, tekst wyśrodkowany.

---

## 3. Adaptacja do RoundEdge (co przenosimy, co zmieniamy)

### Przenosimy bez zmian (struktura, rytm, gęstość)

1. Pełnoekranowe płótno 3D jako element pierwszorzędny — koniec z podziałem 40/60.
2. Górny pasek 52 px: marka po lewej, kontrolki po prawej, `flex-wrap` przy wąskim oknie.
3. Boczne szyny (lewa = statystyki, prawa = parametry + ostrzeżenia), każda z osobnym przewijaniem.
4. Szklany pasek widoku w lewym dolnym narożniku + odczyt fps w prawym dolnym.
5. Karty: `1px solid var(--line)`, `border-radius: 8px`, `backdrop-filter: blur(6px)`.
6. `pointer-events: none` na szkieletach szyn, `auto` na kartach — scena zawsze się orbituje.
7. Jedna akcja główna wypełniona akcentem; pozostałe przyciski `--btn` z widoczną krawędzią.

### Zmieniamy ( RoundEdge ≠ PrintFins)

| PrintFins | RoundEdge (adaptacja) | Powód |
|---|---|---|
| „Build volume” (wymiary stołu) | **Dysza** (0,2–2,0 mm) | Drukarka 3D ma dyszę, nie stół w tym znaczeniu; to parametr, który steruje minimalnym promieniem |
| „Overhang” (kąt podparcia) | **Promień zaokrąglenia** (mm) | Główna akcja produktu |
| „Add fins” (główna akcja) | **Zaokrąglij** | Główna akcja produktu |
| „Export ▾” | „Export ▾” (STL / OBJ) | Bez zmian |
| „Calibrate ▾”, „Plugins ▾”, „Language ▾”, „GitHub”, „Ko-fi” | **Presety ▾**, **Pomoc ▾** | Produkt nie ma kalibracji wtyczek ani wielojęzyczności w MVP |
| czerwone ściany = overhangi | **pomarańczowe krawędzie = zaznaczone**, fioletowe = wykryte automatycznie | To istniejący model kolorów w RoundEdge (SPEC §7.2) |
| płyty (wiele modeli) | **zakładki modelu** | Funkcjonalnie to samo |

### Karta środkowa (pusty stan)

RoundEdge ma dwa ekrany (import / podgląd). Przenosimy format PrintFins: **jedna karta środkowa
z krótką instrukcją i akcją**, zamiast pełnoekranowego wizardu.

Treść karty (PL):

> **Zaokrągl narożniki przed drukiem**
> Wgraj model 3D (STL / OBJ / 3MF), zaznacz krawędzie i pobierz gotowy plik.
> 1. **Wgraj** — upuść plik w okno przeglądarki.
> 2. **Zaznacz** — kliknij krawędź w podglądzie 3D.
> 3. **Pobierz** — zaokrąglone narożniki drukują się lepiej.
> *Wszystkie obliczenia lokalnie w przeglądarce — plik nie opuszcza komputera.*

Pod kartą: dwa przyciski-demo („Kostka 20 mm”, „Pranie (trudny)”).

---

## 4. Mapa funkcji RoundEdge → miejsca w nowym układzie

| Funkcja (obecna) | Nowe miejsce |
|---|---|
| Wczytanie modelu (drop + przycisk) | Topbar: przycisk **Import** (akcent) + drop na całym oknie |
| Wybór pliku demo | Karta środkowa: dwa przyciski |
| Selekcja krawędzi (klik w viewerze) | Bez zmian — viewer jest teraz pełnoekranowy |
| Auto-detekcja ostrych krawędzi | Prawa szyna: przycisk w sekcji „Krawędzie” + licznik |
| Presety promienia (Bezpieczne/Wytrzymałe/Ścięcie/Własne) | Prawa szyna: **Presety ▾** w topbarze albo segment w karcie parametrów |
| Suwak promienia | Topbar: suwak „Promień” (z wartością w mm) — jak „Overhang” w PrintFins |
| Rodzaj zaokrąglenia (fillet/chamfer) | Prawa szyna: przełącznik segmentowy (jak `mode-seg`) |
| Liczba segmentów | Prawa szyna: suwak/select |
| Próg kąta płaskiego | Prawa szyna: suwak „Kąt ostry” |
| Statystyki (plik, trójkąty, wymiary, objętość) | Lewa szyna: karta `#stats` |
| Tabela przed/po + ostrzeżenia | Prawa szyna: karta statusu, ostrzeżenia jako `.over-warn` (pomarańczowa) |
| Eksport STL / OBJ | Topbar: „Export ▾” |
| Podpowiedź „min. promień dla dyszy” | Prawa szyna: ostrzeżenie `.over-warn` gdy `r < 2 × dysza` |

---

## 5. Reguły niezmienne (z AGENTS.md — obowiązują)

- Kolory: 70% powierzchnie (`#14161a`, `#1c1f26`), 20% tekst (`#e7e9ee`, `#8d95a5`),
  10% akcent (`#4da3ff`) — tylko akcja główna i aktywna zakładka.
- Zielony `#6fcf8b` wyłącznie semantycznie (sukces). Pomarańczowy `#ffb454` wyłącznie ostrzeżenie.
- Nigdy dwa konkurujące akcenty na jednym ekranie.
- Jedna akcja główna na ekranie.
- Brak marketingowych tagline'ów w UI produktu; realne nazwy i liczby.
- Każdy stan (pusty, błąd, gotowe) renderuje się bez ślepego zaułka.

---

## 6. Czego świadomie nie przenosimy

- Nazwa „Support Fins”, logo (trójkąt), identyfikatory wizualne marki.
- Własne ikony i ilustracje PrintFins (favicon, gify, printy kalibracyjne).
- Teksty, tutoriale, sekcja „What's new”, kalibracja, wtyczki slicerów, wielojęzyczność.
- Biblioteki vendorowane (`manifold-3d`, `occt-import-js`, `three-mesh-bvh`) — RoundEdge ma własną
  topologię i nie potrzebuje importu STEP/3MF.
