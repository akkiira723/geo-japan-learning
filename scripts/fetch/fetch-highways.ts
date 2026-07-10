import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/** 混雑・レート制限（429/504）に備えて複数の Overpass インスタンスをローテーションする */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** overpass-api.de のレート制限（数クエリ/分）を踏まないためのバッチ間ウェイト */
const BATCH_DELAY_MS = 8000;
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';

const JP_AREA = 'area["ISO3166-1"="JP"][admin_level=2]->.jp;';

/** IC・JCT・都市高速出入口（名前つき motorway_junction ノード） */
const QUERY_JUNCTIONS = `
[out:json][timeout:600];
${JP_AREA}
node["highway"="motorway_junction"]["name"](area.jp);
out body;`;

/**
 * junction ノードを含む way（道路名・operator の join 用。node refs が要るので out body）。
 * 全国一括だと応答が大きすぎて 504/途切れが頻発するため、取得済み junction の
 * ノード ID をバッチに分けて問い合わせる（キャッシュは junctions.json から決定的に切れる）
 */
const WAYS_BATCH_SIZE = 500;
const queryWaysBatch = (nodeIds: number[]) => `
[out:json][timeout:180];
node(id:${nodeIds.join(',')});
way(bn)["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"];
out body;`;

/** SA/PA（way/relation は center で代表点を得る） */
const QUERY_SERVICES = `
[out:json][timeout:600];
${JP_AREA}
nwr["highway"~"^(services|rest_area)$"]["name"](area.jp);
out center tags;`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OverpassResponse {
  elements: unknown[];
  remark?: string;
}

async function fetchOverpass(label: string, query: string, cachePath: string): Promise<number> {
  if (existsSync(cachePath)) {
    const cached: OverpassResponse = JSON.parse(await readFile(cachePath, 'utf8'));
    console.log(`${label}: キャッシュ済み（${cached.elements.length} 要素、スキップ）`);
    return cached.elements.length;
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      console.log(`${label}: 取得中… (${endpoint})`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(360_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OverpassResponse;
      // remark はタイムアウト・メモリ超過の警告。空レスポンスも「済み」に見える事故を防ぐため書かない
      if (json.remark) throw new Error(`Overpass remark: ${json.remark}`);
      if (!Array.isArray(json.elements) || json.elements.length === 0) {
        throw new Error('elements が空');
      }
      await writeFile(cachePath, JSON.stringify(json), 'utf8');
      console.log(`${label}: ${json.elements.length} 要素 → ${cachePath}`);
      return json.elements.length;
    } catch (err) {
      console.warn(`  リトライ ${attempt}/5: ${err instanceof Error ? err.message : err}`);
      if (attempt === 5) throw err;
      await sleep(8000 * attempt);
    }
  }
  throw new Error('unreachable');
}

/** junction ノード ID のバッチごとに親 way を取得し、重複を除いて ways.json にまとめる */
async function fetchWays(): Promise<void> {
  const outPath = 'data-cache/highway/ways.json';
  if (existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`親way: キャッシュ済み（${cached.elements.length} 要素、スキップ）`);
    return;
  }
  const junctions = JSON.parse(await readFile('data-cache/highway/junctions.json', 'utf8'));
  const ids: number[] = junctions.elements.map((e: { id: number }) => e.id).sort((a: number, b: number) => a - b);
  const byWayId = new Map<number, unknown>();
  for (let i = 0; i < ids.length; i += WAYS_BATCH_SIZE) {
    const batch = ids.slice(i, i + WAYS_BATCH_SIZE);
    const part = `data-cache/highway/ways-part-${String(i / WAYS_BATCH_SIZE).padStart(2, '0')}.json`;
    await fetchOverpass(
      `親way ${i / WAYS_BATCH_SIZE + 1}/${Math.ceil(ids.length / WAYS_BATCH_SIZE)}`,
      queryWaysBatch(batch),
      part,
    );
    const json = JSON.parse(await readFile(part, 'utf8'));
    for (const el of json.elements as { id: number }[]) byWayId.set(el.id, el);
    await sleep(BATCH_DELAY_MS);
  }
  await writeFile(outPath, JSON.stringify({ elements: [...byWayId.values()] }), 'utf8');
  console.log(`親way: 計 ${byWayId.size} way → ${outPath}`);
}

async function main() {
  await mkdir('data-cache/highway', { recursive: true });
  await fetchOverpass('IC/JCTノード', QUERY_JUNCTIONS, 'data-cache/highway/junctions.json');
  await fetchWays();
  await fetchOverpass('SA/PA', QUERY_SERVICES, 'data-cache/highway/services.json');
  console.log('完了');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
