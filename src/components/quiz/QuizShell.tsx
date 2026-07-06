import { useEffect, useState } from 'react';
import { useQuizEngine } from '../../hooks/useQuizEngine';
import type { HoverKind, Question } from '../../quizzes/types';
import { QuizMap } from '../map/QuizMap';

export interface QuizShellProps {
  questions: Question[];
  radiusKm: number;
  quizTitle: string;
  hoverKind?: HoverKind;
  hoverPrefs?: number[];
  onFinish: (stats: { targetCount: number; hitCount: number; missCount: number; giveUpCount: number }) => void;
  onExit: () => void;
}

export function QuizShell({ questions, radiusKm, quizTitle, hoverKind, hoverPrefs, onFinish, onExit }: QuizShellProps) {
  const engine = useQuizEngine(questions, radiusKm);
  const { current, phase, pin, feedback } = engine;
  const [imgExpanded, setImgExpanded] = useState(false);

  useEffect(() => {
    setImgExpanded(false);
  }, [current?.id]);

  // スペースキー: 出題中はピン確定、回答表示中は次の問題へ
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
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
            {current.prompt}
          </span>
          {multi && phase === 'guessing' && (
            <span className="quiz-multi-badge">全 {current.targets.length} 箇所 / あと {remain}</span>
          )}
        </div>
        <div className="quiz-progress">
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
          question={current}
          revealed={phase === 'revealed'}
          pin={pin}
          hitMarks={engine.hitMarks}
          missMarks={engine.missMarks}
          radiusKm={radiusKm}
          onPlacePin={engine.placePin}
          hoverKind={hoverKind}
          hoverPrefs={hoverPrefs}
        />
        {feedback && (
          <div className={`quiz-feedback quiz-feedback-${feedback.type}`}>{feedback.message}</div>
        )}
      </div>

      <footer className="quiz-footer">
        {phase === 'guessing' ? (
          <>
            <button className="btn btn-ghost" onClick={engine.giveUp}>降参して答えを見る</button>
            <button className="btn btn-primary" disabled={!pin} onClick={engine.confirm}>
              回答する <kbd>Space</kbd>
            </button>
            {!pin && <span className="quiz-hint">地図をクリックしてピンを置き、Space で回答</span>}
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
