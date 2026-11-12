import { EdgeCard } from './EdgeCard.tsx';
import type { EdgeCardProps } from './EdgeCard.tsx';
import { ParamsCard } from './ParamsCard.tsx';
import type { ParamsCardProps } from './ParamsCard.tsx';
import { Card } from './ui/Card.tsx';

export interface OptionsRailProps {
  edge: EdgeCardProps;
  params: ParamsCardProps;
  /** Liczba ścian wymagających podparcia. */
  overhangCount: number;
  /** Łączne pole nawisów (mm²). */
  overhangAreaMm2: number;
}

/** Prawa szyna: karta krawędzi, karta parametrów i sekcja nawisów. */
export function OptionsRail({ edge, params, overhangCount, overhangAreaMm2 }: OptionsRailProps) {
  return (
    <div className="flex flex-col gap-3">
      <EdgeCard {...edge} />
      <ParamsCard {...params} />

      <Card title="Nawisy">
        <dl className="space-y-1 font-mono text-[11px] text-txt-dim">
          <div className="flex items-center justify-between gap-2">
            <dt>Ściany do podparcia</dt>
            <dd className="text-txt">{overhangCount}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Pole nawisów</dt>
            <dd className="text-txt">{overhangAreaMm2.toFixed(2)} mm²</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Próg kąta</dt>
            <dd className="text-txt">45° od osi budowania</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
