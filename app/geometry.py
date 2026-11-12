"""
RoundEdge — czysta geometria i diagnostyka siatki (bez zależności zewnętrznych).

Moduł jest celowo oddzielony od app/main.py: importuje WYŁĄCZNIE bibliotekę
standardową Pythona, dzięki czemu skrypty kontrolne (np. scripts/verify_backend.py)
działają bez FastAPI i bez `pip install`.
"""

from __future__ import annotations

import math
import struct
from typing import Dict, List, Tuple

Vector = Tuple[float, float, float]


# --------------------------------------------------------------------------- #
# Wczytywanie STL (binarny + ASCII), bez zależności zewnętrznych
# --------------------------------------------------------------------------- #
def parse_binary_stl(data: bytes) -> List[Tuple[Vector, Vector, Vector]]:
    if len(data) < 84:
        raise ValueError("Plik jest za krótki na binarny STL.")
    (tri_count,) = struct.unpack_from("<I", data, 80)
    expected = 84 + tri_count * 50
    if expected > len(data):
        raise ValueError(
            f"Nagłówek deklaruje {tri_count} trójkątów ({expected} B), "
            f"a plik ma {len(data)} B."
        )
    triangles = []
    for i in range(tri_count):
        base = 84 + i * 50
        coords = struct.unpack_from("<12f", data, base)
        triangles.append(
            (
                (coords[3], coords[4], coords[5]),
                (coords[6], coords[7], coords[8]),
                (coords[9], coords[10], coords[11]),
            )
        )
    return triangles


def parse_ascii_stl(text: str) -> List[Tuple[Vector, Vector, Vector]]:
    triangles: List[Tuple[Vector, Vector, Vector]] = []
    current: List[Vector] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("vertex"):
            parts = stripped.split()
            if len(parts) < 4:
                raise ValueError(f"Niepoprawna linia 'vertex': {stripped!r}")
            current.append((float(parts[1]), float(parts[2]), float(parts[3])))
            if len(current) == 3:
                triangles.append((current[0], current[1], current[2]))
                current = []
    return triangles


def parse_stl(data: bytes) -> List[Tuple[Vector, Vector, Vector]]:
    head = data[:512].lstrip()
    looks_ascii = head[:5].lower() == b"solid" and b"facet" in data[:2048].lower()
    if looks_ascii:
        return parse_ascii_stl(data.decode("utf-8", errors="replace"))
    return parse_binary_stl(data)


# --------------------------------------------------------------------------- #
# Topologia: welding z siatką przestrzenną + diagnostyka
# --------------------------------------------------------------------------- #
def weld(vertices: List[Vector], tolerance: float) -> Tuple[List[Vector], List[int]]:
    """Scala wierzchołki bliższe niż `tolerance` (siatka 27 komórek)."""
    cell = max(tolerance, 1e-12)
    buckets: Dict[Tuple[int, int, int], List[int]] = {}
    unique: List[Vector] = []
    remap: List[int] = []

    def cell_of(v: float) -> int:
        return math.floor(v / cell)

    for vertex in vertices:
        cx, cy, cz = (cell_of(c) for c in vertex)
        found = -1
        best = tolerance * tolerance
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for idx in buckets.get((cx + dx, cy + dy, cz + dz), ()):
                        u = unique[idx]
                        d2 = (
                            (u[0] - vertex[0]) ** 2
                            + (u[1] - vertex[1]) ** 2
                            + (u[2] - vertex[2]) ** 2
                        )
                        if d2 <= best:
                            best = d2
                            found = idx
        if found < 0:
            found = len(unique)
            unique.append(vertex)
            buckets.setdefault((cx, cy, cz), []).append(found)
        remap.append(found)
    return unique, remap


def signed_volume(vertices: List[Vector], faces: List[Tuple[int, int, int]]) -> float:
    if not vertices:
        return 0.0
    cx = (min(v[0] for v in vertices) + max(v[0] for v in vertices)) / 2
    cy = (min(v[1] for v in vertices) + max(v[1] for v in vertices)) / 2
    cz = (min(v[2] for v in vertices) + max(v[2] for v in vertices)) / 2
    total = 0.0
    for a, b, c in faces:
        ax, ay, az = (vertices[a][0] - cx, vertices[a][1] - cy, vertices[a][2] - cz)
        bx, by, bz = (vertices[b][0] - cx, vertices[b][1] - cy, vertices[b][2] - cz)
        cxx, cyy, czz = (vertices[c][0] - cx, vertices[c][1] - cy, vertices[c][2] - cz)
        total += (
            ax * (by * czz - bz * cyy)
            - ay * (bx * czz - bz * cxx)
            + az * (bx * cyy - by * cxx)
        )
    return total / 6.0


