# ADR 0009: Web Worker dla obliczeń geometrii (planowane)

- Status: Proposed
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

Operacje zaokrąglania są kosztowne i dziś wykonują się synchronicznie w głównym wątku UI.
Audyt (AUD-005, `docs/audit/printability-audit.md:175-192`) zmierzył m.in. ~22 s i ~1 GB RAM
dla 76 800 trójkątów wejściowych, co blokuje interakcję i grozi awarią karty. Koszt rośnie
przez wielopoziomowe zagęszczanie pasa i przebudowę topologii
(`src/utils/edgeRounding.ts:215-289,961-966`) oraz budżet wyjścia zależny od wejścia
(`triangleBudget` domyślnie wyliczany w `:746-749`, egzekwowany w refine `:274-279`).

Plan przebudowy przewiduje przeniesienie obliczeń poza wątek główny
(`docs/superpowers/plans/2026-11-12-printability-rework.md:449-476`, Task 6).

## Decision

1. **Cel:** uruchamiać pipeline geometryczny (`buildMeshFromRaw` + `roundEdges`) w Web
   Workerze, aby UI pozostało responsywne i mogło pokazywać postęp/anulowanie.
2. **Kontrakt komunikatów (szkic z planu, Task 6 `:457-463`):**
   request `{ type: 'round', id: number, positions: Float64Array, indices: Int32Array, options: RoundingOptions }`
   → response `{ type: 'result', id, mesh: MeshData, report: RoundingReport }` albo
   `{ type: 'error', id, message }`. Indeksy krawędzi serializowane jako `number[]`
   (bezpieczne dla `postMessage`/structured clone, `:469-471`).
3. **Zachowanie:** debounce suwaka ~150 ms i anulowanie starszych żądań po `id`
   (`:465-466`), twardy limit wejścia 300 000 trójkątów z komunikatem po polsku
   (`:463-464`). Integracja po stronie UI planowana w `src/App.tsx` (obecnie wywołania
   synchroniczne/inline logiki widoczne przy przeliczeniach i użyciu wyników,
   np. `src/App.tsx:327-332,386-389,419-420`).
4. **Stan obecny (uczciwie):** mechanizm workera nie jest zaimplementowany.
   Nie zaimplementowano (sprawdzone: brak katalogu `src/workers/`, brak plików
   `tests/*worker*` w repo; jedyne trafienia `*worker*` to artefakty `node_modules/`).

## Consequences

### Positive
- Odblokowanie wątku głównego dla dużych modeli i przewidywalne UX (progress/cancel).
- Limit 300 k trójkątów i anulowanie ograniczą ryzyko „Awaria strony” opisane w AUD-005.
- Wydzielenie czystej funkcji obsługi żądania ułatwi testowanie logiki bez `self`.

### Negative / Trade-offs
- Koszt serializacji/transferu dużych buforów (`Float64Array`/mesh) między wątkami.
- Większa złożoność stanu UI (kolejność odpowiedzi, stare `id`, obsługa błędów workera).

### Risks
- Niespójna obsługa anulowania/debounce może pokazać wynik nieadekwatny do aktualnych
  ustawień użytkownika.
- Pozostaje do zrobienia: `src/workers/rounding.worker.ts`, integracja w `App.tsx`,
  testy (np. czysta `handleRoundRequest`, serializowalność opcji) oraz egzekucja limitu
  300 000 trójkątów zgodnie z planem Task 6.
