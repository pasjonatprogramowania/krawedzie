import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMeshFromRaw,
  roundEdges,
  signedVolume,
} from '../src/utils/meshProcessing.ts';
import type { MeshData } from '../src/utils/meshProcessing.ts';
import { makeBox, makeLShape, bboxOf, manifoldReport, volumeOf } from './helpers.ts';

/** Odległość punktu od prostopadłościanu [−hx,hx]x[−hy,hy]x[−hz,hz]. */
function distanceToBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
  const dx = Math.max(Math.abs(x) - hx, 0);
  const dy = Math.max(Math.abs(y) - hy, 0);
  const dz = Math.max(Math.abs(z) - hz, 0);
  return Math.hypot(dx, dy, dz);
}

/** Ostre krawędzie sześcianu (12 krawędzi x subdiv segmentów, kąt 90 stopni). */
function cubeEdges(mesh: MeshData) {
  return mesh.edges.filter((e) => e.normalAngle > Math.PI / 4 && e.faces.length === 2);
}

function vertexAt(mesh: MeshData, i: number): [number, number, number] {
  return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
}

/** Znajduje wierzchołek wynikowy najbliższy zadanemu punktowi. */
function nearestVertexIndex(mesh: MeshData, p: [number, number, number]): number {
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const d = Math.hypot(
      mesh.positions[3 * v] - p[0],
      mesh.positions[3 * v + 1] - p[1],
      mesh.positions[3 * v + 2] - p[2],
    );
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

test('FILLET: sześcian 20mm, r=2, wszystkie 12 krawędzi — geometria dokładnego łuku', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh);
  assert.equal(edges.length, 12);

  const r = 2;
  const { mesh: result, report } = roundEdges(mesh, {
    radius: r,
    segments: 3,
    kind: 'fillet',
    edgeIndices: edges.map((e) => e.index),
  });

  // 1. Promień nie został przycięty.
  assert.ok(Math.abs(report.effectiveRadius - r) < 1e-12, `effectiveRadius=${report.effectiveRadius}`);
  assert.equal(report.processedEdgeCount, 12);
  assert.equal(report.skippedBoundaryEdgeCount, 0);
  assert.equal(report.skippedFlatEdgeCount, 0);

  // 2. Wynik pozostaje domkniętą rozmaitością, bez flipów i degeneratów.
  const report2 = manifoldReport(result.positions, Int32Array.from(result.faces));
  assert.equal(report2.closed, true, 'wynik musi być domkniętą rozmaitością');
  assert.equal(report2.nonManifold, 0);
  assert.equal(report2.boundary, 0);
  assert.equal(report.flippedFaceCount, 0, 'brak odwróconych trójkątów');
  assert.equal(report.degenerateFaceCount, 0, 'brak zdegenerowanych trójkątów');

  // 3. WYMIARY: bbox pozostaje dokładnie 20 x 20 x 20 (płaszczyzny ścian zachowane).
  const bbox = bboxOf(result.positions);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(bbox.size[k] - 20) < 1e-9, `wymiar ${k} = ${bbox.size[k]}`);
    assert.ok(Math.abs(report.bboxDelta[k]) < 1e-9, `bboxDelta[${k}] = ${report.bboxDelta[k]}`);
  }

  // 4. TWARDY TEST GEOMETRYCZNY: zaokrąglony sześcian to suma Minkowskiego
  //    "wewnętrznego" sześcianu 16mm i kuli o promieniu r. Zatem KAŻDY wierzchołek
  //    powierzchni musi leżeć w odległości dokładnie r od wewnętrznego sześcianu.
  let maxErr = 0;
  for (let v = 0; v < result.vertexCount; v++) {
    const [x, y, z] = vertexAt(result, v);
    const d = distanceToBox(x, y, z, 10 - r, 10 - r, 10 - r);
    maxErr = Math.max(maxErr, Math.abs(d - r));
  }
  assert.ok(maxErr < 1e-6, `maksymalny błąd odległości od powierzchni filletu: ${maxErr}`);

  // 5. OBJĘTOŚĆ: wzór Steinera dla bryły = wewn. sześcian + kula r.
  const a = 20 - 2 * r;
  const expected = a ** 3 + 6 * a * a * r + 3 * Math.PI * a * r * r + (4 / 3) * Math.PI * r ** 3;
  const actual = Math.abs(signedVolume(result));
  assert.ok(
    actual <= expected + 1e-6,
    `siatka musi być wpisana w bryłę analityczną (${actual} > ${expected})`,
  );
  assert.ok(
    Math.abs(actual - expected) / expected < 0.01,
    `objętość ${actual} vs analityczna ${expected} (${((actual - expected) / expected * 100).toFixed(3)}%)`,
  );

  // 6. Ubytek objętości odpowiada polu przekroju łuku: r²(1 − π/4) ≈ 0.2146·r²
  //    na jednostkę długości krawędzi (z dokładnością aproksymacji chordalnej).
  const analyticLoss = 8000 - expected;
  assert.ok(8000 - actual > 0, 'zaokrąglenie wypukłych krawędzi musi zmniejszyć objętość');
  assert.ok(
    Math.abs((8000 - actual) - analyticLoss) / analyticLoss < 0.05,
    `ubytekW ${(8000 - actual).toFixed(2)} vs analityczny ${analyticLoss.toFixed(2)}`,
  );

  // 7. Przemieszczenie wierzchołka na środku krawędzi = (√2 − 1)·r (po dwusiecznej).
  const mid: [number, number, number] = [10, 0, 10]; // środek krawędzi x=10, z=10
  const idx = nearestVertexIndex(result, mid);
  const [px, py, pz] = vertexAt(result, idx);
  const disp = Math.hypot(px - mid[0], py - mid[1], pz - mid[2]);
  assert.ok(
    Math.abs(disp - (Math.SQRT2 - 1) * r) < 0.05,
    `przemieszczenie środka krawędzi = ${disp}, oczekiwane ${(Math.SQRT2 - 1) * r}`,
  );
  // Kierunek: po dwusiecznej w głąb materiału.
  assert.ok(px < 10 && pz < 10, `punkt powinien przesunąć się w głąb materiału (${px}, ${pz})`);

  // 8. Przemieszczenie wierzchołka narożnego = (√3 − 1)·r po przekątnej.
  const cornerIdx = nearestVertexIndex(result, [10, 10, 10]);
  const [cx, cy, cz] = vertexAt(result, cornerIdx);
  const cornerDisp = Math.hypot(cx - 10, cy - 10, cz - 10);
  assert.ok(
    Math.abs(cornerDisp - (Math.sqrt(3) - 1) * r) < 0.06,
    `przemieszczenie narożnika = ${cornerDisp}, oczekiwane ${(Math.sqrt(3) - 1) * r}`,
  );

  // 9. Twarda gwarancja: żaden wierzchołek nie przesunął się więcej niż r.
  assert.ok(report.maxDisplacement <= r + 1e-9, `maxDisplacement=${report.maxDisplacement}`);
});

