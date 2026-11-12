/**
 * Tokeny UI wg pomiaru wzorca PrintFins (docs/design/printfins-reference.md §1).
 *
 * Reguła jednego źródła: każdy hex stąd ma dokładnie ten sam odpowiednik w `:root`
 * pliku `src/index.css`. Pilnuje tego test statyczny T-02 w `tests/ui.test.ts`.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // >= 900 px = układ desktopowy (pływające szyny); poniżej = układ mobilny.
      screens: {
        wide: '900px',
      },
      colors: {
        surface: {
          base: '#14161a',
          panel: '#1c1f26',
          raised: '#232731',
          viewport: '#101216',
        },
        line: { DEFAULT: '#2c313b', strong: '#454d5c' },
        txt: { DEFAULT: '#e7e9ee', dim: '#8d95a5', faint: '#5d6573' },
        accent: { DEFAULT: '#4da3ff', hover: '#6fb4ff' },
        btn: { DEFAULT: '#2a303a', hover: '#333a46' },
        // Kolory krawędzi — rodzina semantyczna, nie akcent marki.
        edge: { selected: '#ff6b4a', auto: '#7c5cff', hover: '#ffd043' },
        warn: '#ffb454',
        error: '#ff6b6b',
        ok: '#6fcf8b',
      },
      borderRadius: {
        panel: '8px',
        bar: '9px',
        chip: '3px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.28)',
        glass: 'inset 0 1px 0 rgb(255 255 255 / 0.06), 0 4px 18px rgb(0 0 0 / 0.28)',
        focus: '0 0 0 2px #14161a, 0 0 0 4px #4da3ff',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
