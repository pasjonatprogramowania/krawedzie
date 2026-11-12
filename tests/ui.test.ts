/**
 * Smoke test warstwy UI: czyta prawdziwe pliki źródłowe pod kątem typowych pułapek,
 * których nie wychwyci kompilator (np. wywołanie funkcji usuniętej z API, brak
 * przebudowy geometrii po zmianie topologii, "udawana" diagnostyka).
 *
 * Nie uruchamiamy przeglądarki — sprawdzamy kod i kontrakt API, którego używa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const viewer = readFileSync(join(root, 'src', 'components', 'ThreeViewer.tsx'), 'utf8');
const barrel = readFileSync(join(root, 'src', 'utils', 'meshProcessing.ts'), 'utf8');

test('UI: App używa wyłącznie istniejącego API biblioteki', () => {
  const used = ['buildMeshFromRaw', 'roundEdges', 'exportToSTL', 'exportToOBJ', 'objectToTriangleSoup'];
  for (const name of used) {
    assert.ok(app.includes(name), `App.tsx nie używa ${name}`);
    assert.ok(barrel.includes(name), `barrel nie eksportuje ${name}`);
  }
  // Stare (usunięte) API nie może wracać.
  for (const gone of ['applyLocalRounding', 'buildMeshTopology', 'calculateMeshVolume', 'UniqueMesh']) {
    assert.ok(!app.includes(gone), `App.tsx wciąż odwołuje się do usuniętego API: ${gone}`);
    assert.ok(!viewer.includes(gone), `ThreeViewer.tsx wciąż odwołuje się do usuniętego API: ${gone}`);
    assert.ok(!barrel.includes(`export type { ${gone}`), `barrel wciąż eksportuje ${gone}`);
  }
});

test('UI: nie ma już kłamliwej, zaszytej na stałe diagnostyki', () => {
  assert.ok(!app.includes('> Tak\n'), 'App.tsx nie może mieć zaszytego "Tak" w diagnostyce');
  assert.ok(app.includes('diagnostics.isClosed'), 'diagnostyka musi pochodzić z realnych danych');
  assert.ok(app.includes('diagnostics.nonManifoldEdgeCount'), 'brak realnego sprawdzenia non-manifold');
  assert.ok(app.includes('flippedFaceCount'), 'brak raportowania odwróconych trójkątów');
});

test('UI: geometria jest przebudowywana, gdy zmienia się topologia (nie tylko pozycje)', () => {
  // Po zaokrągleniu liczba trójkątów rośnie — aktualizacja bufora "w miejscu"
  // (positionAttr.setXYZ) prowadziłaby do wycieku poza bufor.
  assert.ok(!viewer.includes('positionAttr.setXYZ'), 'ThreeViewer nie może aktualizować pozycji w miejscu');
  assert.ok(viewer.includes('meshToGeometry'), 'ThreeViewer musi przebudowywać geometrię z MeshData');
});

test('UI: eksport nie centruje ani nie skaluje modelu', () => {
  assert.ok(!app.includes('geom.center()'), 'model nie może być centrowany (utrata oryginalnego położenia)');
  assert.ok(!app.includes('.scale.set('), 'model nie może być skalowany');
});

test('UI: stan zaznaczenia to zbiór krawędzi (a nie wierzchołków)', () => {
  assert.ok(app.includes('selectedEdges'), 'brak stanu selectedEdges');
  assert.ok(app.includes('handleToggleEdge'), 'brak przełączania pojedynczej krawędzi');
  assert.ok(viewer.includes('faceIndex'), 'selekcja musi korzystać z faceIndex raycastu');
});

test('UI: nie ma już martwego kodu backendu MeshLib w ścieżce klienta', () => {
  assert.ok(!app.includes('api/process'), 'frontend nie może wysyłać danych do atrapy backendu');
  assert.ok(!app.includes('localhost:8000'), 'brak odwołań do serwera, którego nie ma');
});

test('UI: graf importów App jest kompletny (analiza statyczna)', () => {
  // Pełny render komponentu wymaga kompilacji JSX — robi to `npm run test:ssr`
  // (build SSR przez Vite + renderToStaticMarkup). Tutaj sprawdzamy spójność importów.
  for (const spec of ['./components/ThreeViewer.tsx', './utils/meshProcessing.ts']) {
    assert.ok(app.includes(`from '${spec}'`), `App.tsx musi importować ${spec} z rozszerzeniem (Node ESM)`);
  }
});