test('FILLET: wierzchołki poza pasmem są BIT-IDENTYCZNE z wejściem', () => {
  const box = makeBox(40, 40, 40, 8);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh);
  assert.equal(edges.length, 12 * 8, 'oczekiwano 96 segmentów krawędzi sześcianu');
  const r = 3;

  const original = Float64Array.from(mesh.positions);
  const { mesh: result } = roundEdges(mesh, {
    radius: r,
    segments: 4,
    kind: 'fillet',
    edgeIndices: edges.map((e) => e.index),
  });

  // Siatka wynikowa zachowuje oryginalne indeksy wierzchołków (zagęszczanie tylko dodaje).
  assert.ok(result.vertexCount >= mesh.vertexCount);
  let unchangedFar = 0;
  let changedNear = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const ox = original[3 * v], oy = original[3 * v + 1], oz = original[3 * v + 2];
    // odległość od najbliższej zaznaczonej krawędzi sześcianu
    let d = Infinity;
    for (const e of edges) {
      d = Math.min(d, segmentDistance(ox, oy, oz,
        original[3 * e.v0], original[3 * e.v0 + 1], original[3 * e.v0 + 2],
        original[3 * e.v1], original[3 * e.v1 + 1], original[3 * e.v1 + 2]));
    }
    const same =
      result.positions[3 * v] === ox &&
      result.positions[3 * v + 1] === oy &&
      result.positions[3 * v + 2] === oz;
    if (d > r + 1e-9) {
      assert.ok(same, `wierzchołek ${v} w odległości ${d} od krawędzi został zmieniony`);
      unchangedFar++;
    } else if (!same) {
      changedNear++;
    }
  }
  assert.ok(unchangedFar > 100, `oczekiwano wielu niezmienionych wierzchołków, jest ${unchangedFar}`);
  assert.ok(changedNear > 0);
});

