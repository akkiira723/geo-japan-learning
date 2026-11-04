import { useCallback, useEffect, useMemo, useState } from 'react';
import { prefName } from '../../lib/prefectures';
import type { Ruby } from '../../quizzes/types';
import { RubyText } from '../quiz/RubyText';

/** 単語帳の1カード（マンホール・市章で共用） */
export interface FlashCard {
  /** カードの一意キー */
  key: string;
  /** 「覚えた」の単位（自治体 id。同じ自治体の別画像のカードは同じ id） */
  learnId: string;
  pref: number;
  name: string;
  rubies?: Ruby[];
  /** 旧市町村のみ: 郡名（同名の旧町村の区別用） */
  gun?: string;
  /** 旧市町村のみ: 現在の自治体 */
  into?: string;
  intoYomi?: Ruby[];
  img: string;
  imgAlt: string;
  /** 'emblem' = 小さな市章 PNG を白地に余白付きで表示 */
  imgKind?: 'photo' | 'emblem';
  /** 答え表示時に画像の下端に出す注記（例: この自治体の写真 2/4） */
  imgNote?: string;
  desc?: string;
  link: string;
  linkLabel?: string;
}

interface FlashcardStudyProps {
  cards: FlashCard[];
  learned: Set<string>;
  onLearnedChange: (next: Set<string>) => void;
  onExit: () => void;
  /** 「もう一度」「未習得だけもう一度」 */
  onAgain: (scope: 'all' | 'unlearned') => void;
}

/**
 * カードをめくる画面（学習中 → めくり終わり）。
 * Space: 答えを表示/隠す、→/←: 次/前、Enter: 覚えた
 */
export function FlashcardStudy({ cards, learned, onLearnedChange, onExit, onAgain }: FlashcardStudyProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);

  // カード集合が変わったら最初から
  useEffect(() => {
    setIndex(0);
    setRevealed(false);
    setDone(false);
  }, [cards]);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= cards.length) {
        setDone(true);
        return;
      }
      setIndex(Math.max(0, nextIndex));
      setRevealed(false);
    },
    [cards.length],
  );

  const card = done ? undefined : cards[index];

  const markLearned = useCallback(() => {
    if (!card) return;
    const next = new Set(learned);
    if (next.has(card.learnId)) {
      next.delete(card.learnId);
      onLearnedChange(next);
    } else {
      next.add(card.learnId);
      onLearnedChange(next);
      goTo(index + 1);
    }
  }, [card, learned, onLearnedChange, goTo, index]);

  useEffect(() => {
    if (done) return;
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
  }, [done, index, goTo, markLearned]);

  // 次のカードの画像を先読みしてめくり待ちを減らす
  const nextImgUrl = !done && index + 1 < cards.length ? cards[index + 1].img : undefined;

  // 「覚えた」は自治体単位（同じ自治体の別の画像のカードにも付く）
  const unitCount = useMemo(() => new Set(cards.map((c) => c.learnId)).size, [cards]);
  const learnedInRange = useMemo(
    () => new Set(cards.filter((c) => learned.has(c.learnId)).map((c) => c.learnId)).size,
    [cards, learned],
  );

  if (done) {
    return (
      <div className="page page-center">
        <h2>おつかれさま！</h2>
        <div className="result-card">
          <p className="result-accuracy">{cards.length} 枚</p>
          <p>
            めくり終わり ・ この範囲で覚えた {learnedInRange} / {unitCount} 自治体
          </p>
        </div>
        <div className="result-actions">
          <button className="btn btn-primary" onClick={() => onAgain('all')}>
            もう一度
          </button>
          {learnedInRange < unitCount && (
            <button className="btn" onClick={() => onAgain('unlearned')}>
              未習得だけもう一度
            </button>
          )}
          <button className="btn btn-ghost" onClick={onExit}>
            設定へ
          </button>
        </div>
      </div>
    );
  }

  if (!card) return null;
  const isLearned = learned.has(card.learnId);
  return (
    <div className="page cards-page">
      <header className="cards-header">
        <button className="btn btn-ghost btn-small" onClick={onExit}>
          終了
        </button>
        <span className="cards-progress">
          {index + 1} / {cards.length} 枚 ・ 覚えた {learnedInRange} / {unitCount} 自治体
        </span>
      </header>

      <div className={`flashcard ${revealed ? 'flashcard-revealed' : ''}`} onClick={() => setRevealed((r) => !r)}>
        {isLearned && <span className="flashcard-badge">✓ 覚えた</span>}
        <div className={`flashcard-img-wrap ${card.imgKind === 'emblem' ? 'flashcard-emblem' : ''}`}>
          <img src={card.img} alt={card.imgAlt} loading="eager" />
          {card.imgNote && revealed && <span className="flashcard-img-nav">{card.imgNote}</span>}
        </div>
        {revealed ? (
          <div className="flashcard-answer" onClick={(e) => e.stopPropagation()}>
            <p className="flashcard-name">
              {card.gun && <span className="flashcard-gun">{card.gun}</span>}
              <RubyText text={card.name} rubies={card.rubies} />
              <span className="flashcard-pref">（{prefName(card.pref)}）</span>
            </p>
            {card.into && (
              <p className="flashcard-into">
                <RubyText text={`現在: ${card.into}`} rubies={card.intoYomi} />
              </p>
            )}
            {card.desc && <p className="flashcard-desc">{card.desc}</p>}
            <a href={card.link} target="_blank" rel="noreferrer">
              {card.linkLabel ?? '出典ページ'}
            </a>
          </div>
        ) : (
          <div className="flashcard-hidden">
            どこの{card.imgKind === 'emblem' ? '章' : '蓋'}？{' '}
            <span className="flashcard-tap">
              タップ / <kbd>Space</kbd> で答え
            </span>
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
