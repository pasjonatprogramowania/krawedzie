# ADR 0003: Przetwarzanie wyłącznie po stronie klienta, Python jako opcjonalna referencja diagnostyczna

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Produkt RoundEdge wykonuje import, walidację, zaokrąglanie i eksport siatek w przeglądarce (React/TypeScript, moduły `src/utils/*`, orkiestracja w `src/App.tsx`) – np. wczytywanie i budowa siatki przez `buildMeshFromRaw` oraz obliczenia `roundEdges` uruchamiane w UI (`src/App.tsx:16-21`, `src/App.tsx:89-161`, `src/App.tsx:268-289`, `src/utils/meshIO.ts:108-184`, `src/utils/edgeRounding.ts:741-1321`). Równolegle w repo istnieje warstwa Pythona: czysta geometria/diagnostyka w `app/geometry.py` (tylko stdlib) i serwis FastAPI w `app/main.py`, który świadomie nie implementuje przetwarzania (`/api/process` → 501) i udostępnia diagnostykę `/api/inspect` (`app/geometry.py:1-7`, `app/geometry.py:126-228`, `app/main.py:1-17`, `app/main.py:59-133`). Skrypt `scripts/verify_backend.py` importuje `app.geometry` (bez zależności zewnętrznych) i porównuje wyniki z „złotymi” wartościami pochodzącymi z implementacji TS (`scripts/verify_backend.py:1-9`, `scripts/verify_backend.py:20-21`, `scripts/verify_backend.py:83-104`), a CI uruchamia go w osobnym jobie (`.github/workflows/ci.yml:47-57`).

## Decision

1. **Geometria i operacje edycji modelu (rounding/export) pozostają w 100% po stronie klienta (przeglądarka)**; backend nie jest wymagany do działania aplikacji (`src/App.tsx:268-305`, `src/utils/meshProcessing.ts:1-50`, `app/main.py:6-16`).
2. **Pythonowa warstwa diagnostyczna jest opcjonalna i referencyjna**:
   - `app/geometry.py` stanowi implementację referencyjną (stdlib-only) do walidacji/liczb diagnostycznych (`app/geometry.py:1-7`, `app/geometry.py:126-228`).
   - `app/main.py` to opcjonalna warstwa HTTP (FastAPI) eksponująca `/api/health` i `/api/inspect`; endpoint `/api/process` pozostaje celowo niezaimplementowany (501), aby nie sugerować serwerowego przetwarzania (`app/main.py:43-56`, `app/main.py:59-133`).
3. **Zgodność TS↔Python weryfikujemy skryptem i w CI**, a nie przez współdzielony runtime: `scripts/verify_backend.py` porównuje wybrane metryki z oczekiwaniami, a job `python` w CI uruchamia ten skrypt (`scripts/verify_backend.py:23-49`, `scripts/verify_backend.py:83-104`, `.github/workflows/ci.yml:47-57`).
4. Nowe funkcje przetwarzania geometrii nie powinny być przenoszone na backend bez osobnej decyzji ADR; ewentualna ewolucja może dotyczyć diagnostyki/automatyzacji, ale nie może zmieniać gwarancji lokalnego przetwarzania bez jawnej zmiany.

## Consequences

### Positive
- Prywatność i prostota wdrożenia: plik modelu nie musi opuszczać przeglądarki, brak obowiązkowej infrastruktury serwerowej dla głównej funkcji (`app/main.py:6-16`, `src/App.tsx:268-305`).
- Niezależna referencja diagnostyczna w Pythonie ułatwia wykrywanie rozjazdów liczb i regresji algorytmów walidacji (`scripts/verify_backend.py:1-9`, `.github/workflows/ci.yml:47-57`).

### Negative / Trade-offs
- Duplikacja części logiki diagnostycznej (TS i Python) zwiększa koszt utrzymania i ryzyko dryfu implementacji (`app/geometry.py:126-228`, `src/utils/meshTopology.ts:642-755`).
- Obciążenie CPU/RAM spada na przeglądarkę użytkownika; obecnie obliczenia wywoływane są synchronicznie z poziomu UI flow (`src/App.tsx:268-289`), co może ograniczać skalę modeli (dokładne limity wydajności: **nie zweryfikowano** w tej sesji).

### Risks
- Użytkownicy mogą błędnie oczekiwać serwerowego endpointu przetwarzania; komunikat 501 i dokumentacja muszą pozostać spójne (`app/main.py:118-133`).
- Jeśli `verify_backend.py` lub „złote” wartości przestaną odzwierciedlać stan TS, cross-check straci wartość; aktualizacje muszą być świadome i przeglądane (`scripts/verify_backend.py:10-49`).