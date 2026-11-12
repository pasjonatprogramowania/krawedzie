# RoundEdge — specyfikacja przebudowy GUI (wzorzec PrintFins)

Status: specyfikacja do wdrożenia. Wzorzec: `docs/design/printfins-reference.md` (pomiar 2026-11-12).
Zakres: wyłącznie warstwa UI (`src/**`, `tailwind.config.js`, `scripts/ssr-smoke.mjs`, `tests/ui.test.ts`).
Logika siatki (`src/utils/**`) nietknięta poza nowym modułem `src/utils/printParams.ts`.

---

## 0. Zasady nadrzędne

1. **Jeden akcent.** Niebieski `#4da3ff` = akcja główna + focus + aktywna zakładka. Nigdy dwa konkurujące akcenty.
2. **Kolor semantyczny ≠ akcent.** `#ff6b4a` = zaznaczona krawędź, `#7c5cff` = wykryta automatycznie,
   `#ffd043` = pod kursorem, `#6fcf8b` = sukces, `#ffb454` = ostrzeżenie — trzy osobne rodziny.
3. **Pełnoekranowy viewport** (canvas 3D pod szynami), **klik w lukę = orbita** (szyny `pointer-events: none`,
   karty `pointer-events: auto`), **jeden komponent = jedna sekcja ekranu** (≤ 150 linii), zero marketingu w UI.

---

## 1. Tokeny

### 1.1 `tailwind.config.js` — `theme.extend`

```js
screens: { wide: '900px' },          // >= 900 px = układ desktopowy; niżej = sheet
colors: {
  surface: { base: '#14161a', panel: '#1c1f26', raised: '#232731', viewport: '#101216' },
  line:    { DEFAULT: '#2c313b', strong: '#454d5c' },
  txt:     { DEFAULT: '#e7e9ee', dim: '#8d95a5', faint: '#5d6573' },
  accent:  { DEFAULT: '#4da3ff', hover: '#6fb4ff' },
  btn:     { DEFAULT: '#2a303a', hover: '#333a46' },
  edge:    { selected: '#ff6b4a', auto: '#7c5cff', hover: '#ffd043' },
  warn:    '#ffb454',
  error:   '#ff6b6b',
  ok:      '#6fcf8b',
},
borderRadius: { panel: '8px', bar: '9px', chip: '3px' },
boxShadow: {
  card:  '0 1px 2px rgb(0 0 0 / 0.28)',
  glass: 'inset 0 1px 0 rgb(255 255 255 / 0.06), 0 4px 18px rgb(0 0 0 / 0.28)',
  focus: '0 0 0 2px #14161a, 0 0 0 4px #4da3ff',
},
fontFamily: {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
  mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
},
```

**Usunięte nazwy (nie mogą wrócić):** `bg.bg-dark`, `bg.bg-card`, `bg.bg-panel`, `bg.bg-hover`,
`accent.teal`, `accent.orange`, `accent.purple`, `accent.yellow`, `accent.green`,
`shadow.glow-teal`, `shadow.glow-orange`, `shadow.glow-purple`.

**Klasy Tailwind po przebudowie** (komplet; inne są niedozwolone):

| Zastosowanie | Klasy |
|---|---|
| Tła | `bg-surface-base` `bg-surface-panel` `bg-surface-raised` `bg-surface-viewport` + warianty `/85` `/70` `/10` `/5` |
| Obramowania | `border-line` `border-line-strong` `border-line/50` `border-white/10` |
| Tekst | `text-txt` `text-txt-dim` `text-txt-faint` |
| Akcent | `bg-accent` `text-accent` `border-accent` `bg-accent-hover` `text-accent-hover` `bg-accent/10` `bg-accent/15` |
| Przyciski | `bg-btn` `bg-btn-hover` `border-line-strong` |
| Krawędzie | `text-edge-selected` `text-edge-auto` `text-edge-hover` `bg-edge-selected/10` `border-edge-selected/30` |
| Semantyka | `text-warn` `bg-warn/10` `border-warn/30` `text-error` `bg-error/10` `border-error/30` `text-ok` `bg-ok/10` `border-ok/30` |
| Kształt | `rounded` (4 px, przycisk) `rounded-md` (6 px, segment) `rounded-panel` (8 px, karta) `rounded-bar` (9 px, viewbar) `rounded-chip` (3 px) |
| Cień | `shadow-card` `shadow-glass` `shadow-focus` |

### 1.2 `src/index.css` — `:root` (custom properties)

```css
:root {
  color-scheme: dark;
  --topbar-h: 52px;  --rail-gap: 14px;
  --bg: #14161a;  --panel: #1c1f26;  --raised: #232731;  --viewport: #101216;
  --line: #2c313b;  --line-strong: #454d5c;
  --text: #e7e9ee;  --dim: #8d95a5;  --faint: #5d6573;
  --accent: #4da3ff;  --accent-hover: #6fb4ff;
  --btn: #2a303a;  --btn-hi: #333a46;  --btn-line: #454d5c;
  --edge-selected: #ff6b4a;  --edge-auto: #7c5cff;  --edge-hover: #ffd043;
  --warn: #ffb454;  --error: #ff6b6b;  --ok: #6fcf8b;
}
```

**Reguła jednego źródła:** hexy w `tailwind.config.js` i w `:root` muszą być identyczne — pilnuje tego
test statyczny T-06 (§11.2).

### 1.3 `src/index.css` — poza `:root`

**Do usunięcia** (przestarzałe wobec tokenów): `.glass-panel`, `.glass-card`, `.glass-card:hover`,
`@keyframes pulse-glow`, `.pulse-teal-glow`, `.light body`, `.light ::-webkit-scrollbar-*` ×3,
`.theme-text-primary`, `.theme-text-secondary`, `.theme-text-muted`, `.theme-text-warning`,
`.theme-bg-panel`, `.theme-bg-card`, `.theme-border`, `.theme-table-header`, `.theme-preset-btn`
(wraz z wariantami `.light`).

**Do dodania:**

```css
body { margin: 0; background: var(--bg); color: var(--text); overflow: hidden; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--btn-line); }

/* Suwak (nie da się tego zrobić w Tailwind) */
.re-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 3px; background: var(--line); cursor: pointer; }
.re-range:disabled { opacity: .45; cursor: not-allowed; }
.re-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--dim); border: 2px solid var(--btn-line); cursor: pointer; }
.re-range:focus-visible::-webkit-slider-thumb { background: var(--accent); }
.re-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--dim); border: 2px solid var(--btn-line); cursor: pointer; }
.re-range:focus-visible::-moz-range-thumb { background: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```

`body` przestaje przewijać dokument (dziś `overflow-x: hidden`) — przy pełnoekranowym viewportie
przewijanie strony jest błędem.

