import { useState, type Dispatch, type SetStateAction } from 'react';
import { REGIONS } from '../../lib/regions';
import { ALL_PREF_CODES, prefName } from '../../lib/prefectures';
import type {
  HighwayFacilityKind,
  HighwayRoadType,
  OperatorFilter,
  QuizFilter,
  QuizMeta,
  RouteBand,
} from '../../quizzes/types';

const COUNT_OPTIONS: { count: number; label: string }[] = [
  { count: 5, label: '5 問' },
  { count: 10, label: '10 問' },
  { count: 20, label: '20 問' },
  { count: Infinity, label: '全問' },
];
const RADIUS_OPTIONS: { km: number; label: string }[] = [
  { km: 20, label: 'やさしい (20km)' },
  { km: 10, label: 'ふつう (10km)' },
  { km: 3, label: 'むずかしい (3km)' },
];
// 03・06 は単独局番なので帯としては出さない（地方・都道府県で選べば含まれる）
const CODE_PREFIX_OPTIONS = ['01', '02', '04', '05', '07', '08', '09'];

const FACILITY_KIND_OPTIONS: [HighwayFacilityKind, string][] = [
  ['ic', 'IC'],
  ['jct', 'JCT'],
  ['sapa', 'SA・PA'],
];
const ROAD_TYPE_OPTIONS: [HighwayRoadType, string][] = [
  ['inter', '都市間高速'],
  ['urban', '都市高速'],
];
const ROUTE_BAND_OPTIONS: [RouteBand, string][] = [
  ['two', '1〜58号（主要国道）'],
  ['three-low', '101〜299号'],
  ['three-high', '300〜507号'],
];

/** 出題範囲の選び方（局番帯は市外局番クイズのみ） */
type ScopeMode = 'region' | 'pref' | 'band';

export interface FilterPanelProps {
  meta: QuizMeta;
  onStart: (filter: QuizFilter) => void;
}

