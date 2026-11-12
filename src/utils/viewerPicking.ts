import * as THREE from 'three';
import type { MeshData } from './meshProcessing.ts';

export const MAX_DRAWN_EDGES = 60_000;

export function pointToSegmentDistance(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 0 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t));
}

export function pickEdgeIndex(
  baseMesh: MeshData,
  hit: THREE.Intersection,
): number | null {
  const faceIndex = hit.faceIndex;
  if (faceIndex === undefined || faceIndex === null) return null;
  const point = hit.point;
  let best = -1;
  let bestDist = Infinity;
  const face = [
    baseMesh.faces[3 * faceIndex],
    baseMesh.faces[3 * faceIndex + 1],
    baseMesh.faces[3 * faceIndex + 2],
  ];
  for (let k = 0; k < 3; k++) {
    const u = face[k];
    const v = face[(k + 1) % 3];
    const key = u < v ? u * baseMesh.vertexCount + v : v * baseMesh.vertexCount + u;
    const edgeIndex = baseMesh.edgeKeyToIndex.get(key);
    if (edgeIndex === undefined) continue;
    const e = baseMesh.edges[edgeIndex];
    const d = pointToSegmentDistance(
      point.x, point.y, point.z,
      baseMesh.positions[3 * e.v0], baseMesh.positions[3 * e.v0 + 1], baseMesh.positions[3 * e.v0 + 2],
      baseMesh.positions[3 * e.v1], baseMesh.positions[3 * e.v1 + 1], baseMesh.positions[3 * e.v1 + 2],
    );
    if (d < bestDist) { bestDist = d; best = edgeIndex; }
  }
  if (best < 0) return null;
  const maxDim = Math.max(
    baseMesh.bboxMax[0] - baseMesh.bboxMin[0],
    baseMesh.bboxMax[1] - baseMesh.bboxMin[1],
    baseMesh.bboxMax[2] - baseMesh.bboxMin[2],
  ) || 1;
  return bestDist > maxDim * 0.35 ? null : best;
}

export function buildEdgeLines(
  baseMesh: MeshData,
  selectedEdges: Set<number>,
  hoveredEdge: number | null,
  sharpThresholdDeg: number,
  showAllEdges: boolean,
): THREE.LineSegments | null {
  const threshold = (sharpThresholdDeg * Math.PI) / 180;
  const visible: number[] = [];
  for (const e of baseMesh.edges) {
    if (e.faces.length !== 2) continue;
    const selected = selectedEdges.has(e.index);
    const hovered = hoveredEdge === e.index;
    const sharp = e.normalAngle >= threshold;
    if (showAllEdges || sharp || selected || hovered) visible.push(e.index);
  }
  if (visible.length === 0) return null;
  const step = visible.length > MAX_DRAWN_EDGES ? Math.ceil(visible.length / MAX_DRAWN_EDGES) : 1;
  const points: number[] = [];
  const colors: number[] = [];
  const colDefault = new THREE.Color(0x2c313b);
  const colSharp = new THREE.Color(0x7c5cff);
  const colSelected = new THREE.Color(0xff6b4a);
  const colHover = new THREE.Color(0xffd043);
  for (let i = 0; i < visible.length; i += step) {
    const e = baseMesh.edges[visible[i]];
    const a = 3 * e.v0;
    const b = 3 * e.v1;
    points.push(
      baseMesh.positions[a], baseMesh.positions[a + 1], baseMesh.positions[a + 2],
      baseMesh.positions[b], baseMesh.positions[b + 1], baseMesh.positions[b + 2],
    );
    const selected = selectedEdges.has(e.index);
    const hovered = hoveredEdge === e.index;
    const col = hovered ? colHover : selected ? colSelected : e.normalAngle >= threshold ? colSharp : colDefault;
    colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const lines = new THREE.LineSegments(geom, mat);
  lines.scale.setScalar(1.0008);
  return lines;
}