### 1.4 `src/utils/printParams.ts` (nowy) — parametry druku

Jedyny moduł z liczbami druku; importowany przez UI **i** przez testy (`.ts`, nie `.tsx`).

```ts
export const NOZZLE_OPTIONS_MM = [0.2, 0.25, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0] as const;
export const DEFAULT_NOZZLE_MM = 0.4;
export const PRINT_MIN_FILLER_FACTOR = 2;    // fillet:  r >= 2 × dysza
export const PRINT_MIN_CHAMFER_FACTOR = 1;   // ścięcie: r >= 1 × dysza
export const PRINT_TOLERANCE_MM = 0.1;       // tolerancja gabarytu (było App.tsx:34)
export const RADIUS_MAX_MM = 5;
export const RADIUS_STEP_MM = 0.05;
export const DEFAULT_RADIUS_MM = 0.8;        // = 2 × DEFAULT_NOZZLE_MM
export type RoundingKind = 'fillet' | 'chamfer';
export type PrintPresetId = 'safe' | 'strong' | 'chamfer' | 'custom';
export interface PrintPreset { id: PrintPresetId; label: string; kind: RoundingKind; radiusMm: number | null; segments: number; tip: string; }
export const PRINT_PRESETS: readonly PrintPreset[] = [ /* tabela w §5.4 */ ];
export function minRadiusMm(nozzleMm: number, kind: RoundingKind): number {
  return kind === 'fillet' ? PRINT_MIN_FILLER_FACTOR * nozzleMm : PRINT_MIN_CHAMFER_FACTOR * nozzleMm;
}
export function fmtMm(v: number, digits = 2): string { return v.toFixed(digits).replace('.', ','); } // "0,80"
```

**Pochodzenie istniejących stałych:** `NOZZLE_MM = 0.4` (`App.tsx:32`) → `DEFAULT_NOZZLE_MM`;
`MIN_VISIBLE_RADIUS_MM = 0.3` (`App.tsx:33`) → **usunięta**, nadpisana regułą `2 × dysza` (0,8 mm > 0,3 mm,
a 0,3 mm nie jest minimum dla żadnej dyszy z listy); `PRINT_TOLERANCE_MM = 0.1` (`App.tsx:34`) → bez zmian
(używana w StatusCard przy kontroli Δ bbox).


## 2. Drzewo komponentów

```
src/App.tsx                          stan + kompozycja (~270 linii)
├── components/TopBar.tsx            pasek górny 52 px
├── components/StatsRail.tsx         lewa szyna: karta „Plik" + „Diagnostyka druku"
├── components/OptionsRail.tsx       prawa szyna: kontener kart
│   ├── components/EdgeCard.tsx      karta „Krawędzie"
│   └── components/ParamsCard.tsx    karta „Parametry"
├── components/StatusCard.tsx        karta „Wynik" (tabela przed/po + kontrola + ostrzeżenia)
├── components/ViewBar.tsx           szklany pasek widoku (lewy dolny róg)
├── components/HeroCard.tsx          pusty stan (karta środkowa + przyciski demo)
├── components/Toasts.tsx            powiadomienia
└── components/ThreeViewer.tsx       canvas three.js (modyfikowany, nie dzielony)
```

Wspólne prymitywy (`src/components/ui/`): `Card.tsx`, `Tooltip.tsx` (łączy obecne `Tip` + `TipIcon`),
`Segmented.tsx`, `Slider.tsx`, `DiagRow.tsx`. Hook: `src/hooks/useMediaQuery.ts` (~12 linii, guard `typeof window` pod SSR).

### 2.1 Propsy — verbatim

```ts
// src/components/TopBar.tsx
export interface TopBarProps {
  fileName: string | null;
  nozzleMm: number;            onNozzleChange: (mm: number) => void;
  radiusMm: number;            radiusKind: RoundingKind;
  radiusMinMm: number;         radiusMaxMm: number;
  onRadiusChange: (mm: number) => void;
  onImportClick: () => void;   onExportStl: () => void;   onExportObj: () => void;
  onReset: () => void;         onSelectAll: () => void;   onClearSelection: () => void;
  hasResult: boolean;
}
```

```ts
// src/components/StatsRail.tsx
export interface StatsRailProps {
  file: File | null;  diagnostics: MeshDiagnostics | null;  warnings: string[];
}
```

```ts
// src/components/OptionsRail.tsx
export interface OptionsRailProps {
  sharpThresholdDeg: number;   onSharpThresholdChange: (deg: number) => void;
  sharpEdgeCount: number;      selectedCount: number;      hoveredEdge: number | null;
  onSelectSharp: () => void;   onSelectAll: () => void;    onClear: () => void;
  showAllEdges: boolean;       onShowAllEdgesChange: (value: boolean) => void;
  kind: RoundingKind;          onKindChange: (kind: RoundingKind) => void;
  segments: number;            onSegmentsChange: (segments: number) => void;
  presetId: PrintPresetId;     onPresetChange: (id: PrintPresetId) => void;
  nozzleMm: number;            busy: boolean;
}
```

```ts
// src/components/EdgeCard.tsx
export interface EdgeCardProps {
  sharpThresholdDeg: number;   onSharpThresholdChange: (deg: number) => void;
  sharpEdgeCount: number;      selectedCount: number;      hoveredEdge: number | null;
  onSelectSharp: () => void;   onSelectAll: () => void;    onClear: () => void;
  showAllEdges: boolean;       onShowAllEdgesChange: (value: boolean) => void;
}
```

```ts
// src/components/ParamsCard.tsx
export interface ParamsCardProps {
  kind: RoundingKind;          onKindChange: (kind: RoundingKind) => void;
  segments: number;            onSegmentsChange: (segments: number) => void;
  presetId: PrintPresetId;     onPresetChange: (id: PrintPresetId) => void;
  nozzleMm: number;            busy: boolean;
}
```

```ts
// src/components/StatusCard.tsx
export interface StatusCardProps {
  diagnostics: MeshDiagnostics | null;  result: RoundingResult | null;  warnings: string[];
}
```

```ts
// src/components/ViewBar.tsx
export interface ViewBarProps {
  selectedCount: number; hoveredEdge: number | null;
  compareMode: 'before' | 'after' | 'overlay';
  onCompareModeChange: (mode: 'before' | 'after' | 'overlay') => void;
  hasResult: boolean;
}
```

```ts
// src/components/HeroCard.tsx
export interface HeroCardProps { onLoadDemo: (path: string, name: string) => void; }
```

```ts
// src/components/Toasts.tsx
export interface ToastItem { id: number; kind: 'info' | 'warn' | 'ok'; text: string; }
export interface ToastsProps { toasts: ToastItem[]; onDismiss: (id: number) => void; }
```

```ts
// src/components/ui/Card.tsx
export interface CardProps {
  title?: string; badge?: React.ReactNode; children: React.ReactNode; className?: string;
}
```

