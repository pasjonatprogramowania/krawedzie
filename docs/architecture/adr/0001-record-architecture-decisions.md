# ADR 0001: Rejestrowanie decyzji architektonicznych (ADR)

- Status: Accepted
- Date: 2026-11-12
- Deciders: właściciel produktu, zespół RoundEdge

## Context

RoundEdge łączy kilka wrażliwych obszarów (geometria siatki w przeglądarce, reguły drukowalności FDM, pipeline walidacji/eksportu, opcjonalna referencja Pythona) opisanych m.in. w dokumentacji i planie przebudowy (`docs/superpowers/plans/2026-11-12-printability-rework.md:1-28`, `docs/audit/printability-audit.md:1-31`). W repozytorium istnieje już pojedyncza decyzja GUI (`docs/architecture/adr/0005-gui-jak-printfins.md:1-6`), ale bez spójnego indeksu i konwencji dla kolejnych ADR-ów trudno utrzymać kontekst motywacji (np. dlaczego fillet analityczny zamiast wygładzania w `src/utils/edgeRounding.ts:1-43`, dlaczego przetwarzanie jest client-only z opcjonalną diagnostyką w `app/main.py:1-17`, dlaczego testy uruchamiane są w procesie przez `tests/all.test.ts:1-9`). Brak ujednoliconego formatu utrudnia audyt zmian i powiązanie decyzji z kodem i raportami.

## Decision

1. Decyzje architektoniczne zapisujemy jako ADR w katalogu `docs/architecture/adr/` (obecny wzorzec: `docs/architecture/adr/0005-gui-jak-printfins.md:1`).
2. Pliki numerujemy sekwencyjnie `NNNN-krótki-slug.md` i utrzymujemy indeks w `docs/architecture/adr/README.md`.
3. Każdy ADR używa stałego formatu: nagłówek `# ADR NNNN: <Title>`, metadane `Status/Date/Deciders`, sekcje `## Context`, `## Decision`, `## Consequences` (z podsekcjami Positive, Negative / Trade-offs, Risks) z cytowaniami `ścieżka:linia` tam gdzie to możliwe.
4. ADR o statusie `Accepted` jest niezmienny merytorycznie; zmiany kierunku dokumentujemy nowym ADR-em ze statusem `Superseded`/`Accepted` i odniesieniem do poprzedniego (jeśli dotyczy). Korekty redakcyjne dopuszczalne tylko gdy nie zmieniają decyzji.
5. ADR opisują decyzje trwałe (algorytm, granice systemu, strategia testów/CI, istotne kontrakty), a nie jednorazowe zadania wdrożeniowe z planu (`docs/superpowers/plans/2026-11-12-printability-rework.md:45-46`).

## Consequences

### Positive
- Spójny ślad „dlaczego” dla kluczowych wyborów (np. analityczny fillet `src/utils/edgeRounding.ts:5-43`, kontrakt raportu `src/utils/meshTypes.ts:126-183`, bramka CI `package.json:11-14`, `.github/workflows/ci.yml:17-57`).
- Łatwiejsze onboardowanie i przeglądy zmian – decyzje można weryfikować względem kodu i audytów (`docs/audit/printability-audit.md:10-31`).

### Negative / Trade-offs
- Dodatkowy koszt utrzymania dokumentacji przy zmianach architektonicznych.
- Ryzyko rozjazdu ADR z kodem, jeśli aktualizacje nie będą częścią pracy (wymaga dyscypliny w review).

### Risks
- Zbyt ogólne ADR bez odniesień do `ścieżka:linia` tracą wartość dowodową; częściowo niezweryfikowalne stwierdzenia należy oznaczać jako `nie zweryfikowano`.
- Błędne „domknięcie” decyzji w ADR może utrudnić późniejszą korektę, jeśli nie zostanie jawnie zastąpione nowym ADR-em.