test('FILLET: zaznaczenie jednej krawędzi nie rusza pozostałych', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh);
  const only = edges[0];

  const { report } = roundEdges(mesh, {
    radius: 1,
    segments: 3,
    kind: 'fillet',
    edgeIndices: [only.index],
  });
  assert.equal(report.processedEdgeCount, 1);
  assert.ok(report.volumeChangePercent < 0, 'wypukła krawędź -> ubytek objętości');
  assert.ok(report.volumeChangePercent > -1, 'ubytku nie może być dużo');
});

test('FILLET na krawędzi WKLĘSŁEJ dodaje materiał (kształt L)', () => {
  const l = makeLShape(40, 20, 20);
  const { mesh } = buildMeshFromRaw(l.positions, l.indices);
  const concave = mesh.edges.filter((e) => !e.isConvex && e.faces.length === 2);
  assert.ok(concave.length >= 1);
  const vertical = concave.filter((e) => Math.abs(e.length - 20) < 1e-6);
  assert.ok(vertical.length >= 1, 'oczekiwano pionowej krawędzi wklęsłej');

  const before = Math.abs(signedVolume(mesh));
  const { mesh: result, report } = roundEdges(mesh, {
    radius: 3,
    segments: 4,
    kind: 'fillet',
    edgeIndices: vertical.map((e) => e.index),
  });

  const after = Math.abs(signedVolume(result));
  assert.ok(after > before, `wklęsłe zaokrąglenie musi dodać materiał (${before} -> ${after})`);
  assert.ok(report.volumeChangePercent > 0);
  const rep = manifoldReport(result.positions, Int32Array.from(result.faces));
  assert.equal(rep.closed, true);
  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);

  // Objętość dodana ≈ pole przekroju łuku wklęsłego * długość krawędzi
  // Dla 90 stopni: r²(1 − π/4) ≈ 0.2146 r², ale r=3 przy ścianie 20mm.
  const expectedGain = (Math.PI * 9 / 4 - 9 / 2) * 20; // (πr²/4 − r²/2)·L
  assert.ok(
    Math.abs(after - before - expectedGain) / expectedGain < 0.25,
    `przyrost ${after - before} vs oczekiwany ~${expectedGain}`,
  );
});

test('CHAMFER: sześcian, c=2 — płaszczyzna ścinająca 45 stopni', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh);
  const c = 2;

  const { mesh: result, report } = roundEdges(mesh, {
    radius: c,
    segments: 1,
    kind: 'chamfer',
    edgeIndices: edges.map((e) => e.index),
  });

  assert.equal(report.flippedFaceCount, 0);
  assert.equal(report.degenerateFaceCount, 0);
  const rep = manifoldReport(result.positions, Int32Array.from(result.faces));
  assert.equal(rep.closed, true);

  // Wymiary zachowane.
  const bbox = bboxOf(result.positions);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(bbox.size[k] - 20) < 1e-9);

  // Środek krawędzi przesuwa się o c/√2 po dwusiecznej.
  const mid: [number, number, number] = [10, 0, 10];
  const idx = nearestVertexIndex(result, mid);
  const [px, , pz] = vertexAt(result, idx);
  const disp = Math.hypot(px - 10, pz - 10);
  assert.ok(Math.abs(disp - c / Math.SQRT2) < 0.05, `przemieszczenie ${disp} vs ${c / Math.SQRT2}`);

  // Narożnik przesuwa się o c/√3.
  const cornerIdx = nearestVertexIndex(result, [10, 10, 10]);
  const [cx, cy, cz] = vertexAt(result, cornerIdx);
  const cornerDisp = Math.hypot(cx - 10, cy - 10, cz - 10);
  assert.ok(Math.abs(cornerDisp - c / Math.sqrt(3)) < 0.05, `narożnik ${cornerDisp} vs ${c / Math.sqrt(3)}`);

  // Objętość: ścięcie usuwa materiał, ale mniej niż pełny fillet o tym samym parametrze.
  assert.ok(report.volumeChangePercent < 0);
});

