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

const MANHOLE_LEARNED_KEY = 'geo-japan-learning:manhole-learned';
const EMBLEM_LEARNED_KEY = 'geo-japan-learning:emblem-learned';

function loadLearned(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveLearned(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // localStorage 不可の環境では保存をあきらめる
  }
}

/** マンホール単語帳で「覚えた」にした自治体の item id 集合 */
export const loadLearnedManholes = (): Set<string> => loadLearned(MANHOLE_LEARNED_KEY);
export const saveLearnedManholes = (ids: Set<string>): void => saveLearned(MANHOLE_LEARNED_KEY, ids);

/** 市章単語帳で「覚えた」にした自治体の item id 集合 */
export const loadLearnedEmblems = (): Set<string> => loadLearned(EMBLEM_LEARNED_KEY);
export const saveLearnedEmblems = (ids: Set<string>): void => saveLearned(EMBLEM_LEARNED_KEY, ids);
