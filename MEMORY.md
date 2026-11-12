# MEMORY.md — zwarta pamięć projektu RoundEdge

> Artefakt stanu wiedzy o projekcie: fakty potrzebne do dalszej pracy bez ponownego
> odkrywania. Dokumentacja użytkowa: [README.md](README.md). Audyt/research/plan:
> `docs/audit/printability-audit.md`, `docs/research/printability-algorithms.md`,
> `docs/superpowers/plans/2026-11-12-printability-rework.md`.

Ostatnia weryfikacja: **2026-11-12**.

| Bramka | Komenda | Wynik |
|---|---|---|
| Lint | `npm run lint` | 0 |
| Typy | `npx tsc -b` / `npm run typecheck` | czysto |
| Testy | `node tests/all.test.ts` (`npm test`) | 79 / 79 pass |
| Render UI | `npm run test:ssr` (`scripts/ssr-smoke.mjs`) | 7 / 7 |
| Build | `npm run build` | OK |
| Backend (cross-check) | `python scripts/verify_backend.py` | OK (zgodność z TS) |

CI: `.github/workflows/ci.yml` (Node 22.18.0 i 24: lint, typecheck, test, test:ssr, build; osobny job Python).

---

## 1. Co to jest (stan faktyczny)

**RoundEdge** — klientowa aplikacja webowa (React 19 + TypeScript 6 + Vite 8 + three.js 0.185 + Tailwind 3)
do zaokrąglania/ścinania wybranych krawędzi siatek 3D pod druk FDM. Przetwarzanie lokalnie w przeglądarce.
UI: **dark-only, canvas-first, styl PrintFins** (górny pasek z dyszą/promieniem, pływające szyny, karta startowa,
porównanie before/after/overlay, pokaz nawisu i zmierzonego błędu powierzchni). Web Worker **niezaimplementowany** (plan: zadanie 6).

## 2. Mapa kluczowych plików/modułów

| Obszar | Pliki |
|---|---|
| UI / stan | `src/App.tsx`, `src/components/TopBar.tsx`, `StatsRail.tsx`, `OptionsRail.tsx`, `StatusCard.tsx`, `ViewBar.tsx`, `HeroCard.tsx`, `Toasts.tsx`, `src/hooks/useMediaQuery.ts` |
| Viewer 3D | `src/components/ThreeViewer.tsx` + `viewerPicking.ts`, `viewerGeometry.ts` |
| Rdzeń geometrii | `src/utils/edgeRounding.ts` (`roundEdges`, zagęszczanie pasa, naprawa) |
| Topologia / IO / eksport | `src/utils/meshTopology.ts`, `meshIO.ts`, `meshExport.ts`, `meshTypes.ts`, `meshProcessing.ts` (barrel) |
| Drukowalność / parametry | `src/utils/meshClearance.ts`, `src/utils/printability.ts`, `src/utils/printParams.ts` |
| Python (referencyjny) | `app/geometry.py` (stdlib-only diagnostyka), `app/main.py` (HTTP/FastAPI, `/api/process` → 501) |
| Testy / smoke | `tests/all.test.ts` (agregator), `tests/*.test.ts`, `scripts/ssr-smoke.mjs` |
| Dokumentacja/audyt | `README.md`, `SPEC.md`, `docs/audit/*`, `docs/research/*`, `docs/design/*`, `docs/architecture/adr/*`, `docs/superpowers/plans/*` |

## 3. Raport i semantyka wyniku (aktualne)

`RoundingReport` / `roundEdges` raportuje m.in.: `effectiveRadius`, `edgesRounded`, `processedEdgeCount`,
`geometryChanged`, `failed`, `failedEdgeIndices`, `measuredSurfaceError`, `bandFacetSize`, `chordDeviation`,
`refinementLimitedByBudget`, `radiusClampReason`, limity przemieszczeń, bbox/objętość, ostrzeżenia.
- **`failed`/`geometryChanged`**: operacja może zostać wycofana lub częściowo nieskuteczna — UI blokuje eksport przy `failed`.
- **`measuredSurfaceError`**: zmierzony błąd powierzchni w paście (pokazywany w UI); `chordDeviation` pozostaje wartością teoretyczną.
- Promień może być ograniczany przez geometrię/siatkę/kąt (`radiusClampReason`); UI wymusza minimum **2 × dysza**.

## 4. Pułapki i niezmienniki (zachować)

- **Brak Laplacian/Taubin/HC smoothing** — operacje bez jednostki mm i kurczące model są odrzucone.
- **Float64 w geometrii**, float32 dopiero na eksport/GPU.
- **`node --test` z przechwytywaniem stdio może dawać `spawn EPERM`** w tym środowisku → używaj `node tests/all.test.ts`.
- **Node nie importuje `.tsx`** → UI weryfikowany analizą statyczną + SSR smoke (`scripts/ssr-smoke.mjs`), nie importem komponentów w teście.
- **Nie używać `BufferGeometryUtils.mergeVertices`** (hashowanie atrybutów/kwantyzacja) — własny spawacz/topologia.
- **Wypukłość/wklęsłość** wyznaczana testem strony płaszczyzny (niezależnie od konwencji nawijania); orientacja ścian i objętość muszą być spójne.
- **Ograniczenia realne**: budżet trójkątów może przerwać zagęszczanie (`refinementLimitedByBudget`), rozdzielczość pasa (`bandFacetSize`) może ograniczać jakość bardziej niż `segments`, ostre kąty/cienkie elementy mogą powodować clamp/wycofanie.
- **ThreeViewer** zrefaktoryzowany (logika pomocnicza w `viewerPicking.ts` / `viewerGeometry.ts`) — zmiany raycast/podświetlania rób spójnie.

## 5. Skróty

```bash
npm run dev
npm run lint
npm run typecheck
npm test              # node tests/all.test.ts
npm run test:ssr
npm run build
python scripts/verify_backend.py
```