test('SAFETY: promień większy niż połowa najkrótszej krawędzi jest przycinany', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh);
  const { report } = roundEdges(mesh, {
    radius: 40,
    segments: 3,
    kind: 'fillet',
    edgeIndices: edges.map((e) => e.index),
  });
  // Najkrótsza krawędź w otoczeniu to 20mm (krawędzie sześcianu nie są wzorcowe dla
  // przekątnych 28.28mm, które są najkrótszymi NIE-wzorcowymi) -> limit 0.5*28.28 = 14.14.
  assert.ok(report.effectiveRadius < 40, 'promień musi zostać przycięty');
  assert.ok(report.warnings.some((w) => w.includes('ograniczony')), 'musi być ostrzeżenie');
  assert.ok(report.flippedFaceCount === 0);
  assert.ok(report.degenerateFaceCount === 0);
});

test('SAFETY: determinizm — dwa uruchomienia dają identyczny wynik', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edges = cubeEdges(mesh).map((e) => e.index);
  const opts = { radius: 2, segments: 3, kind: 'fillet' as const, edgeIndices: edges };
  const a = roundEdges(mesh, opts);
  const b = roundEdges(mesh, opts);
  assert.equal(a.mesh.vertexCount, b.mesh.vertexCount);
  assert.equal(a.mesh.faceCount, b.mesh.faceCount);
  for (let i = 0; i < a.mesh.positions.length; i++) {
    assert.equal(a.mesh.positions[i], b.mesh.positions[i], `pozycja ${i} różni się`);
  }
});

test('SAFETY: brak NaN/Infinity w wyniku', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const { mesh: result } = roundEdges(mesh, {
    radius: 2,
    segments: 3,
    kind: 'fillet',
    edgeIndices: cubeEdges(mesh).map((e) => e.index),
  });
  for (let i = 0; i < result.positions.length; i++) {
    assert.ok(Number.isFinite(result.positions[i]), `pozycja ${i} = ${result.positions[i]}`);
  }
});

test('FILLET: więcej segmentów = mniejsza odchyłka chordalna i większa objętość', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edgeIdx = cubeEdges(mesh).map((e) => e.index);
  const coarse = roundEdges(mesh, { radius: 2, segments: 2, kind: 'fillet', edgeIndices: edgeIdx });
  const fine = roundEdges(mesh, { radius: 2, segments: 8, kind: 'fillet', edgeIndices: edgeIdx });
  assert.ok(fine.report.chordDeviation < coarse.report.chordDeviation);
  assert.ok(fine.report.trianglesAfter > coarse.report.trianglesAfter);
  assert.ok(Math.abs(signedVolume(fine.mesh)) > Math.abs(signedVolume(coarse.mesh)));
  assert.ok(fine.report.flippedFaceCount === 0);
  assert.ok(fine.report.degenerateFaceCount === 0);
});

function segmentDistance(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 0 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t));
}

test('FILLET: objętość zbiega do wartości analitycznej wraz z liczbą segmentów', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edgeIdx = cubeEdges(mesh).map((e) => e.index);
  const r = 2;
  const a = 20 - 2 * r;
  const expected = a ** 3 + 6 * a * a * r + 3 * Math.PI * a * r * r + (4 / 3) * Math.PI * r ** 3;

  const errors: number[] = [];
  for (const segments of [2, 4, 8]) {
    const { mesh: res } = roundEdges(mesh, { radius: r, segments, kind: 'fillet', edgeIndices: edgeIdx });
    const v = Math.abs(signedVolume(res));
    assert.ok(v <= expected + 1e-6, 'siatka musi być wpisana w bryłę analityczną');
    errors.push((expected - v) / expected);
  }
  // Błąd aproksymacji łuku musi maleć ~jak 1/segments².
  assert.ok(errors[0] > errors[1] && errors[1] > errors[2], `błędy: ${errors.join(', ')}`);
  assert.ok(errors[2] < 0.0005, `błąd przy 8 segmentach: ${errors[2]}`);
});

