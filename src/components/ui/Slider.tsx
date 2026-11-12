export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Odczyt w prawej kolumnie (np. „30° (12 kraw.)”). */
  readout?: string;
  readoutTone?: 'default' | 'warn';
  ariaLabel: string;
  /** Podpowiedź pod suwakiem. */
  hint?: string;
  disabled?: boolean;
}

/** Suwak z etykietą, odczytem i (opcjonalnie) podpowiedzią. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  readout,
  readoutTone = 'default',
  ariaLabel,
  hint,
  disabled = false,
}: SliderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-txt-dim">{label}</span>
        {readout && (
          <span
            className={`font-mono text-[11px] tabular-nums ${
              readoutTone === 'warn' ? 'text-warn' : 'text-txt'
            }`}
          >
            {readout}
          </span>
        )}
      </div>
      <input
        type="range"
        className="re-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={readout}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="text-[10px] text-txt-faint">{hint}</span>}
    </div>
  );
}
