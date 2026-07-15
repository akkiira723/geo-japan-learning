import { areaCodeQuiz } from './areaCode';
import { highwayQuiz } from './highway';
import { legacyTownQuiz } from './legacyTown';
import { manholeQuiz } from './manhole';
import { routeQuiz } from './route';
import { stationQuiz } from './station';
import type { QuizId, QuizModule } from './types';

export const QUIZZES: Partial<Record<QuizId, QuizModule>> = {
  areacode: areaCodeQuiz,
  legacy: legacyTownQuiz,
  station: stationQuiz,
  route: routeQuiz,
  highway: highwayQuiz,
  manhole: manholeQuiz,
};

export function getQuiz(id: string | undefined): QuizModule | null {
  if (!id) return null;
  return (QUIZZES as Record<string, QuizModule | undefined>)[id] ?? null;
}
