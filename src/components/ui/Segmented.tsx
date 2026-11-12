export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Przełącznik segmentowy (tryb zaokrąglenia, tryb porównania). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex overflow-hidden rounded-md border border-line-strong bg-btn ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 ${
              active ? 'bg-surface-raised text-txt' : 'text-txt-dim hover:text-txt'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
