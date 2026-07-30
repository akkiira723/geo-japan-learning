import { useCallback, useMemo, useRef, useState } from 'react';
import { matchesAnswer, normalizeAnswer } from '../lib/textAnswer';
import type { Question } from '../quizzes/types';
import type { Feedback, QuizPhase, SessionStats } from './useQuizEngine';

/** テキスト回答式の1問あたりの許容ミス回数。到達したら正解を表示する */
export const MAX_TEXT_MISSES = 3;

export type SubmitResult = 'hit' | 'miss' | 'duplicate' | 'empty' | 'ignored';

/**
 * テキスト入力回答式クイズのセッション状態。
 * useQuizEngine（地図クリック判定）とは判定・ヒント段階が異なるため別フック。
 * ミス回数は設問単位の通算で、途中の正解ではリセットしない。
 */
export function useTextQuizEngine(questions: Question[]) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>(questions.length > 0 ? 'guessing' : 'finished');
  const [misses, setMisses] = useState(0);
  const [solvedIds, setSolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const statsRef = useRef<SessionStats>({ targetCount: 0, hitCount: 0, missCount: 0, giveUpCount: 0 });

  const current: Question | null = phase === 'finished' ? null : questions[index] ?? null;

  const remainingTargets = useMemo(
    () => (current ? current.targets.filter((t) => !solvedIds.has(t.id)) : []),
    [current, solvedIds],
  );

  const submit = useCallback(
    (raw: string): SubmitResult => {
      if (phase !== 'guessing' || !current) return 'ignored';
      if (normalizeAnswer(raw).length === 0) {
        setFeedback({ type: 'info', message: '市町村名を入力してから Enter で回答してください' });
        return 'empty';
      }
      // 回答済みの答えを再入力してもミスにはしない
      const solved = current.targets.find(
        (t) => solvedIds.has(t.id) && t.answer && matchesAnswer(raw, t.answer),
      );
      if (solved) {
        setFeedback({
          type: 'info',
          message: `「${solved.answer}」は回答済みです（あと ${remainingTargets.length} 個）`,
        });
        return 'duplicate';
      }
      const hit = remainingTargets.find((t) => t.answer && matchesAnswer(raw, t.answer));
      if (hit) {
        const nextSolved = new Set(solvedIds).add(hit.id);
        setSolvedIds(nextSolved);
        statsRef.current.hitCount += 1;
        const remain = current.targets.length - nextSolved.size;
        if (remain === 0) {
          setPhase('revealed');
          setFeedback({ type: 'hit', message: '正解！' });
        } else {
          setFeedback({ type: 'hit', message: `正解！ あと ${remain} 個` });
        }
        return 'hit';
      }
      statsRef.current.missCount += 1;
      const nextMisses = misses + 1;
      setMisses(nextMisses);
      if (nextMisses >= MAX_TEXT_MISSES) {
        // 3回外したら不正解として正解を表示
        statsRef.current.giveUpCount += remainingTargets.length;
        setPhase('revealed');
        setFeedback({ type: 'giveup', message: `不正解…（ミス ${MAX_TEXT_MISSES} 回）正解はこちら` });
      } else {
        setFeedback({ type: 'miss', message: `はずれ…（あと ${MAX_TEXT_MISSES - nextMisses} 回）` });
      }
      return 'miss';
    },
    [phase, current, solvedIds, remainingTargets, misses],
  );

  const giveUp = useCallback(() => {
    if (phase !== 'guessing' || !current) return;
    statsRef.current.giveUpCount += remainingTargets.length;
    setPhase('revealed');
    setFeedback({ type: 'giveup', message: '正解を表示します' });
  }, [phase, current, remainingTargets]);

  const next = useCallback(() => {
    if (phase !== 'revealed') return;
    const q = questions[index];
    if (q) statsRef.current.targetCount += q.targets.length;
    setSolvedIds(new Set());
    setMisses(0);
    setFeedback(null);
    if (index + 1 >= questions.length) {
      setPhase('finished');
    } else {
      setIndex(index + 1);
      setPhase('guessing');
    }
  }, [phase, questions, index]);

  return {
    current,
    index,
    total: questions.length,
    phase,
    misses,
    solvedIds,
    remainingTargets,
    submit,
    giveUp,
    next,
    feedback,
    stats: statsRef.current,
  };
}
