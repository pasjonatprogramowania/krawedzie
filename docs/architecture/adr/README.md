# Architecture Decision Records (ADR)

Ten katalog zawiera decyzje architektoniczne RoundEdge. Format i zasady utrzymania opisuje `0001-record-architecture-decisions.md`.

## Format

- Nagłówek: `# ADR NNNN: <Title>`
- Metadane: `- Status`, `- Date`, `- Deciders`
- Sekcje: `## Context`, `## Decision`, `## Consequences` (z podsekcjami `Positive`, `Negative / Trade-offs`, `Risks`)
- Twierdzenia faktów powinny zawierać odniesienia `ścieżka:linia` (lub nazwę komendy/skryptu). Niepewne: `nie zweryfikowano`.

## Indeks ADR

| ADR | Tytuł | Status | Data |
|---|---|---|---|
| [0001](./0001-record-architecture-decisions.md) | Rejestrowanie decyzji architektonicznych (ADR) | Accepted | 2026-11-12 |
| [0002](./0002-analytical-fillet-over-smoothing.md) | Analityczny fillet (rolling-ball) zamiast wygładzania siatki | Accepted | 2026-11-12 |
| [0003](./0003-client-only-no-backend.md) | Przetwarzanie wyłącznie po stronie klienta, Python jako opcjonalna referencja diagnostyczna | Accepted | 2026-11-12 |
| [0004](./0004-in-process-test-runner.md) | Testy in-process i bramki CI (Node + Python cross-check) | Accepted | 2026-11-12 |
| [0005](./0005-gui-jak-printfins.md) | Przebudowa GUI na wzór PrintFins (canvas-first, szyny boczne) | Accepted | 2026-11-12 |

## Uwagi

- ADR `0005` istniał wcześniej i jest tylko zindeksowany powyżej (bez duplikowania treści).
- Nowe decyzje dodawać jako kolejne numery `NNNN-*` i aktualizować tabelę indeksu. Statusy inne niż `Accepted` (np. `Superseded`): **nie zweryfikowano** w bieżącym zestawie.