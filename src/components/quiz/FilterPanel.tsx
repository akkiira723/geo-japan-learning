import { useState } from 'react';
import { REGIONS } from '../../lib/regions';
import { ALL_PREF_CODES, prefName } from '../../lib/prefectures';
import type { OperatorFilter, QuizFilter, QuizMeta } from '../../quizzes/types';

const COUNT_OPTIONS: { count: number; label: string }[] = [
  { count: 5, label: '5 問' },
  { count: 10, label: '10 問' },
  { count: 20, label: '20 問' },
  { count: Infinity, label: '全問' },
];
const RADIUS_OPTIONS: { km: number; label: string }[] = [
  { km: 50, label: 'やさしい (50km)' },
  { km: 20, label: 'ふつう (20km)' },
  { km: 10, label: 'むずかしい (10km)' },
];

export interface FilterPanelProps {
  meta: QuizMeta;
  onStart: (filter: QuizFilter) => void;
}

export function FilterPanel({ meta, onStart }: FilterPanelProps) {
  const [prefs, setPrefs] = useState<Set<number>>(new Set());
  const [operator, setOperator] = useState<OperatorFilter>('all');
  const [questionCount, setQuestionCount] = useState(Infinity);
  const [radiusKm, setRadiusKm] = useState(20);
  const [showPrefs, setShowPrefs] = useState(false);

  const toggleRegion = (regionPrefs: number[]) => {
    setPrefs((prev) => {
      const next = new Set(prev);
      const allOn = regionPrefs.every((p) => next.has(p));
      for (const p of regionPrefs) {
        if (allOn) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  };

  const togglePref = (code: number) => {
    setPrefs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const start = () => {
    onStart({
      prefs: [...prefs].sort((a, b) => a - b),
      operator,
      questionCount,
      radiusKm,
    });
  };

  return (
    <div className="filter-panel">
      <h2>{meta.title}</h2>
      <p className="filter-desc">{meta.description}</p>

      <section>
        <h3>出題範囲</h3>
        <div className="chip-row">
          <button
            className={`chip ${prefs.size === 47 ? 'chip-on' : ''}`}
            onClick={() => setPrefs(prefs.size === 47 ? new Set() : new Set(ALL_PREF_CODES))}
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
      </section>

      {meta.hasOperatorFilter && (
        <section>
          <h3>事業者</h3>
          <div className="chip-row">
            {(
              [
                ['all', 'すべて'],
                ['jr', 'JRのみ'],
                ['nonjr', 'JR以外'],
              ] as [OperatorFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={`chip ${operator === value ? 'chip-on' : ''}`}
                onClick={() => setOperator(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {meta.usesRadius && (
        <section>
          <h3>難易度（正解半径）</h3>
          <div className="chip-row">
            {RADIUS_OPTIONS.map((o) => (
              <button
                key={o.km}
                className={`chip ${radiusKm === o.km ? 'chip-on' : ''}`}
                onClick={() => setRadiusKm(o.km)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>出題数</h3>
        <div className="chip-row">
          {COUNT_OPTIONS.map((o) => (
            <button
              key={o.label}
              className={`chip ${questionCount === o.count ? 'chip-on' : ''}`}
              onClick={() => setQuestionCount(o.count)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {questionCount === Infinity && (
          <p className="filter-note">選択した範囲の全問題を出題します（途中で「終了」できます）</p>
        )}
      </section>

      <button className="btn btn-primary btn-large" disabled={prefs.size === 0} onClick={start}>
        スタート
      </button>
      {prefs.size === 0 && <p className="filter-warn">出題範囲を選んでください</p>}
    </div>
  );
}
