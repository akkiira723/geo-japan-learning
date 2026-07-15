import type { MultiLineString } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { prefName } from '../lib/prefectures';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule, RouteBand } from './types';

interface RouteRecord {
  n: number;
  /** 通過都道府県（線に沿った初出順） */
  prefs: number[];
  /** [lat, lng] 最長チェーンの中間点（線上の代表点） */
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiLineString;
}

interface RouteChunk {
  band: RouteBand;
  items: RouteRecord[];
}

const ALL_BANDS: RouteBand[] = ['two', 'three-low', 'three-high'];

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const bands = filter.routeBands?.length ? filter.routeBands : ALL_BANDS;
  const chunks = await Promise.all(bands.map((b) => loadChunk<RouteChunk>(`routes/${b}.json`)));
  const pool = chunks.flatMap((c) => c.items);

  // 出題数の絞り込みはランダムに行い、昇順モードでは選ばれた問題を番号順に並べ替える
  const routes = shuffled(pool).slice(0, filter.questionCount);
  if (filter.order === 'asc') routes.sort((a, b) => a.n - b.n);
  return routes.map((r) => {
    const prefSummary =
      r.prefs.slice(0, 4).map(prefName).join('・') + (r.prefs.length > 4 ? ' など' : '');
    return {
      id: `route:${r.n}`,
      prompt: `国道${r.n}号`,
      sub: '国道番号クイズ',
      targets: [
        {
          id: String(r.n),
          label: `国道${r.n}号（${prefSummary}）`,
          kind: 'line' as const,
          point: r.point,
          bbox: r.bbox,
          geom: r.geom,
        },
      ],
    };
  });
}

export const routeQuiz: QuizModule = {
  meta: {
    id: 'route',
    title: '国道番号クイズ',
    description:
      '出題された国道をハイライトから選んで回答。カーソルを近づけると路線が光るのでクリックで選択。バイパスを含む全区間が対象。',
    usesRadius: false,
    hasOperatorFilter: false,
    nationwide: true,
    hasRouteFilters: true,
    answerMode: 'select',
    selectionLabel: (id) => `国道${id}号`,
  },
  loadQuestions,
};
