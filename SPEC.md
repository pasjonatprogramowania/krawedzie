# SPECYFIKACJA APLIKACJI: RoundEdge
## Webowa aplikacja do zaokrąglania krawędzi modeli 3D pod druk 3D

**Wersja:** 1.0 (MVP)
**Data:** 2026-06-27
**Status:** Specyfikacja produktowo-techniczna gotowa do wdrożenia

> ### ⚠️ Stan implementacji (2026)
>
> Specyfikacja opisuje **docelowy produkt komercyjny** (backend FastAPI + MeshLib +
> Celery/Redis + S3). Zaimplementowana aplikacja jest **w 100% klientowa** i nie
> korzysta z żadnego z tych komponentów — to świadoma decyzja: model nie opuszcza
> komputera użytkownika, nie ma kosztów infrastruktury i nie ma kolejki.
>
> W związku z tym **rozstrzygające są poniższe różnice**:
>
> | Sekcja SPEC | Stan faktyczny |
> |---|---|
> | §5.1 backend FastAPI/MeshLib, §5.2 diagram architektury, §5.3 pseudokod MeshLib | **Nieaktualne.** Rdzeń to [src/utils/edgeRounding.ts](src/utils/edgeRounding.ts): dokładny fillet metodą toczącej się kuli (opening/closing przecięcia półprzestrzeni), bez MeshLib i bez wokselizacji. `app/main.py` to wyłącznie opcjonalny serwer referencyjny do diagnostyki; `/api/process` zwraca 501. |
> | §4.2 Ekran 4 „Processing (asynchroniczny)", §6.1 „Processing async, job queue" | **Nieaktualne.** Przetwarzanie jest synchroniczne, w przeglądarce, z debounce 90 ms i wskaźnikiem zajętości. |
> | §6.1 „Auto-detect krawędzi > 60°" | Próg domyślny to **30°** (regulowany) — 60° przepuszczało krawędzie, które dla oka są już ostre. |
> | §6.1 „Download STL/3MF" | Zaimplementowane **STL i OBJ**; 3MF pozostaje w planach. |
> | §6.1 „Live preview: overlay przed/po" | Zaimplementowane jako tabela porównawcza przed/po + jednoczesny podgląd obu siatek. |
> | §7.2 kolory krawędzi | Zaimplementowane; automatycznie wykryte ostre krawędzie idą do wspólnego zbioru zaznaczenia. |
>
> Faktyczne gwarancje algorytmu, parametry druku i sposób uruchomienia opisuje
> [README.md](README.md); niezmienniki i pułapki implementacyjne — [MEMORY.md](MEMORY.md).

---

## 1. TL;DR — Czym jest ta aplikacja

**RoundEdge** to webowa aplikacja, która pozwala osobom bez wiedzy technicznej o CAD/meshopracowaniu wgrać model 3D (STL/OBJ/3MF), zaznaczyć krawędzie do zaokrąglenia i otrzymać zoptymalizowany plik gotowy do druku 3D — z automatycznym doborem parametrów pod kątem m.in. wytrzymałości, redukcji naprężeń i jakości powierzchni.

**Analogia:** tak jak Canva uprościła grafikę, tak RoundEdge upraszcza przygotowanie modelu do druku 3D. Użytkownik nie musi wiedzieć, czym jest manifold, half-edge czy NURBS — po prostu klika krawędzie, wybiera preset i pobiera gotowy plik.

**Kluczowa obietnica:** „Wgraj model → zaznacz krawędzie → pobierz zoptymalizowany STL w 2 minuty."

---

## 2. Problem i kontekst rynkowy

### 2.1. Dlaczego zaokrąglanie krawędzi ma znaczenie w druku 3D

Na podstawie źródeł (Pollen AM, BigRep, Markforged, DfAM guides):

