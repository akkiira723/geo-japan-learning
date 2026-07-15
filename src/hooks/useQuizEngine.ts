import { useCallback, useMemo, useRef, useState } from 'react';
import { judgeClick } from '../lib/judge';
import type { LatLng, Question, Target } from '../quizzes/types';

export type QuizPhase = 'guessing' | 'revealed' | 'finished';

/** 1問あたりの許容ミス回数。超えたら不正解として正解を表示する */
export const MAX_MISSES = 5;

export interface HitMark {
  target: Target;
  click: LatLng;
}

export interface Feedback {
  type: 'hit' | 'miss' | 'giveup';
  message: string;
}

export interface SessionStats {
  targetCount: number;
  hitCount: number;
  missCount: number;
  giveUpCount: number;
}

export function useQuizEngine(questions: Question[], radiusKm: number, selectMode = false) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>(questions.length > 0 ? 'guessing' : 'finished');
  const [pin, setPin] = useState<LatLng | null>(null);
  /** 選択式（selectMode）: ピンと同時に選んだターゲット id。選択なしクリックは null */
  const [selection, setSelection] = useState<string | null>(null);
  const [hitMarks, setHitMarks] = useState<HitMark[]>([]);
  const [missMarks, setMissMarks] = useState<LatLng[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const statsRef = useRef<SessionStats>({ targetCount: 0, hitCount: 0, missCount: 0, giveUpCount: 0 });
  const [, bumpStats] = useState(0);

  const current: Question | null = phase === 'finished' ? null : questions[index] ?? null;

  const remainingTargets = useMemo(() => {
    if (!current) return [];
    const hitIds = new Set(hitMarks.map((h) => h.target.id));
    return current.targets.filter((t) => !hitIds.has(t.id));
  }, [current, hitMarks]);

  const placePin = useCallback(
    (p: LatLng, selectionId?: string | null) => {
      if (phase !== 'guessing') return;
      setPin(p);
      setSelection(selectionId ?? null);
    },
    [phase],
  );

  const confirm = useCallback(() => {
    if (phase !== 'guessing' || !pin || !current) return;
    // 選択式: 選んだ線形の一致で判定。距離はミス表示用にクリック地点から計算する
    const judged = judgeClick(remainingTargets, pin, radiusKm);
    const hitTarget = selectMode
      ? (selection && remainingTargets.find((t) => t.id === selection)) || null
      : judged.hitTarget;
    const nearestDistanceKm = judged.nearestDistanceKm;
    if (hitTarget) {
      const nextHits = [...hitMarks, { target: hitTarget, click: pin }];
      setHitMarks(nextHits);
      statsRef.current.hitCount += 1;
      const remain = current.targets.length - nextHits.length;
      if (remain === 0) {
        setPhase('revealed');
        setFeedback({ type: 'hit', message: '正解！' });
      } else {
        setFeedback({ type: 'hit', message: `正解！ あと ${remain} 箇所` });
      }
    } else {
      statsRef.current.missCount += 1;
      setMissMarks((m) => [...m, pin]);
      const missCount = missMarks.length + 1;
      if (missCount >= MAX_MISSES) {
        // 5回外したら不正解として正解を表示
        statsRef.current.giveUpCount += remainingTargets.length;
        setPhase('revealed');
        setFeedback({ type: 'giveup', message: `不正解…（ミス ${MAX_MISSES} 回）正解はこちら` });
      } else {
        const km = nearestDistanceKm === Infinity ? null : Math.round(nearestDistanceKm);
        setFeedback({
          type: 'miss',
          message:
            (km === null ? 'はずれ…' : `はずれ… 最寄りの正解まで約 ${km} km`) +
            `（あと ${MAX_MISSES - missCount} 回）`,
        });
      }
    }
    bumpStats((n) => n + 1);
    setPin(null);
    setSelection(null);
  }, [phase, pin, current, remainingTargets, radiusKm, hitMarks, missMarks, selectMode, selection]);

  const giveUp = useCallback(() => {
    if (phase !== 'guessing' || !current) return;
    statsRef.current.giveUpCount += remainingTargets.length;
    bumpStats((n) => n + 1);
    setPhase('revealed');
    setFeedback({ type: 'giveup', message: '正解を表示します' });
    setPin(null);
    setSelection(null);
  }, [phase, current, remainingTargets]);

  const next = useCallback(() => {
    if (phase !== 'revealed') return;
    const q = questions[index];
    if (q) statsRef.current.targetCount += q.targets.length;
    setPin(null);
    setSelection(null);
    setHitMarks([]);
    setMissMarks([]);
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
    pin,
    selection,
    placePin,
    confirm,
    giveUp,
    next,
    hitMarks,
    missMarks,
    remainingTargets,
    feedback,
    stats: statsRef.current,
  };
}
