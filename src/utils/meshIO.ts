/**
 * RoundEdge — wczytywanie geometrii i przygotowanie siatki do przetwarzania.
 *
 * Kolejność operacji (potwierdzona researchem — kolejność ma znaczenie!):
 *   1. spłaszczenie do "zupy trójkątów" (bez atrybutów normal/uv — inaczej welding
 *      nie scala wierzchołków, bo hash obejmuje wszystkie atrybuty),
 *   2. tolerancyjny welding spatial-hashem (27 komórek; bez aliasingu kubełków),
 *   3. budowa topologii + klasyfikacja krawędzi,
 *   4. naprawa niespójnego windingu (BFS po sąsiedztwie ścian + korekta znaku objętości),
 *   5. pełna diagnostyka gotowości do druku.
 */

import * as THREE from 'three';
import type { MeshData, MeshDiagnostics } from './meshTypes.ts';
import {
  buildTopology,
  computeDiagnostics,
  orientFacesConsistently,
  signedVolume,
  weldTriangleSoup,
} from './meshTopology.ts';

export interface MeshBuildOptions {
  /** Tolerancje weldu jako ułamki przekątnej bbox (od najostrzejszej). */
  weldTolerances?: number[];
  /** Naprawa niespójnego windingu (domyślnie tak). */
  repairOrientation?: boolean;
}

export interface MeshBuildResult {
  mesh: MeshData;
  diagnostics: MeshDiagnostics;
  /** Użyta tolerancja weldu w jednostkach modelu. */
  weldTolerance: number;
  rawVertexCount: number;
  orientationRepaired: boolean;
  /** Obiekt three.js zbudowany z wynikowej siatki (indeksowany, bez normalnych). */
  geometry: THREE.BufferGeometry;
}

const DEFAULT_TOLERANCES = [1e-6, 1e-5, 1e-4];

/** Wyciąga pozycje i opcjonalne indeksy z BufferGeometry (bez normalnych/UV). */
export function extractGeometryData(geometry: THREE.BufferGeometry): {
  positions: Float64Array;
  indices: Int32Array | null;
} {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Geometria nie ma atrybutu "position".');
  const count = position.count;
  const positions = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[3 * i] = position.getX(i);
    positions[3 * i + 1] = position.getY(i);
    positions[3 * i + 2] = position.getZ(i);
  }
  const index = geometry.getIndex();
  let indices: Int32Array | null = null;
  if (index) {
    indices = new Int32Array(index.count);
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  }
  return { positions, indices };
}

/**
 * Spłaszcza Object3D (np. grupę z 3MF/OBJ) do jednej zupy trójkątów
 * z uwzględnieniem transformacji świata. Zwraca null, gdy brak geometrii.
 */
export function objectToTriangleSoup(object: THREE.Object3D): {
  positions: Float64Array;
  indices: Int32Array | null;
} | null {
  object.updateWorldMatrix(true, true);
  const chunks: Float64Array[] = [];
  const indexChunks: number[] = [];
  let vertexOffset = 0;

  object.traverse((child) => {
    const asMesh = child as THREE.Mesh;
    if (!asMesh.isMesh || !asMesh.geometry) return;
    const geom = asMesh.geometry as THREE.BufferGeometry;
    const data = extractGeometryData(geom);
    const v = new THREE.Vector3();
    for (let i = 0; i < data.positions.length / 3; i++) {
      v.set(data.positions[3 * i], data.positions[3 * i + 1], data.positions[3 * i + 2]);
      v.applyMatrix4(asMesh.matrixWorld);
      data.positions[3 * i] = v.x;
      data.positions[3 * i + 1] = v.y;
      data.positions[3 * i + 2] = v.z;
    }
    chunks.push(data.positions);
    if (data.indices) {
      for (let i = 0; i < data.indices.length; i++) indexChunks.push(data.indices[i] + vertexOffset);
    } else {
      for (let i = 0; i < data.positions.length / 3; i++) indexChunks.push(i + vertexOffset);
    }
    vertexOffset += data.positions.length / 3;
  });

  if (chunks.length === 0) return null;
  const totalVertices = chunks.reduce((s, c) => s + c.length, 0);
  const positions = new Float64Array(totalVertices);
  let cursor = 0;
  for (const c of chunks) { positions.set(c, cursor); cursor += c.length; }
  return { positions, indices: Int32Array.from(indexChunks) };
}