| Powód | Mechanizm |
|---|---|
| **Redukcja koncentracji naprężeń** | Ostre narożniki wewnętrzne to koncentratory naprężeń — zaokrąglenie (nawet 2 mm) znacząco zwiększa wytrzymałość |
| **Lepsza jakość powierzchni** | Ostre krawędzie zewnętrzne powodują drgania głowicy i artefakty |
| **Mniej wsparć** | Zaokrąglone krawędzie poprawiają overhangi, mniej potrzeba supportów |
| **Mocniejsze delikatne elementy** | Cienkie wypusty (np. uchwyty) łączone zaokrągleniem są 2-3× mocniejsze |
| **Estetyka** | Detale wyglądają profesjonalnie, można malować/zdjąć supporty łatwiej |
| **Bezpieczeństwo** | Brak ostrych kantów = bezpieczniejsze użytkowanie (zabawki, uchwyty) |

### 2.2. Co oferuje rynek dzisiaj (i dlaczego to za trudne)

| Narzędzie | Możliwości edge rounding | Problem dla laika |
|---|---|---|
| **Blender (Bevel + bool)** | Zaawansowane, elastyczne | Stroma krzywa uczenia; trzeba znać topologię |
| **Fusion 360 / SolidWorks (Fillet)** | Najlepsza jakość, parametryczny | Płatny; wymaga CAD; nie działa na meshach |
| **Meshmixer (Make Solid + Sculpt)** | Zaokrąglanie przez voxel remeshing | UI archaiczne; niszczące oryginalną geometrię |
| **PrusaSlicer / Bambu Studio** | Brak bezpośredniej opcji; tylko naprawa mesh | Nie edytują modelu, tylko przygotowują G-code |
| **Online narzędzia (Makeprintable, etc.)** | Głównie naprawa | Brak selektywnego zaokrąglania krawędzi |

**Luka rynkowa:** brak prostego webowego narzędzia typu „kliknij krawędzie → zaokrąglij → pobierz", zoptymalizowanego pod DfAM.

---

## 3. Docelowi użytkownicy

### Persona 1: „Marek, hobbysta druku 3D"
- Drukuje od 2 lat, ma Ender 3 / Prusa Mini
- Pobiera modele z Thingiverse, Printables
- Czasem chce poprawić model przed drukiem, ale Blender to dla niego „rocket science"
- **Potrzeba:** szybko zaokrąglić kanty w modelu, który ma ostre krawędzie

### Persona 2: „Anna, projektantka produktu"
- Projektuje w Figma/Solidworks, prototypy oddaje do druku
- Nie ma czasu na wielogodzinne poprawki
- Wysyła model do drukarni, ale STL z jej CAD-a ma problemy
- **Potrzeba:** narzędzie do szybkiej optymalizacji przed wysłaniem do druku

### Persona 3: „Kuba, edukator / nauczyciel"
- Prowadzi zajęcia z projektowania / druku 3D
- Uczniowie robią modele w Tinkercad (niskiej jakości)
- **Potrzeba:** jeden klik, który „naprawi" krawędzie uczniowskich modeli

---

## 4. Proces użycia — User Flow (w wersji uproszczonej)

### 4.1. Porównanie: jak to robią profesjonaliści vs. jak będzie w RoundEdge

**Profesjonalny flow w Blenderze (obecnie):**
1. Import STL → sprawdź, czy manifold
2. Konwersja do edytowalnej siatki (jeśli potrzeba)
3. Edge select mode → zaznacz krawędzie
4. Bevel tool → ustaw width, segments, profile
5. Manualny adjust na narożnikach
6. Sprawdź, czy nie ma non-manifold edges po bevelu
7. Re-eksport STL
8. *Czas: 30-90 minut, wymaga wiedzy*

**Planowany flow w RoundEdge (uproszczony):**
1. Wgraj plik (drag & drop)
2. Zaznacz krawędzie (klik myszką w przeglądarce)
3. Wybierz preset: „Bezpieczne narożniki" / „Wytrzymałe" / „Estetyczne" → albo suwak z podglądem
4. Klik „Zaokrąglij" → processing w chmurze
5. Pobierz wynik (STL/3MF)
6. *Czas: 2-3 minuty, zero wiedzy technicznej*

