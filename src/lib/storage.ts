import type { QuizId } from '../quizzes/types';

export interface SessionRecord {
  quizId: QuizId;
  playedAt: string; // ISO
  questionCount: number;
  targetCount: number;
  hitCount: number;
  missCount: number;
  giveUpCount: number;
}

const KEY = 'geo-japan-learning:sessions';
const MAX_RECORDS = 200;

export function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(record: SessionRecord): void {
  try {
    const all = [record, ...loadSessions()].slice(0, MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // localStorage 不可の環境では成績保存をあきらめる
  }
}

const LEARNED_KEY = 'geo-japan-learning:manhole-learned';

/** 単語帳で「覚えた」にした蓋の item id 集合 */
export function loadLearnedManholes(): Set<string> {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveLearnedManholes(ids: Set<string>): void {
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage 不可の環境では保存をあきらめる
  }
}
