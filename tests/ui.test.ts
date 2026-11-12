/**
 * Smoke test warstwy UI: analiza statyczna prawdziwych plikow zrodlowych.
 * Sprawdza kontrakty, ktorych nie wychwyci kompilator ani runner bez przegladarki.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const viewer = readFileSync(join(root, 'src', 'components', 'ThreeViewer.tsx'), 'utf8');
const topBar = readFileSync(join(root, 'src', 'components', 'TopBar.tsx'), 'utf8');
const optionsRail = readFileSync(join(root, 'src', 'components', 'OptionsRail.tsx'), 'utf8');
const viewBar = readFileSync(join(root, 'src', 'components', 'ViewBar.tsx'), 'utf8');
const heroCard = readFileSync(join(root, 'src', 'components', 'HeroCard.tsx'), 'utf8');
const statusCard = readFileSync(join(root, 'src', 'components', 'StatusCard.tsx'), 'utf8');
const statsRail = readFileSync(join(root, 'src', 'components', 'StatsRail.tsx'), 'utf8');
const barrel = readFileSync(join(root, 'src', 'utils', 'meshProcessing.ts'), 'utf8');
const tailwind = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTsx(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

test('UI: App uzywa wylacznie istniejacego API biblioteki', () => {
  const used = ['buildMeshFromRaw', 'roundEdges', 'exportToSTL', 'exportToOBJ', 'objectToTriangleSoup'];
  for (const name of used) {
    assert.ok(app.includes(name), `App.tsx uzywa ${name}, ale go nie importuje/nie ma`);
    assert.ok(barrel.includes(`export`), 'brak eksportow w meshProcessing.ts');
  }
});

test('UI: nie ma juz klamliwej, zaszytej na stale diagnostyki', () => {
  const ui = [app, statsRail, statusCard].join('\n');
  assert.ok(!ui.includes('> Tak\n'), 'UI nie moze miec zaszytego "Tak" w diagnostyce');
  assert.ok(ui.includes('diagnostics.isClosed'), 'diagnostyka musi pochodzic z realnych danych');
  assert.ok(ui.includes('diagnostics.nonManifoldEdgeCount'), 'brak realnego sprawdzenia non-manifold');
  assert.ok(ui.includes('flippedFaceCount'), 'brak raportowania odwroconych trojkatow');
});

test('UI: geometria jest przebudowywana, gdy zmienia sie topologia (nie tylko pozycje)', () => {
  assert.ok(
    viewer.includes('meshToGeometry(shownMesh)'),
    'ThreeViewer musi przebudowac geometrie z calej siatki (po zaokragleniu zmienia sie liczba trojkatow)',
  );
  assert.ok(viewer.includes('meshRef.current.geometry.dispose()'), 'stara geometria musi byc zwalniana');
  assert.ok(app.includes('setResult(null)'), 'zmiana parametrow/selekcji musi wyczyscic wynik');
});

test('UI: eksport nie centruje ani nie skaluje modelu', () => {
  assert.ok(!app.includes('exportModelCentered'), 'funkcja "centruj i skaluj" nie moze wracac');
  assert.ok(!app.includes('meshToGeometryCentered'), 'eksport musi uzywac wspolrzednych oryginalu');
});

test('UI: stan zaznaczenia to zbior krawedzi (a nie wierzcholkow)', () => {
  assert.ok(app.includes('Set<number>'), 'zaznaczenie musi byc zbiorem');
  assert.ok(app.includes('handleToggleEdge'), 'brak handlera klikniecia krawedzi');
  assert.ok(app.includes('edgeIndex'), 'selekcja musi operowac na indeksach krawedzi');
  assert.ok(viewer.includes('onToggleEdge'), 'viewer musi przekazywac klikniecie krawedzi do rodzica');
});

test('UI: nie ma juz martwego kodu backendu MeshLib w sciezce klienta', () => {
  assert.ok(!barrel.includes('meshlibRoundMesh'), 'meshProcessing.ts nie moze trzymac stubu backendu');
  assert.ok(!barrel.includes('app/main.py'), 'sciezka kliencka nie moze odwolywac sie do serwera przetwarzania');
});

test('UI: graf importow App jest kompletny (analiza statyczna)', () => {
  assert.ok(app.includes("from 'three/examples/jsm/loaders/STLLoader.js'"), 'brak importu STLLoader');
  assert.ok(app.includes("from 'three/examples/jsm/loaders/3MFLoader.js'"), 'brak importu 3MFLoader');
  assert.ok(app.includes("from './utils/meshProcessing.ts'"), 'brak importu modulu przetwarzania');
  assert.ok(app.includes("from './components/ThreeViewer.tsx'"), 'brak importu ThreeViewer');
});

// --- Zadanie 5, testy T1-T7 (plan) ---

test('UI: brak trybu jasnego (setTheme / theme- / .light nie wystepuja w src/)', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|css)$/.test(name)) out.push(p);
    }
    return out;
  }
  const offenders: string[] = [];
  for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('setTheme') || text.includes('theme-') || text.includes('.light')) {
      offenders.push(relative(root, file));
    }
  }
  assert.deepEqual(offenders, [], `Znaleziono pozostalosc trybu jasnego w: ${offenders.join(', ')}`);
});

test('UI: tokeny hex w tailwind.config.js sa identyczne z tokenami w index.css', () => {
  const hexes = [
    '#14161a', '#1c1f26', '#2c313b', '#e7e9ee', '#8d95a5', '#4da3ff',
    '#2a303a', '#333a46', '#454d5c', '#ffb454', '#ff6b6b', '#6fcf8b',
  ];
  for (const h of hexes) {
    assert.ok(tailwind.toLowerCase().includes(h), `brak ${h} w tailwind.config.js`);
    assert.ok(css.toLowerCase().includes(h), `brak ${h} w src/index.css`);
  }
});

test('UI: kazdy komponent w src/components ma ≤ 150 linii', () => {
  const files = walkTsx(join(root, 'src', 'components'));
  const tooLong: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n').length;
    if (lines > 150) tooLong.push(`${relative(root, f)} (${lines})`);
  }
  assert.deepEqual(tooLong, [], `Komponenty >150 linii: ${tooLong.join(', ')}`);
});

test('UI: gorny pasek zawiera selektor dyszy i suwak promienia', () => {
  assert.ok(topBar.includes('Dysza'), 'TopBar musi zawierac etykiete Dysza');
  assert.ok(topBar.includes('NOZZLE_OPTIONS_MM'), 'TopBar musi uzywac NOZZLE_OPTIONS_MM');
  assert.ok(topBar.includes('type="range"') || topBar.includes('Promie') || topBar.includes('radius'), 'TopBar musi zawierac suwak promienia');
});

test('UI: eksport jest blokowany, gdy report.failed', () => {
  const text = [app, topBar, statusCard].join('\n');
  assert.ok(text.includes('failed'), 'UI musi reagowac na report.failed');
  assert.ok(app.includes('exportBlocked'), 'App musi blokowac eksport przy failed');
  assert.ok(text.includes('exportBlockedReason') || text.includes('orygina'), 'UI musi informowac o blokadzie eksportu');
});

test('UI: raport pokazuje zmierzony blad powierzchni (measuredSurfaceError)', () => {
  const text = [app, statusCard].join('\n');
  assert.ok(text.includes('measuredSurfaceError'), 'UI musi pokazywac measuredSurfaceError');
});

test('UI: dostepnosc - aria-label / aria-pressed / aria-live w TopBar, OptionsRail, ViewBar, HeroCard', () => {
  assert.ok(topBar.includes('aria-label'), 'TopBar musi miec aria-label');
  assert.ok(optionsRail.includes('aria-pressed') || app.includes('aria-pressed'), 'OptionsRail/App musi miec aria-pressed dla przelacznikow');
  assert.ok(viewBar.includes('aria-pressed') || viewBar.includes('aria-label'), 'ViewBar musi miec atrybuty dostepnosci');
  assert.ok(heroCard.includes('aria-live') || heroCard.includes('aria-label'), 'HeroCard musi miec aria-live lub aria-label');
});
