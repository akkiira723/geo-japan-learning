import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { HighwayFacilityKind, Question, QuizFilter, QuizModule, Ruby, Target } from './types';

interface HighwayRecord {
  id: string;
  n: string;
  /** sapa チャンクのみ: SA か PA か */
  k?: 'sa' | 'pa';
  /** 地名コアのふりがな（b は n 中の対象部分、k はひらがな）。読みが無い施設は省略 */
  y?: Ruby;
  lat: number;
  lon: number;
  /** 道路名（例: ["東名高速道路"]）。取得できなかった施設は省略 */
  r?: string[];
  /** 都市高速なら 1（省略 = 都市間高速） */
  u?: 1;
  pref: number;
}

interface HighwayChunk {
  kind: HighwayFacilityKind;
  items: HighwayRecord[];
}

const ALL_KINDS: HighwayFacilityKind[] = ['ic', 'jct', 'sapa'];

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const kinds = filter.facilityKinds?.length ? filter.facilityKinds : ALL_KINDS;
  const chunks = await Promise.all(kinds.map((k) => loadChunk<HighwayChunk>(`highways/${k}.json`)));
  const roadTypes = new Set(filter.roadTypes?.length ? filter.roadTypes : ['inter', 'urban']);
  const facilities = chunks
    .flatMap((c) => c.items)
    .filter((f) => roadTypes.has(f.u ? 'urban' : 'inter'));

  // 同名施設を1問にまとめる（遠隔の同名 IC は複数ターゲット）
  const byName = new Map<string, HighwayRecord[]>();
  for (const f of facilities) {
    const group = byName.get(f.n);
    if (group) group.push(f);
    else byName.set(f.n, [f]);
  }

  const names = shuffled([...byName.keys()]).slice(0, filter.questionCount);
  return names.map((name) => {
    const group = byName.get(name)!;
    const roads = [...new Set(group.flatMap((f) => f.r ?? []))];
    const targets: Target[] = group.map((f) => ({
      id: f.id,
      label: `${name}（${prefName(f.pref)}${f.r?.[0] ? '・' + f.r[0] : ''}）`,
      rubies: f.y ? [f.y] : undefined,
      kind: 'point',
      point: [f.lat, f.lon],
    }));
    // 同名施設で読みが異なる場合は併記（b は同名グループなので共通）
    const yomis = group.map((f) => f.y).filter((y): y is Ruby => !!y);
    const kanas = [...new Set(yomis.map((y) => y.k))];
    return {
      id: `highway:${name}`,
      prompt: name,
      promptRubies: kanas.length > 0 ? [{ b: yomis[0].b, k: kanas.join('・') }] : undefined,
      // 全国出題で範囲の絞り込みがないため、道路名をヒントとして出す
      sub: roads.length > 0 ? roads.slice(0, 2).join('・') : '高速道路クイズ',
      targets,
    };
  });
}

export const highwayQuiz: QuizModule = {
  meta: {
    id: 'highway',
    title: '高速道路クイズ',
    description:
      '出題された IC・JCT・SA/PA の場所を地図でクリック。都市高速の出入口も含む。同名施設は全部の場所を答えよう。',
    usesRadius: true,
    hasOperatorFilter: false,
    nationwide: true,
    hasHighwayFilters: true,
  },
  loadQuestions,
};
