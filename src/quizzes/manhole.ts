import type { MultiPolygon } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule } from './types';

interface ManholeItem {
  id: string;
  name: string;
  page: string;
  imgs: { url: string; kind: string }[];
  into?: string;
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

interface ManholeChunk {
  pref: number;
  items: ManholeItem[];
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const chunks = await Promise.all(
    filter.prefs.map((p) => loadChunk<ManholeChunk>(`manholes/pref-${String(p).padStart(2, '0')}.json`)),
  );
  const all: { item: ManholeItem; pref: number }[] = chunks.flatMap((c) =>
    c.items.map((item) => ({ item, pref: c.pref })),
  );

  const picked = shuffled(all).slice(0, filter.questionCount);
  return picked.map(({ item, pref }) => {
    // デザイン蓋を優先しつつランダムに1枚
    const designs = item.imgs.filter((i) => i.kind === 'design');
    const pool = designs.length > 0 ? designs : item.imgs;
    const img = pool[Math.floor(Math.random() * pool.length)];
    return {
      id: `manhole:${item.id}`,
      prompt: 'このマンホールはどこ？',
      sub: 'マンホールクイズ',
      image: img.url,
      imageLink: item.page,
      targets: [
        {
          id: item.id,
          label: `${item.name}（${prefName(pref)}）`,
          sublabel: item.into ? `現在: ${item.into}` : undefined,
          kind: 'polygon' as const,
          point: item.point,
          bbox: item.bbox,
          geom: item.geom,
        },
      ],
    };
  });
}

export const manholeQuiz: QuizModule = {
  meta: {
    id: 'manhole',
    title: 'マンホールクイズ',
    description:
      'ご当地デザインマンホールの写真から自治体を当てる。その自治体（旧市町村の蓋なら旧町村域）内をクリックで正解。',
    usesRadius: false,
    hasOperatorFilter: false,
  },
  loadQuestions,
};
