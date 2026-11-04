import { useState } from 'react';
import { ALL_PREF_CODES, prefName } from '../../lib/prefectures';
import { REGIONS } from '../../lib/regions';

interface AreaPickerProps {
  prefs: Set<number>;
  onChange: (next: Set<number>) => void;
}

/** 単語帳の範囲選択（全国 / 地方チップ / 都道府県チェック） */
export function AreaPicker({ prefs, onChange }: AreaPickerProps) {
  // PC 幅（モバイル用ブレークポイント 600px 超）では都道府県一覧を最初から開く
  const [showPrefs, setShowPrefs] = useState(() => window.matchMedia('(min-width: 601px)').matches);

  const toggleRegion = (regionPrefs: number[]) => {
    const next = new Set(prefs);
    const allOn = regionPrefs.every((p) => next.has(p));
    for (const p of regionPrefs) {
      if (allOn) next.delete(p);
      else next.add(p);
    }
    onChange(next);
  };

  const togglePref = (code: number) => {
    const next = new Set(prefs);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  return (
    <>
      <div className="chip-row">
        <button
          className={`chip ${prefs.size === 47 ? 'chip-on' : ''}`}
          onClick={() => onChange(prefs.size === 47 ? new Set() : new Set(ALL_PREF_CODES))}
        >
          全国
        </button>
        {REGIONS.map((r) => (
          <button
            key={r.id}
            className={`chip ${r.prefs.every((p) => prefs.has(p)) ? 'chip-on' : ''}`}
            onClick={() => toggleRegion(r.prefs)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost btn-small" onClick={() => setShowPrefs(!showPrefs)}>
        {showPrefs ? '都道府県を閉じる' : '都道府県ごとに選ぶ'}
      </button>
      {showPrefs && (
        <div className="pref-grid">
          {ALL_PREF_CODES.map((code) => (
            <label key={code} className="pref-check">
              <input type="checkbox" checked={prefs.has(code)} onChange={() => togglePref(code)} />
              {prefName(code)}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
