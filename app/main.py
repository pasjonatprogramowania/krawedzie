"""
RoundEdge — opcjonalny serwis pomocniczy (FastAPI).

WAŻNE — podział odpowiedzialności:
  * ZAOKRĄGLANIE KRAWĘDZI odbywa się w 100% w przeglądarce
    (src/utils/edgeRounding.ts — analityczny fillet toczny, patrz README).
    Ten serwis NIE przetwarza geometrii i celowo zwraca 501 dla /api/process.
    Poprzednia wersja tego pliku zwracała niezmodyfikowany plik jako "wynik
    przetwarzania", co było mylące — nie robimy tak.
  * Serwis udostępnia za to PRAWDZIWĄ walidację i diagnostykę siatki
    (/api/inspect), zaimplementowaną w czystym Pythonie (bez MeshLib, bez
    zależności binarnych), zgodną z diagnostyką w przeglądarce.

Uruchomienie:
    pip install fastapi uvicorn python-multipart
    python -m app.main        # http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import math
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.geometry import Vector, inspect, parse_stl, weld

app = FastAPI(title="RoundEdge API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Endpointy
# --------------------------------------------------------------------------- #
@app.get("/api/health")
async def health_check() -> dict:
    return {
        "status": "healthy",
        "version": "2.0",
        "roundingEngine": "browser (TypeScript, src/utils/edgeRounding.ts)",
        "meshLibAvailable": False,
        "endpoints": {
            "/api/health": "stan serwisu",
            "/api/inspect": "POST STL -> diagnostyka gotowości do druku",
            "/api/process": "501 — zaokrąglanie odbywa się w przeglądarce",
        },
    }


@app.post("/api/inspect")
async def inspect_mesh(file: UploadFile = File(...)) -> dict:
    """Rzeczywista walidacja siatki (bez modyfikowania geometrii)."""
    if not file.filename or not file.filename.lower().endswith(".stl"):
        raise HTTPException(
            status_code=400, detail="Obsługiwane są pliki STL (binarne i ASCII)."
        )

    data = await file.read()
    if len(data) < 84:
        raise HTTPException(
            status_code=400, detail="Plik jest za mały, by być poprawnym STL."
        )

    try:
        triangles = parse_stl(data)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Nie udało się sparsować STL: {exc}"
        ) from exc
    if not triangles:
        raise HTTPException(
            status_code=400, detail="Plik nie zawiera żadnych trójkątów."
        )

    raw_vertices: List[Vector] = [v for tri in triangles for v in tri]
    xs = [v[0] for v in raw_vertices]
    ys = [v[1] for v in raw_vertices]
    zs = [v[2] for v in raw_vertices]
    diag = math.dist((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))) or 1.0

    # Eskalacja tolerancji weldu: przyjmij pierwszą, która domyka siatkę.
    best = None
    for rel in (1e-6, 1e-5, 1e-4):
        tolerance = diag * rel
        vertices, remap = weld(raw_vertices, tolerance)
        faces = []
        for i in range(len(triangles)):
            a, b, c = remap[3 * i], remap[3 * i + 1], remap[3 * i + 2]
            if a != b and b != c and c != a:
                faces.append((a, b, c))
        result = inspect(vertices, faces)
        result["weldTolerance"] = tolerance
        result["rawVertexCount"] = len(raw_vertices)
        result["weldedVertexCount"] = len(raw_vertices) - len(vertices)
        result["degenerateFacesRemoved"] = len(triangles) - len(faces)
        if (
            best is None
            or (result["boundaryEdgeCount"] == 0 and result["faceCount"] > 0)
            or result["boundaryEdgeCount"] < best["boundaryEdgeCount"]
        ):
            best = result
        if result["boundaryEdgeCount"] == 0 and result["faceCount"] > 0:
            break

    assert best is not None
    return best


@app.post("/api/process")
async def process_mesh() -> dict:
    """
    Celowo niezaimplementowane.

    Zaokrąglanie krawędzi jest operacją czysto geometryczną i działa w przeglądarce
    (src/utils/edgeRounding.ts). Zwracanie tutaj niezmodyfikowanego pliku jako
    "przetworzonego" byłoby wprowadzaniem użytkownika w błąd.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "Zaokrąglanie krawędzi działa w całości w przeglądarce (bez wysyłania modelu). "
            "Użyj interfejsu RoundEdge: wczytaj model, zaznacz krawędzie i pobierz STL. "
            "Ten endpoint służy wyłącznie do diagnostyki — zobacz /api/inspect."
        ),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
