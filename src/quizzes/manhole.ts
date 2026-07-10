import type { MultiPolygon } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule, Ruby } from './types';

export interface ManholeItem {
  id: string;
  name: string;
  /** 自治体名のひらがな読み（「（旧）」サフィックスは含まない） */
  kana?: string;
  page: string;
  imgs: { url: string; kind: string; desc?: string }[];
  into?: string;
  /** into の各市区町村の読み */
  intoYomi?: Ruby[];
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

/** 表示名 name（「○○町（旧）」等）への Ruby。読み対象は （旧） を除く自治体名部分 */
export function manholeRuby(item: ManholeItem): Ruby[] | undefined {
  if (!item.kana) return undefined;
  return [{ b: item.name.replace(/（旧）$/, ''), k: item.kana }];
}

interface ManholeChunk {
  pref: number;
  items: ManholeItem[];
}

/** 指定した都道府県のマンホールデータを読み込む（クイズ・単語帳で共用） */
export async function loadManholeItems(prefs: number[]): Promise<{ item: ManholeItem; pref: number }[]> {
  const chunks = await Promise.all(
    prefs.map((p) => loadChunk<ManholeChunk>(`manholes/pref-${String(p).padStart(2, '0')}.json`)),
  );
  return chunks.flatMap((c) => c.items.map((item) => ({ item, pref: c.pref })));
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const all = await loadManholeItems(filter.prefs);

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
      imageDesc: img.desc,
      targets: [
        {
          id: item.id,
          label: `${item.name}（${prefName(pref)}）`,
          rubies: manholeRuby(item),
          sublabel: item.into ? `現在: ${item.into}` : undefined,
          sublabelRubies: item.intoYomi,
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
    hoverKind: 'muni',
  },
  loadQuestions,
};