test('FILLET: dowolny kąt dwuścienny — powierzchnia to łuk o promieniu r (nie elipsa)', () => {
  // Klin o kącie materiału theta w stopniach, r = 1. Idealny fillet to łuk okręgu
  // o promieniu r styczny do obu ścian; oś kuli leży w odległości r/sin(theta/2) od
  // krawędzi po dwusiecznej. Mierzymy odległość rho każdego wierzchołka wynikowej
  // powierzchni od tej osi — musi wynosić dokładnie r.
  //
  // UWAGA: dla kątów < 60° sam wierzchołek krawędzi musiałby się przesunąć o więcej
  // niż r (r/sin(theta/2) − r), a twardy limit |Δ| ≤ r tego zabrania — dlatego
  // dokładności żądamy dla 60°..150°, a kąty ostrzejsze mają osobny test bezpieczeństwa.
  for (const deg of [60, 75, 90, 105, 120, 135, 150]) {
    const theta = (deg * Math.PI) / 180;
    const r = 1;
    const h = 20;          // długość klina wzdłuż osi Z
    const L = 60;          // promieniowa długość ramion
    // Przekrój: krawędź w początku układu, materiał w klinie [-theta/2, +theta/2].
    const ux = Math.cos(theta / 2), uy = Math.sin(theta / 2);
    const profile: Array<[number, number]> = [
      [0, 0],
      [ux * L, uy * L],
      [ux * (L - 4), uy * (L - 4)],
      [Math.cos(-theta / 2) * 4, Math.sin(-theta / 2) * 4],
      [Math.cos(-theta / 2) * L, Math.sin(-theta / 2) * L],
    ];
    const positions: number[] = [];
    const indices: number[] = [];
    const pushVertex = (x: number, y: number, z: number) => {
      positions.push(x, y, z);
      return positions.length / 3 - 1;
    };
    // Dwa przekroje (z = 0 i z = h) połączone pasami trójkątów; końce klina są otwarte,
    // ale zaokrąglamy wyłącznie krawędź wewnętrzną, więc to nie przeszkadza.
    const rings: number[][] = [];
    for (const z of [0, h]) {
      const ring: number[] = [];
      for (const [x, y] of profile) ring.push(pushVertex(x, y, z));
      rings.push(ring);
    }
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const a = rings[0][i], b = rings[1][i], c = rings[1][j], d = rings[0][j];
      indices.push(a, b, c, a, c, d);
    }
    const built = buildMeshFromRaw(Float64Array.from(positions), Int32Array.from(indices));
    const m = built.mesh;
    // Krawędź klinowa to ta w początku układu (x≈0, y≈0).
    const edge = m.edges
      .filter((e) => e.faces.length === 2)
      .map((e) => ({
        e,
        d: Math.hypot(
          (m.positions[3 * e.v0] + m.positions[3 * e.v1]) / 2,
          (m.positions[3 * e.v0 + 1] + m.positions[3 * e.v1 + 1]) / 2,
        ),
      }))
      .filter((x) => x.d < 1e-6)[0];
    assert.ok(edge, `brak krawędzi w wierzchołku klina dla ${deg}°`);

    const { mesh: out } = roundEdges(m, {
      radius: r,
      segments: 4,
      kind: 'fillet',
      edgeIndices: [edge!.e.index],
      // Wyłączamy wygaszanie na końcach łańcucha: mierzymy czystą matematykę łuku,
      // a nie profil run-out przy otwartych końcach pryzmatu.
      taperEnds: false,
    });

    const axis = r / Math.sin(theta / 2);
    let maxErr = 0;
    let moved = 0;
    for (let v = 0; v < out.vertexCount; v++) {
      const x = out.positions[3 * v];
      const y = out.positions[3 * v + 1];
      const t = Math.hypot(x, y);
      if (t < 1e-9) continue;
      // Dwusieczna materiału to oś +X (klin jest symetryczny względem niej).
      if (Math.abs(y) / t > 1e-6) continue;
      if (t > axis + 1e-9) continue; // poza strefą łuku (dalsza część ramion)
      moved++;
      const rho = Math.abs(axis - t);
      maxErr = Math.max(maxErr, Math.abs(rho - r));
    }
    assert.ok(moved > 0, `nie zmierzono żadnego wierzchołka łuku dla ${deg}°`);
    assert.ok(maxErr < 1e-9, `kąt ${deg}°: max |rho − r| = ${maxErr}`);
  }
});

