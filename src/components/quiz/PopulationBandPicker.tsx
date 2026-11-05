import { bandLabel, POPULATION_BANDS } from '../../lib/populationBands';

interface PopulationBandPickerProps {
  /** 選択中の帯（開始順位） */
  bands: Set<number>;
  onChange: (next: Set<number>) => void;
  /** 注記の末尾に足す補足（旧市町村の扱いなどクイズごとの違い） */
  note?: string;
}

/** 人口順位帯（100 位刻み）の複数選択チップ。クイズの出題範囲と単語帳の範囲で共用 */
export function PopulationBandPicker({ bands, onChange, note }: PopulationBandPickerProps) {
  const toggle = (from: number) => {
    const next = new Set(bands);
    if (next.has(from)) next.delete(from);
    else next.add(from);
    onChange(next);
  };

  return (
    <>
      <div className="chip-row">
        {POPULATION_BANDS.map((b) => (
          <button key={b.from} className={`chip ${bands.has(b.from) ? 'chip-on' : ''}`} onClick={() => toggle(b.from)}>
            {bandLabel(b)}
          </button>
        ))}
      </div>
      <p className="filter-note">
        2020年国勢調査の人口順（現行の市・東京特別区・町村。政令市は市全体で1件）。複数の帯を選べます。{note}
      </p>
    </>
  );
}