def inspect(vertices: List[Vector], faces: List[Tuple[int, int, int]]) -> dict:
    edge_faces: Dict[Tuple[int, int], List[int]] = {}
    edge_dir: Dict[Tuple[int, int], int] = {}
    face_normals: List[Vector] = []
    areas: List[float] = []
    for f_index, (a, b, c) in enumerate(faces):
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        areas.append(length / 2)
        face_normals.append(
            (nx / length, ny / length, nz / length) if length else (0.0, 0.0, 0.0)
        )
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edge_faces.setdefault(key, []).append(f_index)
            edge_dir[key] = edge_dir.get(key, 0) + (1 if u < v else -1)

    boundary = sum(1 for f in edge_faces.values() if len(f) == 1)
    non_manifold = sum(1 for f in edge_faces.values() if len(f) > 2)
    bad_winding = 0
    edge_lengths: List[float] = []
    for key, fl in edge_faces.items():
        u, v = vertices[key[0]], vertices[key[1]]
        edge_lengths.append(math.dist(u, v))
        if len(fl) == 2 and edge_dir.get(key, 0) != 0:
            bad_winding += 1

    # Składowe spójności (po wierzchołkach).
    adjacency: Dict[int, List[int]] = {}
    for key in edge_faces:
        adjacency.setdefault(key[0], []).append(key[1])
        adjacency.setdefault(key[1], []).append(key[0])
    seen: set[int] = set()
    components = 0
    for start in range(len(vertices)):
        if start in seen:
            continue
        components += 1
        stack = [start]
        seen.add(start)
        while stack:
            node = stack.pop()
            for nb in adjacency.get(node, ()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)

    xs = [v[0] for v in vertices] or [0.0]
    ys = [v[1] for v in vertices] or [0.0]
    zs = [v[2] for v in vertices] or [0.0]
    size = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]

    volume = abs(signed_volume(vertices, faces))
    euler = len(vertices) - len(edge_faces) + len(faces)
    closed = boundary == 0 and bool(faces)
    manifold = non_manifold == 0

    warnings: List[str] = []
    if boundary:
        warnings.append(f"Siatka nie jest domknięta: {boundary} krawędzi brzegowych.")
    if non_manifold:
        warnings.append(f"Wykryto {non_manifold} krawędzi nie-rozmaitości.")
    if bad_winding:
        warnings.append(f"Niespójna orientacja {bad_winding} krawędzi.")
    if min(size) <= 0:
        warnings.append("Model jest płaski (jeden z wymiarów = 0).")
    if max(size) < 5:
        warnings.append(
            "Największy wymiar < 5 mm — sprawdź jednostki (STL ich nie przechowuje)."
        )
    if max(size) > 1000:
        warnings.append(
            "Największy wymiar > 1000 mm — upewnij się, że jednostką są milimetry."
        )

    return {
        "vertexCount": len(vertices),
        "faceCount": len(faces),
        "edgeCount": len(edge_faces),
        "isClosed": bool(closed),
        "isManifold": bool(manifold and closed),
        "boundaryEdgeCount": boundary,
        "nonManifoldEdgeCount": non_manifold,
        "inconsistentWindingCount": bad_winding,
        "eulerCharacteristic": euler,
        "connectedComponents": components,
        "volume": volume,
        "surfaceArea": sum(areas),
        "bboxMin": [min(xs), min(ys), min(zs)],
        "bboxMax": [max(xs), max(ys), max(zs)],
        "size": size,
        "minEdgeLength": min(edge_lengths) if edge_lengths else 0.0,
        "averageEdgeLength": (sum(edge_lengths) / len(edge_lengths))
        if edge_lengths
        else 0.0,
        "maxEdgeLength": max(edge_lengths) if edge_lengths else 0.0,
        "warnings": warnings,
    }
