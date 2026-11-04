import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaPicker } from '../components/cards/AreaPicker';
import { FlashcardStudy, type FlashCard } from '../components/cards/FlashcardStudy';
import { ALL_PREF_CODES } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import { loadLearnedManholes, saveLearnedManholes } from '../lib/storage';
import { loadManholeItems, manholeRuby, type ManholeItem } from '../quizzes/manhole';

type CardOrder = 'shuffle' | 'pref';
type CardScope = 'all' | 'unlearned';

interface StudySettings {
  prefs: number[];
  order: CardOrder;
  scope: CardScope;
}

type PageState =
  | { mode: 'setup' }
  | { mode: 'loading' }
  | { mode: 'error'; message: string }
  | { mode: 'studying'; cards: FlashCard[]; settings: StudySettings };

function buildCards(all: { item: ManholeItem; pref: number }[], settings: StudySettings, learned: Set<string>): FlashCard[] {
  let picked = all;
  if (settings.scope === 'unlearned') picked = picked.filter(({ item }) => !learned.has(item.id));
  // クイズと同様、1自治体に複数の画像があればすべてカードにする（画像ごとに1枚）
  const cards: FlashCard[] = picked.flatMap(({ item, pref }) =>
    item.imgs.map((img, k) => ({
      key: `${item.id}:${k}`,
      learnId: item.id,
      pref,
      name: item.name,
      rubies: manholeRuby(item),
      gun: item.gun,
      into: item.into,
      intoYomi: item.intoYomi,
      img: img.url,
      imgAlt: 'マンホール蓋',
      imgNote: item.imgs.length > 1 ? `この自治体の写真 ${k + 1}/${item.imgs.length}` : undefined,
      desc: img.desc,
      link: img.page ?? item.page,
    })),
  );
  return settings.order === 'shuffle' ? shuffled(cards) : cards;
}

export function ManholeCards() {
  const [state, setState] = useState<PageState>({ mode: 'setup' });
  const [learned, setLearned] = useState<Set<string>>(() => loadLearnedManholes());

  const onLearnedChange = useCallback((next: Set<string>) => {
    saveLearnedManholes(next);
    setLearned(next);
  }, []);

  const start = async (settings: StudySettings) => {
    setState({ mode: 'loading' });
    try {
      const all = await loadManholeItems(settings.prefs);
      const cards = buildCards(all, settings, learned);
      if (cards.length === 0) {
        setState({
          mode: 'error',
          message: settings.scope === 'unlearned' ? 'この範囲の蓋はすべて「覚えた」になっています。' : 'この範囲に蓋がありません。',
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
  const [prefs, setPrefs] = useState<Set<number>>(new Set(ALL_PREF_CODES));
  const [order, setOrder] = useState<CardOrder>('shuffle');
  const [scope, setScope] = useState<CardScope>('all');

  return (
    <div className="page">
      <div className="filter-panel">
        <h2>マンホール単語帳</h2>
        <p className="filter-desc">
          デザイン蓋を1枚ずつめくって自治体名を暗記する。覚えた蓋にチェックを付けて、未習得の蓋だけに絞り込める。
        </p>

        <section>
          <h3>範囲</h3>
          <AreaPicker prefs={prefs} onChange={setPrefs} />
        </section>

        <section>
          <h3>並び順</h3>
          <div className="chip-row">
            <button className={`chip ${order === 'shuffle' ? 'chip-on' : ''}`} onClick={() => setOrder('shuffle')}>
              シャッフル
            </button>
            <button className={`chip ${order === 'pref' ? 'chip-on' : ''}`} onClick={() => setOrder('pref')}>
              都道府県順
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
          disabled={prefs.size === 0}
          onClick={() => onStart({ prefs: [...prefs].sort((a, b) => a - b), order, scope })}
        >
          はじめる
        </button>
        {prefs.size === 0 && <p className="filter-warn">範囲を選んでください</p>}
        <p className="filter-note">
          <Link to="/">ホームへ戻る</Link>
        </p>
      </div>
    </div>
  );
}
