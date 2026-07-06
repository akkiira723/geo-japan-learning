import type { MultiPolygon, Polygon } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule, Target } from './types';

interface TownEntry {
  id: string;
  n: string;
  gun: string;
  into: string;
  point: [number, number];
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

interface TownChunk {
  pref: number;
  towns: TownEntry[];
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const chunks = await Promise.all(
    filter.prefs.map((p) => loadChunk<TownChunk>(`legacy/pref-${String(p).padStart(2, '0')}.json`)),
  );

  // 同名の旧市町村を1問にまとめる（全箇所回答が必要）
  const byName = new Map<string, { town: TownEntry; pref: number }[]>();
  for (const chunk of chunks) {
    for (const town of chunk.towns) {
      const group = byName.get(town.n);
      const entry = { town, pref: chunk.pref };
      if (group) group.push(entry);
      else byName.set(town.n, [entry]);
    }
  }

  const names = shuffled([...byName.keys()]).slice(0, filter.questionCount);
  return names.map((name) => {
    const group = byName.get(name)!;
    const targets: Target[] = group.map(({ town, pref }) => ({
      id: town.id,
      label: `${name}（${prefName(pref)}${town.gun ? ' ' + town.gun : ''}）`,
      sublabel: town.into ? `現在: ${town.into}` : undefined,
      kind: 'polygon',
      point: town.point,
      bbox: town.bbox,
      geom: town.geom,
    }));
    return {
      id: `legacy:${name}`,
      prompt: name,
      sub: '旧市町村クイズ',
      targets,
    };
  });
}

export const legacyTownQuiz: QuizModule = {
  meta: {
    id: 'legacy',
    title: '旧市町村クイズ',
    description:
      '平成の大合併などで消滅した市町村の場所を地図でクリック。同名の旧市町村が複数ある場合は全部の場所を答えよう。',
    usesRadius: false,
    hasOperatorFilter: false,
    hoverKind: 'legacy',
  },
  loadQuestions,
};