/** Buduje w pełni zwalidowaną siatkę z surowych pozycji (z tolerancyjnym weldingiem). */
export function buildMeshFromRaw(
  rawPositions: Float64Array,
  rawIndices: Int32Array | null,
  options: MeshBuildOptions = {},
): MeshBuildResult {
  const tolerances = options.weldTolerances ?? DEFAULT_TOLERANCES;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < rawPositions.length / 3; i++) {
    const x = rawPositions[3 * i], y = rawPositions[3 * i + 1], z = rawPositions[3 * i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;

  // Tolerancyjny welding z eskalacją: przyjmij pierwszą tolerancję, która daje
  // siatkę domkniętą. Jeśli żadna — weź tę o najmniejszej liczbie krawędzi brzegowych.
  interface WeldCandidate {
    mesh: MeshData;
    tol: number;
    degenerate: number;
    duplicate: number;
    rawCount: number;
  }
  let best: WeldCandidate | null = null;
  let fallback: WeldCandidate | null = null;
  for (const rel of tolerances) {
    const tol = diag * rel;
    const welded = weldTriangleSoup(rawPositions, tol, rawIndices ?? undefined);
    const mesh = buildTopology(welded.positions, welded.faces, {
      stats: {
        degenerateFacesRemoved: welded.degenerateFacesRemoved,
        duplicateFacesRemoved: welded.duplicateFacesRemoved,
      },
    });
    const entry = {
      mesh,
      tol,
      degenerate: welded.degenerateFacesRemoved,
      duplicate: welded.duplicateFacesRemoved,
      rawCount: welded.rawVertexCount,
    };
    if (!fallback) fallback = entry;
    if (mesh.boundaryEdgeCount === 0 && mesh.faceCount > 0) {
      best = entry;
      break;
    }
    if (!best || mesh.boundaryEdgeCount < best.mesh.boundaryEdgeCount) best = entry;
  }
  const picked = best ?? fallback!;

  // Naprawa orientacji: niespójne nawinięcie lub globalnie odwrócony model.
  let mesh = picked.mesh;
  let repaired = false;
  if (options.repairOrientation ?? true) {
    const vol = signedVolume(mesh);
    if (mesh.inconsistentWindingCount > 0 || (mesh.faceCount > 0 && Number.isFinite(vol) && vol < 0)) {
      const fixed = orientFacesConsistently(mesh);
      if (fixed !== mesh) { mesh = fixed; repaired = true; }
    }
  }

  const diagnostics = computeDiagnostics(mesh, {
    rawVertexCount: picked.rawCount,
    degenerateFacesRemoved: picked.degenerate,
    duplicateFacesRemoved: picked.duplicate,
  });

  return {
    mesh,
    diagnostics,
    weldTolerance: picked.tol,
    rawVertexCount: picked.rawCount,
    orientationRepaired: repaired,
    geometry: meshToGeometry(mesh),
  };
}

/** Buduje zwalidowaną siatkę z BufferGeometry (pojedynczej). */
export function buildMeshFromGeometry(
  geometry: THREE.BufferGeometry,
  options: MeshBuildOptions = {},
): MeshBuildResult {
  const data = extractGeometryData(geometry);
  return buildMeshFromRaw(data.positions, data.indices, options);
}

/** Konwertuje MeshData do indeksowanej BufferGeometry (pozycje float32). */
export function meshToGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount * 3; i++) positions[i] = mesh.positions[i];
  const indices = new Uint32Array(mesh.faceCount * 3);
  for (let i = 0; i < mesh.faceCount * 3; i++) indices[i] = mesh.faces[i];
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Konwertuje MeshData do nieindeksowanej geometrii (płaskie ściany, zgodnie z STL). */
export function meshToFlatGeometry(mesh: MeshData): THREE.BufferGeometry {
  const positions = new Float32Array(mesh.faceCount * 9);
  let cursor = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.faces[3 * f + k];
      positions[cursor++] = mesh.positions[3 * v];
      positions[cursor++] = mesh.positions[3 * v + 1];
      positions[cursor++] = mesh.positions[3 * v + 2];
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
