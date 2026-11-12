/**
 * Smoke test warstwy UI — kompiluje App przez Vite (SSR) i renderuje do HTML.
 *
 * Uruchomienie:  npm run test:ssr
 *
 * Sprawdza cały graf importów (three + loadery STL/3MF/OBJ + lucide-react + moduły
 * przetwarzania siatki) oraz to, że pierwszy render nie wymaga DOM ani WebGL.
 */
import { build } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
// Katalog MUSI leżeć w projekcie — inaczej Node nie rozwiąże importów typu 'react'.
const outDir = join(root, 'node_modules', '.tmp', 'ssr-smoke');
mkdirSync(outDir, { recursive: true });

try {
  await build({
    root,
    logLevel: 'error',
    configFile: false,
    build: {
      ssr: 'src/ssrEntry.tsx',
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { entryFileNames: 'ssrEntry.mjs' } },
    },
  });

  const entry = readdirSync(outDir).find((f) => f.endsWith('.mjs'));
  if (!entry) throw new Error('Build SSR nie wygenerował pliku wejściowego.');

  const mod = await import(pathToFileURL(join(outDir, entry)).href);
  const App = mod.default ?? mod.App;
  if (!App) throw new Error('Entry SSR nie eksportuje komponentu App.');

  const html = renderToStaticMarkup(createElement(App));
  const checks = [
    ['nagłówek "RoundEdge"', html.includes('RoundEdge')],
    ['ekran startowy "Rozpocznij tutaj"', html.includes('Rozpocznij tutaj')],
    ['viewport "Oczekiwanie na model 3D"', html.includes('Oczekiwanie na model 3D')],
    ['przycisk demo kostki', html.includes('Kostka 20 mm')],
    ['informacja o lokalnym przetwarzaniu', html.includes('Wszystkie obliczenia lokalnie')],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? '✔' : '✖'} ${label}`);
    if (!ok) failed++;
  }
  console.log(`ℹ SSR render: ${html.length} znaków HTML, ${checks.length - failed}/${checks.length} sprawdzeń OK`);
  if (failed > 0) process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
