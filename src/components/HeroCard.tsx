import { Sparkles, Upload } from 'lucide-react';

export interface HeroCardProps {
  onLoadDemo: (path: string, name: string) => void;
}

const STEPS = [
  { title: 'Wgraj', text: 'upuść plik w okno przeglądarki.' },
  { title: 'Zaznacz', text: 'kliknij krawędź w podglądzie 3D.' },
  { title: 'Pobierz', text: 'zaokrąglone narożniki drukują się lepiej.' },
];

/** Pusty stan: jedna karta środkowa z instrukcją i dwa przyciski demo. */
export function HeroCard({ onLoadDemo }: HeroCardProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6">
      <div className="pointer-events-auto w-full max-w-[420px] rounded-panel border border-dashed border-line-strong bg-surface-panel/85 p-5 text-center shadow-card backdrop-blur-[6px]">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent">
          <Upload className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <h1 className="text-[17px] font-semibold text-txt">Zaokrągl narożniki przed drukiem</h1>
        <p className="mt-1 text-[13px] text-txt-dim">
          Wgraj model 3D (STL / OBJ / 3MF), zaznacz krawędzie i pobierz gotowy plik.
        </p>

        <ol aria-live="polite" className="mt-3 space-y-1 text-left text-[13px] text-txt-dim">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-2">
              <span className="font-mono text-txt-faint">{index + 1}.</span>
              <span>
                <strong className="font-medium text-txt">{step.title}</strong> — {step.text}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-3 text-[11px] text-txt-faint">
          Wszystkie obliczenia lokalnie w przeglądarce — plik nie opuszcza komputera.
        </p>
      </div>

      <div className="pointer-events-auto mt-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => onLoadDemo('/cube.stl', 'cube.stl')}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-btn px-3 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover"
        >
          <Sparkles className="h-3.5 w-3.5" /> Kostka 20 mm
        </button>
        <button
          type="button"
          onClick={() => onLoadDemo('/pranie.stl', 'pranie.stl')}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-btn px-3 text-[12px] font-medium text-txt transition-colors duration-150 hover:bg-btn-hover"
        >
          <Sparkles className="h-3.5 w-3.5" /> Pranie (trudny)
        </button>
      </div>
    </div>
  );
}
