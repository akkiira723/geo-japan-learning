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
  type: 'hit' | 'miss' | 'giveup' | 'info';
  message: string;
}

export interface QuizEngineOptions {
  /** 選択式回答（answerMode='select'）: 選択 id とターゲット id の一致で判定する */
  selectMode?: boolean;
  /** 選択式のミス表示用: 選択 id を表示名にする（例: '15' → '国道15号'） */
  selectionLabel?: (id: string) => string;
}

export interface SessionStats {
  targetCount: number;
  hitCount: number;
  missCount: number;
  giveUpCount: number;
}

export function useQuizEngine(questions: Question[], radiusKm: number, options: QuizEngineOptions = {}) {
  const { selectMode = false, selectionLabel } = options;
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
    if (phase !== 'guessing' || !current) return;
    // ピンなしで回答操作をしたら、黙って無視せず操作を案内する
    if (!pin) {
      setFeedback({
        type: 'info',
        message: selectMode
          ? '地図上の線をクリックして選択してから回答してください'
          : '地図をクリックしてピンを置いてから回答してください',
      });
      return;
    }
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
        // 選択式では「何を答えたか」を出す（正解との距離だけでは選んだ路線が分からない）
        const answered =
          selectMode && selection && selectionLabel ? `（回答: ${selectionLabel(selection)}）` : '';
        setFeedback({
          type: 'miss',
          message:
            `はずれ…${answered}` +
            (km === null ? '' : ` 最寄りの正解まで約 ${km} km`) +
            `（あと ${MAX_MISSES - missCount} 回）`,
        });
      }
    }
    bumpStats((n) => n + 1);
    setPin(null);
    setSelection(null);
  }, [phase, pin, current, remainingTargets, radiusKm, hitMarks, missMarks, selectMode, selection, selectionLabel]);

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
