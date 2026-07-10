import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule, Target } from './types';

interface StationRecord {
  id: string;
  n: string;
  /** ひらがな読み（駅名部分のみ、「駅」を含まない） */
  kana?: string;
  lat: number;
  lon: number;
  lines: string[];
  op: 'jr' | 'subway' | 'other';
  pref: number;
}

interface StationChunk {
  pref: number;
  stations: Omit<StationRecord, 'pref'>[];
}

function matchOperator(op: StationRecord['op'], filter: QuizFilter['operator']): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'jr') return op === 'jr';
  return op !== 'jr';
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const chunks = await Promise.all(
    filter.prefs.map((p) =>
      loadChunk<StationChunk>(`stations/pref-${String(p).padStart(2, '0')}.json`),
    ),
  );
  const stations: StationRecord[] = chunks.flatMap((c) =>
    c.stations.filter((s) => matchOperator(s.op, filter.operator)).map((s) => ({ ...s, pref: c.pref })),
  );

  // 同名駅を1問にまとめる（フィルタ適用後の集合でグループ化）
  const byName = new Map<string, StationRecord[]>();
  for (const s of stations) {
    const group = byName.get(s.n);
    if (group) group.push(s);
    else byName.set(s.n, [s]);
  }

  const names = shuffled([...byName.keys()]).slice(0, filter.questionCount);
  return names.map((name) => {
    const group = byName.get(name)!;
    const targets: Target[] = group.map((s) => ({
      id: s.id,
      label: `${name}駅（${prefName(s.pref)}・${s.lines[0] ?? ''}）`,
      rubies: s.kana ? [{ b: name, k: s.kana }] : undefined,
      kind: 'point',
      point: [s.lat, s.lon],
    }));
    // 同名駅グループでも読みが異なることがある（金山: かなやま/かねやま）ので出題側は併記する
    const kanas = [...new Set(group.map((s) => s.kana).filter((k): k is string => !!k))];
    return {
      id: `station:${name}`,
      prompt: `${name}駅`,
      promptRubies: kanas.length > 0 ? [{ b: name, k: kanas.join('・') }] : undefined,
      sub: '駅名クイズ',
      targets,
    };
  });
}

export const stationQuiz: QuizModule = {
  meta: {
    id: 'station',
    title: '駅名クイズ',
    description: '出題された駅の場所を地図でクリック。同名駅が複数ある場合は全部の場所を答えよう。※一部廃駅も含む',
    usesRadius: true,
    hasOperatorFilter: true,
  },
  loadQuestions,
};
