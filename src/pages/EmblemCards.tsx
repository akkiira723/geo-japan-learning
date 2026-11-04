import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaPicker } from '../components/cards/AreaPicker';
import { FlashcardStudy, type FlashCard } from '../components/cards/FlashcardStudy';
import { ALL_PREF_CODES } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import { loadLearnedEmblems, saveLearnedEmblems } from '../lib/storage';
import { emblemRuby, loadEmblemItems, loadTopEmblemItems, type EmblemItem } from '../quizzes/emblem';
import type { PopulationTop } from '../quizzes/types';

type RangeMode = 'area' | 'pop';
type CardOrder = 'shuffle' | 'natural';
type CardScope = 'all' | 'unlearned';

const POPULATION_TOP_OPTIONS: PopulationTop[] = [100, 300, 500, 1000];

interface StudySettings {
  mode: RangeMode;
  prefs: number[];
  top: PopulationTop;
  includeLegacy: boolean;
  /** 'natural' = 都道府県順（人口上位モードでは人口順） */
  order: CardOrder;
  scope: CardScope;
}

type PageState =
  | { mode: 'setup' }
  | { mode: 'loading' }
  | { mode: 'error'; message: string }
  | { mode: 'studying'; cards: FlashCard[]; settings: StudySettings };

async function loadItems(settings: StudySettings): Promise<EmblemItem[]> {
  if (settings.mode === 'pop') return loadTopEmblemItems(settings.top);
  const items = await loadEmblemItems(settings.prefs);
  return settings.includeLegacy ? items : items.filter((it) => !it.legacy);
}

function buildCards(items: EmblemItem[], settings: StudySettings, learned: Set<string>): FlashCard[] {
  let picked = items;
  if (settings.scope === 'unlearned') picked = picked.filter((it) => !learned.has(it.id));
  const cards: FlashCard[] = picked.map((item) => ({
    key: item.id,
    learnId: item.id,
    pref: item.pref,
    name: item.name,
    rubies: emblemRuby(item),
    gun: item.gun,
    into: item.into,
    intoYomi: item.intoYomi,
    img: `${import.meta.env.BASE_URL}data/${item.img}`,
    imgAlt: '市町村章',
    imgKind: 'emblem',
    desc:
      item.rank !== undefined && item.pop !== undefined
        ? `人口 ${item.pop.toLocaleString('ja-JP')} 人（全国 ${item.rank} 位・2020年国勢調査）`
        : undefined,
    link: item.page,
    linkLabel: '出典ページ（ちきページ）',
  }));
  return settings.order === 'shuffle' ? shuffled(cards) : cards;
}

export function EmblemCards() {
  const [state, setState] = useState<PageState>({ mode: 'setup' });
  const [learned, setLearned] = useState<Set<string>>(() => loadLearnedEmblems());

  const onLearnedChange = useCallback((next: Set<string>) => {
    saveLearnedEmblems(next);
    setLearned(next);
  }, []);

  const start = async (settings: StudySettings) => {
    setState({ mode: 'loading' });
    try {
      const cards = buildCards(await loadItems(settings), settings, learned);
      if (cards.length === 0) {
        setState({
          mode: 'error',
          message: settings.scope === 'unlearned' ? 'この範囲の章はすべて「覚えた」になっています。' : 'この範囲に章がありません。',
        });
        return;
      }
      setState({ mode: 'studying', cards, settings });
    } catch (err) {
      setState({ mode: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  switch (state.mode) {
    case 'setup':
      return <CardSetup onStart={start} />;
    case 'loading':
      return <div className="page page-center">データを読み込み中…</div>;
    case 'error':
      return (
        <div className="page page-center">
          <p className="error-text">{state.message}</p>
          <button className="btn btn-primary" onClick={() => setState({ mode: 'setup' })}>
            設定に戻る
          </button>
        </div>
      );
    case 'studying':
      return (
        <FlashcardStudy
          cards={state.cards}
          learned={learned}
          onLearnedChange={onLearnedChange}
          onExit={() => setState({ mode: 'setup' })}
          onAgain={(scope) => start({ ...state.settings, scope })}
        />
      );
  }
}

function CardSetup({ onStart }: { onStart: (settings: StudySettings) => void }) {
  const [mode, setMode] = useState<RangeMode>('area');
  const [prefs, setPrefs] = useState<Set<number>>(new Set(ALL_PREF_CODES));
  const [top, setTop] = useState<PopulationTop>(100);
  const [includeLegacy, setIncludeLegacy] = useState(true);
  const [order, setOrder] = useState<CardOrder>('shuffle');
  const [scope, setScope] = useState<CardScope>('all');

  const canStart = mode === 'pop' || prefs.size > 0;

  return (
    <div className="page">
      <div className="filter-panel">
        <h2>市章単語帳</h2>
        <p className="filter-desc">
          市町村章（市章・町章・村章）を1つずつめくって自治体名を暗記する。覚えた章にチェックを付けて、未習得の章だけに絞り込める。
        </p>

        <section>
          <h3>範囲</h3>
          <div className="chip-row">
            <button className={`chip ${mode === 'area' ? 'chip-on' : ''}`} onClick={() => setMode('area')}>
              地方・都道府県で選ぶ
            </button>
            <button className={`chip ${mode === 'pop' ? 'chip-on' : ''}`} onClick={() => setMode('pop')}>
              人口上位で選ぶ
            </button>
          </div>
          {mode === 'area' ? (
            <>
              <AreaPicker prefs={prefs} onChange={setPrefs} />
              <label className="pref-check filter-toggle">
                <input type="checkbox" checked={includeLegacy} onChange={() => setIncludeLegacy(!includeLegacy)} />
                旧市町村（消滅した自治体）のものも含める
              </label>
            </>
          ) : (
            <>
              <div className="chip-row">
                {POPULATION_TOP_OPTIONS.map((n) => (
                  <button key={n} className={`chip ${top === n ? 'chip-on' : ''}`} onClick={() => setTop(n)}>
                    人口 Top{n}
                  </button>
                ))}
              </div>
              <p className="filter-note">
                2020年国勢調査の人口順（現行の市・東京特別区・町村。政令市は市全体で1件）。人口上位は現行の章のみ
              </p>
            </>
          )}
        </section>

        <section>
          <h3>並び順</h3>
          <div className="chip-row">
            <button className={`chip ${order === 'shuffle' ? 'chip-on' : ''}`} onClick={() => setOrder('shuffle')}>
              シャッフル
            </button>
            <button className={`chip ${order === 'natural' ? 'chip-on' : ''}`} onClick={() => setOrder('natural')}>
              {mode === 'pop' ? '人口順' : '都道府県順'}
            </button>
          </div>
        </section>

        <section>
          <h3>対象</h3>
          <div className="chip-row">
            <button className={`chip ${scope === 'all' ? 'chip-on' : ''}`} onClick={() => setScope('all')}>
              すべて
            </button>
            <button className={`chip ${scope === 'unlearned' ? 'chip-on' : ''}`} onClick={() => setScope('unlearned')}>
              未習得のみ
            </button>
          </div>
        </section>

        <button
          className="btn btn-primary btn-large"
          disabled={!canStart}
          onClick={() =>
            onStart({ mode, prefs: [...prefs].sort((a, b) => a - b), top, includeLegacy, order, scope })
          }
        >
          はじめる
        </button>
        {!canStart && <p className="filter-warn">範囲を選んでください</p>}
        <p className="filter-note">
          <Link to="/">ホームへ戻る</Link>
        </p>
      </div>
    </div>
  );
}
