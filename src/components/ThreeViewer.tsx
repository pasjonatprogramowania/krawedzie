import React, { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../utils/meshProcessing.ts';
import { meshToGeometry } from '../utils/meshProcessing.ts';
import { buildEdgeLines, pickEdgeIndex } from '../utils/viewerPicking.ts';

interface ThreeViewerProps {
  baseMesh: MeshData | null;
  shownMesh: MeshData | null;
  overlayMesh: MeshData | null;
  selectedEdges: Set<number>;
  hoveredEdge: number | null;
  onToggleEdge: (edgeIndex: number) => void;
  onHoverEdge: (edgeIndex: number | null) => void;
  sharpThreshold: number;
  showAllEdges: boolean;
}

/** Interaktywny podglad 3D: przebudowa geometrii przy kazdej zmianie obiektu siatki. */
export const ThreeViewer: React.FC<ThreeViewerProps> = ({
  baseMesh, shownMesh, overlayMesh, selectedEdges, hoveredEdge,
  onToggleEdge, onHoverEdge, sharpThreshold, showAllEdges,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pickRef = useRef<THREE.Mesh | null>(null);
  const overlayRef = useRef<THREE.Mesh | null>(null);
  const edgesRef = useRef<THREE.LineSegments | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const fittedRef = useRef<MeshData | null>(null);
  const rayRef = useRef<THREE.Raycaster | null>(null);
  const mouseRef = useRef(new THREE.Vector2());

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
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(1, 1, 1); camera.add(key);
    const fill = new THREE.DirectionalLight(0x4da3ff, 0.55); fill.position.set(-1, -0.5, -1); camera.add(fill);
    const rim = new THREE.DirectionalLight(0xe7e9ee, 0.45); rim.position.set(0, -1, -0.5); camera.add(rim);
    rayRef.current = new THREE.Raycaster();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (!width || !height) continue;
        camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
      }
    });
    ro.observe(container);
    let id = 0;
    const loop = () => { id = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    return () => { cancelAnimationFrame(id); ro.disconnect(); controls.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement); };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (meshRef.current) { scene.remove(meshRef.current); meshRef.current.geometry.dispose(); meshRef.current = null; }
    if (overlayRef.current) { scene.remove(overlayRef.current); overlayRef.current.geometry.dispose(); overlayRef.current = null; }
    if (!shownMesh || shownMesh.faceCount === 0) return;
    const geometry = meshToGeometry(shownMesh);
    meshRef.current = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa6bb, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide, flatShading: true }));
    scene.add(meshRef.current);
    if (overlayMesh && overlayMesh.faceCount > 0) {
      overlayRef.current = new THREE.Mesh(meshToGeometry(overlayMesh), new THREE.MeshBasicMaterial({ color: 0xffb454, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }));
      scene.add(overlayRef.current);
    }
  }, [shownMesh, overlayMesh]);

  useEffect(() => {
    const scene = sceneRef.current, camera = cameraRef.current, controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (pickRef.current) { scene.remove(pickRef.current); pickRef.current.geometry.dispose(); pickRef.current = null; }
    if (gridRef.current) { scene.remove(gridRef.current); gridRef.current = null; }
    if (!baseMesh || baseMesh.faceCount === 0) return;
    const pick = new THREE.Mesh(meshToGeometry(baseMesh), new THREE.MeshBasicMaterial()); pick.visible = false; scene.add(pick); pickRef.current = pick;
    const maxDim = Math.max(baseMesh.bboxMax[0] - baseMesh.bboxMin[0], baseMesh.bboxMax[1] - baseMesh.bboxMin[1], baseMesh.bboxMax[2] - baseMesh.bboxMin[2]) || 1;
    const center = new THREE.Vector3((baseMesh.bboxMax[0] + baseMesh.bboxMin[0]) / 2, (baseMesh.bboxMax[1] + baseMesh.bboxMin[1]) / 2, (baseMesh.bboxMax[2] + baseMesh.bboxMin[2]) / 2);
    const grid = new THREE.GridHelper(maxDim * 4, 40, 0x2c313b, 0x2c313b); grid.position.set(center.x, baseMesh.bboxMin[1] - maxDim * 0.02, center.z); scene.add(grid); gridRef.current = grid;
    if (fittedRef.current !== baseMesh) {
      controls.target.copy(center);
      camera.position.set(center.x + maxDim * 1.3, center.y + maxDim * 1.3, center.z + maxDim * 1.3);
      camera.near = Math.max(maxDim * 0.001, 0.01); camera.far = maxDim * 100; camera.updateProjectionMatrix();
      controls.minDistance = maxDim * 0.05; controls.maxDistance = maxDim * 12; controls.update(); fittedRef.current = baseMesh;
    }
  }, [baseMesh]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !baseMesh) return;
    if (edgesRef.current) { scene.remove(edgesRef.current); edgesRef.current.geometry.dispose(); edgesRef.current = null; }
    const lines = buildEdgeLines(baseMesh, selectedEdges, hoveredEdge, sharpThreshold, showAllEdges);
    if (lines) { scene.add(lines); edgesRef.current = lines; }
  }, [baseMesh, selectedEdges, hoveredEdge, sharpThreshold, showAllEdges]);

  const pickEdge = useCallback((clientX: number, clientY: number): number | null => {
    const renderer = rendererRef.current, camera = cameraRef.current, pick = pickRef.current, ray = rayRef.current;
    if (!renderer || !camera || !pick || !ray || !baseMesh) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouseRef.current, camera);
    const hits = ray.intersectObject(pick, false);
    return hits.length ? pickEdgeIndex(baseMesh, hits[0]) : null;
  }, [baseMesh]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-crosshair overflow-hidden"
      onMouseMove={(e) => onHoverEdge(pickEdge(e.clientX, e.clientY))}
      onClick={(e) => { const edge = pickEdge(e.clientX, e.clientY); if (edge !== null) onToggleEdge(edge); }}
      onMouseLeave={() => onHoverEdge(null)}
    />
  );
};
