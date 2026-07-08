import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALL_PREF_CODES, prefName } from '../lib/prefectures';
import { REGIONS } from '../lib/regions';
import { shuffled } from '../lib/shuffle';
import { loadLearnedManholes, saveLearnedManholes } from '../lib/storage';
import { loadManholeItems, type ManholeItem } from '../quizzes/manhole';

type CardOrder = 'shuffle' | 'pref';
type CardScope = 'all' | 'unlearned';

interface Card {
  item: ManholeItem;
  pref: number;
  imgs: ManholeItem['imgs'];
}

interface StudySettings {
  prefs: number[];
  order: CardOrder;
  scope: CardScope;
}

type PageState =
  | { mode: 'setup' }
  | { mode: 'loading' }
  | { mode: 'error'; message: string }
  | { mode: 'studying'; cards: Card[]; settings: StudySettings }
  | { mode: 'done'; cards: Card[]; settings: StudySettings };

function buildCards(all: { item: ManholeItem; pref: number }[], settings: StudySettings, learned: Set<string>): Card[] {
  let picked = all;
  if (settings.scope === 'unlearned') picked = picked.filter(({ item }) => !learned.has(item.id));
  const cards = picked.map(({ item, pref }) => {
    // クイズと同様にデザイン蓋を優先
    const designs = item.imgs.filter((i) => i.kind === 'design');
    return { item, pref, imgs: designs.length > 0 ? designs : item.imgs };
  });
  return settings.order === 'shuffle' ? shuffled(cards) : cards;
}