```ts
// src/components/ui/Tooltip.tsx
export interface TooltipProps { text: string; children: React.ReactNode; side?: 'top' | 'bottom' | 'right'; }
export function TipIcon(props: { text: string }): React.ReactElement;
```

```ts
// src/components/ui/Segmented.tsx
export interface SegmentedOption<T extends string> { value: T; label: string; title?: string; }
export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;  value: T;
  onChange: (value: T) => void;  ariaLabel: string;  className?: string;
}
```

```ts
// src/components/ui/Slider.tsx
export interface SliderProps {
  label: string;  value: number;  min: number;  max: number;  step: number;
  onChange: (value: number) => void;  readout?: string;
  readoutTone?: 'default' | 'warn';  ariaLabel: string;  hint?: string;  disabled?: boolean;
}
```

```ts
// src/components/ui/DiagRow.tsx
export interface DiagRowProps { label: string; ok: boolean; detail: string; tip?: string; }
```

### 2.2 Odpowiedzialności

| Komponent | Odpowiedzialność | Nie robi |
|---|---|---|
| `App.tsx` | stan globalny, wczytywanie pliku, obliczanie zaokrąglenia, eksport, kompozycja | nie zawiera JSX kart |
| `TopBar` | marka, Import, Dysza, Promień, Pobierz STL, menu `⋯` | nie zna siatki |
| `StatsRail` | dane pliku + diagnostyka druku | nie renderuje w pustym stanie |
| `OptionsRail` | kontener: `EdgeCard` + `ParamsCard` | nie ma własnego stanu |
| `EdgeCard` | próg ostrości, auto-detekcja, zaznacz/wyczyść, siatka | nie zna promienia |
| `ParamsCard` | preset, fillet/chamfer, segmenty, stan „przeliczanie" | nie zawiera suwaka promienia (jest w TopBar) |
| `StatusCard` | tabela przed/po, kontrola geometrii, ostrzeżenia | nie generuje ostrzeżeń (dostaje je z propsów) |
| `ViewBar` | licznik krawędzi, tryb porównania, podpowiedź myszy | nie steruje kamerą |
| `HeroCard` | pusty stan + demo | nie zawiera inputu pliku |
| `Toasts` | lista powiadomień | nie tworzy powiadomień |
| `ui/*` | prezentacja, bez stanu aplikacji | — |


## 3. Layout

### 3.1 Desktop (≥ 900 px)

Kontener: `relative h-screen w-full overflow-hidden bg-surface-base text-txt`.

| Region | Pozycja / rozmiar | z | Overflow | pointer-events | Klasy |
|---|---|---|---|---|---|
| `#viewport` | `absolute inset-0` | 0 | `hidden` | auto | `absolute inset-0 z-0 bg-surface-viewport` |
| `#topbar` | `absolute top-0 inset-x-0 h-[52px]` | 40 | widoczny | auto | `absolute top-0 inset-x-0 z-40 flex h-[52px] items-center gap-3 border-b border-line bg-surface-base/85 px-3 backdrop-blur-md` |
| `#left-rail` | `absolute left-[14px] top-[52px] bottom-[14px] w-[260px] xl:w-[272px]` | 30 | `y-auto` | `none` (karty `auto`) | `absolute left-[14px] top-[52px] bottom-[14px] z-30 flex w-[260px] flex-col gap-3 overflow-y-auto pointer-events-none xl:w-[272px]` |
| `#right-rail` | `absolute right-[14px] top-[52px] bottom-[14px] w-[260px] xl:w-[300px]` | 30 | `y-auto` | `none` (karty `auto`) | `absolute right-[14px] top-[52px] bottom-[14px] z-30 flex w-[260px] flex-col gap-3 overflow-y-auto pointer-events-none xl:w-[300px]` |
| `#viewbar` | `absolute bottom-[14px] left-[14px]` | 30 | widoczny | auto | `absolute bottom-[14px] left-[14px] z-30 flex items-center gap-2 rounded-bar border border-white/10 bg-surface-panel/70 px-2 py-1.5 backdrop-blur-md shadow-glass` |
| `#hero` | `absolute inset-0` | 20 | widoczny | `none` (karta `auto`) | `absolute inset-0 z-20 grid place-items-center px-6 pointer-events-none` |
| `#toasts` | `absolute bottom-[14px] right-[14px] w-[320px]` | 50 | widoczny | `none` (toast `auto`) | `absolute bottom-[14px] right-[14px] z-50 flex w-[320px] max-w-[calc(100vw-28px)] flex-col gap-2 pointer-events-none` |

**Karta** (`.re-card`): `rounded-panel border border-line bg-surface-panel/85 p-3 shadow-card backdrop-blur-[6px] pointer-events-auto`.

**Warianty przycisków:**

| Wariant | Klasy |
|---|---|
| domyślny | `inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-btn px-3 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover` |
| akcent (główny) | j.w. + `bg-accent border-transparent font-semibold text-surface-base hover:bg-accent-hover` |
| ikona | `grid h-8 w-8 place-items-center rounded border border-line-strong bg-btn text-txt-dim hover:bg-btn-hover hover:text-txt` |
| segment (przełącznik) | `h-7 rounded-md px-2.5 text-[12px] font-medium text-txt-dim hover:text-txt` + aktywny `bg-surface-raised text-txt` |
| pole select | `h-8 rounded border border-line-strong bg-btn px-2 text-[12px] text-txt` |

**Topbar — grupy (desktop):**

```
[■ RoundEdge v2.0]  …(ml-auto)…  [Import] [Dysza ▾] [Promień —●— 0,80 mm] [Pobierz STL] [⋯]
```

- Marka: `grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-surface-base`
  + wordmark `text-[13px] font-semibold text-txt` + `text-[11px] font-mono text-txt-dim` → „v2.0".
- Import: przycisk domyślny; **w stanie pustym przyjmuje wariant akcent** (jedyne akcentowe CTA ekranu).
- Dysza: etykieta `text-[11px] text-txt-dim` „Dysza" + `<select class="…">` z 11 opcjami (§5.1).
- Promień: etykieta `text-[11px] text-txt-dim` + `input.re-range w-24` + odczyt
  `w-16 text-right font-mono text-[12px] tabular-nums text-txt` → „0,80 mm"; pod etykietą zawsze
  `text-[10px] text-txt-faint` → „Minimum dla dyszy 0,40 mm: 0,80 mm".
- Pobierz STL: przycisk akcent; `title` zależny od stanu (§4 poz. 22).
- `⋯`: przycisk ikona, `aria-haspopup="menu"`, `aria-expanded`, `aria-label="Więcej opcji"`.
  Menu: `Pobierz OBJ` · `Wczytaj inny plik` · `Zaznacz wszystkie krawędzie` · `Wyczyść zaznaczenie`
  · separator · `Pomoc (skróty)`. Zamykanie: `Escape`, klik poza, wybór pozycji.