test('FILLET: objętość wyniku zgadza się z niezależnym całkowaniem siatki', () => {
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const { mesh: result } = roundEdges(mesh, {
    radius: 1.5,
    segments: 4,
    kind: 'fillet',
    edgeIndices: cubeEdges(mesh).map((e) => e.index),
  });
  const v1 = Math.abs(signedVolume(result));
  const v2 = volumeOf(result.positions, Int32Array.from(result.faces));
  assert.ok(Math.abs(v1 - v2) < 1e-6, `${v1} vs ${v2}`);
});

test('RAPORT: rozdzielczość pasa jest mierzona, a nie zakładana', () => {
  // Sześcian 20 mm, jedna para trójkątów na ścianę, promień 2 mm. Po zagęszczeniu
  // ściany w pasie mają rozmiar zbliżony do docelowej długości łuku, więc raport
  // musi pokazywać WARTOŚĆ ZMIERZONĄ, istotnie mniejszą od wyjściowych 20 mm...
  const box = makeBox(20, 20, 20, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edgeIdx = cubeEdges(mesh).map((e) => e.index);

  const dense = roundEdges(mesh, { radius: 2, segments: 8, kind: 'fillet', edgeIndices: edgeIdx });
  assert.ok(dense.report.bandFacetSize > 0, 'rozmiar ściany w pasie musi być zmierzony');
  assert.ok(dense.report.bandFacetSize < 20, `oczekiwano zagęszczenia, jest ${dense.report.bandFacetSize}`);
  // ...i być mniejszy niż dla grubszej siatki wyjściowej.
  const coarse = roundEdges(mesh, {
    radius: 2, segments: 8, kind: 'fillet', edgeIndices: edgeIdx, maxLevels: 1,
  });
  assert.ok(
    coarse.report.bandFacetSize > dense.report.bandFacetSize,
    `1 poziom: ${coarse.report.bandFacetSize}, pełne: ${dense.report.bandFacetSize}`,
  );
  assert.equal(coarse.report.refinementLimitedByBudget, false, 'limit poziomów to nie limit trójkątów');
});

test('RAPORT: rzadka siatka jest wykrywana i jawnie ostrzega o odchyłce', () => {
  // Model 176 mm, promień 0.5 mm, ściany po ~20 mm: siatka nie jest w stanie
  // odtworzyć łuku. Aplikacja musi to powiedzieć, a nie pokazywać teoretycznej
  // odchyłki łuku jako rzeczywistej.
  const box = makeBox(176, 176, 176, 1);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edgeIdx = cubeEdges(mesh).map((e) => e.index);
  const { report } = roundEdges(mesh, { radius: 0.5, segments: 3, kind: 'fillet', edgeIndices: edgeIdx });

  assert.ok(report.bandFacetSize > 2 * report.effectiveRadius, `pas=${report.bandFacetSize}`);
  const warning = report.warnings.find((w) => w.includes('decyduje'));
  assert.ok(warning, `brak ostrzeżenia o rzadkiej siatce; ostrzeżenia: ${report.warnings.join(' | ')}`);
  // Ostrzeżenie musi podać realne ograniczenie (maks. przesunięcie), a nie teoretyczne.
  assert.ok(warning!.includes(report.maxDisplacement.toFixed(3)));
  assert.ok(report.maxDisplacement > report.chordDeviation, 'odchyłka rzeczywista > teoretyczna');
});

test('RAPORT: gęsta siatka nie generuje fałszywego ostrzeżenia', () => {
  const box = makeBox(20, 20, 20, 8);
  const { mesh } = buildMeshFromRaw(box.positions, box.indices);
  const edgeIdx = cubeEdges(mesh).map((e) => e.index);
  const { report } = roundEdges(mesh, { radius: 1, segments: 3, kind: 'fillet', edgeIndices: edgeIdx });
  assert.ok(report.bandFacetSize > 0);
  assert.ok(
    report.bandFacetSize <= 2 * report.effectiveRadius,
    `pas=${report.bandFacetSize} powinien być rozdzielony przy r=${report.effectiveRadius}`,
  );
  assert.ok(!report.warnings.some((w) => w.includes('decyduje')), report.warnings.join(' | '));
});

test('BUDŻET: przekroczenie limitu trójkątów jest raportowane, a wynik pozostaje poprawny', () => {
  // Siatka 27 osobnych kostek 10 mm: pas obejmuje CAŁĄ siatkę, więc samo
  // zagęszczenie chciałoby kilku poziomów, a limit trójkątów przerywa je wcześniej.
  const side = 10, gap = 1.5, per = 3;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ix = 0; ix < per; ix++) {
    for (let iy = 0; iy < per; iy++) {
      for (let iz = 0; iz < per; iz++) {
        const b = makeBox(side, side, side, 1);
        const base = positions.length / 3;
        const ox = ix * (side + gap), oy = iy * (side + gap), oz = iz * (side + gap);
        for (let i = 0; i < b.positions.length; i += 3) {
          positions.push(b.positions[i] + ox, b.positions[i + 1] + oy, b.positions[i + 2] + oz);
        }
        for (const idx of b.indices) indices.push(base + idx);
      }
    }
  }
  const built = buildMeshFromRaw(Float64Array.from(positions), Int32Array.from(indices));
  assert.equal(built.mesh.faceCount, 27 * 12);
  const all = built.mesh.edges.filter((e) => e.faces.length === 2 && e.normalAngle > Math.PI / 4).map((e) => e.index);
  assert.equal(all.length, 27 * 12);

  const opts = { radius: 0.4, segments: 3, kind: 'fillet' as const, edgeIndices: all };
  const limited = roundEdges(built.mesh, { ...opts, triangleBudget: 10_000 });
  assert.equal(limited.report.refinementLimitedByBudget, true, 'limit 10 000 trójkątów musi zostać zgłoszony');
  assert.ok(limited.report.warnings.some((w) => w.includes('limit trójkątów')));
  assert.ok(limited.report.trianglesAfter <= 12_000, `limit przekroczony: ${limited.report.trianglesAfter}`);

  // Ten sam model z dużym budżetem: zagęszczanie idzie dalej. Pełne zejście do
  // docelowej długości łuku (0.21 mm) wymagałoby ~1.3 mln trójkątów, dlatego
  // w teście ograniczamy liczbę poziomów — liczy się sam kierunek zmiany.
  const wider = roundEdges(built.mesh, { ...opts, triangleBudget: 2_000_000, maxLevels: 4 });
  assert.equal(wider.report.refinementLimitedByBudget, false);
  assert.ok(
    wider.report.bandFacetSize < limited.report.bandFacetSize,
    `większy budżet nie poprawił rozdzielczości: ${wider.report.bandFacetSize} vs ${limited.report.bandFacetSize}`,
  );

  // Mimo przerwanego zagęszczania gwarancje bezpieczeństwa nadal obowiązują.
  for (const r of [limited, wider]) {
    const diag = manifoldReport(r.mesh.positions, Int32Array.from(r.mesh.faces));
    assert.equal(diag.boundary, 0);
    assert.equal(diag.nonManifold, 0);
    assert.equal(diag.flippedWinding, 0);
    assert.ok(r.report.maxDisplacement <= r.report.effectiveRadius + 1e-9);
    assert.equal(r.report.flippedFaceCount, 0);
    assert.equal(r.report.degenerateFaceCount, 0);
  }
});
