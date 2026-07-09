import type { MultiPolygon } from 'geojson';
import { loadChunk } from '../hooks/useChunkLoader';
import { shuffled } from '../lib/shuffle';
import type { Question, QuizFilter, QuizModule } from './types';

interface AreaEntry {
  code: string;
  munis: string[];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

interface AreaChunk {
  pref: number;
  areas: AreaEntry[];
}

function mergeBbox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

async function loadQuestions(filter: QuizFilter): Promise<Question[]> {
  const chunks = await Promise.all(
    filter.prefs.map((p) =>
      loadChunk<AreaChunk>(`areacodes/pref-${String(p).padStart(2, '0')}.json`),
    ),
  );

  // 県またぎ局番は選択県分をマージして1問にする
  const byCode = new Map<string, { munis: string[]; bbox: [number, number, number, number]; coords: MultiPolygon['coordinates'] }>();
  for (const chunk of chunks) {
    for (const area of chunk.areas) {
      const cur = byCode.get(area.code);
      if (cur) {
        cur.coords = cur.coords.concat(area.geom.coordinates);
        cur.bbox = mergeBbox(cur.bbox, area.bbox);
        for (const m of area.munis) if (!cur.munis.includes(m)) cur.munis.push(m);
      } else {
        byCode.set(area.code, { munis: [...area.munis], bbox: [...area.bbox] as [number, number, number, number], coords: area.geom.coordinates });
      }
    }
  }

  let pool = [...byCode.keys()];
  if (filter.codePrefixes && filter.codePrefixes.length > 0) {
    pool = pool.filter((c) => filter.codePrefixes!.some((p) => c.startsWith(p)));
  }
  // 出題数の絞り込みはランダムに行い、昇順モードでは選ばれた問題を局番順に並べ替える
  const codes = shuffled(pool).slice(0, filter.questionCount);
  if (filter.order === 'asc') codes.sort((a, b) => a.localeCompare(b));
  return codes.map((code) => {
    const e = byCode.get(code)!;
    const center: [number, number] = [(e.bbox[1] + e.bbox[3]) / 2, (e.bbox[0] + e.bbox[2]) / 2];
    const muniSummary = e.munis.slice(0, 3).join('・') + (e.munis.length > 3 ? ' など' : '');
    return {
      id: `areacode:${code}`,
      prompt: code,
      sub: '市外局番クイズ',
      targets: [
        {
          id: code,
          label: `${code}（${muniSummary}）`,
          kind: 'polygon' as const,
          point: center,
          bbox: e.bbox,
          geom: { type: 'MultiPolygon' as const, coordinates: e.coords },
        },
      ],
    };
  });
}

export const areaCodeQuiz: QuizModule = {
  meta: {
    id: 'areacode',
    title: '市外局番クイズ',
    description:
      '出題された市外局番のエリアを地図でクリック。エリア内なら正解。区画は総務省の市外局番一覧に基づく（複数局番に分かれる市区町村は町丁単位で区分）。',
    usesRadius: false,
    hasOperatorFilter: false,
    hasAreaCodeFilters: true,
    hoverKind: 'areacode',
  },
  loadQuestions,
};