**Right rail:** `EdgeCard` i `ParamsCard` u góry, `StatusCard` na dołu (przypięty przez `mt-auto`;
przy braku miejsca przewija się razem z szyną). **Left rail:** karta „Plik" u góry, „Diagnostyka druku" pod nią.

### 3.2 Wąski układ (< 900 px)

`useMediaQuery('(min-width: 900px)')` → `isWide`.

- **Viewport** zajmuje całe okno (bez zmian).
- **Topbar** zawija się na dwa wiersze: `flex-wrap h-auto min-h-[52px] py-2`.
  Wiersz 1: marka + `⋯`. Wiersz 2: `Dysza` (select `w-20`) + `Promień` (slider `flex-1`)
  + `Pobierz STL` (ikona + skrót „STL").
- **Szyny znikają z bocznych pozycji** i stają się **bottom sheetem**:
  `fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-panel border-t border-line bg-surface-panel/95 backdrop-blur-md`.
  Nagłówek: zakładki `Statystyki` / `Parametry` / `Wynik` + przycisk `Zamknij`
  (ikona `X`, `aria-label="Zamknij panel"`). Domyślnie otwarta zakładka: `Parametry`.
  Zamknięcie = zwinięcie do paska zakładek (ekran nigdy nie zostaje bez wyjścia).
- **Viewbar** przesuwa się nad sheet: `bottom-[72px]`, podpowiedź myszy ukryta.
- **Toasty** przesuwa się nad sheet: `bottom-[72px]`.


## 4. Mapa interakcji

| # | Kontrolka obecna (źródło) | Nowe miejsce | Etykieta PL | Stan / uwagi |
|---|---|---|---|---|
| 1 | Import pliku — `App.tsx:487` | TopBar (`Import`) + drag&drop na całym oknie (`App.tsx:181-195`) | `Import` | Akcent tylko w stanie pustym; po załadowaniu → `Wczytaj inny plik` w menu `⋯` |
| 2 | Demo kostka — `App.tsx:507` | HeroCard, pod kartą | `Kostka 20 mm` | przycisk domyślny |
| 3 | Demo pranie — `App.tsx:515` | HeroCard, pod kartą | `Pranie (trudny)` | przycisk domyślny |
| 4 | Wskaźnik kroków „1./2." — `App.tsx:433-441` | **usunięty** | — | Topbar nie jest wizardem |
| 5 | Przełącznik motywu — `App.tsx:442-452` | **usunięty** (§9) | — | brak `.light` w całym `src/` |
| 6 | Podsumowanie pliku — `App.tsx:529-552` | StatsRail → karta „Plik" | `Plik` | bez zmian merytorycznie |
| 7 | Diagnostyka druku (4 wiersze) — `App.tsx:557-582` | StatsRail → karta „Diagnostyka druku" | `Diagnostyka druku` | `DiagRow` z `ui/` |
| 8 | Ostrzeżenia siatki — `App.tsx:338-339` | StatsRail (lista) + toast | jak dziś | przestaje zasypywać toastami |
| 9 | Próg kąta ostrego — `App.tsx:600-606` | EdgeCard | `Próg kąta ostrego` | 5–90°, krok 5; odczyt `30° (12 kraw.)`; **tylko do selekcji i rysowania, nie do algorytmu** (`flatAngleDeg` nie jest przekazywane — `App.tsx:256-261`) |
| 10 | `Ostre krawędzie` — `App.tsx:612-616` | EdgeCard | `Ostre krawędzie` | ikona `Sparkles` w `text-edge-auto` |
| 11 | `Wszystkie` — `App.tsx:620-624` | EdgeCard | `Wszystkie` | ikona `Check` |
| 12 | `Wyczyść zaznaczenie (N)` — `App.tsx:629-635` | EdgeCard | `Wyczyść zaznaczenie (24)` | `disabled` gdy `selectedCount === 0` |
| 13 | `Pokaż wszystkie krawędzie siatki` — `App.tsx:641-649` | EdgeCard | `Pokaż wszystkie krawędzie siatki` | checkbox, `accent-accent` |
| 14 | Presety (4) — `App.tsx:660-663` | ParamsCard | `Bezpieczne` / `Wytrzymałe` / `Ścięcie 45°` / `Własne` | siatka 2×2; `Własne` to stan, nie preset |
| 15 | Fillet/chamfer — `App.tsx:670-691` | ParamsCard | `Zaokrąglenie` / `Ścięcie` | `Segmented`, `aria-pressed` |
| 16 | Suwak promienia — `App.tsx:702-708` | **TopBar** | `Promień` (fillet) / `Szerokość ścięcia` (chamfer) | odczyt `0,80 mm`; min = 2×dysza (fillet) / 1×dysza (ścięcie) |
| 17 | Suwak segmentów — `App.tsx:720-726` | ParamsCard | `Gładkość (segmenty łuku)` | 1–12; tylko dla filleta |
| 18 | Wskaźnik „Przeliczanie" — `App.tsx:731-735` | ParamsCard | `Przeliczanie zaokrąglenia…` | `RefreshCw` przestaje się kręcić przy `prefers-reduced-motion` |
| 19 | Tabela przed/po — `App.tsx:742-761` | StatusCard | `Wynik` | nagłówek `Metryka | Przed | Po` |
| 20 | Diagnostyka wyniku (4 wiersze) — `App.tsx:763-778` | StatusCard | `Kontrola geometrii` | bez zmian |
| 21 | „Maks. przesunięcie" — `App.tsx:758` | StatusCard (wiersz tabeli) | `Maks. przesunięcie` | **readout, nie kontrolka** — `RoundingOptions.maxDisplacement` (`meshTypes.ts:114`) celowo nie jest wystawione w UI |
| 22 | Eksport STL — `App.tsx:786-790` | TopBar (główna akcja) | `Pobierz STL` | akcent; `title` = „Pobierze model zaokrąglony" / „Pobierze oryginał — brak zaznaczonych krawędzi" |
| 23 | Eksport OBJ — `App.tsx:793-798` | TopBar → menu `⋯` | `Pobierz OBJ` | wtórne |
| 24 | `Wczytaj inny plik` — `App.tsx:802-806` | TopBar → menu `⋯` | `Wczytaj inny plik` | wtórne |
| 25 | Licznik krawędzi — `App.tsx:843-847` | ViewBar | `Zaznaczone: 24` | liczba w `text-edge-selected`; hover `#123` w `text-edge-hover` |
| 26 | Tryb porównania — `App.tsx:849-869` | ViewBar (`Segmented`) | `Przed` / `Po` / `Porównanie` | widoczny tylko gdy `hasResult` |
| 27 | Podpowiedź myszy — `ThreeViewer.tsx:342-348` | ViewBar | `LPM zaznacz · przeciągnij obrót · scroll zoom` | `hidden lg:inline`; overlay znika z viewera |
| 28 | Toasty — `App.tsx:876-908` | Toasts | — | 4 strumienie zamiast 5 (§4.1) |

### 4.1 Kanały komunikatów (zmiana)

| Kanał | Zawartość |
|---|---|
| **Toast `ok`** | wczytanie pliku (`App.tsx:345-348`), wynik zaokrąglenia (`App.tsx:356-358`), zapis pliku (nowe), korekta promienia po zmianie dyszy (nowe) |
| **Toast `warn`** | błąd wczytania (`App.tsx:98,135,139,144,159`), błąd przetwarzania (`App.tsx:264`) |
| **StatusCard (trwałe)** | `result.report.warnings`, W1–W3 z §5.5, `diagnostics.warnings` |
| **StatsRail (trwałe)** | diagnostyka druku |

Efekt uboczny: `printHints` (`App.tsx:292-334`) przestają być toastami — zostają trwałymi ostrzeżeniami
w StatusCard (wymóg wzorca: „ostrzeżenia jako `.over-warn`", `printfins-reference.md:156`).


## 5. Nowe kontrolki drukowalności

### 5.1 „Dysza" (topbar)

`<select aria-label="Średnica dyszy">` — dokładnie 11 wartości (identyczny zestaw jak w PrintFins):

`0,2 mm` · `0,25 mm` · `0,4 mm` · `0,6 mm` · `0,8 mm` · `1,0 mm` · `1,2 mm` · `1,4 mm` · `1,6 mm` · `1,8 mm` · `2,0 mm`

- Domyślnie: **0,4 mm** (`DEFAULT_NOZZLE_MM`). Format: przecinek dziesiętny (`fmtMm`), jednostka `mm` w każdej opcji.
- Zmiana dyszy **nie resetuje** selekcji ani wyniku; podnosi promień do nowego minimum (§5.3).

### 5.2 „Promień" (topbar)

- Suwak `input.re-range`, zakres `min = minRadiusMm(nozzle, kind)`, `max = 5`, `step = 0,05`.
- Etykieta zależna od trybu: `Promień` (fillet) / `Szerokość ścięcia` (chamfer).
- Odczyt: `0,80 mm` (`font-mono`, `tabular-nums`). Domyślnie: **0,80 mm** = 2 × 0,4 mm.
- Pod etykietą zawsze: `Minimum dla dyszy 0,40 mm: 0,80 mm`.
- Wartością zarządza **wyłącznie** ten suwak — nie dubluje się jej w ParamsCard.

### 5.3 Reguła minimum

```
minRadiusMm(nozzle, 'fillet')  = 2 × nozzle     // łuk musi mieścić dwie szerokości dyszy
minRadiusMm(nozzle, 'chamfer') = 1 × nozzle     // ramię ścięcia = jedna szerokość dyszy
```

1. **Minimum suwaka jest twarde** — użytkownik nie może przeciągnąć promienia poniżej minimum.
2. **Zmiana dyszy lub trybu** podnosi promień do nowego minimum; gdy wartość faktycznie wzrośnie,
   leci toast `warn`: `Promień podniesiony do 1,60 mm — minimum dla dyszy 0,80 mm.`
3. **Preset poniżej minimum jest niedostępny** (`disabled` + tooltip):
   `Preset „Bezpieczne” (0,80 mm) jest poniżej minimum dla dyszy 2,00 mm (4,00 mm).`
4. **Presety są wartościami bezwzględnymi** (nie mnożnikami dyszy), żeby tabela nie rozjeżdżała się
   przy zmianie dyszy; niedostępność opisuje punkt 3.

### 5.4 Tabela presetów (`PRINT_PRESETS`)

| id | Etykieta | Typ | Promień | Segmenty | Tooltip |
|---|---|---|---|---|---|
| `safe` | `Bezpieczne` | fillet | 0,80 mm | 3 | „Dwie szerokości dyszy — subtelne, ale widoczne złagodzenie krawędzi.” |
| `strong` | `Wytrzymałe` | fillet | 1,60 mm | 5 | „Mniejsza koncentracja naprężeń w narożnikach; zużywa więcej materiału.” |
| `chamfer` | `Ścięcie 45°` | chamfer | 0,80 mm | 1 | „Płaskie ścięcie zamiast łuku — przewidywalne przy krawędziach opierających się o stół.” |
| `custom` | `Własne` | — | — | — | „Pełna kontrola: typ, promień i liczba segmentów.” |

**Zmiana względem dziś** (`App.tsx:82-84`): `Bezpieczne` 0,40 → 0,80 mm; `Wytrzymałe` 1,00 → 1,60 mm;
`Ścięcie 45°` 0,60 → 0,80 mm. Powód: przy dyszy 0,4 mm wartości sprzed 0,8 mm są poniżej nowego minimum,
czyli byłyby nieosiągalne przez suwak.

### 5.5 Teksty ostrzeżeń (PL)

| Id | Warunek | Tekst | Miejsce |
|---|---|---|---|
| W1 | `result.report.effectiveRadius < minRadiusMm(nozzle, kind)` | `Promień efektywny 0,35 mm jest poniżej minimum 0,80 mm dla dyszy 0,40 mm — siatka w tym miejscu jest zbyt rzadka, żeby odtworzyć łuk.` | StatusCard |
| W2 | `chordDeviation > 0.05 && bandFacetSize <= 2 * effectiveRadius` | `Teoretyczna odchyłka łuku 0,062 mm — zwiększ liczbę segmentów.` | StatusCard (z `App.tsx:315`) |
| W3 | `bandFacetSize > 2 * effectiveRadius` | `Rozdzielczość pasa 1,20 mm jest większa niż 2 × promień — o gładkości łuku decyduje siatka modelu, a nie liczba segmentów.` | StatusCard |
| — | zawsze pod suwakiem | `Minimum dla dyszy 0,40 mm: 0,80 mm` | TopBar |

Każde ostrzeżenie ma ikonę `AlertTriangle` w `text-warn` i jest elementem listy, nie toastem.


## 6. Pusty stan (HeroCard)

Karta środkowa z przerywaną ramką (`border-dashed border-line-strong`), maks. szerokość 420 px,
wyśrodkowana w viewportcie (nie w szynie). Pod kartą — dwa przyciski demo.

**Treść karty (kolejność wizualna):**

1. Ikona `Upload` 28 px w kółku `bg-accent/10 text-accent`.
2. Nagłówek (17 px, semibold): **„Zaokrągl narożniki przed drukiem”**
3. Podtytuł (13 px, `text-txt-dim`):
   **„Wgraj model 3D (STL / OBJ / 3MF), zaznacz krawędzie i pobierz gotowy plik.”**
4. Lista numerowana (13 px, `text-txt-dim`, wyrównanie do lewej):
   1. **Wgraj** — upuść plik w okno przeglądarki.
   2. **Zaznacz** — kliknij krawędź w podglądzie 3D.
   3. **Pobierz** — zaokrąglone narożniki drukują się lepiej.
5. Notka (11 px, `text-txt-faint`):
   **„Wszystkie obliczenia lokalnie w przeglądarce — plik nie opuszcza komputera.”**

**Pod kartą:** `Kostka 20 mm` · `Pranie (trudny)` (przyciski domyślne, ikona `Sparkles` 14 px).

**Nie ma w karcie:** przycisku „Wgraj plik" (import jest w topbarze — jeden punkt wejścia), strefy
drag&drop (upuszczanie działa na całym oknie) oraz nagłówka „Rozpocznij tutaj" (`App.tsx:469`).


## 7. Tryb jasny — decyzja: **USUNĄĆ**

**Rekomendacja: usunąć przełącznik motywu i całą gałąź `.light`.**

1. **Wzorzec referencyjny jest ciemny.** `printfins-reference.md` (§1) mierzy wyłącznie ciemny zestaw
   tokenów; brak motywu jasnego w PrintFins i w `gittrahan/support-fins`. „Wygląd jak PrintFins" = ciemny interfejs.
2. **Koszt podtrzymania rośnie.** Dziś motyw przebija 10 klas `.theme-*` + 11 reguł `.light`
   w `src/index.css` (73-165), ~20 ternariów `theme === 'dark' ? … : …` w `src/App.tsx`
   (397, 408-425, 434-451, 457, 462, 482, 495, 604, 673, 685, 706, 724, 815, 885) oraz 4 gałęzie kolorów
   w `ThreeViewer.tsx` (136, 190, 235-238).
3. **Viewport 3D wymaga osobnej palety.** Materiał siatki, kolor gruntu i 4 kolory krawędzi
   (`ThreeViewer.tsx:135-138, 190, 235-238`) musiałyby mieć wariant jasny — to osobny zestaw w WebGL,
   niewidoczny w przeglądarce stylów.
4. **Nowa architektura tokenów znosi ten koszt na przyszłość.** Po przebudowie wszystkie kolory pochodzą
   z jednego zestawu zmiennych CSS, więc motyw jasny staje się ~12 liniami w `index.css`
   (`[data-theme='light'] { --bg: …; --panel: …; … }`) — bez dotykania komponentów. **Nie ma powodu płacić
   za niego teraz**; powrót to osobna funkcja z osobną paletą i osobnymi testami.

**Lista miejsc do zmiany przy usuwaniu:**

| Plik / miejsce | Zmiana |
|---|---|
| `src/App.tsx:51` | usunąć `const [theme, setTheme] = useState<'dark' \| 'light'>('dark')` |
| `src/App.tsx:396-404` | usunąć ternarz tła + dwie „świetlne plamy" (`bg-accent-teal/5`, `bg-accent-purple/5`) |
| `src/App.tsx:407-411` | usunąć ternarz nagłówka |
| `src/App.tsx:412-453` | usunąć ternarze marki, wskaźnika kroków i przycisku motywu (442-452) |
| `src/App.tsx:456-458` | usunąć ternarz `<main>` |
| `src/App.tsx:461-465` | usunąć ternarz lewej szyny |
| `src/App.tsx:482-484, 495` | usunąć ternarze strefy drop (strefa drop znika) |
| `src/App.tsx:604, 673, 685, 706, 724` | usunąć ternarze klas suwaków i przycisków trybu |
| `src/App.tsx:814-818` | usunąć ternarz gradientu sekcji 3D → `bg-surface-viewport` |
| `src/App.tsx:885-887` | usunąć ternarz koloru toastów `info` |
| `src/components/ThreeViewer.tsx:8` | usunąć prop `theme: 'dark' \| 'light'` |
| `src/components/ThreeViewer.tsx:136, 190, 235-238` | zastąpić gałęzie `theme === 'dark'` stałymi kolorami tokenów |
| `src/index.css:73-88` | usunąć `.light body` i `.light ::-webkit-scrollbar-*` |
| `src/index.css:91-165` | usunąć wszystkie `.theme-*` i `.light .theme-*` |
| `src/index.css:9` | `color-scheme: dark` zostaje (jedyny tryb) |
| `index.html:6` | `<meta name="color-scheme" content="dark" />` zostaje |


## 8. Dostępność i klawiatura

| Obszar | Wymaganie |
|---|---|
| Focus | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base`; na karcie offset `ring-offset-surface-panel` |
| Przełączniki | `aria-pressed` na `Segmented`; `Pokaż wszystkie krawędzie` to natywny `checkbox` z `accent-accent` |
| Przyciski ikoniczne | każdy ma `aria-label` (`Więcej opcji`, `Zamknij powiadomienie`, `Zamknij panel`) |
| Suwaki | `aria-label` + `aria-valuetext` z jednostką („0,80 mm”, „30 stopni”) |
| Select | `<label>` + `aria-label="Średnica dyszy"` |
| Klawiatura | `Escape` zamyka menu `⋯` i sheet; `Enter`/`Space` aktywują natywne `<button>` |
| Live region | lista toastów `role="status" aria-live="polite"`; ostrzeżenia `role="alert"` |
| Kontrast | `#8d95a5` na `#14161a` = **6,2:1** (AA dla tekstu normalnego, nie AAA); `#e7e9ee` = 15,1:1; `#4da3ff` na `#14161a` = 7,1:1 (AAA); akcent jako tło + tekst `#14161a` = 7,1:1 |
| Kolor jako jedyny nośnik | każdy status ma też ikonę (`Check` / `AlertTriangle`) i tekst — nigdy sam kolor |
| Ruch | `prefers-reduced-motion: reduce` zeruje animacje i transitiony (§1.3); spinner `RefreshCw` przestaje się kręcić |
| Zoom | brak `user-scalable=no`; layout w `px`/`rem`, nie `vh`-zależny poza topbarem |


## 9. Lista zmian plik po pliku + kolejność

### 9.1 Pliki

| # | Plik | Akcja | Powód (1 linia) |
|---|---|---|---|
| 1 | `tailwind.config.js` | modyfikacja | nowe tokeny kolorów, promieni, cieni, czcionek, breakpoint `wide` |
| 2 | `src/index.css` | modyfikacja | `:root` z tokenami, style suwaka, `prefers-reduced-motion`, usunięcie `.light` i `.theme-*` |
| 3 | `src/utils/printParams.ts` | **nowy** | dysze, min promienia, tabela presetów, formatowanie liczb — wspólne dla UI i testów |
| 4 | `src/hooks/useMediaQuery.ts` | **nowy** | `matchMedia` z guardem SSR — wybór układu desktop/sheet |
| 5 | `src/components/ui/Card.tsx` | nowy | powtarzalna powłoka karty (6 miejsc) |
| 6 | `src/components/ui/Tooltip.tsx` | nowy | scala `Tip` (`App.tsx:944`) i `TipIcon` (`App.tsx:929`) w jedną parę eksportów |
| 7 | `src/components/ui/Segmented.tsx` | nowy | tryb zaokrąglenia + tryb porównania (2+ użycia) |
| 8 | `src/components/ui/Slider.tsx` | nowy | 3 suwaki z jednym odczytem i tonem ostrzeżenia |
| 9 | `src/components/ui/DiagRow.tsx` | nowy | 2 zestawy diagnostyki drukują tę samą strukturę |
| 10 | `src/components/TopBar.tsx` | nowy | pasek górny 52 px: marka, Import, Dysza, Promień, Pobierz STL, menu `⋯` |
| 11 | `src/components/StatsRail.tsx` | nowy | lewa szyna: dane pliku + diagnostyka druku |
| 12 | `src/components/OptionsRail.tsx` | nowy | prawa szyna jako kontener kart |
| 13 | `src/components/EdgeCard.tsx` | nowy | karta selekcji krawędzi (progi, auto-detekcja, czyszczenie) |
| 14 | `src/components/ParamsCard.tsx` | nowy | karta parametrów (preset, fillet/chamfer, segmenty) |
| 15 | `src/components/StatusCard.tsx` | nowy | wynik: tabela przed/po, kontrola geometrii, ostrzeżenia |
| 16 | `src/components/ViewBar.tsx` | nowy | szklany pasek: licznik krawędzi, tryb porównania, podpowiedź myszy |
| 17 | `src/components/HeroCard.tsx` | nowy | pusty stan: karta środkowa + przyciski demo |
| 18 | `src/components/Toasts.tsx` | nowy | powiadomienia jako osobny komponent (obecnie w App) |
| 19 | `src/App.tsx` | **przepisanie** | 1000 → ~270 linii: stan + obsługa + kompozycja |
| 20 | `src/components/ThreeViewer.tsx` | modyfikacja | bez propu `theme`; krawędzie ostre w `edge.auto`; usunięty overlay podpowiedzi |
| 21 | `src/App.css` | **usunięcie** | martwy plik (1 komentarz), nieimportowany (`main.tsx:3` importuje tylko `index.css`) |
| 22 | `tests/ui.test.ts` | modyfikacja | rozszerzony zestaw plików do odczytu + 6 nowych asercji statycznych |
| 23 | `tests/pipeline.test.ts` | modyfikacja | tabela presetów importowana z `printParams.ts` zamiast literałów (`:131-135`) |
| 24 | `scripts/ssr-smoke.mjs` | modyfikacja | 2 sprawdzenia zastąpione, 5 dodanych (§9.4) |
| 25 | `MEMORY.md` | modyfikacja (follow-up) | stałe druku i wartości presetów (`:135-139`) — do zaktualizowania po wdrożeniu |

### 9.2 Kolejność pracy (zależności)

1. `tailwind.config.js` → 2. `src/index.css` → 3. `src/utils/printParams.ts` → 4. `src/hooks/useMediaQuery.ts`
2. 5-9. `src/components/ui/*` (równolegle) → 3. 10-18. komponenty ekranu (dowolna kolejność)
3. 19. `src/App.tsx` (punkt integracji) → 4. 20. `src/components/ThreeViewer.tsx` → 5. 21. `src/App.css` (usunięcie)
4. 22-24. testy i smoke (po 19-20) → 5. 25. `MEMORY.md` (po zielonych bramkach)

### 9.3 `App.tsx` — szkielet po przebudowie

Stan (bez zmian + 2 nowe): `file`, `meshData`, `diagnostics`, `loadError`, `selectedEdges`, `hoveredEdge`,
`sharpThreshold`, `showAllEdges`, `presetId`, `roundingType`, `radius`, `segments`, **`nozzleMm` (nowe)**,
`compareMode`, `result`, `busy`, `toasts`.

Obowiązkowo zostają w `App.tsx` (wymóg `tests/ui.test.ts`): `buildMeshFromRaw`, `objectToTriangleSoup`,
`roundEdges`, `exportToSTL`, `exportToOBJ` (import z `'./utils/meshProcessing.ts'`), `handleToggleEdge`,
`selectedEdges`, oraz import `'./components/ThreeViewer.tsx'`. Nowe handlery:

```ts
const radiusMinMm = minRadiusMm(nozzleMm, roundingType);
// przy każdej zmianie dyszy lub trybu:
const clampRadius = (nextMin: number) => {
  if (radius >= nextMin) return;
  setRadius(nextMin);
  pushToast('warn', `Promień podniesiony do ${fmtMm(nextMin)} mm — minimum dla dyszy ${fmtMm(nozzleMm, 1)} mm.`);
};
```

### 9.4 `scripts/ssr-smoke.mjs` — nowe sprawdzenia

| Linia | Było | Jest |
|---|---|---|
| 44 | `nagłówek "RoundEdge"` | **bez zmian** |
| 45 | `ekran startowy "Rozpocznij tutaj"` | **`karta środkowa "Zaokrągl narożniki przed drukiem"`** |
| 46 | `viewport "Oczekiwanie na model 3D"` | **`przycisk demo "Pranie (trudny)"`** |
| 47 | `przycisk demo kostki` | **bez zmian** |
| 48 | `informacja o lokalnym przetwarzaniu` | **bez zmian** |
| — | — | **+ `selektor dyszy`**: `html.includes('Dysza')` |
| — | — | **+ `suwak promienia`**: `html.includes('Promień')` |
| — | — | **+ `przycisk eksportu`**: `html.includes('Pobierz STL')` |
| — | — | **+ `minimum promienia`**: `html.includes('Minimum dla dyszy')` |
| — | — | **+ `brak przełącznika motywu`**: `!html.includes('Przełącz na tryb jasny')` |

Render SSR to stan pusty (brak pliku) — sprawdzenia dotyczą topbaru i hero.

---

## 10. Plan testów

### 10.1 `tests/ui.test.ts` — testy istniejące

| Test | Linia | Werdykt | Działanie |
|---|---|---|---|
| „App używa wyłącznie istniejącego API biblioteki" | 21-33 | **zielony bez zmian** | 5 wywołań API zostaje w `App.tsx` (§9.3) |
| „nie ma już kłamliwej diagnostyki" | 35-40 | **wymaga rozszerzenia zbioru plików** | czytać `StatsRail.tsx` + `StatusCard.tsx`; asercje `diagnostics.isClosed`, `diagnostics.nonManifoldEdgeCount`, `flippedFaceCount` sprawdzać na konkatenacji `app + stats + status` |
| „geometria jest przebudowywana…" | 42-47 | **zielony bez zmian** | `meshToGeometry` zostaje w viewerze |
| „eksport nie centruje ani nie skaluje" | 49-52 | **zielony bez zmian** | `download()` zostaje w `App.tsx` |
| „stan zaznaczenia to zbiór krawędzi" | 54-58 | **zielony bez zmian** | `selectedEdges` + `handleToggleEdge` zostają w `App.tsx` |
| „brak martwego kodu backendu" | 60-63 | **zielony bez zmian** | bez zmian |
| „graf importów App jest kompletny" | 65-71 | **zielony bez zmian** | `App.tsx` nadal importuje `'./components/ThreeViewer.tsx'` i `'./utils/meshProcessing.ts'` z rozszerzeniami |

### 10.2 Nowe asercje statyczne (`tests/ui.test.ts`)

| Id | Asercja |
|---|---|
| T-01 | **Każdy komponent ≤ 150 linii.** Odczyt `src/components/**/*.tsx`; `split('\n').length <= 150` dla każdego pliku (komunikat z nazwą pliku i liczbą linii) |
| T-02 | **Parametry druku.** `printParams.ts` zawiera `PRINT_MIN_FILLER_FACTOR = 2`, `DEFAULT_NOZZLE_MM = 0.4`, `DEFAULT_RADIUS_MM = 0.8` oraz dokładnie 11 wartości dyszy (`0.2 … 2.0`) |
| T-03 | **Tryb tylko ciemny.** Żaden z `App.tsx`, `TopBar.tsx`, `StatsRail.tsx`, `OptionsRail.tsx`, `StatusCard.tsx`, `ViewBar.tsx`, `HeroCard.tsx`, `Toasts.tsx`, `ThreeViewer.tsx` nie zawiera `setTheme`, `'dark' | 'light'`, `theme-text-`, `theme-bg-`, `theme-border`, `theme-preset-btn`, `theme-table-header` |
| T-04 | **Dostępność.** `TopBar.tsx` zawiera `aria-label="Więcej opcji"` i `aria-haspopup`; `OptionsRail.tsx` i `ViewBar.tsx` zawierają `aria-pressed`; `HeroCard.tsx` zawiera `aria-live` dla ostrzeżeń; żaden komponent nie używa `outline-none` bez pary `focus-visible:ring` |
| T-05 | **Jedno miejsce importu.** `type="file"` występuje wyłącznie w `src/App.tsx` (z `id="model-file-input"`); `HeroCard.tsx` go nie zawiera (brak duplikatu wejścia) |
| T-06 | **Zgodność tokenów.** Wszystkie hexy z `tailwind.config.js` (`#14161a`, `#1c1f26`, `#2c313b`, `#e7e9ee`, `#8d95a5`, `#4da3ff`, `#2a303a`, `#333a46`, `#454d5c`, `#ffb454`, `#ff6b6b`, `#6fcf8b`, `#ff6b4a`, `#7c5cff`) występują w `src/index.css` |

### 10.3 `tests/pipeline.test.ts`

`PIPELINE: każdy preset UI…` (`:130-135`) zastępuje własną tabelę importem `PRINT_PRESETS`
z `src/utils/printParams.ts` — jedno źródło prawdy, brak rozjazdu wartości. Warunki asercji
(flipy, degeneraty, Hausdorff, dziury, winding, NaN) bez zmian.

### 10.4 Testy manualne (nieautomatyzowalne w tym repo)

1. Przeciągnięcie pliku na okno → model się ładuje, drop-highlight znika.
2. Klik w krawędź → pomarańczowa (klik = toggle, `App.tsx:198-205`; `Shift` nie istnieje w MVP).
3. Zmiana dyszy 0,4 → 1,0 mm → promień skacze do 2,00 mm + toast; brak przełącznika motywu;
   brak poziomego scrolla przy < 900 px; przy `prefers-reduced-motion` brak animacji i statyczny spinner.

---

## 11. Ryzyka i świadome odstępstwa

Zgodne z `docs/architecture/adr/0005-gui-jak-printfins.md` poza świadomymi odstępstwami R-02, R-03, R-05, R-09.

| # | Ryzyko / odstępstwo | Decyzja |
|---|---|---|
| R-01 | Domyślny promień 0,40 → 0,80 mm to **zmiana zachowania produktu** | akceptowalna: 0,40 mm jest poniżej nowego minimum 0,80 mm; wymaga aktualizacji `MEMORY.md:136,139` i `tests/pipeline.test.ts` |
| R-02 | Brak przycisku „Zaokrąglij" (w PrintFins jest) | zaokrąglanie jest **live** (`App.tsx:244-272`); przycisk byłby no-opem. Główną akcją jest „Pobierz STL" |
| R-03 | Brak osobnego menu `Export ▾` | eksport STL jest jedyną akcją główną; OBJ siedzi w menu `⋯` — mniej konkurujących akcentów |
| R-04 | Import w topbarze, brak przycisku w hero | jeden punkt wejścia (zakaz duplikatów); hero kieruje do topbara instrukcją „upuść plik w okno" |
| R-05 | Prawa szyna 300 px zamiast 264 px z wzoru | tabela 3-kolumnowa z polskimi etykietami nie mieści się w 264 px; różnica mieści się w „gęstości wzorca" |
| R-06 | Model centrowany w pełnym viewportcie, szyny go zasłaniają | odziedziczone ze wzorca; szyny `pointer-events: none`, więc orbita działa; docelowo kadr z bezpiecznego obszaru |
| R-07 | Usunięty motyw jasny | świadome (§7); powrót = ~12 linii w `:root[data-theme]` |
| R-08 | `RoundingOptions.maxDisplacement` i `flatAngleDeg` nie są wystawione w UI | świadome: `maxDisplacement` to gwarancja algorytmu (maks. przesunięcie ≤ promień), sterowanie nim łamałoby zasadę „minimum" |
| R-09 | Brak odczytu FPS w prawym dolnym rogu (ADR pkt 4) | świadome: aplikacja nie liczy FPS (`ThreeViewer.tsx` nie ma licznika); odczyt fps wymagałby nowego countera. Jego rolę w ViewBarze przejmuje podpowiedź sterowania. Do wdrożenia dopiero z realnym pomiarem fps |

---

## 12. Definicja „gotowe"

`npm run lint` — 0 błędów, 0 ostrzeżeń · `npx tsc -b` — czysto · `npm test` — wszystkie testy zielone
(w tym T-01…T-06) · `npm run test:ssr` — 10/10 sprawdzeń · `npm run build` — bez błędów ·
weryfikacja manualna §10.4.
