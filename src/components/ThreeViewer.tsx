import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../utils/meshProcessing.ts';
import { meshToGeometry } from '../utils/meshProcessing.ts';

interface ThreeViewerProps {
  theme: 'dark' | 'light';
  /** Siatka oryginalna (służy do selekcji krawędzi i kadrowania kamery). */
  baseMesh: MeshData | null;
  /** Siatka aktualnie wyświetlana (przed lub po zaokrągleniu). */
  shownMesh: MeshData | null;
  /** Opcjonalny "duch" drugiej siatki (tryb porównania). */
  overlayMesh: MeshData | null;
  selectedEdges: Set<number>;
  hoveredEdge: number | null;
  onToggleEdge: (edgeIndex: number) => void;
  onHoverEdge: (edgeIndex: number | null) => void;
  sharpThreshold: number;
  showAllEdges: boolean;
}

const MAX_DRAWN_EDGES = 60_000;

/**
 * Interaktywny podglądem 3D. Geometria jest przebudowywana przy każdej zmianie
 * OBIEKTU siatki (nie tylko pozycji) — po zaokrągleniu liczba trójkątów i wierzchołków
 * rośnie, więc aktualizacja "w miejscu" bufora pozycji jest niepoprawna.
 */
export const ThreeViewer: React.FC<ThreeViewerProps> = ({
  theme,
  baseMesh,
  shownMesh,
  overlayMesh,
  selectedEdges,
  hoveredEdge,
  onToggleEdge,
  onHoverEdge,
  sharpThreshold,
  showAllEdges,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pickRef = useRef<THREE.Mesh | null>(null);
  const overlayRef = useRef<THREE.Mesh | null>(null);
  const edgesLineRef = useRef<THREE.LineSegments | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const fittedMeshRef = useRef<MeshData | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const mouseRef = useRef(new THREE.Vector2());

  // --- Scena, kamera, światła, pętla renderowania -----------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100_000);
    camera.position.set(0, 0, 100);
    cameraRef.current = camera;
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(1, 1, 1);
    camera.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7c5cff, 0.9);
    fillLight.position.set(-1, -0.5, -1);
    camera.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x00d4aa, 0.7);
    rimLight.position.set(0, -1, -0.5);
    camera.add(rimLight);

    raycasterRef.current = new THREE.Raycaster();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(container);

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // --- Siatka wyświetlana -----------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) { scene.remove(meshRef.current); meshRef.current.geometry.dispose(); meshRef.current = null; }
    if (overlayRef.current) { scene.remove(overlayRef.current); overlayRef.current.geometry.dispose(); overlayRef.current = null; }

    if (!shownMesh || shownMesh.faceCount === 0) return;

    const geometry = meshToGeometry(shownMesh);
    const material = new THREE.MeshStandardMaterial({
      color: theme === 'dark' ? 0x9aa6bb : 0x475569,
      roughness: 0.55,
      metalness: 0.08,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    if (overlayMesh && overlayMesh.faceCount > 0) {
      const oGeom = meshToGeometry(overlayMesh);
      const oMat = new THREE.MeshBasicMaterial({
        color: 0xff6b4a,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      const oMesh = new THREE.Mesh(oGeom, oMat);
      scene.add(oMesh);
      overlayRef.current = oMesh;
    }
  }, [shownMesh, overlayMesh, theme]);

  // --- Siatka do raycastingu (zawsze oryginał) + siatka pomocnicza ------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (pickRef.current) { scene.remove(pickRef.current); pickRef.current.geometry.dispose(); pickRef.current = null; }
    if (gridRef.current) { scene.remove(gridRef.current); gridRef.current = null; }
    if (!baseMesh || baseMesh.faceCount === 0) return;

    const pickGeometry = meshToGeometry(baseMesh);
    const pickMesh = new THREE.Mesh(pickGeometry, new THREE.MeshBasicMaterial());
    pickMesh.visible = false;
    scene.add(pickMesh);
    pickRef.current = pickMesh;

    const size: [number, number, number] = [
      baseMesh.bboxMax[0] - baseMesh.bboxMin[0],
      baseMesh.bboxMax[1] - baseMesh.bboxMin[1],
      baseMesh.bboxMax[2] - baseMesh.bboxMin[2],
    ];
    const center = new THREE.Vector3(
      (baseMesh.bboxMax[0] + baseMesh.bboxMin[0]) / 2,
      (baseMesh.bboxMax[1] + baseMesh.bboxMin[1]) / 2,
      (baseMesh.bboxMax[2] + baseMesh.bboxMin[2]) / 2,
    );
    const maxDim = Math.max(size[0], size[1], size[2]) || 1;

    const gridColor = theme === 'dark' ? 0x242436 : 0xcbd5e1;
    const grid = new THREE.GridHelper(maxDim * 4, 40, gridColor, gridColor);
    grid.position.set(center.x, baseMesh.bboxMin[1] - maxDim * 0.02, center.z);
    scene.add(grid);
    gridRef.current = grid;

    if (fittedMeshRef.current !== baseMesh) {
      controls.target.copy(center);
      camera.position.set(center.x + maxDim * 1.3, center.y + maxDim * 1.3, center.z + maxDim * 1.3);
      camera.lookAt(center);
      camera.near = Math.max(maxDim * 0.001, 0.01);
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = maxDim * 0.05;
      controls.maxDistance = maxDim * 12;
      controls.update();
      fittedMeshRef.current = baseMesh;
    }
  }, [baseMesh, theme]);

  // --- Rysowanie krawędzi -----------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !baseMesh) return;
    if (edgesLineRef.current) {
      scene.remove(edgesLineRef.current);
      edgesLineRef.current.geometry.dispose();
      edgesLineRef.current = null;
    }

    const threshold = (sharpThreshold * Math.PI) / 180;
    const visible: number[] = [];
    for (const e of baseMesh.edges) {
      if (e.faces.length !== 2) continue;
      const selected = selectedEdges.has(e.index);
      const hovered = hoveredEdge === e.index;
      const sharp = e.normalAngle >= threshold;
      if (showAllEdges || sharp || selected || hovered) visible.push(e.index);
    }
    if (visible.length === 0) return;

    const step = visible.length > MAX_DRAWN_EDGES ? Math.ceil(visible.length / MAX_DRAWN_EDGES) : 1;
    const points: number[] = [];
    const colors: number[] = [];

    const colDefault = new THREE.Color(theme === 'dark' ? 0x2f3550 : 0xcbd5e1);
    const colSharp = new THREE.Color(theme === 'dark' ? 0x4b5a86 : 0x94a3b8);
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
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geom, mat);
    // Delikatne odsunięcie od powierzchni, aby uniknąć Z-fightingu.
    lines.scale.setScalar(1.0008);
    scene.add(lines);
    edgesLineRef.current = lines;
  }, [baseMesh, selectedEdges, hoveredEdge, sharpThreshold, showAllEdges, theme]);

  // --- Selekcja krawędzi przez raycast ---------------------------------------
  const pickEdge = useCallback((clientX: number, clientY: number): number | null => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const pickMesh = pickRef.current;
    const raycaster = raycasterRef.current;
    if (!renderer || !camera || !pickMesh || !raycaster || !baseMesh) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseRef.current, camera);
    const hits = raycaster.intersectObject(pickMesh, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const faceIndex = hit.faceIndex;
    if (faceIndex === undefined || faceIndex === null) return null;
    const point = hit.point;

    // Trzy krawędzie trafionej ściany — wybieramy najbliższą punktowi kliknięcia.
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
    // Zbyt daleko od żadnej krawędzi -> traktujemy jak kliknięcie w tło.
    if (bestDist > maxDim * 0.35) return null;
    return best;
  }, [baseMesh]);

  const handleMouseMove = (e: React.MouseEvent) => {
    onHoverEdge(pickEdge(e.clientX, e.clientY));
  };

  const handleClick = (e: React.MouseEvent) => {
    const edge = pickEdge(e.clientX, e.clientY);
    if (edge !== null) onToggleEdge(edge);
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-crosshair overflow-hidden"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onMouseLeave={() => onHoverEdge(null)}
    >
      <div className={`absolute bottom-4 right-4 text-[10px] font-mono pointer-events-none select-none px-2 py-1 rounded border backdrop-blur-sm ${
        theme === 'dark'
          ? 'text-accent-teal/60 bg-[#0a0a0f]/60 border-accent-teal/20'
          : 'text-indigo-600/70 bg-white/70 border-slate-200'
      }`}>
        LPM: zaznacz krawędź | Przeciągnij: obrót | Scroll: zoom
      </div>
    </div>
  );
};

function pointToSegmentDistance(
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
