import { areaCodeQuiz } from './areaCode';
import { stationQuiz } from './station';
import type { QuizId, QuizModule } from './types';

export const QUIZZES: Partial<Record<QuizId, QuizModule>> = {
  station: stationQuiz,
  areacode: areaCodeQuiz,
};

export function getQuiz(id: string | undefined): QuizModule | null {
  if (!id) return null;
  return (QUIZZES as Record<string, QuizModule | undefined>)[id] ?? null;
}