### 4.2. Szczegółowy user flow (krok po kroku)

```
┌──────────────────────────────────────────────────────────────┐
│  EKRAN 1: Upload                                              │
│  ─────────────────                                            │
│  • Drag & drop STL/OBJ/3MF (max 50 MB w MVP)                 │
│  • Walidacja: czy to poprawny mesh?                          │
│  • Miniaturka z liczbą trójkątów, rozmiarem w mm             │
│  • Wykrywanie potencjalnych problemów (preview)               │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  EKRAN 2: Selekcja krawędzi                                   │
│  ─────────────────────────                                   │
│  • Interaktywny viewer 3D (obrót, zoom, pan)                 │
│  • Tryby selekcji:                                           │
│    - Klik: pojedyncza krawędź                                │
│    - Ctrl+klik: dodaj do zaznaczenia                          │
│    - Drag: krawędzie w obszarze (fence selection)             │
│    - „Auto-detect": automatycznie zaznacz wszystkie ostre      │
│      krawędzie (>X stopni) — feature-killer w MVP             │
│  • Podświetlenie zaznaczonych (kolor/highlight)               │
│  • Licznik: „Zaznaczono: 47 krawędzi"                        │
│  • Sugestie: „Wykryto 23 ostre krawędzie >60° — zaznaczyć?"   │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  EKRAN 3: Parametry zaokrąglenia                             │
│  ────────────────────────────────                            │
│  • Presety (kafelki z ikonami):                              │
│    [🛡 Wytrzymałe] [✨ Estetyczne] [⚡ Szybkie] [⚙ Custom]  │
│  • Dla Custom:                                                │
│    - Suwak promienia (0.1 - 10 mm)                           │
│    - Typ: ○ Fillet (okrągły)  ▱ Chamfer (ścięty)             │
│    - Liczba segmentów (preview wpływa na gładkość)           │
│    - Automatyczna detekcja: ostre/normalne krawędzie          │
│  • Live preview:                                            │
│    - Suwak "Porównaj" przed/po (overlay z przezroczystością)  │
│    - Statystyki: przyrost trójkątów, estymowany czas druku    │
│  • Ostrzeżenia:                                              │
│    - „Ten promień jest za duży dla wybranych krawędzi"       │
│    - „Uwaga: możliwe przecięcia w narożnikach"               │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  EKRAN 4: Processing (asynchroniczny)                        │
│  ────────────────────────────────────                        │
│  • Pasek postępu:                                            │
│    ▓▓▓▓▓▓▓░░░ 67% — Zaokrąglanie krawędzi                  │
│  • Etapy widoczne:                                           │
│    ✓ Walidacja mesha                                         │
│    ✓ Analiza topologii krawędzi                              │
│    ▓ Zaokrąglanie (47/47 krawędzi)                          │
│    ○ Naprawa topologii                                       │
│    ○ Eksport                                                 │
│  • Przybliżony czas pozostały                                │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  EKRAN 5: Wynik                                               │
│  ─────────────                                               │
│  • Podgląd 3D z obracaniem                                   │
│  • Porównanie przed/po (slider overlay)                      │
│  • Statystyki:                                               │
│    - Trójkąty: 12 432 → 18 941 (+52%)                       │
│    - Rozmiar pliku: 850 KB → 1.2 MB                         │
│  • Diagnostyka:                                              │
│    ✓ Manifold (zamknięta powierzchnia)                       │
│    ✓ Brak non-manifold edges                                 │
│    ✓ Brak samoprzecięć                                       │
│  • Akcje:                                                    │
│    [📥 Pobierz STL] [📥 Pobierz 3MF] [🔄 Cofnij zmiany]      │
│    [📤 Wyślij do drukarki (opcjonalnie, integracja)]         │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Architektura techniczna

### 5.1. Stack technologiczny (rekomendowany)

**Frontend (Web UI):**
- **React 18 + TypeScript** — komponenty, typowanie
- **Vite** — bundler (szybki dev)
- **Three.js + React Three Fiber** — interaktywny viewer 3D
- **three-mesh-bvh** — akceleracja raycastingu do selekcji krawędzi (kluczowe dla wydajności!)
- **Tailwind CSS + Radix UI / shadcn** — UI

**Backend (processing):**
- **Python 3.11 + FastAPI** — REST API, async job queue
- **MeshLib (meshlib.io)** — Python SDK do mesh processing; najlepsza biblioteka open-source do uproszczenia, naprawy i analizy mesh
- **trimesh** — I/O STL/OBJ/3MF, naprawa topologii
- **manifold3d** — szybkie operacje boolowskie (gdyby potrzeba)
- **Celery + Redis** — kolejka zadań asynchronicznych
- **PostgreSQL** — historia użytkownika, job metadata

**Storage:**
- **S3-compatible (MinIO / AWS S3 / Cloudflare R2)** — pliki użytkowników
- **Cloudflare CDN** — szybki frontend

**DevOps:**
- **Docker + Docker Compose** — konteneryzacja
- **Kubernetes (opcjonalnie, po skali)** — autoskaling
- **GitHub Actions** — CI/CD

### 5.2. Schemat architektury

```
┌──────────────┐         ┌──────────────────────────┐
│   Browser    │ ──────► │  CDN (Cloudflare)        │
│  (React +    │         │  / Static frontend       │
│   Three.js)  │         └──────────────────────────┘
└──────┬───────┘                      │
       │ HTTPS                        ▼
       │                       ┌──────────────┐
       │                       │  React App   │
       │                       │  (Vite build)│
       │                       └──────────────┘
       │                              │
       ▼                              ▼