export function ManholeCards() {
  const [state, setState] = useState<PageState>({ mode: 'setup' });
  const [learned, setLearned] = useState<Set<string>>(() => loadLearnedManholes());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);

  const setLearnedAndSave = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setLearned((prev) => {
      const next = updater(prev);
      saveLearnedManholes(next);
      return next;
    });
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
      setIndex(0);
      setRevealed(false);
      setImgIndex(0);
      setState({ mode: 'studying', cards, settings });
    } catch (err) {
      setState({ mode: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const goTo = useCallback(
    (nextIndex: number) => {
      if (state.mode !== 'studying') return;
      if (nextIndex >= state.cards.length) {
        setState({ mode: 'done', cards: state.cards, settings: state.settings });
        return;
      }
      setIndex(Math.max(0, nextIndex));
      setRevealed(false);
      setImgIndex(0);
    },
    [state],
  );

  const card = state.mode === 'studying' ? state.cards[index] : undefined;

  const markLearned = useCallback(() => {
    if (!card) return;
    if (learned.has(card.item.id)) {
      setLearnedAndSave((prev) => {
        const next = new Set(prev);
        next.delete(card.item.id);
        return next;
      });
    } else {
      setLearnedAndSave((prev) => new Set(prev).add(card.item.id));
      goTo(index + 1);
    }
  }, [card, learned, setLearnedAndSave, goTo, index]);

  useEffect(() => {
    if (state.mode !== 'studying') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setRevealed((r) => !r);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(index - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        markLearned();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.mode, index, goTo, markLearned]);

  // 次のカードの1枚目を先読みしてめくり待ちを減らす
  const nextImgUrl =
    state.mode === 'studying' && index + 1 < state.cards.length ? state.cards[index + 1].imgs[0]?.url : undefined;

  const learnedInRange = useMemo(() => {
    if (state.mode !== 'studying' && state.mode !== 'done') return 0;
    return state.cards.filter((c) => learned.has(c.item.id)).length;
  }, [state, learned]);

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
    case 'studying': {
      if (!card) return null;
      const img = card.imgs[Math.min(imgIndex, card.imgs.length - 1)];
      const isLearned = learned.has(card.item.id);
      return (
        <div className="page cards-page">
          <header className="cards-header">
            <button className="btn btn-ghost btn-small" onClick={() => setState({ mode: 'setup' })}>
              終了
            </button>
            <span className="cards-progress">
              {index + 1} / {state.cards.length} 枚 ・ 覚えた {learnedInRange}
            </span>
          </header>

          <div className={`flashcard ${revealed ? 'flashcard-revealed' : ''}`} onClick={() => setRevealed((r) => !r)}>
            {isLearned && <span className="flashcard-badge">✓ 覚えた</span>}
            <div className="flashcard-img-wrap">
              <img src={img?.url} alt="マンホール蓋" loading="eager" />
              {card.imgs.length > 1 && (
                <div className="flashcard-img-nav" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setImgIndex((i) => (i - 1 + card.imgs.length) % card.imgs.length)}>‹</button>
                  <span>
                    写真 {Math.min(imgIndex, card.imgs.length - 1) + 1}/{card.imgs.length}
                  </span>
                  <button onClick={() => setImgIndex((i) => (i + 1) % card.imgs.length)}>›</button>
                </div>
              )}
            </div>
            {revealed ? (
              <div className="flashcard-answer" onClick={(e) => e.stopPropagation()}>
                <p className="flashcard-name">
                  {card.item.name}
                  <span className="flashcard-pref">（{prefName(card.pref)}）</span>
                </p>
                {card.item.into && <p className="flashcard-into">現在: {card.item.into}</p>}
                {img?.desc && <p className="flashcard-desc">{img.desc}</p>}
                <a href={card.item.page} target="_blank" rel="noreferrer">
                  出典ページ
                </a>
              </div>
            ) : (
              <div className="flashcard-hidden">
                どこの蓋？ <span className="flashcard-tap">タップ / <kbd>Space</kbd> で答え</span>
              </div>
            )}
          </div>

          <div className="cards-actions">
            <button className="btn" disabled={index === 0} onClick={() => goTo(index - 1)}>
              ← 前へ
            </button>
            <button className="btn" onClick={() => setRevealed((r) => !r)}>
              {revealed ? '隠す' : '答えを見る'}
              <kbd>Space</kbd>
            </button>
            <button className="btn" onClick={() => goTo(index + 1)}>
              まだ →
            </button>
            <button className={`btn ${isLearned ? '' : 'btn-primary'}`} onClick={markLearned}>
              {isLearned ? '覚えた解除' : '覚えた'}
              {!isLearned && <kbd>Enter</kbd>}
            </button>
          </div>
          {nextImgUrl && <img src={nextImgUrl} alt="" style={{ display: 'none' }} />}
        </div>
      );
    }
    case 'done':
      return (
        <div className="page page-center">
          <h2>おつかれさま！</h2>
          <div className="result-card">
            <p className="result-accuracy">{state.cards.length} 枚</p>
            <p>めくり終わり ・ この範囲で覚えた {learnedInRange} 枚</p>
          </div>
          <div className="result-actions">
            <button className="btn btn-primary" onClick={() => start(state.settings)}>
              もう一度
            </button>
            {learnedInRange < state.cards.length && (
              <button className="btn" onClick={() => start({ ...state.settings, scope: 'unlearned' })}>
                未習得だけもう一度
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setState({ mode: 'setup' })}>
              設定へ
            </button>
          </div>
        </div>
      );
  }
}

function CardSetup({ onStart }: { onStart: (settings: StudySettings) => void }) {
  const [prefs, setPrefs] = useState<Set<number>>(new Set(ALL_PREF_CODES));
  const [order, setOrder] = useState<CardOrder>('shuffle');
  const [scope, setScope] = useState<CardScope>('all');
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

  return (
    <div className="page">
      <div className="filter-panel">
        <h2>マンホール単語帳</h2>
        <p className="filter-desc">
          デザイン蓋を1枚ずつめくって自治体名を暗記する。覚えた蓋にチェックを付けて、未習得の蓋だけに絞り込める。
        </p>

        <section>
          <h3>範囲</h3>
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
