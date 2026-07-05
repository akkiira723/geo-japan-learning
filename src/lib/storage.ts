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
