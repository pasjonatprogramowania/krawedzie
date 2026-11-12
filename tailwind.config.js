/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          dark: '#0a0a0f',
          card: '#14141c',
          panel: '#1a1a26',
          hover: '#242436',
        },
        accent: {
          teal: '#00d4aa',
          orange: '#ff6b4a',
          purple: '#7c5cff',
          yellow: '#ffd043',
          green: '#10b981',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glow-teal': '0 0 15px rgba(0, 212, 170, 0.4)',
        'glow-orange': '0 0 15px rgba(255, 107, 42, 0.4)',
        'glow-purple': '0 0 15px rgba(124, 92, 255, 0.4)',
      }
    },
  },
  plugins: [],
}
