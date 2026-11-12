"""
Weryfikacja krzyżowa: diagnostyka backendu (Python) musi zgadzać się co do liczby
z implementacją TypeScript użytą w przeglądarce (src/utils/meshTopology.ts).

Uruchomienie:  python scripts/verify_backend.py

Wartości oczekiwane zostały wyliczone przez implementację TypeScript i zapisane tutaj
jako "złoty wynik" — rozjazd oznacza, że któraś z implementacji się zmieniła.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import inspect, parse_stl, weld  # noqa: E402

EXPECTED = {
    "public/cube.stl": {
        "triangles": 12,
        "vertexCount": 8,
        "faceCount": 12,
        "edgeCount": 18,
        "isClosed": True,
        "boundaryEdgeCount": 0,
        "nonManifoldEdgeCount": 0,
        "eulerCharacteristic": 2,
        "connectedComponents": 1,
        "volume": 8000.0,
        "size": [20.0, 20.0, 20.0],
    },
    "public/pranie.stl": {
        "triangles": 260,
        "vertexCount": 138,
        "faceCount": 260,
        "edgeCount": 388,
        "isClosed": True,
        "boundaryEdgeCount": 0,
        "nonManifoldEdgeCount": 2,
        "eulerCharacteristic": 10,
        "connectedComponents": 4,
        "volume": 115707.3428,
        "size": [176.2233, 174.3419, 37.9005],
    },
}


def build(path: Path) -> dict:
    triangles = parse_stl(path.read_bytes())
    raw = [v for tri in triangles for v in tri]
    xs = [v[0] for v in raw]
    ys = [v[1] for v in raw]
    zs = [v[2] for v in raw]
    diag = math.dist((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))) or 1.0

    best = None
    for rel in (1e-6, 1e-5, 1e-4):
        vertices, remap = weld(raw, diag * rel)
        faces = []
        for i in range(len(triangles)):
            a, b, c = remap[3 * i], remap[3 * i + 1], remap[3 * i + 2]
            if a != b and b != c and c != a:
                faces.append((a, b, c))
        result = inspect(vertices, faces)
        result["triangles"] = len(triangles)
        if best is None or (
            result["boundaryEdgeCount"] == 0 and result["faceCount"] > 0
        ) or result["boundaryEdgeCount"] < best["boundaryEdgeCount"]:
            best = result
        if result["boundaryEdgeCount"] == 0 and result["faceCount"] > 0:
            break
    assert best is not None
    return best


def main() -> int:
    failures = 0
    for relative, expected in EXPECTED.items():
        actual = build(ROOT / relative)
        print(f"=== {relative}")
        for key, want in expected.items():
            got = actual[key]
            if isinstance(want, list):
                ok = all(abs(g - w) < 1e-3 for g, w in zip(got, want))
            elif isinstance(want, float):
                ok = abs(got - want) < 1e-3
            else:
                ok = got == want
            print(f"  {'OK ' if ok else 'BLAD'} {key}: {got!r} (oczekiwano {want!r})")
            if not ok:
                failures += 1
    print()
    print("Zgodne z implementacja TypeScript" if failures == 0 else f"Rozbieznosci: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
