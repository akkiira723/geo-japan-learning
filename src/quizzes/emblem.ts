import type { MultiPolygon } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { PopulationTop, Question, QuizFilter, QuizModule, Ruby } from './types';

export interface EmblemItem {
  id: string;
  pref: number;
  /** 表示名。旧市町村は「○○町（旧）」 */
  name: string;
  kana?: string;
  /** public/data/ からの相対パス（PNG） */
  img: string;
  /** 出典ページ URL */
  page: string;
  /** 旧市町村（消滅自治体）の章 */
  legacy?: true;
  /** 旧市町村のみ: 郡名（同名の旧町村の区別用。ラベルの先頭に付ける） */
  gun?: string;
  into?: string;
  intoYomi?: Ruby[];
  /** 現行章のみ: 2020年国勢調査の人口順位・人口 */
  rank?: number;
  pop?: number;
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

interface EmblemChunk { pref: number; items: EmblemItem[]; }
interface TopChunk { from: number; to: number; items: EmblemItem[]; }

/** 人口順位帯ごとのファイル（順位 1–100 / 101–300 / 301–500 / 501–1000）。Top N は N 以下の帯だけ読む */
const TOP_FILES: [upTo: PopulationTop, file: string][] = [
  [100, 'top-0100'],
  [300, 'top-0300'],
  [500, 'top-0500'],
  [1000, 'top-1000'],
];

/** 指定した都道府県の市章データ（現行 + 旧市町村） */
export async function loadEmblemItems(prefs: number[]): Promise<EmblemItem[]> {
  const chunks = await Promise.all(
    prefs.map((p) => loadChunk<EmblemChunk>(`emblems/pref-${String(p).padStart(2, '0')}.json`)),
  );
  return chunks.flatMap((c) => c.items);
}

/** 人口上位 N の現行市区町村の市章（順位順） */
export async function loadTopEmblemItems(top: PopulationTop): Promise<EmblemItem[]> {
  const files = TOP_FILES.filter(([upTo]) => upTo <= top).map(([, f]) => f);
  const chunks = await Promise.all(files.map((f) => loadChunk<TopChunk>(`emblems/${f}.json`)));
  return chunks.flatMap((c) => c.items);
}

function emblemRuby(item: EmblemItem): Ruby[] | undefined {
  if (!item.kana) return undefined;
  return [{ b: item.name.replace(/（旧）$/, ''), k: item.kana }];
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const pool = filter.populationTop
    ? await loadTopEmblemItems(filter.populationTop)
    : (await loadEmblemItems(filter.prefs)).filter((it) => filter.includeLegacy !== false || !it.legacy);

  const picked = shuffled(pool).slice(0, filter.questionCount);
  return picked.map((item) => ({
    id: `emblem:${item.id}`,
    prompt: 'この市章はどこ？',
    sub: '市章クイズ',
    image: `${import.meta.env.BASE_URL}data/${item.img}`,
    imageKind: 'emblem' as const,
    imageAlt: '市町村章',
    imageLink: item.page,
    imageSource: 'ちきページ',
    imageDesc:
      item.rank !== undefined && item.pop !== undefined
        ? `人口 ${item.pop.toLocaleString('ja-JP')} 人（全国 ${item.rank} 位・2020年国勢調査）`
        : undefined,
    targets: [
      {
        id: item.id,
        label: `${item.gun ?? ''}${item.name}（${prefName(item.pref)}）`,
        rubies: emblemRuby(item),
        sublabel: item.into ? `現在: ${item.into}` : undefined,
        sublabelRubies: item.intoYomi,
        kind: 'polygon' as const,
        point: item.point,
        bbox: item.bbox,
        geom: item.geom,
      },
    ],
  }));
}

export const emblemQuiz: QuizModule = {
  meta: {
    id: 'emblem',
    title: '市章クイズ',
    description:
      '市町村章（市章・町章・村章）からその自治体を当てる。自治体（旧市町村の章なら旧町村域）内をクリックで正解。人口上位 100〜1000 の市区町村に絞った出題もできる。',
    usesRadius: false,
    hasOperatorFilter: false,
    hoverKind: 'muni',
    hasPopulationFilter: true,
    hasLegacyToggle: true,
  },
  loadQuestions,
};