export function FilterPanel({ meta, onStart }: FilterPanelProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('region');
  const [prefs, setPrefs] = useState<Set<number>>(new Set());
  const [codePrefixes, setCodePrefixes] = useState<Set<string>>(new Set());
  const [operator, setOperator] = useState<OperatorFilter>('all');
  const [questionCount, setQuestionCount] = useState(Infinity);
  const [radiusKm, setRadiusKm] = useState(3);
  const [order, setOrder] = useState<'random' | 'asc'>('random');
  // 高速道路クイズの絞り込み（初期値は全 on = そのままスタート可能）
  const [facilityKinds, setFacilityKinds] = useState<Set<HighwayFacilityKind>>(
    () => new Set(FACILITY_KIND_OPTIONS.map(([v]) => v)),
  );
  const [roadTypes, setRoadTypes] = useState<Set<HighwayRoadType>>(
    () => new Set(ROAD_TYPE_OPTIONS.map(([v]) => v)),
  );
  // 国道番号クイズの番号帯（初期値は全 on = そのままスタート可能）
  const [routeBands, setRouteBands] = useState<Set<RouteBand>>(
    () => new Set(ROUTE_BAND_OPTIONS.map(([v]) => v)),
  );
  // PC 幅（モバイル用ブレークポイント 600px 超）では都道府県一覧を最初から開く
  const [showPrefs, setShowPrefs] = useState(() => window.matchMedia('(min-width: 601px)').matches);

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

  const toggleCodePrefix = (p: string) => {
    setCodePrefixes((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  // 出題範囲はモードごとに独立して選ぶ（切替時は選択をリセット）
  const switchScopeMode = (mode: ScopeMode) => {
    if (mode === scopeMode) return;
    setScopeMode(mode);
    setPrefs(new Set());
    setCodePrefixes(new Set());
  };

  const toggleIn = <T,>(set: Dispatch<SetStateAction<Set<T>>>, value: T) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const canStart = meta.nationwide
    ? (!meta.hasHighwayFilters || (facilityKinds.size > 0 && roadTypes.size > 0)) &&
      (!meta.hasRouteFilters || routeBands.size > 0)
    : scopeMode === 'band'
      ? codePrefixes.size > 0
      : prefs.size > 0;

  const start = () => {
    onStart({
      // 全国クイズは県で絞らない（prefs 空 = 地図も日本全域のまま）。局番帯モードも全国から局番で絞る
      prefs:
        meta.nationwide ? []
        : scopeMode === 'band' ? [...ALL_PREF_CODES]
        : [...prefs].sort((a, b) => a - b),
      operator,
      questionCount,
      radiusKm,
      order,
      codePrefixes: scopeMode === 'band' ? [...codePrefixes].sort() : [],
      facilityKinds: meta.hasHighwayFilters ? [...facilityKinds] : undefined,
      roadTypes: meta.hasHighwayFilters ? [...roadTypes] : undefined,
      routeBands: meta.hasRouteFilters ? [...routeBands] : undefined,
    });
  };

  const regionChips = (
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
  );

  const prefGrid = (
    <div className="pref-grid">
      {ALL_PREF_CODES.map((code) => (
        <label key={code} className="pref-check">
          <input type="checkbox" checked={prefs.has(code)} onChange={() => togglePref(code)} />
          {prefName(code)}
        </label>
      ))}
    </div>
  );

  return (
    <div className="filter-panel">
      <h2>{meta.title}</h2>
      <p className="filter-desc">{meta.description}</p>

      <section>
        <h3>出題範囲</h3>
        {meta.nationwide ? (
          <p className="filter-note">
            {meta.hasRouteFilters ? '全国の国道から出題します' : '全国の高速道路から出題します'}
          </p>
        ) : meta.hasAreaCodeFilters ? (
          <>
            <div className="chip-row">
              {(
                [
                  ['region', '地方で選ぶ'],
                  ['pref', '都道府県で選ぶ'],
                  ['band', '局番帯で選ぶ'],
                ] as [ScopeMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`chip ${scopeMode === mode ? 'chip-on' : ''}`}
                  onClick={() => switchScopeMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {scopeMode === 'region' && regionChips}
            {scopeMode === 'pref' && prefGrid}
            {scopeMode === 'band' && (
              <>
                <div className="chip-row">
                  {CODE_PREFIX_OPTIONS.map((p) => (
                    <button
                      key={p}
                      className={`chip ${codePrefixes.has(p) ? 'chip-on' : ''}`}
                      onClick={() => toggleCodePrefix(p)}
                    >
                      {p}台
                    </button>
                  ))}
                </div>
                <p className="filter-note">03・06 は単独の局番のため、地方・都道府県から選ぶと出題されます</p>
              </>
            )}
          </>
        ) : (
          <>
            {regionChips}
            <button className="btn btn-ghost btn-small" onClick={() => setShowPrefs(!showPrefs)}>
              {showPrefs ? '都道府県を閉じる' : '都道府県ごとに選ぶ'}
            </button>
            {showPrefs && prefGrid}
          </>
        )}
      </section>

      {meta.hasHighwayFilters && (
        <>
          <section>
            <h3>施設の種別</h3>
            <div className="chip-row">
              {FACILITY_KIND_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  className={`chip ${facilityKinds.has(value) ? 'chip-on' : ''}`}
                  onClick={() => toggleIn(setFacilityKinds, value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>道路タイプ</h3>
            <div className="chip-row">
              {ROAD_TYPE_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  className={`chip ${roadTypes.has(value) ? 'chip-on' : ''}`}
                  onClick={() => toggleIn(setRoadTypes, value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="filter-note">都市高速 = 首都高速・阪神高速・名古屋高速・福岡北九州高速・広島高速</p>
          </section>
        </>
      )}

      {meta.hasRouteFilters && (
        <section>
          <h3>番号帯</h3>
          <div className="chip-row">
            {ROUTE_BAND_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                className={`chip ${routeBands.has(value) ? 'chip-on' : ''}`}
                onClick={() => toggleIn(setRouteBands, value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-note">59〜100・109〜111・214〜216号は欠番のため存在しません</p>
        </section>
      )}

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

      {(meta.hasAreaCodeFilters || meta.hasRouteFilters) && (
        <section>
          <h3>出題順</h3>
          <div className="chip-row">
            {(
              [
                ['random', 'ランダム'],
                ['asc', meta.hasRouteFilters ? '番号の昇順' : '局番の昇順'],
              ] as ['random' | 'asc', string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={`chip ${order === value ? 'chip-on' : ''}`}
                onClick={() => setOrder(value)}
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

      <button className="btn btn-primary btn-large" disabled={!canStart} onClick={start}>
        スタート
      </button>
      {!canStart && (
        <p className="filter-warn">
          {meta.hasRouteFilters
            ? '番号帯を1つ以上選んでください'
            : meta.nationwide
              ? '施設の種別と道路タイプを1つ以上選んでください'
              : '出題範囲を選んでください'}
        </p>
      )}
    </div>
  );
}
