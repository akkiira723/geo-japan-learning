import { useEffect, useRef, useState } from 'react';
import { MAX_TEXT_MISSES, useTextQuizEngine } from '../../hooks/useTextQuizEngine';
import { maskName } from '../../lib/textAnswer';
import type { Question } from '../../quizzes/types';
import { RevealMap } from '../map/RevealMap';
import { RubyText } from './RubyText';

export interface TextQuizShellProps {
  questions: Question[];
  quizTitle: string;
  /** 出題範囲の都道府県。1県のみなら都道府県ヒントの代わりに読みの文字数を出す */
  prefs?: number[];
  onFinish: (stats: { targetCount: number; hitCount: number; missCount: number; giveUpCount: number }) => void;
  onExit: () => void;
}

/** テキスト入力回答式のクイズ画面（answerMode='text'）。地図は正解発表時のみ表示 */
export function TextQuizShell({ questions, quizTitle, prefs, onFinish, onExit }: TextQuizShellProps) {
  const engine = useTextQuizEngine(questions);
  const { current, phase, feedback, misses } = engine;
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 次の問題に移ったら入力欄をクリアしてフォーカス
  useEffect(() => {
    if (phase !== 'guessing') return;
    setInput('');
    inputRef.current?.focus();
  }, [phase, current?.id]);

  // 回答表示中は入力欄からフォーカスを外す（Space の window ハンドラを効かせる）
  useEffect(() => {
    if (phase === 'revealed') inputRef.current?.blur();
  }, [phase]);

  // スペースキー: 回答表示中は次の問題へ（ページスクロールは抑止）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || phase !== 'revealed') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      engine.next();
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
  const singlePref = (prefs?.length ?? 0) === 1;

  const submit = () => {
    const result = engine.submit(input);
    // 空入力の案内時だけ入力を残す（誤答・回答済みは打ち直しやすいようクリア）
    if (result !== 'empty' && result !== 'ignored') setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // IME の変換確定 Enter では回答しない（keyCode 229 はブラウザ差の保険）
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

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
            <span className="quiz-multi-badge">答え {current.targets.length} 個 / あと {remain}</span>
          )}
        </div>
        <div className="quiz-progress">
          {phase === 'guessing' && misses > 0 && (
            <span className="quiz-miss-count">ミス {misses}/{MAX_TEXT_MISSES}　</span>
          )}
          {engine.index + 1} / {engine.total}
        </div>
      </header>

      <div className="text-quiz-body">
        <p className="text-quiz-lead">
          {multi
            ? `この旧市町村は現在 ${current.targets.length} 個の市町村に分かれています。すべて答えてください。`
            : 'この旧市町村は、現在なんという市町村になった？'}
        </p>

        <div className="text-quiz-input-row">
          <input
            ref={inputRef}
            type="text"
            className="text-quiz-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={phase !== 'guessing'}
            placeholder="例: 北広島市"
            autoComplete="off"
            aria-label="現在の市町村名"
          />
          <button
            className="btn btn-primary"
            disabled={phase !== 'guessing'}
            onClick={submit}
          >
            回答する <kbd>Enter</kbd>
          </button>
        </div>

        {feedback && (
          <div className={`quiz-feedback quiz-feedback-${feedback.type} text-quiz-feedback`}>
            {feedback.message}
          </div>
        )}

        {phase === 'guessing' && misses > 0 && (
          <div className="text-quiz-hints">
            <span className="text-quiz-hints-title">ヒント</span>
            {engine.remainingTargets.map((t) => {
              const mask = maskName(t.answer ?? '');
              // 1県に絞った出題では都道府県ヒントに意味がないので、ふりがなの文字数を ◯ のルビで出す
              const kanaLen = t.rubies?.[0]?.k.length;
              const showKana = misses >= 2 && singlePref && !!kanaLen;
              return (
                <span key={t.id} className="text-quiz-hint-row">
                  {showKana ? (
                    <ruby>
                      {mask}
                      <rt>{'○'.repeat(kanaLen)}</rt>
                    </ruby>
                  ) : (
                    mask
                  )}
                  {misses >= 2 && !singlePref && t.answerPref && (
                    <span className="text-quiz-hint-pref">（{t.answerPref}）</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {phase === 'revealed' && (
          <div className="text-quiz-map">
            {/* 問題ごとに作り直してズーム状態をリセットする */}
            <RevealMap key={current.id} targets={current.targets} solvedIds={engine.solvedIds} />
          </div>
        )}

        {phase === 'revealed' && (
          <ul className="text-quiz-answers">
            {current.targets.map((t) => {
              const solved = engine.solvedIds.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`text-quiz-answer ${solved ? 'text-quiz-answer-solved' : 'text-quiz-answer-missed'}`}
                >
                  <span className="text-quiz-answer-mark">{solved ? '✓ 正解' : '答え'}</span>
                  <span className="text-quiz-answer-name">
                    <RubyText text={t.label} rubies={t.rubies} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="quiz-footer">
        {phase === 'guessing' ? (
          <>
            <span className="quiz-hint">漢字の正式名で入力して Enter（例: さいたま市）</span>
            <button className="btn btn-ghost" onClick={engine.giveUp}>
              降参して答えを見る
            </button>
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
