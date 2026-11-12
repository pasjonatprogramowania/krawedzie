# ADR 0004: Testy in-process i bramki CI (Node + Python cross-check)

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Środowisko uruchomieniowe projektu ma ograniczenia, które utrudniają użycie domyślnego trybu `node --test` z procesami potomnymi (opisane w agregatorze testów). Z tego powodu zestaw testów jest uruchamiany w jednym procesie przez agregator `tests/all.test.ts`, importujący poszczególne pliki testowe (`tests/all.test.ts:1-18`). Skrypty npm definiują spójne bramki lokalne: `lint` (`oxlint`), `typecheck` (`tsc -b`), `test` (`node tests/all.test.ts`), `test:ssr` (`node scripts/ssr-smoke.mjs`) oraz `check` łączący wszystkie kroki z buildem (`package.json:6-14`). W CI GitHub Actions uruchamiane są te same kroki Node na macierzy LTS oraz osobny cross-check backendu Pythona przez `python scripts/verify_backend.py` (`.github/workflows/ci.yml:17-57`). Skrypt `scripts/verify_backend.py` opiera się wyłącznie na `app.geometry` (stdlib) i porównuje metryki z wartościami referencyjnymi (`scripts/verify_backend.py:1-9`, `scripts/verify_backend.py:20-21`, `.github/workflows/ci.yml:55-57`).

## Decision

1. **Agregator testów in-process jest kanonicznym sposobem uruchamiania testów jednostkowych/integracyjnych Node**: `npm test` → `node tests/all.test.ts`, a agregator importuje zestawy (`package.json:11`, `tests/all.test.ts:10-18`). Pojedyncze pliki mogą być uruchamiane bezpośrednio `node <plik>.test.ts`, jeśli środowisko na to pozwala (zgodnie z praktyką opisaną w komentarzu agregatora; skuteczność w tym środowisku: **nie zweryfikowano**).
2. **UI weryfikujemy podejściem kompatybilnym z ograniczeniami runtime**: osobny skrypt `npm run test:ssr` (`node scripts/ssr-smoke.mjs`) oraz testy UI w agregatorze (`tests/ui.test.ts` importowany w `tests/all.test.ts:18`) stanowią bramkę UI bez polegania na środowisku wymagającym odrębnego spawn/DOM specyficznego dla `node --test` (szczegóły implementacji asercji UI: **nie zweryfikowano** poza samym podłączeniem skryptu/pliku).
3. **Bramki jakości w Node są zdefiniowane skryptami i powielone w CI**: lint, typecheck, unit tests, SSR smoke, build (lokalnie także przez `npm run check`) (`package.json:6-14`, `.github/workflows/ci.yml:36-45`).
4. **Diagnostyka Python jest weryfikowana jako cross-check referencyjny**: CI uruchamia `python scripts/verify_backend.py` na Python 3.11; skrypt używa `app.geometry` bez instalacji dodatkowych pakietów (`.github/workflows/ci.yml:47-57`, `scripts/verify_backend.py:20-21`).
5. Zmiany w sposobie uruchamiania testów lub bramek CI wymagają aktualizacji skryptów, workflow i odpowiednich ADR-ów, aby zachować spójność lokalnie/CI.

## Consequences

### Positive
- Deterministyczne uruchamianie testów w środowiskach z ograniczeniami spawnowania procesów dzięki jednemu procesowi (`tests/all.test.ts:1-9`).
- Jasne, powtarzalne bramki (`lint/typecheck/test/test:ssr/build`) wspólne dla lokalnego dev i CI (`package.json:6-14`, `.github/workflows/ci.yml:36-45`).
- Niezależny cross-check Python↔TS dla diagnostyki zwiększa pewność poprawności metryk referencyjnych (`scripts/verify_backend.py:23-49`, `.github/workflows/ci.yml:47-57`).

### Negative / Trade-offs
- Agregator in-process może utrudniać izolację awarii między plikami testowymi i różni się od standardowego UX `node --test` runnera (wpływ praktyczny: **nie zweryfikowano**).
- Utrzymywanie równoległych bramek (Node + Python + SSR smoke) wydłuża czas feedbacku w CI.

### Risks
- Jeśli agregator nie zostanie zaktualizowany po dodaniu nowego pliku testowego, testy mogą zostać pominięte lokalnie/CI mimo obecności w repo (`tests/all.test.ts:10-18`).
- Rozjazd między skryptami npm a workflow CI (nazwy/zakres kroków) może prowadzić do „zielone lokalnie, czerwone w CI” lub odwrotnie (`package.json:6-14`, `.github/workflows/ci.yml:36-57`).