┌──────────────────────────────────────────────────┐
│              FastAPI Backend                      │
│  ┌─────────────────────────────────────────┐     │
│  │ /upload  → S3 storage, validation       │     │
│  │ /jobs    → enqueue to Redis             │     │
│  │ /jobs/{id}/status → poll                │     │
│  │ /jobs/{id}/result → download            │     │
│  └─────────────────────────────────────────┘     │
└──────────────┬───────────────────────────────────┘
               │
               ▼
        ┌──────────────┐         ┌──────────────────┐
        │  Redis Queue │ ──────► │  Celery Workers  │
        │              │         │  (Python)        │
        └──────────────┘         │                  │
                                 │  1. MeshLib load │
                                 │  2. Detect edges │
                                 │  3. Apply fillet │
                                 │  4. Validate     │
                                 │  5. Export STL   │
                                 │                  │
                                 │  Output → S3     │
                                 └──────────────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                                 │   PostgreSQL     │
                                 │  - users         │
                                 │  - jobs          │
                                 │  - files_meta    │
                                 └──────────────────┘
```

### 5.3. Algorytm zaokrąglania — szczegóły implementacji

**Wykorzystanie MeshLib (Python SDK):**

```python
# Pseudokod pipeline'u przetwarzania

from meshlib import mrmeshpy as mm

def round_edges(input_path, selected_edges, radius_mm, fillet_type):
    # 1. Load mesh
    mesh = mm.loadMesh(input_path)
    
    # 2. Validate & repair
    if not is_manifold(mesh):
        mesh = repair_topology(mesh)
    
    # 3. Detect selected edges (by user click indices)
    edges = find_edges_by_indices(mesh, selected_edges)
    
    # 4. Apply fillet / bevel
    if fillet_type == "fillet":
        # MeshLib ma wbudowany algorytm zaokrąglania
        settings = mm.MeshFillerSettings()
        settings.maxEdgeLen = radius_mm * 0.5  # adaptive
        result = mm.fillEdges(mesh, edges, settings)
    elif fillet_type == "chamfer":
        # Bevel operation
        result = mm.bevelEdges(mesh, edges, radius_mm)
    
    # 5. Cleanup
    result = mm.selfIntersections(result).fix()
    
    # 6. Validate output
    assert is_manifold(result)
    assert not has_non_manifold_edges(result)
    
    # 7. Export
    mm.saveMesh(result, output_path)
    return output_path
