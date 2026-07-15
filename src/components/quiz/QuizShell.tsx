import { useEffect, useState } from 'react';
import { MAX_MISSES, useQuizEngine } from '../../hooks/useQuizEngine';
import type { HoverKind, Question, QuizId } from '../../quizzes/types';
import { QuizMap } from '../map/QuizMap';
import { RubyText } from './RubyText';

export interface QuizShellProps {
  quizId: QuizId;
  questions: Question[];
  radiusKm: number;
  quizTitle: string;
  prefs?: number[];
  hoverKind?: HoverKind;
  hoverPrefs?: number[];
  /** 'select' = 線形をホバー選択して回答（国道番号クイズ） */
  answerMode?: 'select';
  /** 選択式のミス表示用: 選択 id を表示名にする */
  selectionLabel?: (id: string) => string;
  onFinish: (stats: { targetCount: number; hitCount: number; missCount: number; giveUpCount: number }) => void;
  onExit: () => void;
}

export function QuizShell({ quizId, questions, radiusKm, quizTitle, prefs, hoverKind, hoverPrefs, answerMode, selectionLabel, onFinish, onExit }: QuizShellProps) {
  const engine = useQuizEngine(questions, radiusKm, { selectMode: answerMode === 'select', selectionLabel });
  const { current, phase, pin, feedback } = engine;
  const [imgExpanded, setImgExpanded] = useState(true);

  useEffect(() => {
    setImgExpanded(true);
  }, [current?.id]);

  // スペースキー: 出題中はピン確定、回答表示中は次の問題へ。Tab: 出題中は降参
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Tab') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Tab') {
        // 出題中のみフォーカス移動を乗っ取る（回答表示中は通常のタブ移動のまま）
        if (phase !== 'guessing') return;
        e.preventDefault();
        engine.giveUp();
        return;
      }
      e.preventDefault();
      if (phase === 'guessing') engine.confirm();
      else if (phase === 'revealed') engine.next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, engine]);

  useEffect(() => {
    if (phase === 'finished') onFinish(engine.stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'finished' || !current) return null;

  const multi = current.targets.length > 1;
  const remain = engine.remainingTargets.length;

  return (
    <div className="quiz-shell">
      <header className="quiz-header">
        <button className="btn btn-ghost" onClick={onExit}>← 終了</button>
        <div className="quiz-question">
          <span className="quiz-sub">{current.sub ?? quizTitle}</span>
          <span className={`quiz-prompt ${current.prompt.length > 8 ? 'quiz-prompt-long' : ''}`}>
            <RubyText text={current.prompt} rubies={current.promptRubies} />
          </span>
          {multi && phase === 'guessing' && (
            <span className="quiz-multi-badge">全 {current.targets.length} 箇所 / あと {remain}</span>
          )}
        </div>
        <div className="quiz-progress">
          {phase === 'guessing' && engine.missMarks.length > 0 && (
            <span className="quiz-miss-count">ミス {engine.missMarks.length}/{MAX_MISSES}　</span>
          )}
          {engine.index + 1} / {engine.total}
        </div>
      </header>

      <div className="quiz-map-wrap">
        {current.image && (
          <div
            className={`quiz-image ${imgExpanded ? 'quiz-image-expanded' : ''}`}
            onClick={() => setImgExpanded(!imgExpanded)}
            title="クリックで拡大/縮小"
          >
            <img src={current.image} alt="マンホールの写真" />
            {phase === 'revealed' && current.imageDesc && (
              <p className="quiz-image-desc">{current.imageDesc}</p>
            )}
            {phase === 'revealed' && current.imageLink && (
              <a
                href={current.imageLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                出典: 日本マンホール蓋学会
              </a>
            )}
          </div>
        )}
        <QuizMap
          quizId={quizId}
          question={current}
          revealed={phase === 'revealed'}
          pin={pin}
          hitMarks={engine.hitMarks}
          missMarks={engine.missMarks}
          radiusKm={radiusKm}
          onPlacePin={engine.placePin}
          prefs={prefs}
          hoverKind={hoverKind}
          hoverPrefs={hoverPrefs}
          answerMode={answerMode}
          selectedId={engine.selection}
        />
        {feedback && (
          <div className={`quiz-feedback quiz-feedback-${feedback.type}`}>{feedback.message}</div>
        )}
      </div>

      <footer className="quiz-footer">
        {phase === 'guessing' ? (
          <>
            <button className="btn btn-ghost" onClick={engine.giveUp}>
              降参して答えを見る <kbd>Tab</kbd>
            </button>
            <button className="btn btn-primary" disabled={!pin} onClick={engine.confirm}>
              回答する <kbd>Space</kbd>
            </button>
            {!pin && (
              <span className="quiz-hint">
                {answerMode === 'select'
                  ? '国道をクリックして選択し、Space で回答'
                  : '地図をクリックしてピンを置き、Space で回答'}
              </span>
            )}
          </>
        ) : (
          <button className="btn btn-primary" onClick={engine.next}>
            {engine.index + 1 >= engine.total ? '結果を見る' : '次の問題へ'} <kbd>Space</kbd>
          </button>
        )}
      </footer>
    </div>
  );
}