```

**Dlaczego MeshLib:**
- Open-source, aktywnie rozwijany
- Ma bezpośrednie API do fillet/bevel edges
- Najszybszy w swojej klasie (C++ core, Python bindings)
- Dobra dokumentacja i przykłady

**Alternatywy (jeśli MeshLib okaże się niewystarczający):**
- Open3D — Python, ale słabszy fillet
- PyVista + VTK — wizualizacja + niektóre operacje
- Własny pipeline oparty o half-edge structure

---

## 6. Funkcjonalności — pełna lista

### 6.1. MVP (Faza 1, 8-12 tygodni)

| Priorytet | Funkcja | Opis |
|---|---|---|
| P0 | Upload STL/OBJ/3MF | Drag & drop, walidacja, limit 50 MB |
| P0 | Viewer 3D | Obrót, zoom, pan, podświetlenie krawędzi |
| P0 | Selekcja krawędzi (klik) | Pojedyncza krawędź, multi-select |
| P0 | Auto-detect ostrych krawędzi | Kąt > 60° domyślnie, regulowany |
| P0 | Fillet (zaokrąglenie okrągłe) | Suwak promienia 0.1-10 mm |
| P0 | Chamfer (ścięcie) | Suwak rozmiaru 0.1-10 mm |
| P0 | Live preview | Overlay przed/po |
| P0 | Processing async | Job queue, status polling |
| P0 | Download STL/3MF | Wynik gotowy do druku |
| P0 | Walidacja wyniku | Manifold check, raport błędów |
| P1 | Presety (Wytrzymałe/Estetyczne/Szybkie) | Predefiniowane konfiguracje |
| P1 | Sugestie promienia | „Dla krawędzi 0.8 mm: zalecany promień 0.3 mm" |
| P1 | Statystyki (trójkąty, rozmiar) | Porównanie przed/po |
| P2 | Konto użytkownika | Historia, ponowne pobranie |
| P2 | Integracja z print services | Wyślij do Craftcloud/3DHubs |

### 6.2. Faza 2 (po MVP, 3-6 miesięcy)

- **Variable radius fillet** — różne promienie na różnych krawędziach (per-edge radius)
- **Auto-suggest all edges** — ML-driven suggester na bazie typu modelu
- **Wall thickness analysis** — wykrywanie zbyt cienkich ścianek
- **Overhang analysis** — wykrywanie kątów wymagających wsparć
- **Print orientation preview** — podpowiedzi jak ustawić model
- **Batch processing** — wiele plików naraz
- **API dla integratorów** — embed w innych serwisach

### 6.3. Faza 3 (long-term, 6-12 miesięcy)

- **Generowanie support structures** — podstawowe
- **Lattice infill generation** — lekkie struktury wewnętrzne
- **AR preview** — podgląd modelu w rzeczywistej skali
- **Direct print do Bambu / Prusa** — WebUSB / MQTT
- **Plugin marketplace** — community filters/presets
- **Mobile app** — natywne iOS/Android

---

## 7. UX/UI — kluczowe decyzje projektowe

### 7.1. Zasady projektowe

1. **„Zero wiedzy technicznej"** — terminologia ukryta za przyjaznymi nazwami. Zamiast „bevel width" → „Jak bardzo zaokrąglić".
2. **Live preview wszędzie** — każda zmiana parametru musi pokazać efekt natychmiast (lub po <500 ms).
3. **Auto-detect > manual** — domyślnie zaznacz wszystkie problematyczne krawędzie, user tylko potwierdza.
4. **Bezpieczne domyślne** — preset „Wytrzymałe" działa w 90% przypadków.
5. **Mobile-responsive** — viewer może być uproszczony, ale funkcjonalność core musi działać.

### 7.2. Konwencje wizualne

- **Kolory krawędzi:**
  - 🟦 Niebieski (default) — niezaznaczona
  - 🟨 Żółty — podświetlona po najechaniu (hover)
  - 🟧 Pomarańczowy — zaznaczona przez użytkownika
  - 🟪 Fioletowy — wykryta automatycznie (do potwierdzenia)
  - 🟩 Zielony — zaokrąglona (w podglądzie wyniku)

- **Ikony:**
  - ⬡ Hexagon — preset „Wytrzymałe"
  - ✨ Sparkle — preset „Estetyczne"
  - ⚡ Bolt — preset „Szybkie"
  - ⚙ Cog — preset „Custom"

---

## 8. Model biznesowy

### 8.1. Opcje monetyzacji

| Model | Opis | Plusy | Minusy |
|---|---|---|---|
| **Freemium** | 5 plików/mies. za darmo, powyżej płatne | Niski próg wejścia | Limity irytują |
| **Subscription** | $5-15/mies. unlimited | Przewidywalny przychód | Bariera wejścia |
| **Pay-per-use** | $0.10-0.50 per processing | Sprawiedliwe | Psychologiczna bariera |
| **Pro tier** | $20/mies. z zaawansowanymi funkcjami (variable radius, batch) | Dwa segmenty | Complexity |

**Rekomendacja:** Freemium + Pro tier.
- **Free:** 5 processingów/mies., podstawowe fillet/chamfer, max 50 MB
- **Pro ($12/mies.):** Unlimited, variable radius, wall analysis, batch, API

### 8.2. Projekcja kosztów (miesięcznie)

**Przy 1000 użytkowników, 50 płacących Pro ($12):**
- Przychód: $600/mies.
- Koszty cloud (VPS + bandwidth + storage): ~$100-200
- Koszty processing (CPU time): ~$50
- **Marża:** ~60-70% (typowe dla SaaS)

Skalowanie: każde 10× użytkowników → +$400 infra (głównie processing workers).

---

## 9. Roadmap wdrożenia

### Faza 0: Przygotowanie (tydzień 1-2)
- [ ] Wybór i provisioning infrastruktury
- [ ] Setup repo, CI/CD
- [ ] Design UI/UX w Figma (high-fidelity mockupy)
- [ ] Testy algorytmu MeshLib na 20+ realnych modelach

### Faza 1: MVP (tydzień 3-14)
- **Tydzień 3-4:** Backend skeleton (FastAPI + Redis + worker)
- **Tydzień 5-6:** Mesh processing pipeline (MeshLib)
- **Tydzień 7-9:** Frontend (React + Three.js)
- **Tydzień 10-11:** Integracja end-to-end
- **Tydzień 12-13:** QA, bugfixing, testy wydajności
- **Tydzień 14:** Beta launch (ProductHunt, Reddit r/3Dprinting)

### Faza 2: Iteracja (miesiąc 4-6)
- Zbieranie feedbacku
- Presety i auto-detect improvements
- Variable radius fillet
- Wall thickness analysis

### Faza 3: Skalowanie (miesiąc 7-12)
- Płatności (Stripe)
- Marketing content
- Integracje (Makeprintable, Printables)
- Mobile PWA

---

## 10. Ryzyka i mitygacje

| Ryzyko | Prawdopodobieństwo | Wpływ | Mitygacja |
|---|---|---|---|
| Algorytm fillet MeshLib nie radzi sobie z niektórymi meshami | Średnie | Wysoki | Fallback na voxel remeshing (Meshmixer-style) |
| Performance processing > 30 sek. dla dużych modeli | Średnie | Średni | Auto-decimate input mesh do rozsądnej rozdzielczości |
| Użytkownicy wgrywają zainfekowane pliki | Niskie | Wysoki (reputacja) | ClamAV scan, sandbox processing |
| Koszty cloud rosną szybciej niż przychody | Średnie | Średni | Auto-suspend darmowych kont po limicie, queue priority dla Pro |
| Konkurencja (Canva dla 3D?) | Niskie | Wysoki | First-mover advantage, nisza edge rounding |

---

## 11. Metryki sukcesu (KPIs)

### Faza 1 (3 miesiące po launch):
- 1 000 zarejestrowanych użytkowników
- 10 000 przetworzonych modeli
- Retention D7: >25%
- NPS: >40

### Faza 2 (6 miesięcy):
- 100 płacących Pro
- $1 200 MRR
- Retention D30: >15%

### Faza 3 (12 miesięcy):
- 10 000 użytkowników
- $10 000 MRR
- Integracja z min. 2 dużymi platformami (Thingiverse/Printables)

---

## 12. Załączniki

### 12.1. Glosariusz terminów

| Termin techniczny | Nazwa w UI | Opis |
|---|---|---|
| Edge | Krawędź | Linia styku dwóch ścianek |
| Vertex | Wierzchołek | Punkt, w którym spotykają się krawędzie |
| Fillet | Zaokrąglenie | Łuk okrągły na krawędzi |
| Chamfer | Ścięcie | Skośna płaszczyzna na krawędzi |
| Manifold | Zamknięta powierzchnia | Mesh, który reprezentuje pełny obiekt 3D |
| Non-manifold edge | Krawędź problematyczna | Krawędź, która uniemożliwia poprawny slicing |
| STL | Format pliku | Standard dla druku 3D (trójkąty + normalne) |
| 3MF | Format pliku | Nowoczesny format (XML, kolory, jednostki) |
| DfAM | Design for AM | Zasady projektowania pod druk 3D |
| FDM | Fused Deposition Modeling | Najpopularniejsza technologia druku 3D (plastik) |

### 12.2. Referencje (źródła research)

1. Pollen AM — „Fillets, Ribs & Edges in 3D Printing — DfAM" — pollen.am
2. BigRep — „Fillets vs. Chamfers in 3D Printed Parts" — bigrep.com
3. Markforged — „3D Printing Design Tips" — markforged.com
4. MeshLib Documentation — meshlib.io
5. Manifold3D GitHub (elalish/manifold) — github.com/elalish/manifold
6. three-mesh-bvh (gkjohnson) — github.com/gkjohnson/three-mesh-bvh
7. Blender 3D Print Toolbox — docs.blender.org
8. Meshmixer Tutorials — formlabs.com, sculpteo.com
9. Bambu Studio / PrusaSlicer documentation
10. meshoptimizer library — github.com/zeux/meshoptimizer

### 12.3. Konkurencja — szybkie porównanie

| Narzędzie | Web | Łatwe | Edge select | Bezel/fillet | Cena |
|---|---|---|---|---|---|
| **RoundEdge (ta apka)** | ✅ | ✅ | ✅ | ✅ | Free / $12msc |
| Blender | ❌ | ❌ | ✅ | ✅ | Free |
| Meshmixer | ❌ | ⚠️ | ⚠️ | ⚠️ (voxel) | Free (deprecated) |
| Fusion 360 | ❌ | ⚠️ | ✅ | ✅ (best) | $70/msc |
| Makeprintable | ✅ | ⚠️ | ❌ | ❌ (tylko repair) | Pay-per-use |
| 3DPrinterOS | ✅ | ⚠️ | ❌ | ❌ | Freemium |
| SelfCAD | ✅ | ⚠️ | ⚠️ | ✅ | $10/msc |

**Pozycjonowanie RoundEdge:** jedyne narzędzie webowe z selektywnym edge selection + fillet/chamfer, bez wymagania CAD-owej wiedzy.

---

**Koniec specyfikacji. Gotowe do przekazania zespołowi developerskiemu.**